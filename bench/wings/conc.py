#!/usr/bin/env python3
"""Simultaneous cold starts: launch N servers at the same instant and time each one to protocol readiness.

    conc.py --template DIR --image IMG --n 10 --out DIR [--mem-mb 1536] [--repeat 3]

World directories are prepared BEFORE the start line (overlayfs: private copy-on-write layer on the immutable template),
so the measured interval is container create + JVM + server, the part a start storm stresses. Host CPU use is sampled
from /proc/stat every 200 ms and RAM from /proc/meminfo, each instance's RSS from its cgroup at the end.
All intervals use perf_counter_ns in this one process (monotonic).
"""
import argparse, concurrent.futures as cf, json, os, shutil, statistics, subprocess, sys, threading, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import probe  # noqa: E402

ns = time.perf_counter_ns
ap = argparse.ArgumentParser()
ap.add_argument("--template", required=True)
ap.add_argument("--image", default="ghcr.io/pterodactyl/yolks:java_25")
ap.add_argument("--n", type=int, default=5)
ap.add_argument("--repeat", type=int, default=3)
ap.add_argument("--mem-mb", type=int, default=1536)
ap.add_argument("--port-base", type=int, default=25700)
ap.add_argument("--work", default="/bench/wings-opt/p2/conc-work")
ap.add_argument("--out", required=True)
A = ap.parse_args()


def sh(*a, check=True):
    return subprocess.run(a, capture_output=True, text=True, check=check)


def cpu():
    f = open("/proc/stat").readline().split()[1:]
    v = list(map(int, f))
    return sum(v), v[3] + v[4]  # total, idle+iowait


def sampler(stop, out):
    t0, i0 = cpu()
    while not stop.is_set():
        time.sleep(0.2)
        t1, i1 = cpu()
        mem = [int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith("MemAvailable")][0] // 1024
        out.append(((ns()) / 1e6, 100.0 * (1 - (i1 - i0) / max(1, t1 - t0)), mem))
        t0, i0 = t1, i1


def prep(i, tag):
    d = Path(A.work) / f"{tag}-{i}"
    for sub in ("up", "wk", "mnt"):
        (d / sub).mkdir(parents=True, exist_ok=True)
    sh("mount", "-t", "overlay", "overlay", "-o", f"lowerdir={A.template},upperdir={d / 'up'},workdir={d / 'wk'}", str(d / "mnt"))
    sh("chown", "988:988", str(d / "up"))
    return d


def boot(i, tag, T0):
    d = Path(A.work) / f"{tag}-{i}"
    name = f"conc-{tag}-{i}"
    port = A.port_base + i
    sh("docker", "run", "-d", "--name", name, "--user", "988:988", "--read-only", "--tmpfs", "/tmp:rw,exec,nosuid,size=100M",
       "--security-opt", "no-new-privileges", "--memory", f"{A.mem_mb}m", "--memory-swap", f"{A.mem_mb}m", "--pids-limit", "512",
       "-p", f"127.0.0.1:{port}:25565", "-v", f"{d / 'mnt'}:/home/container", "-w", "/home/container", A.image,
       "java", "@/home/container/jvm.args")
    t_started = ns()
    r = probe.wait("127.0.0.1", port, timeout=240)
    t_ready = ns()
    return {"i": i, "container_started_ms": (t_started - T0) / 1e6,
            "ready_ms": (t_ready - T0) / 1e6 if r.get("status_ns") else None}


def cleanup(tag, n):
    for i in range(n):
        sh("docker", "rm", "-f", f"conc-{tag}-{i}", check=False)
    for i in range(n):
        d = Path(A.work) / f"{tag}-{i}"
        sh("umount", str(d / "mnt"), check=False)
        shutil.rmtree(d, ignore_errors=True)


res = {"config": vars(A), "rounds": []}
for rep in range(A.repeat):
    tag = f"r{rep}"
    cleanup(tag, A.n)
    for i in range(A.n):
        prep(i, tag)
    samples, stop = [], threading.Event()
    th = threading.Thread(target=sampler, args=(stop, samples), daemon=True)
    th.start()
    T0 = ns()
    with cf.ThreadPoolExecutor(A.n) as ex:
        rows = list(ex.map(lambda i: boot(i, tag, T0), range(A.n)))
    time.sleep(2)
    stop.set()
    th.join()
    mem = sh("docker", "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}").stdout
    ready = [r["ready_ms"] for r in rows if r["ready_ms"]]
    res["rounds"].append({"rows": rows, "ready_median": statistics.median(ready) if ready else None,
                          "ready_max": max(ready) if ready else None, "failed": sum(1 for r in rows if not r["ready_ms"]),
                          "peak_cpu_pct": round(max(s[1] for s in samples), 1), "min_mem_available_mb": min(s[2] for s in samples),
                          "mem_usage": [l for l in mem.splitlines() if l.startswith("conc-")]})
    cleanup(tag, A.n)
Path(A.out).mkdir(parents=True, exist_ok=True)
Path(A.out, f"conc-{A.n}.json").write_text(json.dumps(res, indent=1))
allr = [r["ready_ms"] for rd in res["rounds"] for r in rd["rows"] if r["ready_ms"]]
print(json.dumps({"n": A.n, "samples": len(allr), "median": round(statistics.median(allr)), "max": round(max(allr)),
                  "failed": sum(rd["failed"] for rd in res["rounds"]),
                  "peak_cpu_pct": max(rd["peak_cpu_pct"] for rd in res["rounds"]),
                  "min_mem_available_mb": min(rd["min_mem_available_mb"] for rd in res["rounds"])}))
