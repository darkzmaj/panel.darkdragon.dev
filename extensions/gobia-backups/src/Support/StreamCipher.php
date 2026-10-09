<?php

declare(strict_types=1);

namespace GobiaBackups\Support;

use RuntimeException;

/**
 * Authenticated streaming encryption for backup archives (libsodium secretstream, XChaCha20-Poly1305).
 *
 * Layout of an encrypted object: the magic `GOBIABK1`, the 24 byte stream header, then frames of at most
 * 64 KiB of plaintext, each 17 bytes longer than its plaintext. The last frame carries the FINAL tag, so a
 * truncated object is detected instead of being restored as a shorter archive. Memory use is one frame,
 * whatever the size of the archive.
 *
 * This file has no dependencies on purpose: `bin/decrypt.php` loads it alone, so a backup can be decrypted
 * on any machine with PHP and the key when the Panel itself is gone.
 */
final class StreamCipher
{
    public const string MAGIC = 'GOBIABK1';

    public const int CHUNK = 65536;

    public const int KEY_BYTES = SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_KEYBYTES;

    private const int HEADER = SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_HEADERBYTES;

    private const int OVERHEAD = SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES;

    private string $state;

    private string $buffer = '';

    private bool $started = false;

    private bool $finished = false;

    private function __construct(private readonly string $key, private readonly bool $encrypting)
    {
        if (strlen($key) !== self::KEY_BYTES) {
            throw new RuntimeException('The backup encryption key must be '.self::KEY_BYTES.' bytes.');
        }
        $this->state = '';
    }

    public static function generateKey(): string
    {
        return sodium_crypto_secretstream_xchacha20poly1305_keygen();
    }

    public static function encryptor(string $key): self
    {
        return new self($key, true);
    }

    public static function decryptor(string $key): self
    {
        return new self($key, false);
    }

    /** Size of the encrypted object for an archive of the given size. */
    public static function encryptedSize(int $plainBytes): int
    {
        $frames = $plainBytes === 0 ? 1 : intdiv($plainBytes + self::CHUNK - 1, self::CHUNK);

        return strlen(self::MAGIC) + self::HEADER + $plainBytes + $frames * self::OVERHEAD;
    }

    /** Feed the next piece of input; returns whatever output is ready (possibly nothing yet). */
    public function update(string $data): string
    {
        if ($this->finished) {
            throw new RuntimeException('The stream is already finished.');
        }
        $this->buffer .= $data;

        return $this->encrypting ? $this->encryptReady(false) : $this->decryptReady();
    }

    /** Finish the stream; returns the last piece of output. Decryption fails here when the object was cut short. */
    public function finish(): string
    {
        if ($this->finished) {
            return '';
        }

        if ($this->encrypting) {
            $output = $this->encryptReady(true);
            $this->finished = true;

            return $output;
        }

        $output = $this->decryptReady();
        // Whatever is left at the end of the input is the last, shorter frame.
        if ($this->started && ! $this->finished && $this->buffer !== '') {
            $output .= $this->pull($this->buffer);
            $this->buffer = '';
        }
        if (! $this->finished || $this->buffer !== '') {
            throw new RuntimeException('The encrypted backup is truncated or has trailing data.');
        }

        return $output;
    }

    private function encryptReady(bool $final): string
    {
        $output = '';
        if (! $this->started) {
            [$this->state, $header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($this->key);
            $output = self::MAGIC.$header;
            $this->started = true;
        }

        // The last frame must carry the FINAL tag, so one frame is always held back until finish().
        while (strlen($this->buffer) > self::CHUNK) {
            $output .= sodium_crypto_secretstream_xchacha20poly1305_push($this->state, substr($this->buffer, 0, self::CHUNK));
            $this->buffer = substr($this->buffer, self::CHUNK);
        }

        if ($final) {
            $output .= sodium_crypto_secretstream_xchacha20poly1305_push($this->state, $this->buffer, '', SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL);
            $this->buffer = '';
        }

        return $output;
    }

    private function decryptReady(): string
    {
        if (! $this->started) {
            $prefix = strlen(self::MAGIC) + self::HEADER;
            if (strlen($this->buffer) < $prefix) {
                return '';
            }
            if (! str_starts_with($this->buffer, self::MAGIC)) {
                throw new RuntimeException('This is not an encrypted Gobia backup.');
            }
            $this->state = sodium_crypto_secretstream_xchacha20poly1305_init_pull(substr($this->buffer, strlen(self::MAGIC), self::HEADER), $this->key);
            $this->buffer = substr($this->buffer, $prefix);
            $this->started = true;
        }

        $output = '';
        $frame = self::CHUNK + self::OVERHEAD;
        while (! $this->finished && strlen($this->buffer) >= $frame) {
            $output .= $this->pull(substr($this->buffer, 0, $frame));
            $this->buffer = substr($this->buffer, $frame);
        }

        return $output;
    }

    private function pull(string $frame): string
    {
        $result = sodium_crypto_secretstream_xchacha20poly1305_pull($this->state, $frame);
        if ($result === false) {
            throw new RuntimeException('The encrypted backup is damaged or the key is wrong.');
        }
        [$plain, $tag] = $result;
        if ($tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
            $this->finished = true;
        }

        return $plain;
    }
}
