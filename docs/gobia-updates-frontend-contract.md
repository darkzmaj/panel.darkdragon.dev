# Gobia Updates frontend contract

The Gobia Updates screen (admin area, part of the `gobia-core` extension) talks only to the endpoints below. Majcek implements the
privileged backend. The frontend never executes shell commands and never decides compatibility itself; it renders what the backend
reports. Prefix: `/api/application/extensions/gobia-core/updates` (final path to be confirmed against the 2.0 extension route helpers).
All endpoints require a root admin session or an application API key with the `gobia.updates` permission, and use the standard throttle.

Status: DRAFT contract. Payloads may gain fields; removals need a version bump (`contract_version`).

## GET /check

Reports versions and the latest approved Gobia release (never raw upstream Pterodactyl).

```json
{
  "contract_version": 1,
  "current": { "gobia": "2.0.0", "pterodactyl_base": "2.0.0-beta.N", "extensions": { "gobia-core": "1.0.0" } },
  "latest_approved": { "gobia": "2.0.1", "pterodactyl_base": "2.0.0-beta.N+1", "published_at": "...", "security": true,
                       "release_notes_markdown": "...", "artifact": { "sha256": "...", "signed": true } },
  "update_available": true
}
```

## GET /preflight

Local compatibility result for installing `latest_approved`. `ready` is true only if every `required` check passes.

```json
{
  "ready": false,
  "checks": [
    { "id": "php_version", "required": true, "status": "pass|fail|warn|skip", "message": "...", "detail": {} }
  ],
  "extensions": [ { "id": "gobia-templates", "current": "1.0.0", "required": "1.0.1", "compatible": true, "reason": null } ],
  "migrations": { "pending": 3, "destructive": false, "rollback": "file-only|requires-db-restore" }
}
```

Check ids: `gobia_version`, `pterodactyl_base`, `extensions`, `extension_api`, `frontend_sdk`, `backend_extension_api`, `php_version`,
`node_runtime`, `database_version`, `database_connectivity`, `redis`, `pending_migrations`, `disk_space`, `permissions`,
`wings_connectivity`, `queue_health`, `panel_health`, `release_signature`, `release_checksum`, `upgrade_path`.

## Update button rule

Enabled only if `update_available && preflight.ready`. A newer upstream Pterodactyl does not matter. The frontend shows each failing
required check with its message and detail. No client side override.

## POST /install

Starts the update. Body: `{ "target": "2.0.1", "confirm_backup": true }`. Response `202 { "update_id": "uuid" }`. Rejects with `409` if
another update holds the exclusive lock, `422` with the failing preflight checks if not ready. Idempotent per `update_id`.

## GET /progress/{update_id}

```json
{ "update_id": "uuid", "state": "queued|preflight|backup|staging|migrating|switching|health_check|completed|failed|rolling_back|rolled_back",
  "percent": 40, "step": "migrating", "log": [ { "at": "...", "level": "info", "message": "sanitized" } ],
  "failure": null, "rollback": { "performed": false, "database_restored": false } }
```

Poll (TanStack Query `refetchInterval`) while the state is not terminal. Maintenance mode may interrupt the Panel itself during the switch;
the frontend must tolerate transient network errors and a changed asset version, then reload.

## GET /history

List of past updates: `update_id`, from/to versions, started/finished timestamps, result, whether rollback or database restore happened.

## GET /rollback-eligibility

`{ "eligible": true, "mode": "file-only|requires-db-restore", "database_snapshot": { "id": "...", "taken_at": "..." }, "reason": null }`

## POST /rollback

Body: `{ "update_id": "uuid" }`. Only if eligible. Returns `202` with a new progress id. When `mode` is `requires-db-restore`, the UI must state that
data written after the snapshot will be lost and require explicit confirmation.

## UI sections

Current Gobia version, Pterodactyl base version, latest approved version, compatibility status, extension compatibility table, migration status,
release notes, security update badge, preflight status, Update button (rule above), progress, failure state, rollback state.
