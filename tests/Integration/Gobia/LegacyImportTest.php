<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia;

use GobiaCore\Services\LegacyImporter as CoreImporter;
use GobiaTemplates\Services\LegacyImporter as TemplateImporter;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use Pterodactyl\Tests\Integration\IntegrationTestCase;

/**
 * Upgrading a Gobia 1.x database: the 1.x tables are rebuilt here exactly as the 1.x migrations created them, filled with
 * data, and imported into the extension tables. The import must keep ids, skip rows whose parents are gone, change nothing
 * when run again, change nothing at all on a dry run, and never touch the 1.x tables.
 */
class LegacyImportTest extends IntegrationTestCase
{
    use BuildsTemplates;

    private const LEGACY_TABLES = [
        'template_sftp_events', 'template_sftp_credentials', 'server_template_instances', 'server_template_revisions',
        'server_template_files', 'server_template_variables', 'server_template_nodes', 'server_templates',
        'user_server_category_members', 'user_server_categories', 'user_server_icon_colors', 'user_server_preferences',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTemplates();
        $this->dropLegacy();
        $this->createLegacy();
    }

    protected function tearDown(): void
    {
        $this->dropLegacy();
        Storage::disk('local')->deleteDirectory('avatars');
        $this->shutdownTemplates();
        parent::tearDown();
    }

    public function test_core_import_copies_personal_data_and_skips_orphans(): void
    {
        $data = $this->fill();
        $before = $this->legacyChecksum();

        $report = $this->app->make(CoreImporter::class)->run();

        $this->assertSame(2, $report['profiles']);
        $this->assertSame(2, $report['server order']);
        $this->assertSame(1, $report['icon colours']);
        $this->assertSame(1, $report['categories']);
        $this->assertSame(1, $report['category members']);
        // The two preference rows and the colour that point at a missing server or user, the orphan category and its member.
        $this->assertSame(4, $report['skipped (user or server gone)']);
        $this->assertSame(1, $report['avatar files missing']);

        $profile = DB::table('gobia_user_profiles')->where('user_id', $data['user']->id)->first();
        $this->assertSame('dark', $profile->theme);
        // Only well formed colours survive.
        $this->assertSame(['#112233', '#aabbcc'], json_decode($profile->recent_icon_colors, true));
        $this->assertSame('light', DB::table('gobia_user_profiles')->where('user_id', $data['other']->id)->value('theme'));

        $preference = DB::table('gobia_server_preferences')->where('user_id', $data['user']->id)->where('server_id', $data['servers'][0]->id)->first();
        $this->assertSame(2, $preference->position);
        $this->assertSame('#ff0000', $preference->icon_color);
        $this->assertSame(5, (int) DB::table('gobia_server_categories')->value('id'));

        $this->assertSame($before, $this->legacyChecksum(), 'the 1.x tables must not change');
    }

    public function test_core_import_moves_avatars_and_runs_twice_without_change(): void
    {
        $data = $this->fill();
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', true);
        Storage::disk('local')->put('avatars/'.$data['user']->uuid.'.png', $png);

        $first = $this->app->make(CoreImporter::class)->run();
        $this->assertSame(1, $first['avatars']);
        $this->assertNotNull(DB::table('gobia_user_profiles')->where('user_id', $data['user']->id)->value('avatar_file'));

        $second = $this->app->make(CoreImporter::class)->run();
        foreach (['profiles', 'server order', 'icon colours', 'categories', 'category members', 'avatars'] as $key) {
            $this->assertSame(0, $second[$key], $key);
        }
    }

    public function test_dry_run_changes_nothing(): void
    {
        $this->fill();

        $report = $this->app->make(CoreImporter::class)->run(null, true);
        $templates = $this->app->make(TemplateImporter::class)->run(null, true);

        $this->assertSame(2, $report['profiles']);
        $this->assertSame(1, $templates['templates']);
        foreach (['gobia_user_profiles', 'gobia_server_preferences', 'gobia_server_categories', 'gobia_server_templates', 'gobia_template_instances'] as $table) {
            $this->assertSame(0, DB::table($table)->count(), $table);
        }
    }

    public function test_template_import_keeps_ids_links_and_hashes(): void
    {
        $data = $this->fill();
        $before = $this->legacyChecksum();

        $report = $this->app->make(TemplateImporter::class)->run();

        $this->assertSame(1, $report['templates']);
        $this->assertSame(1, $report['variables']);
        $this->assertSame(1, $report['file records']);
        $this->assertSame(1, $report['revisions']);
        $this->assertSame(2, $report['instances']);
        $this->assertSame(1, $report['sftp credentials']);
        $this->assertSame(1, $report['sftp events']);

        $template = DB::table('gobia_server_templates')->where('id', 3)->first();
        $this->assertSame($data['uuid'], $template->uuid);
        $this->assertSame(0, (int) $template->api_enabled, 'the template API stays off until an administrator turns it on');
        $this->assertNull($template->node_id, 'a node that no longer exists is dropped, not copied');
        $this->assertSame(0, DB::table('gobia_server_templates')->where('id', 4)->count(), 'a template whose egg is gone is skipped');

        $kept = DB::table('gobia_template_instances')->where('uuid', '11111111-1111-4111-8111-111111111111')->first();
        $this->assertSame($data['servers'][0]->id, $kept->server_id);
        $this->assertNull($kept->api_key_id);
        $this->assertNull(DB::table('gobia_template_instances')->where('uuid', '22222222-2222-4222-8222-222222222222')->value('server_id'));
        $this->assertSame(0, DB::table('gobia_template_instances')->where('uuid', '33333333-3333-4333-8333-333333333333')->count());

        $credential = DB::table('gobia_template_sftp_credentials')->where('id', 8)->first();
        $this->assertStringStartsWith('$2y$12$hash', $credential->password_hash);
        $this->assertSame('ro', $credential->permission);
        $this->assertNull($credential->created_by);

        // The revision snapshot is carried over byte for byte so old revisions can still provision.
        $this->assertSame(DB::table('server_template_revisions')->value('snapshot'), DB::table('gobia_template_revisions')->value('snapshot'));

        $again = $this->app->make(TemplateImporter::class)->run();
        foreach (['templates', 'variables', 'file records', 'revisions', 'instances', 'sftp credentials', 'sftp events'] as $key) {
            $this->assertSame(0, $again[$key], $key);
        }
        $this->assertSame($before, $this->legacyChecksum(), 'the 1.x tables must not change');
    }

    public function test_storage_report_notices_missing_template_files(): void
    {
        $data = $this->fill();

        $missing = $this->app->make(TemplateImporter::class)->run(null, true);
        $this->assertSame(1, $missing['template directories missing']);

        $blobs = $this->templateStorage.DIRECTORY_SEPARATOR.$data['uuid'].DIRECTORY_SEPARATOR.'blobs';
        mkdir($blobs, 0775, true);
        $present = $this->app->make(TemplateImporter::class)->run(null, true);
        $this->assertSame(1, $present['template directories found']);
        $this->assertSame(1, $present['published blobs missing']);

        file_put_contents($blobs.DIRECTORY_SEPARATOR.str_repeat('a', 64), 'abc');
        $this->assertSame(0, $this->app->make(TemplateImporter::class)->run(null, true)['published blobs missing']);
    }

    private function dropLegacy(): void
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        foreach (self::LEGACY_TABLES as $table) {
            Schema::dropIfExists($table);
        }
        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        foreach (['theme', 'recent_icon_colors', 'avatar_hash'] as $column) {
            if (Schema::hasColumn('users', $column)) {
                Schema::table('users', fn (Blueprint $table) => $table->dropColumn($column));
            }
        }
    }

    /** The Gobia 1.x schema, from its migrations (only the columns the import reads or writes matter). */
    private function createLegacy(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('theme', 8)->default('system');
            $table->json('recent_icon_colors')->nullable();
            $table->string('avatar_hash', 16)->nullable();
        });
        Schema::create('user_server_preferences', function (Blueprint $table): void {
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('position');
            $table->primary(['user_id', 'server_id']);
        });
        Schema::create('user_server_icon_colors', function (Blueprint $table): void {
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id');
            $table->char('color', 7);
            $table->primary(['user_id', 'server_id']);
        });
        Schema::create('user_server_categories', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('name', 32);
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });
        Schema::create('user_server_category_members', function (Blueprint $table): void {
            $table->unsignedInteger('category_id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('position');
            $table->primary(['category_id', 'server_id']);
        });
        Schema::create('server_templates', function (Blueprint $table): void {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->string('name', 80);
            $table->string('slug', 80)->unique();
            $table->string('description', 500)->nullable();
            $table->boolean('enabled')->default(true);
            $table->unsignedInteger('revision')->default(1);
            $table->unsignedInteger('nest_id');
            $table->unsignedInteger('egg_id');
            $table->string('docker_image', 191);
            $table->text('startup')->nullable();
            $table->unsignedInteger('memory');
            $table->unsignedInteger('swap')->default(0);
            $table->unsignedInteger('disk');
            $table->unsignedInteger('cpu')->default(0);
            $table->unsignedSmallInteger('io')->default(500);
            $table->boolean('oom_disabled')->default(true);
            $table->unsignedInteger('database_limit')->nullable();
            $table->unsignedInteger('allocation_limit')->nullable();
            $table->unsignedInteger('backup_limit')->nullable();
            $table->string('placement_mode', 16)->default('any');
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('location_id')->nullable();
            $table->unsignedSmallInteger('additional_allocations')->default(0);
            $table->string('preferred_ports', 191)->nullable();
            $table->unsignedInteger('max_instances')->nullable();
            $table->boolean('start_automatically')->default(true);
            $table->boolean('temporary')->default(false);
            $table->unsignedInteger('ttl_minutes')->nullable();
            $table->boolean('allow_instance_delete')->default(true);
            $table->timestamp('published_at')->nullable();
            $table->timestamp('working_changed_at')->nullable();
            $table->timestamps();
        });
        Schema::create('server_template_nodes', function (Blueprint $table): void {
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('node_id');
            $table->primary(['template_id', 'node_id']);
        });
        Schema::create('server_template_variables', function (Blueprint $table): void {
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('egg_variable_id');
            $table->text('value')->nullable();
            $table->boolean('overridable')->default(false);
            $table->primary(['template_id', 'egg_variable_id']);
        });
        Schema::create('server_template_files', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->string('path', 255);
            $table->unsignedInteger('size');
            $table->char('sha256', 64);
            $table->timestamps();
        });
        Schema::create('server_template_revisions', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('revision');
            $table->longText('snapshot');
            $table->timestamp('created_at')->useCurrent();
        });
        Schema::create('server_template_instances', function (Blueprint $table): void {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('template_revision');
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('owner_id');
            $table->unsignedInteger('api_key_id')->nullable();
            $table->string('name', 191);
            $table->string('state', 24)->default('queued');
            $table->string('failed_stage', 24)->nullable();
            $table->string('error', 500)->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedInteger('node_id')->nullable();
            $table->text('overrides')->nullable();
            $table->string('idempotency_key', 80)->nullable();
            $table->char('request_hash', 64)->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('state_changed_at')->nullable();
            $table->json('stage_ms')->nullable();
            $table->timestamps();
        });
        Schema::create('template_sftp_credentials', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('template_id');
            $table->unsignedInteger('created_by')->nullable();
            $table->string('label', 80)->nullable();
            $table->string('username', 32)->unique();
            $table->string('password_hash');
            $table->string('permission', 4)->default('rw');
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->string('last_used_ip', 45)->nullable();
            $table->timestamps();
        });
        Schema::create('template_sftp_events', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('credential_id')->nullable();
            $table->unsignedInteger('template_id')->nullable();
            $table->string('username', 64)->nullable();
            $table->string('event', 24);
            $table->string('ip', 45)->nullable();
            $table->text('detail')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });
    }

    /** @return array{user: User, other: User, servers: list<Server>, uuid: string, egg: int} */
    private function fill(): array
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $first = $this->createServerModel(['owner_id' => $user->id]);
        $second = $this->createServerModel(['owner_id' => $user->id]);
        $egg = $this->bungeecord();
        $variable = $egg->variables()->firstOrFail();
        $now = now()->toDateTimeString();
        $gone = 999_999;
        $uuid = '4e436375-f987-4f32-9609-cf549afe551e';

        DB::table('users')->where('id', $user->id)->update(['theme' => 'dark', 'recent_icon_colors' => json_encode(['#112233', 'not a colour', '#aabbcc']), 'avatar_hash' => 'abc']);
        DB::table('users')->where('id', $other->id)->update(['theme' => 'light']);
        DB::table('user_server_preferences')->insert([
            ['user_id' => $user->id, 'server_id' => $first->id, 'position' => 2],
            ['user_id' => $user->id, 'server_id' => $second->id, 'position' => 1],
            ['user_id' => $user->id, 'server_id' => $gone, 'position' => 3],
            ['user_id' => $gone, 'server_id' => $first->id, 'position' => 1],
        ]);
        DB::table('user_server_icon_colors')->insert([
            ['user_id' => $user->id, 'server_id' => $first->id, 'color' => '#ff0000'],
            ['user_id' => $user->id, 'server_id' => $gone, 'color' => '#00ff00'],
        ]);
        DB::table('user_server_categories')->insert([
            ['id' => 5, 'user_id' => $user->id, 'name' => 'Hubs', 'position' => 0, 'created_at' => $now, 'updated_at' => $now],
            ['id' => 6, 'user_id' => $gone, 'name' => 'Orphan', 'position' => 0, 'created_at' => $now, 'updated_at' => $now],
        ]);
        DB::table('user_server_category_members')->insert([
            ['category_id' => 5, 'server_id' => $first->id, 'position' => 0],
            ['category_id' => 6, 'server_id' => $first->id, 'position' => 0],
        ]);

        $template = ['id' => 3, 'uuid' => $uuid, 'name' => 'Hub %number%', 'slug' => 'hub', 'description' => null, 'enabled' => 1, 'revision' => 2,
            'nest_id' => $egg->nest_id ?? 1, 'egg_id' => $egg->id, 'docker_image' => 'ghcr.io/pterodactyl/yolks:java_21', 'startup' => null, 'memory' => 256, 'swap' => 0, 'disk' => 1024,
            'cpu' => 0, 'io' => 500, 'oom_disabled' => 1, 'database_limit' => 0, 'allocation_limit' => 0, 'backup_limit' => 0, 'placement_mode' => 'any', 'node_id' => $gone,
            'location_id' => null, 'additional_allocations' => 1, 'preferred_ports' => '25570-25580', 'max_instances' => null, 'start_automatically' => 1, 'temporary' => 0,
            'ttl_minutes' => null, 'allow_instance_delete' => 1, 'created_at' => $now, 'updated_at' => $now];
        DB::table('server_templates')->insert([$template, array_merge($template, ['id' => 4, 'uuid' => 'ffffffff-0000-4000-8000-000000000000', 'slug' => 'bad-egg', 'egg_id' => $gone])]);
        DB::table('server_template_variables')->insert([
            ['template_id' => 3, 'egg_variable_id' => $variable->id, 'value' => 'latest', 'overridable' => 1],
            ['template_id' => 3, 'egg_variable_id' => $gone, 'value' => 'x', 'overridable' => 0],
        ]);
        DB::table('server_template_files')->insert([['template_id' => 3, 'path' => 'plugins/a.jar', 'size' => 3, 'sha256' => str_repeat('a', 64), 'created_at' => $now, 'updated_at' => $now]]);
        $snapshot = json_encode(['settings' => ['nest_id' => 1, 'egg_id' => $egg->id], 'files' => []]);
        DB::table('server_template_revisions')->insert([['template_id' => 3, 'revision' => 1, 'snapshot' => $snapshot, 'created_at' => $now]]);
        DB::table('server_template_instances')->insert([
            ['uuid' => '11111111-1111-4111-8111-111111111111', 'template_id' => 3, 'template_revision' => 1, 'server_id' => $first->id, 'owner_id' => $user->id, 'api_key_id' => 77, 'name' => 'Hub 1', 'state' => 'ready', 'created_at' => $now, 'updated_at' => $now],
            ['uuid' => '22222222-2222-4222-8222-222222222222', 'template_id' => 3, 'template_revision' => 1, 'server_id' => $gone, 'owner_id' => $user->id, 'api_key_id' => null, 'name' => 'Hub 2', 'state' => 'ready', 'created_at' => $now, 'updated_at' => $now],
            ['uuid' => '33333333-3333-4333-8333-333333333333', 'template_id' => 3, 'template_revision' => 1, 'server_id' => null, 'owner_id' => $gone, 'api_key_id' => null, 'name' => 'Orphan', 'state' => 'failed', 'created_at' => $now, 'updated_at' => $now],
        ]);
        DB::table('template_sftp_credentials')->insert([['id' => 8, 'template_id' => 3, 'created_by' => $gone, 'label' => 'dev', 'username' => 'tpl_abc', 'password_hash' => '$2y$12$hashhashhashhashhashhashhashhashhashhashhashhashhashha', 'permission' => 'ro', 'created_at' => $now, 'updated_at' => $now]]);
        DB::table('template_sftp_events')->insert([['credential_id' => 8, 'template_id' => 3, 'username' => 'tpl_abc', 'event' => 'login', 'ip' => '1.2.3.4', 'created_at' => $now]]);

        return ['user' => $user, 'other' => $other, 'servers' => [$first, $second], 'uuid' => $uuid, 'egg' => $egg->id];
    }

    private function legacyChecksum(): string
    {
        return md5(collect(self::LEGACY_TABLES)->map(fn (string $table): string => $table.json_encode(DB::table($table)->get()))->implode('|'));
    }
}
