<?php

declare(strict_types=1);

namespace GobiaCore\Console\Update;

use GobiaCore\Updater\UpdateOrchestrator;
use Illuminate\Console\Command;

class UpdateWorkCommand extends Command
{
    protected $signature = 'gobia-core:update:work {run : Id of a run created by the updater}';

    protected $description = 'Executes a queued Panel update run. Started by the updater, not meant to be run by hand.';

    protected $hidden = true;

    public function handle(UpdateOrchestrator $orchestrator): int
    {
        set_time_limit(0);
        ini_set('memory_limit', '1G');
        ignore_user_abort(true);

        $run = $orchestrator->execute((string) $this->argument('run'));

        $wanted = ($run['type'] ?? 'update') === 'rollback' ? 'rolled_back' : 'success';

        return $run['result'] === $wanted ? self::SUCCESS : self::FAILURE;
    }
}
