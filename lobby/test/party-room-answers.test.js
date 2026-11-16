// Answered inputs in a turn-based game (W4: KR-7), proved on the real Durable Object class with
// the Who Am I?-shaped test game (turn-game.js). An input with an id is answered to its sender
// only, after it is saved and after the sender's fresh snapshot: `ack {id}` or `error {id, error,
// message}`. The same id from the same seat is answered again and never applied twice, also
// after the room is rebuilt over the same storage and just after the game ended. Everyone gets
// fresh snapshots after every input, answered either way. A ticking game is fire and forget.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
import { from, savedGame, started as startedIn, turnGame } from "./turn-game.js";

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
const answersOf = (got) => got.filter((m) => m.t === "ack" || m.t === "error");

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("an input with an id", () => {
  it("is answered ack to its sender only, once saved and after the sender's own fresh snapshot", async () => {
    const game = turnGame();
    const { ctx, say, ws } = await started(game);
    const order = [];
    ws.ann.onSend = (text) => order.push([JSON.parse(text).t, savedGame(ctx)?.moves.length]);
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "in", d: { say: "Am I alive?" }, id: "q-1" });
    await settle();
    expect(answersOf(since(ws.ann))).toEqual([{ t: "ack", id: "q-1" }]);
    // The snapshot first, then the answer, both once the input was saved.
    expect(order.filter(([t]) => t === "snap" || t === "ack")).toEqual([
      ["snap", 1],
      ["ack", 1],
    ]);
    for (const w of [ws.bo, ws.screen]) {
      expect(answersOf(since(w))).toEqual([]);
      expect(since(w).filter((m) => m.t === "snap").map((m) => m.s.moves)).toEqual([1]);
    }
  });

  it("is answered with the game's error when it is turned down, after the sender's fresh snapshot", async () => {
    const { ctx, say, ws } = await started(turnGame());
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "in", d: { say: "Me first?" }, id: 9 });
    await settle();
    expect(answersOf(since(ws.bo))).toEqual([{ t: "error", id: 9, error: "not_your_turn", message: "It is not your turn." }]);
    expect(since(ws.bo).map((m) => m.t)).toEqual(["snap", "error"]);
    // Nothing moved, so nobody else hears of it (party-room-review.test.js, N4, for one that moved something).
    for (const w of [ws.ann, ws.screen]) expect(since(w)).toEqual([]);
    expect(ctx.room.core.activity.state.moves).toEqual([]);
  });

  it("is answered with the room's error when the room does not take it, and no game frame goes out", async () => {
    const game = turnGame();
    const { ctx, connect, say, ws } = await started(game);
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    ws.cy = await connect(cy.token);
    const since = from(...Object.values(ws));
    say(ws.screen, { t: "in", d: { say: "Screen?" }, id: "s" });
    say(ws.cy, { t: "in", d: { say: "Me?" }, id: "c" });
    await settle();
    expect(answersOf(since(ws.screen))).toEqual([{ t: "error", id: "s", error: "not_in_game", message: "That seat is not playing this game." }]);
    expect(answersOf(since(ws.cy))).toEqual([{ t: "error", id: "c", error: "not_in_game", message: "That seat is not playing this game." }]);
    expect(game.calls.input).toBe(0);
    for (const w of Object.values(ws)) expect(since(w).filter((m) => m.t === "snap" || m.t === "ev")).toEqual([]);
  });

  it("sent again from the same seat is answered the same way and not applied twice; another seat's same id is its own", async () => {
    const game = turnGame();
    const { ctx, say, ws } = await started(game);
    say(ws.ann, { t: "in", d: { say: "Am I alive?" }, id: "x" });
    await settle();
    say(ws.bo, { t: "in", d: { say: "Yes." }, id: "x" });
    await settle();
    expect(game.calls.input).toBe(2);
    const since = from(ws.ann, ws.bo, ws.screen);
    const saved = structuredClone(ctx.store.get("lobby"));
    // Ann's phone sends "x" again (a retry after a reconnect): the first answer, the game as it is now, and nothing else for anyone.
    say(ws.ann, { t: "in", d: { say: "Am I alive?" }, id: "x" });
    await settle();
    expect(game.calls.input).toBe(2);
    expect(ctx.room.core.activity.state.moves).toHaveLength(2);
    expect(since(ws.ann).map((m) => m.t)).toEqual(["snap", "ack"]);
    expect(since(ws.ann)[0].s).toMatchObject({ moves: 2, you: 0 });
    for (const w of [ws.bo, ws.screen]) expect(since(w)).toEqual([]);
    expect(ctx.store.get("lobby")).toEqual(saved);

    // A refusal is kept as a refusal: Bo's out-of-turn input sent twice is refused twice, applied never.
    say(ws.bo, { t: "in", d: { say: "Again" }, id: "y" });
    await settle();
    say(ws.bo, { t: "in", d: { say: "Again" }, id: "y" });
    await settle();
    expect(answersOf(ws.bo.messages()).filter((m) => m.id === "y")).toEqual([
      { t: "error", id: "y", error: "not_your_turn", message: "It is not your turn." },
      { t: "error", id: "y", error: "not_your_turn", message: "It is not your turn." },
    ]);
    expect(game.calls.input).toBe(3);
  });

  it("is remembered through a rebuild of the room over the same storage", async () => {
    const game = turnGame({ own: true });
    const { ctx, connect, say, sleepAndWake, ws, tokens } = await started(game);
    say(ws.ann, { t: "in", d: { say: "Am I a bird?" }, id: "q-1" });
    await settle();
    expect(ctx.store.get("lobby").game.answers).toEqual({ 0: [["s:q-1", { ok: true }, expect.stringMatching(/^[0-9a-f]{8}$/)]] });
    await sleepAndWake();
    // Ann's phone came back on a new socket and sends what it never heard answered.
    const wsAnn2 = await connect(tokens.ann);
    say(wsAnn2, { t: "in", d: { say: "Am I a bird?" }, id: "q-1" });
    await settle();
    expect(answersOf(wsAnn2.messages())).toEqual([{ t: "ack", id: "q-1" }]);
    expect(game.calls.input).toBe(1);
    expect(ctx.room.core.activity.state.moves).toHaveLength(1);
    // And a new id after the wake is applied as usual.
    say(ws.bo, { t: "in", d: { say: "No." }, id: "a-1" });
    await settle();
    expect(answersOf(ws.bo.messages())).toEqual([{ t: "ack", id: "a-1" }]);
    expect(ctx.room.core.activity.state.moves).toHaveLength(2);
  });

  it("that won the game, sent again just after, is answered ack, not refused, also after a rebuild", async () => {
    const game = turnGame();
    const { ctx, say, sleepAndWake, ws } = await started(game);
    say(ws.ann, { t: "in", d: { say: "I am an owl", win: true }, id: "win" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const got = ws.ann.messages();
    // The last snapshot, the end, then the answer.
    expect(got.findIndex((m) => m.t === "end")).toBeLessThan(got.findIndex((m) => m.t === "ack"));
    await sleepAndWake();
    const since = from(ws.ann, ws.bo);
    say(ws.ann, { t: "in", d: { say: "I am an owl", win: true }, id: "win" });
    say(ws.ann, { t: "in", d: { say: "?" }, id: "other" });
    await settle();
    expect(answersOf(since(ws.ann))).toEqual([
      { t: "ack", id: "win" },
      { t: "error", id: "other", error: "not_playing", message: "No turn-based game is being played." },
    ]);
    expect(since(ws.bo)).toEqual([]);
    expect(game.calls.input).toBe(1);
    expect(ctx.room.core.members[0].points).toBe(3);
  });

  it("without an id is not answered, as before", async () => {
    const { say, ws } = await started(turnGame());
    say(ws.ann, { t: "in", d: { say: "Hi" } });
    say(ws.bo, { t: "in", d: { say: "Out of turn" } });
    await settle();
    for (const w of [ws.ann, ws.bo]) expect(answersOf(w.messages())).toEqual([]);
  });
});

describe("a ticking game", () => {
  it("takes an input with an id as fire and forget: applied once, answered never", async () => {
    const inputs = [];
    const game = {
      id: "ticker",
      minSeats: 2,
      maxSeats: 2,
      tickHz: 10,
      create: ({ seats }) => ({ seats: seats.map((s) => s.seat), ticks: 0 }),
      input: (state, seat, data) => {
        inputs.push([seat, data]);
        return { ok: false, error: "never sent" };
      },
      tick: (state) => void (state.ticks += 1),
      snapshot: (state) => ({ ticks: state.ticks }),
      isOver: (state) => state.ticks >= 50,
    };
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token) };
    await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
    say(ws.ann, { t: "in", d: { fire: 1 }, id: "f" });
    say(ws.ann, { t: "in", d: { fire: 1 }, id: "f" });
    await vi.advanceTimersByTimeAsync(200);
    expect(inputs).toEqual([
      [0, { fire: 1 }],
      [0, { fire: 1 }],
    ]);
    expect(answersOf(ws.ann.messages())).toEqual([]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(ctx.room.core.activity.kind).toBe("lobby");
  });
});
