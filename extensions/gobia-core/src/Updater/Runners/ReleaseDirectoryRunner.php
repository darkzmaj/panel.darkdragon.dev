<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Runners;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\ProcessRunner;
use GobiaCore\Updater\ReleaseInfo;
use GobiaCore\Updater\VersionComparator;

/**
 * Hardened production layout:
 *
 *   <root>/releases/<version>/   one directory per release, never modified after install
 *   <root>/shared/.env           configuration, linked into every release
 *   <root>/shared/storage/       uploads, logs, updater state, linked into every release
 *   <root>/current -> releases/<version>
 *
 * Switching releases is a single atomic symlink replacement, so a rollback is the same operation in reverse.
 * The only privileged operations (switching the symlink, restarting services) go through a root owned helper
 * that accepts a fixed set of verbs, see deploy/linux/gobia-update-helper.
 */
class ReleaseDirectoryRunner implements DeploymentRunner
{
    use RunsArtisan;

    private readonly string $root;

    public function __construct(ProcessRunner $processes, string $root, private readonly string $helper)
    {
        $this->processes = $processes;
        $this->root = rtrim(str_replace('\\', '/', $root), '/');
    }

    public function name(): string
    {
        return 'release-directory';
    }

    public function liveTree(): string
    {
        return $this->root.'/current';
    }

    public function problems(): array
    {
        $problems = [];
        if (! is_link($this->root.'/current')) {
            $problems[] = 'GOBIA_UPDATE_INSTALL_ROOT has no "current" symbolic link.';
        }
        if (! is_dir($this->root.'/releases') || ! is_writable($this->root.'/releases')) {
            $problems[] = 'The releases directory is missing or not writable by the PHP user.';
        }
        if (! is_file($this->root.'/shared/.env') || ! is_dir($this->root.'/shared/storage')) {
            $problems[] = 'shared/.env or shared/storage is missing.';
        }
        if (! is_file($this->helper)) {
            $problems[] = 'The update helper is not installed at '.$this->helper.'.';
        } elseif (! $this->helper($this->helper, 'check')->successful()) {
            $problems[] = 'The PHP user may not run the update helper through sudo, or its configuration is invalid.';
        }

        return $problems;
    }

    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void
    {
        if (! VersionComparator::isValid($release->version())) {
            throw new UpdateException('Invalid release version.');
        }

        $target = $this->root.'/releases/'.$release->version();
        if (file_exists($target)) {
            throw new UpdateException('Release '.$release->version().' is already installed on disk.');
        }

        $previous = is_link($this->root.'/current') ? basename((string) readlink($this->root.'/current')) : null;
        @mkdir($backupDir, 0750, true);
        file_put_contents($backupDir.'/previous-release.json', json_encode(['version' => $previous, 'installed' => $release->version()]));

        if (! @rename($stagedPath, $target)) {
            throw new UpdateException('The release could not be moved into the releases directory.');
        }

        foreach (['.env' => '../../shared/.env', 'storage' => '../../shared/storage'] as $name => $link) {
            @unlink($target.'/'.$name);
            if (! @symlink($link, $target.'/'.$name)) {
                throw new UpdateException('Could not link shared "'.$name.'" into the new release.');
            }
        }

        if ($previous !== null && is_dir($this->root.'/releases/'.$previous)) {
            $this->carryOver($this->root.'/releases/'.$previous, $target);
        }

        $this->activate($release->version());
    }

    public function restoreFiles(string $backupDir): void
    {
        $file = $backupDir.'/previous-release.json';
        $previous = is_file($file) ? (json_decode((string) file_get_contents($file), true)['version'] ?? null) : null;

        if (is_string($previous) && VersionComparator::isValid($previous)) {
            $this->activate($previous);
        }
    }

    public function restartWorkers(): void
    {
        $this->artisan('queue:restart');
        $result = $this->helper($this->helper, 'restart-services');
        if (! $result->successful()) {
            throw new UpdateException('The update helper refused or failed "restart-services": '.trim($result->error));
        }
    }

    private function activate(string $version): void
    {
        $result = $this->helper($this->helper, 'activate', $version);
        if (! $result->successful()) {
            throw new UpdateException('The update helper refused or failed "activate": '.trim($result->error));
        }
    }
}
