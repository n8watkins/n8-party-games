// The socket handshake on the kit's own room class (room.js): a socket opens with no token in
// its address, has no seat and hears nothing until its first message names its seat's token, and
// is closed by anything else. The old form, with the token in the address, is taken as that hello
// for now. Sockets that never say whose they are are shared out by the address they came from.
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
const { CLOSE_BAD_TOKEN, CLOSE_HELLO_EXPECTED, CLOSE_HELLO_LATE, HELLO_MS, MAX_UNKNOWN, MAX_UNKNOWN_PER_CLIENT } = await import("../src/worker/hello-logic.js");

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
  /** Opens a socket from `ip` (the address Cloudflare puts on the request; none, as in a local run, by default). */
  const open = async (query = "", ip = null) => {
    const headers = { Upgrade: "websocket", ...(ip ? { "CF-Connecting-IP": ip } : {}) };
    const res = await ctx.room.fetch(new Request(`https://room/ws${query}`, { headers }));
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
    const stranger = await r.open("", "203.0.113.7");
    expect(stranger.attachment).toEqual({ unknown: true, at: Date.now(), lag: 0, client: "203.0.113.7" });
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

  it("a room that does not exist answers exactly as one that does: nothing until the hello, then a seat that is not there", async () => {
    const Room = createPartyRoom(secretGame());
    const ctx = fakeCtx();
    const env = fakeEnv();
    let room = new Room(ctx, env);
    const open = async () => (await room.fetch(new Request("https://room/ws", { headers: { Upgrade: "websocket" } })), ctx.sockets.at(-1));
    // Opening a socket does not say whether the code is a room.
    const silent = await open();
    expect(silent.closed).toBeNull();
    expect(silent.attachment).toEqual({ unknown: true, at: Date.now(), lag: 0, client: "local" });
    const ws = await open();
    // The object sleeps and wakes with nothing saved: the sockets are still nobody's.
    room = new Room(ctx, env);
    await settle();
    room.webSocketMessage(ws, JSON.stringify({ t: "hello", token: "any-token" }));
    expect(ws.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(ws.frames).toEqual([]);
    // And never more than a client's share wait there either.
    const flood = [];
    for (let i = 0; i < 40; i++) flood.push(await open());
    expect([silent, ...flood].filter((s) => !s.closed)).toHaveLength(MAX_UNKNOWN_PER_CLIENT);
    expect(ctx.store.size).toBe(0);
  });
});

describe("the old form, the token in the address, from a page loaded before the deploy", () => {
  it("is taken as a socket that opened and said hello with that token at once: seated, and told the room", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const old = await r.open(`?token=${r.bo.token}`);
    await settle();
    expect(old.closed).toBeNull();
    expect(old.messages()[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(old.attachment).toMatchObject({ token: r.bo.token, role: "player", seat: 1 });
    expect(r.ctx.room.unknown.has(old)).toBe(false);
    expect(ann.messages().at(-1).room.seats[1]).toMatchObject({ name: "Bo", connected: true });
    // It plays as that seat from here on.
    r.say(old, { t: "ready", v: true });
    expect(r.ctx.room.core.seats[1].ready).toBe(true);
  });

  it("in the middle of a round, it gets its own seat's view of it, as a hello would", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const bo = await r.connect(r.bo.token);
    r.say(ann, { t: "ready", v: true });
    r.say(bo, { t: "ready", v: true });
    r.say(ann, { t: "start" });
    await settle();
    r.ctx.room.webSocketClose(bo, 1006, "");
    const old = await r.open(`?token=${r.bo.token}`);
    await settle();
    const [hello, snap] = old.messages();
    expect(hello).toMatchObject({ t: "hello", you: { seat: 1 } });
    expect(snap).toMatchObject({ t: "snap", full: true });
    expect(snap.s.others).toEqual([r.ctx.room.core.state.secrets[0]]);
  });

  it("with a token that names nobody, or a seat given up, gets what a wrong hello gets: closed, with nothing said", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const before = ann.frames.length;
    for (const query of ["?token=not-a-token", "?token="]) {
      const old = await r.open(query);
      await settle();
      expect(old.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
      expect(old.frames).toEqual([]);
    }
    expect(ann.frames.length).toBe(before);
    expect(r.ctx.room.core.seats.filter(Boolean)).toHaveLength(2);

    const bo = await r.connect(r.bo.token);
    r.say(bo, { t: "leave" });
    await settle();
    const gone = await r.open(`?token=${r.bo.token}`);
    expect(gone.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "bad_token" });
    expect(gone.frames).toEqual([]);
  });

  it("a hello after it on the same socket changes nothing: it is already that seat", async () => {
    const r = await openRoom();
    const old = await r.open(`?token=${r.bo.token}`);
    r.hello(old, r.ann.token);
    await settle();
    expect(r.ctx.room.sockets.get(old)).toMatchObject({ seat: 1, token: r.bo.token });
    expect(r.ctx.room.core.seats[0].connected).toBe(false);
  });

  it("is never one of the sockets waiting to say whose they are, so it pushes none of them out", async () => {
    const r = await openRoom();
    const waiting = [];
    for (let i = 0; i < MAX_UNKNOWN_PER_CLIENT; i++) waiting.push(await r.open());
    await r.open(`?token=${r.bo.token}`);
    expect(waiting.every((ws) => ws.closed === null)).toBe(true);
    expect(r.ctx.room.unknown.size).toBe(MAX_UNKNOWN_PER_CLIENT);
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
  it("are never more than a client's share, wake no timer, change nothing, and do not keep a player out", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const before = ann.frames.length;
    const saved = structuredClone(r.ctx.store.get("room"));
    const flood = [];
    for (let i = 0; i < 200; i++) flood.push(await r.open());
    await settle();
    expect(flood.filter((ws) => !ws.closed)).toHaveLength(MAX_UNKNOWN_PER_CLIENT);
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

  /** Bo was in from `home`, and dropped; the room is full of someone else's silent sockets already, from 40 addresses. */
  async function crowded(home) {
    const r = await openRoom();
    const first = await r.open("", home);
    r.hello(first, r.bo.token);
    r.ctx.room.webSocketClose(first, 1006, "");
    for (let i = 0; i < MAX_UNKNOWN; i++) await r.open("", `198.51.100.${i % 40}`);
    return r;
  }

  /** Bo's phone opens from `from`, `n` more silent sockets arrive from `others(i)`, and then its hello lands. */
  async function comesBack(r, from, n, others) {
    const phone = await r.open("", from);
    for (let i = 0; i < n; i++) await r.open("", others(i));
    await vi.advanceTimersByTimeAsync(500);
    const waited = phone.closed;
    r.hello(phone, r.bo.token);
    expect(r.ctx.room.unknown.size).toBeLessThanOrEqual(MAX_UNKNOWN);
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
      expect(heard).toMatchObject({ t: "hello", you: { seat: 1 } });
    },
  );

  it.each([8, 40, MAX_UNKNOWN, 1000])(
    "a phone on a network the room has never seen is seated though %i silent sockets from 40 addresses arrived during its round trip",
    async (n) => {
      const r = await crowded("203.0.113.7");
      const { waited, heard } = await comesBack(r, "192.0.2.50", n, (i) => `198.51.100.${i % 40}`);
      expect(waited).toBeNull();
      expect(heard).toMatchObject({ t: "hello", you: { seat: 1 } });
    },
  );

  it("what is left: a phone on a network the room has never seen is pushed out by more addresses than the room lets wait, each opening one socket inside its round trip", async () => {
    const r = await crowded("203.0.113.7");
    const { waited } = await comesBack(r, "192.0.2.50", MAX_UNKNOWN + 1, everywhere);
    expect(waited).toEqual({ code: CLOSE_HELLO_LATE, reason: "crowded" });
    // One fewer, and it would have stayed.
    const again = await crowded("203.0.113.7");
    expect((await comesBack(again, "192.0.2.50", MAX_UNKNOWN - 1, everywhere)).waited).toBeNull();
  });

  it("the room remembers the networks it let in across a sleep and a restart", async () => {
    const r = await crowded("203.0.113.7");
    await r.sleepAndWake();
    const { waited } = await comesBack(r, "203.0.113.7", 1000, everywhere);
    expect(waited).toBeNull();
    expect(r.ctx.store.get("clients")).toEqual(["203.0.113.7"]);
  });

  it("one address cannot hold more than its share: its newest pushes out its own oldest, never another's", async () => {
    const r = await openRoom();
    const phone = await r.open("", "203.0.113.7");
    const greedy = [];
    for (let i = 0; i < 50; i++) greedy.push(await r.open("", "198.51.100.9"));
    expect(phone.closed).toBeNull();
    expect(r.ctx.room.unknown.countOf("198.51.100.9")).toBe(MAX_UNKNOWN_PER_CLIENT);
    expect(greedy.slice(-MAX_UNKNOWN_PER_CLIENT).every((ws) => ws.closed === null)).toBe(true);
    // An IPv6 /48 is one address here, as at the door.
    for (let i = 0; i < 20; i++) await r.open("", `2001:db8:5:${i.toString(16)}::1`);
    expect(r.ctx.room.unknown.countOf("2001:db8:5::/48")).toBe(MAX_UNKNOWN_PER_CLIENT);
    r.hello(phone, r.bo.token);
    expect(phone.messages()[0]).toMatchObject({ t: "hello" });
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

describe("leaving, with a second socket open for the same seat (another tab, a phone's old socket)", () => {
  it("closes every socket of that seat, so none of them hears the seat's views while a bot plays it", async () => {
    const r = await openRoom();
    const ann = await r.connect(r.ann.token);
    const bo = await r.connect(r.bo.token);
    const tab = await r.connect(r.bo.token);
    r.say(ann, { t: "ready", v: true });
    r.say(bo, { t: "ready", v: true });
    r.say(ann, { t: "start" });
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    r.say(bo, { t: "leave" });
    await settle();
    expect(bo.closed).toEqual({ code: 1000, reason: "left" });
    expect(tab.closed).toEqual({ code: CLOSE_BAD_TOKEN, reason: "left" });
    expect([...r.ctx.room.sockets.values()].map((e) => e.token)).toEqual([r.ann.token]);
    // The round goes on with a bot in Bo's seat, and the tab is sent none of it.
    expect(r.ctx.room.core.seats[1].kind).toBe("bot");
    const heard = tab.frames.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(tab.frames.length).toBe(heard);
    expect(ann.messages().some((m) => m.t === "snap")).toBe(true);
    // A message on the closed tab does nothing.
    r.say(tab, { t: "in", d: { x: 1 } });
    expect(r.ctx.room.core.phase).toBe("playing");
  });
});
