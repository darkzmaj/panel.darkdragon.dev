<?php

namespace Pterodactyl\Console\Commands\Update;

use Illuminate\Console\Command;
use Pterodactyl\Services\Updater\UpdateService;

class UpdateCheckCommand extends Command
{
    protected $signature = 'gobia:update:check {--refresh : Ignore the cached result and ask the update source}';

    protected $description = 'Check whether a newer Panel release is available.';

    public function handle(UpdateService $updates): int
    {
        $result = $updates->check((bool) $this->option('refresh'));
        $this->line('Installed: ' . $updates->currentVersion() . ' (Pterodactyl ' . config('app.upstream_version') . ' base)');

        if ($result['error'] !== null) {
            $this->error('Update check failed: ' . $result['error']);

            return 1;
        }

        if ($result['release'] === null) {
            $this->line('The update source has no releases yet.');
        } elseif ($result['available']) {
            $this->info('Update available: ' . $result['release']['version'] . ' - run "php artisan gobia:update:run" or use Admin -> Updates.');
        } else {
            $this->info('Up to date (latest release: ' . $result['release']['version'] . ').');
        }

        return 0;
    }
}
