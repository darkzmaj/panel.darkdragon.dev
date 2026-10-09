<?php

declare(strict_types=1);

namespace GobiaCore\Console\Update;

use GobiaCore\Updater\Exceptions\PreflightFailedException;
use GobiaCore\Updater\Exceptions\UpdateException;
use GobiaCore\Updater\UpdateService;
use Illuminate\Console\Command;

class UpdateRunCommand extends Command
{
    protected $signature = 'gobia-core:update:run {--force : Do not ask for confirmation}';

    protected $description = 'Install the latest approved Gobia release (the same update the Admin, Updates button starts).';

    public function handle(UpdateService $updates): int
    {
        $check = $updates->check(refresh: true);
        if ($check['error'] !== null) {
            $this->error($check['error']);

            return self::FAILURE;
        }
        if (! $check['update_available']) {
            $this->info('The Panel is up to date ('.$check['current']['gobia'].').');

            return self::SUCCESS;
        }

        $target = (string) $check['latest_approved']['gobia'];
        if (! $this->option('force') && ! $this->confirm('Update '.$check['current']['gobia'].' to '.$target.'? The Panel is in maintenance mode while it installs.')) {
            return self::SUCCESS;
        }

        try {
            $run = $updates->start($target, ['type' => 'console']);
        } catch (PreflightFailedException $exception) {
            foreach ($exception->report['checks'] as $item) {
                if ($item['required'] && $item['status'] !== 'pass') {
                    $this->error($item['id'].': '.$item['message']);
                }
            }

            return self::FAILURE;
        } catch (UpdateException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->line('Update '.$run['id'].' started.');
        $seen = 0;
        do {
            sleep(2);
            $progress = (array) $updates->progress((string) $run['id']);
            foreach (array_slice($progress['log'], $seen) as $entry) {
                $this->line('  '.$entry['message']);
            }
            $seen = count($progress['log']);
        } while (! in_array($progress['state'], ['completed', 'failed', 'rolled_back'], true));

        if ($progress['state'] === 'completed') {
            $this->info('Updated to '.$target.'.');

            return self::SUCCESS;
        }

        $this->error('The update failed: '.$progress['failure'].($progress['rollback']['performed'] ? ' The previous version was restored.' : ''));

        return self::FAILURE;
    }
}
