# Wings final results

Environment and method: [`wings-startup-baseline.md`](wings-startup-baseline.md). Changes: [`wings-optimizations.md`](wings-optimizations.md).
Machine-readable: [`wings-performance.json`](wings-performance.json); raw runs under [`data/`](data/).
Everything is **WSL2-virtualised** on one i7-14700KF host, **one workload** (Paper 1.21.11, no plugins, 249 MB world) and
**one server at a time**; read it as "what is measured here", not as a node benchmark.

## Leaderboard (interleaved run, n=20 per cell, ms, median / p95)

"Gobia Wings" = fork with `image_pull_policy: periodic` + `reuse_containers: true`. "Direct Docker" is built from the
`docker` CLI with Wings' exact container flags (so it pays ~0.4 s of CLI overhead a daemon does not).

| Metric | Direct Docker | Stock Wings v1.13.3 | Gobia Wings | Winner |
|---|---|---|---|---|
| API/command overhead (HTTP accepted) | n/a (CLI create+start returns after ~440 ms) | 0.6 / 0.7 | 0.5 / 0.8 | stock ≈ Gobia |
| Time to container started (start) | 676 / 719 | 1483 / 1696 | **178 / 207** | Gobia |
| Time to container started (restart, incl. old shutdown) | 1101 / 1157 | 2187 / 2233 | 1058 / 1100 | Gobia ≈ direct |
| Paper "Starting" line (JVM + bootstrap) | 4812 | 5673 | **4373** | Gobia |
| Paper "Done" | 5898 | 6779 | **5458** | Gobia |
| **Protocol-ready, cold start** | 5941 / 6022 | 6825 / 7023 | **5501 / 5588** | **Gobia** |
| **Protocol-ready, graceful restart** | 6411 / 6460 | 7481 / 7547 | **6385 / 6543** | Gobia ≈ direct |
| Stop (`die` event after the stop request) | 860 | 854 | 949 (start scenario) / 866 (restart) | direct ≈ stock |
| Client login while already running | – | – | see "Warm" | – |
| Wings daemon RAM, idle / with 1 server | – | 9.6 / 9.9 MiB | 8.0 / 8.8 MiB | Gobia (tiny) |
| Wings daemon CPU, idle / with 1 server | – | 0.02% / 0.02% | 0.00% / 0.02% | tie |

Percentages (Gobia vs stock): **cold start −1324 ms (−19.4%)**, p95 −1435 ms (−20.4%); **graceful restart −1096 ms
(−14.7%)**, p95 −1004 ms (−13.3%). Fastest single cycles: start 5440 ms, restart 6295 ms. Control run (unmodified
upstream develop as the baseline instead of v1.13.3): start −18.8%, restart −15.7%.
Charts: [start-warm](charts/start-warm.svg) · [restart-warm](charts/restart-warm.svg) · [start-cold](charts/start-cold.svg) ·
[restart-cold](charts/restart-cold.svg).

Not measured: P99 (n too small), Panel-side stages T1/T12, client join beyond login, concurrent starts, load, larger
worlds, plugins, multiple servers, forced-kill recovery.

## Answers to the headline questions

- **Fastest confirmed Paper start (protocol-ready): 5.44 s; median 5.50 s, p95 5.59 s.** The five-second goal was **not**
  reached. The remaining time is the JVM and Paper's bootstrap (4.2 s) plus world preparation (1.1 s); Wings contributes 0.18 s.
- **Millisecond cold starts are not possible** with this server software; no such claim is made. Command dispatch is
  sub-millisecond (HTTP `202` in 0.5 ms) but that is not the server starting.
- **Stock Wings vs direct Docker:** stock Wings is 0.9 s (+15%) slower for a start and 1.07 s (+17%) for a restart in the same
  session, almost entirely the per-start image pull. After the patches the daemon is *faster* than a CLI-driven direct start.

## Warm instance activation (pool primitive only)

`bench/wings/warm.py`, 30 samples, one already-running ready server, offline-mode login up to Login Success:
claim (Wings status lookup) **0.6 ms median**; connect → Login Success **49 ms median, 55 ms p95** (min 33 ms); request to
accepted **~50 ms**. This is the time to put a player on an instance that is *already running*; it is **not** a cold
start and includes no proxy hop (a Minekube Gate relay was not run) and no pool manager (selection, allocation, reset,
replacement were not built). A replacement for a claimed instance costs one cold start (5.5 s). Paper throttles repeated
logins from one address for 4 s (`connection-throttle`), so samples were spaced 4.3 s; a proxy fronting a pool should
disable that throttle for its own address.

## Correctness and safety validation (optimized build, `bench/wings/validate.py`, all pass)

| Check | Result |
|---|---|
| Reuse engages | same container id across two starts (62 reuse log lines during the runs) |
| A Panel limit change is not masked by reuse | memory 2048→2560 MB recreated the container with the new limit (2.95 GB vs 2.47 GB cgroup) |
| World saved and data kept | file written through the API survived; `level.dat` rewritten by the graceful stop |
| Filesystem ownership | 0 entries not owned by 988:988 after all cycles |
| Wings restart does not kill game servers | Wings container restarted while Paper ran: server stayed running, Wings re-attached (state `running`) |
| Backup | Panel-created backup completed |
| Isolation on a reused container | read-only rootfs, no-new-privileges, 10 dropped caps, pids limit 512, memory limit present |
| Unit tests | `internal/ufs`, `server/filesystem`, `config` pass; new race test fails on upstream code |

## Not validated (so "production-ready" is not claimed)

SFTP, crash detection/recovery, concurrent starts (5/10/20), node under CPU/disk/memory pressure, multi-hour leak/race
soak, plugin sets, large worlds, image-update behaviour of `periodic`, Gobia Panel end-to-end with the fork, forced
restart, shutdown during heavy world writes. The stop being 100–190 ms slower after a reused start is unexplained.

## Should Gobia Wings replace stock Wings?

**Not yet.** The image-pull skip is low-risk, upstream-friendly and gives −1.0 s per start/restart; it is the change worth
proposing upstream and trialling on a staging node first. Container reuse adds only ~0.1–0.25 s and carries the
correctness risk, so keep it off until the unvalidated list above is covered. The race fix is a plain bug fix. Large
further gains need to come from the workload (a warm pool in front of Gate, lighter server software), not from Wings.
