// Turns a Table game's pure rules into the game the party room runs: one adapter for every Table
// game, so no game is a special case in the room (party-kit/GAME-CONTRACT.md, "Games at the Table").
//
// The rules module exports (Count to ten and Paper Masks both do):
//   GAME_ID, MIN_PLAYERS, MAX_PLAYERS, SYSTEM
//   create(seats, options, seed, now)  -> state | { refused, message }
//   apply(state, seat, move, now)      -> new state | { refused, message }   (pure)
//   view(state, seat)                  -> what that seat may see; seat -1 is a big screen
//   nextDeadline(state), done(state), result(state), standings(state)
// and takes these moves from SYSTEM: { t: "tick" } at nextDeadline, { t: "join", seat } for a late
// joiner, { t: "leave", seat } for a seat gone for good, { t: "host", seat } when the host changes.
//
// What the room gives it: a fresh secret seed per match from the platform's secure source (never
// the room's own seed, which a page may learn), the seats playing, the host's seat, and `now`.
// What it gives the room: the kit's turn-based game (`tickHz: 0`), whose `join`, `leave` and
// `host` hooks the room calls (lobby/server/lobby-core.js). Only `view` output is ever sent.

const isRefusal = (x) => !!x && typeof x === "object" && typeof x.refused === "string";
const refusal = (out) => ({ ok: false, error: out.refused, message: typeof out.message === "string" ? out.message : "That cannot be done now." });

/** The kit applies a move to a copy of the state and keeps the copy: the new state goes into it. */
function replace(target, next) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

/**
 * The kit's game for a rules module. `id` defaults to the module's GAME_ID; `maxSeats` to its
 * MAX_PLAYERS (the room deals in at most the Table's own cap).
 */
export function tableGame(rules, { id = rules.GAME_ID } = {}) {
  for (const name of ["create", "apply", "view", "nextDeadline", "done", "result", "standings"]) {
    if (typeof rules[name] !== "function") throw new Error(`${id}: a Table game's rules must export ${name}()`);
  }
  if (rules.SYSTEM === undefined) throw new Error(`${id}: a Table game's rules must export SYSTEM`);
  const system = (state, move, now) => {
    const out = rules.apply(state, rules.SYSTEM, move, now);
    if (isRefusal(out)) return refusal(out);
    replace(state, out);
    return { ok: true, events: [] };
  };
  return {
    id,
    minSeats: rules.MIN_PLAYERS ?? 1,
    maxSeats: rules.MAX_PLAYERS ?? 4,
    tickHz: 0,
    /** The room's seats, its host (when that is a player) and its secret seed for this match. */
    create({ seats, seed, now, host }) {
      const numbers = seats.map((s) => s.seat);
      const state = rules.create(numbers, numbers.includes(host) ? { host } : {}, seed, now);
      if (isRefusal(state)) throw new Error(`${id} refused to start: ${state.refused}`);
      return state;
    },
    input(state, seat, move, now) {
      const out = rules.apply(state, seat, move, now);
      if (isRefusal(out)) return refusal(out);
      replace(state, out);
      return { ok: true, events: [] };
    },
    nextDeadline: (state) => rules.nextDeadline(state),
    tick(state, now) {
      system(state, { t: "tick" }, now);
      return [];
    },
    /** A player's seat sees their own view; anyone else (the big screen, a member not dealt in) sees seat -1's. */
    snapshot: (state, now, viewer) => rules.view(state, viewer?.role === "player" ? viewer.seat : -1),
    isOver: (state) => rules.done(state),
    result: (state) => rules.result(state),
    standings: (state) => rules.standings(state),
    join: (state, seat, now) => system(state, { t: "join", seat }, now),
    leave: (state, seat, now) => system(state, { t: "leave", seat }, now),
    host: (state, seat, now) => system(state, { t: "host", seat }, now),
    // Never called for a turn-based game: nobody stands in for a player.
    bot: () => [],
  };
}
