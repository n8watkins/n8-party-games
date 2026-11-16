// The pure part of the socket handshake (hello-logic.js): reading the first message, and the
// sockets that have not said whose they are yet.
import { describe, expect, it } from "vitest";
import { CLOSE_HELLO_LATE, HELLO_MS, KnownClients, MAX_KNOWN_CLIENTS, MAX_TOKEN_LENGTH, MAX_UNKNOWN, MAX_UNKNOWN_PER_CLIENT, UnknownSockets, readHello } from "../src/worker/hello-logic.js";
import { RATE_LIMITS, socketClient } from "../src/worker/limit-logic.js";

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
    expect(ws.attachment).toEqual({ unknown: true, at: START, lag: 150, client: "local" });
    expect(unknown.has(ws)).toBe(true);
    expect(unknown.size).toBe(1);
    expect(unknown.take(ws)).toEqual({ unknown: true, at: START, lag: 150, client: "local" });
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

  it("writes on the socket which client it came from, and counts a socket with no address as the local one", () => {
    const unknown = new UnknownSockets();
    const [a, b] = [new Socket(), new Socket()];
    unknown.add(a, START, 0, "203.0.113.7");
    unknown.add(b, START, 0);
    expect(a.attachment).toEqual({ unknown: true, at: START, lag: 0, client: "203.0.113.7" });
    expect(b.attachment.client).toBe("local");
  });

  it("a client never holds more than its share: one more from it closes that client's oldest, and nobody else's", () => {
    const unknown = new UnknownSockets();
    const other = new Socket();
    unknown.add(other, START, 0, "198.51.100.1");
    const mine = Array.from({ length: MAX_UNKNOWN_PER_CLIENT + 3 }, () => new Socket());
    mine.forEach((ws, i) => unknown.add(ws, START + 1 + i, 0, "203.0.113.7"));
    expect(unknown.countOf("203.0.113.7")).toBe(MAX_UNKNOWN_PER_CLIENT);
    expect(mine.slice(0, 3).map((ws) => ws.closed)).toEqual(Array(3).fill({ code: CLOSE_HELLO_LATE, reason: "crowded" }));
    expect(mine.slice(3).every((ws) => ws.closed === null)).toBe(true);
    // The older socket of another client was not touched.
    expect(other.closed).toBeNull();
  });

  it("holds a whole party on one home's wifi coming back at once (four phones and the screen)", () => {
    expect(MAX_UNKNOWN_PER_CLIENT).toBeGreaterThanOrEqual(5);
    const unknown = new UnknownSockets();
    const party = Array.from({ length: 5 }, () => new Socket());
    party.forEach((ws) => unknown.add(ws, START, 0, "203.0.113.7"));
    expect(party.every((ws) => ws.closed === null)).toBe(true);
  });

  it("when the room is full, the client holding the most gives way, its oldest first, and a client with one is left alone", () => {
    const unknown = new UnknownSockets();
    // Many clients, two waiting each, and one greedy client with its whole share.
    const greedy = Array.from({ length: MAX_UNKNOWN_PER_CLIENT }, () => new Socket());
    greedy.forEach((ws, i) => unknown.add(ws, START + 1000 + i, 0, "greedy"));
    for (let i = 0; unknown.size < MAX_UNKNOWN - 1; i++) unknown.add(new Socket(), START + i, 0, `pair-${Math.floor(i / 2)}`);
    const lone = new Socket();
    unknown.add(lone, START, 0, "lone");
    expect(unknown.size).toBe(MAX_UNKNOWN);
    // Three more from new clients: each time the greedy client's oldest goes, though the pairs and the lone socket are older.
    for (let i = 0; i < 3; i++) unknown.add(new Socket(), START + 2000 + i, 0, `new-${i}`);
    expect(unknown.size).toBe(MAX_UNKNOWN);
    expect(greedy.slice(0, 3).map((ws) => ws.closed?.reason)).toEqual(["crowded", "crowded", "crowded"]);
    expect(greedy.slice(3).every((ws) => ws.closed === null)).toBe(true);
    expect(lone.closed).toBeNull();
  });

  it("when the room is full, a socket from a network the room has never let in gives way before any from one it knows", () => {
    const known = new KnownClients(["home"]);
    const unknown = new UnknownSockets((c) => known.has(c));
    const mine = Array.from({ length: 3 }, () => new Socket());
    mine.forEach((ws) => unknown.add(ws, START, 0, "home"));
    const strangers = Array.from({ length: MAX_UNKNOWN - 3 }, () => new Socket());
    strangers.forEach((ws, i) => unknown.add(ws, START + 1 + i, 0, `c-${i}`));
    unknown.add(new Socket(), START + 500, 0, "newcomer");
    // The home network holds the most and waited longest, and still the oldest stranger went.
    expect(mine.every((ws) => ws.closed === null)).toBe(true);
    expect(strangers[0].closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "crowded" });
    // With no stranger left waiting, the known networks share out the room as anyone would.
    const all = new UnknownSockets(() => true);
    const greedy = Array.from({ length: 4 }, () => new Socket());
    greedy.forEach((ws) => all.add(ws, START, 0, "greedy"));
    for (let i = 0; all.size < MAX_UNKNOWN; i++) all.add(new Socket(), START + 1, 0, `k-${i}`);
    all.add(new Socket(), START + 2, 0, "late");
    expect(greedy[0].closed?.reason).toBe("crowded");
  });

  it("KnownClients keeps what it is given, takes only text, and nothing once full", () => {
    const known = new KnownClients(["a"]);
    expect(known.add("a")).toBe(false);
    expect(known.add("b")).toBe(true);
    expect(known.add(undefined)).toBe(false);
    expect(known.add("")).toBe(false);
    expect(known.list()).toEqual(["a", "b"]);
    expect(new KnownClients(undefined).list()).toEqual([]);
    const full = new KnownClients(Array.from({ length: MAX_KNOWN_CLIENTS + 5 }, (_, i) => `n-${i}`));
    expect(full.list()).toHaveLength(MAX_KNOWN_CLIENTS);
    expect(full.add("late")).toBe(false);
    expect(full.has("n-0")).toBe(true);
  });

  it("a room full of fresh silent sockets from 128 addresses, one each, does not keep a phone out: it is let in, and stays until a full room's worth of newer opens land", () => {
    const unknown = new UnknownSockets();
    for (let i = 0; i < MAX_UNKNOWN; i++) unknown.add(new Socket(), START + i, 0, `hostile-${i}`);
    const phone = new Socket();
    unknown.add(phone, START + 1000, 0, "phone");
    expect(phone.closed).toBeNull();
    expect(unknown.has(phone)).toBe(true);
    // Newer opens inside its round trip, each from an address of its own: the older lone ones go first.
    for (let i = 0; i < MAX_UNKNOWN - 1; i++) unknown.add(new Socket(), START + 1001 + i, 0, `later-${i}`);
    expect(unknown.has(phone)).toBe(true);
    unknown.add(new Socket(), START + 2000, 0, "one too many");
    expect(phone.closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "crowded" });
  });

  it("two phones on one carrier /48, two tabs each, coming back at the same moment are all let wait", () => {
    expect(MAX_UNKNOWN_PER_CLIENT).toBeGreaterThanOrEqual(4);
    const unknown = new UnknownSockets();
    const tabs = ["2001:db8:1:2::a", "2001:db8:1:2::a", "2001:db8:1:9::b", "2001:db8:1:9::b"].map((ip) => {
      const ws = new Socket();
      unknown.add(ws, START, 0, socketClient(ip));
      return ws;
    });
    expect(unknown.countOf("2001:db8:1::/48")).toBe(4);
    expect(tabs.every((ws) => ws.closed === null)).toBe(true);
  });

  it("when every client holds one and the room is full, the oldest of all goes (the newcomer stays)", () => {
    const unknown = new UnknownSockets();
    const all = Array.from({ length: MAX_UNKNOWN }, () => new Socket());
    all.forEach((ws, i) => unknown.add(ws, START + i, 0, `c-${i}`));
    const one = new Socket();
    unknown.add(one, START + 500, 0, "newcomer");
    expect(all[0].closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "crowded" });
    expect(all.slice(1).every((ws) => ws.closed === null)).toBe(true);
    expect(one.closed).toBeNull();
  });

  it("after a sleep, takes back the sockets that were waiting with their clients, oldest first again", () => {
    const unknown = new UnknownSockets();
    const all = Array.from({ length: MAX_UNKNOWN_PER_CLIENT }, () => new Socket());
    // The runtime hands them back in no promised order.
    all.forEach((ws, i) => unknown.restore(ws, { unknown: true, at: START + (MAX_UNKNOWN_PER_CLIENT - i), lag: 0, client: "203.0.113.7" }));
    const one = new Socket();
    unknown.add(one, START + 100, 0, "203.0.113.7");
    expect(all.at(-1).closed).toEqual({ code: CLOSE_HELLO_LATE, reason: "crowded" });
    expect(all.slice(0, -1).every((ws) => ws.closed === null)).toBe(true);
  });

  it("a socket kept from before clients were written down counts as the local client", () => {
    const unknown = new UnknownSockets();
    const old = new Socket();
    unknown.restore(old, { unknown: true, at: START, lag: 0 });
    expect(unknown.countOf("local")).toBe(1);
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

/**
 * The attack from the review of the first version: someone who knows a room's code keeps opening
 * silent sockets from many addresses, so that a real phone's socket is pushed out during the one
 * round trip it waits for its hello to land (accepted, 101 back, onopen, the hello travels). With
 * one shared cap of eight, 40 addresses kept a phone out at any round trip from 100 ms up.
 */
describe("silent sockets from many addresses, against a phone waiting one round trip for its hello", () => {
  const perSecond = RATE_LIMITS.socket.limit / (RATE_LIMITS.socket.windowMs / 1000);

  /**
   * Whether the phone's socket is still waiting when its hello lands. Every hostile client opens
   * as fast as the door lets it (`perSecond`, staggered across clients), and with `burst` also
   * that many more each inside the phone's round trip (the door's window is a minute, so a whole
   * minute's opens can come at once).
   */
  function phoneSeated({ clients, rtt, phase, burst = 0 }) {
    const unknown = new UnknownSockets();
    const opens = [];
    const gap = 1000 / perSecond;
    for (let c = 0; c < clients; c++) for (let t = (c / clients) * gap; t < 12_000; t += gap) opens.push({ at: t, client: `hostile-${c}` });
    const phoneAt = 5_000 + phase;
    for (let c = 0; c < clients; c++) for (let k = 1; k <= burst; k++) opens.push({ at: phoneAt + (k * rtt) / (burst + 1), client: `hostile-${c}` });
    opens.sort((a, b) => a.at - b.at);
    const phone = new Socket();
    let added = false;
    for (const open of opens) {
      if (!added && open.at >= phoneAt) {
        unknown.add(phone, START + phoneAt, 0, "the phone's");
        added = true;
      }
      if (open.at > phoneAt + rtt) break;
      unknown.add(new Socket(), START + open.at, 0, open.client);
    }
    return unknown.has(phone) && phone.closed === null;
  }

  for (const clients of [1, 5, 20, 40, 100]) {
    it(`a phone is seated at every round trip up to 2 s against ${clients} hostile addresses opening as fast as the door allows`, () => {
      for (const rtt of [50, 100, 250, 500, 1000, 2000]) for (let i = 0; i < 10; i++) expect(phoneSeated({ clients, rtt, phase: (i * 500) / 10 }), `rtt ${rtt}, trial ${i}`).toBe(true);
    });
  }

  it("a phone on a network the room knows is seated against 1,000 addresses, even when someone has filled the room's list of known networks with theirs", () => {
    // Fewer known networks than sockets may wait: with the room full of known networks' sockets
    // alone, one of those networks holds two, and gives way before a phone alone on its own.
    expect(MAX_KNOWN_CLIENTS).toBeLessThan(MAX_UNKNOWN);
    const known = new KnownClients(["phone", ...Array.from({ length: MAX_KNOWN_CLIENTS - 1 }, (_, i) => `hostile-${i}`)]);
    expect(known.add("one more")).toBe(false);
    for (const rtt of [100, 500, 2000]) {
      const unknown = new UnknownSockets((c) => known.has(c));
      const phone = new Socket();
      unknown.add(phone, START, 0, "phone");
      // The known ones and 1,000 strangers, all inside the round trip.
      for (let i = 0; i < 4000; i++) unknown.add(new Socket(), START + (i * rtt) / 4000, 0, i % 2 ? `hostile-${i % (MAX_KNOWN_CLIENTS - 1)}` : `stranger-${i % 1000}`);
      expect(unknown.has(phone), `rtt ${rtt}`).toBe(true);
    }
  });

  it("what is left: a phone on a network the room has never seen, against more addresses than may wait, each opening inside its round trip", () => {
    expect(phoneSeated({ clients: MAX_UNKNOWN, rtt: 1000, phase: 0 })).toBe(false);
    expect(phoneSeated({ clients: MAX_UNKNOWN, rtt: 250, phase: 0 })).toBe(true);
  });

  it("and against 40 hostile addresses that each spend a whole minute's opens inside its round trip", () => {
    for (const rtt of [100, 500, 2000]) for (let i = 0; i < 3; i++) expect(phoneSeated({ clients: 40, rtt, phase: i * 100, burst: RATE_LIMITS.socket.limit }), `rtt ${rtt}`).toBe(true);
  });
});
