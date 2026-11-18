// The Specimen (public/specimen-draw.js and public/art-specimen.js), held to the owner's rules: the
// potato with a face in its lab rig, the same parts at every stage, faces that follow the stage
// and react to verdicts, motion that is breathing and throbbing about where it sits (never a
// shake), and a drawing loop that stops when nothing moves.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARTS, createSpecimen } from "../public/art-specimen.js";
import { ALL_FACES, BODY, CHUNKS, FACES, FRAME, HEATS, LADDER, LISTENING, LUMPS, REACTIONS, VIEW, atLevel, composeFace, idleAt, levelOf, lightOrder, pose, reactionKind, scene } from "../public/specimen-draw.js";

const base = (stage, i = 0) => FACES[HEATS[stage]][i];
const sceneAt = (stage, extra = {}) => scene({ growth: stage / 4, strain: (stage / 4) * 0.8, stage, face: composeFace({ base: base(stage), stage, phase: "ready" }), t: 1.234, ...extra });

describe("the Specimen's parts", () => {
  it("draws every part at every stage, and only its own parts", () => {
    const names = new Set(PARTS.map(([n]) => n));
    const keys = (s) => Object.keys(s).sort().join(",");
    const first = sceneAt(0);
    for (const k of Object.keys(first)) expect(names.has(k), k).toBe(true);
    for (let stage = 0; stage <= 4; stage++) {
      for (const [i] of FACES[HEATS[stage]].entries()) {
        expect(keys(sceneAt(stage, { face: composeFace({ base: base(stage, i), stage }) }))).toBe(keys(first));
      }
    }
    expect(keys(sceneAt(4, { burstFor: 0.3 }))).toBe(keys(first));
    expect(keys(sceneAt(2, { face: composeFace({ base: base(2), reaction: REACTIONS.wrong[0], stage: 2 }) }))).toBe(keys(first));
  });

  it("keeps the body, its outline and a face at every stage until it bursts", () => {
    for (let stage = 0; stage <= 4; stage++) {
      const s = sceneAt(stage);
      expect(s.spud.opacity).toBe(1);
      expect(s.eyeW0.opacity + s.eyeS0.opacity).toBe(1);
      expect(s.eyeW1.opacity + s.eyeS1.opacity).toBe(1);
      expect(s.mouthLine.opacity + s.mouthFill.opacity).toBeGreaterThan(0);
    }
    expect(sceneAt(4, { burstFor: 0.5 }).spud.opacity).toBe(0);
  });

  it("is the same potato in the same rig at every stage: fixed shapes, the same lumps and sprouts in the same places", () => {
    const fixed = PARTS.filter(([, , , a]) => a.points || a.d || a.cx !== undefined).map(([n, , , a]) => [n, JSON.stringify(a)]);
    expect(fixed.length).toBeGreaterThan(20);
    // The lumps are placed about the same centres at every stage; only their size and crawl change.
    const centre = (tr) => tr.match(/translate\(-(\d+) -(\d+)\)$/).slice(1).join(",");
    for (const i of [0, 1, 2]) {
      const at = [2, 3, 4].map((stage) => centre(sceneAt(stage)[`lump${i}`].transform));
      expect(new Set(at).size).toBe(1);
    }
    expect(lightOrder(7)).toEqual(lightOrder(7));
    expect([...lightOrder(7)].sort()).toEqual([0, 1, 2, 3]);
  });

  it("grows at every stage, about the point it sits on", () => {
    const k = (stage) => Number(sceneAt(stage).spud.transform.match(/scale\(([\d.]+)/)[1]);
    for (let s = 1; s <= 4; s++) expect(k(s)).toBeGreaterThan(k(s - 1));
    for (let s = 0; s <= 4; s++) expect(sceneAt(s).spud.transform).toMatch(/^translate\(120 196\.8\) .* translate\(-120 -196\.8\)$/);
  });

  it("lets the rig react as it heats: clamps open, tubes fill, lights go out, bulbs turn to alarms", () => {
    const angle = (s) => Number(s.clampL.transform.match(/rotate\((-?[\d.]+)/)[1]);
    const still = (stage) => sceneAt(stage, { still: true });
    expect(angle(still(0))).toBe(0);
    expect(angle(still(4))).toBeLessThan(angle(still(2)));
    expect(Number(still(4).liquidL.y)).toBeLessThan(Number(still(0).liquidL.y));
    const dark = (s) => [0, 1, 2, 3].filter((i) => s[`light${i}`].fill !== "#ffd23f").length;
    expect([0, 1, 2, 3, 4].map((st) => dark(still(st)))).toEqual([0, 0, 1, 2, 3]);
    expect(still(0).alarmL.opacity).toBe(0);
    expect(still(3).alarmL.opacity).toBe(1);
    expect(still(4).foamL.opacity).toBe(1);
    expect(still(0).foamL.opacity).toBe(0);
  });

  it("bursts into the picker's splat, BREACH! and chunks, settling where they land", () => {
    const end = sceneAt(4, { burstFor: 2 });
    const later = sceneAt(4, { burstFor: 5 });
    expect(end.splat.opacity).toBe(1);
    expect(end.breach.opacity).toBe(1);
    expect(CHUNKS).toHaveLength(10);
    for (let i = 0; i < 10; i++) expect(end[`chunk${i}`]).toEqual(later[`chunk${i}`]);
  });
});

describe("its faces", () => {
  it("has several faces at every stage, the picker's own first, all different", () => {
    for (const heat of HEATS.slice(0, 5)) expect(FACES[heat].length).toBeGreaterThanOrEqual(3);
    expect(FACES.calm[0].id).toBe("deadpan");
    expect(FACES.critical[0].id).toBe("screech");
    const ids = ALL_FACES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Thirty, as the README says: change both together.
    expect(ids.length).toBe(30);
  });

  it("is cute, not scary: the screech is a cartoon wail with buck teeth and a tongue, not fangs", () => {
    const screech = FACES.critical[0].mouth;
    expect(screech.tongue).toBeTruthy();
    // Its teeth are two squares on the top lip (four corners each), not a row of points.
    const teeth = screech.detail.split("M").filter(Boolean);
    expect(teeth).toHaveLength(2);
    for (const tooth of teeth) expect(tooth.match(/-?[\d.]+ -?[\d.]+/g)).toHaveLength(4);
    // No face's white detail on a dark mouth is a zigzag of more than four points.
    for (const f of ALL_FACES) if (f.mouth.detail && f.mouth.colour !== "#fff") for (const s of f.mouth.detail.split("M").filter(Boolean)) expect(s.match(/-?[\d.]+ -?[\d.]+/g).length, f.id).toBeLessThanOrEqual(4);
  });

  it("glows in spots away from its mouth, so they never read as boils", () => {
    const box = (d) => {
      const n = d.match(/-?[\d.]+/g).map(Number);
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    for (const f of ALL_FACES) {
      const d = f.mouth.fill ?? f.mouth.line;
      const [x0, y0, x1, y1] = box(d);
      for (const [cx, cy, r] of LUMPS) {
        const dx = Math.max(x0 - cx, 0, cx - x1);
        const dy = Math.max(y0 - cy, 0, cy - y1);
        expect(Math.hypot(dx, dy) - r * 1.7, `${f.id} and the spot at ${cx},${cy}`).toBeGreaterThan(14);
      }
    }
  });

  it("follows the state: listening looks up, a reaction replaces the face, and a blink shuts its eyes", () => {
    expect(composeFace({ base: base(0), stage: 0, phase: "listen" }).id).toBe(LISTENING.id);
    const up = composeFace({ base: base(3), stage: 3, phase: "listen", fuse: 1 });
    expect(up.id).toBe(base(3).id);
    expect(up.eyes[0].py).toBeLessThan(0);
    // The eyes follow the burning fuse's spark from right to left.
    const early = composeFace({ base: base(2), stage: 2, phase: "listen", fuse: 0.9 }).eyes[0].px;
    const late = composeFace({ base: base(2), stage: 2, phase: "listen", fuse: 0.1 }).eyes[0].px;
    expect(early).toBeGreaterThan(late);
    expect(composeFace({ base: base(1), reaction: REACTIONS.right[0], stage: 1, phase: "ready" }).id).toBe(REACTIONS.right[0].id);
    const blink = composeFace({ base: base(0), stage: 0, phase: "ready", blink: true });
    expect(blink.eyes.filter(Boolean).every((e) => e.shut === "line")).toBe(true);
    const glance = composeFace({ base: base(1), stage: 1, phase: "ready", glance: true });
    expect(glance.eyes[0].px).toBeGreaterThan(0);
    // Once it strains it keeps its third eye in every reaction.
    expect(composeFace({ base: base(3), reaction: REACTIONS.wrong[0], stage: 3 }).eyes[2]).toBeTruthy();
  });

  it("reads each kind of verdict on its face", () => {
    expect(reactionKind("right")).toBe("right");
    expect(reactionKind("right", { appeal: true })).toBe("appeal");
    expect(reactionKind("worse", { why: "slow" })).toBe("slow");
    expect(reactionKind("worse", { why: "used" })).toBe("repeat");
    expect(reactionKind("worse", { why: "echo" })).toBe("repeat");
    expect(reactionKind("worse", { why: "overturned" })).toBe("overturned");
    expect(reactionKind("worse", { why: "wrong-letter" })).toBe("wrong");
    expect(reactionKind("doom")).toBe("doom");
    for (const k of ["right", "appeal", "wrong", "slow", "repeat", "overturned", "doom"]) expect(REACTIONS[k].length).toBeGreaterThan(0);
  });

  it("blinks, glances and sighs now and then between turns", () => {
    const ts = Array.from({ length: 2400 }, (_, i) => i / 100);
    const at = ts.map((t) => idleAt(t, 7));
    expect(at.some((x) => x.blink)).toBe(true);
    expect(at.some((x) => x.glance)).toBe(true);
    expect(at.some((x) => x.sighFor < 1.6)).toBe(true);
    expect(at.filter((x) => x.blink).length / at.length).toBeLessThan(0.1);
  });
});

describe("its motion: a ladder of stress", () => {
  const TOP = levelOf(4, 1);
  const levels = Array.from({ length: Math.round(TOP * 10) + 1 }, (_, i) => i / 10);
  const times = Array.from({ length: 6.4 * 240 }, (_, i) => i / 240);
  /** The largest shake (rotation in degrees, or a jolt in the drawing's units) at a level. */
  const shakeAt = (level) => Math.max(...times.map((t) => pose({ t, level })).map((m) => Math.max(Math.abs(m.rot), Math.abs(m.tx), Math.abs(m.ty))));
  /** How far it bulges past its breathing at a level. */
  const bulgeAt = (level) => Math.max(...times.map((t) => pose({ t, level, breath: 0 }).sx)) - 1;

  it("is chill when calm: no tremble, no shake, no skew, only slow breathing", () => {
    for (const level of [0, 0.3, 0.7, 1, 1.4, 1.7]) {
      for (const t of times) {
        const m = pose({ t, level });
        expect([m.rot, m.tx, m.ty, m.sk]).toEqual([0, 0, 0, 0]);
      }
    }
    // Calm breathes slowly (one breath in several seconds); it quickens as the stress rises.
    expect(atLevel(LADDER.breathS, 0)).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < 6; i++) expect(LADDER.breathS[i]).toBeLessThan(LADDER.breathS[i - 1]);
  });

  it("trembles more the more stressed it is, rising at every step, to a hard shake at critical", () => {
    const shakes = levels.map(shakeAt);
    for (let i = 1; i < shakes.length; i++) expect(shakes[i]).toBeGreaterThanOrEqual(shakes[i - 1] - 1e-9);
    // Nothing at calm or warm, shivers at hot, a steady tremble at strain, a hard shake at critical.
    expect(shakeAt(1.7)).toBe(0);
    expect(shakeAt(2)).toBeGreaterThan(0.5);
    expect(shakeAt(3)).toBeGreaterThan(shakeAt(2));
    expect(shakeAt(4)).toBeGreaterThan(shakeAt(3) * 1.5);
    expect(shakeAt(TOP)).toBeGreaterThan(shakeAt(4));
    // Hot shivers come in short bursts; strain trembles all the time.
    const still = (level) => times.filter((t) => Math.abs(pose({ t, level }).rot) < 1e-9).length / times.length;
    expect(still(2.3)).toBeGreaterThan(0.6);
    expect(still(3.3)).toBeLessThan(0.05);
    // The throb bulges more as the stress rises, from hot on.
    expect(bulgeAt(1.5)).toBeLessThan(1e-9);
    const bulges = [2, 3, 4, TOP].map(bulgeAt);
    for (let i = 1; i < bulges.length; i++) expect(bulges[i]).toBeGreaterThan(bulges[i - 1]);
  });

  it("moves in eased gestures: no jumps from one moment to the next", () => {
    for (const level of [0.5, 1.5, 2.2, 3.4, TOP]) {
      for (const [react, reactFor] of [[null, 9], ["right", 0.3], ["worse", 0.2]]) {
        for (let i = 0; i < 2000; i++) {
          const t = i * 0.0031;
          const a = pose({ t, level, react, reactFor, sighFor: 0.4 });
          const b = pose({ t: t + 0.001, level, react, reactFor, sighFor: 0.4 });
          // Even the hard shake is a continuous wobble: no step from one millisecond to the next.
          expect(Math.abs(b.rot - a.rot)).toBeLessThan(0.4);
          expect(Math.abs(b.tx - a.tx)).toBeLessThan(0.4);
          expect(Math.abs(b.sk - a.sk)).toBeLessThan(0.05);
          expect(Math.abs(b.sx - a.sx)).toBeLessThan(0.003);
          expect(Math.abs(b.sy - a.sy)).toBeLessThan(0.003);
        }
      }
    }
  });

  it("holds still with reduced motion, and on the start screen: the stress shows in still signs", () => {
    const none = { sx: 1, sy: 1, sk: 0, rot: 0, tx: 0, ty: 0, beat: 0 };
    for (const level of levels) {
      expect(pose({ t: 0.37, level, reduce: true })).toEqual(none);
      expect(pose({ t: 0.37, level, still: true })).toEqual(none);
    }
    // Reduced motion at critical: sweat on its face, nothing flung, the rig as stressed as it is.
    const s = sceneAt(4, { reduce: true, stress: 1 });
    expect([0, 1, 2, 3].filter((i) => s[`sweat${i}`].opacity > 0).length).toBe(4);
    expect([0, 1, 2, 3].every((i) => s[`fling${i}`].opacity === 0)).toBe(true);
    const calm = sceneAt(0, { reduce: true });
    expect([0, 1, 2, 3].every((i) => calm[`sweat${i}`].opacity === 0)).toBe(true);
  });

  it("shows the stress within a stage in at least three steps: sweat, the clamps, the lights, the tubes, its size", () => {
    const signs = (stage, stress) => {
      const s = sceneAt(stage, { stress, still: true });
      const lights = [0, 1, 2, 3].filter((i) => s[`light${i}`].fill !== "#ffd23f").length;
      return {
        // How much sweat shows: each bead shown, by its size.
        sweat: [0, 1, 2, 3].reduce((n, i) => n + Number(s[`sweat${i}`].opacity) * Number(s[`sweat${i}`].transform.match(/scale\(([\d.]+)\)/)[1]), 0),
        clamp: Number(s.clampL.transform.match(/rotate\((-?[\d.]+)/)[1]),
        tube: Number(s.liquidL.y),
        size: Number(s.spud.transform.match(/scale\(([\d.]+)/)[1]),
        lights,
      };
    };
    for (let stage = 0; stage <= 4; stage++) {
      const steps = [0, 0.33, 0.66, 1].map((x) => signs(stage, x));
      for (let i = 1; i < steps.length; i++) {
        // Each step is visibly more stressed than the one before: bigger, fuller tubes, clamps
        // pushed further (from warm), more sweat (from warm).
        expect(steps[i].size).toBeGreaterThan(steps[i - 1].size);
        expect(steps[i].tube).toBeLessThan(steps[i - 1].tube);
        if (stage >= 1) expect(steps[i].clamp).toBeLessThan(steps[i - 1].clamp);
        if (stage >= 1 && stage <= 2) expect(steps[i].sweat).toBeGreaterThan(steps[i - 1].sweat);
        expect(steps[i].lights).toBeGreaterThanOrEqual(steps[i - 1].lights);
      }
      // A lost life is a clear jump: the next stage's calmest is past this stage's most stressed.
      if (stage < 4) expect(levelOf(stage + 1, 0) - levelOf(stage, 1)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });
});

/** A 2D affine transform list, parsed from an SVG transform attribute, applied to [x, y]. */
function transformer(attr) {
  const ops = [...(attr ?? "").matchAll(/(\w+)\(([^)]*)\)/g)].map(([, op, args]) => [op, args.trim().split(/[\s,]+/).map(Number)]);
  return ([x, y]) => {
    for (const [op, a] of [...ops].reverse()) {
      if (op === "translate") [x, y] = [x + a[0], y + (a[1] ?? 0)];
      else if (op === "scale") [x, y] = [x * a[0], y * (a[1] ?? a[0])];
      else if (op === "skewX") x += y * Math.tan((a[0] * Math.PI) / 180);
      else if (op === "rotate") {
        const r = (a[0] * Math.PI) / 180;
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        const [dx, dy] = [x - cx, y - cy];
        [x, y] = [cx + dx * Math.cos(r) - dy * Math.sin(r), cy + dx * Math.sin(r) + dy * Math.cos(r)];
      }
    }
    return [x, y];
  };
}
const pointsOf = (s) => s.trim().split(/\s+/).map((p) => p.split(",").map(Number));

describe("it stays inside its drawing", () => {
  const [vx, vy, vw, vh] = VIEW.split(" ").map(Number);
  const inside = ([x, y], margin) => x >= vx + margin && x <= vx + vw - margin && y >= vy + margin && y <= vy + vh - margin;
  const part = (name) => PARTS.find(([n]) => n === name)[3];

  it("at its most stressed and shaking, sprouts, sweat and all", () => {
    const outside = [];
    for (let i = 0; i < 480; i++) {
      const t = i / 120;
      const motion = pose({ t, level: levelOf(4, 1) });
      const s = sceneAt(4, { stress: 1, motion, t });
      const spud = transformer(s.spud.transform);
      for (const v of [0, 1, 2]) {
        const vine = transformer(s[`vine${v}`].transform);
        for (const p of pointsOf(part(`vine${v}`).points)) if (!inside(spud(vine(p)), 2.5)) outside.push(`vine${v} at ${t}`);
      }
      for (const n of ["sweat0", "sweat1", "sweat2", "sweat3", "fling0", "fling1", "fling2", "fling3"]) {
        if (!(s[n].opacity > 0)) continue;
        const own = transformer(s[n].transform);
        for (const p of pointsOf(s[n].points)) if (!inside(spud(own(p)), 1.5)) outside.push(`${n} at ${t}`);
      }
      for (const p of pointsOf(BODY.replace(/[MLZ]/g, " ").trim().replace(/(\d) (\d)/g, "$1,$2"))) if (!inside(spud(p), 3.5)) outside.push(`body at ${t}`);
      const clamp = transformer(s.clampL.transform);
      const mirror = transformer(part("mirror").transform);
      for (const p of pointsOf(part("clampLArm").points)) if (!inside(clamp(p), 2.5) || !inside(mirror(clamp(p)), 2.5)) outside.push(`clamps at ${t}`);
    }
    expect(outside.slice(0, 5)).toEqual([]);
  });

  it("through the burst: the clamps spring open but stay in the rig, and the chunks land inside", () => {
    const arm = pointsOf(part("clampLArm").points);
    const mirror = transformer(part("mirror").transform);
    const outside = [];
    for (let i = 0; i <= 300; i++) {
      const s = sceneAt(4, { burstFor: i / 100, stress: 1 });
      const clamp = transformer(s.clampL.transform);
      for (const p of arm) {
        if (!inside(clamp(p), 2.5)) outside.push(`clampL at ${i / 100}`);
        if (!inside(mirror(clamp(p)), 2.5)) outside.push(`clampR at ${i / 100}`);
      }
      for (let c = 0; c < 10; c++) {
        const chunk = transformer(s[`chunk${c}`].transform);
        for (const p of pointsOf(part(`chunk${c}`).points)) if (!inside(chunk(p), 0)) outside.push(`chunk${c} at ${i / 100}`);
      }
    }
    expect(outside.slice(0, 5)).toEqual([]);
  });
});

// The screen frames FRAME (style.css), so he stays on the screen as long as he stays in FRAME. The
// renderer moves the breath, the throb and the clock each at its own pace, so every mix of them can
// meet: this sweeps them apart, at every stress the last stage reaches and through every moment
// (a flinch, the doom, a right answer), and takes the worst of it, not one frame.
describe("he stays inside the frame the screen shows, at the worst of his shake", () => {
  const part = (name) => PARTS.find(([n]) => n === name)[3];
  const body = pointsOf(BODY.replace(/[MLZ]/g, " ").trim().replace(/(\d) (\d)/g, "$1,$2"));
  /** The scene at a moment of the sweep (a stage between two is growing into the next). */
  const at = (m) => sceneAt(Math.floor(m.stage), { growth: m.stage / 4, stress: m.stress, motion: pose({ t: m.t, level: levelOf(m.stage, m.stress), breath: m.breath, beat: m.beat, react: m.react, reactFor: m.reactFor }), t: m.t });
  /** His furthest reach over a sweep, in the drawing's units, and the frame it happened in. */
  const reach = (moments) => {
    const worst = { x0: [Infinity], x1: [-Infinity], y0: [Infinity], y1: [-Infinity] };
    for (const m of moments) {
      const s = at(m);
      const spud = transformer(s.spud.transform);
      const see = ([x, y]) => {
        if (x < worst.x0[0]) worst.x0 = [x, m];
        if (x > worst.x1[0]) worst.x1 = [x, m];
        if (y < worst.y0[0]) worst.y0 = [y, m];
        if (y > worst.y1[0]) worst.y1 = [y, m];
      };
      for (const p of body) see(spud(p));
      for (const v of [0, 1, 2]) {
        if (!(s[`vine${v}`].opacity > 0)) continue;
        const own = transformer(s[`vine${v}`].transform);
        for (const p of pointsOf(part(`vine${v}`).points)) see(spud(own(p)));
      }
      for (const n of ["sweat0", "sweat1", "sweat2", "sweat3", "fling0", "fling1", "fling2", "fling3"]) {
        if (!(s[n].opacity > 0)) continue;
        const own = transformer(s[n].transform);
        for (const p of pointsOf(s[n].points)) see(spud(own(p)));
      }
    }
    return worst;
  };
  function* sweep(stage, { stresses = [0, 0.45, 0.9, 1], reacts = [[null, 9], ["worse", null], ["right", null]], fps = 60 } = {}) {
    for (const stress of stresses)
      for (const [react, at] of reacts)
        for (let i = 0; i < 25 * fps; i++) {
          // Steps of 1/fps s through 25 s; the breath and the throb at paces of their own (as the
          // renderer runs them), and a moment's whole course every second.
          const t = i / fps;
          yield { stage, stress, t, breath: (t * 0.37 + stress) % 1, beat: (t * 1.93) % 1, react, reactFor: at ?? (i % fps) / fps };
        }
  }
  // (Tens of thousands of scenes each: more time than a plain test gets when every file runs at once.)
  const LONG = 30000;
  const inFrame = (w) => [w.x0[0] >= FRAME.x0 - 1e-6, w.x1[0] <= FRAME.x1 + 1e-6, w.y0[0] >= FRAME.y0 - 1e-6, w.y1[0] <= FRAME.y1 + 1e-6];
  const say = (w) => `x ${w.x0[0].toFixed(2)} to ${w.x1[0].toFixed(2)}, y ${w.y0[0].toFixed(2)} to ${w.y1[0].toFixed(2)}`;

  it("at the last stage: shaking, flinching, in the doom and after a right answer", () => {
    const w = reach(sweep(4));
    expect(inFrame(w), say(w)).toEqual([true, true, true, true]);
  }, LONG);

  it("at every other stage, and growing into the last", () => {
    for (const stage of [0, 1, 2, 3, 3.5, 3.8]) {
      const w = reach(sweep(stage, { stresses: [0, 1], fps: 12 }));
      expect(inFrame(w), `stage ${stage}: ${say(w)}`).toEqual([true, true, true, true]);
    }
  }, LONG);

  it("the frame is held only at the peak of the shake: he is never drawn smaller below the last stage, nor at rest", () => {
    const held = (m) => /^translate\([^)]*\) scale\(/.test(at(m).spud.transform);
    for (const stage of [0, 1, 2, 3]) for (const m of sweep(stage, { stresses: [0, 1], fps: 12 })) if (held(m)) throw new Error(`held at stage ${stage}: ${JSON.stringify(m)}`);
    // At the last stage, held still (reduced motion or a still): as he is.
    for (const stress of [0, 1]) expect(sceneAt(4, { stress, still: true, motion: pose({ still: true }) }).spud.transform).not.toMatch(/^translate\([^)]*\) scale\(/);
    // Shaking at the last stage with no moment on, he is held in only now and then.
    let n = 0;
    let count = 0;
    for (const m of sweep(4, { stresses: [1], reacts: [[null, 9]] })) {
      n++;
      if (held(m)) count++;
    }
    expect(count / n).toBeLessThan(0.02);
  }, LONG);

  it("style.css frames the same numbers", () => {
    const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
    const got = Object.fromEntries([...css.matchAll(/--f([xy][01]):\s*(-?[\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
    expect(got).toEqual(FRAME);
  });
});

// A small stand-in for the DOM and the frame clock: enough for the renderer to build its SVG.
describe("its drawing loop", () => {
  let frames;
  let now;
  const node = () => ({ attrs: {}, children: [], dataset: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); }, remove() {} });
  beforeEach(() => {
    frames = [];
    now = 0;
    globalThis.document = { createElementNS: () => node() };
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    globalThis.cancelAnimationFrame = () => {};
  });
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  /** Runs `n` frames of 1/60 s (or until nothing asks for another). */
  const run = (n) => {
    for (let i = 0; i < n && frames.length; i++) {
      now += 1000 / 60;
      const due = frames;
      frames = [];
      for (const cb of due) cb(now);
    }
  };
  const ready = (stage) => ({ stage, growth: stage / 4, strain: (stage / 4) * 0.8, fuse: 1, light: "#fff", phase: "ready", paused: false });

  it("stops on the start screen, while paused, after the burst settles, and with reduced motion", () => {
    const art = createSpecimen(node(), { seed: 7 });
    art.set({ ...ready(0), phase: "idle" });
    run(10);
    expect(art.look().running).toBe(false);
    const idleDraws = art.look().draws;
    run(30);
    expect(art.look().draws).toBe(idleDraws);

    art.set(ready(2));
    run(30);
    expect(art.look().running).toBe(true);
    art.set({ ...ready(2), paused: true });
    run(5);
    expect(art.look().running).toBe(false);
    const pausedDraws = art.look().draws;
    run(30);
    expect(art.look().draws).toBe(pausedDraws);

    art.set({ ...ready(4), phase: "burst", growth: 1, strain: 1, stage: 5 });
    art.play("burst");
    run(200);
    expect(art.look().burst).toBe(true);
    expect(art.look().running).toBe(false);

    const calm = createSpecimen(node(), { seed: 7, reducedMotion: () => true });
    calm.set(ready(3));
    run(5);
    expect(calm.look().running).toBe(false);
    expect(calm.look().growth).toBe(0.75);
  });

  it("shows a reaction for a moment, then the stage's face again; the last miss panics until it bursts", () => {
    const art = createSpecimen(node(), { seed: 7 });
    art.set(ready(1));
    run(5);
    art.play("worse", { why: "slow" });
    run(2);
    expect(art.look().reaction).toBe("slow");
    expect(REACTIONS.slow.map((f) => f.id)).toContain(art.look().face);
    run(120);
    expect(art.look().reaction).toBe(null);
    expect(FACES.warm.map((f) => f.id)).toContain(art.look().face);
    art.set({ ...ready(4), phase: "doom" });
    art.play("doom", { why: "word" });
    run(200);
    expect(art.look().reaction).toBe("doom");
    art.play("reset");
    art.set({ ...ready(0), phase: "idle" });
    run(10);
    expect(art.look().face).toBe("deadpan");
  });
});
