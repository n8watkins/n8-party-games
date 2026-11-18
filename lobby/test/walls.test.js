// Where a room hangs its boxes and its pools of light lie (lobby/shared/rooms.js, wallFor): most
// rooms evenly, the bar under its painting's five gold frames. The room decides who stands in which
// light by it, and every look draws it, so a piece under a painted frame votes for that frame's game.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { knockLanding, landingGround } from "../shared/bump.js";
import { SCARE_LANDING, SPOOK_LANDING } from "../shared/ghost.js";
import { ROOMS, hangsOwnBoxes, wallFor } from "../shared/rooms.js";
import { boxFromManifest } from "../shared/vote.js";
import { POSITION_SLACK, ROOM, boxCentre, evenWall, lightAt, lightHalf, spawnX } from "../shared/world.js";
import { layout } from "../public/look3d/space.js";

const plate = JSON.parse(readFileSync(new URL("../public/look3d/rendered/bar/layers/plate.json", import.meta.url), "utf8"));
const BAR = wallFor("bar", 5);

describe("a room's wall", () => {
  it("is even in every room but the bar's five, and the bar's is the middles of its painted frames", () => {
    for (const { id } of ROOMS) for (const n of [3, 4, 5, 6]) if (!(id === "bar" && n === 5)) expect(wallFor(id, n).xs).toEqual(evenWall(n).xs);
    expect(hangsOwnBoxes("bar", 5)).toBe(true);
    expect(hangsOwnBoxes("bar", 6)).toBe(false);
    expect(hangsOwnBoxes("ship", 5)).toBe(false);
    const painted = plate.frames.map((f) => (f.open.x + f.open.w / 2) * plate.painting.scale);
    BAR.xs.forEach((x, i) => expect(Math.abs(x - painted[i])).toBeLessThan(0.2));
  });

  it("keeps today's rules exactly for an even wall", () => {
    for (const n of [4, 5, 6]) {
      const w = evenWall(n);
      expect(w.half).toBe(lightHalf(n));
      for (let x = ROOM.minX; x <= ROOM.maxX; x += 7) expect(lightAt(x, w)).toBe(lightAt(x, n));
      for (let seat = 0; seat < 8; seat++) expect(spawnX(seat, w)).toBe(spawnX(seat, n));
      expect(w.xs).toEqual(Array.from({ length: n }, (_, i) => boxCentre(i, n)));
    }
    // The Star Lounge keeps today's spacing.
    expect(wallFor("ship", 5).xs).toEqual(evenWall(5).xs);
  });

  it("puts a piece under each of the bar's painted frames in that frame's light, and nowhere else's", () => {
    for (let i = 0; i < 5; i++) {
      const o = plate.frames[i].open;
      // Anywhere under the frame's opening but its outer edges (the pools are a little narrower than the frames).
      for (const u of [0.15, 0.5, 0.85]) expect(lightAt((o.x + o.w * u) * plate.painting.scale, BAR)).toBe(i);
    }
    // The even wall's end pools are dark in the bar: the first is in front of the bar stools, the last under the chalkboard.
    expect(lightAt(boxCentre(0, 5), BAR)).toBe(-1);
    expect(lightAt(boxCentre(4, 5), BAR)).toBe(-1);
  });

  it("leaves no pool out of reach, none on another, and a dark gap between each two", () => {
    for (const w of [BAR, evenWall(4), evenWall(5), evenWall(6)]) {
      for (let i = 0; i < w.n; i++) {
        expect(w.xs[i] - w.half).toBeGreaterThan(ROOM.minX);
        expect(w.xs[i] + w.half).toBeLessThan(ROOM.maxX);
        if (i) expect(w.xs[i] - w.half - (w.xs[i - 1] + w.half)).toBeGreaterThan(20);
      }
    }
  });

  it("brings every piece in in the dark, inside the walls, and does not crowd four players", () => {
    for (const w of [BAR, evenWall(4), evenWall(5), evenWall(6)]) {
      const xs = Array.from({ length: 8 }, (_, seat) => spawnX(seat, w));
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(ROOM.minX);
        expect(x).toBeLessThanOrEqual(ROOM.maxX);
        expect(lightAt(x, w)).toBe(-1);
      }
      const four = xs.slice(0, 4).sort((a, b) => a - b);
      for (let i = 1; i < 4; i++) expect(four[i] - four[i - 1]).toBeGreaterThanOrEqual(90);
    }
  });

  it("knocks a piece into the dark on the bar's wall too, never into another light", () => {
    const ground = landingGround(BAR);
    expect(ground[0][0]).toBe(ROOM.minX);
    expect(ground.at(-1)[1]).toBe(ROOM.maxX);
    for (let x = ROOM.minX; x <= ROOM.maxX; x += 13)
      for (const dir of [-1, 1]) {
        const to = knockLanding(x, dir, BAR);
        expect(lightAt(to, BAR), `x=${x} dir=${dir}`).toBe(-1);
        expect(to).toBeGreaterThanOrEqual(ROOM.minX);
        expect(to).toBeLessThanOrEqual(ROOM.maxX);
      }
  });

  it("lands the ghost's spook and scare on the bar's wall as on any other: never into another light, never further than they reach", () => {
    for (const reach of [SPOOK_LANDING, SCARE_LANDING])
      for (const lit of [null, [0, 2, 4]])
        for (let x = ROOM.minX; x <= ROOM.maxX; x += 7)
          for (const dir of [-1, 1]) {
            const from = lightAt(x, BAR);
            const to = knockLanding(x, dir, BAR, lit, reach);
            const at = lightAt(to, BAR);
            const on = (i) => i !== -1 && (!lit || lit.includes(i));
            // Out of the light it stood in, or (a spook in the middle of a pool wider than it reaches) still in that one: never into another that is on.
            if (on(at)) expect(at, `x=${x} dir=${dir}`).toBe(from);
            expect(Math.abs(to - x)).toBeLessThanOrEqual((reach.most ?? Infinity) + 1);
            expect(to).toBeGreaterThanOrEqual(ROOM.minX);
            expect(to).toBeLessThanOrEqual(ROOM.maxX);
          }
  });

  it("leaves a piece on the edge of the dark, on the bar's wall, when no dark is within its reach that way", () => {
    // Just right of the second frame's pool, pushed left with a reach too short to cross it: it stays where it is.
    const x = Math.ceil(BAR.xs[1] + BAR.half + 0.5);
    expect(lightAt(x, BAR)).toBe(-1);
    expect(knockLanding(x, -1, BAR, null, { distance: 20, least: 10, most: 20 })).toBe(x);
    // Inside that pool, with no dark within reach: moved the reach inside it, not out through a neighbour.
    expect(knockLanding(BAR.xs[1], -1, BAR, null, { distance: 20, least: 10, most: 20 })).toBe(Math.round(BAR.xs[1] - 20));
  });

  it("is where the 3D look hangs the boxes and lays the pools", () => {
    const L = layout(BAR);
    expect(L.n).toBe(5);
    L.xs.forEach((x, i) => expect(960 + x * 125.55).toBeCloseTo(BAR.xs[i], 6));
    // Boxes no wider than their spacing allows, so neighbours never touch.
    expect(L.bw * 125.55).toBeLessThan(BAR.slot);
    expect(layout(5).xs).toEqual(layout(evenWall(5)).xs);
  });
});

describe("the room decides the vote by its wall", () => {
  const five = ["one", "two", "three", "four", "five"].map((id) => boxFromManifest({ ...coinFlipManifest, id, name: id }, { test: true }));
  const core = (room) => {
    const c = new LobbyCore({ boxes: five, games: new Map(five.map((b) => [b.id, coinFlip])), seed: 3, code: "BCDFGH", now: 1000 });
    c.room = room;
    return c;
  };
  /** Walks a seat's piece to x in steps the room believes. */
  const walk = (c, seat, x, now) => {
    const m = c.members[seat];
    let at = m.x;
    while (Math.abs(x - at) > POSITION_SLACK) {
      at += Math.sign(x - at) * POSITION_SLACK;
      c.move(seat, { x: at, d: 0, r: m.rev }, now);
    }
    c.move(seat, { x, d: 0, r: m.rev }, now);
  };

  it("in the bar, a piece under each painted frame stands in that frame's game's light", () => {
    const c = core("bar");
    const joined = c.join("Ann", 1000);
    c.connect(joined.token, 1000);
    expect(lightAt(c.members[joined.seat].x, BAR)).toBe(-1);
    BAR.xs.forEach((x, i) => {
      walk(c, joined.seat, x, 1000);
      expect(c.standing(1000)[joined.seat]).toBe(five[i].id);
    });
    // Where the even wall has its first pool, the bar has dark floor in front of its stools.
    walk(c, joined.seat, boxCentre(0, 5), 1000);
    expect(c.standing(1000)[joined.seat]).toBe(null);
  });

  it("in the Star Lounge, the same place is the even wall's", () => {
    const c = core("ship");
    const joined = c.join("Bo", 1000);
    c.connect(joined.token, 1000);
    walk(c, joined.seat, boxCentre(0, 5), 1000);
    expect(c.standing(1000)[joined.seat]).toBe("one");
    // Between the even wall's first two pools: dark there, and in the bar under its second frame.
    expect(lightAt(800, BAR)).toBe(1);
    walk(c, joined.seat, 800, 1000);
    expect(c.standing(1000)[joined.seat]).toBe(null);
  });

  it("works out who stands where again when the party moves room", () => {
    const c = core("ship");
    const joined = c.join("Cy", 1000);
    c.connect(joined.token, 1000);
    walk(c, joined.seat, 800, 1000);
    expect(c.standing(1000)[joined.seat]).toBe(null);
    c.room = "bar";
    expect(c.standing(1000)[joined.seat]).toBe("two");
  });
});
