<?php

namespace Pterodactyl\Console\Commands\Update;

use Illuminate\Console\Command;
use Pterodactyl\Services\Updater\RunStore;
use Pterodactyl\Services\Updater\UpdateOrchestrator;
use Pterodactyl\Services\Updater\Runners\DeploymentRunner;

class UpdateRecoverCommand extends Command
{
    protected $signature = 'gobia:update:recover {--force-up : Leave maintenance mode even if the last rollback failed}';

    protected $description = 'Clean up after an update whose worker died, and optionally leave maintenance mode.';

    public function handle(RunStore $store, UpdateOrchestrator $orchestrator, DeploymentRunner $runner): int
    {
        $active = $store->active();
        if ($active !== null && $store->isStale($active)) {
            $run = $orchestrator->recover($active);
            $this->line('Recovered run ' . $run['id'] . ': ' . $run['result']);
        } elseif ($active !== null) {
            $this->warn('Run ' . $active['id'] . ' is still active; nothing to recover.');

            return 1;
        } else {
            $this->line('No stale update run.');
        }

        if ($this->option('force-up')) {
            $runner->artisan('up');
            $this->info('Maintenance mode is off.');
        }

        return 0;
    }
}
