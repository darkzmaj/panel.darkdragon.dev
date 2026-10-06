<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Models\UserProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;

#[Group('Gobia profile')]
class ProfileController
{
    #[Endpoint('Get the Gobia profile', 'Returns the signed in user\'s Gobia profile (appearance).')]
    public function show(Request $request): JsonResponse
    {
        return new JsonResponse($this->payload(UserProfile::forUser($request->user())));
    }

    #[Endpoint('Update appearance', 'Stores the signed in user\'s colour scheme preference.')]
    public function updateAppearance(Request $request): JsonResponse
    {
        $data = $request->validate(['theme' => ['required', 'string', Rule::in(UserProfile::THEMES)]]);
        $profile = UserProfile::forUser($request->user());
        $profile->update(['theme' => $data['theme']]);

        return new JsonResponse($this->payload($profile));
    }

    /** @return array{theme: string} */
    private function payload(UserProfile $profile): array
    {
        return ['theme' => $profile->theme];
    }
}
