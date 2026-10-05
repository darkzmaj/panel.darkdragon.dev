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
use Pterodactyl\Models\ServerTemplate;
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
                ['label' => 'Users', 'value' => User::query()->count(), 'icon' => 'fa-users', 'route' => 'admin.users', 'note' => $this->count(User::query()->where('root_admin', true)->count(), 'administrator')],
                ['label' => 'Nodes', 'value' => Node::query()->count(), 'icon' => 'fa-sitemap', 'route' => 'admin.nodes', 'note' => $this->count(Location::query()->count(), 'location')],
                ['label' => 'Instances', 'value' => Server::query()->count(), 'icon' => 'fa-server', 'route' => 'admin.servers', 'note' => 'across all nodes'],
                ['label' => 'Templates', 'value' => ServerTemplate::query()->count(), 'icon' => 'fa-clone', 'route' => 'admin.templates', 'note' => ServerTemplate::query()->where('enabled', true)->count() . ' enabled'],
                ['label' => 'Databases', 'value' => DatabaseHost::query()->count(), 'icon' => 'fa-database', 'route' => 'admin.databases', 'note' => 'database hosts'],
                ['label' => 'Mounts', 'value' => Mount::query()->count(), 'icon' => 'fa-hdd-o', 'route' => 'admin.mounts', 'note' => Nest::query()->count() . ' nests'],
            ],
        ]);
    }

    private function count(int $number, string $noun): string
    {
        return $number . ' ' . \Illuminate\Support\Str::plural($noun, $number);
    }
}
