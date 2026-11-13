// End to end, in real pages (headless and muted): the browser's bars and the room.
//
//   node lobby/test/e2e-screen.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/screen]
//
// - The web app manifest and its icons are served with the right types under the site's CSP.
// - A phone whose browser can go full screen (Android Chrome) goes full screen on the tap that
//   takes it into the room, has a full screen choice on the door's sheet (a laptop also in the
//   corner), and is offered one tap back when it drops out by itself, once.
// - An iPhone (no page full screen) gets the "Play without the browser bar" card once, and the
//   door's sheet opens it again.
// - Opened from the home screen (display-mode standalone), none of it shows.
// - At the sizes phones really show with their bars on screen (iPhone Safari and Android Chrome,
//   sideways, small to large), nothing is cut off, nothing scrolls, and every button is at least
//   44 pixels.
// What emulation cannot show is said at the end: a real iPhone's bars, a real Android launcher.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/screen"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const errors = [];
try {
  async function open(name, { width, height, ua = ANDROID, iphone = false, standalone = false }) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ua });
    if (iphone)
      await context.addInitScript(() => {
        // An iPhone has no full screen for a page.
        delete Element.prototype.requestFullscreen;
        Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false });
      });
    if (standalone)
      await context.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => (/display-mode: (standalone|fullscreen)/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
      });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  async function join(page, pin, nickname) {
    // ?full=on: a browser driven by a test is otherwise never put full screen on the way in.
    await page.goto(`${base}/lobby/?join=${pin}&full=on`);
    await page.fill("input[name=nickname]", nickname);
    await page.tap("button[type=submit]");
    await page.waitForSelector(".bar", { timeout: 30000 });
    await page.waitForTimeout(900);
  }

  // ---------------------------------------------------------------- the manifest
  const res = await fetch(base + "/manifest.webmanifest");
  const manifest = await res.json();
  check(res.headers.get("content-type")?.startsWith("application/manifest+json") && /default-src 'self'/.test(res.headers.get("content-security-policy") ?? ""), "the manifest is served as application/manifest+json, under a CSP whose default-src allows it");
  check(manifest.display === "standalone" && manifest.orientation === "landscape" && manifest.icons.some((i) => i.purpose === "maskable"), `standalone, landscape, with a maskable icon: ${manifest.name}`);
  for (const icon of manifest.icons) {
    const r = await fetch(base + icon.src);
    check(r.ok && r.headers.get("content-type") === "image/png", `${icon.src} is served as a PNG`);
  }
  const page = await (await fetch(base + "/lobby/")).text();
  check(/rel="manifest"/.test(page) && /apple-touch-icon/.test(page), "the room's page links the manifest and the home screen icon");

  // A screen holds the party open.
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await host.goto(`${base}/lobby/?start&as=screen`);
  await host.click("button[type=submit]");
  await host.waitForSelector(".bar");
  const pin = await host.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin);

  // ---------------------------------------------------------------- Android: full screen on the tap in
  const android = await open("android", { width: 915, height: 356 });
  await join(android, pin, "Andy");
  check(await android.evaluate(() => !!document.fullscreenElement), "Android: the tap that joins also takes the page full screen");
  await android.tap(".door-btn");
  const sheet = await android.locator(".sheet").innerText();
  check(/Leave full screen/.test(sheet) && (await android.locator(".corner .full-btn").isHidden()), "on a phone the door's sheet has the full screen choice, and the corner stays clear for the wall");
  await android.screenshot({ path: `${out}/00-android-door-sheet.png` });
  await android.tap(".sheet .plain");
  await android.evaluate(() => document.exitFullscreen());
  await android.waitForTimeout(400);
  check((await android.locator(".full-back").count()) === 1, "when the browser drops out of full screen, one tap back is offered");
  await android.screenshot({ path: `${out}/01-android-back-to-full-screen.png` });
  await android.tap(".full-back");
  await android.waitForTimeout(400);
  check(await android.evaluate(() => !!document.fullscreenElement), "and it works");
  await android.tap(".door-btn");
  await android.tap(".full-choice");
  await android.waitForTimeout(400);
  check(!(await android.evaluate(() => !!document.fullscreenElement)) && (await android.locator(".full-back").count()) === 0, "leaving full screen on purpose is not followed by an offer to go back");
  await android.close();

  // ---------------------------------------------------------------- iPhone: the home screen card, once
  const iphone = await open("iphone", { width: 852, height: 342, ua: IPHONE, iphone: true });
  await join(iphone, pin, "Ivy");
  const tip = await iphone.locator(".home-tip").innerText().catch(() => "");
  check(/Play without the browser bar/.test(tip) && /Add to Home Screen/.test(tip), "iPhone: a card says how to play without the browser bar");
  await iphone.screenshot({ path: `${out}/02-iphone-home-screen-card.png` });
  await iphone.tap("text=Got it");
  check(!(await iphone.evaluate(() => !!document.fullscreenElement)), "and nothing tried to go full screen");
  await iphone.reload();
  await iphone.waitForSelector(".bar");
  await iphone.waitForTimeout(800);
  check((await iphone.locator(".home-tip").count()) === 0, "the card shows by itself only once");
  await iphone.tap(".door-btn");
  await iphone.tap(".full-choice");
  check((await iphone.locator(".home-tip").count()) === 1, "the door's sheet opens it again");
  await iphone.close();

  // ---------------------------------------------------------------- from the home screen
  const home = await open("home screen", { width: 932, height: 430, standalone: true });
  await join(home, pin, "Hal");
  await home.tap(".door-btn");
  check((await home.locator(".full-btn, .full-choice, .home-tip").count()) === 0 && !(await home.evaluate(() => !!document.fullscreenElement)), "opened from the home screen: no button, no card, nothing to do");
  await home.screenshot({ path: `${out}/03-home-screen-app.png` });
  await home.close();

  // ---------------------------------------------------------------- the visible viewport with the bars on screen
  const sizes = [
    ["iphone-se-safari", 667, 320, IPHONE, true],
    ["iphone-15-safari", 852, 342, IPHONE, true],
    ["iphone-pro-max-safari", 932, 380, IPHONE, true],
    ["android-small-chrome", 740, 304, ANDROID, false],
    ["pixel-7-chrome", 915, 356, ANDROID, false],
  ];
  for (const [name, width, height, ua, iphoneLike] of sizes) {
    const p = await open(name, { width, height, ua, iphone: iphoneLike });
    await join(p, pin, name.slice(0, 6));
    if (iphoneLike) await p.locator("text=Got it").tap().catch(() => {});
    const found = await p.evaluate(() => {
      const bad = [];
      const [W, H] = [innerWidth, innerHeight];
      const doc = document.documentElement;
      if (doc.scrollHeight > H + 1 || doc.scrollWidth > W + 1) bad.push(`the page scrolls (${doc.scrollWidth}x${doc.scrollHeight})`);
      for (const el of document.querySelectorAll(".bar, .bar button, .corner, .corner button")) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.top < -1 || r.bottom > H + 1 || r.left < -1 || r.right > W + 1)) bad.push(`${el.className} is cut off`);
      }
      for (const el of document.querySelectorAll(".bar button, .corner button")) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.width < 43.5 || r.height < 43.5)) bad.push(`${el.className.split(" ").join(".")} is ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      const app = document.getElementById("app").getBoundingClientRect();
      if (Math.abs(app.height - H) > 1) bad.push(`the room is ${app.height} tall in ${H}`);
      return bad;
    });
    check(found.length === 0, `${name} (${width} x ${height} visible): nothing cut off, nothing scrolls, every button 44 pixels` + (found.length ? ": " + [...new Set(found)].join("; ") : ""));
    await p.screenshot({ path: `${out}/10-${name}.png` });
    await p.click(".door-btn");
    await p.click(".sheet .choice");
    await p.waitForURL(base + "/", { timeout: 8000 });
    await p.context().close();
  }
} finally {
  await browser.close();
}
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 5).join("; ") : ""));
console.log("\nNot shown by emulation: a real iPhone's bars (whether Safari overlays the page), a real Add to Home Screen, and orientation lock on a real Android phone.");
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
