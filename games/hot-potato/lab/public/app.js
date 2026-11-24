// The Hot Potato hearing test: one turn = one speech recognition session, started by a tap, a
// click or the keyboard (or again by itself in hands-free mode). Each turn's timings, guesses
// and verdict are logged on the page and in the "Copy results" report. Nothing is stored or sent
// anywhere by this page.
//
// The matcher and the lists are the game's (games/hot-potato/shared), served at
// /one-device/hot-potato/shared/: this page and the game use the one copy.
import { CATEGORIES, CATEGORY_IDS, DEFAULT_CATEGORY, dataUrl } from "/one-device/hot-potato/shared/categories.js";
import { deviceInfo, micKind } from "./device.js";
import { DEAD_END_BELOW, EARLY_STABLE_MS, RULES_VERSION, buildIndex, deadLetters, earlyMatch, matchHeard, median, nextLetter, normalize } from "/one-device/hot-potato/shared/logic.js";
import { suggestions } from "/one-device/hot-potato/shared/suggest.js";

const $ = (id) => document.getElementById(id);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const ua = navigator.userAgent;
const MAX_ALTERNATIVES = 10;
const POTATO_MAX = 10;
const REPORT_VERSION = "v4";
const CATEGORY_KEY = "hot-potato-category";
const SUGGEST_KEY = "hot-potato-suggest";

const device = deviceInfo(ua, navigator.userAgentData, navigator.maxTouchPoints || 0);
const touchFirst = device.kind !== "desktop";

/** The category this device chose last time (per device; the page works without storage). */
function savedCategory() {
  try {
    const id = localStorage.getItem(CATEGORY_KEY);
    return CATEGORIES[id] ? id : DEFAULT_CATEGORY;
  } catch {
    return DEFAULT_CATEGORY;
  }
}

function saveCategory(id) {
  try {
    localStorage.setItem(CATEGORY_KEY, id);
  } catch {
    // Storage refused (private window, blocked site data): the choice lasts this visit only.
  }
}

/** Whether this device shows suggestions (on unless it was turned off here). */
function savedSuggest() {
  try {
    return localStorage.getItem(SUGGEST_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveSuggest(on) {
  try {
    localStorage.setItem(SUGGEST_KEY, on ? "on" : "off");
  } catch {
    // Storage refused: the switch lasts this visit only.
  }
}

const state = {
  category: savedCategory(),
  index: null, // the chosen category's index, once loaded
  chain: [], // spoken names accepted this game
  used: new Set(),
  usedNames: new Set(),
  required: "",
  skipped: [], // dead-end letters the chain stepped back over after the last answer
  shown: [], // the suggestions on screen now, [{id, name}]
  suggestPage: 0, // how many times "more" was pressed for this letter
  suggestFor: "", // the game position the suggestions were picked for
  potato: 0,
  turns: [],
  scenario: 1,
  live: null, // the turn now listening
  silentInARow: 0,
  wakeLock: null,
  notes: { vibrate: "", wakeLock: "", onDevice: "" },
  mics: [], // audio inputs, once the browser names them
  micTrackSupport: "unknown", // "yes", "no" or "unknown": can speech recognition listen to a chosen microphone?
};

// ---- The lists, each loaded when its category is first chosen -----------------------------------

const cat = () => CATEGORIES[state.category];

const files = new Map();
const getJSON = (name) => {
  if (!files.has(name)) {
    const p = fetch(dataUrl(name)).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => files.delete(name)); // a failed load is tried again next time
    files.set(name, p);
  }
  return files.get(name);
};

const indexes = new Map(); // category id -> Promise of its index
let listReady = Promise.resolve(null);

/** Loads a category's list (once; words.json is shared) and makes it the current one. */
function useCategory(id) {
  const category = CATEGORIES[id];
  if (!indexes.has(id)) {
    const p = Promise.all([getJSON(category.file), getJSON("words.json")]).then(([doc, words]) => buildIndex(doc, words, category));
    p.catch(() => indexes.delete(id));
    indexes.set(id, p);
  }
  state.index = null;
  listReady = indexes
    .get(id)
    .then((index) => {
      if (state.category !== id) return state.index;
      state.index = index;
      renderDeadNote();
      renderGame();
      renderCaps();
      renderButtons();
      return index;
    })
    .catch((err) => {
      if (state.category === id) $("need").textContent = `The ${category.one} list did not load (${err.message}). Reload the page.`;
      throw err;
    });
  listReady.catch(() => {});
  renderCategory();
  renderGame();
  renderCaps();
  renderButtons();
}

function newGame() {
  Object.assign(state, { chain: [], used: new Set(), usedNames: new Set(), required: "", skipped: [], potato: 0 });
  $("heard").textContent = " ";
  $("verdict").textContent = " ";
  renderAppeal(null);
  renderGame();
}

/** A new category starts a new game (the log is kept; each turn names its category). */
function chooseCategory(id) {
  if (!CATEGORIES[id] || id === state.category) return;
  if (state.live) stopListening();
  state.category = id;
  saveCategory(id);
  newGame();
  useCategory(id);
}

// ---- Sound and vibration ----------------------------------------------------------------------

let audio = null;
function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audio) audio = new Ctx();
  if (audio.state === "suspended") audio.resume().catch(() => {});
}

function tone(freq, start, length, type = "sine", gain = 0.25, slideTo = 0) {
  const t = audio.currentTime + start;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(audio.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** Plays the ding or the buzz; returns how long it lasts in ms (0 when sounds are off). */
function play(kind) {
  if (!$("sounds").checked || !audio) return 0;
  if (kind === "ding") {
    tone(880, 0, 0.18, "sine", 0.3);
    tone(1320, 0.09, 0.25, "sine", 0.25);
    return 350;
  }
  tone(140, 0, 0.35, "sawtooth", 0.18, 90);
  tone(147, 0, 0.35, "square", 0.08, 95);
  return 380;
}

function vibrate(pattern) {
  if (!("vibrate" in navigator)) {
    state.notes.vibrate = "not supported in this browser";
  } else {
    let ok = false;
    try {
      ok = navigator.vibrate(pattern);
    } catch {
      ok = false;
    }
    state.notes.vibrate = ok ? "works" : "refused by the browser";
  }
  renderCaps();
}

// ---- Screen wake lock ---------------------------------------------------------------------------

async function holdScreen() {
  if (state.wakeLock || !("wakeLock" in navigator)) {
    if (!("wakeLock" in navigator)) state.notes.wakeLock = "not supported";
    return;
  }
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.notes.wakeLock = "on while listening";
    state.wakeLock.addEventListener("release", () => (state.wakeLock = null));
  } catch (err) {
    state.notes.wakeLock = `refused (${err.name})`;
  }
  renderCaps();
}

function releaseScreen() {
  if (state.wakeLock) state.wakeLock.release().catch(() => {});
  state.wakeLock = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (state.live || $("handsFree").checked)) holdScreen();
});

// ---- The microphone picker ------------------------------------------------------------------------

async function refreshMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return;
  }
  // Browsers only name devices after the microphone is allowed; unnamed ones cannot be told apart.
  state.mics = devices.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications" && d.label);
  renderMics();
}

function renderMics() {
  const pick = $("micPick");
  const select = $("mic");
  if (state.mics.length < 2) {
    pick.hidden = true;
    return;
  }
  const chosen = select.value;
  const options = [new Option("System default", "")].concat(state.mics.map((m) => new Option(m.label, m.deviceId)));
  select.replaceChildren(...options);
  select.value = state.mics.some((m) => m.deviceId === chosen) ? chosen : "";
  pick.hidden = false;
  renderMicNote();
}

function renderMicNote() {
  const note = $("micNote");
  if (state.micTrackSupport === "no") {
    note.textContent = "This browser's speech recognition always listens to the system's default microphone, so this choice cannot be used here. Change the default in the system's sound settings.";
  } else if (state.micTrackSupport === "yes" && $("mic").value) {
    note.textContent = "Speech recognition listens to this microphone.";
  } else {
    note.textContent = "";
  }
  note.hidden = !note.textContent;
}

/**
 * Whether this browser's speech recognition can take a chosen microphone (start(audioTrack)).
 * A browser with that form rejects a non-track argument at once; one without it ignores the
 * argument and starts listening, which is stopped straight away.
 */
function probeTrackSupport() {
  if (state.micTrackSupport !== "unknown" || !Recognition) return state.micTrackSupport;
  let probe;
  try {
    probe = new Recognition();
    probe.start({});
    state.micTrackSupport = "no";
    try {
      probe.abort();
    } catch {}
  } catch (err) {
    state.micTrackSupport = err instanceof TypeError ? "yes" : "no";
  }
  return state.micTrackSupport;
}

async function chosenTrack() {
  const id = $("mic").value;
  if (!id || state.micTrackSupport !== "yes") return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } });
    return stream.getAudioTracks()[0] ?? null;
  } catch {
    return null;
  }
}

const micInReport = () => {
  const id = $("mic").value;
  const chosen = state.mics.find((m) => m.deviceId === id);
  const count = `${state.mics.length || "unknown number of"} input${state.mics.length === 1 ? "" : "s"}`;
  if (!chosen) return `system default (${count})`;
  return `chosen: ${micKind(chosen.label)} (${count}); used by recognition: ${state.micTrackSupport}`;
};

// ---- One turn -----------------------------------------------------------------------------------

function newTurn(auto) {
  return {
    n: state.turns.length + 1,
    category: state.category,
    index: state.index, // the list this turn is checked against, even if the category changes
    next: null, // after a right answer: {letter, skipped} from the dead-end rule
    scenario: state.scenario,
    lang: $("lang").value,
    sounds: $("sounds").checked,
    handsFree: $("handsFree").checked,
    early: $("early").checked,
    wide: $("wide").checked,
    // The suggestions seen for this turn (more are added if "more" is pressed while it listens),
    // or null when they are hidden.
    suggested: $("suggest").checked ? [...state.shown] : null,
    auto,
    required: state.required,
    rules: snapshot(),
    t0: performance.now(),
    at: {}, // ms after the tap: start, audiostart, speechstart, speechend, interim, valid, final, end
    interimCount: 0,
    firstInterim: "",
    alternatives: [],
    finalMatch: null,
    earlyWould: null, // what an early answer would have taken, even with the switch off
    pendingEarly: null,
    match: null,
    decidedBy: "",
    verdict: "",
    error: "",
    misheard: false,
    appeal: "", // "real-city" or "wrong": the player says the verdict was wrong
    onDevice: "",
    mic: "",
  };
}

const since = (turn) => Math.round(performance.now() - turn.t0);
const mark = (turn, key) => {
  if (turn.at[key] === undefined) turn.at[key] = since(turn);
};

/** The game as it stood when a turn began: every check in that turn is made against it. */
const snapshot = () => ({
  required: state.required,
  used: new Set(state.used),
  usedNames: new Set(state.usedNames),
  previous: state.chain.at(-1) ?? "",
  wide: $("wide").checked,
});

function check(turn, alternatives) {
  if (!turn.index) return null;
  return matchHeard(turn.index, alternatives, turn.rules);
}

async function startTurn(auto = false) {
  if (state.live || !Recognition || !state.index) return;
  unlockAudio();
  const turn = newTurn(auto);
  let rec;
  try {
    rec = new Recognition();
  } catch (err) {
    turn.error = `cannot create recognition (${err.name})`;
    return finishTurn(turn);
  }
  rec.lang = turn.lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = MAX_ALTERNATIVES;
  turn.onDevice = "processLocally" in rec ? `processLocally=${rec.processLocally}` : "not exposed";
  turn.mic = micInReport();
  state.live = { turn, rec, track: null };
  renderButtons();

  for (const name of ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend"]) {
    rec.addEventListener(name, () => mark(turn, name));
  }
  rec.addEventListener("result", (e) => onResult(turn, rec, e));
  rec.addEventListener("nomatch", () => mark(turn, "nomatch"));
  rec.addEventListener("error", (e) => {
    turn.error = e.error || "error";
    if (e.error === "not-allowed" || e.error === "service-not-allowed") showMicBlocked(true);
  });
  rec.addEventListener("end", () => {
    mark(turn, "end");
    finishTurn(turn);
  });

  // Only a chosen microphone waits for getUserMedia; otherwise start() stays inside the tap, as
  // some browsers (Safari) want.
  const track = $("mic").value && state.micTrackSupport === "yes" ? await chosenTrack() : null;
  state.live.track = track;
  try {
    if (track) rec.start(track);
    else rec.start();
  } catch (err) {
    turn.error = `start failed (${err.name})`;
    track?.stop();
    state.live = null;
    return finishTurn(turn);
  }
  holdScreen();
  $("heard").textContent = "Listening...";
  $("heard").classList.add("listening");
  $("verdict").textContent = " ";
  $("verdict").className = "verdict";
  renderAppeal(null);
}

function onResult(turn, rec, e) {
  let interim = "";
  let interimAlts = [];
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const result = e.results[i];
    if (result.isFinal) {
      mark(turn, "final");
      clearTimeout(turn.pendingEarly?.timer);
      turn.pendingEarly = null;
      turn.alternatives = Array.from(result, (a) => ({ transcript: a.transcript.trim(), confidence: a.confidence }));
      const m = check(turn, turn.alternatives);
      turn.finalMatch = m;
      $("heard").textContent = turn.alternatives[0]?.transcript || " ";
      if (!turn.verdict) decide(turn, m, "final");
    } else {
      interim += result[0].transcript;
      if (result.length > 1) interimAlts = Array.from(result, (a) => a.transcript);
    }
  }
  interim = interim.trim();
  if (!interim || turn.at.final !== undefined) return;
  turn.interimCount++;
  if (turn.at.interim === undefined) {
    mark(turn, "interim");
    turn.firstInterim = interim;
  }
  if (!turn.verdict) $("heard").textContent = interim;
  considerEarly(turn, rec, interimAlts.length > 1 ? [interim, ...interimAlts.slice(1)] : [interim]);
}

/**
 * The early answer: an interim that the rules would take starts a short timer; if the interim
 * is still the same when it fires, the early answer is noted (and, with the switch on, taken).
 */
function considerEarly(turn, rec, transcripts) {
  if (!turn.index || turn.earlyWould) return;
  const key = normalize(transcripts[0]);
  if (turn.pendingEarly?.key === key) return;
  clearTimeout(turn.pendingEarly?.timer);
  turn.pendingEarly = null;
  const m = earlyMatch(turn.index, transcripts, turn.rules);
  if (!m.ok) return;
  mark(turn, "valid");
  turn.pendingEarly = {
    key,
    timer: setTimeout(() => {
      turn.pendingEarly = null;
      if (turn.at.final !== undefined || state.live?.turn !== turn) return;
      turn.earlyWould = m;
      mark(turn, "early");
      if (turn.early && !turn.verdict) {
        decide(turn, m, "interim");
        try {
          rec.stop();
        } catch {}
      }
    }, EARLY_STABLE_MS),
  };
}

function decide(turn, m, by) {
  if (!m) return; // the list is not loaded yet: the final result decides
  turn.match = m;
  turn.decidedBy = by;
  turn.verdict = m.ok ? "right" : "wrong";
  // A turn decided after the category changed belongs to the old game: logged, not played.
  if (turn.index !== state.index) return;
  if (m.ok) {
    state.chain.push(m.said);
    state.used.add(m.place.id);
    state.usedNames.add(normalize(m.said));
    turn.next = nextLetter(turn.index, m.said, { used: state.used, wide: turn.wide });
    state.required = turn.next.letter;
    state.skipped = turn.next.skipped;
    state.potato = Math.min(POTATO_MAX, state.potato + 1);
    turn.soundMs = play("ding");
    vibrate(60);
  } else {
    state.potato = 0;
    turn.soundMs = play("buzz");
    vibrate([180, 60, 180]);
    $("potato").classList.remove("pop");
    void $("potato").offsetWidth;
    $("potato").classList.add("pop");
  }
  // A city found only in the final result could have been answered no sooner than that.
  if (turn.at.valid === undefined && m.ok && by === "final") turn.at.valid = turn.at.final ?? since(turn);
  showVerdict(turn);
  renderGame();
}

async function finishTurn(turn) {
  const live = state.live?.turn === turn ? state.live : null;
  if (live) {
    live.track?.stop();
    state.live = null;
  }
  clearTimeout(turn.pendingEarly?.timer);
  turn.pendingEarly = null;
  if (!turn.verdict && turn.alternatives.length) {
    // The final result came before the city list was ready.
    await listReady.catch(() => {});
    turn.finalMatch = check(turn, turn.alternatives);
    decide(turn, turn.finalMatch, "final");
  }
  if (!turn.verdict) {
    turn.verdict = "none";
    $("heard").textContent = " ";
    showVerdict(turn);
  }
  $("heard").classList.remove("listening");
  state.turns.push(turn);
  state.silentInARow = turn.verdict === "none" ? state.silentInARow + 1 : 0;
  renderLog();
  renderSummary();
  renderButtons();
  if (state.turns.length === 1) refreshMics();

  const fatal = /not-allowed|service-not-allowed|language-not-supported|cannot create|start failed/.test(turn.error);
  if ($("handsFree").checked && !fatal && state.silentInARow < 3) {
    // Wait for the ding or buzz to finish, so the microphone does not hear the page's own sound.
    state.nextTurn = setTimeout(() => {
      state.nextTurn = null;
      if ($("handsFree").checked) startTurn(true);
    }, (turn.soundMs || 0) + 400);
  } else {
    if (state.silentInARow >= 3 && $("handsFree").checked) {
      $("handsFree").checked = false;
      $("verdict").textContent = "Hands-free stopped after three turns with nothing heard.";
    }
    releaseScreen();
  }
}

function stopListening() {
  $("handsFree").checked = false;
  clearTimeout(state.nextTurn);
  state.nextTurn = null;
  renderButtons();
  if (state.live) {
    try {
      state.live.rec.abort();
    } catch {}
  }
  releaseScreen();
}

// ---- Words for verdicts ----------------------------------------------------------------------

function population(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** "Edmonton (Alberta, Canada)": where a place is, as plainly as the list allows. */
const where = (place) => [place.region, place.countryName].filter(Boolean).join(", ");

/** The other places of that name, when there are any: "; there is also one in Australia". */
function alsoText(m, category) {
  if (!m.others.length) return "";
  if (category.format !== "cities") return `; also a name of ${m.others.slice(0, 2).map((p) => p.name).join(" and ")}`;
  const abroad = [...new Set(m.others.filter((p) => p.country !== m.place.country).map((p) => p.countryName))];
  const home = m.others.filter((p) => p.country === m.place.country);
  const parts = [];
  if (abroad.length) parts.push(`one in ${abroad.slice(0, 2).join(" and ")}${abroad.length > 2 ? " and elsewhere" : ""}`);
  if (home.length) parts.push(`another in ${home[0].region || "the same country"}${home.length > 1 ? " and more" : ""}`);
  return parts.length ? `; there is also ${parts.join(", and ")}` : "";
}

/**
 * Which entry was matched, in brackets: "(Alberta, Canada, 1.0M)" for a city, "(The
 * Netherlands, Europe)" for Holland, "(cougar, mammal)" for puma, "(drink)" for tea.
 */
function entryText(m, category) {
  if (category.format === "cities") return ` (${where(m.place)}, ${population(m.place.population)})`;
  const parts = [normalize(m.said) !== normalize(m.place.name) ? m.place.name : "", m.place.group].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** What a turn's verdict was checked against: its own category, the one chosen when it began. */
const turnCategory = (turn) => CATEGORIES[turn.category] ?? CATEGORIES[DEFAULT_CATEGORY];

export function verdictText(turn) {
  const m = turn.match;
  const category = turnCategory(turn);
  if (turn.verdict === "none") {
    if (/not-allowed|service-not-allowed/.test(turn.error)) return `Microphone blocked (${turn.error})`;
    if (turn.error === "network") return "No connection to the speech service (network)";
    if (turn.error === "aborted") return "Stopped (aborted)";
    return turn.error ? `Nothing heard (${turn.error})` : "Nothing heard";
  }
  if (!m) return "";
  if (m.ok) {
    const how =
      m.kind === "exact"
        ? m.plural
          ? `heard "${m.heard}"`
          : m.wordName && category.wordNames
            ? `exact (the ${category.one}, not the word)`
            : "exact"
        : m.kind === "alternative"
          ? `from the recogniser's guess ${m.alternative + 1}, "${m.heard}"`
          : `heard "${m.heard}", ${m.distance === 1 ? "one letter" : `${m.distance} letters`} off`;
    return `Yes: ${m.said}${entryText(m, category)}, ${how}${alsoText(m, category)}`;
  }
  const near = m.place ? (category.format === "cities" ? `${m.said} (${m.place.countryName})` : m.said) : "";
  switch (m.reason) {
    case "word":
      // In "Anything" every listed word is an answer: this is a phrase, or a one-letter word.
      if (category.format === "words") return `No: heard "${m.heard}", not one word on the list`;
      return `No: heard "${m.heard}", an ordinary word, not ${category.a}`;
    case "name":
      return `No: heard "${m.heard}", a name, not ${category.a}`;
    case "lesser-known":
      return category.format === "cities"
        ? `No: ${near} is a lesser-known town of ${population(m.place.population)}, not on the well-known list (taken with "${wideLabel(category)}" on)`
        : `No: ${near} is lesser known, not on the well-known list (taken with "${wideLabel(category)}" on)`;
    case "wrong-letter":
      return `No: ${near} starts with ${m.said.charAt(0).toUpperCase()}, not ${turn.required.toUpperCase()}`;
    case "used":
      return `No: ${m.said} was already said this game`;
    case "echo":
      return `No: that was the last ${category.one} again`;
    default:
      return `No: heard "${m.heard}", not ${category.a} on the list`;
  }
}

function showVerdict(turn) {
  const el = $("verdict");
  el.textContent = verdictText(turn) || " ";
  el.className = `verdict ${turn.verdict}`;
  renderAppeal(turn);
}

// ---- Appeals: the player says the verdict was wrong --------------------------------------------------

const appealLabel = (turn) => (turn.verdict === "right" ? "That was wrong" : `That was a real ${turnCategory(turn).one}`);
const appealKind = (turn) => (turn.verdict === "right" ? "wrong" : "real");

function toggleAppeal(turn) {
  turn.appeal = turn.appeal ? "" : appealKind(turn);
  renderAppeal(state.stageTurn);
  renderLog();
  renderSummary();
}

function appealButton(turn, cls) {
  const b = el("button", cls, turn.appeal ? `Marked: ${appealLabel(turn).toLowerCase()} (undo)` : appealLabel(turn));
  b.type = "button";
  b.setAttribute("aria-pressed", String(Boolean(turn.appeal)));
  b.addEventListener("click", () => toggleAppeal(turn));
  return b;
}

/** The appeal under the current verdict, for the turn just decided. */
function renderAppeal(turn) {
  state.stageTurn = turn;
  const slot = $("appealSlot");
  slot.replaceChildren(...(turn && (turn.verdict === "right" || turn.verdict === "wrong") ? [appealButton(turn, "appeal")] : []));
}

// ---- Rendering -----------------------------------------------------------------------------------

/** "Y", "O and Y", "U, X, Y and Z". */
const upper = (letters) => {
  const up = letters.map((c) => c.toUpperCase());
  return up.length > 1 ? `${up.slice(0, -1).join(", ")} and ${up.at(-1)}` : (up[0] ?? "");
};

function renderGame() {
  const c = cat();
  const last = state.chain.at(-1);
  $("need").textContent = state.required
    ? `Next: ${c.a} starting with ${state.required.toUpperCase()}`
    : last
      ? `Next: any ${c.one}`
      : `Say any ${c.one} to start`;
  const parts = [];
  if (last) parts.push(`after ${last}`);
  if (last && state.skipped.length) {
    parts.push(state.required ? `${upper(state.skipped)} ${state.skipped.length > 1 ? "are dead ends" : "is a dead end"}` : "every letter of it is a dead end");
  }
  if (state.chain.length > 1) parts.push(`${state.chain.length} ${c.plural} so far`);
  $("chainLine").textContent = parts.join(" · ");
  $("potato").style.setProperty("--level", String(state.potato));
  $("potato").dataset.level = String(state.potato);
  renderSuggestions();
}

/**
 * Three or four well-known answers for the letter needed, not yet said ("Try: Tokyo · Toronto
 * ..."), for a player who does not know many. Plain text: tapping one does nothing, since this is
 * a hearing test and the point is to say it. "more" shows the next few.
 */
function renderSuggestions() {
  const on = $("suggest").checked;
  const at = `${state.category} ${state.required} ${state.chain.length}`;
  if (at !== state.suggestFor) {
    state.suggestFor = at;
    state.suggestPage = 0;
  }
  const pick = (page) => (on && state.index ? suggestions(state.index, { letter: state.required, used: state.used, usedNames: state.usedNames, page }) : []);
  const shown = pick(state.suggestPage);
  state.shown = shown;
  $("suggestions").hidden = !shown.length;
  $("suggestList").replaceChildren(...shown.flatMap((s, i) => (i ? [document.createTextNode(" · "), el("span", "suggestion", s.name)] : [el("span", "suggestion", s.name)])));
  // "more" only when there are others to show.
  const next = pick(state.suggestPage + 1);
  $("suggestMore").hidden = next.every((s) => shown.some((x) => x.id === s.id));
  const turn = state.live?.turn;
  if (turn?.suggested) for (const s of shown) if (!turn.suggested.some((x) => x.id === s.id)) turn.suggested.push(s);
}

/** True when a turn's answer was one of the suggestions it showed: the entry, or a guess that is one of their names. */
function readSuggestion(turn) {
  const m = turn.match;
  if (!m || !turn.suggested?.length) return false;
  if (m.ok && turn.suggested.some((s) => s.id === m.place.id)) return true;
  const names = new Set(turn.suggested.map((s) => normalize(s.name)));
  return turn.alternatives.some((a) => names.has(normalize(a.transcript)));
}

/** The report's token for suggestions: "sugg:read", "sugg:own", "sugg:hidden", or "" when nothing was heard. */
function suggestionToken(turn) {
  if (!turn.match) return "";
  if (!turn.suggested) return "sugg:hidden";
  return readSuggestion(turn) ? "sugg:read" : "sugg:own";
}

/** The name of the switch that accepts the wider list: "Also allow lesser-known cities". */
const wideLabel = (c) => `Also allow lesser-known ${c.plural}`;

/** The category picker, the lesser-known switch and the dead-end note, for the chosen category. */
function renderCategory() {
  const c = cat();
  $("category").value = state.category;
  const wide = $("wide");
  wide.disabled = !c.wide;
  if (!c.wide) wide.checked = false;
  $("wideText").textContent = c.wide ? `${wideLabel(c)}: ${c.wide}` : `${wideLabel(c)}: there are none`;
  $("wideNote").textContent = c.wide ? `(accepts more answers; off: ${c.wideOff})` : "(every one is already on the list)";
  renderDeadNote();
}

function renderDeadNote() {
  const note = $("deadNote");
  const idx = state.index;
  if (!idx) {
    note.textContent = "";
    note.hidden = true;
    return;
  }
  const dead = deadLetters(idx, $("wide").checked);
  const c = cat();
  note.textContent = dead.length
    ? `Dead ends: ${upper(dead)} (fewer than ${DEAD_END_BELOW} ${c.plural} start with ${dead.length > 1 ? "them" : "it"}). After one, go on from the letter before.`
    : "";
  note.hidden = !dead.length;
}

function renderButtons() {
  const live = Boolean(state.live);
  const btn = $("turn");
  const c = cat();
  btn.disabled = !Recognition || live || !state.index;
  btn.textContent = !Recognition
    ? "No speech recognition here"
    : !state.index
      ? `Loading the ${c.one} list...`
      : live
        ? "Listening..."
        : touchFirst
          ? `Your turn: tap and say ${c.a}`
          : `Your turn: click, then say ${c.a}`;
  btn.classList.toggle("live", live);
  $("stop").hidden = !live && !$("handsFree").checked;
}

const ms = (v) => (v === undefined || v === null ? "-" : `${v}`);

function summary() {
  const t = state.turns;
  const count = (f) => t.filter(f).length;
  const pick = (k) => median(t.map((x) => x.at[k]));
  const speechToFinal = median(t.map((x) => (x.at.final !== undefined && x.at.speechend !== undefined ? x.at.final - x.at.speechend : null)));
  const earlyTurns = t.filter((x) => x.earlyWould);
  return {
    turns: t.length,
    right: count((x) => x.verdict === "right"),
    wrong: count((x) => x.verdict === "wrong"),
    none: count((x) => x.verdict === "none"),
    misheard: count((x) => x.misheard),
    soundAlike: count((x) => x.match?.kind === "sound-alike"),
    appealReal: count((x) => x.appeal === "real"),
    appealWrong: count((x) => x.appeal === "wrong"),
    errors: count((x) => x.error),
    fromSuggestions: count(readSuggestion),
    earlyWould: earlyTurns.length,
    earlyDiffers: earlyTurns.filter((x) => x.finalMatch && (!x.finalMatch.ok || x.finalMatch.place.id !== x.earlyWould.place.id)).length,
    interim: pick("interim"),
    valid: pick("valid"),
    final: pick("final"),
    speechToFinal,
  };
}

function renderSummary() {
  const s = summary();
  const rows = [
    ["Turns", s.turns],
    ["Right", s.right],
    ["Wrong", s.wrong],
    ["Nothing heard", s.none],
    ["It misheard me", s.misheard],
    ["You said: that was a real one", s.appealReal],
    ["You said: that was wrong", s.appealWrong],
    ["Read from the suggestions", s.fromSuggestions],
    ["Early answers it would take", s.earlyWould],
    ["Early answers unlike the final", s.earlyDiffers],
    ["Median: start to first word", s.interim === null ? "-" : `${s.interim} ms`],
    ["Median: start to a matching answer", s.valid === null ? "-" : `${s.valid} ms`],
    ["Median: start to final result", s.final === null ? "-" : `${s.final} ms`],
    ["Median: end of speech to final", s.speechToFinal === null ? "-" : `${s.speechToFinal} ms`],
  ];
  $("summary").replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = String(v);
      return [dt, dd];
    }),
  );
  for (const btn of document.querySelectorAll("#checklist button")) {
    const n = state.turns.filter((t) => t.scenario === Number(btn.dataset.scenario)).length;
    btn.querySelector(".count").textContent = n ? `(${n} turn${n === 1 ? "" : "s"})` : "";
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderLog() {
  const items = [...state.turns].reverse().map((turn) => {
    const li = el("li", `turn-row ${turn.verdict}${turn.misheard ? " misheard" : ""}${turn.appeal ? " appealed" : ""}`);
    const head = el("p", "row-head");
    head.append(el("span", "row-n", `#${turn.n}`), el("span", "row-verdict", verdictText(turn)));
    const times = el("p", "row-times", `first word ${ms(turn.at.interim)} · matching answer ${ms(turn.at.valid)} · final ${ms(turn.at.final)} ms${turn.decidedBy ? ` · decided on ${turn.decidedBy}` : ""}`);
    const alts = turn.alternatives.length
      ? turn.alternatives.map((a) => `"${a.transcript}" ${a.confidence ? a.confidence.toFixed(2) : "0"}`).join(" · ")
      : turn.firstInterim
        ? `interim only: "${turn.firstInterim}"`
        : "no words";
    const heard = el("p", "row-alts", `Heard: ${alts}`);
    li.append(head, times, heard);
    const extra = [turnCategory(turn).label];
    if (turn.required) extra.push(`needed ${turn.required.toUpperCase()}`);
    if (turn.next?.skipped.length) extra.push(`${upper(turn.next.skipped)}: dead end, next ${turn.next.letter ? turn.next.letter.toUpperCase() : "any letter"}`);
    extra.push(turn.wide ? "lesser-known allowed" : "well-known list", `test ${turn.scenario}`, turn.sounds ? "sounds on" : "sounds off");
    if (readSuggestion(turn)) extra.push("read from the suggestions");
    if (turn.auto) extra.push("hands-free");
    if (turn.error) extra.push(`error: ${turn.error}`);
    if (turn.finalMatch && turn.match && turn.decidedBy === "interim" && turn.finalMatch.said !== turn.match.said) {
      extra.push(`final said: ${turn.finalMatch.ok ? turn.finalMatch.said : turn.finalMatch.reason}`);
    }
    li.append(el("p", "row-extra", extra.join(" · ")));
    const actions = el("div", "row-actions");
    const mis = el("button", "mis", turn.misheard ? "Marked: it misheard me (undo)" : "It misheard me");
    mis.type = "button";
    mis.setAttribute("aria-pressed", String(turn.misheard));
    mis.addEventListener("click", () => {
      turn.misheard = !turn.misheard;
      renderLog();
      renderSummary();
    });
    actions.append(mis);
    if (turn.verdict === "right" || turn.verdict === "wrong") actions.append(appealButton(turn, "mis appeal-row"));
    li.append(actions);
    return li;
  });
  $("log").replaceChildren(...items);
}

function renderCaps() {
  const idx = state.index;
  const parts = [
    `device: ${device.label}`,
    `speech recognition: ${Recognition ? (window.SpeechRecognition ? "SpeechRecognition" : "webkitSpeechRecognition") : "none"}`,
    `on device or server: ${state.turns.at(-1)?.onDevice || state.notes.onDevice || "not known until the first turn"}`,
    `vibration: ${state.notes.vibrate || ("vibrate" in navigator ? "not tried yet" : "not supported")}`,
    `screen awake: ${state.notes.wakeLock || ("wakeLock" in navigator ? "not tried yet" : "not supported")}`,
    `${cat().one} list: ${idx ? `${idx.knownCount.toLocaleString("en-US")} well known${cat().wide ? `, ${idx.places.length.toLocaleString("en-US")} with lesser-known ones` : ""}` : "loading"}`,
  ];
  $("caps").textContent = parts.join(" · ");
}

// ---- The report -----------------------------------------------------------------------------------

export function reportText() {
  const s = summary();
  const ticks = [...document.querySelectorAll("#checklist input")].map((c, i) => `${i + 1}${c.checked ? "x" : "-"}`).join(" ");
  const lines = [
    `Hot Potato hearing test, ${REPORT_VERSION} (matching rules ${RULES_VERSION})`,
    `date: ${new Date().toISOString().slice(0, 16)}Z`,
    `device: ${device.label}; ${ua}`,
    `recognition: ${Recognition ? (window.SpeechRecognition ? "SpeechRecognition" : "webkitSpeechRecognition") : "none"}; on-device: ${state.turns.at(-1)?.onDevice || "-"}; ${state.notes.onDevice || ""}`.trim(),
    `microphone: ${micInReport()}`,
    `vibration: ${state.notes.vibrate || "-"}; wake lock: ${state.notes.wakeLock || "-"}; window ${window.innerWidth}x${window.innerHeight}`,
    `settings now: category=${state.category} lang=${$("lang").value} sounds=${on($("sounds"))} handsfree=${on($("handsFree"))} early=${on($("early"))} wide=${on($("wide"))} suggestions=${on($("suggest"))} maxAlternatives=${MAX_ALTERNATIVES}`,
    `checklist done: ${ticks}`,
    `summary: turns ${s.turns}, right ${s.right}, wrong ${s.wrong}, nothing heard ${s.none}, misheard ${s.misheard}, sound-alike ${s.soundAlike}, appeals real ${s.appealReal} wrong ${s.appealWrong}, errors ${s.errors}, read from suggestions ${s.fromSuggestions}`,
    `early answer: would have taken ${s.earlyWould}, ${s.earlyDiffers} differing from the final`,
    `medians ms: tap>first word ${ms(s.interim)}, tap>matching answer ${ms(s.valid)}, tap>final ${ms(s.final)}, speech end>final ${ms(s.speechToFinal)}`,
    "turns (#n rules category list(known|wide) test sounds mode need | ms after tap: start audio speech speechend first-word answer final end | verdict | heard | flags, sugg:read|own|hidden):",
    ...state.turns.map(turnLine),
  ];
  return lines.join("\n");
}

const on = (input) => (input.checked ? "on" : "off");

function turnLine(t) {
  const a = t.at;
  const m = t.match;
  const verdict =
    t.verdict === "none"
      ? "NONE"
      : m?.ok
        ? `RIGHT ${m.kind}${m.plural ? "-plural" : ""} ${m.said} ${m.place.country ?? (m.place.group.replace(/ /g, "-") || "-")} (heard "${m.heard}", by ${t.decidedBy})`
        : `WRONG ${m?.reason ?? "?"}${m?.place ? ` ${m.said}` : ""} (heard "${m?.heard ?? ""}", by ${t.decidedBy})`;
  const heard = t.alternatives.length ? t.alternatives.map((x) => `${x.transcript}=${x.confidence ? x.confidence.toFixed(2) : 0}`).join(" / ") : t.firstInterim ? `interim:${t.firstInterim}` : "-";
  const finalDiff = t.decidedBy === "interim" && t.finalMatch && t.finalMatch.said !== m?.said ? ` final-differs:${t.finalMatch.ok ? t.finalMatch.said : t.finalMatch.reason}` : "";
  const early = t.earlyWould ? `early-would:${t.earlyWould.said}@${ms(a.early)}` : "";
  const deadEnd = t.next?.skipped.length ? `dead-end:${t.next.skipped.join("")}>${t.next.letter || "any"}` : "";
  const flags = [t.error && `err:${t.error}`, t.misheard && "MISHEARD", t.appeal && `APPEAL:${t.appeal}`, t.auto && "auto", early, deadEnd, `n-interim:${t.interimCount}`, suggestionToken(t)].filter(Boolean).join(" ");
  return `#${t.n} ${m?.rules ?? RULES_VERSION} ${t.category} ${t.wide ? "wide" : "known"} t${t.scenario} snd:${t.sounds ? "on" : "off"} ${t.handsFree ? "hf" : "tap"} ${t.early ? "early" : "final"} ${t.lang} need:${t.required || "-"} | ${[a.start, a.audiostart, a.speechstart, a.speechend, a.interim, a.valid, a.final, a.end].map(ms).join(" ")} | ${verdict}${finalDiff} | ${heard} | ${flags}`;
}

async function copyResults() {
  const text = reportText();
  const note = $("copyNote");
  const area = $("copyText");
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = `Copied ${state.turns.length} turns. Paste them to the agent.`;
    note.hidden = false;
    area.hidden = true;
    return;
  } catch {
    // Fall back to selecting the text so it can be copied by hand.
  }
  area.value = text;
  area.hidden = false;
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  note.textContent = copied ? `Copied ${state.turns.length} turns. Paste them to the agent.` : "Copying was refused: the text below is selected, so copy it by hand.";
  note.hidden = false;
}

// ---- Start-up ---------------------------------------------------------------------------------------

function showMicBlocked(blocked) {
  $("micBlocked").hidden = !blocked;
  if (device.ios) $("micHelp").textContent = "On iPhone or iPad: open Settings, then Safari, then Microphone, and choose Allow; also check Settings, Privacy & Security, Speech Recognition. Then reload the page.";
}

function setScenario(n) {
  state.scenario = n;
  for (const btn of document.querySelectorAll("#checklist button")) btn.setAttribute("aria-pressed", String(Number(btn.dataset.scenario) === n));
}

async function checkOnDevice() {
  const SR = window.SpeechRecognition;
  if (!SR || typeof SR.available !== "function") return;
  try {
    const answer = await SR.available({ langs: [$("lang").value], processLocally: true });
    state.notes.onDevice = `on-device pack for ${$("lang").value}: ${answer}`;
  } catch (err) {
    state.notes.onDevice = `on-device check failed (${err.name})`;
  }
  renderCaps();
}

/** Space or Enter starts a turn and Escape stops listening, unless a control has the keyboard. */
function onKey(e) {
  if (e.key === "Escape") {
    if (state.live || $("handsFree").checked) {
      e.preventDefault();
      stopListening();
    }
    return;
  }
  if (e.key !== " " && e.key !== "Enter") return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.("button, input, select, textarea, a, [contenteditable]")) return;
  e.preventDefault();
  startTurn(false);
}

function init() {
  $("noRecognition").hidden = Boolean(Recognition);
  $("iosNote").hidden = !device.ios;
  $("keys").hidden = touchFirst;
  $("turn").addEventListener("click", () => startTurn(false));
  $("stop").addEventListener("click", stopListening);
  $("copy").addEventListener("click", copyResults);
  $("handsFree").addEventListener("change", renderButtons);
  $("lang").addEventListener("change", checkOnDevice);
  $("mic").addEventListener("change", () => {
    if ($("mic").value) probeTrackSupport();
    if (state.micTrackSupport === "no") $("mic").value = "";
    renderMicNote();
  });
  navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
  document.addEventListener("keydown", onKey);
  $("newGame").addEventListener("click", newGame);
  $("category").replaceChildren(...CATEGORY_IDS.map((id) => new Option(CATEGORIES[id].label, id)));
  $("category").addEventListener("change", () => chooseCategory($("category").value));
  $("wide").addEventListener("change", renderDeadNote);
  $("suggest").checked = savedSuggest();
  $("suggest").addEventListener("change", () => {
    saveSuggest($("suggest").checked);
    renderSuggestions();
  });
  $("suggestMore").addEventListener("click", () => {
    state.suggestPage++;
    renderSuggestions();
  });
  for (const btn of document.querySelectorAll("#checklist button")) btn.addEventListener("click", () => setScenario(Number(btn.dataset.scenario)));
  setScenario(1);
  useCategory(state.category);
  if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: "microphone" })
      .then((status) => {
        showMicBlocked(status.state === "denied");
        if (status.state === "granted") refreshMics();
        status.addEventListener("change", () => {
          showMicBlocked(status.state === "denied");
          if (status.state === "granted") refreshMics();
        });
      })
      .catch(() => {});
  }
  renderGame();
  renderButtons();
  renderSummary();
  renderCaps();
  checkOnDevice();
}

init();
