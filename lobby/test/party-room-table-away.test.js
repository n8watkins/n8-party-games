// A hidden page at the Table (another app, a text message, the lock screen; the socket stays
// open), proved on the real party room class with the Table's real games:
//   - Who Am I? needs only the guesser whose turn it is (rules.js, `needs`). Hidden on their own
//     turn, their grace (two minutes, the room's TURN_GRACE_MS) runs; hidden for the whole of it,
//     they forfeit and the other player wins. Everyone else sees the time left (`awayIn`), and the
//     player who comes back is told how much they had left (`awaySpare`).
//   - Hidden while waiting (the other player's turn, the setup, a watcher) costs nothing.
//   - Paper Masks and Count to ten have no `needs`: a hidden page there changes nothing, as on main.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeCtx, fakeEnv, settle, useFakeRuntime } from "./fake-room.js";
import { from } from "./turn-game.js";
import { TEST_WALL } from "../wall.js";
import { PLAY_BEAT_MS } from "../shared/table.js";
import { TURN_GRACE_MS } from "../server/lobby-core.js";
import * as rules from "../../party/games/who-am-i/rules.js";
import { game as whoAmI } from "../../party/games/who-am-i/index.js";
import { game as paperMasks } from "../../party/games/paper-masks/index.js";
import { game as countToTen } from "../../party/games/count-to-ten/index.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const NAMES = ["Ann", "Bo", "Cy", "Di"];
const key = (seat) => NAMES[seat].toLowerCase();
const GRACE = TURN_GRACE_MS;

/** A party of `players` at the Table (Ann hosts) and a big screen. */
async function party(players = 2) {
  const env = fakeEnv();
  const Room = createLobbyRoom(() => TEST_WALL);
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
  for (const name of NAMES.slice(1, players)) {
    tokens[name.toLowerCase()] = (await ctx.room.join({ nickname: name, as: "player" })).token;
    ws[name.toLowerCase()] = await connect(tokens[name.toLowerCase()]);
  }
  tokens.screen = (await ctx.room.join({ as: "screen" })).token;
  ws.screen = await connect(tokens.screen);
  return { ctx, say, connect, tokens, ws, core: () => ctx.room.core, state: () => ctx.room.core.activity.state };
}

/** The host picks a game and the beat runs out: the game is on. */
async function play(r, id) {
  r.say(r.ws.ann, { t: "play", id });
  await settle();
  await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
  expect(r.core().activity.kind).toBe("game");
}

let ids = 0;
/** One answered input from a seat's phone; returns the room's answer to it. */
async function send(r, who, d) {
  const id = ++ids;
  const ws = r.ws[who];
  const before = ws.frames.length;
  r.say(ws, { t: "in", d, id });
  await settle();
  return ws.messages().slice(before).find((m) => (m.t === "ack" || m.t === "error") && m.id === id);
}

/** Who Am I? begun by the host with these choices (`timer: 0` is "no timer": a five-minute backstop). */
async function whoAmIBegun(r, choices = {}) {
  await play(r, "who-am-i");
  if (Object.keys(choices).length) expect(await send(r, "ann", { t: "choose", ...choices })).toMatchObject({ t: "ack" });
  expect(await send(r, "ann", { t: "begin" })).toMatchObject({ t: "ack" });
  expect(r.state().phase).toBe("playing");
}

const roomOf = (msgs) => msgs.filter((m) => m.room).at(-1)?.room;
const lastRoom = (ws) => roomOf(ws.messages());
const endedNote = (ws) => ws.messages().find((m) => m.t === "note" && m.k === "ended");

async function hide(r, who) {
  r.say(r.ws[who], { t: "away" });
  await settle();
}

async function show(r, who) {
  r.say(r.ws[who], { t: "back" });
  await settle();
}

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("Who Am I?'s rules: who the match waits on", () => {
  it("is only the guesser whose turn it is, while they ask", async () => {
    const { Table } = await import("../../party/games/who-am-i/test/table.js");
    const t = new Table([0, 1, 2]);
    // The setup waits on nobody.
    for (const seat of [0, 1, 2]) expect(rules.needs(t.state, seat)).toBe(false);
    t.begin();
    const g = t.guesser;
    const j = t.judge;
    expect(rules.needs(t.state, g)).toBe(true);
    expect(rules.needs(t.state, j)).toBe(false);
    // A seat in the pool not picked to play (a watcher) is never needed.
    const watcher = [0, 1, 2].find((s) => s !== g && s !== j);
    expect(rules.needs(t.state, watcher)).toBe(false);
    // While the guess waits to be confirmed: nobody (the guesser waits; the judge has selfConfirm and confirmLapse behind them).
    t.do(g, { t: "guess" }, 1000);
    expect(rules.needs(t.state, g)).toBe(false);
    expect(rules.needs(t.state, j)).toBe(false);
    t.do(j, { t: "confirm" }, 1000);
    // Now the other player guesses (keep going: their own turn; trade: the round is won): whoever has the turn is needed.
    if (t.phase === "playing") expect(rules.needs(t.state, t.guesser)).toBe(true);
    // The reveal and a match that is over wait on nobody.
    t.playMatch();
    for (const seat of [0, 1, 2]) expect(rules.needs(t.state, seat)).toBe(false);
  });

  it("is never a player who left", async () => {
    const { Table } = await import("../../party/games/who-am-i/test/table.js");
    const t = new Table([0, 1]);
    t.begin();
    const g = t.guesser;
    t.do(rules.SYSTEM, { t: "leave", seat: g });
    expect(rules.needs(t.state, g)).toBe(false);
  });

  it("reaches the room through the Table's adapter, and only for rules that export it", () => {
    expect(typeof whoAmI.needs).toBe("function");
    expect(paperMasks.needs).toBeUndefined();
    expect(countToTen.needs).toBeUndefined();
  });
});

describe("Who Am I? at the Table: a page hidden on the player's own turn", () => {
  it("for the whole grace: the guesser forfeits, the other player wins, and the phones and the big screen counted it down", async () => {
    const r = await party(2);
    // No timer and keep-going turns: the guesser's turn lasts until the grace is up.
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const g = r.state().turn.seat;
    const o = 1 - g;
    const since = from(r.ws[key(o)], r.ws.screen);
    await hide(r, key(g));
    const hidAt = Date.now();
    for (const w of [r.ws[key(o)], r.ws.screen]) expect(roomOf(since(w)).members[g]).toMatchObject({ away: true, awayIn: GRACE });
    // The grace's end is a wake-up: the room is woken for it (or sooner) with nobody doing anything.
    expect(r.ctx.alarm.at).toBeLessThanOrEqual(hidAt + GRACE);
    expect(r.core().nextWake(Date.now())).toBeLessThanOrEqual(hidAt + GRACE);
    await vi.advanceTimersByTimeAsync(GRACE - 1);
    expect(r.core().activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(r.core().activity.kind).toBe("lobby");
    const last = r.core().last;
    expect(last.early).toMatchObject({ seat: g, why: "gone", text: `${NAMES[g]} did not come back, so ${NAMES[o]} wins.` });
    expect(last.rows).toEqual([expect.objectContaining({ seat: o, place: 1 })]);
    for (const w of [r.ws.ann, r.ws.bo, r.ws.screen]) expect(endedNote(w)).toMatchObject({ seat: g, why: "gone" });
    // The hidden page heard the end on its open socket, and shows it when it is shown again.
    expect(r.ws[key(g)].closed).toBeNull();
    expect(r.ws[key(g)].messages().some((m) => m.t === "end")).toBe(true);
  });

  it("back inside the grace: the clock stops at once, the match goes on, and the player is told how close it was", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const g = r.state().turn.seat;
    await hide(r, key(g));
    await vi.advanceTimersByTimeAsync(GRACE - 15_000);
    const since = from(r.ws[key(g)]);
    await show(r, key(g));
    const seen = roomOf(since(r.ws[key(g)])).members[g];
    expect(seen).not.toHaveProperty("awayIn");
    expect(seen.awaySpare).toBe(15_000);
    // Long after the grace, still on: the clock stopped the moment the page was shown.
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(r.core().activity.kind).toBe("game");
    expect(lastRoom(r.ws.screen).members[g]).not.toHaveProperty("awayIn");
  });

  it("trade turns, each move timed: the time a hidden guesser uses waits through the other's move, and runs on at their next", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 90, turnFormat: "trade" });
    const g = r.state().turn.seat;
    const o = 1 - g;
    await hide(r, key(g));
    // The move runs out at 90 s: the turn passes, and the clock is held (no time shown).
    await vi.advanceTimersByTimeAsync(90_000 + 50);
    expect(r.state().turn.seat).toBe(o);
    expect(lastRoom(r.ws[key(o)]).members[g]).not.toHaveProperty("awayIn");
    // The other player takes their time (60 s), then passes: the hidden guesser's turn again.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await send(r, key(o), { t: "pass" })).toMatchObject({ t: "ack" });
    expect(r.state().turn.seat).toBe(g);
    // 90 s used (to the move's deadline, when the alarm passed the turn): 30 s left.
    expect(lastRoom(r.ws[key(o)]).members[g].awayIn).toBe(GRACE - 90_000);
    await vi.advanceTimersByTimeAsync(GRACE - 90_000 - 1);
    expect(r.core().activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last.early).toMatchObject({ seat: g, why: "gone" });
  });
});

describe("Who Am I? at the Table: a page hidden while the match does not wait on it", () => {
  it("the player waiting (the other's turn) costs nothing: hidden four minutes, no time shown, nobody forfeits", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const g = r.state().turn.seat;
    const w = 1 - g;
    await hide(r, key(w));
    expect(lastRoom(r.ws[key(g)]).members[w]).toMatchObject({ away: true });
    expect(lastRoom(r.ws[key(g)]).members[w]).not.toHaveProperty("awayIn");
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(r.core().activity.kind).toBe("game");
    expect(r.state().turn.seat).toBe(g);
    // The guesser gives up: now it is the hidden player's turn, and their clock starts there.
    expect(await send(r, key(g), { t: "skip" })).toMatchObject({ t: "ack" });
    expect(r.state().turn.seat).toBe(w);
    expect(lastRoom(r.ws[key(g)]).members[w].awayIn).toBe(GRACE);
  });

  it("a player in the setup costs nothing: hidden longer than the grace, still in the pool, and the match begins with them", async () => {
    const r = await party(2);
    await play(r, "who-am-i");
    await hide(r, "bo");
    await vi.advanceTimersByTimeAsync(GRACE - 5_000);
    expect(r.state().phase).toBe("setup");
    expect(r.state().pool).toEqual([0, 1]);
    expect(lastRoom(r.ws.ann).members[1]).not.toHaveProperty("awayIn");
    // The setup begins by itself (two minutes): with Bo in it.
    await vi.advanceTimersByTimeAsync(rules.TIMERS.setup);
    expect(r.state().phase).toBe("playing");
    expect(r.state().players.map((p) => p.seat)).toEqual([0, 1]);
  });

  it("a watcher (arrived mid-match) hidden for ten minutes: no clock, no time shown, and still watching", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const cy = await r.ctx.room.join({ nickname: "Cy", as: "player" });
    r.ws.cy = await r.connect(cy.token);
    await settle();
    expect(r.state().watchers).toEqual([2]);
    await hide(r, "cy");
    expect(r.core().activity.clocks?.[2]).toBeUndefined();
    expect(lastRoom(r.ws.ann).members[2]).not.toHaveProperty("awayIn");
    // Ann keeps the match alive by playing; Cy is still a watcher at the end of it.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(2.5 * 60_000);
      if (r.core().activity.kind !== "game") break;
      const turn = r.state().turn;
      if (turn?.phase === "asking") await send(r, key(turn.seat), { t: "hint" });
    }
    expect(r.core().activity.clocks?.[2]).toBeUndefined();
    expect(r.core().activity.gone ?? []).not.toContain(2);
  });

  it("two players hidden at once, each on their own turn in turn: whoever runs out first forfeits, and the other wins", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const g = r.state().turn.seat;
    const o = 1 - g;
    await hide(r, key(o));
    await hide(r, key(g));
    expect(lastRoom(r.ws.screen).members[g].awayIn).toBe(GRACE);
    expect(lastRoom(r.ws.screen).members[o]).not.toHaveProperty("awayIn");
    await vi.advanceTimersByTimeAsync(GRACE);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last.early).toMatchObject({ seat: g, why: "gone" });
    // The one who stayed has a connected phone (hidden, but there): they win.
    expect(r.core().last.rows).toEqual([expect.objectContaining({ seat: o, place: 1 })]);
  });

  it("a phone that drops while the other has the turn keeps main's plain grace: from when it dropped", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const w = 1 - r.state().turn.seat;
    r.ctx.room.webSocketClose(r.ws[key(w)], 1001, "");
    await settle();
    await vi.advanceTimersByTimeAsync(GRACE + 100);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last.early).toMatchObject({ seat: w, why: "gone" });
  });

  it("the match ending while a countdown runs leaves no time on anyone, and no clock", async () => {
    const r = await party(2);
    await whoAmIBegun(r, { timer: 0, turnFormat: "keep_going" });
    const g = r.state().turn.seat;
    await hide(r, key(g));
    expect(lastRoom(r.ws.screen).members[g].awayIn).toBe(GRACE);
    // The host ends the game from the Table.
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    for (const m of lastRoom(r.ws.screen).members.filter(Boolean)) {
      expect(m).not.toHaveProperty("awayIn");
      expect(m).not.toHaveProperty("awaySpare");
    }
    await vi.advanceTimersByTimeAsync(2 * GRACE);
    expect(r.core().last.early?.why).not.toBe("gone");
  });
});

describe("the Table's games without `needs`: a hidden page changes nothing", () => {
  it.each([
    ["Count to ten", "count-to-ten", 2],
    ["Paper Masks", "paper-masks", 3],
  ])("%s: hidden three graces, no clock, no time shown, nobody gone", async (_, id, players) => {
    const r = await party(players);
    await play(r, id);
    await hide(r, "bo");
    expect(r.core().members[1]).toMatchObject({ connected: true, away: true });
    for (let t = 0; t < 3 * GRACE; t += 30_000) {
      await vi.advanceTimersByTimeAsync(30_000);
      for (const m of lastRoom(r.ws.ann).members.filter(Boolean)) expect(m).not.toHaveProperty("awayIn");
    }
    expect(r.core().activity.clocks ?? {}).toEqual({});
    expect(endedNote(r.ws.ann)?.why).not.toBe("gone");
    if (r.core().activity.kind === "game") expect(r.core().activity.seats).toContain(1);
  });
});
