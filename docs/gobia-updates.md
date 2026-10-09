# Gobia Panel updates

Administrators update the Panel from **Admin, Updates**: "Check for updates" asks the update source, the preflight list shows whether this
installation is ready, and "Update" installs the release. No terminal is needed. The same update can be started with
`php artisan gobia-core:update:run`.

The Panel installs **signed Gobia release packages only**. It never pulls from upstream Pterodactyl, never runs `composer` or `npm` on the
server, and never accepts a URL, path or command from the browser. The browser sends a version string or a run id and nothing else.

Code: `extensions/gobia-core/src/Updater`, `src/Console/Update`, `src/Http/Controllers/UpdateController.php`, configuration
`extensions/gobia-core/config/gobia_updater.php`. API contract: `docs/gobia-updates-frontend-contract.md`.

## How an update runs

```
Admin UI / CLI
      |  version string only
      v
UpdateService ---- ReleaseProvider (GitHub | directory)     what exists, how to download it
      |            ReleaseVerifier (SHA-256 + Ed25519)       whether to trust it
      |            Preflight (20 checks)                     whether this installation is ready
      |  creates the run record, starts one detached worker (php artisan gobia-core:update:work <id>)
      v
UpdateOrchestrator (worker process, holds the update lock)
      | preflight again -> download -> verify -> unpack (SafeTarExtractor) -> database backup -> maintenance mode
      | -> install -> migrate -> theme and extensions -> view cache -> restart workers -> health check -> up
      v
DeploymentRunner                                             how code goes live
   InPlaceRunner          standard layout: swaps the code directories, keeps .env and storage
   ReleaseDirectoryRunner hardened layout: releases/<version> + "current" symlink, switched by a root owned helper
```

State (run records, logs, downloads, backups) lives under `storage/updater` (`GOBIA_UPDATE_STATE_PATH`), outside the database and outside
any release, so it survives migrations, database restores and release switches.

| Step | What happens | If it fails |
| --- | --- | --- |
| check | The release is looked up again, its signature verified and the whole preflight repeated | Nothing has changed |
| download, verify, extract | The package is fetched, its size and SHA-256 compared with the signed manifest, then unpacked into `storage/updater/staging` | Nothing has changed |
| backup | `mariadb-dump`/`mysqldump` of the Panel database into `storage/updater/backups/<run>`, verified complete | Nothing has changed; the update stops |
| maintenance | `php artisan down` with a one time secret | The Panel is brought back up |
| install | The new code goes live (see the two layouts below) | Previous files are restored |
| migrate | `php artisan migrate --force` in the new code | Previous files **and** the database dump are restored |
| extensions | `gobia-core:update:finalize`: the Gobia theme is applied and every enabled extension is migrated and published again | Same |
| cache | `view:clear`, `view:cache` | Same |
| restart | `queue:restart`, and through the helper the worker service, companion services and PHP-FPM | Same |
| health | `gobia-core:update:health` in the new code (version, database, pending migrations, storage, frontend manifest, Gobia extensions loaded, queue) and an HTTP request for the sign in page | Same |
| finish | `php artisan up`, temporary files removed, old backups pruned | |

If the rollback itself fails the Panel stays in maintenance mode and the run says so. Fix the cause and run
`php artisan gobia-core:update:recover --force-up`. A worker that dies mid update is detected (no heartbeat for three minutes and nobody
holds the lock) and recovered the same way, automatically when the Updates screen asks for progress.

## What an update keeps

* `.env`, `storage/` (uploads, avatars, branding files, template files, logs, updater state) and the database are never part of a release
  and never replaced. The extractor refuses a package that contains them.
* **Extensions and themes that are not part of the release** (anything under `extensions/` or `themes/` the release does not ship) are
  copied into the new code, without `node_modules` and `.git`.
* Enabled extensions stay enabled and disabled ones stay disabled. Their published assets and the Gobia theme are published again from
  the new code. A Gobia extension that a release introduces is enabled.
* The preflight refuses the update when an enabled third party extension declares a `requires.panel`, `requires.sdk` or `requires.php`
  that the release does not satisfy, so an update cannot silently break one.

Gobia's own customisations are the release: the three Gobia extensions, the Gobia theme, the shell and the core patches all ship inside the
signed package, built from the Gobia repository. Nothing is merged from upstream on the server.

## Configuration (`.env`)

Most installations need one line:

```
GOBIA_UPDATE_GITHUB_TOKEN=github_pat_...     # fine-grained token, repository Cryvex-Dev/panel.gobia.cloud, "Contents: Read-only" only
```

The token is only needed while the repository is private. It is read by the server, never sent to the browser, never returned by an API
and redacted from logs.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GOBIA_UPDATE_PROVIDER` | `github` | `directory` installs from a local folder (`GOBIA_UPDATE_DIRECTORY`): development and air gapped servers |
| `GOBIA_UPDATE_REPOSITORY` | `Cryvex-Dev/panel.gobia.cloud` | The only repository releases come from |
| `GOBIA_UPDATE_PUBLIC_KEY` | the project key in `gobia_updater.php` | Base64 Ed25519 public key releases must be signed with |
| `GOBIA_UPDATE_RUNNER` | `in-place`, or `release-directory` when `GOBIA_UPDATE_INSTALL_ROOT` is set | How code goes live |
| `GOBIA_UPDATE_HELPER` | `/usr/local/sbin/gobia-update-helper` | Root owned helper (optional for `in-place`) |
| `GOBIA_UPDATE_BACKUP_RETENTION` | `3` | Update backups kept |
| `GOBIA_UPDATE_CHECK_TTL` | `21600` | Seconds the "latest release" answer is cached; the button always asks again |
| `GOBIA_UPDATE_HTTP_PROBE`, `GOBIA_UPDATE_HEALTH_URL` | on, `APP_URL` | The HTTP part of the health check |
| `GOBIA_UPDATE_PHP_BINARY`, `GOBIA_UPDATE_MYSQLDUMP`, `GOBIA_UPDATE_MYSQL` | looked up on `PATH` | Absolute paths when the programs are not on the PHP user's `PATH` |
| `GOBIA_UPDATE_PRERELEASE` | off | Also offer pre-releases (`2.1.0-rc.1`) |
| `GOBIA_UPDATE_ALLOW_UNSIGNED` | off | Development only |

Requirements on the server: the `sodium` PHP extension (signature check), `mariadb-dump` or `mysqldump` and the matching client, and a
queue worker supervised by systemd (`Restart=always`) so `queue:restart` brings it back on the new code.

## Layout 1: in place (the standard installation)

Nothing to set up. The Panel directory (`/var/www/pterodactyl`) is owned by the PHP user as in the normal installation guide. The updater
renames each top level code directory into `storage/updater/backups/<run>/previous` and moves the new one in, so a rollback is the same
renames in reverse. `storage/updater` must be on the same filesystem as the Panel (it is by default).

PHP-FPM picks the new files up through OPcache's timestamp check (the PHP default). If the server runs with
`opcache.validate_timestamps=0`, install the helper below: the updater then also reloads PHP-FPM.

## Layout 2: release directories (optional, hardened)

```
/var/www/pterodactyl/
  releases/2.0.0/                 one directory per release, owned by the Panel user
  shared/.env  shared/storage/    configuration and state, linked into every release
  current -> releases/2.0.0       web server root: /var/www/pterodactyl/current/public
```

`.env`: `GOBIA_UPDATE_INSTALL_ROOT=/var/www/pterodactyl`. Switching a release is one atomic symlink replacement done by the helper.

### The helper

The PHP user needs no root. The only privileged actions go through a root owned script with a fixed set of verbs
(`deploy/linux/gobia-update-helper`): `check`, `activate <version>` and `restart-services`.

```
install -m 0755 -o root -g root deploy/linux/gobia-update-helper /usr/local/sbin/gobia-update-helper

# /etc/gobia-update-helper.conf   (root:root, 0644; read as data, never executed)
PANEL_ROOT=/var/www/pterodactyl
PANEL_USER=www-data
WORKER_SERVICE=pteroq.service
PHP_FPM_SERVICE=php8.3-fpm.service
EXTRA_SERVICES=gobia-template-sftp.service

# /etc/sudoers.d/gobia-update   (visudo -f)
www-data ALL=(root) NOPASSWD: /usr/local/sbin/gobia-update-helper check, \
                              /usr/local/sbin/gobia-update-helper activate *, \
                              /usr/local/sbin/gobia-update-helper restart-services
```

`activate` only accepts a version that matches the Gobia version pattern, requires `releases/<version>` to be a real directory owned by the
Panel user whose `gobia-release.json` states that version, then repoints `current`. The helper cannot run commands, touch other paths or
restart services that are not named in its configuration. The updater's own artisan calls are limited to a fixed list (`down`, `up`,
`migrate`, `view:clear`, `view:cache`, `queue:restart`, `gobia-core:update:health`, `gobia-core:update:finalize`).

## Release package and signature

A release is three files attached to the GitHub Release tagged `gobia-v<version>` (the prefix keeps Gobia tags apart from upstream tags):

* `gobia-panel-<version>.tar.gz`: the application, production `vendor/`, built `public/assets` and built extension bundles. Never `.env`,
  `storage/`, `.git`, symbolic links, tests or development tooling.
* `release.json`: `gobia-release.json` plus the bundled extension versions, the names of every migration in the release, the destructive
  flag and the artifact's name, size and SHA-256, with an Ed25519 `signature` over all of it (`ReleaseSignature::message()`: the context
  line `gobia-release-v2` and the manifest as canonical JSON). Changing any field, or swapping the package, breaks the signature.
* `gobia-panel-<version>.tar.gz.sha256` for people.

Versions are `MAJOR.MINOR.PATCH` with an optional `-dev`, `-alpha.N`, `-beta.N` or `-rc.N`. Only versions without a suffix are offered
unless `GOBIA_UPDATE_PRERELEASE` is on.

### One time setup of the release key

1. Generate a key pair:
   `php -r '$k=sodium_crypto_sign_keypair(); echo base64_encode(sodium_crypto_sign_publickey($k)),"\n",base64_encode(sodium_crypto_sign_secretkey($k)),"\n";'`
2. Put the **secret** key in the repository secret `GOBIA_RELEASE_SIGNING_KEY` and the **public** key in
   `extensions/gobia-core/config/gobia_updater.php` (`public_key`). Never commit the secret key.

The public key in the configuration file today is the Gobia 1.x release key. Keep using it only if its secret key is still under your
control; otherwise replace it before the first 2.x release.

### Publishing a release

1. Set `gobia_version` in `gobia-release.json` (and `min_upgrade_from`, `security_update` when they apply). Let the Gobia CI workflow pass.
2. Tag and push: `git tag gobia-v2.0.1 && git push origin gobia-v2.0.1`. `.github/workflows/gobia-release.yaml` checks that the tag
   matches the file and is on `gobia-2`, builds the frontend and the package, signs it and publishes the GitHub Release.
3. While GitHub Actions is unavailable for the organisation, build on any Linux machine and upload the three files to the release by hand:

```
npm ci && npm --prefix extensions/gobia-files ci
npm run build:production && node scripts/gobia/run.mjs build
GOBIA_RELEASE_SIGNING_KEY=<base64 secret key> scripts/release/build-release.sh dist
```

Set `RELEASE_DESTRUCTIVE=true` (repository variable `GOBIA_RELEASE_DESTRUCTIVE` in CI) for a release that contains a migration which drops
or narrows data. The preflight shows it. The updater always restores the database dump when a failed update had started migrating, and a
manual rollback of an update that ran migrations always restores the dump too, so this flag informs the administrator, it does not weaken
any safeguard when it is missing.

Production panels see "Update available" only after step 2 or 3. An upstream Pterodactyl release never shows up on its own: it reaches
installations only as part of a Gobia release.

## Rollback

"Roll back" in Admin, Updates (or `php artisan gobia-core:update:rollback`) undoes the last installed update with the backup it left
behind. When that update ran migrations the pre-update database is restored and everything saved since the update is lost; the screen
says so and asks again, and the command needs `--restore-database`. Only the newest update can be rolled back, and only while its backup
is still kept.

## Security model

* The update source, repository, signing key and runner are server configuration. No request can change them.
* A release is trusted only if its manifest carries a valid Ed25519 signature from the configured key. The package is compared with the
  signed size and SHA-256 before it is unpacked, and unpacked by an extractor that rejects traversal, absolute and drive paths, links,
  device files, `.env`, `storage`, `.git`, duplicates, oversized and truncated archives.
* Reading the update state needs a root administrator. Installing and rolling back also need a panel session (an API key is refused),
  CSRF protection applies, and both are limited to six requests a minute.
* Only one update can run: the run record is created with an exclusive file create and the worker holds an exclusive file lock.
* Logs and run records are scrubbed of the database password, the application key and GitHub tokens before they are stored or shown.
* The worker runs as the Panel's PHP user. In the in-place layout that user can already write the Panel's code, so the updater adds no new
  privilege; the release directory layout with the helper is for installations that want the code owned separately from the web process.

## Tests

* `tests/Integration/Gobia/UpdaterTest.php` (Pest): authorisation, check, tampered and unsigned manifests, every preflight failure,
  install validation, a complete run, a failed migration with rollback, a swapped package, an incomplete package, manual rollback with and
  without a database restore, hostile archives, the in-place file swap and restore, the command allow list, log scrubbing.
* An end to end run on Linux (PHP 8.4, MariaDB 11.8, unprivileged Panel user) is recorded in `docs/gobia-updater-e2e.md`.

Not covered by a test yet: the GitHub provider against the real API, PHP-FPM with systemd, the release directory layout on a real server,
real Wings nodes during an update, and a full disk. Run one update on a staging copy of production before relying on it.
