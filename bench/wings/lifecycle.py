#!/usr/bin/env python3
"""Measure real Paper start / stop / restart cycles under direct Docker or a Wings daemon. Linux + Docker, run as root.

    lifecycle.py --mode direct|wings --label NAME --scenario start|restart --n 20 --out DIR [options]

Every timestamp is wall-clock ns on this host (time.time_ns, Docker `timeNano`, `docker logs --timestamps`) and stored
relative to T0 = the instant before the start/restart command is issued. Readiness (`ready_ms`) is ONE definition for all
modes: first valid Minecraft Server List Ping answered on the published port by a server process started after T0.
Output: DIR/runs.jsonl (one row per cycle), DIR/timeline.jsonl (raw events for the dashboard), DIR/env.json.
"""
import argparse, http.client, json, os, re, shutil, subprocess, sys, threading, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import probe  # noqa: E402
from summarize import iso_ns  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--mode", required=True, choices=["direct", "wings"])
ap.add_argument("--label", required=True)
ap.add_argument("--scenario", default="start", choices=["start", "restart"])
ap.add_argument("--n", type=int, default=20)
ap.add_argument("--out", required=True)
ap.add_argument("--template", default="/bench/wings-opt/templates/world-min")
ap.add_argument("--uuid", default=None, help="wings: server uuid (= container name and data dir name)")
ap.add_argument("--wings-url", default="127.0.0.1:19090")
ap.add_argument("--wings-token-file", default="/bench/wings-opt/wdev-token")
ap.add_argument("--wings-container", default="wdev-wings-1")
ap.add_argument("--volumes", default="/srv/wings/wdev/lib/volumes")
ap.add_argument("--host-ip", default="172.18.0.1")
ap.add_argument("--port", type=int, default=25565)
ap.add_argument("--image", default="ghcr.io/pterodactyl/yolks:java_21")
ap.add_argument("--startup", default=None, help="direct mode: replace the java command line (default = the Paper egg's)")
ap.add_argument("--drop-caches", action="store_true")
ap.add_argument("--warmup", type=int, default=1, help="discarded cycles before the measured ones")
ap.add_argument("--settle", type=float, default=3.0, help="seconds to idle after ready before stopping/restarting")
A = ap.parse_args()

OUT = Path(A.out)
OUT.mkdir(parents=True, exist_ok=True)
NAME = A.uuid if A.mode == "wings" else f"wdev-direct-{A.label}"
VOL = Path(A.volumes) / A.uuid if A.mode == "wings" else Path("/bench/wings-opt/direct-vol") / A.label
STARTUP = A.startup or ("java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true "
                        "-jar server.jar")
TOKEN = Path(A.wings_token_file).read_text().strip()
LOCK = threading.Lock()
TL = open(OUT / "timeline.jsonl", "a")


def sh(*a, check=True):
    return subprocess.run(a, capture_output=True, text=True, check=check).stdout


def mark(run, stage, ns=None, **kw):
    with LOCK:
        TL.write(json.dumps({"label": A.label, "run": run, "stage": stage, "ns": ns or time.time_ns(), **kw}) + "\n")
        TL.flush()


# ---- Wings API ---------------------------------------------------------------------------------------------------
_tl = threading.local()  # one keep-alive connection per thread: sharing one interleaves responses


def wings(method, path, body=None):
    for _ in range(2):
        try:
            if getattr(_tl, "c", None) is None:
                _tl.c = http.client.HTTPConnection(A.wings_url, timeout=30)
            _tl.c.request(method, path, json.dumps(body) if body else None,
                          {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
            r = _tl.c.getresponse()
            return r.status, r.read()
        except (OSError, http.client.HTTPException):
            _tl.c = None
    raise RuntimeError("wings api unreachable")


def power(action):
    s, _ = wings("POST", f"/api/servers/{A.uuid}/power", {"action": action})
    assert s == 202, f"power {action}: HTTP {s}"


def wings_state():
    try:
        s, b = wings("GET", f"/api/servers/{A.uuid}")
        return json.loads(b)["state"] if s == 200 else None
    except Exception:
        return None


# ---- direct Docker: same container shape Wings builds (environment/docker/container.go Create) --------------------
def direct_create():
    Path("/run/wings/machine-id").mkdir(parents=True, exist_ok=True)
    mid = Path(f"/run/wings/machine-id/{NAME}")
    mid.write_text("0" * 32 + "\n") if not mid.exists() else None
    caps = ["setpcap", "mknod", "audit_write", "net_raw", "dac_override", "fowner", "fsetid", "net_bind_service",
            "sys_chroot", "setfcap"]
    cmd = ["docker", "create", "--name", NAME, "-it", "-a", "stdin", "-a", "stdout", "-a", "stderr", "--hostname", NAME,
           "--user", "988:988", "--read-only", "--tmpfs", "/tmp:rw,exec,nosuid,size=100M",
           "--security-opt", "no-new-privileges", "--memory", "2469606195", "--memory-swap", "2469606195",
           "--memory-reservation", "2147483648", "--pids-limit", "512", "--network", "pterodactyl_nw",
           "--dns", "1.1.1.1", "--dns", "1.0.0.1", "--log-driver", "local", "--log-opt", "max-size=5m",
           "--log-opt", "max-file=1", "--log-opt", "compress=false", "--log-opt", "mode=non-blocking",
           "-p", f"{A.host_ip}:{A.port}:25565/tcp", "-p", f"{A.host_ip}:{A.port}:25565/udp",
           "-v", f"{VOL}:/home/container", "-v", f"{mid}:/etc/machine-id:ro",
           "-e", "TZ=UTC", "-e", f"STARTUP={STARTUP}", "-e", "SERVER_MEMORY=2048", "-e", f"SERVER_IP={A.host_ip}",
           "-e", f"SERVER_PORT={A.port}", "-e", "SERVER_JARFILE=server.jar", "-e", "MINECRAFT_VERSION=latest",
           "-e", "BUILD_NUMBER=latest", "-e", "DL_PATH="]
    for c in caps:
        cmd += ["--cap-drop", c]
    sh(*cmd, A.image)


class Attach:  # `start -a -i` attaches before starting (as Wings does) and keeps stdin open so `stop` can be typed
    def __init__(self):
        self.p = subprocess.Popen(["docker", "start", "-a", "-i", NAME], stdin=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.exit_ns = None  # attach stream EOF = the process really exited (Docker's `die` event arrives later)
        threading.Thread(target=self._wait, daemon=True).start()

    def _wait(self):
        self.p.wait()
        self.exit_ns = time.time_ns()

    def send(self, line):
        self.p.stdin.write(line.encode() + b"\n")
        self.p.stdin.flush()

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(5)
        except Exception:
            self.p.kill()


# ---- background watchers -----------------------------------------------------------------------------------------
class Watch:
    def __init__(self, run):
        self.run, self.events, self.pings, self.states, self.stop = run, [], [], [], False
        self.ev = subprocess.Popen(["docker", "events", "--since", str(time.time() - 0.5), "--filter",
                                    f"container={NAME}", "--filter", "type=container", "--format", "{{json .}}"],
                                   stdout=subprocess.PIPE, text=True)
        self.th = [threading.Thread(target=f, daemon=True) for f in (self._ev, self._ping, self._state)]
        for t in self.th:
            t.start()

    def _ev(self):
        for line in self.ev.stdout:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            a = e["Action"].split(":")[0]
            if a in ("create", "start", "die", "destroy", "kill", "stop", "attach", "oom"):
                self.events.append((a, e["timeNano"]))
                mark(self.run, "docker_" + a, e["timeNano"])

    def _ping(self):
        up = False
        while not self.stop:
            try:
                probe.status(A.host_ip, A.port, timeout=0.3)
                ok = True
            except Exception:
                ok = False
            n = time.time_ns()
            if ok != up:
                up = ok
                self.pings.append((n, ok))
                mark(self.run, "status_up" if ok else "status_down", n)
            time.sleep(0.004 if not ok else 0.05)

    def _state(self):
        if A.mode != "wings":
            return
        last = None
        while not self.stop:
            s = wings_state()
            if s != last:
                last = s
                self.states.append((time.time_ns(), s))
                mark(self.run, "wings_state_" + str(s))
            time.sleep(0.01)

    def close(self):
        self.stop = True
        time.sleep(0.15)
        self.ev.terminate()


def first(lst, pred, after=0):
    for x in lst:
        if x[0] >= after and pred(x):
            return x[0]


def ev_first(w, name, after):
    return next((n for a, n in w.events if a == name and n >= after), None)


def docker_log_marks(name, after, since):
    out = sh("docker", "logs", "--timestamps", "--since", str(since), name, check=False)
    r = {}
    for line in out.splitlines():
        ts, _, msg = line.partition(" ")
        n = iso_ns(ts)
        if not n or n < after:
            continue
        r.setdefault("first_line", n)
        if "Starting minecraft server version" in msg:
            r.setdefault("paper_starting", n)
        if re.search(r"Done \(\d", msg):
            r.setdefault("paper_done", n)
    return r


def wings_log_marks(after, since):
    p = subprocess.run(["docker", "logs", "--timestamps", "--since", str(since), A.wings_container],
                       capture_output=True, text=True)
    r = {}
    for line in (p.stdout + p.stderr).splitlines():
        ts, _, msg = line.partition(" ")
        n = iso_ns(ts)
        if not n or n < after:
            continue
        for key, pat in (("wings_lock", "acquired exclusive lock"), ("wings_sync", "syncing server configuration"),
                         ("wings_preflight_done", "completed server preflight"), ("wings_lock_released", "releasing exclusive lock")):
            if pat in msg and A.uuid in msg:
                r.setdefault(key, n)
    return r


# ---- one cycle ---------------------------------------------------------------------------------------------------
def reset_files():
    if VOL.exists():
        shutil.rmtree(VOL)
    sh("cp", "-a", A.template, str(VOL))
    sh("chown", "-R", "988:988", str(VOL))


def wait_for(fn, timeout, step=0.01):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    raise TimeoutError


def start_cmd(att_box):
    if A.mode == "wings":
        power("start")
    else:
        sh("docker", "rm", "-f", NAME, check=False)
        direct_create()
        att_box.append(Attach())


def stop_cmd(att_box):
    if A.mode == "wings":
        power("stop")
    else:
        att_box[0].send("stop")


def cycle(i, measured):
    run = f"{A.label}-{i}"
    att = []
    if A.scenario == "start" or not (VOL / "server.jar").exists():
        if A.mode == "wings":
            assert wings_state() == "offline", "server must be offline"
        reset_files()
        if A.drop_caches:
            sh("sync")
            Path("/proc/sys/vm/drop_caches").write_text("3")
    w = Watch(run)
    row = {"label": A.label, "run": i, "mode": A.mode, "scenario": A.scenario, "measured": measured}
    try:
        if A.scenario == "restart":  # get a running server first, then restart it
            since0 = time.time_ns()
            start_cmd(att)
            wait_for(lambda: first(w.pings, lambda x: x[1], since0), 180, 0.02)
            time.sleep(A.settle)
            w.events.clear(), w.pings.clear()
        since = time.time() - 1
        t0 = time.time_ns()
        mark(run, "T0", t0)
        if A.scenario == "restart":
            if A.mode == "wings":
                power("restart")
            else:  # graceful: console `stop`, wait for exit, then start the SAME container again (no recreate)
                att[0].send("stop")
                wait_for(lambda: att[0].exit_ns, 120, 0.002)
                att[0].close()
                att[:] = [Attach()]
            row["api_return_ms"] = (time.time_ns() - t0) / 1e6
        else:
            start_cmd(att)
            row["api_return_ms"] = (time.time_ns() - t0) / 1e6
        restart_die = None
        gate = t0
        if A.scenario == "restart":  # the old server keeps answering until it exits: only count answers after `die`
            restart_die = wait_for(lambda: ev_first(w, "die", t0), 180, 0.002)
            gate = restart_die
        ready = wait_for(lambda: first(w.pings, lambda x: x[1], gate), 180, 0.002)
        row["ready_ms"] = (ready - t0) / 1e6
        if A.mode == "wings":
            wr = wait_for(lambda: first(w.states, lambda x: x[1] == "running", t0), 60)
            row["wings_running_ms"] = (wr - t0) / 1e6
        time.sleep(A.settle)
        # ---- graceful stop timing
        s0 = time.time_ns()
        mark(run, "stop_request", s0)
        stop_cmd(att)
        row["stop_api_return_ms"] = (time.time_ns() - s0) / 1e6
        die = wait_for(lambda: ev_first(w, "die", s0), 180, 0.005)
        row["stop_die_ms"] = (die - s0) / 1e6
        if A.mode == "wings":
            off = wait_for(lambda: first(w.states, lambda x: x[1] == "offline", s0), 60)
            row["stop_exit_ms"] = (off - s0) / 1e6  # Wings sees the console stream end
        else:
            row["stop_exit_ms"] = (wait_for(lambda: att[0].exit_ns, 60, 0.002) - s0) / 1e6
        # ---- stage extraction
        for k, name in (("docker_destroy_ms", "destroy"), ("docker_create_ms", "create"), ("docker_start_ms", "start")):
            n = ev_first(w, name, t0)
            if n:
                row[k] = (n - t0) / 1e6
        if restart_die:
            row["restart_old_exit_ms"] = (restart_die - t0) / 1e6
        marks = docker_log_marks(NAME, t0, since)
        if A.mode == "wings":
            marks.update(wings_log_marks(t0, since))
        for k, n in marks.items():
            row[k + "_ms"] = (n - t0) / 1e6
        if A.mode == "direct":
            att[0].close()
            sh("docker", "rm", "-f", NAME, check=False)
    finally:
        w.close()
        for a in att[:1]:
            a.close()
    return row


def ensure_offline():
    if A.mode == "wings":  # a freshly (re)started daemon answers 404/5xx until it has loaded its servers
        wait_for(lambda: wings_state() is not None, 120, 0.1)
    if A.mode == "wings" and wings_state() != "offline":
        if wings_state() in ("starting", "running"):  # a console `stop` typed while Paper boots is not acted on
            probe.wait(A.host_ip, A.port, timeout=120)
        power("stop")
        wait_for(lambda: wings_state() == "offline", 120, 0.05)
    if A.mode == "direct":  # the Wings-managed server shares the published port: it must not be running
        other = Path("/bench/wings-opt/wdev-uuid").read_text().strip()
        if sh("docker", "ps", "-q", "--filter", f"name={other}", check=False).strip():
            A.uuid = other
            power("stop")
            wait_for(lambda: wings_state() == "offline", 120, 0.1)
        sh("docker", "rm", "-f", NAME, check=False)


def main():
    ensure_offline()
    sh("docker", "rm", "-f", NAME, check=False) if A.mode == "direct" else None
    VOL.parent.mkdir(parents=True, exist_ok=True)
    env = {"label": A.label, "mode": A.mode, "scenario": A.scenario, "n": A.n, "drop_caches": A.drop_caches,
           "image": A.image, "image_id": sh("docker", "image", "inspect", "-f", "{{.Id}}", A.image).strip(),
           "docker": sh("docker", "version", "--format", "{{.Server.Version}}").strip(),
           "kernel": os.uname().release, "cpus": os.cpu_count(), "template_bytes": int(sh("du", "-sb", A.template).split()[0]),
           "startup": STARTUP, "started": time.strftime("%FT%TZ", time.gmtime())}
    (OUT / "env.json").write_text(json.dumps(env, indent=1))
    with open(OUT / "runs.jsonl", "a") as f:
        for i in range(-A.warmup, A.n):
            row = cycle(i, i >= 0)
            f.write(json.dumps(row) + "\n")
            f.flush()
            print(A.label, i, "ready", round(row["ready_ms"]), "ms", flush=True)


main()
