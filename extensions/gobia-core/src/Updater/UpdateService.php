<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use GobiaCore\Services\CompatibilityReport;
use GobiaCore\Updater\Exceptions\PreflightFailedException;
use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\Exceptions\UpdateInProgressException;
use GobiaCore\Updater\Providers\ReleaseProvider;
use Illuminate\Support\Facades\Cache;
use Pterodactyl\Services\Extensions\ExtensionRepository;

/**
 * What the admin API and the console commands talk to: update availability (cached), the preflight,
 * starting a run and reading progress, in the shapes of docs/gobia-updates-frontend-contract.md.
 * Starting only ever accepts a version string, which must be the release the configured source publishes.
 */
class UpdateService
{
    public const int CONTRACT_VERSION = 1;

    private const array TERMINAL = ['completed', 'failed', 'rolled_back'];

    public function __construct(
        private readonly ReleaseProvider $provider,
        private readonly ReleaseVerifier $verifier,
        private readonly RunStore $store,
        private readonly Preflight $preflight,
        private readonly CompatibilityReport $report,
        private readonly ExtensionRepository $extensions,
    ) {}

    public function currentVersion(): string
    {
        return (string) ($this->report->release()['gobia_version'] ?? 'unknown');
    }

    /**
     * Versions of this installation and the latest approved Gobia release. The lookup is cached;
     * $refresh asks the source again. A failed lookup is reported in `error` and cached briefly so a
     * broken token does not hammer the source.
     *
     * @return array<string, mixed>
     */
    public function check(bool $refresh = false): array
    {
        $lookup = $this->lookup($refresh);
        $release = is_array($lookup['release']) ? ReleaseInfo::fromCache($lookup['release']) : null;

        $extensions = [];
        foreach ($this->extensions->discovered() as $manifest) {
            $extensions[$manifest->id] = $manifest->version;
        }

        return [
            'contract_version' => self::CONTRACT_VERSION,
            'current' => [
                'gobia' => $this->currentVersion(),
                'pterodactyl_base' => (string) config('extensions.panel_version'),
                'extensions' => (object) $extensions,
            ],
            'latest_approved' => $release === null ? null : [
                'gobia' => $release->version(),
                'pterodactyl_base' => $release->baseVersion(),
                'published_at' => $release->publishedAt,
                'security' => $release->securityUpdate(),
                'release_notes_markdown' => $release->notes,
                'artifact' => ['sha256' => $release->sha256(), 'size' => $release->size(), 'signed' => $release->signature() !== null],
            ],
            'update_available' => $lookup['available'],
            'checked_at' => $lookup['checked_at'],
            'error' => $lookup['error'],
        ];
    }

    /** The release an update would install: the cached latest approved one, if it is newer than this installation. */
    public function availableRelease(): ?ReleaseInfo
    {
        $lookup = $this->lookup(false);

        return $lookup['available'] && is_array($lookup['release']) ? ReleaseInfo::fromCache($lookup['release']) : null;
    }

    /** @return array<string, mixed>|null null when there is nothing to install */
    public function preflight(): ?array
    {
        $release = $this->availableRelease();

        return $release === null ? null : $this->preflight->evaluate($release);
    }

    /**
     * Validates the request, runs the preflight and begins the update in a detached worker.
     *
     * @param  array<string, mixed>|null  $initiator
     * @return array<string, mixed> the new run
     *
     * @throws UpdateInProgressException|PreflightFailedException|UpdateException
     */
    public function start(string $version, ?array $initiator): array
    {
        if (! VersionComparator::isValid($version)) {
            throw new UpdateException('That is not a valid Gobia version.');
        }

        $this->refuseIfActive();

        // Only the newest approved release may be installed, and its manifest must verify right now.
        $release = $this->provider->latest();
        if ($release === null || $release->version() !== $version) {
            throw new UpdateException('Version '.$version.' is not the latest approved Gobia release.');
        }
        $this->verifier->verifyMetadata($release);

        $report = $this->preflight->evaluate($release);
        if (! $report['ready']) {
            throw new PreflightFailedException($report);
        }

        [$created, $run] = $this->store->begin(UpdateOrchestrator::newRun($this->store->newId(), $this->currentVersion(), $version, $initiator));
        if (! $created) {
            throw new UpdateInProgressException((string) $run['id']);
        }

        $this->spawn('gobia-core:update:work', (string) $run['id']);

        return $run;
    }

    /**
     * @return array{eligible: bool, mode: string, update_id: string|null, database_snapshot: array{id: string, taken_at: string|null}|null, reason: string|null}
     */
    public function rollbackEligibility(): array
    {
        $none = fn (string $reason): array => ['eligible' => false, 'mode' => 'file-only', 'update_id' => null, 'database_snapshot' => null, 'reason' => $reason];

        if ($this->store->active() !== null) {
            return $none('An update is running.');
        }

        $last = $this->lastUpdate();
        if ($last === null) {
            return $none('There is no installed update to roll back.');
        }
        if (($last['result'] ?? null) !== 'success' || $last['to_version'] !== $this->currentVersion()) {
            return $none('The last update is not the version that is running.');
        }

        $backup = $last['backup'] ?? null;
        if (! is_array($backup) || ! is_dir((string) ($backup['directory'] ?? '')) || ! is_file((string) ($backup['database'] ?? ''))) {
            return $none('The backup of the last update is no longer kept.');
        }

        return [
            'eligible' => true,
            'mode' => $this->ranMigrations($last) ? 'requires-db-restore' : 'file-only',
            'update_id' => (string) $last['id'],
            'database_snapshot' => ['id' => (string) $last['id'], 'taken_at' => $backup['taken_at'] ?? $last['started_at'] ?? null],
            'reason' => null,
        ];
    }

    /**
     * Begins reverting the last update in a detached worker. When that update ran migrations the
     * pre-update database is restored, which discards everything saved since; the caller must have confirmed that.
     *
     * @param  array<string, mixed>|null  $initiator
     * @return array<string, mixed> the rollback run
     */
    public function startRollback(string $updateId, bool $confirmDatabaseRestore, ?array $initiator): array
    {
        $this->refuseIfActive();

        $eligibility = $this->rollbackEligibility();
        if (! $eligibility['eligible'] || $eligibility['update_id'] !== $updateId) {
            throw new UpdateException($eligibility['reason'] ?? 'Only the last update can be rolled back.');
        }
        if ($eligibility['mode'] === 'requires-db-restore' && ! $confirmDatabaseRestore) {
            throw new UpdateException('That update changed the database. Rolling back restores the database from before the update and discards everything saved since; confirm this explicitly.');
        }

        $last = (array) $this->store->load($updateId);
        $run = UpdateOrchestrator::newRun($this->store->newId(), $this->currentVersion(), (string) $last['from_version'], $initiator, 'rollback');
        $run['rolls_back'] = $updateId;
        $run['backup'] = $last['backup'];
        $run['flags'] = ['maintenance' => false, 'files_changed' => true, 'migrated' => $this->ranMigrations($last)];

        [$created, $run] = $this->store->begin($run);
        if (! $created) {
            throw new UpdateInProgressException((string) $run['id']);
        }

        $this->spawn('gobia-core:update:work', (string) $run['id']);

        return $run;
    }

    /**
     * Progress of one run in the contract's shape. Also notices a dead worker and triggers recovery.
     *
     * @return array<string, mixed>|null
     */
    public function progress(string $id): ?array
    {
        $run = $this->store->load($id);
        if ($run === null) {
            return null;
        }

        if (empty($run['finished_at']) && $this->store->isStale($run)) {
            $this->spawn('gobia-core:update:recover', null);
        }

        $steps = (array) ($run['steps'] ?? []);
        $done = count(array_filter($steps, fn (array $step): bool => $step['status'] === 'done'));
        $state = $this->state($run);

        return [
            'update_id' => $run['id'],
            'type' => $run['type'] ?? 'update',
            'state' => $state,
            'percent' => in_array($state, ['completed', 'rolled_back'], true) ? 100 : (int) round($done / max(1, count($steps)) * 100),
            'step' => $run['stage'] ?? $state,
            'steps' => array_map(fn (array $step): array => ['id' => $step['id'], 'label' => $step['label'], 'status' => $step['status']], $steps),
            'log' => $this->logEntries((string) $run['id']),
            'failure' => $run['error'] ?? null,
            'failure_step' => $run['failure_stage'] ?? null,
            'rollback' => [
                'performed' => ($run['rollback']['result'] ?? null) === 'success',
                'database_restored' => (bool) ($run['rollback']['database_restored'] ?? false),
                'failed' => ($run['rollback']['result'] ?? null) === 'failed',
            ],
        ];
    }

    /** The run that is in flight, if any, so a reloaded page can pick its progress up again. */
    public function activeId(): ?string
    {
        $active = $this->store->active();

        return $active === null ? null : (string) $active['id'];
    }

    /** @return list<array<string, mixed>> newest first */
    public function history(int $limit = 20): array
    {
        $entries = [];
        foreach ($this->store->history($limit) as $run) {
            $state = $this->state($run);
            $entries[] = [
                'update_id' => $run['id'],
                'type' => $run['type'] ?? 'update',
                'from' => $run['from_version'],
                'to' => $run['to_version'],
                'started_at' => $run['started_at'],
                'finished_at' => $run['finished_at'] ?? null,
                'result' => in_array($state, self::TERMINAL, true) ? $state : 'running',
                'rolled_back' => ($run['rollback']['result'] ?? null) === 'success',
                'database_restored' => (bool) ($run['rollback']['database_restored'] ?? false),
                'failure' => $run['error'] ?? null,
            ];
        }

        return $entries;
    }

    public function store(): RunStore
    {
        return $this->store;
    }

    /** @param array<string, mixed> $run */
    private function state(array $run): string
    {
        $rolledBack = ($run['result'] ?? null) === 'rolled_back';
        if (($run['type'] ?? 'update') === 'rollback') {
            return match (true) {
                $rolledBack => 'rolled_back',
                ! empty($run['finished_at']) => 'failed',
                $run['state'] === 'queued' => 'queued',
                default => 'rolling_back',
            };
        }

        return match ($run['state']) {
            'queued' => 'queued',
            'completed' => 'completed',
            'rolling_back' => 'rolling_back',
            'failed' => $rolledBack ? 'rolled_back' : 'failed',
            default => UpdateOrchestrator::STEPS[$run['stage'] ?? 'check'][1] ?? 'preflight',
        };
    }

    /** @return list<array{at: string, level: string, message: string}> */
    private function logEntries(string $id): array
    {
        $entries = [];
        foreach (array_slice(explode("\n", trim($this->store->readLog($id))), -200) as $line) {
            if (preg_match('/^\[([^\]]+)\] (.*)$/', $line, $match) !== 1) {
                continue;
            }
            $level = str_starts_with($match[2], 'FAILED') || str_starts_with($match[2], 'ROLLBACK FAILED') ? 'error' : (str_starts_with($match[2], 'Rolling back') ? 'warning' : 'info');
            // Stack traces stay in the log file on the server.
            if (str_starts_with($match[2], '#')) {
                continue;
            }
            $entries[] = ['at' => $match[1], 'level' => $level, 'message' => $match[2]];
        }

        return $entries;
    }

    /**
     * The most recent update that is still installed. Updates that failed left nothing behind (they were
     * undone) and are skipped, and so is an update that was rolled back afterwards.
     *
     * @return array<string, mixed>|null
     */
    private function lastUpdate(): ?array
    {
        $history = $this->store->history(50);

        $undone = [];
        foreach ($history as $run) {
            if (($run['type'] ?? 'update') === 'rollback' && ($run['result'] ?? null) === 'rolled_back') {
                $undone[] = $run['rolls_back'] ?? null;
            }
        }

        foreach ($history as $run) {
            if (($run['type'] ?? 'update') === 'update' && ($run['result'] ?? null) === 'success' && ! in_array($run['id'], $undone, true)) {
                return $run;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $run */
    private function ranMigrations(array $run): bool
    {
        // Unknown counts as "yes": restoring files alone under a changed schema would leave the Panel broken.
        return ($run['migrations']['pending'] ?? -1) !== 0;
    }

    private function refuseIfActive(): void
    {
        $active = $this->store->active();
        if ($active !== null) {
            throw new UpdateInProgressException((string) $active['id']);
        }
    }

    /**
     * @return array{checked_at: string, release: array<string, mixed>|null, error: string|null, available: bool}
     */
    private function lookup(bool $refresh): array
    {
        if ($refresh) {
            Cache::forget(UpdateOrchestrator::LATEST_CACHE_KEY);
        }

        $result = Cache::get(UpdateOrchestrator::LATEST_CACHE_KEY);
        if (! is_array($result)) {
            $result = ['checked_at' => gmdate('c'), 'release' => null, 'error' => null, 'available' => false];

            try {
                $release = $this->provider->latest();
                if ($release !== null) {
                    $this->verifier->verifyMetadata($release);
                    $result['release'] = $release->toCache();
                }
            } catch (UpdateException $exception) {
                $result['error'] = Redactor::scrub($exception->getMessage());
            }

            Cache::put(UpdateOrchestrator::LATEST_CACHE_KEY, $result, $result['error'] === null ? (int) config('gobia_updater.check_ttl') : 120);
        }

        // Compared on every read: the installed version changes when an update finishes.
        $current = $this->currentVersion();
        $version = $result['release']['manifest']['gobia_version'] ?? null;
        $result['available'] = is_string($version) && VersionComparator::isValid($current) && VersionComparator::isNewer($version, $current);

        return $result;
    }

    /** Starts the detached worker. Overridden in tests so no real process is started. */
    protected function spawn(string $command, ?string $runId): void
    {
        ProcessRunner::detachArtisan($command, $runId);
    }
}
