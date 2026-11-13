// The lobby room as numbers: where things are and how a piece moves. Plain logic with no clock
// of its own, shared by the room (lobby/server) and the page (lobby/public), so both always
// agree on where a piece is and which light it stands in.
//
// The room is a side view, 1920 units wide. A piece only has an x: it walks left and right
// along the floor. Jumping is for show and changes nothing the room decides.

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

/** A bump reaches this far in front of a piece, and pushes whoever it finds this far. It is weak on purpose. */
export const BUMP_REACH = 120;
export const BUMP_PUSH = 90;
export const BUMP_COOLDOWN_MS = 900;

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

/** Which light an x stands in: the box's index, or -1 for the dark. */
export function lightAt(x, n) {
  const half = lightHalf(n);
  for (let i = 0; i < n; i++) if (Math.abs(x - boxCentre(i, n)) <= half) return i;
  return -1;
}

/**
 * Where the room puts a seat's piece (on arriving, and after a game): always in the dark, and
 * apart from the others. The first two stand by the door; the rest stand in the dark gaps
 * between the pools of light further along the wall of `n` boxes.
 */
export function spawnX(seat, n) {
  if (seat < 2) return 150 + seat * 100;
  const slot = (ROOM.boxesRight - ROOM.boxesLeft) / n;
  return Math.round(ROOM.boxesLeft + slot * Math.min(seat - 1, n - 1));
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

/**
 * Who a bump lands on: the nearest other piece within reach in front of the bumper (a piece
 * standing right on top of it counts too). `others` is [{seat, x}]. Returns a seat or -1.
 */
export function bumpTarget(x, face, others) {
  let best = -1;
  let bestGap = Infinity;
  for (const other of others) {
    const ahead = (other.x - x) * (face || 1);
    if (ahead < -20 || ahead > BUMP_REACH) continue;
    if (Math.abs(ahead) < bestGap) {
      bestGap = Math.abs(ahead);
      best = other.seat;
    }
  }
  return best;
}
