<?php

return [
    // Adds a Server-Timing header (total, database, Wings) with durations and counts only.
    'server_timing' => (bool) env('GOBIA_SERVER_TIMING', env('APP_DEBUG', false)),

    // Development only: a file that receives one JSON line per SQL query (placeholders only, never bound values).
    'query_log' => env('GOBIA_QUERY_LOG'),
];
