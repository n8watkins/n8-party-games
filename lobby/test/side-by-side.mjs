// Sets the baked look's stills beside the landing page's hero, the picture it is meant to match.
//
//   node lobby/test/shoot-baked-stills.mjs     first, for the stills
//   node lobby/test/side-by-side.mjs           writes lobby/test/shots/baked/side-by-side-*.png
//
// Each sheet is the hero (a Cycles render) on top and the live room under it, at the same width.
import sharp from "sharp";
import { resolve } from "node:path";

const shots = resolve("lobby/test/shots/baked");
const hero = resolve("landing/public/img/hero-2000.webp");

async function sheet(name, under, width, crop) {
  // The part of the hero that shows the same stretch of room as the still under it.
  const h = await sharp(hero).metadata();
  const cut = crop ? { left: Math.round(crop.x * h.width), top: Math.round(crop.y * h.height), width: Math.round(crop.w * h.width), height: Math.round(crop.h * h.height) } : null;
  const top = await (cut ? sharp(hero).extract(cut) : sharp(hero)).resize({ width }).png().toBuffer({ resolveWithObject: true });
  const bottom = await sharp(resolve(shots, under)).resize({ width }).png().toBuffer({ resolveWithObject: true });
  await sharp({ create: { width, height: top.info.height + bottom.info.height + 12, channels: 3, background: "#000" } })
    .composite([{ input: top.data, left: 0, top: 0 }, { input: bottom.data, left: 0, top: top.info.height + 12 }])
    .png()
    .toFile(resolve(shots, name));
  console.log(`wrote ${name}`);
}

await sheet("side-by-side-phone-whole-room.png", "phone-whole-room.png", 1688);
await sheet("side-by-side-phone-closer.png", "phone-closer.png", 1688, { x: 0.02, y: 0.42, w: 0.6, h: 0.56 });
await sheet("side-by-side-screen.png", "screen-live.png", 1920);
