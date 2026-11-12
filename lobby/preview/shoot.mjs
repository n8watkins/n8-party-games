// Renders the lobby concept stills into lobby/preview/shots/.
// Run from the repository root after `npm install`: node lobby/preview/shoot.mjs [name-filter]
// It serves the repository on a local port (the scene loads three.js and one Cork & Bell picture),
// opens scene.html once per picture and saves a screenshot. Nothing is left running.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = join(here, "shots");
mkdirSync(out, { recursive: true });

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
const base = `http://127.0.0.1:${server.address().port}/lobby/preview/scene.html`;

const SCREEN = { width: 1920, height: 1080, scale: 1 };
const PHONE = { width: 844, height: 390, scale: 3 };
const pictures = [
  { file: "01-vote-big-screen", query: "shot=vote", size: SCREEN },
  { file: "02-vote-phone", query: "shot=vote&view=phone", size: PHONE },
  { file: "03-countdown-big-screen", query: "shot=countdown", size: SCREEN },
  { file: "04-tie-big-screen", query: "shot=tie", size: SCREEN },
  { file: "05-shove-big-screen", query: "shot=shove", size: SCREEN },
  { file: "06-vote-lantern-room", query: "shot=vote&theme=lantern", size: SCREEN },
].filter((p) => !process.argv[2] || p.file.includes(process.argv[2]));

const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const p of pictures) {
    const context = await browser.newContext({ viewport: { width: p.size.width, height: p.size.height }, deviceScaleFactor: p.size.scale });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log(`[${p.file}] ${m.text()}`); });
    page.on("pageerror", (e) => console.log(`[${p.file}] ${e.message}`));
    await page.goto(`${base}?${p.query}`);
    await page.waitForSelector("html[data-ready]", { timeout: 60000 });
    await page.screenshot({ path: join(out, `${p.file}.png`) });
    await context.close();
    console.log(`saved ${p.file}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
