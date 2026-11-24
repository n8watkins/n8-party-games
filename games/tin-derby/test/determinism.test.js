// A race is a function of its seed, its seats and its inputs: the same three give the same race, bit for bit,
// however the steps are cut up, wherever it was saved and carried on, and whichever engine runs it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hash, rules } from "../shared/rules.js";
import { RACES, fingerprints } from "../tools/fingerprints.mjs";
import { runRace } from "../tools/race.mjs";

const LONG = 180_000;
const golden = JSON.parse(readFileSync(new URL("./golden.json", import.meta.url), "utf8"));
const tool = fileURLToPath(new URL("../tools/fingerprints.mjs", import.meta.url));
const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
const hasBun = bun.status === 0;

/** A fixed list of inputs for two players, each with the step it takes effect at: what a room would have relayed. */
function script(seed, steps) {
  const list = [], count = [0, 0];
  for (let n = 30; n < steps; n += 7 + Math.floor(hash(seed, n) * 40)) {
    const c = hash(seed + 1, n) < 0.5 ? 0 : 1, r = hash(seed + 2, n);
    list.push({ k: "i", n, c, j: ++count[c], s: Math.round((hash(seed + 3, n) * 2 - 1) * 16) / 16, b: 1 | (r < 0.1 ? 2 : 0) | (r > 0.7 ? 4 : 0) | (r > 0.5 && r < 0.6 ? 8 : 0) });
  }
  return list;
}
const SEATS = [{ seat: 0, name: "Ann", character: "ghost" }, { seat: 1, name: "Bo", character: "robot" }];
/** Runs the script, stopping wherever `cuts` says (a list of steps), and returns the race at `steps`. */
function play(seed, steps, cuts = [], { reload = false } = {}) {
  let st = rules.createRace({ seed, seats: SEATS, now: 0, delay: 0 });
  for (const e of script(seed, steps)) rules.hear(st, e);
  for (const cut of [...cuts, steps]) {
    rules.advance(st, Math.min(cut, steps));
    // Saved as text, as a snapshot goes over the wire, and carried on from the text.
    if (reload) st = rules.load(JSON.parse(JSON.stringify(rules.dump(st))));
  }
  return st;
}

describe("the same inputs give the same race", () => {
  it("twice over, to the last bit; another seed gives another race", () => {
    const a = runRace(rules, { seed: 31, humans: [{ style: "plain" }, { style: "sloppy" }] });
    const b = runRace(rules, { seed: 31, humans: [{ style: "plain" }, { style: "sloppy" }] });
    const c = runRace(rules, { seed: 32, humans: [{ style: "plain" }, { style: "sloppy" }] });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(JSON.stringify(rules.dump(b.state))).toBe(JSON.stringify(rules.dump(a.state)));
    expect(c.fingerprint).not.toBe(a.fingerprint);
  }, LONG);

  it("however the steps are cut into ticks: one at a time, a room's four, or a room that stalled and caught up", () => {
    const steps = 120 * 50;
    const whole = rules.fingerprint(play(77, steps));
    const single = [], fours = [], ragged = [];
    for (let n = 1; n < steps; n++) single.push(n);
    for (let n = 4; n < steps; n += 4) fours.push(n);
    for (let n = 3; n < steps; n += 1 + Math.floor(hash(9, n) * 300)) ragged.push(n);
    expect(rules.fingerprint(play(77, steps, single))).toBe(whole);
    expect(rules.fingerprint(play(77, steps, fours))).toBe(whole);
    expect(rules.fingerprint(play(77, steps, ragged))).toBe(whole);
  }, LONG);

  it("saved as text and carried on from it at any step: a snapshot is the whole race", () => {
    const steps = 120 * 50;
    const whole = play(77, steps);
    const cuts = [1, 2, 359, 360, 361, 1000, 2501, 4000, 4001, 5999];
    const carried = play(77, steps, cuts, { reload: true });
    expect(rules.fingerprint(carried)).toBe(rules.fingerprint(whole));
    expect(JSON.stringify(rules.dump(carried))).toBe(JSON.stringify(rules.dump(whole)));
    // And the script did something: both cars moved, and it is not the race with no inputs.
    expect(whole.cars[0].s).toBeGreaterThan(50);
    expect(rules.fingerprint(whole)).not.toBe(rules.fingerprint(rules.advance(rules.createRace({ seed: 77, seats: SEATS, now: 0, delay: 0 }), steps)));
  }, LONG);

  it("a dump is plain JSON, shares nothing with the race, and a copy runs on its own", () => {
    const st = play(5, 2000);
    const d = rules.dump(st);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    const copy = rules.clone(st), before = rules.fingerprint(st);
    rules.advance(copy, 2600);
    copy.cars[0].x = 999; copy.queue.push([1, 0, 1, 0, 0]); copy.room.q[0] = 99;
    expect(rules.fingerprint(st)).toBe(before);
    expect(st.n).toBe(2000);
    expect(rules.dump(st)).toEqual(d);
  });

  it("a dump made by other rules is refused, not guessed at", () => {
    const d = rules.dump(rules.createRace({ seed: 1 }));
    expect(() => rules.load({ ...d, v: rules.VERSION + 1 })).toThrow(/version/);
    expect(() => rules.load(null)).toThrow();
  });

  it("when the clock starts makes no difference: only the steps count", () => {
    const at = (now) => {
      const st = rules.createRace({ seed: 8, seats: SEATS, now, delay: 0 });
      rules.takeInput(st, 0, { c: [now + 4000, 0.5, 1, 0, 0, 0] }, now + 10);
      rules.advance(st, rules.stepOf(st, now + 9000));
      const d = rules.dump(st);
      delete d.startAt;
      return JSON.stringify(d);
    };
    expect(at(1_700_000_000_123)).toBe(at(0));
  });
});

describe("the same race on every engine", () => {
  it("Node gives the fingerprints kept in golden.json (after a change that was meant: node tools/fingerprints.mjs --write)", () => {
    expect(Object.keys(golden)).toEqual(RACES.map((r) => r.name));
    expect(fingerprints()).toEqual(golden);
  }, LONG);

  it.skipIf(!hasBun)("JavaScriptCore (Bun), the engine of every iPhone browser, gives the very same", () => {
    const out = spawnSync("bun", [tool], { encoding: "utf8", timeout: LONG });
    expect(out.status, out.stderr).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(golden);
  }, LONG);
});
