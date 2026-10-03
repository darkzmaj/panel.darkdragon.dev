<?php

namespace Pterodactyl\Console\Commands\Update;

use Illuminate\Console\Command;
use Pterodactyl\Services\Updater\UpdateOrchestrator;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

class UpdateRollbackCommand extends Command
{
    protected $signature = 'gobia:update:rollback {--restore-database : Also restore the pre-update database dump, discarding data saved since}';

    protected $description = 'Revert the most recent successful update using its retained backup.';

    public function handle(UpdateOrchestrator $orchestrator): int
    {
        set_time_limit(0);

        try {
            $run = $orchestrator->rollbackLast(['id' => null, 'username' => 'console'], (bool) $this->option('restore-database'));
        } catch (UpdateException $exception) {
            $this->error($exception->getMessage());

            return 1;
        }

        if ($run['result'] === 'rolled_back') {
            $this->info('Rolled back to ' . $run['to_version'] . '.');

            return 0;
        }

        $this->error('Rollback failed: ' . ($run['rollback']['error'] ?? $run['error']));

        return 1;
    }
}
