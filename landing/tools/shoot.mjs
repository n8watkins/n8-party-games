// Takes stills of the landing page on a desktop, an upright phone and a phone held sideways,
// in a headless, muted browser, and checks a few things a still cannot show:
// nothing wider than the window, no request to another host, no console errors.
//
//   npm run dev            (or PORT=... npm run dev:lan)
//   node landing/tools/shoot.mjs [base-url] [name-filter]
//
// Stills land in landing/shots/. The default address is http://localhost:8791/preview/landing/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "shots");
mkdirSync(out, { recursive: true });
const base = process.argv[2] ?? "http://localhost:8791/preview/landing/";
const filter = process.argv[3];

const SIZES = [
  { name: "desktop", width: 1440, height: 900, scale: 1 },
  { name: "desktop-wide", width: 1920, height: 1080, scale: 1 },
  { name: "laptop", width: 1280, height: 720, scale: 1 },
  { name: "tablet", width: 820, height: 1180, scale: 1, touch: true },
  { name: "phone", width: 390, height: 844, scale: 3, touch: true },
  { name: "phone-small", width: 360, height: 640, scale: 3, touch: true },
  { name: "sideways", width: 844, height: 390, scale: 3, touch: true },
  { name: "sideways-small", width: 667, height: 375, scale: 2, touch: true },
].filter((s) => !filter || s.name.includes(filter));

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
let failed = false;
try {
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, hasTouch: !!size.touch, isMobile: !!size.touch, reducedMotion: "reduce" });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`error: ${e.message}`));
    page.on("request", (r) => { if (!r.url().startsWith(new URL(base).origin) && !r.url().startsWith("data:")) problems.push(`outside request: ${r.url()}`); });
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `${size.name}-1-first-screen.png`) });
    // Bring every lazy picture in before the long still.
    await page.evaluate(async () => {
      for (const img of document.images) { img.loading = "eager"; }
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    });
    await page.screenshot({ path: join(out, `${size.name}-2-whole-page.png`), fullPage: true });
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const over = [...document.querySelectorAll("body *")].filter((el) => !el.closest(".stage, .room-tabs, pre") && el.getBoundingClientRect().right > w + 1 && getComputedStyle(el).position !== "fixed");
      return { scroll: document.documentElement.scrollWidth - w, over: over.slice(0, 5).map((el) => `${el.tagName}.${el.className}`) };
    });
    if (wide.scroll > 0 || wide.over.length) problems.push(`wider than the window by ${wide.scroll}px: ${wide.over.join(", ")}`);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.currentSrc || i.src));
    for (const b of broken) problems.push(`picture did not load: ${b}`);
    console.log(`${size.name}: ${problems.length ? "\n  " + problems.join("\n  ") : "ok"}`);
    if (problems.length) failed = true;
    await context.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
