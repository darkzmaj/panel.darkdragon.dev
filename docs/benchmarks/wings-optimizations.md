# Wings optimizations

Fork: `C:\Users\majko\Documents\PROJECTS\gobia-wings` (branch `gobia/perf`, based on upstream `develop`
`cba8315bceda926241d6f86e78b3bd52cf15e41f`; exact changes, flags and rollback in its `GOBIA.md`). Nothing was pushed
anywhere. Each change was benchmarked on its own against the same baseline; all numbers are medians of **interleaved**
runs ([`data/final`](data/final): 20 cycles per case; [`data/control`](data/control): 15, adds an unmodified-develop
control). Raw per-cycle data in the `runs.jsonl` files.

## Implemented and kept

| # | Change | Flag | Start saving | Restart saving | Evidence |
|---|---|---|---|---|---|
| 1 | Skip the per-start registry `ImagePull` when the image is already local (`periodic` policy re-pulls hourly) | `docker.image_pull_policy: periodic` | **−1149 ms (−16.8%)** vs stock; −1032 ms (−15.1%) vs unmodified develop | −1022 ms (−13.7%) vs stock; −1044 ms vs develop | create event at 283 ms instead of 1340 ms |
| 2 | Start the existing container when a hash of its create-time config + image ID still matches (instead of remove + create) | `docker.reuse_containers: true` (needs #1) | a further **−175 ms (−3.1%)** (−255 ms in the control run) | a further −74 ms (−1.1%) (−140 ms in the control) | container start event at 177 ms instead of 400 ms |
| 3 | Directory listing no longer fails when an entry disappears mid-listing | always on | – | – | HTTP 500 rate 7.8% → 0% (below) |

Combined (#1+#2), interleaved, medians: **start 6825 → 5501 ms (−1324 ms, −19.4%)**, p95 7023 → 5588;
**graceful restart 7481 → 6385 ms (−1096 ms, −14.7%)**, p95 7547 → 6543. Against unmodified develop (control run):
start 6833 → 5547 (−18.8%), restart 7560 → 6376 (−15.7%). Relative to direct Docker (created through the CLI, same
flags) the optimized daemon starts 440 ms (−7.4%) faster and restarts on par (6385 vs 6411 ms).
Charts: [start-warm](charts/start-warm.svg), [restart-warm](charts/restart-warm.svg).

**Why #2 is small:** after #1 only container remove + create (~175 ms together, which is what #2 saves) are left, and a restart already
spends ~0.9 s waiting for Paper to save and exit. It stays behind its flag because it is the riskier of the two (see
GOBIA.md): the saving is real but modest.

### #3 — the reported concurrent file-operation race belongs to Wings, not the Panel

`ListDirectory` stats every entry after reading the directory; an entry deleted or renamed in between returned
`lstatat <name>: file does not exist` and failed the whole listing (HTTP 500). Reproduced **without the Panel**, directly
against the Wings API (`bench/wings/race.py`, 8 writers doing create/rename/delete + 4 listers, 15 s, same directory):

| Wings | listings | HTTP 500 |
|---|---|---|
| stock v1.13.3 | 45,659 | **3,580 (7.8%)** |
| patched | 46,740 | **0** |

A unit test (`internal/ufs/walk_unix_test.go`) fails on the upstream code with exactly that message and passes with the
fix. The Panel's extra `list-directory` call before `files/write` is a separate Panel-side inefficiency that exposes the
race more often; it is not the fault. Writes themselves never failed (all 204).

## Measured and rejected (no change made)

| Idea | Result |
|---|---|
| JVM startup flags, direct Docker, n=8 each | default 6122 ms; `-XX:+UseSerialGC` 6616; `-XX:TieredStopAtLevel=1` 6483; serial+C1+`-UsePerfData` 7237; `-XX:+UseParallelGC` 6047 (noise: repeating the default gave 6216 and 6367). **None helps**, several hurt. |
| Larger/pre-sized heap (`-Xms1G`, `-Xms1G -Xmn600M`) | 6639 / 6545 vs 6216–6367 default: slower |
| Launching the server jar without Paperclip (`-cp libraries/* …Main`) | does not start (classpath conflict, `NoSuchMethodError`); Paperclip builds a specific classpath. Paper's own bootstrap (before its "Starting" line) is ~4.2 s of the run anyway. |
| Skip recursive chown / disk scan on boot | **Not implemented, not shown to matter at this size**: the whole preflight (Panel sync + disk check + config + chown over 511 files) is ~40 ms. It may matter for worlds with hundreds of thousands of files; that was not measured, and a wrong skip would risk cross-tenant ownership, so it needs its own design and a large-world benchmark first. |
| Docker API overhead | Wings talks to the Docker API directly: remove + create ≈ 175 ms in total, versus ≈ 440 ms for a `docker create` through the CLI. Nothing left to gain beyond #2. |
| Concurrency/locks | Power lock is per server; independent servers are not serialised in the code read. Concurrent starts were **not** benchmarked. |

## Observed but not fixed

- With reuse on, the **stop** after a reused start measured ~100–190 ms slower in the *start* scenario (`stop_die` 949 ms vs
  841 ms for #1) but not in the *restart* scenario (866 vs 845 ms). Cause unknown; it does not offset the 175 ms start gain,
  but the net lifecycle saving is smaller than the start numbers suggest. Open item.
- Unmodified develop starts 213 ms slower than v1.13.3 (6833 vs 6620 ms, control run) — an upstream difference, not from
  these patches (the unmodified-develop image is built from the same commit as the fork base).

## Why under five seconds was not reached

Best measured cold start: **5.50 s median, 5.44 s fastest** (existing small world, no plugins, Paper 1.21.11). Floor
breakdown with the optimized Wings: container started at 0.18 s, then Paper's bootstrap to its "Starting" line 4.2 s and
world/spawn preparation to "Done" 1.1 s. No Wings change reduces those, and the JVM flags tried did not either. Sub-second
*player availability* is a different thing and is only reached with an already-running ready instance (next document).
