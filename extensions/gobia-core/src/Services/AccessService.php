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
use stdClass;

/**
 * Account level management of who can open the servers a user owns. It is a thin layer over the panel's subuser actions,
 * so every grant is an ordinary subuser row and the panel's own permission checks, SFTP revocation and activity log
 * apply unchanged. Only servers the caller owns can ever be touched.
 */
class AccessService
{
    public function __construct(
        private readonly CreatesSubusers $creator,
        private readonly UpdatesSubusers $updater,
        private readonly DeletesSubusers $deleter,
        private readonly SubuserPermissionCatalog $catalog,
    ) {}

    /** @return Collection<int, stdClass> */
    public function ownedServers(User $owner): Collection
    {
        return Server::query()->where('owner_id', $owner->id)->orderBy('name')->toBase()->get(['id', 'uuid', 'uuidShort', 'name']);
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
            ->whereHas('server', fn ($query) => $query->where('owner_id', $owner->id))
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
        if (mb_strtolower($owner->email) === mb_strtolower($email)) {
            throw ValidationException::withMessages(['email' => 'You already own these servers.']);
        }

        DB::transaction(function () use ($email, $servers, $permissions): void {
            foreach ($servers as $server) {
                $existing = Subuser::query()->where('server_id', $server->id)->whereHas('user', fn ($query) => $query->where('email', $email))->first();
                if ($existing !== null) {
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

    /** @return Collection<int, Subuser> */
    private function rows(User $owner, User $person): Collection
    {
        return Subuser::query()->with(['server', 'user'])->where('user_id', $person->id)->whereHas('server', fn ($query) => $query->where('owner_id', $owner->id))->get();
    }

    /** The person must currently have access to at least one of the owner's servers; anyone else is a 404. */
    private function person(User $owner, string $uuid): User
    {
        $person = User::query()->where('uuid', $uuid)->first();
        if ($person === null || Subuser::query()->where('user_id', $person->id)->whereHas('server', fn ($query) => $query->where('owner_id', $owner->id))->doesntExist()) {
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
        $servers = Server::query()->where('owner_id', $owner->id)->whereIn('uuid', $unique)->get();
        if ($unique === [] || $servers->count() !== count($unique)) {
            throw ValidationException::withMessages(['servers' => 'Choose at least one server you own.']);
        }

        return $servers;
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
