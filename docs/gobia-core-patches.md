# Gobia core patches

Every modification Gobia makes to official Pterodactyl files outside Gobia owned paths (`extensions/gobia-*`, `themes/gobia`, `tools/audit-probe`,
`scripts/gobia`, `docs/gobia-*`, `tests/Integration/Gobia`, `tests/Integration/Extensions/AuditProbeTest.php`, `CLAUDE.md`, `MAJCEK_HANDOFF.md`,
`vitest.gobia.config.ts`, `.github/workflows/gobia-ci.yaml`). Goal: keep this list tiny. Baseline: upstream `2.0-develop` pinned at `240aaf62ea53b1d6956a643a872f44d2f5956031`.

## Permanent patches

| File | Purpose | Why the extension API cannot support it | Upstream conflict risk | Tests | Removal path |
| --- | --- | --- | --- | --- | --- |
| `.gitignore` | Track `extensions/gobia-*` (upstream ignores the whole `extensions/` directory as local checkouts) | Repository layout, not an extension concern | Low (two lines) | CI builds from tracked files | Move Gobia extensions to a separate repository and install them in the release build |
| `.github/workflows/*` (upstream `ci.yaml`, `docker.yaml`, `release.yaml`, `staging.yaml`, `build.yaml`, `react-doctor.yml` deleted; `gobia-ci.yaml` added) | Upstream workflows publish to `ghcr.io/pterodactyl/panel` and dispatch staging; they must never run from the Gobia repository | CI is repository configuration | None (deleted files) | n/a | Keep deleted |
| `resources/scripts/extensions/componentTypes.ts`, `resources/scripts/components/dashboard/DashboardContainer.tsx`, `resources/scripts/sdk/testing.tsx`, `app/Services/Extensions/ExtensionManifest.php`, `packages/sdk/manifest.schema.json`, `packages/sdk/README.md`, `tests/Unit/Services/Extensions/ExtensionManifestTest.php`, generated `packages/sdk/types/**` | New replaceable component `dashboard.page` (a whole page replacement, about 30 hand written lines plus generated types) | The dashboard list needs Gobia filters (All, You, Other), categories, a persisted per user order and its own data source. Slots only add content beside the native list, and `dashboard.serverCard` only restyles one row of a fixed, paginated native list. A replacement that owns the page also stops the native query from running | Medium: `componentTypes.ts`, `testing.tsx` and the manifest name lists change whenever upstream adds a replaceable component. Each hunk is a one line list entry, so conflicts are small but real | `resources/scripts/extensions/dashboardPage.spec.tsx` (3 tests), `ExtensionManifestTest` | Delete the patch if upstream adds an equivalent point (for example a dashboard list slot with replace semantics); otherwise re-apply with the sync checklist in `MAJCEK_HANDOFF.md` |

## Temporary patches (identical to open upstream pull requests, remove after the sync that contains the merge)

These make Gobia CI green on clean upstream. They are the same hunks as the pull requests, so merging upstream later resolves cleanly.

| File | Upstream PR | Problem fixed |
| --- | --- | --- |
| `tests/Integration/Console/SchedulerTest.php` | https://github.com/pterodactyl/panel/pull/7249 | Telemetry test counted requests for leftover nodes from other tests |
| `app/Http/Requests/Api/Admin/Extensions/InstallExtensionRequest.php`, `app/Services/Extensions/ExtensionPackageLocator.php` | https://github.com/pterodactyl/panel/pull/7250 | Pint formatting fails upstream |
| `app/Extensions/Illuminate/Auth/Passwords/PasswordBroker.php`, `PasswordBrokerManager.php`, `app/Http/Controllers/Api/Client/Servers/FileController.php` | https://github.com/pterodactyl/panel/pull/7251 | Rector changes reported under PHP 8.4 |
| `scripts/generate-extension-openapi.php` | https://github.com/pterodactyl/panel/pull/7252 | `mb_trim()` is undefined on PHP 8.3 |
| `packages/sdk/vite.mjs`, `packages/sdk/vite.spec.ts` | https://github.com/pterodactyl/panel/pull/7253 | Extension builds preload shared lazy chunks from the site root |
