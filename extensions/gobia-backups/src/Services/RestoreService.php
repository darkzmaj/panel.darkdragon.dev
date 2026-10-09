<?php

declare(strict_types=1);

namespace GobiaBackups\Services;

use GobiaBackups\Models\Restore;
use GobiaBackups\Models\Run;
use GobiaBackups\Storage\StoreFactory;
use GobiaBackups\Support\StreamCipher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Pterodactyl\Exceptions\DisplayException;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Facades\Daemon;
use Pterodactyl\Models\Backup;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use RuntimeException;
use Throwable;

/**
 * Restores an offsite backup into a server.
 *
 * Wings already knows how to restore from a download link (that is how S3 backups are restored). The Panel hands
 * Wings a signed, short lived link to itself and, when Wings fetches it, streams the object from the Storage Box,
 * decrypting it on the way. The target can be the server the backup came from or, for an administrator, any other
 * server: the original server and its node do not have to exist any more.
 *
 * Wings reports the end of a restore against a Panel backup, so a placeholder backup exists for the duration of
 * the restore and is removed afterwards.
 */
class RestoreService
{
    public function __construct(private readonly StoreFactory $stores) {}

    /**
     * @throws DisplayException
     */
    public function request(Run $run, Server $target, ?User $by, bool $truncate): Restore
    {
        if ($run->state !== Run::COMPLETED || $run->remote_path === null) {
            throw new DisplayException('This backup cannot be restored: it is not a completed backup.');
        }
        if (! $run->destination->enabled) {
            throw new DisplayException('The destination this backup is stored on is disabled.');
        }
        $target->validateCurrentState();
        if ($target->status !== null) {
            throw new DisplayException('This server is not in a state that allows a restore.');
        }

        $restore = DB::transaction(function () use ($run, $target, $by, $truncate): Restore {
            if (Restore::query()->where('server_id', $target->id)->whereIn('state', Restore::ACTIVE)->lockForUpdate()->exists()) {
                throw new DisplayException('A restore of this server is already running.');
            }

            $placeholder = $target->backups()->create([
                'uuid' => Str::uuid()->toString(),
                'name' => 'Offsite restore of '.$run->created_at->toDateTimeString(),
                'ignored_files' => [],
                // Wings downloads the archive only for this adapter. Nothing is ever read from S3 for this row.
                'disk' => Backup::ADAPTER_AWS_S3,
                'is_locked' => true,
            ]);

            $restore = Restore::query()->create([
                'uuid' => Str::uuid()->toString(),
                'run_id' => $run->id,
                'server_id' => $target->id,
                'backup_uuid' => $placeholder->uuid,
                'requested_by' => $by?->id,
                'truncate' => $truncate,
                'state' => Restore::REQUESTED,
            ]);
            $target->update(['status' => Server::STATUS_RESTORING_BACKUP]);

            return $restore;
        });

        try {
            $placeholder = Backup::query()->where('uuid', $restore->backup_uuid)->firstOrFail();
            Daemon::server($target)->backups()->restore($placeholder, $this->link($restore), $truncate);
        } catch (Throwable $exception) {
            report($exception);
            $this->finish($restore, false, 'The node could not be asked to restore.');
            $target->update(['status' => null]);

            throw new DisplayException('The node could not be reached. Nothing was changed on the server.');
        }

        Activity::event('gobia:backup.offsite-restore-started')->subject($target)->property(['backup' => $run->uuid, 'restore' => $restore->uuid, 'truncate' => $truncate, 'from_server' => $run->server_uuid])->log();

        return $restore;
    }

    /** The link Wings downloads the archive from. Signed, and valid only for a short time. */
    public function link(Restore $restore): string
    {
        return URL::temporarySignedRoute('extensions.gobia-backups.web.fetch', now()->addMinutes((int) config('gobia_backups.restore_link_minutes', 15)), ['restore' => $restore->uuid]);
    }

    /**
     * Stream the archive of a restore to `$write`, decrypted. Called when Wings fetches the link.
     *
     * @param  callable(string): void  $write
     */
    public function stream(Restore $restore, callable $write): void
    {
        if (! in_array($restore->state, [Restore::REQUESTED, Restore::STREAMING], true)) {
            throw new RuntimeException('This restore is not waiting for a download.');
        }

        $run = $restore->run;
        $destination = $run->destination;
        $key = $run->encrypted ? base64_decode((string) $destination->encryption_key, true) : null;
        if ($run->encrypted && ($key === false || $key === null)) {
            throw new RuntimeException('The destination no longer has the encryption key of this backup.');
        }

        $restore->forceFill(['state' => Restore::STREAMING, 'transferred_bytes' => 0])->save();
        $cipher = $key === null ? null : StreamCipher::decryptor($key);
        $sent = 0;
        $beat = time();
        $store = $this->stores->open($destination);

        try {
            $store->get((string) $run->remote_path, function (string $bytes) use ($cipher, $write, &$sent, &$beat, $restore): void {
                $plain = $cipher === null ? $bytes : $cipher->update($bytes);
                if ($plain !== '') {
                    $sent += strlen($plain);
                    $write($plain);
                }
                if (time() - $beat >= 10) {
                    $beat = time();
                    $restore->forceFill(['transferred_bytes' => $sent])->save();
                }
            });
            $last = $cipher?->finish() ?? '';
            if ($last !== '') {
                $sent += strlen($last);
                $write($last);
            }
        } catch (Throwable $exception) {
            report($exception);
            $restore->forceFill(['error' => Str::limit('The archive could not be read from the Storage Box: '.$exception->getMessage(), 480)])->save();

            throw $exception;
        } finally {
            rescue(fn () => $store->close(), report: false);
        }

        if ($sent !== $run->bytes) {
            $restore->forceFill(['error' => 'The archive read back from the Storage Box has a different size than the backup.'])->save();

            throw new RuntimeException('Restored archive size mismatch.');
        }

        $restore->forceFill(['state' => Restore::UNPACKING, 'transferred_bytes' => $sent])->save();
    }

    /**
     * Close restores whose server left the "restoring" state (Wings reported the end), and give up on restores
     * that never got anywhere. Called every minute by the scheduler.
     */
    public function settle(): void
    {
        foreach (Restore::query()->whereIn('state', Restore::ACTIVE)->with(['server', 'run'])->get() as $restore) {
            $server = $restore->server;
            if ($server->status === Server::STATUS_RESTORING_BACKUP) {
                if ($restore->created_at->lt(now()->subSeconds((int) config('gobia_backups.transfer_timeout')))) {
                    $server->update(['status' => null]);
                    $this->finish($restore, false, 'The restore did not finish in time.');
                }

                continue;
            }

            // Wings reports the outcome against the placeholder backup; without a report, a restore whose archive was
            // handed over completely counts as done.
            $successful = $this->reportedOutcome($restore) ?? ($restore->state === Restore::UNPACKING);
            $this->finish($restore, $successful, $successful ? null : ($restore->error ?? 'Wings reported that the restore failed.'));
        }
    }

    private function finish(Restore $restore, bool $successful, ?string $error): void
    {
        $restore->forceFill(['state' => $successful ? Restore::COMPLETED : Restore::FAILED, 'error' => $successful ? null : $error, 'completed_at' => now()])->save();
        Backup::query()->where('uuid', $restore->backup_uuid)->forceDelete();

        Activity::event($successful ? 'gobia:backup.offsite-restore-completed' : 'gobia:backup.offsite-restore-failed')
            ->subject($restore->server)->property(['restore' => $restore->uuid, 'backup' => $restore->run->uuid, 'reason' => $error])->log();
    }

    /** What Wings reported for the placeholder backup: true, false, or null when it reported nothing. */
    private function reportedOutcome(Restore $restore): ?bool
    {
        $backup = Backup::query()->where('uuid', $restore->backup_uuid)->first();
        if ($backup === null) {
            return null;
        }

        $event = DB::table('activity_log_subjects as s')
            ->join('activity_logs as l', 'l.id', '=', 's.activity_log_id')
            ->where('s.subject_type', $backup->getMorphClass())
            ->where('s.subject_id', $backup->id)
            ->whereIn('l.event', ['server:backup.restore-complete', 'server:backup.restore-failed'])
            ->orderByDesc('l.id')
            ->value('l.event');

        return $event === null ? null : $event === 'server:backup.restore-complete';
    }
}
