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
 * A wall: where its `n` boxes hang, which is also where their pools of light lie on the floor
 * (`xs`, the middle of each, world units), how far apart they are at the least (`slot`), how wide
 * a box is (`box`) and half the width of a pool (`half`). Most rooms space their boxes evenly
 * between ROOM.boxesLeft and ROOM.boxesRight (evenWall); a room whose picture has the boxes
 * somewhere else says where (shared/rooms.js, wallFor), and every rule and every drawing of that
 * room reads its wall, so a piece in a pool votes for the box over it in every look.
 */
export function evenWall(n) {
  return { n, xs: Array.from({ length: n }, (_, i) => boxCentre(i, n)), slot: (ROOM.boxesRight - ROOM.boxesLeft) / n, box: boxWidth(n), half: lightHalf(n) };
}

/** A wall whose boxes hang at `xs` (world units, left to right): its boxes and pools as wide as their spacing allows, by the even wall's rules. */
export function placedWall(xs) {
  const slot = Math.min(...xs.slice(1).map((x, i) => x - xs[i]), ROOM.boxesRight - ROOM.boxesLeft);
  return { n: xs.length, xs: [...xs], slot, box: slot - 36, half: Math.min(118, slot * 0.4) };
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
 * apart from the others. The first two stand by the door; the rest stand in the dark gaps
 * between the pools of light further along the wall (or an even wall of that many boxes).
 */
export function spawnX(seat, wall) {
  if (seat < 2) return 150 + seat * 100;
  const w = wallOf(wall);
  return Math.round(w.xs[Math.min(seat - 1, w.n - 1)] - w.slot / 2);
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
