import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "crac"))
import crac_experiment as ce


class Plan(unittest.TestCase):
    def setUp(self):
        self.a = ce.argparse.Namespace(crac_jdk="/opt/zulu-crac", template="/t/aot", out="/o", image="img", runs=3, port=25597, mem_mb=2355)
        self.steps = ce.plan(self.a)

    def docker_runs(self):
        return [s["argv"] for s in self.steps if s["argv"][:2] == ["docker", "run"]]

    def test_only_checkpoint_caps_are_added_and_drop_all_stays(self):
        for argv in self.docker_runs():
            self.assertEqual(argv[argv.index("--cap-drop") + 1], "ALL")
            added = {argv[i + 1] for i, x in enumerate(argv) if x == "--cap-add"}
            self.assertEqual(added, set(ce.CAPS))
            self.assertNotIn("--privileged", argv)
            self.assertIn("no-new-privileges", argv)

    def test_jdk_is_mounted_read_only_and_loopback_only(self):
        for argv in self.docker_runs():
            self.assertIn("/opt/zulu-crac:/opt/crac-jdk:ro", argv)
            self.assertEqual(argv[argv.index("-p") + 1], "127.0.0.1:25597:25565")

    def test_every_restore_gets_its_own_copy_of_the_checkpoint_dir(self):
        mounts = [argv[argv.index("/opt/zulu-crac:/opt/crac-jdk:ro") + 2] for argv in self.docker_runs()]
        roots = [m.split(":")[0] for m in mounts]
        self.assertEqual(len(roots), 4)                       # 1 checkpoint boot + 3 restores
        self.assertEqual(len(set(roots)), 4, "two containers share a directory")
        copies = [s["argv"] for s in self.steps if s["argv"][0] == "cp"]
        self.assertEqual(len(copies), 4)

    def test_checkpoint_and_restore_flags(self):
        runs = self.docker_runs()
        self.assertIn("-XX:CRaCCheckpointTo=/home/container/crac-image", runs[0])
        for r in runs[1:]:
            self.assertIn("-XX:CRaCRestoreFrom=/home/container/crac-image", r)
            self.assertEqual(r[-1], "-XX:CRaCRestoreFrom=/home/container/crac-image")


if __name__ == "__main__":
    unittest.main()
