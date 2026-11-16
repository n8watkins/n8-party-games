// Whole seeded races, start to finish, with the preview's scripted drivers in the seats and house cars in the rest;
// and the preview's balance targets, as assertions.
import { describe, expect, it } from "vitest";
import { rules } from "../shared/rules.js";
import { runRace, tally } from "../tools/race.mjs";

const T = rules.T;
const LONG = 180_000;

/** What must hold in every race, whoever drives. */
function sound(r, label) {
  expect(r.bad, label).toBe("");
  expect(r.over, label).toBe(true);
  expect(r.outside, `${label}: frames with a car outside a wall`).toBe(0);
  expect(r.stuck, `${label}: the longest any car was below walking pace`).toBeLessThan(3);
  expect(r.state.t, label).toBeLessThanOrEqual(T.RACE_CAP + 0.01);
}

describe("whole races", () => {
  const FIELDS = [
    [{ style: "plain", character: "pawn" }],
    [{ style: "sloppy", character: "ghost" }],
    [{ style: "plain", character: "slime" }, { style: "sloppy", character: "robot" }],
    [{ style: "sloppy", character: "robot" }, { style: "handsoff", character: "pawn" }, { style: "plain", character: "ghost" }],
    [{ style: "plain", character: "ghost", touch: true }, { style: "clean", character: "pawn" }, { style: "sloppy", character: "slime", touch: true }, { style: "left", character: "robot" }],
    [{ style: "right", character: "pawn" }, { style: "plain", character: "pawn" }, { style: "plain", character: "pawn" }, { style: "sloppy", character: "pawn" }],
  ];

  it("one to four players, every kind of driver and racer: every car gets home, nobody is stuck, nobody leaves the road", () => {
    for (const [k, humans] of FIELDS.entries()) for (const seed of [11 + k, 3_000_000_011 + k]) {
      const r = runRace(rules, { seed, humans }), label = `${humans.length} players, seed ${seed}`;
      sound(r, label);
      // Every player gets home. (A house car still out a few seconds after the last player is left where it is.)
      expect(r.times.every((time) => time !== null), `${label}: ${r.field}`).toBe(true);
      if (!r.allFinished) expect(r.state.t).toBeCloseTo(r.state.homeAt + T.HOUSE_GRACE, 1);
      // Four cars always: house cars fill the empty seats.
      expect(r.state.cars).toHaveLength(4);
      expect(r.state.cars.filter((c) => c.house)).toHaveLength(4 - humans.length);
      // The result: every seat once, best first, places from 1, a time for each.
      const result = rules.game.result(r.state);
      expect(result.map((row) => row.seat).sort()).toEqual(humans.map((h, i) => i));
      expect(result.map((row) => row.place)).toEqual(humans.map((h, i) => i + 1));
      expect(result.map((row) => row.time)).toEqual(result.map((row) => row.time).slice().sort((a, b) => a - b));
      for (const row of result) { expect(row.time).toBeGreaterThan(40); expect(row.time).toBeLessThan(T.RACE_CAP); }
      expect(rules.game.standings(r.state)).toEqual(result.map(({ seat, place }) => ({ seat, place })));
    }
  }, LONG);

  it("seat numbers are the room's: they may have gaps and come in any order", () => {
    const r = runRace(rules, { seed: 5, humans: [{ style: "plain", seat: 3 }, { style: "sloppy", seat: 1 }] });
    sound(r, "seats 3 and 1");
    expect(rules.game.result(r.state).map((row) => row.seat).sort()).toEqual([1, 3]);
  }, LONG);

  it("a race of two laps takes about a minute, and the kitchen is busy in it", () => {
    const r = runRace(rules, { seed: 21, humans: [{ style: "plain" }] });
    expect(r.times[0]).toBeGreaterThan(50);
    expect(r.times[0]).toBeLessThan(75);
    for (const k of ["start", "lap", "finish", "lastcall", "end", "pad", "leap", "land", "item", "use", "cherry", "kettle", "toaster", "eggwarn", "syrupwarn"]) expect(r.events[k], k).toBeGreaterThan(0);
    expect(r.events.finish).toBe(r.state.order.length);
    expect(r.events.lastcall).toBe(1);
    expect(r.events.start).toBe(1);
    expect(r.events.end).toBe(1);
  }, LONG);
});

// A short check each test run. The full sweep (120 races a style) is `node tools/race.mjs all 120`; README.md has its figures.
describe("balance: round five's targets", () => {
  const RACES = 16;

  it("a plain driver is in the top two in at least 80% of races, and always gets home", () => {
    const t = tally(rules, "plain", RACES);
    for (const r of t.rows) sound(r, `plain, seed ${r.seed}`);
    expect(t.finished).toBe(RACES);
    expect(t.places[0] + t.places[1], `places 1st to 4th: ${t.places.join(" / ")}`).toBeGreaterThanOrEqual(RACES * 0.8);
  }, LONG);

  it("a car nobody steers is never in the top two, and still gets home", () => {
    const t = tally(rules, "handsoff", RACES);
    for (const r of t.rows) sound(r, `hands off, seed ${r.seed}`);
    expect(t.finished).toBe(RACES);
    expect(t.places[0] + t.places[1], `places 1st to 4th: ${t.places.join(" / ")}`).toBe(0);
  }, LONG);

  it("a first-timer is mostly second or third, and last in at most a fifth of races", () => {
    const t = tally(rules, "sloppy", RACES);
    for (const r of t.rows) sound(r, `sloppy, seed ${r.seed}`);
    expect(t.finished).toBe(RACES);
    expect(t.places[3], `places 1st to 4th: ${t.places.join(" / ")}`).toBeLessThanOrEqual(RACES * 0.2);
    expect(t.places[1] + t.places[2], `places 1st to 4th: ${t.places.join(" / ")}`).toBeGreaterThanOrEqual(RACES * 0.5);
  }, LONG);

});
