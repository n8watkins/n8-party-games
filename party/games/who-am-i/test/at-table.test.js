// Who Am I? as the Table runs it: through the Table's own adapter (party/games/table-game.js), and
// then on the real party room class with fake sockets, storage and alarm, as a party plays it:
// two phones and a big screen, a phone that drops and comes back, a reload, a restart of the room,
// someone arriving mid-match, a phone gone past the room's grace, and a player leaving on purpose.
// Every frame every socket receives is scanned for names it must not hold.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, fakeCtx, fakeEnv, settle, useFakeRuntime } from "../../../../lobby/test/fake-room.js";
import { from } from "../../../../lobby/test/turn-game.js";
import { TEST_WALL, buildTurnWall } from "../../../../lobby/wall.js";
import { PLAY_BEAT_MS } from "../../../../lobby/shared/table.js";
import { TURN_GRACE_MS } from "../../../../lobby/server/lobby-core.js";
import { tableGame } from "../../table-game.js";
import * as rules from "../rules.js";
import { game, manifest } from "../index.js";
import { getIdentity } from "../deck.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../../../../lobby/server/lobby-room.js");

const T0 = 5_000_000;
const GAME = "who-am-i";
const NAMES = ["Ann", "Bo", "Cy", "Di"];
const key = (seat) => NAMES[seat].toLowerCase();

describe("through the Table's adapter", () => {
  it("is the kit's turn-based game: the rules' seats, moves as inputs, the room's hooks as SYSTEM moves", () => {
    const g = tableGame(rules);
    expect(g).toMatchObject({ id: GAME, minSeats: 2, maxSeats: 8, tickHz: 0 });
    expect(game.id).toBe(GAME);
    expect(manifest).toMatchObject({ id: GAME, path: "/party/", players: { min: 2, max: 2 }, public: [], table: { view: "games/who-am-i.js" } });
    const state = g.create({ seats: [{ seat: 0 }, { seat: 3 }], seed: 4242, now: T0, host: 3 });
    expect(state).toMatchObject({ phase: "setup", host: 3, pick: [0, 3] });
    expect(g.snapshot(state, T0, { role: "player", seat: 0 })).toMatchObject({ phase: "setup", you: { seat: 0, role: "player", host: false } });
    expect(g.snapshot(state, T0, { role: "screen", seat: -1 })).toMatchObject({ you: { role: "screen" } });
    // A member who is not dealt in (or the big screen) is shown the screen's view: no secret.
    expect(g.snapshot(state, T0, { role: "screen", seat: 2 }).you).toEqual({ seat: -1, role: "screen", host: false });
    expect(g.input(state, 0, { t: "begin" }, T0)).toEqual({ ok: false, error: "not_host", message: "Only the host can do that." });
    expect(g.input(state, 3, { t: "begin" }, T0 + 1)).toEqual({ ok: true, events: [] });
    expect(state.phase).toBe("playing");
    expect(g.nextDeadline(state)).toBe(state.turn.deadline);
    expect(g.join(state, 5, T0 + 2)).toEqual({ ok: true, events: [] });
    expect(state.watchers).toEqual([5]);
    expect(g.join(state, 5, T0 + 2)).toMatchObject({ ok: false, error: "already_in_game" });
    expect(g.host(state, 5, T0 + 3)).toMatchObject({ ok: true });
    expect(state.host).toBe(5);
    const before = state.turn.seat;
    g.tick(state, state.turn.deadline);
    expect(state.turn.seat).not.toBe(before);
    expect(g.leave(state, 0, T0 + 4)).toMatchObject({ ok: true });
    expect(g.isOver(state)).toBe(true);
    expect(g.standings(state)).toEqual([{ seat: 3, place: 1 }]);
    expect(g.result(state)[0]).toMatchObject({ seat: 3, place: 1 });
  });

  it("gives each match a fresh 256-bit secret the views never hold, whatever the room's seed", () => {
    const g = tableGame(rules);
    const a = g.create({ seats: [{ seat: 0 }, { seat: 1 }], seed: 4242, now: T0, host: 0 });
    const b = g.create({ seats: [{ seat: 0 }, { seat: 1 }], seed: 4242, now: T0, host: 0 });
    expect(a.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.secret).not.toBe(b.secret);
    g.input(a, 0, { t: "begin" }, T0 + 1);
    for (const viewer of [{ role: "player", seat: 0 }, { role: "player", seat: 1 }, { role: "screen", seat: -1 }]) {
      const json = JSON.stringify(g.snapshot(a, T0 + 1, viewer));
      for (let i = 0; i + 8 <= a.secret.length; i++) expect(json).not.toContain(a.secret.slice(i, i + 8));
    }
    // The rules that do not use it (Count to ten) are created as before.
    const counted = [];
    const plain = tableGame({ ...rules, create: (...args) => (counted.push(args), rules.create(...args)) });
    plain.create({ seats: [{ seat: 0 }, { seat: 1 }], seed: 7, now: T0, host: 0 });
    expect(counted[0].slice(0, 4)).toEqual([[0, 1], { host: 0 }, 7, T0]);
    expect(counted[0][4].secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes the room's presence to rules that hear it, and gives other rules no presence hook", () => {
    const g = tableGame(rules);
    const state = g.create({ seats: [{ seat: 0 }, { seat: 1 }], seed: 1, now: T0, host: 0 });
    g.input(state, 0, { t: "begin" }, T0 + 1);
    const guesser = state.turn.seat;
    const judge = 1 - guesser;
    g.input(state, guesser, { t: "guess" }, T0 + 2);
    expect(g.input(state, guesser, { t: "selfConfirm" }, T0 + 60_000)).toMatchObject({ ok: false, error: "judge_here" });
    expect(g.presence(state, judge, { connected: true, away: true }, T0 + 60_000)).toBe(true);
    expect(g.input(state, guesser, { t: "selfConfirm" }, T0 + 60_000 + rules.TIMERS.selfConfirm)).toEqual({ ok: true, events: [] });
    // A game that is over takes nothing more.
    g.leave(state, guesser, T0 + 100_000);
    expect(g.isOver(state)).toBe(true);
    expect(g.presence(state, judge, { connected: false, away: false }, T0 + 100_001)).toBe(false);
    const { HEARS_PRESENCE, ...deaf } = rules;
    expect(tableGame(deaf)).not.toHaveProperty("presence");
  });

  it("refuses to start with too few seats, through the adapter", () => {
    expect(() => tableGame(rules).create({ seats: [{ seat: 0 }], seed: 1, now: T0, host: 0 })).toThrow(/bad_seats/);
  });
});

/** The Table's wall with Who Am I? hung on it (in place of its "coming soon" entry). */
function wallWith(m = manifest) {
  const turn = buildTurnWall([{ manifest: m, game }]);
  return { ...TEST_WALL, games: new Map([...TEST_WALL.games, ...turn.games]), table: turn.table };
}

/** A party of `players` at the Table (Ann is the host) and, with `screen`, a big screen. */
async function party({ players = 2, screen = true, wall = wallWith() } = {}) {
  const env = fakeEnv();
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
  return { ctx, say, connect, tokens, ws, sleepAndWake, core: () => ctx.room.core, state: () => ctx.room.core.activity.state };
}

/** The host picks Who Am I? and the beat runs out: the game is on, at its setup step. */
async function play(r) {
  r.say(r.ws.ann, { t: "play", id: GAME });
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

/** The strings that give a name away: the name as JSON text, and its picture's addresses. */
function giveaways(id) {
  const i = getIdentity(id);
  return [JSON.stringify(i.name).slice(1, -1), ...(i.picture ? [i.picture.imageUrl, i.picture.filePage] : [])];
}

/** Whether any frame among `frames` (text) holds the name `id`. */
const heard = (frames, id) => giveaways(id).some((s) => frames.includes(s));

/** Each round's names as dealt, by seat, kept as the match goes (the server state; tests only). */
function dealt(r) {
  return { ...r.state().round.assign };
}

/** The frames a socket has received since `mark` (its frame count then), as text. */
const textSince = (ws, mark) => ws.frames.slice(mark).join("\n");

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("on the party room, two phones and a big screen", () => {
  it("plays a whole match: each phone hears only the other's name, the screen neither, until each reveal; the winner goes on the Tonight board", async () => {
    const r = await party({ players: 2 });
    const since = from(r.ws.ann, r.ws.bo, r.ws.screen);
    await play(r);
    // The setup step: Ann (the host) chooses and begins; Bo cannot.
    const start = since(r.ws.bo).find((m) => m.t === "start");
    expect(start.s).toMatchObject({ phase: "setup", you: { seat: 1, role: "player", host: false } });
    expect(since(r.ws.screen).find((m) => m.t === "start").s.you).toMatchObject({ role: "screen" });
    expect(await send(r, "bo", { t: "begin" })).toMatchObject({ t: "error", error: "not_host" });
    expect(await send(r, "ann", { t: "choose", pack: "actors", match: "first-to-3" })).toMatchObject({ t: "ack" });
    let marks = { ann: r.ws.ann.frames.length, bo: r.ws.bo.frames.length, screen: r.ws.screen.frames.length };
    expect(await send(r, "ann", { t: "begin" })).toMatchObject({ t: "ack" });
    // The turn timer is the room's alarm.
    expect(r.ctx.alarm.at).toBe(rules.nextDeadline(r.state()));
    let rounds = 0;
    while (r.core().activity.kind === "game") {
      const s = r.state();
      if (s.phase === "playing") {
        const names = dealt(r);
        const guesser = s.turn.seat;
        const judge = s.round.order.find((x) => x !== guesser);
        // A question and its answer, then the right guess, confirmed (or a pass when it may not guess yet).
        await send(r, key(guesser), { t: "ask", text: "Am I a real person?" });
        const q = r.state().turn.log.at(-1);
        expect(await send(r, key(judge), { t: "answer", id: q.id, answer: "yes" })).toMatchObject({ t: "ack" });
        if (!rules.isRefusal(rules.apply(r.state(), guesser, { t: "guess" }, Date.now()))) {
          await send(r, key(guesser), { t: "guess" });
          await send(r, key(judge), { t: "confirm" });
        } else await send(r, key(guesser), { t: "pass" });
        if (r.state().phase !== "playing" || r.state().round?.n !== s.round.n) {
          // The round is over: until now nobody heard their own name, and the screen heard neither.
          rounds++;
          for (const [seat, id] of Object.entries(names)) {
            const who = key(Number(seat));
            const other = Object.keys(names).find((x) => x !== seat);
            const upToReveal = textSince(r.ws[who], marks[who]).split("\n").filter((f) => !f.includes('"reveal"')).join("\n");
            expect(heard(upToReveal, id), `${who} heard their own name in round ${s.round.n}`).toBe(false);
            expect(heard(textSince(r.ws[who], marks[who]), names[other]), `${who} never saw the other's name`).toBe(true);
            const screen = textSince(r.ws.screen, marks.screen).split("\n").filter((f) => !f.includes('"reveal"')).join("\n");
            expect(heard(screen, id), `the screen heard ${seat}'s name`).toBe(false);
          }
          // After the reveal, everyone has both names.
          for (const who of ["ann", "bo", "screen"]) for (const id of Object.values(names)) expect(heard(r.ws[who].text(), id)).toBe(true);
        }
      } else if (s.phase === "reveal") {
        marks = { ann: r.ws.ann.frames.length, bo: r.ws.bo.frames.length, screen: r.ws.screen.frames.length };
        expect(await send(r, "bo", { t: "next" })).toMatchObject({ t: "ack" });
      }
      expect(rounds).toBeLessThan(20);
    }
    expect(rounds).toBeGreaterThanOrEqual(3);
    const end = since(r.ws.bo).find((m) => m.t === "end");
    expect(end.room).toMatchObject({ mode: "turn-based", phase: "lobby" });
    const [first, second] = end.result;
    expect(first).toMatchObject({ score: 3, place: 1 });
    expect(second.place).toBe(2);
    expect(end.last.rows.find((row) => row.seat === first.seat)).toMatchObject({ place: 1, points: 3, score: 3 });
    expect(end.last.rows.find((row) => row.seat === second.seat)).toMatchObject({ place: 2, points: 2 });
    expect(r.core().members[first.seat].points).toBe(3);
  });

  it("gives a phone that drops and comes back, or reloads, its own view again, still without its own name", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    const names = dealt(r);
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    // The room holds the seat; the rules hear only that it is not here, and the match goes on.
    expect(r.core().activity.seats).toEqual([0, 1]);
    r.ws.bo = await r.connect(r.tokens.bo);
    const full = r.ws.bo.messages().find((m) => m.t === "snap" && m.full);
    expect(full.s).toMatchObject({ phase: "playing", you: { seat: 1, role: "player" }, opponent: { seat: 0, name: getIdentity(names[0]).name } });
    expect(heard(r.ws.bo.text(), names[1])).toBe(false);
    // A reload: a second socket for the same seat while the first is still open.
    const again = await r.connect(r.tokens.bo);
    expect(again.messages().find((m) => m.t === "snap" && m.full).s).toEqual(full.s);
    expect(heard(again.text(), names[1])).toBe(false);
  });

  it("survives a restart of the room mid-round: the same names, the same turn, the same alarm", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    const before = structuredClone(r.state());
    const alarm = r.ctx.alarm.at;
    await r.sleepAndWake();
    expect(r.state()).toEqual(before);
    expect(r.ctx.alarm.at).toBe(alarm);
    expect(await send(r, key(before.turn.seat), { t: "hint" })).toMatchObject({ t: "ack" });
  });

  it("passes a move not taken in time on the room's alarm", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    const seat = r.state().turn.seat;
    await vi.advanceTimersByTimeAsync(r.state().turn.deadline - Date.now() + 50);
    expect(r.state().turn.seat).toBe(1 - seat);
    expect(r.state().notes.at(-1)).toMatchObject({ k: "timed_out", seat });
  });

  it("begins by itself when the host never taps Begin", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await vi.advanceTimersByTimeAsync(rules.TIMERS.setup + 50);
    expect(r.state().phase).toBe("playing");
  });

  it("takes someone who arrives mid-match as a watcher who sees neither name and cannot play", async () => {
    const r = await party({ players: 2, screen: false });
    await play(r);
    await send(r, "ann", { t: "begin" });
    const names = dealt(r);
    const cy = await r.ctx.room.join({ nickname: "Cy", as: "player" });
    r.ws.cy = await r.connect(cy.token);
    await settle();
    expect(r.state().watchers).toEqual([2]);
    expect(r.core().activity.seats).toEqual([0, 1, 2]);
    // First the screen's view as the phone connects, then the watcher's once the game takes it in.
    const views = r.ws.cy.messages().filter((m) => m.t === "snap").map((m) => m.s.you);
    expect(views[0]).toMatchObject({ seat: -1, role: "screen" });
    expect(views.at(-1)).toMatchObject({ seat: 2, role: "watcher" });
    expect(await send(r, "cy", { t: "hint" })).toMatchObject({ t: "error", error: "not_playing" });
    await send(r, key(r.state().turn.seat), { t: "hint" });
    for (const id of Object.values(names)) expect(heard(r.ws.cy.text(), id)).toBe(false);
  });

  it("ends with a forfeit when a phone is gone past the room's grace: the one who stayed is first", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 100);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last.rows).toEqual([expect.objectContaining({ seat: 0, place: 1, points: 3 })]);
    expect(r.core().members[0].points).toBe(3);
  });

  it("picks no winner when both phones are gone past the room's grace", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    r.ctx.room.webSocketClose(r.ws.bo, 1001, "");
    r.ctx.room.webSocketClose(r.ws.ann, 1001, "");
    await settle();
    expect(r.state().here).toEqual({ 0: false, 1: false });
    await vi.advanceTimersByTimeAsync(TURN_GRACE_MS + 100);
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last.rows.filter((row) => row.place !== null)).toEqual([]);
    expect(r.core().members.filter(Boolean).every((m) => !m.points)).toBe(true);
  });

  it("lets the guesser confirm their own guess once the judge's phone has dropped for 30 s, and not before", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    const guesser = r.state().turn.seat;
    const judge = 1 - guesser;
    await send(r, key(guesser), { t: "guess" });
    await vi.advanceTimersByTimeAsync(rules.TIMERS.selfConfirm + 1000);
    expect(await send(r, key(guesser), { t: "selfConfirm" })).toMatchObject({ t: "error", error: "judge_here" });
    r.ctx.room.webSocketClose(r.ws[key(judge)], 1001, "");
    await settle();
    expect(await send(r, key(guesser), { t: "selfConfirm" })).toMatchObject({ t: "error", error: "too_soon" });
    await vi.advanceTimersByTimeAsync(rules.TIMERS.selfConfirm);
    expect(await send(r, key(guesser), { t: "selfConfirm" })).toMatchObject({ t: "ack" });
    expect(r.state().notes.some((n) => n.k === "self_confirmed")).toBe(true);
  });

  it("scores a decided match once when the host taps the Table's own End the game on its last reveal", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    // First to 3: right guesses, confirmed, until the reveal that decides the match.
    for (let i = 0; i < 20 && !rules.decided(r.state()); i++) {
      const s = r.state();
      if (s.phase === "reveal") await send(r, "ann", { t: "next" });
      else {
        await send(r, key(s.turn.seat), { t: "guess" });
        await send(r, key(1 - s.turn.seat), { t: "confirm" });
      }
    }
    expect(rules.decided(r.state())).toBe(true);
    const places = game.standings(r.state());
    expect(places).toHaveLength(2);
    const since = from(r.ws.ann, r.ws.bo);
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    const end = since(r.ws.bo).find((m) => m.t === "end");
    expect(end.last).not.toHaveProperty("early");
    expect(end.last.rows.map((row) => [row.seat, row.place]).sort()).toEqual(places.map((p) => [p.seat, p.place]).sort());
    const after = [0, 1].map((s) => r.core().members[s].points);
    expect(after.sort()).toEqual([2, 3]);
    // Scored once: the reveal's own deadline coming later changes nothing.
    await vi.advanceTimersByTimeAsync(rules.TIMERS.reveal + 5000);
    expect([0, 1].map((s) => r.core().members[s].points).sort()).toEqual(after);
    expect(r.core().history.filter((h) => h.name === "Who Am I?")).toHaveLength(1);
  });

  it("still throws away a match that is not decided when the host ends it from the Table", async () => {
    const r = await party({ players: 2 });
    await play(r);
    await send(r, "ann", { t: "begin" });
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().last).toMatchObject({ rows: [], early: { why: "host" } });
    expect([0, 1].map((s) => r.core().members[s].points)).toEqual([0, 0]);
  });

  it("ends with a forfeit when a player leaves the party mid-round, and shows that round's names to the one who stayed", async () => {
    const r = await party({ players: 2 });
    const since = from(r.ws.ann, r.ws.screen);
    await play(r);
    await send(r, "ann", { t: "begin" });
    const names = dealt(r);
    r.say(r.ws.bo, { t: "leave" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    const end = since(r.ws.ann).find((m) => m.t === "end");
    expect(end.result.find((row) => row.seat === 1)).toMatchObject({ place: null, forfeit: true });
    expect(end.last.rows).toEqual([expect.objectContaining({ seat: 0, place: 1 })]);
    // The last snapshot reveals the unfinished round to everyone left.
    const last = since(r.ws.ann).filter((m) => m.t === "snap").at(-1).s;
    expect(last.reveal.entries.map((e) => e.name).sort()).toEqual(Object.values(names).map((id) => getIdentity(id).name).sort());
  });
});

describe("on the party room, a table of three (the manifest raised to eight)", () => {
  it("lets the host pick the two; the third watches with no name, and gets no place", async () => {
    const wide = { ...manifest, players: { min: 2, max: 8 } };
    const r = await party({ players: 3, wall: wallWith(wide) });
    await play(r);
    expect(r.state().pool).toEqual([0, 1, 2]);
    expect(await send(r, "ann", { t: "pick", seats: [1, 2] })).toMatchObject({ t: "ack" });
    await send(r, "ann", { t: "begin" });
    const names = dealt(r);
    expect(r.state().watchers).toEqual([0]);
    expect(r.ws.ann.messages().filter((m) => m.t === "snap").at(-1).s.you).toMatchObject({ role: "watcher", host: true });
    await send(r, "bo", { t: "hint" });
    await send(r, "cy", { t: "hint" });
    for (const id of Object.values(names)) expect(heard(r.ws.ann.text(), id)).toBe(false);
    // The host may still end it for everyone (the room's own `stop`); nobody scores.
    r.say(r.ws.ann, { t: "stop" });
    await settle();
    expect(r.core().activity.kind).toBe("lobby");
    expect(r.core().members.filter(Boolean).every((m) => !m.points)).toBe(true);
  });
});
