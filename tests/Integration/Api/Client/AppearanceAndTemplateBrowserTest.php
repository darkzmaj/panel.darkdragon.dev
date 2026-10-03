<?php

namespace Pterodactyl\Tests\Integration\Api\Client;

use Pterodactyl\Models\User;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Services\Media\FooterService;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;
use Pterodactyl\Tests\Traits\Integration\RemovesAddedRows;

class AppearanceAndTemplateBrowserTest extends ClientApiIntegrationTestCase
{
    use BuildsTemplates;
    use RemovesAddedRows;

    public function setUp(): void
    {
        parent::setUp();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));
        $this->rememberHighWater();
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        DB::table('server_template_revisions')->where('id', '>', 0)->whereNotIn('template_id', DB::table('server_templates')->select('id'))->delete();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        $this->removeAddedRows();

        parent::tearDown();
    }

    public function testThemeIsStoredPerUserAndValidated(): void
    {
        $user = User::factory()->create();
        $this->assertSame('system', $user->fresh()->theme ?? 'system', 'System is the default');

        foreach (['dark', 'light', 'system'] as $theme) {
            $this->actingAs($user)->putJson('/api/client/account/appearance', ['theme' => $theme])
                ->assertOk()->assertJson(['theme' => $theme]);
            $this->assertSame($theme, $user->fresh()->theme);
        }

        $this->actingAs($user)->putJson('/api/client/account/appearance', ['theme' => 'neon'])->assertUnprocessable();
        $this->actingAs($user)->putJson('/api/client/account/appearance', [])->assertUnprocessable();
        $this->assertSame('system', $user->fresh()->theme);
    }

    public function testThemeIsPartOfTheUserObjectGivenToTheApp(): void
    {
        $user = User::factory()->create(['theme' => 'light']);

        $this->assertSame('light', $user->toVueObject()['theme']);
    }

    public function testTheTemplateBrowserIsAdministratorsOnly(): void
    {
        $this->useTemplateStorage();
        $template = $this->makeTemplate();
        $user = User::factory()->create();

        $this->actingAs($user)->getJson('/api/client/templates')->assertForbidden();
        $this->actingAs($user)->getJson("/api/client/templates/{$template->id}")->assertForbidden();
        $this->actingAs($user)->postJson("/api/client/templates/{$template->id}/instances", ['name' => 'X'])->assertForbidden();

        $this->removeTemplateStorage();
    }

    public function testAdministratorsSeeTemplatesAndAProposedNumberedName(): void
    {
        $this->useTemplateStorage();
        $template = $this->makeTemplate(['name' => 'Browser Hub %number%']);
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->getJson('/api/client/templates')->assertOk()
            ->assertJsonFragment(['name' => 'Browser Hub %number%']);
        $this->actingAs($admin)->getJson("/api/client/templates/{$template->id}")->assertOk()
            ->assertJsonPath('proposed_name', 'Browser Hub 1');

        $this->removeTemplateStorage();
    }

    public function testOnlyTheOverridesATemplateAllowsAreAccepted(): void
    {
        Queue::fake();
        $this->useTemplateStorage();
        $this->makeNode();
        $template = $this->makeTemplate();
        $admin = User::factory()->admin()->create();

        // A resource override is not something the browser may send.
        $this->actingAs($admin)->postJson("/api/client/templates/{$template->id}/instances", ['name' => 'Y', 'memory' => 99999])
            ->assertUnprocessable()->assertJsonPath('errors.0.meta.source_field', 'memory');

        $this->removeTemplateStorage();
    }

    public function testTheFooterIsBuiltFromConfiguration(): void
    {
        config([
            'gobia_ui.site_url' => 'https://example.test',
            'gobia_ui.footer' => [
                'PRODUCT' => [['label' => 'Cloud', 'href' => '/cloud'], ['label' => 'Roadmap', 'href' => 'https://other.test/x']],
                'COMPANY' => [['label' => 'Careers', 'soon' => true]],
            ],
        ]);

        $footer = app(FooterService::class)->build();

        $this->assertSame(['PRODUCT', 'COMPANY'], array_column($footer['columns'], 'title'));
        $this->assertSame('https://example.test/cloud', $footer['columns'][0]['links'][0]['href']);
        $this->assertSame('https://other.test/x', $footer['columns'][0]['links'][1]['href']);
        $this->assertTrue($footer['columns'][1]['links'][0]['soon']);
        $this->assertNull($footer['columns'][1]['links'][0]['href']);
    }
}
