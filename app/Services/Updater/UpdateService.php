<?php

namespace Pterodactyl\Services\Updater;

use Illuminate\Support\Facades\Cache;
use Symfony\Component\Process\PhpExecutableFinder;
use Pterodactyl\Services\Updater\Providers\ReleaseProvider;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * What the admin interface and console commands talk to: update availability (cached), starting a run,
 * and reading progress. Starting only ever accepts a version string, which must match a release the
 * configured source actually publishes.
 */
class UpdateService
{
    public function __construct(
        private ReleaseProvider $provider,
        private ReleaseVerifier $verifier,
        private RunStore $store,
    ) {
    }

    public function currentVersion(): string
    {
        return (string) config('app.version');
    }

    /**
     * Returns the cached result of the last update check, performing a check when the cache is empty
     * or $refresh is set. Failures are cached briefly so a broken token does not hammer GitHub.
     *
     * @return array{checked_at: string, release: array|null, error: string|null, available: bool}
     */
    public function check(bool $refresh = false): array
    {
        if ($refresh) {
            Cache::forget(UpdateOrchestrator::LATEST_CACHE_KEY);
        }

        $result = Cache::get(UpdateOrchestrator::LATEST_CACHE_KEY);
        if ($result === null) {
            $result = $this->lookup();
            Cache::put(
                UpdateOrchestrator::LATEST_CACHE_KEY,
                $result,
                $result['error'] === null ? (int) config('gobia.update.check_ttl') : 120
            );
        }

        return $result;
    }

    /**
     * The cached result only, never touching the network. For pages that must stay cheap.
     */
    public function cached(): ?array
    {
        return Cache::get(UpdateOrchestrator::LATEST_CACHE_KEY);
    }

    /**
     * Validates the request and begins an update. If one is already running its record is returned instead.
     *
     * @return array{0: bool, 1: array} whether a new run was started, and the run
     *
     * @throws UpdateException
     */
    public function start(string $version, ?array $initiator): array
    {
        if (!VersionComparator::isValid($version)) {
            throw new UpdateException('That is not a valid Panel version.');
        }

        $active = $this->store->active();
        if ($active !== null) {
            return [false, $active];
        }

        if (!VersionComparator::isNewer($version, $this->currentVersion())) {
            throw new UpdateException('The Panel is already up to date (' . $this->currentVersion() . ').');
        }

        // The version must be one the update source publishes, and its metadata must verify.
        $release = $this->provider->find($version) ?? throw new UpdateException('Version ' . $version . ' is not published by the update source.');
        $this->verifier->verifyMetadata($release);

        [$created, $run] = $this->store->begin(UpdateOrchestrator::newRun(
            $this->store->newId(),
            $this->currentVersion(),
            $version,
            $initiator
        ));

        if ($created) {
            $this->spawnWorker($run['id']);
        }

        return [$created, $run];
    }

    /**
     * Full status for the admin page. Also notices a dead worker and triggers recovery.
     */
    public function status(): array
    {
        $active = $this->store->active();
        if ($active !== null && $this->store->isStale($active)) {
            $this->spawnRecovery();
        }

        return [
            'current' => $this->currentVersion(),
            'upstream' => (string) config('app.upstream_version'),
            'latest' => $this->cached(),
            'active' => $active,
            'last_success' => $this->store->lastWithResult('success'),
            'last_failure' => collect($this->store->history(20))->first(fn ($run) => in_array($run['result'] ?? null, ['failed', 'rolled_back', 'rollback_failed'], true)),
            'history' => $this->store->history(10),
        ];
    }

    /**
     * Minimal, non sensitive progress for the maintenance page. Contains no versions, errors or paths.
     */
    public function publicProgress(): array
    {
        $run = $this->store->active() ?? collect($this->store->history(1))->first();
        if ($run === null || (!empty($run['finished_at']) && time() - strtotime($run['finished_at']) > 600)) {
            return ['active' => false, 'state' => 'idle', 'steps' => [], 'percent' => 0];
        }

        $steps = collect($run['steps'])->map(fn ($step) => ['label' => $step['label'], 'status' => $step['status']])->all();
        $done = collect($steps)->where('status', 'done')->count();

        return [
            'active' => empty($run['finished_at']),
            'state' => $run['state'],
            'result' => $run['result'],
            'steps' => $steps,
            'percent' => (int) round($done / max(1, count($steps)) * 100),
        ];
    }

    public function store(): RunStore
    {
        return $this->store;
    }

    /**
     * @return array{checked_at: string, release: array|null, error: string|null, available: bool}
     */
    private function lookup(): array
    {
        $result = ['checked_at' => gmdate('c'), 'release' => null, 'error' => null, 'available' => false];

        try {
            $release = $this->provider->latest();
            if ($release !== null) {
                $this->verifier->verifyMetadata($release);
                $result['release'] = $release->toArray();
                $result['available'] = VersionComparator::isNewer($release->version, $this->currentVersion());
            }
        } catch (UpdateException $exception) {
            $result['error'] = Redactor::scrub($exception->getMessage());
        }

        return $result;
    }

    protected function spawnWorker(string $runId): void
    {
        $this->spawn('gobia:update:work', $runId);
    }

    protected function spawnRecovery(): void
    {
        $this->spawn('gobia:update:recover', null);
    }

    /**
     * Starts a detached `php artisan <command>` from a fixed list. The only argument is a validated run id.
     */
    private function spawn(string $command, ?string $runId): void
    {
        if (!in_array($command, ['gobia:update:work', 'gobia:update:recover'], true)
            || ($runId !== null && !preg_match('/^[0-9]{8}T[0-9]{6}-[a-z0-9]{6}$/D', $runId))) {
            throw new UpdateException('Invalid worker request.');
        }

        $php = (new PhpExecutableFinder())->find() ?: 'php';
        $arguments = $runId === null ? '' : ' ' . $runId;

        $line = PHP_OS_FAMILY === 'Windows'
            ? 'start /B "" ' . escapeshellarg($php) . ' artisan ' . $command . $arguments . ' > NUL 2>&1'
            : 'nohup ' . escapeshellarg($php) . ' artisan ' . $command . $arguments . ' > /dev/null 2>&1 &';

        $cwd = getcwd();
        chdir(base_path());
        pclose(popen($line, 'r'));
        chdir($cwd);
    }
}
