<?php

namespace Pterodactyl\Http\Controllers\Admin\Settings;

use Illuminate\View\View;
use Illuminate\Http\RedirectResponse;
use Prologue\Alerts\AlertsMessageBag;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Media\BrandingService;
use Pterodactyl\Http\Requests\Admin\Settings\BrandingFormRequest;

class BrandingController extends Controller
{
    public function __construct(
        private AlertsMessageBag $alert,
        private BrandingService $branding,
    ) {
    }

    /**
     * Render the UI for managing the panel logo and favicon.
     */
    public function index(): View
    {
        return view('admin.settings.branding', [
            'logo' => $this->branding->url(BrandingService::LOGO),
            'favicon' => $this->branding->url(BrandingService::FAVICON),
        ]);
    }

    /**
     * Replace the panel logo or favicon.
     *
     * @throws \Pterodactyl\Exceptions\DisplayException
     * @throws \Pterodactyl\Exceptions\Model\DataValidationException
     */
    public function update(BrandingFormRequest $request, string $asset): RedirectResponse
    {
        $this->branding->store($asset, $request->file($asset));
        $this->alert->success('The ' . $asset . ' has been updated successfully.')->flash();

        return redirect()->route('admin.settings.branding');
    }

    /**
     * Reset the panel logo or favicon back to the default.
     */
    public function delete(string $asset): RedirectResponse
    {
        $this->branding->remove($asset);
        $this->alert->success('The ' . $asset . ' has been reset to the default.')->flash();

        return redirect()->route('admin.settings.branding');
    }
}
