// Count to ten: a test game for the Table, and nothing more. It exists to prove the path a real
// Table game takes, end to end: the host picks it, the party plays it in turns on their own
// phones, and everyone is back at the Table with the result.
//
// The rules: the players take turns. On your turn you add one or two to the count. Whoever makes
// it ten wins. A turn not taken in TURN_MS passes to the next player, and a phone that drops has
// its turns skipped until it is back, so nobody's dropped phone holds the game up.
//
// It keeps the game contract (party-kit/GAME-CONTRACT.md) as a turn-based game (`tickHz: 0`):
// plain JavaScript, no import from the kit, a plain-JSON state, and one secret per seat (a word
// only that seat is shown) so the room's per-seat views are exercised too.

export const TARGET = 10;
/** How long a turn waits before it passes to the next player. */
export const TURN_MS = 20_000;
/** How many of the last presses every snapshot carries, for the page's list. */
const LOG_SIZE = 6;
const WORDS = ["owl", "fern", "kite", "plum", "moth", "reef", "wren", "lime", "dune", "pear"];

/** A word per seat, all different. Drawn from the platform's secure source, never from the round's seed. */
function drawWords(n) {
  const pool = [...WORDS];
  const out = [];
  const bytes = new Uint32Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) out.push(pool.splice(bytes[i] % pool.length, 1)[0]);
  return out;
}

/** The next seat whose phone is here, after the one whose turn it is. Stays put when nobody else is here. */
function passTurn(state, now) {
  const n = state.order.length;
  for (let step = 1; step <= n; step++) {
    const i = (state.turn + step) % n;
    if (!state.missing.includes(state.order[i])) {
      state.turn = i;
      break;
    }
  }
  state.deadline = now + TURN_MS;
}

const fail = (error, message) => ({ ok: false, error, message });

export const game = {
  id: "count-to-ten",
  minSeats: 2,
  maxSeats: 4,
  tickHz: 0,

  create({ seats, now }) {
    const order = seats.map((s) => s.seat);
    const words = drawWords(order.length);
    return {
      order,
      turn: 0,
      count: 0,
      deadline: now + TURN_MS,
      missing: [],
      log: [],
      winner: null,
      secrets: Object.fromEntries(order.map((seat, i) => [seat, words[i]])),
    };
  },

  input(state, seat, data, now) {
    if (state.winner !== null) return fail("over", "The game is over.");
    if (seat !== state.order[state.turn]) return fail("not_your_turn", "It is not your turn.");
    const add = data?.add === 1 || data?.add === 2 ? data.add : null;
    if (add === null) return fail("bad_input", "Add one or two.");
    state.count = Math.min(TARGET, state.count + add);
    state.log = [...state.log, { seat, add, count: state.count }].slice(-LOG_SIZE);
    const events = [{ k: "pressed", seat, add, count: state.count }];
    if (state.count >= TARGET) {
      state.winner = seat;
      events.push({ k: "won", seat });
    } else passTurn(state, now);
    return { ok: true, events };
  },

  /** The turn timer, paused while nobody whose turn it could be is here. */
  nextDeadline(state) {
    if (state.winner !== null) return null;
    return state.order.every((seat) => state.missing.includes(seat)) ? null : state.deadline;
  },

  /** A turn not taken in time passes on; nothing is counted for it. */
  tick(state, now) {
    const seat = state.order[state.turn];
    passTurn(state, now);
    return [{ k: "timed_out", seat }];
  },

  /** A phone that drops has its turns skipped until it is back; one that is back plays again. */
  presence(state, seat, { connected }, now) {
    const missing = !connected;
    if (missing === state.missing.includes(seat)) return false;
    const allGone = state.order.every((s) => state.missing.includes(s));
    state.missing = missing ? [...state.missing, seat] : state.missing.filter((s) => s !== seat);
    if (missing && state.order[state.turn] === seat) passTurn(state, now);
    // Back after everyone was gone: the timer runs again from the full turn.
    if (!missing && allGone) state.deadline = now + TURN_MS;
    return [{ k: missing ? "missing" : "back", seat }];
  },

  /**
   * What a viewer may see. Everyone sees the count, whose turn it is and the last presses; a
   * player sees their own secret word, and no one else's. The big screen, and anyone at the
   * Table who is not playing, sees no word at all.
   */
  snapshot(state, now, viewer) {
    const view = {
      target: TARGET,
      count: state.count,
      order: [...state.order],
      turn: state.order[state.turn],
      deadline: state.winner === null && !state.order.every((s) => state.missing.includes(s)) ? state.deadline : null,
      turnMs: TURN_MS,
      missing: [...state.missing],
      log: state.log.map((p) => ({ ...p })),
      winner: state.winner,
    };
    if (viewer?.role === "player" && state.order.includes(viewer.seat)) return { ...view, you: viewer.seat, secret: state.secrets[viewer.seat] };
    return view;
  },

  isOver: (state) => state.winner !== null,
  standings: (state) => state.order.map((seat) => ({ seat, place: seat === state.winner ? 1 : 2 })),
  result: (state) => ({ winnerSeat: state.winner, count: state.count }),

  // Never called for a turn-based game: nobody stands in for a player.
  bot: () => [],
};

export const manifest = {
  id: "count-to-ten",
  name: "Count to ten",
  pitch: "Test game: add one or two in turns, whoever says ten wins",
  path: "/party/",
  players: { min: 2, max: 4 },
  devices: { phone: true, desktop: true, upright: true },
  public: [],
};

/** Where its view is on this site (party/public/games/count-to-ten.js). */
export const VIEW = "/party/games/count-to-ten.js";
