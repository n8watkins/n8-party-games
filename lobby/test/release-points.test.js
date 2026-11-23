// When a page may load a new build (lobby/server/release-points.js), phase by phase, and what the
// real party room class says about builds: its own build and protocol in every hello with whether
// now is safe, a `release` message to the pages of another build each time that changes, both
// ways (a count that starts and one that is called off included), and after a deploy it took
// asleep, an answer to `release?`, and a page of an OLDER protocol let go with update_required at
// a safe point, its seat kept; a page of a newer one is never let go.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeEnv, openRoom, settle, useFakeRuntime, voteTo, walkIn, walkTo } from "./fake-room.js";
import { choosing, turnGame } from "./turn-game.js";
import { releaseSafe, unsafeBecause } from "../server/release-points.js";
import { UPDATE_REQUIRED } from "../../party-kit/src/worker/hello-logic.js";
import { PROTOCOL } from "../../party-kit/src/worker/http.js";

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
/** What the room says of its build: in the hello, and in a `release` message with `t`. */
const word = (safe, protocol = PROTOCOL, id = ROOM.id) => ({ id, safe, protocol });
const message = (safe, protocol = PROTOCOL, id = ROOM.id) => ({ t: "release", ...word(safe, protocol, id) });

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

/**
 * A party of Ann and Bo with a big screen, in a room of build ROOM; `pages` says each page's hello.
 * `protocol`: the room speaks that one instead of PROTOCOL (PARTY_TEST_PROTOCOL, as the e2e does).
 */
async function party({ release = ROOM, pages = {}, protocol = null } = {}) {
  const env = fakeEnv();
  if (protocol) Object.assign(env, { PARTY_DEBUG: "on", PARTY_TEST_PROTOCOL: protocol });
  const r = await openRoom(createLobbyRoom, turnGame(), { release, env });
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
  it("says the room's build, its protocol, and that the lobby is a safe point", async () => {
    const r = await party({ pages: { ann: { release: OLD, protocol: "2" }, bo: { release: ROOM.id, protocol: "2" } } });
    expect(helloOf(r.ws.ann).release).toEqual(word(true));
    expect(helloOf(r.ws.bo).release).toEqual(word(true));
    // A page from before the release record hears it too; it does not know the field and ignores it.
    expect(helloOf(r.ws.screen).release).toEqual(word(true));
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
    expect(helloOf(late).release).toEqual(word(false));
  });

  it("says the settings step is no moment for it", async () => {
    const r = await choosing(createLobbyRoom, turnGame({ settings: true }), { release: ROOM });
    const again = await r.open();
    r.say(again, { t: "hello", token: r.tokens.ann, release: OLD });
    await settle();
    expect(r.ctx.room.core.activity.kind).toBe("settings");
    expect(helloOf(again).release).toEqual(word(false));
  });

  it("says the protocol the room speaks, a test's own where the test switches are on", async () => {
    const r = await party({ protocol: "3", pages: { ann: { release: OLD, protocol: "3" } } });
    expect(helloOf(r.ws.ann).release).toEqual(word(true, "3"));
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

describe("the release message", () => {
  it("goes to the pages of another build each time the room becomes busy or safe again, and to nobody else", async () => {
    const r = await party({ pages: { ann: { release: OLD }, bo: { release: ROOM.id } } });
    // Walking into the lights: the count starts, and the room is busy (a vote message only).
    await walkIn(r.say, r.ctx, r.ws.ann, 0);
    await walkIn(r.say, r.ctx, r.ws.bo, 1);
    expect(r.ctx.room.core.count).not.toBeNull();
    expect(releases(r.ws.ann)).toEqual([message(false)]);
    // The game starts and is played: still busy, nothing more is said.
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    expect(releases(r.ws.ann)).toEqual([message(false)]);
    // The game ends: back in the lobby, with the result on show, a safe point.
    r.say(r.ws.ann, { t: "in", d: { say: "x", win: true }, id: "q1" });
    await settle();
    expect(r.ctx.room.core.activity.kind).toBe("lobby");
    expect(releases(r.ws.ann)).toEqual([message(false), message(true)]);
    expect(releases(r.ws.bo)).toEqual([]);
    expect(releases(r.ws.screen)).toEqual([]);
    // Once for each change, not on every change of the room while it stays safe.
    await walkIn(r.say, r.ctx, r.ws.ann, 0);
    await settle();
    expect(r.ctx.room.core.count).toBeNull();
    expect(releases(r.ws.ann)).toHaveLength(2);
  });

  it("says the room is safe again when a count is called off, so no notice stays up", async () => {
    const r = await party({ pages: { ann: { release: OLD } } });
    const start = r.ctx.room.core.members[0].x;
    await walkIn(r.say, r.ctx, r.ws.ann, 0);
    await walkIn(r.say, r.ctx, r.ws.bo, 1);
    expect(r.ctx.room.core.count).not.toBeNull();
    expect(releases(r.ws.ann)).toEqual([message(false)]);
    // Ann steps out of her light: the count stops, and the room is in the plain lobby again.
    await walkTo(r.say, r.ctx, r.ws.ann, 0, start);
    await settle();
    expect(r.ctx.room.core.count).toBeNull();
    expect(r.ctx.room.core.activity.kind).toBe("lobby");
    expect(releases(r.ws.ann)).toEqual([message(false), message(true)]);
    // In again and out again: each change is said once.
    await walkIn(r.say, r.ctx, r.ws.ann, 0);
    expect(r.ctx.room.core.count).not.toBeNull();
    await walkTo(r.say, r.ctx, r.ws.ann, 0, start);
    await settle();
    expect(releases(r.ws.ann)).toEqual([message(false), message(true), message(false), message(true)]);
  });

  it("goes to them after a deploy the room took asleep, with the first thing anyone says", async () => {
    const r = await party({ pages: { ann: { release: ROOM.id }, bo: { release: ROOM.id } } });
    await r.sleepAndWake({ release: { id: "cccccccccccc" } });
    const m = r.ctx.room.core.members[0];
    r.say(r.ws.ann, { t: "m", x: m.x + 10, d: 1, r: m.rev });
    await settle();
    expect(releases(r.ws.ann)).toEqual([message(true, PROTOCOL, "cccccccccccc")]);
    expect(releases(r.ws.bo)).toEqual([message(true, PROTOCOL, "cccccccccccc")]);
  });

  it("answers a page that asks, with whether now is safe", async () => {
    const r = await party({ pages: { ann: { release: OLD } } });
    r.say(r.ws.ann, { t: "release?" });
    await settle();
    expect(releases(r.ws.ann).at(-1)).toEqual(message(true));
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    r.say(r.ws.ann, { t: "release?" });
    await settle();
    expect(releases(r.ws.ann).at(-1)).toEqual(message(false));
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

  it("is compared by number: a room of protocol 10 lets a page of 9 go", async () => {
    const r = await party({ protocol: "10", pages: { ann: { protocol: "9" }, bo: { protocol: "10" } } });
    expect(r.ws.ann.closed).toEqual({ code: 4000, reason: UPDATE_REQUIRED });
    expect(r.ws.bo.closed).toBeNull();
  });

  it("from before the release record (no protocol said) is protocol 2: let go only by a room of a newer one", async () => {
    const same = await party();
    expect(same.ws.screen.closed).toBeNull();
    const newer = await party({ protocol: "3" });
    expect(newer.ws.screen.closed).toEqual({ code: 4000, reason: UPDATE_REQUIRED });
  });
});

describe("a page of a newer protocol (loaded after a deploy, its room still on the old code)", () => {
  it("is never let go, at a safe point or after a game, and hears the room's older protocol", async () => {
    const r = await party({ pages: { ann: { release: OLD, protocol: "3" }, bo: { release: OLD, protocol: "10" } } });
    expect(r.ws.ann.closed).toBeNull();
    expect(r.ws.bo.closed).toBeNull();
    expect(helloOf(r.ws.ann).release).toEqual(word(true, PROTOCOL));
    await voteTo(r, "game", [r.ws.ann, 0], [r.ws.bo, 1]);
    r.say(r.ws.ann, { t: "in", d: { say: "x", win: true }, id: "q1" });
    await settle();
    expect(r.ctx.room.core.activity.kind).toBe("lobby");
    expect(r.ws.ann.closed).toBeNull();
    expect(r.ws.bo.closed).toBeNull();
    expect(releases(r.ws.ann).at(-1)).toEqual(message(true, PROTOCOL));
  });

  it("is not let go by a test protocol the switches do not allow (PARTY_DEBUG off)", async () => {
    const env = fakeEnv();
    Object.assign(env, { PARTY_TEST_PROTOCOL: "9" });
    const r = await openRoom(createLobbyRoom, turnGame(), { release: ROOM, env });
    const ann = await r.ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const ws = await r.open();
    r.say(ws, { t: "hello", token: ann.token, protocol: "2" });
    await settle();
    expect(ws.closed).toBeNull();
    expect(helloOf(ws).release).toEqual(word(true, PROTOCOL));
  });
});
