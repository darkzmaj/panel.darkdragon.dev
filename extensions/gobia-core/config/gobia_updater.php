<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Gobia Panel updates
|--------------------------------------------------------------------------
|
| Everything here is server side configuration. Nothing in this file can be
| influenced by a browser request: the update source, the repository and the
| signing key are all fixed by the operator. See docs/gobia-updates.md.
|
*/
return [
    // "github" for production, "directory" to install releases from a local folder (development, tests, air gapped servers).
    'provider' => env('GOBIA_UPDATE_PROVIDER', 'github'),

    // The only repository releases are installed from.
    'repository' => env('GOBIA_UPDATE_REPOSITORY', 'Cryvex-Dev/panel.gobia.cloud'),

    // Fine-grained token with read-only "Contents" access to the repository above. Never exposed to the browser.
    'github_token' => env('GOBIA_UPDATE_GITHUB_TOKEN'),

    'directory' => env('GOBIA_UPDATE_DIRECTORY'),

    // Offer pre-releases (2.1.0-rc.1) too. Leave off in production.
    'prerelease' => (bool) env('GOBIA_UPDATE_PRERELEASE', false),

    // Base64 Ed25519 public key every release manifest must be signed with.
    'public_key' => env('GOBIA_UPDATE_PUBLIC_KEY', 'L5SyQHI6Wj+7N4kaIHUgqUmnIzqxQZ6kpXl37KK5Nu0='),

    // Development only: accept a release that carries no signature at all. The SHA-256 is still enforced.
    'allow_unsigned' => (bool) env('GOBIA_UPDATE_ALLOW_UNSIGNED', false),

    // "in-place" swaps the code directories inside the installation (the standard /var/www/pterodactyl layout).
    // "release-directory" uses releases/ + a "current" symlink and needs GOBIA_UPDATE_INSTALL_ROOT and the helper.
    'runner' => env('GOBIA_UPDATE_RUNNER', env('GOBIA_UPDATE_INSTALL_ROOT') ? 'release-directory' : 'in-place'),

    // Root of a release-directory install: contains releases/, shared/ and the "current" symlink.
    'install_root' => env('GOBIA_UPDATE_INSTALL_ROOT'),

    // Narrowly scoped sudo helper that flips the release and restarts services. Optional for "in-place".
    'helper' => env('GOBIA_UPDATE_HELPER', '/usr/local/sbin/gobia-update-helper'),

    // Where updater state, downloads and database backups live. Must survive a release switch.
    'state_path' => env('GOBIA_UPDATE_STATE_PATH', storage_path('updater')),

    // How many update backups (previous files and database dump) are kept. Only the newest can be rolled back.
    'backup_retention' => (int) env('GOBIA_UPDATE_BACKUP_RETENTION', 3),

    // How long the "latest release" lookup is cached, in seconds. "Check for updates" always asks again.
    'check_ttl' => (int) env('GOBIA_UPDATE_CHECK_TTL', 6 * 3600),

    'max_download_bytes' => 512 * 1024 * 1024,
    'max_extracted_bytes' => 1536 * 1024 * 1024,
    'max_archive_entries' => 200000,

    // After the switch the updater requests the site over HTTP. The URL defaults to APP_URL.
    'http_probe' => (bool) env('GOBIA_UPDATE_HTTP_PROBE', true),
    'health_url' => env('GOBIA_UPDATE_HEALTH_URL'),

    // Absolute paths of programs the updater runs. Looked up on PATH when empty.
    'php_binary' => env('GOBIA_UPDATE_PHP_BINARY'),
    'mysqldump' => env('GOBIA_UPDATE_MYSQLDUMP'),
    'mysql' => env('GOBIA_UPDATE_MYSQL'),

    // After switching releases, start a replacement queue worker (development only; production uses systemd).
    'spawn_queue_worker' => (bool) env('GOBIA_UPDATE_SPAWN_QUEUE_WORKER', false),

    // The theme that is published again after every update.
    'theme' => 'gobia',
];
