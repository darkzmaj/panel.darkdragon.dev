<?php

namespace Pterodactyl\Tests\Unit\Services\Updater\Support;

use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\ProcessResult;
use Pterodactyl\Services\Updater\HttpHealthProbe;
use Pterodactyl\Services\Updater\DatabaseBackupService;
use Pterodactyl\Services\Updater\Runners\DeploymentRunner;
use Pterodactyl\Services\Updater\Providers\ReleaseProvider;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

class FakeProvider implements ReleaseProvider
{
    /** @var array<string, ReleaseInfo> */
    public array $releases = [];

    /** @var array<string, string> version => package bytes */
    public array $packages = [];

    public ?string $failWith = null;

    public ?string $truncateTo = null;

    public function add(ReleaseInfo $release, string $package): void
    {
        $this->releases[$release->version] = $release;
        $this->packages[$release->version] = $package;
    }

    public function latest(): ?ReleaseInfo
    {
        $this->failWith && throw new UpdateException($this->failWith);

        return collect($this->releases)->sortKeysUsing(fn ($a, $b) => version_compare($b, $a))->first();
    }

    public function find(string $version): ?ReleaseInfo
    {
        $this->failWith && throw new UpdateException($this->failWith);

        return $this->releases[$version] ?? null;
    }

    public function download(ReleaseInfo $release, string $destination): void
    {
        $bytes = $this->packages[$release->version];
        file_put_contents($destination, $this->truncateTo !== null ? substr($bytes, 0, (int) $this->truncateTo) : $bytes);
    }
}

class FakeRunner implements DeploymentRunner
{
    /** @var string[] */
    public array $calls = [];

    /** @var array<string, ProcessResult> */
    public array $artisanResults = [];

    public bool $failInstall = false;

    public bool $failRestore = false;

    public function name(): string
    {
        return 'fake';
    }

    public function install(string $stagedPath, ReleaseInfo $release, string $backupDir): void
    {
        $this->calls[] = 'install';
        if ($this->failInstall) {
            throw new UpdateException('disk full');
        }
        @mkdir($backupDir, 0777, true);
        file_put_contents($backupDir . '/journal.json', '[]');
    }

    public function restoreFiles(string $backupDir): void
    {
        $this->calls[] = 'restoreFiles';
        if ($this->failRestore) {
            throw new UpdateException('cannot restore');
        }
    }

    public function artisan(string $command, array $options = []): ProcessResult
    {
        $this->calls[] = 'artisan:' . $command;

        return $this->artisanResults[$command] ?? new ProcessResult(0, $command === 'gobia:update:health' ? json_encode(['ok' => true, 'checks' => []]) : '', '');
    }

    public function restartWorkers(): void
    {
        $this->calls[] = 'restartWorkers';
    }
}

class FakeBackup extends DatabaseBackupService
{
    /** @var string[] */
    public array $calls = [];

    public bool $failCreate = false;

    public bool $failRestore = false;

    public function __construct()
    {
    }

    public function create(string $directory, string $name): string
    {
        $this->calls[] = 'create';
        if ($this->failCreate) {
            throw new UpdateException('The database backup failed: access denied');
        }
        @mkdir($directory, 0777, true);
        file_put_contents($file = $directory . '/' . $name . '.sql', str_repeat('-- dump', 50) . "\n-- Dump completed on 2026-01-01\n");

        return $file;
    }

    public function restore(string $file): void
    {
        $this->calls[] = 'restore';
        if ($this->failRestore) {
            throw new UpdateException('restore failed');
        }
    }
}

class FakeProbe extends HttpHealthProbe
{
    public bool $fail = false;

    public function check(string $secret): void
    {
        if ($this->fail) {
            throw new UpdateException('The login page returned HTTP 500 during the health check.');
        }
    }
}
