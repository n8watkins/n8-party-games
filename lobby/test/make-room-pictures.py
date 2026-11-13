"""Turns the stills and loop frames from shoot-3d-stills.mjs into the pictures the rooms page shows.

    python3 lobby/test/make-room-pictures.py [shots folder]

For every lobby/test/shots/3d/room-<id>.png it writes lobby/public/look3d/rooms/<id>.jpg (the
room above its bottom bar, 1280 wide). For every folder of frames in
lobby/test/shots/3d/loops/<id>/ it writes lobby/public/look3d/rooms/<id>.webp, a looping
picture 640 wide at eight frames a second. From each live room's still it also writes
lobby/public/rooms/<id>.webp, the small picture on the room picker's card (320 wide). Needs Pillow.
"""

import sys
from pathlib import Path

from PIL import Image

shots = Path(sys.argv[1] if len(sys.argv) > 1 else "lobby/test/shots/3d")
out = Path("lobby/public/look3d/rooms")
cards = Path("lobby/public/rooms")
# The rooms a party can be in (lobby/shared/rooms.js): only those get a card on the picker.
LIVE = ["bar", "ship", "arcade", "camp", "roof", "navy", "fair"]

for still in sorted(shots.glob("room-*.png")):
    name = still.stem.removeprefix("room-")
    picture = Image.open(still).convert("RGB")
    # The bottom 90 of 1080 is the page's bar, which the rooms page does not need.
    picture = picture.crop((0, 0, picture.width, round(picture.height * 990 / 1080)))
    picture = picture.resize((1280, round(1280 * picture.height / picture.width)), Image.LANCZOS)
    picture.save(out / f"{name}.jpg", quality=74, optimize=True, progressive=True)
    print(f"still {name}.jpg {(out / f'{name}.jpg').stat().st_size // 1024} KB")

for folder in sorted((shots / "loops").glob("*/")):
    frames = [Image.open(f).convert("RGB") for f in sorted(folder.glob("*.png"))]
    if not frames:
        continue
    frames = [f.resize((640, round(640 * f.height / f.width)), Image.LANCZOS) for f in frames]
    target = out / f"{folder.name}.webp"
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=125, loop=0, quality=50, method=6, minimize_size=True)
    print(f"loop  {target.name} {target.stat().st_size // 1024} KB, {len(frames)} frames")

cards.mkdir(exist_ok=True)
for name in LIVE:
    still = out / f"{name}.jpg"
    if not still.exists():
        continue
    picture = Image.open(still).convert("RGB")
    picture = picture.resize((320, round(320 * picture.height / picture.width)), Image.LANCZOS)
    target = cards / f"{name}.webp"
    picture.save(target, quality=72, method=6)
    print(f"card  {target.name} {target.stat().st_size // 1024} KB")
