// The code-drawn potato's geometry (public/potato-draw.js), held to the owner's rules: no face,
// the same pores in the same places at every stage (one seed, only stretching), nothing bolted on
// as it grows, the frame and stand fixed and only reacting to its size, and a pulse, never a shake.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLOOR_Y, FRAME, STAND, TETHER_SOCKET, burstShape, cable, makeSpecimen, potatoShape, pulseAt, smoothPath } from "../public/potato-draw.js";

const spec = makeSpecimen(7);
const stages = [0, 0.25, 0.5, 0.75, 1].map((growth) => potatoShape({ spec, growth, strain: growth * 0.8 }));
const counts = (s) => ({ pores: s.pores.length, cables: s.cables.length, traces: s.traces.length, marks: s.marks.length, creases: s.creases.length, outline: s.outline.length });

describe("the potato", () => {
  it("has no face: nothing in its drawing is an eye, a mouth or a brow", () => {
    for (const file of ["potato-draw.js", "art-code.js"]) {
      const code = readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(code, file).not.toMatch(/\b(eye|eyes|pupil|mouth|teeth|brow|face|smile|lid)\b/i);
    }
  });

  it("is the same potato for the same seed, and another for another seed", () => {
    expect(makeSpecimen(7)).toEqual(spec);
    expect(makeSpecimen(8).pores).not.toEqual(spec.pores);
  });

  it("has the same parts at every stage: nothing is added as it grows", () => {
    const first = counts(stages[0]);
    for (const s of stages) expect(counts(s)).toEqual(first);
    expect(first.pores).toBeGreaterThanOrEqual(12);
  });

  it("keeps every pore where it was, only stretched with the skin", () => {
    // Each pore's place relative to the body (its share of the way across and down the body's
    // box) hardly moves from stage to stage, and pores never swap order.
    const rel = (s) => s.pores.map((p) => [(p.x - s.box.left) / (s.box.right - s.box.left), (p.y - s.box.top) / (s.box.bottom - s.box.top)]);
    const base = rel(stages[0]);
    for (const s of stages.slice(1)) {
      rel(s).forEach(([x, y], i) => {
        expect(Math.abs(x - base[i][0]), `pore ${i} across`).toBeLessThan(0.12);
        expect(Math.abs(y - base[i][1]), `pore ${i} down`).toBeLessThan(0.2);
      });
    }
    // And they grow with it.
    stages[4].pores.forEach((p, i) => expect(p.w).toBeGreaterThan(stages[0].pores[i].w));
  });

  it("grows bigger at every stage, from the same resting place", () => {
    for (let i = 1; i < stages.length; i++) {
      const a = stages[i - 1].box;
      const b = stages[i].box;
      expect(b.right - b.left).toBeGreaterThan(a.right - a.left);
      expect(b.bottom - b.top).toBeGreaterThan(a.bottom - a.top);
    }
    // It rests on the rod; past the rod's ends it may bulge down over them, never to the floor.
    for (const s of stages) {
      expect(s.box.bottom).toBeGreaterThan(s.restY - 4);
      expect(s.box.bottom).toBeLessThan(FLOOR_Y - 10);
    }
  });

  it("stays a potato as it grows: rounder and lumpier, never a flat slab", () => {
    // A healthy potato is long and low; as it swells it gets rounder, never a wide, flat slab.
    const ratio = (s) => (s.box.right - s.box.left) / (s.box.bottom - s.box.top);
    expect(ratio(stages[0])).toBeLessThan(1.65);
    for (const s of stages.slice(2)) expect(ratio(s), "width to height").toBeLessThan(1.47);
    for (let i = 3; i < stages.length; i++) expect(ratio(stages[i])).toBeLessThan(ratio(stages[i - 1]));
    const last = stages[4];
    expect((last.box.bottom - last.box.top) / (stages[0].box.bottom - stages[0].box.top)).toBeGreaterThan(1.6);
  });

  it("shows every mark from the calm start, faint and closed, so growth only deepens what was there", () => {
    for (const [i, s] of stages.entries()) {
      expect(s.marks.every((m) => m.len > 5), `stage ${i} marks`).toBe(true);
      expect(s.creases.every((c) => c.len > 3), `stage ${i} creases`).toBe(true);
      expect(s.pores.every((p) => p.glow > 0.1), `stage ${i} pores`).toBe(true);
    }
    const [first, , , , last] = stages;
    expect(first.marks.every((m) => m.open === 0)).toBe(true);
    expect(first.creases.every((c) => c.pull === 0)).toBe(true);
    expect(first.pores.every((p) => p.glow < 0.2)).toBe(true);
    // At the end the same marks are open, the creases pulled, the pores bright.
    expect(last.marks.every((m) => m.open > 0.5)).toBe(true);
    expect(last.creases.some((c) => c.pull > 0.5)).toBe(true);
    expect(last.pores.every((p) => p.glow > first.pores[0].glow)).toBe(true);
  });

  it("starts as a proper, framed starting point: small, calm and well inside its bay", () => {
    const s = stages[0];
    expect(s.box.left).toBeGreaterThan(FRAME.left + FRAME.band + 40);
    expect(s.box.right).toBeLessThan(FRAME.right - FRAME.band - 40);
    expect(s.box.top).toBeGreaterThan(FRAME.top + FRAME.band + 100);
    expect(s.frame.bow).toEqual({ left: 0, right: 0, top: 0 });
    expect(s.cables.every((c) => c.over === 0 && c.sag > 4)).toBe(true);
  });

  it("only changes what is around it as a consequence of its size", () => {
    const [first, , , , last] = stages;
    // The frame and the stand's feet never move; the frame bows where it is pushed, the rod sags.
    expect(last.frame.left).toBe(first.frame.left);
    expect(last.frame.right).toBe(first.frame.right);
    expect(last.stand.feet).toEqual(first.stand.feet);
    expect(last.stand.base).toEqual(first.stand.base);
    // Pressed on, both sides bow out together: the whole bay strains, not one side.
    expect(last.frame.bow.left).toBeGreaterThan(5);
    expect(last.frame.bow.right).toBe(last.frame.bow.left);
    expect(stages[2].frame.bow.left).toBe(0);
    expect(last.stand.rod.sag).toBeGreaterThan(first.stand.rod.sag);
    // The cables keep their length: slack at first, pulled straight at the end, with creases.
    expect(last.cables.every((c) => c.sag === 0 && c.over > 0)).toBe(true);
    expect(last.creases.every((c, i) => c.len > first.creases[i].len)).toBe(true);
    first.cables.forEach((c, i) => expect(last.cables[i].length).toBeCloseTo(c.length, 6));
    // The tether goes taut and tilts the plate; its socket on the stand stays put.
    expect(last.tether.to).toEqual([TETHER_SOCKET.x, TETHER_SOCKET.y]);
    expect(last.plate.angle).toBeGreaterThan(first.plate.angle);
    // The plate is rigid: the same size at every stage.
    expect(last.plate.w).toBe(first.plate.w);
    expect(last.plate.h).toBe(first.plate.h);
  });

  it("pulses by scale about where it rests, never shaking sideways", () => {
    const still = potatoShape({ spec, growth: 0.5, strain: 0.5, pulse: 0 });
    const swell = potatoShape({ spec, growth: 0.5, strain: 0.5, pulse: 0.04 });
    // The middle of its base stays where it is; it only swells.
    const mid = (s) => (s.box.left + s.box.right) / 2;
    expect(Math.abs(mid(swell) - mid(still))).toBeLessThan(0.5);
    expect(Math.abs(swell.box.bottom - still.box.bottom)).toBeLessThan(0.5);
    expect(swell.box.right - swell.box.left).toBeGreaterThan(still.box.right - still.box.left);
    // The pulse is gentle when healthy, quicker and deeper as it strains, and never negative.
    const range = (strain) => {
      let max = 0;
      let crossings = 0;
      let prev = 0;
      for (let t = 0; t < 10; t += 0.01) {
        const p = pulseAt(t, strain);
        expect(p).toBeGreaterThanOrEqual(0);
        max = Math.max(max, p);
        if (prev < max / 2 && p >= max / 2) crossings++;
        prev = p;
      }
      return { max, crossings };
    };
    const calm = range(0);
    const tense = range(1);
    expect(tense.max).toBeGreaterThan(calm.max * 2);
    expect(tense.crossings).toBeGreaterThan(calm.crossings * 3);
    expect(calm.max).toBeLessThan(0.02);
  });

  it("hangs a cable while it is slack and pulls it straight when stretched", () => {
    const slack = cable([0, 0], [100, 0], 120);
    expect(slack.sag).toBeGreaterThan(10);
    expect(slack.over).toBe(0);
    const taut = cable([0, 0], [130, 0], 120);
    expect(taut.sag).toBe(0);
    expect(taut.over).toBeCloseTo(130 / 120 - 1);
  });

  it("bursts into chunks that land and stay inside the bay, and a pile on the stand", () => {
    const end = burstShape(spec, 3);
    expect(end.flash.opacity).toBe(0);
    expect(end.chunks.every((c) => c.landed)).toBe(true);
    // Every chunk lies wholly inside the bay, above the frame's bottom band.
    for (const c of end.chunks) {
      const a = (c.angle * Math.PI) / 180;
      for (const [px, py] of c.shape) {
        const x = c.x + px * Math.cos(a) - py * Math.sin(a);
        const y = c.y + px * Math.sin(a) + py * Math.cos(a);
        expect(x).toBeGreaterThan(FRAME.left + FRAME.band);
        expect(x).toBeLessThan(FRAME.right - FRAME.band);
        expect(y).toBeLessThan(FLOOR_Y + 0.5);
        // Clear of the chamfered bottom corners too: the inner chamfer cuts off a 45° corner
        // FRAME.chamfer - 0.4 × FRAME.band across (art-code.js framePath), plus the stroke.
        const corner = FRAME.chamfer - 0.4 * FRAME.band + 4;
        expect(x - (FRAME.left + FRAME.band) + (FLOOR_Y - y)).toBeGreaterThan(corner);
        expect(FRAME.right - FRAME.band - x + (FLOOR_Y - y)).toBeGreaterThan(corner);
      }
    }
    // So does the fallen plate (70 by 52, turned by its angle).
    const p = end.plate;
    const a = (p.angle * Math.PI) / 180;
    const reach = 35 * Math.abs(Math.sin(a)) + 26 * Math.abs(Math.cos(a));
    expect(p.y + reach).toBeLessThan(FLOOR_Y + 0.5);
    expect(burstShape(spec, 3)).toEqual(burstShape(spec, 4));
    expect(end.pile.every(([, y]) => y <= STAND.rodY + 20)).toBe(true);
  });

  it("pops the splat out and shrinks it away at full colour, never fading it through a muddy mix", () => {
    const sizes = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1].map((t) => burstShape(spec, t).splat);
    for (const s of sizes) expect(Object.keys(s)).toEqual(["scale"]);
    expect(sizes[3].scale).toBeCloseTo(1);
    expect(sizes[6].scale).toBe(0);
  });

  it("draws a closed, smooth outline", () => {
    const d = smoothPath(stages[2].outline);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN/);
  });
});
