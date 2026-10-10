#!/usr/bin/env python3
"""Simultaneous cold starts: launch N servers at the same instant and time each one to protocol readiness.

    conc.py --template DIR --image IMG --n 10 --out DIR [--mem-mb 1536] [--repeat 3] [--ports-base 25700]

World directories are prepared BEFORE the start line (overlayfs: private copy-on-write layer on the immutable template),
so the measured interval is container create + JVM + server, the part a start storm stresses. Host CPU use is sampled
from /proc/stat every 200 ms and RAM from /proc/meminfo, each instance's RSS from its cgroup at the end.
All intervals use perf_counter_ns in this one process (monotonic).

Reliability: a server that fails to start is recorded as a failure (it never aborts the round), every round is cleaned up in
a `finally`, and the run refuses to start when N x --mem-mb does not fit in the host's available RAM (an over-committed host
would measure the OOM killer, not the servers). Container flags come from containers.run_args (shared with pool.py).
"""
import argparse, concurrent.futures as cf, json, shutil, statistics, subprocess, sys, threading, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import containers  # noqa: E402
import probe  # noqa: E402

ns = time.perf_counter_ns


def sh(*a, check=True):
    return subprocess.run(a, capture_output=True, text=True, check=check)


def parse(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--image", default="ghcr.io/pterodactyl/yolks:java_25")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--mem-mb", type=int, default=1536)
    ap.add_argument("--port-base", type=int, default=25700)
    ap.add_argument("--boot-timeout", type=int, default=240)
    ap.add_argument("--headroom", type=float, default=0.9, help="max fraction of MemAvailable the servers may be limited to")
    ap.add_argument("--work", default="/bench/wings-opt/p2/conc-work")
    ap.add_argument("--out", required=True)
    return ap.parse_args(argv)


def cpu():
    f = open("/proc/stat").readline().split()[1:]
    v = list(map(int, f))
    return sum(v), v[3] + v[4]  # total, idle+iowait


def mem_available_mb():
    return [int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith("MemAvailable")][0] // 1024


def preflight(a, available_mb=None):
    avail = mem_available_mb() if available_mb is None else available_mb
    need = a.n * a.mem_mb
    if a.n < 1 or a.repeat < 1:
        raise SystemExit("--n and --repeat must be >= 1")
    if need > avail * a.headroom:
        raise SystemExit(f"refusing to start: {a.n} x {a.mem_mb} MB = {need} MB exceeds {a.headroom:.0%} of the "
                         f"{avail} MB available; lower --n/--mem-mb (an over-committed host measures the OOM killer)")
    containers.check_overlay_path(a.template)
    containers.check_overlay_path(a.work)


def sampler(stop, out):
    t0, i0 = cpu()
    while not stop.is_set():
        time.sleep(0.2)
        t1, i1 = cpu()
        out.append((ns() / 1e6, 100.0 * (1 - (i1 - i0) / max(1, t1 - t0)), mem_available_mb()))
        t0, i0 = t1, i1


def prep(a, i, tag):
    d = Path(a.work) / f"{tag}-{i}"
    for sub in ("up", "wk", "mnt"):
        (d / sub).mkdir(parents=True, exist_ok=True)
    sh("mount", "-t", "overlay", "overlay", "-o", f"lowerdir={a.template},upperdir={d / 'up'},workdir={d / 'wk'}", str(d / "mnt"))
    sh("chown", "988:988", str(d / "up"))
    return d


def boot(a, i, tag, T0, run=sh, wait=probe.wait):
    """One start. Never raises: a failed start is a result row, so one bad container cannot abort (or leak) the round."""
    d = Path(a.work) / f"{tag}-{i}"
    name = f"conc-{tag}-{i}"
    port = a.port_base + i
    try:
        run(*containers.run_args(name, port, d / "mnt", a.image, a.mem_mb, ["java", "@/home/container/jvm.args"]))
        t_started = ns()
        r = wait("127.0.0.1", port, timeout=a.boot_timeout)
        t_ready = ns()
        return {"i": i, "container_started_ms": (t_started - T0) / 1e6,
                "ready_ms": (t_ready - T0) / 1e6 if r.get("status_ns") else None,
                **({} if r.get("status_ns") else {"error": r.get("error", "no status")})}
    except Exception as e:
        return {"i": i, "container_started_ms": None, "ready_ms": None, "error": repr(e)}


def cleanup(a, tag, n):
    for i in range(n):
        sh("docker", "rm", "-f", f"conc-{tag}-{i}", check=False)
    for i in range(n):
        d = Path(a.work) / f"{tag}-{i}"
        r = sh("umount", str(d / "mnt"), check=False) if (d / "mnt").exists() else None
        if r is not None and r.returncode != 0:
            sh("umount", "-l", str(d / "mnt"), check=False)
        if (d / "mnt").exists() and (d / "mnt").is_mount():
            print(f"WARNING: {d / 'mnt'} is still mounted; not deleting it", file=sys.stderr)
            continue
        shutil.rmtree(d, ignore_errors=True)


def round_summary(rows, samples, mem_lines):
    ready = [r["ready_ms"] for r in rows if r["ready_ms"]]
    return {"rows": rows, "ready_median": statistics.median(ready) if ready else None,
            "ready_max": max(ready) if ready else None, "failed": sum(1 for r in rows if not r["ready_ms"]),
            "peak_cpu_pct": round(max((s[1] for s in samples), default=0.0), 1),
            "min_mem_available_mb": min((s[2] for s in samples), default=None), "mem_usage": mem_lines}


def overall(res, n):
    allr = [r["ready_ms"] for rd in res["rounds"] for r in rd["rows"] if r["ready_ms"]]
    mem = [rd["min_mem_available_mb"] for rd in res["rounds"] if rd["min_mem_available_mb"] is not None]
    return {"n": n, "samples": len(allr), "median": round(statistics.median(allr)) if allr else None,
            "max": round(max(allr)) if allr else None, "failed": sum(rd["failed"] for rd in res["rounds"]),
            "peak_cpu_pct": max((rd["peak_cpu_pct"] for rd in res["rounds"]), default=0),
            "min_mem_available_mb": min(mem) if mem else None}


def main(argv=None):
    a = parse(argv)
    preflight(a)
    Path(a.work).mkdir(parents=True, exist_ok=True)
    res = {"config": vars(a), "rounds": []}
    for rep in range(a.repeat):
        tag = f"r{rep}"
        cleanup(a, tag, a.n)
        try:
            for i in range(a.n):
                prep(a, i, tag)
            samples, stop = [], threading.Event()
            th = threading.Thread(target=sampler, args=(stop, samples), daemon=True)
            th.start()
            T0 = ns()
            with cf.ThreadPoolExecutor(a.n) as ex:
                rows = list(ex.map(lambda i: boot(a, i, tag, T0), range(a.n)))
            time.sleep(2)
            stop.set()
            th.join()
            mem = sh("docker", "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}", check=False).stdout
            res["rounds"].append(round_summary(rows, samples, [l for l in mem.splitlines() if l.startswith("conc-")]))
        finally:
            cleanup(a, tag, a.n)
    Path(a.out).mkdir(parents=True, exist_ok=True)
    Path(a.out, f"conc-{a.n}.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(overall(res, a.n)))


if __name__ == "__main__":
    main()
