<?php

namespace Pterodactyl\Extensions\Themes;

class Theme
{
    public function js($path): string
    {
        return sprintf('<script src="%s"></script>' . PHP_EOL, $this->getUrl($path));
    }

    public function css($path): string
    {
        return sprintf('<link media="all" type="text/css" rel="stylesheet" href="%s"/>' . PHP_EOL, $this->getUrl($path));
    }

    protected function getUrl($path): string
    {
        // Tie cache busting to the Panel version so browsers fetch fresh assets after an update.
        return str_replace('{cache-version}', substr(md5(config('app.version')), 0, 8), '/themes/pterodactyl/' . ltrim($path, '/'));
    }
}
