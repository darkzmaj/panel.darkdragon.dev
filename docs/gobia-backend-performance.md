# Gobia 2.0 backend performance (2026-10-09)

Measured before changing anything, as the performance policy asks. The short version: the Panel's request handlers were already lean, the
avoidable cost was in what every request does **before** its handler runs, and the time a game server needs to start is spent on the node,
not in the Panel.

## What was measured

**Queries per request** (Pest probe with `DB::listen`, 18 servers, the three Gobia extensions enabled, MariaDB 11):

| Request | Queries | Notes |
| --- | --- | --- |
| `GET /api/remote/servers/{uuid}` (Wings asks this before every start) | 11 | No N+1; one query for the egg variables runs twice |
| `GET /api/remote/servers` (Wings boot) | 10 | Batched for all servers of the node |
| `GET /api/client/extensions/gobia-core/servers` (instance list) | 5 | List, three counts for the views, categories |
| `.../servers/summary` | 6 | |
| `GET /api/client` (upstream list) | 12 | |
| `GET /api/client/servers/{id}` | 10 | |
| `GET .../websocket`, `GET .../resources` | 4 each | |

Nothing here grows with the number of rows, so there was no handler worth rewriting.

**Boot cost** (a fresh application handling a request, queries counted from the first database connection): every request, whatever the
route, including each call from Wings and each poll from the browser, ran three queries before reaching its handler:

1. `select exists (...) from information_schema.tables` (does the `extensions` table exist),
2. `select * from extensions`,
3. `update extensions set error = NULL ... where error is not null` (a write, on every request).

**Time per request** (Linux container, PHP 8.4 built-in server with OPcache, 40 requests after warm up; requests that are rejected early, so
the number is almost purely framework boot):

| | Client API | Daemon API | Application shell `/` |
| --- | --- | --- | --- |
| No framework snapshots | 26.1 ms | 29.9 ms | 30.3 ms |
| Route and event snapshots | 23.1 ms | 23.4 ms | 29.6 ms |
| Route, event and configuration snapshots | 20.8 ms | 21.0 ms | 25.1 ms |

A second run of the same measurement gave 28.8 / 30.3 / 32.7, then 23.8 / 24.0 / 31.3, then 22.0 / 22.6 / 27.7 ms. The container's OPcache
revalidated every file on every request (`revalidate_freq=0`), which production does not do, so absolute numbers are higher than a real
PHP-FPM server; the differences between the rows are the useful part.

## What was changed

1. **Two of the three boot queries are gone** (`app/Services/Extensions/ExtensionRepository.php`, recorded in
   `docs/gobia-core-patches.md`). A missing table is recognised from the failed select instead of asking `information_schema` first, and
   the error column is only cleared when a row that was just read actually carries an error. Boot queries per request: 3 before, 1 after.
   Extension loading behaves the same, including on a panel that has not been migrated yet.
2. **Route and event snapshots are built by the updater** (`route:cache`, `event:cache` in its cache step) and rebuilt in the background
   when an extension is enabled or disabled (the Panel deletes the route snapshot on every such change). Measured gain: 12 to 22 percent
   on the base cost of an API request, about 3 to 6 ms each in the container. Extension routes are part of the snapshot and were checked
   to answer afterwards. To get this on an installation that has not updated yet: `php artisan route:cache && php artisan event:cache`.
3. The configuration snapshot (`config:cache`) is **not** used although it measures another 2 ms: extension providers merge configuration
   at boot, so an extension enabled later would silently run without its configuration until someone rebuilt the snapshot. Upstream's
   container image makes the same choice.

## Server start time

Starting a server from the Panel is: the browser sends `set state start` over the websocket straight to Wings; Wings asks the Panel once
for the server's configuration (`GET /api/remote/servers/{uuid}`, 11 queries, tens of milliseconds); then Wings prepares the container
(image, mounts, configuration files) and the game process boots. The Panel's share is that single request. The changes above make it a
few milliseconds cheaper; they cannot make a JVM or a Docker pull faster.

Where the seconds actually go, and what helps:

* **Docker image pulls.** Wings pulls the egg's image before a start when it is missing or when the image tag moves. Keep images on the
  node (pin tags or digests in the eggs, pull during off hours) so a start never waits for a registry.
* **Disk.** World and plugin loading is disk bound: NVMe for `/var/lib/pterodactyl/volumes`, no network filesystem under running servers.
* **The startup done string.** The Panel shows "running" when the egg's `config.startup.done` text appears in the console. An egg whose
  text never matches leaves the server "starting" although it is up; that looks like a slow start and is an egg setting.
* **Wings itself** (crash detection timeouts, throttles) is configured on the node. Wings was not changed in this work (project policy).

Measuring a real start on a real node (click to "running", split into Panel request, image, container, process) is still to do; no node was
available here.

## Server configuration that matters more than any code change

These are deployment settings, so they are listed rather than applied:

* **OPcache.** The Panel loads about 1 900 PHP files per request and ships about 15 000. PHP's default `opcache.max_accelerated_files=10000`
  is too small once the cache fills; use `opcache.max_accelerated_files=30000`, `opcache.memory_consumption=256`,
  `opcache.interned_strings_buffer=32`. Keep `opcache.validate_timestamps=1` (default) unless the update helper is installed, because the
  in-place updater relies on PHP noticing changed files.
* **Redis for cache, sessions and queue** instead of files and `sync` on any installation with more than a handful of users.
* **PHP-FPM**: enough `pm.max_children` for the client API plus one long file transfer per two users (`docs/gobia-security-review.md`,
  finding 3).
* `php artisan route:cache && php artisan event:cache` after any manual deployment (the updater does it by itself).

## Not done

No load or soak test, no measurement on PHP-FPM, no real Wings node, and the frontend bundle was not touched in this pass (it has its own
budgets, `docs/gobia-visual-parity.md`).
