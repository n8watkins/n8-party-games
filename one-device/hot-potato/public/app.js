// Hot Potato, the page: the screens, the voice, the sounds and the buzz around the round's rules
// (game.js) and the potato's look (art.js). One phone or one browser is passed around the group.
//
// Nothing is sent anywhere by this page; it keeps the category, the number of players and the
// sound and buzz switches in this browser's storage, and works without it. The browser's own
// speech service may send what it hears to its maker.

import { createPotatoArt } from "./art.js";
import {
  LIGHTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  appeal,
  artState,
  canAppeal,
  canStart,
  drainEvents,
  fuseShare,
  hear,
  lightFuse,
  livesLeft,
  newRound,
  playerName,
  setPaused,
  showLetter,
  speaking,
  startTurn,
  stressOf,
  tick,
} from "./game.js";
import { CATEGORIES, CATEGORY_IDS, DEFAULT_CATEGORY, dataUrl } from "./shared/categories.js";
import { buildIndex } from "./shared/logic.js";
import { STAGE_BUZZ, BUZZ, createSounds } from "./sounds.js";
import { MIC_WAIT_MS, Recognition, createListener, listenLang } from "./voice.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const reduced = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
const touchFirst = (() => {
  try {
    return matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
})();

// ---- What this device remembers --------------------------------------------------------------

const STORE_KEY = "n8games.hot-potato";
function loadSetup() {
  const fallback = { category: DEFAULT_CATEGORY, players: 4, sound: false, buzz: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      category: CATEGORIES[saved.category] ? saved.category : fallback.category,
      players: Number.isInteger(saved.players) ? Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, saved.players)) : fallback.players,
      sound: typeof saved.sound === "boolean" ? saved.sound : fallback.sound,
      buzz: typeof saved.buzz === "boolean" ? saved.buzz : fallback.buzz,
    };
  } catch {
    return fallback;
  }
}
function saveSetup() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(setup));
  } catch {
    // Storage refused (a private window, blocked site data): the choice lasts this visit only.
  }
}
const setup = loadSetup();

// ---- The lists, each loaded when its category is first chosen ---------------------------------

const files = new Map();
function getJSON(name) {
  if (!files.has(name)) {
    const p = fetch(dataUrl(name)).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => files.delete(name));
    files.set(name, p);
  }
  return files.get(name);
}
const indexes = new Map();
function loadIndex(id) {
  if (!indexes.has(id)) {
    const category = CATEGORIES[id];
    const p = Promise.all([getJSON(category.file), getJSON("words.json")]).then(([doc, words]) => buildIndex(doc, words, category));
    p.catch(() => indexes.delete(id));
    indexes.set(id, p);
  }
  return indexes.get(id);
}

// ---- The page's state ------------------------------------------------------------------------

const game = $("game");
const art = createPotatoArt($("pot"), { seed: 7, reducedMotion: reduced });
const sounds = createSounds();
const canBuzz = typeof navigator.vibrate === "function";
let g = null; // the round
let screen = "start";
let mode = Recognition ? "voice" : "typed"; // how answers are given
let modeWhy = Recognition ? "" : "none"; // why typing: "none", "blocked", "failed", "chosen"
let listener = null;
let micTimer = 0; // gives up waiting for the microphone (MIC_WAIT_MS)
let turnTyped = false; // this turn only is typed (the microphone did not come on, or kept stopping)
let turnNote = ""; // and why, said on the turn's status line
let firstNext = 0; // who holds it first in the next round: it goes round the group
let focusBefore = null; // what had the keyboard before the pause
let heardNow = "";
let wakeLock = null;
let nextTick = 0;
let lastFrame = 0;

const setScreen = (s) => {
  screen = s;
  game.dataset.screen = s;
  if (s !== "turn") {
    clearReact();
    game.dataset.phase = s === "end" ? "over" : "idle";
  }
  renderHeat();
};

/** The ground heats with the potato: calm, warm, hot, strain, critical, then boom once it burst. */
const HEATS = ["calm", "warm", "hot", "strain", "critical", "boom"];
function renderHeat() {
  let heat = "calm";
  if (screen === "end") heat = "boom";
  else if (screen === "turn" && g) heat = g.phase === "burst" || g.phase === "over" ? "boom" : HEATS[Math.min(4, g.stage)];
  if (game.dataset.heat !== heat) game.dataset.heat = heat;
}

// ---- A verdict, big for a moment (the status line keeps it in words) ---------------------------

let reactTimer = 0;
function showReact(kind, head, line) {
  clearReact();
  $(`r-${kind}-head`).textContent = head;
  $(`r-${kind}`).textContent = line;
  void game.offsetWidth; // start the animation again
  game.dataset.react = kind;
  reactTimer = setTimeout(clearReact, 1250);
}
function clearReact() {
  clearTimeout(reactTimer);
  delete game.dataset.react;
}
/** The big words for a refusal: what kind of miss it was, and why, unless the headline says it all. */
function missWords(v, overturned = false) {
  if (overturned) return ["Overturned!", "That was wrong"];
  if (v?.reason === "slow") return ["Too slow!", ""];
  if (v?.reason === "used" || v?.reason === "echo") return ["Again?", v.why];
  return ["Nope!", v?.why ?? ""];
}

function buzz(pattern) {
  if (!setup.buzz || !canBuzz) return;
  try {
    navigator.vibrate(pattern || 0);
  } catch {
    // Not allowed here.
  }
}
/** Repeats a pattern for about `ms` (vibrate takes one long list). */
function buzzFor(pattern, ms) {
  if (!pattern) return buzz(0);
  const one = pattern.reduce((a, b) => a + b, 0);
  const out = [];
  for (let t = 0; t < ms; t += one) out.push(...pattern);
  buzz(out);
}
const sfx = (key, ch) => setup.sound && sounds.play(key, ch);

// ---- Start screen ----------------------------------------------------------------------------

$("s-cats").innerHTML = CATEGORY_IDS.map((id) => `<button type="button" class="cap chip" data-cat="${id}" aria-pressed="${id === setup.category}">${esc(CATEGORIES[id].label)}</button>`).join("");
$("s-cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  setup.category = b.dataset.cat;
  saveSetup();
  renderSetup();
  loadIndex(setup.category).catch(() => {});
});
function setPlayers(n) {
  setup.players = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
  saveSetup();
  renderSetup();
}
$("s-minus").addEventListener("click", () => setPlayers(setup.players - 1));
$("s-plus").addEventListener("click", () => setPlayers(setup.players + 1));

function toggleSound() {
  if (!setup.sound && !sounds.wake()) {
    showNote("This browser cannot play the sounds.");
    return;
  }
  setup.sound = !setup.sound;
  if (!setup.sound) sounds.silence();
  saveSetup();
  renderToggles();
}
function toggleBuzz() {
  setup.buzz = !setup.buzz;
  if (!setup.buzz) {
    try {
      navigator.vibrate(0);
    } catch {
      // Not allowed here.
    }
  }
  saveSetup();
  renderToggles();
}
for (const id of ["s-sound", "p-sound", "g-sound"]) $(id).addEventListener("click", toggleSound);
for (const id of ["s-buzz", "p-buzz"]) $(id).addEventListener("click", toggleBuzz);

function renderToggles() {
  for (const id of ["s-sound", "p-sound", "g-sound"]) $(id).setAttribute("aria-pressed", String(setup.sound));
  for (const id of ["s-buzz", "p-buzz"]) {
    $(id).setAttribute("aria-pressed", String(setup.buzz && canBuzz));
    $(id).hidden = !canBuzz;
  }
}

function renderSetup() {
  for (const b of $("s-cats").querySelectorAll("[data-cat]")) b.setAttribute("aria-pressed", String(b.dataset.cat === setup.category));
  $("s-n").textContent = String(setup.players);
  $("s-minus").disabled = setup.players <= MIN_PLAYERS;
  $("s-plus").disabled = setup.players >= MAX_PLAYERS;
  renderToggles();
  renderModeNote();
}

function showNote(html) {
  const n = $("s-note");
  n.innerHTML = html;
  n.hidden = !html;
}
function renderModeNote() {
  if (mode === "voice") return showNote("");
  if (modeWhy === "none") return showNote("<b>This browser cannot listen.</b> You will type each word instead. Chrome, Edge and Safari can listen.");
  if (modeWhy === "blocked") return showNote(`<b>The microphone is blocked.</b> You will type each word instead. ${micHelp()}`);
  if (modeWhy === "failed") return showNote("<b>Listening does not work here right now</b> (no microphone, or no connection to the speech service). You will type each word instead.");
  showNote("");
}
function micHelp() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return ios
    ? "To use your voice: Settings, Safari, Microphone, Allow (and Settings, Privacy &amp; Security, Speech Recognition), then reload."
    : "To use your voice, allow the microphone for this site (the icon by the address), then reload.";
}

$("setup").addEventListener("submit", (e) => {
  e.preventDefault();
  beginRound();
});

async function beginRound() {
  // Inside the tap: wake the sound and hold the screen on.
  if (setup.sound) sounds.wake();
  holdScreen();
  const start = $("s-start");
  const label = start.querySelector(".plate");
  start.disabled = true;
  label.textContent = `Loading ${CATEGORIES[setup.category].plural}`;
  let index;
  try {
    index = await loadIndex(setup.category);
  } catch {
    start.disabled = false;
    label.textContent = "Start";
    showNote("<b>The list did not load.</b> Check the connection and try again.");
    return;
  }
  start.disabled = false;
  label.textContent = "Start";
  // Typing chosen for one round ("Type it instead") goes back to the voice for the next.
  if (modeWhy === "chosen" && Recognition) {
    mode = "voice";
    modeWhy = "";
  }
  g = newRound({ index, players: setup.players, first: firstNext });
  // The next round starts with the next player along.
  firstNext = (g.holder + 1) % g.players;
  heardNow = "";
  art.play("reset");
  setScreen("turn");
  render();
  $("g-go").focus({ preventScroll: true });
}

// ---- The turn ---------------------------------------------------------------------------------

function goTurn() {
  if (!g || !canStart(g)) return;
  if (setup.sound) sounds.wake();
  if (!startTurn(g)) return;
  heardNow = "";
  turnTyped = false;
  turnNote = "";
  nextTick = g.fuseMax - 1000;
  $("g-word").value = "";
  if (mode === "voice") listen();
  else {
    lightFuse(g);
    render();
    $("g-word").focus({ preventScroll: true });
  }
  afterEvents();
}

/** Whether this turn's word is typed: the round is typed, or this turn had to be. */
const typing = () => mode === "typed" || turnTyped;

function listen() {
  listener?.abort();
  clearTimeout(micTimer);
  // A recogniser that never says it has started would leave the turn waiting for ever.
  micTimer = setTimeout(() => {
    if (g?.phase === "listen" && !g.lit && !g.paused) typeThisTurn("The microphone did not come on, so type the word this turn.");
  }, MIC_WAIT_MS);
  listener = createListener({
    lang: listenLang(),
    onStart: () => {
      clearTimeout(micTimer);
      lightFuse(g);
      afterEvents();
    },
    onSpeech: () => g && speaking(g),
    onInterim: (text) => {
      if (!g || g.phase !== "listen") return;
      speaking(g);
      heardNow = text;
      render();
    },
    onFinal: (alts) => {
      if (!g || g.phase !== "listen") return;
      heardNow = alts[0].transcript;
      hear(g, alts);
      afterEvents();
    },
    onBlocked: () => switchToTyped("blocked"),
    onFail: (code) => (code === "restarts" ? typeThisTurn("Listening kept stopping, so type the word this turn.") : switchToTyped("failed")),
  });
  listener.start();
}

/** This turn only is typed, with the reason on the status line; the next turn listens again. */
function typeThisTurn(note) {
  clearTimeout(micTimer);
  listener?.abort();
  turnTyped = true;
  turnNote = note;
  if (g?.phase === "listen") {
    lightFuse(g);
    $("g-word").value = heardNow;
  }
  render();
  if (g?.phase === "listen") $("g-word").focus({ preventScroll: true });
  afterEvents();
}

/** Listening cannot work: the round goes on with typed words, and the turn's fuse is lit. */
function switchToTyped(why) {
  mode = "typed";
  modeWhy = why;
  clearTimeout(micTimer);
  listener?.abort();
  if (g?.phase === "listen") {
    lightFuse(g);
    $("g-word").value = heardNow;
  }
  render();
  if (g?.phase === "listen") $("g-word").focus({ preventScroll: true });
  afterEvents();
}

$("g-go").addEventListener("click", goTurn);
$("g-type").addEventListener("click", () => switchToTyped("chosen"));
$("g-typed").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("g-word").value.trim();
  if (!g || g.phase !== "listen" || !text) return;
  heardNow = text;
  hear(g, [{ transcript: text, confidence: 1 }], { typed: true });
  $("g-word").blur();
  afterEvents();
});
$("g-appeal").addEventListener("click", () => {
  if (!g || !appeal(g)) return;
  afterEvents();
});

// ---- Pause, hiding the page, and the screen staying on ----------------------------------------

function pause(on) {
  if (!g || screen !== "turn") return;
  if (!setPaused(g, on)) return;
  if (on) {
    focusBefore = document.activeElement;
    clearTimeout(micTimer);
    listener?.abort();
    buzz(0);
    sounds.silence();
  } else if (g.phase === "listen") {
    // Resuming is a tap, so listening may start again; a half-said word is said again.
    heardNow = "";
    g.speaking = false;
    if (!typing()) {
      g.lit = false;
      listen();
    }
  }
  afterEvents();
  if (on) $("p-resume").focus({ preventScroll: true });
  else restoreFocus();
}

/** Whether the keyboard can be put on `el`: on the page, enabled, and shown. */
const usable = (el) => Boolean(el) && el.isConnected && !el.disabled && !el.closest("[hidden]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
/** The turn's area, which takes the keyboard while none of its controls can (the go button settling). */
const turnArea = game.querySelector(".gi");
turnArea.tabIndex = -1;
let goWhenReady = false; // the keyboard moves on to the go button once it can be pressed

/**
 * After the pause, the keyboard goes back where it was, or to what the turn needs now: the word box
 * while typing, the go button, the appeal; and while the go button is still settling after a
 * verdict, the turn's area, until the go button can be pressed. Never a hidden or disabled control.
 */
function restoreFocus() {
  const before = focusBefore;
  focusBefore = null;
  goWhenReady = false;
  const wanted = g?.phase === "listen" && typing() ? $("g-word") : before !== document.body ? before : null;
  const target = [wanted, $("g-go"), $("g-appeal"), $("g-word")].find(usable);
  if (target) return target.focus({ preventScroll: true });
  turnArea.focus({ preventScroll: true });
  goWhenReady = g?.phase === "ready";
}
$("g-pause").addEventListener("click", () => pause(true));
$("p-resume").addEventListener("click", () => pause(false));
$("p-quit").addEventListener("click", () => {
  endRound();
  setScreen("start");
  render();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause(true);
  else if (g && screen === "turn") holdScreen();
});

async function holdScreen() {
  if (wakeLock || !("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}
function letScreenSleep() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function endRound() {
  clearTimeout(micTimer);
  listener?.abort();
  buzz(0);
  sounds.silence();
  letScreenSleep();
  if (g) g.paused = false;
}

// ---- Keys: Space or Enter starts a turn, Escape pauses ---------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "Escape") {
    if (screen === "turn" && g) {
      e.preventDefault();
      pause(!g.paused);
    }
    return;
  }
  if ((e.key !== " " && e.key !== "Enter") || e.repeat) return;
  if (e.target.closest?.("input, textarea, select, a, [contenteditable]")) return;
  // A focused button does its own thing with Space and Enter, except the turn's own button.
  if (e.target.closest?.("button") && e.target.id !== "g-go") return;
  if (screen === "turn" && g && !g.paused && g.phase === "ready") {
    e.preventDefault();
    goTurn();
  }
});

// ---- After the rules change: sounds, buzz, the art and the screen -----------------------------

function afterEvents() {
  if (!g) return;
  for (const ev of drainEvents(g)) {
    if (ev.type === "listen") buzz(0);
    else if (ev.type === "lit") buzzFor(STAGE_BUZZ[g.stage], g.fuseMax);
    else if (ev.type === "right") {
      listener?.abort();
      buzz(0);
      sfx("bell");
      art.play("right");
      showReact("right", "Yes!", ev.word);
      stampLetter();
    } else if (ev.type === "worse") {
      listener?.abort();
      buzz(0);
      sfx("knocks");
      const overturned = ev.why === "Overturned";
      art.play("worse", { why: overturned ? "overturned" : g.last?.reason });
      showReact("wrong", ...missWords(g.last, overturned));
    } else if (ev.type === "doom") {
      listener?.abort();
      buzz(0);
      sfx("knocks");
      art.play("doom", { why: g.last?.reason });
      showReact("wrong", ...missWords(g.last));
    } else if (ev.type === "appeal") {
      if (ev.now === "right") {
        sfx("bell");
        art.play("right", { appeal: true });
        showReact("right", "Fair enough!", g.chain.at(-1)?.said ?? "");
        stampLetter();
      }
    } else if (ev.type === "grace") listener?.finish();
    else if (ev.type === "burst") {
      listener?.abort();
      clearReact();
      $("r-boom").textContent = playerName(g.burstOn);
      sfx("crack");
      buzz(BUZZ.shudder);
      art.play("burst");
    } else if (ev.type === "over") {
      endRound();
      setScreen("end");
      renderEnd();
      $("e-again").focus({ preventScroll: true });
    }
  }
  render();
}

function stampLetter() {
  const tag = $("g-tag");
  tag.classList.remove("new");
  void tag.offsetWidth;
  tag.classList.add("new");
}

// ---- Drawing the screen ------------------------------------------------------------------------

function render() {
  const paused = Boolean(g?.paused && screen === "turn");
  game.dataset.paused = paused ? "yes" : "no";
  $("g-paused").hidden = !paused;
  // While paused, only the pause box can be reached: the game behind it is inert.
  game.querySelector(".gi").inert = paused;
  if (screen !== "turn" || !g) {
    renderSetup();
    return;
  }
  const cat = g.category;
  const left = livesLeft(g);
  renderHeat();
  game.dataset.phase = g.phase;
  game.dataset.lit = g.phase === "listen" && g.lit ? "yes" : "no";
  game.dataset.typing = typing() ? "yes" : "no";
  $("g-cat").textContent = cat.label;
  const life = $("g-life");
  life.querySelectorAll("i").forEach((el, i) => {
    el.classList.toggle("on", i < left);
    // The life at risk: it warms with the potato's stress (renderStress), as the fuse does.
    el.classList.toggle("risk", i === left - 1);
  });
  renderStress();
  life.setAttribute("aria-label", `${left} ${left === 1 ? "life" : "lives"} left`);
  $("g-left").textContent = left === 0 ? "No lives" : left === 1 ? "Last life" : `${left} lives`;
  const holding = g.phase === "doom" || g.phase === "burst" || g.phase === "over";
  $("g-holder").textContent = playerName(holding ? (g.last?.by ?? g.holder) : g.holder);
  $("g-holder").nextElementSibling.textContent = holding ? "is holding it" : "is up";
  const tag = $("g-tag");
  tag.classList.toggle("any", !g.need);
  $("g-letter").textContent = g.need ? showLetter(g.need) : "Any";
  tag.setAttribute("aria-label", g.need ? `Starts with ${showLetter(g.need)}` : "Any letter");
  $("g-need").textContent = g.need ? `${cat.a} starting with` : "Start with";
  renderLastWord();
  $("g-listen-text").textContent = g.lit ? "Say it now" : "Starting";
  game.style.setProperty("--f", `${(fuseShare(g) * 100).toFixed(2)}%`);
  $("g-fuse").classList.toggle("low", g.phase === "listen" && g.lit && g.fuse < 3000);
  renderStatus();
  renderActs();
}

/** The potato's stress within its stage, for the life at risk and the fuse to agree with it. */
function renderStress() {
  const s = stressOf(g).toFixed(3);
  if (game.style.getPropertyValue("--stress") !== s) game.style.setProperty("--stress", s);
}

/** The last word, big, with the letter the next word needs boxed (dead ends skipped back past). */
function renderLastWord() {
  const cat = g.category;
  const last = g.chain.at(-1);
  const box = $("g-after");
  $("g-after-lbl").textContent = last ? "Last word" : "First word";
  box.classList.toggle("first", !last);
  if (!last) {
    const text = `Any ${cat.one}`;
    box.textContent = text;
    box.style.setProperty("--n", String(text.length));
  } else {
    const w = last.said;
    let at = -1;
    for (let i = w.length - 1; i >= 0; i--) {
      const c = w[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (!/[a-z]/.test(c)) continue;
      if (c === g.need) {
        at = i;
        break;
      }
      if (!g.skipped.includes(c)) break;
    }
    box.innerHTML = at < 0 ? esc(w) : `${esc(w.slice(0, at))}<b>${esc(w[at])}</b>${esc(w.slice(at + 1))}`;
    box.style.setProperty("--n", String(w.length));
  }
  const dead = $("g-dead");
  dead.hidden = !g.skipped.length;
  dead.textContent = g.skipped.length ? `${g.skipped.map(showLetter).join(", ")} ${g.skipped.length === 1 ? "is a dead end" : "are dead ends"}, so ${showLetter(g.need) || "any letter"}` : "";
}

function wanted() {
  const cat = g.category;
  return g.need ? `${esc(cat.a)} starting with <b>${showLetter(g.need)}</b>` : `any ${esc(cat.one)}`;
}

function verdictLine(v) {
  if (!v) return "";
  if (v.ok && !v.overturned) {
    const dead = v.skipped?.length ? ` ${v.skipped.map(showLetter).join(", ")} ${v.skipped.length === 1 ? "is a dead end" : "are dead ends"}, so ${showLetter(g.need) || "any letter"}.` : "";
    return `<span class="mark ok" aria-hidden="true"></span><span><b>${esc(v.word.said)}.</b> It settles.${dead}</span>`;
  }
  if (v.overturned === "right") return `<span class="mark ok" aria-hidden="true"></span><span><b>Taken: ${esc(g.chain.at(-1)?.said ?? v.heard)}.</b> The damage is undone.</span>`;
  if (v.overturned === "wrong") return `<span class="mark bad" aria-hidden="true"></span><span><b>Overturned.</b> It gets worse.</span>`;
  return `<span class="mark bad" aria-hidden="true"></span><span><b>${esc(v.why)}.</b> ${g.phase === "doom" ? "It is going to burst!" : "It gets worse."}</span>`;
}

function renderStatus() {
  const st = $("g-status");
  const heard = $("g-heard");
  let html = "";
  let cls = "";
  let shown = "";
  let part = false;
  if (g.phase === "ready") {
    const first = g.turns === 0;
    if (g.last) {
      html = verdictLine(g.last);
      cls = g.last.ok || g.last.overturned === "right" ? "ok" : "bad";
      shown = "";
    } else if (first) html = `<span>${esc(playerName(g.holder))} starts: say ${wanted()}.</span>`;
  } else if (g.phase === "listen") {
    if (!typing()) {
      // The microphone and the letter say it on screen; the words are for screen readers.
      html = g.lit ? `<span>Say ${wanted()}</span>` : "<span>Starting the microphone</span>";
      if (g.lit) cls = "quiet";
      shown = heardNow;
      part = true;
    } else html = `<span>${turnNote ? `${esc(turnNote)} ` : ""}Type ${wanted()}</span>`;
  } else if (g.phase === "doom") {
    html = verdictLine(g.last);
    cls = "bad";
  } else if (g.phase === "burst" || g.phase === "over") {
    html = `<span class="mark bad" aria-hidden="true"></span><span><b>It burst on ${esc(playerName(g.burstOn))}!</b></span>`;
    cls = "bad";
  }
  st.className = `status${cls ? ` ${cls}` : ""}`;
  if (st.innerHTML !== html) st.innerHTML = html;
  heard.textContent = shown ? `“${shown}”` : "";
  heard.classList.toggle("part", part);
}

function renderActs() {
  const go = $("g-go");
  const ready = g.phase === "ready";
  go.hidden = !ready;
  go.disabled = !canStart(g);
  const name = playerName(g.holder);
  $("g-go-text").textContent = `${name}: go`;
  go.setAttribute("aria-label", `${name}, start your turn${touchFirst ? "" : " (Space or Enter)"}`);
  const ap = $("g-appeal");
  ap.hidden = !canAppeal(g);
  ap.textContent = g.last?.ok ? "That was wrong" : "That was right";
  const typed = g.phase === "listen" && typing();
  $("g-typed").hidden = !typed;
  $("g-type").hidden = !(g.phase === "listen" && !typing());
}

function renderEnd() {
  $("e-who").textContent = playerName(g.burstOn);
  const n = g.chain.length;
  $("e-stats").textContent = `It stayed alive for ${n} ${n === 1 ? "word" : "words"} and ${g.misses} ${g.misses === 1 ? "miss" : "misses"}.`;
  // The buttons' lamps light up again for the next round.
  game.style.setProperty("--lamp", LIGHTS[0]);
  $("e-chain").innerHTML = n
    ? g.chain
        .map((c) => {
          const w = c.said;
          return `<li><span><b>${esc(w.charAt(0))}</b>${esc(w.slice(1, -1))}${w.length > 1 ? `<b>${esc(w.slice(-1))}</b>` : ""}</span><small>${esc(playerName(c.by))}</small></li>`;
        })
        .join("")
    : `<li class="none">No words this time.</li>`;
}

$("e-again").addEventListener("click", () => beginRound());
$("e-setup").addEventListener("click", () => {
  setScreen("start");
  art.play("reset");
  render();
});

// ---- The clock: the round only runs while it is on screen, not paused, and the page is visible --

function frame(now) {
  const dt = lastFrame ? Math.min(100, now - lastFrame) : 0;
  lastFrame = now;
  if (g && screen === "turn" && !document.hidden) {
    const was = g.phase;
    tick(g, dt);
    if (g.phase === "listen" && g.lit && !g.paused) {
      while (g.fuse <= nextTick && nextTick > 0) {
        sfx("clock", "tick");
        nextTick -= nextTick <= 3000 ? 500 : 1000;
      }
    }
    if (g.events.length || was !== g.phase) afterEvents();
    else if (g.phase === "listen" || g.phase === "ready") {
      game.style.setProperty("--f", `${(fuseShare(g) * 100).toFixed(2)}%`);
      $("g-fuse").classList.toggle("low", g.phase === "listen" && g.lit && g.fuse < 3000);
      renderStress();
      if (g.phase === "ready") $("g-go").disabled = !canStart(g);
    }
    if (goWhenReady && g.phase === "ready" && canStart(g) && document.activeElement === turnArea) {
      goWhenReady = false;
      $("g-go").focus({ preventScroll: true });
    }
    art.set(artState(g));
  } else if (screen === "start") {
    // On the start screen it rests, healthy and still: nothing is redrawn until a round starts.
    art.set({ stage: 0, growth: 0, strain: 0, fuse: 1, light: LIGHTS[0], phase: "idle", paused: false });
  }
  requestAnimationFrame(frame);
}

// ---- Start -----------------------------------------------------------------------------------

renderSetup();
setScreen("start");
loadIndex(setup.category).catch(() => {});
requestAnimationFrame(frame);

// For the browser tests: read the round and the art (nothing here changes the game).
window.__hotPotato = { round: () => g, art, mode: () => mode };
