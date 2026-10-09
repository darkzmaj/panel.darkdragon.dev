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
  (runners, providers, progress). It was ported to 2.0 on 2026-10-09 as part of `gobia-core` (`extensions/gobia-core/src/Updater`); see section 15
  and `docs/gobia-updates.md`.

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
`/install`, `/progress`, `/history`, `/rollback*`) is implemented by `GobiaCore\Http\Controllers\UpdateController` (section 15); the frontend gates the Update button on
`update_available && preflight.ready`.

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
* **Updater boundary.** The frontend (Admin, Updates) only renders what the backend reports. Installing, replacing files and running programs happen in `extensions/gobia-core/src/Updater` (a detached CLI worker, never the web request) and, for the release directory layout, in the root owned `deploy/linux/gobia-update-helper`. That code is Majcek's; do not move any of it into the frontend or into request handling.

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
| Check | is a compatible approved release available | implemented |
| Preflight | list of checks with pass/fail and the reason | implemented |
| Status / Progress | current step and log tail | implemented |
| Install | start the run | implemented (button gated, panel session required) |
| History | past runs | implemented |
| Rollback eligibility and Rollback | whether files only or a DB restore is needed | implemented |
| Errors | structured `{code, message, step}` shown verbatim | implemented |

## 12. Exact remaining work

**Implemented.** Gobia extensions and manifests with compatibility fields; `gobia-release.json` (partial); the compatibility endpoint and its tests; Updates screen gated on `update_available && preflight.ready`; the contract document; CI mirror workflow.

**Placeholders.** None left in the manifest: `scripts/release/sign.php` adds the extension version map, the migration list and the artifact (name, size, SHA-256) and signs the result (`release.json`). `gobia-release.json` in the repository stays the hand edited part (version, base, `min_upgrade_from`, PHP and database requirements, `security_update`).

**Implemented since (2026-10-09, section 15).** Check, Preflight (all twenty checks), Install, Progress, History, Rollback eligibility and Rollback, the detached worker and the root owned helper, signed release packaging and the release workflow.

**Still missing.** A real GitHub Release to install from (nothing has been tagged), a run of the release workflow (GitHub Actions is blocked for the organisation), and the tests listed under "Tests required" that need a real server. The deviation from the paragraph below is deliberate and explained in section 15.

**Must never run as the web server user.** Extraction and file replacement, symlink switching, `composer`, service restarts, database dump/restore, key material for signing, anything with `sudo`. The web process may only write a request file or call a narrow socket; a separate privileged helper (systemd unit or root owned CLI with a fixed command set, no user supplied arguments) does the work and writes status the web process can read.

**Tests required before production updates are enabled.** End to end upgrade and rollback on a disposable Linux install with real Wings; a failed migration mid run; a corrupted artifact and a bad signature; disk full; a release with `requires-db-restore`; a concurrent second run; an interrupted run (kill the helper) that resumes or rolls back cleanly; permission tests proving the web user cannot reach the privileged paths.

## 13. Files workspace: transfers between servers and live status (operational notes)

**What ships.** `gobia-files` now has a backend (`GobiaFiles\GobiaFilesProvider`; `extension.json` declares `provider` and `autoload`) with one route, `POST /api/client/extensions/gobia-files/transfers`, mounted with the normal client API middleware (session or API key, 2FA requirement, `throttle:api.client`). Build its `dist` and run `php artisan p:extension:enable gobia-files` as before. It needs no database change and no worker.

**How it works.** The Panel streams each file from the source node's Wings (`GET /api/servers/{uuid}/files/contents`, `WingsFiles::download`) into a PHP temporary file, uploads it from that file to the destination node (`POST .../files/write`), reads it back and compares size and SHA-256, then renames it into place. Memory does not grow with the file (Guzzle writes straight to disk and reads the upload from disk; PHP holds only chunk buffers). Folder listings, renames, deletes and folder creation use the core `FilesClient`. There is no queue job: the browser sends one request per chosen item and shows real progress. Wings credentials never leave the Panel.

**Semantics.** *Copy* leaves the source. *Move* removes the source only after every file inside the item verified at the destination, then lists the source folder again to confirm it is gone; only then is the item `moved`. If verification fails the source stays and the temporary destination data is deleted (`failed`). If the verified copy exists but the original could not be removed or is still listed, the item is `move_incomplete`: nothing is lost, the UI shows it as such and offers *Finish*, which resends the item with `resume: true` (an identical file already at the destination counts as copied; only the source removal is retried). *Duplicate* is a separate action on one server. In the explorer a plain drag between servers moves, Ctrl (Cmd) drag copies, and the context menu has explicit "Copy to" and "Move to" entries (also the only way on touch). A file with unsaved edits asks Save and move / Discard and move / Cancel first, so an older disk version is never moved silently; open tabs of what moved close on the source and reopen at the destination identity.

**Permissions** (checked on both servers; the same 403 whichever is missing, so nothing leaks): `file.read` and `file.read-content` on the source, `file.create` on the destination, `file.update` to replace an existing file, `file.delete` on the source for a move. Servers must not be suspended, installing, transferring or on a node in maintenance. Root admins and owners pass as everywhere else.

**Integrity and recovery.** Each file goes to `.gobia-transfer-<random>.tmp` beside its destination, is verified (size always; SHA-256 read back for files up to `verify_hash_bytes`, 256 MiB, larger by the size the node lists) and only then renamed into place; on any failure the temporary file is deleted and nothing under the real name changes. A replace deletes the old file immediately before the rename (a crash between the two leaves the verified temporary file, never a half written one). Symbolic links are skipped. Paths are normalised server side (`..` and control characters give 422). Free space on the destination is checked from the node's reported usage when the server has a disk limit.

**Limits.** `config/gobia_files.php`: `GOBIA_FILES_TRANSFER_MAX_FILE_BYTES` 2 GiB, `..._MAX_ENTRIES` 2000, `..._MAX_DEPTH` 24, `..._VERIFY_HASH_BYTES` 256 MiB, `..._TIMEOUT` 900 s per node request. The Panel needs temporary disk for one file at a time (up to three copies' worth: download, read-back); make sure `sys_get_temp_dir()` can hold the largest allowed file, and size the proxy and `max_execution_time` for it. Transfers are sequential; there is no queue. Very large worlds need a queued job and a Wings side copy between nodes (Wings changes, not attempted).

**Measured on the development mock (Panel to mock Wings on loopback, not a real node).** Before this work, binaries and a 40 MiB jar failed verification (a byte counting bug, found and fixed; the earlier Pest fake counted characters and hid it), and each case took about 2.1 s. After, with the node on `127.0.0.1`: small file 83 ms, 5 MiB binary 130 ms, 40 MiB jar 423 ms, 20 files in a folder 369 ms, small move 98 ms, 40 MiB move 505 ms, all byte identical (`docs/gobia-transfer-perf-after.json`, `scripts/gobia/transfer-perf.mjs`; the response carries per stage `timings`). On Windows a node address of `localhost` adds about 210 ms to every call (IPv6 then IPv4 fallback), which is why the numbers above are taken with `127.0.0.1`. These numbers say nothing about a real node, a network or Docker volumes.

**Websockets on the instance list.** The list opens one Wings websocket per visible instance (at most 24 at once) through the existing credentials route, which allows five requests a minute per instance; tokens are cached ten minutes in the browser. Wings must list the Panel origin in `allowed_origins` (already needed for the console), and websocket upgrades to every node must pass any proxy.

**Real Wings.** None of this has run against real Wings, Docker, quotas or large and many files. Mock Wings and a faked Wings in Pest prove the Panel logic only. Required before production: copy and move between two real nodes (the same node and different nodes), a 60 MiB and a 1 GiB file (temp disk, timeouts, the 2 GiB limit), a failing source delete (`move_incomplete` then Finish), a folder with thousands of entries, unusual file names, a full destination disk, a node going offline mid transfer, an interrupted request (no temporary files may remain), subuser permission combinations, and the dots with real resource numbers and a real start/stop.

## 14. Hetzner Storage Box backups (specification; implemented in part on 2026-10-09)

**Status.** The extension `gobia-backups` implements this section with SFTP and built in encryption instead of BorgBackup, has an API and console commands, and no screen yet. What was built, what differs from this specification and why, and what is untested are in `docs/gobia-backups.md`. The text below is the original specification and stays as the reference for the parts that are not built (Borg, a second destination, notifications, capacity warnings).

It is the design the backup feature follows. Facts about Hetzner come from its official documentation (docs.hetzner.com, Storage Box pages "Overview", "Access Overview", "Access with SSH/rsync/BorgBackup", "Access with SFTP/SCP", "Snapshots", last changed September 2026 when read on 2026-10-09). Re-read them before building; limits and ports change.

### 14.1 What a Storage Box offers (verified)

| Item | Fact |
| --- | --- |
| Hostname | `uXXXXX.your-storagebox.de` (main account), `uXXXXX-subX.your-storagebox.de` (sub account). Use the name, not the IP: addresses can change. |
| SFTP / SCP | Port 22, always on, **no interactive shell**, password or SSH key. |
| Extended SSH | Port 23, must be enabled ("SSH Support"); rsync, BorgBackup, SFTP, SCP and a short list of commands (`ls`, `mkdir`, `rm`, `mv`, `cat`, `df`, `du`, `stat`, `sha256sum` ...). No full shell, no pipes, no uploaded scripts. |
| Other | FTP/FTPS 21, SMB/CIFS 445, HTTPS/WebDAV 443 (enable per protocol). Not suitable for this feature. |
| Reachability | From outside Hetzner's network "External Reachability" must be enabled per Storage Box. |
| Keys | Port 22 wants the public key in RFC4716 format, port 23 in OpenSSH format (RSA, ECDSA, ED25519; port 23 also the `-sk` types). Both formats go in `.ssh/authorized_keys` to use both ports. Each sub account has its own `authorized_keys`. Password login cannot be disabled. |
| Sub accounts | Up to 100 per Storage Box; each sees only its own directory, the main user sees all; sub account directories can be set read only; all share the box's capacity. |
| Limits | **Up to 10 simultaneous connections per account**; 10/20/30/40 manual snapshots and automatic snapshot slots on BX11/21/31/41; 1 to 10 Gbit/s per shared host; `/etc` and `/lib` cannot be created; never remove the execute right of the home directory. Only `/home` is writable; use relative paths. |
| rsync | Works from your server to the box and back; **rsync cannot run on the box itself**; ownership (uid/gid) cannot be set. |
| BorgBackup | Borg 1.1, 1.2 (default), 1.4 on port 23; select with `--remote-path=borg-1.4`. Append-only mode exists but a restricted client can still mark archives deleted, so it is not a defence against a compromised client. |
| Snapshots | ZFS style, stored on the box and counted against its capacity, listed under `/.zfs/snapshot` (`/home/.zfs/snapshot` on port 23), read only. They are **not backups of another system**: restoring one deletes everything newer including newer snapshots, and they live on the same host as the data. |
| Rclone | SFTP backend on port 23 works; `md5` errors on large trees mean the 10 connection limit was hit (lower `--checkers`). |
| Host keys | Published in the Storage Box overview; pin them (do not trust on first use). |

### 14.2 Transport decision

* **Chosen: SSH on port 23 with BorgBackup or rsync, authenticated by an SSH key, driven by a worker on the Panel host or node.** Borg gives encryption, deduplication, integrity checks (`borg check`) and pruning in one tool the box supports natively; rsync/SFTP is the fallback for plain archives (`.tar.gz` or Wings backup files) where deduplication is not wanted.
* Port 22 SFTP is the fallback when port 23 is disabled (upload, `sftp` listing, no `sha256sum` remote command, so verify by size plus a downloaded sample or by re-reading with a checksum locally).
* Not chosen: FTP/FTPS (weaker), SMB and WebDAV (mounts, no integrity story), Hetzner snapshots as the backup (same host, shared capacity, not independent).
* Do not claim more: nothing in the documentation promises durability beyond RAID on one host; the Storage Box is one copy in one place. Offer a second destination for important data.

### 14.3 Configuration model

Global defaults with per server overrides; every field below exists at both levels unless noted. No Hetzner account, hostname or key is hardcoded anywhere in the repository.

* **Destination** (many allowed, stored in a `backup_destinations` table): name, type (`storagebox`), hostname, port (23 or 22), username (main or sub account), auth (SSH key reference; password only as a last resort), pinned host key fingerprint, base path (`/home/<root>`), protocol mode (`borg` or `rsync`), `borg_remote_path`, optional capacity hint and warn threshold, enabled flag.
* **Assignment:** one destination for everything, several destinations, one per node, or one per server (`server_id`, `node_id` nullable; most specific wins: server, then node, then global). A server may have a primary and a secondary destination.
* **Policy:** schedule (cron plus timezone), allowed window (start/end, so large servers do not all start together), retention (keep last N, daily, weekly, monthly; maximum age), maximum storage per server and per destination, compression (`none`, `lz4`, `zstd`; Borg level), encryption (Borg `repokey-blake2` or `keyfile`; or `age` for rsync archives; off only by explicit choice), exclude patterns, pre and post commands (admin only), notifications (email/webhook on failure, on success optional, on quota warnings), retry policy (attempts, backoff, give up and alert), maximum concurrent backups (global, per node, per destination; keep per destination well under 10 SSH connections, e.g. 4 jobs and 1 to 2 connections each).
* **Overrides:** a server row stores only what differs; the effective policy is computed (server over node over global). Normal users see their own backup list and may start/restore only with the extension permissions `ext.gobia-backups.create` / `.restore`; destinations, credentials and policy are administrator only.

### 14.4 Flows

1. **Create:** a scheduler (queue worker, not the web request) enqueues a job when the window opens and the destination has capacity and free slots. The job asks Wings to create a backup (existing Wings backup API) or reads the server's data directory through a snapshot-safe path (locked or stopped server for consistent copies where the egg needs it), writes to a local staging area bounded in size, never to unbounded memory.
2. **Upload:** stream with `borg create` (stdin or path) or `rsync --partial --inplace` to `<base>/<server uuid>/`, per server directory (and per server sub account where the box is shared by customers). Bandwidth limit (`--remote-ratelimit`, `--bwlimit`), CPU/IO niceness, a hard timeout, progress events (bytes, files) written to the job row for the UI.
3. **Verify:** Borg: `borg check --archives-only` of the new archive (periodically a full `--verify-data`); rsync/SFTP: compare size and a SHA-256 computed locally and, on port 23, with the remote `sha256sum` command. A backup is `completed` only after verification; otherwise `failed`, remote partials removed, local staging kept for retry until the retry policy ends.
4. **Retention:** after a verified success apply the policy (`borg prune` / delete oldest) for that server only, then `borg compact`. Never prune before the new backup verified; never delete the last verified backup.
5. **Restore:** restore into the original server (stop it, snapshot current data to a safety archive first, extract, verify, start) or to a new server/node; works when the node or original server is gone because the archive plus the encryption key are enough, and the restore target is any node with free space. An administrator or an authorized owner starts it; the action is logged and requires a fresh confirmation (and 2FA when the account has it). Restores of server A into server B require administrator rights.
6. **Failed backup recovery:** a failed job keeps its error, last good backup, and a retry button; stale locks (`borg break-lock`) are cleared only after the owning job is confirmed dead; `.checkpoint` archives are cleaned by prune.
7. **Logging:** every step writes an activity entry (who/what/server/destination/bytes/duration/result) with credentials, key paths, passphrases and command lines containing them redacted before storage or display.

### 14.5 Security

* Credentials (SSH private key, Borg passphrase, optional password) are stored encrypted with the Panel key (Laravel `Crypt` or a separate secret store), never in extension config or git, never returned by an API or shown in the UI after saving (write only, with "replace" and "rotate").
* **Rotation:** adding a new key, testing it, switching the destination to it, then removing the old key from `authorized_keys`; Borg passphrase rotation with `borg key change-passphrase`; keep a documented offline copy of Borg keys (loss of the key means loss of the data).
* Use a restricted identity per destination: a sub account per node or per customer group, an `authorized_keys` entry limited to that sub account's directory, a read only sub account for restore-only access. Do not use the main account for routine jobs.
* Transport is SSH (encrypted, host key pinned, `StrictHostKeyChecking=yes`, key forwarding off). Pre-upload encryption (Borg or `age`) means the box never sees plaintext; recommend it on by default.
* Per server isolation: one repository or directory per server under the destination's base path; paths are built from server UUIDs only, never from user input; reject `..`, absolute paths, symlinks and control characters (same normaliser as the transfer feature); archive extraction rejects traversal and links that leave the target.
* Normal users never see destinations, hostnames, keys or other servers' backups; the API returns only the caller's own backup rows.
* Run the worker as an unprivileged user with access only to the staging directory and the key store.

### 14.6 Performance

* Asynchronous queue with separate queues for create, verify and restore; concurrency limits as in 14.3; one connection pool per destination capped below the 10 connection limit.
* Streaming only: no whole backup in PHP memory, staging on disk with a size cap, backpressure by the tool (`borg`/`rsync`), bandwidth limits so game traffic and other jobs are not starved, `nice`/`ionice`.
* Snapshots on the box consume capacity when data changes; ZFS style snapshots plus Borg compaction temporarily need free space (reserve headroom, alert at 80 percent, stop new jobs at 90 percent, never fill the box). Retention cleanup overhead on large repositories must be measured on the real box.
* Spread schedules with jitter inside the window; the biggest servers first or on their own days.

### 14.7 Not to change

The updater rules, signing requirements and the compatibility gate in sections 1 to 12 are unchanged and untouched by this feature. Backups never run privileged updater code; the backup worker never replaces Panel files.

### 14.8 To verify against a real box before shipping

Port 23 with a real key (OpenSSH format) and port 22 (RFC4716), host key pinning, 10 connection behaviour under concurrent jobs, sub account isolation and read only mode, Borg 1.4 create/check/prune/compact on a large repository, restore onto a different node, interrupted uploads and stale locks, quota exhaustion, key and passphrase rotation, and the exact numbers (throughput, prune time) with real server sizes. None of this was run.

## 15. Updater status (2026-10-09): what was built and what was decided

Operator and release guide: `docs/gobia-updates.md`. Recorded end to end run: `docs/gobia-updater-e2e.md`.

**Where it lives.** `extensions/gobia-core/src/Updater` (provider, verifier, extractor, preflight, orchestrator, runners, run store), `src/Console/Update` (`gobia-core:update:check|run|rollback|recover` for people, `work|health|finalize` for the updater itself), `src/Http/Controllers/UpdateController.php`, routes in `extensions/gobia-core/routes/admin.php`, configuration `extensions/gobia-core/config/gobia_updater.php`, helper `deploy/linux/gobia-update-helper`, packaging `scripts/release/build-release.sh` and `sign.php`, workflow `.github/workflows/gobia-release.yaml`. It is the Gobia 1.x updater ported to the 2.0 contract, not a new design.

**Decisions that differ from sections 6, 10 and 12, and why.**

1. *The worker runs as the Panel's PHP user, not as root.* It is a detached CLI process, never the web request. In the standard layout that user already owns and can rewrite the Panel's code, so a root helper for extraction would add privilege, not remove it. What the signature protects is where the code comes from. Only the symlink switch and the service restarts go through the root owned helper, and only in the release directory layout (optional in the in-place layout). An installation that wants the code owned by a different user than the web process uses the release directory layout.
2. *The switch happens before the migrations*, as in 1.x, not after them. The Panel is in maintenance mode for both, a failure in either restores files and, once migrating started, the database dump. Migrating from a staged tree would need a second linked `.env` and `storage` in the in-place layout for no gain in safety.
3. *The database backup is verified by size and by the dump's completion footer*, not by restoring it into a scratch database: the Panel's database user normally cannot create databases. The restore path itself is exercised by every failed update and is covered by the end to end run.
4. *Wings reachability is a warning, not a blocker* (section 4 left this open): servers keep running on Wings while the Panel updates.
5. *Run ids are `YYYYMMDDTHHMMSS-xxxxxx`, not UUIDs.* They sort by time and are validated by one pattern before they reach a path.
6. *Framework caches.* The updater rebuilds the view cache and the route and event snapshots, never the configuration snapshot (extension providers change configuration at boot) and never `optimize:clear` (it flushes the application cache, which can hold sessions).
7. *Release tags are `gobia-v<version>`* so a Gobia tag can never collide with an upstream `v2.x` tag in the same repository.

**Contract additions** (all optional for an older frontend): `check` also returns `checked_at`, `error` and `active_update_id` and accepts `?refresh=1`; `progress` also returns `type`, `steps`, `failure_step` and `rollback.failed`; `rollback-eligibility` also returns `update_id`; `rollback` needs `confirm_database_restore: true` when the mode is `requires-db-restore`. The Updates screen gained a "Check for updates" button, follows a run that is already in flight after a reload, shows the log, and asks again before a database restore.
