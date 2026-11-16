// Who Am I? at the Table: the pure rules (README.md says what was decided and why, and every
// difference from the live game at whoami.n8builds.dev).
//
// Each of two players is dealt a secret name. Your phone shows the name the OTHER player is
// guessing, never your own; you ask yes/no questions (or listen to clues) and guess who you are,
// and the other player confirms the guess.
//
// Everything here is a pure function of plain JSON: no clock, no platform APIs, no hidden
// randomness. Randomness comes from a mulberry32 generator whose position is kept in the state
// (`state.rng`), started from the secret seed given to `create`. The state is server only: a page
// gets `view(state, seat)` and nothing else.
//
//   create(seats, options, seed, now)  -> state | refusal
//   apply(state, seat, move, now)      -> new state | refusal     (never changes `state`)
//   view(state, seat)                  -> what that seat may see (seat -1: a big screen)
//   nextDeadline(state)                -> when the room must send { t: "tick" } as SYSTEM, or null
//   done(state), result(state), standings(state)
//
// A refusal is `{ refused: code, message }`; `isRefusal(x)` tells them apart.

import { DIFFICULTIES, PACK_IDS, PACKS, drawPair, getIdentity, publicIdentity } from "./deck.js";

export const GAME_ID = "who-am-i";
/** Seats the module takes: two play, the rest watch. The Table's wall decides what a party may start. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
/** Players in a match. */
export const PLAYERS_PER_MATCH = 2;
/** The seat id the room sends its own moves as: tick, join, leave, host. */
export const SYSTEM = "system";

export const MODES = Object.freeze(["twenty_questions", "describe_it"]);
export const TURN_FORMATS = Object.freeze(["trade", "keep_going"]);
/** Seconds per turn (per move in trade turns); 0 is "no timer": no countdown shown, a long backstop only. */
export const TIMER_CHOICES = Object.freeze([0, 60, 90]);
export const MATCH_CHOICES = Object.freeze(["first-to-3", "first-to-5", "rounds-5", "rounds-10"]);
export const QUESTION_MODES = Object.freeze(["spoken", "app", "both"]);
export const ANSWERS = Object.freeze(["yes", "no", "sort_of", "dont_know"]);
export const DEFAULT_OPTIONS = Object.freeze({
  pack: "mixed",
  difficulty: "medium",
  mode: "twenty_questions",
  turnFormat: "trade",
  timer: 90,
  match: "first-to-3",
  hints: true,
  questions: "both",
});

/** Hints a guesser may reveal per turn (every name has exactly three, vague to strong). */
export const HINTS_PER_TURN = 3;
export const QUESTION_MAX_LENGTH = 140;
/** In-app questions per guesser: at most `limit` in any `windowMs` (as live). */
export const QUESTION_RATE_LIMIT = Object.freeze({ limit: 6, windowMs: 60_000 });

/** Time limits in milliseconds. Every step has one, so the match never waits on a phone that went quiet. */
export const TIMERS = Object.freeze({
  setup: 120_000, // the host's choices; then the match begins by itself with them as they stand
  relaxedTurn: 300_000, // the backstop of a turn with "no timer"
  selfConfirm: 30_000, // a guess unanswered this long may be confirmed by the guesser
  confirmLapse: 120_000, // a guess unanswered this long lapses, as if rejected
  reveal: 90_000, // the round's reveal; then the next round (or the end) by itself
});

const NOTES_KEPT = 12;
/** Trade turns: this many timed-out moves in a row with nobody touching the game ends the round. */
const IDLE_MOVES = 4;
const MAX_RAW_QUESTION = QUESTION_MAX_LENGTH * 4;
/** Control and format characters (bidi overrides, zero-width), as the live game strips them. */
const CONTROL_CHARS = new RegExp("[\\x00-\\x1f\\x7f-\\x9f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]", "g");

// ---------------------------------------------------------------------------------------------
// Refusals

const MESSAGES = {
  bad_seats: "Who Am I? needs 2 to 8 different seats.",
  bad_option: "That option is not one the game knows.",
  bad_host: "The host must be one of the seats.",
  bad_move: "That move is not one the game knows.",
  not_system: "Only the room can send that.",
  over: "The match is over.",
  not_now: "That cannot be done at this point.",
  not_host: "Only the host can do that.",
  not_playing: "Only the two players can do that.",
  not_your_turn: "It is not your turn.",
  not_guesser: "Only the player who is guessing can do that.",
  not_judge: "The other player judges this guess.",
  bad_pick: "Pick two different people from the table.",
  spoken_only: "This match asks questions out loud.",
  ask_mode_only: "The question counter is for Ask matches.",
  not_trade: "This match does not trade turns.",
  one_question: "One question per move.",
  question_waiting: "Wait for the answer first.",
  not_text: "A question must be text.",
  too_long: `Questions are at most ${QUESTION_MAX_LENGTH} characters.`,
  empty: "Type a question.",
  rate_limited: "Slow down a little before the next question.",
  no_question: "That question is not part of this turn.",
  answered: "That question was already answered.",
  bad_answer: "Answer yes, no, sort of or don't know.",
  hints_off: "Hints are turned off in this match.",
  no_hints_left: "No more hints this turn.",
  confirming: "A guess is waiting for confirmation.",
  no_guess: "There is no guess to judge.",
  too_soon: "The other player can still answer.",
  already_in_game: "That seat is in the game already.",
  left: "That seat left the match.",
  full: "The table is full.",
};

const refuse = (code) => ({ refused: code, message: MESSAGES[code] ?? "That cannot be done now." });

export function isRefusal(x) {
  return !!x && typeof x === "object" && typeof x.refused === "string";
}

// ---------------------------------------------------------------------------------------------
// Seeded randomness, kept in the state

/** Mixes any seed into a 32-bit number (FNV-1a with a final mix, as the kit's rng.js and Paper Masks). */
export function hashSeed(value) {
  const text = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

function rand(state) {
  const a = (state.rng + 0x6d2b79f5) | 0;
  state.rng = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * An id for a turn log entry (a question or a hint): a hash of the match's id key (derived from
 * the seed apart from the generator, as Paper Masks' card ids), and a running count. It never
 * touches `state.rng`, so ids say nothing about the generator's draws (the names), and the count
 * is the same whoever is dealt what.
 */
function entryId(state) {
  state.idSeq += 1;
  const [a, b] = state.idKey;
  const base = `${a}:${b}:${state.idSeq}`;
  return hashSeed(`${base}:hi`).toString(36).padStart(7, "0") + hashSeed(`${base}:lo`).toString(36).padStart(7, "0");
}

// ---------------------------------------------------------------------------------------------
// Options

const OPTION_CHOICES = {
  pack: PACK_IDS,
  difficulty: DIFFICULTIES,
  mode: MODES,
  turnFormat: TURN_FORMATS,
  timer: TIMER_CHOICES,
  match: MATCH_CHOICES,
  hints: [true, false],
  questions: QUESTION_MODES,
};

/** The host's choices as a page lists them (no names, only the packs' titles). */
export const CHOICES = Object.freeze({ ...OPTION_CHOICES, packs: PACKS });

/** Checks and fills in options; returns the clean options or a refusal. `host` is not an option here. */
export function cleanOptions(options = {}, base = DEFAULT_OPTIONS) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return refuse("bad_option");
  const out = { ...base };
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(OPTION_CHOICES, key) || !OPTION_CHOICES[key].includes(value)) return refuse("bad_option");
    out[key] = value;
  }
  return out;
}

/** Trade turns are for Ask matches only, as live: Clues always keeps going. */
const isTrade = (state) => state.options.turnFormat === "trade" && state.options.mode === "twenty_questions";

function matchRule(match) {
  const [kind, n] = match.split(/-to-|-/);
  return kind === "first" ? { points: Number(n) } : { rounds: Number(n) };
}

// ---------------------------------------------------------------------------------------------
// Create

const validSeats = (seats) =>
  Array.isArray(seats) &&
  seats.length >= MIN_PLAYERS &&
  seats.length <= MAX_PLAYERS &&
  seats.every((s) => Number.isInteger(s) && s >= 0) &&
  new Set(seats).size === seats.length;

/**
 * Starts at the setup step. `seats` are the seat numbers dealt in (2 to 8); `options` may name the
 * `host` (one of them) and any of the host's choices to start from. `seed` must be secret (the
 * room's fresh secure seed for this match), since the names come from it.
 */
export function create(seats, options = {}, seed = 0, now = 0) {
  if (!validSeats(seats)) return refuse("bad_seats");
  if (!options || typeof options !== "object" || Array.isArray(options)) return refuse("bad_option");
  const { host: wanted, ...picked } = options;
  const clean = cleanOptions(picked);
  if (isRefusal(clean)) return clean;
  const pool = [...seats].sort((a, b) => a - b);
  const host = wanted ?? pool[0];
  if (!pool.includes(host)) return refuse("bad_host");
  const state = {
    game: GAME_ID,
    v: 1,
    rng: hashSeed(`who-am-i/draws/${seed}`) || 1,
    idKey: [hashSeed(`who-am-i/entry-ids/a/${seed}`), hashSeed(`who-am-i/entry-ids/b/${seed}`)],
    idSeq: 0,
    now,
    options: clean,
    host,
    phase: "setup",
    until: now + TIMERS.setup,
    pool,
    pick: null,
    players: [],
    watchers: [],
    starter: null,
    usedIds: [],
    round: null,
    turn: null,
    summary: null,
    sends: {},
    notes: [],
    noteSeq: 0,
    ended: null,
  };
  state.pick = defaultPick(state);
  return state;
}

/** The two who play unless the host picks others: the host and the next seat round the table, or the first two. */
function defaultPick(state) {
  const pool = state.pool;
  const i = pool.indexOf(state.host);
  if (i === -1) return pool.slice(0, 2);
  return [state.host, pool[(i + 1) % pool.length]].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Small readers

const playerOf = (state, seat) => state.players.find((p) => p.seat === seat) ?? null;
const isPlayer = (state, seat) => {
  const p = playerOf(state, seat);
  return !!p && !p.left;
};
const opponentOf = (state, seat) => state.players.find((p) => p.seat !== seat) ?? null;
const key = (seat) => String(seat);

function note(state, k, extra = {}) {
  state.noteSeq += 1;
  state.notes.push({ n: state.noteSeq, round: state.round?.n ?? state.summary?.n ?? 0, k, ...extra });
  if (state.notes.length > NOTES_KEPT) state.notes.splice(0, state.notes.length - NOTES_KEPT);
}

const turnMs = (state) => (state.options.timer > 0 ? state.options.timer * 1000 : TIMERS.relaxedTurn);

// ---------------------------------------------------------------------------------------------
// The match

function begin(state, now, how) {
  const [a, b] = state.pick;
  state.players = [a, b].map((seat) => ({ seat, score: 0, correct: 0, skips: 0, hintsUsed: 0, left: false }));
  state.watchers = [...state.watchers, ...state.pool.filter((s) => s !== a && s !== b)].sort((x, y) => x - y);
  state.pool = [];
  state.pick = null;
  state.starter = rand(state) < 0.5 ? a : b;
  note(state, "began", { how });
  startRound(state, now);
}

/** First guesser of a round: the match's starter in odd rounds, the other player in even rounds (as live). */
function firstGuesser(state, n) {
  return n % 2 === 1 ? state.starter : opponentOf(state, state.starter).seat;
}

function startRound(state, now) {
  const n = (state.summary?.n ?? 0) + 1;
  const first = firstGuesser(state, n);
  const second = opponentOf(state, first).seat;
  const { pair, reshuffled } = drawPair({ packId: state.options.pack, difficulty: state.options.difficulty, usedIds: state.usedIds, random: () => rand(state) });
  if (reshuffled) state.usedIds = [];
  state.usedIds.push(...pair);
  state.round = {
    n,
    order: [first, second],
    assign: { [key(first)]: pair[0], [key(second)]: pair[1] },
    results: {},
    hints: {},
    tracks: {},
    reshuffled,
  };
  state.summary = null;
  state.phase = "playing";
  state.until = null;
  if (reshuffled) note(state, "reshuffled");
  beginTurn(state, first, now);
}

function beginTurn(state, seat, now) {
  const track = state.round.tracks[key(seat)];
  state.turn = {
    seat,
    phase: "asking",
    deadline: now + turnMs(state),
    paused: null,
    questionCount: track?.questionCount ?? 0,
    hintsUsed: track?.hintsUsed ?? 0,
    log: track ? track.log.map((e) => ({ ...e })) : [],
    moveAsked: false,
    confirmSince: null,
  };
}

function saveTrack(state) {
  const t = state.turn;
  state.round.tracks[key(t.seat)] = { log: t.log.map((e) => ({ ...e })), questionCount: t.questionCount, hintsUsed: t.hintsUsed };
}

const pendingQuestion = (turn) => turn.log.some((e) => e.kind === "question" && e.answer === null);

/** Trade turns: this move is over; the other player moves next, unless they are out of the round. */
function endMove(state, now) {
  const t = state.turn;
  const r = state.round;
  saveTrack(state);
  const other = r.order.find((s) => s !== t.seat);
  state.turn = null;
  beginTurn(state, r.results[key(other)] ? t.seat : other, now);
}

/** A player is done with this round (correct, skipped or timed out): the other's turn, or the reveal. */
function afterTurn(state, now) {
  const r = state.round;
  const remaining = r.order.find((s) => !r.results[key(s)]);
  // Trade turns: the first right guess wins the round. Keep going: both players have their turn.
  const roundWon = isTrade(state) && Object.values(r.results).includes("correct");
  if (remaining !== undefined && !roundWon) return beginTurn(state, remaining, now);
  return completeRound(state, now);
}

function finishTurn(state, result, now) {
  const t = state.turn;
  saveTrack(state);
  state.round.results[key(t.seat)] = result;
  if (result !== "correct") playerOf(state, t.seat).skips += 1;
  state.turn = null;
  afterTurn(state, now);
}

function scoreCorrect(state, now, how) {
  const p = playerOf(state, state.turn.seat);
  p.score += 1;
  p.correct += 1;
  if (how) note(state, how, { seat: p.seat });
  finishTurn(state, "correct", now);
}

/** The round summary: both names, each player's result, hints and questions. */
function summaryOf(state, decided) {
  const r = state.round;
  const anyCorrect = Object.values(r.results).includes("correct");
  return {
    n: r.n,
    entries: r.order.map((seat) => ({
      seat,
      id: r.assign[key(seat)],
      result: r.results[key(seat)] ?? (decided ? (anyCorrect ? "beaten" : "skipped") : "unfinished"),
      hints: r.hints[key(seat)] ?? 0,
      questions: r.tracks[key(seat)]?.questionCount ?? 0,
    })),
    matchOver: false,
  };
}

function matchDecided(state) {
  const rule = matchRule(state.options.match);
  if (rule.points) return Math.max(...state.players.map((p) => p.score)) >= rule.points;
  return state.summary.n >= rule.rounds;
}

function completeRound(state, now) {
  const idle = !state.round.acted;
  state.summary = summaryOf(state, true);
  state.round = null;
  // A whole round in which neither player touched the game: nobody is there; end with no points.
  if (idle) return endMatch(state, "idle");
  state.turn = null;
  state.summary.matchOver = matchDecided(state);
  state.phase = "reveal";
  state.until = now + TIMERS.reveal;
}

function endMatch(state, how, by = null) {
  if (state.round) {
    // A match that ends mid-round shows that round's names: nobody is guessing any more.
    state.summary = summaryOf(state, false);
    state.round = null;
  }
  state.turn = null;
  state.phase = "over";
  state.until = null;
  state.ended = { how, by };
  note(state, "ended", { how, ...(by === null ? {} : { seat: by }) });
}

// ---------------------------------------------------------------------------------------------
// Moves

/**
 * Applies one move from one seat at time `now` (the room's clock; defaults to the last time the
 * game saw). Returns a new state, or a refusal. The given state is never changed.
 */
export function apply(prev, seat, move, now = prev.now) {
  if (!move || typeof move !== "object" || typeof move.t !== "string") return refuse("bad_move");
  const state = JSON.parse(JSON.stringify(prev));
  state.now = Math.max(state.now, Number.isFinite(now) ? now : state.now);
  now = state.now;
  const table = seat === SYSTEM ? SYSTEM_MOVES : MOVES;
  const handler = Object.hasOwn(table, move.t) ? table[move.t] : null;
  if (!handler) return refuse(seat !== SYSTEM && Object.hasOwn(SYSTEM_MOVES, move.t) ? "not_system" : "bad_move");
  if (state.phase === "over" && move.t !== "tick") return refuse("over");
  const out = handler(state, seat, move, now);
  return isRefusal(out) ? out : state;
}

/** The checks every move of a turn shares: there is a turn, and the seat is one of the two players. */
function inTurn(state, seat) {
  if (state.phase !== "playing") return refuse("not_now");
  if (!isPlayer(state, seat)) return refuse("not_playing");
  // Somebody is playing this round (a refused move leaves no trace: apply drops the copy).
  state.round.acted = true;
  state.round.idleMoves = 0;
  return null;
}

function tidyQuestion(text) {
  if (typeof text !== "string") return { error: "not_text" };
  if (text.length > MAX_RAW_QUESTION) return { error: "too_long" };
  // As live, but whitespace first: a tab or a line break becomes a space instead of joining two words.
  const clean = text
    .replace(/\s+/g, " ")
    .replace(CONTROL_CHARS, "")
    .trim();
  if (!clean.length) return { error: "empty" };
  if ([...clean].length > QUESTION_MAX_LENGTH) return { error: "too_long" };
  return { text: clean };
}

const MOVES = {
  /** The host changes the match's choices before it begins. */
  choose(state, seat, move) {
    if (state.phase !== "setup") return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    const { t, ...choices } = move;
    const clean = cleanOptions(choices, state.options);
    if (isRefusal(clean)) return clean;
    state.options = clean;
  },

  /** The host picks the two who play (a table of more than two); everyone else watches. */
  pick(state, seat, move) {
    if (state.phase !== "setup") return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    const seats = move.seats;
    if (!Array.isArray(seats) || seats.length !== PLAYERS_PER_MATCH || seats[0] === seats[1] || !seats.every((s) => state.pool.includes(s))) return refuse("bad_pick");
    state.pick = [...seats].sort((a, b) => a - b);
  },

  /** The host begins the match with the choices and the two players as they stand. */
  begin(state, seat, move, now) {
    if (state.phase !== "setup") return refuse("not_now");
    if (seat !== state.host) return refuse("not_host");
    begin(state, now, "host");
  },

  /** The guesser types a yes/no question; the other player answers it on their phone. */
  ask(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (state.options.questions === "spoken") return refuse("spoken_only");
    if (t.seat !== seat) return refuse("not_guesser");
    if (t.phase !== "asking") return refuse("confirming");
    if (pendingQuestion(t)) return refuse("question_waiting");
    if (isTrade(state) && t.moveAsked) return refuse("one_question");
    const tidy = tidyQuestion(move.text);
    if (tidy.error) return refuse(tidy.error);
    const recent = (state.sends[key(seat)] ?? []).filter((at) => now - at < QUESTION_RATE_LIMIT.windowMs);
    if (recent.length >= QUESTION_RATE_LIMIT.limit) return refuse("rate_limited");
    state.sends[key(seat)] = [...recent, now];
    t.log.push({ id: entryId(state), kind: "question", text: tidy.text, answer: null, at: now });
    t.questionCount = Math.min(t.questionCount + 1, 99);
    t.moveAsked = true;
  },

  /** The other player answers a typed question. */
  answer(state, seat, move) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (t.seat === seat) return refuse("not_judge");
    const entry = t.log.find((e) => e.kind === "question" && e.id === move.id);
    if (!entry) return refuse("no_question");
    if (entry.answer !== null) return refuse("answered");
    if (!ANSWERS.includes(move.answer)) return refuse("bad_answer");
    entry.answer = move.answer;
  },

  /** A question asked out loud: one more on the counter (Ask matches). Either player may tap it. */
  count(state, seat) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (state.options.mode !== "twenty_questions") return refuse("ask_mode_only");
    if (t.phase !== "asking") return refuse("confirming");
    if (isTrade(state) && t.moveAsked) return refuse("one_question");
    t.questionCount = Math.min(t.questionCount + 1, 99);
    t.moveAsked = true;
  },

  /** The guesser reveals the next hint about their own name (free, up to three a turn). */
  hint(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (!state.options.hints) return refuse("hints_off");
    if (t.seat !== seat) return refuse("not_guesser");
    if (t.phase !== "asking") return refuse("confirming");
    if (t.hintsUsed >= HINTS_PER_TURN) return refuse("no_hints_left");
    const identity = getIdentity(state.round.assign[key(seat)]);
    const index = t.hintsUsed;
    t.hintsUsed += 1;
    t.log.push({ id: entryId(state), kind: "hint", index: index + 1, text: identity.hints[index], at: now });
    state.round.hints[key(seat)] = (state.round.hints[key(seat)] ?? 0) + 1;
    playerOf(state, seat).hintsUsed += 1;
  },

  /** "I guessed it": the guesser said a name out loud; the other player confirms or rejects it. */
  guess(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (t.seat !== seat) return refuse("not_your_turn");
    if (t.phase !== "asking") return refuse("confirming");
    if (isTrade(state) && pendingQuestion(t)) return refuse("question_waiting");
    t.phase = "confirming";
    t.paused = Math.max(0, t.deadline - now);
    t.deadline = null;
    t.confirmSince = now;
  },

  confirm(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (t.seat === seat) return refuse("not_judge");
    if (t.phase !== "confirming") return refuse("no_guess");
    scoreCorrect(state, now, null);
  },

  reject(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (t.seat === seat) return refuse("not_judge");
    if (t.phase !== "confirming") return refuse("no_guess");
    rejectGuess(state, now);
  },

  /**
   * The guesser confirms their own guess when the other player has not answered it for
   * TIMERS.selfConfirm (their phone died or locked; they are at the same table and can say so).
   */
  selfConfirm(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (t.seat !== seat) return refuse("not_guesser");
    if (t.phase !== "confirming") return refuse("no_guess");
    if (now < t.confirmSince + TIMERS.selfConfirm) return refuse("too_soon");
    scoreCorrect(state, now, "self_confirmed");
  },

  /** The guesser gives up on this round. */
  skip(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    if (state.turn.seat !== seat) return refuse("not_your_turn");
    finishTurn(state, "skipped", now);
  },

  /** Trade turns: the guesser ends this move without guessing. */
  pass(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (!isTrade(state)) return refuse("not_trade");
    if (t.seat !== seat) return refuse("not_your_turn");
    if (t.phase !== "asking") return refuse("confirming");
    if (pendingQuestion(t)) return refuse("question_waiting");
    endMove(state, now);
  },

  /** After the reveal: the next round, or, when the match is decided, the end. Either player or the host. */
  next(state, seat, move, now) {
    if (state.phase !== "reveal") return refuse("not_now");
    if (!isPlayer(state, seat) && seat !== state.host) return refuse("not_playing");
    nextAfterReveal(state, now);
  },
};

function rejectGuess(state, now) {
  const t = state.turn;
  t.phase = "asking";
  t.deadline = now + (t.paused ?? turnMs(state));
  t.paused = null;
  t.confirmSince = null;
  // In trade turns a wrong guess uses up the move (as live).
  if (isTrade(state)) endMove(state, now);
}

function nextAfterReveal(state, now) {
  if (state.summary.matchOver) return endMatch(state, "decided");
  startRound(state, now);
}

const SYSTEM_MOVES = {
  /** The room's clock. Harmless before the deadline; at it, the step acts as its own tap would. */
  tick(state, seat, move, now) {
    const due = nextDeadline(state);
    if (due === null || now < due) return;
    if (state.phase === "setup") return begin(state, now, "time");
    if (state.phase === "reveal") return nextAfterReveal(state, now);
    const t = state.turn;
    if (t.phase === "confirming") {
      note(state, "guess_lapsed", { seat: t.seat });
      return rejectGuess(state, now);
    }
    note(state, "timed_out", { seat: t.seat });
    if (!isTrade(state)) return finishTurn(state, "timed_out", now);
    // Trade turns: running out of time costs only this move (as live), unless nobody has touched
    // the game for two moves each: then the round is over for both, so an idle table ends.
    const r = state.round;
    r.idleMoves = (r.idleMoves ?? 0) + 1;
    if (r.idleMoves < IDLE_MOVES) return endMove(state, now);
    saveTrack(state);
    for (const s of r.order) r.results[key(s)] ??= "timed_out";
    for (const s of r.order) if (r.results[key(s)] === "timed_out") playerOf(state, s).skips += 1;
    state.turn = null;
    return completeRound(state, now);
  },

  /**
   * Someone in the party who is not in the match is here. Before it begins they join the table and
   * may be picked; once it has begun they watch, and see no secret name.
   */
  join(state, seat, move) {
    const s = move.seat;
    if (!Number.isInteger(s) || s < 0) return refuse("bad_move");
    const p = playerOf(state, s);
    if (p) return refuse(p.left ? "left" : "already_in_game");
    if (state.pool.includes(s) || state.watchers.includes(s)) return refuse("already_in_game");
    if (state.phase === "setup") {
      if (state.pool.length >= MAX_PLAYERS) return refuse("full");
      state.pool = [...state.pool, s].sort((a, b) => a - b);
      return;
    }
    state.watchers = [...state.watchers, s].sort((a, b) => a - b);
    note(state, "watching", { seat: s });
  },

  /**
   * A seat is gone for good. A watcher just goes. Before the match, the table goes on without it
   * (and ends, with no points, below two). One of the two players: a match already decided ends
   * with its real places; otherwise the player who left forfeits and the one who stayed is first.
   */
  leave(state, seat, move) {
    const s = move.seat;
    if (state.watchers.includes(s)) {
      state.watchers = state.watchers.filter((w) => w !== s);
      if (state.host === s) passHost(state);
      return;
    }
    if (state.phase === "setup") {
      if (!state.pool.includes(s)) return refuse("not_playing");
      state.pool = state.pool.filter((x) => x !== s);
      if (state.host === s) passHost(state);
      if (state.pool.length < PLAYERS_PER_MATCH) return endMatch(state, "too_few");
      if (state.pick.includes(s)) state.pick = defaultPick(state);
      return;
    }
    const p = playerOf(state, s);
    if (!p) return refuse("not_playing");
    if (p.left) return refuse("left");
    p.left = true;
    note(state, "left", { seat: s });
    if (state.phase === "reveal" && state.summary.matchOver) return endMatch(state, "decided");
    endMatch(state, "forfeit", s);
  },

  /** The room's host (picker) moved to another seat. */
  host(state, seat, move) {
    const s = move.seat;
    if (!(isPlayer(state, s) || state.pool.includes(s) || state.watchers.includes(s))) return refuse("bad_host");
    state.host = s;
  },
};

function passHost(state) {
  const next = state.phase === "setup" ? state.pool[0] : (state.players.find((p) => !p.left)?.seat ?? state.watchers[0]);
  if (next === undefined) return;
  state.host = next;
  note(state, "host_passed", { to: next });
}

// ---------------------------------------------------------------------------------------------
// Time

/** When the room must next send `{ t: "tick" }` as SYSTEM, or null. Moves on after every tick that acts. */
export function nextDeadline(state) {
  if (state.phase === "over") return null;
  if (state.phase === "setup" || state.phase === "reveal") return state.until;
  const t = state.turn;
  return t.phase === "confirming" ? t.confirmSince + TIMERS.confirmLapse : t.deadline;
}

// ---------------------------------------------------------------------------------------------
// Views

function roleOf(state, seat) {
  if (state.phase === "setup") return state.pool.includes(seat) ? "player" : "screen";
  if (isPlayer(state, seat)) return "player";
  if (state.watchers.includes(seat) || playerOf(state, seat)) return "watcher";
  return "screen";
}

/**
 * What one seat may see. Everyone sees the scores, whose turn it is, the turn's questions, answers
 * and hints, the timers, and each round's names once the round is over.
 * A player also sees the name the OTHER player is guessing (`opponent`), and nothing else: never
 * their own before their round's reveal. A watcher and a big screen (-1) see neither name during a
 * round: a watcher's phone lies on the same table, and may be a player's second phone.
 */
export function view(state, seat) {
  const role = roleOf(state, seat);
  const out = {
    game: GAME_ID,
    phase: state.phase,
    round: state.round?.n ?? state.summary?.n ?? 0,
    options: { ...state.options },
    match: matchRule(state.options.match),
    trade: isTrade(state),
    host: state.host,
    until: state.until,
    you: { seat: Number.isInteger(seat) ? seat : null, role, host: role !== "screen" && state.host === seat },
    players: state.players.map((p) => ({ ...p })),
    watchers: [...state.watchers],
    notes: state.notes.map((n) => ({ ...n })),
  };

  if (state.phase === "setup") {
    out.setup = { pool: [...state.pool], pick: [...state.pick], choices: CHOICES, timers: { setup: TIMERS.setup } };
  }

  if (state.phase === "playing") {
    const r = state.round;
    const t = state.turn;
    out.order = [...r.order];
    out.results = { ...r.results };
    out.turn = {
      seat: t.seat,
      phase: t.phase,
      deadline: t.deadline,
      paused: t.paused,
      timed: state.options.timer > 0,
      questionCount: t.questionCount,
      hintsUsed: t.hintsUsed,
      hintsLeft: state.options.hints ? HINTS_PER_TURN - t.hintsUsed : 0,
      log: t.log.map((e) => ({ ...e })),
      moveAsked: t.moveAsked,
      questionWaiting: pendingQuestion(t),
      confirmSince: t.confirmSince,
      selfConfirmAt: t.confirmSince === null ? null : t.confirmSince + TIMERS.selfConfirm,
      lapseAt: t.confirmSince === null ? null : t.confirmSince + TIMERS.confirmLapse,
    };
    if (role === "player") {
      // Only the other player's name: r.assign for this seat is never read here.
      const other = r.order.find((s) => s !== seat);
      out.opponent = { seat: other, ...publicIdentity(r.assign[key(other)]) };
    }
  }

  if (state.summary && state.phase !== "playing") {
    const s = state.summary;
    out.reveal = {
      round: s.n,
      matchOver: s.matchOver,
      entries: s.entries.map(({ id, ...e }) => ({ ...e, ...publicIdentity(id) })),
    };
  }

  if (state.phase === "over") out.result = result(state);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The end

export function done(state) {
  return state.phase === "over";
}

/**
 * The final rows, best first: seat, score, correct, skips, hints, place, left. A player who forfeits
 * (left a match not yet decided) has no place, and the one who stayed is first whatever the score.
 * Ties share a place. A match that ended before it began has no rows. Readable mid-match.
 */
export function result(state) {
  const forfeit = state.ended?.how === "forfeit";
  const rows = [...state.players]
    .sort((a, b) => b.score - a.score || a.seat - b.seat)
    .map((p) => ({ seat: p.seat, score: p.score, correct: p.correct, skips: p.skips, hints: p.hintsUsed, left: p.left, place: null, ...(forfeit && p.left ? { forfeit: true } : {}) }));
  if (forfeit) {
    for (const row of rows) if (!row.left) row.place = 1;
    rows.sort((a, b) => (a.place === null) - (b.place === null));
    return rows;
  }
  // A table that went idle places nobody.
  if (state.ended?.how === "idle") return rows;
  let place = 0;
  let last = null;
  rows.forEach((row, i) => {
    if (row.score !== last) place = i + 1;
    last = row.score;
    row.place = place;
  });
  return rows;
}

/** Places for the party's Tonight board: place 1 is best, ties share; a forfeit has none. */
export function standings(state) {
  if (state.phase !== "over") return [];
  return result(state)
    .filter((r) => r.place !== null)
    .map((r) => ({ seat: r.seat, place: r.place }));
}
