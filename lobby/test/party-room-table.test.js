// The Table's games on the real party room class: the list that follows the party's size, the
// host's pick (`play`) with its starting beat, the races between a pick, a switch and a start,
// the game played in turns with a secret per seat, reconnects, late joiners taken in as watchers
// (`join`), a seat gone for good while the game goes on (`leave`), a new host (`host`), the host
// ending it (`stop`), everyone back at the Table with the result, the Table's eight places, and
// the secret seed each match gets. Count to ten (party/games/count-to-ten) is the game: it keeps
// the same rules shape as Paper Masks and runs through the same adapter (party-kit/src/table/table-game.js).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeCtx, fakeEnv, settle, useFakeRuntime } from "./fake-room.js";
import { from } from "./turn-game.js";
import { TEST_WALL, WALL, buildTurnWall } from "../wall.js";
import { PLAY_BEAT_MS, tableWhyNot, tablePlayers, tableEntry } from "../shared/table.js";
import { MODE_COOLDOWN_MS } from "../shared/mode.js";
import { DROP_FADE_MS, HOST_GRACE_MS, MAX_PLAYERS, TABLE_MAX_PLAYERS, TURN_GRACE_MS, seatColour } from "../server/lobby-core.js";
import { TARGET, TURN_MS } from "../../party/games/count-to-ten/index.js";
import * as rules from "../../party/games/count-to-ten/rules.js";
import { tableGame } from "../../party-kit/src/table/table-game.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const GAME = "count-to-ten";
const NAMES = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal"];
const key = (seat) => NAMES[seat].toLowerCase();

/**
 * A party of `players` (Ann is the host) and, with `screen`, a big screen, all connected, moved
 * to the Table first so it may be larger than the Floor's four. Returns ways to say things and to
 * restart the room, as fake-room's openRoom does.
 */
async function table({ players = 3, screen = true, env = fakeEnv(), wall = TEST_WALL } = {}) {
  const Room = createLobbyRoom(() => wall);
  const ctx = fakeCtx();
  ctx.keepAlive = true;
  ctx.room = new Room(ctx, env);
  await settle();
  const say = (ws, msg) => ctx.room.webSocketMessage(ws, JSON.stringify(msg));
  const connect = async (token) => {
    await ctx.room.fetch(new Request("https://room/ws", { headers: { Upgrade: "websocket" } }));
    const ws = ctx.sockets.at(-1);
    say(ws, { t: "hello", token });
    await settle();
    return ws;
  };
  const tokens = {};
  const ws = {};
  tokens.ann = (await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" })).token;
  ws.ann = await connect(tokens.ann);
  say(ws.ann, { t: "mode", v: "turn-based" });
  await settle();
  expect(ctx.room.core.mode).toBe("turn-based");
  for (const name of NAMES.slice(1, players)) {
    tokens[name.toLowerCase()] = (await ctx.room.join({ nickname: name, as: "player" })).token;
    ws[name.toLowerCase()] = await connect(tokens[name.toLowerCase()]);
  }
  if (screen) {
    tokens.screen = (await ctx.room.join({ as: "screen" })).token;
    ws.screen = await connect(tokens.screen);
  }
  const sleepAndWake = async () => {
    ctx.room.stopTimer();
    ctx.room = new Room(ctx, env);
    await settle();
  };
  return { ctx, say, connect, tokens, ws, sleepAndWake, core: () => ctx.room.core };
}

/** The host picks the game and the beat runs out: the game is on. */
async function play(r, id = GAME, by = "ann") {
  r.say(r.ws[by], { t: "play", id });
  await settle();
  await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
  expect(r.core().activity.kind).toBe("game");
}

/** Whose turn it is: the seat, and its socket. */
function turnOf(r) {
  const state = r.core().activity.state;
  const seat = state.order[state.turn];
  return { seat, ws: r.ws[key(seat)] };
}

let ids = 0;
/** Whoever's turn it is adds `n`, with an answered input. */
async function press(r, n = 2) {
  r.say(turnOf(r).ws, { t: "in", d: { t: "add", n }, id: ++ids });
  await settle();
}

const lastRoom = (messages) => messages.filter((m) => m.room).at(-1)?.room;
const secretsOf = (r) => r.core().activity.state.secrets;

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("the Table's list", () => {
  it("follows the party's size, with the reason, and is in the room view only at the Table", async () => {
    expect(tableWhyNot(tableEntry({ id: "pm", name: "PM", players: { min: 3, max: 8 } }), 2)).toBe("Needs 3 or more");
    expect(tableWhyNot(tableEntry({ id: "w", name: "W", players: { min: 2, max: 2 } }), 3)).toBe("For exactly 2");
    expect(tableWhyNot(tableEntry({ id: "w", name: "W", players: { min: 2, max: 2 } }), 1)).toBe("Needs exactly 2");
    expect(tableWhyNot(tableEntry({ id: "x", name: "X", players: { min: 2, max: 4 } }, { soon: true }), 3)).toBe("Coming soon");
    expect(tablePlayers({ min: 3, max: 8 })).toBe("3-8 players");

    const r = await table({ players: 2 });
    const list = r.core().view(Date.now()).table;
    expect(list.map((e) => [e.id, e.min, e.max, e.soon, e.test, e.why])).toEqual([
      ["paper-masks", 3, 8, false, false, "Needs 3 or more"],
      ["who-am-i", 2, 2, false, false, null],
      [GAME, 2, 8, false, true, null],
    ]);
    expect(list[0]).toMatchObject({ name: "Paper Masks", view: "/party/games/paper-masks.js", art: "/party/games/paper-masks/art/door-480.webp" });
    expect(list[1]).toMatchObject({ name: "Who Am I?", view: "/party/games/who-am-i.js" });
    expect(list[2]).toMatchObject({ name: "Count to ten", view: "/party/games/count-to-ten.js", art: null });
    for (const e of list) expect(e.pitch.length, e.id).toBeGreaterThan(10);

    // Bo's phone drops: one player here, so the test game needs two, and Who Am I? exactly two.
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    expect(r.core().view(Date.now()).table[2].why).toBe("Needs 2 or more");
    expect(r.core().view(Date.now()).table[1].why).toBe("Needs exactly 2");

    // Back on the Floor there is no list, and no word of a game starting.
    r.ws.bo = await r.connect(r.tokens.bo);
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    const floor = r.core().view(Date.now());
    expect(floor).not.toHaveProperty("table");
    expect(floor).not.toHaveProperty("starting");
  });

  it("refuses at Worker load a Table game that is not turn-based, has settings, or has no view", () => {
    const manifest = { id: "t", name: "T", path: "/t/", players: { min: 2, max: 2 }, table: { view: "v.js" } };
    const game = { tickHz: 0 };
    expect(() => buildTurnWall([{ manifest, game: { tickHz: 30 } }])).toThrow(/not turn-based/);
    expect(() => buildTurnWall([{ manifest, game: { ...game, settings: () => ({}) } }])).toThrow(/settings/);
    expect(() => buildTurnWall([{ manifest: { ...manifest, table: undefined }, game }])).toThrow(/no view/);
    // A real game that is built takes its coming-soon entry's place.
    const built = buildTurnWall([{ manifest: { ...manifest, id: "who-am-i" }, game }]);
    expect(built.table.filter((e) => e.id === "who-am-i")).toEqual([expect.objectContaining({ soon: false, view: "/t/v.js" })]);
  });
});

describe("who may start a Table game", () => {
  it("only the host, only at the Table, only a game on the list that can be played by the party as it is", async () => {
    // A game still coming: none is on the real list now, so this one is hung for the test.
    const later = tableEntry({ id: "later", name: "Later", pitch: "A game that is not built yet", players: { min: 2, max: 2 } }, { soon: true });
    const r = await table({ players: 2, wall: { ...TEST_WALL, table: [...TEST_WALL.table, later] } });
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    r.say(r.ws.bo, { t: "play", id: GAME });
    r.say(r.ws.screen, { t: "play", id: GAME });
    r.say(r.ws.ann, { t: "play", id: "nope" });
    r.say(r.ws.ann, { t: "play", id: "paper-masks" });
    r.say(r.ws.ann, { t: "play", id: "later" });
    r.say(r.ws.ann, { t: "play", id: 7 });
    await settle();
    expect(since(r.ws.bo)).toEqual([{ t: "play-no", error: "not_host", message: "Only the one who started the party picks the game." }]);
    expect(since(r.ws.screen)).toEqual([{ t: "play-no", error: "not_host", message: "Only the one who started the party picks the game." }]);
    expect(since(r.ws.ann)).toEqual([
      { t: "play-no", error: "not_found", message: "That game is not on the Table's list." },
      { t: "play-no", error: "party_size", message: "Paper Masks: Needs 3 or more." },
      { t: "play-no", error: "not_ready", message: "Later: Coming soon." },
      { t: "play-no", error: "not_found", message: "That game is not on the Table's list." },
    ]);
    expect(r.core().starting).toBeNull();
  });

  it("refuses the test game in production, where PARTY_TEST_GAMES is off, even sent by hand", async () => {
    const r = await table({ players: 2, wall: WALL });
    expect(r.core().view(Date.now()).table.map((e) => e.id)).not.toContain(GAME);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(r.ws.ann.messages().at(-1)).toEqual({ t: "play-no", error: "not_found", message: "That game is not on the Table's list." });
    expect(r.core().starting).toBeNull();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity.kind).toBe("lobby");
  });

  it("refuses a party too small, counting only the phones that are here", async () => {
    const r = await table({ players: 2 });
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(since(r.ws.ann)).toEqual([{ t: "play-no", error: "party_size", message: "Count to ten: Needs 2 or more." }]);
  });

  it("refuses on the Floor: the Floor's games are chosen by the vote", async () => {
    const r = await table({ players: 2 });
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(since(r.ws.ann)).toEqual([{ t: "play-no", error: "not_table", message: "Games are picked here only when the party is at the Table." }]);
  });

  it("lets whoever holds the controls pick while the host's phone is gone past its grace", async () => {
    const r = await table({ players: 3, screen: false });
    r.ctx.room.webSocketClose(r.ws.ann, 1001, "");
    await settle();
    // Within the host's grace (a page moving rooms), nobody else may.
    r.say(r.ws.bo, { t: "play", id: GAME });
    await settle();
    expect(r.core().starting).toBeNull();
    await vi.advanceTimersByTimeAsync(HOST_GRACE_MS + 10);
    r.say(r.ws.bo, { t: "play", id: GAME });
    await settle();
    expect(r.core().starting).toBe(GAME);
  });
});

describe("the starting beat, and the races around it", () => {
  it("shows everyone the game starting, then starts it with the phones that are here", async () => {
    const r = await table({ players: 3 });
    const since = from(r.ws.ann, r.ws.bo, r.ws.cy, r.ws.screen);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    for (const ws of Object.values(r.ws)) expect(lastRoom(since(ws)).starting).toEqual({ id: GAME, name: "Count to ten", by: 0, in: PLAY_BEAT_MS });
    expect(r.core().activity.kind).toBe("lobby");
    // The beat is one wake-up: nothing ticks for it.
    expect(r.ctx.alarm.at).toBe(Date.now() + PLAY_BEAT_MS);
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity).toMatchObject({ kind: "game", id: GAME, seats: [0, 1, 2] });
    for (const ws of Object.values(r.ws)) {
      const start = since(ws).find((m) => m.t === "start");
      expect(start.room.game).toMatchObject({ id: GAME, name: "Count to ten", turns: true, seats: [0, 1, 2] });
      expect(start.room.starting).toBeNull();
    }
    expect(r.core().starting).toBeNull();
  });

  it("refuses a switch and a second pick during the beat, and again while the game is on", async () => {
    const r = await table({ players: 2 });
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(since(r.ws.ann)).toEqual([
      { t: "mode-no", why: "A game is starting. You can switch when it ends.", v: "turn-based" },
      { t: "play-no", error: "starting", message: "A game is starting already." },
    ]);
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity.kind).toBe("game");
    const later = from(r.ws.ann);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(later(r.ws.ann).filter((m) => m.t.endsWith("-no"))).toEqual([
      { t: "mode-no", why: "A game is on. You can switch when it ends.", v: "turn-based" },
      { t: "play-no", error: "playing", message: "A game is on. You can pick the next one when it ends." },
    ]);
    expect(r.core().mode).toBe("turn-based");
  });

  it("refuses a pick while a switch is being saved, so a switch taken back cannot leave a Table game starting on the Floor", async () => {
    const r = await table({ players: 2 });
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    const put = r.ctx.storage.put;
    let fail = true;
    r.ctx.storage.put = async (k, v) => {
      if (fail && v.mode === "turn-based") {
        fail = false;
        throw new Error("storage is down");
      }
      return put(k, v);
    };
    const since = from(r.ws.ann);
    r.say(r.ws.ann, { t: "mode", v: "turn-based" });
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(since(r.ws.ann).filter((m) => m.t.endsWith("-no"))).toEqual([
      { t: "play-no", error: "busy", message: "The party is moving. Wait a moment, then pick again." },
      { t: "mode-no", why: "The switch did not go through. Try again.", v: "party-games" },
    ]);
    expect(r.core().mode).toBe("party-games");
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().starting).toBeNull();
  });

  it("does not start when the party is too small by the end of the beat, and says so", async () => {
    const r = await table({ players: 2 });
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    const since = from(r.ws.ann);
    r.say(r.ws.bo, { t: "leave" });
    await settle();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().starting).toBeNull();
    expect(since(r.ws.ann).find((m) => m.t === "note" && m.k === "cancelled")).toMatchObject({ text: "Count to ten did not start: needs 2 or more." });
    expect(lastRoom(since(r.ws.ann)).starting).toBeNull();
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(r.core().mode).toBe("party-games");
  });

  it("starts nothing after a restart during the beat: the host picks again", async () => {
    const r = await table({ players: 2 });
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    await r.sleepAndWake();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().starting).toBeNull();
    await play(r);
  });
});

describe("a Table game, played to the end", () => {
  it("sends each player their own secret and nobody else's, and brings everyone back to the Table with the result", async () => {
    const r = await table({ players: 3 });
    const since = from(r.ws.ann, r.ws.bo, r.ws.cy, r.ws.screen);
    await play(r);
    const secrets = secretsOf(r);
    expect(new Set(Object.values(secrets)).size).toBe(3);
    for (const seat of [0, 1, 2]) {
      const start = since(r.ws[key(seat)]).find((m) => m.t === "start");
      expect(start.s).toMatchObject({ you: { seat, role: "player" }, secret: secrets[seat], count: 0, target: TARGET });
    }
    expect(since(r.ws.screen).find((m) => m.t === "start").s).toMatchObject({ you: { seat: -1, role: "screen" } });
    expect(since(r.ws.screen).find((m) => m.t === "start").s).not.toHaveProperty("secret");
    const acks = [];
    while (r.core().activity.kind === "game") {
      const { ws } = turnOf(r);
      const before = ws.frames.length;
      await press(r, 2);
      acks.push(...ws.messages().slice(before).filter((m) => m.t === "ack"));
    }
    expect(acks).toHaveLength(TARGET / 2);
    const end = since(r.ws.bo).find((m) => m.t === "end");
    expect(end.room).toMatchObject({ mode: "turn-based", phase: "lobby" });
    expect(end.room.table.length).toBeGreaterThan(0);
    expect(end.result).toMatchObject({ count: TARGET });
    expect(end.last.rows[0]).toMatchObject({ seat: end.result.winnerSeat, place: 1, points: 3 });
    expect(end.last.rows).toHaveLength(3);
    expect(r.core().members[end.result.winnerSeat].points).toBe(3);
    // No socket ever heard a word that was not its own.
    for (const seat of [0, 1, 2]) {
      for (const [other, word] of Object.entries(secrets)) if (Number(other) !== seat) expect(r.ws[key(seat)].text()).not.toContain(`"${word}"`);
    }
    for (const word of Object.values(secrets)) expect(r.ws.screen.text()).not.toContain(`"${word}"`);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(r.core().starting).toBe(GAME);
  });

  it("refuses a turn out of order, to that page only, and changes nothing", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const { seat } = turnOf(r);
    const other = key(1 - seat);
    const since = from(r.ws.ann, r.ws.bo);
    r.say(r.ws[other], { t: "in", d: { t: "add", n: 1 }, id: "x1" });
    await settle();
    expect(since(r.ws[other]).at(-1)).toEqual({ t: "error", id: "x1", error: "not_your_turn", message: "It is not your turn." });
    expect(since(r.ws[key(seat)])).toEqual([]);
    expect(r.core().activity.state.count).toBe(0);
  });

  it("refuses the room's own moves from a player", async () => {
    const r = await table({ players: 2 });
    await play(r);
    r.say(r.ws.bo, { t: "in", d: { t: "tick" }, id: 1 });
    r.say(r.ws.bo, { t: "in", d: { t: "leave", seat: 0 }, id: 2 });
    await settle();
    expect(r.ws.bo.messages().filter((m) => m.t === "error").map((m) => m.error)).toEqual(["not_system", "not_system"]);
    expect(r.core().activity.seats).toEqual([0, 1]);
  });

  it("passes a turn not taken in time on the room's alarm, so nobody's silence holds the game up", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const { seat } = turnOf(r);
    // The deadline is the room's alarm (a Durable Object alarm), not a timer in memory.
    expect(r.ctx.alarm.at).toBe(r.core().activity.state.deadline);
    expect(r.ctx.room.timer).toBeNull();
    await vi.advanceTimersByTimeAsync(TURN_MS + 50);
    expect(turnOf(r).seat).toBe(1 - seat);
    expect(r.core().activity.state.log.at(-1)).toMatchObject({ seat, timedOut: true });
  });

  it("gives a reconnecting phone its own view back", async () => {
    const r = await table({ players: 3 });
    await play(r);
    const word = secretsOf(r)[1];
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    r.ws.bo = await r.connect(r.tokens.bo);
    const got = r.ws.bo.messages();
    expect(got[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(got[0].room.game).toMatchObject({ id: GAME, seats: [0, 1, 2] });
    expect(got.find((m) => m.t === "snap" && m.full).s).toMatchObject({ you: { seat: 1, role: "player" }, secret: word });
  });

  it("survives a restart mid-game, every seat and word as it was", async () => {
    const r = await table({ players: 2 });
    await play(r);
    await press(r, 2);
    const before = structuredClone(r.core().activity.state);
    await r.sleepAndWake();
    expect(r.core().activity).toMatchObject({ kind: "game", id: GAME, seats: [0, 1], host: 0, gone: [], declined: [] });
    expect(r.core().activity.state.secrets).toEqual(before.secrets);
    await press(r, 2);
    expect(r.core().activity.state.count).toBe(4);
  });

  it("takes in a phone that joins mid-game as a watcher (the game's `join`): it sees the game, gets no word, and cannot play", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const cy = await r.ctx.room.join({ nickname: "Cy", as: "player" });
    r.ws.cy = await r.connect(cy.token);
    await settle();
    expect(r.core().activity.state.watchers).toEqual([2]);
    expect(r.core().activity.seats).toEqual([0, 1, 2]);
    const got = r.ws.cy.messages();
    // The room view says Cy is in the game before Cy's view of it comes.
    const seated = got.findIndex((m) => m.t === "room" && m.room.game?.seats?.includes(2));
    const watching = got.findIndex((m) => m.t === "snap" && m.s.you.role === "watcher");
    expect(seated).toBeGreaterThan(-1);
    expect(watching).toBeGreaterThan(seated);
    for (const word of Object.values(secretsOf(r))) expect(r.ws.cy.text()).not.toContain(`"${word}"`);
    r.say(r.ws.cy, { t: "in", d: { t: "add", n: 1 }, id: 1 });
    await settle();
    expect(r.ws.cy.messages().at(-1)).toMatchObject({ t: "error", id: 1, error: "not_playing" });
    // When the game ends Cy is at the Table with everyone, and plays the next one.
    while (r.core().activity.kind === "game") await press(r, 2);
    expect(r.core().last.rows.map((row) => row.seat).sort()).toEqual([0, 1]);
    await play(r);
    expect(r.core().activity.seats).toEqual([0, 1, 2]);
  });

  it("goes on without a seat gone for good (the game's `leave`), tells it the new host, and ends by itself", async () => {
    const r = await table({ players: 3 });
    await play(r);
    const since = from(r.ws.bo);
    r.say(r.ws.ann, { t: "leave" });
    await settle();
    // Ann left: the game goes on with Bo and Cy, Ann's seat kept out of the party until it ends.
    expect(r.core().activity).toMatchObject({ kind: "game", seats: [1, 2], gone: [0], host: 1 });
    expect(r.core().activity.state).toMatchObject({ order: [1, 2], host: 1 });
    expect(r.core().activity.state.secrets).not.toHaveProperty("0");
    expect(lastRoom(since(r.ws.bo)).game.seats).toEqual([1, 2]);
    const di = await r.ctx.room.join({ nickname: "Di", as: "player" });
    expect(di.seat).toBe(3);
    // Bo is the host now, and can end it; instead Cy's phone drops past the grace and Bo is left alone.
    r.ctx.room.webSocketClose(r.ws.cy, 1001, "");
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 100);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last).toMatchObject({ name: "Count to ten", rows: [{ seat: 1, place: 1, points: 3 }] });
    // The seat that went is not placed and the one left is: the card says why it won.
    expect(r.core().last.early).toMatchObject({ seat: 2, why: "gone", text: "Cy did not come back, so Bo wins." });
    await vi.advanceTimersByTimeAsync(DROP_FADE_MS + 100);
    expect(r.core().members[2]).toBeNull();
  });

  it("gives the card a reason when a leave ends a game that places nobody (Paper Masks' waiting step, left with two)", async () => {
    const r = await table({ players: 3 });
    await play(r, "paper-masks");
    expect(r.core().activity.state.at).toBe("setup");
    const since = from(r.ws.ann, r.ws.screen);
    r.say(r.ws.cy, { t: "leave" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    const text = "Cy left the party, so Paper Masks ended.";
    for (const ws of [r.ws.ann, r.ws.screen]) {
      const got = since(ws);
      expect(got.find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ why: "left", seat: 2, name: "Cy", text });
      expect(got.find((m) => m.t === "end").last).toMatchObject({ name: "Paper Masks", rows: [], early: { seat: 2, name: "Cy", why: "left", text } });
    }
  });

  it("tells the game when the host's controls pass on while the host's phone is gone", async () => {
    const r = await table({ players: 3, screen: false });
    await play(r);
    r.ctx.room.webSocketClose(r.ws.ann, 1001, "");
    await settle();
    expect(r.core().activity.state.host).toBe(0);
    // The host's grace ends with no other event: the room wakes for it.
    await vi.advanceTimersByTimeAsync(HOST_GRACE_MS + 50);
    expect(r.core().activity.state.host).toBe(1);
    expect(r.core().activity.host).toBe(1);
  });

  it("gives each match a fresh secret seed, never one worked out from the room's", async () => {
    const seen = [];
    const spy = { ...rules, create: (seats, options, seed, now) => (seen.push(seed), rules.create(seats, options, seed, now)) };
    const turn = buildTurnWall([]);
    turn.games.set(GAME, tableGame(spy));
    const wall = { ...TEST_WALL, games: new Map([...TEST_WALL.games, ...turn.games]) };
    const r = await table({ players: 2, wall });
    await play(r);
    while (r.core().activity.kind === "game") await press(r, 2);
    await play(r);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    for (const [i, seed] of seen.entries()) expect(seed).not.toBe(r.core().roundSeed(i + 1));
  });
});

describe("the host ends a Table game", () => {
  it("is the host's alone; everyone is back at the Table with a card that says who ended it", async () => {
    const r = await table({ players: 2 });
    await play(r);
    await press(r, 2);
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    r.say(r.ws.bo, { t: "stop" });
    await settle();
    expect(since(r.ws.bo)).toEqual([{ t: "stop-no", error: "not_host", message: "Only the one who started the party can end the game." }]);
    expect(r.core().activity.kind).toBe("game");
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    for (const ws of [r.ws.ann, r.ws.bo, r.ws.screen]) {
      const got = since(ws);
      expect(got.find((m) => m.t === "note" && m.k === "ended")).toEqual({ t: "note", k: "ended", why: "host", seat: 0, name: "Ann", colour: r.core().members[0].colour, text: "Ann ended Count to ten." });
      const end = got.find((m) => m.t === "end");
      expect(end.last).toMatchObject({ name: "Count to ten", rows: [], early: { why: "host", name: "Ann", seat: 0 } });
      expect(end.room).toMatchObject({ phase: "lobby", mode: "turn-based" });
    }
    expect(r.ctx.store.get("lobby").game).toBeNull();
  });

  it("scores a match the game says is decided (Paper Masks' final curtain) once, instead of throwing it away", async () => {
    const r = await table({ players: 3 });
    await play(r, "paper-masks");
    const say = (who, d) => r.say(r.ws[who], { t: "in", d, id: ++ids });
    const state = () => r.core().activity.state;
    say("ann", { t: "choose", rounds: 3 });
    say("ann", { t: "begin" });
    await settle();
    // Play the three rounds from the seats' own views, as the phones do.
    for (let i = 0; i < 200 && state().at === "match"; i++) {
      const m = state().match;
      const viewOf = (seat) => r.core().games.get("paper-masks").snapshot(state(), 0, { role: "player", seat });
      if (m.phase === "writing") for (const seat of [0, 1, 2]) say(key(seat), { t: "answer", text: `Words of ${NAMES[seat]} in round ${m.round.n}` });
      else if (m.phase === "reading") say(key(m.round.reader), { t: "startGuessing" });
      else if (m.phase === "guessing") {
        for (const seat of [0, 1, 2]) {
          const v = viewOf(seat).step;
          if (v.yours) say(key(seat), { t: "decoy", card: v.card.id });
          else if (v.guess === null) say(key(seat), { t: "guess", card: v.card.id, who: v.available[0] });
        }
        await settle();
        say(key(state().match.round.reader), { t: "next" });
      } else if (m.phase === "reveal") say(key(m.round.reader), { t: "reveal" });
      else if (m.phase === "summary") say(key(m.host), { t: "nextRound" });
      await settle();
    }
    expect(state().at).toBe("curtain");
    const places = r.core().games.get("paper-masks").standings(state());
    expect(places).toHaveLength(3);
    const before = [0, 1, 2].map((s) => r.core().members[s].points);
    const since = from(r.ws.ann, r.ws.bo);
    // The host taps the Table's own "End the game" instead of the curtain's Back to the Table.
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    const end = since(r.ws.bo).find((m) => m.t === "end");
    expect(end.last).not.toHaveProperty("early");
    expect(end.last.rows.map((row) => [row.seat, row.place])).toEqual(places.map((p) => [p.seat, p.place]).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
    expect(since(r.ws.bo).some((m) => m.t === "note" && m.k === "ended")).toBe(false);
    const after = [0, 1, 2].map((s) => r.core().members[s].points);
    const gained = after.map((p, i) => p - before[i]);
    expect(gained.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    for (const row of end.last.rows) expect(gained[row.seat]).toBe(row.points);
    // Scored once: the curtain's own deadline coming later changes nothing.
    await vi.advanceTimersByTimeAsync(200_000);
    expect([0, 1, 2].map((s) => r.core().members[s].points)).toEqual(after);
    expect(r.core().history.filter((h) => h.name === "Paper Masks")).toHaveLength(1);
  });

  it("keeps the place of a player who leaves the party at Paper Masks' final curtain: the match was decided before they went", async () => {
    const r = await table({ players: 3 });
    await play(r, "paper-masks");
    const say = (who, d) => r.say(r.ws[who], { t: "in", d, id: ++ids });
    const state = () => r.core().activity.state;
    say("ann", { t: "choose", rounds: 3 });
    say("ann", { t: "begin" });
    await settle();
    for (let i = 0; i < 200 && state().at === "match"; i++) {
      const m = state().match;
      const viewOf = (seat) => r.core().games.get("paper-masks").snapshot(state(), 0, { role: "player", seat });
      if (m.phase === "writing") for (const seat of [0, 1, 2]) say(key(seat), { t: "answer", text: `Words of ${NAMES[seat]} in round ${m.round.n}` });
      else if (m.phase === "reading") say(key(m.round.reader), { t: "startGuessing" });
      else if (m.phase === "guessing") {
        for (const seat of [0, 1, 2]) {
          const v = viewOf(seat).step;
          if (v.yours) say(key(seat), { t: "decoy", card: v.card.id });
          else if (v.guess === null) say(key(seat), { t: "guess", card: v.card.id, who: v.available[0] });
        }
        await settle();
        say(key(state().match.round.reader), { t: "next" });
      } else if (m.phase === "reveal") say(key(m.round.reader), { t: "reveal" });
      else if (m.phase === "summary") say(key(m.host), { t: "nextRound" });
      await settle();
    }
    expect(state().at).toBe("curtain");
    const places = r.core().games.get("paper-masks").standings(state());
    expect(places.map((p) => p.seat).sort()).toEqual([0, 1, 2]);
    // Cy leaves the party at the curtain; then the host closes it.
    r.say(r.ws.cy, { t: "leave" });
    await settle();
    expect(r.core().activity.kind).toBe("game");
    const since = from(r.ws.bo);
    say("ann", { t: "close" });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    const end = since(r.ws.bo).find((m) => m.t === "end");
    expect(end.last.rows.map((row) => [row.seat, row.place]).sort()).toEqual(places.map((p) => [p.seat, p.place]).sort());
    const cy = end.last.rows.find((row) => row.seat === 2);
    expect(r.core().remembered.get("cy")).toBe(cy.points);
  });

  it("still throws away a game that is not decided: Paper Masks mid-match ends with no points", async () => {
    const r = await table({ players: 3 });
    await play(r, "paper-masks");
    r.say(r.ws.ann, { t: "in", d: { t: "begin" }, id: ++ids });
    await settle();
    expect(r.core().activity.state.at).toBe("match");
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().last).toMatchObject({ name: "Paper Masks", rows: [], early: { why: "host", name: "Ann" } });
    expect([0, 1, 2].map((s) => r.core().members[s].points)).toEqual([0, 0, 0]);
  });

  it("is refused when no game is on", async () => {
    const r = await table({ players: 2 });
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.ws.ann.messages().at(-1)).toEqual({ t: "stop-no", error: "not_playing", message: "No game at the Table is being played." });
  });
});

describe("the Table's eight places", () => {
  it("seats up to eight at the Table, each with a colour of its own, and turns the ninth away", async () => {
    const r = await table({ players: TABLE_MAX_PLAYERS, screen: false });
    expect(r.core().view(Date.now()).members.map((m) => m.name)).toEqual(NAMES);
    expect(new Set(r.core().members.map((m) => m.colour)).size).toBe(TABLE_MAX_PLAYERS);
    expect(r.core().members.map((m) => m.colour)).toEqual(NAMES.map((_, seat) => seatColour(seat)));
    expect(await r.ctx.room.join({ nickname: "Ivy", as: "player" })).toMatchObject({ ok: false, error: "room_full", message: "This party is full: 8 players at most." });
    expect((await r.ctx.room.preview()).full).toBe(true);
    // All eight play the game.
    await play(r);
    expect(r.core().activity.seats).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the Floor at four: a party of more cannot move there", async () => {
    const r = await table({ players: 5, screen: false });
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(r.ws.ann.messages().at(-1)).toEqual({ t: "mode-no", why: "The Floor has room for 4, and 5 are here. It can go there when fewer are.", v: "turn-based" });
    // On the Floor the party has four places, and a fifth is turned away.
    const floor = await table({ players: 4, screen: false });
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    floor.say(floor.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(floor.core().view(Date.now()).members).toHaveLength(MAX_PLAYERS);
    expect(await floor.ctx.room.join({ nickname: "Ed", as: "player" })).toMatchObject({ ok: false, message: "This party is full: four players at most." });
  });

  it("seats someone beyond the Floor's four in a free place of them on the way, and their socket speaks for that seat", async () => {
    const r = await table({ players: 6, screen: false });
    r.say(r.ws.bo, { t: "leave" });
    r.say(r.ws.cy, { t: "leave" });
    await settle();
    expect(r.core().members.map((m) => m?.name ?? null)).toEqual(["Ann", null, null, "Di", "Ed", "Flo", null, null]);
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(r.core().mode).toBe("party-games");
    expect(r.core().members.map((m) => m?.name ?? null)).toEqual(["Ann", "Ed", "Flo", "Di"]);
    expect(r.core().members[1].colour).toBe(seatColour(1));
    // Ed's socket now plays seat 1: a look he chooses is his own.
    r.say(r.ws.ed, { t: "look", c: "ghost" });
    await settle();
    expect(r.core().members[1].character).toBe("ghost");
    expect(r.ws.ed.attachment.seat).toBe(1);
  });

  it("takes the seats back with a switch that could not be saved", async () => {
    const r = await table({ players: 5, screen: false });
    r.say(r.ws.bo, { t: "leave" });
    await settle();
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    const put = r.ctx.storage.put;
    r.ctx.storage.put = async (k, v) => (v.mode === "party-games" ? Promise.reject(new Error("down")) : put(k, v));
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    expect(r.core().mode).toBe("turn-based");
    expect(r.core().members.map((m) => m?.name ?? null)).toEqual(["Ann", null, "Cy", "Di", "Ed", null, null, null]);
    expect(r.ws.ed.attachment.seat).toBe(4);
  });

  it("restores a Table party saved before it had eight places with eight", async () => {
    const r = await table({ players: 2, screen: false });
    const saved = r.ctx.store.get("lobby");
    r.ctx.store.set("lobby", { ...saved, members: saved.members.slice(0, MAX_PLAYERS) });
    await r.sleepAndWake();
    expect(r.core().members).toHaveLength(TABLE_MAX_PLAYERS);
    expect(r.core().members.filter(Boolean).map((m) => m.name)).toEqual(["Ann", "Bo"]);
  });
});

/** The test wall with one more Table game: these rules, through the same adapter, under `id`. */
function wallWith(id, gameRules) {
  const entry = tableEntry({ id, name: "Broken", pitch: "A Table game made to fail", players: { min: 2, max: 8 } }, { view: "/party/games/broken.js" });
  return { ...TEST_WALL, games: new Map([...TEST_WALL.games, [id, tableGame(gameRules, { id })]]), table: [...TEST_WALL.table, entry] };
}

/**
 * Count to ten whose view throws whenever `broken.now` is true. Returns the switch and the wall.
 */
function breakableView() {
  const broken = { now: false };
  const view = (state, seat) => {
    if (broken.now) throw new Error("view boom");
    return rules.view(state, seat);
  };
  return { broken, wall: wallWith("broken", { ...rules, view }) };
}

/** Everyone heard the game end for an error: the note, `end` and the room view, back at the Table. */
function endedForError(r, since, sockets) {
  expect(r.core().activity.kind).toBe("lobby");
  for (const ws of sockets) {
    const got = since(ws);
    expect(got.find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ why: "error", text: "Broken ran into a problem, so it ended." });
    const end = got.find((m) => m.t === "end");
    expect(end).toBeDefined();
    expect(end.room).toMatchObject({ phase: "lobby", mode: "turn-based" });
    expect(end.last).toMatchObject({ rows: [], early: { why: "error" } });
    expect(got.findLastIndex((m) => m.t === "room")).toBeGreaterThan(got.findIndex((m) => m.t === "end"));
  }
}

describe("a Table game whose view throws", () => {
  let quiet;
  beforeEach(() => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => quiet.mockRestore());

  it("ends with reason error when the view throws after a turn, and the Table is free again", async () => {
    const { broken, wall } = breakableView();
    const r = await table({ players: 2, wall });
    await play(r, "broken");
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    broken.now = true;
    expect(() => r.say(turnOf(r).ws, { t: "in", d: { t: "add", n: 2 }, id: 1 })).not.toThrow();
    await settle();
    endedForError(r, since, [r.ws.ann, r.ws.bo, r.ws.screen]);
    expect(r.ctx.store.get("lobby").game).toBeNull();
    broken.now = false;
    await play(r, "broken");
  });

  it("ends the game when it cannot be shown to a phone that comes back, and seats that phone all the same", async () => {
    const { broken, wall } = breakableView();
    const r = await table({ players: 2, wall });
    await play(r, "broken");
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    const since = from(r.ws.ann, r.ws.screen);
    broken.now = true;
    let threw = null;
    try {
      r.ws.bo = await r.connect(r.tokens.bo);
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();
    const got = r.ws.bo.messages();
    expect(got[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(got.some((m) => m.t === "end")).toBe(true);
    expect(r.core().members[1].connected).toBe(true);
    endedForError(r, since, [r.ws.ann, r.ws.screen]);
  });

  it("ends the game at its start when it cannot be shown", async () => {
    const { broken, wall } = breakableView();
    const r = await table({ players: 2, wall });
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    broken.now = true;
    r.say(r.ws.ann, { t: "play", id: "broken" });
    await settle();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(since(r.ws.ann).some((m) => m.t === "start")).toBe(false);
    endedForError(r, since, [r.ws.ann, r.ws.bo, r.ws.screen]);
    expect(r.ctx.room.timer).toBeNull();
  });

  it("ends the game when its view throws on a refused turn sent back to that page alone", async () => {
    const { broken, wall } = breakableView();
    const r = await table({ players: 2, wall });
    await play(r, "broken");
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    broken.now = true;
    const other = r.ws[key(1 - turnOf(r).seat)];
    r.say(other, { t: "in", d: { t: "add", n: 1 }, id: "x" });
    await settle();
    endedForError(r, since, [r.ws.ann, r.ws.bo, r.ws.screen]);
  });

  it("lets the host end it all the same: everyone gets `end` and the room view", async () => {
    const { broken, wall } = breakableView();
    const r = await table({ players: 2, wall });
    await play(r, "broken");
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    broken.now = true;
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    for (const ws of [r.ws.ann, r.ws.bo, r.ws.screen]) {
      const got = since(ws);
      expect(got.find((m) => m.t === "end")).toMatchObject({ room: { phase: "lobby", mode: "turn-based" }, last: { early: { why: "host", name: "Ann" } } });
      expect(got.findLastIndex((m) => m.t === "room")).toBeGreaterThan(got.findIndex((m) => m.t === "end"));
    }
  });

  it("lets the host end it when the save fails: everyone still hears it is over", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const since = from(r.ws.ann, r.ws.bo);
    r.ctx.storage.put = async () => Promise.reject(new Error("down"));
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    for (const ws of [r.ws.ann, r.ws.bo]) expect(since(ws).some((m) => m.t === "end")).toBe(true);
  });
});

describe("the Table game adapter", () => {
  it("keeps the state when the rules give back the very state they were given", () => {
    const same = { ...rules, apply: (s, seat, m, now) => (m.t === "tick" ? s : rules.apply(s, seat, m, now)) };
    const g = tableGame(same, { id: "same" });
    const state = g.create({ seats: [{ seat: 0 }, { seat: 1 }], seed: 5, now: 0, host: 0 });
    const before = structuredClone(state);
    g.tick(state, 1);
    expect(state).toEqual(before);
    expect(g.input(state, rules.SYSTEM, { t: "tick" }, 2)).toMatchObject({ ok: true });
    expect(state).toEqual(before);
  });
});
