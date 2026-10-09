<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use GobiaCore\Updater\Exceptions\UpdateException;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\PhpExecutableFinder;
use Symfony\Component\Process\Process;
use Throwable;

/**
 * The single place the updater starts other programs. Commands are always passed as an argument
 * array (never through a shell) and callers only ever build them from fixed strings and validated values.
 */
class ProcessRunner
{
    /**
     * @param  list<string>  $command
     * @param  array<string, string>  $env
     * @param  resource|string|null  $input
     */
    public function run(array $command, ?string $cwd = null, array $env = [], int $timeout = 300, $input = null): ProcessResult
    {
        $process = new Process($command, $cwd, $env === [] ? null : $env, $input, $timeout);

        try {
            $process->run();
        } catch (Throwable $exception) {
            throw new UpdateException('A required program could not be run: '.Redactor::scrub($exception->getMessage()));
        }

        return new ProcessResult((int) $process->getExitCode(), $process->getOutput(), $process->getErrorOutput());
    }

    /**
     * Resolves an executable from an explicit configured path or a list of names on PATH.
     *
     * @param  list<string>  $names
     */
    public function find(mixed $configured, array $names): string
    {
        if (is_string($configured) && $configured !== '') {
            if (! is_file($configured)) {
                throw new UpdateException('The configured program "'.basename($configured).'" does not exist.');
            }

            return $configured;
        }

        $finder = new ExecutableFinder;
        foreach ($names as $name) {
            if (($found = $finder->find($name)) !== null) {
                return $found;
            }
        }

        throw new UpdateException('Could not find '.implode(' or ', $names).' on PATH.');
    }

    /**
     * Starts `php artisan <command>` detached from the current request, so it survives the response and a
     * PHP-FPM reload. The command comes from a fixed list and the only argument is a validated run id.
     */
    public static function detachArtisan(string $command, ?string $runId = null): void
    {
        if (! in_array($command, ['gobia-core:update:work', 'gobia-core:update:recover', 'route:cache'], true)
            || ($runId !== null && preg_match(RunStore::ID_PATTERN, $runId) !== 1)) {
            throw new UpdateException('Invalid worker request.');
        }

        $php = escapeshellarg(self::php());
        $arguments = $runId === null ? '' : ' '.$runId;

        $line = PHP_OS_FAMILY === 'Windows'
            ? 'start /B "" '.$php.' artisan '.$command.$arguments.' > NUL 2>&1'
            : 'nohup '.$php.' artisan '.$command.$arguments.' > /dev/null 2>&1 &';

        $cwd = (string) getcwd();
        chdir(base_path());
        pclose(popen($line, 'r'));
        chdir($cwd);
    }

    /** The PHP CLI binary. Under PHP-FPM, PHP_BINARY is the FPM binary, so it is looked up instead. */
    public static function php(): string
    {
        $configured = config('gobia_updater.php_binary');
        if (is_string($configured) && $configured !== '' && is_file($configured)) {
            return $configured;
        }

        return (new PhpExecutableFinder)->find() ?: 'php';
    }
}
