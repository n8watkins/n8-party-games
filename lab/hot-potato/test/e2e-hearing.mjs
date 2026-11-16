// End-to-end check of the Hot Potato hearing test in a headless, muted Chromium, with speech
// recognition replaced by a scripted fake (headless Chromium cannot really hear). It proves the
// page's timings, matcher, verdicts, log and copied report work; it says nothing about how well
// a real phone hears.
//
//   node lab/hot-potato/test/e2e-hearing.mjs --base=http://localhost:8875 [--shots=/tmp/claude-hot-potato/shots]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:8875");
const SHOTS = arg("shots", "/tmp/claude-hot-potato/shots");
const URL = `${BASE}/lab/hot-potato/`;
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

/**
 * The fake recogniser. Each start() takes the next scripted turn from window.__turns: a list of
 * steps, each [delay ms, kind, data], kind being "interim" (text), "final" ([[text, confidence]]),
 * "error" (code) or "silence". It fires the same events, in the same order, as Chrome does.
 */
const fake = () => {
  window.__turns = [];
  window.__starts = 0;
  class FakeRecognition extends EventTarget {
    constructor() {
      super();
      this.lang = "en-US";
      this.interimResults = false;
      this.continuous = false;
      this.maxAlternatives = 1;
      this.processLocally = false;
      this.timers = [];
      this.ended = false;
    }
    fire(type, props = {}) {
      const e = new Event(type);
      Object.assign(e, props);
      this.dispatchEvent(e);
    }
    start() {
      window.__starts++;
      const steps = window.__turns.shift() ?? [[300, "error", "no-speech"]];
      const at = (ms, fn) => this.timers.push(setTimeout(fn, ms));
      at(5, () => this.fire("start"));
      at(20, () => this.fire("audiostart"));
      at(60, () => this.fire("speechstart"));
      let t = 60;
      let hadFinal = false;
      for (const [delay, kind, data] of steps) {
        // The speaker stops talking a little before the final result arrives.
        if (kind === "final") at(t + delay - 120, () => !this.ended && this.fire("speechend"));
        t += delay;
        at(t, () => {
          if (this.ended) return;
          if (kind === "interim") {
            const alt = [{ transcript: data, confidence: 0 }];
            alt.isFinal = false;
            this.fire("result", { resultIndex: 0, results: [alt] });
          } else if (kind === "final") {
            hadFinal = true;
            const alts = data.map(([transcript, confidence]) => ({ transcript, confidence }));
            alts.isFinal = true;
            this.fire("result", { resultIndex: 0, results: [alts] });
            this.finish();
          } else if (kind === "error") {
            this.fire("error", { error: data });
            this.finish();
          }
        });
      }
      at(t + 50, () => {
        if (!hadFinal) this.finish();
      });
    }
    finish() {
      if (this.ended) return;
      this.ended = true;
      setTimeout(() => this.fire("end"), 10);
    }
    stop() {
      // Chrome answers stop() with the final result for what it heard so far; the script's own
      // final step stands in for that.
    }
    abort() {
      this.timers.forEach(clearTimeout);
      this.fire("error", { error: "aborted" });
      this.finish();
    }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });

async function open(viewport, init) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: viewport.width < 600 });
  // Headless Chromium reports an ungranted microphone as "denied"; a phone asks first. Grant it,
  // so only the refused-microphone check below shows the blocked notice.
  await context.grantPermissions(["clipboard-read", "clipboard-write", "microphone"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(URL);
  await page.waitForFunction(() => document.getElementById("caps").textContent.includes("places"));
  return { context, page, errors };
}

const turnsDone = (page, n) => page.waitForFunction((n) => document.querySelectorAll("#log li").length >= n, n, { timeout: 10000 });

// 1. The page at three sizes, with the fake recogniser: no console errors.
for (const [name, viewport] of [["390x844", { width: 390, height: 844 }], ["844x390", { width: 844, height: 390 }], ["320x568", { width: 320, height: 568 }]]) {
  const { context, page, errors } = await open(viewport, fake);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${name}: no sideways scroll (${overflow}px)`);
  await page.screenshot({ path: `${SHOTS}/load-${name}.png` });
  await page.screenshot({ path: `${SHOTS}/load-${name}-full.png`, fullPage: true });
  check(errors.length === 0, `${name}: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 2. A scripted game: right, sound-alike, right, wrong letter, a later guess, nothing heard, hands-free.
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, fake);
  const play = async (steps, n) => {
    await page.evaluate((s) => window.__turns.push(s), steps);
    await page.click("#turn");
    await turnsDone(page, n);
  };
  await play([[200, "interim", "Los"], [150, "interim", "Los Angeles"], [300, "final", [["Los Angeles", 0.93], ["Los Angeles California", 0.41]]]], 1);
  check((await page.textContent("#need")).includes("starting with S"), "after Los Angeles the next city needs an S");
  await play([[250, "interim", "Sid"], [150, "interim", "Sidnee"], [300, "final", [["Sidnee", 0.62], ["Sydney", 0.55]]]], 2);
  await play([[200, "interim", "York"], [300, "final", [["York", 0.9]]]], 3);
  check((await page.textContent("#need")).includes("starting with K"), "after York the next city needs a K");
  await play([[200, "interim", "Oslo"], [300, "final", [["Oslo", 0.88]]]], 4);
  check((await page.textContent("#verdict")).includes("wrong first letter"), "Oslo after York is refused for its first letter");
  await page.screenshot({ path: `${SHOTS}/game-wrong-390.png` });
  await play([[200, "interim", "Cairo"], [300, "final", [["Cairo", 0.7], ["Kyoto", 0.3]]]], 5);
  await play([[400, "error", "no-speech"]], 6);
  // Hands-free: two turns queued, one tap; the second starts by itself.
  await page.evaluate(() => window.__turns.push([[200, "interim", "Oaxaca"], [300, "final", [["Oaxaca", 0.8]]]], [[200, "interim", "Accra"], [250, "final", [["Accra", 0.85]]]]));
  await page.check("#handsFree");
  await page.click("#turn");
  await turnsDone(page, 8);
  await page.click("#stop");
  await page.waitForTimeout(1500);
  const starts = await page.evaluate(() => window.__starts);
  check(starts === 8, `hands-free started the next turn by itself, and "Stop listening" stopped the one after (${starts} starts)`);
  check((await page.textContent("#turn")).startsWith("Your turn"), "after stopping, the button is ready for a tap again");
  // Mark the Sidnee turn (#2) as misheard.
  await page.locator("#log li", { hasText: "#2" }).locator("button.mis").click();
  await page.click("#copy");
  const report = await page.evaluate(() => navigator.clipboard.readText());
  console.log("---- copied report ----\n" + report + "\n-----------------------");
  const line = (n) => report.split("\n").find((l) => l.startsWith(`#${n} `)) ?? "";
  check(/RIGHT exact Los Angeles US/.test(line(1)), "turn 1: Los Angeles, exact");
  check(/RIGHT sound-alike Sydney AU/.test(line(2)) && /MISHEARD/.test(line(2)), "turn 2: Sidnee heard, Sydney by sound, marked misheard");
  check(/RIGHT exact York GB/.test(line(3)), "turn 3: York, exact");
  check(/WRONG wrong-letter Oslo/.test(line(4)), "turn 4: Oslo refused, wrong letter");
  check(/RIGHT alternative Kyoto JP/.test(line(5)) && /by final/.test(line(5)), "turn 5: Kyoto from the second guess, decided on the final result");
  check(/NONE/.test(line(6)) && /err:no-speech/.test(line(6)), "turn 6: nothing heard, no-speech error");
  check(/RIGHT exact Oaxaca/.test(line(7)) && /RIGHT exact Accra/.test(line(8)) && /auto/.test(line(8)), "turns 7 and 8: hands-free, the second started by itself");
  check(/summary: turns 8, right 6, wrong 1, nothing heard 1, misheard 1/.test(report), "summary counts");
  // Timings: first word, then a matching city, then the final result, in that order.
  const times = line(1).split(" | ")[1].split(" ").map(Number);
  const [, , , , interim, valid, final] = times;
  check(interim > 0 && valid >= interim && final >= valid, `turn 1 timings in order: first word ${interim}, city ${valid}, final ${final} ms`);
  check(/by interim/.test(line(1)) && !/final-differs/.test(report), "turn 1 was decided on an interim result (early answer on), and every final agreed");
  check(/speech end>final 1[0-9]{2}\b/.test(report), "end of speech to final is measured (about 120 ms in the script)");
  check(/medians ms: tap>first word \d+, tap>matching city \d+, tap>final \d+/.test(report), "medians are reported");
  check(!/natkins|natha/i.test(report), "the report holds nothing personal");
  await page.screenshot({ path: `${SHOTS}/game-390.png` });
  await page.screenshot({ path: `${SHOTS}/game-390-full.png`, fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: `${SHOTS}/game-844x390.png` });
  check(errors.length === 0, `game: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 3. The microphone refused.
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, fake);
  await page.evaluate(() => window.__turns.push([[100, "error", "not-allowed"]]));
  await page.click("#turn");
  await turnsDone(page, 1);
  check(await page.isVisible("#micBlocked"), "a refused microphone shows how to allow it");
  await page.screenshot({ path: `${SHOTS}/mic-denied-390.png` });
  check(errors.length === 0, `mic denied: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 4. No speech recognition at all (Firefox, some in-app browsers).
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, () => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  check(await page.isVisible("#noRecognition"), "no recognition: the page says so");
  check(await page.isDisabled("#turn"), "no recognition: the turn button is off");
  await page.screenshot({ path: `${SHOTS}/no-recognition-390.png` });
  check(errors.length === 0, `no recognition: no console errors ${errors.join(" | ")}`);
  await context.close();
}

await browser.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
