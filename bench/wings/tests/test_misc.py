import io, json, socket, struct, tempfile, threading, time, unittest, zipfile
from pathlib import Path
from unittest import mock

import conc, containers, mkvariant, probe


def make_jar(path, libs=("a/b.jar", "c/d.jar"), ver="1.21.11/server-1.21.11.jar", main="io.papermc.paperclip.Main"):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("META-INF/libraries.list", "".join(f"h{i}\tid{i}\t{p}\n" for i, p in enumerate(libs)))
        z.writestr("META-INF/versions.list", f"h\tid\t{ver}\n")
        z.writestr("META-INF/main-class", main)


class Containers(unittest.TestCase):
    def args(self, **kw):
        d = dict(name="pool-1", port=25601, root="/w/pool-1", image="img", mem_mb=1536, cmd=["java", "@/home/container/jvm.args"])
        d.update(kw)
        return containers.run_args(**d)

    def test_security_posture(self):
        a = self.args()
        for flag in ("--read-only", "--cap-drop", "--pids-limit"):
            self.assertIn(flag, a)
        self.assertEqual(a[a.index("--cap-drop") + 1], "ALL")
        self.assertIn("no-new-privileges", a)
        self.assertEqual(a[a.index("--user") + 1], "988:988")
        self.assertEqual(a[a.index("-p") + 1], "127.0.0.1:25601:25565")   # loopback only
        self.assertEqual(a[a.index("--memory") + 1], a[a.index("--memory-swap") + 1])  # no swap
        self.assertNotIn("--privileged", a)
        self.assertEqual(a[-2:], ["java", "@/home/container/jvm.args"])

    def test_rejects_unsafe_inputs(self):
        for bad in ("a b", "x;rm -rf /", "-rf", "", "a/b", "$(id)"):
            with self.assertRaises(ValueError):
                self.args(name=bad)
        with self.assertRaises(ValueError):
            self.args(cmd="java -jar x")        # a shell string, not an argv list
        with self.assertRaises(ValueError):
            self.args(port=0)
        with self.assertRaises(ValueError):
            self.args(mem_mb=10)

    def test_overlay_paths(self):
        containers.check_overlay_path("/bench/templates/canvas")
        for bad in ("/a,b", "/a:b", "/a\nb"):
            with self.assertRaises(ValueError):
                containers.check_overlay_path(bad)


class Mkvariant(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.base = self.tmp / "base"
        self.base.mkdir()
        make_jar(self.base / "server.jar")
        (self.base / "world").mkdir()
        (self.base / "world" / "level.dat").write_text("pristine")
        (self.base / "server.properties").write_text("online-mode=false\n")

    def test_classpath_order_and_main(self):
        cp, main = mkvariant.classpath(self.base / "server.jar")
        self.assertEqual(cp, "versions/1.21.11/server-1.21.11.jar:libraries/a/b.jar:libraries/c/d.jar")
        self.assertEqual(main, "io.papermc.paperclip.Main")

    def test_path_traversal_in_metadata_is_rejected(self):
        make_jar(self.tmp / "evil.jar", libs=("../../etc/passwd",))
        with self.assertRaises(ValueError):
            mkvariant.classpath(self.tmp / "evil.jar")
        make_jar(self.tmp / "evil2.jar", libs=("/abs/x.jar",))
        with self.assertRaises(ValueError):
            mkvariant.classpath(self.tmp / "evil2.jar")

    def test_jvm_lines(self):
        pc = mkvariant.jvm_lines("-Xms1M -Da=b", [], "paperclip")
        self.assertEqual(pc, ["-Xms1M", "-Da=b", "-jar", "server.jar", "nogui"])
        by = mkvariant.jvm_lines("-Xms1M", ["-XX:AOTCache=/x"], "aot", "cp1", "Main")
        self.assertEqual(by[-4:], ["-cp", "cp1", "Main", "nogui"])
        self.assertIn("-XX:AOTCache=/x", by)

    def run_build(self, extra, fake_ready=True):
        out = self.tmp / "new"
        A = mkvariant.parse([str(self.base), str(out), "--image", "img", *extra])
        calls = []

        def start(name, root, A):
            calls.append(("start", name, Path(root)))
            jv = (Path(root) / "jvm.args").read_text()
            for line in jv.split():                 # emulate the JVM writing the archive at exit
                for pre in ("-XX:AOTCacheOutput=", "-XX:ArchiveClassesAtExit="):
                    if line.startswith(pre):
                        (Path(root) / line[len(pre):].rsplit("/", 1)[-1]).write_bytes(b"ARCHIVE")
            (Path(root) / "world" / "level.dat").write_text("MUTATED BY TRAINING BOOT")   # a real boot rewrites the world

        with mock.patch.object(mkvariant, "start_container", start), \
                mock.patch.object(mkvariant, "stop_container", lambda n, g=90: "log"), \
                mock.patch.object(mkvariant, "wait_ready", lambda A: fake_ready), \
                mock.patch.object(mkvariant, "chown", lambda p: None), \
                mock.patch.object(mkvariant.time, "sleep", lambda s: None):
            mkvariant.build(A)
        return out, calls

    def test_aot_training_never_touches_the_measured_template(self):
        out, calls = self.run_build(["--aot"])
        self.assertEqual((out / "world" / "level.dat").read_text(), "pristine")
        self.assertTrue((out / "app.aot").exists())
        self.assertFalse(Path(str(out) + ".train").exists(), "scratch training copy must be removed")
        args = (out / "jvm.args").read_text().split()
        self.assertIn("-XX:AOTCache=/home/container/app.aot", args)
        self.assertFalse(any(a.startswith("-XX:AOTCacheOutput") for a in args))
        self.assertNotIn("-XX:AOTMode=on", args)

    def test_strict_adds_mode_on(self):
        out, _ = self.run_build(["--aot", "--strict"])
        self.assertIn("-XX:AOTMode=on", (out / "jvm.args").read_text().split())
        out, _ = self.run_build(["--cds", "--strict"])
        self.assertIn("-Xshare:on", (out / "jvm.args").read_text().split())

    def test_bypass_and_paperclip_need_no_training(self):
        out, calls = self.run_build(["--bypass"])
        self.assertEqual(calls, [])
        self.assertNotIn("-jar", (out / "jvm.args").read_text().split())
        self.assertFalse((out / "app.aot").exists())
        out, calls = self.run_build(["--paperclip"])
        self.assertIn("-jar", (out / "jvm.args").read_text().split())

    def test_variants_differ_only_in_startup_files(self):
        outs = {}
        for k in ("--paperclip", "--bypass", "--aot"):
            outs[k], _ = self.run_build([k])
            snap = {p.relative_to(outs[k]).as_posix(): p.read_bytes() for p in outs[k].rglob("*") if p.is_file()}
            outs[k] = snap
            __import__("shutil").rmtree(self.tmp / "new")
        keys = set().union(*[set(v) for v in outs.values()]) - {"jvm.args", "app.aot"}
        for k in keys:
            self.assertEqual({v.get(k) for v in outs.values()}, {outs["--bypass"][k]}, k)

    def test_failed_training_boot_raises_and_cleans_up(self):
        with self.assertRaises(AssertionError):
            self.run_build(["--aot"], fake_ready=False)
        self.assertFalse(Path(str(self.tmp / "new") + ".train").exists())

    def test_verify_runs_strict_boot_without_changing_template(self):
        out, calls = self.run_build(["--aot", "--verify"])
        self.assertEqual(len(calls), 2)                          # training boot + strict verification boot
        self.assertNotIn("-XX:AOTMode=on", (out / "jvm.args").read_text().split())
        self.assertFalse(Path(str(out) + ".verify").exists())

    def test_mutually_exclusive_variants(self):
        with self.assertRaises(SystemExit), mock.patch("sys.stderr", io.StringIO()):
            mkvariant.parse(["a", "b", "--image", "i", "--aot", "--cds"])


class FakeStatusServer:
    def __init__(self, behaviour):
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(8)
        self.port = self.srv.getsockname()[1]
        self.behaviour = behaviour
        self.stop = False
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while not self.stop:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self.handle, args=(c,), daemon=True).start()

    def handle(self, c):
        try:
            c.settimeout(2)
            if not c.recv(4096):
                return
            self.behaviour(c)
        except OSError:
            pass
        finally:
            c.close()

    def close(self):
        self.stop = True
        self.srv.close()


class Probe(unittest.TestCase):
    def serve(self, b):
        s = FakeStatusServer(b)
        self.addCleanup(s.close)
        return s

    def test_selftest(self):
        probe.selftest()

    def test_open_socket_is_not_ready(self):
        s = self.serve(lambda c: time.sleep(0.5))      # accepts, never speaks the protocol
        r = probe.wait("127.0.0.1", s.port, timeout=0.6)
        self.assertIsNotNone(r["tcp_ns"])
        self.assertIsNone(r["status_ns"])

    def test_json_without_version_is_not_ready(self):
        def b(c):
            body = json.dumps({"description": "loading"}).encode()
            c.sendall(probe.packet(0x00, probe.varint(len(body)) + body))
        s = self.serve(b)
        r = probe.wait("127.0.0.1", s.port, timeout=0.5)
        self.assertIsNone(r["status_ns"])

    def test_absurd_frame_length_is_refused_quickly(self):
        s = self.serve(lambda c: c.sendall(probe.varint(1 << 30)))
        t0 = time.monotonic()
        with self.assertRaises(ValueError):
            probe.status("127.0.0.1", s.port, timeout=2)
        self.assertLess(time.monotonic() - t0, 1.5)

    def test_cancel_stops_wait_promptly(self):
        ev = threading.Event()
        threading.Timer(0.2, ev.set).start()
        t0 = time.monotonic()
        r = probe.wait("127.0.0.1", 9, timeout=30, cancel=ev)   # nothing listens on port 9
        self.assertEqual(r["error"], "cancelled")
        self.assertLess(time.monotonic() - t0, 2)

    def test_wait_times_out(self):
        t0 = time.monotonic()
        r = probe.wait("127.0.0.1", 9, timeout=0.3)
        self.assertEqual(r["error"], "timeout")
        self.assertLess(time.monotonic() - t0, 2)

    def test_join_total_deadline(self):
        def trickle(c):                                  # Login Success, then keep-alives forever: never finishes configuration
            c.sendall(probe.packet(0x02, b"x"))
            for _ in range(200):
                c.sendall(probe.packet(0x04, b"\x00" * 8))
                time.sleep(0.05)
        s = self.serve(trickle)
        t0 = time.monotonic()
        with self.assertRaises(TimeoutError):
            probe.join("127.0.0.1", s.port, timeout=0.5)
        self.assertLess(time.monotonic() - t0, 3)


class Conc(unittest.TestCase):
    def args(self, **kw):
        d = ["--template", "/t/x", "--out", "/tmp/o", "--n", "4", "--repeat", "1", "--mem-mb", "1000"]
        return conc.parse(d + [i for k, v in kw.items() for i in (f"--{k.replace('_', '-')}", str(v))])

    def test_preflight_refuses_overcommit(self):
        with self.assertRaises(SystemExit):
            conc.preflight(self.args(n=10), available_mb=8000)
        conc.preflight(self.args(n=4), available_mb=8000)
        with self.assertRaises(SystemExit):
            conc.preflight(self.args(n=0), available_mb=8000)

    def test_boot_failure_is_a_row_not_an_exception(self):
        a = self.args()

        def boom(*x, **k):
            raise RuntimeError("docker run failed")
        row = conc.boot(a, 2, "r0", conc.ns(), run=boom, wait=lambda *x, **k: {})
        self.assertIsNone(row["ready_ms"])
        self.assertIn("docker run failed", row["error"])

    def test_boot_timeout_is_a_failure_and_ok_is_timed_from_T0(self):
        a = self.args()
        T0 = conc.ns()
        bad = conc.boot(a, 0, "r0", T0, run=lambda *x, **k: None, wait=lambda *x, **k: {"error": "timeout"})
        self.assertIsNone(bad["ready_ms"])
        good = conc.boot(a, 1, "r0", T0, run=lambda *x, **k: None, wait=lambda *x, **k: {"status_ns": 1})
        self.assertGreaterEqual(good["ready_ms"], good["container_started_ms"])

    def test_summaries_handle_all_failed(self):
        rows = [{"i": 0, "ready_ms": None, "container_started_ms": None}]
        rd = conc.round_summary(rows, [], [])
        self.assertEqual(rd["failed"], 1)
        o = conc.overall({"rounds": [rd]}, 1)
        self.assertIsNone(o["median"])
        rd2 = conc.round_summary([{"i": 0, "ready_ms": 3000.0}, {"i": 1, "ready_ms": 4000.0}], [(0, 55.0, 900)], [])
        o = conc.overall({"rounds": [rd, rd2]}, 2)
        self.assertEqual((o["median"], o["failed"], o["min_mem_available_mb"]), (3500, 1, 900))


if __name__ == "__main__":
    unittest.main()
