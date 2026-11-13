// Packs the bar's rendered plate for the baked look into lobby/public/baked/bar.
//
//   landing/tools/blender/plate.sh       renders the passes (about 45 minutes, not committed)
//   node lobby/tools/pack-baked.mjs      joins, sizes and compresses them, and writes plate.json
//
// What it writes, and why each is the size it is:
//   base-3840.webp, base-2560.webp   the room with no game lamp on. 1.5 and 1 pixel per world
//                                    unit: the large one for big and dense screens, the small
//                                    one for the rest (room-baked.js picks).
//   lamp-<i>.webp                    only what lamp i adds, at 0.75 pixel per unit: light is
//                                    soft, and these are mostly black.
//   env.webp                         the room all round, for the pieces' shine.
//   juke.webp                        the jukebox with its shadow, on a clear picture.
//   plate.json                       how many boxes the wall has, the part of the room the
//                                    plate covers, and how to add the lamps back.
import sharp from "sharp";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const renders = resolve(here, "..", "..", "landing", "tools", "blender", "out");
const out = resolve(here, "..", "public", "baked", "bar");
mkdirSync(out, { recursive: true });

/** The same numbers as landing/tools/blender/room.py (PLATE_RECT, LAMP_STOPS and the jukebox's part of the frame). */
const BOXES = 5;
const RECT = { x0: -320, y0: -180, x1: 2240, y1: 1260 };
const JUKE = { x0: 1560, y0: 500, x1: 1900, y1: 860 };
const LAMP_STOPS = -1.5;

const need = (file) => {
  const path = join(renders, file);
  if (!existsSync(path)) throw new Error(`${file} is not rendered yet: run landing/tools/blender/plate.sh`);
  return path;
};

// The base was rendered in two halves, to keep each job short.
const [left, right] = [need("plate-base-0_0_500_1000.png"), need("plate-base-500_0_1000_1000.png")];
const [lm, rm] = [await sharp(left).metadata(), await sharp(right).metadata()];
const base = await sharp({ create: { width: lm.width + rm.width, height: lm.height, channels: 3, background: "#000" } })
  .composite([{ input: left, left: 0, top: 0 }, { input: right, left: lm.width, top: 0 }])
  .png()
  .toBuffer();
const sizes = {};
const save = async (img, name) => {
  await img.toFile(join(out, name));
  sizes[name] = statSync(join(out, name)).size;
};
await save(sharp(base).webp({ quality: 92, effort: 6 }), "base-3840.webp");
await save(sharp(base).resize({ width: 2560 }).webp({ quality: 90, effort: 6 }), "base-2560.webp");
const lamps = [];
for (let i = 0; i < BOXES; i++) {
  lamps.push(`lamp-${i}.webp`);
  await save(sharp(need(`plate-lamp${i}.png`)).removeAlpha().webp({ quality: 86, effort: 6 }), `lamp-${i}.webp`);
}
await save(sharp(need("plate-env.png")).removeAlpha().resize({ width: 1024 }).webp({ quality: 80, effort: 6 }), "env.webp");
await save(sharp(need("plate-juke.png")).webp({ quality: 86, alphaQuality: 90, effort: 6 }), "juke.webp");

const info = {
  boxes: BOXES,
  rect: RECT,
  base: { large: "base-3840.webp", small: "base-2560.webp" },
  lamps,
  // What a lamp's pass is multiplied by to put back what LAMP_STOPS took, and a little more: the live room's pools read better a touch hotter than the render's.
  lampGain: Number((2 ** -LAMP_STOPS * 1.35).toFixed(3)),
  exposure: 0.7,
  env: "env.webp",
  juke: { file: "juke.webp", rect: JUKE },
};
writeFileSync(join(out, "plate.json"), JSON.stringify(info, null, 2) + "\n");
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
for (const [name, bytes] of Object.entries(sizes)) console.log(name.padEnd(18), kb(bytes));
const small = sizes["base-2560.webp"] + lamps.reduce((n, f) => n + sizes[f], 0) + sizes["env.webp"] + sizes["juke.webp"];
console.log(`a phone loads ${kb(small)}; a large screen ${kb(small - sizes["base-2560.webp"] + sizes["base-3840.webp"])}`);
