<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

/**
 * The byte string a release manifest is signed over. It has no dependencies on purpose:
 * scripts/release/sign.php loads this one file so the release pipeline and the Panel can never disagree.
 *
 * The whole manifest is covered (version, base, checksum, size, migration summary, requirements),
 * so none of it can be altered without the private key.
 */
final class ReleaseSignature
{
    public const string CONTEXT = 'gobia-release-v2';

    /** @param array<string, mixed> $manifest */
    public static function message(array $manifest): string
    {
        unset($manifest['signature']);

        return self::CONTEXT."\n".json_encode(self::canonical($manifest), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /** Objects get their keys sorted at every depth; lists keep their order. */
    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (! array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        return array_map(self::canonical(...), $value);
    }
}
