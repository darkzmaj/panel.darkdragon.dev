<?php

declare(strict_types=1);

namespace GobiaCore\Console\Update;

use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\UpdateService;
use Illuminate\Console\Command;

class UpdateRollbackCommand extends Command
{
    protected $signature = 'gobia-core:update:rollback {--restore-database : Accept that the database from before the update is restored and newer data is lost}';

    protected $description = 'Revert the last Panel update using the backup it left behind.';

    public function handle(UpdateService $updates): int
    {
        $eligibility = $updates->rollbackEligibility();
        if (! $eligibility['eligible']) {
            $this->error((string) $eligibility['reason']);

            return self::FAILURE;
        }

        try {
            $run = $updates->startRollback((string) $eligibility['update_id'], (bool) $this->option('restore-database'), ['type' => 'console']);
        } catch (UpdateException $exception) {
            $this->error($exception->getMessage().($eligibility['mode'] === 'requires-db-restore' ? ' Pass --restore-database to confirm.' : ''));

            return self::FAILURE;
        }

        do {
            sleep(2);
            $progress = (array) $updates->progress((string) $run['id']);
        } while (! in_array($progress['state'], ['completed', 'failed', 'rolled_back'], true));

        if ($progress['state'] === 'rolled_back') {
            $this->info('Rolled back to '.$run['to_version'].'.');

            return self::SUCCESS;
        }

        $this->error('The rollback failed: '.$progress['failure']);

        return self::FAILURE;
    }
}
