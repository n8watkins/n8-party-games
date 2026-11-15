// Turn-based games: a game that declares `tickHz: 0` is never ticked on a timer. The room applies
// each input at once, sends the fresh views and goes back to sleep; the only time it wakes on its
// own is the game's next deadline (a turn timer running out), which goes on the room's alarm.
// Because the room sleeps between taps, and a sleeping room may be evicted or restarted by a
// deploy, the game in progress is saved after every input and restored when the room wakes.
//
// Plain logic: no network, no clock, no storage. Any room class (the party room today, the kit's
// own room later) can use it to decide how a game runs and how its state is written down.

import { presenceProblems } from "./presence.js";

/** The version of what saveState writes, so a later shape can still read an older save. */
export const SAVE_VERSION = 1;

/** Whether a game is turn-based: it says `tickHz: 0`, and only then. A game that says nothing ticks at the room's default. */
export function isTurnBased(game) {
  return game?.tickHz === 0;
}

/**
 * What is wrong with a game definition, as sentences (an empty list when nothing is). A room
 * refuses to start a game with problems, so a mistake shows as a clear refusal and not halfway
 * through a match.
 */
export function gameProblems(game) {
  if (!game || typeof game !== "object") return ["A game is an object."];
  const problems = [];
  for (const name of ["create", "input", "snapshot", "isOver"]) {
    if (typeof game[name] !== "function") problems.push(`A game needs ${name}().`);
  }
  const hz = game.tickHz;
  if (hz !== undefined && !(typeof hz === "number" && Number.isFinite(hz) && hz >= 0)) {
    problems.push("tickHz is a number of ticks per second: 0 for a turn-based game, more for a ticking one.");
  }
  if (isTurnBased(game)) {
    if (game.nextDeadline !== undefined && typeof game.nextDeadline !== "function") problems.push("nextDeadline, when given, is a function.");
    if (typeof game.nextDeadline === "function" && typeof game.tick !== "function") problems.push("A turn-based game with deadlines needs tick(), called when one is reached.");
    if ((typeof game.serialize === "function") !== (typeof game.restore === "function")) problems.push("serialize and restore come together, or not at all.");
  } else if (typeof game.tick !== "function") {
    problems.push("A ticking game needs tick().");
  }
  // Presence, the grace, an early end and the room's lifetimes (presence.js): read only while a
  // turn-based game is played, but a wrong value is wrong on any game.
  problems.push(...presenceProblems(game));
  return problems;
}

/**
 * The game's next deadline: a finite time in ms, or null when it is not waiting on the clock (no
 * `nextDeadline`, a paused timer, or a game that is over). Anything else a game returns is null.
 */
export function deadlineOf(game, state) {
  if (typeof game?.nextDeadline !== "function" || game.isOver(state)) return null;
  const at = game.nextDeadline(state);
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/**
 * What an input to a turn-based game gave back, split in two. `events` are for the viewers, like
 * tick's (a list, filtered by `only`): an input may return them as a list, or as `events` on an
 * object. `answer` is everything else: the game's word to the sender (ok, or an error), which a
 * room keeps so it can be sent back to that sender when inputs are answered.
 */
export function inputOutcome(returned) {
  if (Array.isArray(returned)) return { events: returned, answer: null };
  if (returned && typeof returned === "object") {
    const { events, ...answer } = returned;
    return { events: Array.isArray(events) ? events : [], answer };
  }
  return { events: [], answer: null };
}

/**
 * A game's state written down for storage: `{v, by, data}`. A game with `serialize` writes its own
 * (`by: "game"`), and its `data` must be plain JSON (a string is the usual choice); any other game's
 * state is copied as plain JSON (`by: "json"`). A state that is not plain JSON (a Map, a Set, a
 * Date, a class instance, a function, undefined, a number that is not finite, a loop) throws
 * here, by its path, instead of coming back changed after a sleep.
 */
export function saveState(game, state) {
  if (typeof game.serialize === "function") return { v: SAVE_VERSION, by: "game", data: plainJson(game.serialize(state), "serialize()") };
  return { v: SAVE_VERSION, by: "json", data: plainJson(state, "state") };
}

/** The state back from what saveState wrote. Throws when the save is not one this game can read. */
export function loadState(game, saved) {
  if (!saved || typeof saved !== "object" || saved.v !== SAVE_VERSION) throw new Error("Not a saved game.");
  if (saved.by === "game") {
    if (typeof game.restore !== "function") throw new Error("Saved by the game's serialize(), and the game has no restore().");
    return game.restore(structuredClone(saved.data));
  }
  if (saved.by === "json") {
    if (typeof game.restore === "function") throw new Error("Saved as plain JSON, and the game restores its own saves.");
    return structuredClone(saved.data);
  }
  throw new Error("Not a saved game.");
}

/** A copy of `value` that is plain JSON, or a TypeError naming the first part that is not. */
export function plainJson(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is ${value}, which JSON cannot hold.`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is ${value === undefined ? "undefined" : `a ${typeof value}`}, which JSON cannot hold.`);
  if (seen.has(value)) throw new TypeError(`${path} refers back to itself.`);
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((item, i) => plainJson(item, `${path}[${i}]`, seen));
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(`${path} is a ${value.constructor?.name ?? "class instance"}, not a plain object.`);
    copy = {};
    for (const [key, item] of Object.entries(value)) {
      // Like JSON.stringify, a key whose value is undefined is left out rather than refused:
      // `{a: undefined}` is how optional fields often look.
      if (item === undefined) continue;
      copy[key] = plainJson(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return copy;
}
