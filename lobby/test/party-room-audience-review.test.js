// What an independent review of the party room's audience work (W6) found, each proved on the
// real Durable Object class before it was fixed: pieces that jumped back after a sleep, a second
// socket of someone who left, a moving piece taking a spot, and the spot step's sums.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, voteTo, walkTo } from "./fake-room.js";
import { SETTINGS_FIELDS, spotsFor4, standOn, turnGame } from "./turn-game.js";
import { SETTINGS_MS } from "../server/lobby-core.js";
import { boxCentre, posAt, spawnX } from "../shared/world.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const spots = (game, opts) => spotsFor4(createLobbyRoom, game, opts);
const roomOf = (ws) => ws.messages().filter((m) => m.room).at(-1)?.room;

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a spot step that ends by itself, then a sleep", () => {
  it("keeps every piece by the door with the room's rev, so the page's next move is taken and nobody jumps back into a light", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    // Cy stands on the first spot; the second stays empty, so the time limit ends the step.
    await standOn(r, ws.cy, 2, 0);
    await vi.advanceTimersByTimeAsync(SETTINGS_MS);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const n = ctx.room.core.boxes.length;
    const seen = roomOf(ws.cy).members;
    expect(seen.map((m) => m.x)).toEqual([0, 1, 2, 3].map((seat) => spawnX(seat, n)));

    // The room sleeps and wakes with the same sockets.
    await r.sleepAndWake();
    const core = ctx.room.core;
    for (const seat of [0, 1, 2, 3]) expect(core.members[seat]).toMatchObject({ x: seen[seat].x, rev: seen[seat].rev });
    expect(Object.values(core.standing(Date.now()))).toEqual([null, null, null, null]);

    // Cy's page walks on from where it was told her piece is: the room takes it and passes it on.
    const before = ws.ann.frames.length;
    say(ws.cy, { t: "m", x: seen[2].x + 20, d: 1, r: seen[2].rev });
    await settle();
    expect(core.members[2]).toMatchObject({ x: seen[2].x + 20, d: 1 });
    expect(ws.ann.frames.slice(before).map((f) => JSON.parse(f))).toContainEqual({ t: "m", s: 2, x: seen[2].x + 20, d: 1 });
    // At the next room view, nobody stands in a light.
    expect(Object.values(core.voteView(Date.now()).standing)).toEqual([null, null, null, null]);
  });
});

describe("someone with two sockets who leaves", () => {
  it("has every socket of theirs closed, so none of them sees or plays as a newcomer in that seat", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    // Cy has the room open twice (a second tab); she leaves from the first.
    const cy2 = await r.connect(r.tokens.cy);
    await settle();
    say(ws.cy, { t: "leave" });
    await settle();
    expect(ws.cy.closed).toMatchObject({ code: 1000, reason: "left" });
    expect(cy2.closed).toMatchObject({ code: 4003, reason: "left" });
    expect((await ctx.room.debug()).sockets).toBe(4);

    // Ed joins in her seat: her other socket hears nothing of him and cannot walk his piece.
    const ed = await ctx.room.join({ nickname: "Ed", as: "player" });
    expect(ed.seat).toBe(2);
    await r.connect(ed.token);
    await settle();
    const heard = cy2.frames.length;
    const x = ctx.room.core.members[2].x;
    say(cy2, { t: "m", x: x + 20, d: 0, r: ctx.room.core.members[2].rev });
    await settle();
    expect(ctx.room.core.members[2].x).toBe(x);
    expect(cy2.frames.length).toBe(heard);
  });

  it("is closed on every socket when one of them floods", async () => {
    const r = await spots(turnGame());
    const { ctx, ws } = r;
    const cy2 = await r.connect(r.tokens.cy);
    await settle();
    for (let i = 0; i < 200 && !ws.cy.closed; i++) ctx.room.webSocketMessage(ws.cy, "not json");
    await settle();
    expect(ws.cy.closed).toMatchObject({ code: 4008 });
    expect(cy2.closed).toMatchObject({ code: 4003 });
    expect(ctx.room.core.members[2]).toBeNull();
  });
});

describe("a piece walking across a spot", () => {
  it("does not take it; one that stops in its light does, and keeps it while it moves inside the light", async () => {
    const r = await spots(turnGame());
    const { ctx, say, ws } = r;
    const core = ctx.room.core;
    const n = core.boxes.length;
    const centre = boxCentre(0, n);
    // Cy walks up to the first spot's light, still out of it.
    await walkTo(say, ctx, ws.cy, 2, centre + 160);
    expect(core.activity.spots.map((s) => s.seat)).toEqual([null, null]);
    // She walks on through it: the room hears her inside the light, walking.
    say(ws.cy, { t: "m", x: centre, d: -1, r: core.members[2].rev });
    await settle();
    expect(core.standing(Date.now())[2]).toBe("turns");
    expect(core.activity.spots.map((s) => s.seat)).toEqual([null, null]);
    // She stops there: the spot is hers.
    say(ws.cy, { t: "m", x: Math.round(posAt(core.members[2], Date.now())), d: 0, r: core.members[2].rev });
    await settle();
    expect(core.activity.spots.map((s) => s.seat)).toEqual([2, null]);
    // She moves a step inside the light: she keeps it.
    say(ws.cy, { t: "m", x: Math.round(core.members[2].x), d: 1, r: core.members[2].rev });
    await settle();
    expect(core.activity.spots.map((s) => s.seat)).toEqual([2, null]);
  });
});

describe("a wall too small for spots", () => {
  it("seats only the game's first seats by seat, also for a game with settings", async () => {
    const game = turnGame({ settings: true });
    // One light on the wall: two spots cannot be offered.
    const r = await openRoom(createLobbyRoom, game, { manifest: { audience: true, settings: SETTINGS_FIELDS } });
    const { ctx, say } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const tokens = [ann];
    for (const nickname of ["Bo", "Cy", "Di"]) tokens.push(await ctx.room.join({ nickname, as: "player" }));
    const ws = [];
    for (const t of tokens) ws.push(await r.connect(t.token));
    await voteTo(r, "settings", ...ws.map((w, seat) => [w, seat]));
    expect(ctx.room.core.activity).not.toHaveProperty("spots");
    expect(ctx.room.core.activity.seats).toEqual([0, 1]);
    say(ws[0], { t: "settings-start" });
    await settle();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    expect(game.calls.created.at(-1).seats.map((s) => s.seat)).toEqual([0, 1]);
    expect(ctx.room.core.viewerOf({ role: "player", seat: 3 })).toEqual({ role: "audience", seat: 3 });
  });
});

describe("the spot step's sums", () => {
  it("counts the phones that are here: a party of three with one dropped plays a two-seat game at once, with the two who are here", async () => {
    const game = turnGame();
    const r = await openRoom(createLobbyRoom, game, { more: 2, manifest: { audience: true } });
    const { ctx } = r;
    ctx.keepAlive = true;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const ws = { ann: await r.connect(ann.token), bo: await r.connect(bo.token), cy: await r.connect(cy.token) };
    await settle();
    // Ann's phone drops; her grey piece is still in the party.
    ctx.room.webSocketClose(ws.ann, 1006, "");
    await settle();
    expect(ctx.room.core.present()).toHaveLength(3);
    await voteTo(r, "game", [ws.bo, 1], [ws.cy, 2]);
    expect(ctx.room.core.activity).not.toHaveProperty("spots");
    expect(ctx.room.core.activity.seats).toEqual([1, 2]);
  });

  it("ends the step at once when fewer members are left than there are spots", async () => {
    const r = await spots(turnGame({ fields: { maxSeats: 3 } }), { players: { min: 2, max: 3 } });
    const { ctx, say, ws } = r;
    expect(ctx.room.core.activity.spots).toHaveLength(3);
    say(ws.cy, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("settings");
    // Two are left for three spots: the step can never fill, so it ends now and says why.
    say(ws.di, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ws.ann.messages().filter((m) => m.t === "note" && m.k === "cancelled")).toMatchObject([{ text: "Not enough players are left for turns, so it did not start." }]);
  });
});

describe("a page back from a drop across a match boundary", () => {
  it("puts away the view of the match it was showing and mounts the one being played, as who it is in that one", async () => {
    const { stageKey, stageStale } = await import("../shared/stage.js");
    const match = (round, seats) => ({ phase: "playing", game: { id: "turns", name: "turns", round, turns: true, seats, audience: true } });
    // Mounted for round 1, in which seat 2 watched.
    const key = stageKey(match(1, [0, 1]).game);
    expect(stageStale(key, match(1, [0, 1]))).toBe(false);
    // Back after the rematch began, in which seat 2 plays: the old view goes.
    expect(stageStale(key, match(2, [1, 2]))).toBe(true);
    // Another game, or no game any more.
    expect(stageStale(key, { phase: "playing", game: { id: "cork-and-bell", round: 1 } })).toBe(true);
    expect(stageStale(key, { phase: "lobby", game: null })).toBe(true);
    expect(stageStale(null, match(2, [1, 2]))).toBe(false);

    // The page wires it: a stale stage is put away before the next snapshot mounts a fresh one.
    const { readFileSync } = await import("node:fs");
    const main = readFileSync(new URL("../public/main.js", import.meta.url), "utf8");
    expect(main).toMatch(/if \(stage && stageStale\(stage\.key, room\)\) endStage\(\);/);
    expect(main).toMatch(/key: stageKey\(room\.game\)/);
  });
});
