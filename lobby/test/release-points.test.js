// When a page may load a new build (lobby/server/release-points.js), phase by phase, and what the
// real party room class says about builds: its own in every hello with whether now is safe, a
// `release` message to the pages of another build each time it comes to a safe point (and after a
// deploy it took asleep), an answer to `release?`, and a page of an older protocol let go with
// update_required at a safe point, its seat kept.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, openRoom, settle, useFakeRuntime, voteTo, walkIn } from "./fake-room.js";
import { choosing, turnGame } from "./turn-game.js";
import { releaseSafe, unsafeBecause } from "../server/release-points.js";
import { UPDATE_REQUIRED } from "../../party-kit/src/worker/hello-logic.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const ROOM = { id: "aaaaaaaaaaaa" };
const OLD = "bbbbbbbbbbbb";
const lobby = { phase: "lobby", game: null, vote: { count: null, toss: null }, closing: null };

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a safe point, from the room as every page sees it", () => {
  it.each([
    ["the lobby, nobody choosing", lobby, null],
    ["people standing in a light before any count", { ...lobby, vote: { count: null, toss: null, standing: { 0: "turns" } } }, null],
    ["the last game's result on show", { ...lobby, last: { round: 1, ago: 2000 } }, null],
    ["the Table's list", { ...lobby, mode: "turn-based", table: [], starting: null }, null],
    ["the vote's count running", { ...lobby, vote: { count: { endsIn: 2000 }, toss: null } }, "count"],
    ["the coin toss", { ...lobby, vote: { count: null, toss: { endsIn: 900 } } }, "toss"],
    ["a game's settings being chosen", { ...lobby, phase: "settings" }, "settings"],
    ["a game on the Floor (a round, a race)", { ...lobby, phase: "playing", game: { id: "cork-and-bell" } }, "playing"],
    ["a turn-based game at the Table", { ...lobby, phase: "playing", game: { id: "paper-masks", turns: true } }, "playing"],
    ["the Table's game starting", { ...lobby, mode: "turn-based", starting: { id: "paper-masks", in: 1500 } }, "starting"],
    ["the room closing", { ...lobby, closing: { in: 10_000, reason: "stale" } }, "closing"],
    ["no room at all", null, "no room"],
  ])("%s", (_, view, why) => {
    expect(unsafeBecause(view)).toBe(why);
    expect(releaseSafe(view)).toBe(why === null);
  });
});

/** A party of Ann and Bo with a big screen, in a room of build ROOM; `pages` says each page's hello. */
async function party({ release = ROOM, pages = {} } = {}) {
  const r = await openRoom(createLobbyRoom, turnGame(), { release });
  const { ctx } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const screen = await ctx.room.join({ as: "screen" });
  const tokens = { ann: ann.token, bo: bo.token, screen: screen.token };
  const ws = {};
  for (const who of ["ann", "bo", "screen"]) {
    ws[who] = await r.open();
    r.say(ws[who], { t: "hello", token: tokens[who], ...(pages[who] ?? {}) });
  }
  await settle();
  return { ...r, tokens, ws };
}

const releases = (ws) => ws.messages().filter((m) => m.t === "release");
const helloOf = (ws) => ws.messages().find((m) => m.t === "hello");

describe("the room's build in the hello", () => {
  it("says the room's build and that the lobby is a safe point", async () => {
    const r = await party({ pages: { ann: { release: OLD, protocol: "2" }, bo: { release: ROOM.id, protocol: "2" } } });
    expect(helloOf(r.ws.ann).release).toEqual({ id: ROOM.id, safe: true });
    expect(helloOf(r.ws.bo).release).toEqual({ id: ROOM.id, safe: true });
    // A page from before the release record hears it too; it does not know the field and ignores it.
    expect(helloOf(r.ws.screen).release).toEqual({ id: ROOM.id, safe: true });
    // Each socket keeps what its page said, through a sleep.
    expect(r.ws.ann.attachment).toMatchObject({ release: OLD, protocol: "2" });
    expect(r.ws.screen.attachment).toMatchObject({ release: null, protocol: "2" });
  });

  it("says a game is no moment for it", async () => {
    const r = await party({ pages: { ann: { release: OLD } } });
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    const late = await r.open();
    r.say(late, { t: "hello", token: r.tokens.bo, release: OLD });
    await settle();
    expect(helloOf(late).release).toEqual({ id: ROOM.id, safe: false });
  });

  it("says the settings step is no moment for it", async () => {
    const r = await choosing(createLobbyRoom, turnGame({ settings: true }), { release: ROOM });
    const again = await r.open();
    r.say(again, { t: "hello", token: r.tokens.ann, release: OLD });
    await settle();
    expect(r.ctx.room.core.activity.kind).toBe("settings");
    expect(helloOf(again).release).toEqual({ id: ROOM.id, safe: false });
  });

  it("a room made without a build says nothing about builds", async () => {
    const r = await party({ release: null, pages: { ann: { release: OLD } } });
    expect(helloOf(r.ws.ann).release).toBeUndefined();
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    r.say(r.ws.ann, { t: "in", d: { say: "x", win: true }, id: "q1" });
    await settle();
    r.say(r.ws.ann, { t: "release?" });
    await settle();
    expect(releases(r.ws.ann)).toEqual([]);
  });
});

describe("the release message at safe points", () => {
  it("goes to the pages of another build when the room comes back to the lobby after a game, and to nobody else", async () => {
    const r = await party({ pages: { ann: { release: OLD }, bo: { release: ROOM.id } } });
    // Walking into the light and the count: the room is busy, and nobody hears anything.
    await walkIn(r.say, r.ctx, r.ws.ann, 0);
    await walkIn(r.say, r.ctx, r.ws.bo, 1);
    expect(r.ctx.room.core.count).not.toBeNull();
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    expect(releases(r.ws.ann)).toEqual([]);
    // The game ends: back in the lobby, with the result on show, a safe point.
    r.say(r.ws.ann, { t: "in", d: { say: "x", win: true }, id: "q1" });
    await settle();
    expect(r.ctx.room.core.activity.kind).toBe("lobby");
    expect(releases(r.ws.ann)).toEqual([{ t: "release", id: ROOM.id, safe: true }]);
    expect(releases(r.ws.bo)).toEqual([]);
    expect(releases(r.ws.screen)).toEqual([]);
    // Once for each time it comes to a safe point, not on every change while it stays at one.
    await walkIn(r.say, r.ctx, r.ws.ann, 0);
    await settle();
    expect(r.ctx.room.core.count).toBeNull();
    expect(releases(r.ws.ann)).toHaveLength(1);
  });

  it("goes to them after a deploy the room took asleep, with the first thing anyone says", async () => {
    const r = await party({ pages: { ann: { release: ROOM.id }, bo: { release: ROOM.id } } });
    await r.sleepAndWake({ release: { id: "cccccccccccc" } });
    const m = r.ctx.room.core.members[0];
    r.say(r.ws.ann, { t: "m", x: m.x + 10, d: 1, r: m.rev });
    await settle();
    expect(releases(r.ws.ann)).toEqual([{ t: "release", id: "cccccccccccc", safe: true }]);
    expect(releases(r.ws.bo)).toEqual([{ t: "release", id: "cccccccccccc", safe: true }]);
  });

  it("answers a page that asks, with whether now is safe", async () => {
    const r = await party({ pages: { ann: { release: OLD } } });
    r.say(r.ws.ann, { t: "release?" });
    await settle();
    expect(releases(r.ws.ann).at(-1)).toEqual({ t: "release", id: ROOM.id, safe: true });
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    r.say(r.ws.ann, { t: "release?" });
    await settle();
    expect(releases(r.ws.ann).at(-1)).toEqual({ t: "release", id: ROOM.id, safe: false });
  });
});

describe("a page of an older protocol", () => {
  it("is let go with update_required at once in the lobby, its seat kept for its reload", async () => {
    const r = await party({ pages: { ann: { release: OLD, protocol: "1" } } });
    expect(r.ws.ann.closed).toEqual({ code: 4000, reason: UPDATE_REQUIRED });
    const ann = r.ctx.room.core.members[0];
    expect(ann).toMatchObject({ name: "Ann", connected: false });
    // The reload comes back to the same seat.
    const back = await r.open();
    r.say(back, { t: "hello", token: r.tokens.ann, release: ROOM.id, protocol: "2" });
    await settle();
    expect(helloOf(back).you).toEqual({ role: "player", seat: 0 });
    expect(back.closed).toBeNull();
  });

  it("plays on in a game and is let go when it ends", async () => {
    const r = await party();
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    const old = await r.open();
    r.say(old, { t: "hello", token: r.tokens.screen, protocol: "1" });
    await settle();
    expect(old.closed).toBeNull();
    r.say(r.ws.ann, { t: "in", d: { say: "x", win: true }, id: "q1" });
    await settle();
    expect(old.closed).toEqual({ code: 4000, reason: UPDATE_REQUIRED });
    expect(r.ws.ann.closed).toBeNull();
  });
});
