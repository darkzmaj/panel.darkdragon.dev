#!/usr/bin/env python3
"""Aggregate lifecycle.py output.

    summarize.py OUT_DIR [OUT_DIR ...]      prints a table per label (median / p95 / min / max, ms) and writes nothing
    summarize.py OUT_DIR --json             same data as JSON
    summarize.py selftest

Only `measured` rows (warm-up cycles are excluded). Percentiles use the nearest-rank method; p99 is reported only with
n >= 100 so a small sample never pretends to have a tail estimate.
"""
import json, re, statistics, sys
from datetime import datetime, timezone
from pathlib import Path

METRICS = ["api_return_ms", "wings_lock_ms", "wings_preflight_done_ms", "docker_destroy_ms", "docker_create_ms",
           "docker_start_ms", "paper_starting_ms", "paper_done_ms", "wings_running_ms", "ready_ms", "restart_old_exit_ms",
           "stop_exit_ms", "stop_die_ms"]


def iso_ns(ts):
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z", ts)
    if not m:
        return None
    base = int(datetime.strptime(m[1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    return base * 10**9 + int((m[2] or "0").ljust(9, "0")[:9])


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, max(0, -(-p * len(v) // 100) - 1))]


def load(*dirs):
    rows = {}
    for d in dirs:
        f = Path(d) / "runs.jsonl"
        if f.exists():
            for line in f.read_text().splitlines():
                if line.strip():
                    r = json.loads(line)
                    if r.get("measured"):
                        rows.setdefault(r["label"], []).append(r)
    return rows


def stats(vals):
    return {"n": len(vals), "min": round(min(vals), 1), "median": round(statistics.median(vals), 1),
            "mean": round(statistics.fmean(vals), 1), "p95": round(pct(vals, 95), 1),
            "p99": round(pct(vals, 99), 1) if len(vals) >= 100 else None, "max": round(max(vals), 1)}


def summarize(*dirs):
    out = {}
    for label, rs in load(*dirs).items():
        m = {}
        for k in METRICS:
            v = [r[k] for r in rs if r.get(k) is not None]
            if v:
                m[k] = stats(v)
        out[label] = {"n": len(rs), "metrics": m}
    return out


def table(s):
    lines = []
    for label in sorted(s):
        lines.append(f"\n{label}  (n={s[label]['n']})")
        lines.append(f"  {'metric':26}{'median':>9}{'p95':>9}{'min':>9}{'max':>9}")
        for k, v in s[label]["metrics"].items():
            lines.append(f"  {k:26}{v['median']:>9}{v['p95']:>9}{v['min']:>9}{v['max']:>9}")
    return "\n".join(lines)


def selftest():
    assert iso_ns("2026-01-01T00:00:01.5Z") - iso_ns("2026-01-01T00:00:00Z") == 1_500_000_000
    assert pct(list(range(1, 21)), 95) == 19 and pct([5], 95) == 5 and pct(list(range(1, 11)), 95) == 10
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        rows = [{"label": "x", "measured": i > 0, "ready_ms": 1000.0 * (i + 1)} for i in range(6)]
        (Path(d) / "runs.jsonl").write_text("\n".join(json.dumps(r) for r in rows))
        s = summarize(d)["x"]
        assert s["n"] == 5 and s["metrics"]["ready_ms"]["median"] == 4000.0 and s["metrics"]["ready_ms"]["min"] == 2000.0
    print("selftest ok")


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if x != "--json"]
    if a == ["selftest"]:
        selftest()
    elif a:
        s = summarize(*a)
        print(json.dumps(s, indent=1) if "--json" in sys.argv else table(s))
    else:
        sys.exit(__doc__)
