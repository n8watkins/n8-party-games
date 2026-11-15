// Looks at the built preview in a headless, muted browser: takes stills at the sizes that matter,
// reports anything the page logged as an error, and checks what the page promises.
//
//   node preview/star-lounge/shoot.mjs [--out=<folder>] [--port=8857] [--only=<name>] [--file=<page>]
//       stills of the room at phone sizes, upright and sideways
//   node preview/star-lounge/shoot.mjs --paths [--out=<folder>] [--only=<thing>]
//       every passing thing along its whole way, at four phone sizes: a sheet of stills for each
//       (entering, four places on the way, leaving), and a count, pixel by pixel, of anything
//       outside the glass that the passing thing changed. One changed pixel that is not glass fails.
//   node preview/star-lounge/shoot.mjs --sky [--seconds=60]
//       watches the live page's sky with its clock run fast and checks, from what is drawn, that
//       there is never more than one thing out there and that the sky is empty between two
//   node preview/star-lounge/shoot.mjs --measure [--soft=1] [--file=<page>]
//       times the frames
//
// Stills are drawn by the software renderer inside WSL (right for a still, wrong for speed).
// --measure and --sky drive a headless Chrome on the Windows side, on the PC's real graphics card,
// with the frame limiter off (Cork & Bell's tools/browser.mjs: no window, a throwaway profile,
// closed at the end). That is a desktop graphics card at a phone's size. It is not a phone.
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { THINGS, TIMES } from "./src/sky.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const port = Number(opt("port", "8857"));
const out = resolve(opt("out", join(here, "shots")));
const only = opt("only", "");
const file = resolve(opt("file", join(here, "star-lounge.html")));
const measure = args.includes("--measure");
const paths = args.includes("--paths");
const watchSky = args.includes("--sky");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end("<!doctype html><html><head><meta charset=utf-8></head><body>" + readFileSync(file, "utf8") + "</body></html>");
}).listen(port);
const base = `http://localhost:${port}/`;
const errors = [];
const watch = (page, name) => {
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  // The page must be one file: anything it asks the network for, beyond itself, is a fault.
  page.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) errors.push(`${name}: the page asked for ${r.url().slice(0, 120)}`);
  });
};
let failed = false;
const softBrowser = () => chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const gpuBrowser = async (soft = false) => {
  const { openBrowser } = await import("../../node_modules/cork-and-bell/tools/browser.mjs");
  process.env.CAB_PROFILE ??= join(tmpdir(), "star-lounge-preview-chrome-profile");
  return openBrowser({ win: !soft, uncapped: true });
};
/** Waits until the page has drawn two more frames. */
const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));

if (measure) {
  const b = await gpuBrowser(opt("soft", "0") === "1");
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
} else if (watchSky) {
  // The live page, its clock run fast, watched frame by frame: what is DRAWN out there (each passing
  // thing's own picture, switched on or off), not what the timetable says.
  const seconds = Number(opt("seconds", "60"));
  const b = await gpuBrowser(opt("soft", "0") === "1");
  try {
    const context = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await context.newPage();
    watch(page, "sky");
    await page.goto(base + "?view=room&fixed&speed=1000");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const got = await page.evaluate(
      (ms) =>
        new Promise((done) => {
          const t0 = performance.now();
          const el = document.getElementById("gl");
          const seen = [];
          let cur = null;
          let most = 0;
          let n = 0;
          let taps = 0;
          const step = (now) => {
            const s = window.__sky();
            n++;
            most = Math.max(most, s.drawn.length);
            const name = s.drawn.join("+") || null;
            if (name !== (cur?.name ?? null)) {
              if (cur) cur.end = s.t;
              cur = name ? { name, start: s.t, end: null } : null;
              if (cur) seen.push(cur);
            }
            // Now and then, a tap on the glass (which may call a shooting star, but only into an empty sky).
            if (n % 1500 === 700) {
              taps++;
              const c = el.getBoundingClientRect();
              for (const type of ["pointerdown", "pointerup"]) el.dispatchEvent(new PointerEvent(type, { clientX: c.left + c.width * 0.5, clientY: c.top + c.height * 0.62, bubbles: true }));
            }
            if (now - t0 < ms) requestAnimationFrame(step);
            else done({ seen, most, frames: n, taps, clock: s.t });
          };
          requestAnimationFrame(step);
        }),
      seconds * 1000,
    );
    const family = Object.fromEntries(THINGS.map((t) => [t.name, t.family]));
    let least = Infinity;
    let tapStars = 0;
    for (const [i, e] of got.seen.entries()) {
      if (e.name.includes("+")) errors.push(`sky: two things drawn at once: ${e.name} at ${e.start.toFixed(1)} s`);
      const next = got.seen[i + 1];
      if (!next || e.end === null) continue;
      const gap = next.start - e.end;
      // A shooting star called by a tap may come into any empty sky; everything the timetable sends keeps its distance.
      const tapped = family[next.name] === "star" && gap < TIMES.quiet[0] - 0.2;
      if (tapped) tapStars++;
      else least = Math.min(least, gap);
      if (!tapped && gap < TIMES.quiet[0] - 0.2 && gap > TIMES.askedQuiet + 0.2) errors.push(`sky: ${next.name} came ${gap.toFixed(1)} s after ${e.name} had gone`);
    }
    if (got.most > 1) errors.push(`sky: ${got.most} passing things were drawn in one frame`);
    if (got.seen.length < 5) errors.push(`sky: only ${got.seen.length} things passed: the clock did not run`);
    const count = {};
    for (const e of got.seen) count[family[e.name] ?? e.name] = (count[family[e.name] ?? e.name] ?? 0) + 1;
    console.log(`sky: watched ${got.frames} frames of the live page, ${(got.clock / 60).toFixed(0)} minutes of the room's clock: ${got.seen.length} things passed (${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(", ")}); never more than ${got.most} drawn at once; the emptiest gap the timetable left was ${least.toFixed(1)} s; ${got.taps} taps on the glass called ${tapStars} shooting stars`);
    await context.close();
  } finally {
    await b.close();
  }
} else if (paths) {
  mkdirSync(out, { recursive: true });
  // On the graphics card (thousands of moments are checked, and the software renderer takes seconds for each); --soft=1 for the software one.
  const browser = await gpuBrowser(opt("soft", "0") === "1");
  const SIZES = [
    { name: "844x390-closer", w: 844, h: 390, q: "view=closer" },
    { name: "844x390-whole-room", w: 844, h: 390, q: "view=room" },
    { name: "667x375-closer", w: 667, h: 375, q: "view=closer" },
    { name: "640x360-whole-room", w: 640, h: 360, q: "view=room" },
    { name: "640x360-closer-eye-left", w: 640, h: 360, q: "view=closer&eye=-2.2" },
    { name: "390x844-upright-closer", w: 390, h: 844, q: "view=closer" },
    // The eye pushed as far as a finger can push it, each way, with the door in view.
    { name: "844x390-whole-room-eye-left", w: 844, h: 390, q: "view=room&eye=-3" },
    { name: "844x390-whole-room-eye-right", w: 844, h: 390, q: "view=room&eye=3" },
  ];
  const things = THINGS.map((t) => t.name).filter((n) => !only || n.includes(only));
  const STEPS = 240;
  let total = 0;
  const open = async (s, dpr) => {
    const context = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: dpr, hasTouch: true });
    const page = await context.newPage();
    watch(page, s.name);
    await page.goto(base + "?still&" + s.q);
    await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
    await sleep(1500);
    return { context, page };
  };
  try {
    for (const [k, s] of SIZES.entries()) {
      // The count is done on a page that draws one pixel for one (quicker, and with the browser's own
      // edge smoothing on); the first size is counted at two for one as well. The stills are at two for one.
      const counters = [await open(s, 1), ...(k === 0 ? [await open(s, 2)] : [])];
      const { context, page } = await open(s, 2);
      const stage = await page.locator("#stage").boundingBox();
      const clip = { x: 0, y: 0, width: s.w, height: Math.min(s.h, Math.ceil(stage.height)) };
      // The glass itself, in white: what the count below calls "glass".
      await page.evaluate(() => window.__glass(true));
      await frames(page);
      await page.screenshot({ path: join(out, `glass-${s.name}.png`), clip });
      await page.evaluate(() => window.__glass(false));
      await frames(page);
      await page.screenshot({ path: join(out, `still-${s.name}.png`), clip });
      console.log("still: " + join(out, `still-${s.name}.png`));
      for (const name of things) {
        // A shooting star is aimed through the door, a post and the left wall in turn, where a leak would show.
        const aims = name === "star" ? [-6.2, -4.3, 0] : [undefined];
        const seenAt = [];
        let leaked = 0;
        let worst = 0;
        let changedMost = 0;
        for (const [c, counter] of counters.entries())
          for (const aim of aims)
            for (let i = 0; i <= STEPS; i++) {
              const u = i / STEPS;
              const r = await counter.page.evaluate(([n, at, x]) => window.__leak(n, at, x), [name, u, aim]);
              total++;
              if (r.passing !== name) errors.push(`${s.name}: asked for ${name}, the page drew ${r.passing}`);
              if (r.changed > 0 && aim === aims[0] && c === 0) seenAt.push(u);
              changedMost = Math.max(changedMost, r.changed);
              if (r.leaked > 0) {
                leaked += r.leaked;
                worst = Math.max(worst, r.worst);
                await counter.page.screenshot({ path: join(out, `LEAK-${s.name}-${name}-${i}.png`) });
              }
            }
        if (leaked) errors.push(`${s.name}: the ${name} changed ${leaked} pixel(s) that are not glass (by up to ${worst} of 255) along its way`);
        if (!seenAt.length) {
          if (!s.name.includes("upright") && !s.name.includes("eye")) errors.push(`${s.name}: the ${name} is never seen`);
          console.log(`path: ${s.name} ${name}: never in view`);
          continue;
        }
        // Six stills: the first and last moments it can be seen, and four between.
        const picks = [0.04, 0.2, 0.4, 0.6, 0.8, 0.96].map((f) => seenAt[Math.round(f * (seenAt.length - 1))]);
        const tiles = [];
        for (const u of picks) {
          await page.evaluate(([n, at, x]) => window.__hold(n, at, x), [name, u, aims[0]]);
          await frames(page);
          tiles.push(await page.screenshot({ clip }));
        }
        const [tw, th] = [clip.width, clip.height];
        const cols = tw > th ? 2 : 3;
        const rows = Math.ceil(tiles.length / cols);
        const small = await Promise.all(tiles.map((t) => sharp(t).resize(tw, th).toBuffer()));
        await sharp({ create: { width: cols * tw + (cols - 1) * 4, height: rows * th + (rows - 1) * 4, channels: 3, background: "#ff00ff" } })
          .composite(small.map((input, k) => ({ input, left: (k % cols) * (tw + 4), top: Math.floor(k / cols) * (th + 4) })))
          .png()
          .toFile(join(out, `path-${s.name}-${name}.png`));
        console.log(`path: ${s.name} ${name}: in view from ${seenAt[0].toFixed(3)} to ${seenAt.at(-1).toFixed(3)} of its way; it changed up to ${changedMost} pixels of glass, and ${leaked} that are not glass: ${join(out, `path-${s.name}-${name}.png`)}`);
      }
      await context.close();
      for (const c of counters) await c.context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`${total} moments checked pixel by pixel`);
} else {
  mkdirSync(out, { recursive: true });
  const browser = await softBrowser();
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
      { name: "phone-640x360", w: 640, h: 360, dpr: 2, q: "still&view=closer" },
      { name: "phone-640x360-whole-room", w: 640, h: 360, dpr: 3, q: "still&view=room" },
      { name: "phone-568x320", w: 568, h: 320, dpr: 2, q: "still&view=room" },
      { name: "phone-upright-390x844", w: 390, h: 844, dpr: 2, q: "still&view=closer" },
      { name: "phone-upright-360x640", w: 360, h: 640, dpr: 2, q: "still&view=closer" },
      { name: "phone-844x390-notes", w: 844, h: 390, dpr: 2, q: "still&view=closer", notes: true },
      { name: "phone-640x360-notes", w: 640, h: 360, dpr: 2, q: "still&view=closer", notes: true },
      { name: "phone-844x390-live-after-taps", w: 844, h: 390, dpr: 2, q: "view=room&fixed", live: true },
      // The same moment with the eye pushed a metre and a half each way: near things must move against far ones.
      { name: "depth-eye-left", w: 844, h: 390, dpr: 2, q: "still&view=closer&eye=-1.5&pass=rock0&at=0.5" },
      { name: "depth-eye-right", w: 844, h: 390, dpr: 2, q: "still&view=closer&eye=1.5&pass=rock0&at=0.5" },
      // The planet close, as it fills a phone: with the round two detail, and with it switched off (round one's surface).
      { name: "planet-detail-on", w: 844, h: 390, dpr: 3, q: "still&view=closer" },
      { name: "planet-detail-off", w: 844, h: 390, dpr: 3, q: "still&view=closer&detail=off" },
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
