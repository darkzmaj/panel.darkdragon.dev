#!/usr/bin/env bash
# Phase 2 matrix: CanvasMC and DivineMC (Minecraft 1.21.11, Java 25), default Paperclip startup vs AOT-cache startup,
# under direct Docker, stock Wings v1.13.3 and the Gobia Wings fork, start and restart, interleaved in rounds.
#   OUT=/bench/wings-opt/out2/main ROUNDS=4 PER=5 ./ab3.sh
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUT:?}; R=${ROUNDS:-4}; P=${PER:-5}
T=/bench/wings-opt/p2/templates; J25=ghcr.io/pterodactyl/yolks:java_25
PULL="image_pull_policy=periodic image_refresh_minutes=60"
declare -A UUID=([canvas]=$(cat /bench/wings-opt/p2/uuid-canvas) [divine]=$(cat /bench/wings-opt/p2/uuid-divine))
declare -A PORT=([canvas]=25566 [divine]=25567)
declare -A TPL=([canvas-default]=canvas-j25-pc [canvas-aot]=canvas-j25-aot [divine-default]=dv-pc [divine-aot]=dv-aot)
# keep the Panel/DB/cache of the wdev project up (and log who stops containers, in case something else does)
source /bench/gobia/scripts/gobia/bench/lib.sh wdev
docker events --filter type=container --filter event=stop --filter event=kill --format '{{.Time}} {{.Actor.Attributes.name}} {{.Action}}' > "$O.events.log" 2>&1 &
ensure_panel() {
  [ "$(docker inspect -f '{{.State.Health.Status}}' wdev-panel-1 2>/dev/null)" = healthy ] && return
  echo "panel was down: restarting" >&2
  dc up -d database cache panel >/dev/null 2>&1
  for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' wdev-panel-1 2>/dev/null)" = healthy ] && break; sleep 2; done
}
daemon() {
  ensure_panel; case $1 in direct) ;; stock) bash "$h/wdev_wings.sh" stock >/dev/null;; gobia) bash "$h/wdev_wings.sh" wings-dev:p2 $PULL reuse_containers=true >/dev/null;; esac; }
for r in $(seq 1 "$R"); do
  warm=0; [ "$r" = 1 ] && warm=1
  for sc in ${SCENARIOS:-start restart}; do
    envs=(direct stock gobia); k=$(( (r-1) % 3 )); envs=("${envs[@]:k}" "${envs[@]:0:k}")   # rotate the order each round
    for env in "${envs[@]}"; do
      daemon "$env"
      for srv in canvas divine; do
        for var in default aot; do
          label="$srv-$var-$env-$sc"
          mode=wings; [ "$env" = direct ] && mode=direct
          python3 "$h/lifecycle.py" --mode "$mode" --uuid "${UUID[$srv]}" --port "${PORT[$srv]}" --label "$label" --scenario "$sc" \
            --n "$P" --warmup "$warm" --settle 1 --template "$T/${TPL[$srv-$var]}" --image $J25 \
            --startup "java @/home/container/jvm.args" --out "$O" >/dev/null
        done
      done
    done
  done
done
