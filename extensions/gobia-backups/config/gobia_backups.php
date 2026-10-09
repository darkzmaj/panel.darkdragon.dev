<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Gobia Backups: offsite backups on a Hetzner Storage Box
|--------------------------------------------------------------------------
|
| Destinations, credentials and policies live in the database (credentials encrypted with the Panel key).
| This file only holds limits that protect the Panel and the Storage Box. See docs/gobia-backups.md.
*/
return [
    // Backups that may be in flight at once (archiving on a node, or uploading), overall and per node / destination.
    // A Storage Box accepts ten connections per account; each upload uses one, so keep the last value well below ten.
    'concurrency' => [
        'global' => (int) env('GOBIA_BACKUPS_CONCURRENCY', 6),
        'per_node' => (int) env('GOBIA_BACKUPS_CONCURRENCY_PER_NODE', 2),
        'per_destination' => (int) env('GOBIA_BACKUPS_CONCURRENCY_PER_DESTINATION', 4),
    ],

    // Seconds Wings may take to build the archive before the run counts as failed.
    'archive_timeout' => (int) env('GOBIA_BACKUPS_ARCHIVE_TIMEOUT', 6 * 3600),

    // Seconds one upload or restore stream may take.
    'transfer_timeout' => (int) env('GOBIA_BACKUPS_TRANSFER_TIMEOUT', 6 * 3600),

    // Seconds an upload may sit without progress before it counts as dead and is retried or failed.
    'stale_after' => (int) env('GOBIA_BACKUPS_STALE_AFTER', 900),

    // A failed run is tried again this many times in total, waiting this many seconds between attempts.
    'attempts' => (int) env('GOBIA_BACKUPS_ATTEMPTS', 3),
    'retry_after' => (int) env('GOBIA_BACKUPS_RETRY_AFTER', 600),

    // How long the link Wings downloads a restore from stays valid. Only the start of the download must fall inside it.
    'restore_link_minutes' => 15,

    // SSH settings for the Storage Box connection.
    'connect_timeout' => 15,
];
