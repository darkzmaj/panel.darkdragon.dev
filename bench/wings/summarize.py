#!/usr/bin/env python3
"""Turn run.sh artifacts into per-stage timings.

    summarize.py OUT_DIR [--label direct-min] > stages.json    
    summarize.py selftest

Stages (ms, relative to T0 = just before the start command):
  docker_start   T5  Docker `start` event
  paper_done     T8  first console line matching "Done (" (Docker's own log timestamp)
  tcp            T9  first successful TCP connect
  status_ready   T10 first valid Server List Ping reply   <- the readiness definition used for every comparison
  dispatch_ms        client-side curl time_starttransfer (wings only: HTTP request until Wings answered)
  stop_exit      container `die` event after the stop request
A missing artifact yields null, never a guess.
"""
import json, re, statistics, sys
from pathlib import Path


def rd(p):
    try:
        return Path(p).read_text().strip()
    except OSError:
        return None


def events(p):
    out = []
    for line in (rd(p) or "").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def first_event(evs, action, after_ns=0):
    for e in evs:
        if e.get("Action", "").split(":")[0] == action and e.get("timeNano", 0) >= after_ns:
            return e["timeNano"]


def iso_ns(ts):
    from datetime import datetime, timezone
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z", ts)
    if not m:
        return None
    base = int(datetime.strptime(m[1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    return base * 10**9 + int((m[2] or "0").ljust(9, "0")[:9])


def paper_done_ns(console):
    for line in (console or "").splitlines():
        if re.search(r"Done \(\d", line):
            return iso_ns(line.split(" ", 1)[0])


def run_stages(r):
    r = Path(r)
    t0 = int(rd(r / "t0_ns") or 0)
    if not t0:
        return None
    ms = lambda ns: None if ns is None else round((ns - t0) / 1e6, 2)
    probe = json.loads(rd(r / "probe.json") or "{}")
    disp = (rd(r / "dispatch.json") or "").split()
    s0 = int(rd(r / "stop_t0_ns") or 0)
    die = first_event(events(r / "stop_events.jsonl"), "die", s0)
    return {
        "docker_start": ms(first_event(events(r / "events.jsonl"), "start", t0)),
        "paper_done": ms(paper_done_ns(rd(r / "console.log"))),
        "tcp": ms(probe.get("tcp_ns")),
        "status_ready": ms(probe.get("status_ns")),
        "dispatch_ms": round(float(disp[2]) * 1000, 2) if len(disp) == 4 else None,
        "stop_exit": round((die - s0) / 1e6, 2) if die and s0 else None,
    }


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, max(0, round(p / 100 * len(v) + 0.5) - 1))]


def summarize(out):
    runs = [x for x in (run_stages(d) for d in sorted(Path(out).glob("run-*"))) if x]
    res = {"n": len(runs), "env": json.loads(rd(Path(out) / "env.json") or "{}"), "stages": {}, "runs": runs}
    for k in runs[0] if runs else []:
        v = [x[k] for x in runs if x[k] is not None]
        if v:
            res["stages"][k] = {"n": len(v), "min": min(v), "median": statistics.median(v), "p95": pct(v, 95),
                                "p99": pct(v, 99) if len(v) >= 100 else None, "max": max(v)}
    return res


def selftest():
    assert iso_ns("2026-01-01T00:00:01.5Z") - iso_ns("2026-01-01T00:00:00Z") == 1_500_000_000
    assert pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) == 10 and pct([5], 95) == 5
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        r = Path(d) / "run-1"
        r.mkdir()
        (r / "t0_ns").write_text("1000000000")
        (r / "probe.json").write_text(json.dumps({"tcp_ns": 3_000_000_000, "status_ns": 4_000_000_000}))
        (r / "events.jsonl").write_text(json.dumps({"Action": "start", "timeNano": 1_500_000_000}) + "\n")
        s = run_stages(r)
        assert s["status_ready"] == 3000.0 and s["docker_start"] == 500.0 and s["paper_done"] is None
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["selftest"]:
        selftest()
    elif len(sys.argv) >= 2:
        print(json.dumps(summarize(sys.argv[1]), indent=1))
    else:
        sys.exit(__doc__)
