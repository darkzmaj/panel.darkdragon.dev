#!/usr/bin/env bash
# Interleaved control run: released v1.13.3 (stock), UNMODIFIED develop@cba8315 (base), and the two Gobia changes on top of
# that same base. Isolates what the patches do from what the newer upstream code does.
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUT:?}; R=${ROUNDS:-3}; P=${PER:-5}; U=$(cat /bench/wings-opt/wdev-uuid)
PULL="image_pull_policy=periodic image_refresh_minutes=60"
run() { python3 "$h/lifecycle.py" --mode wings --uuid "$U" --label "$1-$sc-warm" --scenario "$sc" --n "$P" --out "$O"; }
for r in $(seq 1 "$R"); do
  for sc in start restart; do
    bash "$h/wdev_wings.sh" stock >/dev/null;                                run stock
    bash "$h/wdev_wings.sh" wings-dev:base >/dev/null;                       run base
    bash "$h/wdev_wings.sh" wings-dev:p2 $PULL >/dev/null;                   run p1
    bash "$h/wdev_wings.sh" wings-dev:p2 $PULL reuse_containers=true >/dev/null; run p2
  done
done
