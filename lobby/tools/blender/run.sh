#!/usr/bin/env bash
# Renders one pass of the Star Lounge with Blender, headless (background mode, no window), on the
# Windows side from WSL, the same way the bar's plate is made (landing/tools/blender/run.sh).
#   lobby/tools/blender/run.sh <pass> [width] [samples]
# The passes are listed at the top of star-lounge.py. They land in lobby/tools/blender/out/.
# Renders are heavy: run them one at a time, each through `devguard slot -- ...`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
blender="${BLENDER:-/mnt/c/Program Files/Blender Foundation/Blender 4.2/blender.exe}"
mkdir -p "$here/out"
"$blender" -b -P "$(wslpath -w "$here/star-lounge.py")" -- "$(wslpath -w "$here/out")" "$(wslpath -w "$here")" "$@"
