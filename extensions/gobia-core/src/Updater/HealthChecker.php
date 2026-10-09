<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use GobiaCore\Services\CompatibilityReport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use Pterodactyl\Services\Extensions\ExtensionRepository;
use Throwable;

/**
 * Inspects the application from the inside. It runs in the freshly installed code via
 * `php artisan gobia-core:update:health`, so passing means the new release really boots.
 */
class HealthChecker
{
    public function __construct(private readonly CompatibilityReport $report, private readonly ExtensionRepository $extensions) {}

    /**
     * @return array{ok: bool, checks: list<array{name: string, ok: bool, detail: string}>}
     */
    public function run(string $expectedVersion): array
    {
        $checks = [];
        $add = function (string $name, callable $test) use (&$checks): void {
            try {
                [$ok, $detail] = $test();
            } catch (Throwable $exception) {
                [$ok, $detail] = [false, Redactor::scrub($exception->getMessage())];
            }
            $checks[] = ['name' => $name, 'ok' => $ok, 'detail' => $detail];
        };

        $add('version', function () use ($expectedVersion): array {
            $installed = (string) ($this->report->release()['gobia_version'] ?? 'unknown');

            return [$installed === $expectedVersion, 'installed: '.$installed.', expected: '.$expectedVersion];
        });

        $add('database', function (): array {
            DB::select('select 1');

            return [true, 'connected'];
        });

        $add('migrations', function (): array {
            $pending = $this->report->pendingMigrations();

            return [$pending === [], $pending === null ? 'could not be read' : count($pending).' pending'];
        });

        $add('storage', function (): array {
            foreach ([storage_path('framework'), storage_path('app'), storage_path('logs'), base_path('bootstrap/cache')] as $dir) {
                if (! is_dir($dir) || ! is_writable($dir)) {
                    return [false, $dir.' is not writable'];
                }
            }

            return [true, 'writable'];
        });

        $add('assets', function (): array {
            $manifest = json_decode((string) @file_get_contents(public_path('assets/manifest.json')), true);

            return [is_array($manifest) && $manifest !== [], 'frontend manifest '.(is_array($manifest) ? 'present' : 'missing')];
        });

        $add('extensions', function (): array {
            $failed = [];
            foreach ($this->extensions->records() as $record) {
                if ($record->enabled && $record->error !== null && str_starts_with($record->identifier, 'gobia-')) {
                    $failed[] = $record->identifier;
                }
            }
            $missing = array_diff(['gobia-core'], $this->extensions->enabled()->keys()->all());

            return [$failed === [] && $missing === [], $failed === [] && $missing === [] ? 'Gobia extensions loaded' : 'not loaded: '.implode(', ', [...$failed, ...$missing])];
        });

        $add('queue', function (): array {
            $default = (string) config('queue.default');
            if ($default === 'database') {
                return [Schema::hasTable((string) config('queue.connections.database.table', 'jobs')), 'database queue'];
            }
            if ($default === 'redis') {
                Redis::connection((string) config('queue.connections.redis.connection', 'default'))->ping();
            }

            return [true, $default.' queue'];
        });

        return ['ok' => collect($checks)->every(fn (array $check): bool => $check['ok']), 'checks' => $checks];
    }
}
