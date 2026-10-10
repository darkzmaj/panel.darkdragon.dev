#!/usr/bin/env python3
"""Acceptance checks on live benchmark output. Exit 0 only if the data can be trusted; it never judges speed.

    check_results.py runs OUT_DIR [OUT_DIR ...] [--min-n 10]     lifecycle.py output (runs.jsonl)
    check_results.py pool pool.json [--min-ok 1.0]               pool.py bench output
    check_results.py conc conc-N.json                            conc.py output

runs: for labels `<server>-<variant>-<env>-<scenario>` (env = direct|stock|gobia):
  * every measured row carries files_fp, and it is constant within a label (the variant's files never changed mid-series);
  * the same server+variant+scenario has the SAME fingerprint under direct, stock and gobia (same files in all three), and
    different variants of one server have DIFFERENT fingerprints (they really are different startups);
  * ready_ms is present and positive on every measured row; at least --min-n measured rows per label.
pool: every match reached Play, no instance served two matches, the breaker never opened, failures <= (1-min-ok).
conc: every server of every round reached readiness.
"""
import collections, json, sys
from pathlib import Path


def load_rows(dirs):
    rows = []
    for d in dirs:
        f = Path(d) / "runs.jsonl"
        if f.exists():
            rows += [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    return [r for r in rows if r.get("measured")]


def check_runs(rows, min_n=10):
    bad = []
    by = collections.defaultdict(list)
    for r in rows:
        by[r["label"]].append(r)
    fp = {}
    for label, rs in by.items():
        if len(rs) < min_n:
            bad.append(f"{label}: only {len(rs)} measured rows (< {min_n})")
        fps = {json.dumps(r.get("files_fp"), sort_keys=True) for r in rs}
        if any(r.get("files_fp") is None for r in rs):
            bad.append(f"{label}: rows without files_fp (collected with an older lifecycle.py: files not verified)")
        elif len(fps) != 1:
            bad.append(f"{label}: files changed during the series: {sorted(fps)}")
        else:
            fp[label] = rs[0]["files_fp"]
        for r in rs:
            if not (r.get("ready_ms") and r["ready_ms"] > 0):
                bad.append(f"{label} run {r.get('run')}: missing/invalid ready_ms")
    groups = collections.defaultdict(dict)       # (server, scenario) -> {variant: {env: fp}}
    for label, f in fp.items():
        parts = label.split("-")
        if len(parts) != 4:
            continue
        srv, var, env, sc = parts
        groups[(srv, sc)].setdefault(var, {})[env] = f
    for (srv, sc), variants in groups.items():
        for var, envs in variants.items():
            if len({json.dumps(v, sort_keys=True) for v in envs.values()}) > 1:
                bad.append(f"{srv}-{var}-{sc}: different files under different envs: {envs}")
        reps = {var: json.dumps(next(iter(e.values())), sort_keys=True) for var, e in variants.items() if e}
        if len(set(reps.values())) < len(reps):
            same = [v for v in reps if list(reps.values()).count(reps[v]) > 1]
            bad.append(f"{srv}-{sc}: variants {same} have identical files (not different startups)")
    return bad


def check_pool(d, min_ok=1.0):
    bad = []
    n = d["config"]["matches"]
    ms = d.get("matches", [])
    if len(ms) != n:
        bad.append(f"{len(ms)} match results, expected {n}")
    ok = [m for m in ms if "request_to_play_ms" in m]
    if ms and len(ok) / len(ms) < min_ok:
        bad.append(f"only {len(ok)}/{len(ms)} matches reached Play: {[m.get('error') for m in ms if 'error' in m][:5]}")
    used = d.get("instances_used", [m["instance"] for m in ms if "instance" in m])
    if len(used) != len(set(used)):
        bad.append(f"instance(s) served more than one match: {sorted(i for i in set(used) if used.count(i) > 1)}")
    if any(e[0] == "broken" for e in d.get("pool_events", [])):
        bad.append("the pool's failure breaker opened")
    return bad


def check_conc(d):
    bad = []
    for i, rd in enumerate(d["rounds"]):
        if rd["failed"]:
            bad.append(f"round {i}: {rd['failed']} of {len(rd['rows'])} servers never reached readiness")
    return bad


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, rest = argv[0], argv[1:]
    opt = {}
    for k in ("--min-n", "--min-ok"):
        if k in rest:
            i = rest.index(k)
            opt[k] = float(rest[i + 1])
            del rest[i:i + 2]
    if cmd == "runs":
        bad = check_runs(load_rows(rest), int(opt.get("--min-n", 10)))
    elif cmd == "pool":
        bad = check_pool(json.loads(Path(rest[0]).read_text()), opt.get("--min-ok", 1.0))
    elif cmd == "conc":
        bad = check_conc(json.loads(Path(rest[0]).read_text()))
    else:
        sys.exit(__doc__)
    print("\n".join(["DATA NOT TRUSTWORTHY"] + bad) if bad else "OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
