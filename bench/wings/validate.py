#!/usr/bin/env python3
"""Correctness checks for the optimized Wings (run against the wdev stack with reuse_containers=true).

Each check prints PASS/FAIL with the evidence. Exit status is the number of failures.
 1 reuse: second start reuses the same container id
 2 limits: a Panel memory-limit change forces re-creation with the new limit (reuse must not mask it)
 3 data: a file written through the Wings API survives stop/start, and level.dat is rewritten by the graceful stop
 4 ownership: every file in the server directory is still owned by the Wings user after the cycles
 5 wings restart: restarting the Wings daemon does not stop the running game server, and Wings re-attaches
 6 backup: a Panel-created backup completes successfully
 7 isolation flags: the (re)used container still has read-only rootfs, dropped caps, no-new-privileges, pids/memory limits
"""
import http.client, json, os, subprocess, sys, time
from pathlib import Path

U = Path("/bench/wings-opt/wdev-uuid").read_text().strip()
TOK = Path("/bench/wings-opt/wdev-token").read_text().strip()
KEYS = json.loads(Path("/bench/data/wdev/keys.json").read_text())
VOL = Path(f"/srv/wings/wdev/lib/volumes/{U}")
fails = 0


def wings(m, p, b=None, raw=False):
    c = http.client.HTTPConnection("127.0.0.1:19090", timeout=60)
    c.request(m, p, b if raw else (json.dumps(b) if b is not None else None), {"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"})
    r = c.getresponse()
    return r.status, r.read()


def panel(m, p, key, b=None):
    c = http.client.HTTPConnection("127.0.0.1:19080", timeout=60)
    c.request(m, p, json.dumps(b) if b is not None else None, {"Authorization": f"Bearer {key}", "Accept": "application/json", "Content-Type": "application/json"})
    r = c.getresponse()
    return r.status, json.loads(r.read() or b"{}")


def state():
    return json.loads(wings("GET", f"/api/servers/{U}")[1])["state"]


def until(f, t=120):
    end = time.time() + t
    while time.time() < end:
        v = f()
        if v:
            return v
        time.sleep(0.1)
    raise TimeoutError


def power(a):
    assert wings("POST", f"/api/servers/{U}/power", {"action": a})[0] == 202


def start():
    power("start")
    until(lambda: state() == "running")


def stop():
    power("stop")
    until(lambda: state() == "offline")


def cid():
    return subprocess.run(["docker", "inspect", "-f", "{{.Id}}", U], capture_output=True, text=True).stdout.strip()


def insp():
    return json.loads(subprocess.run(["docker", "inspect", U], capture_output=True, text=True).stdout)[0]


def check(name, ok, evidence):
    global fails
    fails += 0 if ok else 1
    print(("PASS" if ok else "FAIL"), name, "-", evidence, flush=True)


if state() != "offline":
    stop()

# 1 reuse
start(); stop(); a = cid(); start(); b = cid(); stop()
check("1 reuse", a == b and a != "", f"container id {a[:12]} then {b[:12]}")

# 2 limits change forces recreation
s, srv = panel("GET", "/api/application/servers/1", KEYS["application"])
lim, fl, alloc = srv["attributes"]["limits"], srv["attributes"]["feature_limits"], srv["attributes"]["allocation"]


def set_mem(mb):
    body = {"allocation": alloc, "memory": mb, "swap": lim["swap"], "disk": lim["disk"], "io": lim["io"], "cpu": lim["cpu"],
            "threads": lim["threads"], "feature_limits": fl}
    s, r = panel("PATCH", "/api/application/servers/1/build", KEYS["application"], body)
    assert s == 200, (s, r)


set_mem(2560)
before = cid()
start(); mem = insp()["HostConfig"]["Memory"]; after = cid(); stop()
check("2 limits", before != after and mem > 2560 * 1048576, f"container {before[:12]} -> {after[:12]}, memory limit {mem}")
set_mem(lim["memory"])

# 3 data persistence and world save
wings("POST", f"/api/servers/{U}/files/write?file=/persist.txt", b"keep me", raw=True)
lvl = VOL / "world" / "level.dat"
m0 = lvl.stat().st_mtime
start(); time.sleep(2); stop()
check("3 data", (VOL / "persist.txt").read_text() == "keep me" and lvl.stat().st_mtime > m0,
      f"persist.txt intact, level.dat mtime advanced by {lvl.stat().st_mtime - m0:.1f}s")

# 4 ownership
bad = subprocess.run(["find", str(VOL), "!", "-user", "988", "-o", "!", "-group", "988"], capture_output=True, text=True).stdout.split()
check("4 ownership", not bad, f"{len(bad)} entries not owned by 988:988")

# 5 Wings restart must not stop the game server
start()
subprocess.run(["docker", "restart", "-t", "20", "wdev-wings-1"], capture_output=True)
until(lambda: subprocess.run(["curl", "-s", "-o", "/dev/null", "http://127.0.0.1:19090/"], capture_output=True).returncode == 0, 30)
running = insp()["State"]["Running"]
check("5 wings restart", running and until(lambda: state() == "running", 30), f"container running={running}, Wings state={state()}")
stop()

# 6 backup
s, r = panel("POST", "/api/client/servers/" + U[:8] + "/backups", KEYS["client_admin"], {"name": "validate"})
ok = False
if s in (200, 201):
    bid = r["attributes"]["uuid"]
    ok = bool(until(lambda: panel("GET", f"/api/client/servers/{U[:8]}/backups/{bid}", KEYS["client_admin"])[1]["attributes"]["completed_at"], 120))
    panel("DELETE", f"/api/client/servers/{U[:8]}/backups/{bid}", KEYS["client_admin"])
check("6 backup", ok, f"create HTTP {s}, completed={ok}")

# 7 isolation flags on a reused container
start(); h = insp()["HostConfig"]; stop()
flags = {"ReadonlyRootfs": h["ReadonlyRootfs"], "NoNewPrivileges": "no-new-privileges" in (h["SecurityOpt"] or []),
         "CapDrop": len(h["CapDrop"] or []), "PidsLimit": h["PidsLimit"], "Memory": h["Memory"]}
check("7 isolation", flags["ReadonlyRootfs"] and flags["NoNewPrivileges"] and flags["CapDrop"] == 10 and flags["PidsLimit"] == 512 and flags["Memory"] > 0, str(flags))
sys.exit(fails)
