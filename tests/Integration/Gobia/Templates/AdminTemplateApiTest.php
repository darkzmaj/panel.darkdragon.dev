<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia\Templates;

use GobiaTemplates\Jobs\ProvisionTemplateInstanceJob;
use GobiaTemplates\Models\ServerTemplate;
use GobiaTemplates\Models\TemplateInstance;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\Gobia\BuildsTemplates;
use Pterodactyl\Tests\Integration\IntegrationTestCase;

/** The administration API and the dashboard browser: administrators only, files confined to the template. */
class AdminTemplateApiTest extends IntegrationTestCase
{
    use BuildsTemplates;

    private const ADMIN = '/api/admin/extensions/gobia-templates';

    private const CLIENT = '/api/client/extensions/gobia-templates';

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTemplates();
        Queue::fake();
        $this->admin = User::factory()->create(['root_admin' => true]);
    }

    protected function tearDown(): void
    {
        $this->shutdownTemplates();
        parent::tearDown();
    }

    public function test_everything_needs_an_administrator(): void
    {
        $template = $this->makeTemplate();
        $this->getJson(self::ADMIN.'/templates')->assertUnauthorized();
        $this->actingAs(User::factory()->create());
        foreach ([['getJson', '/templates'], ['getJson', "/templates/{$template->id}"], ['getJson', '/options'], ['postJson', "/templates/{$template->id}/publish"], ['getJson', "/templates/{$template->id}/files"], ['deleteJson', "/templates/{$template->id}"]] as [$method, $path]) {
            $this->{$method}(self::ADMIN.$path)->assertForbidden();
        }
        foreach ([['getJson', '/templates'], ['getJson', '/owners'], ['getJson', "/templates/{$template->id}"], ['postJson', "/templates/{$template->id}/instances"]] as [$method, $path]) {
            $this->{$method}(self::CLIENT.$path)->assertForbidden();
        }
    }

    public function test_the_revision_list_names_the_author_the_changes_and_the_servers_pinned_to_each_revision(): void
    {
        $this->actingAs($this->admin);
        $id = $this->postJson(self::ADMIN.'/templates', $this->templateInput())->assertCreated()->json('template.id');
        $this->patchJson(self::ADMIN."/templates/{$id}", $this->templateInput(['memory' => 2048]))->assertOk();

        $list = $this->getJson(self::ADMIN."/templates/{$id}/revisions")->assertOk()->json('data');

        $this->assertCount(2, $list);
        $this->assertSame([2, 1], array_column($list, 'revision'));
        $this->assertTrue($list[0]['current']);
        $this->assertFalse($list[1]['current']);
        $this->assertSame($this->admin->username, $list[0]['created_by']['username']);
        $this->assertSame(2048, $list[0]['summary']['memory']);
        $this->assertSame(['First revision'], $list[1]['changes']);
        $this->assertStringContainsString('Memory', implode(' ', $list[0]['changes']));
        $this->assertSame(0, $list[0]['instances']);
    }

    public function test_an_administrator_creates_edits_duplicates_toggles_and_deletes_a_template(): void
    {
        $this->actingAs($this->admin);
        $created = $this->postJson(self::ADMIN.'/templates', $this->templateInput())->assertCreated()->json('template');
        $this->assertSame('lobby', $created['slug']);
        $this->assertFalse($created['api_enabled']);

        $this->postJson(self::ADMIN.'/templates', $this->templateInput(['memory' => -1]))->assertUnprocessable();

        $update = $this->patchJson(self::ADMIN."/templates/{$created['id']}", $this->templateInput(['memory' => 1024, 'api_enabled' => true]))->assertOk();
        $update->assertJsonPath('created_revision', true)->assertJsonPath('template.revision', 2)->assertJsonPath('template.api_enabled', true);
        $this->patchJson(self::ADMIN."/templates/{$created['id']}", $this->templateInput(['memory' => 1024, 'api_enabled' => true]))->assertJsonPath('created_revision', false);

        $copy = $this->postJson(self::ADMIN."/templates/{$created['id']}/duplicate")->assertCreated()->json('template');
        $this->assertFalse($copy['enabled']);
        $this->postJson(self::ADMIN."/templates/{$copy['id']}/toggle")->assertOk()->assertJsonPath('enabled', true);

        $this->deleteJson(self::ADMIN."/templates/{$copy['id']}")->assertOk();
        $this->getJson(self::ADMIN."/templates/{$copy['id']}")->assertNotFound();
        $this->assertCount(1, $this->getJson(self::ADMIN.'/templates')->json('data'));
    }

    public function test_files_live_in_the_working_tree_and_publishing_makes_an_immutable_revision(): void
    {
        $template = $this->makeTemplate();
        $base = self::ADMIN."/templates/{$template->id}";
        $this->actingAs($this->admin);

        $this->putJson("$base/files", ['path' => 'plugins/config.yml', 'content' => "a: 1\n"])->assertOk();
        $this->getJson("$base/files/content?path=plugins/config.yml")->assertOk()->assertJsonPath('content', "a: 1\n");
        $this->postJson("$base/files/folder", ['path' => 'maps'])->assertCreated();
        $this->postJson("$base/files/move", ['from' => 'plugins/config.yml', 'to' => 'plugins/settings.yml'])->assertOk();
        $listing = $this->getJson("$base/files")->assertOk();
        $this->assertContains('plugins/settings.yml', array_column($listing->json('data'), 'path'));
        $listing->assertJsonPath('status.dirty', true);

        $this->postJson("$base/publish")->assertOk()->assertJsonPath('created_revision', true)->assertJsonPath('revision', 2);
        $this->putJson("$base/files", ['path' => 'plugins/settings.yml', 'content' => "a: 2\n"])->assertOk();
        $revision = $template->refresh()->revisions()->where('revision', 2)->firstOrFail();
        $this->assertSame('plugins/settings.yml', $revision->snapshot['files'][0]['path']);
        // The published revision does not change when the working tree does.
        $this->assertSame(1, $template->refresh()->files()->count());

        $this->deleteJson("$base/files", ['path' => 'plugins/settings.yml'])->assertOk();
        $this->getJson("$base/files/download?path=plugins/settings.yml")->assertStatus(400);
    }

    public function test_paths_that_escape_the_template_are_refused_everywhere(): void
    {
        $template = $this->makeTemplate();
        $base = self::ADMIN."/templates/{$template->id}";
        $this->actingAs($this->admin);

        foreach (['../../etc/passwd', '/etc/passwd', 'a/../../b', '..', 'C:\\x', 'a%2f..%2fb', "a\0b", 'a//b', './x'] as $path) {
            $this->putJson("$base/files", ['path' => $path, 'content' => 'x'])->assertStatus(400);
            $this->getJson("$base/files/content?path=".rawurlencode($path))->assertStatus(400);
            $this->getJson("$base/files/download?path=".rawurlencode($path))->assertStatus(400);
            $this->postJson("$base/files/move", ['from' => 'a.txt', 'to' => $path])->assertStatus(400);
            $this->deleteJson("$base/files", ['path' => $path])->assertStatus(400);
        }
        $this->assertSame(0, $template->refresh()->files()->count());
    }

    public function test_raw_uploads_are_stored_and_limited(): void
    {
        $template = $this->makeTemplate();
        $base = self::ADMIN."/templates/{$template->id}";
        $this->actingAs($this->admin);

        $this->call('PUT', "$base/files/upload?path=server.jar", [], [], [], ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'], str_repeat('A', 2048))->assertOk()->assertJsonPath('size', 2048);
        $this->call('PUT', "$base/files/upload?path=../x.jar", [], [], [], ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'], 'x')->assertStatus(400);
        config(['gobia_templates.limits.max_file_bytes' => 1000]);
        $this->call('PUT', "$base/files/upload?path=big.jar", [], [], [], ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'], str_repeat('A', 2048))->assertStatus(400);
    }

    public function test_the_browser_shows_only_enabled_templates_and_creates_instances(): void
    {
        $this->makeNode();
        $enabled = $this->makeTemplate(['name' => 'World %number%']);
        $this->makeTemplate(['name' => 'Hidden', 'enabled' => false]);
        $this->actingAs($this->admin);

        $list = $this->getJson(self::CLIENT.'/templates')->assertOk()->json('data');
        $this->assertSame(['World %number%'], array_column($list, 'name'));
        $this->getJson(self::CLIENT."/templates/{$enabled->id}")->assertOk()->assertJsonPath('proposed_name', 'World 1');

        $this->postJson(self::CLIENT."/templates/{$enabled->id}/instances", ['name' => 'World 1'])->assertStatus(202)->assertJsonPath('state', 'queued');
        $this->postJson(self::CLIENT."/templates/{$enabled->id}/instances", ['name' => 'World 2', 'memory' => 99999])->assertUnprocessable();
        Queue::assertPushed(ProvisionTemplateInstanceJob::class, 1);
        $instance = TemplateInstance::query()->firstOrFail();
        $this->assertSame($this->admin->id, $instance->owner_id);
        $this->getJson(self::CLIENT."/templates/{$enabled->id}/instances/{$instance->uuid}")->assertOk()->assertJsonPath('id', $instance->uuid);
        $this->getJson(self::CLIENT.'/owners?q='.$this->admin->username)->assertOk()->assertJsonPath('data.0.id', $this->admin->id);
    }

    public function test_the_next_number_is_proposed_deterministically(): void
    {
        $this->makeNode();
        $template = $this->makeTemplate(['name' => 'Hub %number%']);
        $this->createServerModel(['name' => 'Hub 1']);
        $this->createServerModel(['name' => 'Hub 2']);
        $this->actingAs($this->admin);

        $this->getJson(self::CLIENT."/templates/{$template->id}")->assertJsonPath('proposed_name', 'Hub 3');
        $this->assertInstanceOf(ServerTemplate::class, $template);
    }
}
