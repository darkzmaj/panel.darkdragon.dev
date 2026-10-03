# Panel updates

Administrators update the Panel from **Admin -> Updates** (or `php artisan gobia:update:run`). The Panel installs
**release packages published by this repository**; it never pulls from upstream Pterodactyl and never builds anything.

## Architecture

```
Admin UI / CLI
      |  version string only
      v
UpdateService ---- ReleaseProvider (GitHub | directory)     what exists, how to download it
      |            ReleaseVerifier (SHA-256 + Ed25519)       whether to trust it
      |  creates run record, starts one detached worker
      v
UpdateOrchestrator (worker process, holds the update lock)
      | download -> verify -> unpack (SafeTarExtractor) -> DB backup -> maintenance -> install
      | -> migrate -> caches -> restart workers -> health check -> up
      v
DeploymentRunner                                             how code goes live
   InPlaceRunner          Windows/dev: swaps top-level directories, keeps .env + storage
   ReleaseDirectoryRunner Linux: releases/<v> + `current` symlink, privileged helper for the switch
```

State (run records, logs, downloads, backups) lives under `storage/updater` (`GOBIA_UPDATE_STATE_PATH`), outside the
database and outside any release, so it survives migrations, database restores and release switches.

Run states: queued -> running (stages: check, download, verify, extract, backup, maintenance, install, migrate, cache,
restart, health, finish) -> completed, or failed -> rolling back -> failed with result `rolled_back` / `rollback_failed`.

## Release package

`panel-<version>.tar.gz` plus `release.json` and `panel-<version>.tar.gz.sha256`, attached to a GitHub Release whose tag
is `v<version>` (for example `v1.15.1-gobia.2`). The package holds the application, `vendor/` (production only,
optimized) and compiled `public/assets`. It never holds `.env`, `storage/`, `.git`, symlinks or `vendor/bin`; the updater
refuses packages that do.

`release.json`: `version`, `sha256`, `size`, `migrations`, `requires_restart`, `signature`. The signature is an Ed25519
signature over `gobia-release-v1|version|sha256|size|migrations|restart`, so neither the checksum nor the flags can be
altered without the private key. The Panel checks it against `GOBIA_UPDATE_PUBLIC_KEY` (the project's public key is the
default in `config/gobia.php`).

Build locally: `yarn build:production && GOBIA_RELEASE_SIGNING_KEY=<base64 secret key> scripts/release/build-release.sh dist`.
CI builds it on a pushed tag (`.github/workflows/release.yml`) after the full CI workflow passes, and refuses a tag that
does not match `VERSION` or is not on `main`.

### One-time setup of the release pipeline

1. Generate a key pair: `php -r '$k=sodium_crypto_sign_keypair(); echo base64_encode(sodium_crypto_sign_publickey($k)),"\n",base64_encode(sodium_crypto_sign_secretkey($k)),"\n";'`
2. Put the **secret** key in the repository secret `GOBIA_RELEASE_SIGNING_KEY` and the **public** key in `config/gobia.php`
   (`GOBIA_UPDATE_PUBLIC_KEY`). Never commit the secret key.
3. Release: set `VERSION` (for example `1.15.1-gobia.2`), merge to `main`, `git tag v1.15.1-gobia.2 && git push origin v1.15.1-gobia.2`.

## Configuring a server (production)

`.env`:

```
GOBIA_UPDATE_GITHUB_TOKEN=github_pat_...     # fine-grained token, repository Cryvex-Dev/panel.gobia.cloud, "Contents: Read-only" only
GOBIA_UPDATE_INSTALL_ROOT=/var/www/pterodactyl
```

The token is read only by the server, never sent to the browser, never returned by an API and redacted from logs.
Create it at GitHub -> Settings -> Developer settings -> Fine-grained tokens, scoped to this single repository.

### Linux layout and privileged helper

```
/var/www/pterodactyl/
  releases/1.15.1-gobia.1/        one directory per release (owned by the panel user)
  shared/.env  shared/storage/    configuration and state, linked into every release
  current -> releases/1.15.1-gobia.1      nginx root: /var/www/pterodactyl/current/public
```

The PHP user needs no root. Only three actions are privileged and go through a root-owned script that accepts exactly
three verbs and validates its input (`deploy/linux/gobia-update-helper`):

```
install -m 0755 -o root -g root deploy/linux/gobia-update-helper /usr/local/sbin/gobia-update-helper

# /etc/gobia-update-helper.conf   (root:root, 0644)
PANEL_ROOT=/var/www/pterodactyl
PANEL_USER=www-data
WORKER_SERVICE=pteroq.service
PHP_FPM_SERVICE=php8.3-fpm.service

# /etc/sudoers.d/gobia-update   (visudo -f)
www-data ALL=(root) NOPASSWD: /usr/local/sbin/gobia-update-helper activate *, \
                              /usr/local/sbin/gobia-update-helper restart-workers, \
                              /usr/local/sbin/gobia-update-helper reload-php
```

`activate <version>` only accepts `^\d+\.\d+\.\d+-gobia\.\d+$`, requires `releases/<version>` to exist, to be a real
directory owned by the panel user and to contain a matching `VERSION`, then atomically repoints `current`. It cannot
run commands, touch other paths or restart other services. The updater's artisan calls are likewise limited to a fixed
list (`down`, `up`, `migrate`, `optimize`, `optimize:clear`, `view:cache`, `queue:restart`, `gobia:update:health`).

Keep `queue:work` under systemd with `Restart=always` so `restart-workers` brings it back on the new code.

## Backups, rollback and failure behavior

- Before maintenance mode a `mysqldump` of the Panel database is written to `storage/updater/backups/<run>/` and
  verified (non-empty, complete footer). If it cannot be made, the update **aborts** and nothing is touched. The last
  `GOBIA_UPDATE_BACKUP_RETENTION` (5) update backups are kept. These are separate from server backups.
- A failure before install only cleans up. A failure at or after install restores the previous files; if migrations had
  started, the pre-update database dump is restored too (migrations are not assumed reversible; tables created by a
  half-applied migration are dropped first). Then maintenance mode is lifted.
- If the rollback itself fails the Panel stays in maintenance mode and the run is marked `rollback_failed`; fix the
  cause and run `php artisan gobia:update:recover --force-up`. A worker that dies mid-update is detected (no heartbeat,
  lock free) and recovered the same way, automatically when the Updates page or progress endpoint is requested.
- Manual rollback of the last successful update: `php artisan gobia:update:rollback` restores the previous files. If
  that update ran migrations it requires `--restore-database`, which discards data saved since the update.
- Only one update can run: the run record is created with an exclusive file create and the worker holds an exclusive
  file lock. A second request just returns the running update.
- `.env`, `storage/` (avatars, branding, logs, updater state) and the database are never replaced by an update.

## Windows development

`GOBIA_UPDATE_RUNNER=in-place` (default on Windows) swaps the top-level directories of the installation in place and
keeps the previous ones in the backup folder. For a local end-to-end test point the directory provider at a folder of
built releases (`<dir>/<version>/{release.json,panel-<version>.tar.gz}`):

```
GOBIA_UPDATE_PROVIDER=directory
GOBIA_UPDATE_DIRECTORY=C:/Users/you/devtools/releases
GOBIA_UPDATE_SPAWN_QUEUE_WORKER=true     # no systemd here, so the runner starts the replacement queue worker
```

## Security model

- Source and repository are server configuration; the browser sends a version string that must match
  `^\d{1,4}\.\d{1,4}\.\d{1,4}-gobia\.\d{1,4}$` and be published by the source. No URL, path or command is accepted.
- Every package is verified (size, SHA-256, Ed25519 signature over the metadata) before it is even unpacked, and unpacked
  by an extractor that rejects traversal, absolute and drive paths, links, device files, `.env`, `storage`, `.git`,
  duplicates, oversized or truncated archives.
- Root administrators only (`AdminAuthenticate` + `AdminFormRequest`), CSRF-protected POSTs, rate-limited checks and starts.
  Update availability is cached (6 h); only the manual check refreshes it.
- `/system/update-progress` is public so the maintenance page can show progress; it returns stage names and a percentage
  only.

## Merging upstream Pterodactyl

```
git fetch upstream --tags
git checkout develop && git merge v<new upstream tag>     # resolve conflicts, set VERSION to <new>-gobia.1
yarn tsc && yarn lint && yarn build:production
vendor/bin/php-cs-fixer fix --dry-run && vendor/bin/phpunit
# test locally, then merge develop into main, tag v<new>-gobia.1, push the tag (CI builds and publishes the release)
```

An upstream change is never applied on a production server; it ships only as one of our releases.
