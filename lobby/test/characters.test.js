// The character interface (lobby/README.md, "Characters"): the room's list, the page's flat
// drawings and emotes, and the 3D look's models name the same characters; every definition has
// every part a draw site asks for; and the ghost does the room's 14 emotes the way the owner
// chose from the preview (hands by default, wisps for three, one take for Fuming).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMOTES } from "../../party-kit/client/emotes.js";
import { GHOST, GHOST_RIG, WISP, ghostPoseTop, ghostRigById, joinOf, mirrorGhostPose, wispAt, wispHalf } from "../public/characters/ghost-rig.js";
import { CHARACTER_DRAWINGS, drawingOf } from "../public/characters/index.js";
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
    for (const odd of ["slime", undefined, null, "constructor", "__proto__", "toString"]) expect(drawingOf(odd).id, String(odd)).toBe(DEFAULT_CHARACTER);
    expect(drawingOf("ghost").id).toBe("ghost");
  });

  it("gives every definition every part the draw sites ask for", () => {
    for (const def of Object.values(CHARACTER_DRAWINGS)) {
      for (const part of ["byId", "mirror", "top"]) expect(typeof def.emotes[part], `${def.id}.emotes.${part}`).toBe("function");
      for (const part of ["make", "dress", "frame", "dizzy", "blink", "emote", "still", "portrait"]) expect(typeof def.flat[part], `${def.id}.flat.${part}`).toBe("function");
      expect(finite(def.flat.tall) && finite(def.flat.rest), def.id).toBe(true);
      expect(def.flat.shadow.rx, def.id).toBeGreaterThan(0);
      expect(["stick", "ghost"], def.id).toContain(def.flat.figure.limbs);
      expect(typeof def.flat.figure.tint, def.id).toBe("function");
    }
  });

  it("names no character at a draw site: the rooms and the bump ask the definition", () => {
    for (const file of ["../public/scene.js", "../public/bump-draw.js", "../public/look3d/room3d.js", "../public/baked/room-baked.js", "../public/emotes/play.js"]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/["'`](pawn|ghost)["'`]|makePawn|posePawn|dressPawn|bakePawn|makeGhost|poseGhost|dressGhost|bakeGhost/);
    }
  });

  it("reads no body's paint outside the character definitions: a ghost's `mat` and `colour` are its white sheet", () => {
    const sites = drawSites();
    // Every file of the page is looked at, not a list: a new room is checked the day it is written.
    expect(sites.length).toBeGreaterThan(20);
    expect(sites).toContain("../public/look3d/room3d.js");
    expect(sites).toContain("../public/baked/room-baked.js");
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

/** Every page file outside the character definitions (characters/, look3d/characters.js, look3d/pieces.js, look3d/ghost.js), as paths from this test. */
function drawSites() {
  const root = new URL("../public/", import.meta.url);
  const own = /^(characters\/|look3d\/(characters|pieces|ghost)\.js$)/;
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
  });

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
    { seat: 2, x: 1500, face: 1, character: "robot" },
  ];
  const xOf = (seat) => pieces.find((p) => p.seat === seat)?.x;

  it("gives each piece its own character's way of doing it, in the same room at the same time", () => {
    const ex = new Expressions();
    for (const p of pieces) expect(ex.start(p.seat, "trophy", 0, pieces)).toBe(true);
    const ghost = ex.pose(0, 1250, xOf, false);
    const pawn = ex.pose(1, 1250, xOf, false);
    expect(ghost.pose.ghost.limb).toBe("wisp");
    expect(pawn.pose.ghost).toBeUndefined();
    // A character this page does not know does the default's.
    expect(ex.pose(2, 1250, xOf, false).pose.ghost).toBeUndefined();
    expect(ghost.word).toBe(pawn.word);
    expect(finite(ghost.top) && finite(pawn.top)).toBe(true);
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
