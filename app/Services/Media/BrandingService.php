<?php

namespace Pterodactyl\Services\Media;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Contracts\Config\Repository as ConfigRepository;
use Pterodactyl\Contracts\Repository\SettingsRepositoryInterface;

class BrandingService
{
    public const LOGO = 'logo';
    public const FAVICON = 'favicon';

    /**
     * The maximum bounding box in pixels, per asset, that an upload is scaled down to.
     */
    private const BOUNDS = [
        self::LOGO => [512, 256],
        self::FAVICON => [256, 256],
    ];

    public function __construct(
        private ConfigRepository $config,
        private PngImageProcessor $processor,
        private SettingsRepositoryInterface $settings,
    ) {
    }

    /**
     * Normalize the uploaded PNG and store it as the given branding asset.
     *
     * @throws \Pterodactyl\Exceptions\DisplayException
     * @throws \Pterodactyl\Exceptions\Model\DataValidationException
     */
    public function store(string $asset, UploadedFile $file): void
    {
        [$width, $height] = self::BOUNDS[$asset];
        $contents = $this->processor->normalize($file->getRealPath(), $width, $height);

        Storage::disk('local')->put(self::path($asset), $contents);
        $this->settings->set('settings::pterodactyl:branding:' . $asset, substr(sha1($contents), 0, 16));
    }

    public function remove(string $asset): void
    {
        Storage::disk('local')->delete(self::path($asset));
        $this->settings->forget('settings::pterodactyl:branding:' . $asset);
    }

    /**
     * Returns the version hash of a custom asset, or null if the default is in use.
     */
    public function version(string $asset): ?string
    {
        return $this->config->get('pterodactyl.branding.' . $asset);
    }

    /**
     * Returns the cache-busted URL for a custom asset, or null if the default is in use.
     */
    public function url(string $asset): ?string
    {
        $version = $this->version($asset);

        return is_null($version) ? null : route('branding.' . $asset, ['v' => $version], false);
    }

    public static function path(string $asset): string
    {
        return 'branding/' . $asset . '.png';
    }
}
