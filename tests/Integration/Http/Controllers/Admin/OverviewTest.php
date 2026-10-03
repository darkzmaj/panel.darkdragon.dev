<?php

namespace Pterodactyl\Tests\Integration\Http\Controllers\Admin;

use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Request;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\User;
use GuzzleHttp\Psr7\Response;
use Pterodactyl\Models\Location;
use GuzzleHttp\Handler\MockHandler;
use Illuminate\Support\Facades\Cache;
use GuzzleHttp\Exception\ConnectException;
use Pterodactyl\Services\Admin\NodeStatsService;
use Pterodactyl\Tests\Integration\Http\HttpTestCase;

class OverviewTest extends HttpTestCase
{
    public function setUp(): void
    {
        parent::setUp();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));
        Cache::forget(NodeStatsService::CACHE_KEY);
    }

    public function tearDown(): void
    {
        \Pterodactyl\Models\Server::query()->forceDelete();
        Node::query()->forceDelete();
        Location::query()->forceDelete();
        User::query()->forceDelete();

        parent::tearDown();
    }

    private function wings(array $data): Response
    {
        return new Response(200, ['Content-Type' => 'application/json'], json_encode($data));
    }

    /**
     * Binds a stats service whose nodes answer from a script: node name => [system, servers] responses.
     */
    private function fakeWings(array $script): void
    {
        $this->app->instance(NodeStatsService::class, new NodeStatsService(function (Node $node) use ($script) {
            $handler = new MockHandler($script[$node->name] ?? [new ConnectException('refused', new Request('GET', '/')), new ConnectException('refused', new Request('GET', '/'))]);

            return new Client(['handler' => HandlerStack::create($handler), 'base_uri' => 'http://wings.invalid']);
        }));
    }

    private function wingsServer(string $state, int $memory, int $disk, float $cpu): array
    {
        return ['state' => $state, 'utilization' => ['memory_bytes' => $memory, 'disk_bytes' => $disk, 'cpu_absolute' => $cpu, 'state' => $state]];
    }

    public function testOverviewShowsRealCountsAndNoMarketingButtons(): void
    {
        $admin = User::factory()->admin()->create();
        User::factory()->count(2)->create();
        $location = Location::factory()->create();
        Node::factory()->count(2)->create(['location_id' => $location->id]);
        $this->createServerModel(['node_id' => Node::query()->first()->id]);

        $response = $this->actingAs($admin)->get('/admin');
        $response->assertOk();
        $html = $response->getContent();

        $expected = [
            'Registered Users' => User::query()->count(),
            'Administrators' => User::query()->where('root_admin', true)->count(),
            'Nodes' => Node::query()->count(),
            'Instances' => \Pterodactyl\Models\Server::query()->count(),
            'Locations' => Location::query()->count(),
        ];
        foreach ($expected as $label => $count) {
            $this->assertMatchesRegularExpression('/<span class="gb-num">' . $count . '<\/span><span class="gb-label">' . preg_quote($label, '/') . '<\/span>/', $html, $label);
        }

        foreach (['Get Help', 'Documentation', 'GitHub', 'Support the Project', 'BASIC ADMINISTRATION'] as $removed) {
            $this->assertStringNotContainsString($removed, $html);
        }
        $this->assertStringContainsString('<strong>Gobia Cloud</strong>. All Rights Reserved.', $html);
        $this->assertStringContainsString('&copy; ' . date('Y'), $html);
    }

    public function testSidebarHasTheNewStructure(): void
    {
        $html = $this->actingAs(User::factory()->admin()->create())->get('/admin')->getContent();

        foreach (['Overview', 'Settings', 'Users', 'Nodes', 'Services'] as $entry) {
            $this->assertStringContainsString('<span>' . $entry . '</span>', $html, $entry);
        }
        foreach (['Dashboard', 'Network'] as $group) {
            $this->assertStringContainsString('<li class="header">' . $group . '</li>', $html, $group);
        }
        foreach (['Application API', 'Databases', 'Locations', 'Mounts', 'Nests'] as $moved) {
            $this->assertStringNotContainsString('<span>' . $moved . '</span>', $html, $moved . ' must not be a standalone sidebar entry');
        }
    }

    public function testNodeStatisticsAggregateOnlineNodesAndSurviveOfflineOnes(): void
    {
        $location = Location::factory()->create(['short' => 'eu']);
        $a = Node::factory()->create(['name' => 'alpha', 'location_id' => $location->id, 'memory' => 8192, 'disk' => 102400]);
        $b = Node::factory()->create(['name' => 'bravo', 'location_id' => $location->id, 'memory' => 4096, 'disk' => 51200]);
        $c = Node::factory()->create(['name' => 'charlie', 'location_id' => $location->id, 'memory' => 2048, 'disk' => 20480]);
        $this->createServerModel(['node_id' => $a->id, 'memory' => 1024, 'disk' => 2048]);

        $this->fakeWings([
            'alpha' => [
                $this->wings(['version' => '1.11.0', 'cpu_count' => 4]),
                $this->wings([$this->wingsServer('running', 512 * 1048576, 1024 * 1048576, 150.0), $this->wingsServer('offline', 0, 100 * 1048576, 0.0)]),
            ],
            // bravo is unreachable (default script), charlie answers with garbage.
            'charlie' => [new Response(200, [], 'not json'), new Response(500, [], 'boom')],
        ]);

        $data = $this->actingAs(User::factory()->admin()->create())->getJson('/admin/stats/nodes')->assertOk()->json();
        $nodes = collect($data['nodes'])->keyBy('name');

        $this->assertSame('online', $nodes['alpha']['status']);
        $this->assertSame('offline', $nodes['bravo']['status']);
        $this->assertSame('offline', $nodes['charlie']['status']);
        $this->assertNull($nodes['bravo']['ram']['used']);

        // 150 % of one core on a four core node is 37.5 % utilization.
        $this->assertSame(37.5, $nodes['alpha']['cpu']['percent']);
        $this->assertSame(512 * 1048576, $nodes['alpha']['ram']['used']);
        $this->assertSame(1, $nodes['alpha']['instances_running']);
        $this->assertSame(1, $nodes['alpha']['instances']);
        $this->assertSame('eu', $nodes['alpha']['location']);

        $g = $data['global'];
        $this->assertSame((8192 + 4096 + 2048) * 1048576, $g['ram']['total']);
        $this->assertSame(1024 * 1048576, $g['ram']['allocated']);
        $this->assertSame(512 * 1048576, $g['ram']['used'], 'only online nodes contribute live usage');
        $this->assertSame((102400 + 51200 + 20480) * 1048576, $g['storage']['total']);
        $this->assertSame(37.5, $g['cpu']['percent']);
        $this->assertSame(1, $g['cpu']['nodes_reporting']);
        $this->assertSame(['total' => 3, 'online' => 1, 'maintenance' => 0, 'offline' => 2], $g['nodes']);
        $this->assertSame(1, $g['instances']['running']);
    }

    public function testCpuIsWeightedByCoreCountAcrossNodes(): void
    {
        $location = Location::factory()->create();
        Node::factory()->create(['name' => 'small', 'location_id' => $location->id]);
        Node::factory()->create(['name' => 'big', 'location_id' => $location->id]);

        $this->fakeWings([
            'big' => [$this->wings(['cpu_count' => 32]), $this->wings([$this->wingsServer('running', 1, 1, 320.0)])],
            'small' => [$this->wings(['cpu_count' => 2]), $this->wings([$this->wingsServer('running', 1, 1, 200.0)])],
        ]);

        $global = $this->actingAs(User::factory()->admin()->create())->getJson('/admin/stats/nodes')->json('global');

        // (320 + 200) busy core-percent over 34 cores = 15.3 %, not the 55 % that averaging 10 % and 100 % would suggest.
        $this->assertSame(15.3, $global['cpu']['percent']);
    }

    public function testStatisticsAreCachedAndRefreshable(): void
    {
        $location = Location::factory()->create();
        Node::factory()->create(['name' => 'alpha', 'location_id' => $location->id]);
        $calls = 0;
        $this->app->instance(NodeStatsService::class, new NodeStatsService(function (Node $node) use (&$calls) {
            ++$calls;
            $handler = new MockHandler([$this->wings(['cpu_count' => 2]), $this->wings([]), $this->wings(['cpu_count' => 2]), $this->wings([])]);

            return new Client(['handler' => HandlerStack::create($handler), 'base_uri' => 'http://wings.invalid']);
        }));
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->getJson('/admin/stats/nodes')->assertOk();
        $this->actingAs($admin)->getJson('/admin/stats/nodes')->assertOk();
        $this->assertSame(1, $calls, 'the second request is served from the cache');

        $this->actingAs($admin)->getJson('/admin/stats/nodes?refresh=1')->assertOk();
        $this->assertSame(2, $calls);
    }

    public function testStatisticsEndpointIsAdminOnly(): void
    {
        $this->actingAs(User::factory()->create())->getJson('/admin/stats/nodes')->assertForbidden();
    }

    public function testUsersPageFiltersAndShowsManagementColumns(): void
    {
        $admin = User::factory()->admin()->create(['username' => 'rootuser', 'email' => 'root@example.com']);
        $alice = User::factory()->create(['username' => 'alice', 'email' => 'alice@example.com', 'use_totp' => true]);
        User::factory()->create(['username' => 'bobby', 'email' => 'bob@example.com']);
        $this->createServerModel(['user_id' => $alice->id]);

        $page = fn (string $query = '') => $this->actingAs($admin)->get('/admin/users' . $query)->assertOk()->getContent();

        $all = $page();
        foreach (['rootuser', 'alice', 'bobby', 'Administrator', 'Owned', 'Accessible', 'Last activity', 'Created'] as $needle) {
            $this->assertStringContainsString($needle, $all);
        }

        $search = $page('?filter[*]=alice');
        $this->assertStringContainsString('alice@example.com', $search);
        $this->assertStringNotContainsString('bob@example.com', $search);

        $admins = $page('?filter[role]=admin');
        $this->assertStringContainsString('root@example.com', $admins);
        $this->assertStringNotContainsString('alice@example.com', $admins);

        $totp = $page('?filter[2fa]=on');
        $this->assertStringContainsString('alice@example.com', $totp);
        $this->assertStringNotContainsString('bob@example.com', $totp);

        // Wildcards typed by the user are matched literally.
        $this->assertStringNotContainsString('alice@example.com', $page('?filter[*]=%25'));
    }

    public function testTabsGroupTheRelocatedAdminPages(): void
    {
        $admin = User::factory()->admin()->create();
        $expect = [
            '/admin/settings' => ['General', 'Mail', 'Advanced', 'Application API', 'Branding'],
            '/admin/api' => ['General', 'Application API'],
            '/admin/nodes' => ['Nodes', 'Instances', 'Locations'],
            '/admin/servers' => ['Nodes', 'Instances'],
            '/admin/mounts' => ['Mounts', 'Nests', 'Databases'],
            '/admin/nests' => ['Mounts', 'Nests'],
        ];

        foreach ($expect as $url => $labels) {
            $html = $this->actingAs($admin)->get($url)->assertOk()->getContent();
            foreach ($labels as $label) {
                $this->assertStringContainsString($label, $html, "$url should show $label");
            }
        }
    }
}
