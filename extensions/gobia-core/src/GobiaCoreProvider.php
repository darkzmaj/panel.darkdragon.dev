<?php

declare(strict_types=1);

namespace GobiaCore;

use Pterodactyl\Extensions\ExtensionProvider;

class GobiaCoreProvider extends ExtensionProvider
{
    public function boot(): void
    {
        $this->registerApiRoutes();
        $this->loadExtensionMigrations();
    }
}
