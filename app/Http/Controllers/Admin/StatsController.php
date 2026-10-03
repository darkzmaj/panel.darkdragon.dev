<?php

namespace Pterodactyl\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Http\Controllers\Controller;
use Pterodactyl\Services\Admin\NodeStatsService;

class StatsController extends Controller
{
    public function __construct(private NodeStatsService $stats)
    {
    }

    /**
     * Aggregated and per node resource statistics, cached for a short time.
     */
    public function nodes(Request $request): JsonResponse
    {
        return new JsonResponse($this->stats->snapshot($request->boolean('refresh')), 200, ['Cache-Control' => 'no-store']);
    }
}
