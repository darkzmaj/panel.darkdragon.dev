<?php

namespace Pterodactyl\Services\Updater\Runners;

use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\ProcessResult;

/**
 * The platform specific half of an update: how verified code is put in place, how it is undone,
 * and how the application is poked afterwards. Everything else (download, verification, backups,
 * ordering, rollback decisions) is shared and lives in the orchestrator.
 */
interface DeploymentRunner
{
    public function name(): string;

    /**
     * Puts the unpacked release live. $backupDir receives whatever is needed to undo this later.
     *
     * @throws \Pterodactyl\Services\Updater\Exceptions\UpdateException
     */
    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void;

    /**
     * Restores the files that were live before {@see install()} ran.
     *
     * @throws \Pterodactyl\Services\Updater\Exceptions\UpdateException
     */
    public function restoreFiles(string $backupDir): void;

    /**
     * Runs one of a small, fixed set of artisan commands inside the live tree.
     *
     * @param string[] $options only plain "--flag" or "--flag=value" options are accepted
     */
    public function artisan(string $command, array $options = []): ProcessResult;

    /**
     * Makes long-running processes (queue workers, PHP opcache) pick up the new code.
     */
    public function restartWorkers(): void;
}
