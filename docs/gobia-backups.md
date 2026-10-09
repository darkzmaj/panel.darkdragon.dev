# Gobia Backups: offsite backups on a Hetzner Storage Box

Extension `gobia-backups` (`extensions/gobia-backups`). It copies server backups to a Storage Box, on a schedule or on request, keeps
as many as the policy says, and restores them into the same or another server. It has a backend, an API and console commands. **It has
no screen yet**: the API at the end of this document is what the frontend needs.

Enable it once: `php artisan p:extension:enable gobia-backups` (the updater does this by itself on installations that update to a
release containing it). It needs a queue worker (it uploads on the `low` queue) and the scheduler (`schedule:run` every minute), both
part of a normal Panel installation.

## How a backup travels

```
schedule fires / someone asks        run is "queued"
        |  a slot is free (limits per node, per destination, overall)
        v
Panel asks Wings for a backup        run is "archiving": Wings builds the tar.gz on the node, as for any backup
        |  Wings reports it finished
        v
queue worker                         run is "uploading": node --stream--> Panel --encrypt--> Storage Box (SFTP)
        |  size and SHA-256 match
        v
renamed into place                   run is "completed"; the archive on the node is removed; old backups are pruned
```

* **Nothing is staged on the Panel.** The archive is read from the node and written to the box in one pass. Memory use is one 64 KiB
  frame whatever the size of the server (measured: 0.4 MiB extra for a 40 MiB stream).
* **Verified before it counts.** What arrives from the node must match the size and checksum Wings reported. What is stored must have
  the size that was sent and, on port 23, the SHA-256 the box itself computes (`sha256sum`). The object is written as `*.part` and only
  renamed after both checks, so an interrupted upload never looks like a backup. On plain SFTP (port 22) there is no checksum command
  and the backup is marked "verified by size".
* **Encrypted before it leaves the Panel** (default on): libsodium secretstream, XChaCha20-Poly1305, with a random 32 byte key per
  destination. The box never sees a plain archive. A truncated or altered object is rejected on restore.
* **Failures retry.** A failed run goes back to the queue (three attempts, ten minutes apart by default) and then stays "failed" with
  its reason. A run that stops moving is given up by the scheduler.
* **Retention** runs only after a new backup was verified, only counts verified backups, and never removes the newest one.
* **Restore** uses what Wings already does for S3 backups: the Panel gives Wings a signed link to itself that is valid for fifteen
  minutes, and streams the object from the box, decrypted, when Wings fetches it. The target can be any server, so a backup survives
  the loss of its server and its node.

Layout on the box: `<base path>/<server uuid>/<backup uuid>.tar.gz.gbk` (`.tar.gz` when the destination does not encrypt). Paths are
built from UUIDs only.

## Setting it up

1. In the Hetzner console create a **sub account** for the Panel (not the main account), enable **SSH support** (port 23) and, if the
   Panel is not in Hetzner's network, **external reachability**. Note the host key fingerprint the console shows.
2. Create a key pair for the Panel (`ssh-keygen -t ed25519 -f gobia-backup-key -N ''`) and add the public key to the sub account's
   `.ssh/authorized_keys` (OpenSSH format for port 23).
3. Add the destination. The command shows the host key the server presents; compare it with the console before answering yes:

   ```
   php artisan gobia-backups:destination:add falkenstein u123456-sub1.your-storagebox.de u123456-sub1 --key=/root/gobia-backup-key --default
   ```

   It prints the **encryption key once**. Store it somewhere that is not this server. Without it the backups cannot be read if the
   Panel's database is lost.
4. Switch the schedule on and choose what to keep:

   ```
   php artisan gobia-backups:policy:set --enable --cron="0 4 * * *" --timezone=Europe/Ljubljana --keep-last=7
   php artisan gobia-backups:policy:set --server=<uuid> --keep-last=30        # one server keeps more
   php artisan gobia-backups:policy:set --node=3 --disable                    # one node is left out
   ```

5. Try one: `php artisan gobia-backups:run <server uuid>`, then `php artisan gobia-backups:run --list`.

**Policy levels.** There is one global level, one per node and one per server. A level stores only what it changes; a server gets the
defaults, overridden by global, then by its node, then by its own level. Fields: `destination_id`, `enabled`, `cron`, `timezone`,
`window_start` / `window_end` (minutes after midnight between which a scheduled backup may start, may cross midnight), `keep_last`,
`keep_days`, `ignored` (paths left out of the archive, same syntax as the Panel's backup ignore list) and `mirror_user_backups` (also
copy the backups people make themselves in the Panel; those stay on the node as well).

**Limits** (`extensions/gobia-backups/config/gobia_backups.php`, all with `GOBIA_BACKUPS_*` variables): six backups at once overall,
two per node, four per destination (a Storage Box accepts ten connections per account); six hours for Wings to build an archive and
for one transfer; three attempts.

## Recovering without the Panel

`extensions/gobia-backups/bin/decrypt.php` and `src/Support/StreamCipher.php` are all that is needed, on any machine with PHP and the
sodium extension:

```
sftp -P 23 u123456-sub1@u123456-sub1.your-storagebox.de:gobia-backups/<server uuid>/<backup uuid>.tar.gz.gbk .
GOBIA_BACKUP_KEY=<the key printed in step 3> php decrypt.php <backup uuid>.tar.gz.gbk server.tar.gz
```

## Security

* Destinations, credentials and policies are for root administrators. Creating or changing a destination, deleting a backup and
  restoring need a panel session; an API key is refused.
* The SSH private key, the password and the encryption key are encrypted with the Panel key in the database, hidden from every
  serialisation, and never returned by the API. Responses only say whether a key is set.
* The host key is pinned. A connection whose host key differs is dropped before any credential is sent. Changing a destination's
  host needs the new fingerprint in the same request.
* People who can open a server see that server's backups and their state. They never see hosts, paths, checksums or other servers.
  Starting a backup needs the subuser permission `ext.gobia-backups.create`, restoring `ext.gobia-backups.restore` **and the account
  password** (five wrong passwords lock that for fifteen minutes). Restoring a backup of another server is an administrator action.
* The restore link is signed with the Panel key, bound to one restore, valid for fifteen minutes and closed as soon as the archive
  was handed over. It is only ever sent to a node.
* Everything is written to the activity log (who, which server, which backup, result), without credentials.

## What differs from the specification in MAJCEK_HANDOFF.md section 14

| Specification | Built | Why |
| --- | --- | --- |
| BorgBackup or rsync on port 23, driven by a worker on the Panel host or node | SFTP (works on port 23 and 22), driven by the Panel | Server files live on the nodes and Wings only hands out finished `tar.gz` archives. Borg would need the archive staged on the Panel's disk and gains nothing from deduplicating compressed archives. A node side Borg client would mean changing Wings, which is out of scope |
| Encryption with Borg `repokey` or `age` | libsodium secretstream in PHP | No external program, streams in constant memory, authenticated, with a standalone decrypt script |
| Verify with `borg check` or `sha256sum` | Size always, `sha256sum` on port 23 | As specified for the non Borg case |
| Primary and secondary destination per server | One destination per server | Not built |
| Notifications by e-mail or webhook, capacity warnings at 80 and 90 percent | Activity log entries and the run's stored error only | Not built |
| Bandwidth limits, `nice`/`ionice`, pre and post commands, jitter | Concurrency limits and a start window | Not built |
| Per server sub accounts, rotation helpers | One account per destination; rotate by editing the destination (new key, then remove the old key on the box) | Not built |
| Admin and server screens | API and console only | Frontend work |

Because Wings builds a full archive each time, every backup is a full backup: storage use is `keep_last` times the archive size.

## What was tested, and what was not

* `tests/Integration/Gobia/OffsiteBackupTest.php` (16 tests) against a fake Wings and a folder standing in for the box: authorisation,
  destination validation and secrecy, policy inheritance, schedule with timezone and window, a complete encrypted backup, damaged and
  wrongly stored archives with retries, verification by size, retention, concurrency per node, mirroring, per server access and
  permissions, restore with password and signed link, restore into another server after the original was deleted, the console commands,
  and the cipher (every size boundary, truncation, alteration, wrong key).
* The real SFTP client against an OpenSSH server in Docker: host key read and pinning, wrong key rejected, key login, a 40 MiB
  encrypted upload, server side SHA-256, rename, download and decrypt, deletion, and refusal of unexpected paths.

**Not tested: a real Hetzner Storage Box and a real Wings node.** In particular: that Wings accepts the Panel's restore link as it
accepts an S3 link (the request shape and content type follow Wings' S3 restore, but no real node fetched it), the ten connection
limit under load, sub account `authorized_keys` formats, throughput over a real network, and multi hour transfers of large servers
through PHP-FPM and proxies (raise proxy and `request_terminate_timeout` limits for the restore link). Run one backup and one restore
of a disposable server before relying on it.

## API for the frontend

Admin routes are under `/api/admin/extensions/gobia-backups` (root administrator). Routes marked *session* refuse API keys.

| Call | Purpose |
| --- | --- |
| `GET /destinations` | `data[] {id, name, type, host, port, username, host_key_fingerprint, base_path, encrypt, enabled, has_private_key, has_password, last_checked_at, last_error}` |
| `POST /destinations/probe` *session* | Body `{host, port?}`. Returns `{host_key_fingerprint}` read without logging in, to show before pinning |
| `POST /destinations` *session* | Body `{name, host, port?, username, private_key? or password?, host_key_fingerprint, base_path?, encrypt?, enabled?}`. Returns the summary plus `encryption_key` **once**: show it and make the administrator confirm they saved it |
| `PATCH /destinations/{id}` *session* | Any of the fields above except `encrypt`. A secret that is sent replaces the stored one |
| `POST /destinations/{id}/test` *session* | `{ok, checksum_supported, host_key_fingerprint}` or 422 `{ok: false, error}` |
| `DELETE /destinations/{id}` *session* | 409 `destination_in_use` while backups are stored on it |
| `GET /policies` | `{defaults, data[] {scope, node_id, server, overrides}}` |
| `PUT /policies` | Body `{scope: global or node or server, node_id?, server?, ...fields}`. Replaces the level; a field left out or null is inherited |
| `DELETE /policies` | Body `{scope: node or server, node_id? or server?}` |
| `GET /servers/{uuid}/policy` | The policy that applies to one server |
| `GET /runs?server=&state=&per_page=` | `data[]` with `id, state, trigger, bytes, transferred_bytes, encrypted, error, created_at, completed_at, server {uuid, name, exists}, destination_id, attempts, stored_bytes, archive_sha256, verified_by, kept_on_node` and pagination |
| `POST /servers/{uuid}/backups` | Queue a backup now. 202 with the run |
| `DELETE /runs/{id}` *session* | Remove the object from the box |
| `POST /runs/{id}/restore` *session* | Body `{password, target?: server uuid, truncate?}`. 202 with the restore |
| `GET /restores` | Latest restores |

Server routes are under `/api/client/servers/{server}/extensions/gobia-backups` for anyone who can open the server:

| Call | Needs | Purpose |
| --- | --- | --- |
| `GET /backups` | `backup.read` | `{configured, schedule or null, data[] {id, state, trigger, bytes, transferred_bytes, encrypted, error, created_at, completed_at}, restores[] {id, backup, state, transferred_bytes, error, created_at, completed_at}}` |
| `POST /backups` | `ext.gobia-backups.create` | Queue a backup. 202; 400 when one is already running or backups are not set up |
| `POST /backups/{id}/restore` | `ext.gobia-backups.restore` | Body `{password, truncate?}`. 202; 409 while the server is busy; 400 for a wrong password; 429 after five wrong passwords |

Run states: `queued`, `archiving`, `uploading`, `completed`, `failed`, `deleted`. Restore states: `requested`, `streaming`, `unpacking`,
`completed`, `failed`. Poll `GET /backups` while anything is not in a final state; `transferred_bytes` against `bytes` gives the
progress of an upload (`bytes` is known once Wings finished the archive).
