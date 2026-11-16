// The slime and the robot without a browser: what a ghost's fright does to them in both looks
// (wide eyes, a pale tint that the baked look keeps), the robot's red when it fumes (its paint
// tinted, not its colour times red), the flat robot's writes when idle, its alarm lamp, its
// crosses while an emote plays, and its arms fading with it. The pixels are checked in a real
// browser by lobby/test/e2e-ghost.mjs and e2e-characters.mjs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { paintTintOf } from "../public/look3d/body-kit.js";
import { PALE, resumeKnock, startFright, startKnock } from "../public/look3d/pieces.js";
import { RobotHands, bakeRobot, dressRobot, emoteRobot, fadeRobot, makeRobot, poseRobot } from "../public/look3d/robot.js";
import { bakeSlime, dressSlime, makeSlime, poseSlime } from "../public/look3d/slime.js";
import { ROBOT_RIG } from "../public/characters/robot.js";

const piece = (seat = 0) => ({ seat, rx: 900, face: 1, jumpAt: -Infinity, attack: null, knock: null, fright: null, fx: { char: 0, hopAt: -Infinity } });
const quiet = { walking: false, lit: 0.5, calm: false };
const BLUE = "#3f6fd8";

/** Poses a body through a fright of `kind` begun at 1000 ms; returns the most scared and pale it got, and its state at the peak. */
function frighten(make, dress, pose, bake, kind) {
  const b = make(null);
  dress(b, BLUE, true);
  const p = piece();
  pose(b, p, 900, 1 / 60, quiet);
  startFright(p, p.rx + 200, 1000, kind);
  let most = { scared: 0, pale: 0 };
  for (let t = 1000; t < 3600; t += 1000 / 60) {
    pose(b, p, t, 1 / 60, quiet);
    bake?.(b);
    if ((b.scaredK ?? 0) > most.scared) most = { scared: b.scaredK, pale: b.pale, t };
  }
  return { b, p, most };
}

describe("a ghost's fright, in the 3D and baked looks", () => {
  for (const kind of ["scare", "spook"]) {
    it(`widens a robot's eyes and pales its paint (${kind}), and the baked look keeps the pale`, () => {
      const r = makeRobot(null);
      dressRobot(r, BLUE, true);
      const p = piece();
      poseRobot(r, p, 900, 1 / 60, quiet);
      const rest = r.eyes.scale.x;
      startFright(p, p.rx + 200, 1000, kind);
      let widest = 0;
      let eyes = 0;
      let palest = 0;
      for (let t = 1000; t < 3600; t += 1000 / 60) {
        poseRobot(r, p, t, 1 / 60, quiet);
        bakeRobot(r);
        widest = Math.max(widest, r.scaredK ?? 0);
        eyes = Math.max(eyes, r.eyes.scale.x);
        // After the baked look's finish, the paint is still tinted pale.
        const tint = paintTintOf(r.mat);
        if (tint.k > palest) {
          palest = tint.k;
          expect(new THREE.Color(tint.r, tint.g, tint.b).getHexString()).toBe(PALE.getHexString());
        }
      }
      expect(widest).toBeGreaterThan(0.9);
      expect(eyes).toBeGreaterThan(rest * 1.3);
      expect(palest).toBeGreaterThan(0.4);
      // And it is over once the fright is.
      expect(r.scaredK).toBe(0);
      expect(paintTintOf(r.mat).k).toBe(0);
    });

    it(`widens a slime's eyes and pales it (${kind}), and the baked look keeps the pale`, () => {
      const { b, most } = frighten(makeSlime, dressSlime, poseSlime, null, kind);
      expect(most.scared).toBeGreaterThan(0.9);
      expect(most.pale).toBeGreaterThan(0.5);
      // Baked: posed at the peak again, then finished; its colour is still paler than its own.
      const s = makeSlime(null);
      dressSlime(s, BLUE, true);
      const p = piece();
      poseSlime(s, p, 900, 1 / 60, quiet);
      startFright(p, p.rx + 200, 1000, kind);
      for (let t = 1000; t <= most.t; t += 1000 / 60) poseSlime(s, p, t, 1 / 60, quiet);
      const eyes = s.eyes.scale.y;
      bakeSlime(s);
      const own = s.colour.getHSL({});
      const shown = s.mat.color.getHSL({});
      expect(shown.l).toBeGreaterThan(own.l + 0.1);
      expect(shown.s).toBeLessThan(own.s);
      expect(eyes).toBeGreaterThan(1.2);
      expect(b.scaredK).toBe(0);
    });
  }
});

describe("a page that arrives in the middle of a scare, in the 3D look", () => {
  it("draws a robot and a slime scared from its first frame (the room's word: down and safe)", () => {
    for (const [make, dress, pose] of [[makeRobot, dressRobot, poseRobot], [makeSlime, dressSlime, poseSlime]]) {
      const b = make(null);
      dress(b, BLUE, true);
      const p = piece();
      // 500 ms into a scare: what the room tells a page that has just come (lobby-room.js: down, safe and the fright's kind).
      resumeKnock(p, p.rx, 1000, 3000, 5000, "scare");
      pose(b, p, 5000, 1 / 60, quiet);
      expect(b.scaredK).toBeGreaterThan(0.9);
      expect(b.pale).toBeGreaterThan(0.9);
    }
  });
});

describe("a fuming robot, in the 3D look", () => {
  const fuming = { body: { dx: 0, lift: 0, rot: 0, tint: 1 }, ghost: { nubs: 0, yaw: 0 }, face: { eyes: "open", eye: 1, up: 0, lid: 0, brows: null } };
  for (const hex of ["#3f6fd8", "#3aa9a0", "#4fae4a", "#8a5bc4", "#f4ead4", "#d9662b"]) {
    it(`goes red on its paint, not its colour times red (${hex}), in the baked look too`, () => {
      const r = makeRobot(null);
      dressRobot(r, hex, true);
      const p = piece();
      for (const baked of [false, true]) {
        poseRobot(r, p, 1000, 1 / 60, quiet);
        if (baked) bakeRobot(r);
        emoteRobot(r, fuming, 1000, 0);
        const tint = paintTintOf(r.mat);
        expect(tint.k).toBeCloseTo(0.8);
        expect(tint.r).toBeGreaterThan(0.9);
        expect(tint.g).toBeLessThan(0.1);
        // The multiplier is left grey: red times blue paint would be near black.
        expect(r.mat.color.r).toBeCloseTo(r.mat.color.b);
      }
    });
  }
});

describe("a robot leaving in the middle of an emote", () => {
  it("fades its arms and hands with its body, on its own materials (other robots' arms stay solid)", () => {
    const r = makeRobot(null);
    dressRobot(r, BLUE, true);
    const other = new RobotHands(makeRobot(null), BLUE);
    const hands = new RobotHands(r, BLUE);
    // Two hands up (Popcorn, say), at its hold.
    const e = ROBOT_RIG.find((x) => x.id === "trophy");
    const pose = e.pose(e.hold, false, 200);
    hands.set(pose);
    expect(hands.rods.some((rod) => rod.g.visible)).toBe(true);
    expect(hands.rods[0].upper.material.transparent).toBe(false);
    fadeRobot(r, 0.5);
    hands.set(pose);
    for (const rod of hands.rods) {
      for (const m of [rod.upper.material, rod.lower.material, rod.elbow.material]) {
        expect(m.transparent).toBe(true);
        expect(m.opacity).toBeCloseTo(0.4);
      }
    }
    expect(hands.arms.handMat.opacity).toBeCloseTo(0.4);
    expect(other.rods[0].upper.material.opacity).toBe(1);
    expect(other.rods[0].upper.material).not.toBe(hands.rods[0].upper.material);
  });
});

// ---------------------------------------------------------------- the flat look, on a counting stand-in for the page

let writes = 0;
class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
  }
  setAttribute(k, v) {
    writes++;
    this.attrs.set(k, v);
  }
  removeAttribute(k) {
    writes++;
    this.attrs.delete(k);
  }
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  }
  append(...kids) {
    this.children.push(...kids);
  }
  prepend(...kids) {
    this.children.unshift(...kids);
  }
  get lastChild() {
    return this.children.at(-1) ?? null;
  }
}

describe("the flat robot and slime", () => {
  let flat;
  beforeAll(async () => {
    globalThis.document = { createElementNS: (_, tag) => new FakeEl(tag) };
    flat = { robot: (await import("../public/characters/robot.js")).robot.flat, slime: (await import("../public/characters/slime.js")).slime.flat };
  });
  afterAll(() => {
    delete globalThis.document;
  });
  const at = (i) => ({ now: 1000 + i * (1000 / 60), dt: 1 / 60, face: 1, seat: 2, calm: false, grounded: false, walking: false, x: 900, voting: false });

  it("an idle robot writes nothing to the page once it has settled", () => {
    const a = flat.robot.make();
    flat.robot.dress(a, BLUE, true);
    // Seat 2 blinks at the start of each 4.1 s; the frames in between are idle.
    for (let i = 0; i < 120; i++) flat.robot.frame(a, at(i));
    writes = 0;
    for (let i = 120; i < 220; i++) flat.robot.frame(a, at(i));
    expect(writes).toBe(0);
  });

  it("a robot's lamp is red from the first frame it is hit, as the 3D one's", () => {
    const a = flat.robot.make();
    flat.robot.dress(a, BLUE, true);
    flat.robot.frame(a, at(0));
    // The room's knock: thrown (hit, then flying), told to frame before dizzy() is called that frame.
    flat.robot.frame(a, { ...at(1), grounded: true });
    expect(a.lamp.getAttribute("fill")).toBe("#ff4a3a");
    flat.robot.dizzy(a, true);
    flat.robot.frame(a, { ...at(2), grounded: true });
    expect(a.lamp.getAttribute("fill")).toBe("#ff4a3a");
    flat.robot.dizzy(a, false);
    flat.robot.frame(a, at(3));
    expect(a.lamp.getAttribute("fill")).not.toBe("#ff4a3a");
    // Its eyes come back open once it is up.
    expect(a.face.open.getAttribute("display")).toBe(null);
    expect(a.face.crosses.getAttribute("display")).toBe("none");
  });

  for (const id of ["robot", "slime"]) {
    it(`a ${id} knocked over while it emotes keeps its own knocked eyes, and the emote asks for no face`, () => {
      const def = flat[id];
      const a = def.make();
      def.dress(a, BLUE, true);
      const pose = { body: { dx: 0, lift: 0, rot: 0, tint: 0 }, ghost: { nubs: 0, puff: 0 } };
      def.emote(a, pose, () => "");
      expect(a.face.g.getAttribute("display")).toBe("none");
      def.dizzy(a, true);
      def.emote(a, pose, () => "");
      expect(a.face.g.getAttribute("display")).toBe(null);
      const knocked = id === "robot" ? a.face.crosses : a.face.dizzy;
      expect(knocked.getAttribute("display")).toBe(null);
      expect(def.figure.ownKnockedFace).toBe(true);
      def.dizzy(a, false);
      def.emote(a, pose, () => "");
      expect(a.face.g.getAttribute("display")).toBe("none");
    });

    it(`a frightened ${id} goes wide-eyed in the flat look`, () => {
      const def = flat[id];
      const a = def.make();
      def.dress(a, BLUE, true);
      def.frame(a, at(30));
      const before = a.face.open.getAttribute("transform");
      def.scared(a, 1);
      def.frame(a, at(31));
      const scale = /scale\(([\d.]+),([\d.]+)\)/.exec(a.face.open.getAttribute("transform"));
      expect(a.face.open.getAttribute("transform")).not.toBe(before);
      expect(Number(scale[1])).toBeGreaterThan(1.25);
      expect(Number(scale[2])).toBeGreaterThan(1.25);
      if (id === "slime") expect(a.face.whites.getAttribute("display")).toBe(null);
      def.scared(a, 0);
      def.frame(a, at(32));
      expect(Number(/scale\(([\d.]+),/.exec(a.face.open.getAttribute("transform"))[1])).toBe(1);
    });
  }
});

describe("a knocked robot in the 3D look", () => {
  it("shows crosses and a red lamp, and an emote does not open its eyes", () => {
    const r = makeRobot(null);
    dressRobot(r, BLUE, true);
    const p = piece();
    poseRobot(r, p, 900, 1 / 60, quiet);
    startKnock(p, p.rx + 200, 1000);
    poseRobot(r, p, 1300, 1 / 60, quiet);
    emoteRobot(r, { body: { dx: 0, lift: 0, rot: 0, tint: 0 }, ghost: { nubs: 0 }, face: { eyes: "open", eye: 1.3, up: 0, lid: 0 } }, 1300, 0);
    expect(r.crosses.visible).toBe(true);
    expect(r.eyes.visible).toBe(false);
  });
});
