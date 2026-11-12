import { describe, expect, it } from "vitest";
import { game, createBattle, roundTime, dumpStall, loadStall, COUNT_IN } from "../game/shared/battle.js";
import { StallSim, ROUND_SECONDS, launch, predict, mech, backTop, tasksFor, TASKS, CORKS_PER_ROUND, RICOCHET_TIMES, LAMP_OUT_SECONDS } from "../game/shared/sim.js";
import { PLATES, ROWS, BELL } from "../game/shared/layout.js";

function runBattle(seed, n, { until = ROUND_SECONDS + 5, onEvent } = {}) {
  const seats = Array.from({ length: n }, (_, i) => ({ seat: i, name: `Bot ${i}`, kind: "bot" }));
  const state = game.create({ seed, seats, now: 0, round: 1 });
  const all = [];
  let now = 0;
  while (!game.isOver(state) && now < (until + COUNT_IN + 2) * 1000) {
    now += 33;
    for (const s of seats) for (const d of game.bot(state, s.seat, now)) game.input(state, s.seat, d, now);
    for (const e of game.tick(state, now)) {
      all.push(e);
      onEvent?.(e, state);
    }
  }
  return { state, events: all, now };
}

/** What a hit should pay, worked out from the rules alone. */
function expectedPoints(e) {
  const base = e.target === "bell" ? (e.rung ? 100 : 15) : e.target === "jam" ? 15 : e.target === "sh" ? 100 : ROWS[e.row].points;
  const run = e.streak >= 8 ? 3 : e.streak >= 4 ? 2 : 1;
  const points = base * run * (e.ricochet ? RICOCHET_TIMES : 1);
  return e.perfect ? Math.round(points * 1.5) : points;
}

describe("the cork", () => {
  it("passes through the aim point at the front row and falls away beyond it", () => {
    const front = predict(0.2, 1.2, ROWS[0].z);
    expect(Math.abs(front.x - 0.2)).toBeLessThan(0.03);
    expect(Math.abs(front.y - 1.2)).toBeLessThan(0.04);
    // The same aim, carried on to the far row along the sight line, lands low: aim higher for the far row.
    const cam = [0, 1.46, 0.82];
    const k = (ROWS[2].z - cam[2]) / (ROWS[0].z - cam[2]);
    const sightY = cam[1] + (1.6 - cam[1]) * k;
    const far = predict(0, 1.6, ROWS[2].z);
    expect(sightY - far.y).toBeGreaterThan(0.06);
    expect(far.time).toBeGreaterThan(front.time);
  });

  it("knocks a plate down, scores it, and leaves the cork lying in the stall", () => {
    const sim = new StallSim(1, 0);
    sim.step(0.1);
    sim.fire(0.1, PLATES[2].x, PLATES[2].y);
    sim.step(4);
    const hit = sim.events.find((e) => e.k === "hit");
    expect(hit).toMatchObject({ target: "p2", pts: 15, perfect: true });
    expect(sim.plateDown[2]).toBeGreaterThan(0);
    expect(sim.rested.length + sim.corks.length).toBe(1);
    expect(sim.score).toBe(15);
    expect(sim.corksLeft).toBe(CORKS_PER_ROUND); // a dead-centre hit earns the cork back
  });

  it("pays a ricochet hit three times over, and a straight hit once", () => {
    expect(RICOCHET_TIMES).toBe(3);
    // One cork a stall, so the run is 1 or 2 and never multiplies: sweep aims until both kinds of hit are seen.
    const seen = { straight: [], ricochet: [] };
    for (let i = 0; i < 400 && (seen.ricochet.length < 5 || seen.straight.length < 5); i++) {
      const sim = new StallSim(40 + i, 0);
      sim.step(0.1);
      sim.fire(0.1, -1.2 + (i % 25) * 0.1, 1.05 + (Math.floor(i / 25) % 16) * 0.1);
      sim.step(5);
      for (const e of sim.events) if (e.k === "hit") seen[e.ricochet ? "ricochet" : "straight"].push(e);
    }
    expect(seen.ricochet.length).toBeGreaterThanOrEqual(5);
    expect(seen.straight.length).toBeGreaterThanOrEqual(5);
    for (const e of seen.straight) expect(e.pts).toBe(expectedPoints(e));
    for (const e of seen.ricochet) {
      expect(e.mult).toBe(1);
      expect(e.pts).toBe(expectedPoints(e));
      expect(e.pts).toBeGreaterThanOrEqual(ROWS[0].points * 3);
    }
  });

  it("flies over the top of the stall when aimed there, and still bounces off what is really built", () => {
    const shoot = (ax, ay) => {
      const sim = new StallSim(3, 0);
      sim.step(0.1);
      sim.fire(0.1, ax, ay);
      sim.step(7);
      return sim.events;
    };
    // Over the pediment, over the back rail beside it, and over each side wall: nothing to hit.
    for (const [ax, ay] of [[0, 2.7], [0.9, 2.6], [1.35, 2.6], [-1.35, 2.7], [0.8, 2.35], [-1.2, 2.3]]) {
      const events = shoot(ax, ay);
      expect(events.filter((e) => e.k === "bounce" || e.k === "hit")).toEqual([]);
      expect(events.find((e) => e.k === "rest")).toMatchObject({ lost: true });
    }
    // Into the left wall, below its top: it comes back off the wall.
    expect(shoot(-1.35, 1.5).find((e) => e.k === "bounce")).toMatchObject({ what: "wall" });
    // The pediment is an arch: highest in the middle, a plain rail at the sides.
    expect(backTop(0)).toBeGreaterThan(backTop(0.5));
    expect(backTop(0.5)).toBeGreaterThan(backTop(1));
    expect(backTop(1)).toBeCloseTo(2.28);
  });

  it("cannot be fired faster than the lever cocks, or before the bell", () => {
    const sim = new StallSim(1, 0);
    sim.fire(-1, 0, 1.2);
    sim.step(0.05);
    expect(sim.shots).toBe(0);
    sim.fire(0.1, 0, 2.6);
    sim.fire(0.2, 0, 2.6);
    sim.fire(0.65, 0, 2.6);
    sim.step(1);
    expect(sim.shots).toBe(2);
  });

  it("is deterministic: same seed and inputs, same result", () => {
    const run = () => {
      const sim = new StallSim(99, 1);
      for (let i = 0; i < 40; i++) sim.fire(0.2 + i * 0.6, Math.sin(i) * 0.8, 1.15 + (i % 3) * 0.33);
      sim.step(30);
      return JSON.stringify([sim.score, sim.rested, sim.plateDown]);
    };
    expect(run()).toBe(run());
  });

  it("rings the bell for a jackpot only when the meter is full", () => {
    const sim = new StallSim(5, 0);
    sim.step(0.1);
    const aim = { x: BELL.x, y: BELL.y };
    // Find the aim that lands on the bell.
    let ax = aim.x, ay = aim.y;
    for (let i = 0; i < 4; i++) { const p = predict(ax, ay, BELL.z); ax += aim.x - p.x; ay += aim.y - p.y; }
    sim.fire(0.1, ax, ay);
    sim.step(2);
    expect(sim.events.find((e) => e.k === "hit")).toMatchObject({ target: "bell", rung: false });
    sim.bell = 8;
    sim.events.length = 0;
    sim.fire(2.1, ax, ay);
    sim.step(4);
    expect(sim.events.find((e) => e.k === "hit")).toMatchObject({ target: "bell", rung: true });
    expect(sim.bell).toBeLessThan(3); // emptied (the same cork may ricochet into something else on its way down)
  });

  it("speeds the machine up through the round", () => {
    expect(mech(10) - mech(9)).toBeLessThan(mech(89) - mech(88));
  });
});

describe("the rest of the stall", () => {
  /** The first aim in a patch of the stall whose cork meets the thing asked for. */
  function aimAt(what, [x0, x1, y0, y1], prepare) {
    for (let ay = y0; ay <= y1; ay += 0.04) {
      for (let ax = x0; ax <= x1; ax += 0.04) {
        const sim = new StallSim(11, 0);
        prepare?.(sim);
        sim.step(0.1);
        sim.fire(0.1, ax, ay);
        sim.step(2.5);
        const e = sim.events.find((x) => x.k === "prop" && x.what === what);
        if (e) return { sim, e, ax, ay };
      }
    }
    throw new Error(`no aim meets the ${what}`);
  }

  it("puts a lamp out for a while, and scores nothing for it", () => {
    const { sim, e } = aimAt("lamp", [-1.3, 1.3, 1.7, 2.7]);
    expect(sim.events.some((x) => x.k === "bounce" && x.what === "lamp")).toBe(true);
    expect(sim.lampOut[e.i]).toBeCloseTo(e.t + LAMP_OUT_SECONDS);
    expect(sim.lampOut.filter((until) => until > sim.t)).toHaveLength(1);
    if (!sim.events.some((x) => x.k === "hit")) expect(sim.score).toBe(0);
    sim.step(e.t + LAMP_OUT_SECONDS + 0.1);
    expect(sim.lampOut[e.i]).toBeLessThan(sim.t); // it has come back on
  });

  it("rocks a prize at the first knock and has it off the shelf at the second", () => {
    const first = aimAt("vase", [0.9, 1.35, 1.3, 2]);
    expect(first.e).toMatchObject({ broke: false });
    expect(first.sim.vaseDown[first.e.i]).toBe(-1);
    // The same cork again at a prize that has already been knocked once.
    const second = aimAt("vase", [first.ax, first.ax, first.ay, first.ay], (sim) => (sim.vaseKnocks[first.e.i] = 1));
    expect(second.e).toMatchObject({ i: first.e.i, broke: true });
    expect(second.sim.vaseDown[first.e.i]).toBeGreaterThan(0);
    // And once it is gone there is nothing there to hit.
    const sim = new StallSim(11, 0);
    sim.vaseDown[first.e.i] = 0;
    sim.step(0.1);
    sim.fire(0.1, first.ax, first.ay);
    sim.step(2.5);
    expect(sim.events.some((x) => x.k === "prop" && x.what === "vase" && x.i === first.e.i)).toBe(false);
  });

  it("marks the chalk board and rings the drive", () => {
    expect(aimAt("chalk", [-1.35, -0.9, 1.5, 2.3]).e.x).toBeLessThan(-1.2);
    expect(aimAt("wheel", [-1.35, -0.9, 0.6, 1.5]).e.i).toBeGreaterThanOrEqual(0);
  });

  it("carries dark lamps and fallen prizes in a snapshot", () => {
    const sim = new StallSim(5, 0);
    sim.step(1);
    sim.lampOut[3] = 6.5;
    sim.vaseKnocks[1] = 2;
    sim.vaseDown[1] = 0.75;
    sim.vaseKnocks[4] = 1;
    const copy = loadStall(new StallSim(5, 0), JSON.parse(JSON.stringify(dumpStall(sim))));
    expect(copy.lampOut).toEqual(sim.lampOut);
    expect(copy.vaseKnocks).toEqual(sim.vaseKnocks);
    expect(copy.vaseDown).toEqual(sim.vaseDown);
  });
});

describe("the challenges", () => {
  it("chalks up the same two for every stall of a round, and different ones for other rounds", () => {
    const [a, b] = tasksFor(1234);
    expect(a).not.toBe(b);
    expect(TASKS[a]).toBeDefined();
    expect(TASKS[b]).toBeDefined();
    expect(new StallSim(1234, 0).tasks).toEqual([a, b]);
    expect(new StallSim(1234, 3).tasks).toEqual([a, b]);
    const pairs = new Set(Array.from({ length: 40 }, (_, seed) => tasksFor(seed).join()));
    expect(pairs.size).toBeGreaterThan(10);
    for (let seed = 0; seed < 300; seed++) {
      const [x, y] = tasksFor(seed);
      expect(x).not.toBe(y);
      expect(Math.max(x, y)).toBeLessThan(TASKS.length);
    }
  });

  /** A stall whose two challenges are the ones named, a tenth of a second into its round. */
  function stallWith(...ids) {
    const sim = new StallSim(1, 0);
    sim.tasks = ids.map((id) => TASKS.findIndex((task) => task.id === id));
    sim.taskDone = sim.tasks.map(() => 0);
    sim.step(0.1);
    return sim;
  }

  it("pays a challenge its bonus once, on top of the hit that did it", () => {
    const sim = stallWith("centres", "five");
    // Three dead centres on three teapots.
    for (let i = 0; i < 3; i++) sim.fire(0.1 + i * 0.6, PLATES[i].x, PLATES[i].y);
    sim.step(4);
    const hits = sim.events.filter((e) => e.k === "hit");
    expect(hits.filter((e) => e.perfect).length).toBeGreaterThanOrEqual(3);
    const done = sim.events.filter((e) => e.k === "task");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ n: 0, bonus: 150 });
    expect(sim.taskDone).toEqual([1, 0]);
    expect(sim.score).toBe(hits.reduce((sum, e) => sum + e.pts, 0) + 150);
    // More dead centres do not pay it again.
    sim.fire(4.1, PLATES[3].x, PLATES[3].y);
    sim.step(6);
    expect(sim.events.filter((e) => e.k === "task")).toHaveLength(1);
  });

  it("counts a run of five, a lamp put out and a prize off the shelf", () => {
    const run = stallWith("five", "bell");
    for (let i = 0; i < 5; i++) run.fire(0.1 + i * 0.6, PLATES[i].x, PLATES[i].y);
    run.step(5);
    expect(run.streak).toBeGreaterThanOrEqual(5);
    expect(run.taskDone).toEqual([1, 0]);

    const knocks = stallWith("lamp", "prize");
    knocks.checkTasks({ k: "prop", what: "vase", broke: false });
    expect(knocks.taskDone).toEqual([0, 0]);
    knocks.checkTasks({ k: "prop", what: "lamp" });
    knocks.checkTasks({ k: "prop", what: "vase", broke: true });
    expect(knocks.taskDone).toEqual([1, 1]);
    expect(knocks.score).toBe(175);
  });

  it("pays nothing before the bell or after time", () => {
    const sim = new StallSim(1, 0);
    sim.tasks = [TASKS.findIndex((task) => task.id === "lamp"), 0];
    sim.checkTasks({ k: "prop", what: "lamp" }); // the count-in
    sim.step(ROUND_SECONDS + 1);
    sim.checkTasks({ k: "prop", what: "lamp" });
    expect(sim.score).toBe(0);
  });

  it("keeps what is done through a snapshot", () => {
    const sim = stallWith("moons", "five");
    sim.taskDone = [0, 1];
    sim.taskMoons = 1;
    sim.taskCentres = 2;
    const copy = loadStall(new StallSim(1, 0), JSON.parse(JSON.stringify(dumpStall(sim))));
    expect([copy.taskDone, copy.taskMoons, copy.taskCentres]).toEqual([[0, 1], 1, 2]);
  });
});

describe("the battle", () => {
  it("plays four bots through a full round with attacks, and never stacks more than two on a stall", () => {
    let worst = 0;
    const { state, events } = runBattle(1234, 4, {
      onEvent: (e, st) => {
        if (e.k !== "atk") return;
        const sim = st.stalls[e.to];
        let n = st.attacks.filter((a) => a.to === e.to && !a.done && !a.landed).length;
        if (sim.t < sim.jamUntil) n++;
        if (sim.t < sim.mothsUntil) n++;
        if (sim.t < sim.darkUntil) n++;
        worst = Math.max(worst, n);
      },
    });
    expect(game.isOver(state)).toBe(true);
    const result = game.result(state);
    expect(result).toHaveLength(4);
    expect(result[0].score).toBeGreaterThan(300);
    expect(result[0].score).toBeGreaterThanOrEqual(result[3].score);
    const kinds = new Set(events.filter((e) => e.k === "atk").map((e) => e.type));
    expect(kinds.has("jam")).toBe(true);
    expect(worst).toBeLessThanOrEqual(2);
    for (const e of events.filter((x) => x.k === "atk")) expect(e.to).not.toBe(e.from);
  });

  it("scores a ricochet the same way in the room: three times over, on top of the run", () => {
    const seats = [0, 1, 2, 3].map((seat) => ({ seat, name: `Bot ${seat}`, kind: "bot" }));
    const state = game.create({ seed: 4321, seats, now: 0, round: 1 });
    state.keep = true; // keep each stall's own events, as a browser does
    let now = 0;
    while (!game.isOver(state) && now < (ROUND_SECONDS + COUNT_IN + 7) * 1000) {
      now += 33;
      for (const s of seats) for (const d of game.bot(state, s.seat, now)) game.input(state, s.seat, d, now);
      game.tick(state, now);
    }
    const hits = state.simEvents.filter((e) => e.k === "hit");
    const ricochets = hits.filter((e) => e.ricochet);
    expect(ricochets.length).toBeGreaterThan(10);
    expect(ricochets.some((e) => e.mult > 1)).toBe(true);
    for (const e of hits) expect(e.pts).toBe(expectedPoints(e));
    // The result the room announces is the sum of those hits and of the challenges done, nothing more.
    const tasks = state.simEvents.filter((e) => e.k === "task");
    for (const row of game.result(state)) {
      const points = hits.filter((e) => e.seat === row.seat).reduce((sum, e) => sum + e.pts, 0);
      const bonus = tasks.filter((e) => e.seat === row.seat).reduce((sum, e) => sum + e.bonus, 0);
      expect(row.score).toBe(points + bonus);
    }
  });

  it("is repeatable from the seed", () => {
    const a = runBattle(77, 3).state;
    const b = runBattle(77, 3).state;
    expect(game.result(a)).toEqual(game.result(b));
    expect(game.result(runBattle(78, 3).state)).not.toEqual(game.result(a));
  });

  it("sends attacks to the leader unless a rival was picked", () => {
    const seats = [0, 1, 2].map((seat) => ({ seat, name: `P${seat}`, kind: "human" }));
    const state = game.create({ seed: 3, seats, now: 0, round: 1 });
    state.stalls[2].score = 500;
    game.input(state, 0, { pick: 1 }, 0);
    const picked = game.tick(state, 10).find((e) => e.k === "pick");
    expect(picked).toEqual({ k: "pick", seat: 0, to: 1 });
    expect(state.picks[0]).toBe(1);
    game.input(state, 0, { pick: -1 }, 20);
    expect(state.picks[0]).toBeUndefined();
    game.input(state, 0, { pick: 0 }, 30); // not yourself
    expect(state.picks[0]).toBeUndefined();
  });

  it("blocks an attack with a dead-centre hit inside the warning and sends it back", () => {
    const seats = [0, 1].map((seat) => ({ seat, name: `P${seat}`, kind: "human" }));
    const state = game.create({ seed: 9, seats, now: 0, round: 1 });
    const at = (t) => (t + COUNT_IN + state.delay) * 1000;
    game.tick(state, at(1));
    // Seat 0 scores three in a row: a jam goes to seat 1.
    for (let i = 0; i < 3; i++) game.input(state, 0, { f: [1.0 + i * 0.6, PLATES[i].x, PLATES[i].y] }, at(1.0 + i * 0.6) - 300);
    let events = [];
    for (let t = 1; t < 2.6; t += 0.033) events.push(...game.tick(state, at(t)));
    const atk = events.find((e) => e.k === "atk");
    expect(atk).toMatchObject({ type: "jam", from: 0, to: 1 });
    // Seat 1 answers with a dead-centre hit before it lands.
    game.input(state, 1, { f: [2.7, PLATES[0].x, PLATES[0].y] }, at(2.7) - 300);
    events = [];
    for (let t = 2.6; t < 6; t += 0.033) events.push(...game.tick(state, at(t)));
    expect(events.find((e) => e.k === "block")).toMatchObject({ id: atk.id, by: 1 });
    const back = events.find((e) => e.k === "atk");
    expect(back).toMatchObject({ type: "jam", from: 1, to: 0, returned: true });
    expect(state.stalls[1].jammed).toBe(false);
    expect(state.stalls[0].jammed).toBe(true);
  });

  it("clamps a timestamp that is too far from the room's clock", () => {
    const seats = [0, 1].map((seat) => ({ seat, name: `P${seat}`, kind: "human" }));
    const state = game.create({ seed: 9, seats, now: 0, round: 1 });
    const now = (5 + COUNT_IN) * 1000;
    game.tick(state, now);
    game.input(state, 0, { f: [60, 0, 1.2] }, now);
    game.input(state, 0, { f: ["x", 0, 1.2] }, now);
    const f = game.tick(state, now + 33).filter((e) => e.k === "f");
    expect(f).toHaveLength(1);
    expect(f[0].at).toBeLessThan(5.2);
    expect(roundTime(state, now)).toBe(5);
  });

  it("rebuilds a stall from a snapshot", () => {
    const { state } = runBattle(5, 2, { until: 30 });
    const snap = JSON.parse(JSON.stringify(game.snapshot(state, 30000)));
    const copy = loadStall(new StallSim(state.seed, 0), snap.stalls[0]);
    expect(dumpStall(copy)).toEqual(snap.stalls[0]);
  });

  it("ends early when only one stall still has corks", () => {
    const seats = [0, 1].map((seat) => ({ seat, name: `P${seat}`, kind: "human" }));
    const state = game.create({ seed: 9, seats, now: 0, round: 1 });
    state.stalls[1].corksLeft = 0;
    let now = 0;
    while (!game.isOver(state) && now < 20000) game.tick(state, (now += 33));
    expect(game.isOver(state)).toBe(true);
    expect(now).toBeLessThan(8000);
  });
});
