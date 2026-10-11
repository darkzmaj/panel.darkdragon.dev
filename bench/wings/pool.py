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
Reliability properties (all covered by tests/test_pool.py, which run without Docker against a fake backend):
  * an instance moves ready -> reserved exactly once, under the pool lock; the (slow) health ping happens OUTSIDE the lock;
  * a failing instance is retired and the next one is tried; an exhausted pool returns None (or waits up to `wait` seconds);
  * boots that keep failing back off exponentially and stop after --max-failures (pool `broken`) instead of spinning;
  * stop() cancels boots in flight and leaves no container or mount behind;
  * the gate route table is rebuilt INSIDE the gate lock and a finished match's route is removed before its port is reused.
Timestamps use perf_counter_ns inside this one process, so every interval below is monotonic.
"""
import argparse, concurrent.futures as cf, http.client, json, os, shutil, statistics, subprocess, sys, threading, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import containers  # noqa: E402
import probe  # noqa: E402

GATE = os.environ.get("GATE_BIN", "/bench/wings-opt/p2/gate/gate")
ns = time.perf_counter_ns
PLACEHOLDER = {"host": "placeholder.pool.test", "backend": "127.0.0.1:9"}  # Gate lite mode needs >= 1 route


def sh(*a, check=True):
    return subprocess.run(a, capture_output=True, text=True, check=check)


class Inst:
    def __init__(self, i, port):
        self.id, self.port, self.state = i, port, "starting"
        self.name = f"pool-{i}"
        self.dir = None
        self.boot_ms = self.dir_ms = self.prime_ms = None
        self.match = None
        self.host = None


class Gate:
    """Minekube Gate (lite mode) with its Connect/JSON config API. `binary=None` attaches to an API that already runs."""

    def __init__(self, work, bind="127.0.0.1:25580", api="127.0.0.1:18099", binary=GATE, start_timeout=15):
        self.bind, self.api = bind, api
        self.cfg_lock = threading.Lock()
        self.p = self.log = None
        if binary:
            work = Path(work).resolve()
            work.mkdir(parents=True, exist_ok=True)
            cfg = work / "gate.yml"
            cfg.write_text(f"config:\n  bind: {bind}\n  lite:\n    enabled: true\n    routes:\n      - host: {PLACEHOLDER['host']}\n"
                           f"        backend: {PLACEHOLDER['backend']}\napi:\n  enabled: true\n  bind: {api}\n")  # API on loopback only
            self.log = open(work / "gate.log", "w")
            self.p = subprocess.Popen([binary, "-c", str(cfg)], cwd=work, stdout=self.log, stderr=subprocess.STDOUT)
        end = time.time() + start_timeout
        while time.time() < end:
            try:
                self.call("GetStatus", {})
                return
            except Exception:
                time.sleep(0.05)
        self.stop()  # never leave a half-started gate behind
        raise RuntimeError("gate did not start")

    def call(self, method, body):
        c = http.client.HTTPConnection(self.api, timeout=10)
        try:
            c.request("POST", f"/minekube.gate.v1.GateService/{method}", json.dumps(body),
                      {"Content-Type": "application/json", "Connect-Protocol-Version": "1"})
            r = c.getresponse()
            data = r.read()
        finally:
            c.close()
        if r.status != 200:
            raise RuntimeError(f"gate {method}: {r.status} {data[:200]!r}")
        return json.loads(data or b"{}")

    def apply_routes(self, provider):
        """Replace the route table with provider() evaluated INSIDE the lock.

        Snapshotting before taking the lock lets an older snapshot overwrite a newer one (lost route = a match that cannot
        join). ApplyConfig is optimistic: it needs the version GetConfig returned (ifMatch), so conflicts are retried."""
        with self.cfg_lock:
            last = None
            for _ in range(5):
                routes = [PLACEHOLDER] + list(provider())
                v = self.call("GetConfig", {}).get("version")
                try:
                    self.call("ApplyConfig", {"ifMatch": v, "mergePatch": json.dumps({"config": {"lite": {"routes": routes}}})})
                    return
                except RuntimeError as e:
                    last = e
                    if "stale" not in str(e).lower() and "version" not in str(e).lower():
                        raise
            raise RuntimeError(f"could not apply gate config: {last}")

    def stop(self):
        if self.p:
            self.p.terminate()
            try:
                self.p.wait(10)
            except subprocess.TimeoutExpired:
                self.p.kill()
                self.p.wait(5)
            self.p = None
        if self.log:
            self.log.close()
            self.log = None


class DockerBackend:
    """Everything that touches Docker, mounts or the filesystem. The Pool only talks to this interface (see FakeBackend in
    tests/test_pool.py), so the allocation logic is testable without a daemon."""

    def __init__(self, a):
        self.a = a

    def prepare(self, inst):
        d = Path(self.a.work) / inst.name
        if d.exists():
            self.cleanup_dir(d)
        if self.a.reset == "copy":
            sh("cp", "-a", self.a.template, str(d))
            root = d
        else:  # overlayfs: instant copy-on-write view of the immutable template, private upper layer
            containers.check_overlay_path(self.a.template)
            containers.check_overlay_path(d)
            for sub in ("up", "wk", "mnt"):
                (d / sub).mkdir(parents=True)
            sh("mount", "-t", "overlay", "overlay", "-o",
               f"lowerdir={self.a.template},upperdir={d / 'up'},workdir={d / 'wk'}", str(d / "mnt"))
            sh("chown", "988:988", str(d / "up"))
            root = d / "mnt"
        inst.dir = d
        return root

    def cleanup_dir(self, d):
        if (d / "mnt").exists():
            r = sh("umount", str(d / "mnt"), check=False)
            if r.returncode != 0 and os.path.ismount(d / "mnt"):
                sh("umount", "-l", str(d / "mnt"), check=False)
                if os.path.ismount(d / "mnt"):
                    return False  # never rmtree through a live mount
        shutil.rmtree(d, ignore_errors=True)
        return True

    def launch(self, inst, root):
        sh("docker", "rm", "-f", inst.name, check=False)
        sh(*containers.run_args(inst.name, inst.port, root, self.a.image, self.a.mem_mb, ["java", "@/home/container/jvm.args"]))

    def await_ready(self, inst, cancel):
        r = probe.wait("127.0.0.1", inst.port, timeout=self.a.boot_timeout, cancel=cancel)
        return bool(r.get("status_ns"))

    def prime(self, inst):  # bot logins so the first REAL player does not pay first-join class loading/JIT cost
        for k in range(self.a.prime_n):
            probe.join("127.0.0.1", inst.port, name=f"primer{k}", timeout=30)
            time.sleep(0.5)

    def check(self, inst):
        probe.status("127.0.0.1", inst.port, timeout=0.5)  # fresh protocol-level status request; raises when unhealthy

    def kill(self, inst):  # chaos only: simulate a crashed server (OOM kill, JVM crash)
        sh("docker", "kill", inst.name, check=False)

    def destroy(self, inst):
        sh("docker", "rm", "-f", inst.name, check=False)
        if inst.dir:
            self.cleanup_dir(inst.dir)


class Pool:
    def __init__(self, a, backend=None, gate=None):
        self.a, self.lock = a, threading.RLock()
        self.cv = threading.Condition(self.lock)
        self.backend = backend or DockerBackend(a)
        self.gate = gate if gate is not None else Gate(Path(a.out) / "gate")
        self.insts, self.next_id = {}, 0
        self.sem = threading.Semaphore(a.max_starts)
        self.port_free = list(range(a.port_base, a.port_base + a.max_size))
        self.routes = {}
        self.events = []
        self.closing = threading.Event()
        self.threads = []
        self.fail_streak = 0
        self.broken = False

    # ---- instance lifecycle --------------------------------------------------------------------------------------
    def spawn(self):
        """Caller holds self.lock."""
        if not self.port_free:
            return None
        inst = Inst(self.next_id, self.port_free.pop(0))
        self.next_id += 1
        self.insts[inst.id] = inst
        t = threading.Thread(target=self._boot, args=(inst,), daemon=True)
        self.threads.append(t)
        t.start()
        return inst

    def _acquire_slot(self):
        while not self.sem.acquire(timeout=0.1):
            if self.closing.is_set():
                return False
        return True

    def _boot(self, inst):
        if not self._acquire_slot():
            self._destroy(inst)
            return
        failed = None
        try:
            t0 = ns()
            root = self.backend.prepare(inst)
            inst.dir_ms = (ns() - t0) / 1e6
            self.backend.launch(inst, root)
            if not self.backend.await_ready(inst, self.closing):
                raise RuntimeError("cancelled" if self.closing.is_set() else "never became ready")
            inst.boot_ms = (ns() - t0) / 1e6
            if self.a.prime:
                p0 = ns()
                self.backend.prime(inst)
                inst.prime_ms = (ns() - p0) / 1e6
            with self.lock:
                if self.closing.is_set():
                    raise RuntimeError("cancelled")
                inst.state = "ready"
                self.fail_streak = 0
                self.cv.notify_all()
            self.events.append(("ready", inst.id, inst.boot_ms))
        except Exception as e:  # a failed boot is replaced, never handed out
            failed = e
        finally:
            self.sem.release()
        if failed is not None:
            self.events.append(("failed", inst.id, str(failed)))
            self._destroy(inst)
            if self.closing.is_set():
                return
            with self.lock:
                self.fail_streak += 1
                streak = self.fail_streak
                if streak >= self.a.max_failures:
                    self.broken = True
                    self.events.append(("broken", inst.id, f"{streak} consecutive boot failures"))
                    self.cv.notify_all()
                    return
            self.closing.wait(min(self.a.backoff_max, self.a.backoff * 2 ** (streak - 1)))
            self.fill()

    def _destroy(self, inst):
        with self.lock:
            if inst.state == "retiring":
                return  # idempotent: a failed boot and a failed health check may both retire the same instance
            inst.state = "retiring"
        try:
            self.backend.destroy(inst)
        finally:
            with self.lock:
                self.insts.pop(inst.id, None)
                self.port_free.append(inst.port)
                self.cv.notify_all()

    def fill(self):
        with self.lock:
            if self.closing.is_set() or self.broken:
                return
            live = sum(1 for i in self.insts.values() if i.state in ("starting", "ready"))
            need = min(max(0, self.a.size - live), self.a.max_size - len(self.insts))
            for _ in range(need):  # spawned under the lock: two concurrent fill() calls cannot both fill the same gap
                self.spawn()

    def reset(self):
        """Operator action after fixing whatever broke the boots (image, ports, disk): clear the breaker and refill."""
        with self.lock:
            self.broken, self.fail_streak = False, 0
        self.fill()

    # ---- allocation ----------------------------------------------------------------------------------------------
    def _take_ready(self, match):
        with self.lock:
            for inst in sorted((i for i in self.insts.values() if i.state == "ready"), key=lambda i: i.id):
                inst.state = "reserved"  # the ONLY ready -> reserved transition; it happens under the lock, once per instance
                inst.match = match
                return inst
        return None

    def reserve(self, match, wait=0.0):
        """Return a healthy, exclusively owned instance, or None when the pool is exhausted (after waiting up to `wait` s)."""
        end = time.monotonic() + wait
        while True:
            inst = self._take_ready(match)
            if inst is None:
                with self.lock:
                    left = end - time.monotonic()
                    if left <= 0 or self.closing.is_set() or self.broken:
                        return None
                    if not any(i.state == "ready" for i in self.insts.values()):
                        self.cv.wait(min(left, 0.2))
                continue
            try:  # health is checked outside the lock: one slow probe must not serialise every other allocation
                self.backend.check(inst)
            except Exception:
                self.events.append(("unhealthy", inst.id, "failed pre-reserve status ping"))
                inst.match = None
                threading.Thread(target=self._replace, args=(inst,), daemon=True).start()
                continue
            self.fill()  # replenish in the background
            return inst

    def _replace(self, inst):
        self._destroy(inst)
        self.fill()

    def route(self, inst, match):
        host = f"m{match}.pool.test"
        with self.lock:
            self.routes[host] = {"host": host, "backend": f"127.0.0.1:{inst.port}"}
            inst.host = host
        self.gate.apply_routes(self._route_list)
        return host

    def _route_list(self):
        with self.lock:
            return list(self.routes.values())

    def end_match(self, inst, host=None):
        """Retire a finished match. Its route is removed from the gate BEFORE the port is released, otherwise a stale
        `m<id>.pool.test` could reach the next match that reuses the port (cross-match leak)."""
        host = host or inst.host

        def retire():
            try:
                if host:
                    with self.lock:
                        self.routes.pop(host, None)
                    self.gate.apply_routes(self._route_list)
            except Exception as e:
                self.events.append(("route_cleanup_failed", inst.id, str(e)))
            finally:
                self._destroy(inst)
                self.fill()  # capacity freed: without this a pool with max_size == size stays drained after the first match
        t = threading.Thread(target=retire, daemon=True)
        self.threads.append(t)
        t.start()
        return t

    def chaos_kill_one(self, rng=None):
        """Kill one READY or STARTING instance's server (never a reserved one: that would fail a match by design).
        Used by --chaos-every to prove the pool notices and replaces dead instances. Returns the victim or None."""
        import random
        with self.lock:
            cand = [i for i in self.insts.values() if i.state in ("starting", "ready")]
            victim = (rng or random).choice(cand) if cand else None
        if victim is not None:
            self.backend.kill(victim)
            self.events.append(("chaos_kill", victim.id, victim.state))
        return victim

    def sweep(self):
        """Health-check every READY instance (outside the lock) and retire the dead ones, so a crashed idle server is replaced
        within one sweep instead of being discovered by the next player. Returns the number retired."""
        with self.lock:
            ready = [i for i in self.insts.values() if i.state == "ready"]
        dead = 0
        for inst in ready:
            try:
                self.backend.check(inst)
            except Exception:
                with self.lock:
                    if inst.state != "ready":      # reserved or retired meanwhile: not ours to retire
                        continue
                    inst.state = "failed"
                self.events.append(("swept", inst.id, "idle server stopped answering"))
                dead += 1
                threading.Thread(target=self._replace, args=(inst,), daemon=True).start()
        return dead

    def start_sweeper(self, every):
        def loop():
            while not self.closing.wait(every):
                self.sweep()
        t = threading.Thread(target=loop, daemon=True)
        self.threads.append(t)
        t.start()

    def start_chaos(self, every):
        def loop():
            while not self.closing.wait(every):
                self.chaos_kill_one()
        t = threading.Thread(target=loop, daemon=True)
        self.threads.append(t)
        t.start()

    def wait_ready(self, n, timeout=300):
        end = time.monotonic() + timeout
        with self.lock:
            while sum(i.state == "ready" for i in self.insts.values()) < n:
                left = end - time.monotonic()
                if left <= 0 or self.broken or self.closing.is_set():
                    return False
                self.cv.wait(min(left, 0.2))
            return True

    def stop(self):
        self.closing.set()
        with self.lock:
            self.cv.notify_all()
        for t in list(self.threads):
            t.join(timeout=30)
        for i in list(self.insts.values()):
            self._destroy(i)
        self.gate.stop()


def one_match(pool, mid, join=None, reserve_wait=0.0):
    join = join or (lambda host: probe.join("127.0.0.1", 25580, name=f"p{mid % 90}", vhost=host))
    t0 = ns()
    inst = pool.reserve(mid, wait=reserve_wait)
    if inst is None:
        return {"match": mid, "error": "pool exhausted", "reserve_ms": (ns() - t0) / 1e6}
    t1 = ns()
    res = {"match": mid, "instance": inst.id, "reserve_ms": (t1 - t0) / 1e6}
    host = None
    try:
        host = pool.route(inst, mid)
        t2 = ns()
        res["route_ms"] = (t2 - t1) / 1e6
        j = join(host)
        t3 = ns()
        res["login_success_ms"] = (t2 - t0) / 1e6 + j["login_success"] * 1000
        res["config_done_ms"] = (t2 - t0) / 1e6 + j["config_done"] * 1000
        res["play_ms"] = (t2 - t0) / 1e6 + j["play_first_packet"] * 1000
        res["request_to_play_ms"] = (t3 - t0) / 1e6
    except Exception as e:
        res["error"] = repr(e)
    finally:
        pool.end_match(inst, host)  # always: a failed join must not leak the instance, its port or its route
    return res


def stats(v):
    v = sorted(v)
    return {"n": len(v), "min": round(v[0], 1), "median": round(statistics.median(v), 1),
            "p95": round(v[min(len(v) - 1, -(-95 * len(v) // 100) - 1)], 1), "max": round(v[-1], 1)} if v else None


def make_args(**kw):
    d = dict(template=None, image="ghcr.io/pterodactyl/yolks:java_25", size=3, max_size=12, max_starts=3, matches=20,
             concurrent=1, mem_mb=1536, prime_n=1, prime=False, reset="copy", port_base=25600, boot_timeout=90,
             max_failures=5, backoff=0.5, backoff_max=10.0, work="/bench/wings-opt/p2/pool-work", out=".")
    d.update(kw)
    return argparse.Namespace(**d)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["bench"])
    ap.add_argument("--template", required=True)
    for k, v in (("image", "ghcr.io/pterodactyl/yolks:java_25"), ("work", "/bench/wings-opt/p2/pool-work")):
        ap.add_argument(f"--{k}", default=v)
    for k, v in (("size", 3), ("max-size", 12), ("max-starts", 3), ("matches", 20), ("concurrent", 1), ("mem-mb", 1536),
                 ("prime-n", 1), ("port-base", 25600), ("boot-timeout", 90), ("max-failures", 5)):
        ap.add_argument(f"--{k}", type=int, default=v)
    ap.add_argument("--prime", action="store_true", help="join once with a bot before marking an instance ready")
    ap.add_argument("--reset", choices=["copy", "overlay"], default="copy")
    ap.add_argument("--chaos-every", type=float, default=0, help="seconds between random kills of an idle warm server (0 = off)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    a.backoff, a.backoff_max = 0.5, 10.0
    if a.concurrent > a.size + a.max_size:
        ap.error("--concurrent far exceeds the pool; results would only measure exhaustion")
    Path(a.out).mkdir(parents=True, exist_ok=True)
    Path(a.work).mkdir(parents=True, exist_ok=True)
    pool = Pool(a)
    out = {"config": vars(a)}
    try:
        t0 = ns()
        pool.fill()
        if not pool.wait_ready(a.size):
            raise SystemExit(f"pool never filled: {pool.events[-5:]}")
        out["initial_fill_ms"] = (ns() - t0) / 1e6
        pool.start_sweeper(2.0)
        if a.chaos_every:
            pool.start_chaos(a.chaos_every)
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
            if not pool.wait_ready(a.size, timeout=120):  # let the replenishment finish between waves
                out.setdefault("replenish_timeouts", []).append(mid)
        out["matches"] = results
        ok = [r for r in results if "request_to_play_ms" in r]
        out["summary"] = {k: stats([r[k] for r in ok if k in r]) for k in
                          ("reserve_ms", "route_ms", "login_success_ms", "config_done_ms", "play_ms", "request_to_play_ms")}
        out["failures"] = [r for r in results if "error" in r]
        out["instances_used"] = sorted(r["instance"] for r in results if "instance" in r)
        out["pool_events"] = [list(e) for e in pool.events]
        out["replenish_boot_ms"] = stats([i.boot_ms for i in pool.insts.values() if i.boot_ms])
        out["prime_ms"] = stats([i.prime_ms for i in pool.insts.values() if i.prime_ms])
        out["dir_ms"] = stats([i.dir_ms for i in pool.insts.values() if i.dir_ms])
        out["pool_stats_end"] = [l for l in sh("docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}}").stdout.split("\n") if l.startswith("pool-")]
    finally:
        pool.stop()
    Path(a.out, "pool.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: out.get(k) for k in ("initial_fill_ms", "boot_ms", "summary", "failures", "idle_stats")}, indent=1))


if __name__ == "__main__":
    main()
