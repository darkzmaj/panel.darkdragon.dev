#!/usr/bin/env bash
# Collect raw artifacts for N start/stop cycles of one Paper server. Linux + Docker only. Run on a STAGING node.
#
#   MODE=direct|wings  SERVER_DIR=/srv/bench/paper-min  IMAGE=ghcr.io/pterodactyl/yolks:java_21 \
#   PORT=25570 MEM=2048 N=20 OUT=./out/direct-min  ./run.sh [env|run]
#
# MODE=wings also needs WINGS_URL (https://node:8080), WINGS_TOKEN (node token), SERVER_UUID (the container name Wings uses).
# SERVER_DIR must hold server.jar + eula.txt and is copied fresh per run (RESET=1) so every run sees the same files.
# Per run it writes $OUT/run-<i>/{t0_ns,dispatch.json,events.jsonl,console.log,probe.json,stop_t0_ns,stop_events.jsonl}
# and summarize.py turns those into stage timings. Nothing here computes a result; it only records.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${MODE:?direct|wings}" "${SERVER_DIR:?}" "${IMAGE:?}" "${PORT:?}" "${OUT:?}"
MEM="${MEM:-2048}"; N="${N:-20}"; RESET="${RESET:-1}"; JAVA_FLAGS="${JAVA_FLAGS:--Xms${MEM}M -Xmx${MEM}M}"
NAME="${SERVER_UUID:-bench-$$}"
ns() { date +%s%N; }

capture_env() {
  mkdir -p "$OUT"
  {
    echo "{"
    echo " \"cpu\": \"$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs)\","
    echo " \"cores\": $(nproc),"
    echo " \"ram_kb\": $(awk '/MemTotal/{print $2}' /proc/meminfo),"
    echo " \"kernel\": \"$(uname -r)\","
    echo " \"docker\": \"$(docker version --format '{{.Server.Version}}')\","
    echo " \"storage\": \"$(df -T --output=source,fstype "$SERVER_DIR" | tail -1 | xargs)\","
    echo " \"image\": \"$IMAGE\", \"image_id\": \"$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || echo missing)\","
    echo " \"java\": \"$(docker run --rm --entrypoint java "$IMAGE" -version 2>&1 | head -1)\","
    echo " \"jvm_flags\": \"$JAVA_FLAGS\", \"mem_mb\": $MEM,"
    echo " \"server_dir_bytes\": $(du -sb "$SERVER_DIR" | cut -f1),"
    echo " \"plugins\": $(ls "$SERVER_DIR/plugins" 2>/dev/null | grep -c '\.jar$' || true),"
    echo " \"wings\": \"$(wings --version 2>/dev/null | head -1 || echo n/a)\","
    echo " \"mode\": \"$MODE\", \"captured\": \"$(date -u +%FT%TZ)\""
    echo "}"
  } > "$OUT/env.json"
}

direct_start() {  # same isolation flags Wings' Create() applies (environment/docker/container.go)
  docker create --name "$NAME" -it --hostname "$NAME" --user "$(id -u):$(id -g)" \
    --read-only --tmpfs /tmp:rw,exec,nosuid,size=100m --security-opt no-new-privileges \
    --cap-drop setpcap --cap-drop mknod --cap-drop audit_write --cap-drop net_raw --cap-drop dac_override \
    --cap-drop fowner --cap-drop fsetid --cap-drop net_bind_service --cap-drop sys_chroot --cap-drop setfcap \
    --memory "${MEM}m" -p "$PORT:25565" -v "$WORK:/home/container" -w /home/container \
    -e "SERVER_JARFILE=server.jar" "$IMAGE" \
    java $JAVA_FLAGS -jar server.jar nogui >/dev/null
  docker start "$NAME" >/dev/null
}

wings_api() { curl -sk -o /dev/null -w '%{http_code} %{time_connect} %{time_starttransfer} %{time_total}' \
  -H "Authorization: Bearer $WINGS_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"action\":\"$1\"}" "$WINGS_URL/api/servers/$NAME/power"; }

one_run() {
  local r="$OUT/run-$1"; mkdir -p "$r"
  WORK="$r/files"
  if [ "$RESET" = 1 ]; then rm -rf "$WORK"; cp -a "$SERVER_DIR" "$WORK"; fi
  [ "$MODE" = direct ] && { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
  sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || echo "cannot drop page cache (not root): runs are warm-cache" >&2
  docker events --filter "container=$NAME" --format '{{json .}}' > "$r/events.jsonl" & local ev=$!
  python3 "$here/probe.py" wait 127.0.0.1 "$PORT" --timeout 180 > "$r/probe.json" & local pr=$!
  sleep 0.2
  ns > "$r/t0_ns"
  if [ "$MODE" = direct ]; then direct_start; else wings_api start > "$r/dispatch.json"; fi
  wait "$pr" || true
  docker logs --timestamps "$NAME" > "$r/console.log" 2>&1 || true
  # graceful stop: Wings sends the egg's stop command; direct uses SIGTERM, whose shutdown hook saves worlds
  ns > "$r/stop_t0_ns"
  docker events --filter "container=$NAME" --format '{{json .}}' > "$r/stop_events.jsonl" & local sev=$!
  if [ "$MODE" = direct ]; then docker stop -t 120 "$NAME" >/dev/null; else wings_api stop >/dev/null
    while [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = true ]; do sleep 0.02; done; fi
  sleep 0.3; kill "$ev" "$sev" 2>/dev/null || true
  docker logs --timestamps "$NAME" > "$r/console_full.log" 2>&1 || true
  [ "$MODE" = direct ] && docker rm -f "$NAME" >/dev/null
  echo "run $1 done"
}

case "${1:-run}" in
  env) capture_env ;;
  run) capture_env; for i in $(seq 1 "$N"); do one_run "$i"; done ;;
esac
