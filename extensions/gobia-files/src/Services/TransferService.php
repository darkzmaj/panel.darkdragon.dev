<?php

declare(strict_types=1);

namespace GobiaFiles\Services;

use Illuminate\Support\Str;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Daemon\FilesClient;
use Throwable;

/**
 * Copies or moves files and folders from one server to another through the Panel.
 *
 * Authorization is checked on both servers with the permissions the file endpoints use: reading the source needs
 * `file.read` and `file.read-content`, writing the destination `file.create` (and `file.update` to replace), and a move
 * also `file.delete` on the source. Nothing is trusted from the browser except the choice of items.
 *
 * A file is written to a temporary name beside its destination, verified (size, and a SHA-256 read back for files up to
 * the configured limit) and only then renamed into place, so a failed or interrupted transfer never leaves a partial
 * file under the real name. A move removes a source only after every file inside it was verified at the destination.
 *
 * @phpstan-type Counts array{copied: int, skipped: int, failed: int, bytes: int, reasons: list<string>}
 * @phpstan-type ItemResult array{path: string, name: string, status: string, bytes: int, copied: int, skipped: int, failed: int, reason: string|null}
 */
final class TransferService
{
    private const string TEMP_PREFIX = '.gobia-transfer-';

    /**
     * @param  list<string>  $items
     * @return array{source: Server, destination: Server, directory: string, items: list<ItemResult>, bytes: int}
     */
    public function transfer(User $user, string $sourceUuid, string $destinationUuid, string $directory, array $items, string $mode, string $conflict): array
    {
        $source = $this->server($sourceUuid);
        $destination = $this->server($destinationUuid);
        $this->authorize($user, $source, $destination, $mode, $conflict);

        $target = $this->path($directory);
        $from = Daemon::server($source)->files();
        $to = Daemon::server($destination)->files();
        $same = $source->is($destination);
        $budget = (int) config('gobia_files.transfer.max_entries');

        $results = [];
        $total = 0;
        foreach ($items as $raw) {
            $path = $this->path($raw);
            $name = $this->base($path);
            if ($path === '/') {
                $results[] = $this->result($path, '/', 'failed', 0, 0, 0, 1, 'The server root cannot be transferred.');

                continue;
            }
            $parent = $this->parent($path);
            if ($same && $mode === 'move' && ($target === $path || str_starts_with($target.'/', $path.'/'))) {
                $results[] = $this->result($path, $name, 'failed', 0, 0, 0, 1, 'A folder cannot be moved into itself.');

                continue;
            }
            if ($same && $mode === 'move' && $parent === $target) {
                $results[] = $this->result($path, $name, 'skipped', 0, 0, 1, 0, 'It is already in that folder.');

                continue;
            }

            try {
                $entry = $this->find($from, $parent, $name);
                if ($entry === null) {
                    $results[] = $this->result($path, $name, 'failed', 0, 0, 0, 1, 'It no longer exists.');

                    continue;
                }
                $counts = ['copied' => 0, 'skipped' => 0, 'failed' => 0, 'bytes' => 0, 'reasons' => []];
                $listings = [];
                $this->copy($from, $to, $entry, $path, $target, $name, $conflict, 0, $budget, $counts, $listings);
            } catch (Throwable $exception) {
                report($exception);
                $results[] = $this->result($path, $name, 'failed', 0, 0, 0, 1, 'A server could not be reached or refused the request.');

                continue;
            }

            $status = $counts['failed'] > 0 ? ($counts['copied'] > 0 ? 'partial' : 'failed') : ($counts['copied'] === 0 && $counts['skipped'] > 0 ? 'skipped' : 'copied');
            $reason = $counts['reasons'][0] ?? null;
            if ($mode === 'move' && $counts['failed'] === 0 && $counts['skipped'] === 0 && $counts['copied'] > 0) {
                try {
                    $from->deleteFiles($parent, [$name]);
                    $status = 'moved';
                } catch (Throwable $exception) {
                    report($exception);
                    $status = 'copied';
                    $reason = 'It was copied and verified, but the original could not be removed.';
                }
            } elseif ($mode === 'move' && $status === 'copied') {
                $reason = 'The original was kept because something inside it was skipped.';
            }
            $total += $counts['bytes'];
            $results[] = $this->result($path, $name, $status, $counts['bytes'], $counts['copied'], $counts['skipped'], $counts['failed'], $reason);
        }

        return ['source' => $source, 'destination' => $destination, 'directory' => $target, 'items' => $results, 'bytes' => $total];
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  Counts  $counts
     * @param  array<string, list<array<string, mixed>>>  $listings
     */
    private function copy(FilesClient $from, FilesClient $to, array $entry, string $path, string $directory, string $name, string $conflict, int $depth, int &$budget, array &$counts, array &$listings): void
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
                $to->createDirectory($name, $directory);
                unset($listings[$directory]);
                $counts['copied']++;
            }
            $inside = $this->join($directory, $name);
            foreach ($from->getDirectory($path) as $child) {
                $this->copy($from, $to, $child, $this->join($path, (string) $child['name']), $inside, (string) $child['name'], $conflict, $depth + 1, $budget, $counts, $listings);
            }

            return;
        }

        $size = (int) ($entry['size'] ?? 0);
        $limit = (int) config('gobia_files.transfer.max_file_bytes');
        if ($size > $limit) {
            $this->fail($counts, "{$name} is larger than ".Str::of((string) round($limit / 1048576))->append(' MiB, the most that can be carried between servers.'));

            return;
        }
        $replace = false;
        if ($found !== null) {
            if (! ($found['file'] ?? false)) {
                $this->skip($counts, "A folder named {$name} already exists in the destination.");

                return;
            }
            if ($conflict === 'skip') {
                $this->skip($counts, "{$name} already exists in the destination.");

                return;
            }
            if ($conflict === 'keep') {
                $name = $this->unique($name, $existing);
            } else {
                $replace = true;
            }
        }

        $content = $from->getContent($path, $limit);
        $temporary = self::TEMP_PREFIX.Str::lower(Str::random(12)).'.tmp';
        $to->putContent($this->join($directory, $temporary), $content);
        try {
            $this->verify($to, $directory, $temporary, $content);
            if ($replace) {
                $to->deleteFiles($directory, [$name]);
            }
            $to->renameFiles($directory, [['from' => $temporary, 'to' => $name]]);
        } catch (Throwable $exception) {
            try {
                $to->deleteFiles($directory, [$temporary]);
            } catch (Throwable) {
                // The temporary file is hidden by name; nothing else can be done here.
            }
            if ($exception instanceof TransferIntegrityException) {
                $this->fail($counts, "{$name} did not arrive intact and was not kept.");
                unset($listings[$directory]);

                return;
            }
            throw $exception;
        }
        unset($listings[$directory]);
        $counts['copied']++;
        $counts['bytes'] += mb_strlen($content);
    }

    private function verify(FilesClient $to, string $directory, string $temporary, string $content): void
    {
        $written = $this->named($to->getDirectory($directory), $temporary);
        if ($written === null || (int) ($written['size'] ?? -1) !== mb_strlen($content)) {
            throw new TransferIntegrityException('The size at the destination differs.');
        }
        if (mb_strlen($content) <= (int) config('gobia_files.transfer.verify_hash_bytes')) {
            $back = $to->getContent($this->join($directory, $temporary));
            if (! hash_equals(hash('sha256', $content), hash('sha256', $back))) {
                throw new TransferIntegrityException('The checksum at the destination differs.');
            }
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

    /** @return array<string, mixed>|null */
    private function find(FilesClient $files, string $directory, string $name): ?array
    {
        return $this->named($files->getDirectory($directory), $name);
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
    private function listing(FilesClient $to, string $directory, array &$listings): array
    {
        return $listings[$directory] ??= $this->safeList($to, $directory);
    }

    /** @return list<array<string, mixed>> */
    private function safeList(FilesClient $to, string $directory): array
    {
        return $to->getDirectory($directory);
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
    private function result(string $path, string $name, string $status, int $bytes, int $copied, int $skipped, int $failed, ?string $reason): array
    {
        return compact('path', 'name', 'status', 'bytes', 'copied', 'skipped', 'failed', 'reason');
    }
}
