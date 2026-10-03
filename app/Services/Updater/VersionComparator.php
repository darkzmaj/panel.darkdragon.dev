<?php

namespace Pterodactyl\Services\Updater;

/**
 * Release-aware comparison of "<upstream>-gobia.<n>" versions, for example 1.15.1-gobia.2.
 *
 * The upstream part is compared numerically (1.15.10 > 1.15.9) and the gobia counter only
 * decides between releases of the same upstream version. Anything that does not match the
 * scheme exactly is rejected, which also keeps hostile input out of file paths and commands.
 */
class VersionComparator
{
    public const PATTERN = '/^(\d{1,4})\.(\d{1,4})\.(\d{1,4})-gobia\.(\d{1,4})$/D';

    public static function isValid(mixed $version): bool
    {
        return is_string($version) && preg_match(self::PATTERN, $version) === 1;
    }

    /**
     * @return array{int, int, int, int}
     */
    public static function parse(string $version): array
    {
        if (!preg_match(self::PATTERN, $version, $m)) {
            throw new \InvalidArgumentException('Invalid Panel version.');
        }

        return [(int) $m[1], (int) $m[2], (int) $m[3], (int) $m[4]];
    }

    /**
     * Returns -1, 0 or 1 like the spaceship operator.
     */
    public static function compare(string $a, string $b): int
    {
        return self::parse($a) <=> self::parse($b);
    }

    public static function isNewer(string $candidate, string $current): bool
    {
        return self::compare($candidate, $current) > 0;
    }

    /**
     * Strips a leading "v" from a git tag.
     */
    public static function fromTag(string $tag): ?string
    {
        $version = ltrim($tag, 'v');

        return self::isValid($version) ? $version : null;
    }
}
