// End-to-end check of the Hot Potato hearing test in a headless, muted Chromium, with speech
// recognition replaced by a scripted fake (headless Chromium cannot really hear). It proves the
// page's timings, matcher, verdicts, appeals, log, keyboard, microphone picker and copied report
// work, on desktop and phone sizes; it says nothing about how well a real device hears.
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
 * start(track) is accepted like Chrome's start(audioTrack) (a non-track throws a TypeError),
 * unless window.__noTrackSupport is set, when the argument is ignored as older browsers do.
 * Two named microphones are offered by a stubbed enumerateDevices, and getUserMedia hands back a
 * stand-in track.
 */
const fake = () => {
  window.__turns = [];
  window.__starts = 0;
  window.__tracks = [];
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
    start(track) {
      if (track !== undefined && !window.__noTrackSupport) {
        if (!track || track.kind !== "audio") throw new TypeError("not a MediaStreamTrack");
        window.__tracks.push(track.label);
      }
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
  const md = navigator.mediaDevices;
  if (md) {
    md.enumerateDevices = async () => [
      { kind: "audioinput", deviceId: "default", label: "Default - Microphone Array (Realtek(R) Audio)" },
      { kind: "audioinput", deviceId: "mic-a", label: "Microphone Array (Realtek(R) Audio)" },
      { kind: "audioinput", deviceId: "mic-b", label: "Headset Microphone (Jabra Evolve 65)" },
      { kind: "audiooutput", deviceId: "out-a", label: "Speakers" },
    ];
    md.getUserMedia = async (c) => ({ getAudioTracks: () => [{ kind: "audio", label: String(c?.audio?.deviceId?.exact), stop() {} }] });
  }
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

async function open(viewport, init, { phone = viewport.width < 600 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone, ...(phone ? { userAgent: PIXEL } : {}) });
  // Headless Chromium reports an ungranted microphone as "denied"; a real browser asks first.
  // Grant it, so only the refused-microphone check below shows the blocked notice.
  await context.grantPermissions(["clipboard-read", "clipboard-write", "microphone"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(URL);
  await page.waitForFunction(() => document.getElementById("caps").textContent.includes("well-known places"));
  return { context, page, errors };
}

const turnsDone = (page, n) => page.waitForFunction((n) => document.querySelectorAll("#log li").length >= n, n, { timeout: 10000 });

// 1. The page at phone and desktop sizes (2560x1271 is the owner's window): no console errors,
//    no sideways scroll, and the play column a sensible width on a wide screen.
const SIZES = [
  ["390x844", { width: 390, height: 844 }],
  ["844x390", { width: 844, height: 390 }],
  ["320x568", { width: 320, height: 568 }],
  ["1280x720", { width: 1280, height: 720 }],
  ["1920x1080", { width: 1920, height: 1080 }],
  ["2560x1271", { width: 2560, height: 1271 }],
];
for (const [name, viewport] of SIZES) {
  const desktop = viewport.width >= 1000;
  const { context, page, errors } = await open(viewport, fake, { phone: viewport.width < 600 || (viewport.height < 500 && !desktop) });
  // Against the screen's own width: on a phone, a too-wide page widens the layout viewport too.
  await page.waitForSelector("#micPick:not([hidden])", { timeout: 5000 }).catch(() => {});
  const overflow = await page.evaluate((w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w, viewport.width);
  check(overflow <= 0, `${name}: no sideways scroll (${overflow}px), with the microphone picker shown`);
  const widths = await page.evaluate(() => ({ app: document.querySelector(".app").getBoundingClientRect().width, turn: document.getElementById("turn").getBoundingClientRect().width }));
  if (desktop) check(widths.app <= 1200 && widths.turn <= 600, `${name}: the page keeps a sensible width (page ${Math.round(widths.app)}px, button ${Math.round(widths.turn)}px)`);
  const keysShown = await page.isVisible("#keys");
  check(keysShown === desktop, `${name}: keyboard hint ${desktop ? "shown" : "hidden"} on ${desktop ? "a desktop" : "a phone"}`);
  const button = await page.textContent("#turn");
  check(desktop ? /click, then say/.test(button) : /tap and say/.test(button), `${name}: the button speaks to this device ("${button}")`);
  const body = await page.textContent("body");
  check(!/your phone|this phone/i.test(body), `${name}: the wording never assumes a phone`);
  await page.screenshot({ path: `${SHOTS}/load-${name}.png` });
  await page.screenshot({ path: `${SHOTS}/load-${name}-full.png`, fullPage: true });
  check(errors.length === 0, `${name}: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 2. A scripted game on a desktop: exact, a later guess, refusals with reasons, an appeal, an
//    early answer, the keyboard, a chosen microphone, nothing heard, hands-free.
{
  const { context, page, errors } = await open({ width: 1280, height: 720 }, fake);
  await page.waitForSelector("#micPick:not([hidden])", { timeout: 5000 }).catch(() => {});
  check(await page.isVisible("#micPick"), "two named microphones: the picker is shown");
  await page.selectOption("#mic", "mic-b");
  await page.waitForFunction(() => !document.getElementById("micNote").hidden);
  check((await page.textContent("#micNote")).includes("listens to this microphone"), "a chosen microphone is used where the browser can");
  const play = async (steps, n, how = "click") => {
    await page.evaluate((s) => window.__turns.push(s), steps);
    if (how === "click") await page.click("#turn");
    else {
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press(how);
    }
    await turnsDone(page, n);
  };
  await play([[200, "interim", "Los"], [150, "interim", "Los Angeles"], [300, "final", [["Los Angeles", 0.93], ["Los Angeles California", 0.41]]]], 1);
  check((await page.textContent("#need")).includes("starting with S"), "after Los Angeles the next city needs an S");
  check((await page.evaluate(() => window.__tracks)).includes("mic-b"), "the turn listened to the chosen microphone");
  await play([[250, "interim", "Sid"], [150, "interim", "Sidnee"], [300, "final", [["Sidnee", 0.62], ["Sydney", 0.55]]]], 2, "Space");
  check((await page.textContent("#verdict")).includes("from the recogniser's guess 2"), "Space started a turn; Sydney from the second guess");
  await play([[200, "interim", "salmon"], [300, "final", [["salmon", 0.48], ["Salman", 0.48], ["salmen", 0.48]]]], 3, "Enter");
  check((await page.textContent("#verdict")).includes('heard "salmon", an ordinary word, not a city'), "Enter started a turn; salmon refused as an ordinary word");
  await page.screenshot({ path: `${SHOTS}/game-salmon-1280.png` });
  await play([[200, "interim", "Yokohama"], [300, "final", [["Yokohama", 0.9]]]], 4);
  await play([[200, "interim", "Amsterdam"], [300, "final", [["Amsterdam", 0.9]]]], 5);
  await play([[200, "interim", "Montreal"], [300, "final", [["Montreal", 0.9]]]], 6);
  check((await page.textContent("#need")).includes("starting with L"), "after Montreal the next city needs an L");
  await play([[200, "interim", "Leo"], [150, "interim", "Leopold"], [300, "final", [["Leopold", 0.29], ["Leupold", 0.35]]]], 7);
  check((await page.textContent("#verdict")).startsWith("No"), "Leopold is not Léo");
  // He says it was a real city: one tap under the verdict.
  await page.click("#appealSlot button");
  check((await page.textContent("#appealSlot button")).includes("Marked"), "the appeal under the verdict is marked");
  await play([[200, "interim", "Lima"], [300, "final", [["Lima", 0.9]]]], 8);
  // Early answers on: a stable, well-known city is taken from the interim, before the final.
  await page.check("#early");
  await play([[200, "interim", "Accra"], [900, "final", [["Accra", 0.9]]]], 9);
  await play([[200, "interim", "Acapulco"], [300, "final", [["Acapulco", 0.9]]]], 10);
  await play([[200, "interim", "Orange"], [300, "final", [["Orange", 0.78]]]], 11);
  check((await page.textContent("#verdict")).includes("only in hard mode"), "Orange is only in hard mode");
  await page.check("#hard");
  await play([[200, "interim", "Orange"], [300, "final", [["Orange", 0.78]]]], 12);
  const orange = await page.textContent("#verdict");
  check(/^Yes: Orange \(California, United States, 141k\), exact \(the city, not the word\); there is also one in Australia/.test(orange), `hard mode takes Orange, naming the bigger one (${orange})`);
  await page.uncheck("#hard");
  await play([[400, "error", "no-speech"]], 13);
  // Hands-free: two turns queued, one tap; the second starts by itself. Escape stops the third.
  await page.evaluate(() => window.__turns.push([[200, "interim", "Edmonton"], [400, "final", [["Edmonton", 0.89], ["Edmundton", 0.89]]]], [[200, "interim", "Nairobi"], [250, "final", [["Nairobi", 0.85]]]]));
  await page.check("#handsFree");
  await page.click("#turn");
  await turnsDone(page, 15);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const starts = await page.evaluate(() => window.__starts);
  check(starts === 15, `hands-free started the next turn by itself, and Escape stopped the one after (${starts} starts)`);
  check((await page.textContent("#turn")).startsWith("Your turn"), "after stopping, the button is ready again");
  // Mark the Sidnee turn (#2) as misheard, and appeal the salmon refusal (#3) from the log.
  await page.locator("#log li", { hasText: "#2" }).first().locator("button.mis", { hasText: "It misheard me" }).click();
  await page.locator("#log li", { hasText: "#3" }).first().locator("button.appeal-row").click();
  check((await page.textContent("#appealSlot button")) === "That was wrong", "an appeal in the log leaves the appeal under the current verdict in place");
  await page.click("#copy");
  const report = await page.evaluate(() => navigator.clipboard.readText());
  console.log("---- copied report ----\n" + report + "\n-----------------------");
  const line = (n) => report.split("\n").find((l) => l.startsWith(`#${n} `)) ?? "";
  check(report.startsWith("Hot Potato hearing test, v2 (matching rules m2)"), "the report says v2 and the rules version");
  check(/^device: desktop \(Linux, Chrome \d+\)/m.test(report), "the report names a desktop, its system and browser");
  check(/^microphone: chosen: headset \(2 inputs\); used by recognition: yes$/m.test(report), "the report names the microphone only by its kind");
  check(!/Jabra|Realtek/.test(report), "no microphone's own name in the report");
  check(report.split("\n").filter((l) => /^#\d+ m2 (known|hard) /.test(l)).length === 15, "every turn line carries the rules version and the list");
  check(/RIGHT exact Los Angeles US/.test(line(1)) && /by final/.test(line(1)), "turn 1: Los Angeles, exact, decided on the final (early off)");
  check(/RIGHT alternative Sydney AU/.test(line(2)) && /MISHEARD/.test(line(2)), "turn 2: Sydney from the second guess, marked misheard");
  check(/WRONG word \(heard "salmon"/.test(line(3)) && /APPEAL:real-city/.test(line(3)), "turn 3: salmon, an ordinary word, appealed from the log");
  check(/WRONG/.test(line(7)) && /APPEAL:real-city/.test(line(7)), "turn 7: Leopold refused, appealed under the verdict");
  check(/RIGHT exact Accra GH \(heard "accra", by interim\)/.test(line(9)) && /early-would:Accra@\d+/.test(line(9)) && !/final-differs/.test(line(9)), "turn 9: Accra answered early from a stable interim, and the final agreed");
  check(/WRONG hard-only Orange/.test(line(11)) && / known /.test(line(11)), "turn 11: Orange, hard mode only");
  check(/RIGHT exact Orange US/.test(line(12)) && / hard /.test(line(12)), "turn 12: Orange in hard mode");
  check(/NONE/.test(line(13)) && /err:no-speech/.test(line(13)), "turn 13: nothing heard, no-speech error");
  check(/RIGHT exact Edmonton CA/.test(line(14)) && /RIGHT exact Nairobi KE/.test(line(15)) && /auto/.test(line(15)), "turns 14 and 15: hands-free, Edmonton then Nairobi");
  check(/summary: turns 15, right 11, wrong 3, nothing heard 1, misheard 1, sound-alike 0, appeals real-city 2 wrong 0/.test(report), "summary counts, with appeals");
  check(/^early answer: would have taken \d+, 0 differing from the final$/m.test(report), "the early-answer tally is reported");
  const times = line(1).split(" | ")[1].split(" ").map(Number);
  const [, , , , interim, valid, final] = times;
  check(interim > 0 && final >= interim && valid <= final, `turn 1 timings in order: first word ${interim}, city ${valid}, final ${final} ms`);
  check(/speech end>final 1[0-9]{2}\b/.test(report), "end of speech to final is measured (about 120 ms in the script)");
  check(!/natkins|natha/i.test(report), "the report holds nothing personal");
  await page.screenshot({ path: `${SHOTS}/game-1280.png` });
  await page.screenshot({ path: `${SHOTS}/game-1280-full.png`, fullPage: true });
  await page.setViewportSize({ width: 2560, height: 1271 });
  await page.screenshot({ path: `${SHOTS}/game-2560x1271.png` });
  check(errors.length === 0, `game: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 3. A phone: the device line says so, and a turn by tap works.
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, fake);
  await page.evaluate(() => window.__turns.push([[200, "interim", "Oslo"], [300, "final", [["Oslo", 0.88]]]]));
  await page.tap("#turn");
  await turnsDone(page, 1);
  await page.click("#copy");
  const report = await page.evaluate(() => navigator.clipboard.readText());
  check(/^device: phone \(Android, Chrome 157\)/m.test(report), "phone: the report names an Android phone");
  check(/RIGHT exact Oslo NO/.test(report), "phone: Oslo by tap");
  await page.screenshot({ path: `${SHOTS}/game-390.png` });
  check(errors.length === 0, `phone: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 4. A browser whose speech recognition cannot take a chosen microphone: it says so plainly.
{
  // (Headless Chromium's own SpeechRecognition.available() crashes the page, so the real
  // recogniser is never loaded here: the fake is always installed first.)
  const { context, page, errors } = await open({ width: 1280, height: 720 }, { content: `window.__noTrackSupport = true; (${fake.toString()})();` });
  await page.waitForSelector("#micPick:not([hidden])", { timeout: 5000 }).catch(() => {});
  await page.selectOption("#mic", "mic-b");
  await page.waitForFunction(() => !document.getElementById("micNote").hidden);
  const note = await page.textContent("#micNote");
  check(/cannot be used here/.test(note) && (await page.inputValue("#mic")) === "", "no microphone choice: the page says so and stays on the default");
  await page.screenshot({ path: `${SHOTS}/mic-unsupported-1280.png` });
  check(errors.length === 0, `mic unsupported: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 5. The microphone refused.
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

// 6. No speech recognition at all (Firefox, some in-app browsers).
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
