// Stills of the baked look from posed rooms (lobby/public/look3d/still.html?look=baked), for
// looking at it beside the landing page's hero. The browser is headless and muted, and is
// closed at the end whatever happens. A server must be running (npm run dev).
//
//   node lobby/test/shoot-baked-stills.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/baked] [--only=name]
//
// WSL has no graphics card, so these pages draw WebGL in software (?gl=any): right for a
// still, wrong for speed. Frame time is lobby/test/measure-baked.mjs.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/baked"));
const only = opt("only", "");
mkdirSync(out, { recursive: true });

const SCREEN = { width: 1920, height: 1080, scale: 1 };
const PHONE = { width: 844, height: 390, scale: 3 };
const UPRIGHT = { width: 390, height: 844, scale: 3 };
const pictures = [
  { name: "screen-live", size: SCREEN, query: "shot=live" },
  { name: "screen-count", size: SCREEN, query: "shot=count" },
  { name: "screen-toss", size: SCREEN, query: "shot=toss" },
  { name: "screen-all-on", size: SCREEN, query: "shot=vote" },
  { name: "screen-bare", size: SCREEN, query: "shot=live&bare=1" },
  { name: "phone-whole-room", size: PHONE, query: "shot=live&as=player&zoom=room" },
  { name: "phone-closer", size: PHONE, query: "shot=live&as=player&zoom=closer" },
  { name: "upright", size: UPRIGHT, query: "shot=live&as=player" },
  // The same moment in the 3D look, to set beside it.
  { name: "compare-3d-screen", size: SCREEN, query: "shot=vote", look: "3d" },
].filter((p) => !only || p.name.includes(only));

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let failed = false;
try {
  for (const p of pictures) {
    const context = await browser.newContext({ viewport: { width: p.size.width, height: p.size.height }, deviceScaleFactor: p.size.scale, isMobile: p.size !== SCREEN, hasTouch: p.size !== SCREEN });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/lobby/look3d/still.html?gl=any&${p.look === "3d" ? "" : "look=baked&"}${p.query}`);
    await page.waitForSelector("html[data-ready]", { timeout: 120000 });
    await page.waitForTimeout(1500);
    const stats = await page.evaluate(() => window.__still.report());
    await page.screenshot({ path: `${out}/${p.name}.png` });
    console.log(`${errors.length ? "FAIL " : "ok   "}${p.name}: look ${stats.look ?? "3d"}, ${stats.calls} draw calls, ${stats.triangles} triangles${errors.length ? "\n     " + errors.join("\n     ") : ""}`);
    if (errors.length) failed = true;
    await context.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
