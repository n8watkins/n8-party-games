// The client's side of the socket handshake: the seat's token is never in an address the client
// builds (addresses are written down by the server's logs); it is the first message on every
// socket, before anything else the page has to say.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyClient } from "../client/party-client.js";
import { FakeWebSocket } from "./fake-browser-socket.js";

const TOKEN = "tok-3f9aQ_secret-seat-token";
const lobby = { phase: "lobby", game: null };

function memory() {
  const kept = new Map();
  return { kept, getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v), removeItem: (k) => void kept.delete(k) };
}

function client(opts = {}) {
  const c = new PartyClient({ base: "https://party.test", storage: null, ...opts });
  c.session = { code: "BCDFGH", pin: "4821", token: TOKEN, seat: 0, role: "player" };
  return c;
}

const frames = (ws) => ws.sent.map((text) => (text === "ping" ? text : JSON.parse(text)));

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("location", { origin: "https://party.test", pathname: "/lobby/" });
  FakeWebSocket.made = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the address of the socket", () => {
  it("is the room and nothing else: no token, no query", () => {
    const c = client();
    c.connect();
    expect(FakeWebSocket.last.url).toBe("wss://party.test/api/party/rooms/BCDFGH/ws");
  });

  it("for the party room's API too", () => {
    const c = client({ api: "/api/lobby" });
    c.connect();
    expect(FakeWebSocket.last.url).toBe("wss://party.test/api/lobby/rooms/BCDFGH/ws");
  });

  it("carries the simulated latency a test asked for, and still no token", () => {
    const c = client({ lag: 150 });
    c.connect();
    expect(FakeWebSocket.last.url).toBe("wss://party.test/api/party/rooms/BCDFGH/ws?lag=150");
  });

  it("no address the client builds names the token: the socket's on every reconnect, the join link, the QR code", async () => {
    const c = client();
    vi.stubGlobal("fetch", async () => ({ json: async () => ({ ok: true, publicOrigin: "https://party.test" }) }));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby });
    FakeWebSocket.last.die();
    vi.advanceTimersByTime(4000);
    c.dropConnection({ reconnectAfterMs: 0 });
    vi.advanceTimersByTime(10);
    const join = await c.joinUrl("/lobby/");
    const addresses = [...FakeWebSocket.made.map((ws) => ws.url), join, c.qrUrl(join)];
    expect(FakeWebSocket.made.length).toBeGreaterThanOrEqual(3);
    for (const address of addresses) {
      expect(address).not.toContain(TOKEN);
      expect(address).not.toMatch(/token/i);
    }
    expect(join).toBe("https://party.test/lobby/?join=4821");
  });

  it("the calls that make and join a room send no token either: the room hands one back", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, init) => {
      calls.push({ url: String(url), body: init.body ?? "" });
      return { json: async () => ({ ok: true, code: "BCDFGH", pin: "4821", token: TOKEN, seat: 0, role: "player" }) };
    });
    const c = client();
    await c.create({ nickname: "Ann" });
    await c.join("4821", { nickname: "Ann" });
    expect(calls.map((call) => call.url)).toEqual(["https://party.test/api/party/rooms", "https://party.test/api/party/join/4821"]);
    for (const call of calls) expect(call.url + call.body).not.toContain(TOKEN);
  });
});

describe("the first message", () => {
  it("is the hello with the seat's token, sent the moment the socket opens", () => {
    const c = client();
    c.connect();
    const ws = FakeWebSocket.last;
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(frames(ws)[0]).toEqual({ t: "hello", token: TOKEN });
    expect(frames(ws).filter((m) => m.t === "hello")).toHaveLength(1);
  });

  it("comes before the keep-alive, and before a hidden page says it is away", () => {
    const c = client({ api: "/api/lobby", quietPing: { text: "ping", everyMs: 10_000 } });
    c.away = true;
    c.connect();
    const ws = FakeWebSocket.last;
    ws.open();
    expect(frames(ws)).toEqual([{ t: "hello", token: TOKEN }, { t: "away" }, "ping"]);
  });

  it("is sent again on every new socket: after a drop, and after a page comes back", () => {
    const c = client();
    c.connect();
    const first = FakeWebSocket.last;
    first.open();
    first.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby });
    first.die();
    vi.advanceTimersByTime(4000);
    const second = FakeWebSocket.last;
    expect(second).not.toBe(first);
    second.open();
    expect(frames(second)[0]).toEqual({ t: "hello", token: TOKEN });

    c.dropConnection();
    c.connect();
    const third = FakeWebSocket.last;
    third.open();
    expect(frames(third)[0]).toEqual({ t: "hello", token: TOKEN });
  });

  it("is the saved session's token after a reload", () => {
    const storage = memory();
    storage.setItem("party-kit:session", JSON.stringify({ code: "BCDFGH", pin: "4821", token: TOKEN, seat: 0, role: "player" }));
    const c = new PartyClient({ base: "https://party.test", storage });
    expect(c.resume()).toBe(true);
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe("wss://party.test/api/party/rooms/BCDFGH/ws");
    ws.open();
    expect(frames(ws)[0]).toEqual({ t: "hello", token: TOKEN });
  });
});

describe("what the room answers", () => {
  it("its own hello seats the page", () => {
    const c = client();
    c.connect();
    const ws = FakeWebSocket.last;
    ws.open();
    expect(c.you).toBeNull();
    ws.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby });
    expect(c.you).toEqual({ role: "player", seat: 0 });
    expect(c.status).toBe("open");
  });

  it("a seat that is not ours any more (4003) forgets the session and does not come back", () => {
    const storage = memory();
    const c = client({ storage });
    storage.setItem(c.storeKey, JSON.stringify(c.session));
    const closed = [];
    c.on("closed", (why, reason) => closed.push([why, reason]));
    c.connect();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.readyState = 3;
    ws.onclose({ code: 4003, reason: "bad_token" });
    vi.advanceTimersByTime(10_000);
    expect(closed).toEqual([["seat_lost", "bad_token"]]);
    expect(storage.kept.size).toBe(0);
    expect(FakeWebSocket.made).toHaveLength(1);
  });

  it.each([
    ["crowded out or late with its hello (4009)", 4009],
    ["a hello the room could not read (4001)", 4001],
  ])("a socket closed before it was seated, %s, is opened again with the session kept", (_, code) => {
    const storage = memory();
    const c = client({ storage });
    storage.setItem(c.storeKey, JSON.stringify(c.session));
    c.connect();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.readyState = 3;
    ws.onclose({ code, reason: "" });
    expect(c.status).toBe("reconnecting");
    vi.advanceTimersByTime(4000);
    expect(FakeWebSocket.made).toHaveLength(2);
    expect(storage.kept.size).toBe(1);
    FakeWebSocket.last.open();
    expect(frames(FakeWebSocket.last)[0]).toEqual({ t: "hello", token: TOKEN });
  });

  it("sockets that open and are closed before the room's hello back off more each time, and only the hello starts the count again", () => {
    const c = client();
    c.connect();
    const waits = [];
    for (let i = 0; i < 6; i++) {
      const ws = FakeWebSocket.last;
      ws.open();
      ws.readyState = 3;
      ws.onclose({ code: 4009, reason: "crowded" });
      const made = FakeWebSocket.made.length;
      let waited = 0;
      while (FakeWebSocket.made.length === made && waited < 10_000) {
        vi.advanceTimersByTime(250);
        waited += 250;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 4000, 4000]);

    const ws = FakeWebSocket.last;
    ws.open();
    ws.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby });
    ws.die();
    const made = FakeWebSocket.made.length;
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.made.length).toBe(made + 1);
  });
});
