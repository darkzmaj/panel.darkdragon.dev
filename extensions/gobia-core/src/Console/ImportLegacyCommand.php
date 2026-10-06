<?php

declare(strict_types=1);

namespace GobiaCore\Console;

use GobiaCore\Services\LegacyImporter;
use Illuminate\Console\Command;

class ImportLegacyCommand extends Command
{
    protected $signature = 'gobia-core:import-1x {--connection= : Database connection holding the Gobia 1.x tables (default: the panel database)} {--dry-run : Report what would be copied without changing anything}';

    protected $description = 'Copy avatars, theme, icon colours, server order and categories from a Gobia 1.x database into Gobia Core. Never changes the 1.x tables.';

    public function handle(LegacyImporter $importer): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $connection = $this->option('connection') ?: null;

        $report = $importer->run($connection, $dryRun);

        $this->table([$dryRun ? 'Would copy' : 'Copied', 'Rows'], array_map(fn (string $label, int $count): array => [$label, $count], array_keys($report), array_values($report)));
        $this->info($dryRun ? 'Dry run: nothing was changed.' : 'Done. Existing Gobia 2.0 data was left as it was; the 1.x tables were not touched.');

        return self::SUCCESS;
    }
}
