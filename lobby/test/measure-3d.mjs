// Measures the 3D look's frame time on a real graphics card, against a running local server.
//
//   node lobby/test/measure-3d.mjs [--base=http://localhost:8791] [--rooms=bar,roof] [--soft=1]
//
// WSL has no graphics card, so by default this drives a headless Chrome on the Windows side
// (Cork & Bell's tools/browser.mjs: no window, a throwaway profile, closed at the end). With
// --soft=1 it uses the software renderer inside WSL instead, which says nothing about speed
// and is only there to show the script runs.
//
// Each room is measured on a posed room whose four pieces pace and jump all the time
// (still.html?walk=1), the busiest the room gets, at three sizes: a big screen, a laptop and a
// phone held sideways at twice the pixel density. The frame limiter is off, so the numbers
// are the time one frame takes, not the display's 60 a second.
//
// This is a desktop graphics card pretending to be a phone's screen size. It is not a phone.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "../../node_modules/cork-and-bell/tools/browser.mjs";

// Its own Chrome profile on the Windows side, so it never meets another tool's browser.
process.env.CAB_PROFILE ??= join(tmpdir(), "party-room-3d-chrome-profile");
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const rooms = opt("rooms", "bar,ship,arcade,camp,roof,navy,fair").split(",");
const soft = opt("soft", "0") === "1";

const SIZES = [
  { name: "big screen 1920x1080", viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, query: "" },
  { name: "laptop 1366x768", viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, query: "as=player" },
  { name: "phone 844x390 @2x", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, query: "as=player&zoom=closer" },
];

const b = await openBrowser({ win: !soft, uncapped: true });
try {
  for (const size of SIZES) {
    const context = await b.newContext({ viewport: size.viewport, deviceScaleFactor: size.deviceScaleFactor, hasTouch: !!size.hasTouch, isMobile: !!size.isMobile });
    for (const room of rooms) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/lobby/look3d/still.html?walk=1&room=${room}&${size.query}${soft ? "&gl=any" : ""}`);
      const ready = await page.waitForSelector("html[data-ready]", { timeout: 60000, state: "attached" }).catch(() => null);
      if (!ready) {
        console.log(`${size.name}  ${room}: did not start (${errors.join(" | ") || "no hardware WebGL?"})`);
        await page.close();
        continue;
      }
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.__still.reset());
      await page.waitForTimeout(6000);
      const r = await page.evaluate(() => window.__still.report());
      console.log(
        `${size.name}  ${room}: median ${r.median.toFixed(2)} ms, 95th ${r.p95.toFixed(2)} ms, worst ${r.worst.toFixed(1)} ms over ${r.frames} frames; ` +
          `${r.calls} draw calls, ${r.triangles} triangles, ${r.size.join("x")} pixels (ratio ${r.ratio.toFixed(2)}), script ${r.cpuMsPerFrame.toFixed(2)} ms a frame; ${r.gpu}` +
          (errors.length ? " ERRORS " + errors.join(" | ") : ""),
      );
      await page.close();
    }
    await context.close();
  }
} finally {
  await b.close();
}
