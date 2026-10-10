#!/usr/bin/env bash
# Warm-pool integration matrix (WSL2 / Linux, root, Docker, Minekube Gate at $GATE_BIN). Each case is followed by an
# acceptance check (check_results.py pool) and a leak check; the first violation stops the run.
#   TEMPLATE=/bench/wings-opt/p2/templates/canvas-j25-aot OUT=/bench/wings-opt/out2/pool ./run_pool_matrix.sh
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUT:?set OUT}; TPL=${TEMPLATE:?set TEMPLATE}; WORK=${WORK:-/bench/wings-opt/p2/pool-work}
export GATE_BIN=${GATE_BIN:-/bench/wings-opt/p2/gate/gate}
[ "$(id -u)" = 0 ] || { echo "run as root (overlay mounts, chown)" >&2; exit 2; }
[ -x "$GATE_BIN" ] || { echo "Minekube Gate binary not found at $GATE_BIN (set GATE_BIN)" >&2; exit 2; }
mkdir -p "$O"
# name size concurrent matches reset extra
cases=(
  "s3-c1-copy     3 1 20 copy    "
  "s3-c1-overlay  3 1 20 overlay "
  "s6-c3-overlay  6 3 30 overlay "
  "s6-c6-overlay  6 6 30 overlay "
  "s4-c2-chaos    4 2 40 overlay --chaos-every 7"
  "s3-c1-prime    3 1 20 overlay --prime --prime-n 2"
)
python3 "$h/leakcheck.py" snapshot --out "$O/leak-start.json" --work "$WORK"
for c in "${cases[@]}"; do
  read -r name size conc matches reset extra <<<"$c"
  echo "== $name"
  # shellcheck disable=SC2086
  python3 "$h/pool.py" bench --template "$TPL" --size "$size" --max-size $((size * 3)) --concurrent "$conc" --matches "$matches" \
    --reset "$reset" --work "$WORK" --out "$O/$name" ${extra:-} >/dev/null
  min_ok=1.0; [[ $name == *chaos* ]] && min_ok=0.9         # chaos kills idle servers: a replacement may not be ready in time
  python3 "$h/check_results.py" pool "$O/$name/pool.json" --min-ok "$min_ok"
  python3 "$h/leakcheck.py" snapshot --out "$O/leak-$name.json" --work "$WORK"
  python3 "$h/leakcheck.py" diff "$O/leak-start.json" "$O/leak-$name.json"
done
echo "pool matrix OK -> $O"
