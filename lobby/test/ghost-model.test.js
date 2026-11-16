// The ghost's 3D model (public/look3d/ghost.js) without a browser: an idle ghost is not
// "moving" (the room draws every frame only while something moves, so a room of idle ghosts
// must cost what a room of idle pawns does), with room to spare; and its reflection and its
// look in the baked look are its own.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STILL, bakeGhost, dressGhost, emoteGhost, makeGhost, poseGhost } from "../public/look3d/ghost.js";
import { Reflection } from "../public/look3d/characters.js";
import { bakePawn, dressPawn, emotePawn, makePawn } from "../public/look3d/pieces.js";

const piece = (seat = 0) => ({ seat, rx: 900, face: 1, jumpAt: -Infinity, attack: null, knock: null, fx: { char: 0, hopAt: -Infinity } });
const quiet = { walking: false, lit: 0.5, calm: false };

/** Poses an idle ghost for `seconds` at 60 frames a second; returns each frame's answer and its springs. */
function idle(seconds, seat = 0) {
  const g = makeGhost(null);
  dressGhost(g, "#3aa9a0", true);
  const p = piece(seat);
  const frames = [];
  for (let i = 0; i < seconds * 60; i++) {
    const out = poseGhost(g, p, 1000 + i * (1000 / 60), 1 / 60, quiet);
    frames.push({ moving: out.moving, sqV: Math.abs(g.sqV), trV: Math.abs(g.trV), leanV: Math.abs(g.leanV), puffV: Math.abs(g.puffV), trail: Math.abs(g.trX - p.rx) });
  }
  return frames;
}

describe("an idle ghost", () => {
  it("is never moving once it has settled, in any seat", () => {
    for (const seat of [0, 1, 2, 3]) {
      const settled = idle(12, seat).slice(90);
      expect(settled.filter((f) => f.moving), `seat ${seat}`).toEqual([]);
    }
  });

  it("keeps its hover, bob and breath out of the springs: each sits far below its 'moving' threshold, not just under it", () => {
    const settled = idle(12).slice(90);
    const most = (k) => Math.max(...settled.map((f) => f[k]));
    // A tenth of each threshold at most: a tweak to the hover, the bob or the breath cannot tip every idle ghost room into drawing every frame.
    expect(most("sqV")).toBeLessThan(STILL.squashV / 10);
    expect(most("trV")).toBeLessThan(STILL.trailV / 10);
    expect(most("leanV")).toBeLessThan(STILL.leanV / 10);
    expect(most("puffV")).toBeLessThan(STILL.puffV / 10);
  });
});

describe("the baked look's finish", () => {
  it("leaves a fuming piece red: it is given before the emote, and the emote's red stays on top", () => {
    const fume = { body: { dx: 0, lift: 0, rot: 0, tint: 1 }, face: { eyes: "open", eye: 1, lid: 0, up: 0, mouth: null }, ghost: { puff: 0.1, yaw: 0, nubs: 1 } };
    const g = makeGhost(null);
    dressGhost(g, "#3aa9a0", true);
    poseGhost(g, piece(), 1000, 1 / 60, quiet);
    bakeGhost(g);
    emoteGhost(g, fume, 1000, 0);
    expect(g.mat.color.r).toBeGreaterThan(g.mat.color.g * 3);
    const pawn = makePawn(null);
    dressPawn(pawn, "#2f6f8f", true);
    bakePawn(pawn);
    emotePawn(pawn, fume, 0.01);
    expect(pawn.mat.color.r).toBeGreaterThan(pawn.mat.color.b);
  });

  it("is given by the room between a body's pose and its emote, never just before the picture is drawn", () => {
    const strip = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const room = strip("../public/look3d/room3d.js");
    const [pose, finish, express] = ["p.kind.pose(p.body", "this.finish(p)", "this.express(p"].map((s) => room.indexOf(s));
    expect(pose).toBeGreaterThan(0);
    expect(finish).toBeGreaterThan(pose);
    expect(express).toBeGreaterThan(finish);
    const baked = strip("../public/baked/room-baked.js");
    const dress = baked.slice(baked.indexOf("dressPieces() {"), baked.indexOf("stats() {"));
    expect(dress).not.toMatch(/\.bake\(/);
    expect(baked).toMatch(/finish\(p\) \{\s*if \(!this\.plain\) p\.kind\.bake\(p\.body\);/);
  });
});

describe("a reflection", () => {
  it("is made from the body's own surface, in its own colours: a ghost's hem, not a flat white sheet", () => {
    const g = makeGhost(null);
    dressGhost(g, "#8a5bc4", true);
    poseGhost(g, piece(), 1000, 1 / 60, quiet);
    g.group.updateMatrixWorld(true);
    const r = new Reflection(g);
    r.update(1, 0.2);
    expect(r.children).toHaveLength(g.skin.length);
    const sheet = r.children[0];
    expect(sheet.geometry).toBe(g.skin[0].geometry);
    expect(sheet.material.vertexColors).toBe(true);
    // Upside down under the floor.
    expect(sheet.matrixWorld.elements[5]).toBeLessThan(0);
    // A dropped player's ghost is dim in the floor too.
    dressGhost(g, "#8a5bc4", false);
    poseGhost(g, piece(), 1100, 1 / 60, quiet);
    bakeGhost(g);
    r.update(1, 0.2);
    expect(sheet.material.color.r).toBeLessThan(0.8);
    r.dispose();
  });
});
