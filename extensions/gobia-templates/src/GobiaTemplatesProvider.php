<?php

declare(strict_types=1);

namespace GobiaTemplates;

use GobiaTemplates\Console\ExpireTemplateInstancesCommand;
use Illuminate\Console\Scheduling\Schedule;
use Pterodactyl\Extensions\ExtensionProvider;

class GobiaTemplatesProvider extends ExtensionProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom($this->extensionPath('config', 'gobia_templates.php'), 'gobia_templates');
    }

    public function boot(): void
    {
        $this->registerApiRoutes();
        $this->registerWebRoutes($this->extensionPath('routes', 'web.php'));
        $this->loadExtensionMigrations();
        $this->registerCommands([ExpireTemplateInstancesCommand::class]);
        $this->registerSchedule(fn (Schedule $schedule) => $schedule->command('gobia-templates:expire-instances')->everyMinute()->withoutOverlapping());
    }
}
