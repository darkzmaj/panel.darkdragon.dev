<?php

namespace Pterodactyl\Services\Templates;

use Pterodactyl\Models\Server;
use Pterodactyl\Models\TemplateInstance;

/**
 * Expands placeholders in instance names, for example "SloBlock Hub %number%".
 *
 * %number%  the next free number for that pattern. The numbers already in use are read from the names of real servers
 *           and of instances that are still being provisioned, never from database ids. The rule is deterministic:
 *           the highest number in use plus one (so 1, 2, 4 gives 5), starting at 1. Gaps are not reused, which keeps a
 *           deleted instance's name from being handed to a different server later.
 *
 * Further placeholders (for example %node% or %location%) are added to expand(); unknown tokens are left untouched.
 */
class TemplateNameService
{
    public const NUMBER = '%number%';

    public function hasPlaceholders(string $pattern): bool
    {
        return str_contains($pattern, self::NUMBER);
    }

    /**
     * The name an instance would get right now.
     */
    public function expand(string $pattern): string
    {
        if (str_contains($pattern, self::NUMBER)) {
            $pattern = str_replace(self::NUMBER, (string) $this->nextNumber($pattern), $pattern);
        }

        return $pattern;
    }

    public function nextNumber(string $pattern): int
    {
        $parts = explode(self::NUMBER, $pattern);

        // One regex for the whole name. A repeated placeholder must be the same number each time, hence "\1".
        $regex = '/^' . preg_quote($parts[0], '/');
        foreach (array_slice($parts, 1, null, true) as $index => $part) {
            $regex .= ($index === 1 ? '(\d+)' : '\1') . preg_quote($part, '/');
        }
        $regex .= '$/u';

        // Narrow the candidates in SQL by the fixed text before the first placeholder, then match exactly in PHP.
        $like = addcslashes($parts[0], '%_\\') . '%';

        $names = Server::query()->where('name', 'like', $like)->pluck('name')
            ->merge(
                TemplateInstance::query()
                    ->where('name', 'like', $like)
                    ->where('state', '!=', TemplateInstance::STATE_FAILED)
                    ->whereNull('server_id')
                    ->pluck('name')
            );

        $highest = 0;
        foreach ($names as $name) {
            if (preg_match($regex, (string) $name, $match)) {
                $highest = max($highest, (int) $match[1]);
            }
        }

        return $highest + 1;
    }
}
