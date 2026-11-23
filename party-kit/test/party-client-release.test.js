// The client's side of "new version available": a page made with its release says it in every
// hello, hears the room's build (in the hello and in `release` messages) as the `release` event,
// can ask for it, and a room of a newer protocol that lets it go ("update_required") keeps its
// seat and session, so the page can reload into it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL, PartyClient, UPDATE_REQUIRED } from "../client/party-client.js";
import { LEGACY_HELLO_PROTOCOL, UPDATE_REQUIRED as ROOM_UPDATE_REQUIRED, readHelloFields } from "../src/worker/hello-logic.js";
import { PROTOCOL as WORKER_PROTOCOL } from "../src/worker/http.js";
import { FakeWebSocket } from "./fake-browser-socket.js";

const TOKEN = "tok-3f9aQ_secret-seat-token";
const MINE = "aaaaaaaaaaaa";
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

describe("the hello", () => {
  it("says this page's release and protocol, and the room reads them", () => {
    const c = client({ release: MINE });
    c.connect();
    FakeWebSocket.last.open();
    const first = FakeWebSocket.last.sent[0];
    expect(JSON.parse(first)).toEqual({ t: "hello", token: TOKEN, protocol: PROTOCOL, release: MINE });
    expect(readHelloFields(first, 512)).toEqual({ token: TOKEN, release: MINE, protocol: PROTOCOL });
  });

  it("from a page before the release record, reads as protocol 2 with no release", () => {
    expect(readHelloFields(JSON.stringify({ t: "hello", token: TOKEN }), 512)).toEqual({ token: TOKEN, release: null, protocol: LEGACY_HELLO_PROTOCOL });
    expect(LEGACY_HELLO_PROTOCOL).toBe("2");
  });

  it("takes no release that is not one, and no protocol that is not a number", () => {
    const read = (extra) => readHelloFields(JSON.stringify({ t: "hello", token: TOKEN, ...extra }), 512);
    expect(read({ release: "ZZZ" }).release).toBeNull();
    expect(read({ release: "a".repeat(13) }).release).toBeNull();
    expect(read({ release: 7 }).release).toBeNull();
    expect(read({ protocol: "two" }).protocol).toBe(LEGACY_HELLO_PROTOCOL);
    expect(read({ protocol: 3 }).protocol).toBe(LEGACY_HELLO_PROTOCOL);
    expect(read({ protocol: "3" }).protocol).toBe("3");
  });

  it("speaks the protocol the Worker does, and both name update_required the same", () => {
    expect(PROTOCOL).toBe(WORKER_PROTOCOL);
    expect(UPDATE_REQUIRED).toBe(ROOM_UPDATE_REQUIRED);
  });
});

describe("the room's build", () => {
  it("comes as the release event from the hello and from each release message", () => {
    const c = client({ release: MINE });
    const heard = [];
    c.on("release", (r) => heard.push(r));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby, release: { id: "bbbbbbbbbbbb", safe: false, protocol: "2" } });
    FakeWebSocket.last.hear({ t: "release", id: "bbbbbbbbbbbb", safe: true, protocol: "3" });
    // A room that says no protocol, or none that is a number: not known.
    FakeWebSocket.last.hear({ t: "release", id: "bbbbbbbbbbbb", safe: true });
    FakeWebSocket.last.hear({ t: "release", id: "bbbbbbbbbbbb", safe: true, protocol: 3 });
    expect(heard).toEqual([
      { id: "bbbbbbbbbbbb", safe: false, protocol: "2" },
      { id: "bbbbbbbbbbbb", safe: true, protocol: "3" },
      { id: "bbbbbbbbbbbb", safe: true, protocol: null },
      { id: "bbbbbbbbbbbb", safe: true, protocol: null },
    ]);
    expect(c.roomRelease).toBe("bbbbbbbbbbbb");
    expect(c.roomProtocol).toBeNull();
  });

  it("a test page may say another protocol in its hello, and only there", async () => {
    const c = client({ release: MINE, protocol: "3" });
    expect(c.helloProtocol).toBe("3");
    c.connect();
    FakeWebSocket.last.open();
    expect(JSON.parse(FakeWebSocket.last.sent[0])).toMatchObject({ t: "hello", protocol: "3" });
    expect(client({ release: MINE }).helloProtocol).toBe(PROTOCOL);
    // Its seat requests still carry the protocol it really speaks.
    const seen = [];
    vi.stubGlobal("fetch", async (url, init) => (seen.push(init.headers), { json: async () => ({ ok: true, preview: {} }) }));
    await c.preview("4821");
    expect(seen[0]["X-Party-Protocol"]).toBe(PROTOCOL);
  });

  it("a room that says no build raises no event", () => {
    const c = client({ release: MINE });
    const heard = [];
    c.on("release", (r) => heard.push(r));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby });
    expect(heard).toEqual([]);
  });

  it("can be asked for on an open socket", () => {
    const c = client({ release: MINE });
    expect(c.askRelease()).toBe(false);
    c.connect();
    FakeWebSocket.last.open();
    expect(c.askRelease()).toBe(true);
    expect(JSON.parse(FakeWebSocket.last.sent.at(-1))).toEqual({ t: "release?" });
  });
});

describe("a room of a newer protocol", () => {
  it("lets the page go with update_required: no reconnect, and the seat's session is kept for the reload", () => {
    const storage = memory();
    const c = client({ release: MINE, storage });
    storage.setItem(c.storeKey, JSON.stringify(c.session));
    const closed = [];
    c.on("closed", (...a) => closed.push(a));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.readyState = 3;
    FakeWebSocket.last.onclose({ code: 4000, reason: UPDATE_REQUIRED });
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.made).toHaveLength(1);
    expect(closed).toEqual([[UPDATE_REQUIRED, UPDATE_REQUIRED]]);
    expect(JSON.parse(storage.getItem(c.storeKey))).toMatchObject({ token: TOKEN });
  });

  it("a plain room close (4000) still forgets the session", () => {
    const storage = memory();
    const c = client({ release: MINE, storage });
    storage.setItem(c.storeKey, JSON.stringify(c.session));
    c.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.readyState = 3;
    FakeWebSocket.last.onclose({ code: 4000, reason: "room_closed" });
    expect(storage.getItem(c.storeKey)).toBeNull();
  });
});
