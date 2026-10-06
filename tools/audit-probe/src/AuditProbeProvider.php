<?php

namespace AuditProbe;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Extensions\ExtensionProvider;
use Pterodactyl\Services\Extensions\ExtensionSettingDefinition;
use Pterodactyl\Services\Extensions\ExtensionSettingsDefinition;

class AuditProbeProvider extends ExtensionProvider
{
    public function boot(): void
    {
        $this->registerApiRoutes();
        $this->loadExtensionMigrations();
        $this->registerPermissions('Audit probe', ['view' => 'View the probe.', 'write' => 'Write probe items.']);
        $this->registerSettings(new ExtensionSettingsDefinition($this->settings(), [
            ExtensionSettingDefinition::make('greeting', 'greeting', 'hello', ['string', 'max:50'])->label('Greeting')->frontend(),
            ExtensionSettingDefinition::make('api_token', 'api_token', '', ['nullable', 'string'])->field('password')->secret()->label('Token'),
        ]));
        $this->listenToServerOperations(function ($result): void {
            DB::table('audit_probe_items')->insert(['server_uuid' => $result->serverUuid, 'label' => 'op:'.$result->operation.':'.($result->successful ? 'ok' : 'fail'), 'created_at' => now(), 'updated_at' => now()]);
        });
        $this->registerSchedule(fn (Schedule $schedule) => $schedule->call(fn () => null)->hourly());
    }
}
