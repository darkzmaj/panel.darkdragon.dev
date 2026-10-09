<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Gobia Files: transfers between two servers
|--------------------------------------------------------------------------
|
| The Panel moves the bytes itself (it reads from the source node's Wings and writes to the destination node's Wings),
| so the browser never sees them and no Wings credential reaches it. A file is streamed through `php://temp` (a few MiB
| in memory, the rest in a temporary file), so the memory a worker needs does not grow with the file; the limits below
| are about time and disk, not memory.
*/
return [
    'transfer' => [
        // Largest single file moved through the Panel.
        'max_file_bytes' => (int) env('GOBIA_FILES_TRANSFER_MAX_FILE_BYTES', 2 * 1024 * 1024 * 1024),
        // Most files and folders one request may touch, counting everything inside the chosen folders.
        'max_entries' => (int) env('GOBIA_FILES_TRANSFER_MAX_ENTRIES', 2000),
        // Deepest folder nesting that is followed.
        'max_depth' => (int) env('GOBIA_FILES_TRANSFER_MAX_DEPTH', 24),
        // Files up to this size are read back from the destination and compared by SHA-256; larger ones by size only.
        'verify_hash_bytes' => (int) env('GOBIA_FILES_TRANSFER_VERIFY_HASH_BYTES', 256 * 1024 * 1024),
        // Seconds one request to a node may take (a large file needs minutes).
        'timeout' => (int) env('GOBIA_FILES_TRANSFER_TIMEOUT', 900),
    ],
];
