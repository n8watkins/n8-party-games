// Sizes and compresses the landing page's pictures into landing/public/img.
//
//   node landing/tools/pack.mjs
//
// It reads two folders that are not committed (the pictures in landing/public/img are):
//   landing/tools/blender/out/   the Cycles renders, from landing/tools/blender/run.sh or all.sh
//   landing/tools/cork/play.png  a real screenshot of Cork & Bell being played, 1600 x 1000, from
//                                the game's own tool while `npm run dev` is up:
//     node node_modules/cork-and-bell/tools/shot.mjs "play=auto=1&seed=3&t=24" \
//       --size=1600x1000 --wait=5000 --out=landing/tools/cork
// A picture whose source is missing is skipped, and said so.
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const renders = join(here, "blender", "out");
const out = resolve(here, "..", "public", "img");
mkdirSync(out, { recursive: true });

/** A little film grain, so the renders read as pictures and gradients do not band. */
async function grain(img) {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let seed = 12345;
  for (let i = 0; i < data.length; i += info.channels) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = ((seed >>> 16) / 65535 - 0.5) * 9;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, data[i + c] + n));
  }
  return sharp(data, { raw: info });
}

async function photo(from, name, widths, { crop, quality = 78, noise = true } = {}) {
  if (!existsSync(from)) { console.log(`skipped ${name}: no ${from}`); return; }
  for (const w of widths) {
    let img = sharp(from);
    if (crop) {
      // A crop is given in fractions of the source's width, so it holds for a test render too.
      const { width } = await sharp(from).metadata();
      img = img.extract({ left: Math.round(crop.left * width), top: Math.round(crop.top * width), width: Math.round(crop.width * width), height: Math.round(crop.height * width) });
    }
    // The haze in the room lifts the blacks; bring a little depth and colour back.
    img = img.resize({ width: w, withoutEnlargement: true });
    if (noise) img = img.linear(1.1, -9).modulate({ saturation: 1.12 });
    if (noise) img = await grain(img.removeAlpha());
    await img.webp({ quality, effort: 6 }).toFile(join(out, `${name}-${w}.webp`));
  }
  console.log(`packed ${name}`);
}

/** Where the piece itself is in a clear render: the box around every pixel that is mostly solid. */
async function solidBox(from) {
  const { data, info } = await sharp(from).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, x1 = 0, y0 = info.height, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 150) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { x0, x1, y0, y1, width: info.width, height: info.height };
}

/**
 * The four pieces, each cut out of its render with the same window, so they keep their sizes
 * next to one another and all stand on the same floor line with their shadows under them.
 */
async function sprites(kinds, width, height) {
  const found = [];
  for (const kind of kinds) {
    const from = join(renders, `piece-${kind}.png`);
    if (!existsSync(from)) { console.log(`skipped piece-${kind}: no ${from}`); continue; }
    found.push({ kind, from, box: await solidBox(from) });
  }
  if (!found.length) return;
  const tallest = Math.max(...found.map(({ box }) => box.y1 - box.y0));
  const floor = Math.max(...found.filter(({ kind }) => kind !== "ghost").map(({ box }) => box.y1), 0) || found[0].box.y1;
  const h = Math.round(tallest * 1.16), w = Math.round(h * width / height);
  for (const { kind, from, box } of found) {
    const cx = Math.round((box.x0 + box.x1) / 2);
    const left = Math.max(0, Math.min(box.width - w, cx - Math.round(w / 2)));
    const top = Math.max(0, Math.min(box.height - h, floor + Math.round(tallest * 0.1) - h));
    await sharp(from).extract({ left, top, width: w, height: h }).resize({ width, height })
      .webp({ quality: 88, alphaQuality: 92, effort: 6 }).toFile(join(out, `piece-${kind}.webp`));
    console.log(`packed piece-${kind}`);
  }
}

await photo(join(renders, "hero.png"), "hero", [2000, 1400, 900], { quality: 80 });
for (const shot of ["hook", "charge", "absorb", "harden", "fade", "toss", "count", "join", "walk", "score"]) {
  await photo(join(renders, `${shot}.png`), `scene-${shot}`, [1600, 800]);
}
await sprites(["pawn", "robot", "slime", "ghost"], 360, 400);
await photo(join(here, "cork", "play.png"), "cork-play", [1600, 800], { noise: false, quality: 76 });
