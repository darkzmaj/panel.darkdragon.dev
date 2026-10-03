<?php

namespace Pterodactyl\Tests\Unit\Services\Updater;

use PHPUnit\Framework\Attributes\DataProvider;
use Pterodactyl\Services\Updater\ProcessResult;
use Pterodactyl\Services\Updater\ProcessRunner;
use Pterodactyl\Services\Updater\Runners\InPlaceRunner;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;
use Pterodactyl\Services\Updater\Runners\ReleaseDirectoryRunner;

class RecordingProcesses extends ProcessRunner
{
    /** @var string[][] */
    public array $commands = [];

    public int $exitCode = 0;

    public function run(array $command, ?string $cwd = null, array $env = [], int $timeout = 300, $input = null): ProcessResult
    {
        $this->commands[] = $command;

        return new ProcessResult($this->exitCode, '', $this->exitCode ? 'denied' : '');
    }
}

class RunnersTest extends UpdaterTestCase
{
    private string $base;

    private function tree(string $root, array $files): void
    {
        foreach ($files as $path => $content) {
            @mkdir(dirname($root . '/' . $path), 0777, true);
            file_put_contents($root . '/' . $path, $content);
        }
    }

    private function inPlace(?RecordingProcesses $processes = null): InPlaceRunner
    {
        $this->base = $this->state . '/live';
        mkdir($this->base);

        return new InPlaceRunner($processes ?? new RecordingProcesses(), $this->base);
    }

    public function testInstallReplacesCodeAndKeepsStorageAndEnvironment(): void
    {
        $runner = $this->inPlace();
        $this->tree($this->base, [
            'app/Old.php' => 'old',
            'vendor/autoload.php' => 'old-vendor',
            'VERSION' => "1.15.1-gobia.1\n",
            '.env' => 'APP_KEY=secret',
            'storage/app/private/avatars/me.png' => 'avatar',
            'storage/app/private/branding/logo.png' => 'logo',
        ]);
        $this->tree($this->state . '/staged', [
            'app/New.php' => 'new',
            'vendor/autoload.php' => 'new-vendor',
            'VERSION' => "1.15.1-gobia.2\n",
            'database/migrations/x.php' => 'm',
        ]);
        [$release] = $this->publish();

        $runner->install($this->state . '/staged', $release, $this->state . '/backup');

        $this->assertFileExists($this->base . '/app/New.php');
        $this->assertFileDoesNotExist($this->base . '/app/Old.php');
        $this->assertSame("1.15.1-gobia.2\n", file_get_contents($this->base . '/VERSION'));
        $this->assertSame('APP_KEY=secret', file_get_contents($this->base . '/.env'));
        $this->assertSame('avatar', file_get_contents($this->base . '/storage/app/private/avatars/me.png'));
        $this->assertSame('logo', file_get_contents($this->base . '/storage/app/private/branding/logo.png'));
        $this->assertFileExists($this->state . '/backup/previous/app/Old.php');
    }

    public function testRestoreFilesBringsBackThePreviousReleaseExactly(): void
    {
        $runner = $this->inPlace();
        $this->tree($this->base, ['app/Old.php' => 'old', 'VERSION' => "1.15.1-gobia.1\n", '.env' => 'APP_KEY=secret', 'storage/keep.txt' => 'keep']);
        $this->tree($this->state . '/staged', ['app/New.php' => 'new', 'VERSION' => "1.15.1-gobia.2\n", 'extra/added.txt' => 'added']);
        [$release] = $this->publish();

        $runner->install($this->state . '/staged', $release, $this->state . '/backup');
        $runner->restoreFiles($this->state . '/backup');

        $this->assertSame('old', file_get_contents($this->base . '/app/Old.php'));
        $this->assertFileDoesNotExist($this->base . '/app/New.php');
        $this->assertFileDoesNotExist($this->base . '/extra', 'entries that did not exist before are removed');
        $this->assertSame("1.15.1-gobia.1\n", file_get_contents($this->base . '/VERSION'));
        $this->assertSame('APP_KEY=secret', file_get_contents($this->base . '/.env'));
        $this->assertSame('keep', file_get_contents($this->base . '/storage/keep.txt'));
    }

    public function testPublicDirectoryIsSwappedByContentAndRestoredTheSameWay(): void
    {
        $runner = $this->inPlace();
        $this->tree($this->base, ['public/index.php' => 'old', 'public/assets/old.js' => 'old']);
        $this->tree($this->state . '/staged', ['public/index.php' => 'new', 'public/assets/new.js' => 'new']);
        [$release] = $this->publish();

        $runner->install($this->state . '/staged', $release, $this->state . '/backup');
        $this->assertSame('new', file_get_contents($this->base . '/public/index.php'));
        $this->assertFileExists($this->base . '/public/assets/new.js');
        $this->assertFileDoesNotExist($this->base . '/public/assets/old.js');

        $runner->restoreFiles($this->state . '/backup');
        $this->assertSame('old', file_get_contents($this->base . '/public/index.php'));
        $this->assertFileExists($this->base . '/public/assets/old.js');
        $this->assertFileDoesNotExist($this->base . '/public/assets/new.js');
    }

    public function testStagedStorageAndEnvironmentFilesAreNeverInstalled(): void
    {
        $runner = $this->inPlace();
        $this->tree($this->base, ['.env' => 'real', 'storage/real.txt' => 'real', 'VERSION' => '1']);
        $this->tree($this->state . '/staged', ['.env' => 'EVIL', 'storage/real.txt' => 'EVIL', 'VERSION' => '2']);
        [$release] = $this->publish();

        $runner->install($this->state . '/staged', $release, $this->state . '/backup');

        $this->assertSame('real', file_get_contents($this->base . '/.env'));
        $this->assertSame('real', file_get_contents($this->base . '/storage/real.txt'));
    }

    #[DataProvider('forbiddenCommands')]
    public function testOnlyWhitelistedArtisanCommandsRun(string $command, array $options): void
    {
        $processes = new RecordingProcesses();
        $runner = $this->inPlace($processes);

        $this->expectException(UpdateException::class);
        try {
            $runner->artisan($command, $options);
        } finally {
            $this->assertSame([], $processes->commands, 'nothing may be executed');
        }
    }

    public static function forbiddenCommands(): array
    {
        return [
            'arbitrary command' => ['tinker', []],
            'db wipe' => ['db:wipe', ['--force']],
            'shell injection in name' => ['migrate; rm -rf /', []],
            'path in name' => ['../artisan', []],
            'option with shell chars' => ['migrate', ['--force; whoami']],
            'option with spaces' => ['migrate', ['--path=a b']],
            'positional argument' => ['migrate', ['evil']],
            'single dash' => ['migrate', ['-x']],
            'env override' => ['migrate', ['--env=local && x']],
            'newline in option' => ['down', ["--secret=abc\n--x"]],
        ];
    }

    public function testWhitelistedCommandsRunWithoutAShell(): void
    {
        $processes = new RecordingProcesses();
        $runner = $this->inPlace($processes);

        $runner->artisan('migrate', ['--force']);
        $runner->artisan('down', ['--secret=abc123', '--retry=60']);

        $this->assertSame('artisan', $processes->commands[0][1]);
        $this->assertSame(['migrate', '--no-interaction', '--force'], array_slice($processes->commands[0], 2));
        $this->assertSame(['down', '--no-interaction', '--secret=abc123', '--retry=60'], array_slice($processes->commands[1], 2));
    }

    public function testReleaseDirectoryRunnerOnlyAsksTheHelperForFixedVerbs(): void
    {
        $processes = new RecordingProcesses();
        $root = $this->state . '/install';
        mkdir($root . '/releases', 0777, true);
        $runner = new ReleaseDirectoryRunner($processes, $root, '/usr/local/sbin/gobia-update-helper');

        $runner->restartWorkers();

        $this->assertSame([
            ['sudo', '-n', '/usr/local/sbin/gobia-update-helper', 'restart-workers'],
            ['sudo', '-n', '/usr/local/sbin/gobia-update-helper', 'reload-php'],
        ], $processes->commands);
    }

    public function testReleaseDirectoryRunnerRefusesAnExistingReleaseAndInvalidVersions(): void
    {
        $processes = new RecordingProcesses();
        $root = $this->state . '/install';
        mkdir($root . '/releases/1.15.1-gobia.2', 0777, true);
        $runner = new ReleaseDirectoryRunner($processes, $root, '/usr/local/sbin/gobia-update-helper');
        [$release] = $this->publish();

        try {
            $runner->install($this->state . '/staged', $release, $this->state . '/backup');
            $this->fail('Expected the existing release to be refused');
        } catch (UpdateException $exception) {
            $this->assertStringContainsString('already installed', $exception->getMessage());
        }

        $evil = new \Pterodactyl\Services\Updater\ReleaseInfo('../../etc', str_repeat('a', 64), 1, true, true, null, null, '', 'x');
        $this->expectException(UpdateException::class);
        $runner->install($this->state . '/staged', $evil, $this->state . '/backup');
        $this->assertSame([], $processes->commands);
    }

    public function testHelperFailureSurfacesAsAnUpdateError(): void
    {
        $processes = new RecordingProcesses();
        $processes->exitCode = 1;
        $runner = new ReleaseDirectoryRunner($processes, $this->state, '/usr/local/sbin/gobia-update-helper');

        $this->expectExceptionMessage('refused or failed');
        $runner->restartWorkers();
    }
}
