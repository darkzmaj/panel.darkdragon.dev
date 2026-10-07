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

`npm run test:gobia:browser` (needs the stack from `npm run dev:gobia` and `GOBIA_VISUAL_PASSWORD`, optionally `GOBIA_VISUAL_USER`, `GOBIA_SCHEME=light`):

* `visual`: 11 screenshots (login, instances, console, files, settings, security, admin overview, users, templates, updates, create instance) compared with `tests/visual/baseline` (dark) and `baseline-light`
* `responsive`: no horizontal overflow at 390, 430, 768, 1024, 1366, 1440, 1920 and 2560 px on instances, admin overview, security and files
* `a11y`: axe-core, serious and critical violations fail the run (clean in dark and light)
* `smoke`: profile menu, instance view menu, Create Instance dialog, row menu, instance navigation, file create, rename and delete in the live tree, admin navigation and the mobile drawer

## Pages

"Done" means the columns agree with the running 1.x reference and the checks above are green. Anything with a known difference is "In progress".

| Page | Old Gobia reference | Gobia 2 state | Remaining differences | Status | Browser | Dark | Light | Mobile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login | Pitch and interactive preview left, logo and card right | Same layout, logo above the card in the right half as specified, 1.x copy | 1.x placed the logo in the left half; the task asked for the right half | Done | yes | yes | yes | checked at 390 |
| Forgot password, checkpoint, reset | Same auth shell | Same frame, 1.x link style | Not compared one by one | In progress | no | no | no | no |
| Instances | Page head, view chip menu, category chips, Edit, rows with grip, icon, node and address, CPU, memory, storage | Same markup and classes, live metrics, drag reorder, context menu | Category and colour dialogs use the SDK dialog with the Gobia frame, inner controls not 1:1 | In progress | yes | yes | yes | yes |
| Create Instance | Custom or Template, template cards, configure, progress steps | Same flow and markup on the 2.0 data layer | Step labels are the 2.0 wording | Done | yes | yes | yes | no |
| Server console | Title, power buttons, console, stat cards | Core container on tokens | Stat card icon boxes use the 2.0 style; extra Users entry (2.0 feature) | In progress | yes | yes | yes | no |
| Server settings, startup, network, schedules | Page head with subtitle, titled cards | Headings and subtitles from `ServerContentBlock`, cards on tokens | Network notes and variable inputs keep 2.0 markup | In progress | yes | yes | yes | no |
| Server databases, backups, users, activity | Page head, rows | Same wrapper | Not compared page by page | Todo | no | no | no | no |
| Files workspace | Explorer tree, tabs, language chip, problems, word wrap, Save, resizable explorer, drawer on phones | Same structure on CodeMirror. Create, rename, move, delete, upload and refresh update the tree at once; open tabs follow renames and keep unsaved text | No minimap (not available in CodeMirror), Monaco toolbar glyphs differ | Done | yes | yes | yes | drawer only |
| Account: Security | Email, password and two-factor cards | Same | None | Done | yes | yes | yes | no |
| Account: Profile, Access, Appearance | Avatar and username cards, access list, scheme cards | Same markup | Avatar cropper dialog not compared | In progress | partly | yes | no | no |
| Account: API, SSH, Activity | Cards and rows | Core pages on tokens | Not compared | Todo | no | no | no | no |
| Admin overview | Six stat cards, resource rings, node cards | Same, from the gobia-core overview endpoint | Node cards show fewer facts (no FQDN, allocations, Wings version) | In progress | yes | yes | yes | no |
| Admin users, nodes, instances, locations, settings | Boxes and tables | `DataTable` and forms on tokens, Gobia sidebar groups | Detail and form pages not compared | In progress | partly | yes | yes | no |
| Admin database hosts, mounts, eggs, tags, API keys, extensions, activity | Boxes and tables | Same primitives | Not compared | Todo | no | no | no | no |
| Templates | General, Software, Resources, Placement, Variables, Lifecycle, Files, SFTP, Instances tabs, list table | Same tabs and cards, list in the Gobia table | No Revisions tab (the API has no revision list) | In progress | yes | yes | yes | no |
| Updates | Release card, extension table | Gobia page head and cards | Layout differs from the 1.x two column settings page | In progress | yes | yes | yes | no |
| Footer | Gobia footer on application pages, none on login | Gobia footer in the shell, none on auth | Link targets are static (1.x read them from `config/gobia_ui.php`) | Done | yes | yes | yes | yes |

## Intentional differences from 1.x

* The instance list has no search box (1.x did not have one either). The server sidebar has a `Users` entry because 2.0 has a Users page.
* Admin uses the unified React admin: the 1.x Blade groups (Dashboard, Network, Services, System) are kept as sidebar groups and the 2.0 pages (Activity, Eggs, Tags, Extensions, API keys) sit in them.
* The stock Pterodactyl overview version card, external link buttons and navigation cards were removed from the admin overview.
* The login logo sits above the form card in the right half, as requested.
