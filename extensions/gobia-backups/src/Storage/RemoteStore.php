<?php

declare(strict_types=1);

namespace GobiaBackups\Storage;

/**
 * The few operations backups need from a destination. Paths are relative to the destination's base path and are
 * only ever built from identifiers the Panel generated, never from user input.
 */
interface RemoteStore
{
    /** `SHA256:<base64>` of the host key the server presented. */
    public function fingerprint(): string;

    public function makeDirectory(string $directory): void;

    /**
     * Writes an object from a pull callback: `$read(int $length)` returns the next bytes, or null at the end.
     *
     * @param  callable(int): (string|null)  $read
     */
    public function put(string $path, callable $read): void;

    /**
     * Reads an object into a push callback, `$write(string $bytes)`.
     *
     * @param  callable(string): void  $write
     */
    public function get(string $path, callable $write): void;

    /** Size in bytes, or null when the object does not exist. */
    public function size(string $path): ?int;

    /** SHA-256 computed by the server, or null when the server cannot do that (plain SFTP on port 22). */
    public function sha256(string $path): ?string;

    public function rename(string $from, string $to): void;

    public function delete(string $path): void;

    public function close(): void;
}
