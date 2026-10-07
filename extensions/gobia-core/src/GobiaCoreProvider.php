<?php

declare(strict_types=1);

namespace GobiaCore;

use GobiaCore\Console\ImportLegacyCommand;
use Pterodactyl\Extensions\ExtensionProvider;
use Pterodactyl\Services\Extensions\ExtensionSettingDefinition;
use Pterodactyl\Services\Extensions\ExtensionSettingsDefinition;

class GobiaCoreProvider extends ExtensionProvider
{
    /** Shipped with the Gobia theme (themes/gobia/assets/img, published to /assets/theme/img by `p:theme:apply gobia`). */
    public const string DEFAULT_LOGO = '/assets/theme/img/icon-256.png';

    public const string DEFAULT_FAVICON = '/assets/theme/img/favicon-32.png';

    public function boot(): void
    {
        $this->registerApiRoutes();
        $this->loadExtensionMigrations();
        $this->registerCommands([ImportLegacyCommand::class]);
        $definition = new ExtensionSettingsDefinition($this->settings(), [
            ExtensionSettingDefinition::make('logo', 'logo', self::DEFAULT_LOGO)
                ->label('Logo')
                ->help('PNG shown in the top bar instead of the Gobia wordmark. Leave empty to use the Gobia logo.')
                ->tab('Branding')
                ->file(['image/png'], 1024)
                ->frontend()
                ->public(),
            ExtensionSettingDefinition::make('favicon', 'favicon', self::DEFAULT_FAVICON)
                ->label('Favicon')
                ->help('PNG used as the browser tab icon. Leave empty to use the Gobia icon.')
                ->tab('Branding')
                ->file(['image/png'], 256)
                ->frontend()
                ->public(),
        ]);
        $this->registerSettings($definition);
        $this->registerHeadTags(fn (): array => [
            ['tag' => 'link', 'rel' => 'icon', 'type' => 'image/png', 'sizes' => '32x32', 'href' => $this->assetUrl($definition, 'favicon', self::DEFAULT_FAVICON)],
            ['tag' => 'link', 'rel' => 'apple-touch-icon', 'sizes' => '180x180', 'href' => $this->assetUrl($definition, 'logo', self::DEFAULT_LOGO)],
        ]);
    }

    /** A file setting reads as the public URL of its upload, or the default while nothing is uploaded. */
    private function assetUrl(ExtensionSettingsDefinition $definition, string $key, string $default): string
    {
        $value = $definition->get($key);

        return is_string($value) && $value !== '' ? $value : $default;
    }
}
