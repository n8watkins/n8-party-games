// The client fixes from the review of the turn-based stack: ids that stay unique across reloads
// (F1), an error for an input nobody waits for (N8), and the clock pings of a turn-based game
// cancelled when the connection comes back fast (N8).
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
  clockPings() {
    return this.sent.filter((t) => t.startsWith("{") && JSON.parse(t).t === "ping").length;
  }
}

const turns = { phase: "playing", game: { id: "who-am-i", name: "Who Am I?", round: 1, turns: true } };

function client() {
  const c = new PartyClient({ base: "https://party.test", api: "/api/lobby", storage: null, quietPing: { text: "ping", everyMs: 10_000 } });
  c.session = { code: "BCDFGH", token: "t" };
  return c;
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("F1: nextInputId", () => {
  it("gives ids that differ between page loads and within one, and that the room reads", () => {
    const first = client();
    const reloaded = client();
    const ids = [first.nextInputId(), first.nextInputId(), reloaded.nextInputId(), reloaded.nextInputId()];
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("N8: the client", () => {
  it("emits an error with an id nobody waits for on the error event", () => {
    const c = client();
    c.connect();
    const ws = FakeWebSocket.last;
    ws.open();
    const seen = [];
    c.on("error", (err) => seen.push(err));
    ws.hear({ t: "error", id: "late", error: "not_your_turn", message: "It is not your turn." });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ code: "not_your_turn", id: "late" });
  });

  it("cancels a turn-based game's follow-up clock pings when the connection comes back fast", async () => {
    const c = client();
    c.connect();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.hear({ t: "hello", you: { role: "player", seat: 0 }, room: turns });
    // Dropped at once and back on the client's own retry: the new connection sets the clock with its own pings only.
    ws.onclose({ code: 1006 });
    await vi.advanceTimersByTimeAsync(500);
    const ws2 = FakeWebSocket.last;
    expect(ws2).not.toBe(ws);
    ws2.open();
    ws2.hear({ t: "hello", you: { role: "player", seat: 0 }, room: turns });
    await vi.advanceTimersByTimeAsync(1500);
    expect(ws2.clockPings()).toBe(3);
  });
});
