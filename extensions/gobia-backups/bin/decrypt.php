<?php

declare(strict_types=1);

/*
 * Decrypts an encrypted Gobia backup (*.tar.gz.gbk) without the Panel.
 *
 *   GOBIA_BACKUP_KEY=<base64 key> php decrypt.php <backup.tar.gz.gbk> <out.tar.gz>
 *
 * The key is the one shown once when the destination was created. This script needs PHP with the sodium
 * extension and the file next to it, nothing else: copy both to any machine to recover a backup when the
 * Panel is gone.
 */

require __DIR__.'/../src/Support/StreamCipher.php';

use GobiaBackups\Support\StreamCipher;

[, $in, $out] = $argv + [null, null, null];
$key = base64_decode((string) getenv('GOBIA_BACKUP_KEY'), true);
if (! is_string($in) || ! is_file($in) || ! is_string($out) || $key === false || strlen($key) !== StreamCipher::KEY_BYTES) {
    fwrite(STDERR, "usage: GOBIA_BACKUP_KEY=<base64 key> php decrypt.php <backup.tar.gz.gbk> <out.tar.gz>\n");
    exit(2);
}
if (file_exists($out)) {
    fwrite(STDERR, "Refusing to overwrite $out.\n");
    exit(2);
}

$source = fopen($in, 'rb');
$target = fopen($out, 'xb');
$cipher = StreamCipher::decryptor($key);

try {
    while (! feof($source)) {
        fwrite($target, $cipher->update((string) fread($source, 1048576)));
    }
    fwrite($target, $cipher->finish());
} catch (Throwable $exception) {
    fclose($target);
    unlink($out);
    fwrite(STDERR, $exception->getMessage()."\n");
    exit(1);
}

fclose($target);
echo "Decrypted to $out (", filesize($out), " bytes).\n";
