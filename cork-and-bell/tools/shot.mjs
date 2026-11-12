// Takes screenshots of the game in headless Chromium and prints frame rates and console errors.
//   node cork-and-bell/tools/shot.mjs <name>=<query> ... [--size=1920x1080] [--wait=ms] [--gl=swiftshader|egl]
// Each shot loads /cork-and-bell/?<query>, waits, and saves cork-and-bell/shots/<name>.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const [w, h] = opt("size", "1920x1080").split("x").map(Number);
const wait = Number(opt("wait", 2500));
const gl = opt("gl", "egl");
const base = opt("base", "http://localhost:8791/cork-and-bell/");
const out = opt("out", "cork-and-bell/shots");
mkdirSync(out, { recursive: true });
const flags = gl === "egl" ? ["--use-angle=gl-egl", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ headless: true, args: flags });
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
for (const spec of args.filter((a) => !a.startsWith("--"))) {
  const [name, ...rest] = spec.split("=");
  const query = rest.join("=");
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "?" + query);
  await page.waitForFunction(() => window.__cab, null, { timeout: 60000 }).catch(() => errors.push("never booted"));
  await page.waitForTimeout(wait);
  const info = await page.evaluate(() => (window.__cab ? { gpu: window.__cab.gpu(), fps: window.__cab.fps(), sum: window.__cab.summary() } : null)).catch((e) => String(e));
  await page.screenshot({ path: out + "/" + name + ".png" });
  console.log(name, JSON.stringify(info?.fps ?? info), info?.gpu ?? "", errors.length ? "ERRORS: " + errors.slice(0, 4).join(" | ") : "ok");
  await page.close();
}
await browser.close();
