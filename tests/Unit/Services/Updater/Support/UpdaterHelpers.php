<?php

namespace Pterodactyl\Tests\Unit\Services\Updater\Support;

use Pterodactyl\Services\Updater\RunStore;
use Pterodactyl\Services\Updater\ReleaseInfo;
use Pterodactyl\Services\Updater\ReleaseVerifier;
use Pterodactyl\Services\Updater\SafeTarExtractor;
use Pterodactyl\Services\Updater\UpdateOrchestrator;

require_once __DIR__ . '/Fakes.php';

/**
 * Shared fixtures for the updater tests: a temporary state directory, a throw-away signing key,
 * fake collaborators and a builder for signed release packages.
 */
trait UpdaterHelpers
{
    protected string $state;

    protected string $publicKey;

    protected string $secretKey;

    protected RunStore $store;

    protected FakeProvider $provider;

    protected FakeRunner $runner;

    protected FakeBackup $backup;

    protected FakeProbe $probe;

    protected function setUpUpdater(): void
    {
        $this->state = sys_get_temp_dir() . '/gobia-updater-test-' . bin2hex(random_bytes(4));
        mkdir($this->state);

        $pair = sodium_crypto_sign_keypair();
        $this->publicKey = base64_encode(sodium_crypto_sign_publickey($pair));
        $this->secretKey = sodium_crypto_sign_secretkey($pair);

        config([
            'app.version' => '1.15.1-gobia.1',
            'gobia.update.state_path' => $this->state,
            'gobia.update.public_key' => $this->publicKey,
            'gobia.update.backup_retention' => 5,
        ]);

        $this->store = new RunStore($this->state);
        $this->provider = new FakeProvider();
        $this->runner = new FakeRunner();
        $this->backup = new FakeBackup();
        $this->probe = new FakeProbe();
    }

    protected function tearDownUpdater(): void
    {
        $this->deleteTree($this->state);
    }

    protected function orchestrator(): UpdateOrchestrator
    {
        return new UpdateOrchestrator(
            $this->store,
            $this->provider,
            new ReleaseVerifier($this->publicKey),
            new SafeTarExtractor(),
            $this->backup,
            $this->runner,
            $this->probe,
        );
    }

    /**
     * Builds a valid package for $version and registers it with the fake provider.
     *
     * @return array{0: ReleaseInfo, 1: string}
     */
    protected function publish(string $version = '1.15.1-gobia.2', array $files = [], bool $migrations = true): array
    {
        $tar = new TarBuilder();
        $contents = $files + [
            'VERSION' => $version . "\n",
            'artisan' => '<?php',
            'composer.json' => '{}',
            'bootstrap/app.php' => '<?php',
            'vendor/autoload.php' => '<?php',
            'public/index.php' => '<?php',
            'public/assets/manifest.json' => '{"a":1}',
            'app/Example.php' => '<?php',
        ];
        foreach ($contents as $name => $content) {
            $tar->file($name, $content);
        }

        return $this->register($version, $tar->build(), $migrations);
    }

    protected function register(string $version, string $package, bool $migrations = true): array
    {
        $release = $this->sign($version, hash('sha256', $package), strlen($package), $migrations);
        $this->provider->add($release, $package);

        return [$release, $package];
    }

    protected function sign(string $version, string $sha256, int $size, bool $migrations = true, bool $restart = true): ReleaseInfo
    {
        $unsigned = new ReleaseInfo($version, $sha256, $size, $migrations, $restart, null, gmdate('c'), 'Notes', 'pkg');
        $signature = base64_encode(sodium_crypto_sign_detached($unsigned->signedMessage(), $this->secretKey));

        return new ReleaseInfo($version, $sha256, $size, $migrations, $restart, $signature, gmdate('c'), 'Notes', 'pkg');
    }

    /**
     * Creates a queued run the way UpdateService::start() does.
     */
    protected function queueRun(string $to = '1.15.1-gobia.2'): string
    {
        [$created, $run] = $this->store->begin(UpdateOrchestrator::newRun($this->store->newId(), '1.15.1-gobia.1', $to, ['id' => 1, 'username' => 'admin']));
        $this->assertTrue($created);

        return $run['id'];
    }

    protected function deleteTree(string $path): void
    {
        if (!is_dir($path)) {
            return;
        }
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $item) {
            $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
        }
        @rmdir($path);
    }
}
