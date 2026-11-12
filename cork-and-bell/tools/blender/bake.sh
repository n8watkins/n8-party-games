#!/usr/bin/env bash
# The whole bake: layout -> Blender -> game/baked. About four minutes on the CPU.
#   tools/blender/bake.sh [size] [samples]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/dump-layout.mjs"
timeout 590 "$here/run.sh" build_set.py "${1:-4096}" "${2:-64}" > "$here/out/log.txt" 2>&1
echo "blender exit $?"
grep -aE "SAVED|DONE|Error|Traceback" "$here/out/log.txt" | head -20
# Check every baked file before it replaces the one in the game.
for f in set.glb set_albedo.jpg set_lit.jpg set_dusk.jpg env.hdr; do
  if [ ! -s "$here/out/$f" ] || [ "$here/out/$f" -ot "$here/layout.json" ]; then
    echo "MISSING OR STALE: $f"
    exit 1
  fi
done
cp "$here/out/set.glb" "$here/out/set_albedo.jpg" "$here/out/set_lit.jpg" "$here/out/set_dusk.jpg" "$here/out/env.hdr" "$here/../../game/baked/"
ls -la "$here/../../game/baked/"
echo "bake done"
