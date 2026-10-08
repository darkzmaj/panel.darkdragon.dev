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

