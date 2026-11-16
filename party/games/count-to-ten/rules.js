// Count to ten: the pure rules of the Table's test game, in the shape every Table game keeps
// (party-kit/GAME-CONTRACT.md, "Games at the Table"; Paper Masks is the first real one):
//
//   create(seats, options, seed, now)  -> state | refusal
//   apply(state, seat, move, now)      -> new state | refusal     (never changes `state`)
//   view(state, seat)                  -> what that seat may see (seat -1: a big screen)
//   nextDeadline(state)                -> when the room must send { t: "tick" } as SYSTEM, or null
//   done(state), result(state), standings(state)
//
// A refusal is `{ refused: code, message }`. Everything is plain JSON with no clock and no hidden
// randomness: the room passes `now` and a secret seed. Only `view` output ever reaches a page.
//
// The game: the players take turns adding one or two to the count; whoever makes it ten wins. A
// turn not taken in TURN_MS passes on. Each player has a secret word only they are shown. The
// room's own moves come from SYSTEM: the clock (`tick`), a late joiner (`join`, a watcher), a seat
// gone for good (`leave`: the game goes on without it, and ends by itself when one is left) and a
// new host (`host`).

export const GAME_ID = "count-to-ten";
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const SYSTEM = "system";
export const TARGET = 10;
/** How long a turn waits before it passes to the next player. */
export const TURN_MS = 20_000;
/** How many of the last presses a view carries. */
const LOG_SIZE = 6;
const WORDS = ["owl", "fern", "kite", "plum", "moth", "reef", "wren", "lime", "dune", "pear"];
const MESSAGES = {
  bad_seats: "A game needs two to eight players.",
  bad_option: "That is not an option of this game.",
  bad_host: "The host must be one of the players.",
  bad_move: "That is not a move of this game.",
  not_system: "Only the room can do that.",
  over: "The game is over.",
  not_playing: "You are watching this game.",
  not_your_turn: "It is not your turn.",
  bad_add: "Add one or two.",
  already_in_game: "That seat is in the game already.",
};

export const refuse = (code) => ({ refused: code, message: MESSAGES[code] ?? "That cannot be done now." });
export const isRefusal = (x) => !!x && typeof x === "object" && typeof x.refused === "string";

/** mulberry32: the same seed, the same words. */
function generator(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Starts a game. `seats` are the players' seat numbers; `options` may name the `host` (one of them);
 * `seed` must be secret (the room's fresh secure seed for this match), since the words come from it.
 */
export function create(seats, options = {}, seed = 0, now = 0) {
  if (!Array.isArray(seats) || seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) return refuse("bad_seats");
  if (!seats.every((s) => Number.isInteger(s) && s >= 0) || new Set(seats).size !== seats.length) return refuse("bad_seats");
  if (!options || typeof options !== "object" || Object.keys(options).some((k) => k !== "host")) return refuse("bad_option");
  const order = [...seats].sort((a, b) => a - b);
  const host = options.host ?? order[0];
  if (!order.includes(host)) return refuse("bad_host");
  const next = generator(seed);
  const pool = [...WORDS];
  const secrets = {};
  for (const seat of order) secrets[seat] = pool.splice(Math.floor(next() * pool.length), 1)[0];
  return { game: GAME_ID, order, turn: 0, count: 0, deadline: now + TURN_MS, log: [], winner: null, ended: null, host, watchers: [], secrets };
}

/** The next player after the one whose turn it is. */
function passTurn(state, now) {
  state.turn = (state.turn + 1) % state.order.length;
  state.deadline = now + TURN_MS;
}

/** One player left: they win, and the game is over by itself. */
function lastOneWins(state) {
  if (state.order.length === 1 && state.winner === null) {
    state.winner = state.order[0];
    state.ended = "alone";
  }
}

const MOVES = {
  add(state, seat, move, now) {
    if (!state.order.includes(seat)) return refuse("not_playing");
    if (seat !== state.order[state.turn]) return refuse("not_your_turn");
    if (move.n !== 1 && move.n !== 2) return refuse("bad_add");
    state.count = Math.min(TARGET, state.count + move.n);
    state.log = [...state.log, { seat, add: move.n, count: state.count }].slice(-LOG_SIZE);
    if (state.count >= TARGET) state.winner = seat;
    else passTurn(state, now);
  },
};

const SYSTEM_MOVES = {
  /** The clock: a turn not taken in time passes on. Harmless before its deadline. */
  tick(state, seat, move, now) {
    if (state.winner !== null || now < state.deadline) return;
    state.log = [...state.log, { seat: state.order[state.turn], timedOut: true, count: state.count }].slice(-LOG_SIZE);
    passTurn(state, now);
  },
  /** A late joiner watches: they see the count, and no word. */
  join(state, seat, move) {
    if (!Number.isInteger(move.seat) || move.seat < 0) return refuse("bad_move");
    if (state.order.includes(move.seat) || state.watchers.includes(move.seat)) return refuse("already_in_game");
    state.watchers.push(move.seat);
  },
  /** A seat gone for good: the game goes on without it. */
  leave(state, seat, move, now) {
    state.watchers = state.watchers.filter((s) => s !== move.seat);
    const i = state.order.indexOf(move.seat);
    if (i === -1) return;
    const wasTurn = i === state.turn;
    state.order.splice(i, 1);
    delete state.secrets[move.seat];
    if (i < state.turn) state.turn -= 1;
    if (state.turn >= state.order.length) state.turn = 0;
    if (wasTurn) state.deadline = now + TURN_MS;
    lastOneWins(state);
  },
  host(state, seat, move) {
    if (state.order.includes(move.seat)) state.host = move.seat;
  },
};

export function apply(prev, seat, move, now = 0) {
  if (!move || typeof move !== "object" || typeof move.t !== "string") return refuse("bad_move");
  const state = JSON.parse(JSON.stringify(prev));
  const table = seat === SYSTEM ? SYSTEM_MOVES : MOVES;
  const handler = Object.hasOwn(table, move.t) ? table[move.t] : null;
  if (!handler) return refuse(seat !== SYSTEM && Object.hasOwn(SYSTEM_MOVES, move.t) ? "not_system" : "bad_move");
  if (state.winner !== null && move.t !== "tick") return refuse("over");
  const out = handler(state, seat, move, now);
  return isRefusal(out) ? out : state;
}

export const nextDeadline = (state) => (state.winner === null ? state.deadline : null);
export const done = (state) => state.winner !== null;

/**
 * What a seat may see. Everyone sees the count, whose turn it is and the last presses; a player
 * sees their own word, and nobody else's. A watcher, or a big screen (-1), sees no word.
 */
export function view(state, seat) {
  const role = state.order.includes(seat) ? "player" : state.watchers.includes(seat) ? "watcher" : "screen";
  return {
    target: TARGET,
    count: state.count,
    order: [...state.order],
    turn: state.order[state.turn],
    deadline: state.winner === null ? state.deadline : null,
    turnMs: TURN_MS,
    log: state.log.map((p) => ({ ...p })),
    winner: state.winner,
    ended: state.ended,
    host: state.host,
    you: { seat, role },
    ...(role === "player" ? { secret: state.secrets[seat] } : {}),
  };
}

export const result = (state) => ({ winnerSeat: state.winner, count: state.count, early: state.ended === "alone" });
export const standings = (state) => state.order.map((seat) => ({ seat, place: seat === state.winner ? 1 : 2 }));
