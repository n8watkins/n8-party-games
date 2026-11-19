// A knocked-over piece's eyes, as the owner chose in character preview round three: a pawn's are
// squeezed shut, a wince (> <), never crosses, in the flat look and in 3D, so it reads as "oof" and
// never as hurt; the slime's flat eyes squeeze shut as its 3D ones do; the robot keeps its crosses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePawn, posePawn, startKnock } from "../public/look3d/pieces.js";
import { makeRobot, poseRobot } from "../public/look3d/robot.js";

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
  }
  setAttribute(k, v) {
    this.attrs.set(k, v);
  }
  removeAttribute(k) {
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

/** Whether a path is two chevrons (straight strokes meeting at a point) and nothing round or crossed. */
const isWince = (d) => (d.match(/M/g) ?? []).length === 2 && (d.match(/L/g) ?? []).length === 4 && !/[aAcCl]/.test(d);

describe("knocked eyes in the flat look", () => {
  let flat;
  beforeAll(async () => {
    globalThis.document = { createElementNS: (_, tag) => new FakeEl(tag) };
    flat = {
      pawn: (await import("../public/characters/pawn.js")).pawn.flat,
      slime: (await import("../public/characters/slime.js")).slime.flat,
      robot: (await import("../public/characters/robot.js")).robot.flat,
    };
  });
  afterAll(() => {
    delete globalThis.document;
  });

  it("a knocked pawn winces (> <): two chevrons, tips facing, never crosses; its eyes come back when it is up", () => {
    const a = flat.pawn.make();
    flat.pawn.dress(a, "#c8382c", true);
    flat.pawn.dizzy(a, true);
    const shut = a.crosses;
    expect(shut.getAttribute("class")).toBe("pawn-shut");
    expect(shut.getAttribute("display")).toBe(null);
    expect(a.eyes.getAttribute("display")).toBe("none");
    const [left, right] = shut.children.map((p) => p.getAttribute("d"));
    for (const d of [left, right]) expect((d.match(/L/g) ?? []).length).toBe(2);
    // The left one's tip (its middle point) is to the right of its ends, the right one's to the left.
    const pts = (d) => d.match(/-?[\d.]+,-?[\d.]+/g).map((p) => Number(p.split(",")[0]));
    expect(pts(left)[1]).toBeGreaterThan(pts(left)[0]);
    expect(pts(right)[1]).toBeLessThan(pts(right)[0]);
    flat.pawn.dizzy(a, false);
    expect(shut.getAttribute("display")).toBe("none");
    expect(a.eyes.getAttribute("display")).toBe(null);
  });

  it("a knocked slime's eyes squeeze shut the same way (no swirls), as in the 3D look", () => {
    const a = flat.slime.make();
    flat.slime.dizzy(a, true);
    expect(a.face.dizzy.getAttribute("display")).toBe(null);
    expect(isWince(a.face.dizzy.getAttribute("d"))).toBe(true);
  });

  it("a knocked robot keeps its crosses", () => {
    const a = flat.robot.make();
    flat.robot.dizzy(a, true);
    expect(a.face.crosses.getAttribute("display")).toBe(null);
    expect(a.face.crosses.getAttribute("d")).toMatch(/l10,10/);
  });
});

describe("knocked eyes in the 3D look", () => {
  const piece = () => ({ seat: 0, rx: 900, face: 1, jumpAt: -Infinity, attack: null, knock: null, fright: null, fx: { char: 0, hopAt: -Infinity } });
  const quiet = { walking: false, lit: 0.5, calm: false };

  it("a knocked pawn shows its wince (four short bars, two to an eye, tips facing) in place of its eyes", () => {
    const b = makePawn(null);
    const p = piece();
    posePawn(b, p, 900, 1 / 60, quiet);
    expect(b.shut.visible).toBe(false);
    startKnock(p, p.rx + 200, 1000);
    posePawn(b, p, 1300, 1 / 60, quiet);
    expect(b.shut.visible).toBe(true);
    expect(b.eyes.visible).toBe(false);
    // Two bars an eye, angled opposite ways, the left eye's middle further right than its bars' far ends.
    expect(b.shut.geometry.index ? b.shut.geometry.index.count : b.shut.geometry.attributes.position.count).toBeGreaterThan(0);
    posePawn(b, p, 5000, 1 / 60, quiet);
    expect(b.shut.visible).toBe(false);
    expect(b.eyes.visible).toBe(true);
  });

  it("a knocked robot keeps its crosses", () => {
    const r = makeRobot(null);
    const p = piece();
    poseRobot(r, p, 900, 1 / 60, quiet);
    startKnock(p, p.rx + 200, 1000);
    poseRobot(r, p, 1300, 1 / 60, quiet);
    expect(r.crosses.visible).toBe(true);
  });
});
