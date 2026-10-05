# Phase 4: performance engineering

Method and the baseline are in `docs/performance-phase4-baseline.md`. This page lists what changed, the before/after, what is
still slow, and the production recommendations. **Panel overhead** (what Gobia's code and its configuration cost) is kept separate from
**Wings, Docker and application time** (what the Panel can only wait for).

## What changed

| Change | Why | Effect |
| --- | --- | --- |
| `GET /api/client?lite=1` and `ServerListTransformer`; the dashboard asks for it | The list built the startup command, variables, egg and a permission check for every server (about 14 queries each) although the list shows none of it | 230 queries to a fixed 5 (16 servers); 304 to 5 with 600 accessible servers; payload 77 KB to 37 KB per 50 rows; 282 to 182 ms (dev config) and 101 to 47 ms (production-like) |
| `GET /api/client/account/layout?lite=1` | The layout returned every accessible server and every category member on each dashboard load | With 600 servers: 98 KB / 6 queries / 88 ms to 0.1 KB / 3 queries / 28 ms. The full layout is fetched only when the category editor opens |
| `accessibleServers()` rewritten as two indexed predicates | The join to subusers plus `GROUP BY` read the whole servers table | Same rows, no grouping. Verified for correctness by the existing suites; the benefit at large table sizes was reasoned from `EXPLAIN`, not timed |
| Access subqueries instead of `pluck('id')` lists in the list endpoint | One extra query and a huge `IN (...)` list for users with many servers | One query fewer, constant statement size |
| Shared live-stats scheduler on the dashboard | One timer and one request burst per row | 4 concurrent requests, one request per visible server per 30 s, shared between duplicate rows, paused in background tabs |
| Wings HTTP client reuse (`DaemonRepository`) | A new Guzzle client per call meant a new connection and TLS handshake each time | Keep-alive within a process. Helps long-lived workers (template deployment of many files, queue). PHP-FPM requests are separate processes and gain nothing. Certificate verification is unchanged |
| Install polling 5 s to 1 s, 2 s, 5 s | A fixed 5 s poll added up to 5 s after every install | Template provisioning 9.4 s to 6.4 s on the mock (installing 5.6 s to 3.4 s) |
| Per-stage provisioning timings (`stage_ms` column) | Stage times were invisible | Shown in the table below |
| `Server-Timing` and query log | Measurement | Dev only by default |
| `scripts/check-bundle-budget.js` (`yarn budget`) | Regression guard | Fails if the main bundle, server-pages or template-editor chunks grow past their budgets or Monaco leaks into a common chunk |

No index was added: `EXPLAIN` of the hot queries showed existing indexes in use (`servers.owner_id`, `subusers.user_id/server_id`,
`user_server_preferences` primary key, `user_server_category_members` primary key and `server_id`).

## Template provisioning stages (mock Wings, ms)

| Stage | Before | After |
| --- | --- | --- |
| queued (dispatch to worker, includes the 1 s database-queue poll) | 1450 | 1310 |
| allocating | 460 | 320 |
| creating | 500 | 350 |
| installing (mock Wings reports the install after 2 s) | 5600 | 3440 |
| deploying files | 660 | 480 |
| starting | 670 | 480 |
| **total** | **9400** | **6385** |

The earlier rows are single runs and the later ones are one run each; treat differences below a few hundred ms as noise. Large JARs
are streamed and stay byte-identical (verified again by the SFTP end-to-end test). Wings has no batch upload call, so each file is one
request; directory creation is already done once per directory.

## Scale: 600 accessible servers (500 owned, 100 shared, 3000 owned by others)

Synthetic rows, no containers. Panel overhead only (no timing of Wings).

| Request | Queries | Time (warm, in-process) | Payload |
| --- | --- | --- | --- |
| list, full (third-party format), 50 rows | 304 | 275 ms | 77 KB |
| list, lite (dashboard), page 1 / page 3 | 5 | 28 / 31 ms | 37 KB |
| list, You / Other filter | 5 | 25 / 36 ms | 37 KB |
| list, category of 150 servers | 6 | 33 ms | 37 KB |
| list, search "A 42" | 5 | 33 ms | 8 KB |
| layout, full | 6 | 88 ms | 98 KB |
| layout, summary | 3 | 28 ms | 0.1 KB |

In the browser (production-like server): first page of 50 rows rendered in 637 ms, page 2 in 540 ms, the 150-server category in 911 ms
(each includes the first live-stat requests), the category editor with 600 rows opened in 42 ms, the JS heap stayed between 8 and 13 MB, and
there were **no long tasks** (the slowest input event was 72 ms). Pagination is server side (`per_page` 50), so the page never holds more
than 50 rows; virtualization was not needed. Search is server side. The 100-server case was not run separately: query counts do not
depend on the server count.

## Console, files, power: what the Panel adds

Production-like config, mock Wings (about 1 ms): websocket credentials 24 ms (2 ms database), file list 24 ms (2 ms database),
power start 28 ms of which 1.2 ms is the call to Wings. The remaining time is boot, session, authentication and authorization.
The websocket credentials route is rate limited (a burst of 8 calls returned 429), which is intended.

### Start timeline

| Stage | Observable now? |
| --- | --- |
| T0 click | yes, in the browser |
| T1 Panel request received | yes (`Server-Timing: total`) |
| T2 authorization done | not separated; included in `total` minus `wings` minus `db` |
| T3 command sent to Wings, T4 acknowledged | yes (`wings` bucket) |
| T5 container start requested, T6 container running, T7 process starting, T8 application ready | **no**: these happen inside Wings and Docker. With a real Wings they arrive as console state events on the websocket and can be timestamped in the browser |

The Panel's own share of a start is about 28 ms in the production-like config; everything after the Wings acknowledgement is Docker and the
game process. Nothing was claimed or faked for T5 to T8.

### Readiness architecture (design only)

Add an optional `readiness` block to a template or egg: `{ "provider": "process" | "port" | "minecraft-ping" | "http", ...options }`. A small
fixed set of providers runs from the Panel or Wings (TCP connect, Minecraft status ping, HTTP GET to a fixed local port and path) and reports
`running` and then `ready` through the existing state events. No shell command is ever accepted as a health check. It is not required for
any server and nothing depends on it yet.

## Remaining bottlenecks

* The development configuration. Debug mode, Clockwork and no OPcache cost 130 ms or more per request; run production settings when judging speed.
* Per-request session and authentication boot (about 15 to 20 ms even in the production-like config). Only a different runtime (Octane) would remove it.
* The list rows still make one stats request per visible server every 30 s. A single batched stats endpoint on the Panel would turn 50 requests into one.
* Database queue polling adds up to a second before a job starts in development. Use Redis in production.
* The admin node statistics call every node concurrently with short timeouts and a 45 s cache; one dead node costs at most its timeout. This was
  not changed.

## Production recommendations

See `docs/production-performance.md` for the Nginx, PHP-FPM, OPcache, Redis, queue and release-cache settings.

## Security boundaries

Nothing was removed or loosened: the lite list returns only the primary allocation without notes (what every user with access may see), the new
colour and summary queries are restricted to servers the user can currently open, `?lite` does not change who can list what, CSRF and
session checks are untouched, the client cache keys include the node token and address, and TLS verification is unchanged.
`Server-Timing` exposes durations and counts only.

## Not measured

Stock Pterodactyl side by side, real Wings latency, Redis (not available on this Windows machine; the configuration is documented, not
benchmarked), WebSocket round trips, backups and database creation (they are Wings or queue calls with no Panel-side loops to optimise;
a code reading found no sequential internal calls to batch).
