// Coin Flip: a test game, and nothing more. Luck puts the players in an order, first gets three
// points. It exists so the party room has a second light to vote for and so the seam between
// the room and a game (party-kit/GAME-CONTRACT.md, "The lobby hooks") is exercised end to end:
// started with the party's seats, ticked by the room, over with places, back to the lobby.
//
// Like any hosted game it keeps the game contract: plain JavaScript, no import from the kit.

/** The coins spin this long, then the order is shown and the game is over. */
export const FLIP_MS = 3000;

/** A small seeded generator (mulberry32), so the same seed gives the same order. */
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const game = {
  id: "coin-flip",
  minSeats: 1,
  maxSeats: 4,
  tickHz: 4,
  snapshotEvery: 4,

  create({ seed, seats, now }) {
    const next = rng(seed);
    const order = seats.map((s) => s.seat);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return { startAt: now, seats: seats.map((s) => s.seat), order, shown: false };
  },

  // Nothing to press: luck does it all.
  input() {},

  tick(state, now) {
    if (state.shown || now - state.startAt < FLIP_MS) return [];
    state.shown = true;
    return [{ k: "shown", order: state.order }];
  },

  snapshot(state, now) {
    return { seats: state.seats, flipMs: FLIP_MS, elapsed: now - state.startAt, order: state.shown ? state.order : null };
  },

  isOver(state) {
    return state.shown;
  },

  result(state) {
    return state.order.map((seat, i) => ({ seat, place: i + 1 }));
  },

  /** The one shape every hosted game ends with: who came where. */
  standings(state) {
    return state.order.map((seat, i) => ({ seat, place: i + 1 }));
  },
};

export const manifest = {
  id: "coin-flip",
  name: "Coin Flip",
  blurb: "Test game: luck picks the order",
  path: "/lobby/",
  players: { min: 1, max: 4, solo: false },
  devices: { phone: true, desktop: true, sharedScreen: true, sideways: "preferred" },
  public: [],
};
