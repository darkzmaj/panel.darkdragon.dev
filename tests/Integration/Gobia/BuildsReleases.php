<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia;

use GobiaCore\Updater\ReleaseSignature;
use Illuminate\Support\Facades\File;

/**
 * Builds signed Gobia release packages in a temporary directory, laid out the way the directory
 * release provider reads them, so the updater is tested against real archives and real signatures.
 */
trait BuildsReleases
{
    private string $releaseRoot = '';

    private string $releaseSecretKey = '';

    protected function setUpReleases(): void
    {
        $this->releaseRoot = sys_get_temp_dir().'/gobia-rel-'.uniqid();
        File::ensureDirectoryExists($this->releaseRoot.'/releases');
        File::ensureDirectoryExists($this->releaseRoot.'/state');

        $pair = sodium_crypto_sign_keypair();
        $this->releaseSecretKey = sodium_crypto_sign_secretkey($pair);

        config([
            'gobia_updater.provider' => 'directory',
            'gobia_updater.directory' => $this->releaseRoot.'/releases',
            'gobia_updater.state_path' => $this->releaseRoot.'/state',
            'gobia_updater.public_key' => base64_encode(sodium_crypto_sign_publickey($pair)),
            'gobia_updater.allow_unsigned' => false,
            'gobia_updater.http_probe' => false,
            // Any existing file: the tests never dump a real database through these.
            'gobia_updater.mysqldump' => PHP_BINARY,
            'gobia_updater.mysql' => PHP_BINARY,
        ]);
    }

    protected function tearDownReleases(): void
    {
        File::deleteDirectory($this->releaseRoot);
    }

    /**
     * @param  array<string, mixed>  $overrides  manifest fields to change before signing
     * @param  array<string, string>  $files  package files that replace or extend the default tree
     */
    protected function publishRelease(string $version, array $overrides = [], array $files = [], bool $sign = true): string
    {
        $manifest = array_replace_recursive([
            'manifest_version' => 2,
            'gobia_version' => $version,
            'pterodactyl_base' => ['version' => '2.0.0-dev', 'sdk' => '2.0.0-beta.4', 'commit' => str_repeat('a', 40)],
            'extensions' => ['gobia-core' => '1.0.0'],
            'min_upgrade_from' => null,
            'php' => '>=8.3 <8.6',
            'node_runtime_required' => false,
            'database' => ['server' => ['mariadb>=10.5', 'mysql>=8.0'], 'redis' => 'optional'],
            'migrations' => ['names' => [], 'destructive' => false],
            'security_update' => false,
        ], $overrides);

        $inside = $manifest;
        $tar = new TarArchive;
        foreach ($files + [
            'gobia-release.json' => (string) json_encode($inside),
            'artisan' => '<?php',
            'composer.json' => '{}',
            'bootstrap/app.php' => '<?php',
            'vendor/autoload.php' => '<?php',
            'public/index.php' => '<?php // '.$version,
            'public/assets/manifest.json' => '{"index":{"file":"index.js"}}',
            'extensions/gobia-core/extension.json' => '{"id":"gobia-core","name":"Gobia Core","version":"1.0.0"}',
            'extensions/gobia-core/dist/client.js' => 'export default {};',
        ] as $name => $content) {
            $tar->file($name, $content);
        }

        $directory = $this->releaseRoot.'/releases/'.$version;
        File::ensureDirectoryExists($directory);
        $package = $directory.'/gobia-panel-'.$version.'.tar.gz';
        file_put_contents($package, $tar->build());

        $manifest['artifact'] = ['name' => basename($package), 'sha256' => hash_file('sha256', $package), 'size' => filesize($package)];
        if ($sign) {
            $manifest['signature'] = base64_encode(sodium_crypto_sign_detached(ReleaseSignature::message($manifest), $this->releaseSecretKey));
        }

        file_put_contents($directory.'/release.json', (string) json_encode($manifest));
        file_put_contents($directory.'/notes.md', 'Notes for '.$version);

        return $package;
    }

    /** Rewrites a published manifest without signing it again, as an attacker without the key would. */
    protected function tamperRelease(string $version, callable $change): void
    {
        $file = $this->releaseRoot.'/releases/'.$version.'/release.json';
        $manifest = json_decode((string) file_get_contents($file), true);
        file_put_contents($file, (string) json_encode($change($manifest)));
    }
}
