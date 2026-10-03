<?php

namespace Pterodactyl\Http\ViewComposers;

use Illuminate\View\View;
use Pterodactyl\Services\Media\FooterService;
use Pterodactyl\Services\Media\BrandingService;
use Pterodactyl\Services\Helpers\AssetHashService;

class AssetComposer
{
    /**
     * AssetComposer constructor.
     */
    public function __construct(private AssetHashService $assetHashService, private BrandingService $branding, private FooterService $footer)
    {
    }

    /**
     * Provide access to the asset service in the views.
     */
    public function compose(View $view): void
    {
        $view->with('asset', $this->assetHashService);
        $footer = $this->footer->build();
        $view->with('gobiaFooter', $footer);
        $view->with('siteConfiguration', [
            'footer' => $footer,
            'name' => config('app.name') ?? 'Pterodactyl',
            'locale' => config('app.locale') ?? 'en',
            'logo' => $this->branding->url(BrandingService::LOGO),
            'recaptcha' => [
                'enabled' => config('recaptcha.enabled', false),
                'siteKey' => config('recaptcha.website_key') ?? '',
            ],
        ]);
    }
}
