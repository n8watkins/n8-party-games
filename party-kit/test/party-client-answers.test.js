// PartyClient.sendInput with an id: a promise for the room's answer from a turn-based game, with
// a timeout, the same promise for the same id sent again, and fire and forget as before without
// an id or in a ticking game.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_TIMEOUT_MS, PartyClient, PartyError } from "../client/party-client.js";

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
  inputs() {
    return this.sent.filter((t) => t.startsWith("{")).map((t) => JSON.parse(t)).filter((m) => m.t === "in");
  }
}

const turns = { phase: "playing", game: { id: "who-am-i", name: "Who Am I?", round: 1, turns: true } };
const ticking = { phase: "playing", game: { id: "cork-and-bell", name: "Cork & Bell", round: 1 } };

function connected(room = turns) {
  const client = new PartyClient({ base: "https://party.test", api: "/api/lobby", storage: null, quietPing: { text: "ping", everyMs: 10_000 } });
  client.session = { code: "BCDFGH", token: "t" };
  client.connect();
  const ws = FakeWebSocket.last;
  ws.open();
  ws.hear({ t: "hello", you: { role: "player", seat: 0 }, room });
  ws.sent.length = 0;
  return { client, ws };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sendInput with an id", () => {
  it("resolves on ack and rejects on the game's error, and only for its own id", async () => {
    const { client, ws } = connected();
    const errors = [];
    client.on("error", (err) => errors.push(err));
    const asked = client.sendInput({ say: "Am I alive?" }, { id: "q-1" });
    const guessed = client.sendInput({ guess: "owl" }, { id: 2 });
    expect(ws.inputs()).toEqual([
      { t: "in", d: { say: "Am I alive?" }, id: "q-1" },
      { t: "in", d: { guess: "owl" }, id: 2 },
    ]);
    ws.hear({ t: "error", id: 2, error: "not_your_turn", message: "It is not your turn." });
    ws.hear({ t: "ack", id: "q-1" });
    await expect(asked).resolves.toEqual({ ok: true, id: "q-1" });
    const err = await guessed.catch((e) => e);
    expect(err).toBeInstanceOf(PartyError);
    expect(err).toMatchObject({ code: "not_your_turn", message: "It is not your turn.", id: 2 });
    // An error that answered a promise is not also an error event.
    expect(errors).toEqual([]);
    // One nobody waits for ("2" is not the id 2) goes to the error event, and so does one with no id.
    ws.hear({ t: "error", id: "2", error: "x", message: "y" });
    ws.hear({ t: "error", error: "room_full", message: "Full." });
    expect(errors.map((e) => [e.code, e.id])).toEqual([
      ["x", "2"],
      ["room_full", undefined],
    ]);
  });

  it("gives the same promise for the same id sent again, and sends it again", async () => {
    const { client, ws } = connected();
    const first = client.sendInput({ guess: "owl" }, { id: "g" });
    const again = client.sendInput({ guess: "owl" }, { id: "g" });
    expect(again).toBe(first);
    expect(ws.inputs()).toHaveLength(2);
    ws.hear({ t: "ack", id: "g" });
    await expect(first).resolves.toEqual({ ok: true, id: "g" });
  });

  it("times out when the room says nothing, and rejects when the connection drops", async () => {
    const { client, ws } = connected();
    const slow = client.sendInput({ say: "?" }, { id: "slow" });
    const quick = client.sendInput({ say: "?" }, { id: "quick", timeoutMs: 500 });
    const quickErr = quick.catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await quickErr).toMatchObject({ code: "timeout" });
    const slowErr = slow.catch((e) => e);
    await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS - 501);
    // Still waiting; then the socket closes before the answer.
    ws.onclose({ code: 1006 });
    expect(await slowErr).toMatchObject({ code: "disconnected" });
    expect(client.answers.size).toBe(0);
    // Not connected at all: rejected at once.
    await expect(client.sendInput({ say: "?" }, { id: "none" })).rejects.toMatchObject({ code: "not_connected" });
  });

  it("rejects an id the room would not read", async () => {
    const { client, ws } = connected();
    for (const id of ["", "x".repeat(65), 1.5, {}]) await expect(client.sendInput({}, { id })).rejects.toMatchObject({ code: "bad_id" });
    expect(ws.inputs()).toEqual([]);
  });
});

describe("sendInput without an id, or in a ticking game", () => {
  it("is fire and forget, as before", async () => {
    const { client, ws } = connected(ticking);
    expect(client.sendInput({ fire: 1 })).toBe(true);
    // A ticking game answers nothing: the input goes without its id and the promise resolves at once.
    await expect(client.sendInput({ fire: 2 }, { id: "f" })).resolves.toEqual({ ok: true, id: "f", answered: false });
    expect(ws.inputs()).toEqual([
      { t: "in", d: { fire: 1 } },
      { t: "in", d: { fire: 2 } },
    ]);
    const turn = connected(turns);
    expect(turn.client.sendInput({ say: "hi" })).toBe(true);
    expect(turn.ws.inputs()).toEqual([{ t: "in", d: { say: "hi" } }]);
  });
});
