// The socket handshake on the kit's own room class (room.js): a socket opens with no token in
// its address, has no seat and hears nothing until its first message names its seat's token, and
// is closed by anything else. The old form, with the token in the address, is refused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeCtx, fakeEnv, settle, useFakeRuntime } from "../../lobby/test/fake-room.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createPartyRoom } = await import("../src/worker/room.js");
const { CLOSE_BAD_TOKEN, CLOSE_HELLO_EXPECTED, CLOSE_HELLO_LATE, HELLO_MS, MAX_UNKNOWN } = await import("../src/worker/hello-logic.js");

/** A ticking game with a secret per seat that only the other seat may see. */
function secretGame() {
  return {
    id: "secrets",
    minSeats: 2,
    maxSeats: 3,
    tickHz: 30,
    snapshotEvery: 2,
    create: ({ seats }) => ({ seats: seats.map((s) => s.seat), secrets: Object.fromEntries(seats.map((s) => [s.seat, `SECRET-${s.seat}-${crypto.randomUUID()}`])), ticks: 0 }),
    input: () => {},
    tick(state) {
      state.ticks += 1;
      return [{ k: "turn", n: state.ticks }];
    },
    snapshot(state, now, viewer) {
      const base = { ticks: state.ticks };
      if (viewer.role === "player" && state.seats.includes(viewer.seat)) return { ...base, others: state.seats.filter((s) => s !== viewer.seat).map((s) => state.secrets[s]) };
      return { ...base, screen: true };
    },
    isOver: (state) => state.ticks >= 600,
    result: (state) => state.seats.map((seat) => ({ seat, score: seat })),
  };
}

/** A room made by Ann, with Bo in it; nobody's socket is open yet. */
async function openRoom() {
  const Room = createPartyRoom(secretGame());
  const ctx = fakeCtx();
  const env = fakeEnv();
  ctx.room = new Room(ctx, env);
  const open = async (query = "") => {
    const res = await ctx.room.fetch(new Request(`https://room/ws${query}`, { headers: { Upgrade: "websocket" } }));
    expect(res.status).toBe(101);
    return ctx.sockets.at(-1);
  };
  const say = (ws, msg) => ctx.room.webSocketMessage(ws, typeof msg === "string" ? msg : JSON.stringify(msg));
  const hello = (ws, token) => say(ws, { t: "hello", token });
  const connect = async (token) => {
    const ws = await open();
    hello(ws, token);
    return ws;
  };
  const sleepAndWake = async () => {
    ctx.room.stopTimer();
    ctx.room = new Room(ctx, env);
    await settle();
  };
  const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
  const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
  return { ctx, open, say, hello, connect, sleepAndWake, ann, bo };
}

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a socket before it says whose it is", () => {
  it("has no seat, and hears nothing of the room or of a round played in front of it", async () => {
    const r = await openRoom();
    const stranger = await r.open();
    expect(stranger.attachment).toEqual({ unknown: true, at: Date.now(), lag: 0 });
    expect(r.ctx.room.core.seats[0].connected).toBe(false);

    const ann = await r.connect(r.ann.token);
    const bo = await r.connect(r.bo.token);
    r.say(ann, { t: "ready", v: true });
    r.say(bo, { t: "ready", v: true });
    r.say(ann, { t: "start" });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(ann.messages().some((m) => m.t === "snap")).toBe(true);
    expect(stranger.frames).toEqual([]);
    expect(stranger.closed).toBeNull();
    expect((await r.ctx.room.debug()).sockets).toBe(2);
  });

  it.each([
    ["a message a seat may send", JSON.stringify({ t: "ready", v: true })],
    ["a start", JSON.stringify({ t: "start" })],
    ["a clock ping", JSON.stringify({ t: "ping", c: 1 })],
    ["text that is not JSON", "ping"],
    ["a binary frame", new ArrayBuffer(8)],
  ])("is closed by anything but a hello, having done nothing: %s", async (_, first) => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const before = ann.frames.length;
    const stranger = await r.open();
    r.ctx.room.webSocketMessage(stranger, first);
    await settle();
    expect(stranger.closed).toEqual({ code: CLOSE_HELLO_EXPECTED, reason: "hello_expected" });
    expect(stranger.frames).toEqual([]);
    expect(r.ctx.room.core.phase).toBe("lobby");
    expect(r.ctx.room.core.seats.map((s) => s?.ready ?? null)).toEqual([false, false, null]);
    expect(ann.frames.length).toBe(before);
    // Closed is closed: a hello after it takes no seat.
    r.hello(stranger, r.bo.token);
    expect(r.ctx.room.core.seats[1].connected).toBe(false);
  });

  it("takes its seat with a hello, and only then hears the room", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const ws = await r.open();
    r.hello(ws, r.bo.token);
    await settle();
    expect(ws.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(ws.attachment).toMatchObject({ token: r.bo.token, role: "player", seat: 1 });
    expect(ws.attachment.unknown).toBeUndefined();
    expect(ann.messages().at(-1).room.seats[1]).toMatchObject({ name: "Bo", connected: true });
    // No frame to anyone carries a token.
    for (const sock of [ann, ws]) for (const token of [r.ann.token, r.bo.token]) expect(sock.text()).not.toContain(token);
  });

  it("a second hello on a seated socket changes nothing", async () => {
    const r = await openRoom();
    const ws = await r.connect(r.bo.token);
    r.hello(ws, r.ann.token);
    await settle();
    expect(ws.closed).toBeNull();
    expect(r.ctx.room.sockets.get(ws)).toMatchObject({ seat: 1, token: r.bo.token });
    expect(r.ctx.room.core.seats[0].connected).toBe(false);
  });
});

describe("a hello that names no seat", () => {
  it("a wrong token is refused with nothing said, the way a seat that is gone always was", async () => {
    const r = await openRoom();
    const ws = await r.connect("not-a-token");
    expect(ws.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ws.frames).toEqual([]);
    expect((await r.ctx.room.debug()).sockets).toBe(0);
  });

  it("the token of a seat that was given up is refused", async () => {
    const r = await openRoom();
    const bo = await r.connect(r.bo.token);
    r.say(bo, { t: "leave" });
    await settle();
    const again = await r.connect(r.bo.token);
    expect(again.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(again.frames).toEqual([]);
    expect(r.ctx.room.core.seats[1]).toBeNull();
  });

  it("a room that does not exist closes the socket at once", async () => {
    const Room = createPartyRoom(secretGame());
    const ctx = fakeCtx();
    const room = new Room(ctx, fakeEnv());
    await room.fetch(new Request("https://room/ws", { headers: { Upgrade: "websocket" } }));
    expect(ctx.sockets[0].closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ctx.sockets[0].frames).toEqual([]);
  });
});

describe("the old form: the token in the address", () => {
  it("is refused, and the seat it named is given up, on every socket it had", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const tab = await r.connect(r.bo.token);
    const old = await r.open(`?token=${r.bo.token}`);
    await settle();
    expect(old.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "reload" });
    expect(old.frames).toEqual([]);
    // The address was written down the moment it arrived: the token in it opens nothing any more.
    expect(tab.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "reload" });
    expect(r.ctx.room.core.identify(r.bo.token)).toBeNull();
    expect(ann.messages().at(-1).room.seats[1]).toBeNull();
    const again = await r.connect(r.bo.token);
    expect(again.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
  });

  it("with a token that names nobody, is refused the same way and changes nothing", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const before = ann.frames.length;
    const old = await r.open("?token=not-a-token");
    await settle();
    expect(old.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "reload" });
    expect(ann.frames.length).toBe(before);
    expect(r.ctx.room.core.seats.filter(Boolean)).toHaveLength(2);
  });

  it("is refused even beside a hello: the token in the address is the one that counts against it", async () => {
    const r = await openRoom();
    const old = await r.open(`?token=${r.bo.token}`);
    r.hello(old, r.ann.token);
    await settle();
    expect(old.frames).toEqual([]);
    expect(r.ctx.room.core.seats[0].connected).toBe(false);
  });
});

describe("a room that sleeps during the handshake", () => {
  it("between the open and the hello: the socket is still nobody's when it wakes, and its hello still seats it", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const ws = await r.open();
    await r.sleepAndWake();
    expect(r.ctx.room.sockets.has(ws)).toBe(false);
    expect((await r.ctx.room.debug()).sockets).toBe(1);
    expect(r.ctx.room.core.seats[1].connected).toBe(false);
    const before = ws.frames.length;
    r.say(ann, { t: "ready", v: true });
    await settle();
    expect(ws.frames.length).toBe(before);

    r.hello(ws, r.bo.token);
    await settle();
    expect(ws.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(r.ctx.room.core.seats[1].connected).toBe(true);
  });

  it("between the open and a first message that is not a hello: closed all the same", async () => {
    const r = await openRoom();
    const ws = await r.open();
    await r.sleepAndWake();
    r.say(ws, { t: "start" });
    expect(ws.closed).toEqual({ code: CLOSE_HELLO_EXPECTED, reason: "hello_expected" });
    expect(ws.frames).toEqual([]);
  });

  it("right after the hello: the socket wakes in its seat", async () => {
    const r = await openRoom();
    const ws = await r.connect(r.bo.token);
    await r.sleepAndWake();
    expect(r.ctx.room.sockets.get(ws)).toMatchObject({ role: "player", seat: 1, token: r.bo.token });
    expect(r.ctx.room.core.seats[1].connected).toBe(true);
  });
});

describe("many sockets that never say whose they are", () => {
  it("are never more than a handful, wake no timer, change nothing, and do not keep a player out", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const before = ann.frames.length;
    const saved = structuredClone(r.ctx.store.get("room"));
    const flood = [];
    for (let i = 0; i < 200; i++) flood.push(await r.open());
    await settle();
    expect(flood.filter((ws) => !ws.closed)).toHaveLength(MAX_UNKNOWN);
    expect(flood.filter((ws) => ws.closed).every((ws) => ws.closed.code === CLOSE_HELLO_LATE)).toBe(true);
    expect(flood.every((ws) => ws.frames.length === 0)).toBe(true);
    expect(ann.frames.length).toBe(before);
    expect(r.ctx.room.timer).toBeNull();
    expect(r.ctx.store.get("room")).toEqual(saved);
    expect((await r.ctx.room.debug()).sockets).toBe(1);

    const bo = await r.connect(r.bo.token);
    await settle();
    expect(bo.messages()[0]).toMatchObject({ t: "hello", you: { seat: 1 } });
  });

  it("one that said nothing in time is closed the next time anyone opens a socket", async () => {
    const r = await openRoom();
    const idle = await r.open();
    await vi.advanceTimersByTimeAsync(HELLO_MS - 1);
    await r.open();
    expect(idle.closed).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await r.open();
    expect(idle.closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "hello_late" });
  });

  it("a waiting socket that closes is forgotten, and nobody hears of it", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const before = ann.frames.length;
    const ws = await r.open();
    r.ctx.room.webSocketClose(ws, 1006, "");
    await settle();
    expect(r.ctx.room.unknown.size).toBe(0);
    expect(ann.frames.length).toBe(before);
  });

  it("are closed with the room", async () => {
    const r = await openRoom();
    const ws = await r.open();
    await r.ctx.room.destroy();
    expect(ws.closed).toMatchObject({ code: 4000 });
    expect(r.ctx.room.unknown.size).toBe(0);
  });
});
