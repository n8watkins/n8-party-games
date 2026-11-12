#!/usr/bin/env bash
# Runs a Blender script headless on the Windows side from WSL.
#   tools/blender/run.sh <script.py> [args...]
# The script gets the Windows path of tools/blender/out as its first argument after "--".
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
blender="/mnt/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
script="$here/$1"
shift
mkdir -p "$here/out"
"$blender" -b -P "$(wslpath -w "$script")" -- "$(wslpath -w "$here/out")" "$(wslpath -w "$here")" "$@"
