<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Extensions\AuditProbeTest;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Pterodactyl\Contracts\Extensions\InstallsExtensions;
use Pterodactyl\Events\Server\OperationCompleted;
use Pterodactyl\Models\Extension;
use Pterodactyl\Models\ExtensionSetting;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Extensions\ExtensionRepository;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

/*
 * Capability audit of the extension backend API using the disposable "audit-probe" extension in
 * tools/audit-probe (copied to a temp directory with a stub bundle per run). Not a Gobia feature test.
 */
uses(ClientApiIntegrationTestCase::class);

beforeEach(function (): void {
    $this->directory = sys_get_temp_dir().'/ptero-audit-'.uniqid();
    mkdir($this->directory.'/installed', 0777, true);
    config(['extensions.enabled' => true, 'extensions.directory' => $this->directory.'/installed']);
    $this->app->make(ExtensionRepository::class)->flushDiscovery();
    $source = $this->directory.'/source';
    \Illuminate\Support\Facades\File::copyDirectory(base_path('tools/audit-probe'), $source);
    \Illuminate\Support\Facades\File::ensureDirectoryExists($source.'/dist');
    file_put_contents($source.'/dist/client.js', 'export default {};');
    $this->app->make(InstallsExtensions::class)->install($source, enable: true);
    \Illuminate\Support\Facades\Route::getRoutes()->refreshNameLookups();
    $this->app->make(\Pterodactyl\Services\Extensions\ExtensionProviderLoader::class)->registerProviders($this->app->make(ExtensionRepository::class)->enabled());
});

afterEach(function (): void {
    Extension::query()->where('identifier', 'audit-probe')->delete();
    ExtensionSetting::query()->where('extension', 'audit-probe')->delete();
    Schema::dropIfExists('audit_probe_items');
    DB::table('migrations')->where('migration', 'like', '%audit_probe%')->delete();
});

test('enabling runs the extension migration and mounts client routes', function (): void {
    expect(Schema::hasTable('audit_probe_items'))->toBeTrue();
    $user = User::factory()->create();
    $this->getJson('/api/client/extensions/audit-probe/status')->assertUnauthorized();
    $this->actingAs($user)->getJson('/api/client/extensions/audit-probe/status')->assertOk()->assertJsonPath('extension', 'audit-probe');
});

test('per user settings are isolated and the secret never reaches the frontend config', function (): void {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $this->actingAs($a)->putJson('/api/client/extensions/audit-probe/me/setting', ['greeting' => 'hi a'])->assertOk();
    $this->actingAs($a)->getJson('/api/client/extensions/audit-probe/me/setting')->assertJsonPath('greeting', 'hi a');
    $this->actingAs($b)->getJson('/api/client/extensions/audit-probe/me/setting')->assertJsonPath('greeting', 'hello');
});

test('server permissions registered by the extension gate its routes', function (): void {
    [$user, $server] = $this->generateTestAccount(['ext.audit-probe.view']);
    $base = '/api/client/servers/'.$server->uuid.'/extensions/audit-probe';
    $this->actingAs($user)->getJson($base.'/items')->assertOk();
    $this->actingAs($user)->postJson($base.'/items', ['label' => 'x'])->assertForbidden();
    $server->subusers()->where('user_id', $user->id)->update(['permissions' => ['ext.audit-probe.view', 'ext.audit-probe.write']]);
    $this->actingAs($user)->postJson($base.'/items', ['label' => 'x'])->assertCreated();
    $server->subusers()->where('user_id', $user->id)->update(['permissions' => ['websocket.connect']]);
    $this->actingAs($user)->getJson($base.'/items')->assertForbidden();
    $this->actingAs(User::factory()->create())->getJson($base.'/items')->assertNotFound();
});

test('admin routes require a root administrator', function (): void {
    $this->actingAs(User::factory()->create())->getJson('/api/admin/extensions/audit-probe/whoami')->assertForbidden();
    $this->actingAs(User::factory()->create(['root_admin' => true]))->getJson('/api/admin/extensions/audit-probe/whoami')->assertOk()->assertJsonPath('admin', true);
});

test('job progress snapshots are visible to their owner', function (): void {
    $user = User::factory()->create();
    $id = $this->actingAs($user)->postJson('/api/client/extensions/audit-probe/job')->assertOk()->json('id');
    $this->actingAs($user)->getJson(route('api:client.extension-progress', ['extension' => 'audit-probe', 'job' => $id]))->assertOk()->assertJsonPath('data.percent', 100)->assertJsonPath('data.status', 'completed');
});

test('server operation results reach extension listeners', function (): void {
    $server = $this->createServerModel();
    event(new OperationCompleted($server->uuid, 'install', true, $server->uuid));
    expect(DB::table('audit_probe_items')->where('label', 'op:install:ok')->exists())->toBeTrue();
});

test('disabling the extension removes its routes', function (): void {
    config(['extensions.enabled' => false]);
    $user = User::factory()->create();
    $this->actingAs($user)->getJson('/api/client/extensions/audit-probe/status')->assertNotFound();
});
