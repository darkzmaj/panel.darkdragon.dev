<?php

namespace Pterodactyl\Services\Updater;

use Symfony\Component\Process\Process;
use Symfony\Component\Process\ExecutableFinder;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * The single place the updater starts other programs. Commands are always passed as an argument
 * array (never through a shell) and callers only ever build them from fixed strings and validated values.
 */
class ProcessRunner
{
    /**
     * @param string[] $command
     * @param array<string, string> $env
     * @param resource|string|null $input
     */
    public function run(array $command, ?string $cwd = null, array $env = [], int $timeout = 300, $input = null): ProcessResult
    {
        $process = new Process($command, $cwd, $env === [] ? null : $env + $this->baseEnv(), $input, $timeout);

        try {
            $process->run();
        } catch (\Throwable $exception) {
            throw new UpdateException('A required program could not be run: ' . Redactor::scrub($exception->getMessage()));
        }

        return new ProcessResult((int) $process->getExitCode(), $process->getOutput(), $process->getErrorOutput());
    }

    /**
     * Resolves an executable from an explicit configured path or a list of names on PATH.
     */
    public function find(?string $configured, array $names): string
    {
        if (!empty($configured)) {
            if (!is_file($configured)) {
                throw new UpdateException('The configured program "' . basename($configured) . '" does not exist.');
            }

            return $configured;
        }

        $finder = new ExecutableFinder();
        foreach ($names as $name) {
            if (($found = $finder->find($name)) !== null) {
                return $found;
            }
        }

        throw new UpdateException('Could not find ' . implode(' or ', $names) . ' on PATH.');
    }

    private function baseEnv(): array
    {
        return getenv() ?: [];
    }
}
