// Opens a headless browser for the tools.
//   win: false  Playwright's own Chromium inside WSL (software rendering: fine for logic, wrong for speed)
//   win: true   a headless Chrome on the Windows side, on the real graphics card (D3D11), driven
//               over the debugging protocol. It uses a throwaway profile folder in the temp
//               directory, never the owner's Chrome profile or windows. (Not inside this
//               repository: wrangler dev watches it, and every file Chrome wrote there
//               restarted the local server and the rooms with it.)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

export async function openBrowser({ win = false, width = 1920, height = 1080, port = 9300 + Math.floor(Math.random() * 600), uncapped = false } = {}) {
  if (!win) {
    const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    return {
      browser,
      newContext: (opts = {}) => browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...opts }),
      close: () => browser.close(),
    };
  }
  const profile = resolve(process.env.CAB_PROFILE ?? join(tmpdir(), "cork-and-bell-chrome-profile"));
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
      // Ask Chrome itself to quit: killing the WSL side of the process leaves the Windows one running.
      const session = await browser.newBrowserCDPSession().catch(() => null);
      await session?.send("Browser.close").catch(() => {});
      await browser.close().catch(() => {});
      child.kill();
    },
  };
}

/**
 * Where screenshots go unless --out says otherwise. Not inside the repository: wrangler dev
 * watches the folder it serves, and a new file there restarts the local server and every room in it.
 */
export const SHOTS = process.env.CAB_SHOTS ?? join(tmpdir(), "cork-and-bell-shots");

export const opt = (args, k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
