import unittest

import check_results as cr


def rows(label, fp, n=3, ready=3000.0):
    return [{"label": label, "run": i, "measured": True, "ready_ms": ready, "files_fp": fp} for i in range(n)]


class Runs(unittest.TestCase):
    def good(self):
        r = []
        for env in ("direct", "stock", "gobia"):
            r += rows(f"canvas-default-{env}-restart", {"jvm.args": "aaa"})
            r += rows(f"canvas-aot-{env}-restart", {"jvm.args": "bbb", "app.aot": 5})
        return r

    def test_good_data_passes(self):
        self.assertEqual(cr.check_runs(self.good(), 3), [])

    def test_shared_files_between_variants_are_caught(self):
        r = [x for x in self.good() if "aot-gobia" not in x["label"]]
        r += rows("canvas-aot-gobia-restart", {"jvm.args": "aaa"})          # the aot run actually used default's files
        bad = cr.check_runs(r, 3)
        self.assertTrue(any("different files under different envs" in b for b in bad), bad)

    def test_identical_variants_are_caught(self):
        r = rows("canvas-default-direct-start", {"jvm.args": "x"}) + rows("canvas-aot-direct-start", {"jvm.args": "x"})
        self.assertTrue(any("identical files" in b for b in cr.check_runs(r, 3)))

    def test_files_changing_mid_series_are_caught(self):
        r = rows("canvas-default-direct-start", {"jvm.args": "x"}, 2) + rows("canvas-default-direct-start", {"jvm.args": "y"}, 2)
        self.assertTrue(any("changed during the series" in b for b in cr.check_runs(r, 3)))

    def test_old_rows_without_fingerprint_are_flagged(self):
        r = [{"label": "canvas-default-direct-start", "run": i, "measured": True, "ready_ms": 1.0} for i in range(3)]
        self.assertTrue(any("files_fp" in b for b in cr.check_runs(r, 3)))

    def test_missing_ready_and_small_n(self):
        r = rows("canvas-default-direct-start", {"jvm.args": "x"}, 2, ready=None)
        bad = cr.check_runs(r, 5)
        self.assertTrue(any("only 2" in b for b in bad) and any("ready_ms" in b for b in bad))

    def test_servers_are_not_compared_with_each_other(self):
        r = rows("canvas-default-direct-start", {"jvm.args": "x"}) + rows("divine-default-direct-start", {"jvm.args": "y"})
        self.assertEqual(cr.check_runs(r, 3), [])


class Pool(unittest.TestCase):
    def base(self):
        ms = [{"match": i, "instance": i, "request_to_play_ms": 500.0} for i in range(4)]
        return {"config": {"matches": 4}, "matches": ms, "instances_used": [0, 1, 2, 3], "pool_events": []}

    def test_ok(self):
        self.assertEqual(cr.check_pool(self.base()), [])

    def test_duplicate_instance_is_flagged(self):
        d = self.base()
        d["instances_used"] = [0, 1, 1, 3]
        self.assertTrue(any("more than one match" in b for b in cr.check_pool(d)))

    def test_failures_and_breaker(self):
        d = self.base()
        d["matches"][0] = {"match": 0, "error": "pool exhausted"}
        d["pool_events"] = [["broken", 1, "x"]]
        bad = cr.check_pool(d)
        self.assertEqual(len(bad), 2)
        self.assertEqual(len(cr.check_pool(d, min_ok=0.5)), 1)


class Conc(unittest.TestCase):
    def test_failed_servers_flagged(self):
        self.assertEqual(cr.check_conc({"rounds": [{"failed": 0, "rows": [1]}]}), [])
        self.assertEqual(len(cr.check_conc({"rounds": [{"failed": 2, "rows": [1, 2, 3]}]})), 1)


if __name__ == "__main__":
    unittest.main()
