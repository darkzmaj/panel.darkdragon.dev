#!/usr/bin/env python3
"""CRaC checkpoint/restore experiment for CanvasMC / DivineMC. PREPARED, NOT YET EXECUTED: needs Docker + a CRaC JDK + CRIU (WSL2).

    crac_experiment.py --crac-jdk /opt/crac-jdk --template TPL_DIR --out DIR [--runs 5] [--image IMG] [--dry-run]

Run check_prereqs.sh first. Phases (each writes its outcome to DIR/crac.json; a failing phase STOPS the experiment and the
failure text is the result -- a failed checkpoint is a legitimate, expected-possible outcome, not an error of the harness):

  A. checkpoint  boot the server from a COPY of the template under the CRaC JDK with -XX:CRaCCheckpointTo, wait for protocol
                 readiness (probe.wait), then `jcmd 1 JDK.checkpoint`. Records checkpoint wall time, image size, and whether the
                 JVM refused (stock Paper/Canvas keep sockets and region files open and have no CRaC Resource hooks, so
                 "CheckpointException: Open FileDescriptor/socket" is the likely first result).
  B. restore     N times: fresh container, `java -XX:CRaCRestoreFrom=...`; T0 = just before `docker run`; ready = first valid
                 Server List Ping (probe.wait); also a controlled join (probe.join). Records ready_ms per run.
  C. compare     the same N runs of the AOT template (no CRaC) are NOT done here: use ab3.sh/lifecycle.py for that, in the
                 same session, so drift hits both. This script only reports the CRaC numbers and the checkpoint image cost.

What a restored process shares with the checkpointed one -- why this is hazardous, and what the harness does about it:
  * world files: the restore starts from the on-disk world at CHECKPOINT time. Every restore gets a fresh copy of the
    checkpoint-time directory (never the live one), so no two restores share files;
  * network identity/ports: the container is recreated with the same published loopback port; one restore at a time;
  * RNG/time/UUID state is duplicated: never restore the same image twice concurrently or reuse it across players without
    reseeding. (Needs an application-level Resource hook; out of scope for this harness, noted in the report.)
The container needs capabilities (CHECKPOINT_RESTORE, SYS_PTRACE, usually SYS_ADMIN) that the production flags drop. They are
added ONLY to these experiment containers, loopback-published, never to the pool/Wings shape.
"""
import argparse, json, os, shutil, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import containers  # noqa: E402
import probe  # noqa: E402

ns = time.perf_counter_ns
CAPS = ["CHECKPOINT_RESTORE", "SYS_PTRACE", "SYS_ADMIN"]
JDK_MOUNT = "/opt/crac-jdk"
IMG_DIR = "/home/container/crac-image"


def crac_run_args(name, port, root, image, mem_mb, jdk, java_args):
    """Same shape as containers.run_args, plus the checkpoint capabilities, the CRaC JDK mounted read-only, and an
    unconfined seccomp profile only if --seccomp-unconfined is requested explicitly (some CRIU builds need it)."""
    base = containers.run_args(name, port, root, image, mem_mb, [f"{JDK_MOUNT}/bin/java", *java_args])
    i = base.index("--cap-drop")
    out = base[:i + 2]                                   # keep --cap-drop ALL, then add back only what CRIU needs
    for c in CAPS:
        out += ["--cap-add", c]
    out += base[i + 2:]
    j = out.index("-v")
    out[j:j] = ["-v", f"{jdk}:{JDK_MOUNT}:ro"]
    return out


def plan(a):
    """Pure description of every step, used by --dry-run and the tests."""
    work = Path(a.out) / "work"
    ckpt_dir = work / "checkpoint-src"
    steps = [{"phase": "A", "what": "copy template", "argv": ["cp", "-a", a.template, str(ckpt_dir)]},
             {"phase": "A", "what": "boot under CRaC JDK", "argv": crac_run_args(
                 "crac-ckpt", a.port, ckpt_dir, a.image, a.mem_mb, a.crac_jdk,
                 [f"-XX:CRaCCheckpointTo={IMG_DIR}", "@/home/container/jvm.args"])},
             {"phase": "A", "what": "checkpoint", "argv": ["docker", "exec", "crac-ckpt", f"{JDK_MOUNT}/bin/jcmd", "1", "JDK.checkpoint"]}]
    for k in range(a.runs):
        d = work / f"restore-{k}"
        steps += [{"phase": "B", "what": f"fresh copy for restore {k}", "argv": ["cp", "-a", str(ckpt_dir), str(d)]},
                  {"phase": "B", "what": f"restore {k}", "argv": crac_run_args(
                      f"crac-rest-{k}", a.port, d, a.image, a.mem_mb, a.crac_jdk, [f"-XX:CRaCRestoreFrom={IMG_DIR}"])}]
    return steps


def sh(*argv, check=True):
    return subprocess.run(argv, capture_output=True, text=True, check=check)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--crac-jdk", required=True)
    ap.add_argument("--template", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--image", default="ghcr.io/pterodactyl/yolks:java_21")   # base OS userland only: java comes from --crac-jdk
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--port", type=int, default=25597)
    ap.add_argument("--mem-mb", type=int, default=2355)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    steps = plan(a)
    if a.dry_run:
        for s in steps:
            print(f"[{s['phase']}] {s['what']}: " + " ".join(s["argv"]))
        return 0
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    res = {"config": vars(a), "started": time.strftime("%FT%TZ", time.gmtime()), "phases": {}}
    work = out / "work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    try:
        # ---- A: checkpoint
        src = work / "checkpoint-src"
        sh("cp", "-a", a.template, str(src))
        (src / "jvm.args").write_text(f"-XX:CRaCCheckpointTo={IMG_DIR}\n" + (src / "jvm.args").read_text())
        sh("chown", "-R", "988:988", str(src))
        sh("docker", "rm", "-f", "crac-ckpt", check=False)
        sh(*crac_run_args("crac-ckpt", a.port, src, a.image, a.mem_mb, a.crac_jdk, ["@/home/container/jvm.args"]))
        r = probe.wait("127.0.0.1", a.port, timeout=300)
        pa = {"booted": bool(r.get("status_ns"))}
        if pa["booted"]:
            t = ns()
            p = sh("docker", "exec", "crac-ckpt", f"{JDK_MOUNT}/bin/jcmd", "1", "JDK.checkpoint", check=False)
            time.sleep(1)
            pa.update(jcmd_rc=p.returncode, jcmd_out=(p.stdout + p.stderr)[-2000:], checkpoint_ms=(ns() - t) / 1e6,
                      container_status=sh("docker", "inspect", "-f", "{{.State.Status}} {{.State.ExitCode}}", "crac-ckpt", check=False).stdout.strip(),
                      log_tail=sh("docker", "logs", "--tail", "40", "crac-ckpt", check=False).stdout[-3000:])
            img = src / "crac-image"
            pa["image_bytes"] = int(sh("du", "-sb", str(img), check=False).stdout.split()[0]) if img.exists() else 0
        res["phases"]["checkpoint"] = pa
        sh("docker", "rm", "-f", "crac-ckpt", check=False)
        if not pa.get("image_bytes"):
            res["verdict"] = "checkpoint FAILED: no image written (see phases.checkpoint.log_tail for the exact exception)"
            return 2
        # ---- B: restore
        runs = []
        for k in range(a.runs):
            d = work / f"restore-{k}"
            sh("cp", "-a", str(src), str(d))
            name = f"crac-rest-{k}"
            sh("docker", "rm", "-f", name, check=False)
            t0 = ns()
            sh(*crac_run_args(name, a.port, d, a.image, a.mem_mb, a.crac_jdk, [f"-XX:CRaCRestoreFrom={IMG_DIR}"]))
            r = probe.wait("127.0.0.1", a.port, timeout=120)
            row = {"run": k, "ready_ms": (ns() - t0) / 1e6 if r.get("status_ns") else None}
            if row["ready_ms"]:
                try:
                    row["join"] = probe.join("127.0.0.1", a.port, name="cracbot", timeout=30)
                except Exception as e:
                    row["join_error"] = repr(e)
            else:
                row["log_tail"] = sh("docker", "logs", "--tail", "40", name, check=False).stdout[-2000:]
            sh("docker", "rm", "-f", name, check=False)
            runs.append(row)
        res["phases"]["restore"] = runs
        ok = [r["ready_ms"] for r in runs if r["ready_ms"]]
        res["verdict"] = f"{len(ok)}/{len(runs)} restores reached protocol readiness" + (f", median {sorted(ok)[len(ok)//2]:.0f} ms" if ok else "")
        return 0 if ok else 3
    finally:
        res["finished"] = time.strftime("%FT%TZ", time.gmtime())
        (out / "crac.json").write_text(json.dumps(res, indent=1))
        print(res.get("verdict", "aborted before a verdict"))
        shutil.rmtree(work, ignore_errors=True) if res.get("verdict", "").startswith("checkpoint FAILED") else None


if __name__ == "__main__":
    sys.exit(main())
