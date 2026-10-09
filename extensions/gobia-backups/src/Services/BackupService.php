<?php

declare(strict_types=1);

namespace GobiaBackups\Services;

use Carbon\CarbonImmutable;
use GobiaBackups\Jobs\UploadBackupJob;
use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Run;
use GobiaBackups\Storage\RemoteStore;
use GobiaBackups\Storage\StoreFactory;
use GobiaBackups\Support\StreamCipher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Exceptions\Http\Connection\DaemonConnectionException;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use RuntimeException;
use Throwable;

/**
 * An offsite backup from request to a verified object on the Storage Box.
 *
 * Wings builds the archive on the node exactly as it does for an ordinary backup. The Panel then streams that
 * archive from the node to the Storage Box, encrypting it on the way when the destination asks for that, without
 * writing it to the Panel's disk and without holding more than a frame of it in memory. The object is written
 * under a temporary name, checked (size always, SHA-256 when the box can compute it) and only then renamed, so a
 * failed or interrupted upload never looks like a backup. The archive on the node is removed once the copy is
 * verified, unless the backup was one a person made themselves.
 */
class BackupService
{
    public function __construct(
        private readonly PolicyResolver $policies,
        private readonly StoreFactory $stores,
        private readonly WingsArchive $archives,
        private readonly RetentionService $retention,
    ) {}

    /**
     * Queue an offsite backup of a server. It starts when a slot is free (see the scheduler tick).
     *
     * @throws DisplayException
     */
    public function request(Server $server, string $trigger, ?User $by = null): Run
    {
        $destination = $this->policies->destination($server);
        if ($destination === null) {
            throw new DisplayException('Offsite backups are not set up for this server.');
        }
        $server->validateCurrentState();

        return DB::transaction(function () use ($server, $trigger, $by, $destination): Run {
            // One at a time per server: a second archive of the same files would only compete for the node's disk.
            $active = Run::query()->where('server_uuid', $server->uuid)->whereIn('state', Run::ACTIVE)->lockForUpdate()->exists();
            if ($active) {
                throw new DisplayException('An offsite backup of this server is already running.');
            }

            return $this->newRun($server, $destination, $trigger, $by?->id);
        });
    }

    /** Ask Wings to build the archive for a queued run. */
    public function start(Run $run): void
    {
        // Loaded on its own, not as part of a list: the state checks below read several of its relations.
        $server = $run->server_id === null ? null : Server::query()->find($run->server_id);
        if ($server === null) {
            $this->fail($run, 'The server no longer exists.', final: true);

            return;
        }

        try {
            $server->validateCurrentState();
            $policy = $this->policies->effective($server);
            $backup = $server->backups()->create([
                'uuid' => Str::uuid()->toString(),
                'name' => 'Offsite backup '.CarbonImmutable::now()->toDateTimeString(),
                'ignored_files' => array_values($policy['ignored']),
                'disk' => Backup::ADAPTER_WINGS,
                // Locked so nobody deletes the archive from under the upload; the Panel removes it afterwards.
                'is_locked' => true,
            ]);
            $run->forceFill(['backup_uuid' => $backup->uuid, 'state' => Run::ARCHIVING, 'attempts' => $run->attempts + 1, 'started_at' => now(), 'heartbeat_at' => now(), 'error' => null, 'retry_at' => null])->save();
            Daemon::server($server)->backups()->create($backup, Backup::ADAPTER_WINGS);
        } catch (Throwable $exception) {
            report($exception);
            $this->fail($run, $exception instanceof DaemonConnectionException ? 'The node could not be reached.' : 'The backup could not be started: '.Str::limit($exception->getMessage(), 200));
        }
    }

    /**
     * Wings finished (or failed) building a backup. Runs waiting for that archive move on to the upload; with
     * "mirror" enabled, a backup a person made is copied too and stays on the node.
     */
    public function archiveFinished(string $serverUuid, string $backupUuid, bool $successful): void
    {
        $run = Run::query()->where('backup_uuid', $backupUuid)->where('state', Run::ARCHIVING)->first();
        if ($run !== null) {
            if (! $successful) {
                $this->fail($run, 'Wings could not build the archive.');

                return;
            }
            // The size is known now, so progress can be shown while the upload runs.
            $run->forceFill(['state' => Run::UPLOADING, 'heartbeat_at' => now(), 'bytes' => (int) Backup::query()->where('uuid', $backupUuid)->value('bytes')])->save();
            UploadBackupJob::dispatch($run);

            return;
        }

        if (! $successful || Run::query()->where('backup_uuid', $backupUuid)->exists()) {
            return;
        }

        $server = Server::query()->where('uuid', $serverUuid)->first();
        if ($server === null || ! $this->policies->effective($server)['mirror_user_backups']) {
            return;
        }
        $destination = $this->policies->destination($server);
        $backup = Backup::query()->where('uuid', $backupUuid)->first();
        if ($destination === null || $backup === null || $backup->disk !== Backup::ADAPTER_WINGS) {
            return;
        }

        $run = $this->newRun($server, $destination, Run::TRIGGER_MIRROR, null);
        $run->forceFill(['backup_uuid' => $backupUuid, 'state' => Run::UPLOADING, 'keep_local' => true, 'attempts' => 1, 'started_at' => now(), 'heartbeat_at' => now(), 'bytes' => (int) $backup->bytes])->save();
        UploadBackupJob::dispatch($run);
    }

    /**
     * Stream the archive from the node to the Storage Box, verify it and finish the run.
     */
    public function upload(Run $run): void
    {
        // A queue worker lives for a long time; read the policies as they are now.
        $this->policies->forget();
        $server = $run->server;
        $backup = $run->backup_uuid === null ? null : Backup::query()->where('uuid', $run->backup_uuid)->first();
        if ($server === null || $backup === null || ! $backup->is_successful) {
            $this->fail($run, 'The archive is no longer available on the node.');

            return;
        }

        $destination = $run->destination;
        $key = $destination->encrypt ? base64_decode((string) $destination->encryption_key, true) : null;
        if ($destination->encrypt && ($key === false || $key === null || strlen($key) !== StreamCipher::KEY_BYTES)) {
            $this->fail($run, 'The destination has no usable encryption key.', final: true);

            return;
        }

        $final = $run->server_uuid.'/'.$run->uuid.'.tar.gz'.($key === null ? '' : '.gbk');
        $temporary = $final.'.part';
        $store = null;

        try {
            $store = $this->stores->open($destination);
            $store->makeDirectory($run->server_uuid);
            $sent = $this->transfer($run, $store, $temporary, $this->archives->open($server, $backup), $key);

            $this->assertArchiveMatches($backup, $sent);
            $verifiedBy = $this->verifyStored($store, $temporary, $sent);
            $store->rename($temporary, $final);
        } catch (Throwable $exception) {
            report($exception);
            rescue(fn () => $store?->delete($temporary), report: false);
            rescue(fn () => $store?->close(), report: false);
            $this->fail($run, Str::limit($exception->getMessage(), 300));

            return;
        }
        rescue(fn () => $store->close(), report: false);

        $run->forceFill([
            'state' => Run::COMPLETED,
            'encrypted' => $key !== null,
            'remote_path' => $final,
            'bytes' => $sent['bytes'],
            'archive_sha256' => $sent['sha256'],
            'stored_bytes' => $sent['stored_bytes'],
            'stored_sha256' => $sent['stored_sha256'],
            'transferred_bytes' => $sent['bytes'],
            'verified_by' => $verifiedBy,
            'error' => null,
            'completed_at' => now(),
            'heartbeat_at' => now(),
        ])->save();

        Activity::event('gobia:backup.offsite-completed')->subject($server)->property(['backup' => $run->uuid, 'bytes' => $sent['bytes'], 'trigger' => $run->trigger, 'verified_by' => $verifiedBy])->log();

        if (! $run->keep_local) {
            $this->removeFromNode($run);
        }
        rescue(fn () => $this->retention->apply($server, $destination, $this->policies->effective($server)));
    }

    /**
     * Record a failure. The archive on the node is dropped, and the run goes back to the queue until its attempts
     * are used up.
     */
    public function fail(Run $run, string $message, bool $final = false): void
    {
        if (! $run->keep_local) {
            $this->removeFromNode($run);
        }

        $retry = ! $final && $run->trigger !== Run::TRIGGER_MIRROR && $run->attempts < (int) config('gobia_backups.attempts');
        $run->forceFill([
            'state' => $retry ? Run::QUEUED : Run::FAILED,
            'backup_uuid' => $run->keep_local ? $run->backup_uuid : null,
            'error' => Str::limit($message, 480),
            'retry_at' => $retry ? now()->addSeconds((int) config('gobia_backups.retry_after')) : null,
            'completed_at' => $retry ? null : now(),
        ])->save();

        if (! $retry && $run->server !== null) {
            Activity::event('gobia:backup.offsite-failed')->subject($run->server)->property(['backup' => $run->uuid, 'reason' => $run->error, 'attempts' => $run->attempts])->log();
        }
    }

    /** Remove a stored backup from the Storage Box. The row stays as history. */
    public function delete(Run $run): void
    {
        if ($run->isActive()) {
            throw new DisplayException('A backup that is still running cannot be deleted.');
        }
        if ($run->remote_path !== null) {
            $store = $this->stores->open($run->destination);
            try {
                $store->delete($run->remote_path);
            } finally {
                $store->close();
            }
        }
        $run->forceFill(['state' => Run::DELETED, 'remote_path' => null])->save();
    }

    private function newRun(Server $server, Destination $destination, string $trigger, ?int $requestedBy): Run
    {
        return Run::query()->create([
            'uuid' => Str::uuid()->toString(),
            'server_id' => $server->id,
            'server_uuid' => $server->uuid,
            'server_name' => $server->name,
            'node_id' => $server->node_id,
            'destination_id' => $destination->id,
            'trigger' => $trigger,
            'requested_by' => $requestedBy,
            'state' => Run::QUEUED,
        ]);
    }

    /**
     * @return array{bytes: int, sha1: string, sha256: string, stored_bytes: int, stored_sha256: string}
     */
    private function transfer(Run $run, RemoteStore $store, string $path, \Psr\Http\Message\StreamInterface $archive, ?string $key): array
    {
        $cipher = $key === null ? null : StreamCipher::encryptor($key);
        $sha1 = hash_init('sha1');
        $sha256 = hash_init('sha256');
        $stored = hash_init('sha256');
        $bytes = 0;
        $storedBytes = 0;
        $buffer = '';
        $ended = false;
        $beat = time();

        $store->put($path, function (int $length) use ($archive, $cipher, $sha1, $sha256, $stored, &$bytes, &$storedBytes, &$buffer, &$ended, &$beat, $run): ?string {
            // The store asks for at most $length bytes at a time; encryption produces output in its own rhythm,
            // so what is ready is kept in a small buffer and handed out in the size that was asked for.
            while (! $ended && strlen($buffer) < $length) {
                $chunk = $archive->eof() ? '' : $archive->read(StreamCipher::CHUNK);
                if ($chunk === '' && $archive->eof()) {
                    $buffer .= $cipher?->finish() ?? '';
                    $ended = true;
                    break;
                }
                $bytes += strlen($chunk);
                hash_update($sha1, $chunk);
                hash_update($sha256, $chunk);
                $buffer .= $cipher === null ? $chunk : $cipher->update($chunk);
            }
            if ($buffer === '') {
                return null;
            }

            $out = substr($buffer, 0, $length);
            $buffer = (string) substr($buffer, strlen($out));
            $storedBytes += strlen($out);
            hash_update($stored, $out);

            if (time() - $beat >= 10) {
                $beat = time();
                $run->forceFill(['transferred_bytes' => $bytes, 'heartbeat_at' => now()])->save();
            }

            return $out;
        });

        return ['bytes' => $bytes, 'sha1' => hash_final($sha1), 'sha256' => hash_final($sha256), 'stored_bytes' => $storedBytes, 'stored_sha256' => hash_final($stored)];
    }

    /**
     * What arrived from the node must be the archive Wings reported: same size, and the same checksum when Wings
     * gave one in an algorithm that was computed here.
     *
     * @param  array{bytes: int, sha1: string, sha256: string, ...}  $sent
     */
    private function assertArchiveMatches(Backup $backup, array $sent): void
    {
        if ($backup->bytes > 0 && $backup->bytes !== $sent['bytes']) {
            throw new RuntimeException(sprintf('The node sent %d bytes but the archive is %d bytes.', $sent['bytes'], $backup->bytes));
        }
        [$type, $checksum] = array_pad(explode(':', (string) $backup->checksum, 2), 2, '');
        if (isset($sent[$type]) && $checksum !== '' && ! hash_equals(strtolower($checksum), (string) $sent[$type])) {
            throw new RuntimeException('The archive received from the node does not match the checksum Wings reported.');
        }
    }

    /**
     * @param  array{stored_bytes: int, stored_sha256: string, ...}  $sent
     * @return 'sha256'|'size'
     */
    private function verifyStored(RemoteStore $store, string $path, array $sent): string
    {
        $size = $store->size($path);
        if ($size !== $sent['stored_bytes']) {
            throw new RuntimeException(sprintf('The Storage Box holds %s bytes but %d were sent.', $size === null ? 'no' : (string) $size, $sent['stored_bytes']));
        }

        $remote = $store->sha256($path);
        if ($remote === null) {
            return 'size';
        }
        if (! hash_equals($sent['stored_sha256'], $remote)) {
            throw new RuntimeException('The Storage Box reports a different SHA-256 than what was sent.');
        }

        return 'sha256';
    }

    /** Delete the archive from the node and forget the Panel backup that only existed to build it. */
    private function removeFromNode(Run $run): void
    {
        $backup = $run->backup_uuid === null ? null : Backup::query()->where('uuid', $run->backup_uuid)->first();
        if ($backup === null) {
            return;
        }

        rescue(fn () => Daemon::server($backup->server)->backups()->delete($backup), report: false);
        // Removed completely, not soft deleted: it must not count towards the server's backup limit or throttle.
        $backup->forceDelete();
    }
}
