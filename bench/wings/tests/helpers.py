"""Fakes shared by the tests. Nothing here starts Docker, Java or Minecraft."""
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pool  # noqa: E402


class FakeBackend:
    """In-memory stand-in for pool.DockerBackend with scriptable latency, failures and hangs."""

    def __init__(self, boot_s=0.0, check_s=0.0):
        self.boot_s, self.check_s = boot_s, check_s
        self.lock = threading.Lock()
        self.alive = set()            # instance names that exist right now
        self.ports_in_use = {}        # port -> name, to catch two live instances sharing a port
        self.port_clash = []
        self.launches = 0
        self.fail_launch = False
        self.hang_boot = False        # await_ready blocks until cancelled
        self.unhealthy = set()
        self.unhealthy_all = False
        self.running = self.max_running = 0
        self.on_destroy = None

    def prepare(self, inst):
        inst.dir = None
        return Path("/nonexistent")

    def launch(self, inst, root):
        with self.lock:
            self.launches += 1
            if self.fail_launch:
                raise RuntimeError("docker run failed (scripted)")
            if inst.port in self.ports_in_use:
                self.port_clash.append((inst.name, self.ports_in_use[inst.port]))
            self.ports_in_use[inst.port] = inst.name
            self.alive.add(inst.name)

    def await_ready(self, inst, cancel):
        with self.lock:
            self.running += 1
            self.max_running = max(self.max_running, self.running)
        try:
            if self.hang_boot:
                cancel.wait(30)
                return False
            time.sleep(self.boot_s)
            return not cancel.is_set()
        finally:
            with self.lock:
                self.running -= 1

    def prime(self, inst):
        pass

    def check(self, inst):
        time.sleep(self.check_s)
        if self.unhealthy_all or inst.name in self.unhealthy:
            raise OSError("connection refused (scripted)")

    def kill(self, inst):
        self.unhealthy.add(inst.name)   # a killed server stops answering the status ping

    def destroy(self, inst):
        if self.on_destroy:
            self.on_destroy(inst)
        with self.lock:
            self.alive.discard(inst.name)
            if self.ports_in_use.get(inst.port) == inst.name:
                del self.ports_in_use[inst.port]


class FakeGate:
    def __init__(self):
        self.applied = []
        self.lock = threading.Lock()
        self.current = []
        self.stopped = False

    def apply_routes(self, provider):
        with self.lock:
            self.current = [dict(r) for r in provider()]
            self.applied.append(list(self.current))

    def hosts(self):
        with self.lock:
            return {r["host"] for r in self.current}

    def stop(self):
        self.stopped = True


def make_pool(backend=None, gate=None, **kw):
    kw.setdefault("backoff", 0.01)
    kw.setdefault("backoff_max", 0.05)
    a = pool.make_args(**kw)
    return pool.Pool(a, backend=backend or FakeBackend(), gate=gate or FakeGate())


class FakeGateAPI:
    """HTTP server speaking the three Gate Connect/JSON methods used by pool.Gate, with optimistic versioning."""

    def __init__(self, stale_first=0, delay_s=0.0):
        outer = self
        self.version, self.routes, self.stale_left = 1, [], stale_first
        self.applied = 0
        self.lock = threading.Lock()
        self.delay_s = delay_s

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(n) or b"{}")
                method = self.path.rsplit("/", 1)[-1]
                with outer.lock:
                    code, out = 200, {}
                    if method == "GetConfig":
                        out = {"version": str(outer.version)}
                        if outer.delay_s:
                            time.sleep(outer.delay_s)
                    elif method == "ApplyConfig":
                        if outer.stale_left > 0:
                            outer.stale_left -= 1
                            outer.version += 1
                            code, out = 409, {"message": "stale version"}
                        elif body.get("ifMatch") != str(outer.version):
                            code, out = 409, {"message": "stale version"}
                        else:
                            outer.routes = json.loads(body["mergePatch"])["config"]["lite"]["routes"]
                            outer.version += 1
                            outer.applied += 1
                    elif method == "GetStatus":
                        pass
                    else:
                        code, out = 404, {"message": "unknown"}
                data = json.dumps(out).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.addr = "127.0.0.1:%d" % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def hosts(self):
        with self.lock:
            return {r["host"] for r in self.routes} - {pool.PLACEHOLDER["host"]}

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()
