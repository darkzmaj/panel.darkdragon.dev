<?php

namespace Pterodactyl\Services\Media;

use Illuminate\Support\Facades\Route;

/**
 * Resolves the configured footer (config/gobia.php) into plain data shared with Blade and the React application.
 */
class FooterService
{
    /**
     * @return array{tagline_strong: string, tagline: string, discord_url: string|null, columns: array<int, array{title: string, links: array<int, array{label: string, href: string|null, soon: bool}>}>}
     */
    public function build(): array
    {
        $site = rtrim((string) config('gobia_ui.site_url'), '/');

        $columns = [];
        foreach ((array) config('gobia_ui.footer') as $title => $links) {
            $columns[] = [
                'title' => (string) $title,
                'links' => array_map(fn (array $link) => [
                    'label' => $link['label'],
                    'href' => empty($link['soon']) ? $this->resolve($link['href'] ?? '', $site) : null,
                    'soon' => !empty($link['soon']),
                ], $links),
            ];
        }

        return [
            'tagline_strong' => (string) config('gobia_ui.tagline_strong'),
            'tagline' => (string) config('gobia_ui.tagline'),
            'discord_url' => config('gobia_ui.discord_url') ?: null,
            'columns' => $columns,
        ];
    }

    private function resolve(string $href, string $site): string
    {
        if (str_starts_with($href, 'route:')) {
            $name = substr($href, 6);

            return Route::has($name) ? route($name, [], false) : '/';
        }

        return preg_match('#^https?://#', $href) ? $href : $site . '/' . ltrim($href, '/');
    }
}
