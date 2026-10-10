# CRaC checkpoint/restore experiment (prepared, not executed)

Status: **no CRaC result exists.** The cloud container has no Docker, no CRIU and a stock OpenJDK 21 (no CRaC); `check_prereqs.sh`
there reports `NOT READY`, which is the correct answer for that host. Everything below runs on the WSL2 machine.

## Why it might help, and why it probably will not work out of the box
CRaC restores a process from a memory image, skipping JVM start, class loading, JIT warm-up and the server's own init. If it
worked it would beat AOT caching (which only removes class load/link cost) by a wide margin. But a Minecraft server:
* keeps listening/client sockets, region files and `session.lock` open, and CRaC refuses to checkpoint a JVM with open
  files/sockets that no `Resource` callback closed ("CheckpointException ... open file descriptor"). Paper/Canvas/DivineMC register none.
* holds in-memory world state that diverges from disk after the checkpoint, plus RNG / UUID / clock state that every restore would duplicate.
* needs `CHECKPOINT_RESTORE` + `SYS_PTRACE` (often `SYS_ADMIN`) in the container, which the pool/Wings flags deliberately drop.
* needs a JDK build with CRaC (e.g. Azul Zulu CRaC) of a major version that can run the server (>= 21 for 1.21.x), a kernel with
  `CONFIG_CHECKPOINT_RESTORE` (stock WSL2 kernels often lack it) and CRIU.
So the experiment is staged so that each failure is informative and cheap.

## Run order (WSL2, root)
```bash
cd ~/panel.gobia.cloud/bench/wings/crac
CRAC_JAVA=/opt/zulu-crac/bin/java ./check_prereqs.sh            # tier 0: must print "RESULT: CRaC prerequisites met"
# tier 1: checkpoint the real server and restore it N times. Use a NON-AOT bypass template as the base:
python3 crac_experiment.py --crac-jdk /opt/zulu-crac --template /bench/wings-opt/p2/templates-v2/canvas-j25-bypass \
        --out /bench/wings-opt/out2/crac --runs 5 --dry-run     # review the exact docker commands first
python3 crac_experiment.py --crac-jdk /opt/zulu-crac --template /bench/wings-opt/p2/templates-v2/canvas-j25-bypass \
        --out /bench/wings-opt/out2/crac --runs 5
```
Outcomes and what each means (all recorded in `crac.json`; keep failures, they are results):
| verdict | meaning | next step |
|---|---|---|
| `checkpoint FAILED` + `CheckpointException` text | expected for stock server code | tier 2 below |
| checkpoint ok, restores reach readiness | CRaC is viable for the *process*; compare `ready_ms` with the AOT variant measured in the same session | check data integrity (below) before believing it |
| restore fails | read `log_tail`; usually CRIU/caps/kernel | fix environment, rerun |

**Tier 2 (only if tier 1 fails on file descriptors):** checkpoint *earlier*, before the server opens the port and the world, from a
small `-javaagent`/STARTUP-plugin that closes its own logs and calls `jdk.crac.Core.checkpointRestore()`; or checkpoint a pre-warmed
launcher JVM that has loaded and initialised the server classes and then exec's `main` after restore. Both need Java code that
is not written yet and must not be started until tier 1 shows what is blocking.

## Data-integrity checks required before any CRaC number is used
1. A restored server must load the world from disk as of restore time and save it back (join, build, stop, restart, build is still there).
2. Two restores from one image must not run concurrently (duplicated UUID/RNG/network identity).
3. Compare against `app.aot` in the same session (`ab3.sh`), never against numbers from another day (WSL2 drift was measured at ~0.5 s).
4. Report the image size and checkpoint time; they are part of the cost.
