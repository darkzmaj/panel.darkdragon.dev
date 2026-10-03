<?php

namespace Pterodactyl\Http\Controllers\Api\Client;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Auth\AuthManager;
use Illuminate\Http\JsonResponse;
use Pterodactyl\Facades\Activity;
use Illuminate\Support\Facades\RateLimiter;
use Pterodactyl\Services\Media\AvatarService;
use Pterodactyl\Services\Users\UserUpdateService;
use Pterodactyl\Transformers\Api\Client\AccountTransformer;
use Pterodactyl\Http\Requests\Api\Client\Account\UpdateEmailRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\UpdateAvatarRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\UpdatePasswordRequest;
use Pterodactyl\Http\Requests\Api\Client\Account\UpdateUsernameRequest;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

class AccountController extends ClientApiController
{
    /**
     * The number of seconds that must elapse before the email change throttle resets.
     */
    private const EMAIL_UPDATE_THROTTLE = 60 * 60 * 24;

    /**
     * Usernames are login names that other people see in activity logs, so they may only change a few times a day.
     */
    private const USERNAME_UPDATE_LIMIT = 3;

    /**
     * AccountController constructor.
     */
    public function __construct(
        private AuthManager $manager,
        private UserUpdateService $updateService,
        private AvatarService $avatarService,
    ) {
        parent::__construct();
    }

    public function index(Request $request): array
    {
        return $this->fractal->item($request->user())
            ->transformWith($this->getTransformer(AccountTransformer::class))
            ->toArray();
    }

    /**
     * Update the authenticated user's email address.
     */
    public function updateEmail(UpdateEmailRequest $request): JsonResponse
    {
        $user = $request->user();
        // Only allow a user to change their email three times in the span
        // of 24 hours. This prevents malicious users from trying to find
        // existing accounts in the system by constantly changing their email.
        if (RateLimiter::tooManyAttempts($key = "user:update-email:{$user->uuid}", 3)) {
            throw new TooManyRequestsHttpException(message: 'Your email address has been changed too many times today. Please try again later.');
        }

        $original = $user->email;
        if (mb_strtolower($original) !== mb_strtolower($request->validated('email'))) {
            RateLimiter::hit($key, self::EMAIL_UPDATE_THROTTLE);

            $this->updateService->handle($user, $request->validated());

            Activity::event('user:account.email-changed')
                ->property(['old' => $original, 'new' => $request->validated('email')])
                ->log();
        }

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Update the authenticated user's username. Everything else in the system refers to
     * a user by their immutable ID or UUID, so no other records depend on the username.
     */
    public function updateUsername(UpdateUsernameRequest $request): JsonResponse
    {
        $key = 'user:update-username:' . $request->user()->uuid;
        if (RateLimiter::tooManyAttempts($key, self::USERNAME_UPDATE_LIMIT)) {
            throw new TooManyRequestsHttpException(message: 'Your username has been changed too many times today. Please try again later.');
        }

        $original = $request->user()->username;
        $user = $this->updateService->handle($request->user(), $request->validated());

        if ($original !== $user->username) {
            // Only real changes count; submitting the current username again is a no-op.
            RateLimiter::hit($key, self::EMAIL_UPDATE_THROTTLE);

            Activity::event('user:account.username-changed')
                ->property(['old' => $original, 'new' => $user->username])
                ->log();
        }

        return new JsonResponse(['username' => $user->username]);
    }

    /**
     * Replace the authenticated user's profile picture.
     *
     * @throws \Pterodactyl\Exceptions\DisplayException
     */
    public function updateAvatar(UpdateAvatarRequest $request): JsonResponse
    {
        $user = $this->avatarService->store($request->user(), $request->file('avatar'));

        Activity::event('user:account.avatar-changed')->log();

        return new JsonResponse(['avatar_url' => $user->avatar_url]);
    }

    /**
     * Store the interface theme (system, dark or light) so it follows the user between devices.
     */
    public function updateAppearance(Request $request): JsonResponse
    {
        $data = $request->validate(['theme' => 'required|string|in:system,dark,light']);

        $request->user()->forceFill(['theme' => $data['theme']])->save();

        return new JsonResponse(['theme' => $data['theme']]);
    }

    /**
     * Remove the authenticated user's profile picture.
     */
    public function deleteAvatar(Request $request): JsonResponse
    {
        $this->avatarService->remove($request->user());

        Activity::event('user:account.avatar-removed')->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Update the authenticated user's password. All existing sessions will be logged
     * out immediately.
     *
     * @throws \Throwable
     */
    public function updatePassword(UpdatePasswordRequest $request): JsonResponse
    {
        $user = Activity::event('user:account.password-changed')->transaction(function () use ($request) {
            return $this->updateService->handle($request->user(), $request->validated());
        });

        $guard = $this->manager->guard();
        // If you do not update the user in the session you'll end up working with a
        // cached copy of the user that does not include the updated password. Do this
        // to correctly store the new user details in the guard and allow the logout
        // other devices functionality to work.
        $guard->setUser($user);

        // This method doesn't exist in the stateless Sanctum world.
        if (method_exists($guard, 'logoutOtherDevices')) { // @phpstan-ignore function.alreadyNarrowedType
            $guard->logoutOtherDevices($request->input('password'));
        }

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}
