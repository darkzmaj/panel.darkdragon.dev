<?php

namespace Pterodactyl\Services\Updater;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Migrations\Migrator;

/**
 * Inspects the application from the inside. It runs in the freshly installed code via
 * `php artisan gobia:update:health`, so passing means the new release really boots.
 */
class HealthChecker
{
    public function __construct(private Migrator $migrator)
    {
    }

    /**
     * @return array{ok: bool, checks: array<int, array{name: string, ok: bool, detail: string}>}
     */
    public function run(string $expectedVersion): array
    {
        $checks = [];
        $add = function (string $name, callable $test) use (&$checks) {
            try {
                [$ok, $detail] = $test();
            } catch (\Throwable $exception) {
                [$ok, $detail] = [false, Redactor::scrub($exception->getMessage())];
            }
            $checks[] = ['name' => $name, 'ok' => $ok, 'detail' => $detail];
        };

        $add('version', function () use ($expectedVersion) {
            $file = trim((string) @file_get_contents(base_path('VERSION')));
            $config = (string) config('app.version');

            return [
                $file === $expectedVersion && $config === $expectedVersion,
                'files: ' . $file . ', config: ' . $config . ', expected: ' . $expectedVersion,
            ];
        });

        $add('database', function () {
            DB::select('select 1');

            return [true, 'connected'];
        });

        $add('migrations', function () {
            $files = $this->migrator->getMigrationFiles(array_merge($this->migrator->paths(), [database_path('migrations')]));
            $pending = array_diff(array_keys($files), $this->migrator->getRepository()->getRan());

            return [count($pending) === 0, count($pending) . ' pending'];
        });

        $add('storage', function () {
            foreach ([storage_path('framework'), storage_path('app/private'), storage_path('logs')] as $dir) {
                if (!is_dir($dir) || !is_writable($dir)) {
                    return [false, $dir . ' is not writable'];
                }
            }

            return [true, 'writable'];
        });

        $add('assets', function () {
            $manifest = json_decode((string) @file_get_contents(public_path('assets/manifest.json')), true);

            return [is_array($manifest) && count($manifest) > 0, 'frontend manifest ' . (is_array($manifest) ? 'present' : 'missing')];
        });

        $add('queue', function () {
            $default = config('queue.default');
            if ($default === 'database') {
                return [Schema::hasTable(config('queue.connections.database.table', 'jobs')), 'database queue'];
            }
            if ($default === 'redis') {
                Redis::connection(config('queue.connections.redis.connection', 'default'))->ping();
            }

            return [true, $default . ' queue'];
        });

        return ['ok' => collect($checks)->every(fn ($check) => $check['ok']), 'checks' => $checks];
    }
}
