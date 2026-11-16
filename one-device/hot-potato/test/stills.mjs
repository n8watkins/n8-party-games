// Stills of Hot Potato's screens for looking at, not a test: every stage of the potato, listening,
// a right answer, a wrong one, the last miss, the burst and the end, at an upright phone, a small
// phone, a sideways phone and a desktop window, plus a contact sheet of every face the Specimen
// has. Headless and muted, with the browser test's kind of fake recogniser.
//
//   node one-device/hot-potato/test/stills.mjs --base=http://localhost:8930 [--out=/tmp/claude-hp-game/specimen-stills] [--hash=#plain]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:8930");
const OUT = arg("out", "/tmp/claude-hp-game/specimen-stills");
const HASH = arg("hash", "");
const ONLY = arg("sizes", "");
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
            const alts = [{ transcript: data, confidence: 0.9 }];
            alts.isFinal = true;
            this.fire("result", { resultIndex: 0, results: [alts] });
            setTimeout(() => this.fire("end"), 10);
          } else if (kind === "error") {
            this.fire("error", { error: data });
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
const SIZES = [
  ["390x844", { width: 390, height: 844 }],
  ["320x568", { width: 320, height: 568 }],
  ["844x390", { width: 844, height: 390 }],
  ["1280x720", { width: 1280, height: 720 }],
].filter(([n]) => !ONLY || ONLY.split(",").includes(n));

const phase = (page, p) => page.waitForFunction((p) => window.__hotPotato.round()?.phase === p, p, { timeout: 20000 });
const ready = (page) => page.waitForSelector("#g-go:not([hidden]):not([disabled])", { timeout: 20000 });
const settled = (page) =>
  page.waitForFunction(() => {
    const g = window.__hotPotato.round();
    const look = window.__hotPotato.art.look();
    return Math.abs(look.growth - Math.min(1, g.stage / 4)) < 0.004 && !look.reaction;
  }, null, { timeout: 10000 });

async function turn(page, said, { wait = 0 } = {}) {
  await ready(page);
  await page.evaluate((s) => window.__turns.push(s), said === null ? [[60000, "error", "no-speech"]] : [[200, "interim", said.slice(0, 3)], [300, "final", said]]);
  await page.click("#g-go");
  if (said === null) {
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 20000 });
  } else await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 20000 });
  if (wait) await page.waitForTimeout(wait);
}

for (const [name, viewport] of SIZES) {
  const phone = viewport.width < 600 || viewport.height < 500;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone });
  await context.grantPermissions(["microphone"], { origin: BASE });
  const page = await context.newPage();
  await page.addInitScript(fake);
  await page.goto(`${BASE}/one-device/hot-potato/${HASH}`);
  await page.waitForSelector("#s-cats [data-cat]");
  await page.evaluate(() => document.fonts.ready);
  const shot = (what) => page.screenshot({ path: `${OUT}/${name}-${what}.png` });
  await shot("00-start");
  await page.click('#s-cats [data-cat="cities"]');
  while ((await page.textContent("#s-n")) !== "3") await page.click(Number(await page.textContent("#s-n")) < 3 ? "#s-plus" : "#s-minus");
  await page.click("#s-start");
  await phase(page, "ready");
  await page.waitForTimeout(400);
  await shot("01-calm-ready");
  // Listening: the fuse burning, eyes following it.
  await page.evaluate(() => window.__turns.push([[300, "interim", "Los"], [2600, "final", "Los Angeles"]]));
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1800);
  await shot("02-calm-listening");
  await page.waitForFunction(() => window.__hotPotato.round().phase === "ready", null, { timeout: 10000 });
  await page.waitForTimeout(250);
  await shot("03-right");
  await settled(page);
  await page.waitForTimeout(300);
  await shot("04-calm-after-right");
  // Wrong answers to each stage.
  // Misses to each stage: a wrong word, silence (with a still while it listens), a wrong word,
  // silence (and the pause), then the last miss.
  const misses = ["Salmon", null, "Paris", null];
  for (let i = 0; i < 4; i++) {
    if (misses[i] === null) {
      await ready(page);
      await page.evaluate(() => window.__turns.push([[60000, "error", "no-speech"]]));
      await page.click("#g-go");
      await page.waitForFunction(() => window.__hotPotato.round().lit);
      await page.waitForTimeout(2200);
      await shot(`1${i}-stage-${i}-listening`);
      if (i === 3) {
        await page.keyboard.press("Escape");
        await page.waitForSelector("#g-paused:not([hidden])");
        await shot("20-paused");
        await page.evaluate(() => window.__turns.push([[60000, "error", "no-speech"]]));
        await page.click("#p-resume");
      }
      await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 20000 });
    } else await turn(page, misses[i]);
    await page.waitForTimeout(250);
    if (i === 0) await shot("05-worse-wrong");
    if (i === 1) await shot("07-worse-silence");
    await settled(page);
    await page.waitForTimeout(500);
    await shot(`1${i + 1}-stage-${i + 1}-ready`);
  }
  await ready(page);
  await page.evaluate(() => window.__turns.push([[2600, "final", "Zzzz"]]));
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1500);
  await shot("14-stage-4-listening");
  await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await shot("21-doom");
  await phase(page, "burst");
  await page.waitForTimeout(350);
  await shot("22-burst");
  await page.waitForTimeout(800);
  await shot("22b-burst-who");
  await phase(page, "over");
  await page.waitForTimeout(1200);
  await shot("23-end");
  await context.close();
}

// The contact sheet: every face, each at the stage it belongs to.
{
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/one-device/hot-potato/`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const { createSpecimen } = await import("./art-specimen.js");
    const { FACES, LISTENING, REACTIONS } = await import("./specimen-draw.js");
    const HEAT = { calm: 0, warm: 1, hot: 2, strain: 3, critical: 4 };
    const rows = [...Object.entries(FACES).map(([k, list]) => [k, list.map((f) => [f.id, HEAT[k]])]), ["listening", [[LISTENING.id, 0]]], ["reactions", Object.entries(REACTIONS).filter(([k]) => k !== "doom").flatMap(([k, list]) => list.map((f) => [`${f.id}`, k === "right" || k === "appeal" ? 1 : 2, k]))]];
    const BG = ["#2c2768", "#2a3f7a", "#1d6670", "#5b4a7a", "#9a1f5e"];
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#14112e;color:#fff;font:14px Anton, sans-serif;overflow:auto;height:auto";
    document.documentElement.style.cssText = "overflow:auto;height:auto";
    const sheet = document.createElement("div");
    sheet.id = "sheet";
    sheet.style.cssText = "display:grid;gap:10px;padding:14px;width:1200px";
    for (const [label, faces] of rows) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;align-items:stretch";
      const h = document.createElement("div");
      h.textContent = label.toUpperCase();
      h.style.cssText = "width:120px;display:grid;place-items:center;font-size:20px;letter-spacing:.08em;color:#ffd23f";
      row.appendChild(h);
      const cells = document.createElement("div");
      cells.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;flex:1";
      row.appendChild(cells);
      for (const [id, stage, kind] of faces) {
        const cell = document.createElement("div");
        cell.style.cssText = `width:200px;background:${BG[stage]};display:grid;grid-template-rows:190px auto;justify-items:center;padding-bottom:8px;overflow:hidden`;
        // Cropped to the potato: the rig's edges are the same in every face.
        const frame = document.createElement("div");
        frame.style.cssText = "position:relative;width:200px;height:190px;overflow:hidden";
        const host = document.createElement("div");
        host.style.cssText = stage >= 3 ? "position:absolute;width:290px;height:290px;left:-45px;top:-62px" : "position:absolute;width:340px;height:340px;left:-70px;top:-92px";
        frame.appendChild(host);
        cell.appendChild(frame);
        const cap = document.createElement("div");
        cap.textContent = kind ? `${id} (${kind})` : id;
        cap.style.cssText = "letter-spacing:.06em;text-transform:uppercase";
        cell.appendChild(cap);
        cells.appendChild(cell);
        const art = createSpecimen(host, { seed: 7, reducedMotion: () => true });
        art.hold(id, stage);
      }
      sheet.appendChild(row);
    }
    document.body.appendChild(sheet);
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  });
  await page.locator("#sheet").screenshot({ path: `${OUT}/faces-contact-sheet.png` });
  await context.close();
}

await browser.close();
console.log(`stills in ${OUT}`);
