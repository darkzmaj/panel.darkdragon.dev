#!/usr/bin/env bash
# Build the shared Paper server template (identical files for direct Docker, stock Wings and Gobia Wings).
#   make_template.sh <paper.jar> <dest-dir>      -> dest has server.jar, eula.txt, server.properties and a generated world
# Generates the world once by a real boot, waits for protocol readiness, then stops gracefully (save-all via stop).
set -euo pipefail
JAR=${1:?paper jar}; DEST=${2:?dest}; here=$(cd "$(dirname "$0")" && pwd)
IMG=${IMAGE:-ghcr.io/pterodactyl/yolks:java_21}; UIDGID=${UIDGID:-988:988}
rm -rf "$DEST"; mkdir -p "$DEST"; cp "$JAR" "$DEST/server.jar"
echo "eula=true" > "$DEST/eula.txt"
cat > "$DEST/server.properties" <<'EOP'
online-mode=false
server-port=25565
level-seed=gobia-bench
view-distance=4
simulation-distance=4
max-players=20
motd=gobia bench
enable-rcon=false
enable-query=false
spawn-protection=0
EOP
chown -R "$UIDGID" "$DEST"
N=bench-template-$$
docker run -d --name $N --user "$UIDGID" -p 127.0.0.1:25599:25565 -v "$DEST:/home/container" -w /home/container "$IMG" \
  java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true -jar server.jar nogui >/dev/null
python3 "$here/probe.py" wait 127.0.0.1 25599 --timeout 300
docker stop -t 120 $N >/dev/null; docker rm $N >/dev/null
du -sb "$DEST" | cut -f1
