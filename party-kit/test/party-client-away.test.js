// The client's away helper: a page that is hidden with its socket open tells the room it is away
// (`{t:"away"}`) and shown again that it is back (`{t:"back"}`), once per change; the room hears
// it again on every new connection while the page is hidden; and a page shown with its
// connection lost reconnects at once instead of waiting out the back-off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyClient } from "../client/party-client.js";
import { FakeWebSocket } from "./fake-browser-socket.js";

const turns = { phase: "playing", game: { id: "who-am-i", name: "Who Am I?", round: 1, turns: true } };

function connected() {
  const client = new PartyClient({ base: "https://party.test", api: "/api/lobby", storage: null, quietPing: { text: "ping", everyMs: 10_000 } });
  client.session = { code: "BCDFGH", token: "tok" };
  client.connect();
  const ws = FakeWebSocket.last;
  ws.open();
  ws.hear({ t: "hello", you: { role: "player", seat: 0 }, room: turns });
  ws.sent.length = 0;
  return { client, ws };
}

/** What was said about being here, in order. */
const presence = (ws) => ws.kinds().filter((k) => k === "away" || k === "back");

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.made = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("setAway", () => {
  it("says away and back once per change, and keeps the socket", () => {
    const { client, ws } = connected();
    expect(client.setAway(true)).toBe(true);
    expect(client.setAway(true)).toBe(false);
    expect(presence(ws)).toEqual(["away"]);
    expect(ws.closedByPage).toBe(false);
    expect(client.status).toBe("open");
    expect(client.setAway(false)).toBe(true);
    expect(client.setAway(false)).toBe(false);
    expect(presence(ws)).toEqual(["away", "back"]);
    expect(FakeWebSocket.made).toHaveLength(1);
  });

  it("is remembered across a reconnect: a new socket of a hidden page says away first, one of a showing page says nothing", () => {
    const { client, ws } = connected();
    client.setAway(true);
    ws.die();
    vi.advanceTimersByTime(4000);
    const again = FakeWebSocket.last;
    expect(again).not.toBe(ws);
    expect(again.url).toContain("token=tok");
    again.open();
    expect(again.kinds()[0]).toBe("away");

    client.setAway(false);
    again.die();
    vi.advanceTimersByTime(4000);
    const third = FakeWebSocket.last;
    third.open();
    expect(presence(third)).toEqual([]);
  });

  it("shown with the connection lost, reconnects at once, and only once", () => {
    const { client, ws } = connected();
    client.setAway(true);
    ws.die();
    expect(client.status).toBe("reconnecting");
    // The page is suspended (no timers run), then shown: no waiting out the back-off.
    expect(client.setAway(false)).toBe(false);
    expect(FakeWebSocket.made).toHaveLength(2);
    const again = FakeWebSocket.last;
    again.open();
    expect(client.status).toBe("open");
    expect(presence(again)).toEqual([]);
    // The back-off's own reconnect does not open a second socket later.
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.made).toHaveLength(2);
  });

  it("while hidden with the socket connecting, says away as it opens", () => {
    const { client, ws } = connected();
    ws.die();
    vi.advanceTimersByTime(4000);
    const again = FakeWebSocket.last;
    expect(client.setAway(true)).toBe(false);
    again.open();
    expect(presence(again)).toEqual(["away"]);
  });

  it("does not reopen a connection the page closed on purpose", () => {
    const { client } = connected();
    client.dropConnection();
    client.setAway(false);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.made).toHaveLength(1);
    client.leave();
    client.setAway(false);
    expect(FakeWebSocket.made).toHaveLength(1);
  });
});
