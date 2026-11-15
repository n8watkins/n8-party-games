// Per-seat views in the party room (W1b), proved on the real Durable Object class: the vote starts
// the game, the room's own timer ticks it, and every frame each socket is sent is captured as the
// raw text that would go down the wire. The secrets are then looked for in those frames.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cork from "cork-and-bell";
import { GAME_FRAME, dropFakeRuntime, eventsOf, expectNoRoomSeed, kindsOf, openRoom as open, useFakeRuntime, voteIn } from "./fake-room.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

/**
 * A game with a secret per seat, in the shape of Who Am I?: each player may see the other
 * players' secrets and never their own, and the screen sees none. It takes the viewer at its
 * word (a player's view holds every secret but that seat's), so a member outside the game who
 * were wrongly called a player would be handed both secrets: only the room keeps them out.
 * Its events are whispers: a public one, one for each seat naming the other seats' secrets, and
 * one addressed to a list (every seat but the first hears the first seat's secret). Like Cork &
 * Bell it shows its seed in its snapshot.
 */
function secretGame({ ticks = 30 } = {}) {
  return {
    id: "secrets",
    minSeats: 2,
    maxSeats: 2,
    tickHz: 30,
    snapshotEvery: 3,
    create: ({ seed, seats, round }) => ({
      seed,
      seats: seats.map((s) => s.seat),
      secrets: Object.fromEntries(seats.map((s) => [s.seat, `SECRET-${round}-${s.seat}-${crypto.randomUUID()}`])),
      ticks: 0,
    }),
    input: () => {},
    tick(state) {
      state.ticks += 1;
      const events = [{ k: "turn", n: state.ticks }];
      for (const seat of state.seats) {
        events.push({ k: "whisper", only: seat, others: state.seats.filter((s) => s !== seat).map((s) => state.secrets[s]) });
      }
      events.push({ k: "about-first", only: state.seats.slice(1), secret: state.secrets[state.seats[0]] });
      return events;
    },
    snapshot(state, now, viewer) {
      const base = { ticks: state.ticks, seats: state.seats, seed: state.seed };
      if (viewer?.role === "player") {
        return { ...base, you: viewer.seat, others: Object.fromEntries(state.seats.filter((s) => s !== viewer.seat).map((s) => [s, state.secrets[s]])) };
      }
      return { ...base, screen: true };
    },
    isOver: (state) => state.ticks >= ticks,
    result: (state) => state.seats.map((seat, i) => ({ seat, place: i + 1 })),
  };
}

const openRoom = (game, players = { min: 2, max: 2 }) => open(createLobbyRoom, game, { players });

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("per-seat views in the party room, on the wire", () => {
  it("a seat never receives its own secret, the other seat does, and the screen and a member outside the game get neither", async () => {
    const r = await openRoom(secretGame());
    const { ctx, connect, say } = r;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const screen = await ctx.room.join({ as: "screen" });
    const wsAnn = await connect(ann.token);
    const wsBo = await connect(bo.token);
    const wsScreen = await connect(screen.token);
    await voteIn(r, [wsAnn, 0], [wsBo, 1]);
    const a = ctx.room.core.activity;
    expect(a.seats).toEqual([0, 1]);
    const [secretAnn, secretBo] = [a.state.secrets[0], a.state.secrets[1]];

    // A few ticks in: Ann's phone reloads (a second socket), Bo's drops and comes back, and Cy
    // joins the party: seated in the room, not in the game.
    await vi.advanceTimersByTimeAsync(200);
    const wsAnn2 = await connect(ann.token);
    ctx.room.webSocketClose(wsBo, 1006, "gone");
    await vi.advanceTimersByTimeAsync(100);
    const wsBo2 = await connect(bo.token);
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    expect(cy.seat).toBe(2);
    const wsCy = await connect(cy.token);
    // The game runs to its end (30 ticks at 30 Hz), with snapshots every 3 ticks and at the end.
    await vi.advanceTimersByTimeAsync(1500);
    expect(ctx.room.core.activity.kind).toBe("lobby");

    for (const ws of [wsAnn, wsScreen]) expect([...kindsOf(ws)]).toEqual(expect.arrayContaining(["hello", "room", "vote", "start", "ev", "snap", "end"]));
    expect([...kindsOf(wsBo)]).toEqual(expect.arrayContaining(["hello", "room", "vote", "start", "ev", "snap"]));
    expect(wsBo.closed).not.toBeNull();
    for (const ws of [wsAnn2, wsBo2, wsCy]) {
      expect([...kindsOf(ws)]).toEqual(expect.arrayContaining(["hello", "snap", "ev", "end"]));
      expect(ws.messages().find((m) => m.t === "snap").full).toBe(true);
    }
    // The full snapshot on connecting is the one that socket's viewer may see.
    expect(wsAnn2.messages().find((m) => m.t === "snap").s).toMatchObject({ you: 0, others: { 1: secretBo } });
    expect(wsBo2.messages().find((m) => m.t === "snap").s).toMatchObject({ you: 1, others: { 0: secretAnn } });
    expect(wsCy.messages().find((m) => m.t === "snap").s).toMatchObject({ screen: true });
    // The start and the last snapshot too.
    expect(wsAnn.messages().find((m) => m.t === "start").s).toMatchObject({ you: 0, others: { 1: secretBo } });
    expect(wsScreen.messages().find((m) => m.t === "start").s).toMatchObject({ screen: true });
    const lastSnap = (ws) => ws.messages().filter((m) => m.t === "snap").at(-1).s;
    expect(lastSnap(wsAnn)).toMatchObject({ ticks: 30, others: { 1: secretBo } });
    expect(lastSnap(wsCy)).toMatchObject({ ticks: 30, screen: true });

    // Frame by frame: a seat never gets its own secret, and gets the other's.
    for (const ws of [wsAnn, wsAnn2]) {
      for (const frame of ws.frames) expect(frame).not.toContain(secretAnn);
      expect(ws.text()).toContain(secretBo);
    }
    for (const ws of [wsBo, wsBo2]) {
      for (const frame of ws.frames) expect(frame).not.toContain(secretBo);
      expect(ws.text()).toContain(secretAnn);
    }
    for (const ws of [wsScreen, wsCy]) expect(ws.text()).not.toContain("SECRET-");

    // Addressed events reach their seats and nobody else; the rest reach everyone.
    expect(eventsOf(wsAnn).filter((e) => e.k === "whisper").every((e) => e.only === 0)).toBe(true);
    expect(eventsOf(wsBo).filter((e) => e.k === "whisper").every((e) => e.only === 1)).toBe(true);
    expect(eventsOf(wsAnn).filter((e) => e.k === "about-first")).toHaveLength(0);
    // Bo's two sockets between them, less the ticks while the phone was away.
    expect([...eventsOf(wsBo), ...eventsOf(wsBo2)].filter((e) => e.k === "about-first").length).toBeGreaterThan(20);
    expect(eventsOf(wsAnn2).filter((e) => e.k === "about-first")).toHaveLength(0);
    expect(new Set(eventsOf(wsScreen).map((e) => e.k))).toEqual(new Set(["turn"]));
    expect(eventsOf(wsScreen)).toHaveLength(30);
    expect(new Set(eventsOf(wsCy).map((e) => e.k))).toEqual(new Set(["turn"]));

    // No seed of the room's goes out, and the game's own seed (which it shows) is not one derived from it.
    expectNoRoomSeed(ctx.room.core, [wsAnn, wsAnn2, wsBo, wsBo2, wsScreen, wsCy]);
    expect(a.state.seed).not.toBe(ctx.room.core.roundSeed(1));
  });

  it("keeps the views right through a sleep in the middle of a game, and in the next game on the woken room", async () => {
    const r = await openRoom(secretGame({ ticks: 60 }));
    const { ctx, connect, say, sleepAndWake } = r;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const screen = await ctx.room.join({ as: "screen" });
    const wsAnn = await connect(ann.token);
    const wsBo = await connect(bo.token);
    const wsScreen = await connect(screen.token);
    await voteIn(r, [wsAnn, 0], [wsBo, 1]);
    const first = ctx.room.core.activity.state.secrets;
    await vi.advanceTimersByTimeAsync(300);
    // Cy joins mid-game, then the room restarts while the game is on. A game cut short by a
    // restart is not kept (lobby-core.js, serialize): everyone hears they are back in the lobby.
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const wsCy = await connect(cy.token);
    const before = new Map([wsAnn, wsBo, wsScreen, wsCy].map((ws) => [ws, ws.frames.length]));
    await sleepAndWake();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    expect(ctx.room.sockets.size).toBe(4);
    await vi.advanceTimersByTimeAsync(2000);
    for (const [ws, n] of before) {
      const after = ws.frames.slice(n);
      expect(after.some((f) => f.startsWith('{"t":"room"'))).toBe(true);
      expect(after.filter((f) => GAME_FRAME.test(f))).toEqual([]);
    }
    // A phone that reconnects after the wake gets the room and no game state.
    ctx.room.webSocketClose(wsBo, 1006, "gone");
    const wsBo2 = await connect(bo.token);
    expect(wsBo2.messages().map((m) => m.t)).not.toContain("snap");

    // Cy leaves, so the two-seat game's light is on again; the woken room plays the next game.
    say(wsCy, { t: "leave" });
    await voteIn(r, [wsAnn, 0], [wsBo2, 1]);
    const second = ctx.room.core.activity.state.secrets;
    // Mid-game on the woken room, Ann's phone reloads.
    await vi.advanceTimersByTimeAsync(300);
    const wsAnn2 = await connect(ann.token);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ctx.room.core.activity.kind).toBe("lobby");

    for (const ws of [wsAnn, wsAnn2]) {
      for (const frame of ws.frames) expect(frame).not.toContain(first[0]);
      for (const frame of ws.frames) expect(frame).not.toContain(second[0]);
      expect(ws.text()).toContain(second[1]);
    }
    for (const ws of [wsBo, wsBo2]) {
      for (const frame of ws.frames) expect(frame).not.toContain(first[1]);
      for (const frame of ws.frames) expect(frame).not.toContain(second[1]);
    }
    expect(wsBo.text()).toContain(first[0]);
    expect(wsBo2.text()).toContain(second[0]);
    for (const ws of [wsScreen, wsCy]) expect(ws.text()).not.toContain("SECRET-");
    expect(wsAnn2.messages().find((m) => m.t === "snap")).toMatchObject({ full: true, s: { you: 0, others: { 1: second[1] } } });
    expectNoRoomSeed(ctx.room.core, [wsAnn, wsAnn2, wsBo, wsBo2, wsScreen, wsCy]);
  });

  it("Cork & Bell, which ignores the viewer, sends every socket the same game frames, as before", async () => {
    const r = await openRoom(cork.game, cork.manifest.players);
    const { ctx, connect } = r;
    const ann = await ctx.room.create({ code: "BCDFGH", nickname: "Ann", as: "player" });
    const bo = await ctx.room.join({ nickname: "Bo", as: "player" });
    const screen = await ctx.room.join({ as: "screen" });
    const sockets = [await connect(ann.token), await connect(bo.token), await connect(screen.token)];
    await voteIn(r, [sockets[0], 0], [sockets[1], 1]);
    // Halfway through, Cy arrives: seated in the room, watching the battle.
    await vi.advanceTimersByTimeAsync(40_000);
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const wsCy = await connect(cy.token);
    const cyFrom = sockets[0].frames.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const game = (ws) => ws.frames.filter((f) => GAME_FRAME.test(f));
    const [a, b, c] = sockets.map(game);
    expect(a.filter((f) => f.startsWith('{"t":"snap"')).length).toBeGreaterThan(150);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // Cy's frames from the moment it connected are everyone's, after its own full snapshot.
    const cyGame = game(wsCy);
    expect(JSON.parse(cyGame[0])).toMatchObject({ t: "snap", full: true });
    expect(cyGame.slice(1)).toEqual(sockets[0].frames.slice(cyFrom).filter((f) => GAME_FRAME.test(f)));
    expect(sockets[0].messages().find((m) => m.t === "end").last.rows).toHaveLength(2);
    expectNoRoomSeed(ctx.room.core, [...sockets, wsCy]);
  });
});
