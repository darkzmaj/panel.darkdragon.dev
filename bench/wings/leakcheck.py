#!/usr/bin/env python3
"""Resource-leak accounting for long-running reliability runs (soak.sh).

    leakcheck.py snapshot --out FILE [--work DIR ...] [--prefix pool- conc- ...]
    leakcheck.py diff BEFORE AFTER [--allow-containers N] [--max-mem-drop-mb 512] [--max-disk-drop-mb 2048]

A snapshot records: containers (name, state) whose name starts with a benchmark prefix, overlay mounts, entries left in the work
directories, MemAvailable and free disk. `diff` exits 1 when the AFTER state holds containers, mounts or directories that were not
there BEFORE (a leak), or memory/disk dropped by more than the allowance (a slow leak or a runaway log/cache).
"""
import json, os, shutil, subprocess, sys
from pathlib import Path


def snapshot(work_dirs=(), prefixes=("pool-", "conc-", "mkvariant-", "crac-")):
    try:
        names = subprocess.run(["docker", "ps", "-a", "--format", "{{.Names}} {{.State}}"], capture_output=True, text=True, check=True).stdout.split("\n")
    except (OSError, subprocess.CalledProcessError) as e:
        raise SystemExit(f"cannot list containers: {e}")
    cont = sorted(n for n in names if n.startswith(tuple(prefixes)))
    mounts = sorted(l.split()[1] for l in open("/proc/mounts") if l.split()[0] == "overlay" and any(str(w) in l for w in work_dirs))
    left = sorted(str(p) for w in work_dirs if Path(w).exists() for p in Path(w).iterdir())
    mem = [int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith("MemAvailable")][0] // 1024
    disk = [shutil.disk_usage(w).free // 2**20 for w in work_dirs if Path(w).exists()]
    return {"containers": cont, "overlay_mounts": mounts, "work_entries": left, "mem_available_mb": mem,
            "disk_free_mb": min(disk) if disk else None}


def diff(a, b, allow_containers=0, max_mem_drop_mb=512, max_disk_drop_mb=2048):
    bad = []
    new_c = sorted(set(b["containers"]) - set(a["containers"]))
    if len(new_c) > allow_containers:
        bad.append(f"{len(new_c)} container(s) left behind: {new_c[:10]}")
    for k, label in (("overlay_mounts", "overlay mount(s)"), ("work_entries", "work directory entr(ies)")):
        new = sorted(set(b[k]) - set(a[k]))
        if new:
            bad.append(f"{len(new)} {label} left behind: {new[:10]}")
    if a["mem_available_mb"] - b["mem_available_mb"] > max_mem_drop_mb:
        bad.append(f"MemAvailable dropped {a['mem_available_mb'] - b['mem_available_mb']} MB (> {max_mem_drop_mb})")
    if a.get("disk_free_mb") is not None and b.get("disk_free_mb") is not None and a["disk_free_mb"] - b["disk_free_mb"] > max_disk_drop_mb:
        bad.append(f"free disk dropped {a['disk_free_mb'] - b['disk_free_mb']} MB (> {max_disk_drop_mb})")
    return bad


def main(argv):
    if not argv or argv[0] not in ("snapshot", "diff"):
        sys.exit(__doc__)

    def opt(name, default, cast=str):
        return cast(argv[argv.index(name) + 1]) if name in argv else default

    if argv[0] == "snapshot":
        works = [argv[i + 1] for i, x in enumerate(argv) if x == "--work"]
        s = snapshot(works)
        Path(opt("--out", "/dev/stdout")).write_text(json.dumps(s, indent=1))
        return 0
    a, b = (json.loads(Path(p).read_text()) for p in argv[1:3])
    bad = diff(a, b, opt("--allow-containers", 0, int), opt("--max-mem-drop-mb", 512, int), opt("--max-disk-drop-mb", 2048, int))
    print("\n".join(["LEAK"] + bad) if bad else "no leaks")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
