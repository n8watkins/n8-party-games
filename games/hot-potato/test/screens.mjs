// Stills of Hot Potato's key screens, for looking at, not a test: the start, a listening turn at the
// calm stage, a verdict with its appeal, a long verdict, the last stage listening, who was holding
// it, the end, the word box after a microphone that hears nothing, and (where listening cannot work)
// a typed turn and the pause. Each still is captioned underneath with
// how much of the screen the potato takes, measured from what is drawn: his body's width, and the
// whole rig's box (potato, clamps, antennas, tubes, tray) against the screen. Headless and muted,
// in software (these pictures are for a person), with the browser test's kind of fake recogniser.
//
//   node games/hot-potato/test/screens.mjs --base=http://localhost:8930 [--out=/tmp/claude-hp-game/responsive-stills]
//     [--sizes=390x844,1280x720] [--hash=#plain] [--tag=label]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:8930");
const OUT = arg("out", "/tmp/claude-hp-game/responsive-stills");
const HASH = arg("hash", "");
const TAG = arg("tag", "");
const SIZES = arg("sizes", "320x568,390x844,430x932,768x1024,820x1180,1024x768,1280x720,1440x900,1920x1080,2560x1080,1080x1920,844x390").split(",");
mkdirSync(OUT, { recursive: true });

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
const noSpeech = () => {
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
};

/** How much of the screen he takes: his body's width, and the rig's box (all that is drawn but the burst). */
const share = (page) =>
  page.evaluate(() => {
    const shown = (el) => {
      for (let a = el; a && a.tagName !== "svg"; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (Number(cs.opacity) < 0.01 || cs.display === "none") return false;
      }
      return true;
    };
    const box = (want) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of document.querySelectorAll("#pot [data-part]")) {
        if (el.tagName === "g" || !want(el) || !shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) continue;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      }
      return { w: x1 - x0, h: y1 - y0 };
    };
    const body = box((el) => el.dataset.part === "outline");
    const rig = box((el) => !el.closest('[data-part="boom"]'));
    // (Burst, his body is gone: no share.)
    const pct = (a, b) => (Number.isFinite(a) && a > 0 ? Math.round((a / b) * 100) : "–");
    return { body: pct(body.w, innerWidth), rigW: pct(rig.w, innerWidth), rigH: pct(rig.h, innerHeight) };
  });

async function captioned(page, file, label) {
  const png = await page.screenshot();
  const s = await share(page);
  const meta = await sharp(png).metadata();
  const size = Math.max(16, Math.min(28, Math.round(meta.width / 30)));
  const band = Math.round(size * 2.6);
  const text = `${label}${TAG ? ` (${TAG})` : ""}: body ${s.body}% of width · rig ${s.rigH}% of height, ${s.rigW}% of width`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${band}"><rect width="100%" height="100%" fill="#0d0b1f"/><text x="${size * 0.6}" y="${band * 0.62}" font-family="sans-serif" font-size="${size}" fill="#ffd23f">${text.replace(/&/g, "&amp;")}</text></svg>`;
  await sharp({ create: { width: meta.width, height: meta.height + band, channels: 4, background: "#0d0b1f" } })
    .composite([{ input: png, top: 0, left: 0 }, { input: Buffer.from(svg), top: meta.height, left: 0 }])
    .png()
    .toFile(`${OUT}/${file}`);
  return s;
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const phase = (page, p) => page.waitForFunction((p) => window.__hotPotato.round()?.phase === p, p, { timeout: 20000 });
const ready = (page) => page.waitForSelector("#g-go:not([hidden]):not([disabled])", { timeout: 20000 });
const settled = (page) =>
  page.waitForFunction(() => {
    const g = window.__hotPotato.round();
    const look = window.__hotPotato.art.look();
    return Math.abs(look.growth - Math.min(1, g.stage / 4)) < 0.004 && !look.reaction;
  }, null, { timeout: 10000 });

const shares = {};
for (const name of SIZES) {
  const [width, height] = name.split("x").map(Number);
  // Phones and tablets by touch; laptops, desktops and TVs by mouse.
  const touch = Math.min(width, height) < 600 || (Math.max(width, height) <= 1366 && Math.min(width, height) >= 760 && width !== 1366);
  const open = async (inits) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width > 1600 || height > 1600 ? 1 : 2, hasTouch: touch, isMobile: touch });
    await context.grantPermissions(["microphone"], { origin: BASE });
    const page = await context.newPage();
    for (const init of inits) await page.addInitScript(init);
    await page.goto(`${BASE}/one-device/hot-potato/${HASH}`);
    await page.waitForSelector("#s-cats [data-cat]");
    await page.evaluate(() => document.fonts.ready);
    return { context, page };
  };
  const out = (shares[name] = {});
  const file = (n) => `${name}-${n}${TAG ? `-${TAG}` : ""}.png`;
  const { context, page } = await open([fake]);
  const shot = async (n, label) => (out[label] = await captioned(page, file(n), `${name} ${label}`));
  await shot("01-start", "start");
  await page.click('#s-cats [data-cat="cities"]');
  await page.click("#s-start");
  await phase(page, "ready");
  // A right answer, then a turn listening, words half heard.
  await ready(page);
  await page.evaluate(() => window.__turns.push([[100, "interim", "Los"], [300, "final", "Los Angeles"]]));
  await page.click("#g-go");
  await phase(page, "ready");
  await settled(page);
  await ready(page);
  await page.evaluate(() => window.__turns.push([[300, "interim", "San Fran"], [60000, "final", "x"]]));
  await page.click("#g-go");
  await page.waitForFunction(() => /San/.test(document.getElementById("g-heard").textContent));
  await page.waitForTimeout(900);
  await shot("02-listening-calm", "listening, calm");
  // A refusal with its appeal, while the verdict shows big.
  await page.keyboard.press("Escape");
  await page.click("#p-quit");
  await page.click("#s-start");
  await phase(page, "ready");
  await ready(page);
  await page.evaluate(() => window.__turns.push([[200, "interim", "Sal"], [300, "final", "Salmon"]]));
  await page.click("#g-go");
  await phase(page, "ready");
  await page.waitForTimeout(350);
  await shot("03-verdict-appeal", "verdict and appeal");
  // A long word refused, once its big verdict has gone: the strip keeps its height.
  await ready(page);
  await page.evaluate(() => window.__turns.push([[100, "final", "Onomatopoeiaville Extraordinaire"]]));
  await page.click("#g-go");
  await phase(page, "ready");
  await page.waitForFunction(() => !document.getElementById("game").dataset.react, null, { timeout: 5000 });
  await shot("03b-long-verdict", "a long verdict");
  // Two more misses: the last stage, listening.
  for (let i = 0; i < 2; i++) {
    await ready(page);
    await page.evaluate(() => window.__turns.push([[100, "final", "Table"]]));
    await page.click("#g-go");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 20000 });
  }
  await settled(page);
  await ready(page);
  await page.evaluate(() => window.__turns.push([[300, "interim", "Mad"], [3200, "final", "Zzzz"]]));
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1500);
  await shot("04-listening-last", "listening, last stage");
  await phase(page, "burst");
  await page.waitForTimeout(1100);
  await shot("05-burst", "who was holding it");
  await phase(page, "over");
  await page.waitForTimeout(1200);
  await shot("06-end", "the end");
  await context.close();

  // A microphone that is on but hears nothing: after two silent turns the word box comes up.
  const muted = await open([fake]);
  await muted.page.click("#s-start");
  for (let i = 0; i < 2; i++) {
    await ready(muted.page);
    await muted.page.click("#g-go");
    await muted.page.waitForFunction(() => window.__hotPotato.round().lit);
    await muted.page.evaluate(() => {
      window.__hotPotato.round().fuse = 30;
    });
    await muted.page.waitForFunction(() => window.__hotPotato.round().phase !== "listen");
  }
  await ready(muted.page);
  await muted.page.click("#g-go");
  await muted.page.waitForSelector("#g-typed:not([hidden])");
  await muted.page.waitForFunction(() => !document.getElementById("game").dataset.react, null, { timeout: 5000 });
  out["muted microphone"] = await captioned(muted.page, file("06b-muted-mic"), `${name} the microphone hears nothing`);
  await muted.context.close();

  // Where listening cannot work: a typed turn, and the pause over it.
  const typed = await open([fake, noSpeech]);
  const tshot = async (n, label) => (out[label] = await captioned(typed.page, file(n), `${name} ${label}`));
  await typed.page.click("#s-start");
  await ready(typed.page);
  await typed.page.click("#g-go");
  await typed.page.waitForSelector("#g-typed:not([hidden])");
  await typed.page.fill("#g-word", "Lisbon");
  await tshot("07-typed", "typed (cannot listen)");
  await typed.page.keyboard.press("Escape");
  await typed.page.waitForSelector("#g-paused:not([hidden])");
  await tshot("08-paused", "paused");
  await typed.context.close();
}
await browser.close();
for (const [size, list] of Object.entries(shares)) for (const [label, s] of Object.entries(list)) console.log(`${size}\t${label}\tbody ${s.body}%\trig ${s.rigH}% h\t${s.rigW}% w`);
console.log(`stills in ${OUT}`);
