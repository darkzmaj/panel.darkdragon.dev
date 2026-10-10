import threading, time, unittest

from tests.helpers import FakeBackend, FakeGate, FakeGateAPI, make_pool, pool


def wait_for(fn, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if fn():
            return True
        time.sleep(0.005)
    return False


class Alloc(unittest.TestCase):
    def tearDown(self):
        self.p.stop()

    def test_no_instance_is_assigned_to_two_matches(self):
        be = FakeBackend(boot_s=0.01, check_s=0.02)  # slow health check widens the window a racy design would lose
        self.p = make_pool(be, size=8, max_size=40)
        self.p.fill()
        self.assertTrue(self.p.wait_ready(8, 10))
        n = 60
        barrier = threading.Barrier(n)
        got, lock = [], threading.Lock()

        def worker(m):
            barrier.wait()
            inst = self.p.reserve(m, wait=0.0)
            with lock:
                got.append((m, inst))
        ts = [threading.Thread(target=worker, args=(m,)) for m in range(n)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        won = [(m, i) for m, i in got if i is not None]
        ids = [i.id for _, i in won]
        self.assertEqual(len(ids), len(set(ids)), "an instance was handed to two matches")
        for m, i in won:
            self.assertEqual(i.match, m)
            self.assertEqual(i.state, "reserved")
        self.assertGreaterEqual(len(won), 8)   # every initially ready instance was usable
        self.assertEqual(be.port_clash, [])    # two live instances never shared a port

    def test_repeated_rounds_never_duplicate(self):
        be = FakeBackend(boot_s=0.002)
        self.p = make_pool(be, size=4, max_size=12)
        self.p.fill()
        seen = set()
        for rnd in range(25):
            self.assertTrue(self.p.wait_ready(4, 10))
            with ThreadPool(6) as ex:
                res = list(ex.map(lambda m: self.p.reserve(rnd * 100 + m, wait=0.0), range(6)))
            ids = [r.id for r in res if r]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertFalse(seen & set(ids), "instance reused across matches")
            seen |= set(ids)
            for r in res:
                if r:
                    self.p.end_match(r)

    def test_exhausted_pool_returns_none_then_recovers(self):
        be = FakeBackend(boot_s=0.3)
        self.p = make_pool(be, size=1, max_size=1)
        self.p.fill()
        self.assertIsNone(self.p.reserve(1, wait=0.0))            # still booting: exhausted, not an exception
        inst = self.p.reserve(2, wait=5.0)                         # waiting allocation succeeds once the boot finishes
        self.assertIsNotNone(inst)
        self.assertIsNone(self.p.reserve(3, wait=0.05))            # all capacity (max_size=1) is in use: bounded wait, then None
        self.p.end_match(inst).join(5)
        self.assertIsNotNone(self.p.reserve(4, wait=5.0))          # capacity returns after the match ends

    def test_unhealthy_instance_is_skipped_and_replaced(self):
        be = FakeBackend()
        self.p = make_pool(be, size=2, max_size=6)
        self.p.fill()
        self.assertTrue(self.p.wait_ready(2, 5))
        be.unhealthy.add("pool-0")
        inst = self.p.reserve(1, wait=1.0)
        self.assertNotEqual(inst.name, "pool-0")
        self.assertTrue(wait_for(lambda: "pool-0" not in be.alive))
        self.assertTrue(any(e[0] == "unhealthy" for e in self.p.events))

    def test_all_unhealthy_returns_none(self):
        be = FakeBackend()
        self.p = make_pool(be, size=2, max_size=2)
        self.p.fill()
        self.assertTrue(self.p.wait_ready(2, 5))
        be.unhealthy_all = True
        self.assertIsNone(self.p.reserve(1, wait=0.0))


class Chaos(unittest.TestCase):
    def test_killed_idle_servers_are_never_handed_out_and_pool_recovers(self):
        be = FakeBackend(boot_s=0.005)
        p = make_pool(be, size=4, max_size=12)
        self.addCleanup(p.stop)
        p.fill()
        self.assertTrue(p.wait_ready(4, 5))
        p.start_chaos(0.01)
        handed = []
        for m in range(60):
            inst = p.reserve(m, wait=2.0)
            if inst is not None:
                self.assertNotIn(inst.name, be.unhealthy, "a killed server was assigned to a match")
                handed.append(inst.id)
                p.end_match(inst)
            time.sleep(0.005)
        self.assertEqual(len(handed), len(set(handed)))
        self.assertGreater(sum(1 for e in p.events if e[0] == "chaos_kill"), 3)
        self.assertGreater(len(handed), 30)                       # the pool kept serving through the chaos

    def test_sweep_replaces_dead_idle_server_before_any_player_needs_it(self):
        be = FakeBackend()
        p = make_pool(be, size=3, max_size=6)
        self.addCleanup(p.stop)
        p.fill()
        p.wait_ready(3, 5)
        be.kill(p.insts[0])
        self.assertEqual(p.sweep(), 1)
        self.assertTrue(wait_for(lambda: "pool-0" not in be.alive))
        self.assertTrue(p.wait_ready(3, 5))                       # replaced
        self.assertEqual(p.sweep(), 0)

    def test_sweep_does_not_touch_reserved_instances(self):
        be = FakeBackend()
        p = make_pool(be, size=2, max_size=2)
        self.addCleanup(p.stop)
        p.fill()
        p.wait_ready(2, 5)
        a = p.reserve(1)
        be.kill(a)
        p.sweep()
        self.assertEqual(a.state, "reserved")

    def test_chaos_never_targets_reserved_instances(self):
        be = FakeBackend()
        p = make_pool(be, size=2, max_size=2)
        self.addCleanup(p.stop)
        p.fill()
        p.wait_ready(2, 5)
        a = p.reserve(1)
        p.chaos_kill_one()
        self.assertNotIn(a.name, be.unhealthy)


class Boot(unittest.TestCase):
    def tearDown(self):
        self.p.stop()

    def test_failing_boots_back_off_and_stop(self):
        be = FakeBackend()
        be.fail_launch = True
        self.p = make_pool(be, size=2, max_size=4, max_failures=3)
        self.p.fill()
        self.assertTrue(wait_for(lambda: self.p.broken))
        time.sleep(0.2)
        # 2 initial boots, each failure may start one more until the streak hits 3; bounded, not a hot loop
        self.assertLessEqual(be.launches, 6)
        n = be.launches
        time.sleep(0.2)
        self.assertEqual(be.launches, n, "pool kept retrying after the breaker opened")
        self.assertIsNone(self.p.reserve(1, wait=0.1))
        self.assertEqual(be.alive, set())

    def test_recovery_after_reset(self):
        be = FakeBackend()
        be.fail_launch = True
        self.p = make_pool(be, size=2, max_size=4, max_failures=2)
        self.p.fill()
        self.assertTrue(wait_for(lambda: self.p.broken))
        be.fail_launch = False
        self.p.reset()
        self.assertTrue(self.p.wait_ready(2, 5))
        self.assertIsNotNone(self.p.reserve(1))

    def test_transient_failure_recovers_without_reset(self):
        be = FakeBackend()
        be.fail_launch = True
        self.p = make_pool(be, size=1, max_size=3, max_failures=50, backoff=0.02)
        self.p.fill()
        time.sleep(0.1)
        be.fail_launch = False
        self.assertTrue(self.p.wait_ready(1, 5))
        self.assertFalse(self.p.broken)

    def test_max_starts_is_respected(self):
        be = FakeBackend(boot_s=0.05)
        self.p = make_pool(be, size=9, max_size=9, max_starts=2)
        self.p.fill()
        self.assertTrue(self.p.wait_ready(9, 10))
        self.assertLessEqual(be.max_running, 2)

    def test_concurrent_fill_does_not_overshoot(self):
        be = FakeBackend(boot_s=0.05)
        self.p = make_pool(be, size=4, max_size=50, max_starts=50)
        ts = [threading.Thread(target=self.p.fill) for _ in range(32)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertTrue(self.p.wait_ready(4, 5))
        time.sleep(0.1)
        self.assertEqual(len(self.p.insts), 4)

    def test_port_exhaustion_does_not_crash(self):
        be = FakeBackend()
        self.p = make_pool(be, size=5, max_size=2)
        self.p.fill()
        self.assertTrue(self.p.wait_ready(2, 5))
        self.assertEqual(len(self.p.insts), 2)


class Cancel(unittest.TestCase):
    def test_stop_cancels_boots_in_flight_and_cleans_up(self):
        be = FakeBackend()
        be.hang_boot = True
        p = make_pool(be, size=3, max_size=3)
        p.fill()
        self.assertTrue(wait_for(lambda: be.running == 3 or len(be.alive) == 3))
        t0 = time.monotonic()
        p.stop()
        self.assertLess(time.monotonic() - t0, 5)
        self.assertEqual(be.alive, set())
        self.assertEqual(p.insts, {})
        self.assertTrue(p.gate.stopped)
        n = be.launches
        p.fill()                      # a stopped pool never starts anything again
        time.sleep(0.05)
        self.assertEqual(be.launches, n)

    def test_failure_after_stop_does_not_respawn(self):
        be = FakeBackend()
        p = make_pool(be, size=2, max_size=4)
        p.fill()
        p.wait_ready(2, 5)
        p.stop()
        self.assertEqual(be.alive, set())

    def test_waiting_reserve_is_released_by_stop(self):
        be = FakeBackend()
        be.hang_boot = True
        p = make_pool(be, size=1, max_size=1)
        p.fill()
        out = []
        t = threading.Thread(target=lambda: out.append(p.reserve(1, wait=30)))
        t.start()
        time.sleep(0.1)
        p.stop()
        t.join(5)
        self.assertFalse(t.is_alive())
        self.assertEqual(out, [None])


class Routing(unittest.TestCase):
    def test_route_removed_from_gate_before_port_is_reused(self):
        be, gate = FakeBackend(), FakeGate()
        p = make_pool(be, gate, size=1, max_size=1)
        leaked = []
        be.on_destroy = lambda inst: leaked.append(inst.host) if inst.host in gate.hosts() else None
        p.fill()
        p.wait_ready(1, 5)
        inst = p.reserve(1)
        host = p.route(inst, 1)
        self.assertIn(host, gate.hosts())
        p.end_match(inst).join(5)
        self.assertEqual(leaked, [], "route still pointed at the instance when it was destroyed")
        self.assertNotIn(host, gate.hosts())
        p.stop()

    def test_one_match_failed_join_releases_everything(self):
        be, gate = FakeBackend(), FakeGate()
        p = make_pool(be, gate, size=2, max_size=4)
        p.fill()
        p.wait_ready(2, 5)

        def bad_join(host):
            raise ConnectionResetError("scripted")
        r = pool.one_match(p, 1, join=bad_join)
        self.assertIn("error", r)
        self.assertTrue(wait_for(lambda: gate.hosts() == set()))
        good = pool.one_match(p, 2, join=lambda h: {"login_success": 0.1, "config_done": 0.2, "play_first_packet": 0.3},
                              reserve_wait=5)
        self.assertNotIn("error", good)
        self.assertEqual(r["instance"] != good["instance"], True)
        p.stop()

    def test_one_match_exhausted_is_reported_not_raised(self):
        be = FakeBackend()
        be.hang_boot = True
        p = make_pool(be, size=1, max_size=1)
        p.fill()
        r = pool.one_match(p, 1, join=lambda h: {})
        self.assertEqual(r["error"], "pool exhausted")
        p.stop()


class GateRace(unittest.TestCase):
    def test_concurrent_routes_are_never_lost(self):
        api = FakeGateAPI(delay_s=0.003)
        self.addCleanup(api.close)
        gate = pool.Gate(None, api=api.addr, binary=None)
        be = FakeBackend()
        p = make_pool(be, gate, size=1, max_size=40)
        p.fill()
        p.wait_ready(1, 5)
        n = 30
        insts = [p._take_ready(i) or pool.Inst(900 + i, 30000 + i) for i in range(1)]
        fake = [pool.Inst(1000 + i, 31000 + i) for i in range(n)]
        barrier = threading.Barrier(n)

        def go(i):
            barrier.wait()
            p.route(fake[i], i)
        ts = [threading.Thread(target=go, args=(i,)) for i in range(n)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(api.hosts(), {f"m{i}.pool.test" for i in range(n)})
        # and removals are not lost either
        rem = [threading.Thread(target=lambda i=i: p.end_match(fake[i], f"m{i}.pool.test").join(5)) for i in range(0, n, 2)]
        [t.start() for t in rem]
        [t.join() for t in rem]
        self.assertEqual(api.hosts(), {f"m{i}.pool.test" for i in range(1, n, 2)})
        p.stop()


    def test_delayed_older_update_cannot_overwrite_newer_routes(self):
        """Deterministic: the first route() is delayed on its way to the gate while a second one completes."""
        api = FakeGateAPI()
        self.addCleanup(api.close)
        real = pool.Gate(None, api=api.addr, binary=None)

        class DelayFirst:
            def __init__(self):
                self.n, self.lock = 0, threading.Lock()

            def apply_routes(self, provider):
                with self.lock:
                    self.n += 1
                    first = self.n == 1
                if first:
                    time.sleep(0.4)
                real.apply_routes(provider)

            def stop(self):
                pass
        p = make_pool(FakeBackend(), DelayFirst(), size=1, max_size=4)
        a, b = pool.Inst(1, 31001), pool.Inst(2, 31002)
        ta = threading.Thread(target=p.route, args=(a, 1))
        ta.start()
        time.sleep(0.1)
        p.route(b, 2)
        ta.join()
        self.assertEqual(api.hosts(), {"m1.pool.test", "m2.pool.test"})
        p.stop()

    def test_stale_version_is_retried(self):
        api = FakeGateAPI(stale_first=2)
        self.addCleanup(api.close)
        gate = pool.Gate(None, api=api.addr, binary=None)
        gate.apply_routes(lambda: [{"host": "a.pool.test", "backend": "127.0.0.1:1"}])
        self.assertEqual(api.hosts(), {"a.pool.test"})

    def test_persistent_conflict_raises(self):
        api = FakeGateAPI(stale_first=99)
        self.addCleanup(api.close)
        gate = pool.Gate(None, api=api.addr, binary=None)
        with self.assertRaises(RuntimeError):
            gate.apply_routes(lambda: [])

    def test_unreachable_gate_fails_fast_and_cleanly(self):
        t0 = time.monotonic()
        with self.assertRaises(RuntimeError):
            pool.Gate(None, api="127.0.0.1:9", binary=None, start_timeout=0.5)
        self.assertLess(time.monotonic() - t0, 5)


class Stats(unittest.TestCase):
    def test_stats_nearest_rank(self):
        s = pool.stats(list(range(1, 101)))
        self.assertEqual((s["median"], s["p95"], s["max"], s["n"]), (50.5, 95, 100, 100))
        self.assertIsNone(pool.stats([]))
        self.assertEqual(pool.stats([7])["p95"], 7)


from multiprocessing.pool import ThreadPool  # noqa: E402

if __name__ == "__main__":
    unittest.main()
