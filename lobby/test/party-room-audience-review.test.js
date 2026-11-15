// What an independent review of the party room's audience work (W6) found, each proved on the
// real Durable Object class before it was fixed: pieces that jumped back after a sleep, a second
// socket of someone who left, a moving piece taking a spot, and the spot step's sums.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, voteTo, walkTo } from "./fake-room.js";
import { SETTINGS_FIELDS, spotsFor4, standOn, turnGame } from "./turn-game.js";
import { SETTINGS_MS } from "../server/lobby-core.js";
import { SETTLE_MS } from "../shared/vote.js";
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

describe("what the pages say during a spot step", () => {
  const members = [
    { seat: 0, name: "Ann", colour: "#a00" },
    { seat: 1, name: "Bo", colour: "#0a0" },
    { seat: 2, name: "Cy", colour: "#00a" },
    { seat: 3, name: "Di", colour: "#aa0" },
  ];
  const boxes = [
    { id: "turns", name: "Who Am I?" },
    { id: "soon-0", name: "Soon 0" },
  ];
  const stepRoom = (spots, fields = []) => ({ phase: "settings", members, boxes, screens: 1, choosing: { id: "turns", name: "Who Am I?", by: 0, fields, picks: {}, seats: spots.filter((s) => s.seat !== null).map((s) => s.seat), spots, endsIn: 60_000, of: 90_000 } });
  const stepVote = (standing) => ({ standing, waiting: [], leaders: [], count: null, toss: null, lights: {} });

  it("tells a player on a spot which player they are, not the name of the box under it, and the big screen who plays", async () => {
    const { playerLine, statusLine } = await import("../shared/status.js");
    const room = stepRoom([
      { place: "turns", seat: 0 },
      { place: "soon-0", seat: 1 },
    ]);
    const vote = stepVote({ 0: "turns", 1: "soon-0", 2: null, 3: null });
    expect(playerLine(room, vote, 1)).toEqual({ label: "You are", vote: "Player 2", voted: true, rest: "Ann starts the game" });
    expect(playerLine(room, vote, 0)).toEqual({ label: "You are", vote: "Player 1", voted: true, rest: "You start the game" });
    expect(playerLine(room, vote, 2)).toMatchObject({ label: "You are", vote: "watching", voted: false });
    // Standing in a spot someone else holds is not playing.
    expect(playerLine(room, stepVote({ 0: "turns", 1: "soon-0", 2: "soon-0" }), 2)).toMatchObject({ vote: "watching", voted: false });
    expect(statusLine(room, vote)).toEqual({ chip: "WHO PLAYS", main: "Stand in a lit spot to play Who Am I?", sub: "Ann starts it once every spot is taken.", waiting: [] });
    // With settings as well, the big screen still says how to take a spot first, and who chooses the settings.
    expect(statusLine(stepRoom(room.choosing.spots, [{ key: "pace", label: "Pace", options: [] }]), vote)).toEqual({ chip: "WHO PLAYS", main: "Stand in a lit spot to play Who Am I?", sub: "Ann is choosing the settings.", waiting: [] });
  });

  it("says on the card that an open spot sends everyone back when time runs out, and leaves an open select alone when only the spots change", async () => {
    const { cardKey, timeLine } = await import("../public/settings-step.js");
    const open = stepRoom([
      { place: "turns", seat: 0 },
      { place: "soon-0", seat: null },
    ]).choosing;
    const full = { ...open, spots: [{ place: "turns", seat: 0 }, { place: "soon-0", seat: 3 }] };
    expect(timeLine("Ann is choosing.", open.spots, 90_000)).toBe("Ann is choosing. Back to the room in 1:30 unless every spot is taken.");
    expect(timeLine("Ann is choosing.", full.spots, 90_000)).toBe("Ann is choosing. Starts by itself in 1:30.");
    expect(timeLine("Ann is choosing.", null, 5_000)).toBe("Ann is choosing. Starts by itself in 0:05.");
    // Who stands on the spots is not part of what rebuilds the card.
    expect(cardKey(open, true)).toBe(cardKey(full, true));
    expect(cardKey(open, true)).not.toBe(cardKey({ ...open, picks: { pace: 60 } }, true));
  });

  it("lights no spot gold: the room sends no leaders while players are chosen on spots", async () => {
    const r = await spots(turnGame());
    await standOn(r, r.ws.cy, 2, 0);
    expect(r.ctx.room.core.voteView(Date.now()).leaders).toEqual([]);
    expect(roomOf(r.ws.screen).vote.leaders).toEqual([]);
  });

  it("tells players only of the game's seats being away, never of its audience", async () => {
    const { awayOthers } = await import("../public/connection.js");
    const room = { game: { id: "turns", round: 1, seats: [0, 1], audience: true }, members: [{ seat: 0, name: "Ann", away: true }, { seat: 1, name: "Bo" }, { seat: 2, name: "Cy", away: true }, null] };
    expect(awayOthers(room, { role: "player", seat: 1 }).map((m) => m.name)).toEqual(["Ann"]);
    expect(awayOthers(room, { role: "player", seat: 0 })).toEqual([]);
    expect(awayOthers(room, { role: "screen", seat: -1 }).map((m) => m.name)).toEqual(["Ann"]);
    // A game with no audience: everyone away is said, as before.
    expect(awayOthers({ ...room, game: { id: "turns", round: 1, turns: true } }, { role: "player", seat: 1 }).map((m) => m.name)).toEqual(["Ann", "Cy"]);
  });
});

/** The two on spots `a` and `b` (by name in r.ws, with their seats) take them and Ann starts; returns each seat's secret. */
async function playOn(r, [a, seatA], [b, seatB]) {
  await standOn(r, r.ws[a], seatA, 0);
  await standOn(r, r.ws[b], seatB, 1);
  r.say(r.ws.ann, { t: "settings-start" });
  await settle();
  expect(r.ctx.room.core.activity).toMatchObject({ kind: "game", seats: [seatA, seatB].sort() });
  return r.ctx.room.core.activity.state.secrets;
}

/** Each viewer's game frames hold exactly what its role may see: `text(who)` is what that socket got. */
function expectSecrets(text, secrets, { players, audience }) {
  for (const [who, seat] of players) {
    const other = players.find(([, s]) => s !== seat)[1];
    expect(text(who)).not.toContain(secrets[seat]);
    expect(text(who)).toContain(secrets[other]);
  }
  for (const who of audience) for (const [, seat] of players) expect(text(who)).toContain(secrets[seat]);
  for (const [, seat] of players) expect(text("screen")).not.toContain(secrets[seat]);
}

describe("roles across a rematch and a reconnect", () => {
  it("a former audience member who now plays never gets their own secret, and a former player who now watches gets both", async () => {
    const r = await spots(turnGame({ presence: true }));
    const { ctx, say, ws } = r;
    const first = await playOn(r, ["ann", 0], ["bo", 1]);
    expectSecrets((w) => ws[w].text(), first, { players: [["ann", 0], ["bo", 1]], audience: ["cy", "di"] });
    say(ws.ann, { t: "in", d: { say: "got it", win: true } });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");

    // The rematch: Cy and Di take the spots, Ann and Bo watch.
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await voteTo(r, "settings", [ws.ann, 0], [ws.bo, 1], [ws.cy, 2], [ws.di, 3]);
    await settle();
    const at = new Map(Object.values(ws).map((w) => [w, w.frames.length]));
    const second = await playOn(r, ["cy", 2], ["di", 3]);
    say(ws.cy, { t: "in", d: { say: "is it a cat?" } });
    await settle();
    const since = (who) => ws[who].frames.slice(at.get(ws[who])).join("\n");
    expectSecrets(since, second, { players: [["cy", 2], ["di", 3]], audience: ["ann", "bo"] });
    // Over the whole night, Cy and Di never got their own.
    expect(ws.cy.text()).not.toContain(second[2]);
    expect(ws.di.text()).not.toContain(second[3]);
    for (const w of ["cy", "di"]) expect(since(w)).toMatch(/"you":\d/);
  });

  it("a player's own socket and an audience member's own socket, reconnecting mid-match, each get their own role's frames", async () => {
    const r = await spots(turnGame({ presence: true }));
    const { ctx, say, ws } = r;
    const secrets = await playOn(r, ["ann", 0], ["bo", 1]);
    // Ann (a player) and Cy (the audience) drop, and come back on new sockets.
    ctx.room.webSocketClose(ws.ann, 1006, "");
    ctx.room.webSocketClose(ws.cy, 1006, "");
    await settle();
    const back = { ...ws, ann: await r.connect(r.tokens.ann), cy: await r.connect(r.tokens.cy) };
    await settle();
    expect(back.ann.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 0 } });
    expect(back.ann.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { you: 0 } });
    expect(back.cy.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { audience: 2 } });
    say(back.ann, { t: "in", d: { say: "is it a dog?" } });
    await settle();
    const text = (who) => back[who].text();
    expect(text("ann")).not.toContain(secrets[0]);
    expect(text("ann")).toContain(secrets[1]);
    expect(text("cy")).toContain(secrets[0]);
    expect(text("cy")).toContain(secrets[1]);
    expect(text("screen")).not.toContain(secrets[0]);
    expect(text("screen")).not.toContain(secrets[1]);
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
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
