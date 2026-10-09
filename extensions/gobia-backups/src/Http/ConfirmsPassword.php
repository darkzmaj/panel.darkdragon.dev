<?php

declare(strict_types=1);

namespace GobiaBackups\Http;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Pterodactyl\Exceptions\Http\Base\InvalidPasswordProvidedException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

/** A restore overwrites a server's files, so it asks for the account password again, with a limit on guesses. */
trait ConfirmsPassword
{
    private function confirmPassword(Request $request, string $password): void
    {
        $user = $request->user();
        $key = 'gobia-backups:restore-password:'.$user->id;
        if (RateLimiter::tooManyAttempts($key, 5)) {
            throw new TooManyRequestsHttpException(RateLimiter::availableIn($key), 'Too many attempts. Try again later.');
        }
        if (! Hash::check($password, $user->password)) {
            RateLimiter::hit($key, 900);

            throw new InvalidPasswordProvidedException(trans('validation.internal.invalid_password'));
        }
        RateLimiter::clear($key);
    }
}
