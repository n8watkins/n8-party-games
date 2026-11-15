// Per-seat views (KR-1), proved on the real room class: every frame each socket is sent is
// captured as the raw text that would go down the wire, and the secrets are looked for in it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createPartyRoom } = await import("../src/worker/room.js");
const { eventsFor, fanOut, viewerFor, viewerKey } = await import("../src/core/room-core.js");

const START = 1_700_000_000_000;

/** The server end of a socket: keeps every frame the room sends it. */
class FakeSocket {
  constructor() {
    this.frames = [];
    this.closed = null;
    this.attachment = null;
  }
  send(text) {
    if (typeof text !== "string") throw new Error("frames are text");
    this.frames.push(text);
  }
  close(code, reason) {
    this.closed = { code, reason };
  }
  serializeAttachment(v) {
    this.attachment = structuredClone(v);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  messages() {
    return this.frames.map((f) => JSON.parse(f));
  }
}

class FakePair {
  constructor() {
    this[0] = new FakeSocket();
    this[1] = new FakeSocket();
  }
}

/** The runtime allows a 101 with a socket; Node's Response does not, so the test has its own. */
class FakeResponse {
  constructor(body, init = {}) {
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket ?? null;
  }
}

function fakeCtx() {
  const store = new Map();
  const sockets = [];
  return {
    sockets,
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((ws) => !ws.closed),
    waitUntil: () => {},
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
      deleteAll: async () => store.clear(),
    },
  };
}

const env = {
  PARTY_PINS: { getByName: () => ({ issue: async () => ({ value: "4821" }), release: async () => {} }) },
};

/**
 * A game with a secret per seat, in the shape of Who Am I?: each player may see the other
 * players' secrets and never their own, and the screen sees no secret at all. Its events are
 * whispers: a public one, and one for each seat that names the *other* seats' secrets.
 */
function secretGame({ ticks = 6 } = {}) {
  return {
    id: "secrets",
    minSeats: 2,
    maxSeats: 3,
    tickHz: 30,
    snapshotEvery: 2,
    create: ({ seats, round }) => ({
      seats: seats.map((s) => s.seat),
      secrets: Object.fromEntries(seats.map((s) => [s.seat, `SECRET-${round}-${s.seat}-${crypto.randomUUID()}`])),
      ticks: 0,
    }),
    input: () => {},
    tick(state) {
      state.ticks += 1;
      const events = [{ k: "turn", n: state.ticks }];
      for (const seat of state.seats) {
        const others = state.seats.filter((s) => s !== seat).map((s) => state.secrets[s]);
        events.push({ k: "whisper", only: seat, others });
      }
      // Addressed to a list: every seat but seat 0 hears seat 0's secret.
      events.push({ k: "about-0", only: state.seats.filter((s) => s !== 0), secret: state.secrets[0] });
      return events;
    },
    snapshot(state, now, viewer) {
      const base = { ticks: state.ticks, seats: state.seats };
      if (viewer.role === "player" && state.seats.includes(viewer.seat)) {
        return { ...base, you: viewer.seat, others: Object.fromEntries(state.seats.filter((s) => s !== viewer.seat).map((s) => [s, state.secrets[s]])) };
      }
      return { ...base, screen: true };
    },
    isOver: (state) => state.ticks >= ticks,
    result: (state) => state.seats.map((seat) => ({ seat, score: seat })),
  };
}

/** The same game without views: ignores the viewer and addresses nothing, as every game did before. */
function plainGame() {
  const g = secretGame();
  return {
    ...g,
    id: "plain",
    tick(state) {
      state.ticks += 1;
      return [{ k: "turn", n: state.ticks, to: 1 }]; // `to` means nothing to the room (Cork & Bell uses it)
    },
    snapshot: (state) => ({ ticks: state.ticks, secrets: state.secrets }),
  };
}

async function openRoom(game) {
  const Room = createPartyRoom(game);
  const ctx = fakeCtx();
  const room = new Room(ctx, env);
  const connect = async (token) => {
    const res = await room.fetch(new Request("https://room/ws", { headers: { Upgrade: "websocket" } }));
    expect(res.status).toBe(101);
    const ws = ctx.sockets.at(-1);
    // The seat's token is the socket's first message, never in its address.
    room.webSocketMessage(ws, JSON.stringify({ t: "hello", token }));
    return ws;
  };
  const say = (ws, msg) => room.webSocketMessage(ws, JSON.stringify(msg));
  return { room, ctx, connect, say };
}

/** Lets the room's promises (the budget check before a round) settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  vi.stubGlobal("WebSocketPair", FakePair);
  vi.stubGlobal("Response", FakeResponse);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("per-seat views on the wire", () => {
  it("a seat never receives its own secret, the other seat's frames carry it, and the screen gets neither", async () => {
    const { room, connect, say } = await openRoom(secretGame());
    const ann = await room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await room.join({ nickname: "Bo", as: "player" });
    const screen = await room.join({ as: "screen" });
    const wsAnn = await connect(ann.token);
    const wsBo = await connect(bo.token);
    const wsScreen = await connect(screen.token);
    say(wsAnn, { t: "ready", v: true });
    say(wsBo, { t: "ready", v: true });
    say(wsAnn, { t: "start" });
    await settle();
    const state = room.core.state;
    const [secretAnn, secretBo] = [state.secrets[0], state.secrets[1]];

    // Halfway through, a second socket of Ann's opens (a reload): it gets a full snapshot of her own.
    await vi.advanceTimersByTimeAsync(100);
    const wsAnn2 = await connect(ann.token);
    // The round runs to its end (6 ticks at 30 Hz), with snapshots every 2 ticks and at the end.
    await vi.advanceTimersByTimeAsync(1000);
    expect(room.core.phase).toBe("ended");

    // A member who arrives after the round is seated in the room but not in the round: a screen's view.
    const cy = await room.join({ nickname: "Cy", as: "player" });
    const wsCy = await connect(cy.token);

    const kinds = (ws) => new Set(ws.messages().map((m) => m.t));
    for (const ws of [wsAnn, wsBo, wsScreen]) expect([...kinds(ws)]).toEqual(expect.arrayContaining(["hello", "room", "start", "ev", "snap", "end"]));
    expect([...kinds(wsAnn2)]).toEqual(expect.arrayContaining(["hello", "snap", "ev", "end"]));
    expect(wsAnn2.messages().find((m) => m.t === "snap").full).toBe(true);
    expect(wsCy.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { screen: true } });

    const all = (ws) => ws.frames.join("\n");
    for (const ws of [wsAnn, wsAnn2]) {
      expect(all(ws)).not.toContain(secretAnn);
      expect(all(ws)).toContain(secretBo);
    }
    expect(all(wsBo)).not.toContain(secretBo);
    expect(all(wsBo)).toContain(secretAnn);
    for (const ws of [wsScreen, wsCy]) {
      expect(all(ws)).not.toContain(secretAnn);
      expect(all(ws)).not.toContain(secretBo);
      expect(all(ws)).not.toContain("SECRET-");
    }
    // Every snapshot Ann's sockets got is hers: the same holds frame by frame, not only overall.
    for (const frame of [...wsAnn.frames, ...wsAnn2.frames]) expect(frame).not.toContain(secretAnn);
    // Addressed events reach their seats and nobody else; unaddressed ones reach everyone.
    const evs = (ws) => ws.messages().filter((m) => m.t === "ev").flatMap((m) => m.ev);
    expect(evs(wsAnn).filter((e) => e.k === "whisper").every((e) => e.only === 0)).toBe(true);
    expect(evs(wsBo).filter((e) => e.k === "whisper").every((e) => e.only === 1)).toBe(true);
    expect(evs(wsBo).filter((e) => e.k === "about-0")).toHaveLength(6);
    expect(evs(wsAnn).filter((e) => e.k === "about-0")).toHaveLength(0);
    expect(evs(wsScreen).map((e) => e.k)).toEqual(Array(6).fill("turn"));
    // The room's seed is in no frame of any socket, and no room view carries one.
    const seed = String(room.core.seed);
    for (const ws of [wsAnn, wsAnn2, wsBo, wsScreen, wsCy]) {
      for (const m of ws.messages()) if (m.room) expect(m.room).not.toHaveProperty("seed");
      expect(all(ws)).not.toMatch(new RegExp(`\\b${seed}\\b`));
    }
  });

  it("a game that ignores the viewer sends every socket the same frames, as before", async () => {
    const { room, connect, say } = await openRoom(plainGame());
    const ann = await room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await room.join({ nickname: "Bo", as: "player" });
    const screen = await room.join({ as: "screen" });
    const sockets = [await connect(ann.token), await connect(bo.token), await connect(screen.token)];
    say(sockets[0], { t: "ready", v: true });
    say(sockets[1], { t: "ready", v: true });
    say(sockets[0], { t: "start" });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    const game = (ws) => ws.frames.filter((f) => /^\{"t":"(start|ev|snap|end)"/.test(f));
    const [a, b, c] = sockets.map(game);
    expect(a.length).toBe(1 + 6 + 3 + 1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // `to` on an event is the game's own field: it reaches everyone.
    expect(sockets[0].messages().filter((m) => m.t === "ev").flatMap((m) => m.ev)).toHaveLength(6);
  });
});

describe("the view helpers", () => {
  it("tells a player in the round, a member watching it and the big screen apart", () => {
    const round = new Set([0, 2]);
    expect(viewerFor({ role: "player", seat: 2 }, round)).toEqual({ role: "player", seat: 2 });
    expect(viewerFor({ role: "player", seat: 1 }, round)).toEqual({ role: "screen", seat: 1 });
    expect(viewerFor({ role: "screen", seat: -1 }, round)).toEqual({ role: "screen" });
    expect(viewerFor({ role: "player", seat: 1 }, null)).toEqual({ role: "player", seat: 1 });
    expect(new Set([{ role: "player", seat: 1 }, { role: "screen", seat: 1 }, { role: "screen" }].map(viewerKey)).size).toBe(3);
  });

  it("filters addressed events, and leaves a list with none untouched", () => {
    const list = [{ k: "a" }, { k: "b", only: 1 }, { k: "c", only: [0, 1] }, 7, null];
    expect(eventsFor(list, { role: "player", seat: 0 })).toEqual([{ k: "a" }, { k: "c", only: [0, 1] }, 7, null]);
    expect(eventsFor(list, { role: "player", seat: 1 })).toEqual(list);
    expect(eventsFor(list, { role: "screen", seat: 1 })).toEqual([{ k: "a" }, 7, null]);
    const plain = [{ k: "a", to: 3 }];
    expect(eventsFor(plain, { role: "screen" })).toBe(plain);
  });

  it("builds each message once per kind of viewer, and skips viewers with nothing to receive", () => {
    const make = vi.fn((v) => (v.role === "screen" ? null : { s: v.seat }));
    const people = [{ role: "player", seat: 0 }, { role: "player", seat: 0 }, { role: "player", seat: 1 }, { role: "screen", seat: -1 }];
    const out = fanOut(people, (p) => viewerFor(p), make);
    expect(make).toHaveBeenCalledTimes(3);
    expect(out.map(([p, text]) => [p.seat, text])).toEqual([
      [0, '{"s":0}'],
      [0, '{"s":0}'],
      [1, '{"s":1}'],
    ]);
  });
});
