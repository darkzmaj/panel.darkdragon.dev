<?php

declare(strict_types=1);

namespace GobiaCore\Console\Update;

use GobiaCore\Updater\HealthChecker;
use GobiaCore\Updater\UpdateService;
use Illuminate\Console\Command;

class UpdateHealthCommand extends Command
{
    protected $signature = 'gobia-core:update:health {--expect= : The Gobia version that must be running}';

    protected $description = 'Verify that the installed Panel release is healthy (prints JSON).';

    public function handle(HealthChecker $checker, UpdateService $updates): int
    {
        $report = $checker->run((string) ($this->option('expect') ?: $updates->currentVersion()));
        $this->line((string) json_encode($report, JSON_UNESCAPED_SLASHES));

        return $report['ok'] ? self::SUCCESS : self::FAILURE;
    }
}
