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

### Files

File content is stored under `storage/app/private/templates/<uuid>/blobs/<sha256>`, outside the web root and not
tracked by Git. Blobs are addressed by checksum, so a revision's files never change after they are written. The path a
user types is only metadata and is never used to build a path on the Panel's disk.

Path rules (`TemplateFileStore::normalizePath`): relative only; no `.` / `..` / empty segments; no backslashes, drive
letters, control characters or NUL; no percent-encoded characters at all (this also rejects double encoding); no
reserved names (`.pterodactyl`, `.wings`, `.env`, `.htaccess`, `.htpasswd`); max 255 characters; a path cannot be both a
file and a folder. Content must be UTF-8 text without NUL, max 1 MiB per file, 200 files and 20 MiB per template. When a
blob is read, its checksum is re-verified and symlinks are refused.

The admin **Files** tab reuses the file workspace's Monaco editor and its pre-save validation: invalid JSON / YAML /
TOML / XML cannot be saved (see `docs/performance-phase2-hardening.md` for the editor chunking).

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
Lifecycle, Instances (create + live progress + retry), Revisions (history, duplicate, enable/disable, delete).
Validation reuses the Panel's rules: the egg must belong to the nest, the image must be one of the egg's images,
variable values must satisfy the egg variable's own rules. A template with instance history cannot be deleted
(disable it instead); duplicates start disabled.

## Known limitations

* Wings reports installation completion to the Panel; the pipeline polls the database for it. If Wings never calls
  back, the instance fails after 15 minutes.
* `database_limit`, `allocation_limit` and `backup_limit` of `0` mean *none*, matching the existing server form.
* Old template blobs are kept (revisions need them); there is no garbage collection of blobs for deleted revisions yet.
* No bulk operations, scheduled instance creation or per-user quotas.
* Health verification means "Wings still knows the server"; it does not wait for the game process to accept connections.
