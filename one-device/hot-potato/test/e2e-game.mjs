// End-to-end check of Hot Potato in a headless, muted Chromium, with speech recognition replaced
// by a scripted fake (headless Chromium cannot hear). It plays whole rounds to the burst in two
// categories, by voice and by keyboard, checks the typed fallback, a blocked microphone, pause,
// a hidden page, what this device remembers, the wake lock, reduced motion, and the layout at
// phone and desktop sizes; it takes stills of every stage of the potato. It says nothing about
// how well a real device hears, or how a real phone feels in the hand.
//
//   node one-device/hot-potato/test/e2e-game.mjs --base=http://localhost:8930 [--shots=/tmp/claude-hot-potato-game/shots]
//
// Run it against a built site (npm run dev, or wrangler dev on your own port), through
// `devguard slot --`.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:8930");
const SHOTS = arg("shots", "/tmp/claude-hot-potato-game/shots");
const URL = `${BASE}/one-device/hot-potato/`;
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

/**
 * The fake recogniser, as Chrome behaves: each start() takes the next scripted session from
 * window.__turns, a list of steps [delay ms, kind, data] with kind "interim" (text), "final"
 * ([[text, confidence]]) or "error" (code). With nothing scripted, a session hears nothing and
 * ends with "no-speech" after a while, as a real one does in a quiet room. Also counts starts and
 * records wake lock requests and vibrations.
 */
const fake = () => {
  window.__turns = [];
  window.__starts = 0;
  window.__aborts = 0;
  window.__wake = 0;
  window.__buzz = [];
  class FakeRecognition extends EventTarget {
    constructor() {
      super();
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
      const steps = window.__turns.shift() ?? [[700, "error", "no-speech"]];
      const at = (ms, fn) => this.timers.push(setTimeout(fn, ms));
      at(5, () => this.fire("start"));
      at(20, () => this.fire("audiostart"));
      let t = 20;
      let spoke = false;
      for (const [delay, kind, data] of steps) {
        t += delay;
        at(t, () => {
          if (this.ended) return;
          if ((kind === "interim" || kind === "final") && !spoke) {
            spoke = true;
            this.fire("speechstart");
          }
          if (kind === "interim") {
            const alt = [{ transcript: data, confidence: 0 }];
            alt.isFinal = false;
            this.fire("result", { resultIndex: 0, results: [alt] });
          } else if (kind === "final") {
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
      at(t + 50, () => this.finish());
    }
    finish() {
      if (this.ended) return;
      this.ended = true;
      setTimeout(() => this.fire("end"), 10);
    }
    stop() {}
    abort() {
      window.__aborts++;
      this.timers.forEach(clearTimeout);
      this.fire("error", { error: "aborted" });
      this.finish();
    }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
  try {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          window.__wake++;
          const lock = new EventTarget();
          lock.release = async () => lock.dispatchEvent(new Event("release"));
          return lock;
        },
      },
    });
  } catch {}
  const vib = navigator.vibrate?.bind(navigator);
  navigator.vibrate = (p) => {
    window.__buzz.push(Array.isArray(p) ? p.length : p);
    return vib ? true : false;
  };
};
const noSpeech = () => {
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
};
const noStorage = () => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("denied", "SecurityError");
    },
  });
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

async function open(viewport, inits = [fake], { phone = viewport.width < 600 || viewport.height < 500, reducedMotion = "no-preference", context: given } = {}) {
  const context = given ?? (await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone, reducedMotion, ...(phone ? { userAgent: PIXEL } : {}) }));
  await context.grantPermissions(["microphone"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  for (const init of inits) await page.addInitScript(init);
  await page.goto(URL);
  await page.waitForSelector("#s-cats [data-cat]");
  return { context, page, errors };
}

const round = (page) => page.evaluate(() => {
  const g = window.__hotPotato.round();
  return g && { phase: g.phase, stage: g.stage, holder: g.holder, need: g.need, chain: g.chain.map((c) => c.said), burstOn: g.burstOn, fuse: g.fuse, fuseMax: g.fuseMax, lit: g.lit, paused: g.paused, misses: g.misses, last: g.last && { ok: g.last.ok, why: g.last.why, reason: g.last.reason } };
});
const waitPhase = (page, phase, timeout = 15000) => page.waitForFunction((p) => window.__hotPotato.round()?.phase === p, phase, { timeout });
const waitReady = (page) => page.waitForSelector("#g-go:not([hidden]):not([disabled])", { timeout: 15000 });

async function start(page, category, players) {
  await page.click(`#s-cats [data-cat="${category}"]`);
  while ((await page.textContent("#s-n")) !== String(players)) {
    const n = Number(await page.textContent("#s-n"));
    await page.click(n < players ? "#s-plus" : "#s-minus");
  }
  await page.click("#s-start");
  await waitPhase(page, "ready");
}

/** One spoken turn: the script is queued, the holder starts (tap, click or a key), and the verdict comes. */
async function say(page, steps, how = "click") {
  await waitReady(page);
  const before = await page.evaluate(() => window.__hotPotato.round().turns);
  await page.evaluate((s) => window.__turns.push(s), steps);
  if (how === "click") await page.click("#g-go");
  else if (how === "tap") await page.tap("#g-go");
  else await page.keyboard.press(how);
  await page.waitForFunction((n) => {
    const g = window.__hotPotato.round();
    return g.turns > n && g.phase !== "listen";
  }, before, { timeout: 15000 });
  return round(page);
}
const word = (text, confidence = 0.9) => [[200, "interim", text.slice(0, 3)], [250, "final", [[text, confidence]]]];

/** Waits for the art to ease to the stage, then takes a still of the potato. */
async function still(page, name) {
  await page.waitForFunction(() => {
    const g = window.__hotPotato.round();
    const look = window.__hotPotato.art.look();
    const target = Math.min(1, g.stage / 4);
    return look.burst || Math.abs(look.growth - target) < 0.004;
  }, null, { timeout: 8000 });
  // The steam of getting worse has blown away by now.
  await page.waitForTimeout(1300);
  await page.locator("#pot").screenshot({ path: `${SHOTS}/${name}.png` });
}

const noSideways = (page, w) => page.evaluate((w) => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth) - w, w);
/** Every visible control inside the screen (nothing cut off at the edges). */
const offscreen = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, input, .status, .tag, .holder, .logo, .chain")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      if (el.closest("[hidden]")) continue;
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(`${el.id || el.className} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return out;
  });
/** Controls overlapping each other (a sign of a squeezed layout). */
const overlaps = (page) =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll(".gi button, .gi input, .gi .status, .gi .tag, .gi .holder, .gi .after, .gi .heard")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && !el.closest("[hidden]") && getComputedStyle(el).display !== "none";
    });
    const out = [];
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect();
        const b = els[j].getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) out.push(`${els[i].id || els[i].className} / ${els[j].id || els[j].className}`);
      }
    return out;
  });

// 1. Layout: the start screen, a turn listening, a verdict with its appeal, the pause and the end,
//    at an upright phone, a small phone, a sideways phone and a desktop window.
const SIZES = [
  ["390x844", { width: 390, height: 844 }],
  ["320x568", { width: 320, height: 568 }],
  ["844x390", { width: 844, height: 390 }],
  ["1280x720", { width: 1280, height: 720 }],
];
for (const [name, viewport] of SIZES) {
  const { context, page, errors } = await open(viewport);
  const look = async (what) => {
    const side = await noSideways(page, viewport.width);
    check(side <= 0, `${name} ${what}: no sideways scroll (${side}px)`);
    const off = await offscreen(page);
    check(off.length === 0, `${name} ${what}: everything inside the screen ${off.join(" | ")}`);
    const over = await overlaps(page);
    check(over.length === 0, `${name} ${what}: nothing overlaps ${over.join(" | ")}`);
    await page.screenshot({ path: `${SHOTS}/${name}-${what}.png` });
  };
  await look("start");
  await page.click('#s-cats [data-cat="food"]');
  await look("start-food");
  await start(page, "cities", 8);
  await look("ready");
  await page.evaluate(() => window.__turns.push([[300, "interim", "Los"], [4000, "final", [["Los Angeles", 0.9]]]]));
  await page.click("#g-go");
  await page.waitForFunction(() => /Los/.test(document.getElementById("g-heard").textContent));
  await look("listening");
  await page.waitForFunction(() => window.__hotPotato.round().phase === "ready", null, { timeout: 10000 });
  await say(page, word("Leopold", 0.4));
  check(await page.isVisible("#g-appeal"), `${name}: a refusal offers its appeal`);
  await look("verdict-appeal");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-paused:not([hidden])");
  await look("paused");
  await page.click("#p-resume");
  for (let i = 0; i < 4; i++) await say(page, word("hello"));
  await waitPhase(page, "over", 12000);
  await page.waitForTimeout(300);
  await look("end");
  check(errors.length === 0, `${name}: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 2. A whole round of cities on a phone, by voice and taps, to the burst, with a still of every
//    stage of the potato.
{
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await start(page, "cities", 3);
  await still(page, "potato-stage-0");
  let r = await say(page, word("Los Angeles"), "tap");
  check(r.last.ok && r.need === "s" && r.holder === 1, `Los Angeles accepted, the next city needs an S, Player 2 holds it (${JSON.stringify(r.last)})`);
  check((await page.textContent("#g-letter")) === "S", "the steel tag shows S");
  check(/^Cities: after Los Angeles$/.test(await page.textContent("#g-after")), `the line under the name says what came before (${await page.textContent("#g-after")})`);
  r = await say(page, [[250, "interim", "Sid"], [300, "final", [["Sidnee", 0.62], ["Sydney", 0.55]]]], "tap");
  check(r.last.ok && r.chain.at(-1) === "Sydney", "Sydney from the recogniser's second guess");
  r = await say(page, word("salmon"), "tap");
  check(!r.last.ok && r.stage === 1 && r.holder === 0, `salmon refused, it gets worse, and passes to Player 1 (${r.last.why})`);
  await page.waitForTimeout(350);
  await page.locator("#pot").screenshot({ path: `${SHOTS}/potato-steam.png` });
  check(/"Salmon" is not a city/.test(await page.textContent("#g-status")), "the verdict says plainly why");
  await still(page, "potato-stage-1");
  r = await say(page, word("Paris"), "tap");
  check(!r.last.ok && r.last.reason === "wrong-letter" && r.stage === 2, "Paris on a Y is refused: wrong letter");
  await still(page, "potato-stage-2");
  // The appeal: the group says Leopold was right.
  r = await say(page, word("Yokohama"), "tap");
  check(r.last.ok && r.need === "a", "Yokohama accepted");
  r = await say(page, word("Amsterdamm", 0.5), "tap");
  if (!r.last.ok) {
    await page.click("#g-appeal");
    r = await round(page);
    check(r.stage === 2 && r.chain.at(-1).toLowerCase().startsWith("amsterdam"), `"that was right" takes the word and undoes the damage (${r.chain.at(-1)})`);
  } else check(true, "Amsterdamm was heard as Amsterdam");
  r = await say(page, word("Moscow"), "tap");
  check(r.last.ok, "Moscow accepted");
  // "That was wrong": the group overturns an acceptance.
  await page.click("#g-appeal");
  r = await round(page);
  check(r.stage === 3 && r.chain.at(-1) !== "Moscow" && r.need === "m", `"that was wrong" takes Moscow back and it gets worse (stage ${r.stage}, need ${r.need})`);
  await still(page, "potato-stage-3");
  // Silence: the fuse burns down (9 seconds at stage 3... it is 7 at stage 3).
  const fuseStart = Date.now();
  await waitReady(page);
  await page.tap("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1200);
  const mid = await round(page);
  check(mid.fuse < mid.fuseMax - 900 && mid.phase === "listen", `the fuse burns while listening (${Math.round(mid.fuse)} of ${mid.fuseMax} ms)`);
  await page.locator(".game").screenshot({ path: `${SHOTS}/390-listening-stage-3.png` });
  await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 15000 });
  r = await round(page);
  const took = Date.now() - fuseStart;
  check(r.last.reason === "slow" && r.stage === 4 && took >= 6500, `silence: too slow after the 7-second fuse (${took} ms), last life`);
  check(/Too slow/.test(await page.textContent("#g-status")), "the verdict says Too slow");
  check(!(await page.isVisible("#g-appeal")), "no appeal for silence");
  await still(page, "potato-stage-4");
  const who = r.holder;
  r = await say(page, word("Hello"), "tap");
  check(r.phase === "doom", "the last miss: it is going to burst");
  check(await page.isVisible("#g-appeal"), "the appeal is still offered before it bursts");
  await waitPhase(page, "burst", 5000);
  await page.waitForTimeout(500);
  await page.locator("#pot").screenshot({ path: `${SHOTS}/potato-burst-0.5s.png` });
  await waitPhase(page, "over", 6000);
  await still(page, "potato-burst");
  check((await page.textContent("#e-who")) === `Player ${who + 1}`, `the end screen names who it burst on (Player ${who + 1})`);
  const chain = await page.$$eval("#e-chain li", (li) => li.map((l) => l.textContent));
  check(chain.length === 4 && /Los Angeles/.test(chain[0]) && /Player 1/.test(chain[0]), `the end screen shows the chain (${chain.join(" · ")})`);
  check(/It stayed alive for 4 words and 5 misses/.test(await page.textContent("#e-stats")), "and how long it lasted");
  const buzzes = await page.evaluate(() => window.__buzz.length);
  check(buzzes > 0, `it vibrates where it can (${buzzes} calls)`);
  check((await page.evaluate(() => window.__wake)) >= 1, "the screen is kept on during the round");
  await page.screenshot({ path: `${SHOTS}/390-end.png` });
  // Play again: healthy again, the same setup.
  await page.click("#e-again");
  await waitPhase(page, "ready");
  r = await round(page);
  check(r.stage === 0 && r.chain.length === 0, "Play again starts a fresh round");
  await still(page, "potato-again");
  await page.click("#g-pause");
  await page.click("#p-quit");
  check((await page.getAttribute("#game", "data-screen")) === "start", "End this round goes back to the setup");
  check(errors.length === 0, `phone round: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 3. Animals on a desktop with the keyboard: a dead end, a plural, then misses to the burst; the
//    choice of category and players is remembered.
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const { page, errors } = await open({ width: 1280, height: 720 }, [fake], { context });
  await start(page, "animals", 2);
  check((await page.textContent("#g-after")) === "Animals: any animal to start", "the line asks for any animal");
  let r = await say(page, word("monkey"), "Space");
  check(r.last.ok && r.need === "e", "Space starts a turn; after monkey (Y is a dead end) comes an E");
  check(/Y is a dead end/.test(await page.textContent("#g-after")), "the line says Y is a dead end");
  check(/Y is a dead end, so E/.test(await page.textContent("#g-status")), "and so does the verdict");
  r = await say(page, word("eagles"), "Enter");
  check(r.last.ok && r.chain.at(-1) === "eagle" && r.need === "e", "Enter starts a turn; eagles is eagle, and the chain goes on from eagle");
  for (let i = 0; i < 5; i++) r = await say(page, word("table"), "Space");
  check(r.phase === "doom", "five misses: it is going to burst");
  await waitPhase(page, "over", 8000);
  check((await page.textContent("#e-who")) === "Player 1", "it burst on Player 1");
  check(errors.length === 0, `animals: no console errors ${errors.join(" | ")}`);
  await page.close();
  // Remembered on this device.
  const again = await open({ width: 1280, height: 720 }, [fake], { context });
  check((await again.page.getAttribute('#s-cats [data-cat="animals"]', "aria-pressed")) === "true" && (await again.page.textContent("#s-n")) === "2", "the category and the number of players are remembered");
  await context.close();
}

// 4. Pause and a hidden page: the fuse waits, listening stops, and starts again on Go on.
{
  const { context, page, errors } = await open({ width: 1280, height: 720 });
  await start(page, "countries", 4);
  await waitReady(page);
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-paused:not([hidden])");
  const a = await round(page);
  const aborts = await page.evaluate(() => window.__aborts);
  await page.waitForTimeout(1500);
  const b = await round(page);
  check(a.paused && b.fuse === a.fuse, `Escape pauses: the fuse holds (${Math.round(a.fuse)} then ${Math.round(b.fuse)})`);
  check(aborts >= 1, "listening stops while paused");
  const starts = await page.evaluate(() => window.__starts);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !window.__hotPotato.round().paused);
  await page.waitForFunction((n) => window.__starts > n, starts);
  check(true, "Escape again goes on, and listening starts again");
  await page.waitForTimeout(800);
  const c = await round(page);
  check(c.fuse < b.fuse, "the fuse burns again after going on");
  // The page hidden (another app, the phone locked): it pauses by itself.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const d = await round(page);
  await page.waitForTimeout(1200);
  const e = await round(page);
  check(d.paused && e.fuse === d.fuse && e.phase === "listen", "a hidden page pauses the round and the fuse holds");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  check(await page.isVisible("#g-paused"), "coming back shows the pause, waiting for a tap");
  await page.click("#p-resume");
  await page.evaluate(() => window.__turns.push([[100, "interim", "Ger"], [200, "final", [["Germany", 0.9]]]]));
  await page.waitForFunction(() => window.__hotPotato.round().phase === "ready", null, { timeout: 10000 });
  const f = await round(page);
  check(f.chain.at(-1) === "Germany" && f.need === "n", `after Go on the word is heard again (Germany; Y is a dead end, so N: ${f.need})`);
  check(errors.length === 0, `pause: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 5. No speech recognition (Firefox): it says so and the round is played by typing.
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, [fake, noSpeech]);
  check(/cannot listen/.test(await page.textContent("#s-note")), "a browser that cannot listen says so on the start screen");
  await page.screenshot({ path: `${SHOTS}/390-typed-start.png` });
  await start(page, "cities", 2);
  await waitReady(page);
  await page.tap("#g-go");
  await page.waitForSelector("#g-typed:not([hidden])");
  check(await page.evaluate(() => document.activeElement?.id === "g-word"), "the word box has the keyboard");
  await page.fill("#g-word", "Paris");
  await page.screenshot({ path: `${SHOTS}/390-typed-turn.png` });
  await page.keyboard.press("Enter");
  await waitPhase(page, "ready");
  let r = await round(page);
  check(r.last.ok && r.need === "s", "typed Paris is taken; next an S");
  await waitReady(page);
  await page.tap("#g-go");
  await page.fill("#g-word", "Boston");
  await page.tap("#g-send");
  await waitPhase(page, "ready");
  r = await round(page);
  check(!r.last.ok && /Boston starts with B, not S/.test(r.last.why), `a typed wrong word is refused with the reason (${r.last.why})`);
  check(errors.length === 0, `typed: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 6. The microphone refused: it goes on by typing, and says how to allow it.
{
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await start(page, "cities", 2);
  await waitReady(page);
  await page.evaluate(() => window.__turns.push([[30, "error", "not-allowed"]]));
  await page.tap("#g-go");
  await page.waitForSelector("#g-typed:not([hidden])");
  check(true, "a blocked microphone turns the turn into typing");
  await page.fill("#g-word", "Lima");
  await page.keyboard.press("Enter");
  await waitPhase(page, "ready");
  check((await round(page)).last.ok, "and the typed word counts");
  await page.click("#g-pause");
  await page.click("#p-quit");
  check(/microphone is blocked/.test(await page.textContent("#s-note")), "the start screen says the microphone is blocked, and how to allow it");
  check(errors.length === 0, `mic blocked: no console errors ${errors.join(" | ")}`);
  await context.close();
}

// 7. "Type it instead" while listening, storage refused, and reduced motion.
{
  const { context, page, errors } = await open({ width: 390, height: 844 }, [fake, noStorage], { reducedMotion: "reduce" });
  await start(page, "food", 2);
  await waitReady(page);
  await page.tap("#g-go");
  await page.waitForSelector("#g-type:not([hidden])");
  await page.tap("#g-type");
  await page.fill("#g-word", "tomatoes");
  await page.keyboard.press("Enter");
  await waitPhase(page, "ready");
  const r = await round(page);
  check(r.last.ok && r.need === "o", "Type it instead: tomatoes typed is a tomato, next an O");
  check(r.chain.length === 1, "storage refused: the game still plays");
  // Typing stays chosen for the rest of this round.
  for (let i = 0; i < 3; i++) {
    await waitReady(page);
    await page.tap("#g-go");
    await page.waitForSelector("#g-typed:not([hidden])");
    await page.fill("#g-word", "table");
    await page.keyboard.press("Enter");
    await waitPhase(page, "ready");
  }
  // Two frames later the art shows the new stage exactly: no easing, no overshoot.
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  const look = await page.evaluate(() => ({ ...window.__hotPotato.art.look(), stage: window.__hotPotato.round().stage }));
  check(look.stage === 3 && Math.abs(look.growth - 0.75) < 0.001, `reduced motion: the potato changes at once, without the bounce (stage ${look.stage}, growth ${look.growth.toFixed(3)})`);
  check(errors.length === 0, `reduced motion, no storage: no console errors ${errors.join(" | ")}`);
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
