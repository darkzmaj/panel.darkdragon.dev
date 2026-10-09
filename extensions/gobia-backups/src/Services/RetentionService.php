<?php

declare(strict_types=1);

namespace GobiaBackups\Services;

use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Run;
use GobiaBackups\Storage\StoreFactory;
use Pterodactyl\Models\Server;

/**
 * Removes old backups of one server from one destination. It only ever runs after a new backup was verified,
 * only counts verified backups, and never removes the newest one, so a server that has a backup keeps one.
 */
class RetentionService
{
    public function __construct(private readonly StoreFactory $stores) {}

    /**
     * @param  array{keep_last: int, keep_days: int|null, ...}  $policy
     * @return int how many backups were removed
     */
    public function apply(Server $server, Destination $destination, array $policy): int
    {
        $completed = Run::query()
            ->where('server_uuid', $server->uuid)
            ->where('destination_id', $destination->id)
            ->where('state', Run::COMPLETED)
            ->orderByDesc('completed_at')->orderByDesc('id')
            ->get();

        $keep = max(1, (int) $policy['keep_last']);
        $cutoff = $policy['keep_days'] === null ? null : now()->subDays((int) $policy['keep_days']);
        $expired = $completed->values()->filter(fn (Run $run, int $index): bool => $index > 0 && ($index >= $keep || ($cutoff !== null && $run->completed_at !== null && $run->completed_at->lt($cutoff))));
        if ($expired->isEmpty()) {
            return 0;
        }

        $store = $this->stores->open($destination);
        $removed = 0;
        try {
            foreach ($expired as $run) {
                if ($run->remote_path !== null) {
                    $store->delete($run->remote_path);
                }
                $run->forceFill(['state' => Run::DELETED, 'remote_path' => null])->save();
                $removed++;
            }
        } finally {
            $store->close();
        }

        return $removed;
    }
}
