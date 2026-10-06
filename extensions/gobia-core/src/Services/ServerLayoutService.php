<?php

declare(strict_types=1);

namespace GobiaCore\Services;

use GobiaCore\Models\UserProfile;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\User;
use stdClass;

/**
 * A user's personal organisation of the servers they can open: filters (all, owned, shared), categories, the order of
 * the list and the colour of each server icon. Authorisation is never cached here: every read and write starts from
 * the set of servers the user can currently open.
 */
class ServerLayoutService
{
    public const array VIEWS = ['all', 'you', 'other'];

    public const int MAX_CATEGORIES = 24;

    public const int MAX_PER_PAGE = 50;

    public const int RECENT_COLORS = 5;

    public const string COLOR_PATTERN = '/\A#[0-9a-f]{6}\z/';

    /** Servers the user owns or has been invited to, as two indexed predicates (no join, no grouping). */
    public function accessible(User $user): Builder
    {
        return Server::query()->where(function (Builder $query) use ($user): void {
            $query->where('servers.owner_id', $user->id)->orWhereExists(function (QueryBuilder $subusers) use ($user): void {
                $subusers->selectRaw('1')->from('subusers')->whereColumn('subusers.server_id', 'servers.id')->where('subusers.user_id', $user->id);
            });
        });
    }

    /**
     * One page of the list in the user's own order.
     *
     * @param  'all'|'you'|'other'  $view
     * @param  int|'none'|null  $category  a category id, "none" for servers in no category, or null for every server
     * @return LengthAwarePaginator<int, stdClass> plain rows, not models: only a handful of columns are selected
     */
    public function page(User $user, string $view, int|string|null $category, string $search, int $page, int $perPage): LengthAwarePaginator
    {
        $query = $this->accessible($user)
            ->leftJoin('gobia_server_preferences as gp', fn ($join) => $join->on('gp.server_id', '=', 'servers.id')->where('gp.user_id', '=', $user->id))
            ->leftJoin('allocations as ga', 'ga.id', '=', 'servers.allocation_id')
            ->select(['servers.id', 'servers.uuid', 'servers.uuidShort', 'servers.name', 'servers.description', 'servers.owner_id', 'servers.status', 'servers.memory', 'servers.disk', 'servers.cpu', 'ga.ip as gobia_ip', 'ga.ip_alias as gobia_alias', 'ga.port as gobia_port', 'gp.position as gobia_position', 'gp.icon_color as gobia_color']);

        match ($view) {
            'you' => $query->where('servers.owner_id', $user->id),
            'other' => $query->where('servers.owner_id', '!=', $user->id),
            default => null,
        };

        if ($category === 'none') {
            $query->whereNotExists(fn (QueryBuilder $members) => $members->selectRaw('1')->from('gobia_server_category_members as gm')
                ->join('gobia_server_categories as gc', 'gc.id', '=', 'gm.category_id')->whereColumn('gm.server_id', 'servers.id')->where('gc.user_id', $user->id));
        } elseif (is_int($category)) {
            $query->whereExists(fn (QueryBuilder $members) => $members->selectRaw('1')->from('gobia_server_category_members as gm')
                ->join('gobia_server_categories as gc', 'gc.id', '=', 'gm.category_id')->whereColumn('gm.server_id', 'servers.id')
                ->where('gc.user_id', $user->id)->where('gc.id', $category));
            $query->leftJoin('gobia_server_category_members as gcm', fn ($join) => $join->on('gcm.server_id', '=', 'servers.id')->where('gcm.category_id', '=', $category));
            $query->addSelect('gcm.position as gobia_category_position');
        }

        $search = mb_trim($search);
        if ($search !== '') {
            $contains = '%'.addcslashes($search, '%_\\').'%';
            $prefix = addcslashes($search, '%_\\').'%';
            $query->where(function (Builder $inner) use ($contains, $prefix): void {
                $inner->where('servers.name', 'like', $contains)
                    ->orWhere('servers.description', 'like', $contains)
                    ->orWhere('servers.uuid', 'like', $prefix)
                    ->orWhere('servers.uuidShort', 'like', $prefix)
                    ->orWhereRaw("CONCAT(ga.ip, ':', ga.port) LIKE ?", [$prefix]);
            });
        }

        if (is_int($category)) {
            $query->orderBy('gobia_category_position');
        } else {
            $query->orderByRaw('gp.position IS NULL')->orderBy('gp.position');
        }
        $query->orderBy('servers.name')->orderBy('servers.id');

        return $query->toBase()->paginate(perPage: min($perPage, self::MAX_PER_PAGE), page: $page);
    }

    /**
     * Category ids per server uuid, for the servers on one page.
     *
     * @param  Collection<int, stdClass>  $servers  rows from page()
     * @return array<int, list<int>> server id => category ids
     */
    public function categoriesFor(User $user, Collection $servers): array
    {
        $rows = DB::table('gobia_server_category_members as gm')
            ->join('gobia_server_categories as gc', 'gc.id', '=', 'gm.category_id')
            ->where('gc.user_id', $user->id)
            ->whereIn('gm.server_id', $servers->pluck('id'))
            ->get(['gm.server_id', 'gm.category_id']);

        $map = [];
        foreach ($rows as $row) {
            $map[(int) $row->server_id][] = (int) $row->category_id;
        }

        return $map;
    }

    /**
     * Categories with the number of the user's servers in each, plus the servers in none.
     *
     * @return array{categories: list<array{id: int, name: string, position: int, count: int}>, uncategorized: int, counts: array{all: int, you: int, other: int}}
     */
    public function summary(User $user): array
    {
        $accessible = fn (): Builder => $this->accessible($user);
        $categories = DB::table('gobia_server_categories as gc')
            ->where('gc.user_id', $user->id)
            ->orderBy('gc.position')->orderBy('gc.id')
            ->get(['gc.id', 'gc.name', 'gc.position']);

        $perCategory = DB::table('gobia_server_category_members as gm')
            ->join('gobia_server_categories as gc', 'gc.id', '=', 'gm.category_id')
            ->join('servers', 'servers.id', '=', 'gm.server_id')
            ->where('gc.user_id', $user->id)
            ->where(function ($query) use ($user): void {
                $query->where('servers.owner_id', $user->id)->orWhereExists(fn (QueryBuilder $subusers) => $subusers->selectRaw('1')->from('subusers')
                    ->whereColumn('subusers.server_id', 'servers.id')->where('subusers.user_id', $user->id));
            })
            ->groupBy('gm.category_id')
            ->selectRaw('gm.category_id, COUNT(*) as total')
            ->pluck('total', 'category_id');

        $all = $accessible()->count();
        $you = $accessible()->where('servers.owner_id', $user->id)->count();
        $categorised = DB::table('gobia_server_category_members as gm')
            ->join('gobia_server_categories as gc', 'gc.id', '=', 'gm.category_id')
            ->join('servers', 'servers.id', '=', 'gm.server_id')
            ->where('gc.user_id', $user->id)
            ->where(function ($query) use ($user): void {
                $query->where('servers.owner_id', $user->id)->orWhereExists(fn (QueryBuilder $subusers) => $subusers->selectRaw('1')->from('subusers')
                    ->whereColumn('subusers.server_id', 'servers.id')->where('subusers.user_id', $user->id));
            })
            ->distinct()->count('gm.server_id');

        return [
            'categories' => $categories->map(fn ($row): array => ['id' => (int) $row->id, 'name' => (string) $row->name, 'position' => (int) $row->position, 'count' => (int) ($perCategory[$row->id] ?? 0)])->all(),
            'uncategorized' => max(0, $all - $categorised),
            'counts' => ['all' => $all, 'you' => $you, 'other' => $all - $you],
        ];
    }

    /** @return array{id: int, name: string, position: int, count: int} */
    public function createCategory(User $user, string $name): array
    {
        $name = mb_trim($name);
        $existing = DB::table('gobia_server_categories')->where('user_id', $user->id)->get(['name']);
        if ($existing->count() >= self::MAX_CATEGORIES) {
            throw ValidationException::withMessages(['name' => 'You can have at most '.self::MAX_CATEGORIES.' categories.']);
        }
        $this->assertNameFree($user, $name, null);
        $position = (int) DB::table('gobia_server_categories')->where('user_id', $user->id)->max('position') + 1;
        $id = DB::table('gobia_server_categories')->insertGetId(['user_id' => $user->id, 'name' => $name, 'position' => $position, 'created_at' => now(), 'updated_at' => now()]);

        return ['id' => $id, 'name' => $name, 'position' => $position, 'count' => 0];
    }

    public function renameCategory(User $user, int $id, string $name): void
    {
        $this->ownedCategory($user, $id);
        $name = mb_trim($name);
        $this->assertNameFree($user, $name, $id);
        DB::table('gobia_server_categories')->where('id', $id)->update(['name' => $name, 'updated_at' => now()]);
    }

    public function deleteCategory(User $user, int $id): void
    {
        $this->ownedCategory($user, $id);
        DB::table('gobia_server_categories')->where('id', $id)->delete();
    }

    /** @param list<int> $ids every category of the user, in the new order */
    public function reorderCategories(User $user, array $ids): void
    {
        $owned = DB::table('gobia_server_categories')->where('user_id', $user->id)->pluck('id')->map(fn ($id): int => (int) $id)->all();
        if (count($ids) !== count(array_unique($ids)) || array_diff($ids, $owned) !== [] || array_diff($owned, $ids) !== []) {
            throw ValidationException::withMessages(['categories' => 'The list must contain each of your categories exactly once.']);
        }
        DB::transaction(function () use ($ids): void {
            foreach (array_values($ids) as $index => $id) {
                DB::table('gobia_server_categories')->where('id', $id)->update(['position' => $index + 1]);
            }
        });
    }

    /**
     * Replace the set of servers in a category. Servers the user cannot open are rejected, never silently dropped.
     *
     * @param  list<string>  $uuids
     */
    public function assign(User $user, int $categoryId, array $uuids): void
    {
        $this->ownedCategory($user, $categoryId);
        $servers = $this->resolve($user, $uuids);
        DB::transaction(function () use ($categoryId, $servers): void {
            DB::table('gobia_server_category_members')->where('category_id', $categoryId)->delete();
            foreach ($servers->values() as $index => $server) {
                DB::table('gobia_server_category_members')->insert(['category_id' => $categoryId, 'server_id' => $server->id, 'position' => $index + 1]);
            }
        });
    }

    /** Add or remove one server from one category without touching the rest. */
    public function toggleMembership(User $user, int $categoryId, string $uuid, bool $member): void
    {
        $this->ownedCategory($user, $categoryId);
        $server = $this->resolve($user, [$uuid])->first();
        $exists = DB::table('gobia_server_category_members')->where(['category_id' => $categoryId, 'server_id' => $server->id])->exists();
        if ($member && ! $exists) {
            $position = (int) DB::table('gobia_server_category_members')->where('category_id', $categoryId)->max('position') + 1;
            DB::table('gobia_server_category_members')->insert(['category_id' => $categoryId, 'server_id' => $server->id, 'position' => $position]);
        } elseif (! $member && $exists) {
            DB::table('gobia_server_category_members')->where(['category_id' => $categoryId, 'server_id' => $server->id])->delete();
        }
    }

    /**
     * Persist a new order for the servers a client is showing. The listed servers take over the positions they already
     * held, in the new order, so servers on other pages keep theirs.
     *
     * @param  list<string>  $uuids  the order, top first
     */
    public function reorder(User $user, ?int $categoryId, array $uuids): void
    {
        $servers = $this->resolve($user, $uuids)->values();
        DB::transaction(function () use ($user, $categoryId, $servers): void {
            if ($categoryId !== null) {
                $this->ownedCategory($user, $categoryId);
                $ids = $servers->pluck('id')->all();
                $members = DB::table('gobia_server_category_members')->where('category_id', $categoryId)->whereIn('server_id', $ids)->pluck('position', 'server_id');
                if ($members->count() !== count($ids)) {
                    throw ValidationException::withMessages(['servers' => 'Every server must be in the category.']);
                }
                $slots = $members->values()->sort()->values();
                foreach ($ids as $index => $id) {
                    DB::table('gobia_server_category_members')->where(['category_id' => $categoryId, 'server_id' => $id])->update(['position' => $slots[$index]]);
                }

                return;
            }

            $this->materialisePositions($user);
            $ids = $servers->pluck('id')->all();
            $held = DB::table('gobia_server_preferences')->where('user_id', $user->id)->whereIn('server_id', $ids)->pluck('position', 'server_id');
            $slots = $held->values()->sort()->values();
            foreach ($ids as $index => $id) {
                DB::table('gobia_server_preferences')->where(['user_id' => $user->id, 'server_id' => $id])->update(['position' => $slots[$index]]);
            }
        });
    }

    /** Sets or clears the user's icon colour for a server and remembers it in their recent colours. */
    public function setIconColor(User $user, string $uuid, ?string $color): UserProfile
    {
        $server = $this->resolve($user, [$uuid])->first();
        $color = $color === null ? null : mb_strtolower($color);
        if ($color !== null && preg_match(self::COLOR_PATTERN, $color) !== 1) {
            throw ValidationException::withMessages(['color' => 'The colour must look like #1264d1.']);
        }

        return DB::transaction(function () use ($user, $server, $color): UserProfile {
            DB::table('gobia_server_preferences')->updateOrInsert(['user_id' => $user->id, 'server_id' => $server->id], ['icon_color' => $color]);
            $profile = UserProfile::forUser($user);
            if ($color !== null) {
                $recent = array_values(array_unique([$color, ...($profile->recent_icon_colors ?? [])]));
                $profile->update(['recent_icon_colors' => array_slice($recent, 0, self::RECENT_COLORS)]);
            }

            return $profile;
        });
    }

    /**
     * @param  list<string>  $uuids
     * @return Collection<int, stdClass> rows with id and uuid, in the order given
     */
    public function resolve(User $user, array $uuids): Collection
    {
        $unique = array_values(array_unique($uuids));
        $servers = $this->accessible($user)->whereIn('servers.uuid', $unique)->toBase()->get(['servers.id', 'servers.uuid']);
        if ($servers->count() !== count($unique)) {
            throw ValidationException::withMessages(['servers' => 'One or more servers are not available to you.']);
        }
        $byUuid = $servers->keyBy('uuid');

        return collect($unique)->map(fn (string $uuid): stdClass => $byUuid[$uuid]);
    }

    /** Give every server the user can open a position (in the current default order) the first time they reorder. */
    private function materialisePositions(User $user): void
    {
        $missing = $this->accessible($user)
            ->leftJoin('gobia_server_preferences as gp', fn ($join) => $join->on('gp.server_id', '=', 'servers.id')->where('gp.user_id', '=', $user->id))
            ->whereNull('gp.position')
            ->orderBy('servers.name')->orderBy('servers.id')
            ->pluck('servers.id');
        if ($missing->isEmpty()) {
            return;
        }

        $next = (int) DB::table('gobia_server_preferences')->where('user_id', $user->id)->max('position');
        foreach ($missing as $id) {
            DB::table('gobia_server_preferences')->updateOrInsert(['user_id' => $user->id, 'server_id' => $id], ['position' => ++$next]);
        }
    }

    private function ownedCategory(User $user, int $id): void
    {
        if (! DB::table('gobia_server_categories')->where(['id' => $id, 'user_id' => $user->id])->exists()) {
            abort(404);
        }
    }

    private function assertNameFree(User $user, string $name, ?int $ignore): void
    {
        $query = DB::table('gobia_server_categories')->where('user_id', $user->id)->where('name', $name);
        if ($ignore !== null) {
            $query->where('id', '!=', $ignore);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['name' => 'You already have a category with this name.']);
        }
    }
}
