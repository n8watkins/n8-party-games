// The character interface (lobby/README.md, "Characters"): the room's list, the page's flat
// drawings and emotes, and the 3D look's models name the same characters; every definition has
// every part a draw site asks for; and the ghost does the room's 14 emotes the way the owner
// chose from the preview (hands by default, wisps for three, one take for Fuming).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMOTES } from "../../party-kit/client/emotes.js";
import { GHOST, GHOST_RIG, WISP, ghostPoseTop, ghostRigById, joinOf, mirrorGhostPose, wispAt, wispHalf } from "../public/characters/ghost-rig.js";
import { CHARACTER_DRAWINGS, drawingOf } from "../public/characters/index.js";
import { GHOST_MEASURES, carryPose } from "../public/characters/body-rig.js";
import { ROBOT, ROBOT_RIG } from "../public/characters/robot.js";
import { SLIME, SLIME_RIG } from "../public/characters/slime.js";
import { Expressions } from "../public/emotes/play.js";
import { REACH, rigById } from "../public/emotes/rig.js";
import { CHARACTERS, DEFAULT_CHARACTER } from "../shared/characters.js";

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the one list of characters", () => {
  const ids = CHARACTERS.map((c) => c.id);

  it("is drawn flat, with emotes, for exactly the room's characters, the default first", () => {
    expect(Object.keys(CHARACTER_DRAWINGS)).toEqual(ids);
    expect(Object.keys(CHARACTER_DRAWINGS)[0]).toBe(DEFAULT_CHARACTER);
    for (const id of ids) expect(CHARACTER_DRAWINGS[id].id).toBe(id);
  });

  it("has a model in the 3D look for exactly the room's characters", () => {
    // The 3D look needs a browser (three.js is served by the site), so its list is read as text.
    const source = read("../public/look3d/characters.js");
    const listed = source.match(/export const CHARACTER_MODELS = \{([^}]*)\}/)[1].split(",").map((s) => s.trim()).filter(Boolean);
    expect(listed).toEqual(ids);
    for (const id of ids) {
      const def = source.match(new RegExp(`const ${id} = \\{([^}]*)\\}`))[1];
      expect(def).toContain(`id: "${id}"`);
      for (const part of ["make", "dress", "pose", "emote", "hands", "fade", "bake", "dispose"]) expect(def, `${id}.${part}`).toMatch(new RegExp(`\\b${part}:`));
    }
  });

  it("draws an unknown character as the default, and never reads a name off the prototype", () => {
    for (const odd of ["dragon", "Slime", undefined, null, "constructor", "__proto__", "toString"]) expect(drawingOf(odd).id, String(odd)).toBe(DEFAULT_CHARACTER);
    for (const id of ["ghost", "slime", "robot"]) expect(drawingOf(id).id).toBe(id);
  });

  it("gives every definition every part the draw sites ask for", () => {
    for (const def of Object.values(CHARACTER_DRAWINGS)) {
      for (const part of ["byId", "mirror", "top"]) expect(typeof def.emotes[part], `${def.id}.emotes.${part}`).toBe("function");
      for (const part of ["make", "dress", "frame", "dizzy", "blink", "scared", "emote", "still", "portrait"]) expect(typeof def.flat[part], `${def.id}.flat.${part}`).toBe("function");
      expect(finite(def.flat.tall) && finite(def.flat.rest), def.id).toBe(true);
      expect(def.flat.shadow.rx, def.id).toBeGreaterThan(0);
      expect(["stick", "ghost", "goo", "rod"], def.id).toContain(def.flat.figure.limbs);
      expect(typeof def.flat.figure.tint, def.id).toBe("function");
    }
  });

  it("names no character at a draw site: the rooms and the bump ask the definition", () => {
    for (const file of ["../public/scene.js", "../public/bump-draw.js", "../public/look3d/room3d.js", "../public/baked/room-baked.js", "../public/emotes/play.js"]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/["'`](pawn|ghost|slime|robot)["'`]|(make|pose|dress|bake)(Pawn|Ghost|Slime|Robot)/);
    }
  });

  it("reads no body's paint outside the character definitions: a ghost's `mat` and `colour` are its white sheet", () => {
    const sites = drawSites();
    // Every file of the page is looked at, not a list: a new room is checked the day it is written.
    expect(sites.length).toBeGreaterThan(20);
    expect(sites).toContain("../public/look3d/room3d.js");
    expect(sites).toContain("../public/baked/room-baked.js");
    expect(sites).toContain("../public/look3d/rendered/room-rendered.js");
    for (const file of sites) expect(paintReads(read(file)), file).toEqual([]);
  });

  it("would catch a room that reaches into a body's paint, by its handle or through a name for it", () => {
    expect(paintReads("x(p.body.mat.color);")).toHaveLength(1);
    expect(paintReads("const pawn = p.body;\npawn.mat.clearcoat = 1;\nm.color.copy(pawn.colour);")).toHaveLength(2);
    expect(paintReads("for (const p of this.pieces.values()) { const { mat } = p.body; }")).toHaveLength(1);
    expect(paintReads("p.pawn.dizzy")).toHaveLength(1);
    // A member's colour, and a body's handles every room may read, are fine.
    expect(paintReads("dot.style.background = m.colour; const b = p.body; b.blob.position.x = 1; p.kind.bake(p.body);")).toEqual([]);
  });
});

/** Every page file outside the character definitions (characters/, look3d/characters.js, and each character's model in look3d/), as paths from this test. */
function drawSites() {
  const root = new URL("../public/", import.meta.url);
  const own = /^(characters\/|look3d\/(characters|pieces|ghost|slime|robot)\.js$)/;
  return readdirSync(root, { recursive: true })
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter((f) => f.endsWith(".js") && !own.test(f))
    .map((f) => "../public/" + f);
}

/**
 * Where code reads or writes a body's `mat` or `colour` (the character's own paint) or still calls
 * the body `p.pawn`: through `<x>.body`, or through a name given to a body (`const pawn = p.body`).
 */
function paintReads(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const names = [...code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[\w.?]*\.body\b(?!\.)/g)].map((m) => m[1]);
  const found = [...code.matchAll(/\.body\??\.(mat|colour)\b|\.pawn\b/g)].map((m) => m[0]);
  found.push(...[...code.matchAll(/(?:const|let|var)\s*\{[^}]*\b(mat|colour)\b[^}]*\}\s*=\s*[\w.?]*\.body\b/g)].map((m) => m[0]));
  for (const name of names) found.push(...[...code.matchAll(new RegExp(`\\b${name}\\??\\.(mat|colour)\\b`, "g"))].map((m) => m[0]));
  return found;
}

describe("the ghost's emotes", () => {
  it("are exactly the kit's emotes, in the same order, as long as the pawn's (each recording fits both)", () => {
    expect(GHOST_RIG.map((e) => e.id)).toEqual(EMOTES.map((e) => e.id));
    for (const e of GHOST_RIG) {
      const pawn = rigById(e.id);
      expect([e.dur, e.word, e.name, !!e.aimed], e.id).toEqual([pawn.dur, pawn.word, pawn.name, !!pawn.aimed]);
      expect(e.hold, e.id).toBeGreaterThan(0);
      expect(e.hold, e.id).toBeLessThan(e.dur);
    }
  });

  it("uses the take the owner chose for each: hands by default, wisps for GG, Lighter up and Huh?, none for Fuming", () => {
    const takes = Object.fromEntries(GHOST_RIG.map((e) => [e.id, e.take]));
    expect(takes).toEqual({
      popcorn: "float", slowclap: "float", pointlaugh: "float", redcard: "float", hurry: "float", thumbsup: "float", confetti: "float", boo: "float", shush: "float", tomato: "float",
      trophy: "wisp", lighter: "wisp", scratch: "wisp",
      steam: "none",
    });
    for (const e of GHOST_RIG) {
      const p = e.pose(e.hold, false, REACH);
      expect(p.ghost.limb, e.id).toBe(e.take);
      if (e.take === "none") expect(p.hands, e.id).toEqual([]);
      else expect(p.hands.length, e.id).toBeGreaterThan(0);
    }
  });

  it("poses every emote at every moment, near and far, calm or not, with numbers only", () => {
    for (const e of GHOST_RIG) {
      for (let t = 0; t <= e.dur; t += 50) {
        for (const reach of [90, REACH, 420]) {
          for (const calm of [false, true]) {
            const p = e.pose(t, calm, reach);
            for (const v of Object.values(p.body)) expect(finite(v), `${e.id} body at ${t}`).toBe(true);
            for (const h of p.hands) for (const v of [h.x, h.y, h.rot, h.s, h.arm.shoulder.x, h.arm.elbow.x, h.arm.elbow.y, h.arm.wrist.y]) expect(finite(v), `${e.id} hand at ${t}`).toBe(true);
            for (const v of [p.ghost.yaw, p.ghost.puff, p.ghost.nubs]) expect(finite(v), `${e.id} ghost at ${t}`).toBe(true);
            expect(p.ghost.nubs, e.id).toBeGreaterThanOrEqual(0);
            expect(p.ghost.nubs, e.id).toBeLessThanOrEqual(1);
            expect(finite(ghostPoseTop(p)), e.id).toBe(true);
          }
        }
      }
    }
    // About two seconds of plain arithmetic on a quiet PC; on a loaded one it ran past vitest's 5 s default.
  }, 30000);

  it("starts every arm at the side of the sheet, where the nub arms are", () => {
    for (const e of GHOST_RIG) {
      for (const h of e.pose(e.hold, false, REACH).hands) {
        expect(Math.abs(h.arm.shoulder.x), e.id).toBeCloseTo(GHOST.root.x);
        expect(h.arm.shoulder.y, e.id).toBeCloseTo(GHOST.root.y);
      }
    }
  });

  it("mirrors a pose exactly, the turn of the face with it: twice is the same pose", () => {
    for (const e of GHOST_RIG) {
      const p = e.pose(e.hold, false, 250);
      const once = mirrorGhostPose(p);
      expect(once.ghost.yaw).toBeCloseTo(-p.ghost.yaw);
      expect(once.ghost.limb).toBe(p.ghost.limb);
      p.hands.forEach((h, i) => expect(once.hands[i].x).toBeCloseTo(-h.x));
      expect(JSON.parse(JSON.stringify(mirrorGhostPose(once)))).toEqual(JSON.parse(JSON.stringify(p)));
    }
  });

  it("gives Point and laugh's pointing hand a cuff of the sheet, so it reads as the ghost's own, and no other floating hand one", () => {
    for (const e of GHOST_RIG) {
      const p = e.pose(e.hold, false, REACH);
      const joins = p.hands.map((h) => joinOf(p, h));
      if (e.id === "pointlaugh") expect(joins).toEqual(["cuff", null]);
      else if (e.take === "wisp") expect(new Set(joins), e.id).toEqual(new Set(["wisp"]));
      else expect(joins.every((j) => j === null), e.id).toBe(true);
    }
    // The cuff survives the mirror: the pose is drawn mirrored when the target is on the left.
    const laugh = ghostRigById("pointlaugh");
    const left = mirrorGhostPose(laugh.pose(laugh.hold, false, REACH));
    expect(joinOf(left, left.hands[0])).toBe("cuff");
  });

  it("throws the tomato at the floor short of the target, never at its body, as the pawn does", () => {
    const tomato = ghostRigById("tomato");
    let landed = null;
    for (let t = 0; t < tomato.dur; t += 10) {
      const splat = tomato.pose(t, false, 250).props.find((x) => x.kind === "splat");
      if (splat) landed ??= splat;
    }
    expect(landed.space).toBe("stage");
    expect(landed.x).toBeLessThan(250);
    expect(landed.y).toBeGreaterThan(-10);
  });
});

describe("a wisp", () => {
  const arm = { shoulder: { x: 31, y: -62 }, elbow: { x: 50, y: -50 }, wrist: { x: 70, y: -84 } };

  it("runs from the side of the sheet to the wrist", () => {
    const at = [0, 0, 0, 0];
    expect(wispAt(arm, 0, at).slice(0, 2)).toEqual([31, -62]);
    expect(wispAt(arm, 1, at).slice(0, 2)).toEqual([70, -84]);
    for (let u = 0; u <= 1; u += 0.1) expect(Math.hypot(wispAt(arm, u, at)[2], at[3])).toBeCloseTo(1);
  });

  it("tapers from the body to the wrist; a cuff is nothing until its trail begins, and meets the hand a little wider than a wisp does", () => {
    expect(wispHalf(0, false)).toBe(WISP.root);
    expect(wispHalf(1, false)).toBeCloseTo(WISP.wrist);
    for (let u = 0.1; u <= 1; u += 0.1) expect(wispHalf(u, false)).toBeLessThan(wispHalf(u - 0.1, false));
    expect(wispHalf(WISP.cuffFrom, true)).toBe(0);
    expect(wispHalf(0.2, true)).toBe(0);
    expect(wispHalf(1, true)).toBeGreaterThan(WISP.wrist);
  });
});

describe("who does which emote", () => {
  const pieces = [
    { seat: 0, x: 500, face: 1, character: "ghost" },
    { seat: 1, x: 700, face: -1, character: "pawn" },
    { seat: 2, x: 1500, face: 1, character: "dragon" },
    { seat: 3, x: 900, face: 1, character: "slime" },
    { seat: 4, x: 1100, face: -1, character: "robot" },
  ];
  const xOf = (seat) => pieces.find((p) => p.seat === seat)?.x;

  it("gives each piece its own character's way of doing it, in the same room at the same time", () => {
    const ex = new Expressions();
    for (const p of pieces) expect(ex.start(p.seat, "trophy", 0, pieces)).toBe(true);
    const ghost = ex.pose(0, 1250, xOf, false);
    const pawn = ex.pose(1, 1250, xOf, false);
    const slime = ex.pose(3, 1250, xOf, false);
    const robot = ex.pose(4, 1250, xOf, false);
    expect(ghost.pose.ghost.limb).toBe("wisp");
    expect(slime.pose.ghost.limb).toBe("goo");
    expect(robot.pose.ghost.limb).toBe("rod");
    expect(pawn.pose.ghost).toBeUndefined();
    // A character this page does not know does the default's.
    expect(ex.pose(2, 1250, xOf, false).pose.ghost).toBeUndefined();
    for (const e of [ghost, slime, robot]) expect(e.word).toBe(pawn.word);
    for (const e of [ghost, pawn, slime, robot]) expect(finite(e.top)).toBe(true);
    // The robot's head is a pawn's height, the slime is far shorter: the word over each sits accordingly.
    expect(slime.top).toBeGreaterThan(robot.top);
  });

  it("turns a ghost's face to the piece it aims at, on either side", () => {
    const ex = new Expressions();
    ex.start(0, "redcard", 0, pieces);
    expect(ex.pose(0, 1000, xOf, false).pose.ghost.yaw).toBeGreaterThan(0);
    const left = [{ seat: 0, x: 900, face: 1, character: "ghost" }, pieces[1]];
    ex.start(0, "redcard", 0, left);
    expect(ex.pose(0, 1000, (seat) => left.find((p) => p.seat === seat)?.x, false).pose.ghost.yaw).toBeLessThan(0);
  });

  it("refuses an emote the piece's character does not have", () => {
    expect(new Expressions().start(0, "violin", 0, pieces)).toBe(false);
  });
});

describe("the slime's and the robot's emotes: the ghost's, fitted to their bodies", () => {
  const bodies = [
    ["slime", SLIME_RIG, SLIME, "goo"],
    ["robot", ROBOT_RIG, ROBOT, "rod"],
  ];

  it("are exactly the kit's emotes, as long as the pawn's, with the same words", () => {
    for (const [name, rig] of bodies) {
      expect(rig.map((e) => e.id), name).toEqual(EMOTES.map((e) => e.id));
      for (const e of rig) {
        const pawn = rigById(e.id);
        expect([e.dur, e.word, e.name, !!e.aimed], `${name} ${e.id}`).toEqual([pawn.dur, pawn.word, pawn.name, !!pawn.aimed]);
        expect(e.hold, e.id).toBeGreaterThan(0);
        expect(e.hold, e.id).toBeLessThan(e.dur);
      }
    }
  });

  it("join every hand on with the body's own arm (goo, or a jointed rod), and Fuming has none", () => {
    for (const [name, rig, , join] of bodies) {
      for (const e of rig) {
        const p = e.pose(e.hold, false, REACH);
        expect(p.ghost.limb, `${name} ${e.id}`).toBe(e.id === "steam" ? "none" : join);
        if (e.id === "steam") expect(p.hands, e.id).toEqual([]);
        else {
          expect(p.hands.length, `${name} ${e.id}`).toBeGreaterThan(0);
          for (const h of p.hands) expect(joinOf(p, h), `${name} ${e.id}`).toBe(join === "goo" ? "wisp" : "rod");
        }
      }
    }
  });

  it("pose every emote at every moment, near and far, calm or not, with numbers only", () => {
    for (const [name, rig] of bodies) {
      const top = drawingOf(name).emotes.top;
      for (const e of rig) {
        for (let t = 0; t <= e.dur; t += 100) {
          for (const reach of [90, REACH, 420]) {
            for (const calm of [false, true]) {
              const p = e.pose(t, calm, reach);
              for (const v of Object.values(p.body)) expect(finite(v), `${name} ${e.id} body at ${t}`).toBe(true);
              for (const h of p.hands) for (const v of [h.x, h.y, h.rot, h.s, h.arm.shoulder.x, h.arm.elbow.x, h.arm.elbow.y, h.arm.wrist.y]) expect(finite(v), `${name} ${e.id} hand at ${t}`).toBe(true);
              for (const x of p.props) {
                for (const v of [x.x, x.y].filter((v) => v !== undefined)) expect(finite(v), `${name} ${e.id} prop at ${t}`).toBe(true);
                for (const b of x.bits ?? []) expect(finite(b.x) && finite(b.y), `${name} ${e.id} confetti at ${t}`).toBe(true);
              }
              for (const f of p.fx) expect(finite(f.x) && finite(f.y), `${name} ${e.id} fx at ${t}`).toBe(true);
              for (const v of [p.ghost.yaw, p.ghost.puff, p.ghost.nubs]) expect(finite(v), `${name} ${e.id} at ${t}`).toBe(true);
              expect(finite(top(p)), `${name} ${e.id}`).toBe(true);
            }
          }
        }
      }
    }
  }, 30000);

  it("start every arm at the body's own shoulder, and carry a hand at the ghost's mouth to the body's mouth", () => {
    for (const [name, rig, M] of bodies) {
      for (const e of rig) {
        for (const h of e.pose(e.hold, false, REACH).hands) {
          expect(Math.abs(h.arm.shoulder.x), `${name} ${e.id}`).toBeCloseTo(M.root.x);
          expect(h.arm.shoulder.y, `${name} ${e.id}`).toBeCloseTo(M.root.y);
          expect(h.arm.wrist.x).toBeCloseTo(h.x);
        }
      }
      // Shh: the fingertip on the lips. The ghost's hand sits 23 below its mouth; on another body it sits as far below that body's mouth, give or take the stretch.
      const shh = rig.find((e) => e.id === "shush").pose(1200, true, REACH).hands[0];
      expect(Math.abs(shh.y - M.mouth), name).toBeLessThan(40);
    }
  });

  it("keep the floor where it is: a splat lands short of the target, on the floor", () => {
    for (const [name, rig] of bodies) {
      const tomato = rig.find((e) => e.id === "tomato");
      let landed = null;
      for (let t = 0; t < tomato.dur; t += 10) landed ??= tomato.pose(t, false, 250).props.find((x) => x.kind === "splat") ?? null;
      expect(landed.space, name).toBe("stage");
      expect(landed.x, name).toBeLessThan(250);
      expect(landed.y, name).toBeGreaterThan(-10);
    }
  });

  it("mirror a pose exactly: twice is the same pose", () => {
    for (const [name, rig] of bodies) {
      const mirror = drawingOf(name).emotes.mirror;
      for (const e of rig) {
        const p = e.pose(e.hold, false, 250);
        const once = mirror(p);
        expect(once.ghost.yaw).toBeCloseTo(-p.ghost.yaw);
        p.hands.forEach((h, i) => expect(once.hands[i].x).toBeCloseTo(-h.x));
        expect(JSON.parse(JSON.stringify(mirror(once)))).toEqual(JSON.parse(JSON.stringify(p)));
      }
    }
  });

  it("carry the ghost's landmarks onto the other body: its floor, mouth and top, and widths in and outside it", () => {
    const T = { floor: 0, mouth: -100, top: -140, half: 50, root: { x: 40, y: -60 }, hover: 0, hand: 1, lift: 1, puff: 1 };
    const S = GHOST_MEASURES;
    const pose = { body: { lift: 0 }, face: {}, hands: [], fx: [{ kind: "text", x: S.half, y: S.mouth }, { kind: "text", x: 0, y: S.top - 10 }, { kind: "text", x: -S.half / 2, y: S.floor }], props: [{ kind: "splat", space: "stage", x: 300, y: -2 }], other: {}, ghost: { limb: "float", yaw: 0, puff: 0, nubs: 1 } };
    const out = carryPose(pose, S, T, "rod");
    expect(out.fx.map((f) => [f.x, f.y])).toEqual([
      [50, -100],
      [0, -150],
      [-25, 0],
    ]);
    // On the floor, well clear of the body: where it was.
    expect(out.props[0].x).toBe(300);
    expect(Math.abs(out.props[0].y)).toBeLessThan(2.5);
    // Beside the mouth, a hand keeps its place against the face one for one.
    const near = carryPose({ ...pose, fx: [{ kind: "text", x: 0, y: S.mouth + 20 }, { kind: "text", x: 0, y: S.mouth - 20 }] }, S, T, "rod");
    expect(near.fx.map((f) => f.y)).toEqual([-80, -120]);
  });
});
