# Pterodactyl 2.0 audit (clean upstream, before any Gobia change)

Status: IN PROGRESS. This document records only what was actually run. Items not run are listed under "Not yet audited".

## Upstream

* Repository: https://github.com/pterodactyl/panel, branch `2.0-develop`
* Audited SHA: `0d8cd97d00852aa7b251ea39d05a6df168874db1` (2026-10-06 12:30 +0100, "bump seroval dependency to 1.6.8")
* Upstream moves daily: by the end of the audit session `upstream/2.0-develop` was already at `240aaf62e` (6 newer commits, including
  reset password and username enumeration hardening and a recaptcha secret fix). Gobia must merge upstream regularly; see `MAJCEK_HANDOFF.md`.

## Environment used

Windows 11, PHP 8.3.35 (NTS, no `ext-posix`, no `pdo_sqlite`), Composer 2.10.3, Node 22.19.0, npm 10.9.3, MariaDB 11.8.9.
Upstream CI uses Linux, PHP 8.3 and 8.4, MariaDB 10/11 and MySQL 8/9. Failures below that are caused by this environment are labelled as such;
none has been reproduced on Linux, so none is claimed as an upstream bug.

## Installation

* `composer install` requires `ext-posix`, which does not exist on Windows PHP. Installed with `--ignore-platform-req=ext-posix`.
* `npm ci` succeeded (npm reports audit advisories, not triaged).
* `cp .env.example .env`, `php artisan key:generate`, `php artisan migrate --force` against a fresh MariaDB database: **all migrations ran cleanly**.
  Note: Laravel loads `database/schema/mysql-schema.sql` through the `mysql` client, which must be on `PATH`.

## Official checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run tsc` | pass |
| Lint and format (frontend) | `npm run lint` | pass |
| Frontend tests | `npm test` | 742 passed, 34 failed (2 files, see below) |
| Production build | `npm run build` (includes extension runtime check) | pass, `Built extension runtime: exports, React hooks, UI and shared QueryClient verified.` |
| PHPStan | `phpstan analyse -c phpstan-rules.neon` | pass, no errors |
| Rector | `rector --dry-run` | pass |
| Pint | `pint --test` (app, bootstrap, config, database, routes, tests) | **fail on 2 files** (see below) |
| Backend unit | `pest --bootstrap vendor/autoload.php tests/Unit` | 568 passed, 10 failed |
| Backend integration (with `.env.ci`) | `pest tests/Integration` | 1219 passed, 25 failed |
| OpenAPI verify, type coverage, SDK check | not yet run | |

### Failure analysis

* Integration, first runs with a developer `.env` (file cache) produced 44 and then 231 failures. Cause: rate limiter state and different keys/salts. With the CI environment (`.env.ci`: array cache,
  array sessions, fixed key and salt) the number dropped to 25. **Always run tests with `.env.ci` values.**
* Remaining 25 integration failures: 12 `BackendWriteConsistencyTest` and 3 `SubuserGrantUniquenessMigrationTest` ("could not find driver" for in-memory SQLite: this PHP has no `pdo_sqlite`),
  9 `UpgradeCommandTest` (`expected file mode 448 (0700), got 511`: Windows has no POSIX modes), 1 `SchedulerTest` (unexplained, not yet investigated). Environment, not upstream.
* Unit: 4 `RunHooksCommandTest` (executable bit semantics on Windows), 5 `ExtensionStylesheetInspectorTest` and 1 `ExtensionToolingTest` (not yet root caused; suspected path separators on Windows).
* Vitest: 32 in `tools/oxlint/rules/lint.spec.ts` and 2 in `packages/sdk/openapi.spec.ts`. The OpenAPI one is `Call to undefined function mb_trim()` from
  `scripts/generate-extension-openapi.php:76` running under PHP 8.3: `mb_trim` is native only from PHP 8.4, `composer.json` allows `^8.3`, and that script only loads the Composer autoloader (which carries the polyfill) when
  YAML is involved. Upstream's frontend CI job uses PHP 8.4, so it does not notice. **Candidate upstream issue, not yet confirmed on a clean Linux PHP 8.3 and not yet reported.** The oxlint spec failures are
  not yet root caused (likely Windows).
* Pint: `InstallExtensionRequest.php` (phpdoc_tag_type, unary_operator_spaces, not_operator_with_successor_space) and `ExtensionPackageLocator.php` (no_whitespace_in_blank_line). Files are LF. Unchanged
  upstream through `240aaf62e`. Candidate trivial upstream style fix, not yet confirmed on Linux; not worth a PR unless CI shows it.

## Bundle sizes (clean upstream production build)

Total `public/assets` after build: ~5.1 MB on disk (including sourcemap or lazy chunks). Largest chunks (raw): `CodemirrorEditor` 1,146.73 kB (gzip 399.59 kB, lazy),
`ServerConsoleContainer` 658.53 kB (gzip 194.94 kB), `iconCatalog` 494.06 kB (gzip 129.02 kB), `es6` 295.80 kB, `initReactI18next` 212.56 kB, `client` 207.53 kB, `routeTree` 123.63 kB, `form` 72.55 kB.
A complete per-route transfer baseline (dashboard, server, admin, files) has not been measured yet.

## Extension system (read, not yet exercised)

Read from the repository: manifest schema `packages/sdk/manifest.schema.json` (`requires.panel|sdk|php|extensions`, `ui.screens` for `account|server|admin` areas with admin `parent` tabs, `ui.components`
replacement ids, `routes.root`, `ui.prefix`), PHP base class `app/Extensions/ExtensionProvider.php` (client/admin routes, migrations, views, translations, typed settings, permissions `ext.<id>.<key>`, schedules, console
commands, head tags, operation listeners, action wrappers), SDK query helpers (`serverFilesQueryOptions`, `serverFileContentQueryOptions`, `invalidateServerData`, `useNavigationBlocker`, etc.), example `packages/hello-world`.
Whether each capability listed in the migration brief works is **not yet verified by running audit extensions**.

## Bugs found / fixed / PRs

None confirmed on clean upstream. No upstream PR has been created. Two candidates (mb_trim under PHP 8.3 script, pint style) need Linux reproduction first.

## Known alpha limitations and migration risks

* Daily upstream churn; extension SDK is `2.0.0-beta.x` (semver governed ABI after 2.0).
* The editor is CodeMirror (lazy), not Monaco. Gobia 1.x Monaco workspace needs re-evaluation.
* Gobia 1.x frontend (React 16, easy-peasy, webpack) cannot be reused; every UI feature is a rewrite on the SDK.
* `composer.json` requires `ext-posix`: Windows development is second class; use Linux (WSL or Docker) for authoritative test runs.

## Not yet audited

OpenAPI verification, type coverage, extension slots/screens/replacements/settings/migrations/permissions via audit extensions, manual UI pass (auth, 2FA, console, files, backups, databases, network, schedules,
users, nodes, locations, mounts, database hosts, API keys, mobile, dark/light), performance baseline (route chunk transfer, API latency, query counts), migration readiness verdict.
