// The party room's page when it is hidden and shown (connection.js), with the kit's real client
// over a fake socket and no browser. In the lobby and in a ticking game a locked phone parks its
// connection, as it always did. In a turn-based game a hidden page keeps its socket and says it is
// away, then back; a socket that died while the page was hidden is opened again the moment the
// page is shown, with the same seat's token.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartyClient } from "../../party-kit/client/party-client.js";
import { FakeWebSocket } from "../../party-kit/test/fake-browser-socket.js";
import { ConnectionWatch, DEAD_AFTER_MS, KEEP_ALIVE_MS, awayLeft, awayLine, clockText, turnBased, whenHidden } from "../public/connection.js";

const lobby = { phase: "lobby", game: null, members: [] };
const turns = { phase: "playing", game: { id: "who-am-i", name: "Who Am I?", round: 1, turns: true }, members: [] };
const ticking = { phase: "playing", game: { id: "cork-and-bell", name: "Cork & Bell", round: 1 }, members: [] };

/** A page in the room as a player (or the screen), on a phone (touch) or a desktop. */
function page(room, { touch = true, role = "player" } = {}) {
  const link = new PartyClient({ base: "https://party.test", api: "/api/lobby", storage: null, quietPing: { text: "ping", everyMs: KEEP_ALIVE_MS } });
  link.session = { code: "BCDFGH", token: "tok" };
  link.connect();
  const ws = FakeWebSocket.last;
  ws.open();
  ws.hear({ t: "hello", you: { role, seat: role === "player" ? 0 : -1 }, room });
  ws.sent.length = 0;
  const watch = new ConnectionWatch(link, { player: () => link.you?.role === "player", touch });
  // As watchConnection wires it: the room changing while the page is hidden.
  const state = { hidden: false };
  link.on("room", () => watch.roomChanged(state.hidden));
  const hide = () => {
    state.hidden = true;
    watch.hidden();
  };
  const show = () => {
    state.hidden = false;
    watch.shown(true);
  };
  return { link, ws, watch, hide, show };
}

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

describe("whenHidden: park, or say away", () => {
  it.each([
    ["a phone in the lobby", { touch: true, player: true, room: lobby }, "park"],
    ["a phone in a ticking game", { touch: true, player: true, room: ticking }, "park"],
    ["a phone in a turn-based game", { touch: true, player: true, room: turns }, "away"],
    ["a desktop tab in the lobby", { touch: false, player: true, room: lobby }, "stay"],
    ["a desktop tab in a ticking game", { touch: false, player: true, room: ticking }, "stay"],
    ["a desktop tab in a turn-based game", { touch: false, player: true, room: turns }, "away"],
    ["the room's screen in the lobby", { touch: true, player: false, room: lobby }, "stay"],
    ["the room's screen in a turn-based game", { touch: false, player: false, room: turns }, "stay"],
    ["a page that has not heard the room yet", { touch: true, player: true, room: null }, "park"],
  ])("%s: %s", (_, at, what) => {
    expect(whenHidden(at)).toBe(what);
  });

  it("a turn-based game is one being played that says turns", () => {
    expect([lobby, ticking, turns, null].map(turnBased)).toEqual([false, false, true, false]);
  });
});

describe("a page hidden in the lobby or a ticking game", () => {
  it.each([
    ["the lobby", lobby],
    ["a ticking game", ticking],
  ])("in %s, a phone parks its connection as today, says nothing, and opens it again when shown", (_, room) => {
    const { link, ws, hide, show } = page(room);
    hide();
    expect(ws.closedByPage).toBe(true);
    expect(link.status).toBe("reconnecting");
    expect(presence(ws)).toEqual([]);
    // Parked: no reconnect while hidden, and the dead-connection check leaves it alone.
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.made).toHaveLength(1);
    show();
    expect(FakeWebSocket.made).toHaveLength(2);
    const again = FakeWebSocket.last;
    expect(again.url).not.toContain("tok");
    again.open();
    expect(again.helloToken()).toBe("tok");
    expect(presence(again)).toEqual([]);
  });

  it("a desktop tab keeps its connection and says nothing, as today", () => {
    const { ws, hide, show } = page(lobby, { touch: false });
    hide();
    show();
    expect(ws.closedByPage).toBe(false);
    expect(presence(ws)).toEqual([]);
  });
});

describe("a page hidden in a turn-based game", () => {
  it("keeps its socket and says away; shown again, says back and checks the socket with a keep-alive", () => {
    const { link, ws, watch, hide, show } = page(turns);
    hide();
    expect(ws.closedByPage).toBe(false);
    expect(link.status).toBe("open");
    expect(presence(ws)).toEqual(["away"]);
    // Hidden for long, with the keep-alive slowed or stopped and nothing heard: still away, not taken for dead.
    vi.advanceTimersByTime(5 * 60_000);
    watch.check(Date.now());
    expect(FakeWebSocket.made).toHaveLength(1);
    ws.sent.length = 0;
    show();
    expect(ws.kinds()).toEqual(["back", "keep-alive"]);
    expect(FakeWebSocket.made).toHaveLength(1);
    // The reply comes: the socket is alive and nothing more happens.
    ws.hear({ t: "room", room: turns });
    vi.advanceTimersByTime(DEAD_AFTER_MS);
    watch.check(Date.now());
    expect(FakeWebSocket.made).toHaveLength(1);
  });

  it("does the same on a desktop tab", () => {
    const { ws, hide, show } = page(turns, { touch: false });
    hide();
    show();
    expect(presence(ws)).toEqual(["away", "back"]);
    expect(ws.closedByPage).toBe(false);
  });

  it("the room's screen says nothing", () => {
    const { ws, hide, show } = page(turns, { role: "screen" });
    hide();
    show();
    expect(presence(ws)).toEqual([]);
    expect(ws.closedByPage).toBe(false);
  });

  it("a socket that died while the page was hidden is opened again the moment it is shown, with the seat's token, and is not away", () => {
    const { link, ws, hide, show } = page(turns);
    hide();
    // The phone suspended the page and the connection went; no timer ran meanwhile.
    ws.die();
    expect(link.status).toBe("reconnecting");
    show();
    expect(FakeWebSocket.made).toHaveLength(2);
    const again = FakeWebSocket.last;
    expect(again.url).not.toContain("tok");
    again.open();
    expect(again.helloToken()).toBe("tok");
    again.hear({ t: "hello", you: { role: "player", seat: 0 }, room: turns });
    expect(link.status).toBe("open");
    expect(link.you).toEqual({ role: "player", seat: 0 });
    expect(presence(again)).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.made).toHaveLength(2);
  });

  it("a socket that looks open but died while hidden is noticed soon after the page is shown, and opened again", () => {
    const { ws, watch, hide, show } = page(turns);
    hide();
    vi.advanceTimersByTime(5 * 60_000);
    show();
    // No reply to the back or the keep-alive: a few seconds' patience, not the full dead limit.
    vi.advanceTimersByTime(DEAD_AFTER_MS - KEEP_ALIVE_MS - 1);
    watch.check(Date.now());
    expect(FakeWebSocket.made).toHaveLength(1);
    vi.advanceTimersByTime(2);
    watch.check(Date.now());
    expect(ws.closedByPage).toBe(true);
    vi.advanceTimersByTime(0);
    expect(FakeWebSocket.made).toHaveLength(2);
    expect(FakeWebSocket.last.url).not.toContain("tok");
    FakeWebSocket.last.open();
    expect(FakeWebSocket.last.helloToken()).toBe("tok");
  });

  it("a connection that comes back while the page is still hidden says away at once", () => {
    const { ws, hide } = page(turns);
    hide();
    ws.die();
    vi.advanceTimersByTime(4000);
    const again = FakeWebSocket.last;
    again.open();
    // The hello that names the seat, then away: the first thing the seat says.
    expect(again.kinds().slice(0, 2)).toEqual(["hello", "away"]);
  });

  it("offline while hidden parks it; shown and online, it opens a socket that is showing", () => {
    const { ws, watch, hide, show } = page(turns);
    hide();
    watch.offline();
    expect(ws.closedByPage).toBe(true);
    show();
    const again = FakeWebSocket.last;
    expect(again).not.toBe(ws);
    again.open();
    expect(presence(again)).toEqual([]);
  });
});

describe("a page whose seat is gone for good", () => {
  it.each([
    ["the seat was let go", 4003, "bad_token"],
    ["the seat was given up on another socket", 4003, "left"],
    ["the room closed", 4000, "room_closed"],
  ])("%s while it was hidden: shown again, online again or looked at later, it opens no new socket", (_, code, reason) => {
    const { link, ws, watch, hide, show } = page(turns);
    hide();
    ws.readyState = 3;
    ws.onclose({ code, reason });
    expect(link.status).toBe("closed");
    show();
    watch.online(false);
    hide();
    watch.offline();
    show();
    watch.online(false);
    vi.advanceTimersByTime(60_000);
    watch.check(Date.now());
    expect(FakeWebSocket.made).toHaveLength(1);
    expect(link.status).toBe("closed");
  });

  it("the same in the lobby, where a hidden phone had parked its connection", () => {
    const { link, hide, show } = page(lobby);
    hide();
    show();
    const again = FakeWebSocket.last;
    again.open();
    again.readyState = 3;
    again.onclose({ code: 4003, reason: "bad_token" });
    hide();
    show();
    expect(FakeWebSocket.made).toHaveLength(2);
    expect(link.status).toBe("closed");
  });
});

describe("the activity changes while the page is hidden", () => {
  it("a turn-based game that ends parks a phone, as in the lobby", () => {
    const { ws, hide } = page(turns);
    hide();
    ws.hear({ t: "end", room: lobby, result: null, last: { rows: [] } });
    expect(ws.closedByPage).toBe(true);
    expect(presence(ws)).toEqual(["away"]);
  });

  it("a turn-based game that ends has a desktop tab say back, as it would be in the lobby", () => {
    const { ws, hide } = page(turns, { touch: false });
    hide();
    ws.hear({ t: "end", room: lobby, result: null, last: { rows: [] } });
    expect(ws.closedByPage).toBe(false);
    expect(presence(ws)).toEqual(["away", "back"]);
  });

  it("a turn-based game that begins finds a hidden desktop tab away", () => {
    const { ws, hide, show } = page(lobby, { touch: false });
    hide();
    ws.hear({ t: "start", room: turns, s: {}, now: Date.now() });
    expect(presence(ws)).toEqual(["away"]);
    show();
    expect(presence(ws)).toEqual(["away", "back"]);
  });
});

describe("awayLine", () => {
  it("names who is away, plainly", () => {
    expect(awayLine([])).toBe("");
    expect(awayLine(["Bo"])).toBe("Bo is away");
    expect(awayLine(["Bo", "Cy"])).toBe("Bo and Cy are away");
    expect(awayLine(["Ann", "Bo", "Cy"])).toBe("Ann, Bo and Cy are away");
  });

  it("with the room's time left, says what happens then", () => {
    expect(awayLine(["Bo"], 45_000)).toBe("Bo is away: back within 0:45 or the match ends");
    expect(awayLine(["Bo", "Cy"], 60_000)).toBe("Bo and Cy are away: back within 1:00 or the match ends");
    expect(awayLine(["Bo"], null)).toBe("Bo is away");
  });
});

describe("the time left on the away note", () => {
  it("is shown to the second, rounded up, and never below 0:00", () => {
    expect(clockText(60_000)).toBe("1:00");
    expect(clockText(44_001)).toBe("0:45");
    expect(clockText(9_000)).toBe("0:09");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(-5_000)).toBe("0:00");
  });

  it("counts down from when the room view came, from the first of them to run out", () => {
    const members = [{ awayIn: 30_000 }, { awayIn: 12_000 }, {}];
    expect(awayLeft(members, 1000, 1000)).toBe(12_000);
    expect(awayLeft(members, 1000, 6000)).toBe(7_000);
    expect(awayLeft(members, 1000, 60_000)).toBe(0);
    // An endless grace sends no time: the note says only who is away.
    expect(awayLeft([{ away: true }], 0, 0)).toBeNull();
  });

  it("lists a seat whose phone dropped mid-match with the hidden ones: the room gave it a time", async () => {
    const { awayOthers } = await import("../public/connection.js");
    const room = { game: { id: "turns", turns: true }, members: [{ seat: 0, name: "Ann", connected: true }, { seat: 1, name: "Bo", connected: false, awayIn: 30_000 }, { seat: 2, name: "Cy", connected: false }] };
    expect(awayOthers(room, { role: "player", seat: 0 }).map((m) => m.name)).toEqual(["Bo"]);
    expect(awayOthers(room, { role: "player", seat: 1 })).toEqual([]);
  });
});
