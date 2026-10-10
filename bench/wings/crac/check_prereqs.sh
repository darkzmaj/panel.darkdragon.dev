#!/usr/bin/env bash
# CRaC / CRIU feasibility, step 0: what does THIS host (run it on WSL2) support? Read-only; changes nothing.
#   CRAC_JAVA=/opt/crac-jdk/bin/java ./check_prereqs.sh [--json]
# Prints one line per check: PASS / FAIL / WARN / INFO. Exit status 0 only when every hard requirement passes.
set -u
JAVA=${CRAC_JAVA:-java}; fail=0; out=()
chk() { out+=("$1|$2|$3"); if [ "$1" = FAIL ]; then fail=1; fi; return 0; }   # level|name|detail

# kernel: CRIU needs CONFIG_CHECKPOINT_RESTORE (+ namespaces, soft-dirty memory tracking is optional, userfaultfd for lazy restore)
cfg=""
if [ -r /proc/config.gz ]; then cfg=$(zcat /proc/config.gz 2>/dev/null); elif [ -r "/boot/config-$(uname -r)" ]; then cfg=$(cat "/boot/config-$(uname -r)"); fi
if [ -n "$cfg" ]; then
  if grep -q '^CONFIG_CHECKPOINT_RESTORE=y' <<<"$cfg"; then chk PASS kernel.CHECKPOINT_RESTORE "$(uname -r)"; else chk FAIL kernel.CHECKPOINT_RESTORE "not enabled in $(uname -r) (WSL2: a custom kernel is needed)"; fi
  grep -q '^CONFIG_MEM_SOFT_DIRTY=y' <<<"$cfg" && chk PASS kernel.MEM_SOFT_DIRTY yes || chk WARN kernel.MEM_SOFT_DIRTY "no: incremental dumps unavailable, full dump still works"
  grep -q '^CONFIG_USERFAULTFD=y' <<<"$cfg" && chk PASS kernel.USERFAULTFD yes || chk WARN kernel.USERFAULTFD "no: lazy restore unavailable"
else
  chk WARN kernel.config "cannot read kernel config; rely on 'criu check' below"
fi
[ -e /proc/sys/kernel/ns_last_pid ] && chk PASS kernel.ns_last_pid present || chk FAIL kernel.ns_last_pid "missing: /proc/sys/kernel/ns_last_pid is needed to restore PIDs"

# JDK with CRaC
if command -v "$JAVA" >/dev/null 2>&1; then
  v=$("$JAVA" -version 2>&1 | grep -v JAVA_TOOL_OPTIONS | head -1)
  chk INFO java.version "$v"
  if "$JAVA" -XX:+UnlockDiagnosticVMOptions -XX:+PrintFlagsFinal -version 2>/dev/null | grep -q 'CRaCCheckpointTo'; then chk PASS java.crac "JDK has CRaC flags"; else chk FAIL java.crac "this JDK has no CRaC support (stock OpenJDK/Temurin do not; use a CRaC build, e.g. Azul Zulu CRaC)"; fi
else
  chk FAIL java.present "no java at $JAVA"
fi
# CRIU (some CRaC JDKs bundle it under $JAVA_HOME/lib/criu)
jh=$(dirname "$(dirname "$(readlink -f "$(command -v "$JAVA" 2>/dev/null)" 2>/dev/null)")" 2>/dev/null)
crb=""; command -v criu >/dev/null 2>&1 && crb=criu; [ -x "$jh/lib/criu" ] && crb="$jh/lib/criu"
if [ -n "$crb" ]; then
  chk INFO criu.path "$crb"
  if "$crb" check >/dev/null 2>&1; then chk PASS criu.check "criu check ok"; else chk FAIL criu.check "criu check failed (run '$crb check' as root for the reason)"; fi
else
  chk FAIL criu.present "no criu on PATH and none bundled in the JDK"
fi
# Docker: privileges a checkpointing container would need
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  chk PASS docker.daemon "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  docker run --rm --cap-add CHECKPOINT_RESTORE --cap-add SYS_PTRACE alpine true >/dev/null 2>&1 && chk PASS docker.cap_checkpoint_restore "container may be granted CHECKPOINT_RESTORE+SYS_PTRACE" \
    || chk WARN docker.cap_checkpoint_restore "could not start a container with those caps (image missing offline? seccomp?)"
else
  chk FAIL docker.daemon "docker unreachable"
fi
# Security reminder: this is not free. CRIU inside a container needs capabilities the benchmark pool deliberately drops.
chk INFO security "a CRaC-capable container needs CHECKPOINT_RESTORE/SYS_PTRACE (and often SYS_ADMIN): it cannot keep --cap-drop ALL"

if [ "${1:-}" = "--json" ]; then
  printf '['; sep=""; for l in "${out[@]}"; do IFS='|' read -r a b c <<<"$l"; printf '%s{"level":"%s","check":"%s","detail":"%s"}' "$sep" "$a" "$b" "${c//\"/\'}"; sep=","; done; printf ']\n'
else
  for l in "${out[@]}"; do IFS='|' read -r a b c <<<"$l"; printf '%-5s %-34s %s\n' "$a" "$b" "$c"; done
  [ $fail = 0 ] && echo "RESULT: CRaC prerequisites met" || echo "RESULT: NOT READY (see FAIL lines)"
fi
exit $fail
