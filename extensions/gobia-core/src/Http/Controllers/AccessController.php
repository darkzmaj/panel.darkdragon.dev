<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Services\AccessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;

#[Group('Gobia access')]
class AccessController
{
    private const array RULES = [
        'servers' => ['required', 'array', 'min:1', 'max:500'],
        'servers.*' => ['required', 'string', 'uuid'],
        'permissions' => ['present', 'array', 'max:200'],
        'permissions.*' => ['required', 'string', 'max:100'],
    ];

    public function __construct(private readonly AccessService $access) {}

    #[Endpoint('List access', 'Everyone with access to the signed in user\'s servers, those servers with what may be granted on each, and the permission catalog.')]
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        return new JsonResponse([
            'grants' => $this->access->grants($user),
            'servers' => $this->access->manageable($user),
            'permission_groups' => $this->access->permissionGroups(),
        ]);
    }

    #[Endpoint('Grant access', 'Gives a person access to one or more servers the signed in user owns or manages. Managers can only give permissions they hold.')]
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email:strict', 'max:191']] + self::RULES);
        $this->access->grant($request->user(), $data['email'], array_values($data['servers']), array_values($data['permissions']));

        return new JsonResponse(['ok' => true], 201);
    }

    #[Endpoint('Replace access', 'Makes a person\'s access exactly the given servers and permissions.')]
    public function update(Request $request, string $person): JsonResponse
    {
        $data = $request->validate(self::RULES);
        $this->access->replace($request->user(), $person, array_values($data['servers']), array_values($data['permissions']));

        return new JsonResponse(['ok' => true]);
    }

    #[Endpoint('Remove access', 'Removes a person\'s access to every server the signed in user owns.')]
    public function destroy(Request $request, string $person): JsonResponse
    {
        $this->access->revoke($request->user(), $person);

        return new JsonResponse(['ok' => true]);
    }
}
