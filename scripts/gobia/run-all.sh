#!/usr/bin/env bash
# Runs every browser check of the Gobia suite for one colour scheme, one group at a time (the instance websocket
# credentials are limited to five requests a minute per instance, so the groups that open sockets get a pause).
#   GOBIA_VISUAL_USER=... GOBIA_VISUAL_PASSWORD=... GOBIA_SCHEME=light bash scripts/gobia/run-all.sh
set -u
cd "$(dirname "$0")/../.."
fail=0
for part in visual responsive smoke a11y; do
    echo "== $part"
    node scripts/gobia/visual.mjs "$part" 2>&1 | grep -E "^FAIL|passed|failure" || fail=1
done
for group in dashboard files explorer keyboard access admin bundle mobile status dual; do
    echo "== flows $group"
    case "$group" in status | dual) sleep 70 ;; esac
    GOBIA_FLOWS=$group node scripts/gobia/visual.mjs flows 2>&1 | grep -E "^FAIL|passed|failure" || fail=1
done
echo "== finished"
exit $fail
