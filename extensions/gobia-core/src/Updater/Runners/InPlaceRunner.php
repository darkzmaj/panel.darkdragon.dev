<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Runners;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\ProcessRunner;
use GobiaCore\Updater\ReleaseInfo;
use RuntimeException;
use Throwable;

/**
 * Swaps code directories inside a single installation: the standard layout where the web server
 * serves <panel>/public directly. Each top level entry is renamed (never copied) so the swap is quick,
 * and the previous entries are kept in the backup directory for rollback. It needs no root: the Panel
 * user already owns these files.
 *
 * `.env` and `storage` are never touched, so configuration, uploads, logs and updater state survive.
 * Extensions and themes that were installed locally are copied back into the new tree.
 */
class InPlaceRunner implements DeploymentRunner
{
    use RunsArtisan;

    /** Top level entries that belong to the installation rather than to a release. */
    private const array PRESERVED = ['storage', '.env', '.git', 'node_modules'];

    /** Swapped child by child: a running web server keeps the document root open, which stops Windows renaming it. */
    private const array SWAPPED_BY_CONTENT = ['public'];

    private readonly string $base;

    public function __construct(ProcessRunner $processes, ?string $base = null, private readonly ?string $helper = null)
    {
        $this->processes = $processes;
        $this->base = rtrim(str_replace('\\', '/', $base ?? base_path()), '/');
    }

    public function name(): string
    {
        return 'in-place';
    }

    public function liveTree(): string
    {
        return $this->base;
    }

    public function problems(): array
    {
        $problems = [];
        if (! is_writable($this->base)) {
            $problems[] = 'The Panel directory is not writable by the PHP user.';
        }

        foreach (['app', 'bootstrap', 'config', 'database', 'extensions', 'public', 'resources', 'routes', 'vendor'] as $name) {
            $path = $this->base.'/'.$name;
            if (is_link($path)) {
                $problems[] = $name.' is a symbolic link; the in-place updater only replaces real directories.';
            } elseif (file_exists($path) && ! is_writable($path)) {
                $problems[] = $name.' is not writable by the PHP user.';
            }
        }

        return $problems;
    }

    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void
    {
        $previous = $backupDir.'/previous';
        @mkdir($previous, 0750, true);
        $journal = [];

        foreach ($this->entries($stagedPath) as $name) {
            $live = $this->base.'/'.$name;
            try {
                $journal[] = ['name' => $name, 'had_previous' => file_exists($live)];
                file_put_contents($backupDir.'/journal.json', json_encode($journal));
                if (file_exists($live)) {
                    $this->move($live, $previous.'/'.$name);
                }
                $this->move($stagedPath.'/'.$name, $live);
            } catch (Throwable $exception) {
                throw new UpdateException('Installing "'.$name.'" failed: '.$exception->getMessage());
            }
        }

        $this->carryOver($previous, $this->base);
    }

    public function restoreFiles(string $backupDir): void
    {
        $file = $backupDir.'/journal.json';
        if (! is_file($file)) {
            return;
        }

        $journal = json_decode((string) file_get_contents($file), true) ?: [];
        foreach (array_reverse($journal) as $entry) {
            $name = (string) $entry['name'];
            $live = $this->base.'/'.$name;
            $kept = $backupDir.'/previous/'.$name;

            // An entry whose swap never got as far as moving the old one away is still the old one.
            if ($entry['had_previous'] && ! file_exists($kept)) {
                continue;
            }
            if (file_exists($live)) {
                $this->move($live, $backupDir.'/discarded/'.$name);
            }
            if ($entry['had_previous']) {
                $this->move($kept, $live);
            }
        }

        @unlink($file);
    }

    public function restartWorkers(): void
    {
        $this->artisan('queue:restart');

        // Optional in this layout: with the helper installed and allowed through sudo, PHP-FPM and companion
        // services are restarted too. A helper that is present but not usable is skipped, not an error.
        if ($this->helper !== null && $this->helper !== '' && is_file($this->helper) && $this->helper($this->helper, 'check')->successful()) {
            $result = $this->helper($this->helper, 'restart-services');
            if (! $result->successful()) {
                throw new UpdateException('The update helper refused or failed "restart-services": '.trim($result->error));
            }
        }

        // There is no process supervisor on a development machine, so start the replacement worker ourselves.
        if (config('gobia_updater.spawn_queue_worker')) {
            $command = PHP_OS_FAMILY === 'Windows'
                ? 'start /B "" '.escapeshellarg(ProcessRunner::php()).' artisan queue:work --queue=high,standard,low --sleep=3 > NUL 2>&1'
                : 'nohup '.escapeshellarg(ProcessRunner::php()).' artisan queue:work --queue=high,standard,low --sleep=3 > /dev/null 2>&1 &';

            $cwd = (string) getcwd();
            chdir($this->base);
            pclose(popen($command, 'r'));
            chdir($cwd);
        }
    }

    /**
     * The paths to swap, relative to the installation.
     *
     * @return list<string>
     */
    private function entries(string $stagedPath): array
    {
        $entries = [];
        foreach (array_diff(scandir($stagedPath) ?: [], ['.', '..']) as $name) {
            if (in_array($name, self::PRESERVED, true)) {
                continue;
            }

            if (in_array($name, self::SWAPPED_BY_CONTENT, true) && is_dir($stagedPath.'/'.$name)) {
                foreach (array_diff(scandir($stagedPath.'/'.$name) ?: [], ['.', '..']) as $child) {
                    $entries[] = $name.'/'.$child;
                }

                continue;
            }

            $entries[] = $name;
        }

        return $entries;
    }

    private function move(string $from, string $to): void
    {
        @mkdir(dirname($to), 0750, true);
        if (! @rename($from, $to)) {
            throw new RuntimeException('could not move "'.basename($from).'" (is a file in it in use, or is it on another filesystem?)');
        }
    }
}
