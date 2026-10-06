<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Services\CompatibilityReport;
use Illuminate\Http\JsonResponse;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;

#[Group('Gobia admin')]
class CompatibilityController
{
    #[Endpoint('Installation compatibility', 'Gobia and Pterodactyl base versions, extensions and their compatibility, migration state and health. Read only input for the updater preflight.')]
    public function __invoke(CompatibilityReport $report): JsonResponse
    {
        return new JsonResponse($report->build());
    }
}
