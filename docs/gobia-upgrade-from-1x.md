# Upgrading a Gobia 1.x panel to Gobia 2

Gobia 2 is Pterodactyl 2.0 plus Gobia extensions. A 1.x installation is upgraded in place: nothing has to be wiped, and
the 1.x data is never deleted by the upgrade itself.

## What happens to each piece of 1.x data

| 1.x data | Where it ends up |
| --- | --- |
| Users, servers, nodes, eggs, allocations, API keys | Pterodactyl 2.0 core migrations (run unchanged on a 1.x database) |
| Avatar, theme, recent icon colours | `gobia_user_profiles` (Gobia Core) |
| Server order, icon colours | `gobia_server_preferences` |
| Categories and their members | `gobia_server_categories`, `gobia_server_category_members` |
| Templates, allowed nodes, variables | `gobia_server_templates`, `gobia_template_nodes`, `gobia_template_variables` |
| Template file records, revisions | `gobia_template_files`, `gobia_template_revisions` (snapshots byte for byte) |
| Template instances | `gobia_template_instances` (server link kept) |
| Template SFTP credentials and events | `gobia_template_sftp_*` (password hashes unchanged, so existing passwords keep working) |
| Template file content | Not moved: the same directory is used (`GOBIA_TEMPLATE_STORAGE`, default `storage/app/private/templates`) |
| Branding | Set again under Admin, Extensions, Gobia Core |

The 1.x tables (`server_templates`, `user_server_categories` and the rest) stay in the database untouched. They can be dropped
by hand once the upgrade has been confirmed.

## Procedure

Take a database backup and a copy of `storage/` first. Rolling back means restoring both.

1. Put the 2.0 files in place (the release artifact), keep `.env` and `storage/`.
2. `php artisan migrate --force` runs the Pterodactyl 2.0 core migrations on the 1.x database.
3. `php artisan p:theme:apply gobia`
4. Enable the extensions, Gobia Core first: `php artisan p:extension:enable gobia-core`, then `gobia-templates`, then `gobia-files`.
   Enabling creates their tables.
5. Check what will be copied (changes nothing):

   ```
   php artisan gobia-core:import-1x --dry-run
   php artisan gobia-templates:import-1x --dry-run
   ```

6. Run them without `--dry-run`. Both are safe to run again; rows that already exist are left alone and only missing ones are
   added.
7. If the report says template directories or blobs are missing, set `GOBIA_TEMPLATE_STORAGE` to the directory the 1.x panel
   used and run `gobia-templates:import-1x` again.
8. Template API: 1.x gave API keys template permissions. Create an application API key with the Servers permission and turn on
   "API enabled" on each template that should accept it. The importer leaves it off and reports how many old keys had template
   rights.
9. Template SFTP: deploy `services/template-sftp` (see its README) with the same `GOBIA_SFTP_SERVICE_TOKEN` as the panel.

Both commands accept `--connection=<name>` to read the 1.x tables from another configured database connection, for example a
restored dump, instead of the panel database.

## What the import skips, and says so

Rows whose user, server, egg or template no longer exists are skipped and counted under "skipped". Avatars whose file is missing
from `storage/app/private/avatars` are counted as "avatar files missing". Colours that are not `#rrggbb` are dropped.

## Verified

* Tested against a copy of a real 1.x development database (3 users, 19 servers, 1 template with 9 revisions, 21 instances,
  7 SFTP credentials): the 2.0 core migrations ran cleanly, the importers copied everything whose parents still existed, and a
  second run changed nothing.
* `tests/Integration/Gobia/LegacyImportTest.php` rebuilds the 1.x tables from their migrations, fills them, and checks id and link
  preservation, orphan skipping, idempotency, dry run, hash preservation, and that the 1.x tables are byte for byte unchanged.
