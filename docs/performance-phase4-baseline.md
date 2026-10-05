# Phase 4 baseline: how Gobia was measured before optimising

All numbers come from the local development stack on one Windows machine (PHP 8.3 built-in server, MariaDB 11.8, mock
Wings, headless Chromium). Nothing here is a production benchmark, and absolute times on this machine are not what a
Linux server with PHP-FPM will see; the structural numbers (queries, payload bytes, requests) transfer, the milliseconds
only compare like with like.

## Method

* **Server-Timing header.** A new middleware (`ServerTiming`, enabled by `GOBIA_SERVER_TIMING`, default on only when
  `APP_DEBUG` is true) reports `total`, `db` (sum of query time, count in `desc`) and `wings` (time in Panel to Wings
  calls) for each response. Durations and counts only: no SQL, URLs or tokens.
* **Query log.** `GOBIA_QUERY_LOG=<file>` writes one JSON line per query with placeholders only (never bound values), which
  is how repeated and N+1 queries were found.
* **Endpoint script.** A logged-in browser session called each endpoint 8 times; the first call is discarded and the median of the
  rest is reported. The mock Wings answers in about 1 to 3 ms, so Panel to Wings latency cannot be judged beyond "the Panel adds
  little"; real network latency to a real Wings is not represented.
* **Two server configurations.** *Dev config* is what the project uses day to day: `APP_DEBUG=true`, Clockwork enabled, OPcache
  off. *Production-like config* is the same code with `APP_DEBUG=false`, Clockwork off, OPcache on, a larger realpath cache and 4
  PHP workers. The two are never mixed in one comparison.

## Baseline findings (before any Phase 4 change)

* Every request, even a trivial one such as the websocket credentials (3 ms of database), took about 160 to 175 ms in the dev config.
  That floor is framework boot with OPcache off, debug on and Clockwork collecting data; it is not Panel logic. In the production-like
  config the same requests take 17 to 45 ms. **Most of the time a developer sees in the browser is the development configuration.**
* `GET /api/client` (the server list) took 294 ms and **230 queries** for 16 servers. About 14 queries per server: the startup
  command, the variables, the egg, the transfer, the allocation and its server, and a permission lookup per server.
* `GET /api/client/account/layout` loaded every accessible server and every category member on each dashboard load. With 600
  accessible servers it returned 98 KB and took 80 ms.
* `User::accessibleServers()` joined every server to its subusers and grouped the result, which makes MariaDB read the whole `servers`
  table for every request (`EXPLAIN`: full index scan on `servers`).
* Template provisioning stages (ms, mock Wings): queued 1450, allocating 460, creating 500, installing 5600, deploying files 660,
  starting 670 (about 9.4 s). The installing stage was dominated by a fixed 5 second poll interval.
* Not observable from the Panel: container start, process start and application readiness (see `docs/performance-phase4.md`).

## Baseline table (dev config; server time in ms, database time in brackets)

| Endpoint | Baseline, dev config: server ms (db ms) | After, dev config | After, production-like config | Payload KB baseline / after |
| --- | --- | --- | --- | --- |
| Server list API (full, third-party) | 294 (46 db) | 282 (38 db) | 101 (35 db) | 27.5 / 32.6 |
| Server list API (lite, dashboard) | - | 182 (7 db) | 47 (23 db) | - / 14.3 |
| Server list, category filter | 258 (34 db) | 281 (39 db) | 104 (33 db) | 27.5 / 32.6 |
| Account (user) API | 178 (16 db) | 166 (16 db) | 43 (18 db) | 0.2 / 0.2 |
| Layout API (order/categories/colours) | 186 (20 db) | 165 (6 db) | 39 (17 db) | 2.8 / 3.3 |
| Server detail API | 172 (4 db) | 171 (5 db) | 25 (3 db) | 1.9 / 1.9 |
| Server resources (Wings stats) | 177 (20 db) | 175 (3 db) | 41 (17 db) | 0.2 / 0.2 |
| File list (Wings) | 196 (22 db) | 191 (3 db) | 24 (2 db) | 0.8 / 0.8 |
| Console websocket credentials | 172 (13 db) | 164 (3 db) | 24 (2 db) | 0.9 / 0.9 |
| Power start (Panel to Wings ack) | 203 (20 db) | 187 (6 db) | 28 (4 db) | 0.0 / 0.0 |
| Template list API | 178 (3 db) | 169 (3 db) | 23 (2 db) | 0.4 / 0.4 |
| Admin Overview HTML | 173 (13 db) | 177 (4 db) | 37 (15 db) | 27.7 / 27.7 |
| Admin node statistics (all nodes) | 160 (2 db) | 165 (14 db) | 17 (1 db) | 1.0 / 1.0 |
| Admin Instances HTML | 161 (3 db) | 177 (15 db) | 30 (3 db) | 38.5 / 42.2 |
| Admin Nodes HTML | 172 (15 db) | 165 (3 db) | 33 (9 db) | 27.2 / 27.2 |
| Dashboard HTML shell | 167 (17 db) | 163 (15 db) | 32 (12 db) | 4.6 / 4.6 |
| Login HTML | 164 (2 db) | 175 (2 db) | 20 (1 db) | 4.6 / 4.6 |

The first numeric column is the baseline, the second the same endpoints after the Phase 4 changes in the same dev configuration, the third
after the changes in the production-like configuration. The data set is the small development database (about 17 servers); the scale
results are in `docs/performance-phase4.md`.

## Comparison with stock Pterodactyl 1.15.1

The upstream project was not installed beside Gobia, so no side by side timing was run. What can be said from the code: the full
server-list format (`GET /api/client` without `lite`) is unchanged from upstream apart from a cheaper access subquery, so it behaves like
stock, including its per-server queries. Gobia is **faster** where it adds `lite` (the dashboard), the summary layout and the access
query; **equal** on the endpoints it did not touch (account, server detail, files, websocket, power); and Gobia adds its own per-request work
in only two places (the layout endpoint and `ServerTiming`, which is off in production), neither measurable next to boot time.
