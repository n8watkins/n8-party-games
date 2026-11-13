"""Draws the site's app icons: a lamp over a pool of light with a pawn standing in it.

    python3 scripts/make-icons.py

Writes site/icons/: icon-192.png and icon-512.png (the picture fills the square), maskable-512.png
(the same picture inside the middle 80%, for launchers that cut icons to a circle or a squircle)
and apple-touch-icon.png (180, which iOS rounds itself). Original art, drawn here. Needs Pillow.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

out = Path(sys.argv[1] if len(sys.argv) > 1 else "site/icons")
out.mkdir(parents=True, exist_ok=True)

BG = (18, 11, 8)
AMBER = (244, 180, 83)
CREAM = (251, 243, 226)
SHADE = (156, 43, 32)
K = 4  # drawn four times larger, then shrunk, for smooth edges


def picture(size, inset):
    """The picture at `size`, its content kept inside the middle `1 - 2 * inset` of the square."""
    s = size * K
    img = Image.new("RGB", (s, s), BG)
    c = s * (1 - 2 * inset)  # the content square
    o = s * inset
    P = lambda x, y: (o + x * c, o + y * c)  # noqa: E731 - a point in content units (0..1)

    # The light: a soft cone from the lamp to the floor, and a pool where it lands.
    glow = Image.new("L", (s, s), 0)
    g = ImageDraw.Draw(glow)
    g.polygon([P(0.42, 0.30), P(0.58, 0.30), P(0.80, 0.80), P(0.20, 0.80)], fill=110)
    g.ellipse([P(0.14, 0.72), P(0.86, 0.90)], fill=200)
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.035))
    img.paste(Image.new("RGB", (s, s), AMBER), (0, 0), glow)

    d = ImageDraw.Draw(img)
    # The cord and the lamp's shade, and the bulb's edge under it.
    d.rectangle([(P(0.488, 0)[0], 0), P(0.512, 0.16)], fill=(60, 40, 30))
    d.polygon([P(0.42, 0.15), P(0.58, 0.15), P(0.68, 0.30), P(0.32, 0.30)], fill=SHADE)
    d.ellipse([P(0.36, 0.27), P(0.64, 0.33)], fill=(255, 226, 160))

    # A pawn standing in the pool: head, neck ring, body, base.
    d.ellipse([P(0.415, 0.47), P(0.585, 0.64)], fill=CREAM)
    d.rounded_rectangle([P(0.40, 0.62), P(0.60, 0.66)], radius=c * 0.02, fill=CREAM)
    d.polygon([P(0.445, 0.65), P(0.555, 0.65), P(0.62, 0.80), P(0.38, 0.80)], fill=CREAM)
    d.rounded_rectangle([P(0.33, 0.78), P(0.67, 0.84)], radius=c * 0.03, fill=CREAM)
    return img.resize((size, size), Image.LANCZOS)


picture(192, 0.06).save(out / "icon-192.png", optimize=True)
picture(512, 0.06).save(out / "icon-512.png", optimize=True)
picture(512, 0.16).save(out / "maskable-512.png", optimize=True)
picture(180, 0.08).save(out / "apple-touch-icon.png", optimize=True)
for f in sorted(out.glob("*.png")):
    print(f, f.stat().st_size)
