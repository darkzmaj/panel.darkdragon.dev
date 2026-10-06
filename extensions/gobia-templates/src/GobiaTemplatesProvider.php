<?php

declare(strict_types=1);

namespace GobiaTemplates;

use GobiaTemplates\Console\ExpireTemplateInstancesCommand;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;
use Pterodactyl\Extensions\ExtensionProvider;

class GobiaTemplatesProvider extends ExtensionProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom($this->extensionPath('config', 'gobia_templates.php'), 'gobia_templates');
    }

    public function boot(): void
    {
        // A trailing newline is part of a file: saving template files must not trim the content (global middleware cannot be
        // excluded per route, so this exempts exactly that request).
        TrimStrings::skipWhen(fn (Request $request): bool => $request->isMethod('PUT') && $request->is('api/admin/extensions/gobia-templates/templates/*/files'));
        $this->registerApiRoutes();
        $this->registerWebRoutes($this->extensionPath('routes', 'web.php'));
        $this->loadExtensionMigrations();
        $this->registerCommands([ExpireTemplateInstancesCommand::class]);
        $this->registerSchedule(fn (Schedule $schedule) => $schedule->command('gobia-templates:expire-instances')->everyMinute()->withoutOverlapping());
    }
}
