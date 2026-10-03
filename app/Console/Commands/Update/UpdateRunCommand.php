<?php

namespace Pterodactyl\Console\Commands\Update;

use Illuminate\Console\Command;
use Pterodactyl\Services\Updater\UpdateService;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

class UpdateRunCommand extends Command
{
    protected $signature = 'gobia:update:run {version? : Release to install, defaults to the latest}';

    protected $description = 'Install a published Panel release and follow its progress.';

    public function handle(UpdateService $updates): int
    {
        try {
            $version = $this->argument('version') ?? ($updates->check(true)['release']['version'] ?? null);
            if ($version === null) {
                $this->error('No release is available.');

                return 1;
            }

            [$created, $run] = $updates->start($version, ['id' => null, 'username' => 'console']);
        } catch (UpdateException $exception) {
            $this->error($exception->getMessage());

            return 1;
        }

        $this->line(($created ? 'Started ' : 'Following the running update ') . $run['id'] . ' -> ' . $run['to_version']);

        $seen = [];
        while (true) {
            $run = $updates->store()->load($run['id']);
            foreach ($run['steps'] as $step) {
                if ($step['status'] !== 'pending' && ($seen[$step['id']] ?? null) !== $step['status']) {
                    $seen[$step['id']] = $step['status'];
                    $this->line(sprintf('  [%s] %s', $step['status'], $step['label']));
                }
            }
            if (!empty($run['finished_at'])) {
                break;
            }
            sleep(2);
        }

        if ($run['result'] === 'success') {
            $this->info('Update complete.');

            return 0;
        }

        $this->error('Update ' . $run['result'] . ': ' . $run['error']);

        return 1;
    }
}
