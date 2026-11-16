// Paper Masks as the Table runs it: the rules (rules.js) with a step before the match and a step
// after it, both in the same pure shape (party/games/table-game.js).
//
//   setup    the waiting step: the seats are dealt in, and the host picks the rounds (3, 5, 7 or
//            everyone reads once), the pack, family-safe prompts and call mode; Begin starts the
//            match. The Table has no settings step of its own (party-kit/GAME-CONTRACT.md, "Games
//            at the Table": a Table game must not have `settings`), so the choices live here.
//            Someone who arrives now is dealt in (up to 8); a seat that goes is dropped.
//   match    the rules, exactly as they are; every move is theirs.
//   curtain  the final standings with the titles, after the rules say the match is over. The room
//            puts every page back at the Table the moment a game is done, so without this step
//            nobody would ever see the final screen. The host's "Back to the Table" (`close`), or
//            the curtain's own deadline, ends it.
//   closed   done: the room gives out the places (standings) and shows its card.
//
// Hard deadlines keep the room from stalling here too: the waiting step begins by itself, with
// the choices as they stand, SETUP_MS after it opened, and the curtain closes CURTAIN_MS after it
// rose. Pages show the time left.
//
// The seed is kept only until the match is created (rules.create keeps what it needs) and is
// never in a view. Nothing here is ever sent to a page except view().
import * as rules from "./rules.js";
import { PACKS } from "./questions.js";

export const { GAME_ID, MIN_PLAYERS, MAX_PLAYERS, SYSTEM, ROUND_CHOICES, DEFAULT_ROUNDS, PACK_CHOICES, isRefusal } = rules;

/** The waiting step begins the match by itself after this long. */
export const SETUP_MS = 180_000;
/** The final standings stay up this long unless the host goes back to the Table first. */
export const CURTAIN_MS = 120_000;

/** The packs the host can choose from, as a page shows them: names only (no prompts, no ghosts). */
export const PACKS_FOR_PAGE = Object.freeze([{ id: "mixed", name: "Mixed" }, ...PACKS.map(({ id, name }) => ({ id, name }))]);

const refuse = (refused, message) => ({ refused, message });
const DEFAULT_OPTIONS = Object.freeze({ rounds: DEFAULT_ROUNDS, pack: "mixed", family: false, callMode: false });

/**
 * The waiting step for these seats. `options.host` is the host's seat (the room's picker); the
 * other options are the host's choices to start from (the defaults when left out).
 */
export function create(seats, options = {}, seed = 0, now = 0) {
  if (!Array.isArray(seats) || seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) return rules.create(seats, options, seed, now);
  if (!seats.every((s) => Number.isInteger(s) && s >= 0) || new Set(seats).size !== seats.length) return rules.create(seats, options, seed, now);
  const { host: wanted, ...picked } = options ?? {};
  const clean = rules.cleanOptions({ ...DEFAULT_OPTIONS, ...picked });
  if (isRefusal(clean)) return clean;
  const order = [...seats].sort((a, b) => a - b);
  const host = wanted ?? order[0];
  if (!order.includes(host)) return refuse("bad_host", "The host must be one of the seats.");
  return { game: GAME_ID, at: "setup", seats: order, host, seed, now, options: clean, until: now + SETUP_MS, match: null, early: false };
}

function begin(state, now) {
  const match = rules.create(state.seats, { ...state.options, host: state.host }, state.seed, now);
  if (isRefusal(match)) return match;
  state.at = "match";
  state.match = match;
  state.until = null;
  delete state.seed; // the match keeps its own generator; the seed is not needed again
  return null;
}

function raiseCurtain(state, now) {
  state.at = "curtain";
  state.host = state.match.host;
  state.until = now + CURTAIN_MS;
}

/** A new state, or a refusal. Never changes `prev`. */
export function apply(prev, seat, move, now = prev.now) {
  if (!move || typeof move !== "object" || typeof move.t !== "string") return refuse("bad_move", "That move is not one the game knows.");
  const state = JSON.parse(JSON.stringify(prev));
  state.now = Math.max(state.now, Number.isFinite(now) ? now : state.now);
  now = state.now;
  if (state.at === "closed") return refuse("over", "The match is over.");
  if (state.at === "setup") return setupMove(state, seat, move, now);
  if (state.at === "curtain") return curtainMove(state, seat, move, now);

  const out = rules.apply(state.match, seat, move, now);
  if (isRefusal(out)) return out;
  state.match = out;
  if (seat === SYSTEM && move.t === "host") state.host = out.host;
  if (rules.done(out)) raiseCurtain(state, now);
  return state;
}

function setupMove(state, seat, move, now) {
  const { t } = move;
  if (seat === SYSTEM) {
    if (t === "tick") {
      if (now < state.until) return state;
      const no = begin(state, now);
      return no ?? state;
    }
    if (t === "join") {
      const s = move.seat;
      if (!Number.isInteger(s) || s < 0) return refuse("bad_move", "That move is not one the game knows.");
      if (state.seats.includes(s)) return refuse("already_in_game", "That seat is already in the game.");
      if (state.seats.length >= MAX_PLAYERS) return refuse("full", "The table is full.");
      state.seats = [...state.seats, s].sort((a, b) => a - b);
      return state;
    }
    if (t === "leave") {
      if (!state.seats.includes(move.seat)) return refuse("not_playing", "Only a player in this round can do that.");
      state.seats = state.seats.filter((s) => s !== move.seat);
      if (state.host === move.seat) state.host = state.seats[0] ?? null;
      if (state.seats.length < MIN_PLAYERS) {
        // Too few to begin: the match ends before it started, with no points.
        state.at = "closed";
        state.early = true;
        state.until = null;
      }
      return state;
    }
    if (t === "host") {
      if (!state.seats.includes(move.seat)) return refuse("bad_host", "The host must be one of the seats.");
      state.host = move.seat;
      return state;
    }
    return refuse("bad_move", "That move is not one the game knows.");
  }
  if (["tick", "join", "leave", "host"].includes(t)) return refuse("not_system", "Only the room can send that.");
  if (t !== "choose" && t !== "begin") return refuse("not_now", "That cannot be done before the match begins.");
  if (seat !== state.host) return refuse("not_host", "Only the host can do that.");
  if (t === "choose") {
    const picked = {};
    for (const k of ["rounds", "pack", "family", "callMode"]) if (Object.hasOwn(move, k)) picked[k] = move[k];
    if (Object.keys(move).some((k) => k !== "t" && !(k in picked))) return refuse("bad_option", "That option is not one the game knows.");
    const clean = rules.cleanOptions({ ...state.options, ...picked });
    if (isRefusal(clean)) return clean;
    state.options = clean;
    return state;
  }
  const no = begin(state, now);
  return no ?? state;
}

function curtainMove(state, seat, move, now) {
  const { t } = move;
  if (seat === SYSTEM) {
    if (t === "tick") {
      if (now >= state.until) {
        state.at = "closed";
        state.until = null;
      }
      return state;
    }
    // Nobody new sits down after the last round, and a seat that goes changes nothing now.
    if (t === "join") return refuse("over", "The match is over.");
    if (t === "leave") return state;
    if (t === "host") {
      state.host = move.seat;
      return state;
    }
    return refuse("bad_move", "That move is not one the game knows.");
  }
  if (t !== "close") return refuse("over", "The match is over.");
  if (seat !== state.host) return refuse("not_host", "Only the host can do that.");
  state.at = "closed";
  state.until = null;
  return state;
}

export function nextDeadline(state) {
  if (state.at === "setup" || state.at === "curtain") return state.until;
  if (state.at === "match") return rules.nextDeadline(state.match);
  return null;
}

export const done = (state) => state.at === "closed";

const EMPTY_RESULT = Object.freeze({ early: true, roundsPlayed: 0, rows: [], winners: [], awards: { bestMask: { seats: [], count: 0 }, mindReader: { seats: [], count: 0 } }, watchers: [] });

export function result(state) {
  return state.match ? rules.result(state.match) : structuredClone(EMPTY_RESULT);
}

export function standings(state) {
  return state.match ? rules.standings(state.match) : [];
}

/**
 * What one seat may see: the rules' own view during the match and at the curtain, and the
 * waiting step's (who is dealt in and the host's choices; nothing secret exists yet) before it.
 */
export function view(state, seat) {
  if (state.match) {
    const out = rules.view(state.match, seat);
    if (state.at !== "match") {
      out.curtain = true;
      out.host = state.host;
      out.you.host = out.you.seat === state.host && out.you.role !== "screen";
      out.deadline = { soft: null, hard: state.until, overdue: false };
    }
    return out;
  }
  const playing = state.seats.includes(seat);
  return {
    game: GAME_ID,
    phase: state.at === "closed" ? "over" : "setup",
    round: 0,
    rounds: state.options.rounds,
    callMode: state.options.callMode,
    pack: state.options.pack,
    family: state.options.family,
    host: state.host,
    reader: null,
    prompt: null,
    ghost: false,
    you: { seat: Number.isInteger(seat) ? seat : null, role: playing ? "player" : "screen", mask: null, reader: false, host: playing && seat === state.host },
    players: state.seats.map((s) => ({ seat: s, mask: null, score: 0, left: false, joinedRound: null, inRound: true })),
    watchers: [],
    deadline: { soft: null, hard: state.until, overdue: false },
    notes: [],
    step: { choices: { rounds: [...ROUND_CHOICES], packs: PACKS_FOR_PAGE.map((p) => ({ ...p })) }, min: MIN_PLAYERS, max: MAX_PLAYERS },
    ...(state.at === "closed" ? { result: result(state) } : {}),
  };
}
