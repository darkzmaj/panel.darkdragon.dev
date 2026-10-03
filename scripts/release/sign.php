<?php

/*
 * Writes release.json for a built package and signs it with an Ed25519 key.
 *
 *   php scripts/release/sign.php <package.tar.gz> <version> <migrations:true|false> <requires_restart:true|false> <out release.json>
 *
 * The secret key (base64) is read from the GOBIA_RELEASE_SIGNING_KEY environment variable or, for local
 * builds, from the file named by GOBIA_RELEASE_SIGNING_KEY_FILE. It is never written anywhere.
 * The signed message format must match App\Services\Updater\ReleaseInfo::signedMessage().
 */

[, $package, $version, $migrations, $restart, $out] = $argv + array_fill(0, 6, null);

if (!is_file($package) || !preg_match('/^\d+\.\d+\.\d+-gobia\.\d+$/', (string) $version) || !$out) {
    fwrite(STDERR, "usage: sign.php <package> <version> <migrations> <restart> <out>\n");
    exit(2);
}

$key = getenv('GOBIA_RELEASE_SIGNING_KEY') ?: (getenv('GOBIA_RELEASE_SIGNING_KEY_FILE') ? trim((string) file_get_contents(getenv('GOBIA_RELEASE_SIGNING_KEY_FILE'))) : '');
$secret = base64_decode($key, true);
if ($secret === false || strlen($secret) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
    fwrite(STDERR, "A valid base64 Ed25519 secret key is required in GOBIA_RELEASE_SIGNING_KEY.\n");
    exit(2);
}

$sha256 = hash_file('sha256', $package);
$size = filesize($package);
$migrations = $migrations === 'true';
$restart = $restart === 'true';

$message = implode('|', ['gobia-release-v1', $version, $sha256, $size, $migrations ? 'migrations' : 'no-migrations', $restart ? 'restart' : 'no-restart']);

file_put_contents($out, json_encode([
    'version' => $version,
    'sha256' => $sha256,
    'size' => $size,
    'migrations' => $migrations,
    'requires_restart' => $restart,
    'signature' => base64_encode(sodium_crypto_sign_detached($message, $secret)),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);

echo $sha256 . "  " . basename($package) . PHP_EOL;
