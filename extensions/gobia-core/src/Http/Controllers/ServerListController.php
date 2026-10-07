<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Models\UserProfile;
use GobiaCore\Services\ServerLayoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use stdClass;

#[Group('Gobia instances')]
class ServerListController
{
    public function __construct(private readonly ServerLayoutService $layout) {}

    #[Endpoint('List instances', 'The signed in user\'s servers in their own order, filtered by view (all, you, other), category and search.')]
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'view' => ['sometimes', 'string', Rule::in(ServerLayoutService::VIEWS)],
            'category' => ['sometimes', 'string', 'regex:/\A(?:none|[0-9]{1,10})\z/'],
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.ServerLayoutService::MAX_PER_PAGE],
        ]);
        $user = $request->user();
        $category = $data['category'] ?? null;
        $category = $category === null || $category === 'none' ? $category : (int) $category;

        $page = $this->layout->page($user, $data['view'] ?? 'all', $category, $data['q'] ?? '', (int) ($data['page'] ?? 1), (int) ($data['per_page'] ?? 30));
        $categories = $this->layout->categoriesFor($user, $page->getCollection());

        return new JsonResponse([
            'data' => $page->getCollection()->map(fn (stdClass $server): array => [
                'uuid' => $server->uuid,
                'identifier' => $server->uuidShort,
                'name' => $server->name,
                'description' => $server->description,
                'node' => $server->gobia_node,
                'address' => $server->gobia_ip === null ? null : ($server->gobia_alias ?? $server->gobia_ip).':'.$server->gobia_port,
                'is_owner' => (int) $server->owner_id === $user->id,
                'status' => $server->status,
                'limits' => ['memory' => (int) $server->memory, 'disk' => (int) $server->disk, 'cpu' => (int) $server->cpu],
                'icon_color' => $server->gobia_color,
                'categories' => $categories[$server->id] ?? [],
            ])->all(),
            'meta' => ['pagination' => [
                'total' => $page->total(),
                'count' => $page->count(),
                'per_page' => $page->perPage(),
                'current_page' => $page->currentPage(),
                'total_pages' => $page->lastPage(),
            ]],
        ]);
    }

    #[Endpoint('Instance organisation summary', 'Categories with their counts, the totals for each view and the recent icon colours.')]
    public function summary(Request $request): JsonResponse
    {
        $user = $request->user();

        return new JsonResponse($this->layout->summary($user) + ['recent_icon_colors' => UserProfile::forUser($user)->recent_icon_colors ?? []]);
    }

    #[Endpoint('Reorder instances', 'Stores a new order for the listed servers. Listed servers keep the positions they already held, so other pages are unaffected.')]
    public function reorder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'category' => ['sometimes', 'nullable', 'integer'],
            'servers' => ['required', 'array', 'min:1', 'max:'.ServerLayoutService::MAX_PER_PAGE],
            'servers.*' => ['required', 'string', 'uuid'],
        ]);
        $this->layout->reorder($request->user(), $data['category'] ?? null, array_values($data['servers']));

        return new JsonResponse(['ok' => true]);
    }

    #[Endpoint('Set an icon colour', 'Sets or clears the signed in user\'s icon colour for one server. Only this user sees it.')]
    public function iconColor(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate(['color' => ['present', 'nullable', 'string', 'regex:/\A#[0-9a-fA-F]{6}\z/']]);
        $profile = $this->layout->setIconColor($request->user(), $uuid, $data['color']);

        return new JsonResponse(['icon_color' => $data['color'] === null ? null : mb_strtolower($data['color']), 'recent_icon_colors' => $profile->recent_icon_colors ?? []]);
    }
}
