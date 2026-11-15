// Looks at the built preview in a headless, muted browser: takes stills at the sizes that matter,
// reports anything the page logged as an error, and (with --measure) times its frames.
//
//   node preview/star-lounge/shoot.mjs [--out=<folder>] [--port=8856] [--only=<name>]
//   node preview/star-lounge/shoot.mjs --measure [--soft=1]
//
// Stills are drawn by the software renderer inside WSL (right for a still, wrong for speed).
// --measure drives a headless Chrome on the Windows side, on the PC's real graphics card, with the
// frame limiter off (Cork & Bell's tools/browser.mjs: no window, a throwaway profile, closed at the
// end). That is a desktop graphics card at a phone's size. It is not a phone.
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const port = Number(opt("port", "8856"));
const out = resolve(opt("out", join(here, "shots")));
const only = opt("only", "");
const measure = args.includes("--measure");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end("<!doctype html><html><head><meta charset=utf-8></head><body>" + readFileSync(join(here, "star-lounge.html"), "utf8") + "</body></html>");
}).listen(port);
const base = `http://localhost:${port}/`;
const errors = [];
const watch = (page, name) => {
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
};
let failed = false;

if (measure) {
  const { openBrowser } = await import("../../node_modules/cork-and-bell/tools/browser.mjs");
  process.env.CAB_PROFILE ??= join(tmpdir(), "star-lounge-preview-chrome-profile");
  const soft = opt("soft", "0") === "1";
  const b = await openBrowser({ win: !soft, uncapped: true });
  try {
    for (const size of [
      { name: "phone 844x390 @2x, closer", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, query: "view=closer" },
      { name: "phone 844x390 @2x, whole room", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, query: "view=room" },
      { name: "phone 844x390 @3x, closer", viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, query: "view=closer" },
      { name: "screen 1920x1080", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, query: "view=room" },
      // Far more pixels than any device has, so that the graphics card is what sets the pace and not the script:
      // the only way a desktop card says anything about the cost of each pixel. Read the count of frames, not the times.
      { name: "stress 3840x2160 @2x (33 million pixels), closer", viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 2, query: "view=closer&fixed" },
    ]) {
      const context = await b.newContext({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, hasTouch: true });
      const page = await context.newPage();
      watch(page, size.name);
      await page.goto(base + "?" + size.query);
      await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
      await sleep(2500);
      // Its own count of frames over five seconds, with something set off halfway.
      const got = await page.evaluate(
        () =>
          new Promise((done) => {
            const times = [];
            let last = performance.now();
            const t0 = last;
            let poked = false;
            const el = document.getElementById("gl") ?? document.querySelector("canvas");
            const step = (now) => {
              times.push(now - last);
              last = now;
              if (!poked && now - t0 > 2500 && el.id === "gl") {
                poked = true;
                const c = el.getBoundingClientRect();
                for (const [x, y] of [[0.5, 0.3], [0.9, 0.55]]) for (const type of ["pointerdown", "pointerup"]) el.dispatchEvent(new PointerEvent(type, { clientX: c.left + c.width * x, clientY: c.top + c.height * y, bubbles: true }));
              }
              if (now - t0 < 5000) requestAnimationFrame(step);
              else {
                times.sort((a, b) => a - b);
                const gl = el.getContext("webgl2");
                const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
                done({ frames: times.length, mean: times.reduce((a, b) => a + b, 0) / times.length, p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)], worst: times[times.length - 1], meter: window.__meter, pixels: `${el.width}x${el.height}`, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown" });
              }
            };
            requestAnimationFrame(step);
          }),
      );
      console.log(`${size.name}: mean ${got.mean.toFixed(2)} ms, median ${got.p50.toFixed(2)}, 95th ${got.p95.toFixed(2)}, worst ${got.worst.toFixed(1)}, ${got.frames} frames in five seconds; ${got.pixels} pixels drawn` + (got.meter ? `; the page's own work ${got.meter.script.toFixed(2)} ms; ${got.meter.calls} draw calls, ${got.meter.triangles} triangles` : "") + `; ${got.gpu}`);
      await context.close();
    }
  } finally {
    await b.close();
  }
} else {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    const SHOTS = [
      { name: "phone-844x390-closer", w: 844, h: 390, dpr: 2, q: "still&view=closer" },
      { name: "phone-844x390-whole-room", w: 844, h: 390, dpr: 2, q: "still&view=room" },
      { name: "phone-844x390-today", w: 844, h: 390, dpr: 2, q: "still&view=room&look=today" },
      { name: "phone-844x390-today-closer", w: 844, h: 390, dpr: 2, q: "still&view=closer&look=today" },
      { name: "screen-1280x720", w: 1280, h: 720, dpr: 1, q: "still&view=room" },
      { name: "screen-1280x720-closer", w: 1280, h: 720, dpr: 1, q: "still&view=closer" },
      { name: "screen-1280x720-today", w: 1280, h: 720, dpr: 1, q: "still&view=room&look=today" },
      { name: "phone-667x375", w: 667, h: 375, dpr: 2, q: "still&view=closer" },
      { name: "phone-568x320", w: 568, h: 320, dpr: 2, q: "still&view=room" },
      { name: "phone-upright-390x844", w: 390, h: 844, dpr: 2, q: "still&view=closer" },
      { name: "phone-844x390-notes", w: 844, h: 390, dpr: 2, q: "still&view=closer", notes: true },
      { name: "phone-844x390-live-after-taps", w: 844, h: 390, dpr: 2, q: "view=room&fixed", live: true },
      // The same moment with the eye pushed a metre and a half each way: near things must move against far ones.
      { name: "depth-eye-left", w: 844, h: 390, dpr: 2, q: "still&view=closer&eye=-1.5" },
      { name: "depth-eye-right", w: 844, h: 390, dpr: 2, q: "still&view=closer&eye=1.5" },
    ].filter((s) => !only || s.name.includes(only));
    for (const s of SHOTS) {
      const context = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr, hasTouch: true });
      const page = await context.newPage();
      watch(page, s.name);
      await page.goto(base + "?" + s.q);
      await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
      await sleep(s.live ? 4000 : 1200);
      if (s.notes) await page.click("#notes-open");
      if (s.live) {
        // Set things off, and spam them: a lamp, the chart, the glass, a screen.
        const box = await page.locator("#gl").boundingBox();
        for (let i = 0; i < 3; i++) for (const [x, y] of [[0.262, 0.1], [0.905, 0.6], [0.5, 0.62], [0.36, 0.3], [0.905, 0.62]]) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
        await sleep(700);
      }
      if (s.notes) await sleep(400);
      const spill = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1);
      if (spill) errors.push(`${s.name}: the page scrolls`);
      const cut = await page.evaluate(() => [...document.querySelectorAll("#bar button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 0.5); }).map((b) => b.textContent));
      if (cut.length) errors.push(`${s.name}: buttons off the screen: ${cut.join(", ")}`);
      await page.screenshot({ path: join(out, s.name + ".png") });
      if (args.includes("--probe")) console.log(JSON.stringify(await page.evaluate(() => window.__probe())));
      console.log("still: " + join(out, s.name + ".png"));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
server.close();
if (errors.length) {
  failed = true;
  console.log(`${errors.length} problem(s):\n- ` + [...new Set(errors)].join("\n- "));
} else console.log("no errors on any page");
process.exit(failed ? 1 : 0);
