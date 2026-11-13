"""Turns the stills and loop frames from shoot-3d-stills.mjs into the pictures the rooms page shows.

    python3 lobby/test/make-room-pictures.py [shots folder]

For every lobby/test/shots/3d/room-<id>.png it writes lobby/public/look3d/rooms/<id>.jpg (the
room above its bottom bar, 1280 wide). For every folder of frames in
lobby/test/shots/3d/loops/<id>/ it writes lobby/public/look3d/rooms/<id>.webp, a looping
picture 720 wide at eight frames a second. Needs Pillow.
"""

import sys
from pathlib import Path

from PIL import Image

shots = Path(sys.argv[1] if len(sys.argv) > 1 else "lobby/test/shots/3d")
out = Path("lobby/public/look3d/rooms")

for still in sorted(shots.glob("room-*.png")):
    name = still.stem.removeprefix("room-")
    picture = Image.open(still).convert("RGB")
    # The bottom 90 of 1080 is the page's bar, which the rooms page does not need.
    picture = picture.crop((0, 0, picture.width, round(picture.height * 990 / 1080)))
    picture = picture.resize((1280, round(1280 * picture.height / picture.width)), Image.LANCZOS)
    picture.save(out / f"{name}.jpg", quality=80, optimize=True)
    print(f"still {name}.jpg {(out / f'{name}.jpg').stat().st_size // 1024} KB")

for folder in sorted((shots / "loops").glob("*/")):
    frames = [Image.open(f).convert("RGB") for f in sorted(folder.glob("*.png"))]
    if not frames:
        continue
    frames = [f.resize((720, round(720 * f.height / f.width)), Image.LANCZOS) for f in frames]
    target = out / f"{folder.name}.webp"
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=125, loop=0, quality=62, method=4)
    print(f"loop  {target.name} {target.stat().st_size // 1024} KB, {len(frames)} frames")
