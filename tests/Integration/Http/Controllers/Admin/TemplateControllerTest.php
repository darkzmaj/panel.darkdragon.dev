<?php

namespace Pterodactyl\Tests\Integration\Http\Controllers\Admin;

use Pterodactyl\Models\User;
use Illuminate\Support\Facades\Queue;
use Pterodactyl\Models\ServerTemplate;
use Pterodactyl\Models\TemplateInstance;
use Pterodactyl\Jobs\ProvisionTemplateInstanceJob;
use Pterodactyl\Tests\Integration\Http\HttpTestCase;
use Pterodactyl\Tests\Traits\Integration\BuildsTemplates;
use Pterodactyl\Tests\Traits\Integration\RemovesAddedRows;

class TemplateControllerTest extends HttpTestCase
{
    use BuildsTemplates;
    use RemovesAddedRows;

    public function setUp(): void
    {
        parent::setUp();
        $this->useTemplateStorage();

        defined('LARAVEL_START') || define('LARAVEL_START', microtime(true));
        $this->rememberHighWater();
        Queue::fake();
    }

    public function tearDown(): void
    {
        $this->removeTemplateStorage();
        $this->removeAddedRows();
        parent::tearDown();
    }

    /**
     * Form input as a browser would send it (everything is a string).
     */
    private function formInput(array $override = []): array
    {
        $input = $this->templateInput($override);
        foreach (['oom_disabled', 'start_automatically', 'temporary', 'allow_instance_delete', 'enabled'] as $flag) {
            $input[$flag] = $input[$flag] ? '1' : '0';
        }

        return $input;
    }

    public function testOnlyAdministratorsCanReachTemplates(): void
    {
        $template = $this->makeTemplate();
        $user = User::factory()->create();
        $guest = [
            ['get', '/admin/templates'], ['get', '/admin/templates/new'], ['get', "/admin/templates/view/{$template->id}"],
            ['post', '/admin/templates/new'], ['patch', "/admin/templates/view/{$template->id}"],
            ['post', "/admin/templates/view/{$template->id}/duplicate"], ['post', "/admin/templates/view/{$template->id}/toggle"],
            ['delete', "/admin/templates/view/{$template->id}"], ['get', "/admin/templates/view/{$template->id}/files"],
            ['put', "/admin/templates/view/{$template->id}/files"], ['delete', "/admin/templates/view/{$template->id}/files"],
            ['post', "/admin/templates/view/{$template->id}/instances"],
        ];

        foreach ($guest as [$method, $url]) {
            $this->app['auth']->forgetGuards();
            $this->actingAs($user)->{$method}($url)->assertForbidden();
        }

        $this->assertDatabaseHas('server_templates', ['id' => $template->id, 'name' => 'Lobby']);
    }

    public function testAdministratorsSeeTheListAndTheEditor(): void
    {
        $admin = User::factory()->admin()->create();
        $template = $this->makeTemplate();

        $this->actingAs($admin)->get('/admin/templates')->assertOk()->assertSee('Lobby')->assertSee('Templates');
        $this->actingAs($admin)->get('/admin/templates/new')->assertOk()->assertSee('Create Template');
        $this->actingAs($admin)->get("/admin/templates/view/{$template->id}")->assertOk()->assertSee('Revision 1')->assertSee('template-file-editor', false);
    }

    public function testATemplateCanBeCreatedEditedDuplicatedDisabledAndDeleted(): void
    {
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->post('/admin/templates/new', $this->formInput(['name' => 'Survival']))->assertRedirect();
        $template = ServerTemplate::query()->where('name', 'Survival')->firstOrFail();
        $this->assertSame('survival', $template->slug);

        $this->actingAs($admin)->patch("/admin/templates/view/{$template->id}", $this->formInput(['name' => 'Survival', 'memory' => 512]))
            ->assertRedirect(route('admin.templates.view', $template->id));
        $this->assertSame(2, $template->refresh()->revision);

        $this->actingAs($admin)->post("/admin/templates/view/{$template->id}/duplicate")->assertRedirect();
        $copy = ServerTemplate::query()->where('slug', 'survival-copy')->firstOrFail();
        $this->assertFalse($copy->enabled);

        $this->actingAs($admin)->post("/admin/templates/view/{$template->id}/toggle")->assertRedirect();
        $this->assertFalse($template->refresh()->enabled);

        $this->actingAs($admin)->delete("/admin/templates/view/{$copy->id}")->assertRedirect(route('admin.templates'));
        $this->assertDatabaseMissing('server_templates', ['id' => $copy->id]);
    }

    public function testInvalidFormInputIsRejectedWithErrorsAndNothingIsSaved(): void
    {
        $admin = User::factory()->admin()->create();
        $before = ServerTemplate::query()->count();

        // Browsers get a redirect back to the form with the errors; the test client asks for JSON.
        $this->actingAs($admin)->post('/admin/templates/new', $this->formInput(['docker_image' => 'evil/image']))
            ->assertUnprocessable()->assertJsonPath('errors.0.meta.source_field', 'docker_image');
        $this->app['auth']->forgetGuards();
        $this->actingAs($admin)->withHeader('Accept', 'text/html')->post('/admin/templates/new', $this->formInput(['docker_image' => 'evil/image', 'memory' => -1]))
            ->assertSessionHasErrors(['memory']);

        $this->assertSame($before, ServerTemplate::query()->count());
    }

    public function testSystemColumnsCannotBeSetThroughTheForm(): void
    {
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->post('/admin/templates/new', $this->formInput(['name' => 'Sneaky', 'uuid' => 'x', 'revision' => 50, 'id' => 99999]));
        $template = ServerTemplate::query()->where('name', 'Sneaky')->firstOrFail();

        $this->assertNotSame('x', $template->uuid);
        $this->assertSame(1, $template->revision);
        $this->assertNotSame(99999, $template->id);
    }

    public function testFilesCanBeEditedPublishedMovedAndDownloaded(): void
    {
        $admin = User::factory()->admin()->create();
        $template = $this->makeTemplate();
        $base = "/admin/templates/view/{$template->id}";

        $this->actingAs($admin)->putJson("$base/files", ['path' => 'plugins/a.yml', 'content' => "a: 1\n"])->assertOk();
        $listing = $this->actingAs($admin)->getJson("$base/files")->assertOk();
        $listing->assertJsonPath('status.dirty', true)->assertJsonPath('status.added', 1)->assertJsonPath('status.revision', 1);
        $this->assertContains('plugins/a.yml', collect($listing->json('data'))->pluck('path')->all());
        $this->actingAs($admin)->getJson("$base/files/content?path=plugins/a.yml")->assertOk()->assertJsonPath('content', "a: 1\n");

        // Raw uploads are not limited by PHP's upload settings and may be binary.
        $binary = random_bytes(5000);
        $this->actingAs($admin)->call('PUT', "$base/files/upload?path=" . rawurlencode('plugins/Essentials.jar'), [], [], [], ['CONTENT_TYPE' => 'application/octet-stream'], $binary)->assertOk();
        $this->actingAs($admin)->getJson("$base/files/content?path=plugins/Essentials.jar")->assertOk()->assertJsonPath('binary', true);
        $this->actingAs($admin)->get("$base/files/download?path=" . rawurlencode('plugins/Essentials.jar'))->assertOk();

        $this->actingAs($admin)->postJson("$base/files/folder", ['path' => 'world/region'])->assertCreated();
        $this->actingAs($admin)->postJson("$base/files/move", ['from' => 'plugins/a.yml', 'to' => 'world/a.yml'])->assertOk();
        $this->actingAs($admin)->postJson("$base/files/move", ['from' => 'world', 'to' => 'world/region/inside'])->assertStatus(400);

        // Nothing is published until asked; then a revision is recorded.
        $this->assertSame(0, $template->files()->count());
        $this->actingAs($admin)->postJson("$base/publish")->assertOk()->assertJsonPath('created_revision', true)->assertJsonPath('revision', 2);
        $this->assertSame(['plugins/Essentials.jar', 'world/a.yml'], $template->files()->pluck('path')->all());
        $this->actingAs($admin)->postJson("$base/publish")->assertOk()->assertJsonPath('created_revision', false);

        $this->actingAs($admin)->deleteJson("$base/files", ['path' => 'world'])->assertOk();
        $this->actingAs($admin)->getJson("$base/files")->assertJsonPath('status.deleted', 1);
    }

    public function testTraversalAndUnsafePathsAreRefusedOnEveryFileEndpoint(): void
    {
        $admin = User::factory()->admin()->create();
        $template = $this->makeTemplate();
        $base = "/admin/templates/view/{$template->id}";
        $this->actingAs($admin)->putJson("$base/files", ['path' => 'ok.txt', 'content' => 'ok'])->assertOk();

        foreach (['../../.env', '/etc/passwd', 'a/../../b', '%2e%2e/x', '%252e%252e/x', 'a\\b', 'C:/x', '.pterodactyl/x', "a\0b", './x', 'a//b'] as $path) {
            $q = rawurlencode($path);
            $this->actingAs($admin)->putJson("$base/files", ['path' => $path, 'content' => 'x'])->assertStatus(400);
            $this->actingAs($admin)->getJson("$base/files/content?path=$q")->assertStatus(400);
            $this->actingAs($admin)->call('PUT', "$base/files/upload?path=$q", [], [], [], ['HTTP_ACCEPT' => 'application/json'], 'x')->assertStatus(400);
            $this->actingAs($admin)->postJson("$base/files/folder", ['path' => $path])->assertStatus(400);
            $this->actingAs($admin)->postJson("$base/files/move", ['from' => 'ok.txt', 'to' => $path])->assertStatus(400);
            $this->actingAs($admin)->postJson("$base/files/move", ['from' => $path, 'to' => 'x.txt'])->assertStatus(400);
            $this->actingAs($admin)->getJson("$base/files/download?path=$q")->assertStatus(400);
            $this->actingAs($admin)->deleteJson("$base/files", ['path' => $path])->assertStatus(400);
        }

        // Only the one legitimate file exists, and a missing file is a clean error.
        $this->assertSame(['ok.txt'], collect(app(\Pterodactyl\Services\Templates\TemplateFileStore::class)->scan($template))->pluck('path')->all());
        $this->actingAs($admin)->getJson("$base/files/content?path=missing.yml")->assertStatus(400);
    }

    public function testFilesOfOneTemplateAreNotReachableThroughAnother(): void
    {
        $admin = User::factory()->admin()->create();
        $one = $this->makeTemplate(['name' => 'One']);
        $two = $this->makeTemplate(['name' => 'Two']);
        app(\Pterodactyl\Services\Templates\TemplateService::class)->putFile($one, 'secret.txt', 'one');

        $this->actingAs($admin)->getJson("/admin/templates/view/{$two->id}/files/content?path=secret.txt")->assertStatus(400);
        $this->actingAs($admin)->getJson("/admin/templates/view/{$two->id}/files/download?path=secret.txt")->assertStatus(400);
    }

    public function testAnInstanceCanBeQueuedFromTheAdminPanel(): void
    {
        $admin = User::factory()->admin()->create();
        $template = $this->makeTemplate();

        $this->actingAs($admin)->post("/admin/templates/view/{$template->id}/instances", ['name' => 'Hand made', 'owner_id' => $admin->id])
            ->assertRedirect(route('admin.templates.view', $template->id));

        $instance = TemplateInstance::query()->where('name', 'Hand made')->firstOrFail();
        $this->assertSame('queued', $instance->state);
        Queue::assertPushed(ProvisionTemplateInstanceJob::class);

        $this->actingAs($admin)->getJson("/admin/templates/view/{$template->id}/instances/{$instance->uuid}")
            ->assertOk()->assertJsonPath('state', 'queued')->assertJsonPath('finished', false);

        // An instance id from another template never resolves.
        $other = $this->makeTemplate(['name' => 'Other']);
        $this->actingAs($admin)->getJson("/admin/templates/view/{$other->id}/instances/{$instance->uuid}")->assertNotFound();
    }
}
