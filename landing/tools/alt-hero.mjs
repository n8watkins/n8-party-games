// Stills of one alternative for the hero: the close-up of the robot's hook in place of the whole
// room. Nothing is built for it; this swaps the picture in a headless browser and saves two stills
// in landing/shots/ so the two heroes can be compared side by side.
//
//   node landing/tools/alt-hero.mjs [base-url]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "shots");
mkdirSync(out, { recursive: true });
const base = process.argv[2] ?? "http://localhost:8791/preview/landing/";
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  for (const size of [{ name: "desktop", width: 1440, height: 900, scale: 1 }, { name: "phone", width: 390, height: 844, scale: 3 }]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, isMobile: size.name === "phone", hasTouch: size.name === "phone", reducedMotion: "reduce", bypassCSP: true });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: `
      .glow { display: none; }
      .stage-view { left: 0 !important; width: 100% !important; height: 100% !important; aspect-ratio: auto !important; }
      .stage-view > img { object-position: 22% 100%; }
      .stage-caption { display: none; }` });
    await page.evaluate(async () => {
      const img = document.querySelector(".stage-view img");
      img.removeAttribute("srcset");
      img.src = "img/scene-hook-1600.webp";
      await img.decode();
    });
    await page.screenshot({ path: join(out, `alt-hero-close-up-${size.name}.png`) });
    await context.close();
  }
} finally {
  await browser.close();
}
