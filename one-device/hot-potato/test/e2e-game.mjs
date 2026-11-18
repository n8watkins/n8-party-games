// End-to-end check of Hot Potato in a headless, muted Chromium, with speech recognition replaced
// by a scripted fake (headless Chromium cannot hear). It plays whole rounds to the burst in two
// categories, by voice and by keyboard, checks the typed fallback, a blocked microphone, pause,
// a hidden page, what this device remembers, the wake lock, reduced motion, and the layout at
// phone and desktop sizes; it takes stills of every stage of the potato. It says nothing about
// how well a real device hears, or how a real phone feels in the hand.
//
//   node one-device/hot-potato/test/e2e-game.mjs --base=http://localhost:8930 [--shots=/tmp/claude-hot-potato-game/shots] [--lanes=4] [--only=fallback|layout]
//
// Its cases share nothing, so they run four at a time in one browser (most of their time is the
// game's own fuses and bursts, waited out in real time); --lanes=1 (test:hot-potato:full) runs
// them one after another, the way to tell a case that fails on its own from one that fails only
// beside the others.
//
// Run it against a built site (npm run dev, or wrangler dev on your own port), through
// `devguard slot --`.
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { launchBrowser } from "../../../lobby/test/browser.mjs";
import { FACES, HEATS, REACTIONS } from "../public/specimen-draw.js";

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const BASE = arg("base", "http://localhost:8930");
const SHOTS = arg("shots", "/tmp/claude-hot-potato-game/shots");
const URL = `${BASE}/one-device/hot-potato/`;
mkdirSync(SHOTS, { recursive: true });

// Every case below opens pages of its own and shares nothing with the others, so they run side
// by side in one browser, --lanes at a time (default 4; --lanes=1 runs them one after another,
// as test:hot-potato:full does). Each line says which case it is from.
const LANES = Math.max(1, Number(arg("lanes", "4")) || 1);
const where = new AsyncLocalStorage();
let failures = 0;
const check = (ok, what) => {
  const name = where.getStore();
  console.log(`${ok ? "ok  " : "FAIL"} ${name && LANES > 1 ? `[${name}] ` : ""}${what}`);
  if (!ok) failures++;
};
/** The cases, in the order they are written: [group, name, run]. */
const TASKS = [];
const task = (group, name, run) => TASKS.push([group, name, run]);

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
      const at = (ms, fn) => this.timers.push(setTimeout(fn, ms));
      // Broken recognisers, as the review found them: one whose start() does nothing at all, one
      // that ends at once aborted before it starts, and one that starts and then aborts at once.
      if (window.__broken === "silent") return;
      if (window.__broken === "abort-at-once" || window.__broken === "start-then-abort") {
        if (window.__broken === "start-then-abort") {
          at(5, () => this.fire("start"));
          at(10, () => this.fire("audiostart"));
        }
        at(20, () => {
          this.fire("error", { error: "aborted" });
          this.finish();
        });
        return;
      }
      // Nothing scripted: a quiet room. Chrome gives up after some seconds of silence.
      const steps = window.__turns.shift() ?? [[5000, "error", "no-speech"]];
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

// Headless and muted; on the graphics card with TEST_GPU=1 (lobby/test/browser.mjs), as the gate's
// other browser steps.
const browser = await launchBrowser({ args: ["--autoplay-policy=no-user-gesture-required"] });
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

async function open(viewport, inits = [fake], { phone = viewport.width < 600 || viewport.height < 500, reducedMotion = "no-preference", context: given, hash = "" } = {}) {
  const context = given ?? (await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone, reducedMotion, ...(phone ? { userAgent: PIXEL } : {}) }));
  await context.grantPermissions(["microphone"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  for (const init of inits) await page.addInitScript(init);
  await page.goto(URL + hash);
  await page.waitForSelector("#s-cats [data-cat]");
  return { context, page, errors };
}

const round = (page) => page.evaluate(() => {
  const g = window.__hotPotato.round();
  return g && { phase: g.phase, turns: g.turns, stage: g.stage, holder: g.holder, need: g.need, chain: g.chain.map((c) => c.said), burstOn: g.burstOn, fuse: g.fuse, fuseMax: g.fuseMax, lit: g.lit, paused: g.paused, misses: g.misses, last: g.last && { ok: g.last.ok, why: g.last.why, reason: g.last.reason } };
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
  return drawnParts(page);
}

/**
 * Which parts of the potato are drawn now. The Specimen (the default): the names of all its parts
 * (it never adds or removes one), and a mark if its body, outline, eyes or mouth are not showing.
 * The plain potato (#plain): its body's shapes that are drawn, by their place among them: a path
 * with a line to draw, a shape with a size, neither hidden nor fully transparent. Either way every
 * stage must give the same answer: nothing may first appear as it grows.
 */
const drawnParts = (page) =>
  page.evaluate(() => {
    const named = [...document.querySelectorAll("#pot [data-part]")];
    if (named.length) {
      const shown = (n) => {
        const el = document.querySelector(`#pot [data-part="${n}"]`);
        return Boolean(el) && el.getAttribute("opacity") !== "0";
      };
      const core = ["spud", "body", "outline", "shade", "hilite"].every(shown) && (shown("eyeW0") || shown("eyeS0")) && (shown("eyeW1") || shown("eyeS1")) && ["mouthLine", "mouthFill"].some(shown);
      return named.map((el) => el.dataset.part).join(",") + (core ? "" : ",MISSING-BODY-OR-FACE");
    }
    const shapes = [...document.querySelectorAll("#pot .body path, #pot .body ellipse, #pot .body circle, #pot .body rect, #pot .body polygon")];
    return shapes
      .map((el, i) => {
        const a = (n) => el.getAttribute(n);
        const sized = el.tagName === "path" ? Boolean(a("d")) : el.tagName === "ellipse" ? Number(a("rx")) > 0 && Number(a("ry")) > 0 : el.tagName === "circle" ? Number(a("r")) > 0 : true;
        const shown = a("opacity") === null || Number(a("opacity")) > 0;
        return sized && shown ? i : -1;
      })
      .filter((i) => i >= 0)
      .join(",");
  });

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

/**
 * Everything the responsive layout promises, on the screen as it is now: nothing outside the
 * screen, nothing cut short inside its own box, nothing over anything, no scroll, every control at
 * least 44 px, no caption under 12 px, the status line at most two lines, and on a turn the last word and the next letter the biggest words on the screen and
 * big for the screen. Returns a list of what is wrong, and the sizes it measured.
 */
const layoutFaults = (page, turn) =>
  page.evaluate((turn) => {
    const bad = [];
    const W = innerWidth;
    const H = innerHeight;
    const shown = (el) => {
      if (!el || el.closest("[hidden]") || !el.getClientRects().length) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const name = (el) => el.id || String(el.className?.baseVal ?? el.className).split(" ")[0] || el.tagName;
    const se = document.scrollingElement;
    if (se.scrollWidth > W + 0.5 || se.scrollHeight > H + 0.5) bad.push(`the page scrolls (${se.scrollWidth}x${se.scrollHeight})`);
    const paused = !document.getElementById("g-paused").hidden;
    const scope = paused ? "#g-paused" : ".gi";
    // Inside the screen.
    const texts = [...document.querySelectorAll(`${scope} :is(button, input, output, .status, .tag, .holder, .up, .logo, .kicker, .lede, .chain, .lbl, .after, .heard, .keys, .dead, .cat, .life, .fuse, .note, .flabel, h2, .pnote)`)].filter(shown);
    for (const el of texts) {
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) bad.push(`outside: ${name(el)} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    // Not cut short inside its own box (an ellipsis, or text hidden by overflow).
    for (const el of document.querySelectorAll(`${scope} :is(.after, .holder b, .up b, .logo, .cat, .cap-t, .cap, .plate, .tag span)`)) {
      if (!shown(el)) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible") bad.push(`cut short: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    // Nothing over anything.
    const parts = [...document.querySelectorAll(`${scope} :is(button, input, .status, .tag, .holder, .up, .after, .heard, .keys, .dead, .lastword .lbl, .need .lbl, .cat, .life, .lifelbl, .fuse, .logo, .lede, .chips, .stepper, .note, .chain, .flabel)`)].filter((el) => shown(el) && !el.closest(".sr") && getComputedStyle(el).position !== "absolute");
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
        const a = parts[i].getBoundingClientRect();
        const b = parts[j].getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 2 && y > 2) bad.push(`overlap: ${name(parts[i])} / ${name(parts[j])} (${Math.round(x)}x${Math.round(y)})`);
      }
    // Every control big enough to hit: 44 px both ways at least (WCAG 2.5.5, Apple's own guide).
    for (const el of document.querySelectorAll(`${scope} :is(button, input)`)) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 43.5) bad.push(`small control: ${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // No text in the strip smaller than 12 px (the microphone's caption is the smallest).
    for (const el of document.querySelectorAll(`${scope} .cap-t`)) {
      if (shown(el) && parseFloat(getComputedStyle(el).fontSize) < 11.95) bad.push(`small caption: ${name(el)} ${getComputedStyle(el).fontSize}`);
    }
    // The status line (a verdict and its reason) is at most two lines, and none of it is cut off.
    const st = document.getElementById("g-status");
    if (shown(st) && !st.classList.contains("quiet") && st.textContent.trim()) {
      const text = st.querySelector("span:not(.mark)") ?? st;
      const lines = Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight));
      if (lines > 2) bad.push(`the status line runs to ${lines} lines`);
      // (Half a line of slack: the display face's ascent pokes out of its line box a little.)
      if (text.scrollHeight > text.clientHeight + parseFloat(getComputedStyle(text).lineHeight) / 2) bad.push(`the status line is cut off (${text.scrollHeight} > ${text.clientHeight})`);
    }
    // The potato is the biggest thing on the screen. His rig's box (all that is drawn: potato,
    // clamps, antennas, tubes, tray) at the calm stage takes at least: 85% of the width on an
    // upright phone (where the width is the limit), 48% of the height on a tablet upright and on a
    // wide screen, and 28% of the height on a phone on its side (the fallback).
    const drawn = (el) => {
      for (let a = el; a && a.tagName !== "svg"; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (Number(cs.opacity) < 0.01 || cs.display === "none") return false;
      }
      const r = el.getBoundingClientRect();
      return r.width >= 1 || r.height >= 1;
    };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of document.querySelectorAll("#pot [data-part]")) {
      if (el.tagName === "g" || el.closest('[data-part="boom"]') || !drawn(el)) continue;
      const r = el.getBoundingClientRect();
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    const layout = W < H ? (W < 600 ? "phone" : "tablet") : H < 500 ? "sideways" : "wide";
    const rig = { w: (x1 - x0) / W, h: (y1 - y0) / H, layout };
    const g = window.__hotPotato.round();
    if (turn && !paused && g && g.stage === 0) {
      // (A tall portrait screen is limited by its width, as a phone is: the full width then does.)
      const want = { phone: 0.85, tablet: 0.48, wide: 0.48, sideways: 0.28 }[layout];
      const ok = layout === "phone" ? rig.w >= want : rig.h >= want || (layout === "tablet" && rig.w >= 0.85);
      if (!ok) bad.push(`the potato is small for the screen (rig ${Math.round(rig.w * 100)}% of the width, ${Math.round(rig.h * 100)}% of the height on a ${layout})`);
    }
    // He himself (body, face, sprouts), the bulbs and the tray's lights stay on screen at every
    // stage; only the rig's outer parts (tubes, clamp ends, tray corners) may run off the sides.
    for (const el of document.querySelectorAll('#pot [data-part="spud"] [data-part], #pot [data-part^="bulb"], #pot [data-part^="light"]')) {
      if (el.tagName === "g" || !drawn(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) bad.push(`off the screen: ${el.dataset.part}`);
    }
    const size = (el) => (el && shown(el) ? parseFloat(getComputedStyle(el).fontSize) : 0);
    // The end screen's stats line runs over the potato's bulbs and the burst: it sits on its own
    // dark panel, and its text has at least 7:1 on that panel.
    const stats = document.getElementById("e-stats");
    if (shown(stats) && stats.textContent.trim()) {
      const rgba = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const [br, bg, bb, ba = 1] = rgba(getComputedStyle(stats).backgroundColor);
      const [fr, fg, fb] = rgba(getComputedStyle(stats).color);
      const lum = (r, g, b) => [r, g, b].map((c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (Math.max(lum(fr, fg, fb), lum(br, bg, bb)) + 0.05) / (Math.min(lum(fr, fg, fb), lum(br, bg, bb)) + 0.05);
      if (!(ba >= 0.8 && ratio >= 7)) bad.push(`the end stats have no readable backing (panel alpha ${ba}, ${ratio.toFixed(1)}:1)`);
    }
    const go = document.getElementById("g-go");
    const goBox = shown(go) ? go.getBoundingClientRect() : null;
    const out = { word: 0, rig, mic: goBox && { x: `${goBox.left.toFixed(1)}+${goBox.width.toFixed(1)}`, y: `${goBox.top.toFixed(1)}+${goBox.height.toFixed(1)}` } };
    if (turn && !paused) {
      // The word to follow is the biggest text in the strip and readable: at least 6% of the
      // screen's shorter side and 24 px.
      out.word = size(document.getElementById("g-after"));
      const others = [...document.querySelectorAll(".bot :is(.up, .up b, .status, .heard, .cap-t, .dead, .keys, button, input)")].filter(shown);
      const biggest = Math.max(0, ...others.map(size));
      if (out.word && out.word < biggest) bad.push(`the word (${out.word}px) is smaller than other text in the strip (${biggest}px)`);
      if (out.word && out.word < Math.max(24, Math.min(W, H) * 0.06)) bad.push(`the word is small for the screen (${out.word}px on ${W}x${H})`);
      // What is heard, and the verdict's reason, are shown in full when there are any.
      for (const id of ["g-heard", "g-status"]) {
        const el = document.getElementById(id);
        if (!el.textContent.trim() || el.classList.contains("quiet")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 10 || el.scrollWidth > el.clientWidth + 1) bad.push(`${id} is not shown in full (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }
    return { bad, ...out };
  }, turn);

/**
 * In a normal listening turn the strip holds only its three things (whose turn, the microphone, the
 * word to follow, with what is heard in its reserved line and the keys where there is a keyboard),
 * and there is no way to type: no typing control shown, focusable or in the accessibility tree.
 */
const onlyThree = async (page) => {
  const extra = await page.evaluate(() =>
    [...document.querySelectorAll(".bot-turn *")]
      .filter((el) => el.getClientRects().length && !el.closest(".sr") && getComputedStyle(el).visibility !== "hidden")
      .filter((el) => !el.matches(".ask") && !el.closest(".up, .spot, .lastword, .heard, .keys, .status.quiet, .say"))
      .map((el) => el.id || el.className),
  );
  const typing = await page.evaluate(() => ({
    type: Boolean(document.getElementById("g-type")),
    box: (() => {
      const el = document.getElementById("g-word");
      el.focus();
      return document.activeElement === el || el.getClientRects().length > 0;
    })(),
  }));
  const tree = await page.locator("body").ariaSnapshot();
  return { extra, typing: typing.type || typing.box || /textbox|Your word/i.test(tree) };
};

const PHONES = ["320x568", "360x640", "390x844", "430x932", "568x320", "667x375", "844x390", "932x430", "768x1024", "1024x768", "820x1180"];
const DESKTOPS = ["1280x720", "1366x768", "1440x900", "1920x1080", "2560x1080", "1080x1920"];
const dims = (s) => {
  const [width, height] = s.split("x").map(Number);
  return { width, height };
};

const ONLY = arg("only", "");

// R. A microphone that is on but hears nothing, a recogniser that never says a final word, and the
//    word box with the on-screen keyboard up. Answers are spoken: the word box comes up by itself
//    only when the microphone cannot be used, never as a choice.
{
  /** A turn in which the recogniser runs and hears nothing: the fuse is cut short once it is lit. */
  const deafTurn = async (page) => {
    await waitReady(page);
    await page.tap("#g-go");
    await page.waitForFunction(() => window.__hotPotato.round().lit);
    const box = await page.isVisible("#g-typed");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__hotPotato.round().fuse = 30;
    });
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen");
    return box;
  };
  const DEAF = /microphone hears nothing/i;
  task("fallback", "muted microphone", async () => {
    const { context, page, errors } = await open({ width: 390, height: 844 });
    await start(page, "cities", 3);
    // Two turns in a row with the microphone on and nothing heard: no box yet.
    const early = [await deafTurn(page), await deafTurn(page)];
    check(early.every((b) => !b), `a muted microphone: no word box in the first two silent turns (${early.join(", ")})`);
    // The third: the word box comes up by itself, says why, and has the keyboard.
    await waitReady(page);
    const starts = await page.evaluate(() => window.__starts);
    await page.tap("#g-go");
    await page.waitForSelector("#g-typed:not([hidden])", { timeout: 3000 }).catch(() => {});
    const note = await page.textContent("#g-status");
    check(await page.isVisible("#g-typed"), "a muted microphone: after two silent turns in a row the word box comes up by itself");
    check(DEAF.test(note) && /type any city, or check the mic/i.test(note), `and says why in plain words ("${note.trim()}")`);
    check(await page.evaluate(() => document.activeElement?.id === "g-word"), "and the word box has the keyboard");
    check((await page.evaluate(() => window.__starts)) > starts, "the microphone still listens while the box is up");
    await page.screenshot({ path: `${SHOTS}/390-muted-mic-box.png` });
    if (!(await page.isVisible("#g-typed"))) {
      check(false, "a muted microphone: with no word box the turn cannot be played (the rest of this check is skipped)");
      await context.close();
      return;
    }
    // The on-screen keyboard up (the page is resized by it: interactive-widget=resizes-content):
    // the word box, the word to follow and whose turn stay on screen and clear of each other.
    const meta = await page.getAttribute('meta[name="viewport"]', "content");
    check(/interactive-widget=resizes-content/.test(meta), `the page asks to be resized by the on-screen keyboard (${meta})`);
    for (const [w, h] of [[390, 480], [360, 360], [320, 300]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const kbd = await page.evaluate(() => {
        const out = [];
        const ids = ["g-word", "g-send", "g-after", "g-up-name", "g-status"];
        const rs = ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]);
        for (const [id, r] of rs) if (!r.width || !r.height || r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) out.push(`${id} not on screen ${Math.round(r.top)}..${Math.round(r.bottom)}`);
        for (let i = 0; i < rs.length; i++)
          for (let j = i + 1; j < rs.length; j++) {
            const [a, b] = [rs[i][1], rs[j][1]];
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push(`${rs[i][0]} over ${rs[j][0]}`);
          }
        if (document.scrollingElement.scrollHeight > innerHeight + 0.5) out.push("the page scrolls");
        return out;
      });
      check(kbd.length === 0, `${w}x${h} with the keyboard up: the word box, the word and whose turn are on screen ${kbd.join(" | ")}`);
      await page.screenshot({ path: `${SHOTS}/${w}x${h}-keyboard-word-box.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // A typed word counts; the microphone is still deaf, so the next turn brings the box up again.
    await page.fill("#g-word", "Paris");
    await page.keyboard.press("Enter");
    await waitPhase(page, "ready");
    check((await round(page)).chain.includes("Paris"), "the typed word counts");
    // Speech again: the box goes the moment speech is heard, and the word counts by voice.
    await waitReady(page);
    await page.evaluate(() => window.__turns.push([[1200, "interim", "Sev"], [400, "final", [["Seville", 0.9]]]]));
    await page.tap("#g-go");
    await page.waitForSelector("#g-typed:not([hidden])", { timeout: 3000 }).catch(() => {});
    const boxAgain = await page.isVisible("#g-typed");
    await page.waitForFunction(() => /Sev/i.test(document.getElementById("g-heard").textContent), null, { timeout: 5000 }).catch(() => {});
    const boxWhileSpeaking = await page.isVisible("#g-typed");
    const listening = await page.isVisible("#g-listening");
    await waitPhase(page, "ready");
    check(boxAgain && !boxWhileSpeaking && listening, `still deaf, the box is up again; the moment speech is heard it goes and the microphone shows (box ${boxAgain}, then ${boxWhileSpeaking}; listening ${listening})`);
    check((await round(page)).chain.at(-1) === "Seville", "and the spoken word counts");
    check(!(await deafTurn(page)), "after speech, one silent turn does not bring the box back");
    check(errors.length === 0, `muted microphone: no console errors ${errors.join(" | ")}`);
    await context.close();
  });
  // A new round starts on voice: the count of silent turns does not carry over.
  task("fallback", "new round on voice", async () => {
    const { context, page, errors } = await open({ width: 390, height: 844 });
    await start(page, "cities", 2);
    await deafTurn(page);
    await deafTurn(page);
    await page.tap("#g-pause");
    await page.tap("#p-quit");
    await page.click("#s-start");
    await waitPhase(page, "ready");
    check(!(await deafTurn(page)), "a muted microphone: the next round starts on voice again");
    check(errors.length === 0, `new round: no console errors ${errors.join(" | ")}`);
    await context.close();
  });
  // A quiet pause is not a deaf microphone: a session that ends in silence, then the word, in one
  // turn; and silent turns that are not in a row.
  task("fallback", "quiet pause", async () => {
    const { context, page, errors } = await open({ width: 390, height: 844 });
    await start(page, "cities", 3);
    await waitReady(page);
    await page.evaluate(() => window.__turns.push([[3000, "error", "no-speech"]], [[600, "interim", "Lim"], [300, "final", [["Lima", 0.9]]]]));
    await page.tap("#g-go");
    let seen = false;
    while ((await round(page)).phase === "listen") {
      seen = seen || (await page.isVisible("#g-typed"));
      await page.waitForTimeout(150);
    }
    check(!seen && (await round(page)).chain.includes("Lima"), `a quiet pause inside one turn: the word box never comes up, and the word after it counts (${(await round(page)).chain.join(", ")})`);
    const pattern = [await deafTurn(page)];
    await waitReady(page);
    await page.evaluate(() => window.__turns.push([[300, "interim", "Ath"], [200, "final", [["Athens", 0.9]]]]));
    await page.tap("#g-go");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen");
    pattern.push(await deafTurn(page), await deafTurn(page));
    check(pattern.every((b) => !b), `silent turns not in a row never bring up the box (${pattern.join(", ")})`);
    check(errors.length === 0, `quiet pause: no console errors ${errors.join(" | ")}`);
    await context.close();
  });
  // A recogniser that hears the word but never says it is final (Safari can end that way): what it
  // heard is judged, and the turn does not run out of time.
  task("fallback", "partial words", async () => {
    const { context, page, errors } = await open({ width: 390, height: 844 });
    await start(page, "cities", 2);
    await waitReady(page);
    await page.evaluate(() => window.__turns.push([[300, "interim", "Pa"], [300, "interim", "Paris"]]));
    const t0 = Date.now();
    await page.tap("#g-go");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 15000 });
    const r = await round(page);
    check(r.chain.includes("Paris") && r.last.ok && Date.now() - t0 < 4000, `partial words only: "Paris" is judged and taken after ${Date.now() - t0} ms, not timed out (${JSON.stringify(r.last)})`);
    // And a partial that is not a city is refused for what it is, not "too slow".
    await waitReady(page);
    await page.evaluate(() => window.__turns.push([[300, "interim", "table"]]));
    await page.tap("#g-go");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 15000 });
    const r2 = await round(page);
    check(!r2.last.ok && r2.last.reason !== "slow", `a partial word that is wrong is refused for what it is (${r2.last.reason}: ${r2.last.why})`);
    check(errors.length === 0, `partial words: no console errors ${errors.join(" | ")}`);
    await context.close();
  });
}

// 0. The responsive layout, at every size it is designed for, on every key screen: phones and
//    tablets (touch) in one round, laptops, desktops and the extremes (mouse and keyboard) in
//    another. The window is resized in place for each size, so this is also a resize in the middle
//    of every screen: the round goes on untouched.
for (const [kind, sizes] of [["touch", PHONES], ["desktop", DESKTOPS]]) task("layout", `${kind} layout walk`, async () => {
  const touch = kind === "touch";
  const first = dims(sizes[0]);
  const context = await browser.newContext({ viewport: first, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, ...(touch ? { userAgent: PIXEL } : {}) });
  const { page, errors } = await open(first, [fake], { context });
  await page.evaluate(() => document.fonts.ready);
  const sizes_ = {};
  const mics = {}; // where the go button is on the ready screen, by size
  /**
   * Walks every size on the screen as it is now and checks it. With `micAs`, the go button has not
   * moved up or down since the ready screen (the strip kept its height); with `same` also not
   * sideways (the word beside it is the same, so the pair is as wide).
   */
  const walk = async (what, turn = true, micAs = "", same = false) => {
    const keep = await round(page);
    const t0 = Date.now();
    for (const s of sizes) {
      await page.setViewportSize(dims(s));
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const { bad, word, rig, mic } = await layoutFaults(page, turn);
      check(bad.length === 0, `${s} ${what}: fits ${bad.slice(0, 4).join(" | ")}`);
      if (what === "ready") mics[s] = mic;
      if (micAs) {
        const was = mics[s];
        const moved = !mic || !was || mic.y !== was.y || (same && mic.x !== was.x);
        check(!moved, `${s} ${what}: the microphone has not moved since the ${micAs} screen (${was?.x},${was?.y} then ${mic?.x},${mic?.y})`);
      }
      (sizes_[s] ??= []).push(`${what}: rig ${Math.round(rig.w * 100)}% w ${Math.round(rig.h * 100)}% h${word ? `, word ${Math.round(word)}px` : ""}`);
    }
    if (Date.now() - t0 > 4000) console.log(`     (the ${what} walk took ${Date.now() - t0} ms)`);
    const now = await round(page);
    if (keep) check(now.phase === keep.phase && now.turns === keep.turns && now.stage === keep.stage && now.holder === keep.holder, `${kind} ${what}: resizing does not touch the round (${keep.phase} turn ${keep.turns}, then ${now.phase} turn ${now.turns})`);
    await page.setViewportSize(first);
  };
  await walk("start", false);
  await start(page, "cities", 3);
  await walk("ready");
  // The go button's name for screen readers and voice control starts with the words it shows.
  const goName = await page.evaluate(() => ({ shown: document.getElementById("g-go-text").textContent.trim(), name: document.getElementById("g-go").getAttribute("aria-label") ?? "" }));
  check(goName.shown && goName.name.toLowerCase().startsWith(goName.shown.toLowerCase()), `${kind}: the go button's name starts with its visible words ("${goName.name}" shows "${goName.shown}")`);
  // A long verdict: the strip keeps its height, so the microphone stays exactly where it was.
  await say(page, word("Onomatopoeiaville Extraordinaire", 0.9));
  await page.waitForFunction(() => !document.getElementById("game").dataset.react, null, { timeout: 5000 });
  await walk("long verdict", true, "ready", true);
  // Listening: a word half heard, the fuse burning (a slow speaker: 9 s before the word ends).
  await page.evaluate(() => window.__turns.push([[200, "interim", "Los Ang"], [9000, "final", [["Los Angeles", 0.9]]]]));
  await page.click("#g-go");
  await page.waitForFunction(() => /Los/.test(document.getElementById("g-heard").textContent));
  const fuseBefore = (await round(page)).fuse;
  const three = await onlyThree(page);
  check(three.extra.length === 0 && !three.typing, `${kind}: listening, the strip holds only whose turn, the microphone and the word (and what is heard), with no way to type (${three.extra.join(", ")}${three.typing ? " a typing control" : ""})`);
  await walk("listening");
  const fuseAfter = await round(page);
  check(fuseAfter.phase === "listen" && fuseAfter.lit && fuseAfter.fuse < fuseBefore, `${kind}: through every resize the turn kept listening and the fuse kept burning (${Math.round(fuseBefore)} then ${Math.round(fuseAfter.fuse)} ms)`);
  await waitPhase(page, "ready", 15000);
  // A refusal with its appeal (once the big verdict has gone).
  await say(page, word("Salmon", 0.4));
  await page.waitForFunction(() => !document.getElementById("game").dataset.react, null, { timeout: 5000 });
  check(await page.isVisible("#g-appeal"), `${kind}: the refusal offers its appeal`);
  await walk("verdict", true, "ready");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-paused:not([hidden])");
  await walk("paused");
  await page.click("#p-resume");
  // The last stage, listening (its fuse is 6 seconds: the walk takes about two).
  while ((await round(page)).stage < 4) await say(page, word("table"));
  await waitReady(page);
  await page.evaluate(() => window.__turns.push([[200, "interim", "Mad"], [8000, "final", [["Zzzz", 0.9]]]]));
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1200);
  await walk("last stage");
  await waitPhase(page, "doom", 15000);
  await waitPhase(page, "burst", 5000);
  await page.waitForTimeout(900);
  await walk("burst", false);
  await waitPhase(page, "over", 6000);
  await page.waitForTimeout(1500);
  await walk("end", false);
  // Where listening cannot work (here the microphone is refused): a typed turn.
  await page.click("#e-again");
  await waitReady(page);
  await page.evaluate(() => window.__turns.push([[30, "error", "not-allowed"]]));
  await page.click("#g-go");
  await page.waitForSelector("#g-typed:not([hidden])");
  await page.fill("#g-word", "Lisbon");
  await walk("typed");
  for (const [s, list] of Object.entries(sizes_)) console.log(`     ${s}: ${list.join("; ")}`);
  check(errors.length === 0, `${kind} layout walk: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 0b. Turning a phone in the middle of a listening turn, and resizing a desktop window: the turn
//     goes on, the fuse keeps burning, and the potato refits its new box at once.
for (const [kind, from, to] of [["phone turned", "390x844", "844x390"], ["phone turned back", "844x390", "390x844"], ["window resized", "1280x720", "900x700"], ["window maximised", "1024x640", "1920x1080"]]) task("layout", kind, async () => {
  const phone = kind.startsWith("phone");
  const { context, page, errors } = await open(dims(from), [fake], { phone });
  await start(page, "animals", 2);
  await waitReady(page);
  await page.evaluate(() => window.__turns.push([[200, "interim", "Ele"], [6000, "final", [["elephant", 0.9]]]]));
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(500);
  const a = await round(page);
  const starts = await page.evaluate(() => window.__starts);
  await page.setViewportSize(dims(to));
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  // The drawing's scale follows its new box: his frame (253 by 278 units, style.css) as large as fits.
  const fit = await page.evaluate(() => {
    const pot = document.getElementById("pot").getBoundingClientRect();
    const svg = document.querySelector("#pot svg").getBoundingClientRect();
    const s = Math.min((pot.width - 4) / 253, (pot.height - 4) / 278);
    return { pot: [pot.width, pot.height], svg: [svg.width, svg.height], want: 292 * s };
  });
  const { bad } = await layoutFaults(page, true);
  await page.waitForTimeout(400);
  const b = await round(page);
  check(b.phase === "listen" && b.turns === a.turns && b.lit && b.fuse < a.fuse && (await page.evaluate(() => window.__starts)) === starts, `${kind} (${from} to ${to}) mid-turn: still the same listening turn, the fuse still burning (${Math.round(a.fuse)} then ${Math.round(b.fuse)} ms), listening not restarted`);
  // (layoutFaults also checks that the drawing fills its new box.)
  check(Math.abs(fit.svg[1] - fit.want) < 2, `${kind}: the potato refits its new box (${fit.svg.map(Math.round).join("x")}, want ${Math.round(fit.want)} high, in ${fit.pot.map(Math.round).join("x")})`);
  check(bad.length === 0, `${kind}: the new layout fits ${bad.slice(0, 4).join(" | ")}`);
  await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 15000 });
  check((await round(page)).chain.includes("elephant"), `${kind}: the word said across the change counts`);
  check(errors.length === 0, `${kind}: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 1. Layout: the start screen, a turn listening, a verdict with its appeal, the pause and the end,
//    at an upright phone, a small phone, a sideways phone and a desktop window.
const SIZES = [
  ["390x844", { width: 390, height: 844 }],
  ["320x568", { width: 320, height: 568 }],
  ["568x320", { width: 568, height: 320 }],
  ["844x390", { width: 844, height: 390 }],
  ["1280x720", { width: 1280, height: 720 }],
];
for (const [name, viewport] of SIZES) task("rest", `${name} screens`, async () => {
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
  // On the start screen the potato rests: once drawn, nothing is redrawn.
  await page.waitForTimeout(500);
  const idle = await page.evaluate(() => window.__hotPotato.art.look());
  await page.waitForTimeout(1000);
  const idleLater = await page.evaluate(() => window.__hotPotato.art.look());
  check(idleLater.draws === idle.draws && !idleLater.running, `${name}: the start screen does not redraw the potato every frame (${idle.draws} then ${idleLater.draws} draws)`);
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
  await page.focus("#g-appeal");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#g-paused:not([hidden])");
  await look("paused");
  // The pause holds the keyboard: Tab never reaches the game behind it.
  const inside = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    inside.push(await page.evaluate(() => Boolean(document.activeElement?.closest("#g-paused")) || document.activeElement === document.body));
  }
  const reachable = await page.evaluate(() => document.querySelector(".gi").inert);
  check(inside.every(Boolean) && reachable, `${name}: Tab stays in the pause box; the game behind it is inert`);
  // Paused, the potato is not redrawn.
  const pausedDraws = await page.evaluate(() => window.__hotPotato.art.look().draws);
  await page.waitForTimeout(700);
  check((await page.evaluate(() => window.__hotPotato.art.look().draws)) === pausedDraws, `${name}: paused, the potato is not redrawn`);
  await page.click("#p-resume");
  check(await page.evaluate(() => document.activeElement?.id === "g-appeal"), `${name}: after the pause the keyboard is back where it was (${await page.evaluate(() => document.activeElement?.id)})`);
  for (let i = 0; i < 4; i++) await say(page, word("hello"));
  await waitPhase(page, "over", 12000);
  await page.waitForTimeout(2500);
  await look("end");
  check(await page.isVisible("#e-stats"), `${name}: the end screen says how long it lasted`);
  const endDraws = await page.evaluate(() => window.__hotPotato.art.look().draws);
  await page.waitForTimeout(700);
  check((await page.evaluate(() => window.__hotPotato.art.look().draws)) === endDraws, `${name}: on the end screen, once the burst has settled, the potato is not redrawn`);
  check(errors.length === 0, `${name}: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 2. A whole round of cities on a phone, by voice and taps, to the burst, with a still of every
//    stage of the potato.
task("rest", "phone round", async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 });
  await start(page, "cities", 3);
  const faces = [];
  const parts = [];
  const stillAndFace = async (name) => {
    parts.push(await still(page, name));
    faces.push(await page.evaluate(() => window.__hotPotato.art.look().face));
  };
  await stillAndFace("potato-stage-0");
  let r = await say(page, word("Los Angeles"), "tap");
  check(r.last.ok && r.need === "s" && r.holder === 1, `Los Angeles accepted, the next city needs an S, Player 2 holds it (${JSON.stringify(r.last)})`);
  const happy = await page.evaluate(() => window.__hotPotato.art.look());
  check(happy.reaction === "right" && REACTIONS.right.some((x) => x.id === happy.face), `a right word: a happy, relieved face for a moment (${happy.reaction}, ${happy.face})`);
  check((await page.textContent("#g-letter")) === "S", "the giant letter shows S");
  check((await page.textContent("#g-after")) === "Los Angeles" && (await page.textContent("#g-after b")) === "s" && (await page.textContent("#g-cat")) === "Cities", `the last word shows what came before, its last letter boxed, under the category (${await page.innerHTML("#g-after")})`);
  r = await say(page, [[250, "interim", "Sid"], [300, "final", [["Sidnee", 0.62], ["Sydney", 0.55]]]], "tap");
  check(r.last.ok && r.chain.at(-1) === "Sydney", "Sydney from the recogniser's second guess");
  r = await say(page, word("salmon"), "tap");
  check(!r.last.ok && r.stage === 1 && r.holder === 0, `salmon refused, it gets worse, and passes to Player 1 (${r.last.why})`);
  const flinch = await page.evaluate(() => window.__hotPotato.art.look());
  check(flinch.reaction === "wrong" && REACTIONS.wrong.some((x) => x.id === flinch.face) && (await page.getAttribute("#game", "data-react")) === "wrong", `a wrong word: it flinches, and the screen says Nope (${flinch.reaction}, ${flinch.face})`);
  await page.waitForTimeout(350);
  await page.locator("#pot").screenshot({ path: `${SHOTS}/potato-steam.png` });
  check(/"Salmon" is not a city/.test(await page.textContent("#g-status")), "the verdict says plainly why");
  await stillAndFace("potato-stage-1");
  r = await say(page, word("Paris"), "tap");
  check(!r.last.ok && r.last.reason === "wrong-letter" && r.stage === 2, "Paris on a Y is refused: wrong letter");
  await stillAndFace("potato-stage-2");
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
  await stillAndFace("potato-stage-3");
  // Silence: the fuse burns down (9 seconds at stage 3... it is 7 at stage 3).
  const fuseStart = Date.now();
  await waitReady(page);
  await page.tap("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(1200);
  const mid = await round(page);
  check(mid.fuse < mid.fuseMax - 900 && mid.phase === "listen", `the fuse burns while listening (${Math.round(mid.fuse)} of ${mid.fuseMax} ms)`);
  await page.locator(".game").screenshot({ path: `${SHOTS}/390-listening-stage-3.png` });
  // Stressed, the potato trembles inside its rig, but the screen, the layout, the text and the
  // potato's box never move.
  const motion = await page.evaluate(async () => {
    const out = { screen: [], spud: [], boxes: new Set() };
    for (let i = 0; i < 24; i++) {
      await new Promise((ok) => requestAnimationFrame(ok));
      for (const sel of [".game", ".gi", ".top", ".bot", ".pot", "#pot svg", ".up", ".bar", ".ask", ".tag"]) {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        // Its place, size and transform (the slanted type keeps its fixed slant) never change.
        out.boxes.add(`${sel} ${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)} ${getComputedStyle(el).transform}`);
      }
      for (const sel of [".game", ".gi", ".pot", "#pot svg"]) {
        const t = getComputedStyle(document.querySelector(sel)).transform;
        if (t !== "none") out.screen.push(`${sel} ${t}`);
      }
      out.spud.push(document.querySelector('#pot [data-part="spud"]')?.getAttribute("transform") ?? "");
    }
    return { screen: out.screen, spud: out.spud, boxes: out.boxes.size };
  });
  const poses = motion.spud.map((s) => s.match(/^translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+) 0 -74\) skewX\((-?[\d.]+)\) scale\(([\d.]+) ([\d.]+)\) translate\(-120 -196\.8\)$/));
  check(motion.screen.length === 0 && motion.boxes === 10, `the screen, the layout and the potato's box never move (${motion.screen.slice(0, 2).join(" | ")}; ${motion.boxes} boxes for 10 elements)`);
  check(poses.every((m) => m && Math.abs(+m[1] - 120) <= 5 && Math.abs(+m[2] - 196.8) <= 3 && Math.abs(+m[3]) <= 4 && +m[5] > 0.5 && +m[5] < 1.4 && +m[6] > 0.5 && +m[6] < 1.4) && new Set(motion.spud).size > 1, `the potato trembles in place, inside its rig (${motion.spud[0]})`);
  const listening = await page.evaluate(() => window.__hotPotato.art.look());
  check(FACES.strain.some((x) => x.id === listening.face), `listening at the strain stage it keeps a strain face (${listening.face})`);
  // The stress within the stage climbs while the fuse burns, and the fuse warms with it.
  const stressNow = await page.evaluate(() => ({ s: window.__hotPotato.art.look().stress, css: Number(getComputedStyle(document.getElementById("game")).getPropertyValue("--stress")) }));
  await page.waitForTimeout(1500);
  const stressLater = await page.evaluate(() => ({ s: window.__hotPotato.art.look().stress, css: Number(getComputedStyle(document.getElementById("game")).getPropertyValue("--stress")) }));
  check(stressLater.s > stressNow.s + 0.1 && stressLater.css > stressNow.css, `a slow turn gets the potato more stressed, and the fuse and the life at risk show it (${stressNow.s.toFixed(2)} then ${stressLater.s.toFixed(2)}; --stress ${stressNow.css} then ${stressLater.css})`);
  await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen", null, { timeout: 15000 });
  r = await round(page);
  const took = Date.now() - fuseStart;
  check(r.last.reason === "slow" && r.stage === 4 && took >= 6500, `silence: too slow after the 7-second fuse (${took} ms), last life`);
  check(/Too slow/.test(await page.textContent("#g-status")), "the verdict says Too slow");
  check(!(await page.isVisible("#g-appeal")), "no appeal for silence");
  await stillAndFace("potato-stage-4");
  check(parts.every((p) => p === parts[0]) && parts[0].split(",").length > 40 && !parts[0].includes("MISSING"), `every stage draws the same parts of the potato: nothing first appears as it grows (${parts.map((p) => p.split(",").length).join(", ")} parts)`);
  check(faces.every((f, stage) => FACES[HEATS[stage]].some((x) => x.id === f)), `its face follows the stage, one of the stage's own each time (${faces.join(", ")})`);
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
  check(r.holder === 1, `and the next player along starts it (Player ${r.holder + 1})`);
  await still(page, "potato-again");
  await page.click("#g-pause");
  await page.click("#p-quit");
  check((await page.getAttribute("#game", "data-screen")) === "start", "End this round goes back to the setup");
  check(errors.length === 0, `phone round: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 3. Animals on a desktop with the keyboard: a dead end, a plural, then misses to the burst; the
//    choice of category and players is remembered.
task("rest", "desktop keyboard round", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const { page, errors } = await open({ width: 1280, height: 720 }, [fake], { context });
  await start(page, "animals", 2);
  check((await page.textContent("#g-after")) === "Any animal" && (await page.textContent("#g-need")) === "Start with" && (await page.textContent("#g-letter")) === "Any", "the first turn asks for any animal");
  let r = await say(page, word("monkey"), "Space");
  check(r.last.ok && r.need === "e", "Space starts a turn; after monkey (Y is a dead end) comes an E");
  check(/Y is a dead end, so E/.test(await page.textContent("#g-dead")) && (await page.innerHTML("#g-after")) === "monk<b>e</b>y", `the last word boxes the E and says Y is a dead end (${await page.innerHTML("#g-after")})`);
  check(/Y is a dead end, so E/.test(await page.textContent("#g-status")), "and so does the verdict");
  r = await say(page, word("eagles"), "Enter");
  check(r.last.ok && r.chain.at(-1) === "eagle" && r.need === "e", "Enter starts a turn; eagles is eagle, and the chain goes on from eagle");
  await still(page, "1280-potato-stage-0");
  for (let i = 0; i < 5; i++) {
    r = await say(page, word("table"), "Space");
    if (i === 0) {
      await page.waitForTimeout(350);
      await page.locator("#pot").screenshot({ path: `${SHOTS}/1280-potato-steam.png` });
    }
    if (i < 4) await still(page, `1280-potato-stage-${i + 1}`);
  }
  check(r.phase === "doom", "five misses: it is going to burst");
  await waitPhase(page, "burst", 5000);
  await page.waitForTimeout(350);
  await page.locator("#pot").screenshot({ path: `${SHOTS}/1280-potato-burst-0.35s.png` });
  await waitPhase(page, "over", 8000);
  await page.waitForTimeout(1500);
  await page.locator("#pot").screenshot({ path: `${SHOTS}/1280-potato-burst.png` });
  await page.screenshot({ path: `${SHOTS}/1280-end.png` });
  check((await page.textContent("#e-who")) === "Player 1", "it burst on Player 1");
  check(errors.length === 0, `animals: no console errors ${errors.join(" | ")}`);
  await page.close();
  // Remembered on this device.
  const again = await open({ width: 1280, height: 720 }, [fake], { context });
  check((await again.page.getAttribute('#s-cats [data-cat="animals"]', "aria-pressed")) === "true" && (await again.page.textContent("#s-n")) === "2", "the category and the number of players are remembered");
  await context.close();
});

// 4. Pause and a hidden page: the fuse waits, listening stops, and starts again on Go on.
task("rest", "pause and hidden page", async () => {
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
  await page.evaluate(() => window.__turns.push([[100, "interim", "Ger"], [200, "final", [["Germany", 0.9]]]]));
  await page.click("#p-resume");
  await page.waitForFunction(() => window.__hotPotato.round().phase === "ready", null, { timeout: 10000 });
  const f = await round(page);
  check(f.chain.at(-1) === "Germany" && f.need === "n", `after Go on the word is heard again (Germany; Y is a dead end, so N: ${f.need})`);
  check(errors.length === 0, `pause: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 5. No speech recognition (Firefox): it says so and the round is played by typing.
task("rest", "no speech recognition", async () => {
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
  // Nothing readable typed: refused, and no "that was right" (it would put a blank word in the chain).
  await waitReady(page);
  await page.tap("#g-go");
  await page.fill("#g-word", "???");
  await page.keyboard.press("Enter");
  await waitPhase(page, "ready");
  r = await round(page);
  check(!r.last.ok && !(await page.isVisible("#g-appeal")) && r.chain.join("|") === "Paris", `"???" is refused with no appeal, and the chain keeps only real words (${r.chain.join(", ")})`);
  // The round can be finished by typing alone.
  const typeMiss = async () => {
    await waitReady(page);
    await page.tap("#g-go");
    await page.waitForSelector("#g-typed:not([hidden])");
    await page.fill("#g-word", "table");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen");
  };
  while ((await round(page)).phase === "ready") await typeMiss();
  await waitPhase(page, "over", 10000);
  check((await page.getAttribute("#game", "data-screen")) === "end", "a whole round is played to the end by typing");
  check(errors.length === 0, `typed: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 6. The microphone refused: it goes on by typing, and says how to allow it.
task("rest", "microphone refused", async () => {
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
  // The rest of the round is typed, without asking for the microphone again, to the end.
  const starts = await page.evaluate(() => window.__starts);
  while ((await round(page)).phase === "ready") {
    await waitReady(page);
    await page.tap("#g-go");
    await page.waitForSelector("#g-typed:not([hidden])");
    await page.fill("#g-word", "table");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__hotPotato.round().phase !== "listen");
  }
  await waitPhase(page, "over", 10000);
  check((await page.evaluate(() => window.__starts)) === starts, "a blocked microphone: the round is finished by typing, and listening is not tried again in it");
  await page.click("#e-setup");
  await page.click("#s-start");
  await waitReady(page);
  await page.click("#g-pause");
  await page.click("#p-quit");
  check(/microphone is blocked/.test(await page.textContent("#s-note")), "the start screen says the microphone is blocked, and how to allow it");
  check(errors.length === 0, `mic blocked: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 7. Listening that fails (no connection to the speech service): typing takes over; with storage
//    refused and reduced motion.
task("rest", "listening fails", async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 }, [fake, noStorage], { reducedMotion: "reduce" });
  await start(page, "food", 2);
  await waitReady(page);
  await page.evaluate(() => window.__turns.push([[30, "error", "network"]]));
  await page.tap("#g-go");
  await page.waitForSelector("#g-typed:not([hidden])");
  check(await page.evaluate(() => document.activeElement?.id === "g-word"), "listening failed: the word box appears by itself and has the keyboard");
  await page.fill("#g-word", "tomatoes");
  await page.keyboard.press("Enter");
  await waitPhase(page, "ready");
  const r = await round(page);
  check(r.last.ok && r.need === "o", "typed tomatoes is a tomato, next an O");
  check(r.chain.length === 1, "storage refused: the game still plays");
  // Typing stays for the rest of this round.
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
});

// 8. Broken recognisers: the turn never hangs, and listening is not restarted without end.
for (const broken of ["silent", "abort-at-once", "start-then-abort"]) task("rest", `broken recogniser: ${broken}`, async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 }, [fake, `window.__broken = ${JSON.stringify(broken)};`]);
  await start(page, "cities", 2);
  await waitReady(page);
  const t0 = Date.now();
  await page.tap("#g-go");
  await page.waitForSelector("#g-typed:not([hidden])", { timeout: 8000 }).catch(() => {});
  const waited = Date.now() - t0;
  const typedNow = await page.isVisible("#g-typed");
  const r = await round(page);
  const note = await page.textContent("#g-status");
  check(typedNow && r.lit && r.phase === "listen" && waited < 6000, `${broken}: the turn goes to typing after ${waited} ms, with the fuse lit ("${note.trim()}")`);
  check(/microphone did not come on|Listening kept stopping/.test(note), `${broken}: and says why in plain words`);
  await page.waitForTimeout(12000 - (Date.now() - t0));
  const starts = await page.evaluate(() => window.__starts);
  check(starts <= 6, `${broken}: the recogniser was started ${starts} times in 12 s, not without end`);
  // The typed answer still plays (the fuse may have run out in those 12 s: then it is the next turn's).
  if (!typedNow) check(false, `${broken}: no word box to type in: the turn is stuck`);
  else if ((await round(page)).phase === "listen") {
    await page.fill("#g-word", "Paris");
    await page.keyboard.press("Enter");
    await waitPhase(page, "ready");
    check((await round(page)).chain.includes("Paris"), `${broken}: the typed word counts`);
  } else check((await round(page)).last?.reason === "slow", `${broken}: the fuse ran out while nobody typed: too slow`);
  await page.screenshot({ path: `${SHOTS}/390-broken-${broken}.png` });
  check(errors.length === 0, `${broken}: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 9. The plain, faceless potato kept for comparison (#plain): it still draws the same parts at
//    every stage, rests on the start screen, and plays a round on the same screens.
task("rest", "#plain", async () => {
  const { context, page, errors } = await open({ width: 390, height: 844 }, [fake], { hash: "#plain" });
  check((await page.locator("#pot [data-part]").count()) === 0 && (await page.locator("#pot .body").count()) === 1, "#plain draws the faceless potato instead of the Specimen");
  await page.waitForTimeout(500);
  const idle = await page.evaluate(() => window.__hotPotato.art.look());
  await page.waitForTimeout(800);
  check((await page.evaluate(() => window.__hotPotato.art.look().draws)) === idle.draws, "#plain: the start screen does not redraw it");
  await start(page, "cities", 2);
  const parts = [await still(page, "plain-stage-0")];
  for (let i = 1; i <= 2; i++) {
    await say(page, word("table"), "tap");
    parts.push(await still(page, `plain-stage-${i}`));
  }
  check(parts.every((p) => p === parts[0]) && parts[0].split(",").length > 40, `#plain: every stage draws the same parts (${parts.map((p) => p.split(",").length).join(", ")})`);
  await page.screenshot({ path: `${SHOTS}/390-plain.png` });
  check(errors.length === 0, `#plain: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 10. The start screen's note (cannot listen, microphone blocked) on sideways phones: everything
//     inside the screen and nothing over anything, the title included.
const startFits = (page) =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll(".v-start .logo, .v-start .kicker, #s-cats .chip, #s-minus, #s-plus, #s-n, #s-sound, #s-buzz, #s-note, #s-start")].filter((e) => e.getClientRects().length && !e.closest("[hidden]"));
    const bad = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.top < -0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`outside: ${e.id || e.className}`);
    }
    for (let i = 0; i < els.length; i++)
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect();
        const b = els[j].getBoundingClientRect();
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) bad.push(`${els[i].id || els[i].className} over ${els[j].id || els[j].className}`);
      }
    return bad;
  });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
for (const [w, h] of [[568, 320], [667, 375], [740, 340], [844, 390]]) task("rest", `${w}x${h} start notes`, async () => {
  const viewport = { width: w, height: h };
  const { context, page, errors } = await open(viewport, [fake, noSpeech]);
  await page.evaluate(() => document.fonts.ready);
  const bad = await startFits(page);
  check(/cannot listen/.test(await page.textContent("#s-note")) && bad.length === 0, `${w}x${h}: the start screen fits with "cannot listen" ${bad.join(" | ")}`);
  await page.screenshot({ path: `${SHOTS}/${w}x${h}-start-note.png` });
  check(errors.length === 0, `${w}x${h} start note: no console errors ${errors.join(" | ")}`);
  await context.close();
  // The longest note: the microphone blocked, on an iPhone (it says how to allow it in Settings).
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: IPHONE });
  const blocked = await open(viewport, [fake], { context: ctx });
  await start(blocked.page, "cities", 2);
  await waitReady(blocked.page);
  await blocked.page.evaluate(() => window.__turns.push([[30, "error", "not-allowed"]]));
  await blocked.page.tap("#g-go");
  await blocked.page.waitForSelector("#g-typed:not([hidden])");
  await blocked.page.tap("#g-pause");
  await blocked.page.tap("#p-quit");
  const bad2 = await startFits(blocked.page);
  check(/microphone is blocked/.test(await blocked.page.textContent("#s-note")) && bad2.length === 0, `${w}x${h}: the start screen fits with "microphone is blocked" ${bad2.join(" | ")}`);
  await blocked.page.screenshot({ path: `${SHOTS}/${w}x${h}-start-blocked.png` });
  await ctx.close();
});

// 11. A typed turn at 320 wide: the word box and "Say it" both inside the screen.
task("rest", "320 typed turn", async () => {
  const { context, page, errors } = await open({ width: 320, height: 568 }, [fake, noSpeech]);
  await start(page, "cities", 2);
  await waitReady(page);
  await page.tap("#g-go");
  await page.waitForSelector("#g-typed:not([hidden])");
  const off = await offscreen(page);
  const send = await page.evaluate(() => Math.round(document.getElementById("g-send").getBoundingClientRect().right));
  check(off.length === 0 && send <= 320 - 8, `320x568 typed turn: "Say it" fits (its right edge at ${send}px) ${off.join(" | ")}`);
  await page.screenshot({ path: `${SHOTS}/320x568-typed-turn.png` });
  check(errors.length === 0, `320 typed: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 12. A verdict: the appeal stays clearly visible all through it; a pause and Go on within the
//     settling moment after it put the keyboard on something visible and enabled, then on the go
//     button once it can be pressed.
task("rest", "verdict and pause", async () => {
  const { context, page, errors } = await open({ width: 1280, height: 720 });
  await start(page, "cities", 3);
  await say(page, word("Leopold", 0.4));
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(await page.evaluate(() => {
      let o = 1;
      for (let el = document.getElementById("g-appeal"); el; el = el.parentElement) o *= Number(getComputedStyle(el).opacity);
      return o;
    }));
    await page.waitForTimeout(200);
  }
  check(seen.every((o) => o >= 0.95), `the appeal is clearly visible all through the verdict (${seen.map((o) => o.toFixed(2)).join(", ")})`);
  /** Pauses and goes on at once (Escape twice) with the keyboard on nothing in particular; says where it went. */
  const pauseAndGoOn = async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    return page.evaluate(() => {
      const el = document.activeElement;
      const shown = Boolean(el) && el !== document.body && el.getClientRects().length > 0 && !el.closest("[hidden]") && !el.disabled && getComputedStyle(el).visibility !== "hidden";
      return { id: el?.id || el?.className || el?.tagName, shown, settling: !window.__hotPotato.round().paused && document.getElementById("g-go").disabled };
    });
  };
  // Straight after a refusal: the appeal takes it.
  await say(page, word("Lisbonn", 0.4));
  const a = await pauseAndGoOn();
  check(a.shown && a.settling && a.id === "g-appeal", `going on straight after a verdict puts the keyboard on the appeal, not a hidden button (${a.id}${a.settling ? ", go still settling" : ""})`);
  // Straight after a refusal with no appeal ("???"): the screen holds it, then the go button takes it.
  await say(page, [[100, "final", [["???", 0.9]]]]);
  const b = await pauseAndGoOn();
  await page.waitForTimeout(800);
  const then = await page.evaluate(() => document.activeElement?.id);
  check(b.shown && b.settling && b.id === "gi" && then === "g-go", `with no appeal, the keyboard waits on the screen and then takes the go button (${b.id}, then ${then})`);
  check(errors.length === 0, `verdict and pause: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// 13. At the last stage and through the burst, he stays inside the screen, and the flash is a light
//     one. He is framed big (style.css): he himself (body, face, sprouts), the bulbs, the tray's
//     lights and the burst's "BREACH!" must stay on screen; the rig's outer parts (tubes, clamp
//     ends, tray corners), the splat's outermost spikes (a few pixels on a narrow phone) and the
//     flying chunks may run off the sides.
for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) task("rest", `${viewport.width}x${viewport.height} burst`, async () => {
  const name = `${viewport.width}x${viewport.height}`;
  const { context, page, errors } = await open(viewport);
  await start(page, "cities", 2);
  for (let i = 0; i < 4; i++) await say(page, word("table"), viewport.width < 600 || viewport.height < 500 ? "tap" : "click");
  await still(page, `${name}-stage-4`);
  /** Every drawn part of him (and the splat), outside the screen, over a second of frames. */
  const outside = () =>
    page.evaluate(async () => {
      const out = new Set();
      let flash = 0;
      for (let i = 0; i < 60; i++) {
        await new Promise((ok) => requestAnimationFrame(ok));
        flash = Math.max(flash, Number(getComputedStyle(document.querySelector(".ground .flash")).opacity));
        for (const el of document.querySelectorAll('#pot [data-part="spud"] [data-part], #pot [data-part^="bulb"], #pot [data-part^="alarm"], #pot [data-part^="light"], #pot [data-part="breach"]')) {
          if (el.closest('[opacity="0"]') || el.tagName === "g") continue;
          const r = el.getBoundingClientRect();
          if (!r.width && !r.height) continue;
          if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.add(`${el.dataset.part} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
        }
      }
      return { out: [...out], flash };
    });
  // The last stage, its most stressed: listening with the fuse half gone.
  await waitReady(page);
  await page.click("#g-go");
  await page.waitForFunction(() => window.__hotPotato.round().lit);
  await page.waitForTimeout(3000);
  const stressed = await outside();
  check(stressed.out.length === 0, `${name}: at the last stage, shaking, he (body, face, sprouts), the bulbs and the tray's lights are inside the screen ${stressed.out.slice(0, 4).join(" | ")}`);
  await page.evaluate(() => window.__turns.push([[100, "final", [["Zzzz", 0.9]]]]));
  await waitPhase(page, "doom", 15000).catch(() => {});
  await waitPhase(page, "burst", 15000);
  const burst = await outside();
  check(burst.out.length === 0, `${name}: through the burst, "BREACH!" stays inside the screen ${burst.out.slice(0, 4).join(" | ")}`);
  check(burst.flash <= 0.45, `${name}: the burst's flash is a light one, never a blank screen (at most ${burst.flash.toFixed(2)} white)`);
  check(errors.length === 0, `${name} burst: no console errors ${errors.join(" | ")}`);
  await context.close();
});

// --only=fallback or --only=layout runs that group alone (as it always did); otherwise every case.
// The longest cases go first, so the lanes finish together (the times are from the cases' own
// lines in a run; a case not listed counts as short).
const LONG = ["touch layout walk", "desktop layout walk", "phone round", "desktop keyboard round", "muted microphone"];
const chosen = TASKS.filter(([group]) => !ONLY || group === ONLY || !["fallback", "layout"].includes(ONLY));
const rank = (name) => (LONG.includes(name) ? LONG.indexOf(name) : LONG.length);
const queue = LANES > 1 ? [...chosen].sort((a, b) => rank(a[1]) - rank(b[1])) : [...chosen];
const took = [];
const runOne = async ([, name, run]) => {
  const t0 = Date.now();
  try {
    await where.run(name, run);
  } catch (err) {
    where.run(name, () => check(false, `the case stopped: ${err?.stack ?? err}`));
  }
  took.push([name, Date.now() - t0]);
};
await Promise.all(Array.from({ length: Math.min(LANES, queue.length) }, async () => {
  while (queue.length) await runOne(queue.shift());
}));
console.log(`\n${took.length} cases, ${LANES} at a time; the longest: ${[...took].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, ms]) => `${n} ${(ms / 1000).toFixed(0)} s`).join(", ")}`);

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
