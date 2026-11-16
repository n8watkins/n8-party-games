// A page hidden during a turn-based game keeps its socket and says it is away (connection.js). Its
// browser then slows or stops the keep-alive, so the socket goes silent. Proved on the real party
// room class: an away socket of a seat in the game is not reaped as silent before the game's
// grace, its grace does not run while it is away, and the game goes on when the page is back.
// A silent socket that is not away is still reaped after SILENT_MS, as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_GRACE_MS } from "../server/lobby-core.js";
import { dropFakeRuntime, settle, useFakeRuntime, walkIn } from "./fake-room.js";
import { TURN_MS, started as startedIn, turnGame } from "./turn-game.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

const SILENT_MS = 25_000;

/** A party in a turn-based game where `quiet` sockets get no keep-alive reply (their page's timers are stopped), and every other socket does. */
async function startedWithQuiet(game) {
  const r = await startedIn(createLobbyRoom, game);
  const quiet = new Set();
  r.ctx.getWebSocketAutoResponseTimestamp = (ws) => (quiet.has(ws) ? null : new Date(Date.now()));
  return { ...r, quiet };
}

/** Runs the clock on in steps, with the room's own wake-ups (the turn deadlines, which look for silent sockets). */
async function wait(ms, step = 5_000) {
  for (let left = ms; left > 0; left -= step) await vi.advanceTimersByTimeAsync(Math.min(step, left));
}

/** Something reaches the turn-based game (the screen's tap, which it turns down): the room looks for silent sockets first. */
async function poke(say, ws) {
  say(ws.screen, { t: "in", d: { say: "poke" } });
  await settle();
}

/** Ann says something on her turn: an input, which also makes the room look for silent sockets. */
async function annSpeaks(ctx, say, ws) {
  if (ctx.room.core.activity.state.seats[ctx.room.core.activity.state.turn] !== 0) return;
  say(ws.ann, { t: "in", d: { say: "Am I a bird?" } });
  await settle();
}

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("an away socket in a turn-based game", () => {
  it("is not reaped as silent before the game's grace, and its grace does not run while it is away", async () => {
    const game = turnGame();
    const { ctx, say, ws, quiet } = await startedWithQuiet(game);
    // Bo's phone is locked: the page says away, then its keep-alive stops.
    say(ws.bo, { t: "away" });
    await settle();
    quiet.add(ws.bo);
    expect(ctx.room.core.members[1]).toMatchObject({ connected: true, away: true });

    // Far past the silent limit, with the turn deadlines and Ann's inputs looking for silent sockets all along.
    for (let t = 0; t < TURN_GRACE_MS - 10_000; t += 10_000) {
      await wait(10_000);
      await annSpeaks(ctx, say, ws);
      await poke(say, ws);
    }
    expect(game.calls.tick).toBeGreaterThan(0);
    expect(ws.bo.closed).toBeNull();
    expect(ctx.room.core.members[1]).toMatchObject({ connected: true, away: true });
    expect(ctx.room.core.members[1].droppedAt ?? null).toBeNull();
    expect(ctx.room.core.activity.kind).toBe("game");

    // Bo unlocks the phone: back on the same socket, and the game goes on.
    say(ws.bo, { t: "back" });
    await settle();
    quiet.delete(ws.bo);
    expect(ctx.room.core.members[1]).toMatchObject({ connected: true });
    expect(ctx.room.core.members[1]).not.toHaveProperty("away", true);
    await wait(TURN_MS * 2);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(ws.bo.closed).toBeNull();
  });

  it.each([
    ["just after the grace", 1_000],
    ["long after the grace", 120_000],
  ])("silent for longer than the game's grace, reaped %s: one grace from its last sign of life, so the seat is gone at once", async (_, late) => {
    const grace = 60_000;
    // No turn timer, so nothing but the poke wakes the room.
    const game = turnGame({ fields: { reconnectGraceMs: grace, nextDeadline: () => null } });
    const { ctx, say, ws, quiet } = await startedWithQuiet(game);
    say(ws.bo, { t: "away" });
    await settle();
    const lastHeard = Date.now();
    quiet.add(ws.bo);
    await wait(grace - 6_000);
    await poke(say, ws);
    expect(ws.bo.closed).toBeNull();
    expect(ctx.room.core.activity.kind).toBe("game");
    await wait(6_000 + late);
    const reapedAt = Date.now();
    await poke(say, ws);
    expect(ws.bo.closed).toMatchObject({ code: 1001, reason: "silent" });
    // The drop is dated from the last sign of life, never later: not a second grace.
    expect(ctx.room.core.members[1]).toMatchObject({ connected: false, droppedAt: lastHeard });
    expect(reapedAt - lastHeard).toBeGreaterThanOrEqual(grace);
    expect(ctx.room.core.activity.kind).toBe("lobby");
    const note = ws.ann.messages().find((m) => m.t === "note" && m.k === "ended");
    expect(note).toMatchObject({ why: "gone", seat: 1 });
  });

  it("the reviewer's case, with presence and the default grace: an away phone that goes silent ends the game when it is reaped, not at the stale limit", async () => {
    const game = turnGame({ presence: true });
    const { ctx, say, ws, quiet } = await startedWithQuiet(game);
    say(ws.ann, { t: "away" });
    await settle();
    const lastHeard = Date.now();
    quiet.add(ws.ann);
    expect(ctx.room.core.activity.state.paused).not.toBeNull();
    await wait(TURN_GRACE_MS);
    // Bo taps (out of turn: a quiet refusal), and the room looks for silent sockets.
    say(ws.bo, { t: "in", d: { say: "Is it me?" }, id: "b1" });
    await settle();
    expect(ws.ann.closed).toMatchObject({ code: 1001, reason: "silent" });
    expect(ctx.room.core.members[0].droppedAt).toBe(lastHeard);
    expect(ctx.room.core.activity.kind).toBe("lobby");
  });
});

describe("a socket reaped as silent in a turn-based game", () => {
  it("whose game hears nothing new (a quiet upkeep) still gets its grace-end wake-up, and the game ends at the grace, not at the stale limit", async () => {
    // No presence and no turn timer: the reap tells the game nothing it acts on, and no deadline arms the alarm.
    const game = turnGame({ fields: { nextDeadline: () => null } });
    const { ctx, say, ws, quiet } = await startedWithQuiet(game);
    quiet.add(ws.ann);
    await wait(SILENT_MS + 5_000);
    // Bo taps out of turn: a quiet refusal that arms nothing; the room reaps Ann first.
    say(ws.bo, { t: "in", d: { say: "Hello?" }, id: "b1" });
    await settle();
    expect(ws.ann.closed).toMatchObject({ code: 1001, reason: "silent" });
    const droppedAt = ctx.room.core.members[0].droppedAt;
    expect(ctx.alarm.at).toBe(droppedAt + TURN_GRACE_MS);
    await vi.advanceTimersByTimeAsync(droppedAt + TURN_GRACE_MS - Date.now() - 1);
    expect(ctx.room.core.activity.kind).toBe("game");
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.room.core.activity.kind).toBe("lobby");
  });

  it("with an Infinity grace is never reaped as silent", async () => {
    const game = turnGame({ fields: { reconnectGraceMs: Infinity } });
    const { ctx, say, ws, quiet } = await startedWithQuiet(game);
    say(ws.bo, { t: "away" });
    await settle();
    quiet.add(ws.bo);
    // Half an hour of Ann talking on her own (taps keep the room from closing as forgotten).
    for (let t = 0; t < 30 * 60_000; t += 30_000) {
      await wait(30_000);
      await annSpeaks(ctx, say, ws);
    }
    expect(ws.bo.closed).toBeNull();
    expect(ctx.room.core.members[1]).toMatchObject({ connected: true, away: true });
    expect(ctx.room.core.activity.kind).toBe("game");
  });

  it("a silent socket that is not away is still reaped after the silent limit, as before", async () => {
    const game = turnGame();
    const { ctx, ws, quiet } = await startedWithQuiet(game);
    quiet.add(ws.bo);
    await wait(SILENT_MS + TURN_MS + 5_000);
    expect(ws.bo.closed).toMatchObject({ code: 1001, reason: "silent" });
    expect(ctx.room.core.members[1].connected).toBe(false);
  });

  it("an away socket in the lobby has no longer than anyone else", async () => {
    const game = turnGame();
    const { ctx, connect, say, ws, quiet } = await startedWithQuiet(game);
    say(ws.bo, { t: "leave" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("lobby");
    say(ws.ann, { t: "away" });
    await settle();
    quiet.add(ws.ann);
    await wait(SILENT_MS + 5_000);
    // Someone walks in the lobby, and the room looks for silent sockets.
    const cy = await ctx.room.join({ nickname: "Cy", as: "player" });
    const wsCy = await connect(cy.token);
    await walkIn(say, ctx, wsCy, cy.seat);
    expect(ws.ann.closed).toMatchObject({ code: 1001, reason: "silent" });
  });
});
