// The Table's games on the real party room class: the list that follows the party's size, the
// host's pick (`play`) with its starting beat, the races between a pick, a switch and a start,
// the game played in turns with a secret per seat, reconnects, late joiners, a host who leaves
// mid-game, the host ending it (`stop`), and everyone back at the Table with the result.
// Count to ten (party/games/count-to-ten) is the game: the one a real Table game copies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeCtx, fakeEnv, settle, useFakeRuntime } from "./fake-room.js";
import { from } from "./turn-game.js";
import { TEST_WALL } from "../wall.js";
import { PLAY_BEAT_MS, tableWhyNot, tablePlayers, tableEntry } from "../shared/table.js";
import { MODE_COOLDOWN_MS } from "../shared/mode.js";
import { DROP_FADE_MS, HOST_GRACE_MS, TURN_GRACE_MS } from "../server/lobby-core.js";
import { TARGET, TURN_MS } from "../../party/games/count-to-ten/index.js";

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
const NAMES = ["Ann", "Bo", "Cy", "Di"];

/**
 * A party of `players` (Ann is the host) and, with `screen`, a big screen, all connected, moved
 * to the Table. Returns ways to say things and to restart the room, as fake-room's openRoom does.
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
  const first = await ctx.room.create({ code: "BCDFGH", nickname: NAMES[0], as: "player" });
  tokens.ann = first.token;
  for (const name of NAMES.slice(1, players)) tokens[name.toLowerCase()] = (await ctx.room.join({ nickname: name, as: "player" })).token;
  if (screen) tokens.screen = (await ctx.room.join({ as: "screen" })).token;
  for (const [who, token] of Object.entries(tokens)) ws[who] = await connect(token);
  say(ws.ann, { t: "mode", v: "turn-based" });
  await settle();
  expect(ctx.room.core.mode).toBe("turn-based");
  const sleepAndWake = async () => {
    ctx.room.stopTimer();
    ctx.room = new Room(ctx, env);
    await settle();
  };
  return { ctx, say, connect, tokens, ws, sleepAndWake, core: () => ctx.room.core };
}

/** The host picks the game and the beat runs out: the game is on. */
async function play(r, id = GAME) {
  r.say(r.ws.ann, { t: "play", id });
  await settle();
  await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
  expect(r.core().activity.kind).toBe("game");
}

/** The socket of whoever's turn it is, and that seat. */
function turnOf(r) {
  const state = r.core().activity.state;
  const seat = state.order[state.turn];
  const who = NAMES[seat].toLowerCase();
  return { seat, who, ws: r.ws[who] };
}

let ids = 0;
/** Whoever's turn it is adds `add`, with an answered input. */
async function press(r, add = 2) {
  const { ws } = turnOf(r);
  r.say(ws, { t: "in", d: { add }, id: ++ids });
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
      [GAME, 2, 4, false, true, null],
      ["paper-masks", 3, 8, true, false, "Coming soon"],
      ["who-am-i", 2, 2, true, false, "Coming soon"],
    ]);
    expect(list[0]).toMatchObject({ name: "Count to ten", view: "/party/games/count-to-ten.js", art: null });
    for (const e of list) expect(e.pitch.length, e.id).toBeGreaterThan(10);

    // Bo's phone drops: one player here, so the test game needs two.
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    expect(r.core().view(Date.now()).table[0].why).toBe("Needs 2 or more");

    // Back on the Floor there is no list, and no word of a game starting.
    r.ws.bo = await r.connect(r.tokens.bo);
    await vi.advanceTimersByTimeAsync(MODE_COOLDOWN_MS);
    r.say(r.ws.ann, { t: "mode", v: "party-games" });
    await settle();
    const floor = r.core().view(Date.now());
    expect(floor).not.toHaveProperty("table");
    expect(floor).not.toHaveProperty("starting");
  });

  it("refuses at Worker load a Table game that is not turn-based, has settings, or has no view", async () => {
    const { buildTurnWall } = await import("../wall.js");
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
    const r = await table({ players: 2 });
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    r.say(r.ws.bo, { t: "play", id: GAME });
    r.say(r.ws.screen, { t: "play", id: GAME });
    r.say(r.ws.ann, { t: "play", id: "nope" });
    r.say(r.ws.ann, { t: "play", id: "paper-masks" });
    r.say(r.ws.ann, { t: "play", id: "who-am-i" });
    r.say(r.ws.ann, { t: "play", id: 7 });
    await settle();
    expect(since(r.ws.bo)).toEqual([{ t: "play-no", error: "not_host", message: "Only the one who started the party picks the game." }]);
    expect(since(r.ws.screen)).toEqual([{ t: "play-no", error: "not_host", message: "Only the one who started the party picks the game." }]);
    expect(since(r.ws.ann)).toEqual([
      { t: "play-no", error: "not_found", message: "That game is not on the Table's list." },
      { t: "play-no", error: "not_ready", message: "Paper Masks: Coming soon." },
      { t: "play-no", error: "not_ready", message: "Who Am I?: Coming soon." },
      { t: "play-no", error: "not_found", message: "That game is not on the Table's list." },
    ]);
    expect(r.core().starting).toBeNull();
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

  it("refuses a switch, a second pick and a room pick during the beat, and again while the game is on", async () => {
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

  it("refuses a pick while a switch is being saved, and the party lands at the Table with nothing started", async () => {
    // The host switches to the Table and picks at once: the pick reaches the room while the switch
    // waits on storage, with the room already at the Table in memory. It is refused, so a switch
    // that then fails to save and is taken back cannot leave a Table game starting on the Floor.
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
    // And the host may switch rooms again.
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
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity.kind).toBe("game");
  });
});

describe("a Table game, played to the end", () => {
  it("sends each player their own secret and nobody else's, and brings everyone back to the Table with the result", async () => {
    const r = await table({ players: 3 });
    const since = from(r.ws.ann, r.ws.bo, r.ws.cy, r.ws.screen);
    await play(r);
    const secrets = secretsOf(r);
    expect(new Set(Object.values(secrets)).size).toBe(3);
    // Each phone's first snapshot holds its own word.
    for (const [seat, who] of [
      [0, "ann"],
      [1, "bo"],
      [2, "cy"],
    ]) {
      const start = since(r.ws[who]).find((m) => m.t === "start");
      expect(start.s).toMatchObject({ you: seat, secret: secrets[seat], count: 0, target: TARGET });
    }
    expect(since(r.ws.screen).find((m) => m.t === "start").s).not.toHaveProperty("secret");
    // Play: everyone adds two until it reaches ten, every input answered.
    const acks = [];
    while (r.core().activity.kind === "game") {
      const { ws } = turnOf(r);
      const before = ws.frames.length;
      await press(r, 2);
      acks.push(...ws.messages().slice(before).filter((m) => m.t === "ack"));
    }
    expect(acks).toHaveLength(TARGET / 2);
    // Back at the Table, with the result: the winner placed first.
    const end = since(r.ws.bo).find((m) => m.t === "end");
    expect(end.room.mode).toBe("turn-based");
    expect(end.room.phase).toBe("lobby");
    expect(end.room.table.length).toBeGreaterThan(0);
    expect(end.result).toMatchObject({ count: TARGET });
    expect(end.last.rows[0]).toMatchObject({ seat: end.result.winnerSeat, place: 1, points: 3 });
    expect(end.last.rows).toHaveLength(3);
    expect(r.core().members[end.result.winnerSeat].points).toBe(3);
    // No socket ever heard a word that was not its own.
    for (const [seat, who] of [
      [0, "ann"],
      [1, "bo"],
      [2, "cy"],
    ]) {
      for (const [other, word] of Object.entries(secrets)) if (Number(other) !== seat) expect(r.ws[who].text()).not.toContain(`"${word}"`);
    }
    for (const word of Object.values(secrets)) expect(r.ws.screen.text()).not.toContain(`"${word}"`);
    // The host may pick the next game at once: the starting beat is the only wait.
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    expect(r.core().starting).toBe(GAME);
  });

  it("refuses a turn out of order, to that page only, and changes nothing", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const { seat } = turnOf(r);
    const other = NAMES[1 - seat].toLowerCase();
    const since = from(r.ws.ann, r.ws.bo);
    r.say(r.ws[other], { t: "in", d: { add: 1 }, id: "x1" });
    await settle();
    expect(since(r.ws[other]).at(-1)).toEqual({ t: "error", id: "x1", error: "not_your_turn", message: "It is not your turn." });
    expect(since(r.ws[NAMES[seat].toLowerCase()])).toEqual([]);
    expect(r.core().activity.state.count).toBe(0);
  });

  it("passes a turn not taken in time, so nobody's silence holds the game up", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const { seat } = turnOf(r);
    const since = from(r.ws.ann);
    await vi.advanceTimersByTimeAsync(TURN_MS + 50);
    expect(turnOf(r).seat).toBe(1 - seat);
    expect(since(r.ws.ann).filter((m) => m.t === "ev").flatMap((m) => m.ev)).toContainEqual({ k: "timed_out", seat });
  });

  it("skips a dropped phone's turns, and gives a reconnecting phone its own view back", async () => {
    const r = await table({ players: 3 });
    await play(r);
    const word = secretsOf(r)[1];
    // Make it Bo's turn, then Bo's phone drops: the turn passes on at once.
    while (turnOf(r).seat !== 1) await press(r, 1);
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    expect(turnOf(r).seat).not.toBe(1);
    expect(r.core().activity.state.missing).toEqual([1]);
    // Bo reloads: the hello, then the game as Bo may see it, with Bo's own word.
    r.ws.bo = await r.connect(r.tokens.bo);
    const got = r.ws.bo.messages();
    expect(got[0]).toMatchObject({ t: "hello", you: { role: "player", seat: 1 } });
    expect(got[0].room.game).toMatchObject({ id: GAME, seats: [0, 1, 2] });
    expect(got.find((m) => m.t === "snap" && m.full).s).toMatchObject({ you: 1, secret: word });
    expect(r.core().activity.state.missing).toEqual([]);
  });

  it("survives a restart mid-game, every seat and word as it was", async () => {
    const r = await table({ players: 2 });
    await play(r);
    await press(r, 2);
    const before = structuredClone(r.core().activity.state);
    await r.sleepAndWake();
    expect(r.core().activity).toMatchObject({ kind: "game", id: GAME, seats: [0, 1] });
    expect(r.core().activity.state.secrets).toEqual(before.secrets);
    expect(r.core().activity.state.count).toBe(2);
    await press(r, 2);
    expect(r.core().activity.state.count).toBe(4);
  });

  it("lets a phone that joins mid-game wait at the Table: it sees the game is on, gets no word, and cannot play", async () => {
    const r = await table({ players: 2 });
    await play(r);
    const cy = await r.ctx.room.join({ nickname: "Cy", as: "player" });
    r.ws.cy = await r.connect(cy.token);
    const got = r.ws.cy.messages();
    const hello = got.find((m) => m.t === "hello");
    expect(hello.you).toEqual({ role: "player", seat: 2 });
    expect(hello.room).toMatchObject({ phase: "playing", game: { id: GAME, seats: [0, 1] } });
    const snap = got.find((m) => m.t === "snap");
    expect(snap.s).not.toHaveProperty("secret");
    expect(snap.s).not.toHaveProperty("you");
    for (const word of Object.values(secretsOf(r))) expect(r.ws.cy.text()).not.toContain(`"${word}"`);
    r.say(r.ws.cy, { t: "in", d: { add: 1 }, id: 1 });
    await settle();
    expect(r.ws.cy.messages().at(-1)).toMatchObject({ t: "error", id: 1, error: "not_in_game" });
    // When the game ends Cy is at the Table with everyone, and plays the next one.
    while (r.core().activity.kind === "game") await press(r, 2);
    r.say(r.ws.ann, { t: "play", id: GAME });
    await settle();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity.seats).toEqual([0, 1, 2]);
  });

  it("ends when the host leaves mid-game; the next player is host and can pick the next game", async () => {
    const r = await table({ players: 3 });
    await play(r);
    const since = from(r.ws.bo);
    r.say(r.ws.ann, { t: "leave" });
    await settle();
    const got = since(r.ws.bo);
    expect(got.find((m) => m.t === "note" && m.k === "ended")).toMatchObject({ text: "Ann left the party, so Count to ten ended." });
    const end = got.find((m) => m.t === "end");
    expect(end.last.early).toMatchObject({ why: "left", name: "Ann" });
    expect(end.room.mode).toBe("turn-based");
    expect(end.room.picker).toEqual({ seat: 1 });
    r.say(r.ws.bo, { t: "play", id: GAME });
    await settle();
    await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
    expect(r.core().activity).toMatchObject({ kind: "game", seats: [1, 2] });
  });

  it("ends when a dropped phone does not come back within the grace", async () => {
    const r = await table({ players: 2 });
    await play(r);
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 100);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last.early).toMatchObject({ why: "gone", name: "Bo" });
    // Back at the Table, Bo's seat fades by the lobby's own rule.
    await vi.advanceTimersByTimeAsync(DROP_FADE_MS + 100);
    expect(r.core().members[1]).toBeNull();
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
    // Saved: a restart finds the party at the Table, with no game.
    expect(r.ctx.store.get("lobby").game).toBeNull();
    expect(r.core().members.map((m) => m?.points ?? null)).toEqual([0, 0, null, null]);
  });

  it("is refused when no game is on", async () => {
    const r = await table({ players: 2 });
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.ws.ann.messages().at(-1)).toEqual({ t: "stop-no", error: "not_playing", message: "No game at the Table is being played." });
  });
});
