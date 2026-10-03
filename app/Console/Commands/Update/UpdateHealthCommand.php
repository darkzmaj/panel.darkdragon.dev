<?php

namespace Pterodactyl\Console\Commands\Update;

use Illuminate\Console\Command;
use Pterodactyl\Services\Updater\HealthChecker;

class UpdateHealthCommand extends Command
{
    protected $signature = 'gobia:update:health {--expect= : The version that must be running}';

    protected $description = 'Verify that the installed Panel release is healthy (prints JSON).';

    public function handle(HealthChecker $checker): int
    {
        $report = $checker->run((string) ($this->option('expect') ?: config('app.version')));
        $this->line(json_encode($report, JSON_UNESCAPED_SLASHES));

        return $report['ok'] ? 0 : 1;
    }
}
