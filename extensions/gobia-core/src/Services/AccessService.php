<?php

declare(strict_types=1);

namespace GobiaCore\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Pterodactyl\Contracts\Subusers\CreatesSubusers;
use Pterodactyl\Contracts\Subusers\DeletesSubusers;
use Pterodactyl\Contracts\Subusers\UpdatesSubusers;
use Pterodactyl\Exceptions\Service\Subuser\UserIsServerOwnerException;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Models\User;
use Pterodactyl\Services\Servers\SubuserPermissionCatalog;

/**
 * Account level management of who can open the servers a user owns. It is a thin layer over the panel's subuser actions,
 * so every grant is an ordinary subuser row and the panel's own permission checks, SFTP revocation and activity log
 * apply unchanged. The caller can touch the servers they own and the servers where they were given the whole user
 * management set (user.create, user.read, user.update and user.delete); on the second kind they can only hand out
 * permissions they hold themselves and cannot change anyone who holds more than they do.
 */
class AccessService
{
    /** The permissions that make someone a delegated manager of a server's access. */
    public const array MANAGEMENT = ['user.create', 'user.read', 'user.update', 'user.delete'];

    public function __construct(
        private readonly CreatesSubusers $creator,
        private readonly UpdatesSubusers $updater,
        private readonly DeletesSubusers $deleter,
        private readonly SubuserPermissionCatalog $catalog,
    ) {}

    /**
     * The servers the caller may share, with what they may hand out: null means every permission (they own it).
     *
     * @return list<array{uuid: string, name: string, owned: bool, grantable: list<string>|null}>
     */
    public function manageable(User $actor): array
    {
        return $this->managed($actor)->map(fn (Server $server): array => [
            'uuid' => $server->uuid,
            'name' => $server->name,
            'owned' => $server->owner_id === $actor->id,
            'grantable' => $this->authority($actor, $server),
        ])->all();
    }

    /**
     * Everyone with access to the owner's servers, one entry per person.
     *
     * @return list<array{uuid: string, email: string, username: string, servers: list<array{uuid: string, name: string, permissions: list<string>}>, permissions: list<string>}>
     */
    public function grants(User $owner): array
    {
        $rows = Subuser::query()
            ->with(['user', 'server'])
            ->whereIn('server_id', $this->managed($owner)->pluck('id'))
            ->where('user_id', '!=', $owner->id)
            ->get();

        return $rows->groupBy('user_id')->map(function (Collection $group): array {
            $user = $group->first()->user;

            return [
                'uuid' => $user->uuid,
                'email' => $user->email,
                'username' => $user->username,
                'servers' => $group->map(fn (Subuser $row): array => ['uuid' => $row->server->uuid, 'name' => $row->server->name, 'permissions' => array_values($row->permissions)])->sortBy('name')->values()->all(),
                'permissions' => $group->flatMap(fn (Subuser $row): array => $row->permissions)->unique()->sort()->values()->all(),
            ];
        })->sortBy('email')->values()->all();
    }

    /**
     * Give a person access to the chosen servers. Servers they can already open are updated.
     *
     * @param  list<string>  $serverUuids
     * @param  list<string>  $permissions
     */
    public function grant(User $owner, string $email, array $serverUuids, array $permissions): void
    {
        $servers = $this->owned($owner, $serverUuids);
        $permissions = $this->permissions($permissions);
        $this->assertDelegable($owner, $servers, $permissions);
        if (mb_strtolower($owner->email) === mb_strtolower($email)) {
            throw ValidationException::withMessages(['email' => 'You already have access to these servers.']);
        }

        DB::transaction(function () use ($owner, $email, $servers, $permissions): void {
            foreach ($servers as $server) {
                $existing = Subuser::query()->where('server_id', $server->id)->whereHas('user', fn ($query) => $query->where('email', $email))->first();
                if ($existing !== null) {
                    // Granting to someone who already has access rewrites their permissions, so the same rule as
                    // replace() applies: a manager cannot change a person who holds more than they do.
                    $held = $this->authority($owner, $server);
                    if ($held !== null && array_diff($existing->permissions, $held) !== []) {
                        abort(403, 'This person holds more permissions than you on '.$server->name.'.');
                    }
                    $this->updater->update($server, $existing, $permissions);
                    Activity::event('server:subuser.update')->subject($server, $existing->user)->property(['email' => $email, 'new' => $permissions, 'via' => 'account'])->log();

                    continue;
                }
                try {
                    $subuser = $this->creator->create($server, $email, $permissions);
                } catch (UserIsServerOwnerException) {
                    throw ValidationException::withMessages(['email' => 'You already own these servers.']);
                }
                Activity::event('server:subuser.create')->subject($server, $subuser->user)->property(['email' => $email, 'permissions' => $permissions, 'via' => 'account'])->log();
            }
        });
    }

    /**
     * Make one person's access to the owner's servers exactly the given servers and permissions.
     *
     * @param  list<string>  $serverUuids
     * @param  list<string>  $permissions
     */
    public function replace(User $owner, string $personUuid, array $serverUuids, array $permissions): void
    {
        $person = $this->person($owner, $personUuid);
        $target = $this->owned($owner, $serverUuids);
        $permissions = $this->permissions($permissions);
        $this->assertDelegable($owner, $target, $permissions);
        $this->assertNotMorePrivileged($owner, $person);

        DB::transaction(function () use ($owner, $person, $target, $permissions): void {
            $current = $this->rows($owner, $person)->keyBy('server_id');
            foreach ($current as $row) {
                if (! $target->contains('id', $row->server_id)) {
                    $this->deleter->delete($row->server, $row);
                    Activity::event('server:subuser.delete')->subject($row->server, $person)->property(['email' => $person->email, 'via' => 'account'])->log();
                }
            }
            foreach ($target as $server) {
                if ($current->has($server->id)) {
                    $this->updater->update($server, $current[$server->id], $permissions);
                    Activity::event('server:subuser.update')->subject($server, $person)->property(['email' => $person->email, 'new' => $permissions, 'via' => 'account'])->log();
                } else {
                    $this->creator->create($server, $person->email, $permissions);
                    Activity::event('server:subuser.create')->subject($server, $person)->property(['email' => $person->email, 'permissions' => $permissions, 'via' => 'account'])->log();
                }
            }
        });
    }

    public function revoke(User $owner, string $personUuid): void
    {
        $person = $this->person($owner, $personUuid);
        $this->assertNotMorePrivileged($owner, $person);
        DB::transaction(function () use ($owner, $person): void {
            foreach ($this->rows($owner, $person) as $row) {
                $this->deleter->delete($row->server, $row);
                Activity::event('server:subuser.delete')->subject($row->server, $person)->property(['email' => $person->email, 'via' => 'account'])->log();
            }
        });
    }

    /** @return array<string, array{description: string, keys: array<string, string>}> */
    public function permissionGroups(): array
    {
        return $this->catalog->groups()->all();
    }

    /** @return Collection<int, Server> */
    private function managed(User $actor): Collection
    {
        $owned = Server::query()->where('owner_id', $actor->id)->get();
        $delegated = Server::query()
            ->where('owner_id', '!=', $actor->id)
            ->whereHas('subusers', fn ($query) => $query->where('user_id', $actor->id))
            ->get()
            ->filter(fn (Server $server): bool => array_diff(self::MANAGEMENT, $this->authority($actor, $server) ?? self::MANAGEMENT) === []);

        return $owned->concat($delegated)->sortBy('name')->values();
    }

    /**
     * What the caller holds on a server: null for the owner (everything), the subuser permissions otherwise. An
     * administrator account is not special here: this page is about the caller's own servers and shares.
     *
     * @return list<string>|null
     */
    private function authority(User $actor, Server $server): ?array
    {
        if ($server->owner_id === $actor->id) {
            return null;
        }
        $row = Subuser::query()->where('server_id', $server->id)->where('user_id', $actor->id)->first();

        return $row === null ? [] : array_values($row->permissions);
    }

    /** @return Collection<int, Subuser> */
    private function rows(User $owner, User $person): Collection
    {
        return Subuser::query()->with(['server', 'user'])->where('user_id', $person->id)->whereIn('server_id', $this->managed($owner)->pluck('id'))->get();
    }

    /** The person must currently have access to at least one of the owner's servers; anyone else is a 404. */
    private function person(User $owner, string $uuid): User
    {
        $person = User::query()->where('uuid', $uuid)->first();
        if ($person === null || $person->id === $owner->id || Subuser::query()->where('user_id', $person->id)->whereIn('server_id', $this->managed($owner)->pluck('id'))->doesntExist()) {
            abort(404);
        }

        return $person;
    }

    /**
     * @param  list<string>  $uuids
     * @return Collection<int, Server>
     */
    private function owned(User $owner, array $uuids): Collection
    {
        $unique = array_values(array_unique($uuids));
        $servers = $this->managed($owner)->whereIn('uuid', $unique)->values();
        if ($unique === [] || $servers->count() !== count($unique)) {
            throw ValidationException::withMessages(['servers' => 'Choose at least one server you can share.']);
        }

        return $servers;
    }

    /**
     * A manager who does not own a server can only hand out permissions they hold themselves there.
     *
     * @param  Collection<int, Server>  $servers
     * @param  list<string>  $permissions
     */
    private function assertDelegable(User $actor, Collection $servers, array $permissions): void
    {
        foreach ($servers as $server) {
            $held = $this->authority($actor, $server);
            if ($held !== null && array_diff(array_diff($permissions, ['websocket.connect']), $held) !== []) {
                throw ValidationException::withMessages(['permissions' => 'You can only give permissions you have yourself on '.$server->name.'.']);
            }
        }
    }

    /** Someone who holds more than the caller on a shared server is not the caller's to change or remove. */
    private function assertNotMorePrivileged(User $actor, User $person): void
    {
        foreach ($this->rows($actor, $person) as $row) {
            $held = $this->authority($actor, $row->server);
            if ($held !== null && array_diff($row->permissions, $held) !== []) {
                abort(403, 'This person holds more permissions than you on '.$row->server->name.'.');
            }
        }
    }

    /**
     * @param  list<string>  $permissions
     * @return list<string>
     */
    private function permissions(array $permissions): array
    {
        $unique = array_values(array_unique($permissions));
        $unknown = array_diff($unique, $this->catalog->keys());
        if ($unknown !== []) {
            throw ValidationException::withMessages(['permissions' => 'Unknown permission: '.reset($unknown).'.']);
        }

        return $unique;
    }
}
