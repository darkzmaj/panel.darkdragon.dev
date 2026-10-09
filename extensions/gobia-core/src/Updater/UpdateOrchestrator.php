<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use FilesystemIterator;
use GobiaCore\Updater\Exceptions\ReleaseVerificationException;
use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\Providers\ReleaseProvider;
use GobiaCore\Updater\Runners\DeploymentRunner;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use Throwable;

/**
 * Executes one update run from start to finish: preflight, download, verification, database backup,
 * maintenance mode, installation, migrations, extension assets, caches, worker restart and health
 * check, rolling everything back if any step after the point of no return fails.
 *
 * It never takes an URL, path or command from its caller. The only input is the id of a run record
 * that {@see UpdateService} validated and created.
 */
class UpdateOrchestrator
{
    /** Step id => [label, state of the frontend contract]. */
    public const array STEPS = [
        'check' => ['Checking release and preflight', 'preflight'],
        'download' => ['Downloading release', 'staging'],
        'verify' => ['Verifying SHA-256 and signature', 'staging'],
        'extract' => ['Validating and unpacking package', 'staging'],
        'backup' => ['Creating database backup', 'backup'],
        'maintenance' => ['Entering maintenance mode', 'switching'],
        'install' => ['Installing release', 'switching'],
        'migrate' => ['Running migrations', 'migrating'],
        'extensions' => ['Publishing theme and extensions', 'migrating'],
        'cache' => ['Refreshing caches', 'switching'],
        'restart' => ['Restarting workers', 'switching'],
        'health' => ['Running health check', 'health_check'],
        'finish' => ['Completing update', 'health_check'],
    ];

    public const string LATEST_CACHE_KEY = 'gobia:update:latest';

    private const array REQUIRED_FILES = [
        'gobia-release.json', 'artisan', 'composer.json', 'bootstrap/app.php', 'vendor/autoload.php', 'public/index.php',
        'public/assets/manifest.json', 'extensions/gobia-core/extension.json', 'extensions/gobia-core/dist/client.js',
    ];

    /** @var array<string, mixed> */
    private array $run = [];

    private ?string $maintenanceSecret = null;

    public function __construct(
        private readonly RunStore $store,
        private readonly ReleaseProvider $provider,
        private readonly ReleaseVerifier $verifier,
        private readonly SafeTarExtractor $extractor,
        private readonly DatabaseBackupService $database,
        private readonly DeploymentRunner $runner,
        private readonly HttpHealthProbe $probe,
        private readonly Preflight $preflight,
    ) {}

    /**
     * Builds the initial record for a run. The step list is fixed here so the UI can show every stage up front.
     *
     * @param  array<string, mixed>|null  $initiator
     * @return array<string, mixed>
     */
    public static function newRun(string $id, string $from, string $to, ?array $initiator, string $type = 'update'): array
    {
        $steps = [];
        foreach (self::STEPS as $key => [$label]) {
            $steps[] = ['id' => $key, 'label' => $label, 'status' => 'pending', 'at' => null];
        }

        return [
            'id' => $id,
            'type' => $type,
            'from_version' => $from,
            'to_version' => $to,
            'state' => 'queued',
            'stage' => null,
            'steps' => $type === 'update' ? $steps : [],
            'started_at' => gmdate('c'),
            'finished_at' => null,
            'heartbeat' => time(),
            'result' => null,
            'failure_stage' => null,
            'error' => null,
            'initiated_by' => $initiator,
            'migrations' => null,
            'backup' => null,
            'rollback' => null,
            'flags' => ['maintenance' => false, 'files_changed' => false, 'migrated' => false],
        ];
    }

    /**
     * Runs the queued run with the given id (an update, or a manual rollback). Returns the final run record.
     *
     * @return array<string, mixed>
     */
    public function execute(string $runId): array
    {
        $lock = $this->store->tryLock();
        if ($lock === null) {
            throw new UpdateException('Another update process is already running.');
        }

        try {
            $this->run = $this->store->load($runId) ?? throw new UpdateException('Unknown update run.');
            if ($this->run['state'] !== 'queued') {
                throw new UpdateException('That update run was already started.');
            }

            $this->run['pid'] = getmypid();
            $this->run['state'] = 'running';
            $this->persist();

            try {
                if (($this->run['type'] ?? 'update') === 'rollback') {
                    $this->performManualRollback();
                } else {
                    $this->perform();
                    $this->run['result'] = 'success';
                    $this->run['state'] = 'completed';
                    $this->run['stage'] = null;
                    $this->log('Update to '.$this->run['to_version'].' completed.');
                }
            } catch (Throwable $exception) {
                $this->fail($exception);
                $this->rollback();
            } finally {
                $this->run['finished_at'] = gmdate('c');
                $this->persist();
                $this->store->release($runId);
                Cache::forget(self::LATEST_CACHE_KEY);
            }
        } finally {
            $this->store->unlock($lock);
        }

        return $this->run;
    }

    /**
     * Cleans up after a run whose worker died. Uses the flags recorded on the run to decide what to undo.
     *
     * @param  array<string, mixed>  $run
     * @return array<string, mixed>
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
            $this->store->release((string) $run['id']);
            $this->store->unlock($lock);
        }

        return $this->run;
    }

    private function perform(): void
    {
        $id = (string) $this->run['id'];
        $target = (string) $this->run['to_version'];
        $work = $this->store->path('downloads').'/'.$id;
        $package = $work.'/panel.tar.gz';
        $staged = $this->store->path('staging').'/'.$id;
        $backupDir = $this->store->path('backups').'/'.$id;

        // Load everything the rest of the run needs before the code on disk is replaced.
        foreach ([Redactor::class, UpdateException::class, ReleaseVerificationException::class, ProcessResult::class] as $class) {
            class_exists($class);
        }
        Str::limit('preload', 3);
        Cache::get(self::LATEST_CACHE_KEY);

        /** @var ReleaseInfo $release */
        $release = $this->step('check', function () use ($target): ReleaseInfo {
            $release = $this->provider->find($target) ?? throw new UpdateException('Release '.$target.' is not published by the update source.');
            $this->verifier->verifyMetadata($release);

            $report = $this->preflight->evaluate($release, duringRun: true);
            if (! $report['ready']) {
                $failing = collect($report['checks'])->filter(fn (array $check): bool => $check['required'] && $check['status'] !== 'pass')
                    ->map(fn (array $check): string => $check['id'].': '.$check['message'])->implode('; ');

                throw new UpdateException('Preflight failed - '.$failing);
            }
            $this->run['migrations'] = $report['migrations'];

            return $release;
        });

        $this->step('download', function () use ($release, $work, $package): void {
            @mkdir($work, 0750, true);
            $this->provider->download($release, $package);
        });

        $this->step('verify', fn () => $this->verifier->verifyPackage($package, $release));

        $this->step('extract', function () use ($package, $staged, $release): void {
            $stats = $this->extractor->extract($package, $staged);
            $this->log(sprintf('Unpacked %d files (%d bytes).', $stats['files'], $stats['bytes']));

            foreach (self::REQUIRED_FILES as $required) {
                if (! is_file($staged.'/'.$required)) {
                    throw new ReleaseVerificationException('The release package is incomplete: '.$required.' is missing.');
                }
            }

            $inside = json_decode((string) file_get_contents($staged.'/gobia-release.json'), true);
            if (! is_array($inside) || ($inside['gobia_version'] ?? null) !== $release->version()) {
                throw new ReleaseVerificationException('The package contains a different version than the one that was requested.');
            }
        });

        $this->step('backup', function () use ($backupDir): void {
            $file = $this->database->create($backupDir, 'database');
            $this->run['backup'] = ['database' => $file, 'directory' => $backupDir, 'taken_at' => gmdate('c')];
            $this->log('Database backup written and verified ('.filesize($file).' bytes).');
        });

        $this->step('maintenance', function (): void {
            $this->maintenanceSecret = Str::lower(Str::random(32));
            $this->run['flags']['maintenance'] = true;
            $this->persist();
            $this->artisanOrFail('down', ['--secret='.$this->maintenanceSecret, '--retry=30']);
        });

        $this->step('install', function () use ($staged, $release, $backupDir): void {
            $this->run['flags']['files_changed'] = true;
            $this->persist();
            $this->runner->install($staged, $release, $backupDir);
        });

        $this->step('migrate', function (): void {
            $this->run['flags']['migrated'] = true;
            $this->persist();
            $this->artisanOrFail('migrate', ['--force']);
        });

        // Runs in the new code: applies the Gobia theme, then migrates and republishes every enabled extension.
        $this->step('extensions', fn () => $this->artisanOrFail('gobia-core:update:finalize'));

        $this->step('cache', fn () => $this->refreshCaches());

        $this->step('restart', fn () => $this->runner->restartWorkers());

        $this->step('health', function () use ($target): void {
            $result = $this->runner->artisan('gobia-core:update:health', ['--expect='.$target]);
            $report = json_decode(trim($result->output), true);

            if (! is_array($report) || ! ($report['ok'] ?? false)) {
                $failed = is_array($report)
                    ? collect($report['checks'] ?? [])->where('ok', false)->map(fn (array $check): string => $check['name'].': '.$check['detail'])->implode('; ')
                    : trim($result->error ?: $result->output);

                throw new UpdateException('Health check failed - '.Redactor::scrub(Str::limit($failed, 400)));
            }

            $this->probe->check((string) $this->maintenanceSecret);
        });

        $this->step('finish', function () use ($staged, $work): void {
            $this->artisanOrFail('up');
            $this->run['flags']['maintenance'] = false;
            $this->deleteTree($staged);
            $this->deleteTree($work);
            $this->pruneBackups();
        });
    }

    /** A rollback requested by an administrator: the run record already carries the backup of the update being undone. */
    private function performManualRollback(): void
    {
        $this->log('Manual rollback to '.$this->run['to_version'].'.');
        $this->run['flags']['maintenance'] = true;
        $this->persist();
        $this->artisanOrFail('down', ['--secret='.Str::lower(Str::random(32)), '--retry=30']);
        $this->rollback();
        if ($this->run['result'] === 'rolled_back') {
            // The backup has been consumed: the files it held are live again.
            $this->run['backup'] = null;
        }
    }

    /**
     * Undoes a run as far as it got. Files are restored first, then the database when migrations had started.
     */
    private function rollback(): void
    {
        $flags = $this->run['flags'] ?? [];
        $this->run['rollback'] = ['attempted' => false, 'result' => 'not-needed', 'database_restored' => false];

        if (! ($flags['files_changed'] ?? false) && ! ($flags['migrated'] ?? false)) {
            $this->bringUp();

            return;
        }

        $this->run['state'] = 'rolling_back';
        $this->run['rollback'] = ['attempted' => true, 'result' => 'running', 'database_restored' => false];
        $this->persist();
        $backup = $this->run['backup'] ?? null;

        try {
            if (! is_array($backup)) {
                throw new UpdateException('No backup was recorded for this run.');
            }

            if ($flags['files_changed']) {
                $this->log('Rolling back: restoring previous release files.');
                $this->runner->restoreFiles((string) $backup['directory']);
            }

            // Migrations are not reliably reversible, so the pre-update dump is restored instead.
            if ($flags['migrated']) {
                $this->log('Rolling back: restoring the pre-update database backup.');
                $this->database->restore((string) $backup['database']);
                $this->run['rollback']['database_restored'] = true;
            }

            $this->refreshCaches();
            rescue(fn () => $this->runner->restartWorkers(), report: false);
            $this->run['rollback']['result'] = 'success';
            $this->run['result'] = 'rolled_back';
            $this->run['state'] = 'failed';
            $this->log('Rollback completed; the previous version is active again.');
            $this->bringUp();
        } catch (Throwable $exception) {
            // Stay in maintenance mode: serving a half restored application would be worse than serving nothing.
            $this->run['rollback']['result'] = 'failed';
            $this->run['rollback']['error'] = Str::limit(Redactor::scrub($exception->getMessage()), 400);
            $this->run['result'] = 'rollback_failed';
            $this->run['state'] = 'failed';
            $this->log('ROLLBACK FAILED: '.$exception->getMessage().' - run "php artisan gobia-core:update:recover" after fixing the cause.');
        }
    }

    /**
     * Recompiles the views for the code that is live now. The configuration, route and event snapshots are not
     * rebuilt here: they live in bootstrap/cache, which belongs to each release, and extension providers change
     * configuration at boot, so the Panel does not freeze them while extensions are enabled. `optimize:clear` is
     * avoided on purpose because it also flushes the application cache, which can hold sessions.
     */
    private function refreshCaches(): void
    {
        $this->artisanOrFail('view:clear');
        $this->artisanOrFail('view:cache');

        // Route and event snapshots save every request (and every Wings call) the work of registering all
        // routes again. They are an optimisation only: an extension with a route that cannot be cached must
        // not fail the update, so a failed snapshot is removed and the Panel simply runs without it.
        foreach (['route' => 'route:cache', 'event' => 'event:cache'] as $kind => $command) {
            $result = $this->runner->artisan($command);
            if (! $result->successful()) {
                $this->log('The '.$kind.' cache could not be built; continuing without it.');
                rescue(fn () => $this->runner->artisan($kind.':clear'), report: false);
            }
        }
    }

    private function bringUp(): void
    {
        if (! ($this->run['flags']['maintenance'] ?? false)) {
            return;
        }

        try {
            $this->runner->artisan('up');
            $this->run['flags']['maintenance'] = false;
        } catch (Throwable $exception) {
            $this->log('Could not leave maintenance mode: '.$exception->getMessage());
        }
    }

    private function step(string $id, callable $callback): mixed
    {
        $index = (int) collect($this->run['steps'])->search(fn (array $step): bool => $step['id'] === $id);
        $this->run['stage'] = $id;
        $this->run['steps'][$index]['status'] = 'running';
        $this->run['steps'][$index]['at'] = gmdate('c');
        $this->log(self::STEPS[$id][0].'...');
        $this->persist();

        try {
            $result = $callback();
        } catch (Throwable $exception) {
            $this->run['steps'][$index]['status'] = 'failed';
            $this->run['failure_stage'] = $id;
            $this->persist();

            throw $exception;
        }

        $this->run['steps'][$index]['status'] = 'done';
        $this->persist();

        return $result;
    }

    /** @param list<string> $arguments */
    private function artisanOrFail(string $command, array $arguments = []): void
    {
        $result = $this->runner->artisan($command, $arguments);
        if (! $result->successful()) {
            // One readable line for the administrator; the complete output is in the run's log file.
            $output = trim($result->error ?: $result->output);
            $this->log('"'.$command.'" exited with '.$result->exitCode.":\n".$output);
            $summary = (string) preg_replace('/\s+/', ' ', (string) preg_replace('/[^\x20-\x7e\n]+/', ' ', $output));

            throw new UpdateException('"'.$command.'" failed: '.Redactor::scrub(Str::limit(trim($summary), 300)));
        }
    }

    private function fail(Throwable $exception): void
    {
        $this->run['state'] = 'failed';
        $this->run['result'] = 'failed';
        $message = $exception instanceof UpdateException
            ? $exception->getMessage()
            : 'Unexpected '.class_basename($exception).'; see the updater log.';

        $this->run['error'] = Str::limit(Redactor::scrub($message), 500);
        $this->log('FAILED at '.($this->run['failure_stage'] ?? '?').': '.$exception->getMessage());
        if (! ($exception instanceof UpdateException)) {
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
        $this->store->log((string) $this->run['id'], $line);
    }

    /** Keeps the newest backups; an older update can then no longer be rolled back. */
    private function pruneBackups(): void
    {
        $dirs = glob($this->store->path('backups').'/*', GLOB_ONLYDIR) ?: [];
        rsort($dirs);

        foreach (array_slice($dirs, max(1, (int) config('gobia_updater.backup_retention'))) as $dir) {
            $this->deleteTree($dir);
        }
    }

    private function deleteTree(string $path): void
    {
        if (! file_exists($path)) {
            return;
        }

        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $item) {
            $item->isDir() && ! $item->isLink() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($path);
    }
}
