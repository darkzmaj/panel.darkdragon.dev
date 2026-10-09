<?php

declare(strict_types=1);

namespace GobiaBackups\Console;

use GobiaBackups\Services\Scheduler;
use Illuminate\Console\Command;

class TickCommand extends Command
{
    protected $signature = 'gobia-backups:tick';

    protected $description = 'Queue due offsite backups, start waiting ones and close finished restores. Run every minute by the scheduler.';

    public function handle(Scheduler $scheduler): int
    {
        $result = $scheduler->tick();
        $this->line(sprintf('queued %d, started %d, timed out %d', $result['queued'], $result['started'], $result['timed_out']));

        return self::SUCCESS;
    }
}
