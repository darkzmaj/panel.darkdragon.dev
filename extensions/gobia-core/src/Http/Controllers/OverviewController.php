<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Services\NodeStatsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;

#[Group('Gobia admin')]
class OverviewController
{
    public function __construct(private readonly NodeStatsService $nodes) {}

    #[Endpoint('Administration overview', 'Totals for users, administrators, nodes, instances, databases, locations, mounts and templates, plus allocated and live resource usage per node. Offline nodes are reported, never fatal.')]
    public function __invoke(Request $request): JsonResponse
    {
        $count = fn (string $table, ?callable $where = null): int => Schema::hasTable($table) ? (int) ($where ? $where(DB::table($table)) : DB::table($table))->count() : 0;
        $snapshot = $this->nodes->snapshot($request->boolean('refresh'));

        return new JsonResponse([
            'totals' => [
                'users' => $count('users'),
                'administrators' => $count('users', fn ($query) => $query->where('root_admin', true)),
                'nodes' => $count('nodes'),
                'instances' => $count('servers'),
                'databases' => $count('databases'),
                'locations' => $count('locations'),
                'mounts' => $count('mounts'),
                'templates' => $count('gobia_server_templates'),
            ],
            'resources' => $snapshot['global'],
            'nodes' => $snapshot['nodes'],
            'generated_at' => $snapshot['generated_at'],
        ]);
    }
}
