// Who Am I? at the Table: the pure rules (README.md says what was decided and why, and every
// difference from the live game at whoami.n8builds.dev).
//
// Each of two players is dealt a secret name. Your phone shows the name the OTHER player is
// guessing, never your own; you ask yes/no questions (or listen to clues) and guess who you are,
// and the other player confirms the guess.
//
// Everything here is a pure function of plain JSON: no clock, no platform APIs, no hidden
// randomness. Every draw (the names, who starts) comes from the match's secret (`state.secret`,
// at least 128 bits the Table's adapter takes from the platform's secure source) through
// the kit's draws (n8-party-games/table/draws), at a position kept in the state (`state.draws`). The room's `seed` is not used: a page
// may learn it. The state is server only: a page gets `view(state, seat)` and nothing else.
//
//   create(seats, options, seed, now, { secret })  -> state | refusal
//   apply(state, seat, move, now)      -> new state | refusal     (never changes `state`)
//   view(state, seat)                  -> what that seat may see (seat -1: a big screen)
//   nextDeadline(state)                -> when the room must send { t: "tick" } as SYSTEM, or null
//   done(state), result(state), standings(state)
//
// A refusal is `{ refused: code, message }`; `isRefusal(x)` tells them apart.
//
// The room's SYSTEM moves include `{ t: "presence", seat, connected, away }` (HEARS_PRESENCE): a
// seat is here while its phone is connected and its page is shown. Who is here decides when a
// table is idle, when a guesser may confirm their own guess, and whether a leave can be a forfeit.

import { DIFFICULTIES, PACK_IDS, PACKS, drawPair, getIdentity, publicIdentity } from "./deck.js";
import { drawsFor, freshSecret, isSecret } from "n8-party-games/table/draws";

const draw = drawsFor("who-am-i");

export const GAME_ID = "who-am-i";
/** Seats the module takes: two play, the rest watch. The Table's wall decides what a party may start. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
/** Players in a match. */
export const PLAYERS_PER_MATCH = 2;
/** The seat id the room sends its own moves as: tick, join, leave, host, presence. */
export const SYSTEM = "system";
/** These rules take `{ t: "presence", seat, connected, away }` from SYSTEM (table-game.js). */
export const HEARS_PRESENCE = true;

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
  selfConfirm: 30_000, // a guess unanswered this long, the other phone gone, may be confirmed by the guesser
  confirmLapse: 120_000, // a guess unanswered this long lapses, as if rejected
  reveal: 90_000, // the round's reveal; then the next round (or the end) by itself
});

const NOTES_KEPT = 12;
/** A turn's log (questions and hints) keeps only its latest entries, in the state and in views. */
export const LOG_KEPT = 50;
/** Trade turns: this many timed-out moves in a row with no player here ends the round. */
const IDLE_MOVES = 4;
const MAX_RAW_QUESTION = QUESTION_MAX_LENGTH * 4;
/**
 * Invisible characters a question may not carry: controls, the soft hyphen, the Arabic letter mark,
 * zero-width and bidi marks, invisible operators (U+2060 to U+2064), bidi isolates and tag
 * characters. U+200D (zero-width joiner) is taken out apart from inside an emoji sequence.
 */
// (Written as strings: a bundler that prints U+2028 into a regular expression literal breaks it.)
const CONTROL_CHARS = new RegExp("[\\x00-\\x1f\\x7f-\\x9f\\u00ad\\u061c\\u200b\\u200c\\u200e\\u200f\\u2028-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\u{e0000}-\\u{e007f}]", "gu");
const STRAY_JOINER = new RegExp("(?<![\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\ufe0f])\\u200d|\\u200d(?!\\p{Extended_Pictographic})", "gu");
/** Combining marks kept on one character; more is "zalgo" text that spills over other lines. */
const MARKS_PER_CHAR = 3;
const MARK_PILES = new RegExp(`(\\p{M}{${MARKS_PER_CHAR}})\\p{M}+`, "gu");

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
  judge_here: "The other player's phone is here: they confirm it.",
  bad_secret: "The match needs a secret of at least 128 bits.",
  already_in_game: "That seat is in the game already.",
  full: "The table is full.",
};

const refuse = (code) => ({ refused: code, message: MESSAGES[code] ?? "That cannot be done now." });

export function isRefusal(x) {
  return !!x && typeof x === "object" && typeof x.refused === "string";
}

// ---------------------------------------------------------------------------------------------
// Randomness from the match's secret, its position kept in the state

/** The next draw from the match's secret (draws.js), in [0, 1). */
function rand(state) {
  const n = state.draws;
  state.draws += 1;
  return draw(state.secret, n);
}

/**
 * An id for a turn log entry: "q" for a question or "h" for a hint, and a running count. Nothing
 * secret goes into it, and the count is the same whoever is dealt what.
 */
function entryId(state, kind) {
  state.idSeq += 1;
  return `${kind === "question" ? "q" : "h"}${state.idSeq}`;
}

/** Adds an entry to the turn's log, keeping only the latest LOG_KEPT. */
function logEntry(state, entry) {
  const log = state.turn.log;
  log.push({ id: entryId(state, entry.kind), ...entry });
  if (log.length > LOG_KEPT) log.splice(0, log.length - LOG_KEPT);
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
 * `host` (one of them) and any of the host's choices to start from. `seed` (the room's) is not
 * used. `secret` is the match's own (at least 128 bits, as hex): every draw comes from it, so it
 * must never reach a page. Left out, a fresh one is taken from the platform's secure source.
 */
export function create(seats, options = {}, seed = 0, now = 0, { secret = freshSecret() } = {}) {
  if (!validSeats(seats)) return refuse("bad_seats");
  if (!options || typeof options !== "object" || Array.isArray(options)) return refuse("bad_option");
  if (!isSecret(secret)) return refuse("bad_secret");
  const { host: wanted, ...picked } = options;
  const clean = cleanOptions(picked);
  if (isRefusal(clean)) return clean;
  const pool = [...seats].sort((a, b) => a - b);
  const host = wanted ?? pool[0];
  if (!pool.includes(host)) return refuse("bad_host");
  const state = {
    game: GAME_ID,
    v: 2,
    secret,
    draws: 0,
    idSeq: 0,
    now,
    // Who is here (connected, page shown), as the room last said; everyone is, until it says not.
    here: Object.fromEntries(pool.map((s) => [key(s), true])),
    goneSince: {},
    // Seats whose phone is not connected at all (a hidden page is still connected).
    unlinked: {},
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
/** Whether a seat is here: connected and its page shown (a seat the room never spoke of is). */
const isHere = (state, seat) => state.here[key(seat)] !== false;
/** Whether a seat's phone is connected at all, its page shown or hidden (a seat the room never spoke of is). */
const isLinked = (state, seat) => state.unlinked?.[key(seat)] !== true;
const anyPlayerHere = (state) => state.players.some((p) => !p.left && isHere(state, p.seat));

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
    // Whether a player has been here at any time in this round (an idle round has nobody).
    seen: anyPlayerHere(state),
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
  const idle = !state.round.seen;
  state.summary = summaryOf(state, true);
  state.round = null;
  // A whole round with no player here at any time: nobody is playing; end with no points.
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
  return null;
}

/** A question as it is kept and shown, or { error }. Exported for the tests. */
export function tidyQuestion(text) {
  if (typeof text !== "string") return { error: "not_text" };
  if (text.length > MAX_RAW_QUESTION) return { error: "too_long" };
  // As live, but whitespace first: a tab or a line break becomes a space instead of joining two words.
  const clean = text
    .replace(/\s+/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(STRAY_JOINER, "")
    .replace(MARK_PILES, "$1")
    .replace(/ {2,}/g, " ")
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
    logEntry(state, { kind: "question", text: tidy.text, answer: null, at: now });
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

  /**
   * A question asked out loud: one more on the counter (Ask matches). Either player may tap it,
   * apart from in trade turns, where it uses up the guesser's one question: theirs alone.
   */
  count(state, seat) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (state.options.mode !== "twenty_questions") return refuse("ask_mode_only");
    if (isTrade(state) && t.seat !== seat) return refuse("not_guesser");
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
    logEntry(state, { kind: "hint", index: index + 1, text: identity.hints[index], at: now });
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
   * The guesser confirms their own guess when the other player's phone is not here (it died,
   * dropped or is locked; they are at the same table and can say so) and the guess has waited
   * TIMERS.selfConfirm with that phone gone, as live. A judge whose phone is here confirms or
   * rejects it; unanswered, it lapses as rejected.
   */
  selfConfirm(state, seat, move, now) {
    const no = inTurn(state, seat);
    if (no) return no;
    const t = state.turn;
    if (t.seat !== seat) return refuse("not_guesser");
    if (t.phase !== "confirming") return refuse("no_guess");
    const at = selfConfirmAt(state);
    if (at === null) return refuse("judge_here");
    if (now < at) return refuse("too_soon");
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

/** When the guesser may confirm the waiting guess themselves, or null while the judge's phone is here (or no guess waits). */
function selfConfirmAt(state) {
  const t = state.turn;
  if (!t || t.phase !== "confirming") return null;
  const judge = state.round.order.find((s) => s !== t.seat);
  if (isHere(state, judge)) return null;
  return Math.max(t.confirmSince, state.goneSince[key(judge)] ?? t.confirmSince) + TIMERS.selfConfirm;
}

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
    // Trade turns: running out of time costs only this move (as live): a spoken turn may well run
    // out with both players talking. Only when no player has been here for two moves each is the
    // round over for both, so a table nobody is at ends (completeRound: idle).
    const r = state.round;
    r.idleMoves = anyPlayerHere(state) ? 0 : (r.idleMoves ?? 0) + 1;
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
    // (A player who left has ended the match, so it is over before anyone could join again.)
    if (p) return refuse("already_in_game");
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
   * Who is here changed: `connected` (a phone is in the room) and `away` (its page is hidden). A
   * seat is here when connected and not away.
   */
  presence(state, seat, move, now) {
    const s = move.seat;
    if (!Number.isInteger(s) || s < 0) return refuse("bad_move");
    const here = move.connected === true && move.away !== true;
    // Connected at all (a hidden page included): what decides whether a leave is a forfeit.
    state.unlinked ??= {};
    if (move.connected === true) delete state.unlinked[key(s)];
    else state.unlinked[key(s)] = true;
    if (isHere(state, s) === here) return;
    state.here[key(s)] = here;
    if (here) {
      delete state.goneSince[key(s)];
      if (state.round && isPlayer(state, s)) {
        state.round.seen = true;
        state.round.idleMoves = 0;
      }
    } else state.goneSince[key(s)] = now;
  },

  /**
   * A seat is gone for good. A watcher just goes. Before the match, the table goes on without it
   * (and ends, with no points, below two). One of the two players: a match already decided ends
   * with its real places; otherwise the player who left forfeits and the one who stayed is first,
   * even with their page hidden for now (another app, a locked phone): the owner's rule, something
   * must make a leave a forfeit. Only when the one who stayed has no phone connected either is
   * nobody there to win it: it ends with no places.
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
    p.left = true;
    note(state, "left", { seat: s });
    if (state.phase === "reveal" && state.summary.matchOver) return endMatch(state, "decided");
    const stayer = state.players.find((x) => !x.left);
    if (!stayer || !isLinked(state, stayer.seat)) return endMatch(state, "abandoned", s);
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
      // When the guesser may confirm it themselves: null while the other phone is here.
      selfConfirmAt: selfConfirmAt(state),
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
 * True while the reveal of the round that decided the match is up: the match is over in all but
 * the tap to its end, and `standings` are already its final word. Through the Table's adapter the
 * room then scores it (once) even when the host taps the Table's own "End the game" there.
 */
export function decided(state) {
  return state.phase === "reveal" && state.summary?.matchOver === true;
}

/**
 * Whether the match is waiting on this seat right now. Through the Table's adapter the room then
 * runs that seat's grace while its page is hidden, and a player hidden for the whole of it
 * forfeits (`leave`). The match waits on:
 *   - the guesser whose turn it is, while they ask (not while their guess waits to be confirmed);
 *   - in trade turns, the other player while a question typed in the app waits for their
 *     answer: until they answer, the guesser can neither guess nor pass (`question_waiting`).
 *     In keep-going turns the guesser can still guess, give up, take hints and ask out loud, so
 *     a typed question waits on nobody (and the guesser cannot make the other player needed).
 * Nobody else: the player waiting answers spoken questions out loud, a guess they do not confirm
 * is covered by `selfConfirm` and `confirmLapse`, and the setup, the reveal and watchers wait on
 * nobody.
 */
export function needs(state, seat) {
  const t = state.turn;
  if (state.phase !== "playing" || t?.phase !== "asking") return false;
  const p = playerOf(state, seat);
  if (!p || p.left) return false;
  if (t.seat === seat) return true;
  return isTrade(state) && pendingQuestion(t) && state.round.order.includes(seat);
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
  // A table that went idle, or that everyone left, places nobody.
  if (state.ended?.how === "idle" || state.ended?.how === "abandoned") return rows;
  let place = 0;
  let last = null;
  rows.forEach((row, i) => {
    if (row.score !== last) place = i + 1;
    last = row.score;
    row.place = place;
  });
  return rows;
}

/**
 * Places for the party's Tonight board: place 1 is best, ties share; a forfeit has none. Given once
 * the match is over, and already on the reveal that decided it (`decided`).
 */
export function standings(state) {
  if (state.phase !== "over" && !decided(state)) return [];
  return result(state)
    .filter((r) => r.place !== null)
    .map((r) => ({ seat: r.seat, place: r.place }));
}
