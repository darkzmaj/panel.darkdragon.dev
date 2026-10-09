# Wings startup baseline

**Status: not measured.** No live number in this document or in `wings-performance.json` comes from a run. The
session that produced it had no Linux host and no Docker (Windows 11, no WSL, no Docker, no Go toolchain). The task
forbids substituting mocks, so the deliverable here is the harness, the lifecycle analysis read from source, and a
list of what each later measurement must show.

## What was verified

| Item | Value | Source |
|---|---|---|
| Panel | `1.15.1-gobia.1` | `VERSION` |
| Upstream Wings read | `develop` @ `cba8315bceda926241d6f86e78b3bd52cf15e41f` (2026-10-09), latest tag `v1.13.3` | GitHub, shallow clone |
| Harness self-checks | `probe.py selftest`, `summarize.py selftest` pass; `run.sh` passes `bash -n`; dashboard rejects a bad token and exports | run locally (Windows) |
| Harness against real Docker/Paper | **not run** | no Linux host |

Wings/Panel API compatibility of `v1.13.3` with the Gobia Panel is **unverified** (see `wings-compatibility.md`).

## Lifecycle read from source (Wings `develop` @ cba8315)

Start (`server/power.go` `HandlePowerAction` -> `onBeforeStart` -> `environment/docker/power.go` `Start`), in order:

1. Take the per-server power lock (`powerLock`); only that server is serialized.
2. `Sync()`: one HTTP GET to the Panel for the server configuration. Required for suspension/limits freshness; its
   latency is Panel-bound.
3. Disk check: if the server has a disk limit, `HasSpaceErr(false)` (**non-stale**) may walk the whole data directory
   unless the cached size is fresh (`disk_check_interval`, default 150 s). Unlimited disk only kicks off a size scan.
4. `UpdateConfigurationFiles()`: egg config-file edits, run in parallel, awaited.
5. `check_permissions_on_boot` (default `true`): **recursive chown of the entire server root on every start.** Cost
   scales with file count (worlds, plugins), not with the work Paper needs.
6. `Environment.Start`: `ContainerInspect`, log truncate, then `OnBeforeStart`:
   - **`ContainerRemove` then `Create()` on every start**, "to ensure synced data from the Panel is used".
   - `Create()` -> `ensureImageExists`: **`ImagePull` on every create** (a registry round trip even when the image is
     cached; on failure it falls back to `ImageList`). `~`-prefixed images skip the pull.
   - `ContainerCreate` with the isolation flags (read-only rootfs, dropped caps, no-new-privileges, tmpfs `/tmp`).
7. `Attach` (before start, to avoid a deadlock), `ContainerStart`, `applyCpuBurst`.
8. State goes `starting` -> `running` when the egg's "done" regex matches a console line. That is **log-based
   readiness, not protocol readiness**; `running` can precede or lag the real listener and a changed log format breaks it.

Stop/restart: `WaitForStop` (up to 10 min, egg stop command via stdin, e.g. `stop`, or a signal), then the start path
above. Terminate takes the lock only opportunistically.

Unavoidable waiting: Panel sync (freshness), the JVM, Paper itself. Candidate-avoidable: items 3 and 5, the container
remove+create, and the per-start image pull. None of this is a measured saving yet; ranking requires data.

## Measurement definitions

One readiness definition for every case: **T10 = first valid Server List Ping reply** (`probe.py`: handshake, status
request, reply must parse with a `version` object). T8 (console `Done (`) and T9 (TCP accept) are recorded as separate
stages. T11 (client join) needs a controlled account and is not implemented. T12 (Panel shows ready) needs Panel-side
instrumentation and is not implemented.

| Stage | Recorded by |
|---|---|
| T0 start command issued | `run.sh` `date +%s%N` just before `docker start` / Wings API call |
| T1/T2/T3 Panel dispatch, Wings receive, lifecycle begin | Wings only: `dispatch_ms` from curl; true T2/T3 need Wings debug log timestamps or fork tracing (not done) |
| T4/T5 Docker op, container started | `docker events` `timeNano` (`start`) |
| T6/T7 JVM / Paper init | **not instrumented**; needs `-Xlog` or an in-container timestamp |
| T8 Paper "Done" | Docker log timestamp of the first `Done (` line |
| T9/T10 TCP / protocol ready | `probe.py`, wall-clock ns, 5 ms poll interval (a floor on resolution) |
| Stop | `die` event time minus stop request time |

Clock: all timestamps are wall-clock ns on one host (`date +%s%N`, `time.time_ns`, Docker `timeNano`), so they are
comparable only on that host and subject to NTP slew. They are not monotonic clocks; this deviates from the brief.

## Reproduce

On a **staging** Linux node with Docker, Python 3, root (for page-cache drops):

```bash
cd bench/wings
MODE=direct SERVER_DIR=/srv/bench/paper-min IMAGE=ghcr.io/pterodactyl/yolks:java_21 PORT=25570 MEM=2048 N=20 OUT=out/direct-min ./run.sh
python3 summarize.py out/direct-min > out/direct-min.json
python3 dashboard.py out        # prints a tokenised 127.0.0.1 URL
```

`MODE=wings` additionally needs `WINGS_URL`, `WINGS_TOKEN`, `SERVER_UUID` of a server created in the Panel with the same
files. Use the same image, `SERVER_DIR`, memory and ports for every case, pull the image first, and discard run 1 as
warm-up if comparing warm starts. Cold-cache runs require `drop_caches`; without root the script warns and the runs are
warm-cache.

Known harness limits: stop path differs between cases (direct uses SIGTERM and Paper's shutdown hook; Wings sends the
egg's `stop` command); Paper's world save on exit is not separately timed; load, concurrency and Wings-restart tests are
not scripted yet.
