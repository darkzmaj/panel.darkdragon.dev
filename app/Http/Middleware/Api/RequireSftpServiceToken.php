<?php

namespace Pterodactyl\Http\Middleware\Api;

use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The template SFTP process authenticates to the Panel with a shared secret from the environment. If no secret is
 * configured the endpoints are closed completely.
 */
class RequireSftpServiceToken
{
    public function handle(Request $request, \Closure $next): mixed
    {
        $expected = (string) config('gobia_templates.sftp.service_token');
        $given = (string) $request->bearerToken();

        if ($expected === '' || strlen($expected) < 32 || !hash_equals($expected, $given)) {
            throw new AccessDeniedHttpException('Invalid service token.');
        }

        return $next($request);
    }
}
