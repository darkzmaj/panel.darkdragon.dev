<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use InvalidArgumentException;

/**
 * Gobia release versions: "2.0.1", or a pre-release such as "2.0.0-dev", "2.1.0-beta.2", "2.1.0-rc.1".
 *
 * Anything that does not match the scheme exactly is rejected, which also keeps hostile input out of
 * file paths and commands. A pre-release sorts before the release it leads to (2.0.0-dev < 2.0.0).
 */
class VersionComparator
{
    public const string PATTERN = '/^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-(dev|alpha|beta|rc)(?:\.(\d{1,4}))?)?$/D';

    /** Git tags of Gobia releases. The prefix keeps them apart from upstream Pterodactyl tags (v2.0.0). */
    public const string TAG_PREFIX = 'gobia-v';

    private const array STAGES = ['dev' => 0, 'alpha' => 1, 'beta' => 2, 'rc' => 3];

    private const int STABLE = 4;

    public static function isValid(mixed $version): bool
    {
        return is_string($version) && preg_match(self::PATTERN, $version) === 1;
    }

    /** A version without a pre-release suffix. Only these are offered as updates. */
    public static function isStable(string $version): bool
    {
        return self::isValid($version) && ! str_contains($version, '-');
    }

    /**
     * @return array{int, int, int, int, int}
     */
    public static function parse(string $version): array
    {
        if (preg_match(self::PATTERN, $version, $m) !== 1) {
            throw new InvalidArgumentException('Invalid Gobia version.');
        }

        $stage = ($m[4] ?? '') === '' ? self::STABLE : self::STAGES[$m[4]];

        return [(int) $m[1], (int) $m[2], (int) $m[3], $stage, (int) ($m[5] ?? 0)];
    }

    /** Returns -1, 0 or 1 like the spaceship operator. */
    public static function compare(string $a, string $b): int
    {
        return self::parse($a) <=> self::parse($b);
    }

    public static function isNewer(string $candidate, string $current): bool
    {
        return self::compare($candidate, $current) > 0;
    }

    public static function fromTag(string $tag): ?string
    {
        if (! str_starts_with($tag, self::TAG_PREFIX)) {
            return null;
        }

        $version = substr($tag, strlen(self::TAG_PREFIX));

        return self::isValid($version) ? $version : null;
    }
}
