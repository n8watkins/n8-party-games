// Who is here during a turn-based game (W3: KR-4, KR-5, KR-6 and KR-13), proved on the real
// Durable Object class with the Who Am I?-shaped test game (turn-game.js). Nobody stands in for a
// player: a dropped phone keeps its seat for the game's grace, the game hears of every change in
// who is here (and pauses its timer), a page hidden with its socket open is "away", the room's
// lifetimes are the game's while it is played, and a seat gone for good ends the game early.
// A room rebuilt over the same storage mid-game carries all of it on. A ticking game keeps the
// behaviour it had.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_SHUTDOWN_MS, STALE_ROOM_MS } from "../../party-kit/src/core/room-core.js";
import { DROP_FADE_MS, SEAT_HOLD_MS, TURN_GRACE_MS } from "../server/lobby-core.js";
import { dropFakeRuntime, eventsOf, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
import { OVERRIDE_MS, TURN_MS, from, savedGame, started as startedIn, turnGame } from "./turn-game.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const started = (game, opts) => startedIn(createLobbyRoom, game, opts);
const HOUR = 60 * 60_000;

/** A phone's socket closes (signal lost, page closed or parked when the phone locked). */
async function lose(ctx, ws) {
  ctx.room.webSocketClose(ws, 1006, "");
  await settle();
}

/** A game that decides who won when a seat is gone for good: the seat still here wins. */
function abandoning() {
  return {
    abandon(state, seat, now) {
      this.calls.abandon.push({ seat, at: now, moves: state.moves.length });
      const other = state.seats.find((s) => s !== seat);
      return { standings: [{ seat: other, place: 1 }], result: { winnerSeat: other, abandonedBy: seat }, events: [{ k: "abandoned", seat }] };
    },
  };
}

const snapsOf = (got) => got.filter((m) => m.t === "snap").map((m) => m.s);
const notesOf = (got) => got.filter((m) => m.t === "note");

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a dropped phone in a turn-based game", () => {
  it("keeps its seat with nobody standing in; the game hears it, pauses its timer, and runs on when the phone is back", async () => {
    const game = turnGame({ presence: true });
    const { ctx, connect, ws, tokens, secrets } = await started(game);
    // Everyone was here when the vote ended: the game is told nothing at the start.
    expect(game.calls.presence).toEqual([]);
    const first = ctx.room.core.activity.state.deadline;

    await vi.advanceTimersByTimeAsync(10_000);
    const since = from(ws.ann, ws.screen);
    const droppedAt = Date.now();
    await lose(ctx, ws.bo);
    // The seat is still Bo's, in the room and in the game.
    expect(ctx.room.core.members[1]).toMatchObject({ name: "Bo", connected: false });
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    expect(game.calls.presence).toEqual([{ seat: 1, connected: false, away: false, at: droppedAt }]);
    // The game paused its timer: saved, and everyone still here was told, each with their own view.
    expect(savedGame(ctx)).toMatchObject({ paused: first - droppedAt, deadline: null, missing: { 1: droppedAt } });
    for (const w of [ws.ann, ws.screen]) {
      expect(snapsOf(since(w))).toHaveLength(1);
      expect(snapsOf(since(w))[0]).toMatchObject({ paused: true, deadline: null, missing: [1] });
      expect(eventsOf({ messages: () => since(w) })).toEqual([{ k: "missing", seat: 1 }]);
    }
    expect(snapsOf(since(ws.ann))[0]).toMatchObject({ you: 0, others: { 1: secrets.bo } });

    // The turn deadline has gone from the alarm: a minute on, nothing has timed out, and no stand-in played.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(game.calls.tick).toBe(0);
    expect(game.calls.bot).toBe(0);
    expect(ctx.room.core.activity.kind).toBe("game");

    // Bo's phone is back (unlocked, signal back): the same seat, the game hears it, and the timer runs on from where it stopped.
    const back = from(ws.ann, ws.screen);
    const wsBo2 = await connect(tokens.bo);
    await settle();
    const backAt = Date.now();
    expect(wsBo2.messages().find((m) => m.t === "hello").you).toEqual({ role: "player", seat: 1 });
    expect(game.calls.presence.at(-1)).toEqual({ seat: 1, connected: true, away: false, at: backAt });
    const resumed = backAt + (first - droppedAt);
    expect(ctx.room.core.activity.state).toMatchObject({ paused: null, deadline: resumed, missing: {} });
    expect(ctx.alarm.at).toBe(resumed);
    expect(snapsOf(wsBo2.messages()).at(-1)).toMatchObject({ paused: false, you: 1, others: { 0: secrets.ann } });
    for (const w of [ws.ann, ws.screen]) expect(snapsOf(back(w)).at(-1)).toMatchObject({ paused: false, deadline: resumed });
    await vi.advanceTimersByTimeAsync(resumed - Date.now());
    expect(game.calls.tick).toBe(1);
    expect(game.calls.bot).toBe(0);
  });

  it("is held for the room's default grace when the game chooses none, then the game ends with no points", async () => {
    const game = turnGame({ presence: true });
    const { ctx, ws } = await started(game);
    const since = from(ws.ann, ws.screen);
    await lose(ctx, ws.bo);
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS - 1);
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.ann, ws.screen]) {
      const got = since(w);
      // Then, back in the lobby, Bo's piece fades as any dropped piece does.
      expect(notesOf(got)).toEqual([expect.objectContaining({ k: "ended", why: "gone", seat: 1, name: "Bo", text: "Bo did not come back, so turns ended." }), expect.objectContaining({ k: "left", why: "dropped", name: "Bo" })]);
      const end = got.find((m) => m.t === "end");
      expect(end.result).toBeNull();
      expect(end.last).toMatchObject({ rows: [], early: { seat: 1, name: "Bo", why: "gone" } });
      expect(end.room).toMatchObject({ phase: "lobby", game: null, tonight: { games: 0, played: [] } });
      // The last snapshot went out before the end.
      expect(got.findIndex((m) => m.t === "snap")).toBeLessThan(got.findIndex((m) => m.t === "end"));
    }
    expect(ctx.room.core.members.map((m) => m && m.points)).toEqual([0, null, null, null]);
    expect([...ctx.room.core.held.values()]).toMatchObject([{ seat: 1, name: "Bo", points: 0 }]);
    expect(ctx.store.get("lobby")).toMatchObject({ game: null, midGame: false, gamesPlayed: 0 });
  });

  it("is held for the game's own grace, and game.abandon decides the result when it runs out", async () => {
    const game = turnGame({ presence: true, fields: { reconnectGraceMs: 45_000, ...abandoning() } });
    const { ctx, say, ws } = await started(game);
    say(ws.ann, { t: "in", d: { say: "Am I a bird?" } });
    await settle();
    const since = from(ws.ann, ws.screen);
    const droppedAt = Date.now();
    await lose(ctx, ws.bo);
    expect(ctx.alarm.at).toBe(droppedAt + 45_000);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(game.calls.abandon).toEqual([{ seat: 1, at: droppedAt + 45_000, moves: 1 }]);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.ann, ws.screen]) {
      const got = since(w);
      expect(eventsOf({ messages: () => got })).toEqual([{ k: "missing", seat: 1 }, { k: "abandoned", seat: 1 }]);
      const end = got.find((m) => m.t === "end");
      expect(end.result).toEqual({ winnerSeat: 0, abandonedBy: 1 });
      expect(end.last.rows).toEqual([{ seat: 0, name: "Ann", colour: expect.any(String), place: 1, points: 3 }]);
      expect(end.last.early).toMatchObject({ seat: 1, why: "gone" });
      expect(end.room.tonight).toMatchObject({ games: 1, played: [{ name: "turns", winners: [{ name: "Ann" }] }] });
    }
    expect(ctx.room.core.members[0].points).toBe(3);
    // Back in the lobby, Bo's piece is a dropped piece like any other: it fades and its seat is held.
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.room.core.members[1]).toBeNull();
    expect(ctx.room.core.held.size).toBe(1);
  });

  it("is held while the room lives with an Infinity grace, and the player can still win on their own", async () => {
    const game = turnGame({ presence: true, fields: { reconnectGraceMs: Infinity, idleShutdownMs: HOUR, staleRoomMs: HOUR, ...abandoning() } });
    const { ctx, say, ws } = await started(game);
    await lose(ctx, ws.bo);
    // No wake-up for the grace: the seat is held while the room lives.
    expect(ctx.alarm.at).toBe(Date.now() + HOUR);
    // Too soon for the game's own override; then allowed, and the input ends the game.
    say(ws.ann, { t: "in", d: { override: true } });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(OVERRIDE_MS);
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.abandon).toEqual([]);
    say(ws.ann, { t: "in", d: { override: true } });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ws.ann.messages().find((m) => m.t === "end").last).toMatchObject({ rows: [{ seat: 0, place: 1 }, { seat: 1, place: 2 }] });
    expect(game.calls.abandon).toEqual([]);
    expect(game.calls.bot).toBe(0);
  });
});

describe("a page hidden with its socket open", () => {
  it("is away: the game hears it, the room view shows it, and it never runs the grace down", async () => {
    const game = turnGame({ presence: true });
    const { ctx, connect, say, ws, tokens } = await started(game);
    const since = from(ws.bo, ws.screen);
    say(ws.ann, { t: "away" });
    await settle();
    expect(game.calls.presence).toEqual([{ seat: 0, connected: true, away: true, at: Date.now() }]);
    expect(ctx.room.core.activity.state.paused).not.toBeNull();
    for (const w of [ws.bo, ws.screen]) {
      const room = since(w).find((m) => m.t === "room").room;
      expect(room.members[0]).toMatchObject({ connected: true, away: true });
      expect(room.members[1]).not.toHaveProperty("away");
      expect(snapsOf(since(w)).at(-1)).toMatchObject({ paused: true, missing: [0] });
    }
    // Saying it again changes nothing and sends nothing.
    const quiet = from(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "away" });
    await settle();
    for (const w of [ws.ann, ws.bo, ws.screen]) expect(quiet(w)).toEqual([]);

    // A second tab of Ann's that is showing: Ann is here. When it closes, the hidden one is all she has: away again.
    const tab = await connect(tokens.ann);
    await settle();
    expect(game.calls.presence.at(-1)).toMatchObject({ seat: 0, connected: true, away: false });
    await lose(ctx, tab);
    expect(game.calls.presence.at(-1)).toMatchObject({ seat: 0, connected: true, away: true });

    // Away for far longer than any grace: still Ann's seat, still the game.
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS * 3);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(ctx.room.core.members[0]).toMatchObject({ connected: true, away: true });

    say(ws.ann, { t: "back" });
    await settle();
    expect(game.calls.presence.at(-1)).toMatchObject({ seat: 0, connected: true, away: false });
    expect(ctx.room.core.activity.state.paused).toBeNull();
    expect(ctx.alarm.at).toBe(ctx.room.core.activity.state.deadline);

    // The big screen has no seat: its page being hidden is nobody's business.
    const calls = game.calls.presence.length;
    say(ws.screen, { t: "away" });
    await settle();
    expect(game.calls.presence).toHaveLength(calls);
  });
});

describe("ending a turn-based game early", () => {
  it("ends it at once when a player in it leaves the party, and never for a member who is not playing", async () => {
    const game = turnGame({ presence: true, fields: abandoning() });
    const { ctx, connect, say, ws } = await started(game);
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    ws.cy = await connect(cy.token);
    await settle();
    say(ws.cy, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.abandon).toEqual([]);

    const since = from(ws.ann, ws.screen);
    say(ws.bo, { t: "leave" });
    await settle();
    expect(game.calls.abandon).toMatchObject([{ seat: 1 }]);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.ann, ws.screen]) {
      const got = since(w);
      expect(notesOf(got).map((n) => n.k)).toEqual(["left", "ended"]);
      expect(notesOf(got)[1]).toMatchObject({ why: "left", name: "Bo", text: "Bo left the party, so turns ended." });
      expect(got.find((m) => m.t === "end").last).toMatchObject({ rows: [{ seat: 0, place: 1, points: 3 }], early: { seat: 1, name: "Bo", why: "left" } });
    }
  });

  it("ends with no points when the game has no abandon", async () => {
    const { ctx, say, ws } = await started(turnGame());
    say(ws.ann, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const end = ws.bo.messages().find((m) => m.t === "end");
    expect(end).toMatchObject({ result: null, last: { rows: [], early: { seat: 0, name: "Ann", why: "left" } } });
    expect(ctx.room.core.gamesPlayed).toBe(0);
    expect(ctx.room.core.history).toEqual([]);
  });

  it("ends with no points when game.abandon throws, and says so in the log", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const game = turnGame({
      fields: {
        abandon() {
          throw new Error("no");
        },
      },
    });
    const { ctx, say, ws } = await started(game);
    say(ws.bo, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(errors).toHaveBeenCalledWith("party room: turns could not be abandoned; it ends with no points", expect.any(Error));
    expect(ws.ann.messages().find((m) => m.t === "end").last.rows).toEqual([]);
  });
});

describe("the room's lifetimes during a turn-based game", () => {
  it("are the game's own: an empty room waits its idleShutdownMs, then closes", async () => {
    const game = turnGame({ presence: true, fields: { reconnectGraceMs: Infinity, idleShutdownMs: HOUR, staleRoomMs: HOUR } });
    const { ctx, ws } = await started(game);
    for (const w of [ws.ann, ws.bo, ws.screen]) await lose(ctx, w);
    const emptyAt = Date.now();
    await vi.advanceTimersByTimeAsync(IDLE_SHUTDOWN_MS * 10);
    expect(ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(emptyAt + HOUR - Date.now() - 1);
    expect(ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.room.core).toBeNull();
    expect(ctx.store.size).toBe(0);
  });

  it("are the game's own: a match nobody taps for longer than the room's stale limit lives on, until the game's", async () => {
    const game = turnGame({ presence: true, fields: { reconnectGraceMs: Infinity, idleShutdownMs: HOUR, staleRoomMs: HOUR } });
    const { ctx, say, ws } = await started(game);
    // Ann's phone is put away with its socket open: the timer stops and nobody taps.
    say(ws.ann, { t: "away" });
    await settle();
    expect(ctx.room.core.view(Date.now()).idleLimit).toBe(HOUR);
    const quietFrom = ctx.room.core.lastActive;
    await vi.advanceTimersByTimeAsync(STALE_ROOM_MS * 2);
    expect(ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(quietFrom + HOUR - Date.now() - 1);
    expect(ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.room.core).toBeNull();
    expect(ws.bo.closed).toEqual({ code: 4000, reason: "room_idle" });
  });

  it("are the room's when the game chooses none, and the room's again once the game is over", async () => {
    const r = await started(turnGame());
    expect(r.ctx.room.core.view(Date.now()).idleLimit).toBe(STALE_ROOM_MS);
    // Turn timers tick on, but nobody taps: forgotten after the room's stale limit.
    await vi.advanceTimersByTimeAsync(STALE_ROOM_MS - 1000);
    expect(r.ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.ctx.room.core).toBeNull();

    const game = turnGame({ fields: { reconnectGraceMs: Infinity, idleShutdownMs: HOUR, staleRoomMs: HOUR } });
    const { ctx, say, ws } = await started(game);
    say(ws.ann, { t: "in", d: { say: "I win", win: true } });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ctx.room.core.view(Date.now()).idleLimit).toBe(STALE_ROOM_MS);
    // The lobby's own rule: an empty room waits for the seats it holds (SEAT_HOLD_MS), not an hour.
    for (const w of [ws.ann, ws.bo, ws.screen]) await lose(ctx, w);
    await vi.advanceTimersByTimeAsync(SEAT_HOLD_MS + DROP_FADE_MS);
    expect(ctx.room.core).toBeNull();
  });
});

describe("a room rebuilt over the same storage mid-game", () => {
  it("keeps a dropped seat's grace running from the drop, tells the game nothing twice, and ends it on time", async () => {
    const game = turnGame({ presence: true, own: true, fields: { reconnectGraceMs: 45_000, ...abandoning() } });
    const { ctx, say, sleepAndWake, ws } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    const droppedAt = Date.now();
    await lose(ctx, ws.ann);
    expect(game.calls.presence.map((c) => [c.seat, c.connected, c.away])).toEqual([
      [1, true, true],
      [0, false, false],
    ]);
    expect(ctx.store.get("lobby").game.told).toEqual({ 0: { connected: false, away: false }, 1: { connected: true, away: true } });

    await vi.advanceTimersByTimeAsync(10_000);
    const quiet = from(ws.bo, ws.screen);
    await sleepAndWake();
    // Bo's hidden page is still away (its socket says so), Ann is still gone, and the game heard all of it before the sleep.
    expect(ctx.room.core.members[1]).toMatchObject({ connected: true, away: true });
    expect(ctx.room.core.members[0]).toMatchObject({ connected: false, droppedAt });
    expect(game.calls.presence).toHaveLength(2);
    for (const w of [ws.bo, ws.screen]) expect(quiet(w)).toEqual([]);
    expect(ctx.alarm.at).toBe(droppedAt + 45_000);

    await vi.advanceTimersByTimeAsync(droppedAt + 45_000 - Date.now() - 1);
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(game.calls.abandon).toMatchObject([{ seat: 0, at: droppedAt + 45_000 }]);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.bo, ws.screen]) {
      expect(notesOf(quiet(w)).map((n) => [n.k, n.why, n.name])).toEqual([
        ["ended", "gone", "Ann"],
        ["left", "dropped", "Ann"],
      ]);
      expect(quiet(w).find((m) => m.t === "end").last.rows).toEqual([expect.objectContaining({ seat: 1, place: 1, points: 3 })]);
    }
  });

  it("tells the game of a socket that did not come through the sleep, and ends the game when that player leaves after it", async () => {
    const game = turnGame({ presence: true, fields: abandoning() });
    const { ctx, connect, say, sleepAndWake, ws, tokens } = await started(game);
    // Ann's socket dies while the room sleeps: the new instance never hears it close.
    ws.ann.closed = { code: 1006, reason: "" };
    const since = from(ws.bo, ws.screen);
    await sleepAndWake();
    const wokeAt = Date.now();
    expect(game.calls.presence).toEqual([{ seat: 0, connected: false, away: false, at: wokeAt }]);
    expect(savedGame(ctx)).toMatchObject({ missing: { 0: wokeAt } });
    for (const w of [ws.bo, ws.screen]) expect(snapsOf(since(w)).at(-1)).toMatchObject({ paused: true, missing: [0] });
    // The grace runs from the wake.
    expect(ctx.alarm.at).toBe(wokeAt + TURN_GRACE_MS);

    const wsAnn2 = await connect(tokens.ann);
    await settle();
    expect(game.calls.presence.at(-1)).toMatchObject({ seat: 0, connected: true });
    expect(snapsOf(wsAnn2.messages()).at(-1)).toMatchObject({ you: 0, paused: false });

    await sleepAndWake();
    say(ws.bo, { t: "leave" });
    await settle();
    expect(game.calls.abandon).toMatchObject([{ seat: 1 }]);
    expect(wsAnn2.messages().find((m) => m.t === "end").last).toMatchObject({ rows: [{ seat: 0, place: 1 }], early: { why: "left", name: "Bo" } });
    expect(ctx.store.get("lobby")).toMatchObject({ game: null });
  });
});

describe("a ticking game", () => {
  /** A short ticking game with a stand-in, and every hook a turn-based game may have: none of them is called. */
  function tickingGame() {
    const calls = { bot: 0, presence: 0, abandon: 0, inputs: {} };
    return {
      id: "ticker",
      minSeats: 2,
      maxSeats: 2,
      tickHz: 10,
      calls,
      reconnectGraceMs: 0,
      create: ({ seats }) => ({ seats: seats.map((s) => s.seat), ticks: 0, score: {} }),
      input(state, seat) {
        calls.inputs[seat] = (calls.inputs[seat] ?? 0) + 1;
        state.score[seat] = (state.score[seat] ?? 0) + 1;
      },
      bot() {
        calls.bot += 1;
        return [{ tap: 1 }];
      },
      tick(state) {
        state.ticks += 1;
        return [];
      },
      snapshot: (state) => ({ ticks: state.ticks }),
      isOver: (state) => state.ticks >= 100,
      standings: (state) => state.seats.map((seat) => ({ seat, place: (state.score[seat] ?? 0) >= (state.score[state.seats.find((s) => s !== seat)] ?? 0) ? 1 : 2 })),
      presence() {
        calls.presence += 1;
        return true;
      },
      abandon() {
        calls.abandon += 1;
        return null;
      },
    };
  }

  it("keeps today's behaviour: a dropped or departed seat is played by the stand-in, and the round runs to its end", async () => {
    const game = tickingGame();
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token) };
    await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
    expect(ctx.room.timer).not.toBeNull();
    await lose(ctx, ws.bo);
    await vi.advanceTimersByTimeAsync(2000);
    expect(game.calls.bot).toBeGreaterThan(0);
    say(ws.ann, { t: "away" });
    say(ws.ann, { t: "leave" });
    await vi.advanceTimersByTimeAsync(2000);
    // Both seats are gone, one dropped and one left: the round is still on, played by the stand-in.
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.room.core?.activity.kind ?? "closed").not.toBe("game");
    expect(game.calls.presence).toBe(0);
    expect(game.calls.abandon).toBe(0);
    expect(game.calls.inputs[1]).toBeGreaterThan(0);
  });
});
