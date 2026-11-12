// Measures the frame rate on the real GPU: a headless Chrome on the Windows side (D3D11 on the
// machine's graphics card), driven from WSL over the debugging protocol (see browser.mjs).
//   node cork-and-bell/tools/gpu-fps.mjs [name=query ...] [--size=1920x1080] [--dpr=1] [--uncapped=1]
// With --uncapped=1 the frame limiter is off, which shows the headroom above the display's rate.
import { mkdirSync } from "node:fs";
import { BASE, openBrowser, opt, SHOTS } from "./browser.mjs";

const args = process.argv.slice(2);
const [w, h] = opt(args, "size", "1920x1080").split("x").map(Number);
const base = opt(args, "base", BASE);
const out = opt(args, "out", SHOTS + "/gpu");
mkdirSync(out, { recursive: true });
const b = await openBrowser({ win: true, width: w, height: h, uncapped: opt(args, "uncapped", "0") === "1" });
try {
  const dpr = Number(opt(args, "dpr", 1));
  const context = await b.newContext(w < 600 ? { hasTouch: true, isMobile: true, deviceScaleFactor: dpr } : { deviceScaleFactor: dpr });
  const specs = args.filter((a) => !a.startsWith("--"));
  for (const spec of specs.length ? specs : ["solo=auto=1&seed=7"]) {
    const [name, ...rest] = spec.split("=");
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "?" + rest.join("="));
    await page.waitForFunction(() => window.__cab, null, { timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__cab.fps());
    await page.waitForTimeout(8000);
    const info = await page.evaluate(() => ({ gpu: window.__cab.gpu(), ...window.__cab.fps(), dpr: devicePixelRatio, inner: [innerWidth, innerHeight] }));
    await page.screenshot({ path: out + "/" + name + ".png" });
    console.log(name, JSON.stringify(info), errors.length ? "ERRORS " + errors.join(" | ") : "");
    await page.close();
  }
} finally {
  await b.close();
}
