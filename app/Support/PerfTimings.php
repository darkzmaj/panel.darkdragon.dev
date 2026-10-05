<?php

namespace Pterodactyl\Support;

/**
 * Collects how long the current request spent in the database, in Wings calls and in the cache, so the
 * Server-Timing middleware can report it. Only durations and counts are kept, never queries, URLs or tokens.
 */
class PerfTimings
{
    /** @var array<string, array{ms: float, count: int}> */
    private static array $buckets = [];

    public static function add(string $bucket, float $milliseconds): void
    {
        self::$buckets[$bucket] ??= ['ms' => 0.0, 'count' => 0];
        self::$buckets[$bucket]['ms'] += $milliseconds;
        ++self::$buckets[$bucket]['count'];
    }

    /**
     * @return array<string, array{ms: float, count: int}>
     */
    public static function all(): array
    {
        return self::$buckets;
    }

    public static function reset(): void
    {
        self::$buckets = [];
    }
}
