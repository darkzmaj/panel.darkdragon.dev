# Gobia feature parity matrix (1.x to 2.0)

Source of truth for the migration checklist. The 1.x inventory was built from the actual repository
(`gobia-1.x-preserved`, diff against the Pterodactyl 1.x merge base `e98678c5a`: 245 added, 166 modified, 34 deleted files),
not from memory. Status values: `Todo`, `In progress`, `Done`, `Blocked (reason)`, `Dropped (reason)`.

Extensions planned (cohesion based, no micro extensions):

* **gobia-core**: branding, profile and avatar, account structure, access, server organization (filters, categories, order, colours), admin overview, versioning, updates UI.
* **gobia-templates**: templates, revisions, files, SFTP, provisioning, create instance, template API.
* **gobia-files**: multi file editor workspace, file operations, structured validation (only what 2.0 file hooks cannot already do).
* Theme: Gobia design tokens (theme CSS), not an extension screen.

Legend for "Core or Extension": `Ext` extension API only, `Theme` design tokens, `Core?` needs a core patch (must be justified in `docs/gobia-core-patches.md`).

| # | Feature | 1.x implementation | 2.0 destination | Core or Ext | DB migration | Frontend | Backend | Tests | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Gobia design system (blue, navy, thin borders, compact) | `public/themes/gobia/gobia.css`, `admin.css` | theme tokens (`packages/sdk/theme*.css`) | Theme | no | yes | no | visual | Done (theme tokens `themes/gobia`, light and dark, verified in browser) | Dark, light, system |
| 2 | Default logo + favicon (new assets) | `public/themes/gobia/img/*` | extension assets + core favicon slot | Ext / Core? | no | yes | no | visual | Done (default assets in theme; favicon head tag; logo rule) | Check if 2.0 has a branding setting |
| 3 | Admin uploaded logo/favicon, secure PNG processing, cache busting, reset | `BrandingService`, `PngImageProcessor`, `PngImage` rule, `BrandingController`, `BrandingAssetController` | gobia-core (settings + routes) | Ext | settings via extension settings | yes | yes | yes | Done (extension file settings, upstream content checks; `BrandingTest`) | No Gravatar |
| 4 | Avatars, no Gravatar, cropper | `AvatarService`, `AvatarController`, `UpdateAvatarRequest`, `AvatarCropperModal`, migration `replace_gravatar_with_avatar_hash` | gobia-core | Ext | yes (users.avatar_hash) | yes | yes | yes | Done (`ProfileAvatarUsernameTest`, cropper in browser) | Migrate avatar files and hashes |
| 5 | Username change with password confirmation | `UpdateUsernameRequest`, `UpdateUsernameForm` | gobia-core or upstream if 2.0 has it | Ext | no | yes | yes | yes | Done | |
| 6 | Profile menu / user menu / circular images | `UserMenu.tsx` | gobia-core slot | Ext | no | yes | no | yes | Done (nav avatar overlay; menu is core) | |
| 7 | Account navigation: Profile, Security, Access, Activity, API Credentials, SSH Keys, Appearance | `accountRoutes.ts`, `ProfileContainer`, `AppearanceContainer` | 2.0 account screens + extension screens | Ext | no | yes | no | yes | In progress (Profile, Appearance done; Security, Access remain) | |
| 8 | Appearance (theme dark/light/system per user) | migration `add_theme_to_users`, `useTheme`, `AppearanceContainer` | 2.0 native theme if present, else gobia-core per user setting | Ext | maybe | yes | yes | yes | Done | |
| 9 | Centralized access (owner grants permissions across many servers) | `AccountAccessService`, `AccountAccessController`, `StoreAccessRequest`, `UpdateAccessRequest`, `AccessContainer` | gobia-core, reusing 2.0 subuser permission service | Ext | no | yes | yes | yes | Done (`AccessTest`, browser verified) | Do not duplicate authorization |
| 10 | Server filters All / You / Other | `ServerFilterBar`, `ClientController` type filter | gobia-core dashboard slot + query | Ext / Core? | no | yes | yes | yes | Done | Check native 2.0 filter |
| 11 | Personal categories (CRUD, assign, reorder) | `ServerLayoutService`, `ServerLayoutController`, `CategoryEditorModal`, migration `create_user_server_organization_tables` | gobia-core | Ext | yes | yes | yes | yes | Done | Only accessible servers |
| 12 | Server ordering (drag, touch hold, keyboard) | `SortableServerList` | gobia-core dashboard component replacement | Ext | yes (same) | yes | yes | yes | Done (pointer, touch hold, keyboard; browser verified) | Keyboard alternative required |
| 13 | Icon colours, presets, custom, 5 recents | `IconColorModal`, migrations `user_server_icon_colors`, `recent_icon_colors` | gobia-core | Ext | yes | yes | yes | yes | Done | |
| 14 | Server context menu: Open, change icon colour, add to category | `ContextMenu`, `ServerRow` | row action extension capability | Ext | no | yes | no | yes | Done | |
| 15 | Lite server list and layout summary | `ServerListTransformer`, `?lite=1` | re-evaluate against 2.0 list endpoint | Ext? | no | no | maybe | yes | Todo | Port only if still beneficial |
| 16 | Shared live-stats scheduler | `statsHub.ts` | use TanStack Query resources cache (`useServerResources`) | n/a | no | no | no | n/a | Dropped (2.0 provides shared cache) | Verify |
| 17 | Admin architecture (Dashboard, Overview, Settings, Users, Network, Nodes, Instances, Locations, Templates, Services) | Blade admin restyle | 2.0 unified React admin + nav ordering via extension screens | Ext | no | yes | no | yes | Todo | No Blade |
| 18 | Admin Overview statistics, resources (allocated vs live), per node stats, offline node tolerance | `StatsController`, `NodeStatsService`, `BaseController` | gobia-core admin screen + API | Ext | no | yes | yes | yes | Done (`OverviewTest`, browser verified; offline nodes tolerated) | |
| 19 | Templates CRUD + fields (nest/egg, image, startup, variables, limits, placement, ports, lifecycle) | `ServerTemplate*` models, `TemplateService`, `TemplateController`, template editor | gobia-templates | Ext | yes | yes | yes | yes | Done | Egg tags in 2.0 may replace nests |
| 20 | Template placement (fixed node, allowed nodes, compatible, location) | `TemplatePlacementService`, `PlacementException` | gobia-templates | Ext | yes | yes | yes | yes | Done | |
| 21 | Template files (jars, plugins, maps, configs, binaries) | `TemplateFileStore`, working tree | gobia-templates | Ext | yes | yes | yes | yes | Done | Streamed, byte identical |
| 22 | Template name placeholder `%number%` | `TemplateNameService` | gobia-templates | Ext | no | yes | yes | yes | Done | Deterministic next number, extensible |
| 23 | Template revisions (immutable published) | `ServerTemplateRevision` | gobia-templates | Ext | yes | yes | yes | yes | Done | |
| 24 | Template SFTP (jail, expiry, revoke, rw/ro, audit, limits, rate limit) | `services/template-sftp` (Node), `TemplateSftpService`, `TemplateSftpController`, `RequireSftpServiceToken`, `TemplateSftpCredential` | gobia-templates + same external service | Ext | yes | yes | yes | node + php | Done | Service ported (9 node tests), contract verified live; password auth, SSH keys designed |
| 25 | Create Instance flow (Custom / Template) and Template browser | `CreateInstanceModal`, `TemplateBrowserController` | gobia-templates dashboard slot | Ext | no | yes | yes | yes | Done | Dialog in gobia-core, verified live: browse, confirm, provisioning stages, ready |
| 26 | Provisioning stages, idempotency, job progress | `ProvisionTemplateInstanceJob`, `TemplateProvisioningService`, `TemplateInstance` | gobia-templates using `ExtensionJobProgress` | Ext | yes (`stage_ms`) | yes | yes | yes | Done | Adaptive polling, timings |
| 27 | Template application API (auth, 2FA, rate limit, permissions) | `Api/Application/Templates/*` | extension route registration + OpenAPI | Ext | no | no | yes | yes | Done | |
| 28 | File manager (context menu, three dot, rename/move/duplicate/download/copy path/delete) | `fileOps.ts`, `useMoveEntries`, `FileActionsContext` | gobia-files over 2.0 file hooks/mutations | Ext | no | yes | no | yes | Done | |
| 29 | Drag and drop, OS drag upload, folder upload, queue, progress, cancel, retry | `dragDrop.ts`, `uploadQueue.ts`, `UploadPanel` | gobia-files | Ext | no | yes | no | yes | Done | |
| 30 | Multi file editor (tabs, dirty, save, Ctrl/Cmd S, unsaved protection, conflict detection, explorer) | `FileWorkspace`, `FileTree` | gobia-files, `useNavigationBlocker` | Ext | no | yes | no | yes | Done | |
| 31 | Monaco, lazy | `MonacoEditor.tsx` | evaluate 2.0 CodeMirror first; Monaco only if required and lazy | Ext | no | yes | no | bundle budget | Done (CodeMirror, lazy; Monaco not justified) | Never on dashboard |
| 32 | Structured validation (JSON, YAML, TOML, XML) | `validation.ts` | gobia-files | Ext | no | yes | no | yes | Done | Only deterministic errors block save |
| 33 | Mobile files (drawer, tabs, bottom sheets) | `FileWorkspace` mobile CSS | gobia-files | Ext | no | yes | no | responsive | Done | |
| 34 | Server timing telemetry, query log, perf budgets | `ServerTiming`, `PerfTimings`, `check-bundle-budget.js` | gobia-core dev tooling + CI structural budgets | Ext | no | no | yes | yes | Todo | |
| 35 | Wings HTTP client reuse | `DaemonRepository` | re-evaluate against 2.0 | Core? | no | no | maybe | yes | Todo | Port only if still useful |
| 36 | Updater (1.x implementation) | `app/Services/Updater/*`, `UpdateController`, `docs/updates.md` | **Not ported**: Gobia Updates frontend + contract only; privileged updater is Majcek's | Ext | no | yes | contract | yes | Done (frontend and read only compatibility API; privileged updater is Majcek's) | See `MAJCEK_HANDOFF.md` |
| 37 | Gobia footer / branding footer | `FooterService`, `GobiaFooter` | gobia-core slot | Ext | no | yes | yes | yes | Todo | |
| 38 | Login page (split layout, interactive preview, logo in left half, mobile logo above form) | `LoginFormContainer`, `AuthPreview` | 2.0 auth screen restyle via tokens/slots | Theme / Ext / Core? | no | yes | no | yes | Todo | Auth screens may need a core patch |
| 39 | Notification bell, toasts, shell | `NotificationBell`, `Toaster`, `AppShell` | use 2.0 `sonner` and shell | n/a | no | no | no | n/a | Dropped (2.0 provides) | Verify |
| 40 | Existing 1.x database upgrade | custom migrations (8 files listed above) | migration tooling + fixture test | n/a | yes | no | yes | yes | Done (docs/gobia-upgrade-from-1x.md, tested on a real 1.x DB copy) | Preserve avatars, usernames, branding, categories, order, colours, access, templates |
| 41 | Gobia version metadata + compatibility API | none | gobia-core | Ext | no | yes | yes | yes | Done (frontend and read only compatibility API; privileged updater is Majcek's) | Feeds updater preflight |
| 42 | Gobia Updates frontend | none | gobia-core admin screen | Ext | no | yes | contract | yes | Done (frontend and read only compatibility API; privileged updater is Majcek's) | Update button gate rule |

Last updated at migration start. Update statuses as work lands; do not mark `Done` without tests.
