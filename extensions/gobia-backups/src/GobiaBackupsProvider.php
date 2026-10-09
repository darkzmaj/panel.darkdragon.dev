<?php

declare(strict_types=1);

namespace GobiaBackups;

use GobiaBackups\Console\BackupCommand;
use GobiaBackups\Console\DestinationAddCommand;
use GobiaBackups\Console\PolicySetCommand;
use GobiaBackups\Console\TickCommand;
use GobiaBackups\Services\BackupService;
use GobiaBackups\Services\PolicyResolver;
use GobiaBackups\Storage\StoreFactory;
use Illuminate\Console\Scheduling\Schedule;
use Pterodactyl\Events\Server\OperationCompleted;
use Pterodactyl\Extensions\ExtensionProvider;

class GobiaBackupsProvider extends ExtensionProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom($this->extensionPath('config', 'gobia_backups.php'), 'gobia_backups');
        $this->app->singleton(StoreFactory::class);
        $this->app->singleton(PolicyResolver::class);
    }

    public function boot(): void
    {
        $this->registerApiRoutes();
        $this->registerWebRoutes($this->extensionPath('routes', 'web.php'));
        $this->loadExtensionMigrations();
        $this->registerCommands([TickCommand::class, DestinationAddCommand::class, PolicySetCommand::class, BackupCommand::class]);
        $this->registerSchedule(fn (Schedule $schedule) => $schedule->command('gobia-backups:tick')->everyMinute()->withoutOverlapping());

        $this->registerPermissions('Offsite backups on the Storage Box.', [
            'create' => 'Start an offsite backup of the server.',
            'restore' => 'Restore the server from one of its offsite backups, replacing its files.',
        ]);

        // Wings reports every finished backup to the Panel. That is the moment an archive is ready to be copied.
        $this->listenToServerOperations(function (OperationCompleted $event): void {
            if ($event->operation === 'backup') {
                $this->app->make(BackupService::class)->archiveFinished($event->serverUuid, $event->resourceUuid, $event->successful);
            }
        });
    }
}
