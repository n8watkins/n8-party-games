// The fixes from the review of the turn-based stack (#23 to #27), each proved on the real Durable
// Object class with the Who Am I?-shaped test game (turn-game.js). Numbers are the review's
// findings (F1 to F6) and notes (N1 to N8).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_ROOM_MS } from "../../party-kit/src/core/room-core.js";
import { BUDGET_CLOSE_MS, MAX_ROOM_LIFE_MS, TURN_GRACE_MS } from "../server/lobby-core.js";
import { dropFakeRuntime, eventsOf, openRoom, settle, useFakeRuntime, voteIn } from "./fake-room.js";
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
const HOUR = 60 * 60_000;
const answersOf = (got) => got.filter((m) => m.t === "ack" || m.t === "error");
const snapsOf = (got) => got.filter((m) => m.t === "snap").map((m) => m.s);

async function lose(ctx, ws) {
  ctx.room.webSocketClose(ws, 1006, "");
  await settle();
}

/** Ann and Bo voted into the game, with no big screen. */
async function twoPhones(game, opts) {
  const r = await openRoom(createLobbyRoom, game, opts);
  const { ctx, connect } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const ws = { ann: await connect(ann.token), bo: await connect(bo.token) };
  await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
  await settle();
  return { ...r, ws, tokens: { ann: ann.token, bo: bo.token } };
}

/** Every raw frame: a seat never gets its own secret, a screen gets none. */
function expectSecretsKept({ ann = [], bo = [], screens = [] }, secrets) {
  for (const ws of ann) for (const frame of ws.frames) expect(frame).not.toContain(secrets.ann);
  for (const ws of bo) for (const frame of ws.frames) expect(frame).not.toContain(secrets.bo);
  for (const ws of screens) expect(ws.text()).not.toContain("SECRET-");
}

let errors;
beforeEach(() => {
  useFakeRuntime();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(dropFakeRuntime);

describe("F1: an id used again for a different input", () => {
  it("is refused as id_reused and not applied, never acked; the same input again is still answered as before", async () => {
    const game = turnGame();
    const { ctx, connect, say, ws, tokens } = await started(game);
    say(ws.ann, { t: "in", d: { say: "one" }, id: 1 });
    await settle();
    say(ws.bo, { t: "in", d: { say: "two" }, id: 1 });
    await settle();
    // Ann reloads: her new page counts from 1 again.
    const wsAnn2 = await connect(tokens.ann);
    say(wsAnn2, { t: "in", d: { say: "three" }, id: 1 });
    await settle();
    expect(answersOf(wsAnn2.messages())).toEqual([{ t: "error", id: 1, error: "id_reused", message: expect.any(String) }]);
    expect(ctx.room.core.activity.state.moves.map((m) => m.say)).toEqual(["one", "two"]);
    expect(game.calls.input).toBe(2);
    say(wsAnn2, { t: "in", d: { say: "one" }, id: 1 });
    await settle();
    expect(answersOf(wsAnn2.messages()).at(-1)).toEqual({ t: "ack", id: 1 });
    expect(game.calls.input).toBe(2);
  });
});

describe("F2: a hosted game can send an id", () => {
  it("is given send(data, opts) and an id maker by the room's page", () => {
    const main = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
    expect(main).toMatch(/send: \(data, opts\) => link\.sendInput\(data, opts\)/);
    expect(main).toMatch(/inputId: \(\) => link\.nextInputId\(\)/);
  });
});

describe("F3: an empty room during a turn-based game", () => {
  it("lives through the default grace when both phones drop, and the game then ends", async () => {
    const { ctx, ws } = await twoPhones(turnGame({ presence: true }));
    await lose(ctx, ws.ann);
    await lose(ctx, ws.bo);
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS - 1);
    expect(ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.room.core?.activity.kind ?? "closed").not.toBe("game");
  });

  it("lives for the room's stale limit with an Infinity grace and no idleShutdownMs, and for idleShutdownMs when the game sets one", async () => {
    const first = await twoPhones(turnGame({ presence: true, fields: { reconnectGraceMs: Infinity } }));
    await lose(first.ctx, first.ws.ann);
    await lose(first.ctx, first.ws.bo);
    await vi.advanceTimersByTimeAsync(STALE_ROOM_MS - 1);
    expect(first.ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(first.ctx.room.core).toBeNull();

    const second = await twoPhones(turnGame({ presence: true, fields: { reconnectGraceMs: Infinity, idleShutdownMs: 5 * 60_000, staleRoomMs: HOUR } }));
    await lose(second.ctx, second.ws.ann);
    await lose(second.ctx, second.ws.bo);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(second.ctx.room.core?.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(second.ctx.room.core).toBeNull();
  });
});

describe("F4: a tick that leaves the deadline where it was", () => {
  it("is called once and the deadline ignored, logged once, until the next input", async () => {
    const game = turnGame();
    game.tick = (state) => {
      game.calls.tick += 1;
      return [];
    };
    const { ctx, say, ws } = await started(game);
    await vi.advanceTimersByTimeAsync(TURN_MS + 5000);
    expect(game.calls.tick).toBe(1);
    const rang = ctx.alarm.rang;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ctx.alarm.rang - rang).toBeLessThanOrEqual(1);
    expect(errors.mock.calls.filter(([m]) => String(m).includes("did not move its deadline"))).toHaveLength(1);
    // An input moves the deadline on: the game is timed again.
    say(ws.ann, { t: "in", d: { say: "Hi" } });
    await settle();
    expect(ctx.alarm.at).toBe(Date.now() + TURN_MS);
    await vi.advanceTimersByTimeAsync(TURN_MS);
    expect(game.calls.tick).toBe(2);
  });
});

describe("F5: a game callback that throws", () => {
  it("input: nothing it changed is kept, the sender is answered game_error, nobody gets a frame, and the same id may be sent again", async () => {
    const game = turnGame();
    const input = game.input;
    let broken = true;
    game.input = (state, seat, data, now) => {
      state.moves.push({ seat, say: "half" });
      if (broken) throw new Error("boom");
      state.moves.pop();
      return input(state, seat, data, now);
    };
    const { ctx, say, ws } = await started(game);
    const saved = structuredClone(ctx.store.get("lobby"));
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.ann, { t: "in", d: { say: "Hi" }, id: "a" });
    await settle();
    expect(answersOf(since(ws.ann))).toEqual([{ t: "error", id: "a", error: "game_error", message: expect.any(String) }]);
    expect(since(ws.ann).filter((m) => m.t !== "error")).toEqual([]);
    for (const w of [ws.bo, ws.screen]) expect(since(w)).toEqual([]);
    expect(ctx.room.core.activity.state.moves).toEqual([]);
    expect(ctx.store.get("lobby")).toEqual(saved);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("turns"), expect.any(Error));
    broken = false;
    say(ws.ann, { t: "in", d: { say: "Hi" }, id: "a" });
    await settle();
    expect(answersOf(ws.ann.messages()).at(-1)).toEqual({ t: "ack", id: "a" });
    expect(ctx.room.core.activity.state.moves).toEqual([{ seat: 0, say: "Hi" }]);
  });

  it("tick: the game ends with no points and a note, and the alarm does not keep ringing", async () => {
    const game = turnGame();
    game.tick = () => {
      throw new Error("tick broke");
    };
    const { ctx, ws } = await started(game);
    await vi.advanceTimersByTimeAsync(TURN_MS);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const got = ws.ann.messages();
    expect(got.find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ why: "error" });
    expect(got.find((m) => m.t === "end").last).toMatchObject({ rows: [], early: { why: "error" } });
    expect(ctx.room.core.gamesPlayed).toBe(0);
  });

  it("presence: on a wake, the room still wakes and the game ends with a note", async () => {
    const game = turnGame({ presence: true });
    const { ctx, sleepAndWake, ws } = await started(game);
    game.presence = () => {
      throw new Error("presence broke");
    };
    ws.ann.closed = { code: 1006, reason: "" };
    await sleepAndWake();
    expect(ctx.room.core).not.toBeNull();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ws.bo.messages().find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ why: "error" });
    expect(ctx.store.get("lobby")).toMatchObject({ game: null });
  });
});

describe("F6: a player's own message is never taken for silence", () => {
  it("applies and answers an input that arrives after more than the silent limit without a keep-alive", async () => {
    const game = turnGame();
    const { ctx, say, ws } = await started(game);
    ctx.keepAlive = false;
    await vi.advanceTimersByTimeAsync(26_000);
    say(ws.ann, { t: "in", d: { say: "Still here" }, id: "s" });
    await settle();
    expect(ws.ann.closed).toBeNull();
    expect(answersOf(ws.ann.messages())).toEqual([{ t: "ack", id: "s" }]);
    expect(ctx.room.core.activity.state.moves).toHaveLength(1);
  });
});

describe("N1: the note that says why a game ended", () => {
  it("comes before the last snapshot and the end", async () => {
    const { ctx, say, ws } = await started(turnGame());
    const since = from(ws.ann);
    say(ws.bo, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const kinds = since(ws.ann).map((m) => (m.t === "note" ? `note:${m.k}` : m.t));
    expect(kinds.indexOf("note:ended")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("note:ended")).toBeLessThan(kinds.indexOf("snap"));
    expect(kinds.indexOf("snap")).toBeLessThan(kinds.indexOf("end"));
  });
});

describe("N2: what presence says at the start", () => {
  it("is delivered with the start", async () => {
    const game = turnGame({ presence: true });
    const r = await openRoom(createLobbyRoom, game);
    const { ctx, connect, say } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const ws = { ann: await connect(ann.token), bo: await connect(bo.token) };
    say(ws.bo, { t: "away" });
    await settle();
    await voteIn(r, [ws.ann, 0], [ws.bo, 1]);
    await settle();
    expect(game.calls.presence).toMatchObject([{ seat: 1, away: true }]);
    expect(eventsOf(ws.ann)).toEqual([{ k: "missing", seat: 1 }]);
    const got = ws.ann.messages();
    expect(got.findIndex((m) => m.t === "start")).toBeLessThan(got.findIndex((m) => m.t === "ev"));
  });
});

describe("N3: what the game was told", () => {
  it("is saved even when presence says nothing changed", async () => {
    const game = turnGame({ fields: { presence: () => false } });
    const { ctx, ws } = await started(game);
    await lose(ctx, ws.bo);
    expect(ctx.store.get("lobby").game.told[1]).toEqual({ connected: false, away: false });
  });
});

describe("N4: an input the game turns down", () => {
  it("is not saved and gets a snapshot for the sender only, when it changed nothing", async () => {
    const { ctx, say, ws } = await started(turnGame());
    const saved = structuredClone(ctx.store.get("lobby"));
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "in", d: { say: "Out of turn" }, id: "x" });
    await settle();
    expect(ctx.store.get("lobby")).toEqual(saved);
    expect(since(ws.bo).map((m) => m.t)).toEqual(["snap", "error"]);
    for (const w of [ws.ann, ws.screen]) expect(since(w)).toEqual([]);
  });

  it("is saved and goes to everyone when it changed the state (a timed-out turn ended first)", async () => {
    const game = turnGame();
    const input = game.input;
    game.input = (state, seat, data, now) => {
      state.refusals = (state.refusals ?? 0) + 1;
      return input(state, seat, data, now);
    };
    const { ctx, say, ws } = await started(game);
    const since = from(ws.ann, ws.bo, ws.screen);
    say(ws.bo, { t: "in", d: { say: "Out of turn" } });
    await settle();
    expect(savedGame(ctx).refusals).toBe(1);
    for (const w of [ws.ann, ws.bo, ws.screen]) expect(snapsOf(since(w))).toHaveLength(1);
  });
});

describe("N5: the game's words in an answer", () => {
  it("are cut to a sensible length", async () => {
    const game = turnGame();
    game.input = () => ({ ok: false, error: "e".repeat(500), message: "m".repeat(5000) });
    const { say, ws } = await started(game);
    say(ws.ann, { t: "in", d: {}, id: "long" });
    await settle();
    const answer = answersOf(ws.ann.messages())[0];
    expect(answer.error.length).toBeLessThanOrEqual(64);
    expect(answer.message.length).toBeLessThanOrEqual(200);
  });
});

describe("N6: the room's four hours and a budget close during a turn-based game", () => {
  it("end the game with a note at the four hours, and the room closes", async () => {
    const game = turnGame({ presence: true, fields: { reconnectGraceMs: Infinity, staleRoomMs: 5 * HOUR } });
    const { ctx, say, ws } = await started(game);
    say(ws.ann, { t: "away" });
    await settle();
    const since = from(ws.bo);
    await vi.advanceTimersByTimeAsync(ctx.room.core.createdAt + MAX_ROOM_LIFE_MS - Date.now() - 1000);
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1000);
    expect(since(ws.bo).find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ why: "expired" });
    expect(ctx.room.core).toBeNull();
    expect(ws.bo.closed).toEqual({ code: 4000, reason: "room_expired" });
  });

  it("end the game with a note when the budget's close comes, and the room closes", async () => {
    const game = turnGame({ presence: true, fields: { reconnectGraceMs: Infinity, staleRoomMs: HOUR } });
    const { ctx, say, ws } = await started(game);
    say(ws.ann, { t: "away" });
    await settle();
    ctx.room.budgetSpent();
    await vi.advanceTimersByTimeAsync(BUDGET_CLOSE_MS - 1);
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.bo.messages().find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ why: "budget" });
    expect(ctx.room.core).toBeNull();
    expect(ws.bo.closed).toEqual({ code: 4000, reason: "allowance_spent" });
  });
});

describe("N7: secrets on every path that sends a game frame", () => {
  it("never reach their own seat or a screen: a repeated answer, presence, a wake's upkeep, abandon and the last snapshot", async () => {
    const game = turnGame({ presence: true, own: true });
    // Presence and abandon tell the seat still here the other one's secret, as a game might.
    const presence = game.presence;
    game.presence = (state, seat, report, now) => {
      const out = presence(state, seat, report, now);
      const other = state.seats.find((s) => s !== seat);
      return out && [...out, { k: "psst", only: other, secret: state.secrets[seat] }];
    };
    game.abandon = (state, seat) => {
      const other = state.seats.find((s) => s !== seat);
      return { standings: [{ seat: other, place: 1 }], events: [{ k: "psst", only: other, secret: state.secrets[seat] }] };
    };
    const { ctx, connect, say, sleepAndWake, ws, tokens, secrets } = await started(game);
    say(ws.ann, { t: "in", d: { say: "Q" }, id: "q" });
    await settle();
    say(ws.ann, { t: "in", d: { say: "Q" }, id: "q" });
    await settle();
    say(ws.bo, { t: "away" });
    await settle();
    say(ws.bo, { t: "back" });
    await settle();
    ws.ann.closed = { code: 1006, reason: "" };
    await sleepAndWake();
    const wsAnn2 = await connect(tokens.ann);
    await settle();
    say(ws.bo, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    // Every path above sent game frames: check that it did, then scan them all.
    expect(snapsOf(ws.bo.messages()).length).toBeGreaterThan(4);
    expect(eventsOf(wsAnn2).filter((e) => e.k === "psst").length).toBeGreaterThan(0);
    expectSecretsKept({ ann: [ws.ann, wsAnn2], bo: [ws.bo], screens: [ws.screen] }, secrets);
  });
});
