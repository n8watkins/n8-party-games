#!/usr/bin/env bash
# Renders one of the landing page's action scenes with Blender, headless, on the Windows side from WSL
# (the same way Cork & Bell bakes its light).
#   landing/tools/blender/run.sh <shot> [width] [samples]
# The picture lands in landing/tools/blender/out/<shot>.png; `node landing/tools/pack.mjs` then
# sizes and compresses the pictures into landing/public/img.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
blender="${BLENDER:-/mnt/c/Program Files/Blender Foundation/Blender 4.2/blender.exe}"
mkdir -p "$here/out"
"$blender" -b -P "$(wslpath -w "$here/room.py")" -- "$(wslpath -w "$here/out")" "$(wslpath -w "$here")" "$@"
