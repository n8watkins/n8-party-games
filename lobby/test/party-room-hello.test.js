// The socket handshake on the real party room class: a socket opens with no token in its
// address, has no seat and hears nothing (of the room or of a game) until its first message
// names its seat's token, and is closed by anything else. The old form, with the token in the
// address, is taken as that hello for now. Sockets that never say whose they are are shared out
// by the address they came from, wake nothing and push no real phone out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_FRAME, dropFakeRuntime, fakeEnv, openRoom, settle, useFakeRuntime } from "./fake-room.js";
import { started as startedIn, turnGame } from "./turn-game.js";
import { DROP_FADE_MS, SEAT_HOLD_MS } from "../server/lobby-core.js";
import { CLOSE_BAD_TOKEN, CLOSE_HELLO_EXPECTED, CLOSE_HELLO_LATE, HELLO_MS, MAX_UNKNOWN, MAX_UNKNOWN_PER_CLIENT } from "../../party-kit/src/worker/hello-logic.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

/** A party of Ann and Bo in the lobby; Ann's socket is open, Bo's is not yet. */
async function party(opts) {
  const r = await openRoom(createLobbyRoom, turnGame(), opts);
  const { ctx } = r;
  ctx.keepAlive = true;
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  const ws = { ann: await r.connect(ann.token) };
  await settle();
  return { ...r, tokens: { ann: ann.token, bo: bo.token }, ws };
}

const hello = (r, ws, token) => r.say(ws, { t: "hello", token });
const roomOf = (ws) => ws.messages().filter((m) => m.room).at(-1)?.room;

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a socket before it says whose it is", () => {
  it("carries no token, has no seat, and hears nothing while the room goes on in front of it", async () => {
    const r = await party();
    const stranger = await r.open("", "203.0.113.7");
    expect(stranger.attachment).toEqual({ unknown: true, at: Date.now(), lag: 0, client: "203.0.113.7" });
    expect((await r.ctx.room.debug()).sockets).toBe(1);
    expect((await r.ctx.room.debug()).unknown).toBe(1);

    // Ann walks, Bo arrives, and somebody new joins: all of it goes past the stranger.
    const m = r.ctx.room.core.members[0];
    r.say(r.ws.ann, { t: "m", x: m.x + 20, d: 1, r: m.rev });
    const bo = await r.connect(r.tokens.bo);
    await r.ctx.room.join({ nickname: "Cy", as: "player" });
    await settle();
    expect(bo.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(stranger.frames).toEqual([]);
    expect(stranger.closed).toBeNull();
    // It is nobody: no member is connected because of it.
    expect(roomOf(r.ws.ann).members.filter((x) => x?.connected)).toHaveLength(2);
  });

  it.each([
    ["a move", JSON.stringify({ t: "m", x: 500, d: 1, r: 0 })],
    ["a bump", JSON.stringify({ t: "b" })],
    ["a room pick", JSON.stringify({ t: "pick", v: "star-lounge" })],
    ["leave", JSON.stringify({ t: "leave" })],
    ["a game input", JSON.stringify({ t: "in", d: { say: "hi" }, id: "q-1" })],
    ["the settings step's start", JSON.stringify({ t: "settings-start" })],
    ["a clock ping", JSON.stringify({ t: "ping", c: 1 })],
    ["text that is not JSON", "hello"],
    ["a binary frame", new ArrayBuffer(8)],
    ["a hello too long to be one", JSON.stringify({ t: "hello", token: "x", pad: "y".repeat(600) })],
  ])("is closed by anything but a hello, having done nothing: %s", async (_, first) => {
    const r = await party();
    const before = r.ws.ann.frames.length;
    const saved = structuredClone(r.ctx.store.get("lobby"));
    const stranger = await r.open();
    r.ctx.room.webSocketMessage(stranger, first);
    await settle();
    expect(stranger.closed).toEqual({ code: CLOSE_HELLO_EXPECTED, reason: "hello_expected" });
    expect(stranger.frames).toEqual([]);
    expect(r.ws.ann.frames.length).toBe(before);
    expect(r.ctx.store.get("lobby")).toEqual(saved);
    expect(r.ctx.room.core.members.filter(Boolean)).toHaveLength(2);
    // Closed is closed: a hello after it takes no seat.
    hello(r, stranger, r.tokens.bo);
    await settle();
    expect(r.ctx.room.core.members[1].connected).toBe(false);
    expect(stranger.frames).toEqual([]);
  });

  it("takes its seat with a hello, and from then on is that seat and no other", async () => {
    const r = await party();
    const ws = await r.open();
    hello(r, ws, r.tokens.bo);
    await settle();
    expect(ws.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(ws.attachment).toMatchObject({ token: r.tokens.bo, role: "player", seat: 1 });
    expect(ws.attachment.unknown).toBeUndefined();
    expect(roomOf(r.ws.ann).members[1]).toMatchObject({ name: "Bo", connected: true });
    expect((await r.ctx.room.debug()).unknown).toBe(0);
    // A second hello, with Ann's token, does not make it Ann.
    hello(r, ws, r.tokens.ann);
    await settle();
    expect(r.ctx.room.sockets.get(ws)).toMatchObject({ seat: 1, token: r.tokens.bo });
    // No frame to anyone carries a token.
    for (const sock of [r.ws.ann, ws]) for (const token of Object.values(r.tokens)) expect(sock.text()).not.toContain(token);
  });
});

describe("a hello that names no seat", () => {
  it("a wrong token is refused with nothing said", async () => {
    const r = await party();
    const before = r.ws.ann.frames.length;
    const ws = await r.connect("not-a-token");
    await settle();
    expect(ws.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ws.frames).toEqual([]);
    expect(r.ws.ann.frames.length).toBe(before);
    expect((await r.ctx.room.debug()).unknown).toBe(0);
  });

  it.each([
    ["no token", { t: "hello" }],
    ["an empty token", { t: "hello", token: "" }],
    ["a token that is not text", { t: "hello", token: { $ne: null } }],
    ["a token too long to be one", { t: "hello", token: "x".repeat(65) }],
  ])("a hello with %s is refused as a seat that is not there", async (_, first) => {
    const r = await party();
    const ws = await r.open();
    r.say(ws, first);
    expect(ws.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ws.frames).toEqual([]);
  });

  it("the token of a seat that was given up is refused", async () => {
    const r = await party();
    const bo = await r.connect(r.tokens.bo);
    await settle();
    r.say(bo, { t: "leave" });
    await settle();
    const again = await r.connect(r.tokens.bo);
    expect(again.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(again.frames).toEqual([]);
    expect(r.ctx.room.core.members[1]).toBeNull();
  });

  it("a phone that dropped has its seat back with a hello while it is held, and is refused once the hold ran out", async () => {
    const r = await party();
    const bo = await r.connect(r.tokens.bo);
    await settle();
    r.ctx.room.webSocketClose(bo, 1006, "");
    await vi.advanceTimersByTimeAsync(DROP_FADE_MS + 1000);
    expect(r.ctx.room.core.members[1]).toBeNull();
    const back = await r.connect(r.tokens.bo);
    await settle();
    expect(back.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });

    r.ctx.room.webSocketClose(back, 1006, "");
    await vi.advanceTimersByTimeAsync(DROP_FADE_MS + SEAT_HOLD_MS + 2000);
    const late = await r.connect(r.tokens.bo);
    expect(late.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(late.frames).toEqual([]);
  });

  it("a room that does not exist answers exactly as one that does: nothing until the hello, then a seat that is not there", async () => {
    const r = await openRoom(createLobbyRoom, turnGame());
    // Opening a socket does not say whether the code is a party.
    const silent = await r.open();
    expect(silent.closed).toBeNull();
    expect(silent.attachment).toEqual({ unknown: true, at: Date.now(), lag: 0, client: "local" });
    const ws = await r.open();
    // The object sleeps and wakes with nothing saved: the sockets are still nobody's.
    await r.sleepAndWake();
    hello(r, ws, "any-token");
    expect(ws.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ws.frames).toEqual([]);
    // Never more than a client's share wait there either, and nothing is written or timed for them.
    const flood = [];
    for (let i = 0; i < 40; i++) flood.push(await r.open());
    expect([silent, ...flood].filter((s) => !s.closed)).toHaveLength(MAX_UNKNOWN_PER_CLIENT);
    expect(r.ctx.store.size).toBe(0);
    expect(r.ctx.alarm.at).toBeNull();
  });
});

describe("silent sockets opened while a phone's hello is on its way", () => {
  /** Bo was in from `home`, and dropped; the party is full of someone else's silent sockets already, from 40 addresses. */
  async function crowded(home) {
    const r = await party();
    const first = await r.open("", home);
    hello(r, first, r.tokens.bo);
    await settle();
    r.ctx.room.webSocketClose(first, 1006, "");
    await settle();
    for (let i = 0; i < MAX_UNKNOWN; i++) await r.open("", `198.51.100.${i % 40}`);
    return r;
  }

  /** Bo's phone opens from `from`, `n` more silent sockets arrive from `others(i)`, and then its hello lands. */
  async function comesBack(r, from, n, others) {
    const phone = await r.open("", from);
    for (let i = 0; i < n; i++) await r.open("", others(i));
    await vi.advanceTimersByTimeAsync(500);
    const waited = phone.closed;
    hello(r, phone, r.tokens.bo);
    await settle();
    expect((await r.ctx.room.debug()).unknown).toBeLessThanOrEqual(MAX_UNKNOWN);
    return { waited, heard: phone.messages()[0] };
  }

  // Each of the 1,000 is from an address of its own (an IPv6 /48 each).
  const everywhere = (i) => `2001:db8:${(i >> 8).toString(16)}${(i & 255).toString(16).padStart(2, "0")}::1`;

  it.each([8, 40, MAX_UNKNOWN, 1000])(
    "a phone back on the network it played on is seated though %i silent sockets from addresses of their own arrived during its round trip",
    async (n) => {
      const r = await crowded("203.0.113.7");
      const { waited, heard } = await comesBack(r, "203.0.113.7", n, everywhere);
      expect(waited).toBeNull();
      expect(heard).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    },
  );

  it.each([8, 40, MAX_UNKNOWN, 1000])(
    "a phone on a network the party has never seen is seated though %i silent sockets from 40 addresses arrived during its round trip",
    async (n) => {
      const r = await crowded("203.0.113.7");
      const { waited, heard } = await comesBack(r, "192.0.2.50", n, (i) => `198.51.100.${i % 40}`);
      expect(waited).toBeNull();
      expect(heard).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    },
  );

  it("a phone joined from a network is known there before its first socket", async () => {
    const r = await party();
    const cy = await r.ctx.room.join({ nickname: "Cy", as: "player", client: "192.0.2.80" });
    for (let i = 0; i < MAX_UNKNOWN; i++) await r.open("", `198.51.100.${i % 40}`);
    const phone = await r.open("", "192.0.2.80");
    for (let i = 0; i < 1000; i++) await r.open("", everywhere(i));
    expect(phone.closed).toBeNull();
    hello(r, phone, cy.token);
    await settle();
    expect(phone.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 2 } });
  });

  it("one address cannot hold more than its share: its newest pushes out its own oldest, never another's", async () => {
    const r = await party();
    const phone = await r.open("", "192.0.2.50");
    const greedy = [];
    for (let i = 0; i < 50; i++) greedy.push(await r.open("", "198.51.100.9"));
    expect(phone.closed).toBeNull();
    expect(r.ctx.room.unknown.countOf("198.51.100.9")).toBe(MAX_UNKNOWN_PER_CLIENT);
    expect(greedy.slice(-MAX_UNKNOWN_PER_CLIENT).every((ws) => ws.closed === null)).toBe(true);
    hello(r, phone, r.tokens.bo);
    await settle();
    expect(phone.messages()[0]).toMatchObject({ t: "hello" });
  });

  it("the party remembers the networks it let in across a sleep and a restart, and forgets them when it closes", async () => {
    const r = await crowded("203.0.113.7");
    await r.sleepAndWake();
    expect((await comesBack(r, "203.0.113.7", 1000, everywhere)).waited).toBeNull();
    expect(r.ctx.store.get("clients")).toContain("203.0.113.7");
    await r.ctx.room.destroy();
    expect(r.ctx.store.size).toBe(0);
  });
});

describe("the old form, the token in the address, from a page loaded before the deploy", () => {
  it("is taken as a socket that opened and said hello with that token at once: seated, and the room told", async () => {
    const r = await party();
    const old = await r.open(`?token=${r.tokens.bo}`);
    await settle();
    expect(old.closed).toBeNull();
    expect(old.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(old.attachment).toMatchObject({ token: r.tokens.bo, role: "player", seat: 1 });
    expect((await r.ctx.room.debug()).unknown).toBe(0);
    expect(roomOf(r.ws.ann).members[1]).toMatchObject({ name: "Bo", connected: true });
    // It keeps the seat across a sleep, as any seated socket does.
    await r.sleepAndWake();
    expect(r.ctx.room.sockets.get(old)).toMatchObject({ seat: 1, token: r.tokens.bo });
  });

  it("brings back a seat that was only held for a phone that dropped, as a hello does", async () => {
    const r = await party();
    const bo = await r.connect(r.tokens.bo);
    await settle();
    r.ctx.room.webSocketClose(bo, 1006, "");
    await vi.advanceTimersByTimeAsync(DROP_FADE_MS + 1000);
    expect(r.ctx.room.core.members[1]).toBeNull();
    const old = await r.open(`?token=${r.tokens.bo}`);
    await settle();
    expect(old.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(roomOf(r.ws.ann).members[1]).toMatchObject({ name: "Bo", connected: true });
  });

  it.each([
    ["a token that names nobody", "?token=not-a-token"],
    ["an empty token", "?token="],
  ])("with %s gets what a wrong hello gets: closed with nothing said, and nothing changes", async (_, query) => {
    const r = await party();
    const before = r.ws.ann.frames.length;
    const old = await r.open(query);
    await settle();
    expect(old.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(old.frames).toEqual([]);
    expect(r.ws.ann.frames.length).toBe(before);
    expect(r.ctx.room.core.members.filter(Boolean)).toHaveLength(2);
  });

  it("with the token of a seat that was given up, gets what a wrong hello gets", async () => {
    const r = await party();
    const bo = await r.connect(r.tokens.bo);
    await settle();
    r.say(bo, { t: "leave" });
    await settle();
    const old = await r.open(`?token=${r.tokens.bo}`);
    expect(old.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(old.frames).toEqual([]);
  });

  it("a hello after it on the same socket changes nothing: it is already that seat", async () => {
    const r = await party();
    const old = await r.open(`?token=${r.tokens.bo}`);
    hello(r, old, r.tokens.ann);
    await settle();
    expect(r.ctx.room.sockets.get(old)).toMatchObject({ seat: 1, token: r.tokens.bo });
  });

  it("in a turn-based game, a phone back with it plays on in its seat, and sees only its own view", async () => {
    const r = await startedIn(createLobbyRoom, turnGame());
    r.ctx.room.webSocketClose(r.ws.bo, 1006, "");
    await settle();
    const old = await r.open(`?token=${r.tokens.bo}`);
    await settle();
    expect(r.ctx.room.core.activity.kind).toBe("game");
    expect(old.frames.some((f) => GAME_FRAME.test(f))).toBe(true);
    expect(old.text()).toContain(r.secrets.ann);
    expect(old.text()).not.toContain(r.secrets.bo);
    expect(r.ws.ann.closed).toBeNull();
  });
});

describe("a room that sleeps during the handshake", () => {
  it("between the open and the hello: the socket is still nobody's when it wakes, and its hello still seats it", async () => {
    const r = await party();
    const ws = await r.open();
    await r.sleepAndWake();
    expect(r.ctx.room.sockets.has(ws)).toBe(false);
    expect((await r.ctx.room.debug()).sockets).toBe(1);
    expect((await r.ctx.room.debug()).unknown).toBe(1);
    expect(r.ctx.room.core.members[1].connected).toBe(false);
    // The room goes on, and none of it reaches the socket.
    await r.ctx.room.join({ nickname: "Cy", as: "player" });
    await settle();
    expect(ws.frames).toEqual([]);

    hello(r, ws, r.tokens.bo);
    await settle();
    expect(ws.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(r.ctx.room.core.members[1].connected).toBe(true);
  });

  it("between the open and a first message that is not a hello: closed all the same", async () => {
    const r = await party();
    const ws = await r.open();
    await r.sleepAndWake();
    r.say(ws, { t: "pick", v: "star-lounge" });
    expect(ws.closed).toEqual({ code: CLOSE_HELLO_EXPECTED, reason: "hello_expected" });
    expect(ws.frames).toEqual([]);
  });

  it("right after the hello: the socket wakes in its seat, with its piece", async () => {
    const r = await party();
    const ws = await r.connect(r.tokens.bo);
    await r.sleepAndWake();
    expect(r.ctx.room.sockets.get(ws)).toMatchObject({ role: "player", seat: 1, token: r.tokens.bo });
    expect(r.ctx.room.core.members[1].connected).toBe(true);
    expect((await r.ctx.room.debug()).unknown).toBe(0);
  });

  it("right after the hello: the room's screen wakes as the screen (nothing else ever writes it on its socket)", async () => {
    const r = await party();
    const screen = await r.ctx.room.join({ as: "screen" });
    const ws = await r.connect(screen.token);
    expect(ws.attachment).toMatchObject({ token: screen.token, role: "screen", seat: -1 });
    await r.sleepAndWake();
    expect(r.ctx.room.sockets.get(ws)).toMatchObject({ role: "screen", seat: -1, token: screen.token });
    expect(r.ctx.room.core.screensConnected()).toBe(1);
    const before = ws.frames.length;
    await r.ctx.room.join({ nickname: "Cy", as: "player" });
    await settle();
    expect(ws.frames.length).toBeGreaterThan(before);
  });

  it("a waiting socket that closed while the room slept is nobody's drop", async () => {
    const r = await party();
    const ws = await r.open();
    await r.sleepAndWake();
    const before = r.ws.ann.frames.length;
    r.ctx.room.webSocketClose(ws, 1006, "");
    await settle();
    expect(r.ws.ann.frames.length).toBe(before);
    expect(r.ctx.room.core.members.filter((m) => m?.connected)).toHaveLength(1);
    expect((await r.ctx.room.debug()).unknown).toBe(0);
  });
});

describe("a game in front of a socket that has not said whose it is", () => {
  it("sends it no view at all, and after its hello only its own seat's view", async () => {
    const r = await startedIn(createLobbyRoom, turnGame());
    const { ctx, say, ws, secrets, tokens } = r;
    // Bo's phone drops and opens a new socket, which says nothing yet.
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await settle();
    const fresh = await r.open();
    say(ws.ann, { t: "in", d: { say: "one" }, id: "a-1" });
    await settle();
    expect(ws.ann.messages().some((m) => m.t === "ack" && m.id === "a-1")).toBe(true);
    expect(fresh.frames).toEqual([]);

    // It cannot play Bo's turn, or anyone's, before it has said who it is.
    const moves = ctx.room.core.activity.state.moves.length;
    say(fresh, { t: "in", d: { say: "mine" }, id: "b-1" });
    await settle();
    expect(fresh.closed).toEqual({ code: CLOSE_HELLO_EXPECTED, reason: "hello_expected" });
    expect(ctx.room.core.activity.state.moves.length).toBe(moves);
    expect(fresh.frames).toEqual([]);

    // With its hello, Bo's new socket gets Bo's view: Ann's secret, never its own.
    const bo = await r.connect(tokens.bo);
    await settle();
    expect(bo.frames.some((f) => GAME_FRAME.test(f))).toBe(true);
    expect(bo.text()).toContain(secrets.ann);
    expect(bo.text()).not.toContain(secrets.bo);
    // And the screen and Ann were sent nothing new that is not theirs.
    expect(ws.screen.text()).not.toContain(secrets.ann);
    expect(ws.screen.text()).not.toContain(secrets.bo);
    expect(ws.ann.text()).not.toContain(secrets.ann);
  });

  it("a wrong token in the middle of a game hears nothing of it", async () => {
    const r = await startedIn(createLobbyRoom, turnGame());
    const ws = await r.connect("not-a-token");
    r.say(r.ws.ann, { t: "in", d: { say: "one" }, id: "a-1" });
    await settle();
    expect(ws.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ws.frames).toEqual([]);
  });
});

describe("many sockets that never say whose they are", () => {
  it("are never more than a handful, wake nothing, write nothing, and keep nobody out", async () => {
    const budget = [];
    const r = await party({ players: { min: 2, max: 4 }, env: fakeEnv({ budget }) });
    for (const nickname of ["Cy", "Di"]) await r.ctx.room.join({ nickname, as: "player" });
    const screen = await r.ctx.room.join({ as: "screen" });
    await settle();
    const before = r.ws.ann.frames.length;
    const saved = structuredClone(r.ctx.store.get("lobby"));
    const alarm = { at: r.ctx.alarm.at, rang: r.ctx.alarm.rang };
    const reports = budget.length;

    const flood = [];
    for (let i = 0; i < 300; i++) flood.push(await r.open());
    await settle();
    expect(flood.filter((ws) => !ws.closed)).toHaveLength(MAX_UNKNOWN_PER_CLIENT);
    expect(flood.filter((ws) => ws.closed).every((ws) => ws.closed.code === CLOSE_HELLO_LATE)).toBe(true);
    expect(flood.every((ws) => ws.frames.length === 0)).toBe(true);
    // Nobody in the room heard of it, nothing was saved, no timer runs, the alarm is where it was.
    expect(r.ws.ann.frames.length).toBe(before);
    expect(r.ctx.store.get("lobby")).toEqual(saved);
    expect(r.ctx.room.timer).toBeNull();
    expect({ at: r.ctx.alarm.at, rang: r.ctx.alarm.rang }).toEqual(alarm);
    // The budget is not called once per socket.
    expect(budget.length - reports).toBeLessThanOrEqual(1);
    const debug = await r.ctx.room.debug();
    expect(debug).toMatchObject({ sockets: 1, unknown: MAX_UNKNOWN_PER_CLIENT, timer: false });
    // The party is as full as it was, and no fuller: every seat and the screen can still come in.
    expect(debug.view.members.filter(Boolean)).toHaveLength(4);
    const bo = await r.connect(r.tokens.bo);
    const big = await r.connect(screen.token);
    await settle();
    expect(bo.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(big.messages()[0]).toMatchObject({ t: "hello", you: { role: "screen" } });
  });

  it("the flood is still counted as time the room was awake", async () => {
    const budget = [];
    const r = await party({ env: fakeEnv({ budget }) });
    const owed = async () => (await r.ctx.room.debug()).owed.ms + r.ctx.room.meter.ms;
    const before = await owed();
    for (let i = 0; i < 50; i++) await r.open();
    expect(await owed()).toBeGreaterThan(before);
  });

  it("one that said nothing in time is closed the next time anything happens in the room", async () => {
    const r = await party();
    const idle = await r.open();
    await vi.advanceTimersByTimeAsync(HELLO_MS - 1);
    const next = await r.open();
    expect(idle.closed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    hello(r, next, r.tokens.bo);
    expect(idle.closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "hello_late" });
  });

  it("do not keep an empty room open: it closes on time, and they close with it", async () => {
    const r = await party();
    const idle = await r.open();
    r.ctx.keepAlive = false;
    r.ctx.room.webSocketClose(r.ws.ann, 1006, "");
    await settle();
    // Somebody keeps opening sockets and saying nothing.
    const more = [];
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      if (r.ctx.room.core) more.push(await r.open());
    }
    expect(r.ctx.room.core).toBeNull();
    expect(r.ctx.store.size).toBe(0);
    expect(idle.closed).not.toBeNull();
    expect(more.every((ws) => ws.closed)).toBe(true);
    expect(more.length).toBeLessThan(30);
  });
});
