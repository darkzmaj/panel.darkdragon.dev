<?php

namespace Pterodactyl\Http\Controllers\Base;

use Illuminate\Http\JsonResponse;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Updater\UpdateService;

class UpdateProgressController extends Controller
{
    /**
     * Coarse update progress for the maintenance page. Public and independent of the database and
     * sessions so it keeps working while an update runs; it exposes stage names only.
     */
    public function __invoke(UpdateService $updates): JsonResponse
    {
        return new JsonResponse($updates->publicProgress(), 200, ['Cache-Control' => 'no-store']);
    }
}
