<?php

declare(strict_types=1);

namespace GobiaBackups\Services;

use Cron\CronExpression;
use DateTimeImmutable;
use DateTimeZone;
use GobiaBackups\Models\Destination;
use GobiaBackups\Models\Policy;
use Illuminate\Support\Collection;
use Pterodactyl\Models\Server;
use Throwable;

/**
 * Computes the policy that applies to a server: the defaults, overridden by the global level, then by the
 * server's node, then by the server itself. Only fields a level actually sets override anything.
 */
class PolicyResolver
{
    /** @var Collection<int, Policy>|null */
    private ?Collection $policies = null;

    /**
     * @return array{destination_id: int|null, enabled: bool, cron: string, timezone: string, window_start: int|null, window_end: int|null, keep_last: int, keep_days: int|null, ignored: list<string>, mirror_user_backups: bool}
     */
    public function effective(Server $server): array
    {
        $policy = Policy::DEFAULTS;
        foreach ($this->levels($server) as $level) {
            $policy = array_merge($policy, $level->overrides());
        }

        return $policy;
    }

    /** The destination a server's backups go to, or null when backups are not configured for it. */
    public function destination(Server $server): ?Destination
    {
        $id = $this->effective($server)['destination_id'];
        $destination = $id === null ? null : Destination::query()->find($id);

        return $destination !== null && $destination->enabled ? $destination : null;
    }

    /**
     * Whether a scheduled backup should start in the minute of `$now`: the cron expression fires and the minute lies
     * inside the allowed window, both read in the policy's timezone.
     *
     * @param  array{cron: string, timezone: string, window_start: int|null, window_end: int|null, ...}  $policy
     */
    public function isDue(array $policy, DateTimeImmutable $now): bool
    {
        try {
            $local = $now->setTimezone(new DateTimeZone($policy['timezone']));
            if (! (new CronExpression($policy['cron']))->isDue($local)) {
                return false;
            }
        } catch (Throwable) {
            return false;
        }

        $start = $policy['window_start'];
        $end = $policy['window_end'];
        if ($start === null || $end === null) {
            return true;
        }
        $minute = (int) $local->format('G') * 60 + (int) $local->format('i');

        // A window may cross midnight (22:00 to 04:00).
        return $start <= $end ? $minute >= $start && $minute <= $end : $minute >= $start || $minute <= $end;
    }

    public function forget(): void
    {
        $this->policies = null;
    }

    /** @return list<Policy> global first, server last */
    private function levels(Server $server): array
    {
        $this->policies ??= Policy::query()->get();

        return array_values(array_filter([
            $this->policies->firstWhere('scope', Policy::SCOPE_GLOBAL),
            $this->policies->first(fn (Policy $policy): bool => $policy->scope === Policy::SCOPE_NODE && $policy->node_id === $server->node_id),
            $this->policies->first(fn (Policy $policy): bool => $policy->scope === Policy::SCOPE_SERVER && $policy->server_id === $server->id),
        ]));
    }
}
