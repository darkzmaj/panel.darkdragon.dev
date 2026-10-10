# Wings startup baseline

All numbers below were measured on real Paper servers in real Docker containers (no mocks). Raw runs:
[`data/baseline`](data/baseline) (first session) and [`data/final`](data/final) / [`data/control`](data/control)
(interleaved re-measurement). Medians over 20 (baseline, final) or 15 (control) measured cycles per case; the first
cycle of every case is a discarded warm-up.

## Environment

| Item | Value |
|---|---|
| Host | WSL2 Ubuntu 24.04 VM (virtualised, not bare metal) on Windows 11 |
| CPU | Intel Core i7-14700KF, 16 vCPUs given to the VM |
| RAM | 19.5 GB visible to the VM (memory speed not visible from inside the VM) |
| Storage | ext4 on the WSL VHD; server data on the same filesystem as Docker |
| Kernel / Docker | 6.18.40.1-microsoft-standard-WSL2 / Docker Engine 29.9.0 (cgroup v2, overlayfs) |
| Java | Temurin OpenJDK 21.0.12.1 (`ghcr.io/pterodactyl/yolks:java_21`, image id `sha256:a2b1a69f…cf07`) |
| Paper | 1.21.11 build 132 (`paper-1.21.11-132.jar`, SHA-256 `5ffef465…ccfba`, downloaded from papermc.io) |
| Server | no plugins, existing generated world (seed `gobia-bench`, 511 files, 249 MB), `online-mode=false`, view/simulation distance 4 |
| JVM flags | the Paper egg's: `-Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true` |
| Container | identical for every case: 2048 MB server memory (Wings overhead ×1.15 → 2.3 GiB limit), pids 512, read-only rootfs, 10 dropped caps, no-new-privileges, tmpfs /tmp, `pterodactyl_nw` network |
| Stock Wings | `ghcr.io/pterodactyl/wings@sha256:97937976…` = **v1.13.3**, as pinned by the benchmark handoff |
| Panel for the Wings cases | stock Panel image `bench-stock:240aaf6` in the isolated `wdev` project (ports 19080/19090) |

**Direct Docker** is built to be the best honest "no Wings" case: it creates the container with the exact flags Wings
uses (taken from `docker inspect` of a Wings-created container), attaches stdin before starting, stops Paper by typing
`stop` into the console, and restarts by reusing the same container. Its container creation is timed from the `docker`
CLI, which adds roughly 0.3–0.45 s that a daemon talking to the Docker API does not pay.

## Readiness definition (same for every case)

**ready = the first valid Minecraft Server List Ping answered on the published port** (handshake + status request,
reply parsed as JSON with a `version` object), polled every 4 ms. Not "container running", not the console line.
Observed gap between Paper's own "Done" line and protocol readiness: ~45 ms. Wings' own "running" state (egg regex on the
console) lands ~5 ms after "Done", i.e. slightly *before* the protocol answers.
A plain TCP connect proves nothing here: the published port is held by `docker-proxy`, which accepts connections long
before Paper listens (seen directly: TCP accepted 1.4 ms after launch, status answer after 10.5 s on the template boot).
Client join (T11) is measured only for already-running servers (see final results); Panel display time (T12) was not
instrumented.

Timestamps are wall-clock nanoseconds on one host (`time.time_ns`, Docker `timeNano`, `docker logs --timestamps`), so
stages are comparable within a run, but they are **not** monotonic clocks. Stop timing: "stop exit" is the console
stream ending (direct) or Wings' own `offline` state; `stop_die` is Docker's `die` event. They agree (~850 ms) for direct
Docker and for the develop-based Wings builds, but **stock v1.13.3 reports `offline` ~240 ms (≈610 ms) before the
container's `die` event (≈850 ms)**, so its "stop" looks faster than the process really is. Compare `stop_die`, not
`stop_exit`, across Wings versions.

## Baseline: direct Docker vs stock Wings v1.13.3 (n=20 each, ms, median / p95)

| Case | Direct Docker | Stock Wings v1.13.3 | Wings − direct |
|---|---|---|---|
| Start, warm page cache | 6698 / 7019 | 7343 / 7720 | +645 (+9.6%) |
| Start, caches dropped | 6708 / 7142 | 7412 / 7768 | +704 (+10.5%) |
| Graceful restart, warm | 7177 / 7620 | 7992 / 8387 | +815 (+11.4%) |
| Graceful restart, caches dropped | 6822 / 7149 | 7668 / 8058 | +846 (+12.4%) |

Dropping the page cache changed nothing measurable (the WSL VHD is cached by the Windows host as well), so "cold cache"
in this document does not mean "cold disk".

### Where a stock Wings start spends its time (warm start, median ms from the Start request)

| Stage | Stock Wings | Direct Docker |
|---|---|---|
| HTTP request accepted (`202`) | 0.6 | – |
| Wings takes the power lock | 0.5 | – |
| Preflight done (Panel sync, disk check, config files, chown) | 40 | – |
| Old container destroyed | 70 | – |
| **Container created** | **1342** | 463 |
| Container started | 1475 | 751 |
| Paper prints "Starting minecraft server version" | 6097 | 5419 |
| Paper prints "Done" | 7290 | 6647 |
| Protocol ready | **7343** | **6698** |

The 1.27 s between "old container destroyed" and "container created" is the image pull (`ensureImageExists` →
`ImagePull` on every create, a registry round trip even though the image is cached). Everything Wings does besides that
and the destroy/create is small: the whole preflight (including a recursive chown over this server's 511 files and the
Panel sync) costs ~40 ms. From "container started" to "ready" stock Wings and direct Docker are identical (5.87 s vs
5.95 s): **~78% of a stock start is the JVM and Paper, which no Wings change can touch.**

Charts: [start-warm](charts/start-warm.svg), [start-cold](charts/start-cold.svg), [restart-warm](charts/restart-warm.svg),
[restart-cold](charts/restart-cold.svg) (stacked: to container start / JVM + Paperclip / Paper init / Done → protocol
ready).

## Lifecycle read from source (Wings `develop` @ `cba8315`)

Start: power lock → Panel `Sync()` (one HTTP GET) → disk-space check (non-stale: full directory walk if the cached size
is older than `disk_check_interval`=150 s) → egg config-file updates → `check_permissions_on_boot` (default **true**):
recursive `lchown` of the whole server root → `ContainerRemove` + `Create()` on **every** start → `ImagePull` →
`ContainerCreate` → attach → `ContainerStart`. Ready state comes from the egg's console regex. Stop: egg stop command
over stdin, waits up to 10 minutes. Per-server power lock only; independent servers are not serialised.

One finding outside the tables: a console `stop` typed while Paper is still booting is not acted on. A Wings daemon that
auto-started a server at boot and was then asked to stop it waited the full 10-minute `WaitForStop` timeout and
SIGKILLed it. Not changed here.

## Pitfalls found while building the harness (kept so the numbers can be trusted)

- Sharing one HTTP keep-alive connection across threads returned a stale `200` for the power call; fixed (per-thread
  connection). No reported number was produced by the faulty version.
- Cross-session drift of ~0.5 s exists on this VM (the same direct-Docker case measured 6.70 s in the baseline session
  and 5.94 s in the final one). Therefore every before/after claim uses **interleaved** runs from one session
  ([`data/final`](data/final), [`data/control`](data/control)); the first-session baseline is only used for the
  stage-level description above.
- Startup-oriented JVM flags were tried and did not help (see `wings-optimizations.md`).

## Reproduce

```bash
# inside the Linux/WSL host, as root, with the lock /bench/locks/wings-session held
bench/wings/make_template.sh /path/paper.jar /bench/wings-opt/templates/world-min
OUTROOT=out/baseline TAG=stock N=20 bench/wings/baseline.sh        # direct vs Wings, start+restart, warm+cold
OUT=out/final ROUNDS=4 PER=5 bench/wings/ab.sh                     # interleaved direct / stock / p1 / p2
OUT=out/control ROUNDS=3 PER=5 bench/wings/ab2.sh                  # stock / unmodified develop / p1 / p2
python3 bench/wings/summarize.py out/final                         # tables
python3 bench/wings/dashboard.py out                               # live dashboard (prints a tokenised URL)
python3 bench/wings/report.py --out docs/benchmarks a=out/final    # charts + wings-performance.json
```
