// The Hot Potato hearing test: one turn = one speech recognition session, started by a tap (or
// again by itself in hands-free mode). Each turn's timings, guesses and verdict are logged on the
// page and in the "Copy results" report. Nothing is stored or sent anywhere by this page.
import { buildIndex, lastLetter, matchHeard, median, normalize } from "./logic.js";

const $ = (id) => document.getElementById(id);
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const MAX_ALTERNATIVES = 10;
const POTATO_MAX = 10;

const state = {
  index: null,
  places: 0,
  chain: [], // spoken names accepted this game
  used: new Set(),
  usedNames: new Set(),
  required: "",
  potato: 0,
  turns: [],
  scenario: 1,
  live: null, // the turn now listening
  silentInARow: 0,
  wakeLock: null,
  notes: { vibrate: "", wakeLock: "", onDevice: "" },
};

// ---- The city list, loaded after the page is up -----------------------------------------------

const listReady = fetch("cities.json")
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then((doc) => {
    state.index = buildIndex(doc);
    state.places = doc.rows.length;
    renderCaps();
    return state.index;
  })
  .catch((err) => {
    $("need").textContent = `The city list did not load (${err.message}). Reload the page.`;
    throw err;
  });

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

// ---- One turn -----------------------------------------------------------------------------------

function newTurn(auto) {
  return {
    n: state.turns.length + 1,
    scenario: state.scenario,
    lang: $("lang").value,
    sounds: $("sounds").checked,
    handsFree: $("handsFree").checked,
    early: $("early").checked,
    auto,
    required: state.required,
    rules: snapshot(),
    t0: performance.now(),
    at: {}, // ms after the tap: start, audiostart, speechstart, speechend, interim, valid, final, end
    interimCount: 0,
    firstInterim: "",
    validInterim: "",
    alternatives: [],
    finalMatch: null,
    match: null,
    decidedBy: "",
    verdict: "",
    error: "",
    misheard: false,
    onDevice: "",
  };
}

const since = (turn) => Math.round(performance.now() - turn.t0);
const mark = (turn, key) => {
  if (turn.at[key] === undefined) turn.at[key] = since(turn);
};

/** The game as it stood when a turn began: every check in that turn is made against it. */
const snapshot = () => ({ required: state.required, used: new Set(state.used), usedNames: new Set(state.usedNames), previous: state.chain.at(-1) ?? "" });

function check(turn, alternatives) {
  if (!state.index) return null;
  return matchHeard(state.index, alternatives, turn.rules);
}

function startTurn(auto = false) {
  if (state.live || !Recognition) return;
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
  state.live = { turn, rec };

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

  try {
    rec.start();
  } catch (err) {
    turn.error = `start failed (${err.name})`;
    state.live = null;
    return finishTurn(turn);
  }
  holdScreen();
  $("heard").textContent = "Listening...";
  $("heard").classList.add("listening");
  $("verdict").textContent = " ";
  $("verdict").className = "verdict";
  renderButtons();
}

function onResult(turn, rec, e) {
  let interim = "";
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const result = e.results[i];
    if (result.isFinal) {
      mark(turn, "final");
      turn.alternatives = Array.from(result, (a) => ({ transcript: a.transcript.trim(), confidence: a.confidence }));
      const m = check(turn, turn.alternatives);
      turn.finalMatch = m;
      $("heard").textContent = turn.alternatives[0]?.transcript || " ";
      if (!turn.verdict) decide(turn, m, "final");
    } else {
      interim += result[0].transcript;
    }
  }
  interim = interim.trim();
  if (!interim) return;
  turn.interimCount++;
  if (turn.at.interim === undefined) {
    mark(turn, "interim");
    turn.firstInterim = interim;
  }
  if (!turn.verdict) $("heard").textContent = interim;
  if (turn.at.valid === undefined) {
    const m = check(turn, [{ transcript: interim, confidence: 0 }]);
    if (m?.ok) {
      mark(turn, "valid");
      turn.validInterim = interim;
      if (turn.early && !turn.verdict) {
        decide(turn, m, "interim");
        try {
          rec.stop();
        } catch {}
      }
    }
  }
}

function decide(turn, m, by) {
  if (!m) return; // the list is not loaded yet: the final result decides
  turn.match = m;
  turn.decidedBy = by;
  turn.verdict = m.ok ? "right" : "wrong";
  if (m.ok) {
    state.chain.push(m.said);
    state.used.add(m.place.id);
    state.usedNames.add(normalize(m.said));
    state.required = lastLetter(m.said);
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
  const wasLive = state.live?.turn === turn;
  if (wasLive) state.live = null;
  if (!turn.verdict && turn.alternatives.length) {
    // The final result came before the city list was ready.
    await listReady.catch(() => {});
    turn.finalMatch = check(turn, turn.alternatives);
    decide(turn, turn.finalMatch, "final");
  }
  if (!turn.verdict) {
    turn.verdict = "none";
    $("heard").textContent = " ";
    showVerdict(turn);
  }
  $("heard").classList.remove("listening");
  state.turns.push(turn);
  state.silentInARow = turn.verdict === "none" ? state.silentInARow + 1 : 0;
  renderLog();
  renderSummary();
  renderButtons();

  const fatal = /not-allowed|service-not-allowed|language-not-supported|cannot create|start failed/.test(turn.error);
  if ($("handsFree").checked && !fatal && state.silentInARow < 3) {
    // Wait for the ding or buzz to finish, so the phone does not hear its own sound.
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

const REASONS = {
  used: "already said this game",
  "wrong-letter": "wrong first letter",
  echo: "that was the last city again",
  "not-a-city": "not a city in the list",
};

function population(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function verdictText(turn) {
  const m = turn.match;
  if (turn.verdict === "none") {
    if (/not-allowed|service-not-allowed/.test(turn.error)) return `Microphone blocked (${turn.error})`;
    if (turn.error === "network") return "No connection to the speech service (network)";
    if (turn.error === "aborted") return "Stopped (aborted)";
    return turn.error ? `Nothing heard (${turn.error})` : "Nothing heard";
  }
  if (!m) return "";
  if (m.ok) {
    const how = m.kind === "exact" ? "exact" : m.kind === "alternative" ? `guess ${m.alternative + 1}` : "sounds like";
    return `Yes: ${m.said} (${m.place.country}, ${population(m.place.population)}), ${how}`;
  }
  const near = m.place ? `: ${m.said} (${m.place.country})` : "";
  return `No, ${REASONS[m.reason] ?? m.reason}${near}`;
}

function showVerdict(turn) {
  const el = $("verdict");
  el.textContent = verdictText(turn) || " ";
  el.className = `verdict ${turn.verdict}`;
}

// ---- Rendering -----------------------------------------------------------------------------------

function renderGame() {
  const last = state.chain.at(-1);
  $("need").textContent = state.required ? `Next: a city starting with ${state.required.toUpperCase()}` : "Say any city to start";
  $("chainLine").textContent = last ? `after ${last}${state.chain.length > 1 ? ` · ${state.chain.length} cities so far` : ""}` : "";
  $("potato").style.setProperty("--level", String(state.potato));
  $("potato").dataset.level = String(state.potato);
}

function renderButtons() {
  const live = Boolean(state.live);
  const btn = $("turn");
  btn.disabled = !Recognition || live;
  btn.textContent = !Recognition ? "No speech recognition here" : live ? "Listening..." : "Your turn: tap and say a city";
  btn.classList.toggle("live", live);
  $("stop").hidden = !live && !$("handsFree").checked;
}

const ms = (v) => (v === undefined || v === null ? "-" : `${v}`);

function summary() {
  const t = state.turns;
  const count = (f) => t.filter(f).length;
  const pick = (k) => median(t.map((x) => x.at[k]));
  const speechToFinal = median(t.map((x) => (x.at.final !== undefined && x.at.speechend !== undefined ? x.at.final - x.at.speechend : null)));
  return {
    turns: t.length,
    right: count((x) => x.verdict === "right"),
    wrong: count((x) => x.verdict === "wrong"),
    none: count((x) => x.verdict === "none"),
    misheard: count((x) => x.misheard),
    soundAlike: count((x) => x.match?.kind === "sound-alike"),
    errors: count((x) => x.error),
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
    ["Median: tap to first word", s.interim === null ? "-" : `${s.interim} ms`],
    ["Median: tap to a matching city", s.valid === null ? "-" : `${s.valid} ms`],
    ["Median: tap to final result", s.final === null ? "-" : `${s.final} ms`],
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
    const li = el("li", `turn-row ${turn.verdict}${turn.misheard ? " misheard" : ""}`);
    const head = el("p", "row-head");
    head.append(el("span", "row-n", `#${turn.n}`), el("span", "row-verdict", verdictText(turn)));
    const times = el("p", "row-times", `first word ${ms(turn.at.interim)} · matching city ${ms(turn.at.valid)} · final ${ms(turn.at.final)} ms${turn.decidedBy ? ` · decided on ${turn.decidedBy}` : ""}`);
    const alts = turn.alternatives.length
      ? turn.alternatives.map((a) => `"${a.transcript}" ${a.confidence ? a.confidence.toFixed(2) : "0"}`).join(" · ")
      : turn.firstInterim
        ? `interim only: "${turn.firstInterim}"`
        : "no words";
    const heard = el("p", "row-alts", `Heard: ${alts}`);
    li.append(head, times, heard);
    const extra = [];
    if (turn.required) extra.push(`needed ${turn.required.toUpperCase()}`);
    extra.push(`test ${turn.scenario}`, turn.sounds ? "sounds on" : "sounds off");
    if (turn.auto) extra.push("hands-free");
    if (turn.error) extra.push(`error: ${turn.error}`);
    if (turn.finalMatch && turn.match && turn.decidedBy === "interim" && turn.finalMatch.said !== turn.match.said) {
      extra.push(`final said: ${turn.finalMatch.ok ? turn.finalMatch.said : REASONS[turn.finalMatch.reason]}`);
    }
    li.append(el("p", "row-extra", extra.join(" · ")));
    const mis = el("button", "mis", turn.misheard ? "Marked: it misheard me (tap to undo)" : "It misheard me");
    mis.type = "button";
    mis.setAttribute("aria-pressed", String(turn.misheard));
    mis.addEventListener("click", () => {
      turn.misheard = !turn.misheard;
      renderLog();
      renderSummary();
    });
    li.append(mis);
    return li;
  });
  $("log").replaceChildren(...items);
}

function renderCaps() {
  const parts = [
    `Speech recognition: ${Recognition ? (window.SpeechRecognition ? "SpeechRecognition" : "webkitSpeechRecognition") : "none"}`,
    `on device or server: ${state.turns.at(-1)?.onDevice || state.notes.onDevice || "not known until the first turn"}`,
    `vibration: ${state.notes.vibrate || ("vibrate" in navigator ? "not tried yet" : "not supported")}`,
    `screen awake: ${state.notes.wakeLock || ("wakeLock" in navigator ? "not tried yet" : "not supported")}`,
    `city list: ${state.places ? `${state.places.toLocaleString("en-US")} places` : "loading"}`,
  ];
  $("caps").textContent = parts.join(" · ");
}

// ---- The report -----------------------------------------------------------------------------------

function platform() {
  if (isIOS) return "iOS";
  if (/Android/.test(ua)) return "Android";
  return "other";
}

export function reportText() {
  const s = summary();
  const ticks = [...document.querySelectorAll("#checklist input")].map((c, i) => `${i + 1}${c.checked ? "x" : "-"}`).join(" ");
  const lines = [
    "Hot Potato hearing test, v1",
    `date: ${new Date().toISOString().slice(0, 16)}Z`,
    `device: ${platform()}; ${ua}`,
    `recognition: ${Recognition ? (window.SpeechRecognition ? "SpeechRecognition" : "webkitSpeechRecognition") : "none"}; on-device: ${state.turns.at(-1)?.onDevice || "-"}; ${state.notes.onDevice || ""}`.trim(),
    `vibration: ${state.notes.vibrate || "-"}; wake lock: ${state.notes.wakeLock || "-"}; screen ${window.innerWidth}x${window.innerHeight}`,
    `settings now: lang=${$("lang").value} sounds=${on($("sounds"))} handsfree=${on($("handsFree"))} early=${on($("early"))} maxAlternatives=${MAX_ALTERNATIVES}`,
    `checklist done: ${ticks}`,
    `summary: turns ${s.turns}, right ${s.right}, wrong ${s.wrong}, nothing heard ${s.none}, misheard ${s.misheard}, sound-alike ${s.soundAlike}, errors ${s.errors}`,
    `medians ms: tap>first word ${ms(s.interim)}, tap>matching city ${ms(s.valid)}, tap>final ${ms(s.final)}, speech end>final ${ms(s.speechToFinal)}`,
    "turns (#n test sounds mode need | ms after tap: start audio speech speechend first-word city final end | verdict | heard):",
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
        ? `RIGHT ${m.kind} ${m.said} ${m.place.country} (heard "${m.heard}", by ${t.decidedBy})`
        : `WRONG ${m?.reason ?? "?"}${m?.place ? ` ${m.said}` : ""} (by ${t.decidedBy})`;
  const heard = t.alternatives.length ? t.alternatives.map((x) => `${x.transcript}=${x.confidence ? x.confidence.toFixed(2) : 0}`).join(" / ") : t.firstInterim ? `interim:${t.firstInterim}` : "-";
  const finalDiff = t.decidedBy === "interim" && t.finalMatch && t.finalMatch.said !== m?.said ? ` final-differs:${t.finalMatch.ok ? t.finalMatch.said : t.finalMatch.reason}` : "";
  const flags = [t.error && `err:${t.error}`, t.misheard && "MISHEARD", t.auto && "auto", `n-interim:${t.interimCount}`].filter(Boolean).join(" ");
  return `#${t.n} t${t.scenario} snd:${t.sounds ? "on" : "off"} ${t.handsFree ? "hf" : "tap"} ${t.early ? "early" : "final"} ${t.lang} need:${t.required || "-"} | ${[a.start, a.audiostart, a.speechstart, a.speechend, a.interim, a.valid, a.final, a.end].map(ms).join(" ")} | ${verdict}${finalDiff} | ${heard} | ${flags}`;
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
  if (isIOS) $("micHelp").textContent = "On iPhone: open Settings, then Safari, then Microphone, and choose Allow; also check Settings, Privacy & Security, Speech Recognition. Then reload the page.";
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

function init() {
  $("noRecognition").hidden = Boolean(Recognition);
  $("iosNote").hidden = !isIOS;
  $("turn").addEventListener("click", () => startTurn(false));
  $("stop").addEventListener("click", stopListening);
  $("copy").addEventListener("click", copyResults);
  $("handsFree").addEventListener("change", renderButtons);
  $("lang").addEventListener("change", checkOnDevice);
  $("newGame").addEventListener("click", () => {
    Object.assign(state, { chain: [], used: new Set(), usedNames: new Set(), required: "", potato: 0 });
    $("heard").textContent = " ";
    $("verdict").textContent = " ";
    renderGame();
  });
  for (const btn of document.querySelectorAll("#checklist button")) btn.addEventListener("click", () => setScenario(Number(btn.dataset.scenario)));
  setScenario(1);
  if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: "microphone" })
      .then((status) => {
        showMicBlocked(status.state === "denied");
        status.addEventListener("change", () => showMicBlocked(status.state === "denied"));
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
