<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Panel Updates
    |--------------------------------------------------------------------------
    |
    | Everything here is server-side configuration. Nothing in this block can be
    | influenced by a browser request: the update source, the repository and the
    | signing key are all fixed by the operator.
    */

    'update' => [
        // "github" for production, "directory" to install releases from a local folder (development and tests).
        'provider' => env('GOBIA_UPDATE_PROVIDER', 'github'),

        // The only repository releases are installed from.
        'repository' => env('GOBIA_UPDATE_REPOSITORY', 'Cryvex-Dev/panel.gobia.cloud'),

        // Fine-grained token with read-only "Contents" access to the repository above. Never exposed to the browser.
        'github_token' => env('GOBIA_UPDATE_GITHUB_TOKEN'),

        'directory' => env('GOBIA_UPDATE_DIRECTORY'),

        // Base64 Ed25519 public key that release packages must be signed with. Leave empty to disable
        // signature checking (the SHA-256 is still verified).
        'public_key' => env('GOBIA_UPDATE_PUBLIC_KEY', 'L5SyQHI6Wj+7N4kaIHUgqUmnIzqxQZ6kpXl37KK5Nu0='),

        // "in-place" swaps code directories inside the installation (Windows development).
        // "release-directory" uses releases/ + current symlink (Linux production).
        'runner' => env('GOBIA_UPDATE_RUNNER', PHP_OS_FAMILY === 'Windows' ? 'in-place' : 'release-directory'),

        // Root of a release-directory install: contains releases/, shared/ and the "current" symlink.
        'install_root' => env('GOBIA_UPDATE_INSTALL_ROOT'),

        // Narrowly scoped sudo helper used to flip the release and restart services on Linux.
        'helper' => env('GOBIA_UPDATE_HELPER', '/usr/local/sbin/gobia-update-helper'),

        // Where updater state, downloads and database backups live. Must survive a release switch.
        'state_path' => env('GOBIA_UPDATE_STATE_PATH', storage_path('updater')),

        'backup_retention' => (int) env('GOBIA_UPDATE_BACKUP_RETENTION', 5),

        // How long the "latest release" lookup is cached.
        'check_ttl' => (int) env('GOBIA_UPDATE_CHECK_TTL', 6 * 3600),

        'max_download_bytes' => 512 * 1024 * 1024,
        'max_extracted_bytes' => 1536 * 1024 * 1024,
        'max_archive_entries' => 200000,

        // URL the post-update HTTP health check requests. Defaults to APP_URL.
        'health_url' => env('GOBIA_UPDATE_HEALTH_URL'),

        // Absolute path of the database dump/restore clients. Looked up on PATH when empty.
        'mysqldump' => env('GOBIA_UPDATE_MYSQLDUMP'),
        'mysql' => env('GOBIA_UPDATE_MYSQL'),

        // After switching releases, start a replacement queue worker (development only; production uses systemd).
        'spawn_queue_worker' => (bool) env('GOBIA_UPDATE_SPAWN_QUEUE_WORKER', false),
    ],
];
