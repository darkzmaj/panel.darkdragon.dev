<?php

declare(strict_types=1);

namespace GobiaCore\Updater\Runners;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\ProcessResult;
use GobiaCore\Updater\ProcessRunner;
use GobiaCore\Updater\VersionComparator;

trait RunsArtisan
{
    /** The complete list of commands the updater may run. There is no way to run anything else. */
    private const array ARTISAN_COMMANDS = [
        'down', 'up', 'migrate', 'view:clear', 'view:cache', 'route:cache', 'route:clear',
        'event:cache', 'event:clear', 'queue:restart',
        'gobia-core:update:health', 'gobia-core:update:finalize',
    ];

    private ProcessRunner $processes;

    abstract public function liveTree(): string;

    public function artisan(string $command, array $arguments = []): ProcessResult
    {
        if (! in_array($command, self::ARTISAN_COMMANDS, true)) {
            throw new UpdateException('That command is not permitted for the updater.');
        }

        foreach ($arguments as $argument) {
            if (! is_string($argument) || preg_match('/^(--[a-z][a-z-]*(=[A-Za-z0-9._:\/-]+)?|[a-z0-9][a-z0-9-]{0,62})$/D', $argument) !== 1) {
                throw new UpdateException('An invalid command argument was rejected.');
            }
        }

        return $this->processes->run([ProcessRunner::php(), 'artisan', $command, '--no-interaction', '--no-ansi', ...$arguments], $this->liveTree(), [], 900);
    }

    /**
     * Copies what the installation added itself (extensions and themes that are not part of the release)
     * from the previous tree into the new one, so an update never removes them.
     */
    private function carryOver(string $previousTree, string $newTree): void
    {
        foreach (['extensions', 'themes'] as $kind) {
            foreach (is_dir($previousTree.'/'.$kind) ? (scandir($previousTree.'/'.$kind) ?: []) : [] as $name) {
                $from = $previousTree.'/'.$kind.'/'.$name;
                $to = $newTree.'/'.$kind.'/'.$name;
                if (str_starts_with($name, '.') || is_link($from) || file_exists($to)) {
                    continue;
                }

                $this->copyTree($from, $to);
            }
        }
    }

    private function copyTree(string $from, string $to): void
    {
        if (is_link($from)) {
            return;
        }

        if (is_file($from)) {
            if (! is_dir(dirname($to))) {
                @mkdir(dirname($to), 0755, true);
            }
            if (! @copy($from, $to)) {
                throw new UpdateException('Could not carry over "'.basename($from).'" into the new release.');
            }

            return;
        }

        if (! is_dir($to) && ! @mkdir($to, 0755, true)) {
            throw new UpdateException('Could not carry over "'.basename($from).'" into the new release.');
        }

        foreach (scandir($from) ?: [] as $name) {
            // Dependencies and repository data of a development checkout are not part of an installed extension.
            if ($name === '.' || $name === '..' || $name === 'node_modules' || $name === '.git') {
                continue;
            }
            $this->copyTree($from.'/'.$name, $to.'/'.$name);
        }
    }

    /** Calls the root owned helper through sudo. The verb comes from a fixed list and the only argument is a validated version. */
    private function helper(string $helper, string $verb, ?string $version = null): ProcessResult
    {
        if (! in_array($verb, ['check', 'activate', 'restart-services'], true) || ($version !== null && ! VersionComparator::isValid($version))) {
            throw new UpdateException('Invalid helper request.');
        }

        return $this->processes->run(['sudo', '-n', $helper, $verb, ...($version === null ? [] : [$version])], null, [], 120);
    }
}
