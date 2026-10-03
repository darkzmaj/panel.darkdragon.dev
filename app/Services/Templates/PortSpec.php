<?php

namespace Pterodactyl\Services\Templates;

/**
 * Parses a preferred port list such as "25565,25570-25580" into individual ports.
 */
class PortSpec
{
    public const MAX_PORTS = 512;

    /**
     * @return int[]|null null when the specification is malformed
     */
    public static function parse(?string $spec): ?array
    {
        $spec = trim((string) $spec);
        if ($spec === '') {
            return [];
        }

        $ports = [];
        foreach (explode(',', $spec) as $part) {
            $part = trim($part);
            if (preg_match('/^(\d{1,5})$/', $part, $m)) {
                $range = [(int) $m[1], (int) $m[1]];
            } elseif (preg_match('/^(\d{1,5})\s*-\s*(\d{1,5})$/', $part, $m)) {
                $range = [(int) $m[1], (int) $m[2]];
            } else {
                return null;
            }

            [$from, $to] = $range;
            if ($from < 1 || $to > 65535 || $from > $to || count($ports) + ($to - $from + 1) > self::MAX_PORTS) {
                return null;
            }
            for ($port = $from; $port <= $to; ++$port) {
                $ports[$port] = $port;
            }
        }

        return array_values($ports);
    }
}
