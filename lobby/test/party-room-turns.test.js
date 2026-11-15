// Turn-based games in the party room (W2: KR-2 and KR-3), proved on the real Durable Object
// class with a small game in the shape of Who Am I?: two seats, a secret per seat that only the
// other seat may see, and a turn timer. No interval runs: an input is applied at once and saved,
// then everyone hears of it; the turn timer is the room's alarm; and a room rebuilt over the same
// storage (an eviction, a deploy) carries on with the same game, the same seats and the same views.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_FRAME, dropFakeRuntime, eventsOf, expectNoRoomSeed, fakeEnv, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
import { TURN_MS, from, savedGame, started as startedIn, turnGame } from "./turn-game.js";

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

/** A seat never gets its own secret; it gets the other seat's; a screen gets none. */
function expectSecretsKept({ ann, bo, screens = [] }, secrets) {
  for (const ws of ann) for (const frame of ws.frames) expect(frame).not.toContain(secrets.ann);
  for (const ws of bo) for (const frame of ws.frames) expect(frame).not.toContain(secrets.bo);
  for (const ws of screens) expect(ws.text()).not.toContain("SECRET-");
}

let intervals;
beforeEach(() => {
  useFakeRuntime();
  intervals = vi.spyOn(globalThis, "setInterval");
});
afterEach(dropFakeRuntime);

describe("a turn-based game in the party room", () => {
  it("runs no interval, and an input reaches every viewer at once as its own snapshot, saved first", async () => {
    const r = await started(turnGame());
    const { ctx, connect, say, ws, secrets } = r;
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", id: "turns", seats: [0, 1] });
    expect(ctx.room.timer).toBeNull();
    expect(ctx.room.meter.heldFrom).toBeNull();
    expect(intervals).not.toHaveBeenCalled();
    // The game was on record before anyone heard it began, and the room view says it is turn-based.
    expect(savedGame(ctx)).toMatchObject({ moves: [], turn: 0 });
    const start = (w) => w.messages().find((m) => m.t === "start");
    expect(start(ws.ann)).toMatchObject({ room: { phase: "playing", game: { id: "turns", turns: true } }, s: { you: 0, others: { 1: secrets.bo } } });
    expect(start(ws.bo).s).toMatchObject({ you: 1, others: { 0: secrets.ann } });
    expect(start(ws.screen).s).toMatchObject({ screen: true });

    // Cy joins in the middle: a seat in the room, not in the game.
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    expect(cy.seat).toBe(2);
    ws.cy = await connect(cy.token);
    expect(ws.cy.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { screen: true } });

    // Every game frame is sent only once the input that caused it is in storage.
    const savedAtSend = [];
    for (const w of Object.values(ws)) w.onSend = (text) => GAME_FRAME.test(text) && savedAtSend.push(savedGame(ctx)?.moves.length);
    const since = from(...Object.values(ws));
    const at = Date.now();
    say(ws.ann, { t: "in", d: { say: "Am I alive?" } });
    await settle();
    expect(Date.now()).toBe(at);
    expect(savedAtSend.length).toBe(8);
    expect(new Set(savedAtSend)).toEqual(new Set([1]));

    const snap = (w) => since(w).filter((m) => m.t === "snap");
    const evs = (w) => since(w).filter((m) => m.t === "ev").flatMap((m) => m.ev);
    for (const w of Object.values(ws)) expect(snap(w)).toHaveLength(1);
    expect(snap(ws.ann)[0].s).toMatchObject({ moves: 1, turn: 1, you: 0, others: { 1: secrets.bo } });
    expect(snap(ws.bo)[0].s).toMatchObject({ moves: 1, turn: 1, you: 1, others: { 0: secrets.ann } });
    expect(snap(ws.screen)[0].s).toEqual({ moves: 1, turn: 1, deadline: at + TURN_MS, paused: false, missing: [], timeouts: 0, screen: true });
    expect(snap(ws.cy)[0].s).toMatchObject({ screen: true });
    // The event for one seat reaches that seat only.
    expect(evs(ws.ann)).toEqual([{ k: "said", seat: 0, say: "Am I alive?" }]);
    expect(evs(ws.bo)).toEqual([
      { k: "said", seat: 0, say: "Am I alive?" },
      { k: "psst", only: 1, about: 0, secret: secrets.ann },
    ]);
    expect(evs(ws.screen)).toEqual([{ k: "said", seat: 0, say: "Am I alive?" }]);
    expect(evs(ws.cy)).toEqual([{ k: "said", seat: 0, say: "Am I alive?" }]);

    // Out of turn: the game says no, and every viewer still gets a fresh snapshot (nothing moved).
    const again = from(...Object.values(ws));
    say(ws.ann, { t: "in", d: { say: "Again?" } });
    await settle();
    expect(ctx.room.core.activity.state.moves).toHaveLength(1);
    for (const w of Object.values(ws)) expect(again(w).filter((m) => m.t === "snap").map((m) => m.s.moves)).toEqual([1]);
    // The screen and a member outside the game cannot play: nothing is applied and nothing is sent.
    const calls = ctx.room.wall.games.get("turns").calls.input;
    const none = from(...Object.values(ws));
    say(ws.screen, { t: "in", d: { say: "Screen?" } });
    say(ws.cy, { t: "in", d: { say: "Me?" } });
    await settle();
    expect(ctx.room.wall.games.get("turns").calls.input).toBe(calls);
    for (const w of Object.values(ws)) expect(none(w).filter((m) => GAME_FRAME.test(JSON.stringify(m)))).toEqual([]);

    expect(intervals).not.toHaveBeenCalled();
    expectSecretsKept({ ann: [ws.ann], bo: [ws.bo], screens: [ws.screen, ws.cy] }, secrets);
    expectNoRoomSeed(ctx.room.core, Object.values(ws));
  });

  it("wakes at the turn deadline and ticks the game once, and an alarm for a deadline that moved ticks nothing", async () => {
    const game = turnGame();
    const { ctx, say, ws, secrets } = await started(game);
    const { state } = ctx.room.core.activity;
    const first = state.deadline;
    expect(ctx.alarm.at).toBe(first);
    const since = from(ws.ann, ws.bo, ws.screen);
    await vi.advanceTimersByTimeAsync(first - Date.now() - 1);
    expect(game.calls.tick).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(game.calls.tick).toBe(1);
    // Ann's turn timed out: it is Bo's, saved, and everyone heard, each with their own view.
    expect(savedGame(ctx)).toMatchObject({ turn: 1, timeouts: 1 });
    for (const w of [ws.ann, ws.bo, ws.screen]) {
      expect(since(w).filter((m) => m.t === "ev").flatMap((m) => m.ev)).toEqual([{ k: "timed_out", seat: 0 }]);
      expect(since(w).filter((m) => m.t === "snap")).toHaveLength(1);
    }
    expect(since(ws.bo).find((m) => m.t === "snap").s).toMatchObject({ turn: 1, timeouts: 1, others: { 0: secrets.ann } });
    expect(since(ws.screen).find((m) => m.t === "snap").s).toMatchObject({ turn: 1, timeouts: 1, screen: true });
    // The next deadline is the next alarm; nothing ticks before it.
    expect(ctx.alarm.at).toBe(first + TURN_MS);
    await vi.advanceTimersByTimeAsync(TURN_MS - 1);
    expect(game.calls.tick).toBe(1);

    // Bo answers in time: the deadline moves on, and the alarm with it. Nothing ticks at the old one.
    say(ws.bo, { t: "in", d: { say: "Yes." } });
    await settle();
    expect(ctx.alarm.at).toBe(Date.now() + TURN_MS);
    const rang = ctx.alarm.rang;
    await vi.advanceTimersByTimeAsync(TURN_MS - 1);
    expect(game.calls.tick).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(game.calls.tick).toBe(2);
    expect(ctx.alarm.rang).toBe(rang + 1);
    expect(intervals).not.toHaveBeenCalled();
  });

  for (const own of [false, true]) {
    it(`survives the room being rebuilt over its storage mid-game, saved ${own ? "by the game's own serialize" : "as plain JSON"}`, async () => {
      const game = turnGame({ own });
      const r = await started(game);
      const { ctx, connect, say, sleepAndWake, ws, tokens, secrets } = r;
      const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
      ws.cy = await connect(cy.token);
      say(ws.ann, { t: "in", d: { say: "Am I a bird?" } });
      await settle();
      const deadline = ctx.room.core.activity.state.deadline;
      expect(ctx.store.get("lobby").game.state.by).toBe(own ? "game" : "json");
      expect(ctx.store.get("lobby").midGame).toBe(false);

      // An eviction a few seconds later: a new instance over the same storage and the same sockets.
      await vi.advanceTimersByTimeAsync(5000);
      const quiet = from(...Object.values(ws));
      await sleepAndWake();
      const core = ctx.room.core;
      expect(core.activity).toMatchObject({ kind: "game", id: "turns", seats: [0, 1] });
      expect(core.activity.state).toMatchObject({ moves: [{ seat: 0, say: "Am I a bird?" }], turn: 1, deadline, secrets: { 0: secrets.ann, 1: secrets.bo } });
      expect(ctx.room.sockets.size).toBe(4);
      expect(ctx.room.timer).toBeNull();
      // The deadline is still pending, on the alarm the new instance knows of.
      expect(ctx.alarm.at).toBe(deadline);
      expect(ctx.room.alarmAt).toBe(deadline);
      // Waking costs nobody a message: the game was never lost.
      for (const w of Object.values(ws)) expect(quiet(w)).toEqual([]);

      // Phones come back after the wake, each to its own view: the restored game knows its seats.
      const wsAnn2 = await connect(tokens.ann);
      const wsCy2 = await connect(cy.token);
      const wsScreen2 = await connect(tokens.screen);
      const full = (w) => w.messages().find((m) => m.t === "snap");
      expect(full(wsAnn2)).toMatchObject({ full: true, s: { moves: 1, turn: 1, you: 0, others: { 1: secrets.bo } } });
      expect(full(wsCy2)).toMatchObject({ full: true, s: { moves: 1, screen: true } });
      expect(full(wsScreen2)).toMatchObject({ full: true, s: { moves: 1, screen: true } });
      expect(wsAnn2.messages().find((m) => m.t === "hello").room).toMatchObject({ phase: "playing", game: { turns: true } });

      // Bo plays on the socket that stayed open through the sleep: applied to the restored state.
      const next = from(ws.ann, ws.bo, ws.screen, wsAnn2, wsCy2);
      say(ws.bo, { t: "in", d: { say: "No." } });
      await settle();
      expect(ctx.room.core.activity.state.moves).toEqual([
        { seat: 0, say: "Am I a bird?" },
        { seat: 1, say: "No." },
      ]);
      expect(savedGame(ctx)).toMatchObject({ moves: [{}, {}], turn: 0 });
      const snapOf = (w) => next(w).find((m) => m.t === "snap").s;
      expect(snapOf(ws.ann)).toMatchObject({ moves: 2, you: 0, others: { 1: secrets.bo } });
      expect(snapOf(wsAnn2)).toMatchObject({ moves: 2, you: 0, others: { 1: secrets.bo } });
      expect(snapOf(ws.bo)).toMatchObject({ moves: 2, you: 1, others: { 0: secrets.ann } });
      expect(snapOf(ws.screen)).toMatchObject({ moves: 2, screen: true });
      expect(snapOf(wsCy2)).toMatchObject({ moves: 2, screen: true });
      expect(next(ws.ann).flatMap((m) => m.ev ?? [])).toEqual(expect.arrayContaining([{ k: "psst", only: 0, about: 1, secret: secrets.bo }]));

      // Evicted again; the deadline rings on the newest instance and ticks the restored game once.
      await sleepAndWake();
      const due = ctx.room.core.activity.state.deadline;
      await vi.advanceTimersByTimeAsync(due - Date.now());
      expect(ctx.room.core.activity.state.timeouts).toBe(1);
      expect(game.calls.tick).toBe(1);
      expect(eventsOf(wsAnn2).filter((e) => e.k === "timed_out")).toEqual([{ k: "timed_out", seat: 0 }]);

      const all = [...Object.values(ws), wsAnn2, wsCy2, wsScreen2];
      expectSecretsKept({ ann: [ws.ann, wsAnn2], bo: [ws.bo], screens: [ws.screen, ws.cy, wsCy2, wsScreen2] }, secrets);
      expectNoRoomSeed(ctx.room.core, all);
      expect(intervals).not.toHaveBeenCalled();
    });
  }

  it("counts only the time it is awake against the room budget, not the length of the game", async () => {
    const reports = [];
    const r = await started(turnGame(), { env: fakeEnv({ budget: reports }) });
    const { ctx, say, ws } = r;
    const began = Date.now();
    // Twenty minutes of talking: a tap every 40 seconds or so, so some turns time out first.
    const seats = [ws.ann, ws.bo];
    while (Date.now() - began < 20 * 60_000) {
      await vi.advanceTimersByTimeAsync(40_000);
      expect(ctx.room.meter.heldFrom).toBeNull();
      const turn = ctx.room.core.activity.state.turn;
      say(seats[turn], { t: "in", d: { say: "Hmm." } });
      await settle();
    }
    const { state } = ctx.room.core.activity;
    expect(state.moves.length).toBeGreaterThan(20);
    expect(state.timeouts).toBeGreaterThan(20);
    say(seats[state.turn], { t: "in", d: { say: "I win.", win: true } });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    // The game's end reported what was owed; anything left is still on the room or its sockets.
    const left = ctx.room.meter.take(Date.now()).ms + [...ctx.room.sockets.values()].reduce((sum, e) => sum + e.kept.owed.ms, 0);
    const counted = reports.reduce((sum, rep) => sum + rep.ms, 0) + left;
    // A few hundred events at the floor of 2 ms each, against 20 minutes of game.
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThan(2000);
    expect(reports.length).toBeGreaterThan(0);
    expect(intervals).not.toHaveBeenCalled();
  });

  it("ends through the same finish as a ticking game, and its places reach the Tonight board", async () => {
    const { ctx, say, sleepAndWake, ws } = await started(turnGame());
    say(ws.ann, { t: "in", d: { say: "Am I an owl?" } });
    await settle();
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "in", d: { say: "I am a fox.", win: true } });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.ann, ws.bo, ws.screen]) {
      const got = since(w);
      // The last snapshot, then the end, then the room as it is now.
      expect(got.map((m) => m.t)).toEqual(expect.arrayContaining(["snap", "end", "room"]));
      expect(got.findIndex((m) => m.t === "snap")).toBeLessThan(got.findIndex((m) => m.t === "end"));
      const end = got.find((m) => m.t === "end");
      expect(end.result).toEqual({ winnerSeat: 1 });
      expect(end.last.rows).toEqual([
        { seat: 1, name: "Bo", colour: expect.any(String), place: 1, points: 3 },
        { seat: 0, name: "Ann", colour: expect.any(String), place: 2, points: 2 },
      ]);
      expect(end.room).toMatchObject({ phase: "lobby", game: null, tonight: { games: 1 } });
    }
    expect(ctx.room.core.members[1].points).toBe(3);
    // Saved as the lobby, board and all: no game is left in storage, and a wake keeps the board.
    expect(ctx.store.get("lobby")).toMatchObject({ game: null, midGame: false, gamesPlayed: 1 });
    await sleepAndWake();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ctx.room.core.view(Date.now()).tonight).toMatchObject({ games: 1, played: [{ name: "turns", winners: [{ name: "Bo" }] }] });
    expect(ctx.room.core.members.map((m) => m && m.points)).toEqual([2, 3, null, null]);
  });

  it("ends at a deadline too, when the timeout decides it", async () => {
    const { ctx, ws } = await started(turnGame({ maxTimeouts: 1 }));
    await vi.advanceTimersByTimeAsync(TURN_MS);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const end = ws.screen.messages().find((m) => m.t === "end");
    expect(end.last.rows.map((row) => [row.seat, row.place, row.points])).toEqual([
      [1, 1, 3],
      [0, 2, 2],
    ]);
    expect(ctx.room.core.view(Date.now()).tonight.games).toBe(1);
  });

  it("sends everyone back to the lobby when the saved game cannot be read", async () => {
    const { ctx, sleepAndWake, ws } = await started(turnGame({ own: true }));
    const saved = ctx.store.get("lobby");
    saved.game.state.data = JSON.stringify({ shape: "something else" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const since = from(ws.ann, ws.screen);
    await sleepAndWake();
    expect(errors).toHaveBeenCalledWith("party room: a saved game could not be restored", expect.any(Error));
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.ann, ws.screen]) expect(since(w).find((m) => m.t === "room").room).toMatchObject({ phase: "lobby", game: null });
    expect(ctx.store.get("lobby")).toMatchObject({ game: null, midGame: false });
  });

  it("keeps a game that cannot be written down going, and says so: a restart then ends it", async () => {
    const game = turnGame();
    const { ctx, say, sleepAndWake, ws } = await started(game);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = game.input;
    game.input = (state, ...rest) => {
      state.when = new Date(0);
      return input(state, ...rest);
    };
    say(ws.ann, { t: "in", d: { say: "Am I a date?" } });
    await settle();
    expect(errors).toHaveBeenCalledWith("party room: the game in progress could not be saved", expect.any(TypeError));
    expect(ws.bo.messages().filter((m) => m.t === "snap").at(-1).s).toMatchObject({ moves: 1 });
    expect(ctx.store.get("lobby")).toMatchObject({ game: null, midGame: true });
    await sleepAndWake();
    expect(ctx.room.core.activity.kind).toBe("lobby");
  });

  it("does not start a game whose definition is wrong", async () => {
    const game = turnGame({ own: true });
    delete game.restore;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect } = r;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const wsAnn = await connect(ann.token);
    const wsBo = await connect(bo.token);
    await expect(voteIn(r, [wsAnn, 0], [wsBo, 1])).rejects.toThrow();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(errors).toHaveBeenCalledWith("party room: turns cannot start: serialize and restore come together, or not at all.");
  });
});
