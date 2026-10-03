<?php

namespace Pterodactyl\Http\Controllers\Api\Client;

use Pterodactyl\Models\User;
use Illuminate\Http\Response;
use Pterodactyl\Models\Server;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Services\Subusers\AccountAccessService;
use Pterodactyl\Http\Requests\Api\Client\ClientApiRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\StoreAccessRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\UpdateAccessRequest;

/**
 * Account level management of who can access the servers the signed in user owns.
 * It operates on the regular subuser records; see {@see AccountAccessService}.
 */
class AccountAccessController extends ClientApiController
{
    public function __construct(private AccountAccessService $access)
    {
        parent::__construct();
    }

    public function index(ClientApiRequest $request): JsonResponse
    {
        $user = $request->user();

        return new JsonResponse([
            'servers' => $this->access->ownedServers($user)->map(fn (Server $server) => [
                'uuid' => $server->uuid,
                'identifier' => $server->uuidShort,
                'name' => $server->name,
            ])->all(),
            'grants' => $this->access->grants($user),
        ]);
    }

    public function store(StoreAccessRequest $request): JsonResponse
    {
        $user = $request->user();
        $this->access->grant(
            $user,
            $request->validated('email'),
            $this->servers($request, $user),
            $this->permissions($request)
        );

        return new JsonResponse(['grants' => $this->access->grants($user)], Response::HTTP_CREATED);
    }

    public function update(UpdateAccessRequest $request, string $person): JsonResponse
    {
        $user = $request->user();
        $this->access->replace(
            $user,
            User::query()->where('uuid', $person)->firstOrFail(),
            $this->servers($request, $user),
            $this->permissions($request)
        );

        return new JsonResponse(['grants' => $this->access->grants($user)]);
    }

    public function delete(ClientApiRequest $request, string $person): JsonResponse
    {
        $user = $request->user();
        $this->access->revoke($user, User::query()->where('uuid', $person)->firstOrFail());

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * @return string[]
     */
    private function servers(ClientApiRequest $request, User $user): array
    {
        return $request->boolean('all_servers')
            ? $this->access->ownedServers($user)->pluck('uuid')->all()
            : (array) $request->validated('servers', []);
    }

    /**
     * @return string[]
     */
    private function permissions(ClientApiRequest $request): array
    {
        return $request->boolean('all_permissions')
            ? $this->access->allPermissions()
            : (array) $request->validated('permissions', []);
    }
}
