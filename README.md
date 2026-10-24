**Infrastructure sponsored by [NCSE Network](https://ncse.tw/).**

Supporting free and open-source projects.

---

# panel.gobia.cloud

A customized game-server management panel derived from [Pterodactyl Panel](https://github.com/pterodactyl/panel).

| | |
|---|---|
| Panel version | see [`VERSION`](VERSION) (scheme: `<upstream>-gobia.<n>`, e.g. `1.15.1-gobia.1`) |
| Upstream base | Pterodactyl Panel v1.15.1 (`e98678c5a1d07a74036660a459d87a4eb7c105c1`) |
| Wings | unchanged, use upstream Wings |

The version lives only in `VERSION`; `config('app.version')` and `config('app.upstream_version')` are derived from it.

## Branches

- `main` - stable and releasable. Always builds and passes tests. Releases are tagged here.
- `develop` - ongoing development. Open work happens here and is merged to `main` when stable.

Remotes: `origin` is this fork, `upstream` is official Pterodactyl.

## Local development (Windows)

The portable toolchain (PHP 8.3, Composer, MariaDB) lives **outside** the repository in `C:\Users\majko\devtools`.

```powershell
C:\Users\majko\devtools\start-panel.ps1     # MariaDB + web server (http://localhost:8000) + queue worker
```

Requirements elsewhere: Node 22+, Yarn 1. Copy `.env.example` to `.env`, set `APP_KEY`, `HASHIDS_SALT` and the database credentials, then `php artisan migrate --seed`.

**Never commit `.env`.** It holds `APP_KEY`, database credentials and the update token. It is git-ignored; keep it that way.

## Build and test

```bash
composer install
yarn install --frozen-lockfile
yarn tsc && yarn lint            # TypeScript + ESLint
yarn build:production            # production assets
vendor/bin/php-cs-fixer fix --dry-run --diff
vendor/bin/phpunit               # needs a database whose name contains "test" (see .env.ci)
```

## Releases and updates

Releases are deliberate tags (`v1.15.1-gobia.2`) on `main`. A GitHub Actions workflow runs every check, builds the production frontend and publishes `panel-<version>.tar.gz` plus its SHA-256 as a GitHub Release. Release packages already contain compiled assets and `vendor/`; production never builds anything.

Administrators update from **Admin -> System -> Updates**. The Panel only installs releases published by this repository, verifies the checksum, backs up the database, installs, migrates and health-checks. See [`docs/updates.md`](docs/updates.md) for the architecture, token setup and the Linux helper.

Upstream Pterodactyl changes are never applied on a server. They are merged here first:

```bash
git fetch upstream --tags
git checkout develop && git merge v<new upstream tag>   # resolve conflicts, update VERSION to <new>-gobia.1
# run the full checks, test locally, merge develop into main
git tag v<new>-gobia.1 && git push origin main --tags     # CI builds and publishes the release
```

Performance measurements: [`docs/performance-baseline.md`](docs/performance-baseline.md), [`docs/performance-after.md`](docs/performance-after.md).
