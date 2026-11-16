// Hot Potato, the rules of a round: who holds the potato, the letter, the chain, the stages, the
// fuse, appeals and the burst. Pure: no DOM, no clock of its own, no drawing. The page (app.js)
// calls these functions and reads the state; the potato's look (art.js) only ever sees artState().
//
// A round, in phases:
//  - "ready":  the potato has been passed to `holder`, who starts their turn (a tap, Space or
//              Enter). The fuse does not burn while it is being passed. The last verdict stays on
//              screen, and its appeal can still be used, until the turn starts.
//  - "listen": the fuse burns (FUSE_SECONDS for the stage). A word heard or typed is judged by the
//              shared matcher (shared/logic.js, rules m3); the fuse running out is a miss.
//  - "doom":   the last life was just lost. The verdict shows for DOOM_MS, and an appeal can still
//              save it; then it bursts.
//  - "burst":  it burst on `burstOn`; after BURST_MS the round is "over".
//  - "over":   the end screen.
//
// Stages: 0 is healthy; each miss is one stage worse; a miss at stage 4 (the last life) bursts it.
// A right answer does not heal ("it settles"): damage stays, rounds stay short.

import { matchHeard, nextLetter, normalize, trimFillers } from "./shared/logic.js";

/** Seconds on the fuse at each stage: it gets shorter as the potato gets worse. */
export const FUSE_SECONDS = [10, 9, 8, 7, 6];
/** Misses before it bursts: stages 0 to 4 are alive, a miss at 4 bursts it. */
export const LIVES = 5;
export const LAST_STAGE = LIVES - 1;
/** How long the losing verdict stays, with its appeal, before the potato bursts. */
export const DOOM_MS = 2600;
/** How long the burst plays before the end screen. */
export const BURST_MS = 2800;
/** After a verdict, the next turn cannot be started for this long (a double tap is not a turn). */
export const SETTLE_MS = 600;
/** When the fuse runs out while someone is still speaking, the recogniser gets this long to finish. */
export const GRACE_MS = 1200;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** The light on the potato's plate, per stage, then dark when it has burst. */
export const LIGHTS = ["#5dff6a", "#3fae48", "#ffc93a", "#ff9a1f", "#ff3b2f", "#2b2826"];

export const playerName = (i) => `Player ${i + 1}`;
const clampPlayers = (n) => Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(Number(n)) || MIN_PLAYERS));

/**
 * A new round. `index` is the category's index (buildIndex in shared/logic.js), `players` 2 to 8,
 * `first` who holds it first (0 by default).
 */
export function newRound({ index, players, first = 0 }) {
  const n = clampPlayers(players);
  return {
    index,
    category: index.category,
    players: n,
    holder: ((first % n) + n) % n,
    stage: 0,
    phase: "ready",
    paused: false,
    time: 0,
    readyAt: 0,
    fuseMax: FUSE_SECONDS[0] * 1000,
    fuse: FUSE_SECONDS[0] * 1000,
    speaking: false,
    lit: false,
    graceLeft: 0,
    doomLeft: 0,
    burstLeft: 0,
    burstOn: -1,
    need: "",
    skipped: [],
    chain: [],
    used: new Set(),
    usedNames: new Set(),
    misses: 0,
    turns: 0,
    appeals: 0,
    last: null,
    events: [],
  };
}

const emit = (g, type, data = {}) => g.events.push({ type, at: g.time, ...data });

/** Takes and clears the events since the last call: what the page should play (sounds, art). */
export function drainEvents(g) {
  const out = g.events;
  g.events = [];
  return out;
}

const fuseFor = (stage) => FUSE_SECONDS[Math.min(stage, FUSE_SECONDS.length - 1)] * 1000;
const nextHolder = (g, from = g.holder) => (from + 1) % g.players;

/** Whether the holder may start their turn now. */
export const canStart = (g) => g.phase === "ready" && !g.paused && g.time >= g.readyAt;

/** The holder starts their turn: the fuse starts burning. Returns false when it cannot start. */
export function startTurn(g) {
  if (!canStart(g)) return false;
  g.phase = "listen";
  g.fuseMax = fuseFor(g.stage);
  g.fuse = g.fuseMax;
  g.graceLeft = 0;
  g.lit = false;
  g.speaking = false;
  g.turns++;
  g.last = null;
  emit(g, "listen", { holder: g.holder, stage: g.stage });
  return true;
}

/**
 * The fuse is lit: the microphone is on (or the answer is typed). Until then it does not burn, so
 * the browser asking for the microphone, or starting up, costs nobody any time.
 */
export function lightFuse(g) {
  if (g.phase === "listen" && !g.lit) {
    g.lit = true;
    emit(g, "lit");
  }
}

/** Someone has started speaking: if the fuse runs out now, the recogniser gets GRACE_MS to finish. */
export function speaking(g) {
  if (g.phase === "listen") g.speaking = true;
}

/** Recomputes the letter after the chain's last word (dead ends skipped, through the shared matcher). */
function updateNeed(g) {
  const last = g.chain.at(-1);
  if (!last) {
    g.need = "";
    g.skipped = [];
    return;
  }
  const { letter, skipped } = nextLetter(g.index, last.said, { used: g.used });
  g.need = letter;
  g.skipped = skipped;
}

function addWord(g, entry) {
  g.chain.push(entry);
  if (entry.id != null) g.used.add(entry.id);
  g.usedNames.add(normalize(entry.said));
  updateNeed(g);
}

function removeWord(g, entry) {
  const i = g.chain.lastIndexOf(entry);
  if (i >= 0) g.chain.splice(i, 1);
  if (entry.id != null && !g.chain.some((c) => c.id === entry.id)) g.used.delete(entry.id);
  const key = normalize(entry.said);
  if (!g.chain.some((c) => normalize(c.said) === key)) g.usedNames.delete(key);
  updateNeed(g);
}

/** One letter upper case, for display. */
export const showLetter = (c) => (c ? c.toUpperCase() : "");

/** A heard phrase as a person would write it: "los angeles" -> "Los Angeles". */
const titled = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The plain reason a word was refused, for the verdict line. */
export function refusalReason(g, m, required) {
  const one = g.category?.one ?? "word";
  const a = g.category?.a ?? `a ${one}`;
  const heard = m.heard ? titled(m.heard) : "";
  const said = m.said || heard;
  switch (m.reason) {
    case "used":
      return `${said} was said already`;
    case "wrong-letter":
      return `${said} starts with ${showLetter(said.replace(/[^A-Za-z]/g, "").charAt(0))}, not ${showLetter(required)}`;
    case "echo":
      return `${heard || "That"} was the last word again`;
    case "hard-only":
      return `${said} is too little known for this list`;
    case "word":
      return `"${heard}" is not ${a}`;
    case "name":
      return `"${heard}" is a name, not ${a}`;
    default:
      return heard ? `"${heard}" is not ${a} we know` : "Nothing was heard";
  }
}

/**
 * A word was heard (the recogniser's guesses, [{transcript, confidence}]) or typed (`typed`
 * true, one guess). Judges it under the chain rule and updates the round. Returns the verdict, or
 * null when no turn is listening.
 */
export function hear(g, alternatives, { typed = false } = {}) {
  if (g.phase !== "listen") return null;
  const required = g.need;
  const previous = g.chain.at(-1)?.said ?? "";
  const m = matchHeard(g.index, alternatives, { required, used: g.used, usedNames: g.usedNames, previous });
  const by = g.holder;
  const heard = m.heard || trimFillers(alternatives?.[0]?.transcript ?? "");
  if (m.ok) {
    const entry = { said: m.said, id: m.place?.id ?? null, by, heard, typed, group: m.place?.group || m.place?.countryName || "" };
    addWord(g, entry);
    const verdict = { ok: true, word: entry, by, typed, required, skipped: [...g.skipped], match: m, appealed: false };
    return settleVerdict(g, verdict);
  }
  const verdict = { ok: false, reason: m.reason, why: refusalReason(g, m, required), heard, by, typed, required, match: m, appealed: false };
  return missVerdict(g, verdict);
}

/** The fuse ran out with nothing (or nothing finished) heard. */
export function timeUp(g) {
  if (g.phase !== "listen") return null;
  const verdict = { ok: false, reason: "slow", why: "Too slow", heard: "", by: g.holder, typed: false, required: g.need, match: null, appealed: false };
  return missVerdict(g, verdict);
}

function settleVerdict(g, verdict) {
  g.last = verdict;
  g.speaking = false;
  emit(g, "right", { by: verdict.by, word: verdict.word.said });
  passOn(g);
  return verdict;
}

function missVerdict(g, verdict) {
  g.last = verdict;
  g.speaking = false;
  g.misses++;
  if (g.stage >= LAST_STAGE) {
    g.phase = "doom";
    g.doomLeft = DOOM_MS;
    emit(g, "doom", { by: verdict.by, why: verdict.why });
    return verdict;
  }
  g.stage++;
  emit(g, "worse", { by: verdict.by, stage: g.stage, why: verdict.why });
  passOn(g);
  return verdict;
}

function passOn(g) {
  g.holder = nextHolder(g, g.last?.by ?? g.holder);
  g.phase = "ready";
  g.readyAt = g.time + SETTLE_MS;
  g.fuseMax = fuseFor(g.stage);
  g.fuse = g.fuseMax;
  emit(g, "pass", { holder: g.holder });
}

function burst(g, on) {
  g.phase = "burst";
  g.burstOn = on;
  g.stage = LIVES;
  g.burstLeft = BURST_MS;
  emit(g, "burst", { on });
}

/** The word a refusal would go into the chain as, if the group says it was right ("" when nothing was heard). */
const appealedWord = (v) => (v.match?.said || titled(v.heard || "")).trim();

/**
 * Whether the last verdict can still be appealed: until the next turn starts, once. A refusal can
 * be called right only when a word was heard (letters, not just "???"): silence, or nothing
 * the matcher could read, has no word to put in the chain.
 */
export const canAppeal = (g) =>
  Boolean(g.last) && !g.last.appealed && (g.phase === "ready" || g.phase === "doom") && (g.last.ok || /[a-z]/i.test(appealedWord(g.last)));

/**
 * The group says the last verdict was wrong: a refusal becomes a right answer ("that was right"),
 * an acceptance a miss ("that was wrong"). Recognisers mishear, so the group has the last word.
 * Returns true when the appeal was taken.
 */
export function appeal(g) {
  if (!canAppeal(g)) return false;
  const v = g.last;
  v.appealed = true;
  g.appeals++;
  if (!v.ok) {
    // That was right: undo the damage and put the word in the chain as said.
    const said = appealedWord(v);
    const entry = { said, id: v.match?.place?.id ?? null, by: v.by, heard: v.heard, typed: v.typed, group: "", appealed: true };
    addWord(g, entry);
    g.misses = Math.max(0, g.misses - 1);
    if (g.phase === "doom") {
      g.doomLeft = 0;
      g.phase = "ready";
      g.holder = nextHolder(g, v.by);
    } else {
      g.stage = Math.max(0, g.stage - 1);
    }
    g.readyAt = g.time + SETTLE_MS;
    g.fuseMax = fuseFor(g.stage);
    g.fuse = g.fuseMax;
    v.overturned = "right";
    emit(g, "appeal", { now: "right", stage: g.stage });
    return true;
  }
  // That was wrong: the word leaves the chain and the miss counts.
  removeWord(g, v.word);
  g.misses++;
  v.overturned = "wrong";
  if (g.stage >= LAST_STAGE) {
    burst(g, v.by);
    return true;
  }
  g.stage++;
  g.fuseMax = fuseFor(g.stage);
  g.fuse = g.fuseMax;
  emit(g, "appeal", { now: "wrong", stage: g.stage });
  emit(g, "worse", { by: v.by, stage: g.stage, why: "Overturned" });
  return true;
}

/** Pauses or resumes: nothing burns or counts down while paused. */
export function setPaused(g, on) {
  const can = g.phase === "ready" || g.phase === "listen" || g.phase === "doom";
  const next = Boolean(on) && can;
  if (next === g.paused) return false;
  g.paused = next;
  emit(g, next ? "pause" : "resume");
  return true;
}

/** Advances the round's clock by `ms` (the page calls it every frame; never while hidden). */
export function tick(g, ms) {
  if (g.paused || !(ms > 0)) return;
  g.time += ms;
  if (g.phase === "listen") {
    if (!g.lit) return;
    if (g.graceLeft > 0) {
      g.graceLeft -= ms;
      if (g.graceLeft <= 0) timeUp(g);
      return;
    }
    g.fuse = Math.max(0, g.fuse - ms);
    if (g.fuse <= 0) {
      if (g.speaking) {
        g.graceLeft = GRACE_MS;
        emit(g, "grace");
      } else timeUp(g);
    }
  } else if (g.phase === "doom") {
    g.doomLeft -= ms;
    if (g.doomLeft <= 0) {
      const over = -g.doomLeft;
      burst(g, g.last?.by ?? g.holder);
      // The time past the doom counts toward the burst.
      if (over > 0) {
        g.time -= over;
        tick(g, over);
      }
    }
  } else if (g.phase === "burst") {
    g.burstLeft -= ms;
    if (g.burstLeft <= 0) {
      g.phase = "over";
      emit(g, "over", { on: g.burstOn });
    }
  }
}

/** The fuse left, 0 to 1 (1 while it is not burning). */
export const fuseShare = (g) => (g.phase === "listen" ? Math.max(0, Math.min(1, g.fuse / g.fuseMax)) : 1);
export const livesLeft = (g) => Math.max(0, LIVES - g.stage);

/**
 * Everything the potato's look needs, and nothing else: the seam between the rules and the
 * drawing (see art.js). `growth` is how far along it is, 0 healthy to 1 about to burst, from the
 * stage; `strain` adds the pressure of a burning fuse on top, so it swells a little as time runs
 * out and settles back after an answer; `light` is the plate light's colour.
 */
export function artState(g) {
  const burst = g.phase === "burst" || g.phase === "over";
  const stage = Math.min(g.stage, LIVES);
  const growth = burst ? 1 : Math.min(1, stage / LAST_STAGE);
  const pressure = g.phase === "listen" ? 1 - fuseShare(g) : g.phase === "doom" ? 1 : 0;
  const strain = burst ? 1 : Math.min(1, growth * 0.8 + pressure * 0.2);
  return {
    stage,
    growth,
    strain,
    light: LIGHTS[Math.min(stage, LIGHTS.length - 1)],
    phase: burst ? "burst" : g.phase,
    paused: g.paused,
  };
}
