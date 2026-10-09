<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use Composer\Semver\Semver;
use GobiaCore\Services\CompatibilityReport;
use GobiaCore\Updater\Runners\DeploymentRunner;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use Pterodactyl\Models\Node;
use Pterodactyl\Services\Extensions\ExtensionRepository;
use Symfony\Component\Process\ExecutableFinder;
use Throwable;

/**
 * The local compatibility gate: every check that must pass before a release may be installed on this
 * installation. It only reads; nothing here changes the Panel. `ready` is true only when every required
 * check passes, and the updater runs the same checks again as its first step.
 */
class Preflight
{
    /** Bytes kept free on top of what the update itself needs. */
    private const int DISK_HEADROOM = 256 * 1024 * 1024;

    public function __construct(
        private readonly CompatibilityReport $report,
        private readonly ExtensionRepository $extensions,
        private readonly ReleaseVerifier $verifier,
        private readonly DeploymentRunner $runner,
        private readonly RunStore $store,
        private readonly ProcessRunner $processes,
    ) {}

    /**
     * @return array{ready: bool, target: string, checks: list<array{id: string, required: bool, status: string, message: string, detail: array<string, mixed>}>, extensions: list<array{id: string, current: string|null, required: string, compatible: bool, reason: string|null}>, migrations: array{pending: int, destructive: bool, rollback: string}}
     */
    public function evaluate(ReleaseInfo $release, bool $duringRun = false): array
    {
        $current = (string) ($this->report->release()['gobia_version'] ?? 'unknown');
        $pendingNow = $this->report->pendingMigrations();
        $ran = $this->report->ranMigrations();
        $toRun = $ran === null ? null : array_values(array_diff($release->migrationNames(), $ran));
        $extensions = $this->bundledExtensions($release);
        $thirdParty = $this->thirdPartyProblems($release);

        $checks = [
            $this->check('gobia_version', true, fn (): array => $this->gobiaVersion($current, $release)),
            $this->check('pterodactyl_base', true, fn (): array => ['pass', 'Base '.config('extensions.panel_version').' to '.$release->baseVersion().'.', ['commit' => $release->baseCommit()]]),
            $this->check('extensions', true, function () use ($extensions): array {
                $bad = array_values(array_filter($extensions, fn (array $extension): bool => ! $extension['compatible']));

                return $bad === [] ? ['pass', count($extensions).' bundled Gobia extensions.', []] : ['fail', (string) $bad[0]['reason'], ['extensions' => array_column($bad, 'id')]];
            }),
            $this->check('extension_api', true, fn (): array => $thirdParty['panel'] === []
                ? ['pass', 'Installed extensions support the target Panel.', []]
                : ['fail', $thirdParty['panel'][0], ['problems' => $thirdParty['panel']]]),
            $this->check('frontend_sdk', true, fn (): array => $thirdParty['sdk'] === []
                ? ['pass', 'Installed extensions support the target SDK '.($release->sdkVersion() ?? 'unchanged').'.', []]
                : ['fail', $thirdParty['sdk'][0], ['problems' => $thirdParty['sdk']]]),
            $this->check('backend_extension_api', true, fn (): array => $thirdParty['php'] === []
                ? ['pass', 'Installed extensions support this PHP version.', []]
                : ['fail', $thirdParty['php'][0], ['problems' => $thirdParty['php']]]),
            $this->check('php_version', true, function () use ($release): array {
                $constraint = $release->phpConstraint();
                if ($constraint === null) {
                    return ['fail', 'The release does not state which PHP versions it supports.', []];
                }

                return Semver::satisfies(PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION.'.'.PHP_RELEASE_VERSION, $constraint)
                    ? ['pass', 'PHP '.PHP_VERSION.' satisfies '.$constraint.'.', []]
                    : ['fail', 'The release needs PHP '.$constraint.'; this server runs '.PHP_VERSION.'.', []];
            }),
            $this->check('node_runtime', $release->nodeRuntimeRequired(), function () use ($release): array {
                if (! $release->nodeRuntimeRequired()) {
                    return ['skip', 'The release ships built assets; Node is not needed.', []];
                }

                return (new ExecutableFinder)->find('node') !== null ? ['pass', 'Node is installed.', []] : ['fail', 'The release needs Node on this server and it was not found.', []];
            }),
            $this->check('database_version', true, fn (): array => $this->databaseVersion($release)),
            $this->check('database_connectivity', true, function (): array {
                DB::select('select 1');
                $this->processes->find(config('gobia_updater.mysqldump'), ['mariadb-dump', 'mysqldump']);
                $this->processes->find(config('gobia_updater.mysql'), ['mariadb', 'mysql']);

                return ['pass', 'Connected; the dump and restore clients are installed.', []];
            }),
            $this->check('redis', $this->usesRedis(), function (): array {
                if (! $this->usesRedis()) {
                    return ['skip', 'Redis is not used by this installation.', []];
                }
                Redis::connection()->ping();

                return ['pass', 'Redis answers.', []];
            }),
            $this->check('pending_migrations', true, function () use ($pendingNow, $toRun): array {
                if ($pendingNow === null || $toRun === null) {
                    return ['fail', 'The migration state of this installation cannot be read.', []];
                }
                if ($pendingNow !== []) {
                    return ['fail', count($pendingNow).' migrations of the installed version have not run. Run "php artisan migrate" first.', ['pending' => array_slice($pendingNow, 0, 20)]];
                }

                return ['pass', 'Nothing pending now; the release adds '.count($toRun).'.', ['adds' => array_slice($toRun, 0, 50)]];
            }),
            $this->check('disk_space', true, fn (): array => $this->diskSpace($release)),
            $this->check('permissions', true, function (): array {
                $problems = $this->runner->problems();
                $state = $this->store->path('');
                if (! is_dir($state) || ! is_writable($state)) {
                    $problems[] = 'The updater state directory is not writable.';
                }

                return $problems === [] ? ['pass', 'The '.$this->runner->name().' updater can write where it needs to.', []] : ['fail', $problems[0], ['problems' => $problems]];
            }),
            $this->check('wings_connectivity', false, fn (): array => $this->wings()),
            $this->check('queue_health', false, fn (): array => $this->queue()),
            $this->check('panel_health', true, function () use ($duringRun): array {
                if (! $duringRun && $this->store->active() !== null) {
                    return ['fail', 'Another update is running.', []];
                }
                if (! $duringRun && app()->isDownForMaintenance()) {
                    return ['fail', 'The Panel is in maintenance mode.', []];
                }
                Cache::put('gobia:health', 1, 5);
                if (Cache::get('gobia:health') !== 1) {
                    return ['fail', 'The cache store does not keep values.', []];
                }
                foreach ([storage_path('framework'), storage_path('logs'), base_path('bootstrap/cache')] as $directory) {
                    if (! is_writable($directory)) {
                        return ['fail', basename($directory).' is not writable.', []];
                    }
                }

                return ['pass', 'Database, cache and storage are healthy.', []];
            }),
            $this->check('release_signature', true, function () use ($release): array {
                $this->verifier->verifySignature($release);

                return $release->signature() === null
                    ? ['warn', 'Unsigned release accepted because GOBIA_UPDATE_ALLOW_UNSIGNED is on. Never use this in production.', []]
                    : ['pass', 'Signed by the trusted Gobia release key.', []];
            }),
            $this->check('release_checksum', true, function () use ($release): array {
                $this->verifier->verifyChecksumFormat($release);

                return ['pass', 'SHA-256 '.substr($release->sha256(), 0, 12).'... is covered by the signature and checked against the download before anything is unpacked.', ['sha256' => $release->sha256(), 'size' => $release->size()]];
            }),
            $this->check('upgrade_path', true, function () use ($current, $release): array {
                $minimum = $release->minUpgradeFrom();
                if ($minimum === null) {
                    return ['pass', 'A direct upgrade from '.$current.' is allowed.', []];
                }
                if (! VersionComparator::isValid($minimum) || ! VersionComparator::isValid($current)) {
                    return ['fail', 'The upgrade path cannot be determined.', []];
                }

                return VersionComparator::compare($current, $minimum) >= 0
                    ? ['pass', 'A direct upgrade from '.$current.' is allowed (minimum '.$minimum.').', []]
                    : ['fail', 'Upgrade to '.$minimum.' first; '.$release->version().' cannot be installed directly over '.$current.'.', ['minimum' => $minimum]];
            }),
        ];

        $ready = true;
        foreach ($checks as $check) {
            if ($check['required'] && ! in_array($check['status'], ['pass', 'warn'], true)) {
                $ready = false;
            }
        }
        // A warning never blocks, but the frontend treats a required check that is not "pass" as failing.
        foreach ($checks as $index => $check) {
            if ($check['status'] === 'warn') {
                $checks[$index]['required'] = false;
            }
        }

        $pending = $toRun === null ? -1 : count($toRun);

        return [
            'ready' => $ready,
            'target' => $release->version(),
            'checks' => $checks,
            'extensions' => $extensions,
            'migrations' => [
                'pending' => $pending,
                'destructive' => $release->destructive(),
                'rollback' => $pending !== 0 ? 'requires-db-restore' : 'file-only',
            ],
        ];
    }

    /**
     * @param  callable(): array{0: string, 1: string, 2: array<string, mixed>}  $test
     * @return array{id: string, required: bool, status: string, message: string, detail: array<string, mixed>}
     */
    private function check(string $id, bool $required, callable $test): array
    {
        try {
            [$status, $message, $detail] = $test();
        } catch (Throwable $exception) {
            [$status, $message, $detail] = ['fail', Redactor::scrub($exception->getMessage()), []];
        }

        return ['id' => $id, 'required' => $required, 'status' => $status, 'message' => $message, 'detail' => $detail];
    }

    /** @return array{0: string, 1: string, 2: array<string, mixed>} */
    private function gobiaVersion(string $current, ReleaseInfo $release): array
    {
        if (! VersionComparator::isValid($current)) {
            return ['fail', 'The installed Gobia version ("'.$current.'") is not a release version.', []];
        }

        return VersionComparator::isNewer($release->version(), $current)
            ? ['pass', $current.' to '.$release->version().'.', []]
            : ['fail', $release->version().' is not newer than the installed '.$current.'.', []];
    }

    /** @return array{0: string, 1: string, 2: array<string, mixed>} */
    private function databaseVersion(ReleaseInfo $release): array
    {
        $server = $this->report->databaseServer();
        $raw = (string) $server['version'];
        if (preg_match('/^(\d+\.\d+(?:\.\d+)?)/', $raw, $match) !== 1) {
            return ['fail', 'The database server version cannot be read.', []];
        }

        $family = str_contains(strtolower($raw), 'mariadb') ? 'mariadb' : 'mysql';
        foreach ($release->databaseServers() as $requirement) {
            if (preg_match('/^(mariadb|mysql)\s*(>=?|<=?|=)?\s*([\d.]+)$/i', $requirement, $parts) === 1 && strtolower($parts[1]) === $family) {
                return version_compare($match[1], $parts[3], $parts[2] === '' ? '>=' : $parts[2])
                    ? ['pass', ucfirst($family).' '.$match[1].' satisfies '.$requirement.'.', []]
                    : ['fail', 'The release needs '.$requirement.'; this server runs '.$family.' '.$match[1].'.', []];
            }
        }

        return $release->databaseServers() === []
            ? ['pass', ucfirst($family).' '.$match[1].'; the release states no requirement.', []]
            : ['fail', 'The release does not support '.$family.'.', ['supported' => $release->databaseServers()]];
    }

    /** @return array{0: string, 1: string, 2: array<string, mixed>} */
    private function diskSpace(ReleaseInfo $release): array
    {
        $database = 0;
        try {
            $database = (int) (DB::selectOne('select coalesce(sum(data_length + index_length), 0) as bytes from information_schema.tables where table_schema = database()')->bytes ?? 0);
        } catch (Throwable) {
            // Without the size the estimate only covers the package.
        }

        // Download, unpacked copy (about four times the archive) and a database dump.
        $needed = $release->size() * 6 + $database * 2 + self::DISK_HEADROOM;
        $free = min(array_filter([@disk_free_space($this->store->path('')), @disk_free_space(base_path())], is_float(...)) ?: [0.0]);

        $detail = ['needed_bytes' => $needed, 'free_bytes' => (int) $free];

        return $free >= $needed
            ? ['pass', $this->megabytes((int) $free).' free, about '.$this->megabytes($needed).' needed.', $detail]
            : ['fail', 'Only '.$this->megabytes((int) $free).' free; the update needs about '.$this->megabytes($needed).'.', $detail];
    }

    /** @return array{0: string, 1: string, 2: array<string, mixed>} */
    private function wings(): array
    {
        $nodes = Node::query()->get();
        if ($nodes->isEmpty()) {
            return ['skip', 'No nodes are configured.', []];
        }

        $responses = Http::pool(fn (Pool $pool): array => $nodes->map(
            fn (Node $node) => $pool->as((string) $node->id)->withToken($node->getDecryptedKey())->timeout(4)->connectTimeout(3)->get($node->getConnectionAddress().'/api/system')
        )->all());

        $unreachable = [];
        foreach ($nodes as $node) {
            $response = $responses[(string) $node->id] ?? null;
            if (! $response instanceof \Illuminate\Http\Client\Response || ! $response->successful()) {
                $unreachable[] = $node->name;
            }
        }

        // Servers keep running on Wings while the Panel updates, so an unreachable node is a warning, not a blocker.
        return $unreachable === []
            ? ['pass', 'All '.$nodes->count().' nodes answer.', []]
            : ['warn', count($unreachable).' of '.$nodes->count().' nodes did not answer: '.implode(', ', array_slice($unreachable, 0, 5)).'.', ['unreachable' => $unreachable]];
    }

    /** @return array{0: string, 1: string, 2: array<string, mixed>} */
    private function queue(): array
    {
        $driver = (string) config('queue.default');
        if ($driver === 'sync') {
            return ['warn', 'The queue runs synchronously; there is no worker to restart.', ['driver' => $driver]];
        }
        if ($driver === 'database' && ! Schema::hasTable((string) config('queue.connections.database.table', 'jobs'))) {
            return ['fail', 'The queue table is missing.', ['driver' => $driver]];
        }
        if ($driver === 'redis') {
            Redis::connection((string) config('queue.connections.redis.connection', 'default'))->ping();
        }

        $failed = Schema::hasTable('failed_jobs') ? DB::table('failed_jobs')->count() : 0;

        return $failed > 0
            ? ['warn', $failed.' failed jobs are waiting in the '.$driver.' queue.', ['driver' => $driver, 'failed' => $failed]]
            : ['pass', 'The '.$driver.' queue is reachable.', ['driver' => $driver]];
    }

    private function usesRedis(): bool
    {
        return in_array('redis', [config('cache.default'), config('queue.default'), config('session.driver')], true);
    }

    /**
     * The Gobia extensions the release ships, compared with what is installed. A release never downgrades one.
     *
     * @return list<array{id: string, current: string|null, required: string, compatible: bool, reason: string|null}>
     */
    private function bundledExtensions(ReleaseInfo $release): array
    {
        $installed = $this->extensions->discovered();
        $rows = [];
        foreach ($release->extensions() as $id => $version) {
            $current = $installed->get($id)?->version;
            $downgrade = $current !== null && version_compare($version, $current, '<');
            $rows[] = [
                'id' => $id,
                'current' => $current,
                'required' => $version,
                'compatible' => ! $downgrade,
                'reason' => $downgrade ? 'The release ships '.$id.' '.$version.', older than the installed '.$current.'.' : null,
            ];
        }

        return $rows;
    }

    /**
     * Enabled extensions that are not part of the release keep running on the new Panel, so their
     * declared requirements are checked against what the release brings.
     *
     * @return array{panel: list<string>, sdk: list<string>, php: list<string>}
     */
    private function thirdPartyProblems(ReleaseInfo $release): array
    {
        $targets = ['panel' => $this->normalise($release->baseVersion()), 'sdk' => $release->sdkVersion(), 'php' => PHP_VERSION];
        $problems = ['panel' => [], 'sdk' => [], 'php' => []];

        foreach ($this->extensions->configuredEnabled() as $manifest) {
            if (isset($release->extensions()[$manifest->id])) {
                continue;
            }

            foreach ($manifest->requirements as $runtime => $constraint) {
                $target = $targets[$runtime] ?? null;
                if ($target === null) {
                    continue;
                }

                try {
                    $satisfied = Semver::satisfies($target, $constraint);
                } catch (Throwable) {
                    $satisfied = false;
                }
                if (! $satisfied) {
                    $problems[$runtime][] = sprintf('Extension "%s" requires %s %s; the release brings %s. Update or disable it first.', $manifest->id, $runtime, $constraint, $target);
                }
            }
        }

        return $problems;
    }

    /** Same rule as config/extensions.php: an unversioned development build counts as 2.0.0-dev. */
    private function normalise(string $version): ?string
    {
        if ($version === 'canary') {
            return '2.0.0-dev';
        }

        return $version === 'unknown' || $version === '' ? null : $version;
    }

    private function megabytes(int $bytes): string
    {
        return number_format($bytes / 1048576, 0, '.', ' ').' MiB';
    }
}
