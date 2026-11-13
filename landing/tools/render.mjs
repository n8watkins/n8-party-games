// Renders the concept drawings the landing page uses from the lobby's 3D concept scene
// (landing/tools/scene): the six rooms, the interface on a big screen and on a phone, and the
// box fronts. The action scenes are not these: they are Cycles renders (landing/tools/blender).
//
//   node landing/tools/render.mjs [name-filter]   the pictures, sized and compressed, into landing/public/img
//   node landing/tools/render.mjs tex             the signs and box fronts the Blender room hangs on its wall
//
// It serves the repository on a local port (the scene loads three.js from node_modules), opens
// the scene once per picture in a headless, muted browser, and stops everything when it is done.
// The scene page takes its lettering from Google Fonts, so rendering needs a connection; the
// landing page itself loads nothing from outside.
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = join(root, "landing", "public", "img");
mkdirSync(out, { recursive: true });
const filter = process.argv[2];

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/landing/tools/scene/scene.html`;

const SCREEN = { width: 1920, height: 1080 };
const PHONE = { width: 844, height: 390 };
const ROOMS = [["bar", "bar"], ["tech", "tech"], ["fair", "fairground"], ["attic", "attic"], ["roof", "rooftop"], ["camp", "campfire"]];
const pictures = [
  // The room's interface as it is drawn, on a big screen and on a phone held sideways.
  { file: "hero-full", query: "shot=lhero&hide=brand", widths: [1600, 800] },
  { file: "hero-phone", query: "shot=lhero&view=phone&zoom=1.25", size: PHONE, scale: 2, widths: [1688, 844] },
  // The six rooms.
  ...ROOMS.map(([room, name]) => ({ file: `room-${name}`, query: `shot=lhero&hide=brand&room=${room}`, widths: [1600, 800] })),
].filter((p) => !filter || p.file.includes(filter));

/** Saves one picture as WebP, once per width. */
async function save(png, p) {
  for (const w of p.widths) {
    const img = w === 1 ? sharp(png) : sharp(png).resize({ width: w, withoutEnlargement: true });
    const name = p.widths.length > 1 ? `${p.file}-${w}` : p.file;
    if (p.alpha) await img.webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile(join(out, `${name}.webp`));
    else await img.webp({ quality: 80, effort: 6 }).toFile(join(out, `${name}.webp`));
  }
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  if (filter === "tex") {
    // The lettered things on the wall (signs, chalkboard, join sign) and the box fronts, as
    // pictures for the Blender room (landing/tools/blender/room.py), with their sizes in metres.
    const tex = join(here, "blender", "tex");
    mkdirSync(tex, { recursive: true });
    const context = await browser.newContext({ viewport: SCREEN, deviceScaleFactor: 4 });
    const page = await context.newPage();
    await page.goto(`${base}?shot=lhero&only=none&hide=brand`);
    await page.waitForSelector("html[data-ready]", { timeout: 90000 });
    // Solid plates: in the room these are painted boards, not see-through panels.
    await page.addStyleTag({ content: ".sign, .join { background: #1e110c !important; opacity: 1 !important; } .sign.shut > * { opacity: .7; }" });
    const sizes = {};
    for (const [name, selector] of [["sign-0", ".sign.n0"], ["sign-1", ".sign.n1"], ["sign-2", ".sign.n2"], ["sign-3", ".sign.n3"], ["board", ".board"], ["join", ".join"], ["shelf-tag", ".shelf-tag"]]) {
      const el = page.locator(selector);
      const box = await el.boundingBox();
      await el.screenshot({ path: join(tex, `${name}.png`), omitBackground: true });
      sizes[name] = { w: box.width / 127, h: box.height / 127 };
    }
    const boxes = await page.evaluate(() => window.__boxes);
    for (const [id, url] of Object.entries(boxes)) await sharp(Buffer.from(url.split(",")[1], "base64")).png().toFile(join(tex, `box-${id}.png`));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(tex, "sizes.json"), JSON.stringify(sizes, null, 2) + "\n");
    await context.close();
    console.log("saved the textures for Blender");
    pictures.length = 0;
  }
  for (const p of pictures) {
    const size = p.size ?? SCREEN;
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: p.scale ?? 1 });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log(`[${p.file}] ${m.text()}`); });
    page.on("pageerror", (e) => console.log(`[${p.file}] ${e.message}`));
    await page.goto(`${base}?${p.query}`);
    await page.waitForSelector("html[data-ready]", { timeout: 90000 });
    const png = await page.screenshot({ ...(p.clip ? { clip: p.clip } : {}), omitBackground: !!p.alpha });
    await save(png, p);
    console.log(`saved ${p.file}`);
    if (p.file === "hero-full" || filter === "box") {
      // The box fronts, straight from the scene's own canvases.
      const boxes = await page.evaluate(() => window.__boxes);
      for (const [id, url] of Object.entries(boxes)) {
        const buf = Buffer.from(url.split(",")[1], "base64");
        await sharp(buf).resize({ width: 560 }).webp({ quality: 84, effort: 6 }).toFile(join(out, `box-${id}.webp`));
      }
      console.log("saved the box fronts");
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
