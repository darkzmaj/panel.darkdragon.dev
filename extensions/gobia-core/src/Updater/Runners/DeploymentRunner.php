<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Runners;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\ProcessResult;
use GobiaCore\Updater\ReleaseInfo;

/**
 * The platform specific half of an update: how verified code is put in place, how it is undone,
 * and how the application is poked afterwards. Everything else (download, verification, backups,
 * ordering, rollback decisions) is shared and lives in the orchestrator.
 */
interface DeploymentRunner
{
    public function name(): string;

    /** The directory the web server serves the Panel from. */
    public function liveTree(): string;

    /**
     * Problems that would stop {@see install()} from working, for the preflight. Empty when ready.
     *
     * @return list<string>
     */
    public function problems(): array;

    /**
     * Puts the unpacked release live. $backupDir receives whatever is needed to undo this later.
     * Extensions and themes the installation has but the release does not ship are carried over.
     *
     * @throws UpdateException
     */
    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void;

    /**
     * Restores the files that were live before {@see install()} ran.
     *
     * @throws UpdateException
     */
    public function restoreFiles(string $backupDir): void;

    /**
     * Runs one of a small, fixed set of artisan commands inside the live tree.
     *
     * @param  list<string>  $arguments  only "--flag", "--flag=value" or a plain identifier are accepted
     */
    public function artisan(string $command, array $arguments = []): ProcessResult;

    /** Makes long-running processes (queue workers, PHP opcache, companion services) pick up the new code. */
    public function restartWorkers(): void;
}
