// The clock a room's timed events go by (lobby/public/look3d/clock.js): every device in a room
// must work out the same owl at the same moment from nothing but the room's age and its code.
import { describe, expect, it } from "vitest";
import { chance, nextStart, occurrence, roomAge, seedOf } from "../public/look3d/clock.js";

const owl = { every: 43, lasts: 7 };

describe("the room's clock", () => {
  it("is how long the room has been open, from what the room view already says", () => {
    expect(roomAge({ closesIn: 4 * 3600_000 })).toBe(0);
    expect(roomAge({ closesIn: 4 * 3600_000 - 90_000 })).toBe(90);
  });

  it("gives the same numbers for the same seed, and different ones for another room", () => {
    const a = seedOf("4827");
    expect(seedOf("4827")).toBe(a);
    expect(seedOf("4828")).not.toBe(a);
    expect(chance(a, 3, 9)).toBe(chance(a, 3, 9));
    expect(chance(a, 3, 9)).not.toBe(chance(seedOf("4828"), 3, 9));
    for (let i = 0; i < 200; i++) {
      const c = chance(a, i, i * 7);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(1);
    }
  });

  it("has each thing come once in every stretch, whole, and at the same moment for everyone", () => {
    const seed = seedOf("4827");
    for (let n = 0; n < 50; n++) {
      const start = nextStart(owl, 2, n * owl.every, seed);
      expect(start).toBeGreaterThanOrEqual(n * owl.every);
      // It never runs over the end of its stretch, so two of the same thing never overlap.
      expect(start + owl.lasts).toBeLessThanOrEqual((n + 1) * owl.every + 1e-9);
      // Two devices a quarter of a second apart are looking at the same owl, a little further along.
      const here = occurrence(owl, 2, start + 3, seed);
      const there = occurrence(owl, 2, start + 3.25, seed);
      expect(here.n).toBe(there.n);
      expect(here.r).toBe(there.r);
      expect(here.u).toBeCloseTo(3 / owl.lasts);
      expect(there.u).toBeGreaterThan(here.u);
    }
  });

  it("has nothing in the air before a thing starts or after it has gone", () => {
    const seed = seedOf("4827");
    const start = nextStart(owl, 2, 1000, seed);
    expect(occurrence(owl, 2, start - 0.01, seed)).toBeNull();
    expect(occurrence(owl, 2, start + owl.lasts + 0.01, seed)).toBeNull();
    expect(occurrence(owl, 2, start + 0.01, seed)).not.toBeNull();
  });

  it("does not march different things in step", () => {
    const seed = seedOf("4827");
    const a = nextStart(owl, 2, 0, seed);
    const b = nextStart(owl, 3, 0, seed);
    expect(a).not.toBe(b);
  });
});
