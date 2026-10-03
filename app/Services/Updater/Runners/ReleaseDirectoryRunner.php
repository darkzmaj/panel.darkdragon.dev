<?php

namespace Pterodactyl\Services\Updater\Runners;

use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\ProcessRunner;
use Pterodactyl\Services\Updater\VersionComparator;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * Production layout:
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

    private const VERBS = ['activate', 'restart-workers', 'reload-php'];

    private string $root;

    public function __construct(ProcessRunner $processes, string $root, private string $helper)
    {
        $this->processes = $processes;
        $this->root = rtrim(str_replace('\\', '/', $root), '/');
    }

    public function name(): string
    {
        return 'release-directory';
    }

    protected function liveTree(): string
    {
        return $this->root . '/current';
    }

    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void
    {
        if (!VersionComparator::isValid($release->version)) {
            throw new UpdateException('Invalid release version.');
        }

        $target = $this->root . '/releases/' . $release->version;
        if (file_exists($target)) {
            throw new UpdateException('Release ' . $release->version . ' is already installed on disk.');
        }

        $previous = is_link($this->root . '/current') ? basename((string) readlink($this->root . '/current')) : null;
        @mkdir($backupDir, 0750, true);
        file_put_contents($backupDir . '/previous-release.json', json_encode(['version' => $previous]));

        if (!@rename($stagedPath, $target)) {
            throw new UpdateException('The release could not be moved into the releases directory.');
        }

        foreach (['.env' => '../../shared/.env', 'storage' => '../../shared/storage'] as $name => $link) {
            @unlink($target . '/' . $name);
            if (!@symlink($link, $target . '/' . $name)) {
                throw new UpdateException('Could not link shared "' . $name . '" into the new release.');
            }
        }

        $this->helper('activate', $release->version);
    }

    public function restoreFiles(string $backupDir): void
    {
        $file = $backupDir . '/previous-release.json';
        $previous = is_file($file) ? (json_decode((string) file_get_contents($file), true)['version'] ?? null) : null;

        if ($previous !== null && VersionComparator::isValid($previous)) {
            $this->helper('activate', $previous);
        }
    }

    public function restartWorkers(): void
    {
        $this->helper('restart-workers');
        $this->helper('reload-php');
    }

    /**
     * Calls the privileged helper. The verb comes from a fixed list and the only argument is a validated version.
     */
    private function helper(string $verb, ?string $version = null): void
    {
        if (!in_array($verb, self::VERBS, true) || ($version !== null && !VersionComparator::isValid($version))) {
            throw new UpdateException('Invalid helper request.');
        }

        $command = ['sudo', '-n', $this->helper, $verb];
        if ($version !== null) {
            $command[] = $version;
        }

        $result = $this->processes->run($command, null, [], 120);
        if (!$result->successful()) {
            throw new UpdateException('The update helper refused or failed "' . $verb . '": ' . trim($result->error));
        }
    }
}
