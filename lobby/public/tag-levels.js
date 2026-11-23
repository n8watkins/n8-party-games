// Name tags over the pieces, in the flat look (scene.js) and the 3D and baked looks
// (look3d/room3d.js): a tag that would lie across another steps up instead.

/** How many steps up a tag may go: enough for four pieces side by side, one of them shorter. */
export const TAG_LEVELS = 4;

/**
 * Gives each piece in `want` how many steps (`stepOf`: a tag's height and the gap over it) its tag
 * is lifted above where it would sit, going from left to right: the lowest lift where it clears
 * every tag already placed, by `gap` across and a step up and down. Tags are compared where they
 * really are, so a short piece's tag (a ghost's sits lower than a pawn's, by `upOf`) never lands
 * on a taller piece's, and a long tag ("Bea - reconnecting...") never lies across one two pieces
 * along. Sorts `pieces` by `rx`.
 * @param {{rx: number, want?: number}[]} pieces
 * @param {(piece: object) => number} widthOf  a tag's width, in the units of rx
 * @param {(piece: object) => number} upOf  how far its piece's top is above a standing pawn's
 * @param {(piece: object) => number} stepOf  a tag's height and the gap above it
 */
export function tagLevels(pieces, widthOf, upOf = () => 0, stepOf = () => 1, gap = 8) {
  pieces.sort((a, b) => a.rx - b.rx);
  const placed = [];
  for (const p of pieces) {
    const half = widthOf(p) / 2;
    const up = upOf(p);
    const step = stepOf(p);
    const near = placed.filter((o) => o.right + gap > p.rx - half);
    const clear = (lift) => near.every((o) => Math.abs(o.lift - lift) >= Math.max(step, o.step) - 0.001);
    const tries = [up, ...near.map((o) => o.lift + Math.max(step, o.step))].filter((l) => l >= up).sort((a, b) => a - b);
    const lift = Math.min(tries.find(clear) ?? up, up + TAG_LEVELS * step);
    placed.push({ right: p.rx + half, lift, step });
    p.want = (lift - up) / step;
  }
  return pieces;
}
