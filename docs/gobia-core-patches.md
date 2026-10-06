# Gobia core patches

Every modification Gobia makes to official Pterodactyl files outside Gobia owned paths (`extensions/gobia-*`, `themes/gobia`, `tools/audit-probe`,
`scripts/gobia`, `docs/gobia-*`, `tests/Integration/Gobia`, `tests/Integration/Extensions/AuditProbeTest.php`, `CLAUDE.md`, `MAJCEK_HANDOFF.md`,
`vitest.gobia.config.ts`, `.github/workflows/gobia-ci.yaml`). Goal: keep this list tiny. Baseline: upstream `2.0-develop` pinned at `240aaf62ea53b1d6956a643a872f44d2f5956031`.

## Permanent patches

| File | Purpose | Why the extension API cannot support it | Upstream conflict risk | Tests | Removal path |
| --- | --- | --- | --- | --- | --- |
| `.gitignore` | Track `extensions/gobia-*` (upstream ignores the whole `extensions/` directory as local checkouts) | Repository layout, not an extension concern | Low (two lines) | CI builds from tracked files | Move Gobia extensions to a separate repository and install them in the release build |
| `.github/workflows/*` (upstream `ci.yaml`, `docker.yaml`, `release.yaml`, `staging.yaml`, `build.yaml`, `react-doctor.yml` deleted; `gobia-ci.yaml` added) | Upstream workflows publish to `ghcr.io/pterodactyl/panel` and dispatch staging; they must never run from the Gobia repository | CI is repository configuration | None (deleted files) | n/a | Keep deleted |

## Temporary patches (identical to open upstream pull requests, remove after the sync that contains the merge)

These make Gobia CI green on clean upstream. They are the same hunks as the pull requests, so merging upstream later resolves cleanly.

| File | Upstream PR | Problem fixed |
| --- | --- | --- |
| `tests/Integration/Console/SchedulerTest.php` | https://github.com/pterodactyl/panel/pull/7249 | Telemetry test counted requests for leftover nodes from other tests |
| `app/Http/Requests/Api/Admin/Extensions/InstallExtensionRequest.php`, `app/Services/Extensions/ExtensionPackageLocator.php` | https://github.com/pterodactyl/panel/pull/7250 | Pint formatting fails upstream |
| `app/Extensions/Illuminate/Auth/Passwords/PasswordBroker.php`, `PasswordBrokerManager.php`, `app/Http/Controllers/Api/Client/Servers/FileController.php` | https://github.com/pterodactyl/panel/pull/7251 | Rector changes reported under PHP 8.4 |
| `scripts/generate-extension-openapi.php` | https://github.com/pterodactyl/panel/pull/7252 | `mb_trim()` is undefined on PHP 8.3 |
