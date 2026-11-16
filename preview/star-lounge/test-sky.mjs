// Runs the sky's timetable (src/sky.js) for a long simulated time and checks its promises:
// one thing at a time, empty sky between, a rare thing stays rare.
//
//   node preview/star-lounge/test-sky.mjs [--hours=500]
//
// It prints the numbers the page's Notes quote ("how often things pass"), and exits with 1 if a promise is broken.
import assert from "node:assert/strict";
import { THINGS, TIMES, createSky } from "./src/sky.js";

const hours = Number((process.argv.find((a) => a.startsWith("--hours=")) ?? "--hours=500").split("=")[1]);
const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

/** Runs the clock the way a page does: about sixty frames a second, some late, some very late. */
function run({ seed, seconds, meddle = false }) {
  const rnd = seeded(seed);
  const frame = seeded(seed + 7);
  const sky = createSky(rnd);
  const seen = []; // every passing, as the page saw it: { name, family, start, end, firstU, lastU, by }
  let cur = null;
  let curObj = null;
  let t = 0;
  let frames = 0;
  while (t < seconds) {
    const r = frame();
    t += r < 0.97 ? 1 / 60 : r < 0.995 ? 0.05 : 0.1; // the page never steps its clock by more than a tenth of a second
    frames++;
    let by = "timetable";
    if (meddle) {
      // Someone tapping the glass and pressing "send one now" at random, sometimes many times in a row.
      const m = frame();
      if (m < 0.004) {
        if (sky.startIfEmpty("star", t)) by = "tap";
      } else if (m < 0.006) {
        sky.ask(THINGS[Math.floor(frame() * THINGS.length)].name, t);
      }
    }
    const before = sky.now;
    const now = sky.step(t);
    if (now !== curObj) {
      if (cur) cur.seenEnd = t;
      curObj = now;
      cur = now ? { name: now.thing.name, family: now.thing.family, lasts: now.thing.lasts, start: now.start, end: now.end, firstU: now.u, lastU: now.u, seenStart: t, by: before === now ? by : by } : null;
      if (cur) seen.push(cur);
    } else if (now) {
      assert.ok(now.u >= cur.lastU, `${cur.name} went backwards along its way`);
      cur.lastU = now.u;
    }
  }
  return { seen, frames, seconds: t };
}

// ---------------------------------------------------------------- 1. left alone
const quietRun = run({ seed: 11, seconds: hours * 3600 });
const { seen } = quietRun;
assert.ok(seen.length > 100, "the sky did nothing");
assert.equal(seen[0].name, "rocket", "the first thing to pass is the rocket");
assert.ok(Math.abs(seen[0].start - TIMES.first) < 0.11, `the first thing passes ${TIMES.first} seconds in (it came at ${seen[0].start.toFixed(2)})`);
let smallestGap = Infinity;
let largestGap = 0;
let busy = 0;
for (const [i, e] of seen.entries()) {
  assert.ok(e.firstU <= 0.12 / Math.max(e.lasts, 0.9) + 1e-9, `${e.name} did not begin at the start of its way`);
  if (i === seen.length - 1) break; // the last one may be cut off by the end of the run
  assert.ok(Math.abs(e.end - e.start - e.lasts) < 1e-9, `${e.name} was given the wrong time`);
  assert.ok(e.lastU > 1 - 0.11 / e.lasts, `${e.name} vanished before the end of its way (it reached ${e.lastU.toFixed(3)})`);
  const next = seen[i + 1];
  const gap = next.start - e.end;
  assert.ok(gap >= TIMES.quiet[0], `${next.name} came ${gap.toFixed(2)} s after ${e.name} had gone: less than the ${TIMES.quiet[0]} s of empty sky promised`);
  assert.ok(gap <= TIMES.quiet[1] + 0.11, `the sky stayed empty for ${gap.toFixed(2)} s, longer than ${TIMES.quiet[1]} s`);
  assert.notEqual(next.family, e.family, `two of the same kind in a row: ${e.name}, then ${next.name}`);
  smallestGap = Math.min(smallestGap, gap);
  largestGap = Math.max(largestGap, gap);
  busy += e.lasts;
}
const families = [...new Set(THINGS.map((t) => t.family))];
const count = Object.fromEntries(families.map((f) => [f, seen.filter((e) => e.family === f).length]));
const perHour = (f) => count[f] / (quietRun.seconds / 3600);
// A rare thing stays rare: the saucer is the rarest, the liner next, and neither comes more than the page says.
for (const f of families) if (f !== "saucer") assert.ok(count.saucer < count[f], `the saucer (${count.saucer}) is not rarer than the ${f} (${count[f]})`);
assert.ok(count.liner < count.rocket && count.liner < count.rock && count.liner < count.star, "the liner is not rarer than the rocket, the rocks and the shooting stars");
assert.ok(perHour("saucer") < 6, `the saucer passes ${perHour("saucer").toFixed(1)} times an hour: not rare`);
assert.ok(perHour("liner") < 12, `the liner passes ${perHour("liner").toFixed(1)} times an hour: not rare`);
const emptyShare = 1 - busy / quietRun.seconds;
assert.ok(emptyShare > 0.6, `the sky is empty only ${(emptyShare * 100).toFixed(0)}% of the time`);

// ---------------------------------------------------------------- 2. with someone tapping the glass and asking for things
const busyRun = run({ seed: 23, seconds: Math.min(hours, 100) * 3600, meddle: true });
for (const [i, e] of busyRun.seen.entries()) {
  if (i === busyRun.seen.length - 1) break;
  const next = busyRun.seen[i + 1];
  assert.ok(next.start >= e.end, `${next.name} began ${(e.end - next.start).toFixed(2)} s before ${e.name} had gone`);
  assert.ok(next.seenStart >= e.seenEnd, `the page saw ${next.name} while ${e.name} was still there`);
}
// A thing that was asked for by name still waits for the sky to clear.
{
  const sky = createSky(seeded(5));
  let t = 0;
  while (!sky.step(t)) t += 1 / 60; // the rocket
  assert.equal(sky.ask("liner", t), "rocket", "asking while the rocket passes says what it is waiting for");
  assert.equal(sky.startIfEmpty("star", t), false, "a tap cannot start a shooting star while the rocket passes");
  const rocketEnd = sky.now.end;
  while (sky.step(t)?.thing.name === "rocket") t += 1 / 60;
  assert.equal(sky.now, null, "the sky is empty the moment the rocket has gone");
  while (!sky.step(t)) t += 1 / 60;
  assert.equal(sky.now.thing.name, "liner");
  assert.ok(sky.now.start - rocketEnd >= TIMES.askedQuiet, "the liner that was asked for still left a few seconds of empty sky");
}

// ---------------------------------------------------------------- the numbers
const every = (f) => {
  const m = 60 / perHour(f);
  return m >= 1 ? `${m.toFixed(1)} min` : `${(m * 60).toFixed(0)} s`;
};
console.log(`left alone for ${hours} simulated hours (${quietRun.frames.toLocaleString("en")} frames): ${seen.length} things passed, never two at once`);
console.log(`  empty sky between two things: never less than ${smallestGap.toFixed(1)} s, never more than ${largestGap.toFixed(1)} s (the rule: ${TIMES.quiet[0]} to ${TIMES.quiet[1]} s)`);
console.log(`  the sky is empty ${(emptyShare * 100).toFixed(0)}% of the time; something passes about every ${(quietRun.seconds / seen.length).toFixed(0)} s on average`);
for (const f of families) console.log(`  ${f.padEnd(7)} ${perHour(f).toFixed(1).padStart(5)} an hour, one about every ${every(f)}`);
console.log(`with taps and asks at random for ${Math.min(hours, 100)} simulated hours: ${busyRun.seen.length} things passed (${busyRun.seen.filter((e) => e.by === "tap").length} called by a tap), never two at once`);
console.log("the sky keeps its promises");
