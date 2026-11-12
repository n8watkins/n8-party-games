// Takes the preview screenshots into landing/preview/shots/.
// Run from the repository root after `npm install`: node landing/preview/shoot.mjs [mockup-name]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "shots");
mkdirSync(out, { recursive: true });

const only = process.argv[2];
const mockups = ["lights-on", "cupboard"].filter((m) => !only || m === only);
const sizes = [
  { tag: "390x844", width: 390, height: 844, scale: 2 },
  { tag: "1440x900", width: 1440, height: 900, scale: 1 },
];
// The first two are the views asked for; the rest are the states and the whole page.
const views = [
  { tag: "", query: "", fullPage: false },
  { tag: "-full-page", query: "", fullPage: true },
  { tag: "-rooms-full", query: "&state=full", fullPage: false },
  { tag: "-rooms-full-shelf", query: "&state=full", fullPage: false, scrollTo: ".shelf, .shelves" },
  { tag: "-big-screen", query: "&state=screen", fullPage: false },
  { tag: "-big-screen-whole", query: "&state=screen", fullPage: false, wholeSheet: true },
  { tag: "-filter-big-screen", query: "&have=screen", fullPage: true },
];

const browser = await chromium.launch();
for (const name of mockups) {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
    });
    const page = await context.newPage();
    for (const view of views) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${pathToFileURL(join(here, `${name}.html`))}?strip=0${view.query}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle");
      if (view.scrollTo) await page.locator(view.scrollTo).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
      if (view.wholeSheet) {
        // Grow the window so the whole sheet shows in one picture.
        const h = await page.locator(".sheet").evaluate((el) => Math.ceil(el.getBoundingClientRect().height) + 40);
        if (h <= size.height) continue;
        await page.setViewportSize({ width: size.width, height: h });
      }
      await page.screenshot({ path: join(out, `${name}-${size.tag}${view.tag}.png`), fullPage: view.fullPage });
    }
    await context.close();
  }
}
await browser.close();
console.log(`Saved to ${out}`);
