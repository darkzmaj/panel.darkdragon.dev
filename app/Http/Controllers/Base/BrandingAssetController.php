<?php

namespace Pterodactyl\Http\Controllers\Base;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Media\BrandingService;

class BrandingAssetController extends Controller
{
    public function __construct(private BrandingService $branding)
    {
    }

    /**
     * Serve the custom panel logo. This is public since it is shown on the login page.
     */
    public function logo(Request $request): Response
    {
        return $this->serve($request, BrandingService::LOGO);
    }

    /**
     * Serve the custom favicon.
     */
    public function favicon(Request $request): Response
    {
        return $this->serve($request, BrandingService::FAVICON);
    }

    private function serve(Request $request, string $asset): Response
    {
        $version = $this->branding->version($asset);
        $disk = Storage::disk('local');

        if (is_null($version) || !$disk->exists(BrandingService::path($asset))) {
            abort(404);
        }

        // The version in the URL changes whenever the image does, so a versioned URL can be cached indefinitely.
        $response = new Response($disk->get(BrandingService::path($asset)), 200, [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'",
            'Cache-Control' => $request->query('v') === $version
                ? 'public, max-age=31536000, immutable'
                : 'public, no-cache',
        ]);
        $response->setEtag($version);
        $response->isNotModified($request);

        return $response;
    }
}
