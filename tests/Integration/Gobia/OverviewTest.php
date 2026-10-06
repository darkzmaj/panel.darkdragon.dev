<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\OverviewTest;

use GobiaCore\Services\NodeStatsService;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Models\Location;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class);

const OVERVIEW = '/api/admin/extensions/gobia-core/overview';

beforeEach(function (): void {
    Cache::flush();
    $this->installGobia(['gobia-core']);
});
afterEach(fn () => $this->uninstallGobia());

/** A node client answering from canned responses; no node is ever contacted. */
function fakeNodes(array $byName): void
{
    app()->instance(NodeStatsService::class, new NodeStatsService(function (Node $node) use ($byName): Client {
        $queue = $byName[$node->name] ?? [new ConnectException('down', new Request('GET', '/'))];

        return new Client(['handler' => HandlerStack::create(new MockHandler($queue)), 'base_uri' => 'http://node.invalid']);
    }));
}

test('only administrators can read the overview', function (): void {
    $this->getJson(OVERVIEW)->assertUnauthorized();
    $this->actingAs(User::factory()->create())->getJson(OVERVIEW)->assertForbidden();
});

test('totals count users, administrators, nodes, instances and locations', function (): void {
    fakeNodes([]);
    $admin = User::factory()->create(['root_admin' => true]);
    User::factory()->count(2)->create();
    $location = Location::factory()->create();
    Node::factory()->for($location)->create(['name' => 'N1']);
    $this->createServerModel(['owner_id' => $admin->id]);

    $totals = $this->actingAs($admin)->getJson(OVERVIEW)->assertOk()->json('totals');
    expect($totals['administrators'])->toBe(1);
    expect($totals['users'])->toBeGreaterThanOrEqual(3);
    expect($totals['instances'])->toBeGreaterThanOrEqual(1);
    expect($totals['nodes'])->toBeGreaterThanOrEqual(1);
    expect($totals['locations'])->toBeGreaterThanOrEqual(1);
    expect($totals['templates'])->toBe(0);
});

test('an unreachable node is reported offline and does not break the overview', function (): void {
    $location = Location::factory()->create();
    Node::factory()->for($location)->create(['name' => 'Online', 'memory' => 4096, 'disk' => 10000]);
    Node::factory()->for($location)->create(['name' => 'Dead']);
    $system = new Response(200, [], json_encode(['version' => '1.0', 'cpu_count' => 4]));
    $servers = new Response(200, [], json_encode([['state' => 'running', 'utilization' => ['memory_bytes' => 1073741824, 'disk_bytes' => 2147483648, 'cpu_absolute' => 100.0]]]));
    fakeNodes(['Online' => [$system, $servers]]);

    $response = $this->actingAs(User::factory()->create(['root_admin' => true]))->getJson(OVERVIEW)->assertOk();
    $nodes = collect($response->json('nodes'))->keyBy('name');
    expect($nodes['Online']['status'])->toBe('online');
    expect($nodes['Online']['ram']['used'])->toBe(1073741824);
    expect($nodes['Online']['cpu']['percent'])->toEqual(25);
    expect($nodes['Dead']['status'])->toBe('offline');
    expect($nodes['Dead']['ram']['used'])->toBeNull();
    $nodesSummary = $response->json('resources.nodes');
    expect($nodesSummary['online'])->toBeGreaterThanOrEqual(1);
    expect($nodesSummary['offline'])->toBeGreaterThanOrEqual(1);
});

test('allocated capacity is reported separately from live usage', function (): void {
    $location = Location::factory()->create();
    $node = Node::factory()->for($location)->create(['name' => 'Cap', 'memory' => 8192, 'disk' => 50000]);
    $this->createServerModel(['node_id' => $node->id, 'memory' => 2048, 'disk' => 10000]);
    fakeNodes([]);

    $row = collect($this->actingAs(User::factory()->create(['root_admin' => true]))->getJson(OVERVIEW)->json('nodes'))->firstWhere('name', 'Cap');
    expect($row['ram']['total'])->toBe(8192 * 1024 * 1024);
    expect($row['ram']['allocated'])->toBe(2048 * 1024 * 1024);
    expect($row['ram']['used'])->toBeNull();
    expect($row['storage']['allocated'])->toBe(10000 * 1024 * 1024);
});
