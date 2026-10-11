#!/usr/bin/env python3
"""Warm-instance activation: how long until a player is accepted by an ALREADY RUNNING, ready Paper server.

    warm.py --uuid UUID [--n 30] --out DIR

Starts the Wings-managed server (if needed), waits for protocol readiness, then repeats: pool claim (a Wings status
lookup = "is this instance ready and unallocated") followed by an offline-mode login up to Login Success. Reports the
two parts separately. This is NOT a cold start and has no proxy hop (a Minekube Gate hop adds one local TCP relay that
was not measured here). Replacing the claimed instance costs one cold start (see the start-warm results).
"""
import argparse, http.client, json, statistics, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import probe  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--uuid", required=True)
ap.add_argument("--n", type=int, default=30)
ap.add_argument("--out", required=True)
ap.add_argument("--host", default="172.18.0.1")
ap.add_argument("--port", type=int, default=25565)
A = ap.parse_args()
tok = Path("/bench/wings-opt/wdev-token").read_text().strip()
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
c = http.client.HTTPConnection("127.0.0.1:19090")


def api(m, p, b=None):
    c.request(m, p, json.dumps(b) if b else None, H)
    r = c.getresponse()
    return r.status, r.read()


def state():
    return json.loads(api("GET", f"/api/servers/{A.uuid}")[1])["state"]


if state() != "running":
    api("POST", f"/api/servers/{A.uuid}/power", {"action": "start"})
    probe.wait(A.host, A.port, timeout=120)
time.sleep(3)
claim, login, total = [], [], []
for i in range(A.n):
    t = time.perf_counter()
    assert state() == "running"
    t1 = time.perf_counter()
    probe.login(A.host, A.port, name=f"p{i % 7}")
    t2 = time.perf_counter()
    claim.append((t1 - t) * 1000), login.append((t2 - t1) * 1000), total.append((t2 - t) * 1000)
    time.sleep(4.3)  # Paper throttles repeated logins from one address for 4 s (bukkit.yml connection-throttle)


def st(v):
    v = sorted(v)
    return {"median": round(statistics.median(v), 2), "p95": round(v[min(len(v) - 1, -(-95 * len(v) // 100) - 1)], 2),
            "min": round(v[0], 2), "max": round(v[-1], 2)}


res = {"n": A.n, "claim_ms": st(claim), "login_ms": st(login), "request_to_login_success_ms": st(total),
       "definition": "ready instance already running; claim = Wings status lookup; login = connect to Login Success (offline mode)"}
Path(A.out).mkdir(parents=True, exist_ok=True)
Path(A.out, "warm.json").write_text(json.dumps(res, indent=1))
print(json.dumps(res, indent=1))
api("POST", f"/api/servers/{A.uuid}/power", {"action": "stop"})
