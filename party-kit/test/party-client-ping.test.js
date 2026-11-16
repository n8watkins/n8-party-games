// How often the kit's client talks to its room when nobody does anything. A room is billed for
// every event that wakes it, so during a turn-based game (`room.game.turns`) the page keeps to the
// keep-alive the runtime answers by itself and never wakes the room; it sets its clock with a few
// round trips when the game begins and after a reconnect. A ticking game keeps its quick clock pings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyClient } from "../client/party-client.js";

class FakeWebSocket {
  static OPEN = 1;
  static last = null;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.last = this;
  }
  send(text) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  hear(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** What was sent: the keep-alive text as "keep-alive", a clock ping as "clock", anything else by its `t`. */
  kinds() {
    return this.sent.map((text) => (text === "ping" ? "keep-alive" : JSON.parse(text).t === "ping" ? "clock" : JSON.parse(text).t));
  }
}

const lobby = { phase: "lobby", game: null };
const turns = (round = 1) => ({ phase: "playing", game: { id: "who-am-i", name: "Who Am I?", round, turns: true } });
const ticking = { phase: "playing", game: { id: "cork-and-bell", name: "Cork & Bell", round: 1 } };

function connected() {
  const client = new PartyClient({ base: "https://party.test", api: "/api/lobby", storage: null, quietPing: { text: "ping", everyMs: 10_000 } });
  client.session = { code: "BCDFGH", token: "t" };
  client.connect();
  const ws = FakeWebSocket.last;
  ws.open();
  ws.hear({ t: "hello", you: { role: "player", seat: 0 }, room: lobby });
  ws.sent.length = 0;
  return { client, ws };
}

const count = (ws, kind) => ws.kinds().filter((k) => k === kind).length;

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the client's pings", () => {
  it("in the lobby: only the keep-alive, every ten seconds", () => {
    const { ws } = connected();
    vi.advanceTimersByTime(60_000);
    expect(ws.kinds()).toEqual(Array(6).fill("keep-alive"));
  });

  it("in a turn-based game: three clock pings as it begins, then only the keep-alive", () => {
    const { client, ws } = connected();
    ws.hear({ t: "start", room: turns(), s: {}, now: Date.now() });
    vi.advanceTimersByTime(1000);
    expect(count(ws, "clock")).toBe(3);
    // A room message mid-game (someone joined) sets nothing off again.
    ws.hear({ t: "room", room: turns() });
    ws.sent.length = 0;
    vi.advanceTimersByTime(10 * 60_000);
    expect(count(ws, "clock")).toBe(0);
    expect(count(ws, "keep-alive")).toBe(60);
    // The clock is set from the replies.
    ws.hear({ t: "pong", c: Date.now() - 100, s: Date.now() + 5000 });
    expect(Math.round(client.now() - Date.now())).toBe(5050);
  });

  it("sets the clock again after a reconnect, and for the next game", () => {
    const { client, ws } = connected();
    ws.hear({ t: "start", room: turns(1), s: {}, now: Date.now() });
    vi.advanceTimersByTime(5000);
    client.dropConnection({ reconnectAfterMs: 100 });
    vi.advanceTimersByTime(100);
    const again = FakeWebSocket.last;
    expect(again).not.toBe(ws);
    again.open();
    again.hear({ t: "hello", you: { role: "player", seat: 0 }, room: turns(1) });
    vi.advanceTimersByTime(1000);
    expect(count(again, "clock")).toBe(3);
    again.hear({ t: "end", room: lobby });
    again.hear({ t: "start", room: turns(2), s: {}, now: Date.now() });
    vi.advanceTimersByTime(1000);
    expect(count(again, "clock")).toBe(6);
  });

  it("in a ticking game: clock pings every two seconds, as before", () => {
    const { ws } = connected();
    ws.hear({ t: "start", room: ticking, s: {}, now: Date.now() });
    vi.advanceTimersByTime(1000);
    // One at once and three quick ones in the first second.
    expect(count(ws, "clock")).toBe(4);
    ws.sent.length = 0;
    vi.advanceTimersByTime(20_000);
    expect(count(ws, "clock")).toBe(10);
    expect(count(ws, "keep-alive")).toBe(0);
  });
});
