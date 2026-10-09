<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Pest\Integration\Gobia\UpdaterTest;

use GobiaCore\Services\CompatibilityReport;
use GobiaCore\Updater\DatabaseBackupService;
use GobiaCore\Updater\Exceptions\ReleaseVerificationException;
use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\Preflight;
use GobiaCore\Updater\ProcessResult;
use GobiaCore\Updater\ProcessRunner;
use GobiaCore\Updater\Providers\ReleaseProvider;
use GobiaCore\Updater\ReleaseInfo;
use GobiaCore\Updater\ReleaseVerifier;
use GobiaCore\Updater\Runners\DeploymentRunner;
use GobiaCore\Updater\Runners\InPlaceRunner;
use GobiaCore\Updater\RunStore;
use GobiaCore\Updater\SafeTarExtractor;
use GobiaCore\Updater\UpdateOrchestrator;
use GobiaCore\Updater\UpdateService;
use GobiaCore\Updater\VersionComparator;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Mockery;
use Pterodactyl\Models\ApiKey;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Extensions\ExtensionRepository;
use Pterodactyl\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;
use Pterodactyl\Tests\Integration\Gobia\BuildsReleases;
use Pterodactyl\Tests\Integration\Gobia\InstallsGobiaExtensions;
use Pterodactyl\Tests\Integration\Gobia\TarArchive;

uses(ClientApiIntegrationTestCase::class, InstallsGobiaExtensions::class, BuildsReleases::class);

const UPDATES = '/api/admin/extensions/gobia-core/updates';

/** A deployment runner that records what the updater asked for instead of touching the installation. */
function fakeRunner(array $failing = []): DeploymentRunner
{
    return new class($failing) implements DeploymentRunner
    {
        /** @var list<string> */
        public array $calls = [];

        /** @var list<string> */
        public array $problems = [];

        /** @param list<string> $failing artisan commands that exit with an error */
        public function __construct(private readonly array $failing) {}

        public function name(): string
        {
            return 'fake';
        }

        public function liveTree(): string
        {
            return base_path();
        }

        public function problems(): array
        {
            return $this->problems;
        }

        public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void
        {
            $this->calls[] = 'install:'.$release->version();
        }

        public function restoreFiles(string $backupDir): void
        {
            $this->calls[] = 'restore-files';
        }

        public function artisan(string $command, array $arguments = []): ProcessResult
        {
            $this->calls[] = 'artisan:'.$command;
            if (in_array($command, $this->failing, true)) {
                return new ProcessResult(1, '', $command.' exploded');
            }

            $expected = collect($arguments)->first(fn (string $argument): bool => str_starts_with($argument, '--expect='));

            return new ProcessResult(0, $command === 'gobia-core:update:health' ? (string) json_encode(['ok' => true, 'checks' => [], 'expected' => $expected]) : '', '');
        }

        public function restartWorkers(): void
        {
            $this->calls[] = 'restart';
        }
    };
}

/** Binds the fakes every test needs: no real dump, no real file swap, no detached worker. */
function fakeUpdater($test, array $failing = []): DeploymentRunner
{
    $runner = fakeRunner($failing);
    app()->instance(DeploymentRunner::class, $runner);

    app()->instance(DatabaseBackupService::class, new class(resolve(ProcessRunner::class), $runner) extends DatabaseBackupService
    {
        public function __construct(ProcessRunner $processes, private readonly DeploymentRunner $runner)
        {
            parent::__construct($processes);
        }

        public function create(string $directory, string $name): string
        {
            File::ensureDirectoryExists($directory);
            file_put_contents($directory.'/'.$name.'.sql', str_repeat('-- row', 60)."\n-- Dump completed");

            return $directory.'/'.$name.'.sql';
        }

        public function restore(string $file): void
        {
            $this->verify($file);
            $this->runner->calls[] = 'restore-database';
        }
    });

    app()->bind(UpdateService::class, fn ($app): UpdateService => new class(...array_map($app->make(...), [ReleaseProvider::class, ReleaseVerifier::class, RunStore::class, Preflight::class, CompatibilityReport::class, ExtensionRepository::class])) extends UpdateService
    {
        /** @var list<string> */
        public static array $spawned = [];

        protected function spawn(string $command, ?string $runId): void
        {
            self::$spawned[] = $command.' '.$runId;
        }
    });

    return $runner;
}

function admin(): User
{
    return User::factory()->create(['root_admin' => true]);
}

beforeEach(function (): void {
    $this->installGobia(['gobia-core']);
    $this->setUpReleases();
    Http::fake();
    Cache::forget(UpdateOrchestrator::LATEST_CACHE_KEY);
});

afterEach(function (): void {
    $this->tearDownReleases();
    $this->uninstallGobia();
});

test('versions order releases and reject anything else', function (): void {
    expect(VersionComparator::isNewer('2.0.0', '2.0.0-dev'))->toBeTrue();
    expect(VersionComparator::isNewer('2.0.0-rc.2', '2.0.0-rc.1'))->toBeTrue();
    expect(VersionComparator::isNewer('2.0.10', '2.0.9'))->toBeTrue();
    expect(VersionComparator::isNewer('2.0.0-beta.1', '2.0.0'))->toBeFalse();
    expect(VersionComparator::isStable('2.1.0'))->toBeTrue();
    expect(VersionComparator::isStable('2.1.0-rc.1'))->toBeFalse();
    expect(VersionComparator::fromTag('gobia-v2.0.1'))->toBe('2.0.1');
    // An upstream Pterodactyl tag in the same repository is not a Gobia release.
    expect(VersionComparator::fromTag('v2.0.1'))->toBeNull();

    foreach (['2.0', '2.0.0-gobia.1', '../2.0.0', '2.0.0; rm -rf /', '2.0.0-rc', 'v2.0.0', ''] as $bad) {
        expect(VersionComparator::isValid($bad))->toBe($bad === '2.0.0-rc');
    }
});

test('the update endpoints are for root administrators and changes need a session', function (): void {
    fakeUpdater($this);
    foreach (['check', 'preflight', 'history', 'rollback-eligibility'] as $path) {
        $this->getJson(UPDATES.'/'.$path)->assertUnauthorized();
    }

    $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertUnauthorized();

    $this->actingAs(User::factory()->create());
    $this->getJson(UPDATES.'/check')->assertForbidden();
    $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertForbidden();
    $this->postJson(UPDATES.'/rollback', ['update_id' => '20260101T000000-abcdef'])->assertForbidden();
});

test('an account API key may read but never install', function (): void {
    fakeUpdater($this);
    $this->publishRelease('2.0.0');
    $user = admin();
    $key = ApiKey::factory()->for($user)->create(['key_type' => ApiKey::TYPE_ACCOUNT]);
    $headers = ['Authorization' => 'Bearer '.$key->identifier.decrypt($key->token)];

    $this->withHeaders($headers)->getJson(UPDATES.'/check')->assertOk()->assertJsonPath('update_available', true);
    $this->withHeaders($headers)->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertForbidden();
    expect(resolve(RunStore::class)->active())->toBeNull();
});

test('check reports the latest approved release and nothing when up to date', function (): void {
    fakeUpdater($this);
    $this->actingAs(admin());

    $this->getJson(UPDATES.'/check')->assertOk()->assertJson(['contract_version' => 1, 'latest_approved' => null, 'update_available' => false, 'error' => null]);

    $this->publishRelease('2.0.0', ['security_update' => true]);
    $this->publishRelease('2.1.0-rc.1');
    // Cached: the new release only shows after an explicit check.
    $this->getJson(UPDATES.'/check')->assertJsonPath('update_available', false);

    $check = $this->getJson(UPDATES.'/check?refresh=1')->assertOk()->json();
    expect($check['update_available'])->toBeTrue();
    expect($check['current']['gobia'])->toBe('2.0.0-dev');
    expect($check['latest_approved'])->toMatchArray(['gobia' => '2.0.0', 'security' => true, 'release_notes_markdown' => 'Notes for 2.0.0']);
    expect($check['latest_approved']['artifact']['signed'])->toBeTrue();
});

test('a manifest that was changed after signing, or never signed, is not offered', function (): void {
    fakeUpdater($this);
    $this->actingAs(admin());

    $this->publishRelease('2.0.0');
    $this->tamperRelease('2.0.0', fn (array $manifest): array => array_replace_recursive($manifest, ['migrations' => ['destructive' => true]]));
    $check = $this->getJson(UPDATES.'/check?refresh=1')->assertOk()->json();
    expect($check['update_available'])->toBeFalse();
    expect($check['error'])->toContain('signature');

    $this->publishRelease('2.0.1', sign: false);
    $check = $this->getJson(UPDATES.'/check?refresh=1')->json();
    expect($check['update_available'])->toBeFalse();
    expect($check['error'])->toContain('signature');
});

test('the preflight is ready for a compatible release and names every check', function (): void {
    fakeUpdater($this);
    $this->publishRelease('2.0.0', ['migrations' => ['names' => ['2030_01_01_000000_add_something']]]);
    $this->actingAs(admin());
    $this->getJson(UPDATES.'/check?refresh=1');

    $report = $this->getJson(UPDATES.'/preflight')->assertOk()->json();
    $failing = collect($report['checks'])->filter(fn (array $check): bool => $check['required'] && $check['status'] !== 'pass')->pluck('message', 'id')->all();
    expect($failing)->toBe([]);
    expect($report['ready'])->toBeTrue();
    expect(collect($report['checks'])->pluck('id')->all())->toBe([
        'gobia_version', 'pterodactyl_base', 'extensions', 'extension_api', 'frontend_sdk', 'backend_extension_api', 'php_version',
        'node_runtime', 'database_version', 'database_connectivity', 'redis', 'pending_migrations', 'disk_space', 'permissions',
        'wings_connectivity', 'queue_health', 'panel_health', 'release_signature', 'release_checksum', 'upgrade_path',
    ]);
    expect($report['migrations'])->toBe(['pending' => 1, 'destructive' => false, 'rollback' => 'requires-db-restore']);
    expect($report['extensions'][0])->toMatchArray(['id' => 'gobia-core', 'required' => '1.0.0', 'compatible' => true]);
});

test('the preflight blocks an unsupported PHP, upgrade path, extension downgrade and unwritable installation', function (): void {
    $runner = fakeUpdater($this);
    $runner->problems = ['The Panel directory is not writable by the PHP user.'];
    $this->publishRelease('2.0.0', ['php' => '>=9.0', 'min_upgrade_from' => '2.0.0-rc.1', 'extensions' => ['gobia-core' => '0.9.0']]);
    $this->actingAs(admin());
    $this->getJson(UPDATES.'/check?refresh=1');

    $report = $this->getJson(UPDATES.'/preflight')->assertOk()->json();
    $status = collect($report['checks'])->pluck('status', 'id');
    expect($report['ready'])->toBeFalse();
    expect($status['php_version'])->toBe('fail');
    expect($status['upgrade_path'])->toBe('fail');
    expect($status['extensions'])->toBe('fail');
    expect($status['permissions'])->toBe('fail');

    $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])
        ->assertStatus(422)
        ->assertJsonPath('code', 'preflight_failed')
        ->assertJsonPath('step', 'preflight');
    expect(resolve(RunStore::class)->active())->toBeNull();
});

test('install validates its input and only accepts the latest approved release', function (): void {
    fakeUpdater($this);
    $this->publishRelease('2.0.0');
    $this->publishRelease('2.0.1');
    $this->actingAs(admin());

    $this->postJson(UPDATES.'/install', ['target' => '2.0.1'])->assertStatus(422);
    $this->postJson(UPDATES.'/install', ['target' => 'https://evil.example/x.tar.gz', 'confirm_backup' => true])->assertStatus(422);
    $this->postJson(UPDATES.'/install', ['target' => '../2.0.1', 'confirm_backup' => true])->assertStatus(422);
    $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertStatus(422)->assertJsonPath('code', 'update_rejected');
    $this->postJson(UPDATES.'/install', ['target' => '9.9.9', 'confirm_backup' => true])->assertStatus(422);
    expect(resolve(RunStore::class)->active())->toBeNull();
});

test('install starts one worker, a second request is refused, and the run completes', function (): void {
    $runner = fakeUpdater($this);
    $this->publishRelease('2.0.0', ['migrations' => ['names' => ['2030_01_01_000000_add_something']]]);
    $this->actingAs(admin());

    $id = $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertStatus(202)->json('update_id');
    expect(resolve(UpdateService::class)::$spawned)->toContain('gobia-core:update:work '.$id);

    $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertStatus(409)->assertJsonPath('update_id', $id);
    $this->getJson(UPDATES.'/progress/'.$id)->assertOk()->assertJson(['update_id' => $id, 'state' => 'queued', 'percent' => 0]);
    $this->getJson(UPDATES.'/check')->assertJsonPath('active_update_id', $id);

    $run = resolve(UpdateOrchestrator::class)->execute($id);
    expect($run['result'])->toBe('success');
    expect($runner->calls)->toBe([
        'artisan:down', 'install:2.0.0', 'artisan:migrate', 'artisan:gobia-core:update:finalize', 'artisan:view:clear', 'artisan:view:cache', 'artisan:route:cache', 'artisan:event:cache',
        'restart', 'artisan:gobia-core:update:health', 'artisan:up',
    ]);

    $progress = $this->getJson(UPDATES.'/progress/'.$id)->assertOk()->json();
    expect($progress)->toMatchArray(['state' => 'completed', 'percent' => 100, 'failure' => null]);
    expect($progress['rollback'])->toMatchArray(['performed' => false, 'database_restored' => false]);
    expect(collect($progress['log'])->pluck('message')->implode(' '))->toContain('Database backup written')->not->toContain('--secret=');

    $this->getJson(UPDATES.'/history')->assertOk()->assertJsonPath('data.0.update_id', $id)->assertJsonPath('data.0.result', 'completed')->assertJsonPath('data.0.to', '2.0.0');
    $this->getJson(UPDATES.'/check')->assertJsonPath('active_update_id', null);
    // The same run cannot be executed twice.
    expect(fn () => resolve(UpdateOrchestrator::class)->execute($id))->toThrow(UpdateException::class);
});

test('a failed migration restores the previous files and the database, then leaves maintenance mode', function (): void {
    $runner = fakeUpdater($this, failing: ['migrate']);
    $this->publishRelease('2.0.0');
    $this->actingAs(admin());
    $id = $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertStatus(202)->json('update_id');

    $run = resolve(UpdateOrchestrator::class)->execute($id);
    expect($run['result'])->toBe('rolled_back');
    expect($runner->calls)->toBe(['artisan:down', 'install:2.0.0', 'artisan:migrate', 'restore-files', 'restore-database', 'artisan:view:clear', 'artisan:view:cache', 'artisan:route:cache', 'artisan:event:cache', 'restart', 'artisan:up']);

    $progress = $this->getJson(UPDATES.'/progress/'.$id)->json();
    expect($progress['state'])->toBe('rolled_back');
    expect($progress['failure'])->toContain('migrate');
    expect($progress['failure_step'])->toBe('migrate');
    expect($progress['rollback'])->toMatchArray(['performed' => true, 'database_restored' => true]);
    expect(resolve(RunStore::class)->active())->toBeNull();
    $this->getJson(UPDATES.'/rollback-eligibility')->assertJsonPath('eligible', false);
});

test('a package that does not match its checksum is refused before anything changes', function (): void {
    $runner = fakeUpdater($this);
    $package = $this->publishRelease('2.0.0');
    $this->actingAs(admin());
    $id = $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->assertStatus(202)->json('update_id');

    // Same length, different bytes: swapped after the manifest was signed.
    file_put_contents($package, str_repeat('A', (int) filesize($package)));
    $run = resolve(UpdateOrchestrator::class)->execute($id);

    expect($run['result'])->toBe('failed');
    expect($run['failure_stage'])->toBe('verify');
    expect($run['error'])->toContain('SHA-256');
    expect($runner->calls)->toBe([]);
    expect($this->getJson(UPDATES.'/progress/'.$id)->json('state'))->toBe('failed');
});

test('a package without the expected files or with another version inside is refused', function (): void {
    $runner = fakeUpdater($this);
    $this->publishRelease('2.0.0', files: ['gobia-release.json' => (string) json_encode(['gobia_version' => '2.5.0'])]);
    $this->actingAs(admin());
    $id = $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->json('update_id');

    $run = resolve(UpdateOrchestrator::class)->execute($id);
    expect($run['result'])->toBe('failed');
    expect($run['failure_stage'])->toBe('extract');
    expect($runner->calls)->toBe([]);
});

test('the last update can be rolled back, and a database restore needs explicit confirmation', function (): void {
    $runner = fakeUpdater($this);
    $this->publishRelease('2.0.0', ['migrations' => ['names' => ['2030_01_01_000000_add_something']]]);
    $this->actingAs(admin());
    $id = $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->json('update_id');
    resolve(UpdateOrchestrator::class)->execute($id);

    // A later update that failed and was undone changes nothing: the installed one can still be rolled back.
    $store = resolve(RunStore::class);
    $store->save(array_merge(UpdateOrchestrator::newRun('20991231T235959-zzzzzz', '2.0.0', '2.0.1', null), ['state' => 'failed', 'result' => 'rolled_back', 'finished_at' => gmdate('c')]));

    // The fake runner does not replace gobia-release.json, so say which version is live now.
    $service = Mockery::mock(CompatibilityReport::class)->makePartial();
    $service->shouldReceive('release')->andReturn(['gobia_version' => '2.0.0', 'extensions' => ['gobia-core' => '1.0.0']]);
    app()->instance(CompatibilityReport::class, $service);

    $this->getJson(UPDATES.'/rollback-eligibility')->assertOk()->assertJson(['eligible' => true, 'mode' => 'requires-db-restore', 'update_id' => $id]);
    $this->postJson(UPDATES.'/rollback', ['update_id' => $id])->assertStatus(422)->assertJsonPath('code', 'rollback_rejected');
    $this->postJson(UPDATES.'/rollback', ['update_id' => '20200101T000000-zzzzzz', 'confirm_database_restore' => true])->assertStatus(422);

    $runner->calls = [];
    $rollback = $this->postJson(UPDATES.'/rollback', ['update_id' => $id, 'confirm_database_restore' => true])->assertStatus(202)->json('update_id');
    $run = resolve(UpdateOrchestrator::class)->execute($rollback);

    expect($run['result'])->toBe('rolled_back');
    expect($runner->calls)->toBe(['artisan:down', 'restore-files', 'restore-database', 'artisan:view:clear', 'artisan:view:cache', 'artisan:route:cache', 'artisan:event:cache', 'restart', 'artisan:up']);
    expect($this->getJson(UPDATES.'/progress/'.$rollback)->json())->toMatchArray(['state' => 'rolled_back', 'percent' => 100, 'type' => 'rollback']);
});

test('the extractor refuses traversal, links, secrets, runtime state and truncated archives', function (string $case): void {
    $archive = match ($case) {
        'traversal' => (new TarArchive)->file('../outside.php'),
        'nested traversal' => (new TarArchive)->file('app/../../outside.php'),
        'absolute' => (new TarArchive)->file('/etc/cron.d/x'),
        'symlink' => (new TarArchive)->symlink('public/link', '/etc/passwd'),
        'hardlink' => (new TarArchive)->hardlink('public/link', '/etc/passwd'),
        'env' => (new TarArchive)->file('.env', 'APP_KEY=x'),
        'env variant' => (new TarArchive)->file('.env.production', 'APP_KEY=x'),
        'storage' => (new TarArchive)->file('storage/app/x'),
        'git' => (new TarArchive)->file('.git/config'),
        'duplicate' => (new TarArchive)->file('a.php')->file('a.php'),
        'backslash' => (new TarArchive)->file('app\\..\\x.php'),
        default => new TarArchive,
    };

    $file = $this->releaseRoot.'/hostile.tar.gz';
    file_put_contents($file, $case === 'truncated' ? (new TarArchive)->file('a.php')->build(false) : ($case === 'not gzip' ? 'plain text' : $archive->build()));
    $target = $this->releaseRoot.'/out';

    expect(fn () => resolve(SafeTarExtractor::class)->extract($file, $target))->toThrow(ReleaseVerificationException::class);
    expect(file_exists($this->releaseRoot.'/outside.php'))->toBeFalse();
    expect(File::isDirectory($target) ? File::allFiles($target, true) : [])->toHaveCount(in_array($case, ['duplicate', 'truncated'], true) ? 1 : 0);
})->with(['traversal', 'nested traversal', 'absolute', 'symlink', 'hardlink', 'env', 'env variant', 'storage', 'git', 'duplicate', 'backslash', 'truncated', 'not gzip']);

test('the extractor unpacks a normal package and keeps .env.example', function (): void {
    $file = $this->releaseRoot.'/ok.tar.gz';
    file_put_contents($file, (new TarArchive)->directory('./')->file('./artisan', 'a')->file('app/Models/User.php', 'b')->file('.env.example', 'c')->build());

    $stats = resolve(SafeTarExtractor::class)->extract($file, $this->releaseRoot.'/ok');
    expect($stats)->toBe(['files' => 3, 'bytes' => 3]);
    expect(file_get_contents($this->releaseRoot.'/ok/app/Models/User.php'))->toBe('b');
});

test('the in-place runner swaps the code, keeps .env, storage and local extensions, and restores exactly', function (): void {
    $base = $this->releaseRoot.'/panel';
    foreach ([
        '.env' => 'APP_KEY=secret',
        'storage/app/private/avatar.png' => 'avatar',
        'app/Old.php' => 'old',
        'public/index.php' => 'old index',
        'public/assets/extensions/gobia-core/_current' => 'published',
        'extensions/gobia-core/extension.json' => 'old core',
        'extensions/third-party/extension.json' => 'theirs',
        'extensions/third-party/node_modules/x/index.js' => 'dependency',
        'themes/custom/theme.json' => 'custom theme',
        'gobia-release.json' => 'old',
    ] as $path => $content) {
        File::ensureDirectoryExists(dirname($base.'/'.$path));
        file_put_contents($base.'/'.$path, $content);
    }

    $staged = $this->releaseRoot.'/staged';
    foreach ([
        'app/New.php' => 'new',
        'public/index.php' => 'new index',
        'public/assets/manifest.json' => '{}',
        'extensions/gobia-core/extension.json' => 'new core',
        'themes/gobia/theme.json' => 'gobia theme',
        'gobia-release.json' => 'new',
    ] as $path => $content) {
        File::ensureDirectoryExists(dirname($staged.'/'.$path));
        file_put_contents($staged.'/'.$path, $content);
    }

    $runner = new InPlaceRunner(resolve(ProcessRunner::class), $base);
    $backup = $this->releaseRoot.'/backup';
    $release = ReleaseInfo::fromManifest(['gobia_version' => '2.0.0', 'artifact' => []], null, '', '');
    expect($runner->problems())->toBe([]);
    $runner->install($staged, $release, $backup);

    expect(file_get_contents($base.'/.env'))->toBe('APP_KEY=secret');
    expect(file_get_contents($base.'/storage/app/private/avatar.png'))->toBe('avatar');
    expect(file_exists($base.'/app/Old.php'))->toBeFalse();
    expect(file_get_contents($base.'/app/New.php'))->toBe('new');
    expect(file_get_contents($base.'/public/index.php'))->toBe('new index');
    expect(file_get_contents($base.'/extensions/gobia-core/extension.json'))->toBe('new core');
    // What the installation added itself is carried into the new tree, without development leftovers.
    expect(file_get_contents($base.'/extensions/third-party/extension.json'))->toBe('theirs');
    expect(file_exists($base.'/extensions/third-party/node_modules'))->toBeFalse();
    expect(file_get_contents($base.'/themes/custom/theme.json'))->toBe('custom theme');
    expect(file_get_contents($base.'/themes/gobia/theme.json'))->toBe('gobia theme');

    $runner->restoreFiles($backup);
    expect(file_get_contents($base.'/app/Old.php'))->toBe('old');
    expect(file_exists($base.'/app/New.php'))->toBeFalse();
    expect(file_get_contents($base.'/public/index.php'))->toBe('old index');
    expect(file_get_contents($base.'/public/assets/extensions/gobia-core/_current'))->toBe('published');
    expect(file_get_contents($base.'/extensions/gobia-core/extension.json'))->toBe('old core');
    expect(file_get_contents($base.'/extensions/third-party/node_modules/x/index.js'))->toBe('dependency');
    expect(file_exists($base.'/themes/gobia'))->toBeFalse();
    expect(file_get_contents($base.'/gobia-release.json'))->toBe('old');
    expect(file_get_contents($base.'/.env'))->toBe('APP_KEY=secret');
});

test('the runner only runs commands from its fixed list with plain arguments', function (): void {
    $runner = new InPlaceRunner(resolve(ProcessRunner::class), $this->releaseRoot);

    foreach ([['tinker', []], ['db:wipe', []], ['migrate', ['--path=../../x; id']], ['migrate', ['$(id)']], ['up', ['--secret=a b']]] as [$command, $arguments]) {
        expect(fn () => $runner->artisan($command, $arguments))->toThrow(UpdateException::class);
    }
});

test('updater logs never contain the database password, the app key or a token', function (): void {
    config(['gobia_updater.github_token' => 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'database.connections.mysql.password' => 'sup3rs3cret']);
    $store = resolve(RunStore::class);
    $id = $store->newId();
    $store->log($id, 'mysqldump --password=sup3rs3cret failed for Authorization: Bearer github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 key '.config('app.key'));

    $log = $store->readLog($id);
    expect($log)->not->toContain('sup3rs3cret')->not->toContain('github_pat_')->not->toContain((string) config('app.key'));
});

test('after a rollback nothing is left to roll back', function (): void {
    $runner = fakeUpdater($this);
    $this->publishRelease('2.0.0');
    $this->actingAs(admin());
    $id = $this->postJson(UPDATES.'/install', ['target' => '2.0.0', 'confirm_backup' => true])->json('update_id');
    resolve(UpdateOrchestrator::class)->execute($id);

    $service = Mockery::mock(CompatibilityReport::class)->makePartial();
    $service->shouldReceive('release')->andReturn(['gobia_version' => '2.0.0', 'extensions' => ['gobia-core' => '1.0.0']]);
    app()->instance(CompatibilityReport::class, $service);

    // No migrations ran, so the files alone are enough and no confirmation is asked.
    $this->getJson(UPDATES.'/rollback-eligibility')->assertJson(['eligible' => true, 'mode' => 'file-only']);
    $rollback = $this->postJson(UPDATES.'/rollback', ['update_id' => $id])->assertStatus(202)->json('update_id');
    $runner->calls = [];
    expect(resolve(UpdateOrchestrator::class)->execute($rollback)['result'])->toBe('rolled_back');
    expect($runner->calls)->not->toContain('restore-database');

    $this->getJson(UPDATES.'/rollback-eligibility')->assertJson(['eligible' => false]);
    $this->postJson(UPDATES.'/rollback', ['update_id' => $id])->assertStatus(422);
});
