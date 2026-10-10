# Gobia Wings Phase 2: engineering handoff (cloud session -> WSL2)

Scope of the cloud session: source-level review, fixes, automated tests, preparation of the remaining experiments. **No Docker
daemon, Java 25, Minecraft server, Wings or Gate exists in the cloud container, so no benchmark was run and no performance number
in this document is new.** Numbers quoted from earlier work are marked as such and are in
[phase2-reported-local-results.md](phase2-reported-local-results.md). Nothing here is production-ready.

## 1. The Gobia Wings fork is NOT in the cloud-accessible source
* This repository (`Cryvex-Dev/panel.gobia.cloud`) has no `.go` file and no `go.mod`; `git ls-files` shows only the benchmark tooling and docs.
* `docs/benchmarks/wings-optimizations.md` places the fork at `C:\Users\majko\Documents\PROJECTS\gobia-wings`, branch `gobia/perf`
  (base upstream `develop` `cba8315b`), and says "nothing was pushed anywhere".
* The session's repository scope lists only this repo and `list_repos` returned no repository matching `wings`.
Consequence: the Go changes (`image_pull_policy: periodic`, `reuse_containers`, the `ListDirectory` fix) could **not** be reviewed
or tested in the cloud. Their only evidence is the earlier local measurements and `GOBIA.md` in that local repo. To get them reviewed:
push `gobia/perf` to its own (private) repository, e.g. `Cryvex-Dev/gobia-wings`, never into this one; this session never pushed it.

## 2. Code review findings (bench tooling) and what was done
Severity: **H** wrong or unsafe results/behaviour, **M** reliability, **L** hygiene. "Fixed" = covered by an executed test.

| # | Sev | File | Finding | Status |
|---|---|---|---|---|
| 1 | H | pool.py | `route()` snapshotted the route table before taking the gate lock; a delayed older snapshot overwrote a newer one, so a match's route was lost and its join failed (reproduced deterministically; the test fails on the old design) | fixed: table built inside the gate lock |
| 2 | H | pool.py | `end_match` left the finished match's route in Gate while its port was recycled; `m<id>.pool.test` could reach a later match on the same port (cross-match access) | fixed: route removed and applied before the port is freed |
| 3 | H | pool.py | after a match, nothing refilled the pool; with `max_size == size` the pool stayed drained (found by a test) | fixed: refill after destroy |
| 4 | H | pool.py | a failing boot (bad image, busy port, disk) respawned a replacement immediately, forever, with no back-off | fixed: exponential back-off, breaker after `--max-failures`, explicit `reset()` |
| 5 | M | pool.py | `reserve()` held the pool lock across a 0.5 s network ping per candidate: concurrent allocations serialised and `route`/boot completion blocked | fixed: state change under the lock, ping outside it |
| 6 | M | pool.py | `fill()` computed the gap under the lock but spawned outside it; concurrent callers could overshoot `size` | fixed |
| 7 | M | pool.py | `stop()` did not cancel boots in flight; a failing boot after stop respawned containers; `port_free.pop(0)` could raise on exhaustion; Gate process/log leaked if it failed to start | fixed (cancel event, closing flag, bounded ports, cleanup) |
| 8 | M | pool.py | a failed join leaked nothing only by accident; routes/instances are now always retired in `finally` | fixed |
| 9 | M | pool.py | idle servers that crashed were found only by the next player's reservation | added `sweep()` + `--chaos-every` kill test |
| 10 | M | pool.py | umount failure followed by `rmtree` could delete through a live mount; template path with `,` or `:` would corrupt the overlay option string | fixed: lazy umount fallback, never rmtree a mount, path validation |
| 11 | H | mkvariant.py | the AOT/CDS training boot ran **inside the measured template**: it rewrote world, logs and configs, so variants were not byte-equivalent workloads | fixed: train in a scratch copy, measured template = clean base + `jvm.args` + archive |
| 12 | H | mkvariant.py | training ran without the production memory limit/user/rootfs shape; heap sizing (`MaxRAMPercentage`) differs, and an archive built under another heap/GC shape can be rejected **silently** (JVM falls back to a normal boot, which a benchmark would then time as "AOT") | fixed: same container shape (`--mem-mb`, default 2355 = the 2469606195 B lifecycle gives direct and Wings), `--strict` (`-XX:AOTMode=on`) and `--verify` |
| 13 | M | mkvariant.py | `default` vs `aot` differed in two things (Paperclip bypass + AOT) so a gain could not be attributed | added `--bypass` variant and `VARS="default bypass aot"` in ab3.sh |
| 14 | M | mkvariant.py | Paperclip metadata paths used verbatim in the class path (`../`, absolute) | rejected |
| 15 | H | lifecycle.py | variants of one server share one Wings volume; protection depended on a reset flag with no verification | fixed: fingerprint (jvm.args hash, jar/archive sizes) asserted after every reset and before every cycle, written to each row as `files_fp`; `check_results.py runs` compares fingerprints across direct/stock/gobia |
| 16 | M | lifecycle.py | module-level argparse/side effects made the logic untestable; `TimeoutError` had no message; direct mode needed the Wings token but the refactor first dropped it | fixed (`init()`, messages, token kept) |
| 17 | M | conc.py | one failed `docker run` raised out of `ex.map`, aborting the round and leaking containers/mounts (no `finally`); `max()`/`median()` crashed on empty; no memory over-commit guard | fixed (failure rows, `finally`, guards, `preflight`) |
| 18 | M | conc.py | no `--cap-drop ALL`, unlike pool.py | fixed: both use `containers.run_args` |
| 19 | L | probe.py | frame length unbounded (a garbage length waits for a timeout); `join(timeout)` was per-packet, not total; `wait()` not cancellable | fixed |
| 20 | L | ab3.sh | background `docker events` never killed; the variant order was fixed (always default first) | fixed (trap; server/variant/daemon order rotates per round) |
| 21 | info | pool.py/Gate | Gate's config API is unauthenticated; bound to loopback only. The Gate binary at `GATE_BIN` is not checksum-verified | accepted for a benchmark; do not expose the API port |

## 3. Tests actually executed (cloud, no Docker)
`bash bench/wings/run_tests.sh` -> compile all scripts, `bash -n` all shell scripts, `summarize.py selftest`, `probe.py selftest`,
and **94 unit/integration tests, all passing, 5 consecutive runs without a flake** (~10 s). They use fakes only: an in-memory pool backend,
an in-process HTTP server that speaks Gate's optimistic-version API, fake Minecraft status servers (real sockets), synthetic Paperclip jars,
and a mocked Docker for `mkvariant`. A mutation check confirmed the Gate race test fails when the old snapshot design is restored.

| Area | Tests | What is proven |
|---|---|---|
| warm pool allocation (`test_pool.py`, 27) | 60 simultaneous reservations over 8 ready instances; 25 repeated rounds; exhaustion; unhealthy instances; failing boots; breaker/reset; transient recovery; `max_starts`; concurrent `fill`; stop/cancel; waiting reserve released by stop; route cleanup ordering; failed join; Gate race (deterministic + 30-thread); stale-version retry; persistent conflict; unreachable Gate; chaos kill; sweep | no instance is ever assigned to two matches, none is reused, no two live instances share a port |
| lifecycle (`test_lifecycle.py`, 12) | fingerprints, contamination detection, reset leaves exactly the template variant, once-per-invocation reset policy, restart readiness gate (old server's answers do not count), log-mark parsing | the shared-volume bug class is detected, not just avoided |
| matrix (`test_ab3.py`, 6) | `ab3.sh` in `DRY_RUN`: all variants of a server get identical uuid/port/image/startup/n/warm-up and differ only in template+label; leading position is balanced; non-equivalent templates abort with exit 3 before any timing | equivalence of workloads is enforced by construction |
| equivalence (`test_equiv.py`, 6), results (`test_check_results.py`, 11), leaks (`test_leakcheck.py`, 4) | file/flag diffs, fingerprint rules across envs, duplicate-instance detection, leak accounting | live data is validated before it is believed |
| misc (`test_misc.py`, 24) | container flags (security posture, injection-proof names), mkvariant (clean template, strict, verify, traversal), probe (open socket != ready, bad JSON, absurd length, cancel, total join deadline), conc (failure rows, preflight) | |
| CRaC plan (`test_crac.py`, 4) | caps minimal, JDK read-only, per-restore directories | |

## 4. Blocked by the missing Docker daemon (nothing below was run)
* any real Minecraft boot, protocol readiness, join, restart, stop timing; all CanvasMC/DivineMC numbers
* `mkvariant.py` against real containers (AOT archive acceptance, `--strict`/`--verify` outcome), `make_variants.sh`
* `pool.py` with real overlay mounts, Gate process, `docker kill` chaos; `conc.py` start storms and host CPU/RAM sampling
* `lifecycle.py` against Wings/direct Docker (docker events, attach, log marks); `ab3.sh` non-dry runs; `soak.sh`; `run_pool_matrix.sh`
* CRaC (needs CRIU, a CRaC JDK, a suitable kernel)
* the Go fork (not available at all, see section 1)

## 5. Warm-pool concurrency assessment
Reading and test result: an instance changes `ready -> reserved` exactly once, in `Pool._take_ready`, under one lock; instance ids are never
reused, so a second match cannot receive the same server, and a destroyed instance's port is released only after its route is removed.
The health ping is outside the lock, so allocation throughput no longer depends on ping latency. Verified under 60-way contention with a slow ping.
Limits that tests cannot prove: (a) health is a status ping, so a server that answers pings but cannot accept joins would still be handed
out (the optional `--prime` bot join narrows this); (b) the pool is single-process, in-memory state: a crash of `pool.py` leaves `pool-*`
containers (use `leakcheck.py`); (c) Gate's real behaviour on `ApplyConfig` (latency, error strings containing "stale"/"version") is assumed
from earlier local use, only a fake was tested; (d) the sub-second target depends on live numbers that do not exist yet.

## 6. Restart benchmark correctness assessment
* The sharing bug: two variants of one server use the same Wings volume. The earlier fix (reset on the first cycle of each invocation) is correct and kept
  (`needs_reset`), but was unverifiable. It is now verified at runtime (`files_fp`) and after the fact (`check_results.py runs`).
* Equal workloads: enforced by `verify_equiv.py` (gate in `ab3.sh`) and by `mkvariant.py` no longer mutating the measured template.
* Timing definition (unchanged, same for all envs): T0 immediately before the start/restart command; ready = first valid Server List Ping
  answered after T0 (after the old container's `die` event for restarts, so the old server's answers cannot count); Paper/Canvas "Done" and
  Wings states are recorded alongside. Restart includes graceful stop, world save, container exit and the next start; stop phases are reported separately.
* Differences between envs that are intended and should be named in the report: direct restart reuses the container (`docker start`), stock Wings recreates
  it, Gobia with `reuse_containers=true` reuses it when the config hash matches.
* **Not yet measured by `lifecycle.py` (do not claim them):** T1 (Panel dispatch; the harness calls the Wings API directly), T6 (JVM begins), T9 as its own
  timestamp (`probe.wait` records it, `lifecycle.py` records only the status answer), T11 (join; only `pool.py`/`probe.join` do it) and T12 (Panel-reported state).
  The Panel-side stages need the end-to-end run with the Panel API as a separate step.
* Caveat: the Wings startup line configured in the Panel for each server must be exactly `java @/home/container/jvm.args`; lifecycle passes it only to direct mode.

## 7. CRaC experiment readiness
Prepared and unit-tested at plan level only: `crac/check_prereqs.sh` (ran in the cloud: correctly reports NOT READY), `crac/crac_experiment.py`
(`--dry-run` prints the exact commands), `crac/README.md` (expected failure modes, tiers, integrity checks). Honest expectation: stock Paper-family servers
probably fail the first checkpoint on open sockets/files; that outcome is still a result. No CRaC claim is made.

## 8. Reproducible local continuation (WSL2, root)
```bash
# 0. get the branch (the tooling lives in this repo, the Go fork stays in your local gobia-wings repo)
cd ~/panel.gobia.cloud && git fetch origin claude/minecraft-wings-perf-b45532-5i915b && git checkout claude/minecraft-wings-perf-b45532-5i915b
cd bench/wings && bash run_tests.sh                                   # must say OK (94 tests) before anything else

# 1. freeze what you already have (see phase2-reported-local-results.md); never edit it afterwards
# 2. build equivalent variants into a NEW directory; old templates stay as they are
sudo ./make_variants.sh canvas /bench/wings-opt/p2/templates/canvas-j25-pc /bench/wings-opt/p2/templates-v2 canvas-j25
sudo ./make_variants.sh divine /bench/wings-opt/p2/templates/dv-pc          /bench/wings-opt/p2/templates-v2 dv
#    (if --verify fails, the AOT archive was not accepted under the production flags: that is a finding, not something to skip)

# 3. start/restart matrix: direct vs stock Wings vs Gobia Wings, default vs bypass vs aot, interleaved
export BENCH=/bench/wings-opt/p2 TEMPLATES=/bench/wings-opt/p2/templates-v2
DRY_RUN=1 OUT=/tmp/ab3-dry ROUNDS=4 PER=5 VARS="default bypass aot" bash ab3.sh | head      # inspect the plan
sudo OUT=/bench/wings-opt/out3/main ROUNDS=4 PER=5 VARS="default bypass aot" bash ab3.sh
python3 check_results.py runs /bench/wings-opt/out3/main --min-n 20                          # must print OK before any number is used
python3 summarize.py /bench/wings-opt/out3/main

# 4. warm pool: allocation + join (needs Minekube Gate at $GATE_BIN)
sudo TEMPLATE=$TEMPLATES/canvas-j25-aot OUT=/bench/wings-opt/out3/pool ./run_pool_matrix.sh

# 5. start storm
for n in 5 10; do sudo python3 conc.py --template $TEMPLATES/canvas-j25-aot --n $n --repeat 3 --out /bench/wings-opt/out3/conc
  python3 check_results.py conc /bench/wings-opt/out3/conc/conc-$n.json; done

# 6. CRaC (only after crac/check_prereqs.sh passes): see crac/README.md
# 7. reliability: 4 h soak (pool waves with chaos kills + start storms [+ Wings restarts with WINGS=1 UUID=...]), leak-checked each loop
sudo TEMPLATE=$TEMPLATES/canvas-j25-aot OUT=/bench/wings-opt/out3/soak DURATION_MIN=240 ./soak.sh
```
Record for every session (the env.json written by lifecycle.py has part of it): CPU model, RAM and speed, storage, kernel, Docker, Wings
version/commit, Java build, server build, JVM flags, world size, plugin count, container limits.

## 9. Remaining live benchmarks (none done in the cloud)
1. Re-run the CanvasMC/DivineMC start and restart matrix with the corrected templates (default/bypass/aot, direct/stock/gobia) and compare with the reported ~2.83 s / ~3.06 s *only if* the same readiness definition and environment apply.
2. Cold-cache start (`--drop-caches`) vs warm; plugin sets (none / small / realistic) and larger worlds on the same matrix.
3. Warm-pool allocation-to-Play: copy vs overlay, with/without `--prime`, pool sizes 3/6, concurrency 1/3/6; the <1 s claim stands or falls here.
4. Start storms of 5 and 10; soak with chaos; Panel end-to-end (T1, T12) and a join (T11) on the lifecycle path.
5. Graceful restart data safety: join, modify the world, restart, verify the change persists; kill -9 / OOM recovery.
6. CRaC tiers 0-1. 7. Review of the Go fork once it is pushed to its own repository.

## 10. What must run on WSL2 and why
Everything in sections 4 and 8: it needs a Docker daemon with the Java 25 yolks image, root for overlay mounts/chown/drop_caches, the Wings
dev stack (`wdev`) for stock/Gobia daemons, the Gate binary, and the hardware whose numbers you want. The cloud cannot substitute for any of these.
