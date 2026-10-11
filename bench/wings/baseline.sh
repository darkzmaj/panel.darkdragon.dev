#!/usr/bin/env bash
# Baseline matrix: direct Docker vs the Wings daemon currently running as wdev-wings-1, same server files, same limits.
#   OUTROOT=/bench/wings-opt/out/baseline TAG=stock N=20 ./baseline.sh
# TAG labels the Wings side (stock | gobia-<change>); direct is re-measured in the same session for a fair comparison.
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUTROOT:?}; TAG=${TAG:?}; N=${N:-20}; U=${UUID:-$(cat /bench/wings-opt/wdev-uuid)}
for sc in ${SCENARIOS:-start restart}; do
  for caches in ${CACHES:-warm cold}; do
    extra=(); [ $caches = cold ] && extra=(--drop-caches)
    [ "${SKIP_DIRECT:-0}" = 1 ] || python3 "$h/lifecycle.py" --mode direct --label direct-$sc-$caches --scenario $sc --n $N "${extra[@]}" --out "$O"
    python3 "$h/lifecycle.py" --mode wings --uuid "$U" --label $TAG-$sc-$caches --scenario $sc --n $N "${extra[@]}" --out "$O"
  done
done
