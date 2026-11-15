// A small turn-based game in the shape of Who Am I?, and a party voted into it, for the tests of
// turn-based games on the real party room class (party-room-turns, party-room-presence and
// party-room-answers). Two seats, a secret per seat that only the other seat may see, a turn
// timer, and (with `presence`) a timer that pauses while a seat is missing, as Who Am I? does.
import { expect } from "vitest";
import { openRoom, settle, voteIn } from "./fake-room.js";

export const TURN_MS = 30_000;
/** With `presence`: how long the other seat must be missing before a player may end the game on their own (Who Am I?'s host override). */
export const OVERRIDE_MS = 30_000;

/**
 * Two seats take turns to say something. Each seat's secret is seen by the other seat and never
 * by its own, nor by a screen. Saying something passes the turn and tells the other seat (and
 * only it) the speaker's secret; a turn not taken in TURN_MS times out (tick) and passes too.
 * Saying `win` wins; with `maxTimeouts`, the seat that did not time out wins at the last one.
 * With `own`, it writes and reads its own saves as a string, as Who Am I? does.
 *
 * With `presence`, it hears who is here (game.presence): the turn timer pauses while either seat
 * is dropped or away and runs on from where it stopped when both are back, and once the other
 * seat has been missing OVERRIDE_MS a player may say `override` to win on their own. `fields`
 * are added to the game object as they are (reconnectGraceMs, idleShutdownMs, abandon, ...).
 */
export function turnGame({ own = false, maxTimeouts = Infinity, presence = false, fields = {} } = {}) {
  const calls = { tick: 0, input: 0, presence: [], abandon: [], bot: 0 };
  const game = {
    id: "turns",
    minSeats: 2,
    maxSeats: 2,
    tickHz: 0,
    calls,
    create: ({ seats, now }) => ({
      seats: seats.map((s) => s.seat),
      secrets: Object.fromEntries(seats.map((s) => [s.seat, `SECRET-${s.seat}-${crypto.randomUUID()}`])),
      turn: 0,
      deadline: now + TURN_MS,
      paused: null,
      missing: {},
      moves: [],
      timeouts: 0,
      winner: null,
    }),
    input(state, seat, data, now) {
      calls.input += 1;
      if (data?.override) {
        const other = state.seats.find((s) => s !== seat);
        const since = state.missing[other];
        if (since === undefined || now - since < OVERRIDE_MS) return { ok: false, error: "too_soon", message: "Wait for the other player." };
        state.winner = seat;
        return { ok: true, events: [{ k: "override", seat }] };
      }
      if (seat !== state.seats[state.turn]) return { ok: false, error: "not_your_turn", message: "It is not your turn." };
      const say = String(data?.say ?? "");
      state.moves.push({ seat, say });
      if (data?.win) state.winner = seat;
      const other = state.seats[1 - state.turn];
      state.turn = 1 - state.turn;
      if (state.paused === null) state.deadline = now + TURN_MS;
      else state.paused = TURN_MS;
      return { ok: true, events: [{ k: "said", seat, say }, { k: "psst", only: other, about: seat, secret: state.secrets[seat] }] };
    },
    nextDeadline: (state) => (state.paused === null ? state.deadline : null),
    tick(state, now) {
      calls.tick += 1;
      const seat = state.seats[state.turn];
      state.timeouts += 1;
      state.turn = 1 - state.turn;
      state.deadline = now + TURN_MS;
      if (state.timeouts >= maxTimeouts) state.winner = state.seats[state.turn];
      return [{ k: "timed_out", seat }];
    },
    snapshot(state, now, viewer) {
      const base = { turn: state.seats[state.turn], deadline: state.paused === null ? state.deadline : null, paused: state.paused !== null, missing: Object.keys(state.missing).map(Number), moves: state.moves.length, timeouts: state.timeouts };
      if (viewer?.role === "player" && state.seats.includes(viewer.seat)) {
        return { ...base, you: viewer.seat, others: Object.fromEntries(state.seats.filter((s) => s !== viewer.seat).map((s) => [s, state.secrets[s]])) };
      }
      return { ...base, screen: true };
    },
    isOver: (state) => state.winner !== null,
    standings: (state) => state.seats.map((seat) => ({ seat, place: seat === state.winner ? 1 : 2 })),
    result: (state) => ({ winnerSeat: state.winner }),
    // Never called for a turn-based game: nobody stands in for a player.
    bot() {
      calls.bot += 1;
      return [];
    },
  };
  if (presence) {
    game.presence = (state, seat, report, now) => {
      calls.presence.push({ seat, ...report, at: now });
      const missing = !report.connected || report.away;
      if (missing === (state.missing[seat] !== undefined)) return false;
      if (missing) state.missing[seat] = now;
      else delete state.missing[seat];
      const anyMissing = Object.keys(state.missing).length > 0;
      if (anyMissing && state.paused === null) {
        state.paused = Math.max(0, state.deadline - now);
        state.deadline = null;
      } else if (!anyMissing && state.paused !== null) {
        state.deadline = now + state.paused;
        state.paused = null;
      }
      return [{ k: missing ? "missing" : "back", seat }];
    };
  }
  if (own) {
    game.serialize = (state) => JSON.stringify({ shape: "turns/1", state });
    game.restore = (text) => {
      const saved = JSON.parse(text);
      if (saved.shape !== "turns/1") throw new Error("Not a saved turns game");
      return saved.state;
    };
  }
  return Object.assign(game, fields);
}

/** The game as it is saved in the room's storage right now, or null. */
export function savedGame(ctx) {
  const saved = ctx.store.get("lobby")?.game;
  if (!saved) return null;
  return saved.state.by === "game" ? JSON.parse(saved.state.data).state : saved.state.data;
}

/** A party of Ann, Bo and a big screen, voted into the game. */
export async function started(createLobbyRoom, game, opts) {
  const r = await openRoom(createLobbyRoom, game, opts);
  const { ctx, connect } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const screen = await ctx.room.join({ as: "screen" });
  const ws = { ann: await connect(ann.token), bo: await connect(bo.token), screen: await connect(screen.token) };
  await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
  await settle();
  expect(ctx.room.core.activity.kind).toBe("game");
  const state = ctx.room.core.activity.state;
  return { ...r, tokens: { ann: ann.token, bo: bo.token, screen: screen.token }, ws, secrets: { ann: state.secrets[0], bo: state.secrets[1] } };
}

/** What each socket was sent from now on: call the result for the frames since. */
export function from(...sockets) {
  const at = new Map(sockets.map((ws) => [ws, ws.frames.length]));
  return (ws) => ws.frames.slice(at.get(ws)).map((f) => JSON.parse(f));
}
