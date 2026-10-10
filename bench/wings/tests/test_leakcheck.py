import unittest

import leakcheck as lc

BASE = {"containers": ["pool-1 running"], "overlay_mounts": ["/w/a/mnt"], "work_entries": ["/w/a"], "mem_available_mb": 10000, "disk_free_mb": 50000}


class Diff(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(lc.diff(BASE, dict(BASE)), [])

    def test_leaks_detected(self):
        after = {**BASE, "containers": ["pool-1 running", "pool-7 exited"], "overlay_mounts": ["/w/a/mnt", "/w/b/mnt"],
                 "work_entries": ["/w/a", "/w/b"], "mem_available_mb": 9000, "disk_free_mb": 40000}
        bad = lc.diff(BASE, after)
        self.assertEqual(len(bad), 5, bad)
        self.assertEqual(len(lc.diff(BASE, after, allow_containers=1, max_mem_drop_mb=2000, max_disk_drop_mb=20000)), 2)

    def test_removed_things_are_not_leaks(self):
        self.assertEqual(lc.diff(BASE, {**BASE, "containers": [], "work_entries": []}), [])

    def test_unknown_disk_is_ignored(self):
        self.assertEqual(lc.diff({**BASE, "disk_free_mb": None}, {**BASE, "disk_free_mb": None}), [])


if __name__ == "__main__":
    unittest.main()
