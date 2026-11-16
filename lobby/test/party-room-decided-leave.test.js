// A match the game has already decided keeps its real result on the room's card, whoever leaves
// before the card is shown, proved on the real Durable Object class with the Who Am I?-shaped
// test game (turn-game.js, `firstTo`). Who Am I? is first to 3: once a seat has 3 the match
// summary is up ("Match over") and the game reports `isOver` only after a tap on "See final
// results". A player who leaves the party in between ends the game through `abandon`, which
// returns the decided standings and result; the card shows them all, the one who left included,
// and reads as a finished match. A match still being played, or a phone whose grace runs out
// before the match is decided, ends early as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_GRACE_MS } from "../server/lobby-core.js";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
import { from, started as startedIn, turnGame } from "./turn-game.js";

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
const notesOf = (got) => got.filter((m) => m.t === "note");
const endOf = (got) => got.find((m) => m.t === "end");
const colour = expect.any(String);

/** Each seat in `order` says something in turn; those in `scorers` score a point with it. */
async function play(say, ws, order, scorers) {
  for (const who of order) {
    say(ws[who], { t: "in", d: { say: `${who} asks`, point: scorers.includes(who) } });
    await settle();
  }
}

/** Ann wins 3-0 against Bo: the match is decided and its summary is up, but it is not over yet. */
async function annWins3to0(r) {
  await play(r.say, r.ws, ["ann", "bo", "ann", "bo", "ann"], ["ann"]);
  const state = r.ctx.room.core.activity.state;
  expect(state).toMatchObject({ decided: true, winner: null, scores: { 0: 3, 1: 0 } });
  expect(r.ctx.room.core.activity.kind).toBe("game");
}

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a decided match whose player leaves before the card", () => {
  it("keeps the winner who left on the card, in first place with its score, and the one who stayed second", async () => {
    const game = turnGame({ firstTo: 3 });
    const r = await started(game);
    const { ctx, say, ws } = r;
    await annWins3to0(r);
    const since = from(ws.bo, ws.screen);
    say(ws.ann, { t: "leave" });
    await settle();
    expect(game.calls.abandon).toMatchObject([{ seat: 0, decided: true }]);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.bo, ws.screen]) {
      const got = since(w);
      const end = endOf(got);
      expect(end.result).toEqual([
        { seat: 0, score: 3 },
        { seat: 1, score: 0 },
      ]);
      expect(end.last.rows).toEqual([
        { seat: 0, name: "Ann", colour, place: 1, points: 3, score: 3 },
        { seat: 1, name: "Bo", colour, place: 2, points: 2, score: 0 },
      ]);
      // A finished match: nothing on the card, and no note, says it ended because Ann left.
      expect(end.last).not.toHaveProperty("early");
      expect(notesOf(got).map((n) => [n.k, n.name])).toEqual([["left", "Ann"]]);
      expect(end.room.tonight).toMatchObject({ games: 1, played: [{ name: "turns", winners: [{ name: "Ann" }] }] });
      // The view's card says the same.
      expect(end.room.last).toMatchObject({ rows: [{ seat: 0, name: "Ann", place: 1 }, { seat: 1, name: "Bo", place: 2 }] });
      expect(end.room.last).not.toHaveProperty("early");
    }
    // Bo has the points second place earns; Ann's are kept for her name, as for anyone who leaves.
    expect(ctx.room.core.members[1].points).toBe(2);
    expect(ctx.room.core.members[0]).toBeNull();
    expect(ctx.room.core.remembered.get("ann")).toBe(3);
    const back = await ctx.room.join({ nickname: "Ann", as: "player" });
    expect(back.ok).not.toBe(false);
    expect(ctx.room.core.present().find((m) => m.name === "Ann").points).toBe(3);
  });

  it("keeps the loser who left on the card in second place, and the winner first", async () => {
    const game = turnGame({ firstTo: 3 });
    const r = await started(game);
    const { ctx, say, ws } = r;
    await annWins3to0(r);
    const since = from(ws.ann, ws.screen);
    say(ws.bo, { t: "leave" });
    await settle();
    for (const w of [ws.ann, ws.screen]) {
      const end = endOf(since(w));
      expect(end.last.rows).toEqual([
        { seat: 0, name: "Ann", colour, place: 1, points: 3, score: 3 },
        { seat: 1, name: "Bo", colour, place: 2, points: 2, score: 0 },
      ]);
      expect(end.last).not.toHaveProperty("early");
    }
    expect(ctx.room.core.members[0].points).toBe(3);
    expect(ctx.room.core.remembered.get("bo")).toBe(2);
  });

  it("ends early as before when a player leaves a match still being played: the game's verdict, the early line", async () => {
    const game = turnGame({ firstTo: 3 });
    const r = await started(game);
    const { ctx, say, ws } = r;
    // Ann leads 2-0 when she leaves: the match is not decided, so Bo wins it by her forfeit.
    await play(say, ws, ["ann", "bo", "ann", "bo"], ["ann"]);
    const since = from(ws.bo, ws.screen);
    say(ws.ann, { t: "leave" });
    await settle();
    expect(game.calls.abandon).toMatchObject([{ seat: 0, decided: false }]);
    for (const w of [ws.bo, ws.screen]) {
      const got = since(w);
      const end = endOf(got);
      expect(end.result).toEqual({ winnerSeat: 1, abandonedBy: 0 });
      expect(end.last.rows).toEqual([{ seat: 1, name: "Bo", colour, place: 1, points: 3 }]);
      expect(end.last.early).toEqual({ seat: 0, name: "Ann", why: "left", text: "Ann left the party, so turns ended." });
      expect(notesOf(got).map((n) => [n.k, n.name])).toEqual([
        ["left", "Ann"],
        ["ended", "Ann"],
      ]);
    }
    expect(ctx.room.core.members[1].points).toBe(3);
    expect(ctx.room.core.remembered.has("ann")).toBe(false);
  });

  it("ends early as before when a phone's grace runs out in a match still being played: a forfeit", async () => {
    const game = turnGame({ firstTo: 3 });
    const r = await started(game);
    const { ctx, say, ws } = r;
    await play(say, ws, ["ann", "bo"], ["bo"]);
    const since = from(ws.ann, ws.screen);
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS);
    expect(game.calls.abandon).toMatchObject([{ seat: 1, decided: false }]);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    for (const w of [ws.ann, ws.screen]) {
      const end = endOf(since(w));
      expect(end.result).toEqual({ winnerSeat: 0, abandonedBy: 1 });
      expect(end.last.rows).toEqual([{ seat: 0, name: "Ann", colour, place: 1, points: 3 }]);
      expect(end.last.early).toMatchObject({ seat: 1, name: "Bo", why: "gone", text: "Bo did not come back, so turns ended." });
    }
  });

  it("keeps all three on the card when one of three leaves a decided match", async () => {
    const game = turnGame({ firstTo: 2, seats: 3 });
    const r = await openRoom(createLobbyRoom, game, { players: { min: 2, max: 3 } });
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token), cy: await connect(cy.token) };
    await voteIn(r, [ws.ann, 0], [ws.bo, 1], [ws.cy, 2]);
    await settle();
    expect(ctx.room.core.activity.seats).toEqual([0, 1, 2]);
    // Bo 2, Cy 1, Ann 0: Bo has decided it, and Cy (second) leaves on the summary.
    await play(say, ws, ["ann", "bo", "cy", "ann", "bo"], ["bo", "cy"]);
    expect(ctx.room.core.activity.state).toMatchObject({ decided: true, scores: { 0: 0, 1: 2, 2: 1 } });
    const since = from(ws.ann, ws.bo);
    say(ws.cy, { t: "leave" });
    await settle();
    for (const w of [ws.ann, ws.bo]) {
      const end = endOf(since(w));
      expect(end.last.rows).toEqual([
        { seat: 1, name: "Bo", colour, place: 1, points: 3, score: 2 },
        { seat: 2, name: "Cy", colour, place: 2, points: 2, score: 1 },
        { seat: 0, name: "Ann", colour, place: 3, points: 1, score: 0 },
      ]);
      expect(end.last).not.toHaveProperty("early");
    }
    expect(ctx.room.core.members.map((m) => m?.points ?? null)).toEqual([1, 3, null, null]);
    expect(ctx.room.core.remembered.get("cy")).toBe(2);
  });

  it("still shows the decided card, the one who left included, after the room sleeps and wakes", async () => {
    const game = turnGame({ firstTo: 3, own: true });
    const r = await started(game);
    const { ctx, connect, say, sleepAndWake, ws, tokens } = r;
    await annWins3to0(r);
    say(ws.ann, { t: "leave" });
    await settle();
    await sleepAndWake();
    const core = ctx.room.core;
    expect(core.last).toMatchObject({ rows: [{ seat: 0, name: "Ann", place: 1, points: 3, score: 3 }, { seat: 1, name: "Bo", place: 2, points: 2, score: 0 }] });
    expect(core.last).not.toHaveProperty("early");
    expect(core.remembered.get("ann")).toBe(3);
    const bo2 = await connect(tokens.bo);
    await settle();
    const view = bo2.messages().find((m) => m.t === "hello" || m.t === "room");
    const room = view.room ?? view;
    expect(room.last).toMatchObject({ rows: [{ name: "Ann", place: 1 }, { name: "Bo", place: 2 }] });
    expect(room.last).not.toHaveProperty("early");
    expect(room.members[1]).toMatchObject({ name: "Bo", points: 2 });
  });
});
