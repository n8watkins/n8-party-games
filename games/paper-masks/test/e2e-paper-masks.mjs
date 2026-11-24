// End to end, in real pages (headless and muted): Paper Masks at the Table.
//
//   node games/paper-masks/test/e2e-paper-masks.mjs [--base=http://localhost:8791] [--out=<folder for stills>] [--only=1,2,3] [--together=1]
//
// Three whole matches through real browsers, with the big screen watching:
//   1. three players (Ann, Bo, Cy): the game writes a fourth answer ("The game" chip); then the
//      host deals a second match in the same party, and none of the first match's answers reaches
//      any page of it;
//   2. four players (Ann, Bo, Cy, Di) on a call: Di reloads with half an answer typed and again
//      after guessing, Cy's phone loses its connection and comes back, Fay joins mid-match and
//      watches (then plays from the next round), the host skips an answer the reader asked about,
//      and Bo leaves the party mid-match; the match goes on;
//   3. eight players (Ann, Cy, Di, Fay, Gus, Hal, Ivy and Bartholomew Jo, a name as long as a
//      name may be: every place at the Table taken), with the phones and the big screen checked
//      at 390x844, 320x568, 844x390, 1280x720 and 1920x1080.
// The guesses of matches 1 and 3 are random in the middle rounds and fixed in the last (see
// planGuesses), where every reveal is looked at, at every size: at three players the game's card
// with all three fooled, at eight every split of the seven guessers between "Guessed right" and
// "Fooled", starting with three right and four fooled, with every answer as long as the rules allow.
// Each match is played in a party of its own, the three side by side in one browser (they share
// nothing but the Worker). With --together=1 (test:paper-masks:full) one party plays the three
// matches one after another, as people do on one evening: Di joins for the second, Bo leaves in
// it, and the others join for the third.
// Every tap is a real click. Every message any page receives is checked against the secrecy
// rules (PAPER-MASKS-RULES.md, section 8, and the module's README): no answer reaches a page
// before that page may see it, no author before the reveal, nobody's guesses before the reveal,
// no other prompt and no ghost answer that is not a card. After every step each page's whole
// document is checked the same way, every answer is rendered as text only, and the author's page
// sends its decoy tap only when it is clicked: never on arrival, never by itself.
// The author's guessing screen is compared with a guesser's, element for element and box for box
// (3 and 8 players, before and after the host skips an answer), with side-by-side stills; once
// writing closes and at the end of every match no phone's storage holds an answer, a draft or
// which chip an author tapped; at the final curtain the Table's own "End the game" is hidden.
// Captioned stills of every phase go to --out, with index.html listing them.
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser } from "@n8games/lobby/testing/browser";
import { still as takeStill } from "@n8games/lobby/testing/stills";
import { QUESTIONS } from "../questions.js";
import { tidyAnswer } from "../text.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "/tmp/claude-paper-masks-table/shots"));
const only = new Set(opt("only", "1,2,3").split(",").map(Number));
const together = opt("together", "0") === "1";
mkdirSync(out, { recursive: true });

// Which party a line is from, when the parties play side by side.
const lane = new AsyncLocalStorage();
const problems = [];
const check = (ok, what) => {
  const from = lane.getStore();
  const line = from ? `[${from}] ${what}` : what;
  if (!ok || process.env.VERBOSE) console.log((ok ? "ok   " : "FAIL ") + line);
  if (!ok) problems.push(line);
  return ok;
};
let passes = 0;
const pass = (ok, what) => (ok ? (passes += 1) : check(false, what));
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPTS = QUESTIONS.map((q) => q.text);
const GHOSTS = QUESTIONS.flatMap((q) => q.ghosts);
/** The author of the answer the game writes at three players, in the test's own plans. */
const THE_GAME = "the game";
const SECRET_KEYS = new Set(["author", "authors", "answers", "seed", "secret", "draws", "rng", "idKey", "deck", "deckPos", "ghostPool", "decoys", "masksFree", "hasRead", "assignedReader", "match", "until", "gone"]);

const browser = await launchBrowser();
const errors = [];

/**
 * One party at the Table, with everything the test knows of it: its pages, its big screen, the
 * match being played, the answers skipped, the stills it took. Its stills' names start with `tag`.
 */
function makeParty(tag) {
  const stills = [];
  /** Every page in the party: {name, page, context, seat, views, sent, clicked, done}. */
  const people = [];
  let tv = null;
  let pin = null;
  /** What the test knows of the match being played: round -> {seat: tidied answer}. */
  let known = {};
  let matchNo = 0;
  /** Answers the host skipped: {round, text, from: page -> index of its first message after the skip}. */
  const skipped = [];

  // ------------------------------------------------------------------ pages and the wire

  function watchWire(p) {
    p.page.on("websocket", (ws) => {
      ws.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string" || payload[0] !== "{") return;
        let msg;
        try {
          msg = JSON.parse(payload);
        } catch {
          return;
        }
        if ((msg.t === "snap" || msg.t === "start") && msg.s?.game === "paper-masks") {
          p.views.push({ s: msg.s, match: matchNo, checked: false, at: Date.now() });
          p.view = msg.s;
          if (msg.s.you?.seat !== null && msg.s.you?.seat !== undefined && msg.s.you.role !== "screen") p.seat = msg.s.you.seat;
        }
      });
      ws.on("framesent", ({ payload }) => {
        if (typeof payload !== "string" || payload[0] !== "{") return;
        try {
          const msg = JSON.parse(payload);
          if (msg.t === "in") p.sent.push({ d: msg.d, at: Date.now() });
        } catch {
          // not JSON: the keep-alive
        }
      });
    });
  }

  async function open(name, { width = 390, height = 844, screen = false } = {}) {
    const context = await browser.newContext(screen ? { viewport: { width, height } } : { viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID });
    const page = await context.newPage();
    const p = { name, page, context, seat: null, views: [], view: null, sent: [], clicked: new Set(), screen, gone: false };
    const who = tag ? `${tag}${name}` : name;
    page.on("pageerror", (e) => errors.push(`${who}: ${e.message} (${(e.stack ?? "").split("\n").slice(1, 3).join(" ").trim()})`));
    page.on("console", (m) => m.type() === "error" && !/WebSocket|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) && errors.push(`${who}: ${m.text()}`));
    watchWire(p);
    return p;
  }

  async function atTable(p) {
    await p.page.waitForURL((url) => new URL(url).pathname === "/party/", { timeout: 30000 });
    await p.page.waitForSelector("#app .top", { timeout: 30000 });
  }

  async function startParty(name) {
    const p = await open(name);
    await p.page.goto(`${base}/lobby/?start&look=flat`);
    await p.page.fill("input[name=nickname]", name);
    await p.page.click("button[type=submit]");
    await p.page.waitForSelector(".bar", { timeout: 30000 });
    const pin = await p.page.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin);
    people.push(p);
    return { p, pin };
  }

  async function joinParty(name, pin) {
    const p = await open(name);
    await p.page.goto(`${base}/lobby/?join=${pin}&look=flat`);
    await p.page.fill("input[name=nickname]", name);
    await p.page.click("button[type=submit]");
    await atTable(p);
    people.push(p);
    return p;
  }

  async function openScreen(pin) {
    const p = await open("Screen", { width: 1280, height: 720, screen: true });
    await p.page.goto(`${base}/lobby/?join=${pin}&as=screen&look=flat`);
    await p.page.getByText("Show the room here").click();
    await atTable(p);
    return p;
  }

  const live = () => people.filter((p) => !p.gone);
  const players = () => live().filter((p) => p.view && p.view.you?.role !== "screen");
  const byName = (name) => people.find((p) => p.name === name);
  const nameOfSeat = (seat) => people.find((p) => p.seat === seat && !p.gone)?.name ?? `seat ${seat}`;

  // ------------------------------------------------------------------ the secrecy checks

  function walk(value, visit, path = []) {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, i]));
    else if (value && typeof value === "object") {
      visit(value, path);
      for (const [k, v] of Object.entries(value)) walk(v, visit, [...path, k]);
    }
  }

  /** The answers of this round that the viewer `p` may NOT see in view `s`, as [seat, text]. */
  function hiddenFrom(p, s) {
    const round = known[s.round] ?? {};
    const mine = s.you?.role === "player" ? s.you.seat : null;
    const others = Object.entries(round).filter(([seat]) => Number(seat) !== mine);
    if (["reveal", "summary", "over"].includes(s.phase)) return [];
    if (s.phase === "reading" && (s.you?.reader || s.callMode)) return [];
    if (s.phase === "guessing") {
      const seen = new Set([s.step.card.text, ...(s.step.sheet ?? []).map((c) => c.text)]);
      return others.filter(([, text]) => !seen.has(text));
    }
    return others;
  }

  /** Checks one view a page received. */
  function checkView(p, s, where) {
    const json = JSON.stringify(s);
    walk(s, (obj, path) => {
      for (const k of Object.keys(obj)) if (SECRET_KEYS.has(k)) check(false, `${where}: secret key "${k}" at ${path.join(".")}`);
      if (obj.revealed === false && ("by" in obj || "guesses" in obj || "right" in obj || "sameAs" in obj || "mask" in obj)) check(false, `${where}: an author or guesses on an unrevealed card`);
    });
    if (["writing", "reading", "guessing"].includes(s.phase)) pass(!/"guesses"/.test(json), `${where}: guesses before the reveal`);
    for (const [seat, text] of hiddenFrom(p, s)) pass(!json.includes(JSON.stringify(text).slice(1, -1)), `${where}: ${nameOfSeat(Number(seat))}'s answer "${text}" reached ${p.name} too early`);
    // No prompt but this round's, and no ghost answer that is not a card in front of this viewer.
    for (const prompt of PROMPTS) if (prompt !== s.prompt?.text && json.includes(JSON.stringify(prompt).slice(1, -1))) check(false, `${where}: another prompt reached the page: "${prompt}"`);
    const cardTexts = new Set();
    walk(s, (obj) => typeof obj.text === "string" && typeof obj.id === "string" && cardTexts.add(obj.text));
    for (const g of GHOSTS) if (!cardTexts.has(g) && json.includes(JSON.stringify(g).slice(1, -1))) check(false, `${where}: a ghost answer that is not a card reached the page: "${g}"`);
    // "This one is yours" only on the author's own page, and only for their own card.
    if (s.phase === "guessing") {
      const mine = known[s.round]?.[s.you?.seat];
      if (s.step.yours) pass(s.you.role === "player" && s.step.card.text === mine, `${where}: told "yours" about a card that is not ${p.name}'s`);
      else if (s.you?.role === "player" && mine !== undefined && s.step.card.text === mine && !Object.entries(known[s.round]).some(([seat, t]) => Number(seat) !== s.you.seat && t === mine)) check(false, `${where}: ${p.name}'s own card was not marked as theirs`);
      pass(Object.keys(s.step).every((k) => !["tapped_by", "who", "sent"].includes(k)), `${where}: the tap count names seats`);
    }
  }

  /** Checks every message received since the last audit, and every page's whole document now. */
  async function audit(label) {
    for (const p of [...people, tv].filter(Boolean)) {
      p.views.forEach((rec, i) => {
        if (rec.checked || rec.match !== matchNo) return;
        rec.checked = true;
        const where = `${label}, message to ${p.name} (${rec.s.phase} r${rec.s.round})`;
        checkView(p, rec.s, where);
        // A skipped answer is gone from every message after the skip, its author's included.
        const json = JSON.stringify(rec.s);
        for (const b of skipped) {
          const at = json.indexOf(JSON.stringify(b.text).slice(1, -1));
          if (i >= (b.from.get(p) ?? Infinity) && rec.s.round === b.round && rec.match === b.match) pass(at < 0, `${where}: the skipped answer "${b.text}" is still sent: ...${json.slice(Math.max(0, at - 160), at + 60)}...`);
        }
      });
    }
    await Promise.all(
      [...live(), tv].filter(Boolean).map(async (p) => {
        if (!p.view || p.view.phase === "setup") return;
        let dom;
        try {
          dom = await p.page.evaluate(() => {
            const root = document.querySelector(".pm");
            const answers = [...document.querySelectorAll(".pm-a, .pm-yours, .pm-list")].filter((el) => el.classList.contains("pm-a"));
            return {
              html: document.documentElement.outerHTML,
              text: document.body.innerText,
              phase: root?.dataset.phase ?? null,
              elementsInAnswers: answers.filter((el) => el.childElementCount > 0).length,
            };
          });
        } catch {
          return; // the page is navigating (a reload, or back at the Table)
        }
        if (!dom.phase) return;
        const s = p.view;
        const where = `${label}, ${p.name}'s page (${s.phase} r${s.round})`;
        const html = dom.html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
        for (const [seat, text] of hiddenFrom(p, s)) pass(!html.includes(text), `${where}: ${nameOfSeat(Number(seat))}'s answer "${text}" is in the page`);
        pass(dom.elementsInAnswers === 0, `${where}: an answer was rendered as markup`);
        const yours = /Yours: tap any name|This one is yours/.test(dom.text);
        pass(!yours || (s.phase === "guessing" && s.step.yours), `${where}: says the card is yours when it is not`);
        pass(dom.phase !== "guessing" || !dom.html.includes("pm-yours"), `${where}: a "Yours" box during guessing`);
        if (p.screen) pass(!/Yours|This one is yours|Your answer/.test(dom.text) && !dom.html.includes("pm-write"), `${where}: the big screen shows something private`);
        for (const b of skipped) if (b.round === s.round && b.match === matchNo && p.views.length > (b.from.get(p) ?? Infinity)) pass(!html.includes(b.text), `${where}: the skipped answer "${b.text}" is still on the page`);
      }),
    );
  }

  /**
   * Nothing on any phone's storage says who wrote what: no `paper-masks:decoy` key (which chip an
   * author tapped), no draft once writing is closed, and no answer text, in localStorage or
   * sessionStorage. `writingOpen` allows this round's own draft while writing is open.
   */
  async function storageClean(label) {
    const texts = Object.values(known).flatMap((round) => Object.values(round));
    await Promise.all(
      [...live(), tv].filter(Boolean).map(async (p) => {
        let kept;
        try {
          kept = await p.page.evaluate(() => {
            const all = (s) => Object.keys(s).map((k) => [k, s.getItem(k) ?? ""]);
            return { local: all(localStorage), session: all(sessionStorage) };
          });
        } catch {
          return; // navigating
        }
        for (const [where, pairs] of Object.entries(kept)) {
          for (const [k, value] of pairs) {
            pass(!k.startsWith("paper-masks:decoy"), `${label}: ${p.name}'s ${where}Storage keeps which chip an author tapped (${k})`);
            pass(!k.startsWith("paper-masks:draft:"), `${label}: ${p.name}'s ${where}Storage keeps a draft after writing closed (${k})`);
            for (const t of texts) pass(!value.includes(t) && !k.includes(t), `${label}: ${p.name}'s ${where}Storage holds the answer "${t}" (${k})`);
          }
        }
      }),
    );
  }

  /** What a phone's game shows, as structure and boxes, for comparing two phones. */
  const shapeOf = (p) =>
    p.page.evaluate(() => {
      const body = document.querySelector(".pm-body");
      // Which chip is selected or greyed follows the names, which differ between any two phones (each
      // leaves out its own): the counts are compared (`sel`, `used`), not where they fall. The tick
      // inside the selected chip is left out of the list for the same reason.
      const els = [...body.querySelectorAll("*")].filter((e) => !e.classList.contains("pm-ok"));
      const box = (e) => {
        const r = e.getBoundingClientRect();
        // a run of text inside a line is as wide as its words (names differ): its width is not compared
        const inline = e.tagName === "SPAN" && getComputedStyle(e).display === "inline";
        return [Math.round(r.x), Math.round(r.y), inline ? 0 : Math.round(r.width), Math.round(r.height)];
      };
      return {
        tags: els.map((e) => `${e.tagName}${e.className ? "." + [...e.classList].filter((c) => c !== "sel" && c !== "used").join(".") : ""}`),
        boxes: els.map(box),
        inChip: els.map((e) => !!e.closest(".pm-chip") && !e.classList.contains("pm-chip")),
        height: body.scrollHeight,
        root: box(document.querySelector(".pm")),
        chips: [...body.querySelectorAll(".pm-chip")].map((b) => ({ text: b.textContent.trim(), aria: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed"), mask: b.querySelector(".pm-mask")?.dataset.m })),
        used: body.querySelectorAll(".pm-chip.used").length,
        sel: body.querySelectorAll(".pm-chip.sel").length,
        lab: document.querySelector(".pm-side .pm-lab")?.textContent ?? null,
      };
    });

  /**
   * The author's phone and a guesser's, side by side: the same screen. Same elements in the same
   * order with the same classes, the same boxes (a name's own width inside a chip aside), the same
   * height; every chip a painted mask with a player's name as its accessible name. With `full` off
   * (the two phones' own roles differ: one reads or hosts, with buttons of its own) only the names
   * part is compared: the label, the chips and the helper line, box for box from the label down.
   * Returns false when the two are not comparable now (their used names differ in number), so the
   * caller looks again.
   */
  async function sameScreen(author, guesser, label, { full = true } = {}) {
    let [a, g] = await Promise.all([shapeOf(author), shapeOf(guesser)]);
    if (a.used !== g.used || a.sel !== g.sel) return false;
    if (!full) [a, g] = [namesPart(a), namesPart(g)];
    const players = new Set([...people.map((x) => x.name), "The game"]);
    check(a.tags.length === g.tags.length && a.tags.every((t, i) => t === g.tags[i]), `${label}: the author's and a guesser's screens have the same elements and classes (${a.tags.length} and ${g.tags.length}${a.tags.length === g.tags.length ? `; first difference: ${a.tags.find((t, i) => t !== g.tags[i])} / ${g.tags.find((t, i) => t !== a.tags[i])}` : ""})`);
    const off = a.boxes.map((b, i) => (g.boxes[i] && !a.inChip[i] ? Math.max(...b.map((x, k) => Math.abs(x - g.boxes[i][k]))) : 0));
    const worst = off.indexOf(Math.max(0, ...off));
    check(Math.max(0, ...off) <= 1, `${label}: the same layout, box for box (worst: ${a.tags[worst]} ${a.boxes[worst]} vs ${g.boxes[worst]})`);
    if (full) check(a.height === g.height && a.root.join() === g.root.join(), `${label}: the same height (${a.height} and ${g.height}; stage ${a.root} and ${g.root})`);
    check(a.chips.length === g.chips.length, `${label}: as many chips for the author as for a guesser (${a.chips.length} and ${g.chips.length})`);
    for (const [who, chips] of [["author", a.chips], ["guesser", g.chips]]) {
      check(chips.every((c) => players.has(c.text) && c.aria === null && !!c.mask && (c.mask === "blank") === (c.text === "The game")), `${label}: every chip on the ${who}'s phone is a painted mask named for a player (${chips.map((c) => `${c.text}/${c.mask}`).join(", ")})`);
    }
    check(a.lab === g.lab, `${label}: the same label over the chips ("${a.lab}" and "${g.lab}")`);
    return true;
  }

  /** The names part of a shape (the label over the chips down to the helper line), boxes from its top. */
  function namesPart(s) {
    const from = s.tags.findIndex((t) => t === "P.pm-lab");
    const to = s.tags.findIndex((t) => t.startsWith("P.pm-hint.pm-guess-hint"));
    const end = to + 1 + s.tags.slice(to + 1).findIndex((t, i) => !s.inChip[to + 1 + i] && !t.startsWith("SPAN"));
    const pick = (list) => list.slice(from, end > to ? end : s.tags.length);
    const [x0, y0] = s.boxes[from];
    return { ...s, tags: pick(s.tags), inChip: pick(s.inChip), boxes: pick(s.boxes).map(([x, y, w, h]) => [x - x0, y - y0, w, h]) };
  }

  /** Two phones' stills side by side in one picture, for the owner to look at. */
  async function pairStill(left, right, name, caption) {
    // Stills are best-effort (party-kit/test/stills.mjs): a pair with a side missing is skipped.
    const [l, r] = await Promise.all([takeStill(left.page), takeStill(right.page)]);
    if (!l || !r) return;
    const page = await browser.newPage({ viewport: { width: 860, height: 900 } });
    const img = (b, who) => `<figure><img src="data:image/png;base64,${b.toString("base64")}"><figcaption>${who}</figcaption></figure>`;
    await page.setContent(`<style>body{margin:0;padding:12px;background:#111;display:flex;gap:16px;font:600 15px system-ui;color:#eee}figure{margin:0}img{width:400px;display:block}figcaption{padding-top:6px}</style>${img(l, `${left.name} (the author)`)}${img(r, `${right.name} (a guesser)`)}`);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const file = `${tag}${String(stills.length + 1).padStart(2, "0")}-${name}.png`;
    const taken = await takeStill(page, { path: `${out}/${file}`, fullPage: true });
    await page.close();
    if (taken) stills.push({ file, caption });
  }

  /**
   * On the card being guessed, before anyone taps: its author's phone against a guesser's. A guesser
   * with the same role (both plain, neither reading nor hosting) is compared whole; failing one, any
   * guesser, by the names part. `still` names a side-by-side picture to take. Returns "full",
   * "names" or null (nothing comparable on this card).
   */
  async function authorVsGuesser(label, still = null) {
    const here = inMatch().filter((p) => p.view.phase === "guessing" && !p.clicked.has(p.view.step.card.id));
    const author = here.find((p) => p.view.step.yours);
    if (!author) return null;
    const role = (p) => `${!!p.view.you.reader}/${!!p.view.you.host}`;
    const guessers = here.filter((p) => p !== author && p.view.step.chips.length && !p.view.step.yours);
    for (const full of [true, false]) {
      for (const guesser of guessers.filter((p) => (role(p) === role(author)) === full)) {
        if (!(await sameScreen(author, guesser, `${label} (${author.name} wrote it, ${guesser.name} guesses)`, { full }))) continue;
        // Pictures only of two phones of the same role: the whole screen is the same then.
        if (still && full) await pairStill(author, guesser, still.name, still.caption);
        return full ? "full" : "names";
      }
    }
    return null;
  }

  /** How many times each case was compared: {key: {full, names}}. Each must be compared at least once. */
  const compared = {};
  async function compareCard(key, label, still) {
    compared[key] ??= { full: 0, names: 0 };
    const how = await authorVsGuesser(label, compared[key].full === 0 ? still : null);
    if (how) compared[key][how] += 1;
  }
  /** Every case of a match was compared: whole screens where two phones of the same role allowed it. */
  function allCompared(cases) {
    for (const [key, how] of cases) {
      const c = compared[key] ?? { full: 0, names: 0 };
      check(how === "full" ? c.full > 0 : c.full + c.names > 0, `the author's and a guesser's phones were compared: ${key} (${c.full} whole, ${c.names} by the names part)`);
    }
  }

  /** The host skips the answer being guessed, from the phone, as a host does. */
  async function hostSkipsCurrent(host) {
    const card = host.view.step.card;
    await tap(host, "Skip this answer");
    await host.page.waitForSelector(".pm-sheet", { timeout: 5000 });
    await host.page.locator(".pm-sheet button", { hasText: /^Skip it$/ }).click();
    // Every phone has moved on to the next answer (or the reveal), then has had a moment to draw it.
    for (let i = 0; i < 80 && [...live(), tv].filter(Boolean).some((p) => p.view?.phase === "guessing" && p.view.step.card.id === card.id); i++) await wait(100);
    await wait(600);
    // The note ("The host skipped an answer") sits over the foot of the stage for a few seconds.
    await Promise.all(inMatch().map((p) => p.page.waitForFunction(() => document.querySelector(".pm-toast")?.hidden !== false, null, { timeout: 8000 }).catch(() => {})));
    skipped.push({ match: matchNo, round: host.view.round, text: card.text, from: new Map([...people, tv].filter(Boolean).map((p) => [p, p.views.length])) });
    await audit("after the host skipped the answer being guessed");
    return card;
  }

  // ------------------------------------------------------------------ looking at the pages

  async function still(p, name, caption) {
    const file = `${tag}${String(stills.length + 1).padStart(2, "0")}-${name}.png`;
    if (await takeStill(p.page, { path: `${out}/${file}` })) stills.push({ file, caption });
  }

  /** No sideways scroll anywhere; on the big screen no page scroll either; every tap target big enough. */
  async function fits(p, label, { screen = p.screen } = {}) {
    const m = await p.page.evaluate(() => {
      const body = document.querySelector(".pm-body");
      const small = [];
      for (const el of document.querySelectorAll(".pm button")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${el.className}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      const wide = [...document.querySelectorAll(".pm *")].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "hidden" && !["pm-mask"].some((c) => el.classList.contains(c)));
      // Words and buttons the frame cuts off (inside a column that scrolls, or under the footlights).
      const frame = (document.querySelector(".pm-body") ?? document.body).getBoundingClientRect();
      const cut = [...document.querySelectorAll(".pm-body p, .pm-body li, .pm-body button, .pm-body h2, .pm-body .pm-note")]
        .filter((el) => el.checkVisibility())
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height && (r.bottom > frame.bottom + 1 || r.top < frame.top - 1);
        })
        .map((el) => `${el.className || el.tagName}: ${(el.textContent ?? "").slice(0, 24)}`);
      return {
        cut: cut.slice(0, 4),
        cutCount: cut.length,
        // Names their chip cuts short (it shows two lines, then an ellipsis).
        cutNames: [...document.querySelectorAll(".pm-chip b")].filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => el.textContent),
        sw: document.documentElement.scrollWidth,
        sh: document.documentElement.scrollHeight,
        w: innerWidth,
        h: innerHeight,
        bodyOver: body ? body.scrollHeight - body.clientHeight : 0,
        bodyWide: body ? body.scrollWidth - body.clientWidth : 0,
        small,
        wide: wide.map((el) => el.className).slice(0, 4),
      };
    });
    check(m.sw <= m.w && m.bodyWide <= 1, `${label}: nothing scrolls sideways (${m.sw} in ${m.w}, inner ${m.bodyWide})`);
    if (screen) check(m.sh <= m.h && m.bodyOver <= 1 && !m.cutCount, `${label}: the big screen does not scroll and cuts nothing off (${m.sh} in ${m.h}, inner ${m.bodyOver}${m.cutCount ? `, cut: ${m.cut.join(" | ")}` : ""})`);
    check(!m.small.length, `${label}: every tap target is at least 44 pixels${m.small.length ? ` (${m.small.join(", ")})` : ""}`);
    check(!m.cutNames.length, `${label}: no name on a chip is cut off${m.cutNames.length ? ` (${m.cutNames.join(", ")})` : ""}`);
    return m;
  }

  async function allAt(phase, list = [...live(), tv].filter(Boolean), timeout = 20000) {
    await Promise.all(list.map((p) => p.page.waitForFunction((ph) => document.querySelector(".pm")?.dataset.phase === ph, phase, { timeout })));
  }

  /** Clicks a button whose text is `text` inside the game on page `p`. */
  async function tap(p, text, { exact = true } = {}) {
    const b = p.page.locator(".pm button", { hasText: text }).filter({ hasText: exact ? new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) : text });
    await b.first().waitFor({ state: "visible", timeout: 15000 });
    await p.page.waitForFunction((t) => [...document.querySelectorAll(".pm button")].some((b) => b.textContent === t && !b.disabled), text, { timeout: 15000 }).catch(() => {});
    await b.first().click();
  }

  async function dismissDeal(p) {
    const deal = p.page.locator(".pm-deal");
    if (await deal.count()) await deal.locator("button").click().catch(() => {});
  }

  // ------------------------------------------------------------------ playing

  /** What each player types in a round: plain, or one of the hard cases. */
  function answerFor(name, round, kind = "plain") {
    switch (kind) {
      case "long":
        return `${name} wrote the longest answer allowed here, every word of it, round ${round} ok`.padEnd(80, "!").slice(0, 80);
      case "emoji":
        return `Pizza 🍕 at midnight for ${name} 🎉 round ${round}`;
      case "rtl":
        return `שלום עולם ${name} ${round} مرحبا`;
      case "markup":
        return `<b>${name}</b> & "friends" <img src=x onerror=alert(1)> ${round}`;
      case "unbroken":
        return `${name}Supercalifragilisticexpialidocious${round}WithoutAnySpacesAtAllFromStartToEnd`;
      default:
        return `Plum ${name} answer ${round}`;
    }
  }

  async function writeAll(kinds = {}) {
    const round = players()[0].view.round;
    known[round] ??= {};
    for (const p of players()) {
      if (p.view.you.role !== "player" || p.view.phase !== "writing" || p.view.step.yours !== null) continue;
      await dismissDeal(p);
      const raw = answerFor(p.name, round, kinds[p.name]);
      const tidy = tidyAnswer(raw);
      if (!check(tidy.ok, `${p.name}'s answer tidies: ${tidy.error ?? ""}`)) continue;
      known[round][p.seat] = tidy.text;
      await p.page.fill(".pm-write textarea", raw);
      await p.page.click(".pm-write button[type=submit]");
      await p.page.waitForFunction(() => !document.querySelector(".pm-write") || document.querySelector(".pm")?.dataset.phase !== "writing", null, { timeout: 10000 });
      await audit(`writing r${round}, ${p.name} sent`);
    }
  }

  /** The phones whose role is player in the match. */
  const inMatch = () => players().filter((p) => p.view.you.role === "player");

  /**
   * Fixed guesses for a round, so its reveals are the same on every run: the card at place i is
   * guessed right by exactly `targets[i]` of its guessers and wrong by the rest, and every guesser
   * still places each name once. `cards` are the round's cards in the reader's order, as
   * {id, author} (a seat, or THE_GAME). The players stand in a ring in the order of their cards; a
   * card is guessed right by the first `targets[i]` players after its author, and each player's
   * wrong cards trade authors among themselves. Returns seat -> {card id: the author to tap}, or
   * null when the targets would leave a player one wrong card (it has no other name to take).
   */
  function planGuesses(cards, targets) {
    const ring = cards.map((c) => c.author).filter((a) => a !== THE_GAME);
    const right = new Map(ring.map((g) => [g, new Set()]));
    cards.forEach((c, i) => {
      const at = ring.indexOf(c.author);
      for (const g of [...ring.slice(at + 1), ...ring.slice(0, Math.max(at, 0))].slice(0, targets[i])) right.get(g).add(c.id);
    });
    const plan = new Map();
    for (const g of ring) {
      const wrong = cards.filter((c) => c.author !== g && !right.get(g).has(c.id));
      if (wrong.length === 1) return null;
      const mine = Object.fromEntries(cards.filter((c) => right.get(g).has(c.id)).map((c) => [c.id, c.author]));
      wrong.forEach((c, k) => (mine[c.id] = wrong[(k + 1) % wrong.length].author));
      plan.set(g, mine);
    }
    return plan;
  }

  async function guessCard({ pick = "first", plan = null } = {}) {
    const ref = inMatch()[0];
    const card = ref.view.step.card;
    const author = inMatch().find((p) => p.view.step.card.id === card.id && p.view.step.yours);
    // On the last card every sheet with one name left (and the author's decoy) is filled in at once
    // (the rules' README, "The decoy tap").
    const last = ref.view.step.index + 1 === ref.view.step.of && ref.view.step.eachNameOnce;
    // The author's page must not send its decoy by itself: it is given 1.2 s from the moment the
    // card reached it, then looked at, before it is tapped. The guessers tap first, in that time
    // (on the last card nobody taps first). The tap count then says exactly how many have tapped:
    // nobody's tap is counted that was not made.
    const shown = author?.views.find((rec) => rec.s.phase === "guessing" && rec.s.step?.card?.id === card.id)?.at ?? Date.now();
    let looked = !author;
    const look = async () => {
      looked = true;
      await wait(Math.max(0, 1200 - (Date.now() - shown)));
      // (unless the test already clicked it for this card: Di taps before her reload in match 2)
      if (!author.clicked.has(card.id)) pass(!author.sent.some((x) => x.d?.t === "decoy" && x.d.card === card.id), `${author.name}'s page sent its decoy tap without a click`);
      const tapped = inMatch().filter((p) => p.clicked.has(card.id)).length;
      // (The taps just made take a moment to reach every page.)
      if (!last) await Promise.all(inMatch().map((p) => p.page.waitForFunction((n) => {
        const c = document.querySelector(".pm-taps-n")?.textContent ?? "";
        return c === "" || c.startsWith(`${n} of `);
      }, tapped, { timeout: 5000 }).catch(() => {})));
      const counts = await Promise.all(inMatch().map((p) => p.page.locator(".pm-taps-n").textContent().catch(() => "")));
      if (last) pass(new Set(counts).size === 1, `on the last card every page shows the same count (${counts.join(", ")})`);
      else pass(counts.every((c) => c.startsWith(`${tapped} of `) || c === ""), `the tap count moved without a tap: ${tapped} tapped, the pages say ${counts.join(", ")}`);
    };
    if (author && last) await look();
    const here = live().filter((x) => x.view?.phase === "guessing" && x.view.step.card.id === card.id);
    for (const p of [...here.filter((x) => x !== author), ...here.filter((x) => x === author)]) {
      if (p === author && !looked) await look();
      const step = p.view.step;
      if (step.yours) {
        if (step.tapped) continue; // filled in on the last card, as everyone's is
        // The author taps any name, as a guesser does; the page sends the decoy tap.
        p.clicked.add(card.id);
        const names = p.page.locator(".pm-chip:not(.used):not([disabled])");
        await names.nth(Math.floor(Math.random() * (await names.count()))).click();
        await p.page.waitForFunction(() => !document.querySelector(".pm-busy"), null, { timeout: 8000 }).catch(() => {});
        pass(p.sent.some((x) => x.d?.t === "decoy" && x.d.card === card.id) && !p.sent.some((x) => x.d?.t === "guess" && x.d.card === card.id), `${p.name} tapped a name on her own card: her page sent the decoy tap, never a guess`);
      } else if (step.chips?.length && step.guess === null) {
        const choices = p.page.locator(".pm-chip:not(.used):not([disabled])");
        const n = await choices.count();
        if (!n) continue;
        p.clicked.add(card.id);
        if (plan) {
          const who = plan.get(p.seat)?.[card.id];
          const name = who === THE_GAME ? "The game" : nameOfSeat(who);
          const chip = choices.filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
          if (!check((await chip.count()) === 1, `the fixed guesses: ${p.name} can tap "${name}" on answer ${step.index + 1}`)) continue;
          await chip.click();
        } else await choices.nth(pick === "random" ? Math.floor(Math.random() * n) : 0).click();
      } else continue;
      await p.page.waitForFunction((id) => !document.querySelector(".pm-busy"), card.id, { timeout: 8000 }).catch(() => {});
    }
    if (!looked) await look();
    // Every page sent a tap only for a card it clicked.
    for (const p of live()) for (const x of p.sent) if ((x.d?.t === "decoy" || x.d?.t === "guess") && !p.clicked.has(x.d.card)) check(false, `${p.name}'s page sent ${x.d.t} for a card it never clicked`);
    await audit(`guessing ${ref.view.step.index + 1} of ${ref.view.step.of}`);
  }

  /**
   * One round, start to scores. `pick` is how a guesser chooses a name: the first free one, or one
   * at random. `fixed` plays the round with fixed guesses instead and looks at every reveal:
   * {targets(authors) -> how many guess each card right, phone, count} (see revealEach).
   */
  async function playRound({ kinds = {}, pick = "first", during = {}, fixed = null } = {}) {
    await allAt("writing", players());
    const round = players()[0].view.round;
    await during.writing?.();
    await writeAll(kinds);
    await allAt("reading", players());
    await audit(`reading r${round}`);
    // Writing is closed: no phone keeps a draft, an answer or anything else of the round.
    await storageClean(`writing closed r${round}`);
    await during.reading?.();
    const reader = inMatch().find((p) => p.view.you.reader);
    let plan = null;
    let targets = null;
    if (fixed) {
      // The reader's list is the order the cards are guessed and revealed in.
      const seatOf = (text) => Object.entries(known[round]).find(([, t]) => t === text)?.[0];
      const cards = reader.view.step.cards.map((c) => ({ id: c.id, author: seatOf(c.text) === undefined ? THE_GAME : Number(seatOf(c.text)) }));
      targets = fixed.targets(cards.map((c) => c.author));
      plan = planGuesses(cards, targets);
      if (!check(!!plan, `round ${round}: the fixed guesses can be played (${targets.join(", ")} right, card by card)`)) plan = targets = null;
    }
    await tap(reader, "Start guessing");
    for (let i = 0; i < 12; i++) {
      await players()[0].page.waitForFunction(() => ["guessing", "reveal"].includes(document.querySelector(".pm")?.dataset.phase), null, { timeout: 15000 });
      await wait(150);
      const ref = inMatch().find((p) => p.view.phase === "guessing");
      if (!ref) break;
      const before = ref.view.step.index;
      await during.guessing?.(ref.view.step.index);
      if (inMatch()[0].view.phase !== "guessing") break;
      await guessCard({ pick, plan });
      const r = inMatch().find((p) => p.view.you.reader);
      await r.page.waitForFunction(() => [...document.querySelectorAll(".pm button")].some((b) => /^(Next answer|On to the reveal)$/.test(b.textContent) && !b.disabled), null, { timeout: 10000 });
      await r.page.locator(".pm button", { hasText: /^(Next answer|On to the reveal)$/ }).click();
      await r.page.waitForFunction((b) => document.querySelector(".pm")?.dataset.phase !== "guessing" || document.querySelector(".pm-top span")?.textContent !== `Answer ${b + 1} of ${document.querySelector(".pm-top span").textContent.split(" of ")[1]}`, before, { timeout: 10000 });
    }
    await allAt("reveal", players());
    await audit(`reveal r${round}`);
    await during.reveal?.();
    if (targets) await revealEach(targets, fixed);
    const r = inMatch().find((p) => p.view.you.reader);
    for (let i = 0; i < 12; i++) {
      const label = await r.page.locator(".pm-btn").first().textContent();
      await tap(r, label);
      await wait(250);
      await audit(`reveal r${round}, ${label}`);
      if (label === "Show the scores") break;
    }
    await allAt("summary", players());
    await audit(`summary r${round}`);
    await storageClean(`summary r${round}`);
    await during.summary?.();
  }

  /**
   * Looks at one phone at the other sizes, and the big screen at 1920x1080 and back at 1280x720,
   * for this phase: the phone and the big screen are resized together, a size each at a time.
   * `count` is how many play (in the stills' names and captions).
   */
  async function sizesOf(phase, phone, count) {
    const many = `${{ 3: "Three", 8: "Eight" }[count] ?? count} players`;
    for (const [[w, h], [W, H]] of [[[320, 568], [1920, 1080]], [[844, 390], [1280, 720]]]) {
      await Promise.all([phone.page.setViewportSize({ width: w, height: h }), tv.page.setViewportSize({ width: W, height: H })]);
      await wait(400);
      await fits(phone, `${phase}, ${phone.name} at ${w}x${h}`, { screen: false });
      await still(phone, `${phase}-${count}-${w}x${h}`, `${many}, ${phase}, on a ${w}x${h} phone.`);
      await fits(tv, `${phase}, big screen ${W}x${H}, ${many.toLowerCase()}`);
      await still(tv, `${phase}-${count}-screen-${W}x${H}`, `${many}, ${phase}, on a ${W}x${H} big screen.`);
    }
    await phone.page.setViewportSize({ width: 390, height: 844 });
    await wait(400);
  }

  /**
   * The reveal of a round played with fixed guesses, a card at a time: each card comes off with
   * exactly the guesses planned (`targets[i]` right, everyone else fooled), and `phone` and the big
   * screen are looked at for each, at every size. With eight players that is every split of the
   * seven guessers, from nobody right to everybody right.
   */
  async function revealEach(targets, { phone, count }) {
    for (let i = 0; i < targets.length; i++) {
      const reader = inMatch().find((p) => p.view.you.reader);
      await tap(reader, i ? "Reveal the next one" : "Reveal the first one");
      await Promise.all([phone, tv].map((p) => p.page.waitForFunction((n) => document.querySelector(".pm-top span:last-child")?.textContent === n, `${i + 1} of ${targets.length}`, { timeout: 10000 })));
      // At once, while the plain mask lifts and the title comes in, and again when they have settled.
      await fits(tv, `reveal, answer ${i + 1}, as the mask lifts, big screen`);
      await wait(2200);
      const card = tv.view.step.cards[i];
      const right = card.right?.length ?? -1;
      const fooled = Object.keys(card.guesses ?? {}).length - right;
      check(card.revealed && right === targets[i], `the fixed guesses: answer ${i + 1} comes off with ${targets[i]} right (${right} right, ${fooled} fooled)`);
      await sizesOf(`reveal-${right}-right-${fooled}-fooled`, phone, count);
      await audit(`reveal, answer ${i + 1} of ${targets.length}`);
    }
  }

  async function nextRound() {
    const host = inMatch().find((p) => p.view.you.host);
    const label = await host.page.locator(".pm-btn").first().textContent();
    await tap(host, label);
    return label;
  }

  async function pickPaperMasks(host, choices) {
    await host.page.locator(".game button.game-row", { hasText: "Paper Masks" }).click();
    await allAt("setup", [...live(), tv].filter(Boolean), 15000);
    matchNo += 1;
    known = {};
    for (const [group, value] of choices) {
      await tap(host, value);
      await host.page.waitForFunction(
        ([g, v]) => [...document.querySelectorAll(".pm-group")].some((el) => el.querySelector(".pm-lab")?.textContent === g && el.querySelector(".pm-opt.on")?.textContent === v),
        [group, value],
        { timeout: 5000 },
      );
    }
  }

  async function backToTable(host) {
    await tap(host, "Back to the Table");
    await Promise.all([...live(), tv].filter(Boolean).map((p) => p.page.waitForSelector(".card:not([hidden]) .card-rows li, .card:not([hidden]) .card-early", { timeout: 15000 })));
  }

  // ================================================================== the party and its matches

  /** Ann starts the party and takes it to the Table, alone; the others (`names`) join there, then the big screen. */
  async function setUp(names) {
    const { p: ann, pin: got } = await startParty("Ann");
    pin = got;
    await ann.page.click(".rooms-btn");
    await ann.page.waitForSelector(".mode-choice:visible");
    await ann.page.click(".mode-choice");
    await atTable(ann);
    for (const name of names) await joinParty(name, pin);
    tv = await openScreen(pin);
    check(true, `Ann, ${names.join(", ")} are at the Table with the big screen (${pin})`);
    const first = byName(names[0]);
    const entry = await first.page.locator(".game", { hasText: "Paper Masks" }).textContent();
    check(!/Coming soon/.test(entry), `Paper Masks is on the Table's list as playable: "${entry.trim()}"`);
    await still(first, "table-list-390x844", `The Table's list on ${first.name}'s phone: Paper Masks with the owner's door painting, playable.`);
  }

  // ---------------------------------------------------------------- match 1: three players
  async function match1() {
    const ann = byName("Ann");
    let skipIn1 = null;
    await pickPaperMasks(ann, [["Rounds", "3"]]);
    await still(ann, "setup-host-390x844", "Waiting to start, the host's phone: rounds, prompts, family-safe and call switches, Deal the masks.");
    await still(byName("Bo"), "setup-player-390x844", "Waiting to start, a player's phone: who is dealt in and the host's choices.");
    await still(tv, "setup-screen-1280x720", "Waiting to start, the big screen.");
    await fits(ann, "setup, host");
    await fits(tv, "setup, big screen");
    await tap(ann, "Deal the masks");
    await allAt("writing");
    await byName("Bo").page.waitForSelector(".pm-deal", { timeout: 5000 });
    await wait(2200);
    await still(byName("Bo"), "deal-390x844", "Round 1: Bo's mask is dealt (his card back turns over).");
    check(!(await tv.page.locator(".pm-deal").count()), "the big screen is dealt no mask");
    await playRound({
      kinds: { Ann: "markup", Bo: "rtl", Cy: "emoji" },
      during: {
        writing: async () => {
          await dismissDeal(byName("Bo"));
          await byName("Bo").page.fill(".pm-write textarea", "Half an answer");
          await still(byName("Bo"), "writing-390x844", "Writing: the prompt, the private box with its count, who has sent.");
          await still(tv, "writing-screen-1280x720", "Writing on the big screen: the prompt and who has sent, nothing else.");
          await fits(byName("Bo"), "writing, Bo");
          await fits(tv, "writing, big screen");
        },
        reading: async () => {
          const reader = inMatch().find((p) => p.view.you.reader);
          const other = inMatch().find((p) => !p.view.you.reader);
          await still(reader, "reading-reader-390x844", "Reading: the reader's shuffled list, four cards (the game wrote one), none marked as the reader's own.");
          await still(other, "reading-listener-390x844", "Reading, everyone else: listen and watch faces; your own answer small at the bottom.");
          await still(tv, "reading-screen-1280x720", "Reading on the big screen.");
          check(reader.view.step.cards.length === 4, `three players: the game writes a fourth answer (${reader.view.step.cards.length} cards)`);
          const markup = await reader.page.evaluate(() => [...document.querySelectorAll(".pm-a")].map((el) => el.textContent).find((t) => t.includes("</b>")));
          check(!!markup && markup.includes("<img src=x"), `markup in an answer shows as plain text: "${markup}"`);
          await fits(reader, "reading, reader");
          await fits(tv, "reading, big screen");
          // Only round 1 has two plain phones at three players (Ann hosts and reads it). The first
          // plain player's card is compared whole, then the host skips it, so the second plain
          // player's card, later on, is compared whole after a skip.
          const plainSeats = new Set(inMatch().filter((p) => !p.view.you.reader && !p.view.you.host).map((p) => p.seat));
          const authors = reader.view.step.cards.map((c) => Number(Object.entries(known[1]).find(([, t]) => t === c.text)?.[0] ?? -1));
          skipIn1 = authors.findIndex((a) => plainSeats.has(a));
        },
        guessing: async (index) => {
          if (index === skipIn1 && !skipped.some((b) => b.match === matchNo)) {
            await compareCard("3 players, before a skip", `3 players, answer ${index + 1}`, { name: "pair-3-before-skip", caption: "Three players, guessing: the author's phone and a guesser's, side by side. The same chips with the same painted masks." });
            await hostSkipsCurrent(ann);
          }
          if (inMatch()[0].view.phase !== "guessing") return;
          const after = skipped.some((b) => b.match === matchNo);
          if (after) await compareCard("3 players, after a skip", `3 players after a skip, answer ${inMatch()[0].view.step.index + 1}`, { name: "pair-3-after-skip", caption: "Three players, guessing after the host skipped an answer: the author's phone and a guesser's. As many chips on each." });
          else await compareCard("3 players, before a skip", `3 players, answer ${index + 1}`, { name: "pair-3-before-skip", caption: "Three players, guessing: the author's phone and a guesser's, side by side. The same chips with the same painted masks." });
          // The first card written by a player (one may be the game's own).
          const author = inMatch().find((p) => p.view.step.yours);
          if (!author || stills.some((s) => s.file.includes("guessing-author"))) return;
          const guesser = inMatch().find((p) => !p.view.step.yours);
          const chips = await guesser.page.locator(".pm-chip b").allTextContents();
          check(chips.includes("The game"), `three players: "The game" is one of the names (${chips.join(", ")})`);
          await still(guesser, "guessing-390x844", `Guessing, answer ${index + 1}: tap one name ("The game" at three players), and the anonymous tap count.`);
          await still(author, "guessing-author-390x844", "Guessing, the author's phone: the same screen as everyone's, with a quiet \"Yours: tap any name.\" where a guesser's line says \"Only you see your guess.\"");
          await still(tv, "guessing-screen-1280x720", "Guessing on the big screen: the answer, who reads and how many have tapped, never who.");
          await fits(guesser, "guessing, guesser");
          await fits(author, "guessing, author");
          await fits(tv, "guessing, big screen");
        },
        reveal: async () => {
          const reader = inMatch().find((p) => p.view.you.reader);
          await tap(reader, "Reveal the first one");
          await wait(700);
          await still(byName("Cy"), "reveal-mid-390x844", "The reveal, mid-way: the plain mask lifts off the author's mask.");
          await wait(1800);
          await still(byName("Cy"), "reveal-390x844", "The reveal: who wrote it, who guessed right, who was fooled.");
          await still(tv, "reveal-screen-1280x720", "The reveal on the big screen.");
          await fits(byName("Cy"), "reveal, Cy");
          await fits(tv, "reveal, big screen");
          await audit("first reveal");
        },
        summary: async () => {
          await still(ann, "summary-host-390x844", "The round's scores, with the reasons, on the host's phone (Next round).");
          await still(tv, "summary-screen-1280x720", "The round's scores on the big screen.");
          await fits(ann, "summary, host");
          await fits(tv, "summary, big screen");
        },
      },
    });
    await nextRound();
    await playRound({ kinds: { Ann: "long", Bo: "unbroken" }, pick: "random" });
    await nextRound();
    // The last round's guesses are fixed, and every reveal is looked at: the game's own card with
    // all three fooled (the most lines three players can make), then a player's card with nobody
    // right, with one right and one fooled, and with both right.
    await playRound({ fixed: { targets: (authors) => authors.map((a, i) => (a === THE_GAME ? 0 : authors.slice(0, i).filter((b) => b !== THE_GAME).length)), phone: byName("Cy"), count: 3 } });
    check(!(await ann.page.locator(".stage-head .stop").isHidden()), "during the match the host has the Table's own End the game");
    check((await nextRound()) === "Final scores", "after the third round the host's button says Final scores");
    await allAt("over");
    await wait(1500);
    await audit("the end of match 1");
    await storageClean("the end of match 1");
    // The match is decided: the Table's own "End the game" steps aside for the curtain's way back.
    check(await ann.page.locator(".stage-head .stop").isHidden(), "at the final curtain the Table's own End the game is hidden");
    await still(byName("Bo"), "final-390x844", "The final curtain: the winner, the standings, Best mask and Mind reader.");
    await still(ann, "final-host-390x844", "The final curtain, the host's phone: Back to the Table.");
    await still(tv, "final-screen-1280x720", "The final curtain on the big screen.");
    await fits(tv, "final, big screen");
    await backToTable(ann);
    const title = await byName("Bo").page.locator(".card-head h3").textContent();
    check(/^Paper Masks: (Ann|Bo|Cy) won$/.test(title), `back at the Table with the card: "${title}"`);
    await still(byName("Bo"), "back-at-table-390x844", "Back at the Table with the card.");
    await byName("Bo").page.click(".card-done").catch(() => {});
    allCompared([
      ["3 players, before a skip", "full"],
      ["3 players, after a skip", "full"],
    ]);
  }

  /**
   * A second match in the same party, after the first (when the matches are played in parties of
   * their own; with --together the next match is it): dealt fresh, with none of the first match's
   * answers in any message or on any page, and no phone's storage holding them; then the host ends
   * it from the Table's own "End the game", and everyone is back at the Table.
   */
  async function secondMatch() {
    const ann = byName("Ann");
    const before = Object.values(known).flatMap((round) => Object.values(round));
    const from = new Map([...people, tv].filter(Boolean).map((p) => [p, p.views.length]));
    await pickPaperMasks(ann, [["Rounds", "3"]]);
    await tap(ann, "Deal the masks");
    await allAt("writing");
    await wait(500);
    const views = [...people, tv].filter(Boolean).flatMap((p) => p.views.slice(from.get(p)).map((rec) => [p, rec]));
    check(views.some(([, rec]) => rec.s.phase === "writing"), `the second match is dealt (${views.length} messages)`);
    check(views.every(([, rec]) => !(rec.s.round > 1) && ["setup", "writing"].includes(rec.s.phase)), `the second match starts afresh, at round 1 (${[...new Set(views.map(([, rec]) => `${rec.s.phase} r${rec.s.round}`))].join(", ")})`);
    for (const [p, rec] of views) for (const t of before) pass(!JSON.stringify(rec.s).includes(JSON.stringify(t).slice(1, -1)), `the second match: the first match's answer "${t}" reached ${p.name} (${rec.s.phase} r${rec.s.round})`);
    for (const p of [...live(), tv].filter(Boolean)) {
      const html = await p.page.evaluate(() => document.documentElement.outerHTML).catch(() => "");
      const plain = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      for (const t of before) pass(!plain.includes(t), `the second match: the first match's answer "${t}" is on ${p.name}'s page`);
    }
    await audit("the second match, dealt");
    known = { 0: Object.fromEntries(before.map((t, i) => [`old${i}`, t])) };
    await storageClean("the second match, dealt");
    known = {};
    await ann.page.locator(".stage-head .stop").click();
    await ann.page.locator(".confirm .button", { hasText: /^End the game$/ }).click();
    await Promise.all([...live(), tv].filter(Boolean).map((p) => p.page.waitForSelector(".stage", { state: "hidden", timeout: 15000 })));
    check(true, "the host ended the second match: everyone is back at the Table");
  }

  // ---------------------------------------------------------------- match 2: four, on a call, with accidents
  async function match2() {
    const ann = byName("Ann");
    const di = await joinParty("Di", pin);
    const [bo, cy] = [byName("Bo"), byName("Cy")];
    await pickPaperMasks(ann, [["Rounds", "3"]]);
    await tap(ann, "We're on a call");
    await ann.page.waitForSelector('.pm-toggle.on >> text="We\'re on a call"', { timeout: 5000 });
    await tap(ann, "Deal the masks");
    await allAt("writing");
    let fay = null;
    await playRound({
      kinds: { Di: "long" },
      during: {
        writing: async () => {
          // Di has half an answer typed when her page reloads: it is still there.
          await dismissDeal(di);
          await di.page.fill(".pm-write textarea", "Di half typed");
          await di.page.reload();
          await di.page.waitForSelector(".pm[data-phase=writing] .pm-write textarea", { timeout: 20000 });
          const kept = await di.page.inputValue(".pm-write textarea");
          check(kept === "Di half typed", `Di reloaded mid-writing: her half-typed answer is still in the box ("${kept}")`);
          check(!(await di.page.locator(".pm-deal").count()), "Di is not dealt her mask a second time after the reload");
          await still(di, "writing-after-reload-390x844", "Di's phone after a reload mid-writing: her half-typed answer is still in the box.");
          // Cy sends, then loses the connection for a few seconds, and comes back to her sent answer.
          await dismissDeal(cy);
          const raw = answerFor("Cy", 1);
          known[1] ??= {};
          known[1][cy.seat] = tidyAnswer(raw).text;
          await cy.page.fill(".pm-write textarea", raw);
          await cy.page.click(".pm-write button[type=submit]");
          await cy.page.waitForSelector(".pm-yours", { timeout: 8000 });
          await cy.context.setOffline(true);
          await wait(4000);
          await cy.context.setOffline(false);
          await cy.page.waitForFunction(() => !/Reconnecting/.test(document.querySelector(".status")?.textContent ?? ""), null, { timeout: 30000 });
          await cy.page.waitForSelector(".pm-yours .pm-a", { timeout: 20000 });
          const back = await cy.page.locator(".pm-yours .pm-a").textContent();
          check(back === known[1][cy.seat], `Cy lost her connection and came back to her own sent answer ("${back}")`);
          await audit("after Cy's reconnect");
        },
        reading: async () => {
          const lists = await Promise.all(inMatch().map((p) => p.page.locator(".pm-list li").count()));
          check(lists.every((n) => n === 4), `on a call every phone shows the reader's list (${lists.join(", ")})`);
          await still(bo, "reading-call-390x844", "On a call: every phone shows the shuffled list, the same one the reader reads.");
        },
        guessing: async (index) => {
          if (index === 0) {
            // Fay arrives mid-match: she watches this round and may guess for a side score.
            fay = await joinParty("Fay", pin);
            await fay.page.waitForSelector(".pm[data-role=watcher]", { timeout: 20000 });
            const hint = await fay.page.locator(".pm-side").textContent();
            check(/side score/.test(hint), "Fay joined mid-match: she watches, and her guesses count towards a side score");
            await still(fay, "watcher-390x844", "Fay joined mid-round: a watcher, guessing for a side score.");
            await audit("Fay joined");
          }
          if (index === 1) {
            // Di taps, then her page reloads: her tap is still hers.
            const s = di.view.step;
            di.clicked.add(s.card.id);
            await di.page.locator(".pm-chip:not(.used):not([disabled])").nth(s.yours ? 1 : 0).click();
            await di.page.waitForSelector(".pm-chip.sel", { timeout: 8000 });
            const before = await di.page.locator(".pm-chip.sel b").textContent();
            const at = await di.page.locator(".pm-chip").evaluateAll((els) => els.findIndex((e) => e.classList.contains("sel")));
            await di.page.reload();
            await di.page.waitForSelector(".pm[data-phase=guessing] .pm-chip.sel", { timeout: 20000 });
            const after = await di.page.locator(".pm-chip.sel b").textContent();
            const atAfter = await di.page.locator(".pm-chip").evaluateAll((els) => els.findIndex((e) => e.classList.contains("sel")));
            // A guess is the server's: the same name. An author's tap is kept in no storage, so after
            // a reload the view shows one free name, picked by the card's id: tapped, all the same.
            if (s.yours) {
              const free = await di.page.locator(".pm-chip.sel:not(.used)").count();
              check(free === 1, `Di reloaded mid-guessing on her own card: her tap is still in, one free name shown as tapped ("${before}" at ${at}, then "${after}" at ${atAfter})`);
            } else check(after === before && at === atAfter, `Di reloaded mid-guessing: her tap is still in ("${before}" at ${at}, then "${after}" at ${atAfter})`);
            await storageClean("Di's reload mid-guessing");
          }
        },
      },
    });
    check(fay && (await nextRound()) === "Next round", "round 2 begins");
    await allAt("writing", players());
    check(fay.view.you.role === "player", `Fay plays from round 2 (${fay.view.you.role})`);
    await playRound({
      during: {
        reading: async () => {
          // The reader (not the host) asks to skip an answer; the host skips it.
          const reader = inMatch().find((p) => p.view.you.reader);
          check(reader !== ann, `round 2 is read by ${reader.name}, not the host`);
          const text = reader.view.step.cards[0].text;
          await reader.page.locator(".pm-list li").first().locator("button", { hasText: "Ask host to skip" }).click();
          await ann.page.waitForSelector(".pm-ask", { timeout: 8000 });
          const asked = await ann.page.locator(".pm-ask .pm-a").textContent();
          check(asked === text, `the host sees the asked answer's text: "${asked}"`);
          check(!JSON.stringify(ann.view.asks).includes('"by"'), "the host is told the asked answer's text and id, never its author");
          await still(ann, "skip-ask-host-390x844", "The reader asked to skip an answer: the host sees only its text, with Keep and Skip.");
          await ann.page.locator(".pm-ask button", { hasText: "Skip it" }).click();
          await ann.page.waitForSelector(".pm-sheet", { timeout: 5000 });
          await still(ann, "skip-confirm-390x844", "Skip, asked once more: it goes from every phone and its author is never shown.");
          await ann.page.locator(".pm-sheet button", { hasText: "Skip it" }).click();
          await Promise.all(inMatch().map((p) => p.page.waitForFunction(() => document.querySelectorAll(".pm-list li").length === 4, null, { timeout: 8000 })));
          await wait(300);
          skipped.push({ match: matchNo, round: reader.view.round, text, from: new Map([...people, tv].filter(Boolean).map((p) => [p, p.views.length])) });
          await audit("after the skip");
        },
        guessing: async (index) => {
          if (index !== 0) return compareCard("on a call, after a skip", `on a call after a skip, answer ${index + 1}`);
          // Bo leaves the party mid-match (he reads this round): the match goes on without him.
          bo.clicked.add(bo.view.step.card.id);
          await bo.page.click(".top .leave");
          await bo.page.locator(".confirm .button", { hasText: "Leave" }).click();
          bo.gone = true;
          await bo.page.waitForURL((url) => new URL(url).pathname !== "/party/", { timeout: 15000 });
          await ann.page.waitForFunction(() => /Bo left the match/.test(document.querySelector(".pm-toast")?.textContent ?? ""), null, { timeout: 15000 });
          await still(ann, "left-390x844", "Bo left the party mid-match: everyone is told, and the match goes on.");
          const reader = inMatch().find((p) => p.view.you.reader);
          check(reader && reader !== bo, `the reading passed on when Bo left (${reader?.name})`);
          check(inMatch()[0].view.step.tapsDue === 4, `the tap count waits for the four still here (${inMatch()[0].view.step.tapsDue})`);
        },
      },
    });
    await nextRound();
    await playRound({ pick: "random" });
    await nextRound();
    await allAt("over");
    await wait(1200);
    await audit("the end of match 2");
    await storageClean("the end of match 2");
    const rows = await ann.page.locator(".pm-board li").allTextContents();
    check(rows.some((r) => /Bo/.test(r) && /left/.test(r)), `Bo keeps a greyed row marked as left (${rows.join(" | ")})`);
    await still(fay, "final-with-leaver-390x844", "The final standings with a player who left (greyed, no place) and one who joined in round 2.");
    await backToTable(ann);
    await ann.page.click(".card-done").catch(() => {});
    allCompared([["on a call, after a skip", "any"]]);
  }

  // ---------------------------------------------------------------- match 3: eight players, every size
  async function match3() {
    const ann = byName("Ann");
    // (Bartholomew Jo: 14 characters, the longest a name may be, so a title and the lines that name him wrap.)
    for (const name of ["Gus", "Hal", "Ivy", "Bartholomew Jo", "Kit", "Lu", "Max"]) {
      if (live().filter((p) => !p.screen).length >= 8) break;
      await joinParty(name, pin);
    }
    check(live().length === 8, `eight at the Table (${live().map((p) => p.name).join(", ")})`);
    await pickPaperMasks(ann, [["Rounds", "3"]]);
    await tap(ann, "Family-safe prompts");
    const cy = byName("Cy");
    await tap(ann, "Deal the masks");
    await allAt("writing");
    const sizes = (phase) => sizesOf(phase, cy, 8);
    await playRound({
      kinds: { Ann: "long", Cy: "unbroken", Di: "rtl", Fay: "markup", Gus: "emoji" },
      pick: "random",
      during: {
        writing: async () => {
          for (const p of inMatch()) await dismissDeal(p);
          await sizes("writing");
        },
        reading: async () => sizes("reading"),
        guessing: async (index) => {
          await compareCard("8 players, before a skip", `8 players, answer ${index + 1}`, { name: "pair-8-before-skip", caption: "Eight players, guessing: the author's phone and a guesser's, side by side. The same seven painted masks with names." });
          if (index === 0) await sizes("guessing");
        },
        reveal: async () => {
          const reader = inMatch().find((p) => p.view.you.reader);
          await tap(reader, "Reveal the first one");
          await wait(2600);
          await sizes("reveal");
          await tap(reader, "Reveal all the rest");
          await wait(500);
          check(reader.view.step.allRevealed, "at eight players the reader can reveal all the rest at once");
        },
        summary: async () => sizes("summary"),
      },
    });
    await nextRound();
    await playRound({
      pick: "random",
      during: {
        guessing: async (index) => {
          if (index === 0 && !skipped.some((b) => b.match === matchNo)) await hostSkipsCurrent(ann);
          if (inMatch()[0].view.phase === "guessing") await compareCard("8 players, after a skip", `8 players after a skip, answer ${inMatch()[0].view.step.index + 1}`, { name: "pair-8-after-skip", caption: "Eight players, guessing after the host skipped an answer: the author's phone and a guesser's. As many chips on each." });
        },
      },
    });
    await nextRound();
    // The last round's guesses are fixed, not random, and every reveal is looked at, at every size:
    // each split of the seven guessers between "Guessed right" and "Fooled", every answer as long
    // as the rules allow. The first to come off is three right and four fooled: two rows of chips
    // over the most lines that ever stood at full size.
    await playRound({ kinds: Object.fromEntries(live().map((p) => [p.name, "long"])), fixed: { targets: () => [3, 4, 5, 6, 7, 2, 1, 0], phone: cy, count: 8 } });
    await nextRound();
    await allAt("over");
    await wait(1500);
    await audit("the end of match 3");
    await storageClean("the end of match 3");
    await sizes("final");
    await still(cy, "final-8-390x844", "Eight players: the final curtain on a phone.");
    await backToTable(ann);
    allCompared([
      ["8 players, before a skip", "full"],
      ["8 players, after a skip", "full"],
    ]);
  }

  return { setUp, match1, secondMatch, match2, match3, stills };
}

// ================================================================== the run

/** Each party plays in a lane of its own: its lines say which, and a failure stops only its lane. */
async function inLane(name, run) {
  const t0 = Date.now();
  try {
    await lane.run(name, run);
  } catch (err) {
    lane.run(name, () => check(false, `the party stopped: ${err?.stack ?? err}`));
  }
  return [name, Date.now() - t0];
}

const parties = [];
let took;
try {
  if (together) {
    // One party plays the three matches one after another, as on one evening.
    const party = makeParty("");
    parties.push(party);
    took = [
      await inLane("", async () => {
        await party.setUp(["Bo", "Cy"]);
        if (only.has(1)) await party.match1();
        if (only.has(2)) await party.match2();
        if (only.has(3)) await party.match3();
      }),
    ];
  } else {
    // A party of its own for each match, the three side by side. Match 3's party is the same eight
    // the evening above ends with: Ann, Cy, Di and Fay, and Gus, Hal, Ivy and Bartholomew Jo join there.
    const plan = [
      [1, ["Bo", "Cy"], async (p) => (await p.match1(), await p.secondMatch())],
      [2, ["Bo", "Cy"], (p) => p.match2()],
      [3, ["Cy", "Di", "Fay"], (p) => p.match3()],
    ].filter(([n]) => only.has(n));
    took = await Promise.all(
      plan.map(([n, names, play]) => {
        const party = makeParty(`m${n}-`);
        parties.push(party);
        return inLane(`match ${n}`, async () => {
          await party.setUp(names);
          await play(party);
        });
      }),
    );
  }
} finally {
  await browser.close();
}

const stills = parties.flatMap((p) => p.stills);
const index = `<!doctype html><meta charset="utf-8"><title>Paper Masks stills</title><style>body{font:15px system-ui;background:#1b0d12;color:#fbf0dc;margin:16px}figure{display:inline-block;vertical-align:top;margin:0 16px 24px 0;max-width:420px}img{max-width:100%;max-height:520px;border:1px solid #6b4a3a}figcaption{margin-top:6px}</style><h1>Paper Masks at the Table</h1>${stills.map((s) => `<figure><img src="${s.file}" alt=""><figcaption><b>${s.file}</b><br>${s.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</figcaption></figure>`).join("")}`;
writeFileSync(`${out}/index.html`, index);
writeFileSync(`${out}/captions.txt`, stills.map((s) => `${s.file}\t${s.caption}`).join("\n") + "\n");
check(!errors.length, `no page logged an error${errors.length ? `: ${errors.slice(0, 8).join(" | ")}` : ""}`);
console.log(`\n${together ? "one party, the matches one after another" : `${took.length} parties side by side`}: ${took.map(([n, ms]) => `${n || "the party"} ${(ms / 1000).toFixed(0)} s`).join(", ")}`);
console.log(`${passes} secrecy and layout checks passed; stills in ${out}`);
console.log(problems.length ? `${problems.length} problem(s)` : "all good");
process.exit(problems.length ? 1 : 0);
