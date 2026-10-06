<?php

declare(strict_types=1);

namespace Pterodactyl\Tests\Integration\Gobia;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Route;
use Pterodactyl\Contracts\Extensions\InstallsExtensions;
use Pterodactyl\Models\Extension;
use Pterodactyl\Models\ExtensionSetting;
use Pterodactyl\Services\Extensions\ExtensionProviderLoader;
use Pterodactyl\Services\Extensions\ExtensionRepository;

/**
 * Installs the real Gobia extensions from extensions/ into a temporary extensions directory with a stub frontend
 * bundle, then boots their providers, so backend behaviour is tested against the same code that ships.
 */
trait InstallsGobiaExtensions
{
    private string $gobiaDirectory = '';

    /** @var list<string> */
    private array $gobiaInstalled = [];

    /** @param list<string> $ids */
    protected function installGobia(array $ids): void
    {
        $this->gobiaDirectory = sys_get_temp_dir().'/gobia-ext-'.uniqid();
        File::ensureDirectoryExists($this->gobiaDirectory.'/installed');
        config(['extensions.enabled' => true, 'extensions.directory' => $this->gobiaDirectory.'/installed']);
        $this->app->make(ExtensionRepository::class)->flushDiscovery();

        foreach ($ids as $id) {
            $source = $this->gobiaDirectory.'/source-'.$id;
            File::copyDirectory(base_path('extensions/'.$id), $source);
            File::deleteDirectory($source.'/node_modules');
            File::ensureDirectoryExists($source.'/dist');
            file_put_contents($source.'/dist/client.js', 'export default {};');
            $this->app->make(InstallsExtensions::class)->install($source, enable: true);
            $this->gobiaInstalled[] = $id;
        }

        Route::getRoutes()->refreshNameLookups();
        $this->app->make(ExtensionProviderLoader::class)->registerProviders($this->app->make(ExtensionRepository::class)->enabled());
    }

    protected function uninstallGobia(): void
    {
        foreach ($this->gobiaInstalled as $id) {
            Extension::query()->where('identifier', $id)->delete();
            ExtensionSetting::query()->where('extension', $id)->delete();
        }
        $this->gobiaInstalled = [];
        // The extensions own their tables; drop them so the next test starts clean.
        foreach (DB::select('SHOW TABLES LIKE "gobia\\_%"') as $row) {
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
            DB::statement('DROP TABLE IF EXISTS `'.array_values((array) $row)[0].'`');
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
        DB::table('migrations')->where('migration', 'like', '%gobia%')->delete();
        File::deleteDirectory($this->gobiaDirectory);
    }
}
