import collections, os, shlex, subprocess, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
from tests.test_equiv import tpl, BASE


def run(env, **extra):
    e = {**os.environ, "OUT": "/tmp/ab3-test-out", "DRY_RUN": "1", **env}
    return subprocess.run(["bash", str(HERE / "ab3.sh")], capture_output=True, text=True, env=e, **extra)


def parse(out):
    rows = []
    for l in out.splitlines():
        if l.startswith("lifecycle.py "):
            toks = shlex.split(l)[1:]
            rows.append({toks[i][2:]: toks[i + 1] for i in range(0, len(toks), 2)})
    return rows


class Matrix(unittest.TestCase):
    def test_variants_of_one_server_differ_only_in_template_and_label(self):
        r = run({"ROUNDS": "3", "PER": "4", "VARS": "default bypass aot"})
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = parse(r.stdout)
        self.assertEqual(len(rows), 3 * 2 * 3 * 2 * 3)        # rounds x scenarios x envs x servers x variants
        groups = collections.defaultdict(list)
        for x in rows:
            srv, var, env, sc = x["label"].split("-")
            groups[(srv, env, sc)].append((var, x))
        for key, items in groups.items():
            for field in ("mode", "uuid", "port", "image", "startup", "n", "settle", "scenario", "out"):
                self.assertEqual(len({x[field] for _, x in items}), 1, (key, field))
            self.assertEqual(len({x["template"] for _, x in items}), 3, key)   # three distinct templates
        for x in rows:                                           # direct vs wings differ only in `mode`, nothing else
            self.assertEqual(x["mode"], "direct" if "-direct-" in x["label"] else "wings")

    def test_each_variant_is_first_equally_often(self):
        rows = parse(run({"ROUNDS": "3", "PER": "1", "VARS": "default bypass aot", "SCENARIOS": "start", "SERVERS": "canvas"}).stdout)
        firsts = collections.Counter()
        for i in range(0, len(rows), 3):
            firsts[rows[i]["label"].split("-")[1]] += 1
        self.assertEqual(set(firsts.values()), {3})                # 9 groups, 3 variants: each leads 3 times

    def test_default_variants_and_warmup(self):
        rows = parse(run({"ROUNDS": "2", "PER": "5", "SCENARIOS": "restart", "SERVERS": "canvas"}).stdout)
        self.assertEqual({x["label"].split("-")[1] for x in rows}, {"default", "aot"})
        by_round = [rows[:6], rows[6:]]
        self.assertEqual({x["warmup"] for x in by_round[0]}, {"1"})
        self.assertEqual({x["warmup"] for x in by_round[1]}, {"0"})
        rows = parse(run({"ROUNDS": "2", "SCENARIOS": "restart", "SERVERS": "canvas", "WARMUP_ALL": "1"}).stdout)
        self.assertEqual({x["warmup"] for x in rows}, {"1"})

    def test_labels_unique_per_round(self):
        rows = parse(run({"ROUNDS": "1", "VARS": "default bypass aot"}).stdout)
        labels = [x["label"] for x in rows]
        self.assertEqual(len(labels), len(set(labels)))

    def test_non_equivalent_templates_abort_before_any_timing(self):
        t = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(t, ignore_errors=True))
        tpl(t, "canvas-j25-pc", f"{BASE} -jar server.jar")
        tpl(t, "canvas-j25-aot", f"{BASE} -jar server.jar", world="CONTAMINATED")
        r = run({"TEMPLATES": t, "SERVERS": "canvas", "ROUNDS": "1"})
        self.assertEqual(r.returncode, 3)
        self.assertEqual(parse(r.stdout), [])
        self.assertIn("not equivalent", r.stderr)

    def test_equivalent_templates_pass_gate(self):
        t = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(t, ignore_errors=True))
        tpl(t, "canvas-j25-pc", f"{BASE} -jar server.jar")
        tpl(t, "canvas-j25-aot", f"{BASE} -XX:AOTCache=/x -jar server.jar")
        r = run({"TEMPLATES": t, "SERVERS": "canvas", "ROUNDS": "1", "SCENARIOS": "start"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(parse(r.stdout)), 3 * 2)


if __name__ == "__main__":
    unittest.main()
