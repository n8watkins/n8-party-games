// The rules' own maths: right to about 1e-15 against the engine's, and written with exact operations only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as d from "../shared/dmath.js";
import { hash } from "../shared/course.js";

const here = (name) => new URL(name, import.meta.url);

describe("dmath", () => {
  it("sin, cos and tan agree with the engine's over every angle a race can reach", () => {
    let worst = 0;
    for (let k = 0; k < 200_000; k++) {
      const x = (hash(7, k) - 0.5) * (k % 3 === 0 ? 12_000 : 14);
      worst = Math.max(worst, Math.abs(d.sin(x) - Math.sin(x)), Math.abs(d.cos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(2e-13); // (at 6000 radians the argument itself is only known to 1e-12)
    for (const x of [0, 0.1, -0.1, 0.7, 1.2, -1.5]) expect(d.tan(x)).toBeCloseTo(Math.tan(x), 13);
  });

  it("is exact where it matters: no angle, a right angle, a half turn", () => {
    expect(d.sin(0)).toBe(0);
    expect(d.cos(0)).toBe(1);
    expect(d.cos(d.PI / 2)).toBeCloseTo(0, 15);
    expect(d.sin(d.PI / 2)).toBe(1);
    expect(d.cos(d.PI)).toBe(-1);
  });

  it("atan and atan2 agree with the engine's in every quadrant", () => {
    let worst = 0;
    for (let k = 0; k < 100_000; k++) {
      const y = (hash(11, k) - 0.5) * 40, x = (hash(13, k) - 0.5) * (k % 5 === 0 ? 0.01 : 40);
      worst = Math.max(worst, Math.abs(d.atan2(y, x) - Math.atan2(y, x)), Math.abs(d.atan(y) - Math.atan(y)));
    }
    expect(worst).toBeLessThan(1e-15 * 4);
    expect(d.atan2(0, 1)).toBe(0);
    expect(d.atan2(1, 0)).toBe(Math.PI / 2);
    expect(d.atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(d.atan2(0, 0)).toBe(0);
  });

  it("ignores the sign of a zero, which a saved race does not keep", () => {
    expect(d.atan2(0, -1)).toBe(Math.PI);
    expect(d.atan2(-0, -1)).toBe(Math.PI);
    expect(JSON.parse(JSON.stringify({ a: -0 })).a).toBe(0);
  });

  it("wrapA brings any angle into -pi to pi, and hypot is a plain square root", () => {
    for (const a of [0, 1, -1, 3, -3, 4, -4, 7, 100, -100, 6000.5]) {
      const w = d.wrapA(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 11);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 11);
    }
    expect(d.hypot(3, 4)).toBe(5);
  });

  it("the rules never call the engine's own inexact maths, a clock or Math.random", () => {
    // Exact on every engine: + - * / and Math.sqrt, abs, floor, round, sign, min, max, imul.
    const inexact = /Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt|sinh|cosh|tanh|random)\b|[\w)\]]\s*\*\*\s*[\w(]|Date\.|performance\.|new Date/;
    for (const file of ["../shared/dmath.js", "../shared/course.js", "../shared/house.js", "../shared/rules.js", "../shared/replica.js", "../tools/drivers.mjs"]) {
      const comment = (line) => /^(\/\/|\/\*|\*)/.test(line.trim());
      const code = readFileSync(here(file), "utf8").split("\n").filter((line) => !comment(line));
      const found = code.filter((line) => inexact.test(line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "")));
      expect(found, file).toEqual([]);
    }
  });
});
