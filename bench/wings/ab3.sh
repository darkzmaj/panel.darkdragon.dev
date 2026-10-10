#!/usr/bin/env bash
# Phase 2 matrix: CanvasMC and DivineMC (Minecraft 1.21.11, Java 25), startup variants (default Paperclip / bypass / AOT cache)
# under direct Docker, stock Wings v1.13.3 and the Gobia Wings fork, start and restart, interleaved in rounds.
#   OUT=/bench/wings-opt/out2/main ROUNDS=4 PER=5 ./ab3.sh
#   VARS="default bypass aot"   which variants to run (default: "default aot"; add bypass to separate Paperclip-skipping from AOT)
#   SCENARIOS="start restart"   SERVERS="canvas divine"   WARMUP_ALL=1  warm up every invocation, not only round 1
#   DRY_RUN=1                   print the lifecycle.py commands (and run the equivalence check) without touching Docker
# Equivalence rules enforced here: every variant of a server uses the same UUID/volume, port, image, startup line, memory
# and flags; verify_equiv.py must pass before any timing; lifecycle.py resets the shared volume at the start of EVERY
# invocation and fails if the volume does not hold the variant it was started for (files fingerprint).
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd); O=${OUT:?set OUT}; R=${ROUNDS:-4}; P=${PER:-5}
BENCH=${BENCH:-/bench/wings-opt/p2}; T=${TEMPLATES:-$BENCH/templates}; J25=${IMAGE:-ghcr.io/pterodactyl/yolks:java_25}
DRY=${DRY_RUN:-0}; WARMUP_ALL=${WARMUP_ALL:-0}
read -r -a VARS <<< "${VARS:-default aot}"; read -r -a SERVERS <<< "${SERVERS:-canvas divine}"
PULL="image_pull_policy=periodic image_refresh_minutes=60"
declare -A TPL=([canvas-default]=canvas-j25-pc [canvas-bypass]=canvas-j25-bypass [canvas-aot]=canvas-j25-aot
                [divine-default]=dv-pc [divine-bypass]=dv-bypass [divine-aot]=dv-aot)
declare -A PORT=([canvas]=25566 [divine]=25567) UUID
for s in "${SERVERS[@]}"; do
  if [ -f "$BENCH/uuid-$s" ]; then UUID[$s]=$(cat "$BENCH/uuid-$s"); elif [ "$DRY" = 1 ]; then UUID[$s]="uuid-$s"; else echo "missing $BENCH/uuid-$s" >&2; exit 2; fi
done
# ---- equivalence gate: identical files and flags across the variants of one server, before any timing ---------------------
for s in "${SERVERS[@]}"; do
  dirs=(); for v in "${VARS[@]}"; do dirs+=("$T/${TPL[$s-$v]}"); done
  if [ "${#dirs[@]}" -gt 1 ]; then
    [ "$DRY" = 1 ] && [ ! -d "${dirs[0]}" ] && { echo "[dry-run] would verify_equiv.py ${dirs[*]}"; continue; }
    python3 "$h/verify_equiv.py" "${dirs[@]}" || { echo "variant templates of $s are not equivalent: refusing to benchmark" >&2; exit 3; }
  fi
done
if [ "$DRY" != 1 ]; then
  # keep the Panel/DB/cache of the wdev project up (and log who stops containers, in case something else does)
  source /bench/gobia/scripts/gobia/bench/lib.sh wdev
  docker events --filter type=container --filter event=stop --filter event=kill --format '{{.Time}} {{.Actor.Attributes.name}} {{.Action}}' > "$O.events.log" 2>&1 &
  trap 'kill $(jobs -p) 2>/dev/null || true' EXIT
fi
ensure_panel() {
  [ "$DRY" = 1 ] && return
  [ "$(docker inspect -f '{{.State.Health.Status}}' wdev-panel-1 2>/dev/null)" = healthy ] && return
  echo "panel was down: restarting" >&2
  dc up -d database cache panel >/dev/null 2>&1
  for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' wdev-panel-1 2>/dev/null)" = healthy ] && break; sleep 2; done
}
daemon() {
  ensure_panel
  if [ "$DRY" = 1 ]; then echo "[dry-run] daemon $1"; return; fi
  case $1 in direct) ;; stock) bash "$h/wdev_wings.sh" stock >/dev/null;; gobia) bash "$h/wdev_wings.sh" wings-dev:p2 $PULL reuse_containers=true >/dev/null;; esac
}
rotate() { local -n a=$1; local k=$(( $2 % ${#a[@]} )); a=("${a[@]:k}" "${a[@]:0:k}"); }
lc() {
  if [ "$DRY" = 1 ]; then printf "lifecycle.py"; printf " %q" "$@"; echo; else python3 "$h/lifecycle.py" "$@" >/dev/null; fi
}
for r in $(seq 1 "$R"); do
  warm=0; { [ "$r" = 1 ] || [ "$WARMUP_ALL" = 1 ]; } && warm=1
  for sc in ${SCENARIOS:-start restart}; do
    envs=(direct stock gobia); rotate envs $((r-1))                       # rotate daemon order each round
    for env in "${envs[@]}"; do
      daemon "$env"
      srvs=("${SERVERS[@]}"); rotate srvs $((r-1))                         # and server order, so no server is always first
      for srv in "${srvs[@]}"; do
        vs=("${VARS[@]}"); rotate vs $((r-1))                              # and variant order, so no variant is always first
        for var in "${vs[@]}"; do
          label="$srv-$var-$env-$sc"
          mode=wings; [ "$env" = direct ] && mode=direct
          lc --mode "$mode" --uuid "${UUID[$srv]}" --port "${PORT[$srv]}" --label "$label" --scenario "$sc" \
            --n "$P" --warmup "$warm" --settle 1 --template "$T/${TPL[$srv-$var]}" --image "$J25" \
            --startup "java @/home/container/jvm.args" --out "$O"
        done
      done
    done
  done
done
