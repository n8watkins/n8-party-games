// End to end, in real pages (headless and muted): Who Am I? at the Table.
//
//   node party/games/who-am-i/test/e2e-who-am-i.mjs [--base=http://localhost:8791] [--out=<folder for stills>] [--only=1,2,3]
//
// One party plays three whole matches through real browsers:
//   1. Ann and Bo alone, first to 3, trade turns: typed questions (one of them markup), every
//      answer, hints, a wrong guess, a pass, Bo reloads mid-turn and comes back to the same screen,
//      and the self-confirm path: Bo's phone drops while Ann's guess waits, Ann confirms it herself
//      30 s later, Bo's phone comes back. At the last reveal the Table's own End the game is hidden;
//      Back to the Table ends it with the card.
//   2. Ann and Bo again, five rounds, keep going, with the big screen on, and Cy and Di arriving
//      mid-match: they watch. Questions counted out loud, a give-up, and every phase at 320x568,
//      390x844, 844x390, 1280x720 and 1920x1080 (the big screen at the last two).
//   3. Cy and Di leave; Ann and Bo play Clues, and Bo leaves the party mid-round: he forfeits and
//      Ann is first.
// Every tap is a real click. Every message any page receives, and after every step each page's
// whole document and its storage, is checked: no player ever has their own name (the name, an
// alias as a whole word, its picture's address or its file page) before the round's reveal, and
// no watcher or big screen has either; no storage holds a name, a hint or a question; typed text
// is rendered as text only. A player's screen in the same role in two rounds (two different own
// names) is compared element for element and box for box, outside the other player's card.
// Pictures are served by the test in place of upload.wikimedia.org, which the page must load with
// no referrer and the site's CSP must allow. Captioned stills of every phase go to --out.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser } from "../../../../lobby/test/browser.mjs";
import { IDENTITIES } from "../deck.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "/tmp/claude-who-am-i-table/stills"));
const only = new Set(opt("only", "1,2,3").split(",").map(Number));
mkdirSync(out, { recursive: true });

const problems = [];
const check = (ok, what) => {
  if (!ok || process.env.VERBOSE) console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
  return ok;
};
let passes = 0;
const pass = (ok, what) => (ok ? (passes += 1) : check(false, what));
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = "who-am-i";

// What the server keeps and a page must never be sent.
const SECRET_KEYS = new Set(["secret", "draws", "assign", "usedIds", "sends", "here", "goneSince", "idSeq", "tracks", "starter", "deck", "id"]);
const BY_NAME = new Map(IDENTITIES.map((i) => [i.name, i]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The ways a name could show on a page or in a message: its name, its aliases (whole words), its picture's addresses. */
function giveaways(name) {
  const i = BY_NAME.get(name);
  const words = [name, ...(i?.aliases ?? [])].filter((w) => w.length >= 3);
  const urls = i?.picture ? [i.picture.imageUrl, i.picture.filePage, decodeURIComponent(i.picture.imageUrl)] : [];
  return { words, urls };
}
function holds(text, name) {
  const { words, urls } = giveaways(name);
  if (urls.some((u) => text.includes(u))) return `its picture address`;
  for (const w of words) if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) return `"${w}"`;
  return null;
}

// A plain portrait served in place of every Wikimedia picture.
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><rect width="400" height="500" fill="#c9bff5"/><circle cx="200" cy="190" r="90" fill="#4c35b5"/><rect x="80" y="320" width="240" height="180" rx="90" fill="#4c35b5"/></svg>`;
const pictureRequests = [];

const browser = await launchBrowser();
const errors = [];
const stills = [];
/** Every page in the party: {name, page, context, seat, views, view, screen, gone}. */
const people = [];
let tv = null;
let matchNo = 0;
/** Each round's names, as the phones learn them: `${match}:${round}` -> {seat: name}. */
const dealt = new Map();
/** Every hint and question text seen this run (none may be stored on a phone). */
const typed = new Set();

// ------------------------------------------------------------------ pages and the wire

function learn(s) {
  if (s.phase === "playing" && s.opponent) {
    const k = `${matchNo}:${s.round}`;
    const round = dealt.get(k) ?? {};
    round[s.opponent.seat] = s.opponent.name;
    dealt.set(k, round);
  }
  if (s.phase === "playing") for (const e of s.turn.log) typed.add(e.text);
}

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
      if ((msg.t === "snap" || msg.t === "start") && msg.s?.game === GAME) {
        p.views.push({ s: msg.s, raw: JSON.stringify(msg.s), match: matchNo, checked: false });
        p.view = msg.s;
        learn(msg.s);
      }
    });
  });
}

async function open(name, { width = 390, height = 844, screen = false } = {}) {
  const context = await browser.newContext(screen ? { viewport: { width, height } } : { viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID });
  await context.route("https://upload.wikimedia.org/**", (route) => {
    pictureRequests.push({ who: name, url: route.request().url(), referer: route.request().headers().referer ?? null });
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: PICTURE });
  });
  const page = await context.newPage();
  const p = { name, page, context, seat: null, views: [], view: null, screen, gone: false };
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message} (${(e.stack ?? "").split("\n").slice(1, 3).join(" ").trim()})`));
  page.on("console", (m) => m.type() === "error" && !/WebSocket|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
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

async function leaveParty(p) {
  await p.page.click(".top .leave");
  await p.page.locator(".confirm .button", { hasText: "Leave" }).click();
  p.gone = true;
  await p.page.waitForURL((url) => new URL(url).pathname !== "/party/", { timeout: 15000 });
}

const live = () => people.filter((p) => !p.gone);
const all = () => [...live(), tv].filter(Boolean);
const byName = (name) => people.find((p) => p.name === name);
/** The two pages playing the match now. */
const inMatch = () => live().filter((p) => p.view?.you?.role === "player" && p.view.phase !== "setup");
const roleOf = (p) => (p.view?.you?.role === "player" ? "player" : p.screen ? "screen" : "watcher");

// ------------------------------------------------------------------ the secrecy checks

/** The names a page may not hold in view `s`: its own while a round is on; both for anyone not playing. */
function forbidden(p, s, match) {
  if (s.phase !== "playing") return []; // no name is dealt before the match; after a round, its reveal shows both
  const round = dealt.get(`${match}:${s.round}`);
  if (!round) return null; // not known yet: checked later
  const mine = s.you?.role === "player" ? s.you.seat : null;
  const entries = Object.entries(round);
  if (s.phase === "playing" && entries.length < 2) return null;
  return entries.filter(([seat]) => mine === null || Number(seat) === mine).map(([seat, name]) => [Number(seat), name]);
}

function walk(value, visit, path = []) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, i]));
  else if (value && typeof value === "object") {
    visit(value, path);
    for (const [k, v] of Object.entries(value)) walk(v, visit, [...path, k]);
  }
}

function checkView(p, rec, where) {
  const s = rec.s;
  walk(s, (obj, path) => {
    // ("id" is a question's or hint's plain count, or a pack's id; a name's id is "pack.slug".)
    for (const k of Object.keys(obj)) if (SECRET_KEYS.has(k) && !(k === "id" && !String(obj.id).includes("."))) check(false, `${where}: a server key "${k}" at ${path.join(".")}`);
  });
  const names = forbidden(p, s, rec.match);
  if (names === null) return false;
  for (const [seat, name] of names) {
    const found = holds(rec.raw, name);
    pass(!found, `${where}: ${p.name} was sent ${s.you?.role === "player" ? "their own name" : `seat ${seat}'s name`} (${name}, as ${found})`);
  }
  if (s.phase === "playing" && s.you?.role !== "player") pass(!("opponent" in s), `${where}: a ${s.you?.role} was sent an opponent`);
  return true;
}

/** Checks every message received since the last audit, and every page's whole document and storage now. */
async function audit(label) {
  for (const p of [...people, tv].filter(Boolean)) {
    for (const rec of p.views) {
      if (rec.checked) continue;
      rec.checked = checkView(p, rec, `${label}, message to ${p.name} (${rec.s.phase} r${rec.s.round})`);
    }
  }
  await Promise.all(
    all().map(async (p) => {
      let dom;
      try {
        dom = await p.page.evaluate(() => {
          const root = document.querySelector(".wa");
          const all = (s) => Object.keys(s).map((k) => [k, s.getItem(k) ?? ""]);
          return {
            html: document.documentElement.outerHTML,
            phase: root?.dataset.phase ?? null,
            markup: [...document.querySelectorAll(".wa-qtext, .wa-question, .wa-hint span, .wa-name")].filter((e) => e.childElementCount > 0).length,
            store: [...all(localStorage), ...all(sessionStorage), ["cookie", document.cookie]],
          };
        });
      } catch {
        return; // navigating (a reload, or back at the Table)
      }
      // Storage: nothing of the game at all, in any round, ever.
      for (const [k, value] of dom.store) {
        const text = `${k} ${value}`;
        for (const round of dealt.values()) for (const name of Object.values(round)) pass(!holds(text, name), `${label}: ${p.name}'s storage holds the name ${name} (${k})`);
        for (const t of typed) pass(!text.includes(t), `${label}: ${p.name}'s storage holds "${t}" (${k})`);
      }
      if (!dom.phase || !p.view) return;
      const s = p.view;
      if (dom.phase !== s.phase) return; // the page has not drawn its latest view yet
      const names = forbidden(p, s, matchNo);
      if (!names) return;
      const where = `${label}, ${p.name}'s page (${s.phase} r${s.round})`;
      const html = dom.html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      for (const [seat, name] of names) {
        const found = holds(html, name);
        pass(!found, `${where}: ${p.name}'s page holds ${roleOf(p) === "player" ? "their own name" : `seat ${seat}'s name`} (${name}, as ${found})`);
      }
      pass(dom.markup === 0, `${where}: typed text or a name was rendered as markup`);
    }),
  );
}

/** A page's game as structure and boxes, outside the other player's card (which shows a name of its own length). */
const shapeOf = (p) =>
  p.page.evaluate(() => {
    const root = document.querySelector(".wa");
    const els = [...root.querySelectorAll("*")].filter((e) => !e.closest(".wa-opp") && !e.closest(".wa-toast") && !e.closest(".wa-bar-end"));
    const attrs = (e) => [...e.attributes].filter((a) => !["data-at", "aria-label", "style", "data-words"].includes(a.name)).map((a) => `${a.name}=${a.name === "class" || a.name.startsWith("data-") || a.name === "role" || a.name === "type" ? a.value : "*"}`).join(" ");
    return {
      tags: els.map((e) => `${e.tagName} ${attrs(e)}`),
      // A box holding the other player's card is as tall as that card (their name, their picture):
      // only its x and width are compared. The suggested questions are shuffled every turn (as live),
      // so their own boxes are not compared, only that they are there.
      boxes: els.map((e) => {
        const r = e.getBoundingClientRect();
        if (e.closest(".wa-suggest")) return [0, 0, 0];
        return [Math.round(r.x), Math.round(r.width), e.querySelector(".wa-opp") ? 0 : Math.round(r.height)];
      }),
      texts: els.filter((e) => e.closest(".wa-self")).map((e) => e.textContent),
    };
  });

/** One page's screen in one role, kept per role to compare with the same role in a later round. */
const shapes = new Map();
const compared = { same: 0 };
async function sameRole(p, role, label) {
  const shape = await shapeOf(p);
  const k = `${p.name}:${role}`;
  const first = shapes.get(k);
  if (!first) return shapes.set(k, { shape, label });
  const a = first.shape;
  const b = shape;
  const sameTags = a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);
  check(sameTags, `${p.name} as ${role}: the screen is the same, element for element, in ${first.label} and ${label} (two different own names)${sameTags ? "" : `: first difference ${a.tags.find((t, i) => t !== b.tags[i])} / ${b.tags.find((t, i) => t !== a.tags[i])}`}`);
  if (sameTags) {
    const off = a.boxes.map((box, i) => Math.max(...box.map((x, j) => Math.abs(x - b.boxes[i][j]))));
    const worst = off.indexOf(Math.max(...off));
    check(Math.max(0, ...off) <= 1, `${p.name} as ${role}: the same boxes in ${first.label} and ${label} (worst: ${a.tags[worst]} ${a.boxes[worst]} vs ${b.boxes[worst]})`);
  }
  check(a.texts.join("|") === b.texts.join("|"), `${p.name} as ${role}: the "Your name: hidden" line reads the same (${b.texts.join("|")})`);
  compared.same += 1;
}

// ------------------------------------------------------------------ looking at the pages

async function still(p, name, caption) {
  const file = `${String(stills.length + 1).padStart(2, "0")}-${name}.png`;
  await p.page.screenshot({ path: `${out}/${file}` });
  stills.push({ file, caption });
}

/** No sideways scroll; on the big screen no scroll at all and nothing cut off; every tap target at least 44 px. */
async function fits(p, label, { screen = p.screen } = {}) {
  const m = await p.page.evaluate(() => {
    const root = document.querySelector(".wa");
    const small = [];
    for (const e of root.querySelectorAll("button, a, input")) {
      if (!e.checkVisibility()) continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${e.className || e.tagName}: ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const frame = root.getBoundingClientRect();
    const cut = [...root.querySelectorAll("p, li, button, h2, .wa-card")]
      .filter((e) => e.checkVisibility() && !e.closest(".wa-logbox"))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.height && (r.bottom > frame.bottom + 1 || r.top < frame.top - 1 || r.right > frame.right + 1 || r.left < frame.left - 1);
      })
      .map((e) => `${e.className || e.tagName}: ${(e.textContent ?? "").slice(0, 24)}`);
    // Anything wider than the stage, apart from the suggestions' own row, which slides sideways by design (as live).
    const wide = [...root.querySelectorAll("*")].filter((e) => !e.closest(".wa-suggest") && e.getBoundingClientRect().right > frame.right + 1 && e.checkVisibility()).map((e) => e.className || e.tagName);
    return { cut: cut.slice(0, 4), cutCount: cut.length, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight, rootWide: root.scrollWidth - root.clientWidth, wide: wide.slice(0, 4), small };
  });
  check(m.sw <= m.w && m.rootWide <= 1 && !m.wide.length, `${label}: nothing scrolls sideways (${m.sw} in ${m.w}, inner ${m.rootWide}${m.wide.length ? `, wide: ${m.wide.join(", ")}` : ""})`);
  if (screen) check(m.sh <= m.h && !m.cutCount, `${label}: the big screen does not scroll and cuts nothing off (${m.sh} in ${m.h}${m.cutCount ? `, cut: ${m.cut.join(" | ")}` : ""})`);
  check(!m.small.length, `${label}: every tap target is at least 44 pixels${m.small.length ? ` (${m.small.join(", ")})` : ""}`);
}

/** One phone at every size, then the big screen at both of its sizes, for one phase. */
async function sizes(phone, phase) {
  for (const [w, h] of [[320, 568], [844, 390], [1280, 720], [390, 844]]) {
    await phone.page.setViewportSize({ width: w, height: h });
    await wait(350);
    await fits(phone, `${phase}, ${phone.name} at ${w}x${h}`, { screen: false });
    if (w !== 390) await still(phone, `${phase}-${phone.name.toLowerCase()}-${w}x${h}`, `${phase}: ${phone.name}'s phone at ${w}x${h}.`);
  }
  if (!tv) return;
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    await tv.page.setViewportSize({ width: w, height: h });
    await wait(350);
    await fits(tv, `${phase}, big screen ${w}x${h}`);
    if (w === 1920) await still(tv, `${phase}-screen-${w}x${h}`, `${phase} on a ${w}x${h} big screen.`);
  }
}

const phaseOf = (p) => p.page.evaluate(() => document.querySelector(".wa")?.dataset.phase ?? null).catch(() => null);
async function allAt(phase, list = all(), timeout = 20000) {
  await Promise.all(list.map((p) => p.page.waitForFunction((ph) => document.querySelector(".wa")?.dataset.phase === ph, phase, { timeout })));
}

/** Clicks the game's button whose text is exactly `text` on page `p`, once it is enabled. */
async function tap(p, text) {
  const exact = typeof text === "string" ? new RegExp(`^${escapeRe(text)}$`) : text;
  const b = p.page.locator(".wa button").filter({ hasText: exact });
  await b.first().waitFor({ state: "visible", timeout: 15000 });
  await p.page.waitForFunction((src) => [...document.querySelectorAll(".wa button")].some((b) => new RegExp(src).test(b.textContent) && !b.disabled), exact.source, { timeout: 15000 });
  const before = p.views.length;
  await b.first().click();
  await p.page.waitForFunction(() => !document.querySelector(".wa-busy"), null, { timeout: 10000 }).catch(() => {});
  // Every page has heard what the tap changed.
  for (let i = 0; i < 30 && p.views.length === before; i++) await wait(50);
  await wait(250);
}

// ------------------------------------------------------------------ playing

/** The guesser's and the judge's pages in the turn now. */
function turnPages() {
  const [a, b] = inMatch();
  const t = a.view.turn;
  return t.seat === a.view.you.seat ? [a, b] : [b, a];
}

async function ask(g, text) {
  await g.page.fill("#wa-ask-input", text);
  await tap(g, "Send");
}

async function pickWhoAmI(host, choices = []) {
  await host.page.locator(".game button.game-row", { hasText: "Who Am I?" }).click();
  await allAt("setup", all(), 15000);
  matchNo += 1;
  for (const [group, value] of choices) {
    await tap(host, value);
    await host.page.waitForFunction(([g, v]) => [...document.querySelectorAll(".wa-group")].some((el) => el.querySelector(".wa-lab")?.textContent === g && el.querySelector(".wa-opt.on")?.textContent === v), [group, value], { timeout: 5000 });
  }
}

/** Plays the turn now to a right guess, confirmed: the plain way to the end of a round. */
async function rightGuess(label) {
  const [g, j] = turnPages();
  if (g.view.turn.log.some((e) => e.kind === "question" && e.answer === null)) {
    await tap(j, "Yes");
  }
  await tap(g, "I Guessed It");
  await j.page.waitForSelector(".wa-act .wa-btn.success", { timeout: 10000 });
  await audit(`${label}: a guess waits`);
  await tap(j, "Yes, correct");
  await audit(`${label}: the guess confirmed`);
}

async function nextRound(p) {
  const label = await p.page.locator(".wa-act .wa-btn").first().textContent();
  await tap(p, label);
  return label;
}

async function backToTable(p) {
  await tap(p, "Back to the Table");
  await Promise.all(all().map((x) => x.page.waitForSelector(".card:not([hidden]) .card-rows li, .card:not([hidden]) .card-early", { timeout: 15000 })));
}

// ================================================================== the run

try {
  const { p: ann, pin } = await startParty("Ann");
  await ann.page.click(".rooms-btn");
  await ann.page.waitForSelector(".mode-choice:visible");
  await ann.page.click(".mode-choice");
  await atTable(ann);
  const bo = await joinParty("Bo", pin);
  check(true, `Ann and Bo are at the Table (${pin})`);
  const entry = await bo.page.locator(".game", { hasText: "Who Am I?" }).textContent();
  check(!/Coming soon/.test(entry), `Who Am I? is on the Table's list as playable: "${entry.trim()}"`);
  await still(bo, "table-list-390x844", "The Table's list on Bo's phone: Who Am I? playable for two.");

  // ---------------------------------------------------------------- match 1: two players alone
  if (only.has(1)) {
    await pickWhoAmI(ann, [["Match", "First to 3"]]);
    await still(ann, "setup-host-390x844", "Setup, the host's phone: category, level, mode, turns, questions, match, timer, hints; Start the game.");
    await still(bo, "setup-player-390x844", "Setup, the other player's phone: who plays and the host's choices as they stand.");
    await fits(ann, "setup, host");
    await fits(bo, "setup, player");
    await audit("setup");
    await tap(ann, "Start the game");
    await allAt("playing");
    await wait(400);
    await audit("round 1 begins");
    let [g, j] = turnPages();
    await sameRole(g, "guesser, a fresh turn", "round 1");
    await sameRole(j, "judge, a fresh turn", "round 1");
    await still(g, "turn-guesser-390x844", `Round 1, ${g.name} guesses: the other player's name small at the top, "Your name: hidden", suggested questions, a box, Hint, Pass and I Guessed It.`);
    await still(j, "turn-judge-390x844", `Round 1, ${j.name} answers: the headband card with the name to answer as, its picture and credit.`);
    await fits(g, "turn, guesser");
    await fits(j, "turn, judge");
    // A typed question with markup in it shows as text; the judge answers it.
    const markup = `<b>Am I</b> "real" & <img src=x onerror=alert(1)>?`;
    await ask(g, markup);
    await j.page.waitForSelector(".wa-answer", { timeout: 10000 });
    await audit("a question waits");
    const shown = await j.page.locator(".wa-question").textContent();
    check(shown === markup, `a question with markup shows as plain text on the judge's phone ("${shown}")`);
    await still(j, "answer-390x844", `${j.name} is asked: the question big, Yes, No, Sort of, Don't know.`);
    await still(g, "waiting-390x844", `${g.name} waits for the answer.`);
    await tap(j, "Sort of");
    await audit("answered sort of");
    // A hint, then a wrong guess: the move ends (trade turns).
    await tap(g, /^Hint \d$/);
    await audit("a hint");
    check((await g.page.locator(".wa-hint").count()) === 1 && (await j.page.locator(".wa-hint").count()) === 1, "the hint is in the log on both phones");
    await tap(g, "I Guessed It");
    await j.page.waitForSelector(".wa-act .wa-btn.success", { timeout: 10000 });
    await still(j, "confirm-judge-390x844", `${j.name} judges the guess: "Did they say ...?" Not quite or Yes, correct.`);
    await still(g, "confirm-guesser-390x844", `${g.name} waits for the guess to be confirmed, the timer paused.`);
    await audit("a guess waits");
    await tap(j, "Not quite");
    await audit("a wrong guess");
    [g, j] = turnPages();
    check(g !== turnPages()[1] && g.view.turn.log.length === 0, `a wrong guess ends the move: ${g.name} moves now`);
    // The other player asks with a suggested question, gets No, and passes.
    await g.page.locator(".wa-sq").first().click();
    await j.page.waitForSelector(".wa-answer", { timeout: 10000 });
    await tap(j, "No");
    await tap(g, "Pass");
    await audit("a pass");
    [g, j] = turnPages();
    // Bo reloads in the middle of a turn: he lands on the same screen, still without his own name.
    const before = await shapeOf(bo);
    await bo.page.reload();
    await bo.page.waitForSelector(".wa[data-phase=playing]", { timeout: 20000 });
    await wait(600);
    const after = await shapeOf(bo);
    check(before.tags.join("\n") === after.tags.join("\n"), `Bo reloaded mid-turn and is back on the same screen (${before.tags.length} and ${after.tags.length} elements)`);
    await audit("after Bo's reload");
    await rightGuess("round 1");
    await allAt("reveal");
    await audit("reveal r1");
    await still(bo, "reveal-390x844", "The big reveal: both names with their pictures, each result, hints and questions, the scores.");
    await fits(bo, "reveal, Bo");
    await nextRound(bo);
    await allAt("playing");
    await wait(400);
    [g, j] = turnPages();
    await audit("round 2 begins");
    await sameRole(g, "guesser, a fresh turn", "round 2");
    await sameRole(j, "judge, a fresh turn", "round 2");
    // The self-confirm path: the judge's phone drops while the guess waits.
    await tap(g, "I Guessed It");
    await j.page.waitForSelector(".wa-act .wa-btn.success", { timeout: 10000 });
    await j.context.setOffline(true);
    await g.page.waitForFunction(() => /confirm it yourself in/.test(document.querySelector(".wa-act")?.textContent ?? ""), null, { timeout: 30000 });
    await still(g, "self-confirm-wait-390x844", `${j.name}'s phone dropped while ${g.name}'s guess waits: the time until ${g.name} may confirm it herself.`);
    await audit("the judge's phone dropped");
    await g.page.waitForFunction(() => [...document.querySelectorAll(".wa button")].some((b) => b.textContent === "Confirm it myself"), null, { timeout: 45000 });
    await still(g, "self-confirm-390x844", `${j.name}'s phone has been away 30 s: ${g.name} confirms her own guess.`);
    await fits(g, "self-confirm");
    await tap(g, "Confirm it myself");
    await j.context.setOffline(false);
    await j.page.waitForFunction(() => !/Reconnecting/.test(document.querySelector(".status")?.textContent ?? ""), null, { timeout: 30000 });
    await allAt("reveal", inMatch(), 30000);
    check(g.view.notes.some((n) => n.k === "self_confirmed"), "the rules noted the guess as self-confirmed");
    await audit("after the self-confirmed guess and the reconnect");
    // On to the end: right guesses until the match is decided.
    for (let i = 0; i < 8 && !inMatch()[0].view.reveal?.matchOver; i++) {
      await nextRound(inMatch()[i % 2]);
      await allAt("playing", inMatch());
      await wait(300);
      await audit(`round ${inMatch()[0].view.round} begins`);
      [g, j] = turnPages();
      await sameRole(g, "guesser, a fresh turn", `round ${g.view.round}`);
      await sameRole(j, "judge, a fresh turn", `round ${g.view.round}`);
      await rightGuess(`round ${g.view.round}`);
      await allAt("reveal", inMatch());
      await audit(`reveal r${inMatch()[0].view.round}`);
    }
    check(inMatch()[0].view.reveal?.matchOver === true, "the match is decided at first to 3");
    await wait(600);
    check(await ann.page.locator(".stage-head .stop").isHidden(), "on the reveal that decided the match the Table's own End the game is hidden");
    await still(ann, "final-390x844", "The match is decided: who won, both last names, the final scores, Back to the Table.");
    await backToTable(ann);
    const title = await bo.page.locator(".card-head h3").textContent();
    check(/^Who Am I\?: (Ann|Bo) won$/.test(title), `back at the Table with the card: "${title}"`);
    await still(bo, "back-at-table-390x844", "Back at the Table with the card.");
    await audit("back at the Table after match 1");
    await bo.page.click(".card-done").catch(() => {});
    await ann.page.click(".card-done").catch(() => {});
  }

  // ---------------------------------------------------------------- match 2: five rounds, watchers and the big screen
  if (only.has(2)) {
    tv = await openScreen(pin);
    await pickWhoAmI(ann, [["Turns", "Keep going"], ["Match", "5 rounds"], ["Timer", "60 s"]]);
    await still(tv, "setup-screen-1280x720", "Setup on the big screen.");
    await fits(tv, "setup, big screen");
    await sizes(bo, "setup");
    await tap(ann, "Start the game");
    await allAt("playing");
    await wait(400);
    await audit("match 2 begins");
    // Cy and Di arrive mid-match: they watch, with neither name.
    const cy = await joinParty("Cy", pin);
    const di = await joinParty("Di", pin);
    await Promise.all([cy, di].map((p) => p.page.waitForSelector(".wa[data-role=watcher]", { timeout: 20000 })));
    await audit("Cy and Di joined");
    check(!(await cy.page.locator(".wa-opp").count()) && !(await cy.page.locator(".wa-self").count()), "a late joiner sees no name card and no own-name line");
    await still(cy, "watcher-390x844", "Cy joined mid-match: she watches whose turn it is, the questions and answers, the scores; no name.");
    let [g, j] = turnPages();
    await still(tv, "turn-screen-1280x720", "A turn on the big screen: whose turn, the log, the scores and the timer; no name.");
    await sizes(j, "turn");
    await sizes(g, "turn-guesser");
    // Keep going: questions typed and counted out loud, by either player.
    await ask(g, "Am I a real person?");
    await j.page.waitForSelector(".wa-answer", { timeout: 10000 });
    await tap(j, "Don't know");
    await tap(j, "+1");
    await audit("a question counted by the judge");
    check(g.view.turn.questionCount === 2, `the counter: one typed and one counted out loud (${g.view.turn.questionCount})`);
    await still(tv, "log-screen-1280x720", "The big screen with a question, its answer and a counted one.");
    // The guesser gives up this turn; the other player then guesses right.
    await tap(g, "Give up");
    await audit("a give-up");
    [g, j] = turnPages();
    await sameRole(g, "keep going, guesser after a give-up", "round 1");
    await rightGuess("match 2 round 1");
    await allAt("reveal");
    await audit("match 2 reveal r1");
    await still(tv, "reveal-screen-1280x720", "The reveal on the big screen.");
    await sizes(bo, "reveal");
    await still(cy, "reveal-watcher-390x844", "The reveal on a watcher's phone: the players go on.");
    for (let round = 2; round <= 5; round++) {
      await nextRound(inMatch()[round % 2]);
      await allAt("playing", inMatch());
      await wait(300);
      await audit(`match 2 round ${round} begins`);
      // Both players have a turn each round when they keep going.
      for (let turn = 0; turn < 2 && inMatch()[0].view.phase === "playing"; turn++) {
        [g, j] = turnPages();
        if (turn === 0 && round === 3) await sameRole(g, "keep going, guesser at the start", `round ${round}`);
        if (turn === 0 && round === 5) await sameRole(g, "keep going, guesser at the start", `round ${round}`);
        if (round === 4 && turn === 0) {
          await tap(g, /^Hint \d$/);
          await tap(g, "Give up");
          await audit(`round ${round}: a hint, then a give-up`);
        } else await rightGuess(`match 2 round ${round}`);
        await wait(300);
      }
      await allAt("reveal", inMatch());
      await audit(`match 2 reveal r${round}`);
    }
    check(inMatch()[0].view.reveal?.matchOver === true, "five rounds decide the match");
    await wait(500);
    await sizes(ann, "final");
    await still(tv, "final-screen-1280x720", "The decided match on the big screen.");
    await audit("match 2 decided");
    await backToTable(bo);
    await audit("back at the Table after match 2");
    for (const p of all()) await p.page.click(".card-done").catch(() => {});
    await leaveParty(cy);
    await leaveParty(di);
  }

  // ---------------------------------------------------------------- match 3: Clues, and a leave
  if (only.has(3)) {
    await pickWhoAmI(ann, [["Mode", "Clues"], ["Hints", "Off"]]);
    await tap(ann, "Start the game");
    await allAt("playing", inMatch().length ? inMatch() : [ann, bo]);
    await wait(400);
    await audit("match 3 begins");
    let [g, j] = turnPages();
    await still(g, "clues-guesser-390x844", `Clues: ${g.name} listens to the clues and says the guess out loud.`);
    await still(j, "clues-judge-390x844", `Clues: ${j.name} describes the name without saying it.`);
    await fits(g, "clues, guesser");
    await rightGuess("match 3 round 1");
    // In Clues every round has both turns: the second guesser is on.
    await wait(300);
    // Bo leaves the party mid-round: he forfeits, Ann is first.
    await leaveParty(bo);
    await ann.page.waitForSelector(".card:not([hidden]) .card-rows li", { timeout: 20000 });
    const title = await ann.page.locator(".card-head h3").textContent();
    check(/Ann/.test(title), `Bo left mid-round: the card names Ann ("${title}")`);
    await still(ann, "forfeit-card-390x844", "Bo left the party mid-round: he forfeits, and Ann is first on the card.");
    if (tv) await still(tv, "forfeit-card-screen-1280x720", "The big screen after the forfeit.");
    await audit("after the forfeit");
  }

  // Every picture asked for came from the page, with no referrer.
  check(pictureRequests.length > 0, `pictures were loaded from upload.wikimedia.org (${pictureRequests.length})`);
  check(pictureRequests.every((r) => r.referer === null), `no picture request carried a referrer${pictureRequests.some((r) => r.referer) ? `: ${pictureRequests.find((r) => r.referer).referer}` : ""}`);
  check(compared.same >= 4, `a player's screen in the same role was compared across rounds with different own names (${compared.same} times)`);
} finally {
  await browser.close();
}

const index = `<!doctype html><meta charset="utf-8"><title>Who Am I? stills</title><style>body{font:15px system-ui;background:#16141f;color:#f2eefb;margin:16px}figure{display:inline-block;vertical-align:top;margin:0 16px 24px 0;max-width:420px}img{max-width:100%;max-height:520px;border:1px solid #3a3452}figcaption{margin-top:6px}</style><h1>Who Am I? at the Table</h1>${stills.map((s) => `<figure><img src="${s.file}" alt=""><figcaption><b>${s.file}</b><br>${s.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</figcaption></figure>`).join("")}`;
writeFileSync(`${out}/index.html`, index);
writeFileSync(`${out}/captions.txt`, stills.map((s) => `${s.file}\t${s.caption}`).join("\n") + "\n");
check(!errors.length, `no page logged an error${errors.length ? `: ${errors.slice(0, 8).join(" | ")}` : ""}`);
console.log(`\n${passes} secrecy and layout checks passed; stills in ${out}`);
console.log(problems.length ? `${problems.length} problem(s)` : "all good");
process.exit(problems.length ? 1 : 0);
