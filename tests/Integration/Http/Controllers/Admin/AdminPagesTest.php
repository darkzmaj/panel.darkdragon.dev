<?php

namespace Pterodactyl\Tests\Integration\Http\Controllers\Admin;

use Pterodactyl\Models\Node;
use Pterodactyl\Models\User;
use Pterodactyl\Models\Location;
use Pterodactyl\Tests\Integration\Http\HttpTestCase;
use Pterodactyl\Tests\Traits\Integration\RemovesAddedRows;

/**
 * The server-rendered administration pages of the redesign: the settings menu and the nodes table.
 */
class AdminPagesTest extends HttpTestCase
{
    use RemovesAddedRows;

    public function setUp(): void
    {
        parent::setUp();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));
        $this->rememberHighWater();
    }

    public function tearDown(): void
    {
        $this->removeAddedRows();

        parent::tearDown();
    }

    public function testEverySettingsPageSharesTheLeftHandMenu(): void
    {
        $admin = User::factory()->admin()->create();

        $pages = [
            'General' => '/admin/settings',
            'Branding' => '/admin/settings/branding',
            'Mail' => '/admin/settings/mail',
            'Advanced' => '/admin/settings/advanced',
            'Application API' => '/admin/api',
            'Updates' => '/admin/system/updates',
        ];

        foreach ($pages as $label => $url) {
            $html = $this->actingAs($admin)->get($url)->assertOk()->getContent();

            $this->assertStringContainsString('has-subnav', $html, "$url should use the settings layout");
            $this->assertStringContainsString('aria-label="Settings"', $html);
            foreach (array_keys($pages) as $item) {
                $this->assertStringContainsString($item, $html, "$url should list $item in its menu");
            }
            $this->assertStringContainsString('Appearance', $html);
            $this->assertMatchesRegularExpression('/class="active"\s+aria-current="page"\s*>\s*<i class="fa [a-z -]+"><\/i> ' . preg_quote($label, '/') . '/', $html, "$label should be marked as the current page");
        }
    }

    public function testBrandingFallsBackToTheGobiaAssetsAndOnlyAdministratorsSeeIt(): void
    {
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->get('/admin/settings/branding')
            ->assertOk()
            ->assertSee('/themes/gobia/img/logo-text-480.png', false)
            ->assertSee('Using the default image.')
            ->assertDontSee('pterodactyl.svg');

        $this->actingAs(User::factory()->create())->get('/admin/settings/branding')->assertForbidden();
    }

    public function testTheSettingsPagesNoLongerDescribeThemselvesAsPterodactyl(): void
    {
        $admin = User::factory()->admin()->create();

        foreach (['/admin/settings', '/admin/settings/mail', '/admin/settings/advanced', '/admin/nests'] as $url) {
            $content = $this->actingAs($admin)->get($url)->assertOk()->getContent();
            $this->assertStringNotContainsString('Configure Pterodactyl', $content);
            $this->assertStringNotContainsString('how Pterodactyl', $content);
        }
    }

    public function testTheNodesTableReportsAllocationsInstancesAndRouting(): void
    {
        $admin = User::factory()->admin()->create();
        $location = Location::factory()->create();
        $node = Node::factory()->create([
            'location_id' => $location->id,
            'name' => 'Node Table Test',
            'memory' => 8192,
            'memory_overallocate' => 0,
            'scheme' => 'http',
            'maintenance_mode' => true,
            'public' => false,
        ]);

        $html = $this->actingAs($admin)->get('/admin/nodes')->assertOk()->getContent();

        $this->assertStringContainsString('Node Table Test', $html);
        $this->assertStringContainsString('Maintenance', $html);
        $this->assertStringContainsString('No TLS', $html);
        $this->assertStringContainsString('Private', $html);
        $this->assertStringContainsString('0 MiB of 8 GiB', $html);
        $this->assertStringContainsString('filter[node_id]=' . $node->id, urldecode($html));
        $this->assertStringContainsString('data-gb-menu', $html);

        $this->actingAs(User::factory()->create())->get('/admin/nodes')->assertForbidden();
    }

    public function testInstancesCanBeFilteredByNode(): void
    {
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->get('/admin/servers?filter[node_id]=999999')->assertOk();
    }

    public function testTheMaintenancePageNeedsNoAssetsOtherThanItsIcon(): void
    {
        $html = view('errors.503')->render();

        $this->assertStringContainsString('/themes/gobia/img/icon-64.png', $html);
        $this->assertStringContainsString('prefers-color-scheme: light', $html);
        $this->assertStringNotContainsString('Pterodactyl', $html);
    }
}
