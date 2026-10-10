#!/usr/bin/env bash
# Long-running reliability run: repeat restart series, warm-pool waves with chaos kills and start storms for DURATION_MIN minutes,
# checking acceptance and leaks after every loop. Stops at the first failure and keeps all raw data.
#   TEMPLATE=.../canvas-j25-aot OUT=/bench/wings-opt/out2/soak DURATION_MIN=240 ./soak.sh
# Wings-side restarts need the Panel/Wings stack from ab3.sh (set WINGS=1 UUID=... PORT=...); without it only pool+storm loops run.
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUT:?set OUT}; TPL=${TEMPLATE:?set TEMPLATE}; WORK=${WORK:-/bench/wings-opt/p2/soak-work}
MIN=${DURATION_MIN:-120}; end=$(( $(date +%s) + MIN * 60 )); loop=0
export GATE_BIN=${GATE_BIN:-/bench/wings-opt/p2/gate/gate}
mkdir -p "$O"; python3 "$h/leakcheck.py" snapshot --out "$O/leak-0.json" --work "$WORK"
while [ "$(date +%s)" -lt "$end" ]; do
  loop=$((loop + 1)); d="$O/loop-$loop"; echo "== loop $loop ($(date -u +%FT%TZ))"
  python3 "$h/pool.py" bench --template "$TPL" --size 4 --max-size 12 --concurrent 2 --matches 30 --reset overlay \
    --chaos-every 10 --work "$WORK" --out "$d/pool" >/dev/null
  python3 "$h/check_results.py" pool "$d/pool/pool.json" --min-ok 0.9
  python3 "$h/conc.py" --template "$TPL" --n "${STORM_N:-4}" --repeat 1 --work "$WORK/conc" --out "$d/conc" >/dev/null
  python3 "$h/check_results.py" conc "$d/conc/conc-${STORM_N:-4}.json"
  if [ "${WINGS:-0}" = 1 ]; then
    python3 "$h/lifecycle.py" --mode wings --uuid "${UUID:?}" --port "${PORT:-25566}" --label "soak-aot-gobia-restart" --scenario restart \
      --n 20 --warmup 0 --settle 1 --template "$TPL" --image "${IMAGE:-ghcr.io/pterodactyl/yolks:java_25}" --out "$d/lifecycle" >/dev/null
    python3 "$h/check_results.py" runs "$d/lifecycle" --min-n 20
  fi
  python3 "$h/leakcheck.py" snapshot --out "$d/leak.json" --work "$WORK"
  python3 "$h/leakcheck.py" diff "$O/leak-0.json" "$d/leak.json"
done
echo "soak OK: $loop loops in $MIN min -> $O"
