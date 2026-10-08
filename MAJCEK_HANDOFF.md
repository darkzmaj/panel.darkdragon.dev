# MAJCEK_HANDOFF.md: Gobia updater and production upgrade process

Audience: Majcek, who owns the privileged updater and the production upgrade process. Claude builds the Gobia Updates
frontend and the compatibility API contract only. This file is concrete where the repository is concrete and explicit
where something is still a design. Sections marked **(PLANNED)** are design that is not implemented; everything else describes what exists in the repository
at the end of the frontend migration (section 8 lists the exact state).

## 1. The rule: no blind core updates

Production Gobia installations NEVER update from `pterodactyl/panel`. They install approved, signed Gobia releases only.

```
Pterodactyl upstream release
  -> Gobia upstream sync branch (merge or rebase)
  -> Gobia CI (extension compatibility, migrations, tests, browser, a11y, security, perf budgets)
  -> release candidate, test environment, smoke tests, approval
  -> signed Gobia release published (this is what makes "Update Available" appear)
  -> production updater (Majcek) runs the local preflight, then installs
```

The Update button is NOT enabled because a newer upstream Pterodactyl exists. It is enabled only when
(a) a compatible approved Gobia release exists and (b) the local preflight endpoint reports the installation ready.

## 2. What exists in the repository today

Facts verified against upstream `2.0-develop` at `0d8cd97d00852aa7b251ea39d05a6df168874db1`:

* Extension manifest `extension.json` already carries compatibility metadata (`packages/sdk/manifest.schema.json`):
  `id`, `name`, `version`, `requires.panel`, `requires.sdk`, `requires.php`, `requires.extensions` (map of extension id to a Composer
  semver constraint). Gobia reuses these; no parallel package system.
* Backend compatibility service: `app/Services/Extensions/ExtensionCompatibility.php` (read before building the preflight).
* Extension lifecycle services: `ExtensionManager`, `ExtensionLock`, `ExtensionRepository`, `ExtensionAssetPublisher`,
  `ExtensionRuntimeRefresher`, `ExtensionManifestValidator`.
* Extension runtime check: `scripts/check-extension-runtime.mjs` (runs as `postbuild`).
* SDK drift/contract checks: `npm run sdk:check`, `packages/sdk/types-drift.spec.ts`.
* OpenAPI contract: `composer docs:openapi:verify`.
* The Gobia 1.x updater (`app/Services/Updater/*`, `docs/updates.md` on branch `gobia-1.x-preserved`) is a reference for ideas
  (runners, providers, progress). It is NOT ported to 2.0.

## 3. Compatibility metadata (extension manifests implemented; release manifest partly)

Each Gobia extension manifest states:

| Need | Field |
| --- | --- |
| Gobia extension version | `version` |
| Minimum/maximum supported Pterodactyl | `requires.panel` (Composer constraint, e.g. `>=2.0.0-beta.4 <2.1`) |
| Required extension API / frontend SDK | `requires.sdk` |
| PHP | `requires.php` |
| Dependencies on other Gobia extensions | `requires.extensions` |
| Conflicts, required migrations | no upstream field: carried in a Gobia release manifest (`gobia-release.json`), see below |

Release manifest `gobia-release.json` shipped inside every Gobia release (and published beside it, signed):

```json
{
  "gobia_version": "2.0.0",
  "pterodactyl_base": { "version": "2.0.0-beta.N", "commit": "<sha>" },
  "extensions": { "gobia-core": "1.0.0", "gobia-templates": "1.0.0", "gobia-files": "1.0.0" },
  "min_upgrade_from": "2.0.0",
  "php": ">=8.3 <8.6",
  "node_runtime_required": false,
  "database": { "server": ["mariadb>=10.5", "mysql>=8"], "redis": "optional" },
  "migrations": { "count": 0, "destructive": false, "rollback": "file-only|requires-db-restore" },
  "artifact": { "url": "...", "sha256": "...", "signature": "..." },
  "security_update": false
}
```

## 4. Preflight (local, before any change)

The updater MUST refuse to update and show the administrator the exact failing check if any required check fails:

current and target Gobia version; current and target Pterodactyl base version; required Gobia extension versions;
extension API (`requires.sdk`) and frontend SDK compatibility; backend extension API compatibility; PHP version;
Node runtime (only if the release needs it); DB server version and connectivity; Redis version/connectivity if required;
installed extensions, conflicts, and dependencies; pending migrations; disk space; filesystem write access and ownership;
Wings connectivity (per node, informational vs blocking is a policy decision); queue health; current Panel health;
release signature; release checksum; supported upgrade path (`min_upgrade_from`); whether a direct upgrade is allowed.

The Gobia compatibility interface (read only, no privileged actions) will report: Panel version, Pterodactyl base, extensions
and versions, migration state, health. Contract: `docs/gobia-updates-frontend-contract.md`.

## 5. Database safety

* A database backup is mandatory and must complete successfully (verify size and restorability) before migrations run.
* Inspect the pending migration list from the release manifest; detect destructive operations (drop column/table, type
  narrowing) where possible; the release states rollback compatibility.
* Some migrations cannot be rolled back safely. The updater must know `rollback: "requires-db-restore"` releases: rolling back files
  alone is NOT enough for them; restore the snapshot taken in this run.

## 6. Failure safety (requirements for the updater)

Exclusive update lock; maintenance mode; release verification (checksum + signature); database backup; staged extraction
to a new release directory; health check of the staged tree; atomic switch (symlink) where possible; queue worker restart;
cache rebuild (`config:cache`, `route:cache`, `view:cache`, `event:cache`, extension asset publish); migration execution;
rollback; database restoration when required; sanitized logs (no secrets); update history. Not implemented by Claude.

## 7. Future automated pipeline (design)

Detect upstream release; create Gobia upstream-sync branch; merge or rebase; detect conflicts (the core patch registry
`docs/gobia-core-patches.md` lists every file that can conflict); run the extension compatibility scanner; run backend, frontend,
migration, browser, accessibility, security tests and performance budgets; build release candidate; deploy test environment; smoke
test; approval; publish signed release. Only then do production installs see "Update Available".

## 8. Final state of the migration (what exists, what Majcek still owns)

**Versions and metadata.** `gobia-release.json` at the repository root carries `gobia_version` (`2.0.0-dev`), `pterodactyl_base` (branch `2.0-develop`, commit
`240aaf62ea53b1d6956a643a872f44d2f5956031`), `min_upgrade_from` (null: no earlier 2.x), `php` (`>=8.3 <8.6`), `database`, `post_install` and `security_update`.
It does NOT yet carry the artifact (url, sha256, signature), the extension version map or the migration summary from the example in section 3; those are release time
fields that the release pipeline must add. Extension versions come from each `extension.json`: `gobia-core`, `gobia-files`, `gobia-templates`, all `1.0.0`, with
`requires.panel`, `requires.sdk` (`>=2.0.0-beta.4 <3.0`) and `requires.php`.

**Compatibility endpoint (implemented, read only).** `GET /api/admin/extensions/gobia-core/compatibility` (root administrator or admin API key) returns
`gobia_version`, `pterodactyl_base {version, commit}`, `php`, `database {driver, version}`, `extensions[] {id, name, version, enabled, requires, depends_on,
compatible, reason}` (from `ExtensionCompatibility`), `migrations {pending, ran}` (pending is -1 when it cannot be read), `health {database, cache, queue}` and
`release {min_upgrade_from, security_update}`. The Updates screen renders this. Everything else in `docs/gobia-updates-frontend-contract.md` (`/check`, `/preflight`,
`/install`, `/progress`, `/history`, `/rollback*`) is the contract Majcek implements; the frontend already gates the Update button on `update_available && preflight.ready`
and shows "No update service available" while those endpoints do not exist.

**Pre-update checks Majcek must implement** (section 4 lists them): the compatibility report above covers versions, extension compatibility, pending migrations and
database/cache/queue health. Not covered and required: disk space, ownership and write access, Wings connectivity, release signature and checksum, upgrade path.
Migration state check: refuse when `migrations.pending` is -1, and compare the release's migration list with the installed ones before running anything.

**Database backup and rollback.** A verified database backup must exist before `php artisan migrate`. The extensions' migrations are additive (new tables and columns); the
1.x import tooling is a separate, explicit command (`docs/gobia-upgrade-from-1x.md`). A release with a destructive migration must say `rollback: requires-db-restore`; a file
only rollback after such a release leaves the schema ahead of the code.

**Restart list after a release.** Queue workers, the scheduler, PHP-FPM or the web server, the template SFTP service (`services/template-sftp`), then `php artisan p:theme:apply gobia`,
`p:extension:enable gobia-core gobia-files gobia-templates` (publishes the extension assets) and the cache rebuild commands. `services/mock-wings` and `scripts/gobia/dev.mjs` are
development tools only and are never part of a release.

**Known limitations for the release process.** Linux is the authoritative platform: run the Gobia CI workflow (`.github/workflows/gobia-ci.yaml`) before tagging; local Windows runs
only cover the frontend and the Gobia Pest tests. Wings reports file times in nanoseconds on a real node; the file workspace uses time and size as a file's version.


## 9. Architecture summary (for the person who ships it)

* **Base.** Pterodactyl 2.0 `2.0-develop` (still alpha), commit `240aaf62ea53b1d6956a643a872f44d2f5956031`. Gobia = three extensions (`extensions/gobia-core`, `gobia-files`, `gobia-templates`), the `themes/gobia` theme, `resources/scripts/gobia/**` (shell) and the small core patches listed in `docs/gobia-core-patches.md`.
* **Access.** Account, Access (`gobia-core`, `/api/client/extensions/gobia-core/access`) is the one place to share instances. The per server Users page is removed (its addresses redirect). Subusers, their permissions and enforcement are the unchanged upstream ones; Gobia only wraps `CreatesSubusers`/`UpdatesSubusers`/`DeletesSubusers`. Delegated managers (all four `user.*` permissions on a server) are supported, limited to permissions they hold themselves.
* **Updater boundary.** The frontend (Admin, Updates) and the read only compatibility endpoint exist. Nothing in this repository installs, replaces files or runs a shell for an update. That is Majcek's.

## 10. Safe update lifecycle (the order the privileged updater must follow)

1. Fetch the release manifest (`gobia-release.json`) and the artifact URL from the Gobia release feed only.
2. Verify the signature and the sha256 of the manifest and artifact.
3. Run the local preflight (section 4). Any mandatory failure stops here and the Update button stays unavailable.
4. Take the exclusive update lock; refuse a second run.
5. Enter maintenance mode (`php artisan down` with a secret) and stop queue workers and the scheduler.
6. Take a database backup, verify size and that it restores into a scratch database.
7. Extract the artifact into a new release directory (never over the live tree) and copy `.env`, storage and extension data in.
8. Run Composer/asset checks on the staged tree (no network at this point if the artifact is self contained) and a staged health check (`php artisan about`, config load).
9. Run migrations from the staged tree; stop and go to rollback on the first failure.
10. Rebuild caches, publish extension assets (`p:extension:enable gobia-core gobia-files gobia-templates`, `p:theme:apply gobia`).
11. Switch the live symlink atomically.
12. Restart queue workers, the scheduler, PHP-FPM / web server and the template SFTP service; leave maintenance mode.
13. Smoke test (sign in page, `/api/client`, compatibility endpoint, one Wings call per node). Failure goes to rollback.
14. Write the history entry (sanitised log, versions, durations) and release the lock.

**Rollback.** Switch the symlink back, restart services. A release whose manifest says `rollback: requires-db-restore` (and any release that ran a destructive migration) cannot be rolled back by files alone: the database snapshot of step 6 must be restored, which loses everything written after it. Some migrations can never be undone safely without that restore; the updater must refuse a file only rollback for them.

## 11. Gobia Updates frontend contract (summary; full text in `docs/gobia-updates-frontend-contract.md`)

| Call | Purpose | State |
| --- | --- | --- |
| Compatibility | versions, extensions, migrations, health (read only) | implemented |
| Check | is a compatible approved release available | frontend ready, backend missing |
| Preflight | list of checks with pass/fail and the reason | frontend ready, backend missing |
| Status / Progress | current step and log tail | frontend ready, backend missing |
| Install | start the run | frontend ready (button gated), backend missing |
| History | past runs | frontend ready, backend missing |
| Rollback eligibility and Rollback | whether files only or a DB restore is needed | frontend ready, backend missing |
| Errors | structured `{code, message, step}` shown verbatim | frontend ready |

## 12. Exact remaining work

**Implemented.** Gobia extensions and manifests with compatibility fields; `gobia-release.json` (partial); the compatibility endpoint and its tests; Updates screen gated on `update_available && preflight.ready`; the contract document; CI mirror workflow.

**Placeholders.** `gobia-release.json` has no artifact (url, sha256, signature), no extension version map and no migration summary.

**Missing (Majcek).** Check, Preflight (disk space, ownership and write access, Wings reachability, signature and checksum, upgrade path), Install, Progress, History, Rollback endpoints and the privileged helper behind them; the release pipeline that builds, signs and publishes; the test environment that runs the lifecycle above.

**Must never run as the web server user.** Extraction and file replacement, symlink switching, `composer`, service restarts, database dump/restore, key material for signing, anything with `sudo`. The web process may only write a request file or call a narrow socket; a separate privileged helper (systemd unit or root owned CLI with a fixed command set, no user supplied arguments) does the work and writes status the web process can read.

**Tests required before production updates are enabled.** End to end upgrade and rollback on a disposable Linux install with real Wings; a failed migration mid run; a corrupted artifact and a bad signature; disk full; a release with `requires-db-restore`; a concurrent second run; an interrupted run (kill the helper) that resumes or rolls back cleanly; permission tests proving the web user cannot reach the privileged paths.
