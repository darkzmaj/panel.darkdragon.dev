<?php

declare(strict_types=1);

namespace GobiaFiles;

use Pterodactyl\Extensions\ExtensionProvider;

class GobiaFilesProvider extends ExtensionProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom($this->extensionPath('config', 'gobia_files.php'), 'gobia_files');
    }

    public function boot(): void
    {
        $this->registerApiRoutes();
    }
}
