<?php

declare(strict_types=1);

namespace GobiaCore\Http\Controllers;

use GobiaCore\Models\UserProfile;
use GobiaCore\Services\AvatarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Knuckles\Scribe\Attributes\Endpoint;
use Knuckles\Scribe\Attributes\Group;
use Pterodactyl\Exceptions\Http\Base\InvalidPasswordProvidedException;
use Pterodactyl\Facades\Activity;
use Pterodactyl\Models\User;
use Pterodactyl\Validation\UserRules;

#[Group('Gobia profile')]
class ProfileController
{
    public function __construct(private readonly AvatarService $avatars) {}

    #[Endpoint('Get the Gobia profile', 'Returns the signed in user\'s Gobia profile: appearance, avatar and username.')]
    public function show(Request $request): JsonResponse
    {
        return new JsonResponse($this->payload($request->user(), UserProfile::forUser($request->user())));
    }

    #[Endpoint('Update appearance', 'Stores the signed in user\'s colour scheme preference.')]
    public function updateAppearance(Request $request): JsonResponse
    {
        $data = $request->validate(['theme' => ['required', 'string', Rule::in(UserProfile::THEMES)]]);
        $profile = UserProfile::forUser($request->user());
        $profile->update(['theme' => $data['theme']]);

        return new JsonResponse($this->payload($request->user(), $profile));
    }

    #[Endpoint('Upload an avatar', 'Replaces the signed in user\'s avatar with a PNG, normalised to a 256 pixel square.')]
    public function updateAvatar(Request $request): JsonResponse
    {
        $request->validate(['avatar' => ['required', 'file', 'max:2048']]);
        $profile = $this->avatars->store($request->user(), $request->file('avatar'));
        Activity::event('gobia:profile.avatar-changed')->log();

        return new JsonResponse($this->payload($request->user(), $profile));
    }

    #[Endpoint('Remove the avatar', 'Removes the signed in user\'s avatar so the generated one is shown again.')]
    public function deleteAvatar(Request $request): JsonResponse
    {
        $profile = $this->avatars->remove($request->user());
        Activity::event('gobia:profile.avatar-removed')->log();

        return new JsonResponse($this->payload($request->user(), $profile));
    }

    #[Endpoint('Change username', 'Changes the signed in user\'s username after confirming their password.')]
    public function updateUsername(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'username' => UserRules::rules($user)['username'],
            'password' => ['required', 'string'],
        ]);
        throw_unless(Hash::check($data['password'], $user->password), InvalidPasswordProvidedException::class, trans('validation.internal.invalid_password'));

        $original = $user->username;
        if ($original !== mb_strtolower($data['username'])) {
            $user->forceFill(['username' => $data['username']])->save();
            Activity::event('gobia:profile.username-changed')->property(['old' => $original, 'new' => $user->username])->log();
        }

        return new JsonResponse($this->payload($user, UserProfile::forUser($user)));
    }

    /** @return array{theme: string, avatar_url: string|null, username: string} */
    private function payload(User $user, UserProfile $profile): array
    {
        return ['theme' => $profile->theme, 'avatar_url' => AvatarService::url($profile), 'username' => $user->username];
    }
}
