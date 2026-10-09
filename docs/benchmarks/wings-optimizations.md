# Wings optimizations

**Implemented and proven: none.** The brief requires baseline data before any change; none exists yet
(`wings-startup-baseline.md`). The table lists hypotheses read from Wings `develop` @ `cba8315`, in the order they should be
*tested*, not a ranking of measured savings. Each must be benchmarked in isolation, kept only if reproducible, and ship
behind a feature flag with a rollback.

| # | Hypothesis | Where | Expected effect | Risk / guard |
|---|---|---|---|---|
| 1 | Skip `ImagePull` when the image is already present locally (inspect first; pull only if missing or a refresh interval elapsed) | `environment/docker/container.go` `ensureImageExists` | Removes a registry round trip per start; size unknown until measured (network-bound) | Stale tags: keep a periodic refresh. Upstream-friendly |
| 2 | Reuse the container when its create-time inputs are unchanged (hash image, env, mounts, limits, allocations, labels) instead of remove+create | `OnBeforeStart` | Saves remove + create + layer setup | Must invalidate on any Panel-synced change; limits/ports/env correctness is the whole risk |
| 3 | Skip the recursive chown when ownership is provably intact (e.g. a marker written after a successful full chown, invalidated by SFTP/file writes/restores/transfers) | `onBeforeStart`, `Filesystem().Chown` | Scales with file count; could dominate on large worlds | Cross-tenant file exposure if the marker is wrong. Needs design review before any code |
| 4 | Avoid the non-stale disk scan on start (`HasSpaceErr(false)`) | `onBeforeStart` | Scales with directory size | Quota enforcement must still hold; allow a bounded staleness |
| 5 | Protocol-level readiness (Server List Ping) in addition to the egg regex, for accurate status | `server` state handling | Accuracy, not speed | Must not mark ready early |
| 6 | Docker event stream instead of polling, shared client | various | Unknown; first check whether polling exists on the hot path | |

Outside Wings (likely larger for Minecraft; to be measured separately): JVM startup flags (AppCDS, `-Xshare`,
`-XX:TieredStopAtLevel`), plugin count, world size, pre-generated chunks, warm instance pools behind a proxy (Gate) for
sub-second player routing. Pool activation time is a different metric from cold start and must be reported separately.
JVM/CRaC/CRIU snapshots are not to be attempted without proving Java and plugin compatibility.

Upstream note: the newest upstream commit at the time of reading is "Avoid syncing the server environment twice on
start" (2026-10-09), so upstream is itself trimming this path; re-diff before forking.
