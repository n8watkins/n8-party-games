// Measures the frame rate on the real GPU: a headless Chrome on the Windows side (D3D11 on the
// machine's graphics card), driven from WSL over the debugging protocol. It uses its own
// throwaway profile folder inside this repository, never the owner's Chrome profile or windows.
//   node cork-and-bell/tools/gpu-fps.mjs [name=query ...] [--size=1920x1080] [--uncapped=1]
// With --uncapped=1 the frame limiter is off, which shows the headroom above 60.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const [w, h] = opt("size", "1920x1080").split("x").map(Number);
const uncapped = opt("uncapped", "0") === "1";
const port = Number(opt("port", 9347));
const base = opt("base", "http://localhost:8791/cork-and-bell/");
const out = opt("out", "cork-and-bell/shots/gpu");
const chrome = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const profile = resolve(".chrome-gpu-profile");
mkdirSync(profile, { recursive: true });
mkdirSync(out, { recursive: true });
const winProfile = execFileSync("wslpath", ["-w", profile]).toString().trim();
const flags = [
  "--headless=new",
  "--remote-debugging-port=" + port,
  "--user-data-dir=" + winProfile,
  "--no-first-run",
  "--no-default-browser-check",
  "--enable-gpu",
  "--use-angle=d3d11",
  "--window-size=" + w + "," + h,
  "--force-device-scale-factor=1",
  ...(uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
  "about:blank",
];
const child = spawn(chrome, flags, { stdio: "ignore" });
let browser = null;
try {
  for (let i = 0; i < 40 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP("http://localhost:" + port).catch(() => null);
  }
  if (!browser) throw new Error("could not reach the Windows Chrome on port " + port);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const specs = args.filter((a) => !a.startsWith("--"));
  for (const spec of specs.length ? specs : ["solo=auto=1&seed=7"]) {
    const [name, ...rest] = spec.split("=");
    const page = await context.newPage();
    await page.setViewportSize({ width: w, height: h });
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
  await browser?.close().catch(() => {});
  child.kill();
}
