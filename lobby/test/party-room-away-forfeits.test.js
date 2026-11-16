// A player who hides their page in a turn-based game (another tab, another app; the socket stays
// open) runs the same clock as a phone that dropped: missing for the game's grace, the seat is
// gone and the room ends the match through `game.abandon`, with the player who stayed first. The
// owner's rule (2026-11-15): "put a timer so they can't hide their page, and if they don't come
// back they just lose". Proved on the real party room class, with the Who Am I?-shaped test game
// (turn-game.js), whose turn timer pauses while a seat is missing, so nothing but the room's own
// alarm for the grace wakes the room. The clock's rule (presence.js, absenceClock): it runs while
// the seat is missing, winds back up at the same speed while it is back, and a move gives the
// whole grace back. Every other phone and the big screen are told when the seat runs out
// (`awayIn` on the room view's member), by the room's clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropFakeRuntime, settle, useFakeRuntime } from "./fake-room.js";
import { from, spotsFor4, standOn, started as startedIn, turnGame } from "./turn-game.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { createLobbyRoom } = await import("../server/lobby-room.js");

/** Who Am I?'s grace: a minute. */
const GRACE = 60_000;

/** Who Am I? in small: first to 3, with presence (its turn timer pauses while a seat is missing), and the game's grace. */
const whoAmI = (fields = {}) => turnGame({ presence: true, firstTo: 3, fields: { reconnectGraceMs: GRACE, ...fields } });
const started = (game) => startedIn(createLobbyRoom, game);
const roomOf = (msgs) => msgs.filter((m) => m.room).at(-1)?.room;
const endedNote = (ws) => ws.messages().find((m) => m.t === "note" && m.k === "ended");

/** Runs the clock on to `at` exactly, and says whether the match is still on just before it and over at it. */
async function endsAt(ctx, at) {
  await vi.advanceTimersByTimeAsync(at - Date.now() - 1);
  const before = ctx.room.core.activity.kind;
  await vi.advanceTimersByTimeAsync(1);
  return [before, ctx.room.core.activity.kind];
}

beforeEach(useFakeRuntime);
afterEach(dropFakeRuntime);

describe("a page hidden in a turn-based game", () => {
  it("on the player's own turn, for the whole grace: the match ends and the one who stayed is first with her points, on an alarm, the room asleep in between", async () => {
    const game = whoAmI();
    const { ctx, say, ws, sleepAndWake } = await started(game);
    // Ann scores, and it is Bo's turn. Bo is losing, and hides his page.
    say(ws.ann, { t: "in", d: { say: "Am I a bird?", point: true } });
    await settle();
    expect(ctx.room.core.activity.state.turn).toBe(1);
    say(ws.bo, { t: "away" });
    await settle();
    const awayAt = Date.now();
    // The turn timer is paused (the game's rule), so the only wake-up left is the grace's.
    expect(ctx.room.core.turnDeadline()).toBeNull();
    expect(ctx.alarm.at).toBe(awayAt + GRACE);
    // The room sleeps, and nobody does anything: no tick, no timer, just the alarm.
    await vi.advanceTimersByTimeAsync(5_000);
    await sleepAndWake();
    expect(ctx.room.timer).toBeNull();
    expect(ctx.alarm.at).toBe(awayAt + GRACE);
    const rang = ctx.alarm.rang;
    expect(await endsAt(ctx, awayAt + GRACE)).toEqual(["game", "lobby"]);
    expect(ctx.alarm.rang).toBe(rang + 1);
    // Ann is first with her points; Bo gets no place, and everyone hears why.
    const last = ctx.room.core.last;
    expect(last.rows).toEqual([expect.objectContaining({ seat: 0, name: "Ann", place: 1, points: 3 })]);
    expect(last.early).toMatchObject({ seat: 1, name: "Bo", why: "gone", text: "Bo did not come back, so turns ended." });
    expect(game.calls.abandon).toEqual([{ seat: 1, at: awayAt + GRACE, decided: false }]);
    for (const w of [ws.ann, ws.screen, ws.bo]) expect(endedNote(w)).toMatchObject({ why: "gone", seat: 1 });
    // Bo's page, shown again, finds the match over: its socket heard the end while it was hidden.
    expect(ws.bo.closed).toBeNull();
    expect(ws.bo.messages().some((m) => m.t === "end")).toBe(true);
  });

  it("back at 59 seconds: the match goes on, and his clock winds back up while he is here", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    await vi.advanceTimersByTimeAsync(59_000);
    say(ws.bo, { t: "back" });
    await settle();
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(roomOf(ws.ann.messages()).members[1]).not.toHaveProperty("awayIn");
    // Long after: still on (the turn timer runs again and times turns out, nobody forfeits).
    await vi.advanceTimersByTimeAsync(5 * GRACE);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.abandon).toEqual([]);
    // Back for longer than he was away, he has the whole grace again.
    say(ws.bo, { t: "away" });
    await settle();
    expect(ctx.alarm.at).toBe(Date.now() + GRACE);
  });

  it("blinking in and out does not start the clock over: hidden 50 s, shown 2 s, hidden again, he has 12 s left", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    await vi.advanceTimersByTimeAsync(50_000);
    say(ws.bo, { t: "back" });
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    const since = from(ws.ann, ws.screen);
    say(ws.bo, { t: "away" });
    await settle();
    const hidAgain = Date.now();
    for (const w of [ws.ann, ws.screen]) expect(roomOf(since(w)).members[1]).toMatchObject({ away: true, awayIn: 12_000 });
    expect(await endsAt(ctx, hidAgain + 12_000)).toEqual(["game", "lobby"]);
    expect(ctx.room.core.last.early).toMatchObject({ seat: 1, why: "gone" });
  });

  it("blinking every few seconds for ever still runs out: each second hidden needs a second back", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    const t0 = Date.now();
    // Hidden 5 s, shown 1 s, again and again.
    while (ctx.room.core.activity.kind === "game" && Date.now() - t0 < 10 * GRACE) {
      say(ws.bo, { t: "away" });
      await settle();
      await vi.advanceTimersByTimeAsync(5_000);
      if (ctx.room.core.activity.kind !== "game") break;
      say(ws.bo, { t: "back" });
      await settle();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(ctx.room.core.activity.kind).toBe("lobby");
    // 60 s of hiding at 4 s net a cycle: within 15 cycles of 6 s.
    expect(Date.now() - t0).toBeLessThanOrEqual(15 * 6_000);
    expect(ctx.room.core.last.early).toMatchObject({ seat: 1, why: "gone" });
  });

  it("a move the game takes gives the whole grace back", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    // Ann's turn: she hides for 50 s, comes back and asks her question.
    say(ws.ann, { t: "away" });
    await settle();
    await vi.advanceTimersByTimeAsync(50_000);
    say(ws.ann, { t: "back" });
    await settle();
    say(ws.ann, { t: "in", d: { say: "Am I a cat?" } });
    await settle();
    say(ws.ann, { t: "away" });
    await settle();
    expect(ctx.alarm.at).toBe(Date.now() + GRACE);
  });

  it("on the OTHER player's turn runs the same clock", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    expect(ctx.room.core.activity.state.turn).toBe(0);
    // Ann is thinking; Bo hides his page while he waits.
    say(ws.bo, { t: "away" });
    await settle();
    const awayAt = Date.now();
    expect(await endsAt(ctx, awayAt + GRACE)).toEqual(["game", "lobby"]);
    expect(ctx.room.core.last.rows).toEqual([expect.objectContaining({ seat: 0, place: 1 })]);
    expect(ctx.room.core.last.early).toMatchObject({ seat: 1, why: "gone" });
  });

  it("both players away: the one who hid first is gone at their limit, and the other is first", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    say(ws.ann, { t: "away" });
    await settle();
    const annAt = Date.now();
    await vi.advanceTimersByTimeAsync(10_000);
    say(ws.bo, { t: "away" });
    await settle();
    for (const m of roomOf(ws.screen.messages()).members.slice(0, 2)) expect(m).toHaveProperty("away", true);
    expect(roomOf(ws.screen.messages()).members.map((m) => m?.awayIn ?? null).slice(0, 2)).toEqual([GRACE - 10_000, GRACE]);
    expect(await endsAt(ctx, annAt + GRACE)).toEqual(["game", "lobby"]);
    expect(ctx.room.core.last.early).toMatchObject({ seat: 0, why: "gone" });
    expect(ctx.room.core.last.rows).toEqual([expect.objectContaining({ seat: 1, place: 1 })]);
  });

  it("away and then dropped is one clock, not two", async () => {
    const game = whoAmI();
    const { ctx, say, ws } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    const awayAt = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    // The phone suspends the hidden page's socket.
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await settle();
    expect(ctx.room.core.members[1]).toMatchObject({ connected: false });
    expect(ctx.alarm.at).toBe(awayAt + GRACE);
    expect(roomOf(ws.ann.messages()).members[1]).toMatchObject({ connected: false, awayIn: 30_000 });
    expect(await endsAt(ctx, awayAt + GRACE)).toEqual(["game", "lobby"]);
    expect(ctx.room.core.last.early).toMatchObject({ seat: 1, why: "gone" });
  });

  it("dropped and back on a new socket within the grace: the match goes on, and the clock stops", async () => {
    const game = whoAmI();
    const { ctx, connect, say, ws, tokens } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    ctx.room.webSocketClose(ws.bo, 1006, "");
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await connect(tokens.bo);
    await settle();
    expect(ctx.room.core.members[1]).toMatchObject({ connected: true });
    expect(ctx.room.core.members[1].away ?? false).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * GRACE);
    expect(ctx.room.core.activity.kind).toBe("game");
  });

  it("the time everyone else is shown is the room's, and it runs on through a sleep", async () => {
    const game = whoAmI();
    const { ctx, connect, say, ws, tokens, sleepAndWake } = await started(game);
    const since = from(ws.ann, ws.screen);
    say(ws.bo, { t: "away" });
    await settle();
    const awayAt = Date.now();
    for (const w of [ws.ann, ws.screen]) expect(roomOf(since(w)).members[1]).toMatchObject({ away: true, awayIn: GRACE });
    // Bo's own page is not told to count down for itself, but its seat's time is in the room view all the same.
    await vi.advanceTimersByTimeAsync(20_000);
    await sleepAndWake();
    // The big screen reloads after the sleep: the room's word on the time left, not a fresh minute.
    ctx.room.webSocketClose(ws.screen, 1006, "");
    await settle();
    const screen = await connect(tokens.screen);
    await settle();
    const hello = screen.messages().find((m) => m.t === "hello");
    expect(hello.room.members[1]).toMatchObject({ away: true, awayIn: awayAt + GRACE - Date.now() });
    expect(hello.room.members[1].awayIn).toBe(GRACE - 20_000);
    expect(await endsAt(ctx, awayAt + GRACE)).toEqual(["game", "lobby"]);
  });

  it("back long before the limit: the alarm for the limit is taken back, so the room does not wake for nothing", async () => {
    // No turn timer, so nothing sooner moves the alarm when he is back.
    const game = whoAmI({ nextDeadline: () => null });
    const { ctx, say, ws } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    const awayAt = Date.now();
    expect(ctx.alarm.at).toBe(awayAt + GRACE);
    await vi.advanceTimersByTimeAsync(10_000);
    say(ws.bo, { t: "back" });
    await settle();
    expect(ctx.alarm.at).toBe(ctx.room.core.nextWake(Date.now()));
    expect(ctx.alarm.at).toBeGreaterThan(awayAt + GRACE);
    const rang = ctx.alarm.rang;
    await vi.advanceTimersByTimeAsync(2 * GRACE);
    expect(ctx.alarm.rang).toBe(rang);
    expect(ctx.room.core.activity.kind).toBe("game");
  });

  it("with an endless grace keeps today's behaviour: away for ever, no time shown, no wake-up for it", async () => {
    const game = whoAmI({ reconnectGraceMs: Infinity });
    const { ctx, say, ws } = await started(game);
    say(ws.bo, { t: "away" });
    await settle();
    expect(roomOf(ws.ann.messages()).members[1]).toMatchObject({ away: true });
    expect(roomOf(ws.ann.messages()).members[1]).not.toHaveProperty("awayIn");
    expect(ctx.room.core.nextWake(Date.now())).toBe(ctx.room.core.lastActive + ctx.room.core.lifetimes().staleRoomMs);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.abandon).toEqual([]);
  });
});

describe("an audience phone hidden during a turn-based game", () => {
  it("starts no clock and never ends the match", async () => {
    const game = whoAmI();
    const r = await spotsFor4(createLobbyRoom, game);
    const { ctx, say, ws } = r;
    await standOn(r, ws.ann, 0, 0);
    await standOn(r, ws.bo, 1, 1);
    say(ws.ann, { t: "settings-start" });
    await settle();
    expect(ctx.room.core.activity).toMatchObject({ kind: "game", seats: [0, 1] });
    const armed = ctx.alarm.at;
    say(ws.cy, { t: "away" });
    await settle();
    expect(ctx.room.core.activity.clocks[2]).toBeUndefined();
    expect(ctx.alarm.at).toBe(armed);
    for (const m of roomOf(ws.ann.messages()).members) expect(m).not.toHaveProperty("awayIn");
    await vi.advanceTimersByTimeAsync(3 * GRACE);
    expect(ctx.room.core.activity.kind).toBe("game");
    expect(game.calls.abandon).toEqual([]);
  });
});
