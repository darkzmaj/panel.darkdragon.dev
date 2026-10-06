<?php

declare(strict_types=1);

namespace GobiaTemplates\Console;

use GobiaTemplates\Services\LegacyImporter;
use Illuminate\Console\Command;

class ImportLegacyCommand extends Command
{
    protected $signature = 'gobia-templates:import-1x {--connection= : Database connection holding the Gobia 1.x tables (default: the panel database)} {--dry-run : Report what would be copied without changing anything}';

    protected $description = 'Copy templates, revisions, instances and template SFTP records from a Gobia 1.x database. Never changes the 1.x tables.';

    public function handle(LegacyImporter $importer): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $report = $importer->run($this->option('connection') ?: null, $dryRun);

        $this->table([$dryRun ? 'Would copy' : 'Copied', 'Rows'], array_map(fn (string $label, int $count): array => [$label, $count], array_keys($report), array_values($report)));

        if ($report['template directories missing'] > 0 || $report['published blobs missing'] > 0) {
            $this->warn('Some template files were not found. Point GOBIA_TEMPLATE_STORAGE at the directory the 1.x panel used (default storage/app/private/templates) and run this command again.');
        }
        if ($report['api keys to review'] > 0) {
            $this->warn('Some 1.x API keys had template permissions. Create an application API key with the Servers permission and turn on "API enabled" on each template that should accept it.');
        }
        $this->info($dryRun ? 'Dry run: nothing was changed.' : 'Done. Existing Gobia 2.0 data was left as it was; the 1.x tables were not touched.');

        return self::SUCCESS;
    }
}
