// The picture's resolution governor (page/governor.js): when a page draws fewer pixels, and when it earns them back.
import { describe, expect, it } from "vitest";
import { makeGovernor, RECOVER } from "../page/governor.js";
import { TUNE } from "../data/tune.js";

const gov = () => makeGovernor({ slowMs: TUNE.GOV_SLOW_MS });
/** Feeds frames; returns every change it asked for, as [frame index, -1 | +1]. */
function run(g, frames) {
  const out = [];
  frames.forEach((ms, k) => { const s = g.frame(ms); if (s) out.push([k, s]); });
  return out;
}
const many = (n, ms) => Array(n).fill(ms);
/** A 60 Hz screen whose frame times wobble by up to ±4 ms (as Firefox rounds them), seeded so the test is the same each run. */
function jittered(n, seed = 7) {
  let x = seed;
  const next = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, () => 16.7 + (next() * 8 - 4));
}

describe("the resolution governor", () => {
  it("one long stall and two frames a little slow do not lower the picture (the review's 1.46 s and 21 ms)", () => {
    expect(run(gov(), [...many(120, 16.7), 1460, 21, 21, ...many(600, 16.7)]).filter(([, s]) => s < 0)).toEqual([]);
  });

  it("a screen crawling at a few frames a second lowers it within three frames, and again three frames later", () => {
    expect(run(gov(), many(6, 650))).toEqual([[2, -1], [5, -1]]);
  });

  it("forty dropped frames in a row at 60 Hz lower it; thirty-nine do not", () => {
    expect(run(gov(), [...many(60, 16.7), ...many(39, 33.4), 16.7])).toEqual([]);
    expect(run(gov(), [...many(60, 16.7), ...many(40, 33.4)])).toEqual([[99, -1]]);
  });

  it("a page stuck at 30 frames a second from its first frame still counts as slow", () => {
    expect(run(gov(), many(40, 33.4))).toEqual([[39, -1]]);
  });

  it("on a 60 Hz screen, whose frames are never under 12.5 ms, ten seconds at full rate earn the resolution back", () => {
    const g = gov();
    run(g, [...many(60, 16.7), ...many(40, 33.4)]);
    expect(run(g, many(RECOVER, 16.7))).toEqual([[RECOVER - 1, 1]]);
  });

  it("... with ±4 ms of jitter on every frame time and one 8 ms interval among them, it still does; that jitter never lowers it", () => {
    const g = gov();
    run(g, [...jittered(60), ...many(40, 33.4)]);
    const frames = jittered(RECOVER);
    frames[100] = 8;
    expect(run(g, frames)).toEqual([[RECOVER - 1, 1]]);
    expect(run(gov(), jittered(3000)).filter(([, s]) => s < 0)).toEqual([]);
  });
});
