<?php

namespace Pterodactyl\Services\Updater;

use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Services\Updater\Runners\DeploymentRunner;
use Pterodactyl\Services\Updater\Providers\ReleaseProvider;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;
use Pterodactyl\Services\Updater\Exceptions\ReleaseVerificationException;

/**
 * Executes one update run from start to finish: download, verification, backup, maintenance mode,
 * installation, migrations, caches, worker restart and health check, rolling everything back if any
 * step after the point of no return fails.
 *
 * It never takes an URL, path or command from its caller. The only input is the id of a run record
 * that {@see UpdateService::start()} validated and created.
 */
class UpdateOrchestrator
{
    public const STEPS = [
        'check' => 'Checking release',
        'download' => 'Downloading release',
        'verify' => 'Verifying SHA-256 and signature',
        'extract' => 'Validating and unpacking package',
        'backup' => 'Creating database backup',
        'maintenance' => 'Entering maintenance mode',
        'install' => 'Installing release',
        'migrate' => 'Running migrations',
        'cache' => 'Refreshing caches',
        'restart' => 'Restarting workers',
        'health' => 'Running health check',
        'finish' => 'Completing update',
    ];

    public const LATEST_CACHE_KEY = 'gobia:update:latest';

    private const REQUIRED_FILES = [
        'VERSION', 'artisan', 'composer.json', 'bootstrap/app.php', 'vendor/autoload.php', 'public/index.php',
        'public/assets/manifest.json',
    ];

    private array $run = [];

    private ?string $maintenanceSecret = null;

    public function __construct(
        private RunStore $store,
        private ReleaseProvider $provider,
        private ReleaseVerifier $verifier,
        private SafeTarExtractor $extractor,
        private DatabaseBackupService $database,
        private DeploymentRunner $runner,
        private HttpHealthProbe $probe,
    ) {
    }

    /**
     * Builds the initial record for a run. The step list is fixed here so the UI can show every stage up front.
     */
    public static function newRun(string $id, string $from, string $to, ?array $initiator): array
    {
        return [
            'id' => $id,
            'from_version' => $from,
            'to_version' => $to,
            'state' => 'queued',
            'stage' => null,
            'steps' => collect(self::STEPS)->map(fn ($label, $key) => ['id' => $key, 'label' => $label, 'status' => 'pending', 'at' => null])->values()->all(),
            'started_at' => gmdate('c'),
            'finished_at' => null,
            'heartbeat' => time(),
            'result' => null,
            'failure_stage' => null,
            'error' => null,
            'initiated_by' => $initiator,
            'migrations' => null,
            'requires_restart' => null,
            'backup' => null,
            'rollback' => null,
            'flags' => ['maintenance' => false, 'files_changed' => false, 'migrated' => false],
        ];
    }

    /**
     * Runs the update with the given id. Returns the final run record.
     */
    public function execute(string $runId): array
    {
        $lock = $this->store->tryLock();
        if ($lock === null) {
            throw new UpdateException('Another update process is already running.');
        }

        $this->run = $this->store->load($runId) ?? throw new UpdateException('Unknown update run.');
        $this->run['pid'] = getmypid();
        $this->run['state'] = 'running';
        $this->persist();

        try {
            $this->perform();
            $this->run['result'] = 'success';
            $this->run['state'] = 'completed';
            $this->run['stage'] = null;
            $this->log('Update to ' . $this->run['to_version'] . ' completed.');
        } catch (\Throwable $exception) {
            $this->fail($exception);
            $this->rollback();
        } finally {
            $this->run['finished_at'] = gmdate('c');
            $this->persist();
            $this->store->release($runId);
            $this->store->unlock($lock);
            Cache::forget(self::LATEST_CACHE_KEY);
        }

        return $this->run;
    }

    /**
     * Cleans up after a run whose worker died. Uses the flags recorded on the run to decide what to undo.
     */
    public function recover(array $run): array
    {
        $lock = $this->store->tryLock();
        if ($lock === null) {
            return $run;
        }

        $this->run = $run;
        try {
            $this->run['failure_stage'] ??= $run['stage'];
            $this->run['error'] = 'The updater process stopped unexpectedly.';
            $this->log('Recovering a run whose worker stopped unexpectedly.');
            $this->rollback();
        } finally {
            $this->run['result'] ??= 'failed';
            $this->run['state'] = 'failed';
            $this->run['finished_at'] ??= gmdate('c');
            $this->persist();
            $this->store->release($run['id']);
            $this->store->unlock($lock);
        }

        return $this->run;
    }

    /**
     * Manually reverts the most recent successful update using the backup it left behind.
     *
     * The previous files are always restored. The database dump predates everything that happened after the update,
     * so restoring it discards that data; it is only done when the update ran migrations (the old code cannot work
     * with the new schema) and the caller explicitly accepted the data loss.
     */
    public function rollbackLast(?array $initiator, bool $restoreDatabase): array
    {
        $last = $this->store->lastWithResult('success');
        $backup = $last['backup'] ?? null;
        if ($last === null || $backup === null || !is_dir($backup['directory'] ?? '')) {
            throw new UpdateException('There is no successful update with a retained backup to roll back.');
        }

        if (($last['migrations'] ?? true) && !$restoreDatabase) {
            throw new UpdateException('That update ran database migrations. Rolling back restores the pre-update database and discards everything saved since; confirm with --restore-database.');
        }

        $run = self::newRun($this->store->newId(), $this->current(), $last['from_version'], $initiator);
        $run['type'] = 'rollback';
        $run['backup'] = $backup;
        $run['flags'] = ['maintenance' => false, 'files_changed' => true, 'migrated' => (bool) ($last['migrations'] ?? true)];
        [$created, $run] = $this->store->begin($run);
        if (!$created) {
            throw new UpdateException('An update is already running.');
        }

        $lock = $this->store->tryLock();
        $this->run = $run;
        $this->run['state'] = 'running';

        try {
            $this->log('Manual rollback to ' . $last['from_version'] . '.');
            $this->artisanOrFail('down', ['--secret=' . Str::lower(Str::random(32)), '--retry=60']);
            $this->run['flags']['maintenance'] = true;
            $this->persist();
            $this->rollback();
            $this->run['state'] = $this->run['result'] === 'rolled_back' ? 'completed' : 'failed';
        } finally {
            $this->run['finished_at'] = gmdate('c');
            $this->persist();
            $this->store->release($this->run['id']);
            $lock && $this->store->unlock($lock);
            Cache::forget(self::LATEST_CACHE_KEY);
        }

        return $this->run;
    }

    private function current(): string
    {
        return (string) config('app.version');
    }

    private function perform(): void
    {
        $id = $this->run['id'];
        $target = $this->run['to_version'];
        $work = $this->store->path('downloads') . '/' . $id;
        $package = $work . '/panel.tar.gz';
        $staged = $this->store->path('staging') . '/' . $id;
        $backupDir = $this->store->path('backups') . '/' . $id;

        // Load everything the rest of the run needs before the code on disk is replaced.
        class_exists(Redactor::class);
        class_exists(UpdateException::class);
        Str::limit('preload', 3);
        Cache::get(self::LATEST_CACHE_KEY);

        $release = $this->step('check', function () use ($target) {
            if (!VersionComparator::isNewer($target, (string) config('app.version'))) {
                throw new UpdateException('Version ' . $target . ' is not newer than the installed ' . config('app.version') . '.');
            }

            $release = $this->provider->find($target) ?? throw new UpdateException('Release ' . $target . ' is not published by the update source.');
            $this->verifier->verifyMetadata($release);
            $this->run['migrations'] = $release->migrations;
            $this->run['requires_restart'] = $release->requiresRestart;

            return $release;
        });

        $this->step('download', function () use ($release, $work, $package) {
            @mkdir($work, 0750, true);
            $this->provider->download($release, $package);
        });

        $this->step('verify', function () use ($release, $package) {
            $this->verifier->verifyPackage($package, $release);
        });

        $this->step('extract', function () use ($package, $staged, $release) {
            $stats = $this->extractor->extract($package, $staged);
            $this->log(sprintf('Unpacked %d files (%d bytes).', $stats['files'], $stats['bytes']));

            foreach (self::REQUIRED_FILES as $required) {
                if (!is_file($staged . '/' . $required)) {
                    throw new ReleaseVerificationException('The release package is incomplete: ' . $required . ' is missing.');
                }
            }

            if (trim((string) file_get_contents($staged . '/VERSION')) !== $release->version) {
                throw new ReleaseVerificationException('The package contains a different version than the one that was requested.');
            }
        });

        $this->step('backup', function () use ($backupDir) {
            $file = $this->database->create($backupDir, 'database');
            $this->run['backup'] = ['database' => $file, 'directory' => $backupDir];
            $this->log('Database backup written (' . filesize($file) . ' bytes).');
        });

        $this->step('maintenance', function () {
            $this->maintenanceSecret = Str::lower(Str::random(32));
            $this->run['flags']['maintenance'] = true;
            $this->persist();
            $this->artisanOrFail('down', ['--secret=' . $this->maintenanceSecret, '--retry=60']);
        });

        $this->step('install', function () use ($staged, $release, $backupDir) {
            $this->run['flags']['files_changed'] = true;
            $this->persist();
            $this->runner->install($staged, $release, $backupDir);
        });

        $this->step('migrate', function () {
            $this->run['flags']['migrated'] = true;
            $this->persist();
            $this->artisanOrFail('migrate', ['--force']);
        });

        $this->step('cache', function () {
            if (app()->environment('production')) {
                $this->artisanOrFail('optimize');
                $this->artisanOrFail('view:cache');
            } else {
                $this->artisanOrFail('optimize:clear');
            }
        });

        $this->step('restart', fn () => $this->runner->restartWorkers());

        $this->step('health', function () use ($target) {
            $result = $this->runner->artisan('gobia:update:health', ['--expect=' . $target]);
            $report = json_decode(trim($result->output), true);

            if (!is_array($report) || !($report['ok'] ?? false)) {
                $failed = is_array($report) ? collect($report['checks'] ?? [])->where('ok', false)->map(fn ($c) => $c['name'] . ': ' . $c['detail'])->implode('; ') : trim($result->error ?: $result->output);
                throw new UpdateException('Health check failed - ' . Redactor::scrub(Str::limit($failed, 400)));
            }

            $this->probe->check($this->maintenanceSecret);
        });

        $this->step('finish', function () use ($staged, $work) {
            $this->artisanOrFail('up');
            $this->run['flags']['maintenance'] = false;
            $this->deleteTree($staged);
            $this->deleteTree($work);
            $this->pruneBackups();
        });
    }

    /**
     * Undoes a failed run as far as it got. Files are restored first, then the database when migrations had started.
     */
    private function rollback(): void
    {
        $flags = $this->run['flags'] ?? [];
        $this->run['rollback'] = ['attempted' => false, 'result' => 'not-needed'];

        if (!($flags['files_changed'] ?? false) && !($flags['migrated'] ?? false)) {
            $this->bringUp();

            return;
        }

        $this->run['state'] = 'rolling_back';
        $this->run['rollback'] = ['attempted' => true, 'result' => 'running'];
        $this->persist();
        $backup = $this->run['backup'] ?? null;

        try {
            if ($backup === null) {
                throw new UpdateException('No backup was recorded for this run.');
            }

            if ($flags['files_changed']) {
                $this->log('Rolling back: restoring previous release files.');
                $this->runner->restoreFiles($backup['directory']);
            }

            // Migrations are not reliably reversible, so the pre-update dump is restored instead.
            if ($flags['migrated']) {
                $this->log('Rolling back: restoring the pre-update database backup.');
                $this->database->restore($backup['database']);
            }

            $this->runner->artisan('optimize:clear');
            $this->run['rollback']['result'] = 'success';
            $this->run['result'] = 'rolled_back';
            $this->run['state'] = 'failed';
            $this->log('Rollback completed; the previous version is active again.');
            $this->bringUp();
        } catch (\Throwable $exception) {
            // Stay in maintenance mode: serving a half restored application would be worse than serving nothing.
            $this->run['rollback']['result'] = 'failed';
            $this->run['rollback']['error'] = Str::limit(Redactor::scrub($exception->getMessage()), 400);
            $this->run['result'] = 'rollback_failed';
            $this->run['state'] = 'failed';
            $this->log('ROLLBACK FAILED: ' . $exception->getMessage() . ' - run "php artisan gobia:update:recover" after fixing the cause.');
        }
    }

    private function bringUp(): void
    {
        if (!($this->run['flags']['maintenance'] ?? false)) {
            return;
        }

        try {
            $this->runner->artisan('up');
            $this->run['flags']['maintenance'] = false;
        } catch (\Throwable $exception) {
            $this->log('Could not leave maintenance mode: ' . $exception->getMessage());
        }
    }

    private function step(string $id, callable $callback): mixed
    {
        $index = collect($this->run['steps'])->search(fn ($step) => $step['id'] === $id);
        $this->run['stage'] = $id;
        $this->run['steps'][$index]['status'] = 'running';
        $this->run['steps'][$index]['at'] = gmdate('c');
        $this->log(self::STEPS[$id] . '...');
        $this->persist();

        try {
            $result = $callback();
        } catch (\Throwable $exception) {
            $this->run['steps'][$index]['status'] = 'failed';
            $this->run['failure_stage'] = $id;
            $this->persist();

            throw $exception;
        }

        $this->run['steps'][$index]['status'] = 'done';
        $this->persist();

        return $result;
    }

    private function artisanOrFail(string $command, array $options = []): void
    {
        $result = $this->runner->artisan($command, $options);
        if (!$result->successful()) {
            throw new UpdateException('"' . $command . '" failed: ' . Redactor::scrub(Str::limit(trim($result->error ?: $result->output), 600)));
        }
    }

    private function fail(\Throwable $exception): void
    {
        $this->run['state'] = 'failed';
        $this->run['result'] = 'failed';
        $message = $exception instanceof UpdateException
            ? $exception->getMessage()
            : 'Unexpected ' . class_basename($exception) . '; see the updater log.';

        $this->run['error'] = Str::limit(Redactor::scrub($message), 500);
        $this->log('FAILED at ' . ($this->run['failure_stage'] ?? '?') . ': ' . $exception->getMessage());
        if (!($exception instanceof UpdateException)) {
            $this->log($exception->getTraceAsString());
        }
    }

    private function persist(): void
    {
        $this->run['heartbeat'] = time();
        $this->store->save($this->run);
    }

    private function log(string $line): void
    {
        $this->store->log($this->run['id'], $line);
    }

    private function pruneBackups(): void
    {
        $dirs = glob($this->store->path('backups') . '/*', GLOB_ONLYDIR) ?: [];
        rsort($dirs);

        foreach (array_slice($dirs, max(1, (int) config('gobia.update.backup_retention'))) as $dir) {
            $this->deleteTree($dir);
        }
    }

    private function deleteTree(string $path): void
    {
        if (!file_exists($path)) {
            return;
        }

        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $item) {
            $item->isDir() && !$item->isLink() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($path);
    }
}
