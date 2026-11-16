// Stills of Hot Potato's key screens at every size the layout is designed for, for looking at, not
// a test: the start, a turn ready, listening, a verdict with its appeal, a typed turn, the pause,
// the last stage listening, the last miss, who was holding it, and the end. Headless and muted
// (in software: these pictures are for a person), with the browser test's kind of fake recogniser.
//
//   node one-device/hot-potato/test/screens.mjs --base=http://localhost:8930 [--out=/tmp/claude-hp-game/responsive-stills] [--sizes=390x844,1280x720]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:8930");
const OUT = arg("out", "/tmp/claude-hp-game/responsive-stills");
const ONLY = arg("sizes", "");
mkdirSync(OUT, { recursive: true });

/** The sizes the layout is designed for (see "The layout" in the README). */
const SIZES = [
  "320x568", "360x640", "390x844", "430x932",
  "568x320", "667x375", "844x390", "932x430",
  "768x1024", "1024x768", "820x1180",
  "1280x720", "1366x768", "1440x900", "1920x1080",
  "2560x1080", "1080x1920",
];

const fake = () => {
  window.__turns = [];
  class FakeRecognition extends EventTarget {
    fire(type, props = {}) {
      const e = new Event(type);
      Object.assign(e, props);
      this.dispatchEvent(e);
    }
    start() {
      this.timers = [];
      const at = (ms, fn) => this.timers.push(setTimeout(fn, ms));
      const steps = window.__turns.shift() ?? [[60000, "error", "no-speech"]];
      at(5, () => this.fire("start"));
      let t = 20;
      for (const [delay, kind, data] of steps) {
        t += delay;
        at(t, () => {
          if (kind === "interim") {
            const alt = [{ transcript: data, confidence: 0 }];
            alt.isFinal = false;
            this.fire("result", { resultIndex: 0, results: [alt] });
          } else if (kind === "final") {
            const alts = [{ transcript: data, confidence: 0.4 }];
            alts.isFinal = true;
            this.fire("result", { resultIndex: 0, results: [alts] });
            setTimeout(() => this.fire("end"), 10);
          }
        });
      }
    }
    stop() {}
    abort() {
      this.timers?.forEach(clearTimeout);
      setTimeout(() => this.fire("end"), 10);
    }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const phase = (page, p) => page.waitForFunction((p) => window.__hotPotato.round()?.phase === p, p, { timeout: 20000 });
const ready = (page) => page.waitForSelector("#g-go:not([hidden]):not([disabled])", { timeout: 20000 });
const settled = (page) =>
  page.waitForFunction(() => {
    const g = window.__hotPotato.round();
    const look = window.__hotPotato.art.look();
    return Math.abs(look.growth - Math.min(1, g.stage / 4)) < 0.004 && !look.reaction;
  }, null, { timeout: 10000 });

for (const name of SIZES.filter((n) => !ONLY || ONLY.split(",").includes(n))) {
  const [width, height] = name.split("x").map(Number);
  const phone = Math.min(width, height) < 600;
  const touch = phone || (Math.min(width, height) >= 600 && Math.max(width, height) <= 1366 && width < 1280);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width > 1600 ? 1 : 2, hasTouch: touch, isMobile: touch });
  await context.grantPermissions(["microphone"], { origin: BASE });
  const page = await context.newPage();
  await page.addInitScript(fake);
  await page.goto(`${BASE}/one-device/hot-potato/`);
  await page.waitForSelector("#s-cats [data-cat]");
  await page.evaluate(() => document.fonts.ready);
  const shot = (what) => page.screenshot({ path: `${OUT}/${name}-${what}.png` });
  await shot("01-start");
  await page.click('#s-cats [data-cat="cities"]');
  await page.click("#s-start");
  await phase(page, "ready");
  await page.waitForTimeout(300);
  await shot("02-ready");
  await page.evaluate(() => window.__turns.push([[300, "interim", "Los Ang"], [3000, "final", "Los Angeles"]]));
  await page.click("#g-go");
  await page.waitForFunction(() => /Los/.test(document.getElementById("g-heard").textContent));
  await page.waitForTimeout(600);
  await shot("03-listening");
  await phase(page, "ready");
  // A refusal with its appeal, while the verdict shows big and once it has settled.
  await ready(page);
  await page.evaluate(() => window.__turns.push([[200, "interim", "Sal"], [300, "final", "Salmon"]]));
  await page.click("#g-go");
  await phase(page, "ready");
  await page.waitForTimeout(300);
  await shot("04-verdict-appeal");
  await settled(page);
  await shot("05-after-verdict");
  // A typed turn ("Type it instead").
  await ready(page);
  await page.click("#g-go");
  await page.waitForSelector("#g-type:not([hidden])");
  await page.click("#g-type");
  await page.fill("#g-word", "Lisbon");
  await shot("06-typed");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-paused:not([hidden])");
  await shot("07-paused");
  await page.click("#p-quit");
  // The last stage: a new round, four misses, then listening.
  await page.click("#s-start");
  await phase(page, "ready");
  for (let i = 0; i < 4; i++) {
    await ready(page);
    await page.evaluate(() => window.__turns.push([[100, "final", "Table"]]));
    await page.click("#g-go");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 20000 });
  }
  await settled(page);
  await ready(page);
  await page.evaluate(() => window.__turns.push([[300, "interim", "Mad"], [2400, "final", "Zzzz"]]));
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1200);
  await shot("08-last-stage");
  await phase(page, "doom");
  await page.waitForTimeout(300);
  await shot("09-doom");
  await phase(page, "burst");
  await page.waitForTimeout(1100);
  await shot("10-burst-who");
  await phase(page, "over");
  await page.waitForTimeout(1200);
  await shot("11-end");
  await context.close();
}
await browser.close();
console.log(`stills in ${OUT}`);
