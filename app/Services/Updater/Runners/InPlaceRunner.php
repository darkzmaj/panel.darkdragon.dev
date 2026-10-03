<?php

namespace Pterodactyl\Services\Updater\Runners;

use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\ProcessRunner;
use Symfony\Component\Process\PhpExecutableFinder;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * Swaps code directories inside a single installation. Used for the Windows development setup,
 * where symlinks need elevated rights. Each top level entry is renamed (never copied) so the
 * swap is quick, and the previous entries are kept in the backup directory for rollback.
 *
 * `storage` and `.env` are never touched, so avatars, branding, logs and configuration survive.
 */
class InPlaceRunner implements DeploymentRunner
{
    use RunsArtisan;

    /**
     * Top level entries that belong to the installation rather than to a release.
     */
    private const PRESERVED = ['storage', '.env', '.git', 'node_modules'];

    public function __construct(ProcessRunner $processes, private ?string $base = null)
    {
        $this->processes = $processes;
        $this->base = rtrim(str_replace('\\', '/', $base ?? base_path()), '/');
    }

    public function name(): string
    {
        return 'in-place';
    }

    protected function liveTree(): string
    {
        return $this->base;
    }

    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void
    {
        $previous = $backupDir . '/previous';
        @mkdir($previous, 0750, true);
        $journal = [];

        $entries = array_diff(scandir($stagedPath), ['.', '..']);
        foreach ($entries as $name) {
            if (in_array($name, self::PRESERVED, true)) {
                continue;
            }

            $live = $this->base . '/' . $name;
            try {
                if (file_exists($live)) {
                    $this->move($live, $previous . '/' . $name);
                    $journal[] = ['name' => $name, 'had_previous' => true];
                } else {
                    $journal[] = ['name' => $name, 'had_previous' => false];
                }
                file_put_contents($backupDir . '/journal.json', json_encode($journal));
                $this->move($stagedPath . '/' . $name, $live);
            } catch (\Throwable $exception) {
                throw new UpdateException('Installing "' . $name . '" failed: ' . $exception->getMessage());
            }
        }
    }

    public function restoreFiles(string $backupDir): void
    {
        $file = $backupDir . '/journal.json';
        if (!is_file($file)) {
            return;
        }

        $journal = json_decode((string) file_get_contents($file), true) ?: [];
        foreach (array_reverse($journal) as $entry) {
            $name = $entry['name'];
            $live = $this->base . '/' . $name;
            $kept = $backupDir . '/previous/' . $name;

            if (file_exists($live)) {
                $this->move($live, $backupDir . '/discarded/' . $name);
            }
            if ($entry['had_previous'] && file_exists($kept)) {
                $this->move($kept, $live);
            }
        }

        @unlink($file);
    }

    public function restartWorkers(): void
    {
        $this->artisan('queue:restart');

        // There is no process supervisor on a development machine, so start the replacement worker ourselves.
        if (config('gobia.update.spawn_queue_worker')) {
            $php = (new PhpExecutableFinder())->find() ?: 'php';
            $command = PHP_OS_FAMILY === 'Windows'
                ? 'start /B "" ' . escapeshellarg($php) . ' artisan queue:work --queue=high,standard,low --sleep=3 > NUL 2>&1'
                : 'nohup ' . escapeshellarg($php) . ' artisan queue:work --queue=high,standard,low --sleep=3 > /dev/null 2>&1 &';

            $cwd = getcwd();
            chdir($this->base);
            pclose(popen($command, 'r'));
            chdir($cwd);
        }
    }

    private function move(string $from, string $to): void
    {
        @mkdir(dirname($to), 0750, true);
        if (!@rename($from, $to)) {
            throw new \RuntimeException('could not move "' . basename($from) . '" (is a file in it in use?)');
        }
    }
}
