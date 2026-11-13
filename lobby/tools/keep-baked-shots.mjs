// Keeps a chosen few stills of the baked bar in the repository, small enough to commit:
// lobby/shots/baked/*.jpg, from the runs in lobby/test/shots/ (which are not committed) and
// the Star Lounge study in landing/tools/blender/out/.
//
//   node lobby/test/shoot-baked-stills.mjs && node lobby/test/side-by-side.mjs
//   npm run lobby:shots:3d -- --look=baked --out=lobby/test/shots/baked-live
//   node lobby/tools/keep-baked-shots.mjs
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve("lobby/shots/baked");
mkdirSync(out, { recursive: true });
const keep = [
  ["lobby/test/shots/baked/side-by-side-phone-whole-room.png", "side-by-side-hero-above-live-phone-below.jpg", 1688],
  ["lobby/test/shots/baked/side-by-side-phone-closer.png", "side-by-side-hero-above-live-phone-closer-below.jpg", 1688],
  ["lobby/test/shots/baked/side-by-side-screen.png", "side-by-side-hero-above-live-screen-below.jpg", 1920],
  ["lobby/test/shots/baked/screen-live.png", "posed-screen.jpg", 1920],
  ["lobby/test/shots/baked/screen-count.png", "posed-screen-count.jpg", 1920],
  ["lobby/test/shots/baked/phone-whole-room.png", "posed-phone-whole-room.jpg", 1688],
  ["lobby/test/shots/baked/phone-closer.png", "posed-phone-closer.jpg", 1688],
  ["lobby/test/shots/baked/upright.png", "posed-upright.jpg", 780],
  ["lobby/test/shots/baked/compare-3d-screen.png", "the-3d-look-for-comparison.jpg", 1920],
  ["lobby/test/shots/baked-live/07-screen-bump.png", "live-screen-kick.jpg", 1920],
  ["lobby/test/shots/baked-live/04-phone-vote-closer.png", "live-phone-closer.jpg", 1688],
  ["lobby/test/shots/baked-live/08-screen-count.png", "live-screen-count.jpg", 1920],
  ["landing/tools/blender/out/ship-still.png", "star-lounge-study.jpg", 1920],
];
for (const [from, name, width] of keep) {
  if (!existsSync(from)) {
    console.log(`skipped ${name}: no ${from}`);
    continue;
  }
  await sharp(from).resize({ width, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(resolve(out, name));
  console.log(`kept ${name}`);
}
