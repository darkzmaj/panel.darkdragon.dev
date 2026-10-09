# Gobia 2.0 security review (2026-10-09)

Scope: the code Gobia adds on top of Pterodactyl 2.0 (`extensions/gobia-core`, `gobia-files`, `gobia-templates`, `services/template-sftp`,
the core patches in `docs/gobia-core-patches.md`) and the new updater. Method: reading every backend entry point an ordinary user, a
subuser, an API key or an unauthenticated caller can reach, plus `composer audit` and `npm audit`. This was a code review, not a
penetration test: nothing was attacked over the network and no real Wings node was involved.

Upstream Pterodactyl code was not re-audited. Its permission checks, middleware and rate limits are used unchanged.

## Fixed

| # | Severity | Where | Problem | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| 1 | Medium | `gobia-core` `AccessService::grant()` (`POST /api/client/extensions/gobia-core/access`) | A delegated manager (a subuser holding the four `user.*` permissions) could rewrite the permissions of someone who holds more than they do, by "granting" to that person's e-mail address. `replace()` and `revoke()` refused this, `grant()` did not, so the documented rule "cannot change anyone who holds more than them" could be bypassed to strip a more privileged person down | `grant()` applies the same check before it updates an existing subuser | `AccessTest`: "a manager cannot change or remove someone who holds more than they do" |
| 2 | Medium | `gobia-core` `ProfileController::updateUsername()` | The endpoint confirms the account password and had only the general client API limit (256 a minute by default). Anyone holding a client API key or a hijacked session could use it as a password oracle | Five wrong passwords per fifteen minutes per account, then 429 even for the right one; three username changes a day (the limits Gobia 1.x had) | `ProfileAvatarUsernameTest`: "the username change cannot be used to guess the password and is limited per day" |
| 3 | Medium (availability) | `gobia-files` `TransferController` | One transfer request holds a PHP worker for up to minutes and up to three temporary copies of a 2 GiB file. Nothing stopped one user from starting many at once and exhausting PHP-FPM workers and the Panel's temporary disk | At most `GOBIA_FILES_TRANSFER_CONCURRENT_PER_USER` (2) transfers per user at a time, 429 beyond that; the slot is released when the request ends or dies | `FileTransferTest`: "one person can only run a few transfers at once" |
| 4 | Low | `gobia-files` `TransferService::server()` | An unknown server id answered 404 and a forbidden one 403, so any signed in user could test whether a server UUID exists, against the stated intent of the code | Both answer the same 403 | `FileTransferTest`: "a stranger learns nothing and traversal is refused" |
| 5 | n/a | Updater (new code) | Installing code is the most sensitive thing the Panel does | Signed manifests only (Ed25519 over the whole manifest), SHA-256 and size checked before unpacking, hardened extractor, fixed command lists, no URL/path/command from a request, session required for install and rollback, single run lock, scrubbed logs. See `docs/gobia-updates.md`, "Security model" | `UpdaterTest` (31 tests), `docs/gobia-updater-e2e.md` |

## Reviewed, no change needed

* **Instance list, categories, icon colours** (`ServerLayoutService`): every write resolves servers through `accessible()` and categories
  through `ownedCategory()`; search and ordering use bound parameters; `LIKE` input is escaped.
* **Access sharing** apart from finding 1: escalation is blocked (`assertDelegable`), unknown permissions are rejected, a person outside
  the caller's servers is a 404.
* **Avatar upload**: type decided from content, dimensions capped before decoding, image re-encoded (metadata and appended data dropped),
  stored under a random server generated name on a private disk.
* **File transfers** apart from findings 3 and 4: permissions checked on both servers with the same ids the core file API uses, server
  state and node maintenance respected, paths normalised (`..` and control characters give 422), symbolic links skipped, Wings credentials
  never leave the Panel, temporary files created with `tempnam`.
* **Templates** (administrators only): the client, admin and application routes each check their own kind of credential; unknown request
  fields are rejected; template file paths go through `TemplateFileStore::resolve()` (no traversal, no symlinks, must stay inside the
  template); the SFTP bridge needs a service token of at least 32 characters compared in constant time, checks logins with constant time
  hashing and locks out after repeated failures per address and per username.
* **Template SFTP service** (`services/template-sftp`): every path goes through the jail (no symlinks, must stay inside the root),
  connection, per address and authentication attempt limits are in place.
* **Compatibility and overview endpoints**: root administrators only, read only, and the release file is tested to contain no secrets.

## Not fixed here, and why

| Item | Why it is left | What to do |
| --- | --- | --- |
| `i18next-http-backend` below 4.0.2 (`npm audit`, low: incomplete URL validation) | Upstream dependency of the Panel frontend; the fix is a major version. It runs in the browser and only loads the Panel's own translation URLs | Take it with the next upstream sync |
| A delegated manager can lock a credential holder out of template SFTP for 15 minutes by failing logins against their username | Deliberate trade off of the per username lockout; usernames are random (`tpl_` plus ten characters) | None |
| Sharing a server by e-mail creates an account for an unknown address and tells the caller nothing | Upstream subuser behaviour, unchanged | None |
| Session cookie `secure` flag, trusted proxies, CORS | Upstream defaults driven by `.env` (`SESSION_SECURE_COOKIE`, `TRUSTED_PROXIES`) | Set `SESSION_SECURE_COOKIE=true` and the real proxy addresses in production; this is server configuration, not code |
| The release public key in `gobia_updater.php` is the Gobia 1.x key | Only its owner knows whether the secret key is still safe | Generate a new pair before the first 2.x release if there is any doubt (`docs/gobia-updates.md`) |

`composer audit --no-dev`: no advisories. `npm audit --omit=dev`: the one low finding above; `extensions/gobia-files` and
`services/template-sftp`: none.

## What this review does not replace

A penetration test against a deployed panel with real Wings (blocker 5 in `docs/gobia-production-readiness.md`), a review of the server
configuration (TLS, firewall, database exposure, the SFTP service token), and a re-audit after each upstream sync.

## Second pass (2026-10-09): scanners and a live probe

Done after the review above, before the work was pushed.

**Secret scan.** gitleaks over every commit of every branch (4 274 commits) and over the working tree. 15 hits, all in upstream Pterodactyl
commits: documentation examples of API responses, a test fixture, and the public reCAPTCHA test keys upstream shipped in 2017. No commit by
a Gobia author contains a secret.

**Static analysis.** Semgrep (`p/php`, `p/javascript`, `p/typescript`, `p/react`, `p/security-audit`, `p/secrets`, `p/owasp-top-ten`) over
`extensions/`, `services/`, `deploy/`, `scripts/release`, `resources/scripts/gobia` and the core patch: 231 files, no code finding. The only
results were unpinned GitHub Actions in a scaffolded CI file. The release workflow, which holds the signing key, now pins its three actions
to commit hashes.

**Live probe.** A panel installed from a release package (PHP 8.4, MariaDB 11.8, the three Gobia extensions enabled) was called on every
registered route (330 route and method pairs):

* As nobody: 297 answered 401 and 2 answered 404. The only successes are the application shell, which is public by design. No route reached
  validation or data without a credential.
* With an ordinary user's API key on every administrator and application route (200 calls): no success.
* An administrator API key reads the update state but gets 403 on install and rollback (session required). The template SFTP bridge refuses
  callers without its service token, including an administrator key.
* `.env`, `.git/config`, `composer.json`, `gobia-release.json`, extension manifests and configuration, `vendor/`, `storage/` and traversal
  attempts through `/extension-files` and `/assets/extensions` return the application shell or 404, never file content.
* `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy` are sent, the session cookie is HttpOnly, signing in without a CSRF
  token is refused (419), and repeated wrong passwords are limited (429 after ten attempts).

**Fixed in this pass**

| # | Severity | Where | Problem | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| 6 | Low | `bootstrap/app.php`, groups `admin-api` and `application-api` (upstream behaviour, found by the live probe) | Route model binding ran before the administrator check, so any signed in user could tell which ids exist: `/api/admin/users/1` answered 403 and `/api/admin/users/999999` answered 404. The same for nodes, servers and the application API | The authorisation middleware runs first; someone who may not use these APIs gets 403 for every id. Administrators still get 404 for a missing id | `AdminEnumerationTest`; the upstream admin and application suites |
| 7 | Low | `gobia-templates` `TemplateFileStore::writeStream()` and `writeText()` | Upload size was counted in characters (`mb_strlen`), not bytes, so the per file limit could be exceeded several times over with multi byte content. Administrators only | Byte counts (`mb_strlen($x, '8bit')`) | Existing template suites |
| 8 | Hardening | Updater | The database dump written before an update was created with the default umask (readable by other local users if the directory permissions were ever loosened); a release manifest of any size was parsed | The dump is set to 0600; a manifest above 1 MiB is rejected unparsed | `UpdaterTest` |
| 9 | Hardening | `.github/workflows/gobia-release.yaml` | Third party actions referenced by tag in the job that holds the signing key | Pinned to commit hashes | n/a |

**Still not done.** No test against a deployed panel on the internet, no real Wings node, no authenticated session fuzzing of the frontend,
no load test, and upstream Pterodactyl code was only exercised through the route probe, not read line by line.
