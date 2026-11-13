// What a device downloads for each look, on a first visit with nothing cached: a posed room in
// the 3D look, and the same in the baked look on a phone and on a large screen. It prints the
// bytes over the wire for each, and what the baked look adds to the 3D look's.
//
//   node lobby/test/weigh-baked.mjs [--base=http://localhost:8791]
//
// The local server does not compress; production does (scripts and JSON shrink, pictures do not),
// so the script totals here are an upper bound and the picture totals are the real ones.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
try {
  const weigh = async (name, query, viewport, scale) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const urls = new Map();
    const got = [];
    cdp.on("Network.responseReceived", (e) => urls.set(e.requestId, e.response.url));
    cdp.on("Network.loadingFinished", (e) => got.push({ url: urls.get(e.requestId) ?? "", bytes: e.encodedDataLength }));
    await page.goto(`${base}/lobby/look3d/still.html?gl=any&shot=live&${query}`);
    await page.waitForSelector("html[data-ready]", { timeout: 120000 });
    await page.waitForTimeout(1500);
    const total = got.reduce((n, g) => n + g.bytes, 0);
    const plate = got.filter((g) => g.url.includes("/lobby/baked/")).reduce((n, g) => n + g.bytes, 0);
    const pictures = got.filter((g) => /\.(webp|jpg|png)$/.test(g.url) && g.url.includes("/lobby/baked/")).map((g) => `${g.url.split("/").pop()} ${kb(g.bytes)}`);
    console.log(`${name}: ${kb(total)} in ${got.length} requests${plate ? `, of which the baked look's own files are ${kb(plate)} (${pictures.join(", ")})` : ""}`);
    await context.close();
    return total;
  };
  const three = await weigh("3D look, big screen", "", { width: 1920, height: 1080 }, 1);
  const phone = await weigh("baked look, phone 844 x 390 at 3x", "look=baked&as=player", { width: 844, height: 390 }, 3);
  const big = await weigh("baked look, big screen 1920 x 1080 at 2x", "look=baked", { width: 1920, height: 1080 }, 2);
  console.log(`the baked look costs ${kb(phone - three)} more than the 3D look on a phone, and ${kb(big - three)} more on a large, dense screen`);
} finally {
  await browser.close();
}
