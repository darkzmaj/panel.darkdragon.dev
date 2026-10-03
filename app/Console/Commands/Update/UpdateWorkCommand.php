<?php

namespace Pterodactyl\Console\Commands\Update;

use Illuminate\Console\Command;
use Pterodactyl\Services\Updater\UpdateOrchestrator;

class UpdateWorkCommand extends Command
{
    protected $signature = 'gobia:update:work {run : Id of a run created by the updater}';

    protected $description = 'Executes a queued Panel update run. Started by the updater, not meant to be run by hand.';

    protected $hidden = true;

    public function handle(UpdateOrchestrator $orchestrator): int
    {
        set_time_limit(0);
        ini_set('memory_limit', '1G');
        ignore_user_abort(true);

        $run = $orchestrator->execute((string) $this->argument('run'));

        return $run['result'] === 'success' ? 0 : 1;
    }
}
