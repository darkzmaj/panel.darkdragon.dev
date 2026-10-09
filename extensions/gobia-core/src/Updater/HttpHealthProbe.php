<?php

declare(strict_types=1);

namespace GobiaCore\Updater;

use GobiaCore\Updater\Exceptions\UpdateException;
use GuzzleHttp\Client;
use GuzzleHttp\Cookie\CookieJar;
use Throwable;

/**
 * Requests the running site over HTTP while it is still in maintenance mode, using the one-time
 * maintenance secret, to prove that the web stack serves the new release.
 */
class HttpHealthProbe
{
    public function check(string $secret): void
    {
        if (! config('gobia_updater.http_probe', true)) {
            return;
        }

        $base = rtrim((string) (config('gobia_updater.health_url') ?: config('app.url')), '/');
        $client = new Client(['cookies' => new CookieJar, 'timeout' => 20, 'connect_timeout' => 5, 'http_errors' => false, 'allow_redirects' => false]);

        try {
            // Visiting the secret path sets the cookie that bypasses maintenance mode.
            $client->get($base.'/'.$secret);
            $login = $client->get($base.'/auth/login');
            $asset = $client->get($base.'/robots.txt');
        } catch (Throwable $exception) {
            throw new UpdateException('The site did not respond to the health check: '.Redactor::scrub($exception->getMessage()));
        }

        if ($login->getStatusCode() !== 200) {
            throw new UpdateException('The sign in page returned HTTP '.$login->getStatusCode().' during the health check.');
        }

        // A status code alone proves little: a web server can answer 200 with a PHP error page. The Panel's
        // own shell always carries its CSRF token.
        if (! str_contains((string) $login->getBody(), 'name="csrf-token"')) {
            throw new UpdateException('The sign in page did not render the Panel during the health check.');
        }

        if ($asset->getStatusCode() !== 200) {
            throw new UpdateException('Public files returned HTTP '.$asset->getStatusCode().' during the health check.');
        }
    }
}
