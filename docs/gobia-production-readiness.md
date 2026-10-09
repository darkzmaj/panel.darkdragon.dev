# Gobia 2.0 production readiness (2026-10-08)

Verdict: **Not Production Ready.** Frontend Ready and CI Verified (mock Wings), not Production Ready.

| Level | State |
| --- | --- |
| Frontend Ready | Yes: dark, light, 390 px, keyboard, axe, bundle budgets, Access flows (browser suite) |
| CI Verified | Linux mirror workflow (frontend 8.3/8.4, static analysis, Pest on MariaDB 11 and MySQL 8) against mock Wings. GitHub Actions of Cryvex-Dev is blocked by billing |
| Production Ready | No, see blockers |

## Verified blockers

1. Real Wings, Docker, backups, restores, transfers and the SFTP/file flows were never run: mock Wings proves the panel side only.
2. The base, Pterodactyl 2.0 `2.0-develop`, is alpha and a moving target; upstream breaking changes are expected.
3. The updater, signed release packaging and the release workflow exist since 2026-10-09 (`docs/gobia-updates.md`, `MAJCEK_HANDOFF.md` section 15) and passed an end to end run in a container (`docs/gobia-updater-e2e.md`). Still open: no release has been tagged or installed from GitHub, the release workflow has never run (Actions is blocked), and no update has run on a real server with PHP-FPM, systemd and Wings.
4. Production rate limits (websocket token 5 per minute per server, client API 256 per minute) were only exercised on the dev stack with raised limits; a heavy multi server dashboard under real limits is unmeasured.
5. No load, soak or security penetration test; no backup/restore drill of the panel database.
6. CI runs on a private mirror, not on the production repository.

Not blockers: the Access feature (covered by Pest and browser flows), delegated management (escalation and privileged person cases tested), the removed server Users page (redirects; the backend capability is intact).
