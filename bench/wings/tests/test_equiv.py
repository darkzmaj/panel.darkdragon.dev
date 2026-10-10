import tempfile, unittest
from pathlib import Path

import verify_equiv as ve

BASE = "-Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false"


def tpl(root, name, args, world="w1", extra=None):
    d = Path(root) / name
    (d / "world").mkdir(parents=True)
    (d / "server.jar").write_bytes(b"jar")
    (d / "world" / "level.dat").write_text(world)
    (d / "jvm.args").write_text("\n".join(args.split()) + "\n")
    for k, v in (extra or {}).items():
        (d / k).write_text(v)
    return str(d)


class Equiv(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.t, ignore_errors=True))

    def test_equivalent_variants(self):
        a = tpl(self.t, "pc", f"{BASE} -jar server.jar nogui")
        b = tpl(self.t, "bypass", f"{BASE} --enable-native-access=ALL-UNNAMED -cp x Main nogui")
        c = tpl(self.t, "aot", f"{BASE} -XX:AOTCache=/home/container/app.aot --enable-native-access=ALL-UNNAMED -cp x Main nogui",
                extra={"app.aot": "cache"})
        self.assertEqual(ve.compare([a, b, c]), [])

    def test_world_difference_is_caught(self):
        a = tpl(self.t, "a", f"{BASE} -jar server.jar")
        b = tpl(self.t, "b", f"{BASE} -jar server.jar", world="mutated by training boot")
        self.assertTrue(any("level.dat" in d for d in ve.compare([a, b])))

    def test_extra_and_missing_files(self):
        a = tpl(self.t, "a", f"{BASE} -jar server.jar", extra={"plugins.txt": "x"})
        b = tpl(self.t, "b", f"{BASE} -jar server.jar")
        d = ve.compare([a, b])
        self.assertTrue(any("missing plugins.txt" in x for x in d))
        self.assertTrue(any("extra file plugins.txt" in x for x in ve.compare([b, a])))

    def test_flag_difference_is_caught(self):
        a = tpl(self.t, "a", f"{BASE} -jar server.jar")
        b = tpl(self.t, "b", "-Xms128M -XX:MaxRAMPercentage=50.0 -Dterminal.jline=false -jar server.jar")
        self.assertTrue(any("JVM flags differ" in x for x in ve.compare([a, b])))

    def test_cds_flags_are_variant_flags(self):
        a = tpl(self.t, "a", f"{BASE} -jar server.jar")
        b = tpl(self.t, "b", f"{BASE} -XX:SharedArchiveFile=/x.jsa -Xshare:auto -jar server.jar")
        self.assertEqual(ve.compare([a, b]), [])

    def test_main_exit_codes(self):
        a = tpl(self.t, "a", f"{BASE} -jar server.jar")
        b = tpl(self.t, "b", f"{BASE} -jar server.jar", world="x")
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(ve.main([a, a]), 0)
            self.assertEqual(ve.main([a, b]), 1)


if __name__ == "__main__":
    unittest.main()
