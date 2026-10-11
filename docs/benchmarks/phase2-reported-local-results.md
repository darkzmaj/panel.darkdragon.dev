# Phase 2 results as reported from the local WSL2 environment (NOT verified here)

These two figures were reported by the project owner from earlier local runs. **No raw data for them is in this repository** and
nothing in the cloud session re-measured, re-derived or validated them. Treat them as claims until the raw files are archived below.

| Server | Minecraft / Java | Startup | Reported median to protocol readiness |
|---|---|---|---|
| CanvasMC | 1.21.11 / Java 25 | AOT class cache (`-XX:AOTCache`) | ~2.83 s |
| DivineMC | 1.21.11 / Java 25 | AOT class cache | ~3.06 s |

What is not known from the repository: the exact definition used for "ready" (this tooling's definition is the first valid Server List
Ping answered on the published port by a process started after T0), the environment (direct Docker vs stock Wings vs Gobia Wings),
n, warm/cold cache state, and whether the templates were built with the pre-fix `mkvariant.py` (training boot ran inside the measured
template; no strict AOT mode, so a silently rejected cache could not have been detected).

## To make them citable (do this on WSL2, change nothing in the data)
```bash
cd ~/panel.gobia.cloud
mkdir -p docs/benchmarks/data/phase2-local-frozen
cp -a /bench/wings-opt/out2/. docs/benchmarks/data/phase2-local-frozen/          # raw runs.jsonl / timeline.jsonl / env.json, unmodified
( cd docs/benchmarks/data/phase2-local-frozen && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > docs/benchmarks/data/phase2-local-frozen.sha256
python3 bench/wings/summarize.py docs/benchmarks/data/phase2-local-frozen          # reproduces the medians from the raw rows
python3 bench/wings/check_results.py runs docs/benchmarks/data/phase2-local-frozen  # will flag rows lacking files_fp: expected for old data
```
`check_results.py` is expected to report "rows without files_fp" for data collected before this branch; that is a statement about the
old collection method, not a failure of the data. The frozen baseline directories under `docs/benchmarks/data/` were not touched.
