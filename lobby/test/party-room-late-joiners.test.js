// Someone who joins in the middle of a match sees no secrets until it ends (approved 2026-11-15),
// proved on the real Durable Object class. In a game with an audience (Who Am I?: each player must
// not see their own identity, the audience sees both), a player could open the room on a second
// phone or tab mid-match and, as its audience, read their own identity there. So a member who was
// not in the party when the room left the lobby for the match (the vote ended and the spot or
// settings step opened, or the game started at once) is given the big screen's view of that match,
// `{ role: "screen", seat }`, which carries no secrets; from the next match they are ordinary audience.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_FRAME, dropFakeRuntime, openRoom, settle, useFakeRuntime, voteIn, voteTo } from "./fake-room.js";
import { choosing, from, standOn, turnGame } from "./turn-game.js";
import { SETTLE_MS } from "../shared/vote.js";
import * as corkAndBell from "cork-and-bell";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const roomOf = (ws) => ws.messages().filter((m) => m.room).at(-1)?.room;
/** The game frames among these messages, as raw text, the way they went down the wire. */
const gameText = (msgs) => msgs.filter((m) => GAME_FRAME.test(JSON.stringify(m))).map((m) => JSON.stringify(m)).join("\n");

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

/**
 * A party of three (Ann, Bo, Cy) and a big screen, for a two-seat game with an audience, voted in:
 * the room is choosing its players on two spots, and seat 3 is free for someone who comes later.
 */
async function threeOnSpots(game) {
  const r = await openRoom(createLobbyRoom, game, { more: 2, manifest: { audience: true } });
  const { ctx, connect } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
  const screen = await ctx.room.join({ as: "screen" });
  const tokens = { ann: ann.token, bo: bo.token, cy: cy.token, screen: screen.token };
  const ws = {};
  for (const [who, token] of Object.entries(tokens)) ws[who] = await connect(token);
  await voteTo(r, "settings", [ws.ann, 0], [ws.bo, 1], [ws.cy, 2]);
  await settle();
  expect(ctx.room.core.activity.spots).toHaveLength(2);
  return { ...r, tokens, ws };
}

/** Ann (seat 0) and Bo (seat 1) take the spots and Ann starts. Returns each seat's secret. */
async function annAndBoPlay(r) {
  await standOn(r, r.ws.ann, 0, 0);
  await standOn(r, r.ws.bo, 1, 1);
  r.say(r.ws.ann, { t: "settings-start" });
  await settle();
  expect(r.ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
  return r.ctx.room.core.activity.state.secrets;
}

const expectNone = (text, secrets) => {
  for (const s of Object.values(secrets)) expect(text).not.toContain(s);
};
const expectBoth = (text, secrets) => {
  for (const s of Object.values(secrets)) expect(text).toContain(s);
};

describe("a player's second phone, opened in the middle of a match", () => {
  it("gets no identities for the whole match, across its own reconnect and a sleep, cannot play, and is ordinary audience in the rematch", async () => {
    const r = await threeOnSpots(turnGame({ presence: true }));
    const { ctx, say, ws, connect } = r;
    const secrets = await annAndBoPlay(r);

    // Ann opens the room again on a second phone: a new token, a free seat.
    const second = await ctx.room.join({ nickname: "Ann", as: "player" });
    expect(second.seat).toBe(3);
    let ann2 = await connect(second.token);
    await settle();
    const core = () => ctx.room.core;
    expect(core().viewerOf({ role: "player", seat: 3 })).toEqual({ role: "screen", seat: 3 });
    expect(ann2.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 3 } });
    expect(ann2.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { screen: true } });
    // The room view tells her page she watches this match as the big screen does.
    expect(roomOf(ann2).game).toMatchObject({ seats: [0, 1], audience: true, late: [3] });

    // The match goes on: Ann and Bo take turns (events whispered to each, fresh snapshots).
    say(ws.ann, { t: "in", d: { say: "is it a dog?" } });
    await settle();
    say(ws.bo, { t: "in", d: { say: "no" } });
    await settle();
    expectNone(ann2.text(), secrets);

    // She cannot play from it: an input is refused and changes nothing.
    const inputs = ctx.room.core.activity.state.moves.length;
    say(ann2, { t: "in", d: { say: "it's me", win: true }, id: "late-1" });
    await settle();
    expect(ann2.messages().at(-1)).toEqual({ t: "error", id: "late-1", error: "not_in_game", message: "That seat is not playing this game." });
    expect(ctx.room.core.activity.state.moves).toHaveLength(inputs);

    // Its connection drops and comes back on a new socket, and a second socket opens on the same token.
    ctx.room.webSocketClose(ann2, 1006, "");
    await settle();
    ann2 = await connect(second.token);
    const ann2b = await connect(second.token);
    await settle();
    for (const w of [ann2, ann2b]) expect(w.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { screen: true } });

    // Cy, in the party when the match began, drops and comes back: still the audience, both identities.
    ctx.room.webSocketClose(ws.cy, 1006, "");
    await settle();
    const cy = await connect(r.tokens.cy);
    await settle();
    expect(cy.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { audience: 2 } });
    expectBoth(cy.text(), secrets);

    // The room sleeps and wakes in the middle of the match: the mark is kept.
    await r.sleepAndWake();
    expect(core().viewerOf({ role: "player", seat: 3 })).toEqual({ role: "screen", seat: 3 });
    expect(core().viewerOf({ role: "player", seat: 2 })).toEqual({ role: "audience", seat: 2 });
    say(ws.ann, { t: "in", d: { say: "is it a cat?" } });
    await settle();
    // And its own reconnect after the wake.
    const ann2c = await connect(second.token);
    await settle();
    expect(ann2c.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { screen: true } });

    // Over the whole match: the second phone and the big screen got neither identity, the players
    // each the other's, the audience both.
    for (const w of [ann2, ann2b, ann2c, ws.screen]) expectNone(w.text(), secrets);
    expect(ws.ann.text()).not.toContain(secrets[0]);
    expect(ws.ann.text()).toContain(secrets[1]);
    expect(ws.bo.text()).not.toContain(secrets[1]);
    expect(ws.bo.text()).toContain(secrets[0]);
    expectBoth(cy.text(), secrets);
    expect(core().viewerOf({ role: "screen", seat: -1 })).toEqual({ role: "screen" });

    // The match ends: the mark goes with it.
    say(ws.bo, { t: "in", d: { say: "got it", win: true } });
    await settle();
    expect(core().activity).toEqual({ kind: "lobby" });
    expect(ann2c.messages().find((m) => m.t === "end")).toBeTruthy();
    expectNone(ann2c.text(), secrets);

    // The rematch: all four vote, Bo and Cy take the spots, Ann's two phones are its audience.
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const all = { ...ws, cy, ann2: ann2c };
    await voteTo(r, "settings", [all.ann, 0], [all.bo, 1], [all.cy, 2], [all.ann2, 3]);
    await settle();
    const since = from(all.ann2, all.screen);
    await standOn(r, all.bo, 1, 0);
    await standOn(r, all.cy, 2, 1);
    say(all.ann, { t: "settings-start" });
    await settle();
    expect(core().activity).toMatchObject({ kind: "game", seats: [1, 2] });
    const next = core().activity.state.secrets;
    expect(core().viewerOf({ role: "player", seat: 3 })).toEqual({ role: "audience", seat: 3 });
    expect(roomOf(all.ann2).game).not.toHaveProperty("late");
    expectBoth(gameText(since(all.ann2)), next);
    expectNone(gameText(since(all.screen)), next);
  });
});

describe("someone who joins during the spot step", () => {
  it("counts as late when they do not play: the mark is kept through a sleep during the step, and they get no identities once the match starts", async () => {
    const r = await threeOnSpots(turnGame());
    const { ctx, say, ws, connect } = r;
    // Ann stands on a spot, then opens the room on a second phone during the step.
    await standOn(r, ws.ann, 0, 0);
    const di = await ctx.room.join({ nickname: "Ann", as: "player" });
    expect(di.seat).toBe(3);
    const diWs = await connect(di.token);
    await settle();
    // The room sleeps during the step.
    await r.sleepAndWake();
    // Bo takes the other spot and Ann starts.
    const secrets = await annAndBoPlay(r);
    expect(ctx.room.core.viewerOf({ role: "player", seat: 3 })).toEqual({ role: "screen", seat: 3 });
    expect(ctx.room.core.viewerOf({ role: "player", seat: 2 })).toEqual({ role: "audience", seat: 2 });
    say(ws.ann, { t: "in", d: { say: "is it a dog?" } });
    await settle();
    expectNone(diWs.text(), secrets);
    expectBoth(ws.cy.text(), secrets);
  });

  it("a host who goes back to the room clears the mark: in the next match the newcomer is audience", async () => {
    const r = await threeOnSpots(turnGame());
    const { ctx, say, ws, connect } = r;
    const di = await ctx.room.join({ nickname: "Di", as: "player" });
    const diWs = await connect(di.token);
    await settle();
    say(ws.ann, { t: "settings-cancel" });
    await settle();
    expect(ctx.room.core.activity).toEqual({ kind: "lobby" });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await voteTo(r, "settings", [ws.ann, 0], [ws.bo, 1], [ws.cy, 2], [diWs, 3]);
    await settle();
    const secrets = await annAndBoPlay(r);
    expect(ctx.room.core.viewerOf({ role: "player", seat: 3 })).toEqual({ role: "audience", seat: 3 });
    expectBoth(diWs.text(), secrets);
  });
});

describe("someone who joins during a settings step with its players fixed", () => {
  it("watches the match as the big screen does", async () => {
    const r = await choosing(createLobbyRoom, turnGame({ settings: true }), { manifest: { audience: true } });
    const { ctx, say, ws, connect } = r;
    expect(ctx.room.core.activity).not.toHaveProperty("spots");
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const cyWs = await connect(cy.token);
    await settle();
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    const secrets = ctx.room.core.activity.state.secrets;
    say(ws.ann, { t: "in", d: { say: "is it a dog?" } });
    await settle();
    expect(ctx.room.core.viewerOf({ role: "player", seat: cy.seat })).toEqual({ role: "screen", seat: cy.seat });
    expectNone(cyWs.text(), secrets);
    expectNone(ws.screen.text(), secrets);
  });
});

describe("a game with no audience", () => {
  it("Cork & Bell: someone who joins mid-round watches as a screen and the room view's game is as before", async () => {
    const r = await openRoom(createLobbyRoom, corkAndBell.game, { players: corkAndBell.manifest.players, manifest: corkAndBell.manifest });
    const { ctx, connect } = r;
    const tokens = [await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" })];
    for (const nickname of ["Bo", "Cy"]) tokens.push(await ctx.room.join({ nickname, as: "player" }));
    const ws = [];
    for (const t of tokens) ws.push(await connect(t.token));
    await voteIn(r, ...ws.map((w, seat) => [w, seat]));
    const core = ctx.room.core;
    expect(core.activity).toMatchObject({ kind: "game", id: "cork-and-bell", seats: [0, 1, 2] });
    const di = await ctx.room.join({ nickname: "Di", as: "player" });
    const diWs = await connect(di.token);
    await settle();
    expect(core.viewerOf({ role: "player", seat: 3 })).toEqual({ role: "screen", seat: 3 });
    expect([0, 1, 2].map((seat) => core.viewerOf({ role: "player", seat }))).toEqual([0, 1, 2].map((seat) => ({ role: "player", seat })));
    expect(roomOf(diWs).game).toEqual({ id: "cork-and-bell", name: "Cork & Bell", round: 1 });
    ctx.room.stopTimer();
  });
});
