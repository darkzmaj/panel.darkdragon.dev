# Gobia visual parity (1.x design on Pterodactyl 2.0)

The approved Gobia 1.x interface is the design contract. Reference: tag `gobia-1.15-final`, run locally from a git worktree
(`../panel.gobia.cloud-1x`, `http://one.localhost:8001`, database `panel1`) and compared side by side with this branch in a real browser.
No screenshots were attached to the task, so the running 1.x application was the visual source of truth.

## Architecture

| Layer | Where | What it does |
| --- | --- | --- |
| Design tokens | `themes/gobia/tokens.css` (published by `php artisan p:theme:apply gobia`) | Colour roles, radius, fonts, layout widths for the 2.0 token system (`:root` light, `.dark` dark) |
| Component classes | `resources/gobia/gobia.css` | The 1.x `gb-*` classes (shell, cards, buttons, lists, filter bar, tree, tabs, gauges, auth). Token driven: neutral and brand ramps (`--n-*`, `--p-*`) are defined once for light and `.dark`. Kept outside `resources/scripts` because the upstream CSS token spec only allows `var()` colours there |
| Shell | `resources/scripts/gobia/shell/*` | Top bar, sidebar, drawer, footer, profile menu. Each area (dashboard, server, admin) fills the sidebar through `<SidebarContent>` |
| Primitives restyled | `Button`, `Label`, form controls, `Select`, `Checkbox`, `Dialog`, `DropdownMenu`, `ContentBox`, `TitledGreyBox`, `PageHeading`, `ServerContentBlock`, `DataTable`, `AppToaster`, `Alert`, `Empty` | One change restyles every page that uses them |
| Extensions | `gobia-core` (dashboard, create instance, overview, appearance, access, updates, profile), `gobia-files` (workspace), `gobia-templates` (list and editor) | Use the `gb-*` classes from core and the SDK components |
| Branding hand off | `resources/scripts/gobia/branding.ts` (`data-gobia-logo`, `data-gobia-avatar` on `<html>` plus a `gobia:branding` event) | gobia-core publishes the uploaded logo and avatar, the shell renders them. Default is the Gobia wordmark; clearing the setting restores it |
| Scheme hand off | `resources/scripts/gobia/scheme.ts` (`gobia:scheme-request` event) and an inline script in `templates/wrapper.blade.php` | The profile menu asks for System, Dark or Light; gobia-core saves it and applies the `dark` class. The inline script applies the stored scheme before first paint |

## Verification that exists in the repository

`npm run test:gobia:browser` (needs the stack from `npm run dev:gobia` and `GOBIA_VISUAL_PASSWORD`, optionally `GOBIA_VISUAL_USER`, `GOBIA_SCHEME=light`; set `APP_API_CLIENT_RATELIMIT=4096` in the local `.env`, the default 256 requests a minute is exceeded by a full run and the console then shows "Too Many Attempts"):

* `visual`: 15 screenshots (login, instances, console, files, Monaco editor, settings, security, access, appearance, admin overview, users, nodes, templates, updates, create instance) compared with `tests/visual/baseline` (dark) and `baseline-light`
* `responsive`: no horizontal overflow at 390, 430, 768, 1024, 1366, 1440, 1920 and 2560 px on ten pages (instances, console, files, security, access, appearance, admin overview, nodes, templates, updates)
* `a11y`: axe-core on twelve pages, serious and critical violations fail the run (clean in dark and light)
* `smoke`: profile menu, instance view menu, Create Instance dialog, row menu, instance navigation, file create, rename and delete in the live tree, admin navigation and the mobile drawer
* `flows` (`scripts/gobia/flows.mjs`, `GOBIA_FLOWS=dashboard|files` runs half): every view lists the count it shows, search composes with the view, category create, rename, delete and reload, icon colour, context menu Escape; the file workspace creates inline, saves with Ctrl+S, refuses an existing name, flags broken JSON, moves by drag keeping the tab and its unsaved text, refuses a folder dropped into itself, searches and replaces with a preview, renames inline, detects an outside change (Compare, Cancel), forwards the core editor address, deletes
* Backend: `tests/Integration/Gobia/ServerFilterMatrixTest.php` (view by category by search with counts and rows), `ServerOrganizationTest`, `Templates/AdminTemplateApiTest` (revision list)

## Pages

"Done" means the columns agree with the running 1.x reference and the checks above are green. Anything with a known difference is "In progress".

| Page | Old Gobia reference | Gobia 2 state | Remaining differences | Status | Browser | Dark | Light | Mobile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login | Pitch and interactive preview left, logo and card right | Same layout, logo above the card in the right half as specified, 1.x copy | 1.x placed the logo in the left half; the task asked for the right half | Done | yes | yes | yes | checked at 390 |
| Forgot password, checkpoint, reset | Same auth shell | Same frame, 1.x link style | Not compared one by one | In progress | no | no | no | no |
| Instances | Page head, view chip menu, category chips, Edit, rows with grip, icon, node and address, CPU, memory, storage | Same markup and classes, live metrics, 1.x sortable list (lift, placeholder, hold to select on touch), context menu, search by name, description, node and address, category editor and icon colour dialog ported from 1.x | The view menu shows true counts (1.x did not) | Done | yes | yes | yes | yes |
| Create Instance | Custom or Template, template cards, configure, progress steps | Same flow and markup on the 2.0 data layer | Step labels are the 2.0 wording | Done | yes | yes | yes | no |
| Server console | Title, power buttons, console, stat cards | Core container on tokens | Stat card icon boxes use the 2.0 style; extra Users entry (2.0 feature) | In progress | yes | yes | yes | no |
| Server settings, startup, network, schedules | Page head with subtitle, titled cards | Headings and subtitles from `ServerContentBlock`, cards on tokens | Network notes and variable inputs keep 2.0 markup | In progress | yes | yes | yes | no |
| Server databases, backups, users, activity | Page head, rows | Same wrapper | Not compared page by page | Todo | no | no | no | no |
| Files workspace | Explorer tree, tabs, language chip, problems, word wrap, Save, resizable explorer, drawer on phones | Monaco (lazy, one editor, one model per tab, no minimap), inline create and rename, optimistic move and delete with rollback, workspace search and replace with preview, outside change detection with Compare, tab reorder, Problems list from the structured validators | The 1.x editor was Monaco too; Gobia 2 keeps its toolbar | Done | yes | yes | yes | drawer only |
| Account: Security | Email, password and two-factor cards | Same | None | Done | yes | yes | yes | no |
| Account: Profile, Access, Appearance | Avatar and username cards, access list, scheme cards | Same markup; the avatar cropper is direct manipulation (drag, wheel, slider, arrow keys) with a live circular preview | 1.x showed a square crop window next to the circle; 2.x crops inside the circle | Done | yes | yes | yes | no |
| Account: API, SSH, Activity | Cards and rows | Core pages on tokens | Not compared | Todo | no | no | no | no |
| Admin overview | Six stat cards, resource rings, node cards | Eight equal height stat cards in an adaptive grid (4, 2, 1 columns), compact resource meters, node cards with status, location, instances, allocations, memory, storage, live CPU and memory, FQDN and Wings version | Meters are bars, not rings (the task asked for compact) | Done | yes | yes | yes | no |
| Admin users, nodes, instances, locations, settings | Boxes and tables | `DataTable` and forms on tokens, Gobia sidebar groups | Detail and form pages not compared | In progress | partly | yes | yes | no |
| Admin database hosts, mounts, eggs, tags, API keys, extensions, activity | Boxes and tables | Same primitives | Not compared | Todo | no | no | no | no |
| Templates | General, Software, Resources, Placement, Variables, Lifecycle, Files, SFTP, Instances, Revisions tabs, list table | Same tabs and cards, list in the Gobia table; Revisions lists number, date, author, changes from the previous revision, current marker and the servers pinned to each revision (`GET /templates/{id}/revisions`) | None known | Done | yes | yes | yes | no |
| Updates | Release card, extension table | Gobia page head and cards, compatibility from the Gobia release gate; no privileged updater in the browser (owned by Majcek) | Layout differs from the 1.x two column settings page | Done (frontend) | yes | yes | yes | no |
| Footer | Gobia footer on application pages, none on login | Gobia footer in the shell, none on auth | Link targets are static (1.x read them from `config/gobia_ui.php`) | Done | yes | yes | yes | yes |

## Motion and loading

* Timings (tokens `--gb-dur-*` in `resources/gobia/gobia.css`): hover 100 ms, button press 90 ms, menu 120 ms, dialog 150 ms, drawer 160 ms, page content 130 ms, tab 100 ms. Ease out only, no bounce. Reduced motion switches every animation off.
* A route change is instant. The shell (sidebar, top bar, footer) never re-renders for it; only `.gb-main-inner` plays a 130 ms fade and 4 px rise. Router pending time is 0, the pending component is `PageSkeleton` (heading, subtitle and card geometry of a typical page), so a page never shows a spinner and nothing shifts when the content arrives. `scrollbar-gutter: stable` keeps the layout width constant.
* The route animation uses `backwards` fill. A finished animation with `both` keeps a computed identity `transform` on the content wrapper, which turns it into the containing block of every `position: fixed` descendant and moves context menus away from the pointer. The browser flows caught this.
* Lists use row skeletons of the final row height (instances, templates, revisions, users).

## Files workspace

* One Monaco editor instance, created when the first file opens and reused for every tab; a model per open file (`gobia:///path`) keeps text, undo history, selection and scroll. A closed tab disposes its model; a renamed or moved tab gets a model under the new path with its unsaved text.
* Monaco loads only inside the workspace: `gobia-files/dist/chunk.monaco` (about 2.7 MB, 685 KB gzip) plus the editor worker (254 KB, 79 KB gzip) and 101 KB of CSS, fetched 600 ms after the explorer is up. The dashboard, admin and server overview load none of it (verified in the browser: 0 Monaco requests on the dashboard). The panel's own entry stays 765 KiB JS / 236 KiB gzip.
* Features: syntax highlighting (Monaco basic languages plus small JSON and TOML grammars), line numbers, find (Ctrl or Cmd F), replace (Ctrl H, Cmd Option F), undo and redo, word wrap, multi cursor, bracket matching, folding, Ctrl or Cmd S. No minimap.
* Structured validation (JSON, YAML, TOML, XML) runs in the existing validators and is drawn as a Monaco marker; the Problems list shows file, line, column and message and a click focuses the location. Save is blocked only by these deterministic errors, with a "Save anyway" choice.
* Tree: create and rename are inline rows (Enter confirms, Escape cancels, duplicate names and `/` refused); move and delete update the local listings at once and roll back with a toast when the server refuses; uploads and folder uploads insert each entry as it lands and re-read only the folders they touched. A drag shows a compact chip, lights valid target folders and refuses the entry itself, its parent, its own descendants, names that already exist in the target and `..` paths.
* Workspace search crawls the server's files from the browser (the Panel API has no search): four directory walkers and six readers, skipping `node_modules`, `.git`, files above 2 MB, binary mime types and files with NUL bytes; open tabs are searched from their unsaved text. Replace shows the replacement inline for every match, asks for confirmation for "Replace all", writes through the same file API, refuses files that changed after the search or would stop being valid JSON, YAML, TOML or XML, and applies to open tabs without saving them.
* Outside changes: the active tab is checked every 10 seconds and on window focus. A clean tab reloads silently; a tab with edits asks: Compare (Monaco diff), Reload, Overwrite, Cancel (not asked again for that remote version). Wings reports modification times with one second resolution, so two writes inside one second are not told apart.
* The core editor address (`/server/{id}/files/edit#/path`) is replaced by a redirect into the workspace; there is one file editor in the product. CodeMirror remains only for the upstream admin egg editors (core code, not part of the file workspace) and costs nothing outside those pages.
* Timings are recorded in `window.__gobiaFiles` (milliseconds since navigation start): `workspace-mounted`, `explorer-visible`, `monaco-requested`, `monaco-chunk-loaded`, `file-clicked`, `monaco-ready`, `file-visible`, `first-key`.

Measured on the development stack (single threaded PHP server, Edge headless, mock Wings): dashboard to server shell 110 ms, Files click to explorer rows 900 ms (two API calls), first file click to visible text 1.33 s with the chunk already fetched and 2.7 s when it is not.

## Intentional differences from 1.x

* The instance list has a search box and counts in the view menu (requested; 1.x had neither). The server sidebar has a `Users` entry because 2.0 has a Users page.
* Admin uses the unified React admin: the 1.x Blade groups (Dashboard, Network, Services, System) are kept as sidebar groups and the 2.0 pages (Activity, Eggs, Tags, Extensions, API keys) sit in them.
* The stock Pterodactyl overview version card, external link buttons and navigation cards were removed from the admin overview.
* The login logo sits above the form card in the right half, as requested.
