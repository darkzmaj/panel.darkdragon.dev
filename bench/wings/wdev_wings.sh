#!/usr/bin/env bash
# (Re)start the wdev Wings daemon from an image with optional config.yml docker.* overrides. Touches ONLY project wdev.
#   wdev_wings.sh <image> [key=value ...]       e.g. wdev_wings.sh wings-dev:p1 image_pull_policy=periodic reuse_containers=true
#   wdev_wings.sh stock                          the pinned upstream v1.13.3 digest, no overrides
set -euo pipefail
IMG=${1:?image}; shift || true
[ "$IMG" = stock ] && IMG=ghcr.io/pterodactyl/wings@sha256:97937976fdb0ea0ac78797d8c86311ef80937f23f186a75a6903aff4540487d1
C=/srv/wings/wdev/etc/config.yml
for k in image_pull_policy image_refresh_minutes reuse_containers; do sed -i "/^  $k: /d" "$C"; done
for kv in "$@"; do sed -i "s/^docker:\$/docker:\n  ${kv%%=*}: ${kv#*=}/" "$C"; done
source /bench/gobia/scripts/gobia/bench/lib.sh wdev
# Wings restarts servers that its states.json lists as running; the benchmark wants every daemon swap to boot idle.
dc --profile wings stop -t 30 wings >/dev/null 2>&1 || true
echo '{}' > /srv/wings/wdev/lib/states.json
WINGS_IMAGE=$IMG dc --profile wings up -d --force-recreate wings >/dev/null
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:19090/ && break; sleep 0.5; done
docker inspect -f '{{.Config.Image}}' wdev-wings-1
grep -A4 '^docker:' "$C" | head -5
