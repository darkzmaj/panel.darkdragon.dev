<?php

declare(strict_types=1);

/*
 * Writes the signed release manifest (release.json) for a built Gobia package.
 *
 *   php scripts/release/sign.php <package.tar.gz> <staged tree> <out release.json>
 *
 * The manifest is the tree's gobia-release.json plus what only the build knows: the bundled extension
 * versions, every migration the release contains, and the artifact's name, size and SHA-256. It is signed
 * with Ed25519 over GobiaCore\Updater\ReleaseSignature::message(), the same code the Panel verifies with.
 *
 * The secret key (base64) is read from GOBIA_RELEASE_SIGNING_KEY or, for local builds, from the file named
 * by GOBIA_RELEASE_SIGNING_KEY_FILE. It is never written anywhere.
 *
 * RELEASE_DESTRUCTIVE=true marks the release as containing a destructive migration (see docs/gobia-updates.md).
 */

require __DIR__.'/../../extensions/gobia-core/src/Updater/ReleaseSignature.php';

[, $package, $tree, $out] = $argv + array_fill(0, 4, null);
if (! is_string($package) || ! is_file($package) || ! is_string($tree) || ! is_file($tree.'/gobia-release.json') || ! is_string($out)) {
    fwrite(STDERR, "usage: sign.php <package> <staged tree> <out>\n");
    exit(2);
}

$keyFile = getenv('GOBIA_RELEASE_SIGNING_KEY_FILE');
$key = getenv('GOBIA_RELEASE_SIGNING_KEY') ?: ($keyFile ? trim((string) file_get_contents($keyFile)) : '');
$secret = base64_decode($key, true);
if ($secret === false || strlen($secret) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
    fwrite(STDERR, "A valid base64 Ed25519 secret key is required in GOBIA_RELEASE_SIGNING_KEY.\n");
    exit(2);
}

$manifest = json_decode((string) file_get_contents($tree.'/gobia-release.json'), true, flags: JSON_THROW_ON_ERROR);
$version = $manifest['gobia_version'] ?? '';
if (preg_match('/^\d{1,4}\.\d{1,4}\.\d{1,4}(-(dev|alpha|beta|rc)(\.\d{1,4})?)?$/D', (string) $version) !== 1) {
    fwrite(STDERR, "gobia-release.json has no valid gobia_version.\n");
    exit(2);
}

$extensions = [];
$migrations = array_map(fn (string $file): string => basename($file, '.php'), glob($tree.'/database/migrations/*.php') ?: []);
foreach (glob($tree.'/extensions/gobia-*/extension.json') ?: [] as $file) {
    $extension = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
    $extensions[$extension['id']] = $extension['version'];
    foreach (glob(dirname($file).'/database/migrations/*.php') ?: [] as $migration) {
        $migrations[] = basename($migration, '.php');
    }
}
ksort($extensions);
sort($migrations);

// The extension API version this release ships, read from its own configuration file.
$sdk = preg_match("/'sdk_version'\s*=>\s*'([^']+)'/", (string) file_get_contents($tree.'/config/extensions.php'), $match) === 1 ? $match[1] : null;

unset($manifest['post_install'], $manifest['signature']);
$manifest['manifest_version'] = 2;
$manifest['pterodactyl_base'] = ($manifest['pterodactyl_base'] ?? []) + ['version' => '2.0.0-dev'];
$manifest['pterodactyl_base']['sdk'] = $sdk;
$manifest['extensions'] = $extensions;
$manifest['node_runtime_required'] = false;
$manifest['migrations'] = [
    'count' => count($migrations),
    'names' => $migrations,
    'destructive' => getenv('RELEASE_DESTRUCTIVE') === 'true',
];
$manifest['security_update'] = (bool) ($manifest['security_update'] ?? false);
$manifest['artifact'] = [
    'name' => basename($package),
    'sha256' => hash_file('sha256', $package),
    'size' => filesize($package),
];
$manifest['signature'] = base64_encode(sodium_crypto_sign_detached(GobiaCore\Updater\ReleaseSignature::message($manifest), $secret));

file_put_contents($out, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE).PHP_EOL);

echo $manifest['artifact']['sha256'].'  '.basename($package).PHP_EOL;
