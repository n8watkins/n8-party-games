// Takes screenshots of the game in a headless browser and prints frame rates and console errors.
//   node cork-and-bell/tools/shot.mjs <name>=<query> ... [--size=1920x1080] [--dpr=1] [--wait=ms] [--win=1]
// Each shot loads /cork-and-bell/?<query>, waits, and saves <out>/<name>.png (see SHOTS in browser.mjs)
// --win=1 uses Chrome on the Windows side with the real graphics card (see browser.mjs).
import { mkdirSync } from "node:fs";
import { openBrowser, opt, SHOTS } from "./browser.mjs";

const args = process.argv.slice(2);
const [w, h] = opt(args, "size", "1920x1080").split("x").map(Number);
const wait = Number(opt(args, "wait", 2500));
const base = opt(args, "base", "http://localhost:8791/cork-and-bell/");
const out = opt(args, "out", SHOTS);
mkdirSync(out, { recursive: true });
const b = await openBrowser({ win: opt(args, "win", "1") === "1", width: w, height: h });
try {
  const dpr = Number(opt(args, "dpr", 1));
  const context = await b.newContext(w < 600 ? { hasTouch: true, isMobile: true, deviceScaleFactor: dpr } : { deviceScaleFactor: dpr });
  for (const spec of args.filter((a) => !a.startsWith("--"))) {
    const [name, ...rest] = spec.split("=");
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "?" + rest.join("="));
    await page.waitForFunction(() => window.__cab, null, { timeout: 60000 }).catch(() => errors.push("never booted"));
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => (window.__cab ? { gpu: window.__cab.gpu(), fps: window.__cab.fps() } : null)).catch((e) => String(e));
    await page.screenshot({ path: out + "/" + name + ".png" });
    console.log(name, JSON.stringify(info?.fps ?? info), (info?.gpu ?? "").slice(0, 60), errors.length ? "ERRORS: " + errors.slice(0, 4).join(" | ") : "ok");
    await page.close();
  }
} finally {
  await b.close();
}
