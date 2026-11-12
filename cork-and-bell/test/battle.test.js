import { describe, expect, it } from "vitest";
import { game, createBattle, roundTime, dumpStall, loadStall, COUNT_IN } from "../game/shared/battle.js";
import { StallSim, ROUND_SECONDS, launch, predict, mech, CORKS_PER_ROUND } from "../game/shared/sim.js";
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
