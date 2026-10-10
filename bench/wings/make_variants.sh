#!/usr/bin/env bash
# Build ALL startup variants of one server from ONE base template, with identical flags, into a fresh template directory
# (the earlier templates are left untouched), then prove they are equivalent.
#   ./make_variants.sh canvas /bench/wings-opt/p2/templates/canvas-j25-pc /bench/wings-opt/p2/templates-v2 canvas-j25
#   ./make_variants.sh divine /bench/wings-opt/p2/templates/dv-pc          /bench/wings-opt/p2/templates-v2 dv
# Produces <dest>/<prefix>-pc (Paperclip), <prefix>-bypass, <prefix>-aot (names match ab3.sh; run ab3.sh with TEMPLATES=<dest>).
# Needs root, Docker and the Java 25 image. Extra env: FLAGS (JVM flags), IMAGE, MEM_MB (training container memory), STRICT=1.
set -euo pipefail
h=$(cd "$(dirname "$0")" && pwd)
SRV=${1:?server name}; BASE=${2:?base template (Paperclip, with server.jar)}; DEST=${3:?dest dir}; P=${4:?template prefix}
IMAGE=${IMAGE:-ghcr.io/pterodactyl/yolks:java_25}; MEM_MB=${MEM_MB:-2355}
FLAGS=${FLAGS:--Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true}
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
[ -f "$BASE/server.jar" ] || { echo "$BASE/server.jar missing" >&2; exit 2; }
mkdir -p "$DEST"
common=(--image "$IMAGE" --flags "$FLAGS" --mem-mb "$MEM_MB")
python3 "$h/mkvariant.py" "$BASE" "$DEST/$P-pc"     "${common[@]}" --paperclip
python3 "$h/mkvariant.py" "$BASE" "$DEST/$P-bypass" "${common[@]}" --bypass
python3 "$h/mkvariant.py" "$BASE" "$DEST/$P-aot"    "${common[@]}" --aot --verify ${STRICT:+--strict}
python3 "$h/verify_equiv.py" "$DEST/$P-pc" "$DEST/$P-bypass" "$DEST/$P-aot"
echo "$SRV variants ready in $DEST (equivalence verified)"
