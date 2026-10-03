<?php

namespace Pterodactyl\Services\Updater;

/**
 * Removes secrets from anything that is logged, stored or shown to an administrator.
 */
class Redactor
{
    public static function scrub(string $text): string
    {
        $secrets = array_filter([
            config('gobia.update.github_token'),
            config('database.connections.' . config('database.default') . '.password'),
            config('app.key'),
        ], fn ($value) => is_string($value) && strlen($value) >= 6);

        foreach ($secrets as $secret) {
            $text = str_replace($secret, '[redacted]', $text);
        }

        $text = preg_replace('/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/', '[redacted]', $text);
        $text = preg_replace('/(authorization:\s*)(?:bearer|token|basic)\s+\S+/i', '$1[redacted]', $text);
        $text = preg_replace('/(--password=|MYSQL_PWD=|password=)\S+/i', '$1[redacted]', $text);

        return $text;
    }
}
