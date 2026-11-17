// The lobby room as numbers: where things are and how a piece moves. Plain logic with no clock
// of its own, shared by the room (lobby/server) and the page (lobby/public), so both always
// agree on where a piece is and which light it stands in.
//
// The room is a side view, 1920 units wide. A piece only has an x: it walks left and right
// along the floor. Jumping is for show and changes nothing the room decides. The bump has a
// file of its own (lobby/shared/bump.js).

/** The room in world units (the big screen at 1920 x 1080 shows one unit per pixel). */
export const ROOM = {
  width: 1920,
  /** Where pieces stand. */
  floorY: 890,
  /** How far a piece can walk. */
  minX: 110,
  maxX: 1810,
  /** The wall holds the game boxes between these two lines; the join sign and the board flank them. */
  boxesLeft: 296,
  boxesRight: 1580,
};

/** Walking speed in units per second. Movement has no acceleration, so anyone can work out where a piece is. */
export const WALK_SPEED = 430;
export const JUMP_MS = 520;
export const JUMP_HEIGHT = 110;

/** How far from where the room thinks a piece is a client may say it is. Beyond it, the room corrects the client. */
export const POSITION_SLACK = 420;

export function clampX(x) {
  return Math.min(ROOM.maxX, Math.max(ROOM.minX, x));
}

/** The middle of box `i` of `n` on the wall, which is also the middle of its pool of light. */
export function boxCentre(i, n) {
  const slot = (ROOM.boxesRight - ROOM.boxesLeft) / n;
  return ROOM.boxesLeft + slot * (i + 0.5);
}

/** How wide a box is, and half the width of its pool of light, for `n` boxes. */
export function boxWidth(n) {
  return (ROOM.boxesRight - ROOM.boxesLeft) / n - 36;
}
export function lightHalf(n) {
  return Math.min(118, ((ROOM.boxesRight - ROOM.boxesLeft) / n) * 0.4);
}

/**
 * About how wide a piece stands on the floor (a pawn's base, the widest of them), in world units:
 * the least dark there is between two pools of a placed wall, so a piece can stand between them
 * in the dark and look it.
 */
export const PIECE_WIDTH = 76;

/**
 * How far past a pool's counted edge each look draws its light, in world units: the pool on the
 * floor, the foot of the cone (or beam) from the lamp, and the warmth on a piece walking out of
 * it. An even wall has wide dark between its pools, and its light has always spilt a little past
 * the edge. A placed wall's dark gaps are about a piece wide, so its light ends at the counted
 * edge: what looks lit is exactly what counts, in every look.
 */
export const EVEN_SPILL = Object.freeze({ pool: 12, cone: 26, lit: 40 });
export const NO_SPILL = Object.freeze({ pool: 0, cone: 0, lit: 0 });

/**
 * A wall: where its `n` boxes hang, which is also where their pools of light lie on the floor
 * (`xs`, the middle of each, world units), how far apart they are at the least (`slot`), how wide
 * a box is (`box`), half the width of a pool (`half`) and how far its drawn light spills past
 * that (`spill`). Most rooms space their boxes evenly between ROOM.boxesLeft and ROOM.boxesRight
 * (evenWall); a room whose picture has the boxes somewhere else says where (shared/rooms.js,
 * wallFor: a placed wall), and every rule and every drawing of that room reads its wall, so a
 * piece in a pool votes for the box over it in every look.
 */
export function evenWall(n) {
  return { n, xs: Array.from({ length: n }, (_, i) => boxCentre(i, n)), slot: (ROOM.boxesRight - ROOM.boxesLeft) / n, box: boxWidth(n), half: lightHalf(n), spill: EVEN_SPILL, placed: false };
}

/**
 * A wall whose boxes hang at `xs` (world units, left to right): its boxes as wide as their spacing
 * allows, and its pools by the even wall's rule but never so wide that the dark between two is
 * narrower than a piece (PIECE_WIDTH). Its light does not spill (NO_SPILL), and pieces arrive in
 * the wide dark at either end of it, never in a gap (spawnX).
 */
export function placedWall(xs) {
  const slot = Math.min(...xs.slice(1).map((x, i) => x - xs[i]), ROOM.boxesRight - ROOM.boxesLeft);
  return { n: xs.length, xs: [...xs], slot, box: slot - 36, half: Math.min(118, slot * 0.4, (slot - PIECE_WIDTH) / 2), spill: NO_SPILL, placed: true };
}

/**
 * How far from a pool's middle each look draws its light, in world units, on a wall (or an even
 * wall of that many boxes): `pool` the lit floor and its ring, `cone` the foot of the cone or beam
 * from the lamp, `lit` how far a piece is warmed by it, over its last `fade` units. Every look
 * draws from these (scene.js, look3d/room3d.js, look3d/rendered), so on a placed wall each ends
 * at the counted edge (lightAt).
 */
export function drawnLight(wall) {
  const w = wallOf(wall);
  const spill = w.spill ?? EVEN_SPILL;
  return { pool: w.half + spill.pool, cone: w.half + spill.cone, lit: w.half + spill.lit, fade: spill.lit };
}

/** How warm a lamp makes a piece `d` units from the middle of its pool, 0 to 1 (drawnLight): full inside the pool, fading out over `fade` past it, and none past that. */
export function warmthAt(d, wall) {
  const light = drawnLight(wall);
  if (d > light.lit) return 0;
  return light.fade > 0 ? Math.min(1, (light.lit - d) / light.fade) : 1;
}

/** Whether two walls have their pools in the same places (a piece in the light of one is in the same light of the other). */
export const sameWall = (a, b) => a.n === b.n && a.half === b.half && a.xs.every((x, i) => x === b.xs[i]);

/** The places along the floor where the light changes, left to right: the walls, and each pool's two edges. */
const edgesOf = (w) => [ROOM.minX, ...w.xs.flatMap((x) => [x - w.half, x + w.half]), ROOM.maxX];

/**
 * Where a piece standing at `x` on wall `from` stands on wall `to`, when the party moves to a room
 * that hangs the same boxes elsewhere: the floor is stretched piece by piece between the walls and
 * each pool's edges, so a piece in pool i is in pool i (as far into it), and one in a stretch of
 * dark is in that same stretch. Walls with a different number of pools leave it where it is.
 */
export function acrossWalls(x, from, to) {
  const a = edgesOf(from);
  const b = edgesOf(to);
  if (a.length !== b.length) return x;
  for (let i = 1; i < a.length; i++) {
    if (x > a[i] && i < a.length - 1) continue;
    const span = a[i] - a[i - 1];
    const u = span > 0 ? Math.min(1, Math.max(0, (x - a[i - 1]) / span)) : 0;
    return clampX(b[i - 1] + u * (b[i] - b[i - 1]));
  }
  return x;
}

/** A wall from either a wall or a number of boxes (an even wall). */
export const wallOf = (wall) => (typeof wall === "number" ? evenWall(wall) : wall);

/** Which light an x stands in on a wall (or an even wall of that many boxes): the box's index, or -1 for the dark. */
export function lightAt(x, wall) {
  const w = wallOf(wall);
  for (let i = 0; i < w.n; i++) if (Math.abs(x - w.xs[i]) <= w.half) return i;
  return -1;
}

/**
 * Where the room puts a seat's piece (on arriving, and after a game): always in the dark, and
 * apart from the others. The first two stand by the door. On an even wall the rest stand in the
 * dark gaps between the pools further along; on a placed wall, whose gaps are only about a piece
 * wide, they stand in the wide dark at the far end of the wall instead, and then by the door.
 */
export function spawnX(seat, wall) {
  if (seat < 2) return 150 + seat * 100;
  const w = wallOf(wall);
  const ends = w.placed ? endSpots(w) : [];
  if (ends.length) return ends[(seat - 2) % ends.length];
  return Math.round(w.xs[Math.min(seat - 1, w.n - 1)] - w.slot / 2);
}

/** How far apart arrival spots at the ends of a placed wall are: more than a bump reaches (bump.js, BUMP_REACH), so nobody arrives within a kick of another. */
const END_SPACING = 150;

/**
 * The arrival spots of seats after the first two on a placed wall, a piece's width clear of the
 * end pools: across the room at the far end first, nearest the pools first (as the even wall
 * spreads them along), then by the door past the first two.
 */
function endSpots(w) {
  const far = [];
  for (let x = ROOM.maxX - 50; x >= w.xs[w.n - 1] + w.half + PIECE_WIDTH; x -= END_SPACING) far.unshift(x);
  const door = [];
  for (let x = 250 + END_SPACING; x <= w.xs[0] - w.half - PIECE_WIDTH; x += END_SPACING) door.push(x);
  return [...far, ...door];
}

/**
 * Where a piece is at `now`, from the last thing known about it: it was at `x` at time `t`,
 * walking in direction `d` (-1, 0 or 1). It stops at the walls.
 */
export function posAt(piece, now) {
  if (!piece.d) return piece.x;
  return clampX(piece.x + (piece.d * WALK_SPEED * Math.max(0, now - piece.t)) / 1000);
}

/** How high a piece is, `ms` after it jumped. */
export function jumpHeight(ms) {
  if (!(ms > 0) || ms >= JUMP_MS) return 0;
  const u = ms / JUMP_MS;
  return 4 * JUMP_HEIGHT * u * (1 - u);
}
