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

* The file workspace is Monaco (`extensions/gobia-files`): one editor, one model per tab, no minimap, workspace search and replace, outside change detection with Compare, structured
  validation as markers. CodeMirror is not the Gobia editor; it stays only in upstream admin egg editors. Gobia pages follow `docs/gobia-visual-parity.md`: every new page gets the
  Gobia page head (`PageHeading`: title and one line of context), titled cards, tokens only, skeletons instead of spinners, and is added to the browser matrix.

* Gobia design is the visual source of truth, expressed through Pterodactyl 2.0 design tokens (`packages/sdk/theme*.css`,
  Tailwind 4). Dark, light and system.
* Do not reintroduce Blade, AdminLTE, Bootstrap, webpack or 1.x CSS hacks.

## Performance policy

* Measure before optimizing; never claim "faster" from one feel. Record numbers in docs.
* Do not ship Monaco or other large dependencies globally. Use Vite chunking and lazy loading. Monaco lives only in the
  `gobia-files` extension, loads as a lazy chunk when the file workspace opens (never on the dashboard, admin or server
  overview) and has no minimap. Upstream CodeMirror remains for the admin egg editors only.
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

* **Linux is authoritative.** Pterodactyl assumes Linux. The Gobia CI workflow (`.github/workflows/gobia-ci.yaml`: Frontend on PHP 8.4 and 8.3, Static Analysis, Tests on PHP 8.3 and
  8.4 against MariaDB 11 and MySQL 8) is the verdict; a Windows pass is a convenience. When the GitHub organisation cannot run CI, push the branch to a private mirror and run the
  same workflow there. Never call work finished on a Windows result alone.
* **Gobia browser suite** (needs `npm run dev:gobia`): `GOBIA_VISUAL_USER=... GOBIA_VISUAL_PASSWORD=... node scripts/gobia/visual.mjs [visual|responsive|smoke|flows|a11y]`,
  `GOBIA_FLOWS=dashboard|files|mobile|bundle`, `GOBIA_SCHEME=light`, `--update` to store baselines. Details in `docs/gobia-visual-parity.md`.
* **Gobia extension unit tests**: `npm run sdk:testing` once, then `npx vitest run --config extensions/<name>/vitest.config.ts` from the repository root.
* **Gobia Pest tests**: `vendor/bin/pest tests/Integration/Gobia` (tests must not depend on rows other tests leave behind; use unique names).

## Update compatibility policy (critical)

**Never blindly apply upstream Pterodactyl updates to production Gobia installations.** Production installs only ever
install approved, signed Gobia releases, never `pterodactyl/panel` directly:

upstream release -> Gobia integration branch -> Gobia CI -> compatibility verification -> Gobia release -> production updater.

Every update must pass the compatibility gate documented in `MAJCEK_HANDOFF.md` (preflight, then the safe lifecycle there). A mandatory preflight failure keeps the Update button unavailable. The Update button is enabled only when a
compatible approved Gobia release exists AND the local preflight reports the installation ready.

## Access policy

* **Account, Access** (`gobia-core`) is the single place to share instances with other people. The per server Users page was removed; its addresses redirect to Account, Access with the server selected. Subuser models, APIs and permission enforcement are unchanged and still back it.
* Client access (subusers, shared per instance, managed in Account, Access) is not the same as administrator accounts (Admin, Users). Never merge the two.
* Delegation: the owner manages access; a subuser holding `user.create`, `user.read`, `user.update` and `user.delete` on a server may too, but only hands out permissions they hold and cannot change anyone who holds more than them. Presets (View Only, Manage Server, Full Access) are lists of real permission ids in `extensions/gobia-core/src/client/access/permissions.ts`; ids are never renamed.

## Admin navigation

The admin sidebar is fixed: Dashboard (Overview, Users), Network (Nodes & Instances, Locations, Templates), Services (Eggs & Mounts, Database Hosts), System (Settings, Updates). Activity is part of Overview; Tags, Extensions and administrator API keys are Settings tabs; Mounts is an Eggs tab and Instances a Nodes tab. Tabs are real routes (`AdminTabs.tsx`); do not add standalone sidebar entries for them or remove their addresses. See `docs/gobia-visual-parity.md`.

## Files workspace (gobia-files)

Exact behaviour, so a session never has to rely on chat history:

* **Monaco is the Gobia editor.** One Monaco runtime, lazy loaded with the workspace (the dashboard makes zero Monaco requests), **no minimap**. `CodeEditor.tsx` creates one editor instance per pane.
* **Panes.** `usePane.tsx` is one server's explorer, tabs, editor and dialogs as a hook. `Workspace.tsx` is the layout: single mode (one pane) or **dual mode** (Server 1 and Server 2). Dual mode shows **two stacked explorers in the one explorer column** and **two Monaco editors**, stacked or side by side (the explorers stay stacked in both). Dual mode is remembered in `localStorage` (`gobia-files:dual`); the second pane is a component rendered only while dual mode is on, so single mode keeps a single editor. Mobile shows one server at a time with a Server 1 / Server 2 switch; nothing is unmounted, so dirty text survives.
* **Server selection.** Server 1 is the server of the page: its picker (and the instance card of the main sidebar, `gobia/shell/ServerSwitcher.tsx`) navigate to the same page of another server (Files stays Files; where the page is not allowed the first allowed page opens). Server 2 has its own picker and never changes Server 1. Unsaved tabs are kept per server and pane in `sessionStorage` (`session.ts`) and come back when the server is selected again.
* **Model identity.** A Monaco model is `gobia://<server uuid>/<path>?<pane>`: server UUID, canonical path and pane. Two servers with `plugins/config.yml` are two documents; the same server in both panes is two documents too. Undo history, cursor, scroll, markers, dirty and saving state are per model/tab.
* **Dirty state lives in the model**, not in React state: the editor reports only flips of edited/clean (`onDirtyChange`) and a debounced text snapshot (`onSnapshot`, 150 ms); typing never re-renders the workspace. A model is clean again when its alternative version id equals the saved one (undo back to the saved text is clean).
* **Keyboard.** Ctrl/Cmd+S saves the active file, Ctrl/Cmd+Shift+S saves every open file of every pane, Find/Replace/Undo/Redo are Monaco's. Monaco commands are registered with `editorId == '<id>'` (`addCommand` is global otherwise: the last editor created answered Ctrl+S for all of them). A capture listener on `window` in `Workspace.tsx` calls `preventDefault()` synchronously for Ctrl/Cmd+S everywhere else on the page (explorer, tab strip) and saves the pane that holds focus (`data-pane`) or was touched last.
* **Save pipeline** (`usePane.tsx`, `saveOnce`): acknowledge at once (`saving`), validate, wait for a pending version read, check the remote version only when it was not confirmed in the last 8 s, write, then mark exactly the written text as saved (`markSaved(token)`: edits made during the write stay unsaved). "Saved" shows only after the Panel confirmed the write. The new version is read in the background and patches the explorer row; no full tree reload. One save runs per file; a save asked for meanwhile runs again afterwards. States: Modified, Saving, Saved, Save failed, Conflict. A pane that moved to another server never receives the old file's result.
* **Explorer selection** is application state (`picked`: paths, primary, anchor), independent per pane. Click, Ctrl/Cmd+Click, Shift+Click, arrows, empty area clears. Mutations (`useTree.hold()`) drop listings that were requested before or during an unconfirmed move, create or delete, so a refresh can no longer undo the optimistic change or prune the selection (this was the folder-move race).
* **Transfers between the two servers.** Dragging between explorers **copies** (default); **Move** only from the context menu ("Move … to <server>"). Backend: `POST /api/client/extensions/gobia-files/transfers` (`TransferService`): the Panel reads from one Wings and writes to the other (the browser never sees bytes or Wings credentials), checks `file.read`, `file.read-content` on the source and `file.create` (`file.update` to replace, `file.delete` on the source to move) on the destination, writes each file to a hidden temporary name, verifies size and SHA-256 (files up to 16 MiB; larger by size), renames into place, and deletes a move's source only after everything inside verified. Conflicts: replace, keep both, skip, cancel. One request per chosen item, so progress is real. Limits in `config/gobia_files.php` (64 MiB per file, 2000 entries, depth 24). Files with unsaved edits are not moved or replaced.
* **Icons.** Material Icon Theme (MIT) artwork, generated by `scripts/gobia/generate-file-icons.mjs` into `fileIcons.generated.ts` (data URIs inside the lazy workspace chunk). See `docs/gobia-file-icons.md`. The earlier coloured abbreviation badges are gone and must not come back.
* **Tests.** `GOBIA_FLOWS=dual|explorer|files|keyboard|status` browser flows, `tests/Integration/Gobia/FileTransferTest.php`, `extensions/gobia-files` Vitest.

## Instance status dots

Power, CPU, memory and storage dots (`StatusDots`) appear in every row of the instance list and, stacked vertically, in the instance card of the server sidebar. While the instance runs **every dot flashes** in the colour of its level: power is green, each resource green below 75 % of its limit, yellow from 75 %, red from 95 % or over (unlimited is always green). Starting, stopping and installing flash yellow, an unknown state flashes grey, and an instance that is **off or unavailable shows four steady red dots** (the only static dots). Each dot has its own speed (520 ms to 2.6 s) and phase, derived from the instance uuid and the dot (`flashTiming`), so it flashes identically in the list and in the instance card, the four dots of one instance never share a speed, and nothing flashes in step. Only `opacity` animates (compositor, no repaint), the animation stops for `prefers-reduced-motion`, and a hidden tab does no work (`levels.ts` / `gobia/statusLevels.ts`). They follow Wings over websockets (`dashboard/liveStats.ts` for the list, the existing server socket in the server area); polled numbers only fill the gap. The credentials route allows five requests a minute per instance, so tokens are cached for ten minutes in the list.

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

Windows note: keep `php`, `composer` and the MariaDB `bin` directory on PATH (`scripts/gobia/dev.mjs` also reads `GOBIA_PHP_DIR`, `GOBIA_MARIADB_DIR` and `GOBIA_MARIADB_DATA`). Keep the 1.x dev stack
(Panel :8000) untouched; run 2.0 on another port.

## Repository layout notes

* This working tree is a git worktree of the 1.x checkout at `../panel.gobia.cloud` (do not edit that checkout from here).
* Extensions live under `packages/` while developing (upstream example: `packages/hello-world`).
