<?php

declare(strict_types=1);

namespace GobiaCore\Console\Update;

use GobiaCore\Services\CompatibilityReport;
use Illuminate\Console\Command;
use Pterodactyl\Contracts\Extensions\SetsExtensionEnabled;
use Pterodactyl\Contracts\Themes\AppliesThemes;
use Pterodactyl\Services\Extensions\ExtensionRepository;
use Pterodactyl\Services\Themes\ThemeService;
use Throwable;

/**
 * Runs in the freshly installed code, after the core migrations. A new release has an empty public
 * asset directory, so the theme and every extension that was enabled are published again (which also
 * runs their migrations and records their new versions). Extensions the administrator disabled stay
 * disabled; a Gobia extension the release introduces is enabled.
 */
class UpdateFinalizeCommand extends Command
{
    protected $signature = 'gobia-core:update:finalize';

    protected $description = 'Republish the Gobia theme and enabled extensions after an update. Started by the updater.';

    protected $hidden = true;

    public function handle(ExtensionRepository $extensions, SetsExtensionEnabled $installer, AppliesThemes $themes, ThemeService $themeService, CompatibilityReport $report): int
    {
        $theme = (string) config('gobia_updater.theme');
        if ($theme !== '' && isset($themeService->discovered()[$theme])) {
            $themes->apply($theme);
            $this->line('Theme '.$theme.' applied.');
        }

        $records = $extensions->records();
        $bundled = array_keys((array) ($report->release()['extensions'] ?? []));
        $failed = false;

        foreach ($extensions->discovered() as $manifest) {
            $record = $records->get($manifest->id);
            $wanted = $record !== null ? (bool) $record->enabled : in_array($manifest->id, $bundled, true);
            if (! $wanted) {
                continue;
            }

            try {
                $installer->setEnabled($manifest->id, true);
                $this->line('Extension '.$manifest->id.' '.$manifest->version.' published.');
            } catch (Throwable $exception) {
                // A broken third party extension must not undo the update; a broken Gobia extension must.
                $this->error('Extension '.$manifest->id.': '.$exception->getMessage());
                $failed = $failed || str_starts_with($manifest->id, 'gobia-');
            }
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
