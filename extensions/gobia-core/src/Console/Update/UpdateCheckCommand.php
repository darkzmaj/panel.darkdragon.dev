<?php

declare(strict_types=1);

namespace GobiaCore\Console\Update;

use GobiaCore\Updater\UpdateService;
use Illuminate\Console\Command;

class UpdateCheckCommand extends Command
{
    protected $signature = 'gobia-core:update:check {--preflight : Also run the local preflight for the available release}';

    protected $description = 'Ask the update source for the latest approved Gobia release.';

    public function handle(UpdateService $updates): int
    {
        $check = $updates->check(refresh: true);
        $this->line('Installed: '.$check['current']['gobia']);

        if ($check['error'] !== null) {
            $this->error($check['error']);

            return self::FAILURE;
        }

        if ($check['latest_approved'] === null || ! $check['update_available']) {
            $this->info('No newer approved release is available.');

            return self::SUCCESS;
        }

        $this->info('Available: '.$check['latest_approved']['gobia'].($check['latest_approved']['security'] ? ' (security update)' : ''));

        if ($this->option('preflight')) {
            $report = (array) $updates->preflight();
            foreach ($report['checks'] as $item) {
                $this->line(sprintf('  %-5s %-24s %s', strtoupper($item['status']), $item['id'], $item['message']));
            }
            $this->line($report['ready'] ? 'Ready to update.' : 'Not ready: fix the failing checks above.');

            return $report['ready'] ? self::SUCCESS : self::FAILURE;
        }

        return self::SUCCESS;
    }
}
