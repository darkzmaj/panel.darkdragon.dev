<?php

namespace Pterodactyl\Services\Subusers;

use Pterodactyl\Models\User;
use Pterodactyl\Models\Server;
use Pterodactyl\Models\Subuser;
use Pterodactyl\Facades\Activity;
use Illuminate\Support\Collection;
use Pterodactyl\Models\Permission;
use Pterodactyl\Jobs\RevokeSftpAccessJob;
use Illuminate\Database\ConnectionInterface;
use Pterodactyl\Exceptions\DisplayException;

/**
 * Account level management of server access. It is a thin layer over the existing subuser system:
 * every grant is an ordinary `subusers` row created by {@see SubuserCreationService}, so the old
 * permission checks, Wings token revocation and API keep working untouched. Each operation runs in
 * one transaction, so access is changed on all of the chosen servers or on none of them.
 */
class AccountAccessService
{
    public function __construct(
        private ConnectionInterface $connection,
        private SubuserCreationService $creationService,
    ) {
    }

    /**
     * The servers this user owns. Only these can have their access managed from the account.
     *
     * @return Collection<int, Server>
     */
    public function ownedServers(User $owner): Collection
    {
        return Server::query()->where('owner_id', $owner->id)->orderBy('name')->get();
    }

    /**
     * Everyone who has been given access to the owner's servers, one entry per person.
     *
     * @return array<int, array<string, mixed>>
     */
    public function grants(User $owner): array
    {
        $subusers = Subuser::query()
            ->with(['user', 'server:id,uuid,uuidShort,name'])
            ->whereHas('server', fn ($query) => $query->where('owner_id', $owner->id))
            ->get();

        $everything = $this->allPermissions();
        $ownedCount = $this->ownedServers($owner)->count();

        return $subusers->groupBy('user_id')->map(function (Collection $rows) use ($everything, $ownedCount) {
            /** @var User $user */
            $user = $rows->first()->user;
            // Per server permissions can differ when set through the old per-server screen; they are
            // summarized, and the edit form shows the union.
            $union = $rows->flatMap(fn (Subuser $row) => $row->permissions)->unique()->values();
            $full = $rows->every(fn (Subuser $row) => count(array_diff($everything, $row->permissions)) === 0);

            return [
                'uuid' => $user->uuid,
                'email' => $user->email,
                'username' => $user->username,
                'image' => $user->avatar_url,
                'servers' => $rows->map(fn (Subuser $row) => [
                    'uuid' => $row->server->uuid,
                    'identifier' => $row->server->uuidShort,
                    'name' => $row->server->name,
                    'permissions' => array_values($row->permissions),
                ])->sortBy('name')->values()->all(),
                'all_servers' => $rows->count() >= $ownedCount && $ownedCount > 0,
                'permissions' => $union->all(),
                'full_access' => $full,
            ];
        })->sortBy('email')->values()->all();
    }

    /**
     * Gives a person access to the chosen servers with the chosen permissions. Servers they already
     * have access to are updated, the rest are added.
     *
     * @param string[] $serverUuids
     * @param string[] $permissions
     *
     * @throws DisplayException
     */
    public function grant(User $owner, string $email, array $serverUuids, array $permissions): void
    {
        if (strcasecmp($owner->email, $email) === 0) {
            throw new DisplayException('You already own these servers.');
        }

        $servers = $this->resolveOwned($owner, $serverUuids);
        $permissions = $this->normalize($permissions);
        $after = [];

        $this->connection->transaction(function () use ($email, $servers, $permissions, &$after) {
            foreach ($servers as $server) {
                $existing = Subuser::query()
                    ->whereHas('user', fn ($query) => $query->where('email', $email))
                    ->where('server_id', $server->id)
                    ->first();

                if ($existing !== null) {
                    $this->setPermissions($existing, $server, $permissions, $after);
                    continue;
                }

                $subuser = $this->creationService->handle($server, $email, $permissions);
                Activity::event('server:subuser.create')
                    ->subject($server, $subuser->user)
                    ->property(['email' => $email, 'permissions' => $permissions, 'via' => 'account'])
                    ->log();
            }
        });

        $this->dispatch($after);
    }

    /**
     * Makes a person's access exactly match the given servers and permissions: servers are added,
     * updated or removed as needed.
     *
     * @param string[] $serverUuids
     * @param string[] $permissions
     *
     * @throws DisplayException
     */
    public function replace(User $owner, User $person, array $serverUuids, array $permissions): void
    {
        $target = $this->resolveOwned($owner, $serverUuids);
        $permissions = $this->normalize($permissions);
        $after = [];

        $this->connection->transaction(function () use ($owner, $person, $target, $permissions, &$after) {
            $current = Subuser::query()
                ->where('user_id', $person->id)
                ->whereHas('server', fn ($query) => $query->where('owner_id', $owner->id))
                ->with('server')
                ->get()
                ->keyBy('server_id');

            if ($current->isEmpty()) {
                throw new DisplayException('That person does not have access to any of your servers.');
            }

            foreach ($current as $row) {
                if (!$target->contains('id', $row->server_id)) {
                    $this->remove($row, $after);
                }
            }

            foreach ($target as $server) {
                if ($current->has($server->id)) {
                    $this->setPermissions($current[$server->id], $server, $permissions, $after);
                } else {
                    $subuser = $this->creationService->handle($server, $person->email, $permissions);
                    Activity::event('server:subuser.create')
                        ->subject($server, $subuser->user)
                        ->property(['email' => $person->email, 'permissions' => $permissions, 'via' => 'account'])
                        ->log();
                }
            }
        });

        $this->dispatch($after);
    }

    /**
     * Removes a person's access to every server the owner owns.
     *
     * @throws DisplayException
     */
    public function revoke(User $owner, User $person): void
    {
        $after = [];

        $this->connection->transaction(function () use ($owner, $person, &$after) {
            $rows = Subuser::query()
                ->where('user_id', $person->id)
                ->whereHas('server', fn ($query) => $query->where('owner_id', $owner->id))
                ->with('server')
                ->get();

            if ($rows->isEmpty()) {
                throw new DisplayException('That person does not have access to any of your servers.');
            }

            foreach ($rows as $row) {
                $this->remove($row, $after);
            }
        });

        $this->dispatch($after);
    }

    /**
     * Every assignable permission key, for example "control.console".
     *
     * @return string[]
     */
    public function allPermissions(): array
    {
        return Permission::permissions()
            ->flatMap(fn ($group, $prefix) => array_map(fn ($key) => "$prefix.$key", array_keys($group['keys'])))
            ->values()
            ->all();
    }

    /**
     * Drops anything that is not a real permission and always keeps the websocket permission, which every
     * subuser needs to open the console connection, exactly as the per-server screen does.
     *
     * @param string[] $permissions
     *
     * @return string[]
     *
     * @throws DisplayException
     */
    public function normalize(array $permissions): array
    {
        $clean = array_values(array_unique(array_merge(
            array_intersect($permissions, $this->allPermissions()),
            [Permission::ACTION_WEBSOCKET_CONNECT]
        )));

        if (count($clean) === 1) {
            throw new DisplayException('Choose at least one permission.');
        }

        return $clean;
    }

    /**
     * Loads the requested servers, requiring that every one of them is owned by $owner. A server that is
     * unknown or belongs to someone else fails the whole request without revealing which case it is.
     *
     * @param string[] $uuids
     *
     * @return Collection<int, Server>
     *
     * @throws DisplayException
     */
    private function resolveOwned(User $owner, array $uuids): Collection
    {
        $uuids = array_values(array_unique(array_filter($uuids, 'is_string')));
        if ($uuids === []) {
            throw new DisplayException('Choose at least one server.');
        }

        $servers = Server::query()->where('owner_id', $owner->id)->whereIn('uuid', $uuids)->get();
        if ($servers->count() !== count($uuids)) {
            throw new DisplayException('You can only manage access for servers you own.');
        }

        return $servers;
    }

    /**
     * @param array<int, array{0: string, 1: Server}> $after revocations to dispatch once the transaction commits
     */
    private function setPermissions(Subuser $subuser, Server $server, array $permissions, array &$after): void
    {
        $current = $subuser->permissions;
        sort($current);
        $wanted = $permissions;
        sort($wanted);

        if ($current === $wanted) {
            return;
        }

        $subuser->forceFill(['permissions' => $permissions])->save();
        Activity::event('server:subuser.update')
            ->subject($server, $subuser->user)
            ->property(['email' => $subuser->user->email, 'old' => $current, 'new' => $wanted, 'revoked' => true, 'via' => 'account'])
            ->log();
        $after[] = [$subuser->user->uuid, $server];
    }

    private function remove(Subuser $subuser, array &$after): void
    {
        Activity::event('server:subuser.delete')
            ->subject($subuser->server, $subuser->user)
            ->property(['email' => $subuser->user->email, 'revoked' => true, 'via' => 'account'])
            ->log();
        $subuser->delete();
        $after[] = [$subuser->user->uuid, $subuser->server];
    }

    /**
     * @param array<int, array{0: string, 1: Server}> $revocations
     */
    private function dispatch(array $revocations): void
    {
        foreach ($revocations as [$uuid, $server]) {
            RevokeSftpAccessJob::dispatch($uuid, $server);
        }
    }
}
