# Server Templates

A **template** is an administrator-defined blueprint for creating servers. It is different from an *egg*: an egg
describes software (install script, variables, images); a template combines an egg with resources, placement rules,
variables, files and lifecycle settings, so "create a lobby server" is one request instead of a dozen form fields.

Templates live in the admin area under **Network → Templates**. Only administrators can create, edit, duplicate,
disable or delete them.

Not included on purpose: autoscaling, matchmaking, proxy plugins or pool controllers. This is the foundation they
could be built on.

## Data model

Migration: `database/migrations/2026_10_07_000000_create_server_templates_tables.php`.

| Table | Purpose |
| --- | --- |
| `server_templates` | identity (name, slug, description, enabled), software (nest, egg, image, startup override), resources, feature limits, placement, lifecycle, current `revision` |
| `server_template_nodes` | allowed nodes for `allowed_nodes` placement |
| `server_template_variables` | egg variable values, and whether an instance request may override each |
| `server_template_files` | metadata (path, size, SHA-256) for files deployed into new servers |
| `server_template_revisions` | immutable JSON snapshot of the template at each revision |
| `server_template_instances` | one row per "create a server from this template" request; tracks the provisioning state |
| `servers.template_id`, `servers.template_revision` | which template (and which revision of it) created a server |
| `api_keys.r_templates`, `r_template_instance_create`, `r_template_instance_delete` | Application API permissions |

### Revisions

Saving a template, or adding/changing/removing one of its files, writes a new revision **only if the effective content
changed**. A server records the revision it was created from and is never modified when the template changes. An
instance request stores the revision that was current when it was accepted and is built from that snapshot, even if the
template is edited before the job runs (or the instance is retried later).

### Files, working tree and publishing

A template has two file sets:

* **Working files** (`<storage>/<uuid>/work/`): a normal directory tree that admins edit in the browser or over SFTP.
  Editing never changes what servers receive.
* **Published revisions**: immutable snapshots. **Publish** copies the working tree into content-addressed blobs
  (`<storage>/<uuid>/blobs/<sha256>`), records a manifest (`server_template_files`) and creates a new revision *only if
  the content differs from the current revision*. Deleting or renaming in the working tree is reflected by the next
  publish. Instances always deploy from a published revision, so a server that already exists is never changed.

The Panel marks the working tree as changed (`working_changed_at`) when an admin edits it or when an SFTP session that
could write ends; the Files tab shows "N added / changed / removed" computed by comparing the tree with the published
manifest, and enables **Publish changes**. File content is never stored in the database and everything lives outside
the web root.

Any payload is allowed: jars, plugins, maps/worlds, resource packs, scripts, configuration. Binary files are stored
as-is and streamed to Wings (never loaded into memory). Defaults (`config/gobia_templates.php`, overridable by env):
1 GiB per file, 8 GiB and 10,000 files per template. Only files up to 2 MiB open in the browser editor (Monaco, with the
same pre-save validation as the server file manager); larger files can be uploaded and downloaded.

Path rules (`TemplateFileStore::normalizePath`): relative only; no `.` / `..` / empty segments; no backslashes, drive
letters, control characters or NUL; no percent-encoded characters; no reserved names (`.pterodactyl`, `.wings`, `.env`,
`.htaccess`, `.htpasswd`); at most 255 characters; a path cannot be both a file and a folder. Blob checksums are
re-verified on read and symlinks are refused.

## Template SFTP

A separate Node service (`services/template-sftp`, library `ssh2`) lets tools such as FileZilla or CI upload to a
template's **working files**. It never touches the database or the Panel's disk outside the template's directory.

Setup:

```bash
cd services/template-sftp && npm ci --omit=dev
# Panel .env:   GOBIA_SFTP_SERVICE_TOKEN=<32+ random characters>   GOBIA_SFTP_HOST=sftp.example.com   GOBIA_SFTP_PORT=2223
# Service env:  PANEL_URL=https://panel.example.com SFTP_SERVICE_TOKEN=<same token> TEMPLATE_STORAGE=<same path as the Panel>
#               SFTP_PORT=2223 SFTP_BIND=0.0.0.0 SFTP_HOST_KEY=/etc/gobia/sftp_host_key   (generated on first start if missing)
node server.js        # run it under systemd or another supervisor
```

Admin side (template -> **SFTP** tab): create a credential with a label, **read/write** or **read only** access and an
expiry (max 90 days). The password is generated, shown **once** and stored only as a hash. The list shows created,
expires, last used (time and IP) and status; credentials can be revoked at any time. Recent logins, failures, rate limit
hits and sessions are listed from the event log.

How a login works: the service sends username, password and client IP to `/api/internal/template-sftp/authenticate`
(bearer service token, at least 32 characters; the route is closed when no token is configured). The Panel checks the
hash, expiry and revocation, rate limits failures per username (10) and per IP, and answers with the template folder,
permission and limits. Everything after that is enforced by the service itself:

* the session is jailed to `<storage>/<uuid>/work`; every path is resolved and checked against the jail, symlinks are
  never followed or created, and cross-template access is impossible because the root is chosen from the credential;
* read-only credentials cannot write, rename or delete; size, file count and total size limits apply to uploads;
* the Panel is told when a session ends (`/api/internal/template-sftp/session`) so the working tree is marked changed.

SFTP only changes working files. Run **Publish changes** to create a revision; instances created before that keep the
previous revision.

## `%number%` in instance names

A template (or a Create Instance request) may use `%number%` in the name, e.g. `SloBlock Hub %number%`. It becomes the
highest number already used by a real server or an unfinished instance matching the same pattern, plus one, starting at
1. Gaps are not reused (1, 2, 4 gives 5); database ids are never used. Only whole-name matches count, other text in the
pattern is matched literally, and a repeated placeholder gets the same number. An idempotent retry does not consume a new
number. The Create Instance screen proposes the name and lets the user edit it. Other placeholders (`%node%`,
`%location%`, `%date%`) can be added to `TemplateNameService::expand()`.

## Placement

`TemplatePlacementService` picks the node and allocations. It is deterministic and documented here so results can be
explained.

1. **Candidates.** `fixed_node`: that node only. `allowed_nodes`: the chosen nodes. `any`: every node with *Public*
   enabled (the existing automatic-deployment flag). An optional location narrows `allowed_nodes` and `any`.
2. **Hard requirements** (a node failing one is dropped, and the reason is reported per node):
   - not in maintenance mode;
   - online (the same Wings probe the admin overview uses, cached for 45 seconds);
   - memory: `used + requested <= memory * (1 + overallocation%)` (an overallocation of `-1` disables the check, as elsewhere in the Panel);
   - disk: same rule;
   - at least `1 + additional allocations` free allocations;
   - the template's `max_instances` has not been reached (active and ready instances count; failed ones and ready ones whose server was deleted do not).
3. **Score** of each remaining node, measured *after* placing the instance:
   `0.5 × free memory share + 0.3 × free disk share + 0.2 × free allocation share`.
4. **Winner:** highest score; ties go to the lowest node id.
5. **Allocations:** free allocations on the node. Preferred ports (`25565,25570-25580`) are used first, in the order
   written; the rest are the lowest free ports.

Placement and server creation run under one cache lock (`template-placement`), so two instances cannot be handed the same
allocation.

## Provisioning pipeline

`ProvisionTemplateInstanceJob` (queue `standard`) drives `TemplateProvisioningService::advance()`, one durable step
at a time, re-queueing itself with a delay while waiting.

| State | What happens |
| --- | --- |
| `queued` | request accepted; the stored revision is checked |
| `allocating` | the template must still be enabled; node and allocations are chosen |
| `creating` | the server is created through the existing `ServerCreationService` (never raw inserts); Wings is asked to create it, without auto-start |
| `installing` | waits for Wings to report the installation (poll every 5 s, 15 minute timeout) |
| `deploying_files` | creates folders and writes the template's files through Wings; a health check confirms Wings still knows the server |
| `starting` | only if *Start automatically* is on: sends the start power action |
| `ready` | done; `expires_at` is set for temporary templates |
| `failed` | `failed_stage` and a sanitized `error` are recorded |

Everything used to create the server comes from the revision snapshot. A request can only supply the server **name**,
**owner**, an optional **description** and environment values for variables the template marks *overridable*.

**Failure handling.** Any exception marks the instance `failed` at the stage it reached. A half-created server is
force-deleted (this releases its allocations) and the instance stops pointing at it, so there are no orphan servers or
allocations. Messages shown to users are limited to Panel-authored text; anything unexpected becomes a generic message
and the details go to the Panel log. **Retry** (admin button or API) puts a failed instance back in the queue and counts
the attempt.

**Temporary instances.** `p:maintenance:expire-template-instances` (scheduled every five minutes) deletes the servers of
ready instances whose `expires_at` has passed.

## Application API

All routes need an **Application API key** (`Admin → Settings → Application API`). Panel sessions and account (client)
keys of an administrator are *not* accepted here, so creating servers from templates is always a deliberate grant.

| Permission | Key column | Allows |
| --- | --- | --- |
| `template.read` | `r_templates` = Read | `GET /templates`, `GET /templates/{id}`, `GET …/instances/{instance}` |
| `template.instance.create` | `r_template_instance_create` = Read & Write | `POST /templates/{id}/instances`, `POST …/instances/{instance}/retry` |
| `template.instance.delete` | `r_template_instance_delete` = Read & Write | `DELETE …/instances/{instance}` |

```
POST /api/application/templates/{template}/instances
Idempotency-Key: order-1234            (optional)
{ "name": "Lobby 1", "owner_id": 1, "description": "…", "environment": { "SERVER_JARFILE": "x.jar" } }
→ 202 Accepted, Location: …/instances/{instance}
{ "object": "template_instance", "attributes": { "id": "<uuid>", "state": "queued", … } }

GET /api/application/templates/{template}/instances/{instance}     → poll `state` until `finished` is true
```

* **Strict input.** Any other field (memory, startup, image, node, files, paths …) is rejected with a 422 instead of
  being ignored. There is no way to supply a startup command, image, path or shell through this API.
* **Idempotency.** The same `Idempotency-Key` on the same template with the same body returns the original instance
  (HTTP 200, no second job). The same key with a different body is `409`. Keys are scoped per template, 1-80 characters
  of `A-Z a-z 0-9 _ - : .`; a race between two identical requests is resolved by a unique database index.
* **Delete** works on finished instances only, and only if the template allows it (*Allow the API to delete instances*).
  Expiry of temporary templates ignores that switch because it is the template's own rule.
* Template responses never include files, the startup command or variable values.

## Admin interface

*Network → Templates*: list, and a tabbed editor — General, Software, Resources, Placement, Variables, Files,
Lifecycle, SFTP, Instances (create + live progress + retry), Revisions (history, duplicate, enable/disable, delete).
Validation reuses the Panel's rules: the egg must belong to the nest, the image must be one of the egg's images,
variable values must satisfy the egg variable's own rules. A template with instance history cannot be deleted
(disable it instead); duplicates start disabled.

## Known limitations

* Wings reports installation completion to the Panel; the pipeline polls the database for it. If Wings never calls
  back, the instance fails after 15 minutes.
* `database_limit`, `allocation_limit` and `backup_limit` of `0` mean *none*, matching the existing server form.
* SFTP uses password authentication only (no keys yet) and one service instance per storage directory.
* Old template blobs are kept (revisions need them); there is no garbage collection of blobs for deleted revisions yet.
* No bulk operations, scheduled instance creation or per-user quotas.
* Health verification means "Wings still knows the server"; it does not wait for the game process to accept connections.
