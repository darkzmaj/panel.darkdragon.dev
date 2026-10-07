# Gobia visual parity (1.x design on Pterodactyl 2.0)

The approved Gobia 1.x interface is the design contract. Reference: tag `gobia-1.15-final`, run locally from a git worktree
(`../panel.gobia.cloud-1x`, port 8001, database `panel1`) and compared side by side with this branch in a real browser.
No screenshots were attached to the task, so the running 1.x application was the visual source of truth.

## Architecture

| Layer | Where | What it does |
| --- | --- | --- |
| Design tokens | `themes/gobia/tokens.css` (published by `php artisan p:theme:apply gobia`) | Colour roles, radius, fonts, layout widths for the 2.0 token system (`:root` light, `.dark` dark) |
| Component classes | `resources/scripts/gobia/gobia.css` | The 1.x `gb-*` classes (shell, cards, buttons, lists, filter bar, tree, tabs, gauges, auth). Token driven: neutral and brand ramps (`--n-*`, `--p-*`) are defined once for light and `.dark` |
| Shell | `resources/scripts/gobia/shell/*` | Top bar, sidebar, drawer, footer, profile menu. Each area (dashboard, server, admin) fills the sidebar through `<SidebarContent>` |
| Primitives restyled | `Button`, `Label`, form controls, `Select`, `Checkbox`, `Dialog`, `DropdownMenu`, `ContentBox`, `TitledGreyBox`, `PageHeading`, `ServerContentBlock`, `DataTable`, `AppToaster`, `Alert`, `Empty` | One change restyles every page that uses them |
| Extensions | `extensions/gobia-core` (dashboard, create instance, overview, appearance, access, updates, profile), `gobia-files` (workspace), `gobia-templates` | Use the `gb-*` classes from core and the SDK components |
| Branding hand off | `resources/scripts/gobia/branding.ts` (`data-gobia-logo`, `data-gobia-avatar` on `<html>` plus a `gobia:branding` event) | gobia-core publishes the uploaded logo and avatar, the shell renders them. Default is the Gobia wordmark; clearing the setting restores it |
| Scheme hand off | `resources/scripts/gobia/scheme.ts` (`gobia:scheme-request` event) | The profile menu asks for System, Dark or Light; gobia-core saves it to the profile and applies the `dark` class |

## Pages

Legend: Browser = verified in a real browser against the running 1.x reference. Dark/Light/Mobile = checked at that setting.
"Close" is not a status: a row is Done only when the differences column is empty.

| Page | Old Gobia reference | Gobia 2 state | Remaining differences | Strategy | Status | Browser | Dark | Light | Mobile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login | Two column, pitch plus interactive preview left, logo and card right | Same layout, logo above the card in the right half as specified | Copy of 1.x ("Login", "Sign in to your Gobia account.", field label "Email") not yet applied | Core `LoginFormContainer` | In progress | yes | yes | no | no |
| Forgot password, checkpoint, reset | Same auth shell | Same auth shell through `LoginFormContainer` | Titles not compared | Same container | In progress | no | no | no | no |
| Instances (dashboard) | Page head, All chip menu, category chips, Edit chip, grip, row with icon, node and address, CPU, memory, storage | Same markup and classes, live metrics, drag reorder, context menu | Context menu items and category dialogs still use SDK styling | gobia-core `dashboard.page` replacement | In progress | yes | yes | yes | yes |
| Create Instance | Modal: Custom or Template, template cards, configure, progress steps | Same flow and markup on the 2.0 data layer | Progress step labels differ slightly | gobia-core dialog | In progress | yes | yes | no | no |
| Server console | Title, power buttons, console, stat cards | Core console container, tokens | Stat card icon boxes and the Users entry (2.0 only) | Tokens plus primitives | In progress | yes | yes | no | no |
| Server settings, startup, network | Page head with subtitle, titled cards | Same headings through `ServerContentBlock`, cards via tokens | Notes textarea and variable inputs use 2.0 markup | Primitives | In progress | yes | yes | no | no |
| Server databases, schedules, backups, users, activity | Page head, rows | Headings added, rows on tokens | Not compared page by page | Primitives | Todo | no | no | no | no |
| Files workspace | Explorer tree, tabs, language chip, problems, word wrap, Save, resizable explorer | Same structure on CodeMirror, live tree (create, rename, move, delete, upload update at once, open tabs follow renames) | Minimap not available in CodeMirror, Monaco toolbar glyphs differ | gobia-files `server.files.manager` replacement | In progress | yes | yes | no | no |
| Account (security, API, SSH, activity) | Local menu left, cards right | Local menu and cards | Page cards not compared one by one | Core `AccountLayout` | In progress | yes | yes | no | no |
| Profile, Access, Appearance | Avatar cropper, access editor, scheme cards | Extension screens | Not restyled to `gb-*` yet | gobia-core screens | Todo | no | no | no | no |
| Admin overview | Six stat cards, resource rings, node cards | Same, from the gobia-core overview endpoint | Node card shows fewer facts (no FQDN, allocations, Wings version) | Core `OverviewContainer` plus gobia-core panel | In progress | yes | yes | no | no |
| Admin users, nodes, instances, locations, database hosts, mounts, eggs, tags, API keys, settings, activity | Boxes with tables | `DataTable` and forms on tokens | Page cards and forms compared only for users, nodes, instances and settings | `DataTable`, primitives | In progress | partly | yes | no | no |
| Templates (admin) | Tabs General to Revisions | gobia-templates screens | Not restyled | gobia-templates | Todo | no | no | no | no |
| Updates | Release card, extension table | gobia-core screen | Not restyled | gobia-core screen | Todo | no | no | no | no |
| Footer | Gobia footer on application pages, none on login | Gobia footer in the shell, none on auth | Link targets are static (1.x read them from `config/gobia_ui.php`) | `GobiaFooter` | Done | yes | yes | no | yes |

## Intentional differences from 1.x

* The instance list has no search box (1.x did not have one either), and the `Users` entry in the server sidebar exists because 2.0 has a Users page.
* Admin uses the unified React admin: the 1.x Blade groups (Dashboard, Network, Services, System) are kept as sidebar groups.
* The stock Pterodactyl overview version card, external link buttons and navigation cards were removed from the admin overview.
