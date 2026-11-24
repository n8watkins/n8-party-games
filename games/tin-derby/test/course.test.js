// The data file, and the table built from it: the loop, the ground, the live kitchen's clocks.
import { describe, expect, it } from "vitest";
import { TUNE, retune } from "../data/tune.js";
import { DT, makeRules, rules } from "../shared/rules.js";
import { hash } from "../shared/course.js";

const T = TUNE, C = rules.course;

describe("the data file", () => {
  it("is plain data: it survives JSON unchanged", () => {
    expect(JSON.parse(JSON.stringify(TUNE))).toEqual(TUNE);
  });

  it("is frozen all the way down, so nothing can change a number while a race runs", () => {
    expect(Object.isFrozen(TUNE)).toBe(true);
    expect(Object.isFrozen(TUNE.TRACK[1])).toBe(true);
    expect(Object.isFrozen(TUNE.HABITS.gus)).toBe(true);
    expect(Object.isFrozen(TUNE.SUSAN.things[0])).toBe(true);
    expect(() => { "use strict"; TUNE.TOP_SPEED = 99; }).toThrow();
  });

  it("retune gives a changed, frozen copy and leaves the original alone", () => {
    const t = retune({ ASSIST: 0, NET: { DELAY: 0.3 }, SHAKERS: [] });
    expect(t.ASSIST).toBe(0);
    expect(t.NET.DELAY).toBe(0.3);
    expect(t.NET.QUEUE).toBe(TUNE.NET.QUEUE);
    expect(t.SHAKERS).toEqual([]);
    expect(TUNE.ASSIST).toBe(0.9);
    expect(Object.isFrozen(t.NET)).toBe(true);
  });

  it("the rules read their numbers from the copy they were built with", () => {
    const slow = makeRules(retune({ LAPS: 1, TOP_SPEED: 5 }));
    expect(slow.T.TOP_SPEED).toBe(5);
    expect(slow.createRace({ seed: 1 }).cars[0].cap).toBe(5);
    expect(rules.createRace({ seed: 1 }).cars[0].cap).toBe(T.TOP_SPEED);
  });

  it("every racer has a trait and every house habit a pace", () => {
    expect(Object.keys(T.TRAITS).sort()).toEqual(["ghost", "pawn", "robot", "slime"]);
    for (const h of Object.values(T.HABITS)) expect(h.pace).toBeGreaterThan(0.5);
    expect(T.ODDS).toHaveLength(4);
    for (const row of T.ODDS) expect(row).toHaveLength(T.ITEMS.length);
  });

  it("a table the rules cannot drive is refused when the rules are built, not in the middle of a race", () => {
    expect(() => makeRules(retune({ TRACK: [["S", 50], ["A", 10, 180], ["S", 50], ["A", 10, 180]] }))).toThrow(/bank/);
    expect(() => makeRules(retune({ DOMES: [{ name: "kicker", u: 31.5, lat: 0, ru: 2, rl: 2, h: 1, lip: 0.4 }] }))).toThrow(/lip/);
  });
});

describe("the loop", () => {
  it("comes back to where it began, facing the same way", () => {
    const end = C.trackAt(C.LEN - 1e-9), start = C.trackAt(0);
    expect(end.x).toBeCloseTo(start.x, 6);
    expect(Math.cos(end.th)).toBeCloseTo(1, 9);
    expect(C.LEN).toBeCloseTo(108 + 14 * Math.PI + 108 + 4.5 * Math.PI + 10 + 4.5 * Math.PI, 9);
  });

  // Round five's loop did not close: the bank is 28 across (radius 14) and its far end was 30 (9 + 12 + 9), so the
  // last corner ended 2 lengths outside the start of the home straight and a car was moved 2 across the road at the
  // seam. The west straight is 10 now (9 + 10 + 9 = 28).
  it("closes: the last piece ends exactly where the first begins", () => {
    const end = C.trackAt(C.LEN - 1e-9), start = C.trackAt(0);
    expect(end.x).toBeCloseTo(start.x, 6);
    expect(end.z).toBeCloseTo(start.z, 6);
    expect(Math.sin(end.th)).toBeCloseTo(Math.sin(start.th), 9);
  });

  it("moves nobody across the road at the seam: a point just before it and just after it are where locate says", () => {
    const out = {}, p = {};
    for (const lat of [-3, -1.5, 0, 1.5, 3]) {
      for (const u of [C.LEN - 0.5, C.LEN - 0.01, 0.01, 0.5]) {
        C.trackAt(u, lat, p);
        C.locate(p.x, p.z, u, out);
        expect(Math.abs(C.wrapS(out.u - u))).toBeLessThan(1e-6);
        expect(out.lat).toBeCloseTo(lat, 6);
      }
    }
  });

  it("locate undoes trackAt everywhere on the road, the seam included", () => {
    const out = {}, p = {};
    for (let k = 0; k < 4000; k++) {
      const u = hash(3, k) * C.LEN, lat = (hash(5, k) - 0.5) * 6;
      C.trackAt(u, lat, p);
      C.locate(p.x, p.z, u, out);
      expect(Math.abs(C.wrapS(out.u - u))).toBeLessThan(1e-6);
      expect(out.lat).toBeCloseTo(lat, 6);
    }
  });

  it("across the loop, + is the infield: the right-hand side of a right-hand lap", () => {
    const mid = C.trackAt(10, 0), right = C.trackAt(10, 1);
    // Heading +x; right is +z.
    expect(right.z - mid.z).toBeCloseTo(1, 9);
    expect(C.trackAt(120).turn).toBe(true);
    expect(C.trackAt(120).k).toBeGreaterThan(0);
  });

  it("narrows through the cereal box and widens round the shakers and the lazy Susan", () => {
    expect(C.halfAt(10)).toBe(T.HALF);
    expect(C.halfAt(T.TUNNEL.u)).toBe(T.TUNNEL.half);
    expect(C.halfAt(T.TUNNEL.u + T.TUNNEL.len / 2 + T.TUNNEL.funnel / 2)).toBeCloseTo((T.HALF + T.TUNNEL.half) / 2, 9);
    expect(C.halfAt(63)).toBe(5.0);
    expect(C.halfAt(178)).toBe(5.0);
    expect(C.halfAt(42)).toBeGreaterThan(T.HALF);
    expect(C.halfAt(42)).toBeLessThan(5.0);
    expect(C.sideLimit(10)).toBeCloseTo(T.HALF - T.CAR_W / 2, 12);
  });

  it("has one open edge, on the outside", () => {
    expect(C.EDGE_SIDE).toBe(-1);
    expect(C.onEdge(T.EDGE.u0 + 1)).toBe(true);
    expect(C.onEdge(T.EDGE.u0 - 1)).toBe(false);
    expect(C.onEdge(T.EDGE.u1 + 1)).toBe(false);
  });
});

describe("the ground", () => {
  it("is flat cloth on the straights and rises on each set piece", () => {
    expect(C.groundAt(10, 0)).toBe(0);
    expect(C.groundAt(26.5, 0)).toBeCloseTo(0.6, 9); // the bread board, part way up
    expect(C.groundAt(28.19, 0)).toBeGreaterThan(1.29);
    expect(C.groundAt(28.3, 0)).toBe(0); // off its end: the jump
    expect(C.groundAt(26.5, 2)).toBe(0); // beside it
    expect(C.groundAt(31.5, 0)).toBeCloseTo(1.0, 9); // the butter dish's top
    expect(C.groundAt(159, 0)).toBe(1.5); // the tall pancake stack
    expect(C.groundAt(162.5, 0)).toBe(1.0);
    expect(C.groundAt(165.5, 0)).toBe(0.5);
    expect(C.groundAt(215, -2.7)).toBe(0.5); // the knife bridge
    expect(C.groundAt(178, 0)).toBe(T.SUSAN.h);
  });

  it("the bank leans in: the outside of the turn is higher than the inside", () => {
    const mid = (C.TAG.bank.u0 + C.TAG.bank.u1) / 2;
    expect(C.bankAt(mid)).toBe(1);
    expect(C.groundAt(mid, -3)).toBeGreaterThan(C.groundAt(mid, 3) + 1.5);
    expect(C.bankAt(50)).toBe(0);
  });

  it("the toast is on the road only while the race says so", () => {
    const u = T.TOASTER.land, lat = 1;
    expect(C.groundAt(u, lat, null)).toBe(0);
    expect(C.groundAt(u, lat, { toast: 0 })).toBe(0);
    expect(C.groundAt(u, lat, { toast: 1 })).toBeGreaterThan(0.2);
    expect(C.groundAt(u, T.TOASTER.lat0 - 0.5, { toast: 1 })).toBe(0);
  });
});

describe("the live kitchen's clocks", () => {
  it("the kettle whistles, then blows, then rests, every period, from the start", () => {
    const K = T.KETTLE;
    expect(C.steamAt(0.1)).toBe(1);
    expect(C.steamAt(K.warn + 0.1)).toBe(2);
    expect(C.steamAt(K.warn + K.blow + 0.1)).toBe(0);
    expect(C.steamAt(K.period + 0.1)).toBe(1);
  });

  it("the toaster, the egg and the syrup stay quiet through the first lap (ARM_T)", () => {
    expect(C.ARM_TAU).toBe(T.ARM_T + T.COUNT_IN);
    for (let tau = 0; tau < C.ARM_TAU - 0.01; tau += 0.25) {
      expect(C.toasterAt(tau).k).toBe(0);
      expect(C.eggAt(tau).stage).toBe("cup");
      expect(C.syrupAt(tau).stage).toBe("idle");
      expect(C.spillAt(T.SYRUP.u, T.SYRUP.lat, tau)).toBe(null);
    }
  });

  it("once armed, each goes through its stages in order, with a warning first", () => {
    const stages = (at, name) => { const seen = []; for (let tau = C.ARM_TAU; tau < C.ARM_TAU + 40; tau += DT) { const s = at(tau).stage; if (seen[seen.length - 1] !== s) seen.push(s); } return seen.join(" ").includes(name); };
    expect(stages(C.toasterAt, "warn fly lie gone idle")).toBe(true);
    expect(stages(C.eggAt, "warn roll stop cup")).toBe(true);
    expect(stages(C.syrupAt, "warn grow stay dry idle")).toBe(true);
  });

  it("the egg rolls from its cup on the infield right across the road", () => {
    const E = T.EGG;
    let tau = C.ARM_TAU;
    while (C.eggAt(tau).stage !== "roll") tau += DT;
    expect(C.eggAt(tau).lat).toBeCloseTo(E.from, 1);
    while (C.eggAt(tau).stage === "roll") tau += DT;
    expect(C.eggAt(tau).stage).toBe("stop");
    expect(C.eggAt(tau).lat).toBe(E.to);
  });

  it("the syrup patch is a spill only while it is on the road", () => {
    let tau = C.ARM_TAU;
    while (C.syrupAt(tau).stage !== "stay") tau += DT;
    expect(C.spillAt(T.SYRUP.u, T.SYRUP.lat, tau)).toMatchObject({ name: "syrup", does: "slow" });
    expect(C.spillAt(T.SYRUP.u, T.SYRUP.lat + T.SYRUP.r + 0.1, tau)).toBe(null);
  });

  it("the spills on the cloth are always there, each doing its one thing", () => {
    expect(T.SPILLS.map((s) => `${s.name}:${s.does}`)).toEqual(["salt:slide", "oatmeal:spin", "tea:slide"]);
    for (const s of T.SPILLS) {
      expect(C.spillAt(s.u, s.lat)).toBe(s);
      expect(C.spillAt(s.u, s.lat - s.rl - 0.2)).toBe(null);
    }
  });

  it("the jars ride the lazy Susan round its middle", () => {
    const S = T.SUSAN, a = C.susanThings(0, []), b = C.susanThings(Math.PI / S.spin, []);
    expect(a).toHaveLength(2);
    for (const th of a) expect(Math.hypot(th.x - C.SUSAN_AT.x, th.z - C.SUSAN_AT.z)).toBeCloseTo(3.0, 9);
    // Half a turn later each jar is where the other was.
    expect(b[0].x).toBeCloseTo(a[1].x, 9);
    expect(b[0].z).toBeCloseTo(a[1].z, 9);
  });

  it("cherries are planned from the seed alone: the same seed, the same cherries", () => {
    expect(C.cherryPlan(42, 3)).toEqual(C.cherryPlan(42, 3));
    expect(C.cherryPlan(42, 3)).not.toEqual(C.cherryPlan(43, 3));
    for (let n = 0; n < 30; n++) {
      const p = C.cherryPlan(42, n);
      expect(p.u).toBeGreaterThan(C.TAG.bank.u0);
      expect(p.u).toBeLessThan(C.TAG.bank.u1);
      expect(p.at).toBeGreaterThanOrEqual(2 + n * T.CHERRY.every);
      expect(p.lat).toBeGreaterThan(0); // the inside of the bank, under the bowl's rim
    }
  });
});

describe("what the drivers read", () => {
  it("blockers lists the shakers and spills, and with a race, what moves", () => {
    const bare = C.blockers(null, []);
    expect(bare.filter((b) => b[3] === "shaker")).toHaveLength(3);
    expect(bare.filter((b) => b[3] === "spill")).toHaveLength(3);
    const race = rules.createRace({ seed: 1 });
    race.drops.push({ k: "butter", id: 1, x: 0, z: 0, u: 20, lat: 1, y: 0, life: 5, by: 0, safe: 0 });
    const live = C.blockers(race, []);
    expect(live.some((b) => b[3] === "jam")).toBe(true);
    expect(live.some((b) => b[3] === "honey")).toBe(true);
    expect(live.some((b) => b[3] === "butter")).toBe(true);
  });

  it("clearLane moves a line out of what blocks it, to the nearer free side, and leaves a free line alone", () => {
    const list = [[50, -1.5, 1.5, "shaker", 1.6, 0]];
    expect(C.clearLane(list, 45, 3, 6, 4)).toBe(3);
    expect(C.clearLane(list, 45, 0.5, 6, 4)).toBeCloseTo(1.9, 9);
    expect(C.clearLane(list, 45, -0.5, 6, 4)).toBeCloseTo(-1.9, 9);
    expect(C.clearLane(list, 20, 0.5, 6, 4)).toBe(0.5); // too far ahead to matter yet
    expect(C.clearLane(list, 45, 0.5, 6, 1.7)).toBe(0.5); // no room either side: hold the line
  });

  it("clearAhead says whether a stretch is free of things to hit", () => {
    expect(C.clearAhead(null, 100, 20)).toBe(true);
    expect(C.clearAhead(null, 40, 20)).toBe(false); // the first shaker
  });
});
