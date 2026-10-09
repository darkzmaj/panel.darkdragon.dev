<?php

declare(strict_types=1);

namespace GobiaBackups\Storage;

use GobiaBackups\Models\Destination;
use phpseclib3\Crypt\PublicKeyLoader;
use phpseclib3\Net\SFTP;
use RuntimeException;
use Throwable;

/**
 * A Hetzner Storage Box over SSH: SFTP for the data, and on port 23 the box's own `sha256sum` to verify what was
 * stored without downloading it again. Works with any SFTP server; on plain port 22 the checksum is simply
 * unavailable and the caller verifies by size.
 *
 * The connection is refused unless the server presents the pinned host key, before any credential is sent.
 */
final class StorageBoxStore implements RemoteStore
{
    /** Paths the Panel builds: identifiers, dots and slashes only. Anything else never reaches the server. */
    private const string SAFE_PATH = '/\A[A-Za-z0-9][A-Za-z0-9._\/-]*\z/';

    private ?SFTP $sftp = null;

    private string $fingerprint = '';

    public function __construct(private readonly Destination $destination, private readonly bool $verifyHostKey = true) {}

    public function fingerprint(): string
    {
        $this->connection(authenticate: false);

        return $this->fingerprint;
    }

    public function makeDirectory(string $directory): void
    {
        $path = $this->path($directory);
        $sftp = $this->connection();
        if (! $sftp->is_dir($path) && ! $sftp->mkdir($path, -1, true) && ! $sftp->is_dir($path)) {
            throw new RuntimeException('The directory could not be created on the Storage Box.');
        }
    }

    public function put(string $path, callable $read): void
    {
        if (! $this->connection()->put($this->path($path), $read, SFTP::SOURCE_CALLBACK)) {
            throw new RuntimeException('The upload to the Storage Box failed: '.$this->lastError());
        }
    }

    public function get(string $path, callable $write): void
    {
        if ($this->connection()->get($this->path($path), $write) === false) {
            throw new RuntimeException('The download from the Storage Box failed: '.$this->lastError());
        }
    }

    public function size(string $path): ?int
    {
        $stat = $this->connection()->stat($this->path($path));

        return is_array($stat) && isset($stat['size']) ? (int) $stat['size'] : null;
    }

    public function sha256(string $path): ?string
    {
        try {
            $output = $this->connection()->exec('sha256sum '.$this->path($path));
        } catch (Throwable) {
            return null;
        }

        return is_string($output) && preg_match('/\A([a-f0-9]{64})\s/', $output, $match) === 1 ? $match[1] : null;
    }

    public function rename(string $from, string $to): void
    {
        $sftp = $this->connection();
        // SFTP rename does not replace an existing object.
        $sftp->delete($this->path($to), false);
        if (! $sftp->rename($this->path($from), $this->path($to))) {
            throw new RuntimeException('The object could not be renamed on the Storage Box.');
        }
    }

    public function delete(string $path): void
    {
        $this->connection()->delete($this->path($path), false);
    }

    public function close(): void
    {
        $this->sftp?->disconnect();
        $this->sftp = null;
    }

    private function path(string $relative): string
    {
        $path = trim($this->destination->base_path, '/').'/'.ltrim($relative, '/');
        if (preg_match(self::SAFE_PATH, $path) !== 1 || str_contains($path, '..') || str_contains($path, '//')) {
            throw new RuntimeException('Refusing an unexpected Storage Box path.');
        }

        return $path;
    }

    private function connection(bool $authenticate = true): SFTP
    {
        if ($this->sftp instanceof SFTP && ($this->sftp->isAuthenticated() || ! $authenticate)) {
            return $this->sftp;
        }

        $sftp = $this->sftp ?? new SFTP($this->destination->host, $this->destination->port, (int) config('gobia_backups.connect_timeout', 15));
        $this->sftp = $sftp;

        if ($this->fingerprint === '') {
            $key = $sftp->getServerPublicHostKey();
            if (! is_string($key) || $key === '') {
                throw new RuntimeException('The Storage Box did not answer on '.$this->destination->host.':'.$this->destination->port.'.');
            }
            $this->fingerprint = self::fingerprintOf($key);
        }

        if (! $authenticate) {
            return $sftp;
        }

        if ($this->verifyHostKey && ! hash_equals($this->destination->host_key_fingerprint, $this->fingerprint)) {
            $this->close();

            throw new RuntimeException('The Storage Box presented a different host key ('.$this->fingerprint.') than the pinned one. Nothing was sent.');
        }

        $credential = $this->destination->private_key !== null
            ? PublicKeyLoader::load($this->destination->private_key)
            : (string) $this->destination->password;
        if (! $sftp->login($this->destination->username, $credential)) {
            $this->close();

            throw new RuntimeException('The Storage Box rejected the credentials.');
        }
        $sftp->setTimeout((int) config('gobia_backups.transfer_timeout', 21600));

        return $sftp;
    }

    /** OpenSSH style fingerprint (`ssh-keygen -lf`) of a public key line such as "ssh-ed25519 AAAA...". */
    public static function fingerprintOf(string $publicKey): string
    {
        $parts = preg_split('/\s+/', trim($publicKey)) ?: [];
        $blob = base64_decode($parts[1] ?? '', true);
        if ($blob === false || $blob === '') {
            throw new RuntimeException('The host key could not be read.');
        }

        return 'SHA256:'.rtrim(base64_encode(hash('sha256', $blob, true)), '=');
    }

    private function lastError(): string
    {
        return (string) ($this->sftp?->getLastSFTPError() ?: 'no detail');
    }
}
