// Presence during a turn-based game, the plain logic (party-kit/src/core/presence.js): what a page
// says, who is away, what a game is told, when a seat is gone for good, what presence and abandon
// give back, and the room's lifetimes for a game.
import { describe, expect, it } from "vitest";
import * as cork from "cork-and-bell";
import { game as coinFlip } from "../../lobby/games/coin-flip.js";
import {
  abandonOutcome,
  absenceClock,
  allAway,
  clockEndsAt,
  goneWhy,
  graceEndsAt,
  graceOf,
  graceUsed,
  isClock,
  lifetimesOf,
  presenceOutcome,
  presenceProblems,
  presenceSignal,
  reportOf,
  sameReport,
  trackAbsence,
} from "../src/core/presence.js";
import { gameProblems } from "../src/core/turns.js";

describe("what a page says", () => {
  it("is away or back, and nothing else is a presence signal", () => {
    expect(presenceSignal({ t: "away" })).toBe(true);
    expect(presenceSignal({ t: "back" })).toBe(false);
    for (const msg of [{ t: "in" }, {}, null, undefined, "away"]) expect(presenceSignal(msg)).toBeNull();
  });

  it("is away only when every open socket of the player is hidden", () => {
    expect(allAway([{ away: true }, { away: true }])).toBe(true);
    expect(allAway([{ away: true }, { away: false }])).toBe(false);
    expect(allAway([{ away: true }, {}])).toBe(false);
    // No socket at all is not away: it is not connected.
    expect(allAway([])).toBe(false);
  });
});

describe("what a game is told", () => {
  it("is connected and away, and a player who is not connected is never away", () => {
    expect(reportOf({ connected: true })).toEqual({ connected: true, away: false });
    expect(reportOf({ connected: true, away: true })).toEqual({ connected: true, away: true });
    expect(reportOf({ connected: false, away: true })).toEqual({ connected: false, away: false });
    expect(reportOf(null)).toEqual({ connected: false, away: false });
    expect(sameReport({ connected: true, away: false }, { connected: true, away: false })).toBe(true);
    expect(sameReport({ connected: true, away: false }, { connected: true, away: true })).toBe(false);
    expect(sameReport(undefined, { connected: true, away: false })).toBe(false);
  });
});

describe("when a seat is gone for good", () => {
  const dropped = (at) => ({ connected: false, droppedAt: at });
  it("is at once when its player left, and when a dropped phone's grace has run out", () => {
    expect(goneWhy(null, 0, 1000)).toBe("left");
    expect(goneWhy(dropped(0), 999, 1000)).toBeNull();
    expect(goneWhy(dropped(0), 1000, 1000)).toBe("gone");
    expect(goneWhy(dropped(0), 1e15, Infinity)).toBeNull();
    // Without a clock (a room class that keeps none) a phone that is here, away or not, is never gone.
    expect(goneWhy({ connected: true, droppedAt: null }, 1e15, 0)).toBeNull();
    expect(goneWhy({ connected: true, away: true, droppedAt: null }, 1e15, 0)).toBeNull();
    expect(graceEndsAt(dropped(500), 1000)).toBe(1500);
    expect(graceEndsAt(dropped(500), Infinity)).toBeNull();
    expect(graceEndsAt({ connected: true, droppedAt: null }, 1000)).toBeNull();
    expect(graceEndsAt(null, 1000)).toBeNull();
  });

  it("with a clock, is when the seat has been missing (dropped or away) for the whole grace", () => {
    const away = { connected: true, away: true, droppedAt: null };
    const clock = trackAbsence(absenceClock(), true, 1000);
    expect(goneWhy(away, 60_999, 60_000, clock)).toBeNull();
    expect(goneWhy(away, 61_000, 60_000, clock)).toBe("gone");
    expect(graceEndsAt(away, 60_000, clock)).toBe(61_000);
    // An endless grace never ends; a seat that is here has no end; one that left is gone whatever its clock says.
    expect(goneWhy(away, 1e15, Infinity, clock)).toBeNull();
    expect(graceEndsAt(away, Infinity, clock)).toBeNull();
    const here = trackAbsence(clock, false, 2000);
    expect(goneWhy({ connected: true, droppedAt: null }, 1e15, 60_000, here)).toBeNull();
    expect(goneWhy(null, 0, 60_000, clock)).toBe("left");
  });
});

describe("a seat's grace clock", () => {
  const GRACE = 60_000;
  it("runs while the seat is missing and stops when it is back, keeping what it used", () => {
    let c = absenceClock();
    expect(clockEndsAt(c, GRACE)).toBeNull();
    c = trackAbsence(c, true, 10_000);
    expect(clockEndsAt(c, GRACE)).toBe(70_000);
    expect(graceUsed(c, 40_000)).toBe(30_000);
    // Told again that it is missing: the same clock, not a fresh one.
    expect(trackAbsence(c, true, 50_000)).toBe(c);
    c = trackAbsence(c, false, 69_000);
    expect(clockEndsAt(c, GRACE)).toBeNull();
    expect(graceUsed(c, 69_000)).toBe(59_000);
  });

  it("winds back up while the seat is back at the speed it ran, so blinking in and out does not start it over", () => {
    // Hidden 50 s, shown 2 s, hidden again: 8 s left, plus the 2 s it won back.
    let c = trackAbsence(absenceClock(), true, 0);
    c = trackAbsence(c, false, 50_000);
    c = trackAbsence(c, true, 52_000);
    expect(clockEndsAt(c, GRACE)).toBe(52_000 + 12_000);
    // Hidden a second, shown a tenth of one, again and again: the grace still runs out, within 80 seconds.
    let d = trackAbsence(absenceClock(), true, 0);
    let t = 0;
    while (clockEndsAt(d, GRACE) > t + 1000) {
      t += 1000;
      d = trackAbsence(d, false, t);
      t += 100;
      d = trackAbsence(d, true, t);
    }
    expect(t).toBeGreaterThan(GRACE);
    expect(t).toBeLessThan(80_000);
    // Back for as long as it was missing: the whole grace again.
    let e = trackAbsence(absenceClock(), true, 0);
    e = trackAbsence(e, false, 40_000);
    e = trackAbsence(e, true, 80_000);
    expect(clockEndsAt(e, GRACE)).toBe(80_000 + GRACE);
  });

  it("starts from when a phone dropped, never before its own last change, and a fresh clock has the whole grace", () => {
    expect(trackAbsence(absenceClock(), true, 5000, 2000).since).toBe(2000);
    const back = trackAbsence(trackAbsence(absenceClock(), true, 0), false, 3000);
    expect(trackAbsence(back, true, 5000, 1000).since).toBe(3000);
    expect(clockEndsAt(trackAbsence(absenceClock(9000), true, 9000), GRACE)).toBe(9000 + GRACE);
  });

  it("reads back from storage only in its own shape", () => {
    expect(isClock(absenceClock())).toBe(true);
    expect(isClock(trackAbsence(absenceClock(), true, 1))).toBe(true);
    for (const bad of [null, {}, { since: "now", used: 0, at: 0 }, { since: null, used: 0 }]) expect(isClock(bad)).toBe(false);
  });

  it("takes the game's grace, or the room's when the game chooses none", () => {
    expect(graceOf({ reconnectGraceMs: 30_000 }, 120_000)).toBe(30_000);
    expect(graceOf({ reconnectGraceMs: Infinity }, 120_000)).toBe(Infinity);
    expect(graceOf({ reconnectGraceMs: 0 }, 120_000)).toBe(0);
    expect(graceOf({}, 120_000)).toBe(120_000);
    expect(graceOf({ reconnectGraceMs: "soon" }, 120_000)).toBe(120_000);
  });
});

describe("what presence and abandon give back", () => {
  it("presence: nothing, false or null is no change; true, a list or an object is", () => {
    for (const nothing of [undefined, null, false, 0, "yes"]) expect(presenceOutcome(nothing)).toEqual({ changed: false, events: [] });
    expect(presenceOutcome(true)).toEqual({ changed: true, events: [] });
    expect(presenceOutcome([{ k: "away", seat: 1 }])).toEqual({ changed: true, events: [{ k: "away", seat: 1 }] });
    expect(presenceOutcome({ events: [{ k: "x" }] })).toEqual({ changed: true, events: [{ k: "x" }] });
    expect(presenceOutcome({ changed: false })).toEqual({ changed: false, events: [] });
    expect(presenceOutcome({})).toEqual({ changed: true, events: [] });
  });

  it("abandon: nothing is an end with no points; an object may carry standings, a result and events", () => {
    for (const nothing of [undefined, null, false, [{ seat: 0, place: 1 }]]) expect(abandonOutcome(nothing)).toEqual({ standings: [], result: null, events: [] });
    expect(abandonOutcome({ standings: [{ seat: 0, place: 1 }], result: { winner: 0 }, events: [{ k: "gone" }] })).toEqual({ standings: [{ seat: 0, place: 1 }], result: { winner: 0 }, events: [{ k: "gone" }] });
    expect(abandonOutcome({ standings: "first", events: "x" })).toEqual({ standings: [], result: null, events: [] });
  });
});

describe("the room's lifetimes for a game", () => {
  const defaults = { idleShutdownMs: 60_000, staleRoomMs: 1_200_000 };
  it("are the game's own when it chooses them, and the room's otherwise", () => {
    expect(lifetimesOf({ idleShutdownMs: 3_600_000, staleRoomMs: 3_600_000 }, defaults)).toEqual({ idleShutdownMs: 3_600_000, staleRoomMs: 3_600_000 });
    expect(lifetimesOf({ staleRoomMs: 3_600_000 }, defaults)).toEqual({ idleShutdownMs: 60_000, staleRoomMs: 3_600_000 });
    expect(lifetimesOf(cork.game, defaults)).toEqual(defaults);
    expect(lifetimesOf({ idleShutdownMs: Infinity, staleRoomMs: -1 }, defaults)).toEqual(defaults);
  });
});

describe("what makes the presence fields wrong", () => {
  it("finds nothing wrong with the games on the wall, or with Who Am I?'s fields", () => {
    expect(presenceProblems(cork.game)).toEqual([]);
    expect(presenceProblems(coinFlip)).toEqual([]);
    expect(presenceProblems({ reconnectGraceMs: Infinity, idleShutdownMs: 3_600_000, staleRoomMs: 3_600_000, presence: () => true, abandon: () => null })).toEqual([]);
  });

  it("says what does not fit, and gameProblems says it too", () => {
    expect(presenceProblems({ reconnectGraceMs: -1 })).toEqual(["reconnectGraceMs is a number of milliseconds, 0 or more (Infinity: while the room lives)."]);
    expect(presenceProblems({ reconnectGraceMs: NaN })).toHaveLength(1);
    expect(presenceProblems({ idleShutdownMs: Infinity })).toEqual(["idleShutdownMs is a number of milliseconds, more than 0."]);
    expect(presenceProblems({ staleRoomMs: 0 })).toEqual(["staleRoomMs is a number of milliseconds, more than 0."]);
    expect(presenceProblems({ presence: true, abandon: "x" })).toEqual(["presence, when given, is a function.", "abandon, when given, is a function."]);
    const game = { create: () => ({}), input: () => {}, snapshot: () => ({}), isOver: () => false, tickHz: 0, abandon: 1 };
    expect(gameProblems(game)).toEqual(["abandon, when given, is a function."]);
  });
});
