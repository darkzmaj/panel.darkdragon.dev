<?php

declare(strict_types=1);

namespace GobiaCore\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Services\Extensions\ExtensionCompatibility;
use Pterodactyl\Services\Extensions\ExtensionRepository;
use Throwable;

/**
 * Read only description of this installation for the Gobia updater's preflight: versions, extensions and whether
 * they are compatible with this panel, pending migrations and basic health. It performs no privileged action.
 */
class CompatibilityReport
{
    public function __construct(private readonly ExtensionRepository $extensions, private readonly ExtensionCompatibility $compatibility) {}

    /** @return array<string, mixed> the contents of gobia-release.json, or sensible defaults when it is missing */
    public function release(): array
    {
        $path = base_path('gobia-release.json');
        $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;

        return is_array($data) ? $data : ['gobia_version' => 'unknown', 'pterodactyl_base' => ['commit' => null]];
    }

    /** @return array<string, mixed> */
    public function build(): array
    {
        $release = $this->release();
        $enabled = $this->extensions->enabled();
        $resolved = $this->compatibility->resolve($enabled);

        $extensions = $this->extensions->discovered()->map(fn ($manifest): array => [
            'id' => $manifest->id,
            'name' => $manifest->name,
            'version' => $manifest->version,
            'enabled' => $enabled->has($manifest->id),
            'requires' => $manifest->requirements,
            'depends_on' => $manifest->requiredExtensions,
            'compatible' => ! isset($resolved['errors'][$manifest->id]),
            'reason' => $resolved['errors'][$manifest->id] ?? null,
        ])->values()->all();

        return [
            'gobia_version' => $release['gobia_version'] ?? 'unknown',
            'pterodactyl_base' => ['version' => config('app.version'), 'commit' => $release['pterodactyl_base']['commit'] ?? null],
            'php' => PHP_VERSION,
            'database' => $this->database(),
            'extensions' => $extensions,
            'migrations' => $this->migrations(),
            'health' => $this->health(),
            'release' => ['min_upgrade_from' => $release['min_upgrade_from'] ?? null, 'security_update' => (bool) ($release['security_update'] ?? false)],
        ];
    }

    /** @return array{driver: string, version: string|null} */
    private function database(): array
    {
        try {
            $version = DB::selectOne('select version() as v')->v ?? null;
        } catch (Throwable) {
            $version = null;
        }

        return ['driver' => (string) DB::getDriverName(), 'version' => is_string($version) ? $version : null];
    }

    /** @return list<string>|null names of the migrations this installation has on disk but has not run; null when that cannot be read */
    public function pendingMigrations(): ?array
    {
        try {
            $migrator = app('migrator');
            $files = $migrator->getMigrationFiles([...$migrator->paths(), database_path('migrations')]);

            return array_values(array_diff(array_keys($files), $migrator->getRepository()->getRan()));
        } catch (Throwable) {
            return null;
        }
    }

    /** @return list<string>|null names of every migration recorded as run; null when that cannot be read */
    public function ranMigrations(): ?array
    {
        try {
            return array_values(app('migrator')->getRepository()->getRan());
        } catch (Throwable) {
            return null;
        }
    }

    /** @return array{driver: string, version: string|null} */
    public function databaseServer(): array
    {
        return $this->database();
    }

    /** @return array{pending: int, ran: int} */
    private function migrations(): array
    {
        $pending = $this->pendingMigrations();
        $ran = $this->ranMigrations();

        return $pending === null || $ran === null ? ['pending' => -1, 'ran' => -1] : ['pending' => count($pending), 'ran' => count($ran)];
    }

    /** @return array{database: bool, cache: bool, queue: string} */
    private function health(): array
    {
        $database = true;
        try {
            DB::select('select 1');
        } catch (Throwable) {
            $database = false;
        }

        $cache = false;
        try {
            Cache::put('gobia:health', 1, 5);
            $cache = Cache::get('gobia:health') === 1;
        } catch (Throwable) {
            $cache = false;
        }

        return ['database' => $database, 'cache' => $cache, 'queue' => (string) config('queue.default')];
    }
}
