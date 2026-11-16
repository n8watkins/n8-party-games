// The Specimen (public/specimen-draw.js and public/art-specimen.js), held to the owner's rules: the
// potato with a face in its lab rig, the same parts at every stage, faces that follow the stage
// and react to verdicts, motion that is breathing and throbbing about where it sits (never a
// shake), and a drawing loop that stops when nothing moves.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARTS, createSpecimen } from "../public/art-specimen.js";
import { ALL_FACES, CHUNKS, FACES, HEATS, LISTENING, REACTIONS, composeFace, idleAt, lightOrder, pose, reactionKind, scene } from "../public/specimen-draw.js";

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
    expect(ids.length).toBeGreaterThanOrEqual(25);
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

describe("its motion", () => {
  it("only scales about where it sits, with a small skew and rock: never a shake", () => {
    for (let stage = 0; stage <= 4; stage++) {
      for (let i = 0; i < 400; i++) {
        const t = i * 0.0137;
        for (const [react, reactFor] of [[null, 9], ["right", t % 0.9], ["worse", t % 0.55]]) {
          const m = pose({ t, stage, react, reactFor, sighFor: t % 2 });
          expect(Object.keys(m).sort()).toEqual(["rot", "sk", "sx", "sy"]);
          expect(Math.abs(m.rot)).toBeLessThanOrEqual(1.5);
          expect(Math.abs(m.sk)).toBeLessThanOrEqual(9.5);
          expect(m.sx).toBeGreaterThan(0.85);
          expect(m.sx).toBeLessThan(1.25);
          expect(m.sy).toBeGreaterThan(0.75);
          expect(m.sy).toBeLessThan(1.2);
        }
      }
    }
  });

  it("holds still with reduced motion, and on the start screen", () => {
    for (let stage = 0; stage <= 4; stage++) {
      expect(pose({ t: 0.37, stage, reduce: true })).toEqual({ sx: 1, sy: 1, sk: 0, rot: 0 });
      expect(pose({ t: 0.37, stage, still: true })).toEqual({ sx: 1, sy: 1, sk: 0, rot: 0 });
    }
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
