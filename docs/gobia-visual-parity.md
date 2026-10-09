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

`npm run test:gobia:browser` (needs the stack from `npm run dev:gobia` and `GOBIA_VISUAL_PASSWORD`, optionally `GOBIA_VISUAL_USER`, `GOBIA_SCHEME=light`). A full run exceeds the production default of 256 client API requests a minute, so `npm run dev:gobia` starts its own Panel with `APP_API_CLIENT_RATELIMIT=4096` (override with `GOBIA_API_RATELIMIT`); production defaults are never changed, and a Panel started another way needs the same variable or the console shows "Too Many Attempts":

* `visual`: 15 screenshots (login, instances, console, files, Monaco editor, settings, security, access, appearance, admin overview, users, nodes, templates, updates, create instance) compared with `tests/visual/baseline` (dark) and `baseline-light`
* `responsive`: no horizontal overflow at 390, 430, 768, 1024, 1366, 1440, 1920 and 2560 px on ten pages (instances, console, files, security, access, appearance, admin overview, nodes, templates, updates)
* `a11y`: axe-core on twelve pages, serious and critical violations fail the run (clean in dark and light)
* `smoke`: profile menu, instance view menu, Create Instance dialog, row menu, instance navigation, file create, rename and delete in the live tree, admin navigation and the mobile drawer
* `flows` (`scripts/gobia/flows.mjs`, `GOBIA_FLOWS=dashboard|files|mobile|bundle|keyboard` runs one group): every view lists the count it shows, search composes with the view, category create, rename, delete and reload, icon colour, desktop and touch reorder (swipe scrolls, hold lifts, long hold opens actions), context menu opens at the pointer and closes on Escape; the file workspace creates inline, saves with Ctrl+S, refuses an existing name, flags broken JSON, moves by drag keeping the tab and its unsaved text, refuses a folder dropped into itself or its child, keeps tabs and the explorer in step through nested rename, move and delete, rolls back when the node refuses, searches and replaces with a preview, detects an outside change (Compare, Cancel), forwards the core editor address; `bundle` asserts that only the file workspace requests editor code; `keyboard` covers the dialog Tab trap and focus return, menu arrow keys, F2 and Delete in the tree, Monaco Find and Replace shortcuts and reduced motion
* Backend: `tests/Integration/Gobia/ServerFilterMatrixTest.php` (view by category by search with counts and rows), `ServerOrganizationTest`, `Templates/AdminTemplateApiTest` (revision list)

## Pages

Every major page is "Complete", "Intentionally changed" (with the reason) or "Blocked by an external limitation". The 1.x pages were compared in a running 1.x
instance (tag `gobia-1.15-final`, port 8001) side by side with this branch; pages that 1.x never had (extensions, eggs, tags, API keys in admin, server users)
are reviewed against the approved information architecture and the Gobia design tokens. Evidence: the browser suite (screenshots in both themes, overflow at eight
widths, axe, interaction flows) listed above.

| Page | Old Gobia reference | Gobia 2 state | Status | Evidence |
| --- | --- | --- | --- | --- |
| Login | Pitch and interactive preview left, logo and card right | Same layout; the logo sits above the card in the right half as requested (1.x had it in the left half) | Intentionally changed (logo position requested) | screenshots, responsive, axe |
| Forgot password, reset, checkpoint | Same auth shell | Same frame as login, same copy; "Return to Login" link is the muted link colour (1.x used white text) | Complete | compared in both apps, responsive login at 8 widths |
| Instances | Page head, view chip menu, category chips, Edit, rows with grip, icon, node and address, CPU, memory, storage | Same markup and classes, live metrics, 1.x sortable list (lift, placeholder, hold to select on touch), context menu, search by name, description, node and address, category editor and icon colour dialog | Intentionally changed (search box and true view counts were requested; 1.x had neither) | flows (filters, categories, colour, desktop and touch reorder), Pest filter matrix |
| Create Instance | Custom or Template, template cards, configure, progress steps | Same flow and markup on the 2.0 data layer | Complete (step labels use the 2.0 wording) | screenshot, smoke |
| Server console, power, stats | Title, power buttons, console, stat cards | Core console on tokens, Gobia header | Complete | screenshots, responsive, axe |
| Server files | Explorer tree, tabs, language chip, problems, word wrap, Save, resizable explorer, drawer on phones | Monaco workspace (see "Files workspace") | Complete | flows, screenshots, responsive |
| Server databases, schedules, backups, users, network, startup, settings, activity | Page head with subtitle, cards, rows | Headings and subtitles from `ServerContentBlock`, cards, tables and dialogs on tokens; headings compared one by one against 1.x | Intentionally changed (Users page exists only in 2.0; network and variable inputs keep 2.0 markup) | responsive and axe on databases, backups, startup, settings, console |
| Account: Profile, Security, Access, Appearance | Heading, avatar and username cards, access list, scheme cards | Same markup; direct manipulation avatar cropper with live circular preview | Complete | screenshots, axe, responsive |
| Account: Activity, API credentials, SSH keys | Heading with one line of context, a form card and a list card | Same headings and copy (compared in both apps); tables use container based columns so the fingerprint and the delete action fit the narrow card; created keys are shown once in the key dialog | Complete | screenshots (API, SSH), responsive, axe, create and delete exercised against the running panel |
| Admin overview | Six stat cards, resource rings, node cards | Eight equal height stat cards (4, 2, 1 columns), compact meters, node cards with status, location, instances, allocations, memory, storage, live CPU and memory, FQDN and Wings version | Intentionally changed (meters instead of rings, requested) | screenshot, responsive, axe |
| Admin: Activity, Users, Locations, Nodes, Instances, Database Hosts, Mounts, Eggs, Tags, API Keys, Extensions | Boxes and tables (1.x had Nodes, Instances, Locations, Users) | Gobia page head, search, compact tables with Gobia hover, selected and empty states, badges for status; list and detail pages crawled and reviewed in both themes | Complete | screenshots (users, nodes, instances, settings, extensions), responsive and axe on all of them |
| Admin detail and create pages (user, location, node tabs, instance tabs, egg, mount, database host, create forms) | Boxes with grouped fields | The upstream forms are already split into titled cards (Account details, Authentication, Core details, Allocation management, Feature limits and so on) in one to three columns; Gobia card, input, select and button styling; the section headings use the Gobia eyebrow style | Complete | crawl of every admin route in the final pass, axe on detail pages |
| Admin settings, Updates | Two column settings page, release card | Tabs General, Mail, Advanced; Updates shows version, base, extension compatibility, migration and health state, and gates the Update button on the compatibility contract | Complete (frontend; the privileged updater is Majcek's) | screenshots, axe |
| Templates (list and editor) | General, Software, Resources, Placement, Variables, Lifecycle, Files, SFTP, Instances, Revisions tabs | Same tabs and cards; Revisions shows number, date, author, changes, current marker and pinned servers | Complete | screenshot, Pest revision test, axe |
| Footer | Gobia footer on application pages, none on login | Gobia footer in the shell, none on auth; link targets are static | Complete | screenshots |
| Error and empty states | Muted card with icon and one line | Same empty component on every table and list; error boundary and 404 on tokens | Complete | seen on every list in the crawl |

Remaining stock Pterodactyl markup: the egg editors in admin (CodeMirror text areas and the egg script editor) are upstream components restyled by tokens; they are the only
place the old editor stack remains. A hidden stock `h1` with the server name exists in the server layout for assistive technology; it is not visible.

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

### Files performance (measured, development stack: one threaded PHP server, Edge headless, mock Wings, localhost)

| Step | Before the closure pass | After |
| --- | --- | --- |
| Click Files (single page navigation) to explorer rows | 900 ms | 350 ms |
| Root listing requests | 2 (the Panel's and the explorer's) | 1 (the explorer takes the Panel's listing) |
| First file click to text in the DOM, editor chunk already fetched | about 1000 ms (an in page measurement was not taken; 1.3 s by script polling) | 340 ms, of which about 310 ms is the file request |
| Same click, measured by Playwright polling (not comparable with the line above) | 1331 ms | 835 ms (the polling itself adds about 500 ms) |
| First file click right after a direct load of the Files page | 2.7 s | 270 to 290 ms from click when the editor chunk has arrived (it starts 50 ms after the explorer paints and takes about 150 ms on localhost), plus the chunk time if the click is faster |
| Switch between two open tabs, to the painted frame | not measured | 7 to 8 ms, no request |
| Editor requests on dashboard, admin pages, account, console, server settings | 0 | 0 (browser flow `bundle`) |

Where the time went and what changed: the second root listing and its wait (removed by seeding the explorer from the Panel's listing), a 300 ms hold back that React applies when it reveals a
suspended boundary, even for a module that is already loaded (removed: the editor module is kept in state and the editor never suspends), the 600 ms delay before the chunk prefetch
(now 50 ms after the explorer is on screen), the extra version lookup per opened file (the version now comes from the listing), and two tiny shared chunks that were separate requests
(inlined into the workspace chunk by removing the sharing). Monaco is also warmed once (a detached editor creates the shared services) so the first real editor creates in about 7 ms.
The dev server is single threaded and serves the static chunks and the API from one process, so numbers on a real web server are lower, not higher.

### Bundle sizes (production build; JavaScript requested by a cold page load, raw bytes because the dev server does not compress)

| Page | JS files | Raw KiB |
| --- | --- | --- |
| Panel entry (initial, gzip 236 KiB) | 50 | 765 |
| Dashboard | 113 | 1244 |
| Admin overview | 105 | 1193 |
| Admin nodes | 126 | 1224 |
| Server console (terminal included) | 118 | 2134 |
| Files, explorer plus the editor prefetch | 134 | 4966 |

Extension bundles (gobia-core 84 KiB, gobia-templates 37 KiB, gobia-files without the editor about 190 KiB) are part of those numbers. The editor chunk is 2.7 MB (685 KB gzip) plus its worker (254 KB) and
CSS (101 KB) and only the file workspace requests it. The previous pass recorded the same entry size, so nothing in this pass grew the shared bundle.

### Version identity of a file

A file's version is its modification time together with its size (`time|size`, from the same listing entry). A real Wings reports modification times with nanosecond precision, so two writes are
told apart unless they land in the same tick with the same length; the mock node used by the browser flows rounds to seconds, which is why the outside change flow waits two seconds between
writes. Wings offers no content hash or ETag in its file listing today, so a hash based check would need to read the file; the workspace reads it only for Compare. Saves check the version
immediately before writing; open tabs are checked every ten seconds and on window focus.

### Replacement safety

"Replace all" asks first (files and counts), writes open tabs without saving them, refuses files that changed after the search or would stop being valid JSON, YAML, TOML or XML, reports which
files were left unchanged when it stops half way, and offers "Undo the last replacement" for the files it changed (restoring only files nobody touched since).

## Intentional differences from 1.x

* The instance list has a search box and counts in the view menu (requested; 1.x had neither). The server sidebar has no `Users` entry: sharing lives in Account, Access.
* Admin information architecture (final): **Dashboard** (Overview, Users), **Network** (Nodes & Instances, Locations, Templates), **Services** (Eggs & Mounts, Database Hosts), **System** (Settings, Updates). Related pages are tabs of one workspace (`components/admin/AdminTabs.tsx`, driven by `adminTabGroups`): Nodes | Instances (`/panel/nodes`, `/panel/servers`), Eggs | Mounts (`/panel/eggs`, `/panel/mounts`), and Settings with General, Mail, Advanced, API Keys (administrator Application keys, `/panel/api`), Extensions (`/panel/extensions`) and Tags (`/panel/tags`). Each tab is the page's own address, so old links, refresh and Back/Forward keep working and a tab switch is a normal route change served from the query caches. Activity has no sidebar entry: the overview ends with Recent Activity (real admin log, loaded on its own, "View all" opens `/panel/activity`). There is no separate Branding section because no admin branding setting exists in this build.
* Footer: Product, Company and Legal columns only. Copyright sits on the left with the real Cryvex brand image centred under it (50% opacity, 100% on hover or focus, 150 ms, links to cryvex.org); the Discord button (https://gobia.cloud/discord) and the appearance button are on the right, same colour. On a phone everything stacks to the left without overflow.
* File explorer: selection is application state (a set of paths, an anchor and a primary). Click selects, Ctrl/Cmd+Click toggles, Shift+Click selects a range, arrows move it, an empty area clears it, drag moves the whole selection and keeps it at the destination. Hover, selected, active file, focus and dragging are separate styles. File and folder icons are Material Icon Theme artwork (`FileTypeIcon.tsx`, `docs/gobia-file-icons.md`), the earlier coloured abbreviation badges were removed.
* Dual servers: the Files page has an optional second server. Two explorers stack in the explorer column (each with a searchable server picker and its online state), two Monaco editors stack or sit side by side (Stacked | Side by side in the page head, Single to leave), a draggable splitter sits between them. On a phone Server 1 and Server 2 are a switch. Dragging between the explorers copies; Move is in the context menu. See `CLAUDE.md` (Files workspace).
* Status dots: power, CPU, memory, storage, in the instance list rows and stacked in the sidebar instance card, live over websockets. The instance card is a button that opens the searchable instance switcher. The list header and every row share one grid so columns line up.
* The stock Pterodactyl overview version card, external link buttons and navigation cards were removed from the admin overview.
* The login logo sits above the form card in the right half, as requested.

## Server pages: Settings tabs, Ports, explorer hierarchy (final corrections)

* Settings has two tabs, General and Startup, built with `TabLinks` (the admin tab style), each a route: `/server/<id>/settings`, `/server/<id>/settings/startup`. The heading is Settings on both; the sidebar highlights Settings on both. The old `/startup` address moves to the Startup tab. Network is named Ports (`/server/<id>/ports`; `/network` moves there). The browser matrix has `server-startup` (new address) and `server-ports`.
* Files explorer: 16 px per level, guide lines under the root and under every open folder, folders in a heavier weight than files, root items share one indent (checked by the `explorer: hierarchy` flow), drops between servers say "Move here" or "Copy here" on the row under the pointer.
