<?php

namespace Pterodactyl\Services\Updater\Runners;

use Pterodactyl\Services\Updater\ProcessResult;
use Pterodactyl\Services\Updater\ProcessRunner;
use Symfony\Component\Process\PhpExecutableFinder;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

trait RunsArtisan
{
    /**
     * The complete list of commands the updater may run. There is no way to run anything else.
     */
    private const ARTISAN_COMMANDS = [
        'down', 'up', 'migrate', 'optimize', 'optimize:clear', 'view:cache', 'queue:restart', 'gobia:update:health',
    ];

    private ProcessRunner $processes;

    abstract protected function liveTree(): string;

    public function artisan(string $command, array $options = []): ProcessResult
    {
        if (!in_array($command, self::ARTISAN_COMMANDS, true)) {
            throw new UpdateException('That command is not permitted for the updater.');
        }

        foreach ($options as $option) {
            if (!preg_match('/^--[a-z][a-z-]*(=[A-Za-z0-9._:\/-]+)?$/D', (string) $option)) {
                throw new UpdateException('An invalid command option was rejected.');
            }
        }

        $php = (new PhpExecutableFinder())->find() ?: 'php';

        return $this->processes->run(array_merge([$php, 'artisan', $command, '--no-interaction'], $options), $this->liveTree(), [], 900);
    }
}
