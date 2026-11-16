// Measures what each rung of a room made real (the Star Lounge, or the bar with --room=bar) costs
// to draw, beside today's 3D look of that room, against a running local server (npm run dev, or
// any port with --base).
//
//   node lobby/test/measure-real.mjs [--room=ship|bar] [--base=http://localhost:8857] [--soft=1] [--only=<size>]
//
// Each is a posed room (look3d/still.html?walk=1: four pieces pacing and jumping, the busiest the
// room gets) held on one rung (?rung=, with the ladder off so it stays there), at a phone's size
// sideways at twice the density (closer and whole room) and a big screen. The frame limiter is
// off, so the numbers are what a frame takes, not the display's 60 a second.
//
// By default it drives a headless Chrome on the Windows side, on the PC's graphics card (Cork &
// Bell's tools/browser.mjs: no window, a throwaway profile, closed at the end). That is a desktop
// graphics card drawing a phone's number of pixels: it is not a phone. --soft=1 uses the
// software renderer inside WSL, which says nothing about a phone either.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "../../node_modules/cork-and-bell/tools/browser.mjs";

process.env.CAB_PROFILE ??= join(tmpdir(), "party-room-real-chrome-profile");
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8857");
const soft = opt("soft", "0") === "1";
const only = opt("only", "");
// --room=ship (the Star Lounge, the default) or --room=bar.
const room = opt("room", "ship");

const SIZES = [
  { name: "phone 844x390 @2x closer", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, query: "as=player&zoom=closer" },
  { name: "phone 844x390 @2x whole room", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, query: "as=player&zoom=room" },
  // An upright phone: the view follows its piece (closer), so the bar's eye moves and the street slides behind the glass.
  { name: "phone 390x844 @2x upright", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, query: "as=player&zoom=closer" },
  { name: "big screen 1280x720", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, query: "" },
  // Far more pixels than any device has, so that the graphics card sets the pace and not the script: the only way a
  // desktop card says anything about what each pixel costs. The room caps its own pixels (MAX_PIXELS), so this is
  // its biggest picture, about 2560 x 1440. Read the frame times against each other, not as a phone's.
  { name: "stress 3840x2160 @2x, whole room", viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 2, query: "as=player&zoom=room" },
].filter((s) => !only || s.name.includes(only));
const STEPS = { ship: ["no weather", "+ half planet", "+ outside at half resolution"], bar: ["no drops on the glass", "+ half the rain", "+ outside at half resolution"] }[room];
const RUNGS = [
  { name: `3d ${room} (today)`, query: `room=${room}` },
  { name: `real ${room}`, query: `look=real&room=${room}&rung=0&ladder=off` },
  ...STEPS.map((what, i) => ({ name: `real lite ${i + 1} (${what})`, query: `look=real&room=${room}&rung=${i + 1}&ladder=off` })),
];

const b = await openBrowser({ win: !soft, uncapped: true });
try {
  for (const size of SIZES) {
    const context = await b.newContext({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, hasTouch: !!size.hasTouch, isMobile: !!size.isMobile });
    for (const rung of RUNGS) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/lobby/look3d/still.html?walk=1&shot=live&${rung.query}&${size.query}${soft ? "&gl=any" : ""}`);
      const ready = await page.waitForSelector("html[data-ready]", { timeout: 90000, state: "attached" }).catch(() => null);
      if (!ready) {
        console.log(`${size.name}  ${rung.name}: did not start (${errors.join(" | ") || "no hardware WebGL?"})`);
        await page.close();
        continue;
      }
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.__still.reset());
      const drawn0 = await page.evaluate(() => window.__room3d.drawing);
      await page.waitForTimeout(6000);
      const drawn1 = await page.evaluate(() => window.__room3d.drawing);
      const r = await page.evaluate(() => window.__still.report());
      const drew = drawn1.frames - drawn0.frames;
      const cpu = drew ? (drawn1.cpu - drawn0.cpu) / drew : 0;
      console.log(
        `${size.name}  ${rung.name}${r.rung ? " [" + r.rung + "]" : ""}: frame median ${r.median.toFixed(2)} ms, 95th ${r.p95.toFixed(2)} ms, worst ${r.worst.toFixed(1)} ms over ${r.frames} frames; ` +
          `drawing ${cpu.toFixed(2)} ms a picture (${drew} pictures in 6 s); ${r.calls} draw calls, ${r.triangles} triangles, ${r.size.join("x")} pixels (ratio ${r.ratio.toFixed(2)}); ${r.gpu}` +
          (errors.length ? " ERRORS " + errors.join(" | ") : ""),
      );
      await page.close();
    }
    await context.close();
  }
} finally {
  await b.close();
}
