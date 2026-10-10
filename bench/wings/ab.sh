#!/usr/bin/env bash
# Interleaved A/B/C/D run: direct, stock Wings, +image-pull policy (p1), +container reuse (p2), in rounds, so slow drift of
# the host (thermals, WSL VM state) hits every variant equally. Cross-session comparisons showed ~0.5 s of such drift.
#   OUT=/bench/wings-opt/out/final ROUNDS=4 PER=5 ./ab.sh      -> ROUNDS*PER measured cycles per label and scenario
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUT:?}; R=${ROUNDS:-4}; P=${PER:-5}; U=$(cat /bench/wings-opt/wdev-uuid)
PULL="image_pull_policy=periodic image_refresh_minutes=60"
for r in $(seq 1 "$R"); do
  for sc in start restart; do
    python3 "$h/lifecycle.py" --mode direct --label direct-$sc-warm --scenario $sc --n "$P" --out "$O"
    bash "$h/wdev_wings.sh" stock >/dev/null
    python3 "$h/lifecycle.py" --mode wings --uuid "$U" --label stock-$sc-warm --scenario $sc --n "$P" --out "$O"
    bash "$h/wdev_wings.sh" wings-dev:p2 $PULL >/dev/null
    python3 "$h/lifecycle.py" --mode wings --uuid "$U" --label gobia-p1-$sc-warm --scenario $sc --n "$P" --out "$O"
    bash "$h/wdev_wings.sh" wings-dev:p2 $PULL reuse_containers=true >/dev/null
    python3 "$h/lifecycle.py" --mode wings --uuid "$U" --label gobia-p2-$sc-warm --scenario $sc --n "$P" --out "$O"
  done
done
