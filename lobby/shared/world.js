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
 * Whether a box on the wall has a pool of light at all: only a game that can be played does. A
 * game that is coming soon keeps its poster and has no light, no pool and no vote; a poster that
 * is not a game (vote.js, posterBox) has none either.
 */
export const hasPool = (box) => !!box && !box.soon && !box.poster;

/** Which boxes of a wall have a pool: from the boxes themselves, or (a number of boxes) all of them. */
export const litOf = (boxes) => (Array.isArray(boxes) ? boxes.map(hasPool) : Array.from({ length: boxes }, () => true));

/** The least dark between two neighbouring pools of a wall (Infinity with fewer than two). */
function leastGap(pools) {
  let gap = Infinity;
  for (let k = 1; k < pools.length; k++) gap = Math.min(gap, pools[k].x - pools[k].half - (pools[k - 1].x + pools[k - 1].half));
  return gap;
}

/**
 * A wall: where its `n` boxes hang (`xs`, the middle of each, world units), how far apart they are
 * at the least (`slot`), how wide a box is (`box`), and its pools of light on the floor (`pools`:
 * {i, x, half}, one under each box that can be played, left to right). `half` is the widest pool's
 * half width, `gap` the least dark between two pools, and `spill` how far the drawn light spills
 * past a pool's counted edge. Most rooms space their boxes evenly between ROOM.boxesLeft and
 * ROOM.boxesRight (evenWall); a room whose picture has the boxes somewhere else says where
 * (shared/rooms.js, wallFor: a placed wall), and every rule and every drawing of that room reads
 * its wall, so a piece in a pool votes for the box over it in every look.
 * @param {number} n  how many boxes
 * @param {boolean[] | null} [lit]  which boxes have a pool (hasPool); null: all of them
 */
export function evenWall(n, lit = null) {
  const xs = Array.from({ length: n }, (_, i) => boxCentre(i, n));
  const half = lightHalf(n);
  const pools = xs.map((x, i) => ({ i, x, half })).filter((p) => !lit || lit[p.i]);
  const slot = (ROOM.boxesRight - ROOM.boxesLeft) / n;
  // The dark between two lights as it always was on an even wall, whichever are lit (bump.js keeps clear of them by it).
  return { n, xs, slot, box: boxWidth(n), half, gap: n > 1 ? slot - 2 * half : Infinity, pools, spill: EVEN_SPILL, placed: false };
}

/**
 * A wall whose boxes hang at `xs` (world units, left to right): its boxes as wide as their spacing
 * allows, and a pool under each box that can be played (`lit`), each as wide as its own
 * neighbours allow: the even wall's rule (at most 118, and 0.4 of the way to a neighbouring pool)
 * and never so wide that the dark between it and a neighbour is narrower than a piece
 * (PIECE_WIDTH), the two sharing that stretch evenly. A pool may reach under a coming-soon
 * poster's frame, never under another pool's. Its light does not spill (NO_SPILL), and pieces
 * arrive in the wide dark at either end of it, never in a gap (spawnX).
 */
export function placedWall(xs, lit = null) {
  const slot = Math.min(...xs.slice(1).map((x, i) => x - xs[i]), ROOM.boxesRight - ROOM.boxesLeft);
  const at = xs.map((_, i) => i).filter((i) => !lit || lit[i]);
  const widest = (i) => Math.min(118, ...at.filter((j) => j !== i).map((j) => Math.abs(xs[j] - xs[i])).map((d) => Math.min(d * 0.4, (d - PIECE_WIDTH) / 2)));
  const pools = at.map((i) => ({ i, x: xs[i], half: widest(i) }));
  return { n: xs.length, xs: [...xs], slot, box: slot - 36, half: Math.max(0, ...pools.map((p) => p.half)), gap: leastGap(pools), pools, spill: NO_SPILL, placed: true };
}

/** The pool under box `i` of a wall ({i, x, half}), or null when that box has no light. */
export const poolOf = (wall, i) => wallOf(wall).pools.find((p) => p.i === i) ?? null;

/**
 * How far from a pool's middle each look draws its light, in world units, on a wall (or an even
 * wall of that many boxes): `pool` the lit floor and its ring, `cone` the foot of the cone or beam
 * from the lamp, `lit` how far a piece is warmed by it, over its last `fade` units. For box `i`'s
 * pool (the widest pool's when no box is named). Every look draws from these (scene.js,
 * look3d/room3d.js, look3d/rendered), so on a placed wall each ends at the counted edge (lightAt).
 */
export function drawnLight(wall, i = null) {
  const w = wallOf(wall);
  const spill = w.spill ?? EVEN_SPILL;
  const half = i === null ? w.half : (poolOf(w, i)?.half ?? 0);
  return { pool: half + spill.pool, cone: half + spill.cone, lit: half + spill.lit, fade: spill.lit };
}

/** How warm box `i`'s lamp makes a piece `d` units from the middle of its pool, 0 to 1 (drawnLight): full inside the pool, fading out over `fade` past it, and none past that. A box with no pool warms nobody. */
export function warmthAt(d, wall, i = null) {
  if (i !== null && !poolOf(wall, i)) return 0;
  const light = drawnLight(wall, i);
  if (d > light.lit) return 0;
  return light.fade > 0 ? Math.min(1, (light.lit - d) / light.fade) : 1;
}

/** Whether two walls have their boxes and pools in the same places (a piece in the light of one is in the same light of the other). */
export const sameWall = (a, b) =>
  a.n === b.n && a.xs.every((x, i) => x === b.xs[i]) && a.pools.length === b.pools.length && a.pools.every((p, k) => p.i === b.pools[k].i && p.x === b.pools[k].x && p.half === b.pools[k].half);

/** The places along the floor where the light changes, left to right: the walls, and the two edges of each of these pools. */
const edgesOf = (pools) => [ROOM.minX, ...pools.flatMap((p) => [p.x - p.half, p.x + p.half]), ROOM.maxX];

/**
 * Where a piece standing at `x` on wall `from` stands on wall `to`: when the party moves to a room
 * that hangs the same boxes elsewhere, and when a room saved on an older wall wakes on today's.
 * The floor is stretched piece by piece between the walls and the edges of the pools both walls
 * have (by box), so a piece in pool i is in pool i (as far into it), and one in a stretch of dark
 * is in that same stretch. A pool only `from` has is dark on `to`; a pool only `to` has was dark
 * on `from`, so a piece the stretch would put in it is set down just outside it instead. Nobody's
 * vote changes either way.
 */
export function acrossWalls(x, from, to) {
  const both = new Set(from.pools.filter((p) => to.pools.some((q) => q.i === p.i)).map((p) => p.i));
  const a = edgesOf(from.pools.filter((p) => both.has(p.i)));
  const b = edgesOf(to.pools.filter((p) => both.has(p.i)));
  let y = x;
  for (let k = 1; k < a.length; k++) {
    if (x > a[k] && k < a.length - 1) continue;
    const span = a[k] - a[k - 1];
    const u = span > 0 ? Math.min(1, Math.max(0, (x - a[k - 1]) / span)) : 0;
    y = clampX(b[k - 1] + u * (b[k] - b[k - 1]));
    break;
  }
  // Was it in the dark, by `from`? Then it stays in the dark: out of a pool only `to` has, by the nearer edge.
  if (lightAt(x, from) === -1 || !both.has(lightAt(x, from))) {
    for (const p of to.pools) {
      if (both.has(p.i) || Math.abs(y - p.x) > p.half) continue;
      const left = p.x - p.half - 1;
      const right = p.x + p.half + 1;
      y = y - left < right - y && left >= ROOM.minX ? left : right <= ROOM.maxX ? right : left;
    }
  }
  return y;
}

/** A wall from either a wall or a number of boxes (an even wall, every box lit). */
export const wallOf = (wall) => (typeof wall === "number" ? evenWall(wall) : wall);

/** Which light an x stands in on a wall (or an even wall of that many boxes): the box's index, or -1 for the dark (a box with no pool is dark). */
export function lightAt(x, wall) {
  const w = wallOf(wall);
  for (const p of w.pools) if (Math.abs(x - p.x) <= p.half) return p.i;
  return -1;
}

/**
 * Where the room puts a seat's piece (on arriving, and after a game): always in the dark, and
 * apart from the others. The first two stand by the door. On an even wall the rest stand in the
 * dark gaps between the pools further along; on a placed wall, whose gaps are only about a piece
 * wide, they stand in the wide dark at either end of the wall instead: by the door while there
 * is room there, then at the far end.
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
 * end pools: by the door past the first two, then across the room at the far end, nearest the
 * pools first.
 */
function endSpots(w) {
  const first = w.pools[0];
  const last = w.pools[w.pools.length - 1];
  const left = first ? first.x - first.half : w.xs[0];
  const right = last ? last.x + last.half : w.xs[w.n - 1];
  const door = [];
  for (let x = 250 + END_SPACING; x <= left - PIECE_WIDTH; x += END_SPACING) door.push(x);
  const far = [];
  for (let x = ROOM.maxX - 50; x >= right + PIECE_WIDTH; x -= END_SPACING) far.unshift(x);
  return [...door, ...far];
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
