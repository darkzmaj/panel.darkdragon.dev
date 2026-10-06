<?php

declare(strict_types=1);

namespace GobiaTemplates\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * The template SFTP process authenticates to the panel with a shared secret from the environment. Without a
 * configured secret (at least 32 characters) the endpoints are closed completely.
 */
class RequireSftpServiceToken
{
    public function handle(Request $request, Closure $next): mixed
    {
        $expected = (string) config('gobia_templates.sftp.service_token');
        $given = (string) $request->bearerToken();
        if ($expected === '' || mb_strlen($expected) < 32 || ! hash_equals($expected, $given)) {
            throw new AccessDeniedHttpException('Invalid service token.');
        }

        return $next($request);
    }
}
