// The game as a party room runs it: inputs with their steps, what the room tells everyone, a dropped seat handed
// to the house and back, late joiners, the end, and whole races through the kit's own room with no browser.
import { describe, expect, it } from "vitest";
import { RoomCore } from "n8-party-games/kit/core";
import { game, manifest, testGame } from "../party.js";
import { BTN, DT, rules } from "../shared/rules.js";
import { makeReplica } from "../shared/replica.js";
import { START, runNet, shownError } from "../tools/net.mjs";

const T = rules.T, NET = T.NET;
const LONG = 180_000;
const SEATS = [{ seat: 0, name: "Ann", kind: "human", colour: "#c8382c" }, { seat: 2, name: "Bo", kind: "human", colour: "#d9a02a" }];
const fresh = () => game.create({ seed: 77, seats: SEATS, now: START, round: 1 });
/** The room's clock when the race is at step n (the room runs NET.DELAY behind it). */
const clockAt = (n) => START + n * DT * 1000 + NET.DELAY * 1000 + 0.5;
const msg = (at, steer = 0, go = 1, brake = 0, drift = 0, use = 0, q) => ({ c: [at, steer, go, brake, drift, use], ...(q ? { q } : {}) });
const ALIVE = { h: 1 };
/** A room tick with both players' pages up: each says it is there first, as a racing page does every NET.ALIVE_EVERY. */
const tick = (st, now) => { for (const seat of [0, 2]) game.input(st, seat, ALIVE, now); return game.tick(st, now); };

describe("the contract", () => {
  it("has every part a party room calls, and a manifest that matches", () => {
    for (const k of ["create", "input", "bot", "tick", "snapshot", "isOver", "result", "standings"]) expect(typeof game[k], k).toBe("function");
    expect(game).toMatchObject({ id: "tin-derby", minSeats: 1, maxSeats: 4, tickHz: 30, snapshotEvery: 30 });
    expect(manifest).toMatchObject({ id: game.id, name: "Tin Derby", path: "/tin-derby/", players: { min: 2, max: 4, solo: true } });
    expect(game.tickHz * rules.SUB * DT).toBeCloseTo(1, 12); // a tick is four steps
  });

  it("the room runs the race a fixed delay behind its clock, in whole steps, and catches up after a stall", () => {
    const st = fresh();
    game.tick(st, START + 1000);
    expect(st.n).toBe(Math.floor((1 - NET.DELAY) * 120));
    game.tick(st, START + 1000);
    expect(st.n).toBe(Math.floor((1 - NET.DELAY) * 120)); // the same clock: nothing more to run
    game.tick(st, START + 60_000); // the room stalled for a minute: at most CATCH_UP steps a tick
    expect(st.n).toBe(Math.floor((1 - NET.DELAY) * 120) + NET.CATCH_UP);
  });
});

describe("inputs", () => {
  it("an input takes effect at the step of its stamp when it arrives in time, and everyone is told which", () => {
    const st = fresh();
    tick(st, clockAt(400));
    expect(st.n).toBe(400);
    const at = START + 410.5 * DT * 1000; // the page was in step 410 when it applied it: it holds from step 411
    game.input(st, 0, msg(at, 0.5, 1, 0, 0, 0, 1), clockAt(400) + 20);
    const ev = tick(st, clockAt(404));
    expect(ev).toEqual([{ k: "i", n: 411, c: 0, j: 1, s: 0.5, b: BTN.GO, q: 1 }, { k: "n", n: 404 }]);
    expect(st.cars[0].inSt).toBe(0);
    tick(st, clockAt(410));
    expect(st.cars[0].inSt).toBe(0);
    tick(st, clockAt(411));
    expect(st.cars[0].inSt).toBe(0.5);
    expect(st.cars[0].inB).toBe(BTN.GO);
    expect(st.queue).toHaveLength(0);
  });

  it("a late input takes effect at the next step, never in the past; one stamped far ahead is brought back", () => {
    const st = fresh();
    tick(st, clockAt(400));
    game.input(st, 0, msg(START + 100 * DT * 1000, -1), clockAt(400));
    game.input(st, 2, msg(START + 99_999_999, 1), clockAt(400));
    game.input(st, 2, msg("soon", 0.25), clockAt(400)); // no stamp worth the name: the next step
    const ev = tick(st, clockAt(404)).filter((e) => e.k === "i");
    expect(ev[0]).toMatchObject({ c: 0, n: 401 });
    const latest = rules.stepOf(st, clockAt(400)) + 1 + Math.round(NET.AHEAD / DT);
    expect(ev[1]).toMatchObject({ c: 1, n: latest });
    expect(ev[2]).toMatchObject({ c: 1, n: latest }); // never before the same car's earlier input
  });

  it("steering is rounded to steps, so the same hands send nothing twice", () => {
    const st = fresh();
    tick(st, clockAt(400));
    game.input(st, 0, msg(null, 0.52), clockAt(400));
    game.input(st, 0, msg(null, 0.5), clockAt(400));
    game.input(st, 0, msg(null, 0.49), clockAt(400));
    game.input(st, 0, msg(null, 7), clockAt(400));
    const ev = tick(st, clockAt(404)).filter((e) => e.k === "i");
    expect(ev.map((e) => e.s)).toEqual([0.5, 1]);
    expect(ev.map((e) => e.j)).toEqual([1, 2]);
  });

  it("a tap of Use is never lost, however short: down and up in the same step still uses the power", () => {
    const st = fresh();
    tick(st, clockAt(400));
    st.cars[0].item = "overwind"; st.cars[0].itemT = 0;
    game.input(st, 0, msg(null, 0, 1), clockAt(400));
    game.input(st, 0, msg(null, 0, 1, 0, 0, 1), clockAt(400));
    game.input(st, 0, msg(null, 0, 1, 0, 0, 0), clockAt(400));
    tick(st, clockAt(404));
    expect(st.ev.filter((e) => e.k === "use")).toEqual([expect.objectContaining({ car: 0, item: "overwind" })]);
    expect(st.cars[0].item).toBe(null);
    expect(st.cars[0].inB).toBe(BTN.GO);
  });

  it("says the highest input number it has read from each page, taken or not", () => {
    const st = fresh();
    tick(st, clockAt(400));
    game.input(st, 2, msg(null, 0.5, 1, 0, 0, 0, 7), clockAt(400));
    game.input(st, 2, msg(null, 0.5, 1, 0, 0, 0, 8), clockAt(400)); // nothing new in it: read, not relayed
    expect(game.snapshot(st).room.q).toEqual([0, 8, 0, 0]);
    expect(tick(st, clockAt(404)).filter((e) => e.k === "i")).toHaveLength(1);
  });

  it("refuses rubbish without a word: wrong shapes, unknown seats, a house car's seat, a finished race", () => {
    const st = fresh();
    for (const data of [null, undefined, 7, "left", [], {}, { c: "x" }, { c: [] }, { c: [NaN, NaN, NaN] }, { c: [{}, [], null, "1", true, Infinity] }, { c: [1, 2, 3, 4, 5, 6], q: "9" }, { c: [0, 0, 0, 0, 0, 0], q: -4 }]) {
      expect(() => game.input(st, 0, data, START + 500)).not.toThrow();
    }
    for (const seat of [1, 3, -1, 99, "0", null]) game.input(st, seat, msg(null, 1), START + 500);
    game.tick(st, START + 600);
    for (const c of st.cars) expect(Number.isFinite(c.inSt) && Number.isFinite(c.x)).toBe(true);
    expect(st.cars[1].inSt).toBe(0);
    expect(st.cars[2].inSt === 0 || st.cars[2].house).toBe(true);
    st.over = true;
    game.input(st, 0, msg(null, -1), START + 700);
    expect(st.queue.filter((e) => e[3] === -1)).toHaveLength(0);
  });

  it("a flood from one page fills only that car's queue, and the rest is refused", () => {
    const st = fresh();
    tick(st, clockAt(400));
    for (let k = 0; k < 500; k++) game.input(st, 0, msg(START + 99_999_999, (k % 16) / 16), clockAt(400));
    expect(st.queue).toHaveLength(NET.QUEUE);
    game.input(st, 2, msg(null, 1), clockAt(400));
    expect(st.queue).toHaveLength(NET.QUEUE + 1);
  });
});

describe("what the room tells everyone", () => {
  it("only what a page cannot work out: inputs, hand-overs, and how far it has got", () => {
    const net = runNet(rules, { seed: 4, phones: [{ style: "plain", up: 30, down: 30 }, { style: "sloppy", up: 60, down: 60 }], until: 20, check: false });
    const kinds = new Set(net.stats.relay.map((e) => e.k));
    expect([...kinds].sort()).toEqual(["i", "n"]);
    // It says how far it has got at least five times a second, and every step it names is one it has reached.
    const beats = net.stats.relay.filter((e) => e.k === "n");
    expect(beats.length).toBeGreaterThanOrEqual(Math.floor(net.stats.seconds * 4.9));
    for (let k = 1; k < beats.length; k++) expect(beats[k].n).toBeGreaterThanOrEqual(beats[k - 1].n);
    // Nothing is ever given a step the room had already run when it said so.
    let reached = 0;
    for (const e of net.stats.relay) { if (e.k === "n") reached = e.n; else expect(e.n).toBeGreaterThan(reached); }
  }, LONG);

  it("a snapshot is the whole race as plain JSON, the same for every viewer, small enough to send every second", () => {
    const st = fresh();
    for (let k = 1; k <= 300; k++) { game.input(st, 0, msg(null, (k % 9) / 9, 1, 0, k % 2), START + k * 33); game.tick(st, START + k * 33); }
    const s = game.snapshot(st, START + 9900, { role: "player", seat: 0 });
    expect(game.snapshot(st, START + 9900, { role: "screen" })).toEqual(s);
    const text = JSON.stringify(s);
    expect(JSON.parse(text)).toEqual(s);
    expect(text.length).toBeLessThan(4500);
    expect(s).toMatchObject({ v: rules.VERSION, seed: 77, startAt: START, n: st.n, over: false });
    expect(s.cars).toHaveLength(4);
    expect(s.cars[0]).toHaveLength(rules.CAR_KEYS.length);
    // A page that loads it has the room's race, and running both on gives the same race.
    const copy = rules.load(JSON.parse(text));
    expect(rules.fingerprint(copy)).toBe(rules.fingerprint(st));
    expect(copy.cars[1]).toMatchObject({ seat: 2, name: "Bo", colour: "#d9a02a", house: false });
    rules.advance(copy, st.n + 600); rules.advance(st, st.n + 600);
    expect(rules.fingerprint(copy)).toBe(rules.fingerprint(st));
  });

  it("a snapshot asked for between two ticks holds what has arrived since, and the event that follows is not taken twice", () => {
    const st = fresh();
    tick(st, clockAt(400));
    game.input(st, 0, msg(null, 0.5), clockAt(400) + 5);
    const page = makeReplica(rules, JSON.parse(JSON.stringify(game.snapshot(st, clockAt(400) + 6, { role: "screen" }))));
    expect(page.auth.queue).toHaveLength(1);
    page.events(JSON.parse(JSON.stringify(tick(st, clockAt(404)))));
    expect(page.auth.n).toBe(404);
    expect(rules.fingerprint(page.auth)).toBe(rules.fingerprint(st));
  });
});

describe("a phone that drops", () => {
  it("the house takes the car from the next step, drives it as it drives its own, and hands it back", () => {
    const st = fresh();
    tick(st, clockAt(480));
    game.input(st, 0, msg(null, -1, 0, 1), clockAt(480)); // Ann is braking hard left when her phone drops
    let ev = tick(st, clockAt(484));
    expect(st.cars[0].inB).toBe(BTN.BRAKE);
    // The room asks the stand-in each tick the phone is away (it returns no inputs: the rules drive the car).
    expect(game.bot(st, 0, clockAt(488))).toEqual([]);
    ev = tick(st, clockAt(488));
    expect(ev.filter((e) => e.k === "a")).toEqual([{ k: "a", n: 485, c: 0, j: 2, on: 1 }]);
    expect(st.cars[0].auto).toBe(true);
    expect(st.cars[0].inB & BTN.GO).toBe(BTN.GO);
    const s0 = st.cars[0].s;
    for (let n = 492; n <= 1200; n += 4) { game.bot(st, 0, clockAt(n)); game.input(st, 0, msg(null, 1, 0, 1), clockAt(n)); expect(tick(st, clockAt(n)).filter((e) => e.k === "a")).toHaveLength(0); }
    expect(st.cars[0].s - s0).toBeGreaterThan(30); // it raced on, whatever a stale page went on sending
    expect(st.cars[0].auto).toBe(true);
    // The phone is back: the room stops asking, and the car is the player's again from the next step.
    ev = tick(st, clockAt(1204));
    expect(ev.filter((e) => e.k === "a")).toEqual([{ k: "a", n: 1201, c: 0, j: expect.any(Number), on: 0 }]);
    expect(st.cars[0].auto).toBe(false);
    expect([st.cars[0].inSt, st.cars[0].inB]).toEqual([0, BTN.GO]); // rolling straight on until its player says otherwise
    game.input(st, 0, msg(null, 0.5, 1), clockAt(1204));
    tick(st, clockAt(1208));
    expect(st.cars[0].inSt).toBe(0.5);
  });

  it("a car the house is driving for a player paces itself like a house car but is not what the house cars pace themselves by", () => {
    const st = fresh();
    for (let n = 4; n <= 600; n += 4) { game.bot(st, 0, clockAt(n)); tick(st, clockAt(n)); }
    expect(st.cars[0].auto).toBe(true);
    expect(st.cars[0].cap).toBeCloseTo(T.TOP_SPEED * T.HABITS.ace.pace, 6);
    expect(st.cars[0].house).toBe(false); // it keeps its seat and its place in the result
    expect(game.result(st).map((r) => r.seat).sort()).toEqual([0, 2]);
  });

  it("over a whole race with delays: every page's copy is the room's at every step, through a drop, a return and a reload", () => {
    const net = runNet(rules, {
      seed: 3,
      phones: [{ style: "plain", up: 40, down: 40, dropAt: 10, backAt: 20 }, { style: "plain", up: 60, down: 60, jitter: 50, dropAt: 15, backAt: 30, reload: true }, { style: "sloppy", up: 90, down: 90 }],
      screens: [{ down: 50, joinAt: 12 }, { down: 20 }],
    });
    const s = net.stats;
    expect(net.state.over).toBe(true);
    expect(s.mismatches).toEqual([]);
    expect(s.checked).toBeGreaterThan(1000);
    const autos = s.relay.filter((e) => e.k === "a").map((e) => [e.c, e.on]);
    expect(autos).toEqual([[0, 1], [1, 1], [0, 0], [1, 0]]);
    // The dropped cars kept racing and every seat has a place and a time.
    const result = game.result(net.state);
    expect(result.map((r) => r.place)).toEqual([1, 2, 3]);
    for (const r of result) expect(r.time).toBeGreaterThan(40);
    // The late screen and the reloaded phone ended with the room's race.
    for (const v of net.viewers) expect(rules.fingerprint(v.replica.auth)).toBe(rules.fingerprint(net.state));
    // And the race can be made again from nothing but its seed, its seats and what the room relayed.
    expect(shownError(rules, net).truth).toBe(rules.fingerprint(net.state));
  }, LONG);
});

describe("a page that cannot drive, stalls, or is late", () => {
  const handOvers = (ev) => ev.filter((e) => e.k === "a").map((e) => [e.c, e.on]);

  it("{house: 1} gives the sender's own car to the house at once; a beat does not take it back, hands do", () => {
    const st = fresh();
    tick(st, clockAt(400));
    game.input(st, 0, { house: 1 }, clockAt(400) + 3);
    let ev = tick(st, clockAt(404));
    expect(ev.filter((e) => e.k === "a")).toEqual([{ k: "a", n: 401, c: 0, j: 1, on: 1 }]);
    expect(st.cars[0].auto).toBe(true);
    expect(st.cars[1].auto).toBe(false); // Bo's car is his own
    // The page goes on saying it is there (the tick helper beats for both seats): the car stays the house's.
    for (let n = 408; n <= 600; n += 4) expect(handOvers(tick(st, clockAt(n)))).toEqual([]);
    expect(st.cars[0].auto).toBe(true);
    // Hands from that page (a reload that can draw): the car is the player's again, handed back before its input.
    game.input(st, 0, msg(null, 0.5, 1), clockAt(600) + 2);
    ev = tick(st, clockAt(604));
    expect(ev.filter((e) => e.k !== "n").map((e) => e.k + e.c + (e.k === "a" ? e.on : ""))).toEqual(["a00", "i0"]);
    expect(st.cars[0].auto).toBe(false);
    expect(st.cars[0].inSt).toBe(0.5);
  });

  it("{house: 1} is refused from anyone but a player in the race, for a house car, once the race is over, or in any other shape; said twice it is one hand-over", () => {
    const st = fresh();
    tick(st, clockAt(400));
    for (const seat of [1, 3, -1, -2, 99, "0", null, undefined]) game.input(st, seat, { house: 1 }, clockAt(400));
    for (const data of [{ house: true }, { house: "1" }, { house: 2 }, { h: true }, { h: "1" }, { House: 1 }, "house", [1]]) game.input(st, 0, data, clockAt(400));
    expect(handOvers(tick(st, clockAt(404)))).toEqual([]);
    for (const c of st.cars) expect(c.auto).toBe(false);
    game.input(st, 2, { house: 1 }, clockAt(404));
    game.input(st, 2, { house: 1 }, clockAt(404));
    game.input(st, 2, { house: 1, h: 1 }, clockAt(405));
    expect(handOvers(tick(st, clockAt(408)))).toEqual([[1, 1]]);
    // A page that keeps flipping between "house" and hands makes at most one hand-over a message, all for its own car.
    let flips = 0;
    for (let k = 0; k < 40; k++) game.input(st, 2, k % 2 ? { house: 1 } : msg(null, (k % 8) / 8), clockAt(408) + k);
    for (const [c] of handOvers(tick(st, clockAt(412)))) { expect(c).toBe(1); flips++; }
    expect(flips).toBeLessThanOrEqual(40);
    expect(st.cars[0].auto).toBe(false);
    st.over = true;
    game.input(st, 0, { house: 1 }, clockAt(412));
    expect(st.net.filter((e) => e.k === "a")).toEqual([]);
  });

  it("a phone that stalls for 5 s without closing its socket: the house drives its car within about a second, hands it back when it speaks again, and the car finishes", () => {
    const net = runNet(rules, { seed: 5, phones: [{ style: "plain", up: 40, down: 40, freezeAt: 12, freezeFor: 5 }, { style: "plain", up: 40, down: 40 }] });
    const a = net.stats.relay.filter((e) => e.k === "a");
    expect(a.map((e) => [e.c, e.on])).toEqual([[0, 1], [0, 0]]);
    const raceT = (n) => n * DT - T.COUNT_IN;
    // Its last word came at most ALIVE_EVERY before the stall; the room runs DELAY behind its clock.
    expect(raceT(a[0].n)).toBeGreaterThan(12 + NET.SILENT - NET.ALIVE_EVERY - NET.DELAY - 0.05);
    expect(raceT(a[0].n)).toBeLessThan(12 + NET.SILENT + 0.2);
    expect(raceT(a[1].n)).toBeGreaterThan(17 - NET.DELAY - 0.05);
    expect(raceT(a[1].n)).toBeLessThan(17 + 0.5);
    expect(net.state.over).toBe(true);
    expect(net.stats.mismatches).toEqual([]);
    for (const r of game.result(net.state)) expect(r.time).toBeGreaterThan(40);
  }, LONG);

  it("no hand-over on a quiet straight: hands that never change (held Up all race) still say the page is there", () => {
    const net = runNet(rules, { seed: 8, phones: [{ style: "handsoff", up: 60, down: 60, jitter: 40 }, { style: "plain", up: 40, down: 40 }] });
    expect(net.state.over).toBe(true);
    expect(net.stats.relay.filter((e) => e.k === "a")).toEqual([]);
    const [still] = net.stats.up;
    expect(still.n).toBeLessThanOrEqual(2); // its hands: Up, once
    // ...and about four beats a second, light enough: well under the room's 20 messages a second.
    expect(still.beats / net.stats.seconds).toBeGreaterThan(3);
    expect(still.beats / net.stats.seconds).toBeLessThan(4.5);
  }, LONG);

  it("a page that loads late: the house drives its car from GO until its first word, then hands it back", () => {
    const net = runNet(rules, { seed: 2, phones: [{ style: "plain", up: 40, down: 40 }, { style: "plain", up: 40, down: 40, silent: 6 }], until: 15 });
    const a = net.stats.relay.filter((e) => e.k === "a");
    expect(a.map((e) => [e.c, e.on])).toEqual([[1, 1], [1, 0]]);
    expect(Math.abs(a[0].n * DT - T.COUNT_IN)).toBeLessThan(0.05); // from the start of the race, not a step of it parked
    expect(a[1].n * DT - T.COUNT_IN).toBeGreaterThan(6 - NET.DELAY - 0.05);
    expect(a[1].n * DT - T.COUNT_IN).toBeLessThan(6.3);
    // It raced on meanwhile, as far as the house drives in six seconds.
    const car = net.state.cars[1];
    expect(car.s).toBeGreaterThan(40);
  }, LONG);

  it("a page that never says a word at all is the house's for the whole race, and the race ends with its car home", () => {
    const net = runNet(rules, { seed: 2, phones: [{ style: "plain" }, { style: "plain", silent: true }] });
    expect(net.stats.relay.filter((e) => e.k === "a").map((e) => [e.c, e.on])).toEqual([[1, 1]]);
    expect(net.state.over).toBe(true);
    expect(game.result(net.state).every((r) => r.time > 40)).toBe(true);
  }, LONG);
});

describe("a test run's short race", () => {
  const SEATS1 = [{ seat: 0, name: "Ann", kind: "human", colour: "#c8382c" }];

  it("production's game ignores {short: 1}: two laps and the full last call, whatever a page sends", () => {
    const st = game.create({ seed: 5, seats: SEATS1, now: START });
    game.input(st, 0, { short: 1 }, START + 100);
    expect(game.tick(st, START + 200).filter((e) => e.k === "len")).toEqual([]);
    expect([rules.lapsOf(st), st.call]).toEqual([T.LAPS, undefined]);
    expect(game.snapshot(st)).not.toHaveProperty("laps");
  });

  it("the test wall's game takes it in the count-in only, once: one lap and a short last call, told to everyone and in the snapshot", () => {
    const st = testGame.create({ seed: 5, seats: SEATS1, now: START });
    const page = makeReplica(rules, JSON.parse(JSON.stringify(testGame.snapshot(st))), { seat: 0 });
    testGame.input(st, 0, { short: 1 }, START + 100);
    testGame.input(st, 0, { short: 1 }, START + 110);
    const ev = testGame.tick(st, START + 200);
    expect(ev.filter((e) => e.k === "len")).toEqual([{ k: "len", laps: 1, call: 5 }]);
    page.events(JSON.parse(JSON.stringify(ev)));
    expect(rules.lapsOf(page.auth)).toBe(1);
    expect(testGame.snapshot(st)).toMatchObject({ laps: 1, call: 5 });
    // A whole race: the house drives Ann's car (her page never says another word), one lap, and it is over.
    let now = START + 200;
    while (!st.over && now < START + 120_000) { now += 33; testGame.tick(st, now); }
    expect(st.over).toBe(true);
    expect((now - START) / 1000).toBeLessThan(T.COUNT_IN + 50);
    expect(testGame.result(st)[0].time).toBeGreaterThan(15);
    // Too late: once the race is under way nothing changes its length.
    const late = testGame.create({ seed: 5, seats: SEATS1, now: START });
    testGame.tick(late, START + (T.COUNT_IN + 1) * 1000);
    testGame.input(late, 0, { short: 1 }, START + (T.COUNT_IN + 1) * 1000);
    expect(rules.lapsOf(late)).toBe(T.LAPS);
  });

  it("the test wall's game says, on a hand-over for silence, how long it had heard nothing and when it last looked; production's says neither", () => {
    // Ann's page says it is there until the race is 2 s old, then stalls with its socket open. The room looks every
    // 33 ms, then a busy machine makes one look 700 ms late: the car still goes at the first look past NET.SILENT.
    const run = (g, lateBy) => {
      const st = g.create({ seed: 5, seats: SEATS1, now: START });
      const stall = START + (T.COUNT_IN + 2) * 1000, a = [];
      let now = START;
      while (!a.length && now < stall + 5000) {
        now += now >= stall + 900 && now < stall + 933 ? lateBy : 33;
        if (now <= stall) g.input(st, 0, ALIVE, now);
        a.push(...g.tick(st, now).filter((e) => e.k === "a"));
      }
      return a;
    };
    for (const lateBy of [33, 700]) {
      const [e] = run(testGame, lateBy);
      expect(e).toMatchObject({ k: "a", c: 0, on: 1 });
      expect(e.quiet).toBeGreaterThan(NET.SILENT * 1000);
      expect(e.quiet - e.gap).toBeLessThanOrEqual(NET.SILENT * 1000);
      expect(e.gap).toBe(lateBy);
    }
    const [e] = run(game, 33);
    expect(e).toMatchObject({ k: "a", c: 0, on: 1 });
    expect(e).not.toHaveProperty("quiet");
    expect(e).not.toHaveProperty("gap");
    // A closed socket is not silence: the hand-over for it says neither, even on the test wall.
    const st = testGame.create({ seed: 5, seats: SEATS1, now: START });
    const at = START + (T.COUNT_IN + 2) * 1000;
    testGame.input(st, 0, ALIVE, at);
    testGame.tick(st, at);
    testGame.bot(st, 0);
    const [d] = testGame.tick(st, at + 33).filter((x) => x.k === "a");
    expect(d).toMatchObject({ k: "a", c: 0, on: 1 });
    expect(d).not.toHaveProperty("quiet");
  });
});

describe("what a phone shows", () => {
  it("its own car exactly where the room will put it when its inputs arrive in time; late ones cost a fraction of a length", () => {
    const net = runNet(rules, { seed: 6, phones: [{ style: "plain", up: 40, down: 40 }, { style: "sloppy", up: 260, down: 120 }], until: 40 });
    expect(net.stats.mismatches).toEqual([]);
    const [fast, slow] = shownError(rules, net).rows;
    expect(fast.own.frames).toBeGreaterThan(2000);
    expect(fast.own.max).toBeLessThan(1e-6); // on time (40 ms against a delay of 150): no correction at all
    expect(fast.rivals.mean).toBeLessThan(0.1);
    expect(slow.own.mean).toBeLessThan(0.3); // late (260 ms): corrected, by a little
    expect(slow.own.max).toBeLessThan(3);
  }, LONG);

  it("a page sends a steer change at most 15 times a second, and nothing while the hands are still", () => {
    const net = runNet(rules, { seed: 6, phones: [{ style: "plain", up: 40, down: 40, wobble: true }, { style: "handsoff", up: 40, down: 40 }], until: 20, check: false });
    const [busy, still] = net.stats.up;
    expect(busy.n / net.stats.seconds).toBeLessThanOrEqual(15.5);
    expect(busy.n / net.stats.seconds).toBeGreaterThan(8);
    expect(still.n).toBeLessThanOrEqual(2);
  }, LONG);
});

describe("the end", () => {
  it("isOver, a last word on how far the room got, and a result the Tonight board can read", () => {
    const net = runNet(rules, { seed: 9, phones: [{ style: "plain" }, { style: "handsoff" }] });
    const st = net.state;
    expect(game.isOver(st)).toBe(true);
    expect(net.stats.relay[net.stats.relay.length - 1]).toEqual({ k: "n", n: st.n });
    expect(game.tick(st, START + 999_000)).toEqual([]); // nothing more to say
    const standings = game.standings(st), result = game.result(st);
    expect(standings).toEqual([{ seat: expect.any(Number), place: 1 }, { seat: expect.any(Number), place: 2 }]);
    expect(result.map(({ seat, place }) => ({ seat, place }))).toEqual(standings);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    // A race is over in well under the cap: about a minute, plus the count-in.
    expect(net.stats.seconds).toBeLessThan(T.COUNT_IN + T.RACE_CAP + 1);
    expect(net.stats.seconds).toBeLessThan(95);
  }, LONG);
});

describe("in the kit's own room, with no browser", () => {
  /** A whole room: two people join, ready up and race; the room ticks on a made-up clock. */
  function party() {
    let now = START;
    const core = new RoomCore({ game, seed: 4242, code: "TINS", now });
    const ann = core.join("Ann", now), bo = core.join("Bo", now);
    core.connect(ann.token, now); core.connect(bo.token, now);
    core.setReady(ann.seat, true); core.setReady(bo.seat, true);
    expect(core.start(now)).toEqual({ ok: true });
    return { core, ann, bo, tick(ms = 33) { now += ms; return { out: core.tick(now), now }; }, now: () => now };
  }

  it("starts a race for the room's seats and fills the grid with house cars", () => {
    const { core } = party();
    expect(core.phase).toBe("playing");
    expect(core.state.cars.map((c) => [c.seat, c.house])).toEqual([[0, false], [1, false], [-1, true], [-2, true]]);
    const snap = core.snapshotFor(core.viewerOf({ role: "player", seat: 0 }), START);
    expect(snap.n).toBe(0);
  });

  it("runs a whole race: inputs in, events and snapshots out, a dropped player's car driven on and handed back, places at the end", () => {
    const p = party(), { core, ann, bo } = p;
    const page = makeReplica(rules, JSON.parse(JSON.stringify(core.snapshotFor({ role: "screen" }, START))), { seat: bo.seat });
    let ticks = 0, snaps = 0, ended = null, dropped = false, back = false;
    const autos = [];
    while (!ended && ticks < 30 * 140) {
      const { out, now } = p.tick();
      ticks++;
      // Bo's page: it hears the room, and steers by what it predicts (a little weave, flat out).
      const ev = JSON.parse(JSON.stringify(out.events));
      for (const e of ev) if (e.k === "a") autos.push([e.c, e.on]);
      page.events(ev);
      if (out.snap) { snaps++; page.snapshot(JSON.parse(JSON.stringify(core.snapshotFor({ role: "screen" }, now)))); }
      const m = page.input(now, Math.sin(ticks / 20) * 0.3, 1, 0, 0, 0);
      if (m) expect(core.input(bo.seat, m, now)).toBe(true);
      // Ann never steers, but her page is up and says so; her phone drops ten seconds in and is back ten seconds later.
      if (!dropped || back) core.input(ann.seat, { h: 1 }, now);
      if (!dropped && ticks === 300) { core.disconnect(ann.token, now); dropped = true; }
      if (dropped && !back && ticks === 600) { core.connect(ann.token, now); back = true; }
      if (out.ended) ended = { now, result: core.result };
    }
    expect(ended, "the race ended").toBeTruthy();
    expect(core.phase).toBe("ended");
    expect(autos).toEqual([[0, 1], [0, 0]]);
    expect(snaps).toBeGreaterThan(50);
    expect(rules.fingerprint(page.auth)).toBe(rules.fingerprint(core.state));
    expect(ended.result).toHaveLength(2);
    expect(ended.result.map((r) => r.place)).toEqual([1, 2]);
    expect(ended.result.map((r) => r.seat).sort()).toEqual([0, 1]);
    // What a party pays for: the room was awake for the race and no longer.
    expect((ended.now - START) / 1000).toBeLessThan(T.COUNT_IN + T.RACE_CAP + 1);
  }, LONG);
});
