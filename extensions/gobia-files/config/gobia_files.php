<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Gobia Files: transfers between two servers
|--------------------------------------------------------------------------
|
| The Panel moves the bytes itself (it reads from the source node's Wings and writes to the destination node's Wings),
| so the browser never sees them and no Wings credential reaches it. A file is held in the PHP worker's memory while it
| travels, which is why a file above `max_file_bytes` is refused with a clear message instead of risking the worker.
| Raise it only together with PHP's memory_limit (about three times the file size is needed).
*/
return [
    'transfer' => [
        // Largest single file moved through the Panel.
        'max_file_bytes' => (int) env('GOBIA_FILES_TRANSFER_MAX_FILE_BYTES', 64 * 1024 * 1024),
        // Most files and folders one request may touch, counting everything inside the chosen folders.
        'max_entries' => (int) env('GOBIA_FILES_TRANSFER_MAX_ENTRIES', 2000),
        // Deepest folder nesting that is followed.
        'max_depth' => (int) env('GOBIA_FILES_TRANSFER_MAX_DEPTH', 24),
        // Files up to this size are read back from the destination and compared by SHA-256; larger ones by size only.
        'verify_hash_bytes' => (int) env('GOBIA_FILES_TRANSFER_VERIFY_HASH_BYTES', 16 * 1024 * 1024),
    ],
];
