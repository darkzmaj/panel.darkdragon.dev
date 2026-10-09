# Gobia updater: recorded end to end run (2026-10-09)

What was actually run, so nobody has to take "it works" on trust. Environment: a Linux container (Debian, PHP 8.4.26 CLI with OPcache, the
PHP built-in web server), MariaDB 11.8.9 in a second container, the Panel owned by an unprivileged user `panel`, queue driver `database`,
cache and sessions on files. No PHP-FPM, no systemd, no Wings node: those parts are **not** covered here.

## Steps

1. Three signed packages were built from the working tree with `scripts/release/build-release.sh` (`RELEASE_SOURCE=worktree`) and a
   throwaway Ed25519 key: 2.0.0, 2.0.1 (adds a migration and a marker file) and 2.0.2 (adds a migration that creates a table and then
   throws). Each package is about 21 MB and unpacks to about 14 900 files.
2. 2.0.0 was installed from its package alone (unpack, `.env`, `key:generate`, `migrate --seed`, `p:theme:apply gobia`,
   `p:extension:enable` for the three Gobia extensions). A third party extension (`extensions/acme-notes`, enabled), a custom theme
   (`themes/custom`) and a file under `storage/app/private` were added to stand in for what a real installation accumulates.
3. `GOBIA_UPDATE_PROVIDER=directory` pointed at a folder that received 2.0.1, then 2.0.2.

## Results

| Scenario | Result |
| --- | --- |
| Preflight for 2.0.1 | Ready: every required check passed (`wings_connectivity` skipped: no nodes; `redis` skipped: not used) |
| `gobia-core:update:run` 2.0.0 to 2.0.1 | Completed in about 6 seconds. `gobia-release.json` says 2.0.1, the new migration ran, the marker file is served |
| What survived | `.env` (same `APP_KEY`), the storage file, `extensions/acme-notes` (still enabled, assets published again), `themes/custom`; Gobia theme and all four extensions published; files still owned by `panel`; maintenance mode off; sign in page 200; route and event snapshots present; extension routes answer |
| Health command afterwards | `ok: true` (version, database, 0 pending migrations, storage, frontend manifest, Gobia extensions, queue) |
| `gobia-core:update:run` 2.0.1 to 2.0.2 (broken migration) | Failed at `migrate`, rolled back by itself: 2.0.1 files restored, database dump restored (the half created table is gone, the 2.0.1 table and the user row are still there), maintenance mode off, sign in page 200, health `ok: true` |
| Secrets in `storage/updater` logs and run records | None (searched for the database password) |
| `gobia-core:update:rollback` without `--restore-database` | Refused: 2.0.1 had run a migration |
| `gobia-core:update:rollback --restore-database` | Back on 2.0.0: marker table and marker file gone, third party extension still there, site up |
| A second rollback | Refused: nothing left to roll back |
| Helper present but not allowed through sudo (in-place layout) | Skipped, update completes |
| `gobia-update-helper` as root | No config 78; valid config 0; `activate ../../etc` and `activate '2.0.0; id'` 65; unknown verb 64; release not owned by the Panel user 68; valid release switches `current`; missing release 66; a config value with `; rm -rf /` 78; world writable config 78 |

Two defects were found by this run and fixed before the numbers above were taken: rollback eligibility looked only at the newest run, so
a failed update hid the installed one; and the HTTP health probe accepted any 200 response, including a PHP error page (it now requires
the Panel's shell).

## Not exercised

The GitHub release provider against the real API (covered only with faked HTTP in 1.x and by the shared code path here), PHP-FPM reloads,
systemd restarts, the release directory layout end to end (only the helper's `activate` was run), an update while real Wings nodes are
connected, a full disk during unpacking, and the Updates screen in a browser against a real update. `MAJCEK_HANDOFF.md` section 12 lists
the tests that still need a disposable real server.

## Repeating it

The scripts are not in the repository (they create users and databases inside a throwaway container). The recipe: build packages as in
step 1, unpack one into an empty directory owned by an unprivileged user, configure `.env` with `GOBIA_UPDATE_PROVIDER=directory`,
`GOBIA_UPDATE_DIRECTORY` and the matching `GOBIA_UPDATE_PUBLIC_KEY`, copy a newer release folder into that directory and run
`php artisan gobia-core:update:check --preflight`, then `php artisan gobia-core:update:run --force`.
