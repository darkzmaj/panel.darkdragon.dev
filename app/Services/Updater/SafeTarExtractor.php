<?php

namespace Pterodactyl\Services\Updater;

use Pterodactyl\Services\Updater\Exceptions\ReleaseVerificationException;

/**
 * Extracts a .tar.gz release package into an empty directory while refusing anything that could
 * escape it or smuggle in links, devices or oversized payloads. Nothing is trusted from the archive:
 * every path is validated before any file is created.
 */
class SafeTarExtractor
{
    private const BLOCK = 512;

    public function __construct(
        private int $maxBytes = 1536 * 1024 * 1024,
        private int $maxEntries = 200000,
    ) {
    }

    /**
     * @return array{files: int, bytes: int}
     *
     * @throws ReleaseVerificationException
     */
    public function extract(string $archive, string $destination): array
    {
        $handle = @gzopen($archive, 'rb');
        if ($handle === false) {
            throw new ReleaseVerificationException('The release package is not a readable gzip archive.');
        }

        if (!is_dir($destination) && !@mkdir($destination, 0755, true)) {
            throw new ReleaseVerificationException('The staging directory could not be created.');
        }
        $root = rtrim(str_replace('\\', '/', (string) realpath($destination)), '/');

        $files = $bytes = $entries = 0;
        $override = [];
        $sawEnd = false;

        try {
            while (($header = $this->read($handle, self::BLOCK, true)) !== null) {
                if (trim($header, "\0") === '') {
                    $sawEnd = true;
                    break;
                }

                if (++$entries > $this->maxEntries) {
                    throw new ReleaseVerificationException('The release package contains too many entries.');
                }

                $this->assertChecksum($header);
                $type = $header[156] === "\0" ? '0' : $header[156];
                $size = $this->octal(substr($header, 124, 12));
                $name = $this->name($header);

                // Extended header types carry metadata for the next entry rather than a file.
                if ($type === 'x') {
                    $override = $this->paxRecords($this->readBody($handle, $size)) + $override;
                    continue;
                }
                if ($type === 'g') {
                    $this->readBody($handle, $size);
                    continue;
                }
                if ($type === 'L') {
                    $override['path'] = rtrim($this->readBody($handle, $size), "\0");
                    continue;
                }

                $name = $override['path'] ?? $name;
                if (isset($override['size'])) {
                    $size = (int) $override['size'];
                }
                $override = [];

                if ($type !== '0' && $type !== '5') {
                    throw new ReleaseVerificationException('The release package contains an unsupported entry type (links and special files are not allowed).');
                }

                $relative = $this->sanitize($name, $type === '5');
                if ($relative === '') {
                    // The archive root ("./") that tar writes first.
                    continue;
                }
                $target = $root . '/' . $relative;

                if ($type === '5') {
                    if (!is_dir($target) && !@mkdir($target, 0755, true)) {
                        throw new ReleaseVerificationException('A directory from the release package could not be created.');
                    }
                    continue;
                }

                $bytes += $size;
                if ($bytes > $this->maxBytes) {
                    throw new ReleaseVerificationException('The release package expands to more than the allowed size.');
                }

                $dir = dirname($target);
                if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
                    throw new ReleaseVerificationException('A directory from the release package could not be created.');
                }

                $out = @fopen($target, 'xb');
                if ($out === false) {
                    throw new ReleaseVerificationException('The release package contains a duplicate or unwritable file.');
                }

                $remaining = $size;
                while ($remaining > 0) {
                    $chunk = $this->read($handle, min($remaining, 1024 * 1024));
                    fwrite($out, $chunk);
                    $remaining -= strlen($chunk);
                }
                fclose($out);

                $this->skipPadding($handle, $size);
                ++$files;
            }
        } finally {
            gzclose($handle);
        }

        if (!$sawEnd) {
            throw new ReleaseVerificationException('The release package is truncated (no end-of-archive marker).');
        }

        return ['files' => $files, 'bytes' => $bytes];
    }

    /**
     * Reads exactly $length bytes or fails. With $allowEof the end of the stream returns null.
     */
    private function read($handle, int $length, bool $allowEof = false): ?string
    {
        $data = '';
        while (strlen($data) < $length) {
            $chunk = gzread($handle, $length - strlen($data));
            if ($chunk === false || $chunk === '') {
                if ($allowEof && $data === '') {
                    return null;
                }

                throw new ReleaseVerificationException('The release package is truncated or corrupt.');
            }
            $data .= $chunk;
        }

        return $data;
    }

    private function readBody($handle, int $size): string
    {
        if ($size > 1024 * 1024) {
            throw new ReleaseVerificationException('The release package contains an oversized metadata record.');
        }

        $body = $size > 0 ? $this->read($handle, $size) : '';
        $this->skipPadding($handle, $size);

        return $body;
    }

    private function skipPadding($handle, int $size): void
    {
        $padding = (self::BLOCK - ($size % self::BLOCK)) % self::BLOCK;
        if ($padding > 0) {
            $this->read($handle, $padding);
        }
    }

    private function assertChecksum(string $header): void
    {
        $expected = $this->octal(substr($header, 148, 8));
        $sum = array_sum(unpack('C*', substr($header, 0, 148))) + 8 * 32 + array_sum(unpack('C*', substr($header, 156, 356)));

        if ($sum !== $expected) {
            throw new ReleaseVerificationException('The release package has a corrupt entry header.');
        }
    }

    private function octal(string $field): int
    {
        // A set high bit means GNU base-256 encoding, which is only used for huge files we do not allow.
        if ($field !== '' && (ord($field[0]) & 0x80)) {
            throw new ReleaseVerificationException('The release package contains an entry that is too large.');
        }

        $value = trim($field, " \0");

        return $value === '' ? 0 : (int) octdec($value);
    }

    private function name(string $header): string
    {
        $name = rtrim(substr($header, 0, 100), "\0");
        $prefix = rtrim(substr($header, 345, 155), "\0");

        return $prefix !== '' ? $prefix . '/' . $name : $name;
    }

    /**
     * @return array<string, string>
     */
    private function paxRecords(string $body): array
    {
        $records = [];
        $offset = 0;
        while ($offset < strlen($body)) {
            $space = strpos($body, ' ', $offset);
            if ($space === false) {
                break;
            }
            $length = (int) substr($body, $offset, $space - $offset);
            if ($length <= 0) {
                break;
            }
            $record = substr($body, $space + 1, $length - ($space - $offset) - 2);
            $parts = explode('=', $record, 2);
            if (count($parts) === 2) {
                $records[$parts[0]] = $parts[1];
            }
            $offset += $length;
        }

        return $records;
    }

    /**
     * Normalizes an archive path and rejects anything that is not a plain relative path.
     */
    private function sanitize(string $name, bool $allowRoot = false): string
    {
        if ($name === '' || str_contains($name, "\0") || str_contains($name, '\\')) {
            throw new ReleaseVerificationException('The release package contains an invalid path.');
        }

        if (str_starts_with($name, '/') || preg_match('/^[A-Za-z]:/', $name)) {
            throw new ReleaseVerificationException('The release package contains an absolute path.');
        }

        $parts = [];
        foreach (explode('/', $name) as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                throw new ReleaseVerificationException('The release package contains a path traversal attempt.');
            }
            // Windows drive/stream syntax and device names have no place in a release.
            if (str_contains($part, ':') || preg_match('/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i', $part)) {
                throw new ReleaseVerificationException('The release package contains an invalid path component.');
            }
            $parts[] = $part;
        }

        if ($parts === [] && $allowRoot) {
            return '';
        }

        if ($parts === []) {
            throw new ReleaseVerificationException('The release package contains an empty path.');
        }

        // Runtime state and secrets are never shipped with, or overwritten by, an update.
        if ((preg_match('/^\.env(\..*)?$/D', $parts[0]) && $parts[0] !== '.env.example') || $parts[0] === 'storage' || $parts[0] === '.git') {
            throw new ReleaseVerificationException('The release package contains runtime or secret files that must never be shipped.');
        }

        return implode('/', $parts);
    }
}
