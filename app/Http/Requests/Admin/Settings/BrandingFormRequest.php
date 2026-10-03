<?php

namespace Pterodactyl\Http\Requests\Admin\Settings;

use Pterodactyl\Rules\PngImage;
use Pterodactyl\Services\Media\BrandingService;
use Pterodactyl\Http\Requests\Admin\AdminFormRequest;

class BrandingFormRequest extends AdminFormRequest
{
    /**
     * The maximum upload size in kilobytes for each branding asset.
     */
    private const MAX_SIZE = [
        BrandingService::LOGO => 2048,
        BrandingService::FAVICON => 512,
    ];

    public function rules(): array
    {
        $asset = $this->route('asset');

        return [
            $asset => ['bail', 'required', 'file', 'extensions:png', 'max:' . self::MAX_SIZE[$asset], new PngImage()],
        ];
    }
}
