<?php

namespace Pterodactyl\Http\Controllers\Admin\Nodes;

use Illuminate\View\View;
use Illuminate\Http\Request;
use Pterodactyl\Models\Node;
use Spatie\QueryBuilder\QueryBuilder;
use Pterodactyl\Http\Controllers\Controller;

class NodeController extends Controller
{
    /**
     * Returns a listing of nodes on the system.
     */
    public function index(Request $request): View
    {
        $nodes = QueryBuilder::for(
            Node::query()
                ->with('location')
                ->withCount(['servers', 'allocations', 'allocations as allocations_used_count' => fn ($query) => $query->whereNotNull('server_id')])
                ->withSum('servers as allocated_memory', 'memory')
                ->withSum('servers as allocated_disk', 'disk')
                ->withSum('servers as allocated_cpu', 'cpu')
        )
            ->allowedFilters(['uuid', 'name'])
            ->allowedSorts(['id'])
            ->paginate(25);

        return view('admin.nodes.index', ['nodes' => $nodes]);
    }
}
