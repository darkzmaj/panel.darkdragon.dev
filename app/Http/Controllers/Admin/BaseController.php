<?php

namespace Pterodactyl\Http\Controllers\Admin;

use Illuminate\View\View;
use Pterodactyl\Models\Nest;
use Pterodactyl\Models\Node;
use Pterodactyl\Models\User;
use Pterodactyl\Models\Mount;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Location;
use Pterodactyl\Models\DatabaseHost;
use Pterodactyl\Http\Controllers\Controller;

class BaseController extends Controller
{
    /**
     * Return the admin overview. Counts come straight from the database; node resource figures
     * are loaded afterwards by the page through {@see StatsController} so a slow node cannot block it.
     */
    public function index(): View
    {
        return view('admin.index', [
            'counts' => [
                ['label' => 'Registered Users', 'value' => User::query()->count(), 'icon' => 'fa-users', 'route' => 'admin.users'],
                ['label' => 'Administrators', 'value' => User::query()->where('root_admin', true)->count(), 'icon' => 'fa-shield', 'route' => 'admin.users'],
                ['label' => 'Nodes', 'value' => Node::query()->count(), 'icon' => 'fa-sitemap', 'route' => 'admin.nodes'],
                ['label' => 'Instances', 'value' => Server::query()->count(), 'icon' => 'fa-server', 'route' => 'admin.servers'],
                ['label' => 'Databases', 'value' => DatabaseHost::query()->count(), 'icon' => 'fa-database', 'route' => 'admin.databases'],
                ['label' => 'Locations', 'value' => Location::query()->count(), 'icon' => 'fa-globe', 'route' => 'admin.locations'],
                ['label' => 'Mounts', 'value' => Mount::query()->count(), 'icon' => 'fa-hdd-o', 'route' => 'admin.mounts'],
                ['label' => 'Nests', 'value' => Nest::query()->count(), 'icon' => 'fa-th-large', 'route' => 'admin.nests'],
            ],
        ]);
    }
}
