// Every rule of the race, one at a time: a car is put where the rule bites and the steps are run.
import { describe, expect, it } from "vitest";
import { retune } from "../data/tune.js";
import { makeRules, rules } from "../shared/rules.js";
import { wrapA } from "../shared/dmath.js";
import { BTN, DT, GO, of, stage } from "./stage.js";

const T = rules.T, C = rules.course;
const TWO = [{ seat: 0, name: "Ann", character: "robot" }, { seat: 1, name: "Bo", character: "robot" }];
const two = (a = "robot", b = "robot", more = {}) => stage({ seats: [{ seat: 0, name: "Ann", character: a }, { seat: 1, name: "Bo", character: b }], ...more });
/** How far off the road's direction a car points. */
const off = (c) => wrapA(c.h - C.trackAt(c.u, 0, {}).th);

describe("the start", () => {
  it("lines four cars up behind the line, two by two, players first and house cars after", () => {
    const st = rules.createRace({ seed: 5, seats: [{ seat: 2, name: "Ann", colour: "#123456" }, { seat: 0, name: "Bo" }] });
    expect(st.cars.map((c) => [c.seat, c.house, c.name])).toEqual([[2, false, "Ann"], [0, false, "Bo"], [-1, true, "Pip"], [-2, true, "Gus"]]);
    expect(st.cars[0].colour).toBe("#123456");
    for (const c of st.cars) { expect(c.u).toBeLessThan(T.LINE_U); expect(c.s).toBeLessThan(0); expect(c.v).toBe(0); }
    expect(new Set(st.cars.map((c) => `${c.u},${c.lat}`)).size).toBe(4);
  });

  it("gives house cars the racers nobody chose, and an unknown racer the pawn's trait", () => {
    const solo = rules.createRace({ seed: 5, seats: [{ seat: 0, name: "Ann", character: "slime" }] });
    expect(solo.cars.map((c) => c.trait)).toEqual(["slime", "pawn", "ghost", "robot"]);
    const odd = rules.createRace({ seed: 5, seats: [{ seat: 0, name: "Ann", character: "dragon" }] });
    expect(odd.cars[0].trait).toBe("pawn");
    const full = rules.createRace({ seed: 5, seats: [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, name: `P${seat}` })) });
    expect(full.cars).toHaveLength(4);
    expect(full.cars.every((c) => !c.house)).toBe(true);
  });

  it("holds every car through the count-in, then says go", () => {
    const s = stage({ tau: 1, park: false });
    for (const c of s.cars) c.inB = GO;
    const x0 = s.me.x;
    const before = s.run(T.COUNT_IN - 1 - 0.01);
    expect(s.st.t).toBeLessThan(0);
    expect(s.cars.every((c) => c.v === 0)).toBe(true);
    expect(s.me.x).toBe(x0);
    expect(of(before, "start")).toHaveLength(0);
    const after = s.run(0.5);
    expect(of(after, "start")).toHaveLength(1);
    expect(s.me.v).toBeGreaterThan(2);
  });
});

describe("driving", () => {
  it("picks up speed to its top speed and no further", () => {
    const s = stage();
    s.place(s.me, 206, 2.5, 0);
    s.run(1);
    expect(s.me.v).toBeGreaterThan(5);
    expect(s.me.v).toBeLessThan(T.TOP_SPEED);
    s.run(2.5);
    expect(s.me.v).toBe(T.TOP_SPEED);
  });

  it("brakes hard, then backs up slowly; coasts down with nothing held", () => {
    const s = stage();
    s.place(s.me, 206, 2.5, T.TOP_SPEED, { b: BTN.BRAKE });
    s.run(0.25);
    expect(s.me.v).toBeCloseTo(T.TOP_SPEED - T.BRAKE * 0.25, 1);
    s.run(3);
    expect(s.me.v).toBe(-T.REVERSE);
    const k = stage();
    k.place(k.me, 206, 2.5, 6, { b: 0 });
    k.run(1);
    expect(k.me.v).toBeCloseTo(6 - T.COAST, 1);
  });

  it("steers: a tap is a small correction, a hold a full turn, and the wheel springs back", () => {
    const s = stage();
    s.place(s.me, 206, 0, 6, { steer: 0 });
    s.me.inSt = 1;
    s.run(0.1);
    expect(s.me.st).toBeCloseTo(T.STEER_IN * 0.1, 2);
    s.run(0.5);
    expect(s.me.st).toBe(1);
    expect(off(s.me)).toBeGreaterThan(0.3); // + is right
    expect(s.me.lat).toBeGreaterThan(0.2);
    s.me.inSt = 0;
    s.run(0.11);
    expect(s.me.st).toBe(0);
  });

  it("turns less sharply at speed than at a crawl", () => {
    const turn = (v) => { const s = stage(); s.place(s.me, 206, 0, v, { steer: 1, b: 0 }); s.rules.hold(s.me, 1, 0); const h0 = s.me.h; s.run(0.1); return Math.abs(wrapA(s.me.h - h0)); };
    expect(turn(3)).toBeGreaterThan(turn(9.5) * 1.3);
  });

  it("with hands off the wheel, eases back to the way the road runs", () => {
    const s = stage();
    s.place(s.me, 206, 0, 8, { side: 0.4 });
    s.run(2.5);
    expect(Math.abs(off(s.me))).toBeLessThan(0.03);
    const none = stage({ rules: makeRules(retune({ ASSIST: 0 })) });
    none.place(none.me, 206, 0, 8, { side: 0.4 });
    const ev = none.run(1.5);
    expect(of(ev, "wall").length).toBeGreaterThan(0);
  });

  it("a boost pad winds the car up as it crosses it", () => {
    const s = stage();
    s.place(s.me, 18.6, 0, T.TOP_SPEED);
    const ev = s.run(0.4);
    expect(of(ev, "pad", 0)).toHaveLength(1);
    expect(s.me.boostKind).toBe("pad");
    expect(s.me.v).toBeGreaterThan(T.TOP_SPEED * 1.1);
    expect(s.me.cap).toBeCloseTo(T.TOP_SPEED * T.BOOST, 9);
    expect(s.stats[0].pads).toBe(1);
    // A pad beside the car's line does nothing.
    const miss = stage();
    miss.place(miss.me, 18.6, 2.6, T.TOP_SPEED);
    expect(of(miss.run(0.4), "pad")).toHaveLength(0);
  });

  it("a drift held through a turn charges a small boost, and a longer one a big boost", () => {
    const s = stage();
    s.place(s.me, 112, -2, 9, { steer: 1, b: GO | BTN.DRIFT });
    let ev = s.run(T.DRIFT_1 * T.TRAITS.pawn.miniK + 0.2);
    expect(of(ev, "drift", 0)).toHaveLength(1);
    expect(of(ev, "charge", 0).map((e) => e.lvl)).toEqual([1]);
    s.me.inB = GO;
    ev = s.run(0.05);
    expect(of(ev, "mini", 0).map((e) => e.lvl)).toEqual([1]);
    expect(s.me.boostT).toBeCloseTo(T.MINI_1 * T.TRAITS.pawn.miniK, 1); // the pawn's drawback: a little shorter
    expect(s.me.drOn).toBe(false);

    const big = stage({ character: "slime" });
    big.place(big.me, 112, -2, 9, { steer: 1, b: GO | BTN.DRIFT });
    big.run(0.1);
    big.me.inSt = 0.2;
    ev = big.run(T.DRIFT_2);
    expect(of(ev, "charge", 0).map((e) => e.lvl)).toEqual([1, 2]);
    big.me.inB = GO;
    ev = big.run(0.05);
    expect(of(ev, "mini", 0)[0].lvl).toBe(2);
    expect(big.me.boostT).toBeCloseTo(T.MINI_2, 1);
    expect(big.stats[0].bigDrifts).toBe(1);
  });

  it("a drift cannot start at a crawl or with the wheel straight, and a short one gives nothing", () => {
    const slow = stage();
    slow.place(slow.me, 112, 0, 3, { steer: 1, b: BTN.DRIFT });
    expect(of(slow.run(0.3), "drift")).toHaveLength(0);
    const straight = stage();
    straight.place(straight.me, 206, 0, 9, { steer: 0, b: GO | BTN.DRIFT });
    expect(of(straight.run(0.3), "drift")).toHaveLength(0);
    const short = stage();
    short.place(short.me, 112, 0, 9, { steer: 1, b: GO | BTN.DRIFT });
    short.run(0.3);
    short.me.inB = GO;
    expect(of(short.run(0.1), "mini")).toHaveLength(0);
    expect(short.me.boostT).toBe(0);
  });

  it("flies off the bread board and lands beyond the butter dish", () => {
    const s = stage();
    s.place(s.me, 20, 0, T.TOP_SPEED);
    const ev = s.run(2.5);
    const leap = of(ev, "leap", 0)[0], land = of(ev, "land", 0)[0];
    expect(C.jumpAt(leap.u).name).toBe("bread board");
    expect(land.air).toBeGreaterThan(0.3);
    expect(C.wrapS(land.u - C.jumpAt(leap.u).clear)).toBeGreaterThanOrEqual(0);
    expect(s.me.air).toBe(false);
    expect(s.stats[0].jumps).toBeGreaterThanOrEqual(1);
  });

  it("drives up a low step with a clunk and a hop, and slides along a side too tall to climb", () => {
    // The knife bridge is 0.5 high: driven onto from the side, the car clunks up it and hops.
    const s = stage();
    s.place(s.me, 214, -1.2, 6, { side: -0.5, steer: -0.4 });
    s.me.inSt = -0.4;
    let top = 0;
    const ev = s.run(0.4, { step: () => { top = Math.max(top, s.me.y); } });
    expect(of(ev, "clunk", 0).length).toBeGreaterThan(0);
    expect(of(ev, "knock", 0)).toHaveLength(0);
    expect(top).toBeGreaterThanOrEqual(0.5);
    expect(s.me.v).toBeGreaterThan(3);
    // The tall pancake stack (1.5) from behind its low end is climbed step by step; its side from the cloth is not there to hit
    // (it spans the road), so the spoon ramp's tall end (1.15), met from beside it, stands in for a wall.
    const k = stage();
    k.place(k.me, 89.0, -0.2, 5, { side: -0.6, steer: -0.3 });
    k.me.inSt = -0.3;
    const ev2 = k.run(0.6);
    expect(of(ev2, "knock", 0).some((e) => e.hard === 2)).toBe(true);
    expect(k.me.y).toBe(0);
    expect(k.me.v).toBeGreaterThan(1);
  });
});

describe("bumps: they slow, they never flip", () => {
  /** Ann at speed runs into the back of Bo, who is slow. Returns what the bump did. */
  function rearEnd(a, b) {
    const s = two(a, b);
    const [ann, bo] = s.cars;
    s.place(ann, 10, 2, T.TOP_SPEED);
    s.place(bo, 11.4, 2, 4);
    let lost = null, gained = null, va = ann.v, vb = bo.v;
    const ev = s.run(0.6, { step: () => { if (lost === null && s.stats[0].bumps === 1) { lost = va - ann.v; gained = bo.v - vb; } va = ann.v; vb = bo.v; } });
    return { s, ann, bo, ev, lost, gained, bump: of(ev, "bump")[0] };
  }

  it("the car behind loses a share of the closing speed and the car ahead is nudged on", () => {
    const { s, ann, bo, bump, lost, gained } = rearEnd("robot", "robot");
    expect(bump).toMatchObject({ car: 0, into: 1 });
    expect(bump.hard).toBeGreaterThan(4);
    expect(lost).toBeCloseTo(bump.hard * T.BUMP_LOSE, 1);
    expect(gained).toBeGreaterThan(0.3);
    // Nobody spins, tips, stops or leaves the road, and both keep racing.
    for (const c of [ann, bo]) { expect(c.spinT).toBe(0); expect(c.fallT).toBe(0); expect(c.v).toBeGreaterThan(3); expect(Math.abs(c.lat)).toBeLessThan(C.sideLimit(c.u)); }
    expect(Math.hypot(ann.x - bo.x, ann.z - bo.z)).toBeGreaterThanOrEqual(2 * T.CAR_R - 1e-9);
    expect(bo.wobT).toBeLessThanOrEqual(T.WOBBLE_T);
    expect(s.stats[0].bumps).toBe(1);
  });

  it("the pawn is steady: a bump barely slows it", () => {
    const robot = rearEnd("robot", "robot"), pawn = rearEnd("pawn", "robot");
    expect(pawn.lost).toBeCloseTo(robot.lost * T.TRAITS.pawn.bumpK, 1);
    expect(of(pawn.ev, "trait", 0).some((e) => e.trait === "pawn" && e.what === "car")).toBe(true);
  });

  it("side by side, two cars push apart and neither goes through the other", () => {
    const s = two();
    const [ann, bo] = s.cars;
    s.place(ann, 10, 1.6, 8, { side: 0.25 });
    s.place(bo, 10, 2.4, 8, { side: -0.25 });
    s.run(1, { step: () => expect(Math.hypot(ann.x - bo.x, ann.z - bo.z)).toBeGreaterThanOrEqual(2 * T.CAR_R - 1e-9) });
    for (const c of [ann, bo]) { expect(c.v).toBeGreaterThan(5); expect(c.spinT).toBe(0); expect(Math.abs(c.lat)).toBeLessThanOrEqual(C.sideLimit(c.u) + 1e-6); }
  });

  it("a car just set back on the table, a finished car and a car on another level are not bumped", () => {
    for (const change of [(bo) => { bo.safeT = 5; }, (bo) => { bo.fin = true; }, (bo) => { bo.y = 1; bo.air = true; bo.vy = 9; }]) {
      const s = two();
      const [ann, bo] = s.cars;
      s.place(ann, 10, 2, T.TOP_SPEED);
      s.place(bo, 11.4, 2, 4);
      change(bo);
      expect(of(s.run(0.2), "bump")).toHaveLength(0);
    }
  });
});

describe("walls: soft, never a stop", () => {
  it("a car driven into a wall slides along it, loses a little speed and stays on the road", () => {
    const s = stage();
    s.place(s.me, 10, 2, T.TOP_SPEED, { side: 0.5, steer: 0.5 });
    s.me.inSt = 0.5;
    let worst = 0, before = s.me.v, lost = null;
    const ev = s.run(1, { step: () => { worst = Math.max(worst, Math.abs(s.me.lat) - C.sideLimit(s.me.u)); if (lost === null && s.stats[0].walls) lost = before - s.me.v; before = s.me.v; } });
    const wall = of(ev, "wall", 0)[0];
    expect(wall.hard).toBeGreaterThan(T.TOP_SPEED * Math.sin(0.5) - 0.5); // the speed it had into the wall
    expect(lost).toBeCloseTo(wall.hard * T.WALL_HIT, 0);
    expect(worst).toBeLessThan(1e-6);
    expect(s.me.v).toBeGreaterThan(5);
    expect(s.stats[0].walls).toBe(1);
    expect(s.stats[0].stuck).toBe(0);
  });

  it("there is a wall on both sides everywhere but the open edge", () => {
    for (const [u, side] of [[10, -1], [10, 1], [120, -1], [120, 1], [215, 1], [270, -1], [195, 1], [195, -1]]) {
      const s = stage();
      s.place(s.me, u, side * (C.sideLimit(u) - 0.6), 7, { side: side * 0.7, steer: side });
      s.me.inSt = side;
      const ev = s.run(1.2);
      expect(of(ev, "fall"), `${u} ${side}`).toHaveLength(0);
      expect(Math.abs(s.me.lat), `${u} ${side}`).toBeLessThanOrEqual(C.sideLimit(s.me.u) + 1e-6);
    }
  });
});

describe("the open edge", () => {
  it("a car driven off it falls, and the Hand of the House sets it back a moment later", () => {
    const s = stage();
    s.place(s.me, 225.5, -2.4, 6, { side: -0.6, steer: -1 });
    s.me.inSt = -1;
    s.me.boostT = 1; s.me.drOn = true;
    let ev = s.run(1.2);
    const fall = of(ev, "fall", 0)[0];
    expect(fall).toBeTruthy();
    expect(C.onEdge(fall.u)).toBe(true);
    expect(s.me.boostT).toBe(0);
    expect(s.me.drOn).toBe(false);
    expect(s.stats[0].falls).toBe(1);
    // It is back within FALL_T + HAND_T of the fall, on the road, rolling, and safe from bumps for a moment.
    const fellAt = fall.t;
    ev = ev.concat(s.run(T.FALL_T + T.HAND_T));
    const back = of(ev, "back", 0)[0];
    expect(back.t - fellAt).toBeCloseTo(T.FALL_T + T.HAND_T, 1);
    const b = stage();
    b.place(b.me, 225.5, -2.4, 6, { side: -0.6, steer: -1 });
    b.me.inSt = -1;
    b.run(1.2 + 0.01, { step: (st) => { if (b.me.fallT > 0 && b.me.fallT <= DT * 1.5) b.seen = true; } });
    b.run(T.FALL_T + T.HAND_T, { step: () => { if (!b.at && b.me.fallT === 0) b.at = { lat: b.me.lat, v: b.me.v, safeT: b.me.safeT, y: b.me.y, u: b.me.u }; } });
    expect(b.at.lat).toBeCloseTo(-0.8, 1);
    expect(b.at.v).toBeCloseTo(3, 0);
    expect(b.at.safeT).toBeGreaterThan(1);
    expect(b.at.y).toBe(0);
    expect(C.wrapS(fall.u - b.at.u)).toBeGreaterThan(0.5); // a little before where it went over
  });

  it("a fall never ends a race for anyone: the car finishes its lap afterwards", () => {
    const s = stage();
    s.place(s.me, 225.5, -2.4, 6, { side: -0.6, steer: -1 });
    s.me.inSt = -1;
    s.run(1.2);
    s.me.inSt = 0;
    const s0 = s.me.s;
    s.run(6);
    expect(s.me.fallT).toBe(0);
    expect(s.me.s - s0).toBeGreaterThan(25);
  });
});

describe("the shakers and the jars: solid posts a car slides round", () => {
  it("a car driven straight at a pepper shaker is knocked, sneezes pepper, and slides round it without stopping", () => {
    const s = stage({ character: "robot" });
    const sh = C.SHAKERS[0];
    s.place(s.me, sh.u - 4, 0.15, T.TOP_SPEED);
    let nearest = Infinity;
    const ev = s.run(2, { step: () => { nearest = Math.min(nearest, Math.hypot(s.me.x - sh.x, s.me.z - sh.z)); } });
    expect(of(ev, "knock", 0)[0]).toMatchObject({ what: "pepper" });
    expect(of(ev, "hit", 0).map((e) => e.what)).toContain("pepper cloud");
    expect(nearest).toBeGreaterThanOrEqual(sh.r + T.CAR_R - 1e-9);
    expect(C.wrapS(s.me.u - sh.u)).toBeGreaterThan(2);
    expect(s.stats[0].stuck).toBeLessThan(0.5);
    expect(s.stats[0].posts).toBe(1);
  });

  it("the salt shaker knocks but gives no pepper cloud, and the pawn is slowed less", () => {
    const hitIt = (character) => {
      const s = stage({ character }), sh = C.SHAKERS[1];
      s.place(s.me, sh.u - 3, -0.3, T.TOP_SPEED);
      let vMin = 99;
      const ev = s.run(0.6, { step: () => { vMin = Math.min(vMin, s.me.v); } });
      return { ev, vMin };
    };
    const robot = hitIt("robot"), pawn = hitIt("pawn");
    expect(of(robot.ev, "knock", 0)[0]).toMatchObject({ what: "salt" });
    expect(of(robot.ev, "hit", 0)).toHaveLength(0);
    expect(pawn.vMin).toBeGreaterThan(robot.vMin + 0.5);
    expect(of(pawn.ev, "trait", 0).some((e) => e.trait === "pawn")).toBe(true);
  });

  it("a jar riding the lazy Susan is a post too, wherever the turntable has carried it", () => {
    const s = stage({ character: "robot", tau: 20 });
    const jar = C.susanThings(20 + 0.35, [])[0];
    s.place(s.me, jar.u - 3.2, jar.lat, T.TOP_SPEED);
    let nearest = Infinity;
    const ev = s.run(1.5, { step: (st) => { const j = C.susanThings(st.n * DT, [])[0]; nearest = Math.min(nearest, Math.hypot(s.me.x - j.x, s.me.z - j.z) - j.r - T.CAR_R); } });
    expect(of(ev, "knock", 0).some((e) => e.what === "jam")).toBe(true);
    expect(nearest).toBeGreaterThan(-1e-6);
    expect(s.stats[0].stuck).toBeLessThan(0.5);
  });
});

describe("the live kitchen", () => {
  it("the kettle whistles a warning, then its steam pushes a car across the road, toward the infield", () => {
    const K = T.KETTLE;
    const warn = stage({ tau: K.period * 2 - 0.05 });
    expect(of(warn.run(0.2), "kettle")).toHaveLength(1);
    const cross = (character, tau) => {
      const s = stage({ character, tau });
      s.place(s.me, K.u0 - 1, -1.5, T.TOP_SPEED);
      const ev = s.run(0.75);
      return { ev, lat: s.me.lat, s };
    };
    const blow = K.period * 2 + K.warn + 0.05, quiet = K.period * 2 + K.warn + K.blow + 0.3;
    const pushed = cross("pawn", blow), calm = cross("pawn", quiet), ghost = cross("ghost", blow);
    expect(of(pushed.ev, "hit", 0).map((e) => e.what)).toEqual(["steam"]);
    expect(of(calm.ev, "hit", 0)).toHaveLength(0);
    expect(calm.lat).toBeCloseTo(-1.5, 2);
    expect(pushed.lat).toBeGreaterThan(-1.5 + 0.5);
    expect(pushed.s.me.v).toBeGreaterThan(T.TOP_SPEED - 0.5); // a push, not a brake
    // The ghost's drawback: steam pushes it further.
    expect(ghost.lat - -1.5).toBeGreaterThan((pushed.lat - -1.5) * 1.3);
  });

  it("the toast pops (a warning first), lands across the road as a ramp, and a car hops off it", () => {
    const TS = T.TOASTER;
    const lie = stage().findTau((t) => C.toasterAt(t).stage === "lie" && C.toasterAt(t).k === 1);
    const warn = stage({ tau: lie - TS.fly - TS.warn - 0.2 });
    expect(of(warn.run(0.4), "toaster")).toHaveLength(1);
    const s = stage({ tau: lie });
    s.place(s.me, TS.land - TS.len / 2 - 3, 1, T.TOP_SPEED);
    const ev = s.run(1.2);
    expect(s.st.toast).toBe(1);
    expect(of(ev, "onto", 0)).toEqual([expect.objectContaining({ what: "toast" })]);
    expect(of(ev, "leap", 0).length).toBeGreaterThan(0);
    expect(of(ev, "land", 0).length).toBeGreaterThan(0);
    expect(s.me.v).toBeGreaterThan(6);
    // Beside the toast (the outside half) the road is flat.
    const beside = stage({ tau: lie });
    beside.place(beside.me, TS.land - TS.len / 2 - 3, TS.lat0 - 1, T.TOP_SPEED);
    expect(of(beside.run(1.2), "onto")).toHaveLength(0);
  });

  it("the egg rocks in its cup (a warning), rolls across the road, and knocks a car it rolls into", () => {
    const E = T.EGG;
    const first = stage().findTau((t) => C.eggAt(t).stage === "warn");
    expect(of(stage({ tau: first - 0.1 }).run(0.3), "eggwarn")).toHaveLength(1);
    const arrive = 3 / T.TOP_SPEED;
    const tau = stage().findTau((t) => C.eggAt(t + arrive).stage === "roll" && Math.abs(C.eggAt(t + arrive).lat) < 0.2);
    const s = stage({ character: "robot", tau });
    s.place(s.me, E.u - 3, 0, T.TOP_SPEED);
    const ev = s.run(2);
    const said = [...of(ev, "hit", 0).map((e) => e.what), ...of(ev, "knock", 0).map((e) => e.what)];
    expect(said).toContain("egg");
    expect(s.stats[0].stuck).toBeLessThan(0.5);
    expect(s.me.v).toBeGreaterThan(4);
    expect(C.wrapS(s.me.u - E.u)).toBeGreaterThan(3);
  });

  it("the syrup drips (a warning), and its patch is sticky: top speed is cut while a car is on it", () => {
    const first = stage().findTau((t) => C.syrupAt(t).stage === "warn");
    expect(of(stage({ tau: first - 0.1 }).run(0.3), "syrupwarn")).toHaveLength(1);
    const tau = stage().findTau((t) => C.syrupAt(t).stage === "stay");
    const s = stage({ tau });
    s.place(s.me, T.SYRUP.u - 0.4, T.SYRUP.lat, T.TOP_SPEED);
    let slowest = 99;
    const ev = s.run(0.5, { step: () => { if (s.me.spill === "syrup") slowest = Math.min(slowest, s.me.v); } });
    expect(of(ev, "spill", 0)[0]).toMatchObject({ what: "syrup", does: "slow" });
    expect(slowest).toBeLessThan(T.TOP_SPEED * 0.8);
    expect(slowest).toBeGreaterThanOrEqual(T.TOP_SPEED * T.SYRUP_CAP - 1e-9);
    // Before the kitchen arms there is no patch there.
    const early = stage({ tau: 10 });
    early.place(early.me, T.SYRUP.u - 0.4, T.SYRUP.lat, T.TOP_SPEED);
    expect(of(early.run(0.3), "spill")).toHaveLength(0);
  });

  it("the lazy Susan carries a car on along the road on its outside half and back on its infield half", () => {
    // A car standing on it with nothing held, and no jars in the way: only the turntable moves it.
    const noJars = makeRules(retune({ SUSAN: { things: [] } }));
    const ride = (lat, character = "robot") => {
      const s = stage({ rules: noJars, tau: 20, character });
      s.place(s.me, T.SUSAN.u, lat, 0, { b: 0 });
      const h0 = s.me.h, s0 = s.me.s;
      const ev = s.run(0.5);
      return { ds: s.me.s - s0, du: C.wrapS(s.me.u - T.SUSAN.u), turned: wrapA(s.me.h - h0), ev };
    };
    const on = ride(-2.2), back = ride(2.2);
    expect(of(on.ev, "susan", 0)[0].side).toBe(-1);
    expect(of(back.ev, "susan", 0)[0].side).toBe(1);
    expect(on.du).toBeCloseTo(2.2 * Math.sin(T.SUSAN.spin * 0.5), 2);
    expect(back.du).toBeCloseTo(-2.2 * Math.sin(T.SUSAN.spin * 0.5), 2);
    expect(on.turned).toBeCloseTo(T.SUSAN.spin * 0.5, 6);
    // Being carried counts as distance raced, on or back, so the finish line is the same place for every car.
    expect(on.ds).toBeCloseTo(on.du, 9);
    expect(back.ds).toBeCloseTo(back.du, 9);
    // The ghost's drawback: the turntable carries it further.
    expect(ride(-2.2, "ghost").du).toBeGreaterThan(on.du * 1.4);
    // Off the turntable nothing is carried.
    const s = stage({ rules: noJars, tau: 20 });
    s.place(s.me, T.SUSAN.u + T.SUSAN.r + 2, 0, 0, { b: 0 });
    expect(of(s.run(0.3), "susan")).toHaveLength(0);
  });

  it("a cherry wobbles on the bowl's rim (a warning), drops on a car under it, then rolls and is a thing to hit", () => {
    const seed = 9, plan = C.cherryPlan(seed, 8);
    // Under it as it lands: a soft knock.
    const s = stage({ seed, tau: plan.at - 0.2, cherryN: 8 });
    s.place(s.me, plan.u, plan.lat, 0, { b: 0 });
    let ev = s.run(0.2 + T.CHERRY.fall + 0.05);
    expect(of(ev, "cherry")).toEqual([expect.objectContaining({ id: 8 })]);
    expect(of(ev, "hit", 0)).toEqual([expect.objectContaining({ what: "cherry", landed: true, by: -1 })]);
    expect(s.me.wobT).toBeGreaterThan(0);
    // Driven into while it rolls: a knock, and the cherry is sent on.
    const r = stage({ seed, tau: plan.at + T.CHERRY.fall + 0.3 - 0.5, cherryN: 8, character: "robot" });
    r.place(r.me, plan.u - 0.5 * T.TOP_SPEED, plan.lat - 0.9, T.TOP_SPEED);
    ev = r.run(1.5);
    expect(of(ev, "knock", 0).some((e) => e.what === "cherry")).toBe(true);
    expect(r.stats[0].stuck).toBeLessThan(0.5);
    // It is gone a few seconds after it fell.
    const g = stage({ seed, tau: plan.at - 0.2, cherryN: 8 });
    ev = g.run(0.2 + T.CHERRY.fall + T.CHERRY.life + 0.2);
    expect(of(ev, "cherrygone")).toEqual([expect.objectContaining({ id: 8 })]);
    expect(g.st.cherries).toHaveLength(0);
  });

  it("the bowl drops only every other cherry on the first lap, and never more than two are out at once", () => {
    const s = stage({ seed: 4, tau: 0, cherryN: 0 });
    let most = 0;
    const ev = s.run(C.ARM_TAU + 30, { step: (st) => { most = Math.max(most, st.cherries.length); } });
    const early = of(ev, "cherry").filter((e) => C.cherryPlan(4, e.id).at < C.ARM_TAU), late = of(ev, "cherry").filter((e) => C.cherryPlan(4, e.id).at >= C.ARM_TAU);
    expect(early.length).toBeGreaterThan(1);
    expect(early.every((e) => e.id % 2 === 0)).toBe(true);
    expect(late.some((e) => e.id % 2 === 1)).toBe(true);
    expect(most).toBeLessThanOrEqual(T.CHERRY.max);
  });
});

describe("spills: each does one thing", () => {
  const into = (name, character = "pawn") => {
    const sp = T.SPILLS.find((x) => x.name === name);
    const s = stage({ character });
    s.place(s.me, sp.u - sp.ru - 0.6, sp.lat, T.TOP_SPEED);
    let slick = false, spun = 0;
    const ev = s.run(0.5, { step: () => { slick = slick || s.me.slick === name; spun = Math.max(spun, s.me.spinT); } });
    return { s, ev, slick, spun, spill: of(ev, "spill", 0)[0] };
  };

  it("salt and tea are slides: the car keeps going the way it was, whatever way it points", () => {
    for (const name of ["salt", "tea"]) {
      const r = into(name);
      expect(r.spill).toMatchObject({ what: name, does: "slide" });
      expect(r.slick).toBe(true);
      expect(r.spun).toBe(0);
      expect(r.s.stats[0].slicks).toBe(1);
    }
    // On the slide, the way a car moves follows its nose far more slowly than on cloth: a car pointing half a
    // radian off the way it is moving is still sliding a tenth of a second later.
    const sliding = (onSalt) => {
      const sp = T.SPILLS[0], s = stage({ character: "robot" });
      s.place(s.me, onSalt ? sp.u - 1.2 : 12, onSalt ? sp.lat : 2, 6, { steer: 0, b: 0 });
      s.me.h += 0.5; s.me.inSt = 0.1; // (a little steer held, so the steering help does not turn the nose back)
      s.run(0.1);
      return Math.abs(wrapA(s.me.h - s.me.mh));
    };
    expect(sliding(false)).toBeLessThan(0.02);
    expect(sliding(true)).toBeCloseTo(0.5 - T.SLICK_GRIP * 0.1, 1);
  });

  it("oatmeal is a spin: round once in under a second, still rolling, then on its way", () => {
    const r = into("oatmeal");
    expect(r.spill).toMatchObject({ what: "oatmeal", does: "spin" });
    expect(r.spun).toBeCloseTo(T.SPIN_T, 1);
    expect(r.s.me.v).toBeGreaterThan(T.TOP_SPEED * (1 - T.SPIN_LOSE) - 3);
    r.s.run(T.SPIN_T);
    expect(r.s.me.spinT).toBeLessThanOrEqual(0);
    expect(r.s.me.h).toBe(r.s.me.mh); // it comes out facing the way it slid
    expect(r.s.stats[0].stuck).toBe(0);
  });

  it("the slime sticks: it never slides or spins", () => {
    for (const name of ["salt", "oatmeal", "tea"]) {
      const r = into(name, "slime");
      expect(r.spill).toMatchObject({ what: name, does: "stuck" });
      expect(r.slick).toBe(false);
      expect(r.spun).toBe(0);
      expect(of(r.ev, "trait", 0)).toEqual([expect.objectContaining({ trait: "slime", what: name })]);
    }
  });
});

describe("powers", () => {
  it("a sweet gives one power, unwrapped a moment later; the sweet is back on its doily after a few seconds", () => {
    const s = two();
    const [ann, bo] = s.cars;
    const box = T.BOXES[0];
    s.place(ann, box.u - 1.5, box.lats[2], T.TOP_SPEED);
    s.place(bo, box.u - 3.2, box.lats[2], T.TOP_SPEED);
    const ev = s.run(0.6);
    const got = of(ev, "item");
    expect(got).toHaveLength(1); // Bo, right behind on the same sweet, finds the doily empty
    expect(got[0]).toMatchObject({ car: 0, box: 0, sweet: 2 });
    expect(T.ITEMS).toContain(ann.item);
    expect(ann.itemT).toBeGreaterThan(0);
    expect(bo.item).toBe(null);
    expect(s.st.boxT[0][2]).toBeCloseTo((got[0].t + T.COUNT_IN) + T.BOX_BACK, 6);
    expect(s.st.boxT[0].filter((at) => at > 0)).toHaveLength(1); // the other three sweets are still there
    // A press of Use while it is still wrapped does nothing, and is not remembered.
    s.rules.hold(ann, 0, GO | BTN.USE);
    expect(of(s.run(0.05), "use")).toHaveLength(0);
    s.rules.hold(ann, 0, GO);
    s.run(T.UNWRAP_T);
    expect(of(s.run(0.2), "use")).toHaveLength(0);
    expect(ann.item).not.toBe(null);
  });

  it("a car holds one power at a time", () => {
    const s = stage();
    const box = T.BOXES[0];
    s.place(s.me, box.u - 1.5, box.lats[2], T.TOP_SPEED);
    s.me.item = "butter";
    expect(of(s.run(0.6), "item")).toHaveLength(0);
    expect(s.me.item).toBe("butter");
  });

  it("the draw is seeded, and leans to what helps your place: butter for the leader, an overwind at the back", () => {
    expect(rules.drawItem(7, 1, 3, 2)).toBe(rules.drawItem(7, 1, 3, 2));
    for (let place = 1; place <= 4; place++) {
      const n = 6000, count = Object.fromEntries(T.ITEMS.map((k) => [k, 0]));
      for (let k = 0; k < n; k++) count[rules.drawItem(k * 7919 + 1, k % 4, k % 5, place)]++;
      const total = T.ODDS[place - 1].reduce((a, b) => a + b, 0);
      T.ITEMS.forEach((item, k) => expect(count[item] / n, `${item} at place ${place}`).toBeCloseTo(T.ODDS[place - 1][k] / total, 1));
    }
  });

  it("a car's place for the draw counts finishers ahead and everyone further round", () => {
    const s = two();
    const [ann, bo] = s.cars;
    s.place(ann, 20, 2, 5); s.place(bo, 30, 2, 5);
    expect([rules.placeOf(s.st, ann), rules.placeOf(s.st, bo)]).toEqual([2, 1]);
    ann.fin = true; ann.finT = 50;
    expect([rules.placeOf(s.st, ann), rules.placeOf(s.st, bo)]).toEqual([1, 2]);
  });

  it("overwind: a press (not a hold) gives a big boost for a couple of seconds", () => {
    const s = stage();
    s.place(s.me, 206, 2.5, T.TOP_SPEED);
    s.me.item = "overwind";
    s.rules.hold(s.me, 0, GO | BTN.USE);
    let fastest = 0;
    const ev = s.run(T.OVERWIND_T, { step: () => { fastest = Math.max(fastest, s.me.v); } });
    expect(of(ev, "use", 0)).toEqual([expect.objectContaining({ item: "overwind", to: -1 })]);
    expect(s.me.item).toBe(null);
    expect(fastest).toBeGreaterThan(T.TOP_SPEED * 1.4);
    expect(fastest).toBeLessThanOrEqual(T.TOP_SPEED * T.OVERWIND + 1e-9);
    expect(s.stats[0].used).toBe(1);
    // Still holding the button when the next power is unwrapped does not use it: that takes a new press.
    s.place(s.me, 206, 2.5, T.TOP_SPEED, { b: GO | BTN.USE });
    s.me.item = "butter";
    expect(of(s.run(0.3), "use")).toHaveLength(0);
    s.rules.hold(s.me, 0, GO);
    s.rules.hold(s.me, 0, GO | BTN.USE);
    expect(of(s.run(0.05), "use")).toHaveLength(1);
  });

  it("pepper shot: a peppercorn flies to the car ahead, which sneezes and loses speed", () => {
    const s = two();
    const [ann, bo] = s.cars;
    s.place(ann, 8, 2.6, T.TOP_SPEED);
    s.place(bo, 18, 2.6, T.TOP_SPEED * 0.94);
    ann.item = "pepper";
    s.rules.hold(ann, 0, GO | BTN.USE);
    let before = bo.v, lost = null, sneeze = 0;
    const ev = s.run(2.5, { step: () => { if (lost === null && bo.sneezeT > 0) { lost = before - bo.v; sneeze = bo.sneezeT; } before = bo.v; } });
    expect(of(ev, "use", 0)[0]).toMatchObject({ item: "pepper", to: 1 });
    expect(of(ev, "hit", 1)).toEqual([expect.objectContaining({ what: "pepper", by: 0 })]);
    expect(of(ev, "shotgone")).toEqual([expect.objectContaining({ burst: true })]);
    expect(lost).toBeCloseTo(T.TOP_SPEED * 0.94 * T.PEPPER_LOSE, 0);
    expect(sneeze).toBeCloseTo(T.SNEEZE_T, 1);
    expect(s.st.drops).toHaveLength(0);
    // It is short: the car that was hit is racing again inside a second, and nobody spun or fell.
    expect(bo.sneezeT).toBeLessThanOrEqual(0);
    expect(bo.v).toBeGreaterThan(5);
    expect(s.stats[1].stuck).toBe(0);
    expect(bo.spinT).toBe(0);
    expect(of(ev, "hit", 0)).toHaveLength(0); // never its own shot
  });

  it("a sneezing car cannot speed up, and steers at half strength", () => {
    const s = stage();
    s.place(s.me, 206, 0, 4, { steer: 0 });
    s.me.sneezeT = 0.3; s.me.inSt = 1;
    s.run(0.25);
    expect(s.me.v).toBeLessThan(4);
    expect(s.me.st).toBeLessThanOrEqual(0.5);
  });

  it("pepper shot with nobody ahead flies on and is gone, hitting nobody", () => {
    const s = stage();
    s.place(s.me, 8, 2.6, T.TOP_SPEED);
    s.me.item = "pepper";
    s.rules.hold(s.me, 0, GO | BTN.USE);
    const ev = s.run(2);
    expect(of(ev, "use", 0)[0].to).toBe(-1);
    expect(of(ev, "shotgone")).toEqual([expect.objectContaining({ burst: false })]);
    expect(of(ev, "hit")).toHaveLength(0);
  });

  it("butter pat: dropped behind, it spins the car that drives over it once, and is gone", () => {
    const s = two();
    const [ann, bo] = s.cars;
    s.place(ann, 14, 2.6, T.TOP_SPEED);
    s.place(bo, 8, 2.6, T.TOP_SPEED * 0.95);
    ann.item = "butter";
    s.rules.hold(ann, 0, GO | BTN.USE);
    let before = bo.v, lost = null;
    const ev = s.run(2, { step: () => { if (lost === null && bo.spinT > 0) lost = before - bo.v; before = bo.v; } });
    expect(of(ev, "use", 0)[0]).toMatchObject({ item: "butter" });
    expect(of(ev, "hit", 1)).toEqual([expect.objectContaining({ what: "butter", by: 0 })]);
    expect(of(ev, "hit", 0)).toHaveLength(0); // the car that dropped it drives off it untouched
    expect(lost).toBeCloseTo(T.TOP_SPEED * 0.95 * T.BUTTER_LOSE, 0);
    expect(of(ev, "buttergone")).toEqual([expect.objectContaining({ burst: true })]);
    expect(s.st.drops).toHaveLength(0);
    expect(bo.spinT).toBeLessThanOrEqual(0); // over well inside a second
    expect(bo.v).toBeGreaterThan(4);
  });

  it("butter melts away if nobody drives over it, and only slows the slime", () => {
    const s = stage();
    s.place(s.me, 14, 2.6, T.TOP_SPEED);
    s.me.item = "butter";
    s.rules.hold(s.me, 0, GO | BTN.USE);
    s.run(0.1);
    expect(s.st.drops).toHaveLength(1);
    s.park(s.me);
    const ev = s.run(T.BUTTER_LIFE);
    expect(of(ev, "buttergone")).toEqual([expect.objectContaining({ id: 1 })]);
    expect(of(ev, "buttergone")[0].burst).toBeUndefined();

    const t = two("robot", "slime");
    const [ann, bo] = t.cars;
    t.place(ann, 14, 2.6, T.TOP_SPEED);
    t.place(bo, 8, 2.6, T.TOP_SPEED * 0.95);
    ann.item = "butter";
    t.rules.hold(ann, 0, GO | BTN.USE);
    const ev2 = t.run(2);
    expect(of(ev2, "hit", 1)).toHaveLength(1);
    expect(of(ev2, "trait", 1)).toEqual([expect.objectContaining({ trait: "slime", what: "butter" })]);
    expect(bo.spinT).toBe(0);
  });

  it("a house car uses what it holds when it makes sense: pepper with a car ahead", () => {
    const s = stage({ park: false });
    const [me, pip, gus] = s.cars;
    s.park(pip, s.cars[3]);
    s.place(me, 30, 2.6, T.TOP_SPEED * 0.9);
    s.place(gus, 20, 2.6, T.TOP_SPEED);
    gus.item = "pepper"; gus.itemT = 0; gus.itemWait = 0;
    const ev = s.run(3);
    expect(of(ev, "use", gus.i)[0]).toMatchObject({ item: "pepper", to: 0 });
    expect(of(ev, "hit", 0).some((e) => e.what === "pepper" && e.by === gus.i)).toBe(true);
  });

  it("house cars leave some sweets for the players", () => {
    let took = 0, passed = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = stage({ seed, park: false });
      const [me, pip] = s.cars;
      s.park(me, s.cars[2], s.cars[3]);
      const box = T.BOXES[0];
      s.place(pip, box.u - 1.2, box.lats[1], 8);
      pip.inSt = 0; pip.inB = GO;
      passed++;
      // (The house steers itself; one that swerved off the sweet does not count either way.)
      const ev = s.run(0.3);
      if (of(ev, "item", pip.i).length) took++;
    }
    expect(took).toBeGreaterThan(passed * 0.15);
    expect(took).toBeLessThan(passed * (T.HOUSE_TAKE + 0.2));
  });
});

describe("the racers' traits", () => {
  it("the ghost fades through one knock, then must wait before it can fade again", () => {
    const s = two("ghost", "robot");
    const [ghost, bo] = s.cars;
    s.place(ghost, 10, 2, T.TOP_SPEED);
    s.place(bo, 11.4, 2, 4);
    let ev = s.run(0.6);
    expect(of(ev, "trait", 0)).toEqual([expect.objectContaining({ trait: "ghost", what: "car" })]);
    expect(of(ev, "bump")).toHaveLength(0);
    expect(ghost.s).toBeGreaterThan(bo.s); // it went through
    expect(ghost.v).toBeGreaterThan(T.TOP_SPEED - 0.5);
    expect(ghost.phaseCD).toBeGreaterThan(T.TRAITS.ghost.phaseEvery - 1);
    expect(s.stats[0].phases).toBe(1);
    // Straight into the next car: no fade this time.
    s.place(ghost, 10, 2, T.TOP_SPEED);
    s.place(bo, 11.4, 2, 4);
    ev = s.run(0.6);
    expect(of(ev, "bump", 0)).toHaveLength(1);
    // And once the wait is over, it fades again.
    s.run(T.TRAITS.ghost.phaseEvery);
    s.place(ghost, 10, 2, T.TOP_SPEED);
    s.place(bo, 11.4, 2, 4);
    expect(of(s.run(0.6), "trait", 0)).toHaveLength(1);
  });

  it("the ghost fades through a shaker too, when it meets it deep enough", () => {
    // (Carried from round five: a post is faded through only when the step that first touches it lands more than
    // 0.05 inside it; a shallower first touch is an ordinary knock. So of eight runs a step apart, some of each.)
    let faded = 0, knocked = 0;
    for (let k = 0; k < 8; k++) {
      const s = stage({ character: "ghost" }), sh = C.SHAKERS[1];
      s.place(s.me, sh.u - 3 - k * 0.01, 0, T.TOP_SPEED);
      const ev = s.run(0.8);
      if (of(ev, "trait", 0).some((e) => e.trait === "ghost" && e.what === "salt")) {
        faded++;
        expect(of(ev, "knock")).toHaveLength(0);
        expect(C.wrapS(s.me.u - sh.u)).toBeGreaterThan(2);
        expect(s.me.v).toBeGreaterThan(T.TOP_SPEED - 0.1);
      } else { knocked++; expect(of(ev, "knock", 0)).toHaveLength(1); }
    }
    expect(faded).toBeGreaterThan(0);
    expect(faded + knocked).toBe(8);
  });

  it("the slime's drawback: its top speed is a little lower", () => {
    const s = stage({ character: "slime" });
    s.place(s.me, 206, 2.5, 0);
    s.run(3.5);
    expect(s.me.v).toBeCloseTo(T.TOP_SPEED * T.TRAITS.slime.topK, 9);
  });

  it("the robot charges a drift boost faster, and steers more heavily", () => {
    const charge = (character) => {
      const s = stage({ character });
      s.place(s.me, 112, -2, 9, { steer: 1, b: GO | BTN.DRIFT });
      let at = null;
      s.run(1, { each: (e) => { if (e.k === "charge" && e.lvl === 1 && at === null) at = e.t; } });
      return at - s.st.t + 1;
    };
    expect(charge("robot")).toBeCloseTo(T.DRIFT_1 * T.TRAITS.robot.chargeK, 1);
    expect(charge("slime")).toBeCloseTo(T.DRIFT_1, 1);
    const turn = (character) => { const s = stage({ character }); s.place(s.me, 206, 0, 5, { steer: 1, b: 0 }); s.rules.hold(s.me, 1, 0); const h0 = s.me.h; s.run(0.1); return wrapA(s.me.h - h0); };
    expect(turn("robot")).toBeLessThan(turn("slime") * 0.95);
    expect(turn("robot")).toBeGreaterThan(turn("slime") * 0.85);
  });
});

describe("laps and the finish", () => {
  /** A car `back` lengths before the line, about to start lap `lap` (1 is the first). */
  const nearLine = (s, c, lap, back, v = T.TOP_SPEED, lat = 2) => { s.place(c, rules.LEN - back, lat, v); c.s = lap * rules.LEN - back; c.lap = lap - 1; return c; };

  it("crossing the line starts the next lap, and the last crossing finishes", () => {
    const s = stage();
    nearLine(s, s.me, 1, 4);
    let ev = s.run(1);
    expect(of(ev, "lap", 0)).toEqual([expect.objectContaining({ lap: 2 })]);
    expect(of(ev, "finish")).toHaveLength(0);
    expect(s.me.lap).toBe(1);
    expect(T.LAPS).toBe(2);
    nearLine(s, s.me, T.LAPS, 4);
    ev = s.run(1);
    const fin = of(ev, "finish", 0)[0];
    expect(fin).toMatchObject({ place: 1 });
    expect(of(ev, "lastcall")).toHaveLength(1);
    expect(s.me.fin).toBe(true);
    expect(s.st.order).toEqual([0]);
    expect(s.st.firstFin).toBe(fin.time);
  });

  it("times the finish to the moment the line was crossed, between two steps", () => {
    const s = stage();
    nearLine(s, s.me, T.LAPS, 0.5);
    let crossed = null;
    s.run(0.5, { step: (st) => { if (crossed === null && s.me.fin) crossed = st.t; } });
    expect(s.me.finT).toBeLessThanOrEqual(crossed);
    expect(s.me.finT).toBeGreaterThan(crossed - DT);
    // Two cars over the line in the same step still get different times, in the right order.
    const t = two();
    const [ann, bo] = t.cars;
    nearLine(t, ann, T.LAPS, 0.02, 9, 1.5);
    nearLine(t, bo, T.LAPS, 0.05, 9, 2.6);
    t.run(0.05);
    expect(ann.fin && bo.fin).toBe(true);
    expect(ann.finT).toBeLessThan(bo.finT);
    expect(rules.standings(t.st)).toEqual([{ seat: 0, place: 1 }, { seat: 1, place: 2 }]);
  });

  it("a finished car rolls a slow lap of honour, driven by the house, and is out of everyone's way", () => {
    const s = two();
    const [ann, bo] = s.cars;
    nearLine(s, ann, T.LAPS, 1);
    s.run(0.3);
    expect(ann.fin).toBe(true);
    s.rules.hold(ann, -1, BTN.BRAKE); // its player lets go, or does not: the house has the wheel now
    s.run(3);
    expect(ann.v).toBeLessThanOrEqual(4 + 1e-9);
    expect(ann.v).toBeGreaterThan(2);
    expect(ann.inB & GO).toBe(GO);
    s.place(bo, ann.u - 1.2, ann.lat, T.TOP_SPEED);
    expect(of(s.run(0.4), "bump")).toHaveLength(0);
  });

  it("the race ends when every car is home", () => {
    const s = stage({ park: false });
    s.cars.forEach((c, k) => nearLine(s, c, T.LAPS, 1 + k * 1.5, 9, k % 2 ? 2.4 : -2.4));
    const ev = s.run(2);
    expect(of(ev, "end")).toHaveLength(1);
    expect(s.st.over).toBe(true);
    expect(s.st.order.slice().sort()).toEqual([0, 1, 2, 3]);
    expect(s.st.order.map((i) => s.cars[i].finT)).toEqual(s.cars.map((c) => c.finT).sort((a, b) => a - b));
    expect(rules.game.isOver(s.st)).toBe(true);
    expect(rules.game.result(s.st)).toEqual([{ seat: 0, place: 1, time: Math.round(s.me.finT * 1000) / 1000 }]);
  });

  it("once every player is home, the house cars get a few seconds to finish, and then it ends anyway", () => {
    const s = stage();
    nearLine(s, s.me, T.LAPS, 1);
    s.run(T.HOUSE_GRACE - 0.5);
    expect(s.st.over).toBe(false);
    const ev = s.run(1.2);
    expect(of(ev, "end")).toHaveLength(1);
  });

  it("the last call: a fixed time after the first car is home, the race ends for whoever is still out", () => {
    const s = two();
    const [ann, bo] = s.cars;
    nearLine(s, ann, T.LAPS, 1);
    s.place(bo, 60, 3, 0, { b: 0 }); // Bo has put the phone down
    s.run(T.LAST_CALL);
    expect(s.st.over).toBe(false);
    s.run(1.2);
    expect(s.st.over).toBe(true);
    expect(rules.game.result(s.st)).toEqual([
      { seat: 0, place: 1, time: Math.round(ann.finT * 1000) / 1000 },
      { seat: 1, place: 2, distance: Math.round(bo.s * 100) / 100 },
    ]);
  });

  it("a house car that is first home starts the last call too", () => {
    const s = stage({ park: false });
    const [me, pip] = s.cars;
    s.park(s.cars[2], s.cars[3]);
    s.place(me, 60, 3, 0, { b: 0 });
    nearLine(s, pip, T.LAPS, 1);
    const ev = s.run(1);
    expect(of(ev, "lastcall")).toEqual([expect.objectContaining({ car: pip.i })]);
    s.run(T.LAST_CALL + 0.5);
    expect(s.st.over).toBe(true);
    // House cars take no place: the one player is first among the seats, by distance.
    expect(rules.game.result(s.st)).toEqual([{ seat: 0, place: 1, distance: Math.round(me.s * 100) / 100 }]);
  });

  it("no race outlasts the cap", () => {
    const s = stage({ tau: T.COUNT_IN + T.RACE_CAP - 0.5 });
    s.place(s.me, 60, 3, 0, { b: 0 });
    const ev = s.run(1);
    expect(of(ev, "end")).toHaveLength(1);
    expect(s.st.t).toBeLessThanOrEqual(T.RACE_CAP + DT);
    // Nothing runs after the end.
    const n = s.st.n;
    rules.advance(s.st, n + 500);
    expect(s.st.n).toBe(n);
  });

  it("standings: finishers by time, then the rest by distance; equal results share a place; house cars are left out", () => {
    const st = rules.createRace({ seed: 1, seats: [0, 1, 2].map((seat) => ({ seat, name: `P${seat}` })) });
    const [a, b, c, house] = st.cars;
    Object.assign(a, { s: 100 }); Object.assign(b, { s: 250 }); Object.assign(c, { fin: true, finT: 61.2 }); Object.assign(house, { fin: true, finT: 50 });
    expect(rules.standings(st)).toEqual([{ seat: 2, place: 1 }, { seat: 1, place: 2 }, { seat: 0, place: 3 }]);
    expect(rules.raceOrder(st)[0]).toBe(house);
    a.s = 250.004;
    expect(rules.standings(st)).toEqual([{ seat: 2, place: 1 }, { seat: 0, place: 2 }, { seat: 1, place: 2 }]);
    Object.assign(a, { fin: true, finT: 61.2004 }); Object.assign(b, { fin: true, finT: 70 });
    expect(rules.standings(st)).toEqual([{ seat: 2, place: 1 }, { seat: 0, place: 1 }, { seat: 1, place: 3 }]);
  });
});

describe("the house cars", () => {
  it("ease off when ahead of the leading player and push when behind (the rubber band)", () => {
    const capAt = (gap) => {
      const s = stage({ park: false });
      const [me, pip] = s.cars;
      s.park(s.cars[2], s.cars[3]);
      s.place(me, 120, 0, 8);
      s.place(pip, 120 + gap, 0, 8);
      s.run(0.05);
      return pip.cap;
    };
    const level = T.TOP_SPEED * T.HABITS.pip.pace;
    expect(capAt(20)).toBeLessThan(level);
    expect(capAt(20)).toBeGreaterThanOrEqual(level * T.RUBBER_FLOOR - 1e-9);
    expect(capAt(-30)).toBeGreaterThan(level);
    expect(capAt(-30)).toBeLessThanOrEqual(level * (1 + T.RUBBER_BEHIND) + 1e-9);
  });

  it("a house car gives a player coming up fast behind it the road", () => {
    const s = stage({ park: false });
    const [me, pip] = s.cars;
    s.park(s.cars[2], s.cars[3]);
    s.place(pip, 110, 0.3, 6);
    s.place(me, 110 - 2.4, 0.3, T.TOP_SPEED);
    const lat0 = pip.lat;
    const ev = s.run(0.6);
    expect(Math.abs(pip.lat - lat0)).toBeGreaterThan(0.3);
    expect(of(ev, "bump", 0)).toHaveLength(0);
  });

  it("drive themselves round a whole lap without a player on the table", () => {
    const s = stage({ park: false, tau: 0, cherryN: 0 });
    s.park(s.me);
    s.run(T.COUNT_IN + 60);
    for (const c of s.cars.slice(1)) { expect(c.lap, c.name).toBeGreaterThanOrEqual(1); expect(s.stats[c.i].stuck, c.name).toBeLessThan(1.5); expect(s.stats[c.i].falls, c.name).toBe(0); }
  });
});
