import json, tempfile, unittest
from pathlib import Path
from unittest import mock

import lifecycle


def make_tpl(root, name, jvm_args, aot=None):
    d = Path(root) / name
    d.mkdir(parents=True)
    (d / "server.jar").write_bytes(b"J" * 1000)
    (d / "jvm.args").write_text(jvm_args)
    if aot:
        (d / "app.aot").write_bytes(b"A" * aot)
    (d / "world").mkdir()
    (d / "world" / "level.dat").write_text("w")
    return d


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        (self.tmp / "token").write_text("t\n")
        self.vols = self.tmp / "vols"
        self.vols.mkdir()
        self.noop_sh = lambda *a, check=True: (__import__("subprocess").run(a, capture_output=True, text=True, check=check).stdout
                                               if a[0] == "cp" else "")

    def init(self, template, scenario="restart", label="x", uuid="u1", mode="wings", extra=()):
        lifecycle.init(["--mode", mode, "--label", label, "--scenario", scenario, "--out", str(self.tmp / "out"),
                        "--template", str(template), "--uuid", uuid, "--volumes", str(self.vols),
                        "--wings-token-file", str(self.tmp / "token"), *extra])
        self.addCleanup(lambda: lifecycle.TL.close())


class Fingerprint(Base):
    def test_variants_have_distinct_fingerprints(self):
        a = make_tpl(self.tmp, "default", "-jar server.jar\n")
        b = make_tpl(self.tmp, "aot", "-XX:AOTCache=/home/container/app.aot\n", aot=5000)
        self.assertNotEqual(lifecycle.fingerprint(a), lifecycle.fingerprint(b))
        self.assertEqual(lifecycle.fingerprint(a), lifecycle.fingerprint(a))

    def test_runtime_state_does_not_change_fingerprint(self):
        a = make_tpl(self.tmp, "default", "x\n")
        before = lifecycle.fingerprint(a)
        (a / "world" / "level.dat").write_text("changed by a running server")
        (a / "logs").mkdir()
        (a / "logs" / "latest.log").write_text("log")
        self.assertEqual(lifecycle.fingerprint(a), before)

    def test_contaminated_volume_is_detected(self):
        default = make_tpl(self.tmp, "default", "-jar server.jar\n")
        aot = make_tpl(self.tmp, "aot", "-XX:AOTCache=/home/container/app.aot\n", aot=5000)
        self.init(aot)
        (self.vols / "u1").mkdir()
        __import__("shutil").copytree(default, self.vols / "u1", dirs_exist_ok=True)   # previous variant left its files behind
        with self.assertRaises(RuntimeError):
            lifecycle.assert_variant_files()

    def test_reset_files_leaves_exactly_the_template_variant(self):
        default = make_tpl(self.tmp, "default", "-jar server.jar\n")
        aot = make_tpl(self.tmp, "aot", "-XX:AOTCache=/home/container/app.aot\n", aot=5000)
        self.init(aot)
        (self.vols / "u1").mkdir()
        __import__("shutil").copytree(default, self.vols / "u1", dirs_exist_ok=True)
        (self.vols / "u1" / "stale-plugin-data.db").write_text("from the other variant")
        with mock.patch.object(lifecycle, "sh", self.noop_sh):
            lifecycle.reset_files()
        self.assertEqual(lifecycle.assert_variant_files(), lifecycle.fingerprint(aot))
        self.assertFalse((self.vols / "u1" / "stale-plugin-data.db").exists())


class ResetPolicy(Base):
    def test_restart_resets_once_per_invocation(self):
        t = make_tpl(self.tmp, "t", "x\n")
        self.init(t, "restart")
        self.assertEqual([lifecycle.needs_reset() for _ in range(4)], [True, False, False, False])
        self.init(t, "restart")                                   # a new invocation (next variant) re-arms the reset
        self.assertTrue(lifecycle.needs_reset())

    def test_start_resets_every_cycle(self):
        t = make_tpl(self.tmp, "t", "x\n")
        self.init(t, "start")
        self.assertEqual([lifecycle.needs_reset() for _ in range(3)], [True, True, True])


class Config(Base):
    def test_wings_mode_requires_token_and_uuid(self):
        t = make_tpl(self.tmp, "t", "x\n")
        (self.tmp / "token").write_text("")
        with self.assertRaises(SystemExit):
            self.init(t)
        (self.tmp / "token").write_text("tok")
        with self.assertRaises(SystemExit):
            lifecycle.init(["--mode", "wings", "--label", "x", "--out", str(self.tmp / "o2"), "--wings-token-file",
                            str(self.tmp / "token")])

    def test_two_variants_never_share_container_or_volume_names_in_direct_mode(self):
        t = make_tpl(self.tmp, "t", "x\n")
        self.init(t, label="canvas-default-direct-restart", mode="direct")
        a = (lifecycle.NAME, lifecycle.VOL)
        self.init(t, label="canvas-aot-direct-restart", mode="direct")
        self.assertNotEqual(a, (lifecycle.NAME, lifecycle.VOL))


class ReadyGate(Base):
    """The restart readiness rule: only a status answer AFTER the old container died counts."""

    def test_old_server_answers_do_not_count(self):
        t = make_tpl(self.tmp, "t", "x\n")
        self.init(t)
        pings = [(100, True), (200, False), (300, True)]          # transitions: up, down (old server gone), up (new server)
        die = 250
        self.assertEqual(lifecycle.first(pings, lambda x: x[1], die), 300)
        self.assertEqual(lifecycle.first(pings, lambda x: x[1], 0), 100)   # without the gate the OLD server would be counted
        self.assertIsNone(lifecycle.first(pings[:2], lambda x: x[1], die))

    def test_ev_first_picks_first_event_after_cutoff(self):
        class W:
            events = [("die", 10), ("start", 20), ("die", 50), ("die", 90)]
        self.assertEqual(lifecycle.ev_first(W, "die", 11), 50)
        self.assertIsNone(lifecycle.ev_first(W, "oom", 0))

    def test_wait_for_times_out_with_a_message(self):
        t = make_tpl(self.tmp, "t", "x\n")
        self.init(t)
        with self.assertRaises(TimeoutError) as cm:
            lifecycle.wait_for(lambda: False, 0.05, 0.01)
        self.assertIn("0.05", str(cm.exception))

    def test_docker_log_marks_ignores_older_lines(self):
        t = make_tpl(self.tmp, "t", "x\n")
        self.init(t)
        out = ("2026-01-01T00:00:01.000000000Z Starting minecraft server version 1.21.11\n"
               "2026-01-01T00:00:02.000000000Z Done (1.234s)! For help, type \"help\"\n"
               "2026-01-01T00:00:09.000000000Z Starting minecraft server version 1.21.11\n"
               "2026-01-01T00:00:10.500000000Z Done (1.5s)! For help\n")
        after = lifecycle.iso_ns("2026-01-01T00:00:05.000000000Z")
        with mock.patch.object(lifecycle, "sh", lambda *a, check=True: out):
            m = lifecycle.docker_log_marks("n", after, 0)
        self.assertEqual(m["paper_starting"], lifecycle.iso_ns("2026-01-01T00:00:09.000000000Z"))
        self.assertEqual(m["paper_done"], lifecycle.iso_ns("2026-01-01T00:00:10.500000000Z"))


if __name__ == "__main__":
    unittest.main()
