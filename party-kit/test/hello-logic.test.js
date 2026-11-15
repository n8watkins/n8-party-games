// The pure part of the socket handshake (hello-logic.js): reading the first message, and the
// sockets that have not said whose they are yet.
import { describe, expect, it } from "vitest";
import { CLOSE_HELLO_LATE, HELLO_MS, MAX_TOKEN_LENGTH, MAX_UNKNOWN, UnknownSockets, readHello } from "../src/worker/hello-logic.js";

const START = 1_700_000_000_000;

class Socket {
  constructor() {
    this.closed = null;
    this.attachment = null;
  }
  close(code, reason) {
    this.closed ??= { code, reason };
  }
  serializeAttachment(v) {
    this.attachment = structuredClone(v);
  }
}

describe("readHello", () => {
  it("takes the token out of a hello", () => {
    expect(readHello(JSON.stringify({ t: "hello", token: "abc" }), 512)).toBe("abc");
  });

  it.each([
    ["a binary frame", new ArrayBuffer(4)],
    ["text that is not JSON", "hello"],
    ["the keep-alive", "ping"],
    ["a list", JSON.stringify([{ t: "hello", token: "abc" }])],
    ["a number", "7"],
    ["null", "null"],
    ["another message", JSON.stringify({ t: "ready", v: true })],
    ["a message with a token and no hello", JSON.stringify({ t: "in", token: "abc" })],
  ])("is not a hello: %s", (_, data) => {
    expect(readHello(data, 512)).toBeNull();
  });

  it("is not a hello when it is longer than a message may be", () => {
    const long = JSON.stringify({ t: "hello", token: "abc", pad: "x".repeat(600) });
    expect(readHello(long, 512)).toBeNull();
    expect(readHello(long, 2048)).toBe("abc");
  });

  it.each([
    ["none", { t: "hello" }],
    ["an empty one", { t: "hello", token: "" }],
    ["a number", { t: "hello", token: 7 }],
    ["one too long to be a seat's", { t: "hello", token: "x".repeat(MAX_TOKEN_LENGTH + 1) }],
  ])("a hello whose token cannot be a seat's is a hello with no seat: %s", (_, msg) => {
    expect(readHello(JSON.stringify(msg), 512)).toBe("");
  });
});

describe("UnknownSockets", () => {
  it("writes on the socket that it is not known yet, with no token", () => {
    const unknown = new UnknownSockets();
    const ws = new Socket();
    unknown.add(ws, START, 150);
    expect(ws.attachment).toEqual({ unknown: true, at: START, lag: 150 });
    expect(unknown.has(ws)).toBe(true);
    expect(unknown.size).toBe(1);
    expect(unknown.take(ws)).toEqual({ unknown: true, at: START, lag: 150 });
    expect(unknown.has(ws)).toBe(false);
    expect(unknown.take(ws)).toBeNull();
  });

  it("closes the ones that said nothing in time, and only those", () => {
    const unknown = new UnknownSockets();
    const [old, young] = [new Socket(), new Socket()];
    unknown.add(old, START, 0);
    unknown.add(young, START + HELLO_MS - 1000, 0);
    unknown.clear(START + HELLO_MS);
    expect(old.closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "hello_late" });
    expect(young.closed).toBeNull();
    expect(unknown.size).toBe(1);
  });

  it("never holds more than its cap: one more arriving closes the one that has waited longest", () => {
    const unknown = new UnknownSockets();
    const all = Array.from({ length: MAX_UNKNOWN + 3 }, () => new Socket());
    all.forEach((ws, i) => unknown.add(ws, START + i, 0));
    expect(unknown.size).toBe(MAX_UNKNOWN);
    expect(all.slice(0, 3).map((ws) => ws.closed)).toEqual(Array(3).fill({ code: CLOSE_HELLO_LATE, reason: "crowded" }));
    expect(all.slice(3).every((ws) => ws.closed === null)).toBe(true);
  });

  it("after a sleep, takes back the sockets that were waiting, oldest first again", () => {
    const unknown = new UnknownSockets();
    const all = Array.from({ length: MAX_UNKNOWN }, () => new Socket());
    // The runtime hands them back in no promised order.
    all.forEach((ws, i) => unknown.restore(ws, { unknown: true, at: START + (MAX_UNKNOWN - i), lag: 0 }));
    const one = new Socket();
    unknown.add(one, START + 100, 0);
    expect(all.at(-1).closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "crowded" });
    expect(all.slice(0, -1).every((ws) => ws.closed === null)).toBe(true);
  });

  it("a socket that will not close is still let go", () => {
    const unknown = new UnknownSockets();
    const ws = new Socket();
    ws.close = () => {
      throw new Error("already closed");
    };
    unknown.add(ws, START, 0);
    unknown.clear(START + HELLO_MS);
    expect(unknown.size).toBe(0);
  });
});
