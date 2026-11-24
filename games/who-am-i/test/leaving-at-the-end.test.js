// Who Am I? on the real party room: a player who goes at the end, or mid-match. From the
// independent review of PR #70 (its reproductions, made permanent), and the owner's rule that
// something must make a leave a forfeit:
//   - a match already decided keeps the places it decided, whoever goes on its last reveal (a
//     tap on Leave, or a phone whose grace runs out there);
//   - a player who leaves an undecided match forfeits and the one who stayed wins, even with their
//     page hidden at that moment; only when the other phone is not connected at all is nobody
//     placed. The card says so plainly.
import { TURN_GRACE_MS } from "n8-party-games/lobby/core";
import { PLAY_BEAT_MS } from "n8-party-games/lobby/table";
import { TEST_WALL, buildTurnWall } from "n8-party-games/lobby/wall";
import { dropFakeRuntime, fakeCtx, fakeEnv, settle, useFakeRuntime } from "n8-party-games/testing/fake-room";
import { from } from "n8-party-games/testing/turn-game";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as rules from "../rules.js";
import { game, manifest } from "../index.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("n8-party-games/lobby/room");
const GAME = "who-am-i";
const NAMES = ["Ann", "Bo"];
const key = (seat) => NAMES[seat].toLowerCase();

function wallWith(m = manifest) {
  const turn = buildTurnWall([{ manifest: m, game }]);
  return { ...TEST_WALL, games: new Map([...TEST_WALL.games, ...turn.games]), table: turn.table };
}

/** Ann (the host) and Bo at the Table, with a big screen. */
async function party() {
  const env = fakeEnv();
  const Room = createLobbyRoom(() => wallWith());
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
  const ws = {};
  ws.ann = await connect((await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" })).token);
  say(ws.ann, { t: "mode", v: "turn-based" });
  await settle();
  ws.bo = await connect((await ctx.room.join({ nickname: "Bo", as: "player" })).token);
  ws.screen = await connect((await ctx.room.join({ as: "screen" })).token);
  return { ctx, say, ws, core: () => ctx.room.core, state: () => ctx.room.core.activity.state };
}

async function play(r) {
  r.say(r.ws.ann, { t: "play", id: GAME });
  await settle();
  await vi.advanceTimersByTimeAsync(PLAY_BEAT_MS + 50);
  expect(r.core().activity.kind).toBe("game");
  await send(r, "ann", { t: "begin" });
}

let ids = 0;
async function send(r, who, d) {
  const id = ++ids;
  const ws = r.ws[who];
  const before = ws.frames.length;
  r.say(ws, { t: "in", d, id });
  await settle();
  return ws.messages().slice(before).find((m) => (m.t === "ack" || m.t === "error") && m.id === id);
}

/** One right guess, confirmed, for whoever is guessing (or the next round from a reveal). */
async function step(r) {
  const s = r.state();
  if (s.phase === "reveal") return send(r, "ann", { t: "next" });
  await send(r, key(s.turn.seat), { t: "guess" });
  return send(r, key(1 - s.turn.seat), { t: "confirm" });
}

/** Right guesses until the reveal that decides the match; returns the winner's seat. */
async function toDecidingReveal(r) {
  for (let i = 0; i < 20 && !rules.decided(r.state()); i++) await step(r);
  expect(rules.decided(r.state())).toBe(true);
  return game.standings(r.state()).find((p) => p.place === 1).seat;
}

const card = (r, since, who) => since(r.ws[who]).find((m) => m.t === "end")?.last;
const rowsOf = (last) => last.rows.map((row) => [row.seat, row.place, row.points]);

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a decided match keeps its places whoever goes on its last reveal", () => {
  it("the winner who taps Leave on the deciding reveal keeps first place and the points", async () => {
    const r = await play2();
    const winner = await toDecidingReveal(r);
    const loser = 1 - winner;
    const since = from(r.ws[key(loser)]);
    r.say(r.ws[key(winner)], { t: "leave" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    const last = card(r, since, key(loser));
    expect(rowsOf(last)).toEqual([
      [winner, 1, 3],
      [loser, 2, 2],
    ]);
    expect(last).not.toHaveProperty("early");
    expect(r.core().members[loser].points).toBe(2);
    // The winner left the party: their points are kept for their name, for if they come back tonight.
    expect(r.core().remembered.get(NAMES[winner].toLowerCase())).toBe(3);
  });

  it("the winner whose phone dropped just before the deciding confirm, its grace running out during the reveal, keeps first place", async () => {
    const r = await play2();
    let winner = null;
    for (let i = 0; i < 30 && winner === null; i++) {
      const s = r.state();
      if (s.phase === "reveal") {
        await send(r, "ann", { t: "next" });
        continue;
      }
      const g = s.turn.seat;
      await send(r, key(g), { t: "guess" });
      if (s.players.find((x) => x.seat === g).score === 2) {
        winner = g;
        r.ctx.room.webSocketClose(r.ws[key(g)], 1001, "");
        await settle();
        await vi.advanceTimersByTimeAsync(100_000); // the judge takes a while: 100 s of the 120 s grace gone
      }
      await send(r, key(1 - g), { t: "confirm" });
    }
    expect(rules.decided(r.state())).toBe(true);
    const loser = 1 - winner;
    const since = from(r.ws[key(loser)]);
    await vi.advanceTimersByTimeAsync(30_000); // the grace runs out 20 s into the 90 s reveal
    expect(r.core().activity.kind).toBe("lobby");
    expect(rowsOf(card(r, since, key(loser)))).toEqual([
      [winner, 1, 3],
      [loser, 2, 2],
    ]);
  });

  it("the winner whose phone drops past the grace on the deciding reveal keeps first place", async () => {
    const r = await play2();
    const winner = await toDecidingReveal(r);
    const loser = 1 - winner;
    const since = from(r.ws[key(loser)]);
    r.ctx.room.webSocketClose(r.ws[key(winner)], 1001, "");
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 2000);
    expect(rowsOf(card(r, since, key(loser)))).toEqual([
      [winner, 1, 3],
      [loser, 2, 2],
    ]);
  });
});

describe("a player who leaves an undecided match forfeits", () => {
  /** Plays one right guess: returns [leader, trailer]. */
  async function oneUp(r) {
    const g = r.state().turn.seat;
    await step(r);
    await send(r, "ann", { t: "next" });
    return [g, 1 - g];
  }

  it("the trailer leaves while the leader's page is hidden: the leader wins by forfeit, and the card says so", async () => {
    const r = await play2();
    const [leader, trailer] = await oneUp(r);
    r.say(r.ws[key(leader)], { t: "away" });
    await settle();
    expect(r.state().here[String(leader)]).toBe(false);
    const since = from(r.ws.screen);
    r.say(r.ws[key(trailer)], { t: "leave" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    const last = card(r, since, "screen");
    expect(rowsOf(last)).toEqual([[leader, 1, 3]]);
    expect(last.early.text).toBe(`${NAMES[trailer]} left, so ${NAMES[leader]} wins.`);
    expect(r.core().members[leader].points).toBe(3);
  });

  it("the leader leaves and the trailer stays: the trailer wins by forfeit, whatever the score", async () => {
    const r = await play2();
    const [leader, trailer] = await oneUp(r);
    const since = from(r.ws.screen);
    r.say(r.ws[key(leader)], { t: "leave" });
    await settle();
    const last = card(r, since, "screen");
    expect(rowsOf(last)).toEqual([[trailer, 1, 3]]);
    expect(last.early.text).toBe(`${NAMES[leader]} left, so ${NAMES[trailer]} wins.`);
  });

  it("the one who stayed has a hidden page when the other's grace runs out: still a forfeit", async () => {
    const r = await play2();
    const [leader, trailer] = await oneUp(r);
    r.say(r.ws[key(trailer)], { t: "away" });
    await settle();
    r.ctx.room.webSocketClose(r.ws[key(leader)], 1001, "");
    await settle();
    const since = from(r.ws.screen);
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 2000);
    const last = card(r, since, "screen");
    expect(rowsOf(last)).toEqual([[trailer, 1, 3]]);
    expect(last.early.text).toBe(`${NAMES[leader]} did not come back, so ${NAMES[trailer]} wins.`);
  });

  it("both go: nobody is placed, and the card says the match ended", async () => {
    const r = await play2();
    await oneUp(r);
    const since = from(r.ws.screen);
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    r.ctx.room.webSocketClose(r.ws.ann, 1001, "");
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 2000);
    const last = card(r, since, "screen");
    expect(last.rows).toEqual([]);
    expect(last.early.text).toMatch(/did not come back, so Who Am I\? ended\.$/);
    expect(r.core().members.filter(Boolean).every((m) => !m.points)).toBe(true);
  });
});

async function play2() {
  const r = await party();
  await play(r);
  return r;
}
