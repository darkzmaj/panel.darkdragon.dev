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

## Temporary patches (identical to upstream pull requests, remove after the sync that contains the merge)

Reviewed in the final pass: all five pull requests below are now merged upstream (7250 and 7251 on 2026-10-06, 7249, 7252 and 7253 on 2026-10-07). The hunks stay until the next upstream sync, which deletes them; they are not needed afterwards.

These make Gobia CI green on clean upstream. They are the same hunks as the pull requests, so merging upstream later resolves cleanly.

| File | Upstream PR | Problem fixed |
| --- | --- | --- |
| `tests/Integration/Console/SchedulerTest.php` | https://github.com/pterodactyl/panel/pull/7249 | Telemetry test counted requests for leftover nodes from other tests |
| `app/Http/Requests/Api/Admin/Extensions/InstallExtensionRequest.php`, `app/Services/Extensions/ExtensionPackageLocator.php` | https://github.com/pterodactyl/panel/pull/7250 | Pint formatting fails upstream |
| `app/Extensions/Illuminate/Auth/Passwords/PasswordBroker.php`, `PasswordBrokerManager.php`, `app/Http/Controllers/Api/Client/Servers/FileController.php` | https://github.com/pterodactyl/panel/pull/7251 | Rector changes reported under PHP 8.4 |
| `scripts/generate-extension-openapi.php` | https://github.com/pterodactyl/panel/pull/7252 | `mb_trim()` is undefined on PHP 8.3 |
| `packages/sdk/vite.mjs`, `packages/sdk/vite.spec.ts` | https://github.com/pterodactyl/panel/pull/7253 | Extension builds preload shared lazy chunks from the site root |

## Visual parity patches (Gobia shell and primitives)

These are presentation patches. The extension API can replace five components (`dashboard.page`, `dashboard.serverCard`, `server.files.*`) and add slots, but it cannot replace the application shell, the auth screens or the shared UI primitives, so exact 1.x parity needs these edits. All new Gobia code lives in `resources/scripts/gobia/**` (not an upstream path, no conflicts); the files below are the only upstream files touched.

| File | Purpose | Why the extension API cannot do it | Upstream conflict risk | Tests | Removal path |
| --- | --- | --- | --- | --- | --- |
| `resources/scripts/index.tsx` | Imports `../gobia/gobia.css` (kept outside `resources/scripts` so the upstream custom CSS token spec, which allows only `var()` colours there, does not scan the Gobia component layer) | No stylesheet slot loads before first paint for the shell | Low (one import) | Vite build | Move the import into a theme CSS file if upstream themes may ship component CSS |
| `router/layouts/AuthenticatedLayout.tsx`, `AdminLayout.tsx`, `AccountLayout.tsx`, `AuthLayout.tsx`, `ServerLayout.tsx` | Replace the horizontal navigation, sub navigation and auth wrapper with the Gobia shell, sidebar and local menu | Layouts are not replaceable components | Medium (layout files change upstream) | Browser comparison with 1.x, `gobia-core` vitest | Upstream "layout" replacement point |
| `components/NavigationBar.tsx` | No longer rendered (kept so upstream merges stay trivial) | Same | Low | none | Delete after the next upstream sync |
| `components/auth/LoginFormContainer.tsx` | Gobia sign in screen with the interactive preview | Auth screens have no slot that replaces the frame | Medium | Browser comparison | Upstream auth frame slot |
| `components/elements/PageContentBlock.tsx`, `ServerContentBlock.tsx`, `PageHeading.tsx` | Page wrapper without the Pterodactyl footer, 1.x page head and subtitles | Shared wrapper, not a replaceable component | Medium | Browser comparison | Upstream page wrapper slot |
| `components/elements/Button.tsx`, `Label.tsx`, `components/form/controls.tsx`, `components/ui/Select.tsx`, `Checkbox.tsx`, `typography.ts` | Gobia control sizes, radius, focus ring | Primitives are not replaceable | Medium (class strings) | Existing component specs | Tokens only, if upstream exposes control tokens |
| `components/elements/dialog/Dialog.tsx`, `dropdown/DropdownMenu.tsx`, `table/DataTable.tsx`, `AppToaster.tsx`, `alert/Alert.tsx`, `ui/empty.tsx`, `ContentBox.tsx`, `TitledGreyBox.tsx`, `GreyRowBox.tsx` | Gobia modal, menu, table, toast, alert and card look | Same | Medium | Existing component specs | Same |
| `components/admin/overview/OverviewContainer.tsx` | Gobia overview heading; the stock version card, external links and navigation cards are removed (updates are Gobia releases) | Core page, the slots only add content | Low | Browser comparison | Keep |
| `router/routeTree.ts`, `components/admin/servers/ServersContainer.tsx` | Admin "Servers" is "Instances" | Route metadata is core | Low (two strings) | none | Keep |
| `components/server/console/ServerConsoleContainer.tsx` | Console draws its own header | Core page | Low | none | Keep |
| `router/routeTree.ts` (server `users` and `users/new`) | The per server Users page is gone: both addresses redirect to `/account/access?server=<uuid>` (`&grant=1` for the add address) and the navigation entry is removed. The subuser API, models and permission checks are untouched; Account, Access (`gobia-core`) is the one place to share instances | Navigation entries and routes of core pages cannot be removed or redirected by an extension | Low (two route blocks, one nav entry) | `access: no Users entry...` browser flow, `AccessTest` | Keep; delete the redirect stubs once no bookmark needs them |
| `resources/views/templates/wrapper.blade.php` | Inline script that applies the stored colour scheme before first paint (no wrong theme flash) | The wrapper has no extension point for an inline head script | Low (one block) | `npm run test:gobia:browser` | Move into a theme or extension head tag if upstream supports inline scripts |
| `packages/sdk/slot-coverage.spec.ts` | Lists the Gobia shell files as anchors of the navigation slots | Test file | Low (two lines) | itself | Remove with the shell patch |
| `components/server/files/FileManagerContainer.tsx`, `components/server/settings/SettingsContainer.tsx` | No duplicate page head above the Gobia workspace; labelled SFTP fields (accessibility) | Core pages | Low | axe in `npm run test:gobia:browser` | Keep |
| `components/auth/*Container.tsx`, `dashboard/AccountOverviewContainer.tsx` | Gobia copy and layout of the sign in screens and the Security page | Core pages | Low | Browser comparison | Keep |
| `package.json`, `package-lock.json`, `packages/sdk/types/**` | `dev:gobia` and `test:gobia:browser` scripts, dev dependencies of the browser checks (`playwright-core`, `axe-core`, `pixelmatch`, `pngjs`), regenerated SDK declarations | Tooling | Low | `npm run sdk:check` | Keep |

## Motion, loading and table patches (final frontend pass)

| File | Purpose | Why the extension API cannot do it | Upstream conflict risk | Tests | Removal path |
| --- | --- | --- | --- | --- | --- |
| `resources/scripts/router/router.tsx` | No view transitions, pending time 0, `PageSkeleton` as the pending component | Router options are core | Low | `npm run test:gobia:browser` | Upstream router option for the pending component |
| `resources/scripts/components/elements/Spinner.tsx` | A large centred spinner renders `PageSkeleton` | Shared element | Low | Browser comparison | Keep |
| `resources/scripts/index.tsx`, `resources/scripts/router/view-transitions.css` (deleted), `packages/sdk/prefix.spec.ts` | View transition import and stylesheet removed (the shell stays still, only the content fades); the prefix spec no longer lists the deleted stylesheet | Entry file | Low | Browser comparison | Keep |
| `resources/scripts/components/elements/table/DataTable.tsx` | The scroll container is `relative`, so visually hidden text in action buttons cannot widen the page on phones | Shared table | Low | responsive check at 390 and 430 px | Keep |
| `resources/scripts/components/elements/AppToaster.tsx`, `components/Avatar.tsx` | Toast descriptions inherit the toast colour (Sonner's dark theme painted them light grey on the red error toast, contrast 1.9); the generated avatar is decorative (`aria-hidden`) | Shared elements | Low | axe in `npm run test:gobia:browser` | Keep |
| `resources/scripts/gobia/shell/Sidebars.tsx` | Admin groups Dashboard, Network, Services, System in the 1.x order (new Gobia file, not an upstream path) | Sidebar is Gobia code | None | Browser comparison | None |

Extension level changes that are not core patches: `gobia-files` replaces `server.files.manager` (workspace) and `server.files.editor` (redirect into the workspace); `gobia-templates` gained `GET /api/admin/extensions/gobia-templates/templates/{id}/revisions` and a nullable `created_by` column on its revision table; `gobia-core` gained view counts and search in the instance list API.

## Review of the registry (final closure pass)

Every permanent and visual patch above was re-read against the current extension API. None can move into an extension today: the shell, auth frame, shared primitives
and router options are not replaceable components, and the one theme hook the shell needs (stored scheme before first paint) has no extension point. Two entries became
smaller than they were: the view transition stylesheet is gone, and the files editor no longer needs any core file (it is an extension replacement of `server.files.editor`).
Core edits made since: the loading skeleton (`gobia/PageSkeleton.tsx`, a busy indicator with the progressbar role so pages keep a single status region), the account
activity, API credentials and SSH keys headings, card heading consistency in the location and node pages, and container based columns in the two account key tables. The dialog keeps Tab and Shift+Tab inside itself (`components/elements/dialog/Dialog.tsx`, already patched): the library's focus guards let focus reach the page behind in headless
Chromium, found by the keyboard flow. `gobia/shell/GobiaShell.tsx` scrolls the current menu entry into view, `components/elements/AppToaster.tsx`, `components/Avatar.tsx` and `components/server/startup/StartupContainer.tsx` and `components/server/console/Console.tsx` fix contrast, alt text and missing label findings of axe (the terminal text colour was the page foreground, dark on the dark terminal in the light theme). All of these are presentation or accessibility only and are covered by the browser checks.
