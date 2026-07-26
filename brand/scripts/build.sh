#!/usr/bin/env bash
#
# Rebuilds every otterdeploy brand asset from source.
#
# One command, four steps: outline the wordmark, compose the SVGs, rasterise the
# PNGs through Chromium, pack the .ico. Everything downstream is generated —
# edit brand/scripts/build_svgs.py (geometry) or the mark colours, never the
# output files.
#
#   brand/scripts/build.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
BRAND="$PWD"
VENV="$BRAND/.venv"

if [ ! -x "$VENV/bin/python" ]; then
  echo "→ creating brand toolchain venv"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -r "$BRAND/scripts/requirements.txt"
fi

if [ ! -d "$BRAND/node_modules/playwright" ]; then
  echo "→ installing playwright"
  bun install --cwd "$BRAND"
  bunx playwright install chromium
fi

echo "→ 1/4 outlining wordmark"
"$VENV/bin/python" scripts/wordmark.py

echo "→ 2/4 composing svgs"
"$VENV/bin/python" scripts/build_svgs.py

echo "→ 3/4 rasterising"
bun scripts/rasterize.ts

echo "→ 4/4 packing favicon.ico"
"$VENV/bin/python" scripts/make_ico.py

echo "✓ brand assets rebuilt"
