// A short soak: races driven by hands that make no sense, and a race that never ends, checked for numbers that
// are not numbers, cars outside the walls, and a race that grows. (Short on purpose: a smoke check each test run.)
import { describe, expect, it } from "vitest";
import { hash, rules } from "../shared/rules.js";

const T = rules.T, C = rules.course;
const LONG = 180_000;

function sane(st, label) {
  for (const c of st.cars) {
    for (const k of rules.CAR_KEYS) if (typeof c[k] === "number") expect(Number.isFinite(c[k]), `${label}: ${c.name}'s ${k} is ${c[k]}`).toBe(true);
    if (c.fallT <= 0 && !(c.lat < 0 && C.onEdge(c.u))) expect(Math.abs(c.lat), `${label}: ${c.name} outside a wall at u ${c.u}`).toBeLessThanOrEqual(C.sideLimit(c.u) + 0.02);
  }
}

describe("smoke", () => {
  it("four players mashing every button at random: nothing breaks, and the cap ends the race", () => {
    for (const seed of [1, 2, 3]) {
      const st = rules.createRace({ seed, seats: [0, 1, 2, 3].map((seat) => ({ seat, name: `P${seat}`, character: ["pawn", "ghost", "slime", "robot"][seat] })), now: 0, delay: 0 });
      let biggest = 0;
      for (let f = 1; !st.over && f < 60 * (T.RACE_CAP + T.COUNT_IN + 5); f++) {
        const now = (f * 1000) / 60;
        for (let seat = 0; seat < 4; seat++) {
          const r = hash(seed * 31 + seat, f);
          // Seat 0 mostly drives; the others hold whatever comes up, backwards included, for a random while.
          if (hash(seed + seat, Math.floor(f / (5 + seat * 20))) < 0.5) rules.takeInput(st, seat, { c: [now, Math.round((hash(seat, f) * 2 - 1) * 16) / 16, seat === 0 || r > 0.3 ? 1 : 0, r < 0.15 ? 1 : 0, r > 0.6 ? 1 : 0, r > 0.9 ? 1 : 0] }, now);
        }
        rules.advance(st, rules.stepOf(st, now));
        st.ev.length = 0;
        if (f % 30 === 0) { sane(st, `seed ${seed}, frame ${f}`); biggest = Math.max(biggest, JSON.stringify(rules.dump(st)).length); }
      }
      expect(st.over).toBe(true);
      expect(st.t).toBeLessThanOrEqual(T.RACE_CAP + 0.01);
      expect(biggest).toBeLessThan(6000);
      expect(rules.game.result(st)).toHaveLength(4);
    }
  }, LONG);

  it("a race that never ends (the attract race) stays the same size for ten minutes, and no house car is ever stuck", () => {
    const st = rules.createRace({ seed: 12, seats: [], now: 0, delay: 0, endless: true });
    expect(st.cars.every((c) => c.house)).toBe(true);
    const sizes = [];
    for (let sec = 1; sec <= 600; sec++) {
      rules.advance(st, sec * 120);
      st.ev.length = 0;
      if (sec % 20 === 0) { sane(st, `second ${sec}`); sizes.push(JSON.stringify(rules.dump(st)).length); }
    }
    expect(st.over).toBe(false);
    expect(Math.max(...sizes)).toBeLessThan(6000);
    expect(st.queue).toHaveLength(0);
    expect(st.cherries.length).toBeLessThanOrEqual(T.CHERRY.max);
    for (const c of st.cars) { expect(c.lap, c.name).toBeGreaterThanOrEqual(12); expect(st.stats[c.i].stuck, c.name).toBeLessThan(3); }
  }, LONG);
});
