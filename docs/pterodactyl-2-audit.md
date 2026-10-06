# Pterodactyl 2.0 audit (clean upstream, before Gobia features)

Status: baseline complete. Extension capability audit complete for the backend API and for the frontend capabilities listed below. Real Wings behaviour
(console websocket, power, backups, uploads) is not audited because only a mock Wings is available.

## Upstream and pinned baseline

* Repository: https://github.com/pterodactyl/panel, branch `2.0-develop`.
* First audited SHA: `0d8cd97d00852aa7b251ea39d05a6df168874db1` (2026-10-06 12:30 +0100).
* **Pinned Gobia baseline: `240aaf62ea53b1d6956a643a872f44d2f5956031`** (merged into `gobia-2` as sync checkpoint 1). It includes upstream fixes for reset password security,
  username enumeration timing, a recaptcha secret leak in settings and mobile tooltip handling. Upstream moves daily; Gobia does **not** rebase continuously. Syncs happen at controlled checkpoints
  or for important security fixes, each followed by the full Gobia CI run.
* Upstream only runs its Tests workflow on pull requests (not on pushes to `2.0-develop`), so the branch itself can be red without anyone noticing. That is how the failures below accumulated.

## Environments

* Authoritative: Linux (GitHub Actions `ubuntu-24.04`), PHP 8.3 and 8.4, MariaDB 11 and MySQL 8, Node 22. Workflow: `.github/workflows/gobia-ci.yaml` in the Gobia repository.
* Local development: Windows 11, PHP 8.3.35 (no `ext-posix`, no `pdo_sqlite`), MariaDB 11.8.9, Node 22. No WSL or Docker is available here, so Linux results come from CI. Windows only failures
  are listed separately and are not upstream bugs.

## Installation (clean upstream)

`composer install` needs `ext-posix`, which Windows PHP does not have (installed with `--ignore-platform-req=ext-posix` locally; CI installs normally). `npm ci` is clean.
`php artisan migrate` on a fresh MariaDB runs every migration cleanly (the `mysql` client must be on `PATH` because Laravel loads `database/schema/mysql-schema.sql` through it).
The development panel needs `RECAPTCHA_ENABLED=false` in `.env`, otherwise the login form cannot be submitted headlessly.

## Official checks on Linux at `240aaf62e` (before any Gobia change except CI)

| Check | Result |
| --- | --- |
| `npm run api:check` (SDK check, tsc, lint) | pass (PHP 8.4) |
| `npm test` | pass on PHP 8.4; **1 failure on PHP 8.3** (`mb_trim()` undefined, see PR 7252) |
| `npm run build:vite` | pass |
| `vendor/bin/pint --test` | **fail**, 2 files (PR 7250) |
| `vendor/bin/phpstan analyse -c phpstan-rules.neon` | pass |
| `vendor/bin/rector --dry-run` | **fail** under PHP 8.4, 3 files (PR 7251) |
| `pest tests/Unit` and `pest --type-coverage --min=100` | pass (PHP 8.3 and 8.4) |
| `pest tests/Integration` (MariaDB 11, MySQL 8, PHP 8.3 and 8.4) | 1274 pass, **1 failure** in every cell: `Console\SchedulerTest` telemetry (PR 7249) |

With the four fixes applied the whole Gobia CI is green on Linux (Frontend PHP 8.3 and 8.4, Static Analysis, four Tests cells).

### Windows only failures (explained, not upstream bugs)

Vitest 32 in `tools/oxlint/rules/lint.spec.ts` and 1 in `packages/sdk/openapi.spec.ts` (standalone extension client generation), Unit 10 (`RunHooksCommandTest` executable bit, stylesheet inspector and
tooling path handling), Integration 24 (`pdo_sqlite` missing for `BackendWriteConsistencyTest` and `SubuserGrantUniquenessMigrationTest`, POSIX modes in `UpgradeCommandTest`). All pass on Linux CI.

## Upstream bugs found, with pull requests

All opened from the `darkzmaj` fork against `pterodactyl/panel` base `2.0-develop`, written without dash characters, one issue per pull request.

| PR | Problem | Reproduced on |
| --- | --- | --- |
| https://github.com/pterodactyl/panel/pull/7249 | `SchedulerTest` telemetry assertion counts requests for nodes left behind by other tests (21 nodes existed) and makes real outbound requests to their addresses | Linux CI PHP 8.3 and 8.4, Windows |
| https://github.com/pterodactyl/panel/pull/7250 | `pint --test` fails on 2 files, which fails every upstream pull request | Linux CI |
| https://github.com/pterodactyl/panel/pull/7251 | `rector --dry-run` reports 3 files under PHP 8.4 | Linux CI |
| https://github.com/pterodactyl/panel/pull/7252 | `scripts/generate-extension-openapi.php` calls `mb_trim()`, undefined on PHP 8.3 | Linux CI PHP 8.3 |

## Extension system audit (disposable extension `tools/audit-probe`)

Verified by running code, not by reading:

| Capability | Result | Evidence |
| --- | --- | --- |
| Scaffold and doctor (`p:extension:make`, `p:extension:doctor`, `p:extension:install --enable`) | works | CLI |
| Extension migrations run on enable | works | `AuditProbeTest` (table exists) |
| Client API routes, server API routes, admin API routes | work with the right middleware stacks | `AuditProbeTest` (401 for guests, 403/404 for others, admin only) |
| Registered permissions `ext.<id>.<key>` gate server routes and subuser grants | works | `AuditProbeTest` |
| Per user settings, encrypted secret settings | work, isolated per user | `AuditProbeTest`, upstream `ExtensionScopedSettingsTest` |
| Job progress API | works, owner scoped | `AuditProbeTest`, upstream `ExtensionProgressControllerTest` |
| Server operation listeners (`listenToServerOperations`) | work | `AuditProbeTest` |
| Disabling an extension removes its routes | works | `AuditProbeTest` |
| Account, server and admin screens, admin resource tab (`parent: admin.user`), navigation entries | work | headless browser (`/account/audit-probe`, `/server/<id>/audit-probe`, `/panel/audit-probe`, `/panel/users/1/audit-probe-tab`) |
| Slots (`dashboard.serverRow.name.after`, `server.console.after`, `nav.items.after`) | work | headless browser |
| Slot failure isolation | works: a slot that always throws is reported and the dashboard still renders | headless browser, console shows attribution to `audit-probe` |
| Component replacement (`dashboard.serverCard`) | works | headless browser (extension class present on the card) |
| Lazy loading | works: screens ship as separate chunks, entry is about 2.3 kB | build output |
| Theme tokens (`p:theme:apply`) | works: colour roles, radius, fonts, layout widths, assets published to `/assets/theme/` | screenshots dark and light |
| Admin area location | `/panel` (not `/admin`) | router |
| Light/dark selection | upstream forces `<html class="dark">` and has no switcher; Gobia toggles the class from an extension | `gobia-core` Appearance |

Not exercised against a real Wings: websocket events, file mutation and backup/startup hooks beyond what upstream tests cover, console state events. These are verified later with the mock where possible.

Editor note: upstream ships CodeMirror (lazy chunk of 1.1 MB, 400 kB gzip). Monaco is not present.

## Performance baseline (clean upstream, extension disabled, uncompressed, cold cache, local `artisan serve`)

| Route | JS | Files | CSS | API calls | Settled |
| --- | --- | --- | --- | --- | --- |
| `/auth/login` and dashboard `/` | 1072 KB | 76 | 94 KB | 2 | about 2.0 s |
| `/account` | 1085 KB | 70 | 94 KB | 0 | 1.1 s |
| `/server/<id>` (console) | 2007 KB | 83 | 94 KB | 2 | 1.5 s |
| `/server/<id>/files` | 2090 KB | 98 | 94 KB | 3 | 1.7 s |
| `/server/<id>/startup` | 2014 KB | 87 | 94 KB | 3 | 1.8 s |
| `/panel` (admin overview) | 1061 KB | 69 | 94 KB | 1 | 1.3 s |
| `/panel/servers` | 1171 KB | 86 | 94 KB | 1 | 1.2 s |
| `/panel/nodes` | 1175 KB | 90 | 94 KB | 2 | 1.4 s |
| `/panel/eggs` | 1152 KB | 79 | 94 KB | 1 | 1.2 s |

The editor chunk is not loaded on any of these routes (it loads when a file is opened). Times include a development server without OPcache and are only comparable with each other. A tool for
re-measuring is in the maintainer's `devtools` (not committed); Gobia budgets are structural (see `docs/gobia-feature-parity.md` row 34).

## Migration readiness

**Verdict: ready to proceed.** No blocker found for authentication, server control through the client API, files, extensions, permissions, admin or migrations. The extension API covers screens in all three
areas, slots, component replacement, per user and per server settings, permissions, migrations, job progress, routes, themes and file/backup hooks. Known limits that shape the port:

* No upstream light/dark switch (handled by `gobia-core`; a pre paint script would need a one line core patch to the wrapper view, tracked as a possible patch).
* The login page has no logo or split layout slot beyond `auth.login.*` slots; the Gobia login composition may need slots plus tokens, and a core patch only if proven necessary.
* The file editor is CodeMirror. A Monaco workspace stays optional and lazy.
* The extension SDK is `2.0.0-beta.x`; its ABI is semver governed after 2.0, so pin the SDK range per extension.

## Known alpha limitations and risks

* Daily upstream churn and fixes (four CI breaking issues found in one day).
* Upstream `2.0-develop` has no push CI; Gobia CI is the real signal.
* Windows is a second class development platform for this codebase (`ext-posix`, file modes, line endings in generated files).
