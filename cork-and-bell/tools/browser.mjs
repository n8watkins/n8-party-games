// Opens a headless browser for the tools.
//   win: false  Playwright's own Chromium inside WSL (software rendering: fine for logic, wrong for speed)
//   win: true   a headless Chrome on the Windows side, on the real graphics card (D3D11), driven
//               over the debugging protocol. It uses a throwaway profile folder inside this
//               repository (.chrome-gpu-profile), never the owner's Chrome profile or windows.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

export async function openBrowser({ win = false, width = 1920, height = 1080, port = 9347, uncapped = false } = {}) {
  if (!win) {
    const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    return {
      browser,
      newContext: (opts = {}) => browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...opts }),
      close: () => browser.close(),
    };
  }
  const profile = resolve(".chrome-gpu-profile");
  mkdirSync(profile, { recursive: true });
  const winProfile = execFileSync("wslpath", ["-w", profile]).toString().trim();
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + winProfile,
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-gpu",
      "--use-angle=d3d11",
      "--window-size=" + width + "," + height,
      "--force-device-scale-factor=1",
      "--autoplay-policy=no-user-gesture-required",
      ...(uncapped ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let browser = null;
  for (let i = 0; i < 40 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP("http://localhost:" + port).catch(() => null);
  }
  if (!browser) {
    child.kill();
    throw new Error("could not reach the Windows Chrome on port " + port);
  }
  return {
    browser,
    newContext: (opts = {}) => browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...opts }),
    close: async () => {
      await browser.close().catch(() => {});
      child.kill();
    },
  };
}

export const opt = (args, k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
