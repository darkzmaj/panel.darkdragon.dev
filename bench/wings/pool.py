#!/usr/bin/env python3
"""Warm instance pool prototype for match-based minigames (Linux, Docker, root). Proof of concept, not production code.

    pool.py bench --template DIR --image IMG --size K --matches M --concurrent C --out DIR [--reset copy|overlay]

What it does (all measured, nothing simulated):
  * keeps `size` Minecraft servers started and protocol-ready (replenished in the background, bounded by
    --max-starts concurrent boots), each in its own container with the Wings container flags, its own world directory
    (fresh copy of the template, or a fresh overlayfs upper layer) and its own host port;
  * reserve(): under one lock picks a READY instance, re-checks it with a fresh status ping, marks it RESERVED
    (an instance can only move ready -> reserved once, so two matches cannot get the same server);
  * route: Minekube Gate (lite mode) gets a route `m<id>.pool.test -> instance` through its HTTP API (ApplyConfig);
  * a headless client then connects to Gate with that virtual host and must reach the Play state of the instance;
  * after the match the instance is destroyed (container + world) and a replacement boots. Instances are never reused,
    so no match data can leak into the next match.
Timestamps use perf_counter_ns inside this one process, so every interval below is monotonic.
"""
import argparse, concurrent.futures as cf, http.client, json, os, shutil, statistics, subprocess, sys, threading, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import probe  # noqa: E402

GATE = "/bench/wings-opt/p2/gate/gate"
ns = time.perf_counter_ns


def sh(*a, check=True):
    return subprocess.run(a, capture_output=True, text=True, check=check)


class Inst:
    def __init__(self, i, port):
        self.id, self.port, self.state = i, port, "starting"
        self.name = f"pool-{i}"
        self.dir = None
        self.boot_ms = None


class Gate:
    def __init__(self, work, bind="127.0.0.1:25580", api="127.0.0.1:18099"):
        self.bind, self.api, self.routes = bind, api, []
        self.cfg_lock = threading.Lock()
        work = Path(work).resolve()
        work.mkdir(parents=True, exist_ok=True)
        cfg = Path(work) / "gate.yml"
        cfg.write_text(f"config:\n  bind: {bind}\n  lite:\n    enabled: true\n    routes:\n      - host: placeholder.pool.test\n        backend: 127.0.0.1:9\napi:\n  enabled: true\n  bind: {api}\n")
        self.p = subprocess.Popen([GATE, "-c", str(cfg)], cwd=work, stdout=open(Path(work) / "gate.log", "w"), stderr=subprocess.STDOUT)
        end = time.time() + 15
        while time.time() < end:
            try:
                self.call("GetStatus", {})
                return
            except Exception:
                time.sleep(0.05)
        raise RuntimeError("gate did not start")

    def call(self, method, body):
        c = http.client.HTTPConnection(self.api, timeout=10)
        c.request("POST", f"/minekube.gate.v1.GateService/{method}", json.dumps(body),
                  {"Content-Type": "application/json", "Connect-Protocol-Version": "1"})
        r = c.getresponse()
        data = r.read()
        if r.status != 200:
            raise RuntimeError(f"gate {method}: {r.status} {data[:200]!r}")
        return json.loads(data or b"{}")

    def set_routes(self, routes):
        routes = [{"host": "placeholder.pool.test", "backend": "127.0.0.1:9"}] + routes  # lite mode needs >= 1 route
        with self.cfg_lock:  # ApplyConfig is optimistic: it needs the version GetConfig returned (ifMatch)
            for _ in range(5):
                v = self.call("GetConfig", {}).get("version")
                try:
                    self.call("ApplyConfig", {"ifMatch": v, "mergePatch": json.dumps({"config": {"lite": {"routes": routes}}})})
                    return
                except RuntimeError as e:
                    if "stale" not in str(e).lower() and "version" not in str(e).lower():
                        raise
            raise RuntimeError("could not apply gate config")

    def stop(self):
        self.p.terminate()
        self.p.wait(10)


class Pool:
    def __init__(self, a):
        self.a, self.lock = a, threading.RLock()
        self.insts, self.next_id = {}, 0
        self.sem = threading.Semaphore(a.max_starts)
        self.port_free = list(range(a.port_base, a.port_base + 200))
        self.gate = Gate(Path(a.out) / "gate")
        self.routes = {}
        self.events = []

    # ---- instance lifecycle --------------------------------------------------------------------------------------
    def _prepare_dir(self, inst):
        d = Path(self.a.work) / inst.name
        if d.exists():
            self._cleanup_dir(d)
        if self.a.reset == "copy":
            sh("cp", "-a", self.a.template, str(d))
        else:  # overlayfs: instant copy-on-write view of the immutable template, private upper layer
            for sub in ("up", "wk", "mnt"):
                (d / sub).mkdir(parents=True)
            sh("mount", "-t", "overlay", "overlay", "-o",
               f"lowerdir={self.a.template},upperdir={d / 'up'},workdir={d / 'wk'}", str(d / "mnt"))
            sh("chown", "988:988", str(d / "up"))
        inst.dir = d
        return d if self.a.reset == "copy" else d / "mnt"

    def _cleanup_dir(self, d):
        if (d / "mnt").exists():
            sh("umount", str(d / "mnt"), check=False)
        shutil.rmtree(d, ignore_errors=True)

    def spawn(self):
        with self.lock:
            inst = Inst(self.next_id, self.port_free.pop(0))
            self.next_id += 1
            self.insts[inst.id] = inst
        threading.Thread(target=self._boot, args=(inst,), daemon=True).start()
        return inst

    def _boot(self, inst):
        with self.sem:
            t0 = ns()
            try:
                root = self._prepare_dir(inst)
                t_dir = ns()
                sh("docker", "rm", "-f", inst.name, check=False)
                sh("docker", "run", "-d", "--name", inst.name, "--user", "988:988", "--read-only",
                   "--tmpfs", "/tmp:rw,exec,nosuid,size=100M", "--security-opt", "no-new-privileges",
                   "--memory", str(self.a.mem_mb * 1048576), "--memory-swap", str(self.a.mem_mb * 1048576),
                   "--pids-limit", "512", "--cap-drop", "ALL", "-p", f"127.0.0.1:{inst.port}:25565",
                   "-v", f"{root}:/home/container", "-w", "/home/container", "-e", "TZ=UTC", self.a.image,
                   "java", "@/home/container/jvm.args")
                r = probe.wait("127.0.0.1", inst.port, timeout=90)
                if not r.get("status_ns"):
                    raise RuntimeError("never became ready")
                inst.boot_ms = (ns() - t0) / 1e6
                inst.dir_ms = (t_dir - t0) / 1e6
                if self.a.prime:  # one bot login so the first REAL player does not pay the first-join class loading/JIT cost
                    p0 = ns()
                    for k in range(self.a.prime_n):
                        probe.join("127.0.0.1", inst.port, name=f"primer{k}", timeout=30)
                        time.sleep(0.5)
                    inst.prime_ms = (ns() - p0) / 1e6
                with self.lock:
                    inst.state = "ready"
                self.events.append(("ready", inst.id, inst.boot_ms))
            except Exception as e:  # a failed boot is replaced, never handed out
                self.events.append(("failed", inst.id, str(e)))
                self._destroy(inst)
                self.fill()

    def _destroy(self, inst):
        with self.lock:
            inst.state = "retiring"
        sh("docker", "rm", "-f", inst.name, check=False)
        if inst.dir:
            self._cleanup_dir(inst.dir)
        with self.lock:
            self.insts.pop(inst.id, None)
            self.port_free.append(inst.port)

    def fill(self):
        with self.lock:
            live = [i for i in self.insts.values() if i.state in ("starting", "ready")]
            need = max(0, self.a.size - len(live))
            need = min(need, self.a.max_size - len(self.insts))
        for _ in range(need):
            self.spawn()

    # ---- allocation ----------------------------------------------------------------------------------------------
    def reserve(self, match):
        with self.lock:
            ready = sorted((i for i in self.insts.values() if i.state == "ready"), key=lambda i: i.id)
            for inst in ready:
                try:  # health: the instance must answer a fresh protocol-level status request right now
                    probe.status("127.0.0.1", inst.port, timeout=0.5)
                except Exception:
                    inst.state = "failed"
                    threading.Thread(target=self._replace, args=(inst,), daemon=True).start()
                    continue
                inst.state = "reserved"
                inst.match = match
                break
            else:
                return None
        self.fill()  # replenish in the background
        return inst

    def _replace(self, inst):
        self._destroy(inst)
        self.fill()

    def route(self, inst, match):
        host = f"m{match}.pool.test"
        with self.lock:
            self.routes[host] = {"host": host, "backend": f"127.0.0.1:{inst.port}"}
            routes = list(self.routes.values())
        self.gate.set_routes(routes)
        return host

    def end_match(self, inst, host):
        with self.lock:
            self.routes.pop(host, None)
        threading.Thread(target=self._destroy, args=(inst,), daemon=True).start()

    def wait_ready(self, n, timeout=300):
        end = time.time() + timeout
        while time.time() < end:
            with self.lock:
                if sum(i.state == "ready" for i in self.insts.values()) >= n:
                    return True
            time.sleep(0.05)
        return False

    def stop(self):
        for i in list(self.insts.values()):
            self._destroy(i)
        self.gate.stop()


def one_match(pool, mid):
    t0 = ns()
    inst = pool.reserve(mid)
    if inst is None:
        return {"match": mid, "error": "pool exhausted", "reserve_ms": (ns() - t0) / 1e6}
    t1 = ns()
    host = pool.route(inst, mid)
    t2 = ns()
    res = {"match": mid, "instance": inst.id, "reserve_ms": (t1 - t0) / 1e6, "route_ms": (t2 - t1) / 1e6}
    try:
        j = probe.join("127.0.0.1", 25580, name=f"p{mid % 90}", vhost=host)
        t3 = ns()
        res["login_success_ms"] = (t2 - t0) / 1e6 + j["login_success"] * 1000
        res["config_done_ms"] = (t2 - t0) / 1e6 + j["config_done"] * 1000
        res["play_ms"] = (t2 - t0) / 1e6 + j["play_first_packet"] * 1000
        res["request_to_play_ms"] = (t3 - t0) / 1e6
    except Exception as e:
        res["error"] = repr(e)
    pool.end_match(inst, host)
    return res


def stats(v):
    v = sorted(v)
    return {"n": len(v), "min": round(v[0], 1), "median": round(statistics.median(v), 1),
            "p95": round(v[min(len(v) - 1, -(-95 * len(v) // 100) - 1)], 1), "max": round(v[-1], 1)} if v else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["bench"])
    ap.add_argument("--template", required=True)
    ap.add_argument("--image", default="ghcr.io/pterodactyl/yolks:java_25")
    ap.add_argument("--size", type=int, default=3)
    ap.add_argument("--max-size", type=int, default=12)
    ap.add_argument("--max-starts", type=int, default=3)
    ap.add_argument("--matches", type=int, default=20)
    ap.add_argument("--concurrent", type=int, default=1)
    ap.add_argument("--mem-mb", type=int, default=1536)
    ap.add_argument("--prime-n", type=int, default=1, help="number of priming bot logins")
    ap.add_argument("--prime", action="store_true", help="join once with a bot before marking an instance ready")
    ap.add_argument("--reset", choices=["copy", "overlay"], default="copy")
    ap.add_argument("--port-base", type=int, default=25600)
    ap.add_argument("--work", default="/bench/wings-opt/p2/pool-work")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    Path(a.out).mkdir(parents=True, exist_ok=True)
    Path(a.work).mkdir(parents=True, exist_ok=True)
    pool = Pool(a)
    out = {"config": vars(a)}
    try:
        t0 = ns()
        pool.fill()
        assert pool.wait_ready(a.size), "pool never filled"
        out["initial_fill_ms"] = (ns() - t0) / 1e6
        out["boot_ms"] = stats([i.boot_ms for i in pool.insts.values() if i.boot_ms])
        time.sleep(3)
        # idle resources of the warm pool (docker stats counters: one sample per instance)
        st = sh("docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}}").stdout.split("\n")
        out["idle_stats"] = [l for l in st if l.startswith("pool-")]
        results = []
        mid = 0
        while len(results) < a.matches:
            batch = min(a.concurrent, a.matches - len(results))
            with cf.ThreadPoolExecutor(batch) as ex:
                futs = []
                for _ in range(batch):
                    mid += 1
                    futs.append(ex.submit(one_match, pool, mid))
                results += [f.result() for f in futs]
            pool.wait_ready(min(a.size, a.size), timeout=120)  # let the replenishment finish between waves
        out["matches"] = results
        ok = [r for r in results if "request_to_play_ms" in r]
        out["summary"] = {k: stats([r[k] for r in ok if k in r]) for k in
                          ("reserve_ms", "route_ms", "login_success_ms", "config_done_ms", "play_ms", "request_to_play_ms")}
        out["failures"] = [r for r in results if "error" in r]
        out["replenish_boot_ms"] = stats([i.boot_ms for i in pool.insts.values() if i.boot_ms])
        out["prime_ms"] = stats([getattr(i, "prime_ms", None) for i in pool.insts.values() if getattr(i, "prime_ms", None)])
        out["dir_ms"] = stats([getattr(i, "dir_ms", None) for i in pool.insts.values() if getattr(i, "dir_ms", None)])
        out["pool_stats_end"] = [l for l in sh("docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}}").stdout.split("\n") if l.startswith("pool-")]
    finally:
        pool.stop()
    Path(a.out, "pool.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: out.get(k) for k in ("initial_fill_ms", "boot_ms", "summary", "failures", "idle_stats")}, indent=1))


if __name__ == "__main__":
    main()
