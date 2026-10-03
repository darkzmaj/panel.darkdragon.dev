<?php

namespace Pterodactyl\Services\Updater;

use GuzzleHttp\Client;
use GuzzleHttp\Cookie\CookieJar;
use Pterodactyl\Services\Updater\Exceptions\UpdateException;

/**
 * Requests the running site over HTTP while it is still in maintenance mode, using the one-time
 * maintenance secret, to prove that the web stack serves the new release.
 */
class HttpHealthProbe
{
    public function check(string $secret): void
    {
        $base = rtrim((string) (config('gobia.update.health_url') ?: config('app.url')), '/');
        $jar = new CookieJar();
        $client = new Client(['cookies' => $jar, 'timeout' => 20, 'connect_timeout' => 5, 'http_errors' => false, 'allow_redirects' => false]);

        try {
            // Visiting the secret path sets the cookie that bypasses maintenance mode.
            $client->get($base . '/' . $secret);
            $login = $client->get($base . '/auth/login');
            $asset = $client->get($base . '/favicons/favicon-32x32.png');
        } catch (\Throwable $exception) {
            throw new UpdateException('The site did not respond to the health check: ' . Redactor::scrub($exception->getMessage()));
        }

        if ($login->getStatusCode() !== 200) {
            throw new UpdateException('The login page returned HTTP ' . $login->getStatusCode() . ' during the health check.');
        }

        if ($asset->getStatusCode() !== 200) {
            throw new UpdateException('Public assets returned HTTP ' . $asset->getStatusCode() . ' during the health check.');
        }
    }
}
