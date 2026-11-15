// The real party room class, driven with fake sockets, storage, alarm and timers: what the
// Durable Object tests share. A test file mocks "cloudflare:workers" itself (vi.mock is hoisted
// only within the file that calls it), imports createLobbyRoom after that, and hands it here.
import { expect, vi } from "vitest";
import { COUNT_MS, boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, boxCentre } from "../shared/world.js";

export const START = 1_700_000_000_000;

/** The server end of a socket: keeps every frame the room sends it. */
export class FakeSocket {
  constructor() {
    this.frames = [];
    this.closed = null;
    this.attachment = null;
    /** Called with each frame as it is sent, before it is kept. */
    this.onSend = null;
  }
  send(text) {
    if (typeof text !== "string") throw new Error("frames are text");
    if (this.closed) throw new Error("closed");
    this.onSend?.(text);
    this.frames.push(text);
  }
  close(code, reason) {
    this.closed ??= { code, reason };
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
  text() {
    return this.frames.join("\n");
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

/** For beforeEach: the clock, and the runtime's classes the room uses. */
export function useFakeRuntime() {
  vi.useFakeTimers({ now: START });
  vi.stubGlobal("WebSocketPair", FakePair);
  vi.stubGlobal("WebSocketRequestResponsePair", class {});
  vi.stubGlobal("Response", FakeResponse);
}

/** For afterEach. */
export function dropFakeRuntime() {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

/**
 * The Durable Object's state: storage that outlives an instance, the sockets it accepted (which
 * stay open through a sleep, as the Hibernation API keeps them), and one alarm that calls the
 * instance awake at the time.
 */
export function fakeCtx() {
  const store = new Map();
  const sockets = [];
  const ctx = {
    store,
    sockets,
    /** The instance the alarm wakes: the newest one. */
    room: null,
    alarm: { at: null, timer: null, rang: 0 },
    /**
     * Whether every page keeps sending the keep-alive the runtime answers by itself ("ping"): it
     * never reaches the room, which only sees when each socket last got the automatic reply.
     */
    keepAlive: false,
    setWebSocketAutoResponse: () => {},
    getWebSocketAutoResponseTimestamp: () => (ctx.keepAlive ? new Date(Date.now()) : null),
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket: (ws) => sockets.push(ws),
    getWebSockets: () => sockets.filter((ws) => !ws.closed),
    waitUntil: () => {},
    storage: {
      get: async (k) => structuredClone(store.get(k)),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      getAlarm: async () => ctx.alarm.at,
      setAlarm: async (at) => {
        clearTimeout(ctx.alarm.timer);
        ctx.alarm.at = at;
        ctx.alarm.timer = setTimeout(
          () => {
            ctx.alarm.at = null;
            ctx.alarm.rang += 1;
            void ctx.room.alarm();
          },
          Math.max(0, at - Date.now()),
        );
      },
      deleteAlarm: async () => {
        clearTimeout(ctx.alarm.timer);
        ctx.alarm.at = null;
      },
      deleteAll: async () => store.clear(),
    },
  };
  return ctx;
}

/** A Worker environment with a PIN directory, and (with `budget`) a room budget that keeps every report. */
export function fakeEnv({ budget = null } = {}) {
  const env = {
    PARTY_PINS: { getByName: () => ({ issue: async () => ({ value: "4821" }), refresh: async () => {}, release: async () => {} }) },
  };
  if (budget) {
    env.PARTY_ROOM_BUDGET_SHARE = "0.1";
    env.PARTY_BUDGET = {
      getByName: () => ({
        state: async () => "open",
        spend: async (ms, requests) => {
          budget.push({ ms, requests });
          return "open";
        },
      }),
    };
  }
  return env;
}

const manifestOf = (game, players) => ({ id: game.id, name: game.id, players, devices: { phone: true, desktop: true, sharedScreen: true } });

/**
 * A party room with one box on its wall, for `game`. Returns the fake state, ways to open a
 * socket and say something on it, and `sleepAndWake`: a new instance over the same storage and
 * sockets, as after an eviction or a deploy.
 */
export async function openRoom(createLobbyRoom, game, { players = { min: 2, max: 2 }, env = fakeEnv(), manifest = {} } = {}) {
  // `manifest`: more of the game's manifest, as its box is drawn from it (its `settings`, say).
  const wall = {
    boxes: [boxFromManifest({ ...manifestOf(game, players), ...manifest }, { view: "/x/view.js" })],
    games: new Map([[game.id, game]]),
    fields: new Map(manifest.settings ? [[game.id, manifest.settings]] : []),
  };
  const Room = createLobbyRoom(() => wall);
  const ctx = fakeCtx();
  ctx.room = new Room(ctx, env);
  await settle();
  const connect = async (token) => {
    const res = await ctx.room.fetch(new Request(`https://room/ws?token=${token}`, { headers: { Upgrade: "websocket" } }));
    expect(res.status).toBe(101);
    return ctx.sockets.at(-1);
  };
  const say = (ws, msg) => ctx.room.webSocketMessage(ws, JSON.stringify(msg));
  /** Puts the room to sleep and wakes a new instance over the same storage and sockets (a restart). */
  const sleepAndWake = async () => {
    ctx.room.stopTimer(); // the old instance is gone, and its timer with it
    ctx.room = new Room(ctx, env);
    await settle();
  };
  return { ctx, connect, say, sleepAndWake, room: () => ctx.room, wall };
}

/** Lets the room's promises (storage, the budget check before a game) settle. */
export const settle = () => vi.advanceTimersByTimeAsync(0);

/** Walks a seat's piece into the light of the only box, in steps the room believes. */
export async function walkIn(say, ctx, ws, seat) {
  const target = boxCentre(0, 1);
  for (;;) {
    const m = ctx.room.core.members[seat];
    if (Math.abs(target - m.x) < 1) return;
    const x = Math.abs(target - m.x) > POSITION_SLACK ? m.x + Math.sign(target - m.x) * POSITION_SLACK : target;
    say(ws, { t: "m", x, d: 0, r: m.rev });
    await vi.advanceTimersByTimeAsync(50);
  }
}

/** Both players walk into the light; the count runs out on the alarm and the game starts. */
export async function voteIn(r, ...players) {
  return voteTo(r, "game", ...players);
}

/**
 * The players walk into the light and the count runs out on the alarm, up to the moment the room
 * leaves the lobby and no further: `kind` is what it must be then ("game", or "settings" for a
 * game whose settings are chosen first).
 */
export async function voteTo({ ctx, say }, kind, ...players) {
  for (const [ws, seat] of players) await walkIn(say, ctx, ws, seat);
  expect(ctx.room.core.count).not.toBeNull();
  const until = Date.now() + COUNT_MS + 1000;
  while (ctx.room.core.activity.kind === "lobby" && Date.now() < until) await vi.advanceTimersByTimeAsync(10);
  expect(ctx.room.core.activity.kind).toBe(kind);
}

export const GAME_FRAME = /^\{"t":"(start|ev|snap)"/;
export const kindsOf = (ws) => new Set(ws.messages().map((m) => m.t));
export const eventsOf = (ws) => ws.messages().filter((m) => m.t === "ev").flatMap((m) => m.ev);

/** No frame names the room's seed, and no room view carries one. */
export function expectNoRoomSeed(core, sockets) {
  const seed = String(core.seed);
  for (const ws of sockets) {
    for (const m of ws.messages()) if (m.room) expect(m.room).not.toHaveProperty("seed");
    expect(ws.text()).not.toMatch(new RegExp(`\\b${seed}\\b`));
  }
}
