# CLAUDE.md: Gobia Panel on Pterodactyl 2.0

Persistent instructions for every Claude session working in this repository. Read fully before acting.
Status of this file: written at the start of the 2.0 migration. Sections marked (TO CONFIRM) describe intent and must be
corrected to the real architecture before the migration is declared finished.

## Project identity

Gobia Panel is a customized infrastructure and game server control platform built on Pterodactyl.
Current technical base: **Pterodactyl 2.0** (alpha/beta, moving target).

| Item | Value |
| --- | --- |
| Official upstream | https://github.com/pterodactyl/panel |
| Upstream branch | `2.0-develop` (until a stable 2.0 branch replaces it) |
| Gobia origin | https://github.com/Cryvex-Dev/panel.gobia.cloud |
| Official extensions repo | https://github.com/pterodactyl/extensions |
| Gobia Cloud reference (visual/product only) | https://github.com/Cryvex-Dev/gobia.cloud |
| Gobia 1.x functional reference | branch `gobia-1.x-preserved`, tag `gobia-1.15-final` (Pterodactyl 1.15.1 fork) |

Git remotes: **`origin` = Gobia. `upstream` = official Pterodactyl.** Never push to `upstream`. Never confuse them.
The migration branch is `gobia-2` (tracks `upstream/2.0-develop` as its base; push to `origin gobia-2`).
Upstream base SHA at migration start: `0d8cd97d00852aa7b251ea39d05a6df168874db1` (2026-10-06).

## Branch policy

* Never work directly on production `main`. Never merge into `main` and never release unless explicitly instructed.
* Gobia 1.x is preserved and must stay intact (`gobia-1.x-preserved`, `gobia-1.15-final`, `develop`, `main`).
* Use dedicated branches (`gobia-2` and topic branches off it).
* Upstream contributions go on branches off a clean `upstream/2.0-develop` in a fork, never mixed with Gobia features.

## Architecture policy

* Prefer the **Pterodactyl Extensions API** (manifest `extension.json`, SDK `@pterodactyl/sdk`, PHP `ExtensionProvider`)
  over core modification.
* Modify core only when the extension API cannot correctly support the requirement. Every core change is recorded in
  `docs/gobia-core-patches.md` (file, purpose, why extensions cannot do it, conflict risk, tests, removal path).
* Do not port legacy 1.x architecture because it existed. The 1.x repo is a functional and visual reference only;
  never copy its tree over this one.
* Not many micro extensions: group by cohesion (Core, Personalization, Templates, Files, Infrastructure).

## Design policy

* Gobia design is the visual source of truth, expressed through Pterodactyl 2.0 design tokens (`packages/sdk/theme*.css`,
  Tailwind 4). Dark, light and system.
* Do not reintroduce Blade, AdminLTE, Bootstrap, webpack or 1.x CSS hacks.

## Performance policy

* Measure before optimizing; never claim "faster" from one feel. Record numbers in docs.
* Do not ship Monaco or other large dependencies globally. Use Vite chunking and lazy loading. (Upstream 2.0 ships
  CodeMirror; Monaco only if it demonstrably justifies itself and is lazy loaded, never on the dashboard.)
* TanStack Query for server data (use the SDK's shared query options and `invalidateServerData`). No duplicate caches.
* Zustand 5 only for suitable local UI state.
* Structural budgets (bundle size, no editor on dashboard, query count ceilings), not flaky wall clock CI thresholds.

## Security policy

* Never weaken Pterodactyl authorization. Never bypass permission checks. Never expose API secrets or extension secrets.
* Extension permissions are `ext.<id>.<key>`; check with `$user->can('ext.<id>.<key>', $server)`.
* File paths and uploaded files are untrusted (traversal, symlinks, extraction, MIME, size).
* No secrets, `.env`, tokens, private keys or template SFTP credentials in git.

## Testing policy

Run the official upstream checks plus Gobia tests before calling any work finished. Report failures honestly.

## Update compatibility policy (critical)

**Never blindly apply upstream Pterodactyl updates to production Gobia installations.** Production installs only ever
install approved, signed Gobia releases, never `pterodactyl/panel` directly:

upstream release -> Gobia integration branch -> Gobia CI -> compatibility verification -> Gobia release -> production updater.

Every update must pass the compatibility gate documented in `MAJCEK_HANDOFF.md`. The Update button is enabled only when a
compatible approved Gobia release exists AND the local preflight reports the installation ready.

## Extension policy

Gobia extensions declare compatibility with specific Pterodactyl API and SDK versions using the real manifest field
(`requires.sdk`, e.g. `">=2.0.0-beta.4 <3.0"`) plus Gobia metadata layered on top only where upstream has no field.
Do not invent a parallel package system.

## Coding policy

Follow the 2.0 stack and conventions: React 19, TanStack Router/Query/Form/Table, Tailwind 4, TypeScript 6, Vite 8,
Vitest 4, Laravel 13 (PHP ^8.3), Pest, Pint, Rector, PHPStan, oxlint/oxfmt, generated OpenAPI client (`@hey-api/openapi-ts`).
Match surrounding code. No dash characters in prose for upstream PR titles/descriptions/commit messages/issue comments
(code syntax excepted).

## Documentation policy

Keep `docs/` updated when major systems change: `docs/pterodactyl-2-audit.md`, `docs/gobia-feature-parity.md`,
`docs/gobia-core-patches.md`, `docs/gobia-updates-frontend-contract.md`, `MAJCEK_HANDOFF.md`.

## Updater ownership

Claude may build the Gobia Updates frontend and the compatibility API contract. **Majcek owns the final privileged
updater implementation.** Never implement privileged installation, shell execution, or file replacement from the frontend
or from unprivileged PHP.

## Future Wings policy

Do not modify Wings in this migration unless explicitly requested.

## Commands (verified against upstream `package.json`, `composer.json`, `.github/workflows/ci.yaml`)

Requirements: PHP ^8.3 (ext intl, mbstring, pdo_mysql, posix, zip, bcmath, gd), Composer 2, Node >= 22, MariaDB/MySQL.

| Task | Command |
| --- | --- |
| Install PHP deps | `composer install` |
| Install JS deps | `npm ci` |
| Env | `cp .env.example .env` (tests: `cp .env.ci .env`); `php artisan key:generate`; `php artisan migrate` |
| Backend dev server | `php artisan serve` |
| Frontend dev server | `npm run dev` (Vite) |
| Type check (frontend) | `npm run tsc` |
| Lint (frontend) | `npm run lint` (oxfmt --check + oxlint) |
| Frontend tests | `npm test` (vitest run; pretest builds sdk testing) |
| SDK/API check | `npm run api:check` (sdk:check + tsc + lint) |
| Regenerate OpenAPI client | `npm run api:generate` (spec via `composer docs:openapi:verify`) |
| Regenerate SDK types | `npm run sdk:generate` |
| Production build | `npm run build:production` (runs `check-extension-runtime`); CI uses `npm run build:vite` |
| Backend tests | `composer test:unit`, `composer test:integration` (Pest) |
| All backend checks | `composer test` (type coverage, unit, integration, lint, types) |
| Formatting (PHP) | `composer lint` (rector + pint); check only: `composer test:lint` |
| PHPStan | `composer test:types` (`phpstan analyse -c phpstan-rules.neon`) |
| OpenAPI contract | `composer docs:openapi:verify` |
| Extension validation | `npm run build:vite` builds `packages/hello-world`; `node scripts/check-extension-runtime.mjs`; `packages/sdk` specs via `npm test` |

Windows note: use `php`/`composer` from `C:\Users\majko\devtools` (`php`, `mariadb-*\bin` on PATH). Keep the 1.x dev stack
(Panel :8000) untouched; run 2.0 on another port.

## Repository layout notes

* This working tree is a git worktree of the 1.x checkout at `../panel.gobia.cloud` (do not edit that checkout from here).
* Extensions live under `packages/` while developing (upstream example: `packages/hello-world`).
