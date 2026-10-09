<?php

declare(strict_types=1);

namespace GobiaBackups\Services;

use DateTimeImmutable;
use GobiaBackups\Models\Policy;
use GobiaBackups\Models\Run;
use Pterodactyl\Models\Server;
use Throwable;

/**
 * The once a minute housekeeping of offsite backups: queue the backups whose schedule fires, give up on runs
 * that stopped moving, start queued runs while slots are free, and close finished restores.
 */
class Scheduler
{
    public function __construct(
        private readonly PolicyResolver $policies,
        private readonly BackupService $backups,
        private readonly RestoreService $restores,
    ) {}

    /** @return array{queued: int, started: int, timed_out: int} */
    public function tick(?DateTimeImmutable $now = null): array
    {
        $now ??= new DateTimeImmutable;
        $this->policies->forget();

        $result = ['queued' => $this->queueDue($now), 'timed_out' => $this->timeOut(), 'started' => $this->startQueued()];
        $this->restores->settle();

        return $result;
    }

    private function queueDue(DateTimeImmutable $now): int
    {
        // Nothing is scheduled anywhere unless some level switches backups on.
        if (! Policy::query()->where('enabled', true)->exists()) {
            return 0;
        }

        $queued = 0;
        Server::query()->whereNull('status')->orderBy('id')->chunkById(200, function ($servers) use ($now, &$queued): void {
            foreach ($servers as $server) {
                $policy = $this->policies->effective($server);
                if (! $policy['enabled'] || ! $this->policies->isDue($policy, $now)) {
                    continue;
                }

                try {
                    $this->backups->request($server, Run::TRIGGER_SCHEDULE);
                    $queued++;
                } catch (Throwable) {
                    // Already running, no destination, or the server cannot be backed up right now: the next
                    // time the schedule fires is the next chance.
                }
            }
        });

        return $queued;
    }

    private function timeOut(): int
    {
        $stuck = Run::query()
            ->where(fn ($query) => $query->where('state', Run::ARCHIVING)->where('heartbeat_at', '<', now()->subSeconds((int) config('gobia_backups.archive_timeout'))))
            ->orWhere(fn ($query) => $query->where('state', Run::UPLOADING)->where('heartbeat_at', '<', now()->subSeconds((int) config('gobia_backups.stale_after'))))
            ->with('server')->get();

        foreach ($stuck as $run) {
            $this->backups->fail($run, $run->state === Run::ARCHIVING ? 'Wings did not finish the archive in time.' : 'The upload stopped making progress.');
        }

        return $stuck->count();
    }

    private function startQueued(): int
    {
        $limits = (array) config('gobia_backups.concurrency');
        $active = Run::query()->whereIn('state', [Run::ARCHIVING, Run::UPLOADING])->get(['node_id', 'destination_id']);
        $perNode = $active->countBy('node_id');
        $perDestination = $active->countBy('destination_id');
        $total = $active->count();
        $started = 0;

        $waiting = Run::query()->where('state', Run::QUEUED)
            ->where(fn ($query) => $query->whereNull('retry_at')->orWhere('retry_at', '<=', now()))
            ->orderBy('id')->limit(200)->with(['server.node', 'destination'])->get();

        foreach ($waiting as $run) {
            if ($total >= (int) $limits['global']) {
                break;
            }
            if (($perNode[$run->node_id] ?? 0) >= (int) $limits['per_node'] || ($perDestination[$run->destination_id] ?? 0) >= (int) $limits['per_destination']) {
                continue;
            }

            $this->backups->start($run);
            if ($run->refresh()->state === Run::ARCHIVING) {
                $perNode[$run->node_id] = ($perNode[$run->node_id] ?? 0) + 1;
                $perDestination[$run->destination_id] = ($perDestination[$run->destination_id] ?? 0) + 1;
                $total++;
                $started++;
            }
        }

        return $started;
    }
}
