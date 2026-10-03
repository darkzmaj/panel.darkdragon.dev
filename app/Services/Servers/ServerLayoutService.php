<?php

namespace Pterodactyl\Services\Servers;

use Pterodactyl\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Exceptions\DisplayException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * A person's own arrangement of the servers they can access: one global order plus named
 * categories. It never grants anything. Every read is intersected with the servers the person can
 * access right now, and every write is rejected for servers they cannot access.
 */
class ServerLayoutService
{
    public const MAX_CATEGORIES = 20;

    /**
     * Servers the user can open, keyed by uuid, in their personal order.
     *
     * @return Collection<string, object>
     */
    public function accessible(User $user): Collection
    {
        return $user->accessibleServers()
            ->reorder()
            ->leftJoin('user_server_preferences as usp', function ($join) use ($user) {
                $join->on('usp.server_id', '=', 'servers.id')->where('usp.user_id', '=', $user->id);
            })
            ->groupBy('usp.position')
            ->orderByRaw('usp.position IS NULL')
            ->orderBy('usp.position')
            ->orderBy('servers.name')
            ->get(['servers.id', 'servers.uuid', 'servers.uuidShort', 'servers.name', 'servers.owner_id'])
            ->keyBy('uuid');
    }

    /**
     * @return array{servers: array, order: string[], categories: array}
     */
    public function layout(User $user): array
    {
        $accessible = $this->accessible($user);
        $byId = $accessible->keyBy('id');

        $categories = DB::table('user_server_categories')->where('user_id', $user->id)->orderBy('position')->orderBy('id')->get();
        $members = DB::table('user_server_category_members')
            ->whereIn('category_id', $categories->pluck('id'))
            ->orderBy('position')
            ->get()
            ->groupBy('category_id');

        return [
            'servers' => $accessible->map(fn ($server) => [
                'uuid' => $server->uuid,
                'identifier' => $server->uuidShort,
                'name' => $server->name,
                'owned' => (int) $server->owner_id === $user->id,
            ])->values()->all(),
            'order' => $accessible->keys()->all(),
            'categories' => $categories->map(fn ($category) => [
                'id' => $category->id,
                'name' => $category->name,
                // Stale rows for servers the user can no longer access are simply not returned.
                'servers' => collect($members->get($category->id, []))
                    ->map(fn ($member) => $byId->get($member->server_id)?->uuid)
                    ->filter()
                    ->values()
                    ->all(),
            ])->all(),
        ];
    }

    /**
     * Stores a new order for some of the user's servers. The given servers keep occupying the positions they held
     * before, just in the new order, so reordering one page of a long list leaves the rest of the list alone.
     *
     * @param string[] $uuids
     *
     * @throws DisplayException
     */
    public function reorder(User $user, array $uuids): void
    {
        $accessible = $this->accessible($user);
        $uuids = $this->ensureAccessible($accessible, $uuids);

        $full = $this->applySlots($accessible->keys()->all(), $uuids);

        DB::transaction(function () use ($user, $full, $accessible) {
            DB::table('user_server_preferences')->where('user_id', $user->id)->delete();
            DB::table('user_server_preferences')->insert(
                collect($full)->values()->map(fn ($uuid, $position) => [
                    'user_id' => $user->id,
                    'server_id' => $accessible[$uuid]->id,
                    'position' => $position,
                ])->all()
            );
        });
    }

    /**
     * @param string[] $uuids ordered
     *
     * @throws DisplayException
     */
    public function createCategory(User $user, string $name, array $uuids): int
    {
        $this->assertNameFree($user, $name, null);
        if (DB::table('user_server_categories')->where('user_id', $user->id)->count() >= self::MAX_CATEGORIES) {
            throw new DisplayException('You can have at most ' . self::MAX_CATEGORIES . ' categories.');
        }

        $accessible = $this->accessible($user);
        $uuids = $this->ensureAccessible($accessible, $uuids);

        return DB::transaction(function () use ($user, $name, $uuids, $accessible) {
            $id = DB::table('user_server_categories')->insertGetId([
                'user_id' => $user->id,
                'name' => $name,
                'position' => (int) DB::table('user_server_categories')->where('user_id', $user->id)->max('position') + 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->writeMembers($id, $uuids, $accessible);

            return $id;
        });
    }

    /**
     * @param string[] $uuids ordered
     *
     * @throws DisplayException
     */
    public function updateCategory(User $user, int $id, string $name, array $uuids): void
    {
        $this->ownedCategory($user, $id);
        $this->assertNameFree($user, $name, $id);

        $accessible = $this->accessible($user);
        $uuids = $this->ensureAccessible($accessible, $uuids);

        DB::transaction(function () use ($id, $name, $uuids, $accessible) {
            DB::table('user_server_categories')->where('id', $id)->update(['name' => $name, 'updated_at' => now()]);
            DB::table('user_server_category_members')->where('category_id', $id)->delete();
            $this->writeMembers($id, $uuids, $accessible);
        });
    }

    /**
     * Reorders some of the servers inside a category, leaving its other members where they are.
     *
     * @param string[] $uuids
     *
     * @throws DisplayException
     */
    public function reorderCategory(User $user, int $id, array $uuids): void
    {
        $this->ownedCategory($user, $id);
        $accessible = $this->accessible($user);
        $uuids = $this->ensureAccessible($accessible, $uuids);

        $byId = $accessible->keyBy('id');
        $current = DB::table('user_server_category_members')->where('category_id', $id)->orderBy('position')->pluck('server_id')->all();
        $currentUuids = array_values(array_filter(array_map(fn ($serverId) => $byId->get($serverId)?->uuid, $current)));
        $reordered = $this->applySlots($currentUuids, array_values(array_intersect($uuids, $currentUuids)));

        DB::transaction(function () use ($id, $reordered, $accessible) {
            DB::table('user_server_category_members')->where('category_id', $id)->delete();
            $this->writeMembers($id, $reordered, $accessible);
        });
    }

    public function deleteCategory(User $user, int $id): void
    {
        $this->ownedCategory($user, $id);
        DB::table('user_server_categories')->where('id', $id)->delete();
    }

    /**
     * A category, only if it belongs to the user.
     */
    public function ownedCategory(User $user, int $id): object
    {
        $category = DB::table('user_server_categories')->where('id', $id)->where('user_id', $user->id)->first();
        if ($category === null) {
            throw new NotFoundHttpException('Category not found.');
        }

        return $category;
    }

    /**
     * Puts $subset into the positions $full currently gives to those members, in the order of $subset.
     *
     * @param string[] $full
     * @param string[] $subset
     *
     * @return string[]
     */
    private function applySlots(array $full, array $subset): array
    {
        $slots = array_keys(array_filter($full, fn ($uuid) => in_array($uuid, $subset, true)));
        foreach ($slots as $i => $slot) {
            $full[$slot] = $subset[$i] ?? $full[$slot];
        }

        return $full;
    }

    /**
     * @param Collection<string, object> $accessible
     * @param string[] $uuids
     *
     * @return string[]
     *
     * @throws DisplayException
     */
    private function ensureAccessible(Collection $accessible, array $uuids): array
    {
        $uuids = array_values(array_unique(array_filter($uuids, 'is_string')));
        foreach ($uuids as $uuid) {
            if (!$accessible->has($uuid)) {
                throw new DisplayException('You can only organize servers you currently have access to.');
            }
        }

        return $uuids;
    }

    /**
     * @param string[] $uuids
     * @param Collection<string, object> $accessible
     */
    private function writeMembers(int $categoryId, array $uuids, Collection $accessible): void
    {
        if ($uuids === []) {
            return;
        }

        DB::table('user_server_category_members')->insert(
            collect($uuids)->values()->map(fn ($uuid, $position) => [
                'category_id' => $categoryId,
                'server_id' => $accessible[$uuid]->id,
                'position' => $position,
            ])->all()
        );
    }

    private function assertNameFree(User $user, string $name, ?int $ignore): void
    {
        $exists = DB::table('user_server_categories')
            ->where('user_id', $user->id)
            ->where('name', $name)
            ->when($ignore, fn ($query) => $query->where('id', '!=', $ignore))
            ->exists();

        if ($exists) {
            throw new DisplayException('You already have a category with that name.');
        }
    }
}
