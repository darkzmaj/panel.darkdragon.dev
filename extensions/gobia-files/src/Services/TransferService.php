<?php

declare(strict_types=1);

namespace GobiaFiles\Services;

use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Str;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use Throwable;

/**
 * Copies or moves files and folders from one server to another through the Panel.
 *
 * Authorization is checked on both servers with the permissions the file endpoints use: reading the source needs
 * `file.read` and `file.read-content`, writing the destination `file.create` (and `file.update` to replace), and a move
 * also `file.delete` on the source. Nothing is trusted from the browser except the choice of items.
 *
 * A file is streamed from the source node into `php://temp` (a few MiB in memory, the rest in a temporary file, so memory
 * does not grow with the file), uploaded to a temporary name beside its destination, read back and compared by size and
 * SHA-256, and only then renamed into place: a failed or interrupted transfer never leaves a partial file under the real
 * name. A move removes a source only after every file inside it was verified at the destination, and only reports
 * "moved" once the source is confirmed gone; if the original cannot be removed the item is reported as an incomplete move
 * and can be finished later (`resume`) without copying anything twice.
 *
 * @phpstan-type Counts array{copied: int, skipped: int, failed: int, bytes: int, reasons: list<string>, placed: string|null}
 * @phpstan-type ItemResult array{path: string, name: string, status: string, bytes: int, copied: int, skipped: int, failed: int, reason: string|null, destination: string|null}
 */
final class TransferService
{
    private const string TEMP_PREFIX = '.gobia-transfer-';

    /** @var array<string, float> milliseconds spent per stage in the current transfer */
    private array $timings = [];

    /** Bytes still free on the destination (null: unknown or unlimited). */
    private ?int $remaining = null;

    /**
     * @param  list<string>  $items
     * @param  array<string, string>  $kinds  what the browser believes each item is ('file' or 'directory'); only saves a listing
     * @return array{source: Server, destination: Server, directory: string, items: list<ItemResult>, bytes: int, timings: array<string, int>}
     */
    public function transfer(User $user, string $sourceUuid, string $destinationUuid, string $directory, array $items, string $mode, string $conflict, array $kinds = [], bool $resume = false): array
    {
        $this->timings = [];
        $started = hrtime(true);
        set_time_limit(0);
        $source = $this->server($sourceUuid);
        $destination = $this->server($destinationUuid);
        $this->time('authorize', fn () => $this->authorize($user, $source, $destination, $mode, $conflict));

        $target = $this->path($directory);
        $from = new WingsFiles($source);
        $to = new WingsFiles($destination);
        $same = $source->is($destination);
        $budget = (int) config('gobia_files.transfer.max_entries');
        $this->remaining = $this->capacity($destination);

        $results = [];
        $total = 0;
        foreach ($items as $raw) {
            $path = $this->path($raw);
            $name = $this->base($path);
            if ($path === '/') {
                $results[] = $this->result($path, '/', 'failed', 0, 0, 0, 1, 'The server root cannot be transferred.', null);

                continue;
            }
            $parent = $this->parent($path);
            if ($same && $mode === 'move' && ($target === $path || str_starts_with($target.'/', $path.'/'))) {
                $results[] = $this->result($path, $name, 'failed', 0, 0, 0, 1, 'A folder cannot be moved into itself.', null);

                continue;
            }
            if ($same && $mode === 'move' && $parent === $target) {
                $results[] = $this->result($path, $name, 'skipped', 0, 0, 1, 0, 'It is already in that folder.', null);

                continue;
            }

            try {
                $entry = $this->entry($from, $parent, $name, $kinds[$raw] ?? null);
                if ($entry === null) {
                    $results[] = $this->result($path, $name, 'failed', 0, 0, 0, 1, 'It no longer exists.', null);

                    continue;
                }
                $counts = ['copied' => 0, 'skipped' => 0, 'failed' => 0, 'bytes' => 0, 'reasons' => [], 'placed' => null];
                $listings = [];
                $this->copy($from, $to, $entry, $path, $target, $name, $conflict, $resume, 0, $budget, $counts, $listings);
            } catch (Throwable $exception) {
                report($exception);
                $results[] = $this->result($path, $name, 'failed', 0, 0, 0, 1, 'A server could not be reached or refused the request.', null);

                continue;
            }

            $destinationPath = $counts['placed'] === null ? null : $this->join($target, $counts['placed']);
            $status = $counts['failed'] > 0 ? ($counts['copied'] > 0 ? 'partial' : 'failed') : ($counts['copied'] === 0 && $counts['skipped'] > 0 ? 'skipped' : 'copied');
            $reason = $counts['reasons'][0] ?? null;
            if ($mode === 'move' && $counts['failed'] === 0 && $counts['skipped'] === 0 && $counts['copied'] > 0) {
                [$status, $reason] = $this->removeSource($from, $parent, $name);
            } elseif ($mode === 'move' && $status === 'copied') {
                $status = 'move_incomplete';
                $reason = 'The original was kept because something inside it was skipped.';
            }
            $total += $counts['bytes'];
            $results[] = $this->result($path, $name, $status, $counts['bytes'], $counts['copied'], $counts['skipped'], $counts['failed'], $reason, $destinationPath);
        }

        $this->timings['total'] = (hrtime(true) - $started) / 1e6;

        return [
            'source' => $source,
            'destination' => $destination,
            'directory' => $target,
            'items' => $results,
            'bytes' => $total,
            'timings' => array_map(fn (float $milliseconds): int => (int) round($milliseconds), $this->timings),
        ];
    }

    /**
     * Deletes the original of a verified move and confirms it is gone.
     *
     * @return array{0: string, 1: string|null}
     */
    private function removeSource(WingsFiles $from, string $parent, string $name): array
    {
        try {
            $this->time('delete_source', fn () => $from->client()->deleteFiles($parent, [$name]));
            $left = $this->time('confirm_delete', fn () => $this->named($from->client()->getDirectory($parent), $name));
        } catch (Throwable $exception) {
            report($exception);

            return ['move_incomplete', 'It was copied and verified, but the original could not be removed. Nothing was lost; try removing the original again.'];
        }

        return $left === null
            ? ['moved', null]
            : ['move_incomplete', 'It was copied and verified, but the original is still there. Nothing was lost; try removing the original again.'];
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  Counts  $counts
     * @param  array<string, list<array<string, mixed>>>  $listings
     */
    private function copy(WingsFiles $from, WingsFiles $to, array $entry, string $path, string $directory, string $name, string $conflict, bool $resume, int $depth, int &$budget, array &$counts, array &$listings): void
    {
        if (--$budget < 0) {
            $this->fail($counts, 'Too many files in one transfer. Choose fewer items.');

            return;
        }
        if (($entry['symlink'] ?? false) === true) {
            $this->skip($counts, 'Symbolic links are not transferred.');

            return;
        }
        $existing = $this->listing($to, $directory, $listings);
        $found = $this->named($existing, $name);

        if (! ($entry['file'] ?? false)) {
            if ($depth >= (int) config('gobia_files.transfer.max_depth')) {
                $this->fail($counts, 'Folders are nested too deeply.');

                return;
            }
            if ($found !== null && ($found['file'] ?? false)) {
                if ($conflict !== 'keep') {
                    $this->skip($counts, "A file named {$name} already exists in the destination.");

                    return;
                }
                $name = $this->unique($name, $existing);
                $found = null;
            }
            if ($found === null) {
                $this->time('create_folder', fn () => $to->client()->createDirectory($name, $directory));
                $listings[$directory][] = ['name' => $name, 'file' => false, 'size' => 0];
                $counts['copied']++;
            }
            if ($depth === 0) {
                $counts['placed'] = $name;
            }
            $inside = $this->join($directory, $name);
            foreach ($this->time('list_source', fn () => $from->client()->getDirectory($path)) as $child) {
                $this->copy($from, $to, $child, $this->join($path, (string) $child['name']), $inside, (string) $child['name'], $conflict, $resume, $depth + 1, $budget, $counts, $listings);
            }

            return;
        }

        $this->copyFile($from, $to, $entry, $path, $directory, $name, $conflict, $resume, $depth, $found, $existing, $counts, $listings);
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array<string, mixed>|null  $found
     * @param  list<array<string, mixed>>  $existing
     * @param  Counts  $counts
     * @param  array<string, list<array<string, mixed>>>  $listings
     */
    private function copyFile(WingsFiles $from, WingsFiles $to, array $entry, string $path, string $directory, string $name, string $conflict, bool $resume, int $depth, ?array $found, array $existing, array &$counts, array &$listings): void
    {
        $limit = (int) config('gobia_files.transfer.max_file_bytes');
        $hinted = isset($entry['size']) ? (int) $entry['size'] : null;
        if ($hinted !== null && $hinted > $limit) {
            $this->fail($counts, "{$name} is larger than ".$this->mib($limit).', the most one transfer carries.');

            return;
        }
        $replace = false;
        if ($found !== null) {
            if (! ($found['file'] ?? false)) {
                $this->skip($counts, "A folder named {$name} already exists in the destination.");

                return;
            }
            if ($conflict === 'skip' && ! $resume) {
                $this->skip($counts, "{$name} already exists in the destination.");

                return;
            }
            if ($conflict === 'keep' && ! $resume) {
                $name = $this->unique($name, $existing);
            } else {
                $replace = true;
            }
        }
        if ($depth === 0) {
            $counts['placed'] = $name;
        }
        if ($this->remaining !== null && $hinted !== null && $hinted > $this->remaining) {
            $this->fail($counts, "There is not enough storage left on the destination for {$name}.");

            return;
        }

        $source = WingsFiles::temp();
        $back = null;
        $temporary = self::TEMP_PREFIX.Str::lower(Str::random(12)).'.tmp';
        $uploaded = false;
        try {
            try {
                $this->time('download_source', fn () => $from->download($path, $limit, $source));
            } catch (TransferTooLargeException) {
                $this->fail($counts, "{$name} is larger than ".$this->mib($limit).', the most one transfer carries.');

                return;
            } catch (Throwable $exception) {
                if ($this->isMissing($exception)) {
                    $this->fail($counts, "{$name} no longer exists.");

                    return;
                }
                throw $exception;
            }
            $digest = WingsFiles::digest($source);
            if ($this->remaining !== null && $digest['size'] > $this->remaining) {
                $this->fail($counts, "There is not enough storage left on the destination for {$name}.");

                return;
            }

            // A move that was interrupted after the copy: an identical file at the destination counts as copied.
            if ($resume && $found !== null) {
                $present = WingsFiles::temp();
                try {
                    $this->time('verify_download', fn () => $to->download($this->join($directory, $name), $limit, $present));
                    if (WingsFiles::digest($present) === $digest) {
                        $counts['copied']++;
                        $counts['bytes'] += $digest['size'];

                        return;
                    }
                } catch (TransferTooLargeException) {
                    // Not identical: it is replaced below like any other replacement.
                } finally {
                    @unlink($present);
                }
            }

            $this->time('upload', fn () => $to->upload($this->join($directory, $temporary), $source));
            $uploaded = true;
            $back = WingsFiles::temp();
            $this->verify($to, $directory, $temporary, $digest, $back);
            $this->time('commit', function () use ($to, $directory, $temporary, $name, $replace): void {
                if ($replace) {
                    $to->client()->deleteFiles($directory, [$name]);
                }
                $to->client()->renameFiles($directory, [['from' => $temporary, 'to' => $name]]);
            });
            $uploaded = false;
        } catch (Throwable $exception) {
            if ($uploaded) {
                try {
                    $to->client()->deleteFiles($directory, [$temporary]);
                } catch (Throwable) {
                    // The temporary file is hidden by name; nothing else can be done here.
                }
            }
            if ($exception instanceof TransferIntegrityException) {
                $this->fail($counts, "{$name} did not arrive intact and was not kept.");
                unset($listings[$directory]);

                return;
            }
            throw $exception;
        } finally {
            @unlink($source);
            if ($back !== null) {
                @unlink($back);
            }
        }
        $listings[$directory][] = ['name' => $name, 'file' => true, 'size' => $digest['size']];
        $counts['copied']++;
        $counts['bytes'] += $digest['size'];
        if ($this->remaining !== null) {
            $this->remaining = max(0, $this->remaining - $digest['size']);
        }
    }

    /**
     * Reads the uploaded file back and compares it with what left the source. Files above the hash limit are compared by
     * the size the node lists (a second download of a very large file would double the transfer).
     *
     * @param  array{size: int, sha256: string}  $digest
     * @param  string  $back  a temporary file to read the copy into
     */
    private function verify(WingsFiles $to, string $directory, string $temporary, array $digest, $back): void
    {
        if ($digest['size'] <= (int) config('gobia_files.transfer.verify_hash_bytes')) {
            $this->time('verify_download', fn () => $to->download($this->join($directory, $temporary), PHP_INT_MAX, $back));
            $read = WingsFiles::digest($back);
            if ($read['size'] !== $digest['size']) {
                throw new TransferIntegrityException('The size at the destination differs.');
            }
            if (! hash_equals($digest['sha256'], $read['sha256'])) {
                throw new TransferIntegrityException('The checksum at the destination differs.');
            }

            return;
        }
        $written = $this->time('verify_list', fn () => $this->named($to->client()->getDirectory($directory), $temporary));
        if ($written === null || (int) ($written['size'] ?? -1) !== $digest['size']) {
            throw new TransferIntegrityException('The size at the destination differs.');
        }
    }

    /** Free bytes on the destination from the server's disk limit and the node's report; null when unknown or unlimited. */
    private function capacity(Server $destination): ?int
    {
        if ($destination->disk <= 0) {
            return null;
        }
        try {
            $details = $this->time('capacity', fn () => Daemon::server($destination)->details());
            $used = (int) ($details['utilization']['disk_bytes'] ?? 0);
        } catch (Throwable) {
            return null;
        }

        return max(0, $destination->disk * 1024 * 1024 - $used);
    }

    private function mib(int $bytes): string
    {
        return Str::of((string) round($bytes / 1048576))->append(' MiB')->toString();
    }

    private function isMissing(Throwable $exception): bool
    {
        return $exception instanceof RequestException && $exception->response->status() === 404;
    }

    /**
     * The entry for an item. The browser's guess about its kind saves a listing; the node still decides on read, so a
     * wrong guess only fails the item.
     *
     * @return array<string, mixed>|null
     */
    private function entry(WingsFiles $from, string $parent, string $name, ?string $kind): ?array
    {
        if ($kind === 'file') {
            return ['name' => $name, 'file' => true, 'symlink' => false];
        }
        if ($kind === 'directory') {
            return ['name' => $name, 'file' => false, 'symlink' => false];
        }

        return $this->time('list_source', fn () => $this->named($from->client()->getDirectory($parent), $name));
    }

    /**
     * @template T
     *
     * @param  callable(): T  $work
     * @return T
     */
    private function time(string $stage, callable $work): mixed
    {
        $start = hrtime(true);
        try {
            return $work();
        } finally {
            $this->timings[$stage] = ($this->timings[$stage] ?? 0.0) + (hrtime(true) - $start) / 1e6;
        }
    }

    private function server(string $uuid): Server
    {
        $server = Server::query()->where('uuid', $uuid)->with('node')->first();
        abort_if($server === null, 404, 'Server not found.');

        return $server;
    }

    private function authorize(User $user, Server $source, Server $destination, string $mode, string $conflict): void
    {
        $denied = ! $user->can('file.read', $source)
            || ! $user->can('file.read-content', $source)
            || ! $user->can('file.create', $destination)
            || ($mode === 'move' && ! $user->can('file.delete', $source))
            || ($conflict === 'replace' && ! $user->can('file.update', $destination));
        // The same answer whichever permission is missing: the response never reveals what exists on a server.
        abort_if($denied, 403, 'You are not allowed to transfer files between these servers.');

        foreach ([$source, $destination] as $server) {
            $server->validateCurrentState();
            abort_if($server->node->isUnderMaintenance(), 409, 'A node is under maintenance.');
        }
    }

    /** A clean absolute path: no traversal, no empty or dot segments, no control characters. */
    private function path(string $path): string
    {
        abort_if(preg_match('/[\x00-\x1f]/', $path) === 1 || ! str_starts_with($path, '/'), 422, 'Invalid path.');
        $parts = [];
        foreach (explode('/', $path) as $part) {
            abort_if($part === '..', 422, 'Invalid path.');
            if ($part !== '' && $part !== '.') {
                $parts[] = $part;
            }
        }

        return '/'.implode('/', $parts);
    }

    /** Server paths always use forward slashes, whatever the Panel's operating system does with dirname(). */
    private function parent(string $path): string
    {
        $cut = mb_strrpos($path, '/');

        return $cut === false || $cut === 0 ? '/' : mb_substr($path, 0, $cut);
    }

    private function base(string $path): string
    {
        return mb_substr($path, (int) mb_strrpos($path, '/') + 1);
    }

    private function join(string $directory, string $name): string
    {
        return mb_rtrim($directory, '/').'/'.$name;
    }

    /**
     * @param  list<array<string, mixed>>  $entries
     * @return array<string, mixed>|null
     */
    private function named(array $entries, string $name): ?array
    {
        foreach ($entries as $entry) {
            if (($entry['name'] ?? null) === $name) {
                return $entry;
            }
        }

        return null;
    }

    /**
     * @param  array<string, list<array<string, mixed>>>  $listings
     * @return list<array<string, mixed>>
     */
    private function listing(WingsFiles $to, string $directory, array &$listings): array
    {
        return $listings[$directory] ??= $this->time('list_destination', fn () => $to->client()->getDirectory($directory));
    }

    /** @param list<array<string, mixed>> $entries */
    private function unique(string $name, array $entries): string
    {
        $taken = array_map(fn (array $entry): string => (string) ($entry['name'] ?? ''), $entries);
        $dot = mb_strrpos($name, '.');
        $stem = $dot === false || $dot === 0 ? $name : mb_substr($name, 0, $dot);
        $extension = $dot === false || $dot === 0 ? '' : mb_substr($name, $dot);
        for ($index = 1; $index < 1000; $index++) {
            $candidate = $stem.($index === 1 ? ' (copy)' : " (copy {$index})").$extension;
            if (! in_array($candidate, $taken, true)) {
                return $candidate;
            }
        }

        return $stem.' ('.Str::random(6).')'.$extension;
    }

    /** @param Counts $counts */
    private function fail(array &$counts, string $reason): void
    {
        $counts['failed']++;
        $counts['reasons'][] = $reason;
    }

    /** @param Counts $counts */
    private function skip(array &$counts, string $reason): void
    {
        $counts['skipped']++;
        $counts['reasons'][] = $reason;
    }

    /** @return ItemResult */
    private function result(string $path, string $name, string $status, int $bytes, int $copied, int $skipped, int $failed, ?string $reason, ?string $destination): array
    {
        return compact('path', 'name', 'status', 'bytes', 'copied', 'skipped', 'failed', 'reason', 'destination');
    }
}
