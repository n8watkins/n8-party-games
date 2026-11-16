// Name tags step up so none lies across another (public/tag-levels.js), in every look.
import { describe, expect, it } from "vitest";
import { TAG_LEVELS, tagLevels } from "../public/tag-levels.js";

const STEP = 30;
/** Pairs of tags that lie across each other where they really are: their piece's height and their step up. */
const overlaps = (pieces, width) => {
  const bad = [];
  const lift = (p) => (p.up ?? 0) + p.want * STEP;
  for (const a of pieces)
    for (const b of pieces)
      if (a.name < b.name && Math.abs(lift(a) - lift(b)) < STEP - 0.01 && Math.abs(a.rx - b.rx) < (width(a) + width(b)) / 2) bad.push(`${a.name}/${b.name}`);
  return bad;
};
const place = (pieces) => tagLevels(pieces, (p) => p.w, (p) => p.up ?? 0, () => STEP);

describe("name tag levels", () => {
  it("keeps every tag on the floor when none are near", () => {
    const pieces = [{ rx: 100, w: 80 }, { rx: 400, w: 80 }, { rx: 700, w: 80 }];
    place(pieces);
    expect(pieces.map((p) => p.want)).toEqual([0, 0, 0]);
  });

  it("does not put a short piece's stepped-up tag on a tall piece's (the review's phone: a ghost between pawns)", () => {
    const width = (p) => p.w;
    // A pawn's tag, then a ghost's (its head is lower, so its tag is too), close together.
    const pieces = [
      { name: "Ada", rx: 120, w: 54, up: 0 },
      { name: "upright", rx: 100, w: 200, up: -22 },
      { name: "laptop", rx: 230, w: 190, up: -22 },
    ];
    place(pieces);
    expect(overlaps(pieces, width)).toEqual([]);
  });

  it("never lets two tags overlap while there is a step free, however the pieces stand and whatever they are", () => {
    const width = (p) => p.w;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 500; round++) {
      const pieces = Array.from({ length: TAG_LEVELS }, (_, i) => ({ name: String(i), rx: 600 + rand() * 300, w: 40 + rand() * 200, up: rand() < 0.5 ? 0 : -22 }));
      place(pieces);
      expect(overlaps(pieces, width), `round ${round}`).toEqual([]);
    }
  });
});
