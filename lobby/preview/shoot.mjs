// Renders the lobby concept stills into lobby/preview/shots/.
// Run from the repository root after `npm install`: node lobby/preview/shoot.mjs [name-filter]
// It serves the repository on a local port (the scene loads three.js and one Cork & Bell picture),
// opens scene.html once per picture in a headless, muted browser and saves a screenshot. Nothing is left running.
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
const base = `http://127.0.0.1:${server.address().port}/lobby/preview/`;

// Round three. Round one and round two are kept as rendered, in shots/round-1 and shots/round-2;
// their moments are still in scene.js (shot=vote|count|bell|tie|bump|skins|scores, room=tech).
const SCREEN = { width: 1920, height: 1080, scale: 1 };
const PHONE = { width: 844, height: 390, scale: 3 };
const TALL = { width: 390, height: 844, scale: 3 }; // Cork & Bell's own phone layout is upright
const SHEET = { width: 1600, height: 840, scale: 1 };
const action = (xm) => ({ x: Math.round(960 + xm * 148.6 - 520), y: 395, width: 1040, height: 600 }); // a close crop on the floor
const face = (i) => ({ x: [380, 767, 1153, 1540][i] - 95, y: 700, width: 190, height: 210 });
const pictures = [
  // Rooms.
  { file: "room-1-bar", query: "shot=vote" },
  { file: "room-2-fairground", query: "shot=vote&room=fair" },
  { file: "room-3-attic", query: "shot=vote&room=attic" },
  { file: "room-4-rooftop", query: "shot=vote&room=roof" },
  { file: "room-5-campfire", query: "shot=vote&room=camp" },
  // Starting a game, and games the party cannot play.
  { file: "start-1-count", query: "shot=count" },
  { file: "start-2-host-phone", query: "shot=host&view=phone", size: PHONE },
  { file: "start-3-cannot-play-phone", query: "shot=cant&view=phone&zoom=1.25", size: PHONE },
  { file: "start-4-screen-joins", page: "game.html", query: "frame=display" },
  // The phone.
  { file: "phone-1-closer", query: "shot=ability&view=phone&zoom=1.25", size: PHONE },
  { file: "phone-2-whole-room", query: "shot=ability&view=phone", size: PHONE },
  { file: "phone-3-touch-a-poster", query: "shot=poke&view=phone", size: PHONE },
  // One move per skin.
  { file: "move-1-charge", query: "shot=charge", clip: action(2.0) },
  { file: "move-2-hook", query: "shot=hook", clip: action(-0.5) },
  { file: "move-3-slime-absorb", query: "shot=absorb", clip: action(0.5) },
  { file: "move-4-slime-harden", query: "shot=harden", clip: action(0.55) },
  { file: "move-5-fade", query: "shot=fade", clip: action(1.2) },
  ...["pawn", "robot", "slime", "ghost"].map((name, i) => ({ file: `cast-${name}`, query: "shot=cast", clip: face(i) })),
  { file: "move-6-who-beats-who", page: "chart.html", query: "", size: SHEET },
  // Storyboard A: from the room into the game.
  { file: "go-1-count", query: "shot=go1" },
  { file: "go-2-lights-out", query: "shot=go2" },
  { file: "go-3-poster-opens", query: "shot=go3" },
  { file: "go-4-walk-in", query: "shot=go4" },
  { file: "go-5-push-in", query: "shot=go4", size: { ...SCREEN, scale: 2 }, clip: { x: 110, y: 90, width: 720, height: 405 } },
  { file: "go-6-in-the-game", page: "game.html", query: "frame=arrive" },
  // Storyboard B: from the game back into the room.
  { file: "back-1-end-card", page: "game.html", query: "frame=end" },
  { file: "back-2-walk-out", query: "shot=back1" },
  { file: "back-3-next-vote", query: "shot=back2" },
  // Storyboard C: leaving.
  { file: "leave-1-door-button", page: "game.html", query: "frame=menu" },
  { file: "leave-2-door-button-phone", page: "game.html", query: "frame=phone", size: TALL },
  { file: "leave-3-walks-out", query: "shot=leave" },
  { file: "leave-4-reconnecting", query: "shot=drop1" },
  { file: "leave-5-gone", query: "shot=drop2" },
].filter((p) => !process.argv[2] || p.file.includes(process.argv[2]));

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const p of pictures) {
    const size = p.size ?? SCREEN;
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log(`[${p.file}] ${m.text()}`); });
    page.on("pageerror", (e) => console.log(`[${p.file}] ${e.message}`));
    await page.goto(`${base}${p.page ?? "scene.html"}?${p.query}`);
    await page.waitForSelector("html[data-ready]", { timeout: 60000 });
    await page.screenshot({ path: join(out, `${p.file}.png`), ...(p.clip ? { clip: p.clip } : {}) });
    await context.close();
    console.log(`saved ${p.file}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
