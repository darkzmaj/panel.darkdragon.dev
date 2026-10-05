<?php

namespace Pterodactyl\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Pterodactyl\Support\PerfTimings;
use Symfony\Component\HttpFoundation\Response;

/**
 * Adds a Server-Timing header (total, database, Wings) to responses while GOBIA_SERVER_TIMING is enabled, so the browser's
 * network panel and the performance scripts can see where a request spent its time. It reports durations and query
 * counts only. It is off by default in production.
 */
class ServerTiming
{
    public function handle(Request $request, \Closure $next): Response
    {
        if (!config('gobia_perf.server_timing')) {
            return $next($request);
        }

        PerfTimings::reset();
        $start = defined('LARAVEL_START') ? LARAVEL_START : microtime(true);
        $log = config('gobia_perf.query_log');
        DB::listen(function ($query) use ($log, $request) {
            PerfTimings::add('db', $query->time);
            // Development aid for finding repeated queries: the SQL with placeholders (never the bound values).
            if ($log) {
                file_put_contents($log, json_encode(['path' => $request->method() . ' ' . $request->path(), 'sql' => $query->sql, 'ms' => $query->time]) . '
', FILE_APPEND);
            }
        });

        $response = $next($request);

        $parts = ['total;dur=' . round((microtime(true) - $start) * 1000, 1)];
        foreach (PerfTimings::all() as $name => $bucket) {
            $parts[] = sprintf('%s;dur=%s;desc="%d"', $name, round($bucket['ms'], 1), $bucket['count']);
        }
        $response->headers->set('Server-Timing', implode(', ', $parts));

        return $response;
    }
}
