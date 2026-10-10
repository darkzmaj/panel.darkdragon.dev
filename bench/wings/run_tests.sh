#!/usr/bin/env bash
# Everything that runs WITHOUT Docker, Java or Minecraft (CI-safe, ~30 s). Live checks are in the handoff document.
set -euo pipefail
cd "$(dirname "$0")"
for f in *.py crac/*.py; do python3 -I -m py_compile "$f"; done
for f in *.sh crac/*.sh; do bash -n "$f"; done
python3 summarize.py selftest
python3 probe.py selftest
exec python3 -W ignore -m unittest discover -s tests -t . "$@"
