<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

/**
 * Removes secrets from anything that is logged, stored or shown to an administrator.
 */
class Redactor
{
    public static function scrub(string $text): string
    {
        $secrets = array_filter([
            config('gobia_updater.github_token'),
            config('database.connections.'.config('database.default').'.password'),
            config('app.key'),
        ], fn ($value): bool => is_string($value) && strlen($value) >= 6);

        foreach ($secrets as $secret) {
            $text = str_replace($secret, '[redacted]', $text);
        }

        foreach ([
            '/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/' => '[redacted]',
            '/(authorization:\s*)(?:bearer|token|basic)\s+\S+/i' => '$1[redacted]',
            '/(--password=|--secret=|MYSQL_PWD=|password=)\S+/i' => '$1[redacted]',
        ] as $pattern => $replacement) {
            $text = preg_replace($pattern, $replacement, $text) ?? $text;
        }

        return $text;
    }
}
