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

/**
 * Walking speed in units per second: the measure each character's own speed is a share of
 * (SPEED_SHARE). A piece walks at its speed or stands; only the ghost eases between the two
 * (FLOAT_MS), by a rule everyone works out the same way, so anyone can work out where a piece is.
 */
export const WALK_SPEED = 430;
/**
 * Each character's walking speed as a share of WALK_SPEED (the owner's round three, "Speeds"): the
 * pawn fastest, the robot as before, the ghost a little slower and floaty, the slime slowest. A
 * piece of a character this file does not know walks at WALK_SPEED.
 */
export const SPEED_SHARE = Object.freeze({ pawn: 1.1, robot: 1, ghost: 0.95, slime: 0.8 });
/** How fast a character walks, in units per second. */
export const walkSpeed = (character) => WALK_SPEED * (SPEED_SHARE[character] ?? 1);
/**
 * The floaty ghost: slow to stop and to turn. Its speed changes evenly, taking FLOAT_MS to go from
 * walking to standing (or from standing to walking), twice that to turn round. Every other
 * character starts, stops and turns at once.
 */
export const FLOAT_MS = 260;
export const floats = (character) => character === "ghost";
export const JUMP_MS = 520;
/** How high a jump goes: every character's but the pawn's, which jumps highest (round three, "Speeds"). */
export const JUMP_HEIGHT = 110;
export const PAWN_JUMP_HEIGHT = 136;
/** The highest any piece jumps (what a name tag must clear: card-clear.js). */
export const JUMP_TOP = Math.max(JUMP_HEIGHT, PAWN_JUMP_HEIGHT);
/** How high a character jumps. */
export const jumpTopOf = (character) => (character === "pawn" ? PAWN_JUMP_HEIGHT : JUMP_HEIGHT);

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
    // (An end of a stretch is that end exactly, so a piece on a pool's edge stays on its edge.)
    y = clampX(u === 1 ? b[k] : u === 0 ? b[k - 1] : b[k - 1] + u * (b[k] - b[k - 1]));
    break;
  }
  // Nobody's vote changes: a piece in a pool both walls have stays in it, and any other piece stays
  // in the dark. Where the stretch (or a rounding at an edge) says otherwise, it is set down just
  // inside that pool, or just outside the pool it landed in, by the nearer edge.
  const was = lightAt(x, from);
  const want = both.has(was) ? was : -1;
  if (lightAt(y, to) !== want) {
    if (want >= 0) {
      const p = to.pools.find((q) => q.i === want);
      y = Math.min(p.x + p.half, Math.max(p.x - p.half, y));
    } else {
      for (const p of to.pools) {
        if (y < p.x - p.half || y > p.x + p.half) continue;
        const left = p.x - p.half - EDGE_STEP;
        const right = p.x + p.half + EDGE_STEP;
        y = y - left < right - y && left >= ROOM.minX ? left : right <= ROOM.maxX ? right : left;
      }
    }
  }
  return y;
}

/** How far outside a pool's edge a carried piece is set down, so it is in the dark and not on the edge (which is lit). */
const EDGE_STEP = 0.01;

/** A wall from either a wall or a number of boxes (an even wall, every box lit). */
export const wallOf = (wall) => (typeof wall === "number" ? evenWall(wall) : wall);

/** Which light an x stands in on a wall (or an even wall of that many boxes): the box's index, or -1 for the dark (a box with no pool is dark). */
export function lightAt(x, wall) {
  const w = wallOf(wall);
  // Its two edges as every rule works them out (edgesOf, acrossWalls), so a piece on an edge is lit by all of them alike.
  for (const p of w.pools) if (x >= p.x - p.half && x <= p.x + p.half) return p.i;
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
 * A floaty piece's change of speed under way at its last known moment, or null: it was at `x` at
 * `t` going at `v` (a share of its speed, -1 to 1) and is easing to `d`. `vt` says when `v` was
 * true: a `v` from any other moment than `t` (the room or a page moved the piece since, and wrote
 * only x, d and t) is not a change under way. {v0, ms (how long it takes), s (+1 or -1)}.
 */
function rampOf(piece, character) {
  if (!floats(character) || piece.vt !== piece.t || !Number.isFinite(piece.v)) return null;
  const v0 = Math.max(-1, Math.min(1, piece.v));
  if (v0 === piece.d) return null;
  return { v0, ms: Math.abs(piece.d - v0) * FLOAT_MS, s: Math.sign(piece.d - v0) };
}

/**
 * Where a piece is at `now`, from the last thing known about it: it was at `x` at time `t`,
 * walking in direction `d` (-1, 0 or 1) at its character's speed (`character`, the piece's own by
 * default: walkSpeed), and for a floaty one easing from `v` to `d` (rampOf). It stops at the walls.
 */
export function posAt(piece, now, character = piece.character) {
  const ramp = rampOf(piece, character);
  if (!piece.d && !ramp) return piece.x;
  const ms = Math.max(0, now - piece.t);
  const speed = walkSpeed(character);
  if (!ramp) return clampX(piece.x + (piece.d * speed * ms) / 1000);
  const easing = Math.min(ms, ramp.ms);
  const went = ramp.v0 * easing + (ramp.s * easing * easing) / (2 * FLOAT_MS) + piece.d * Math.max(0, ms - ramp.ms);
  return clampX(piece.x + (went * speed) / 1000);
}

/** How fast a piece goes at `now`, as a share of its speed (-1 to 1): `d`, or for a floaty piece still easing, on the way to it (walls aside). */
export function velAt(piece, now, character = piece.character) {
  const ramp = rampOf(piece, character);
  const ms = Math.max(0, now - piece.t);
  if (!ramp || ms >= ramp.ms) return piece.d || 0;
  return ramp.v0 + (ramp.s * ms) / FLOAT_MS;
}

/**
 * The moments after `t` at which a piece's walk, as last known, changes its speed: the end of a
 * floaty piece's easing (and `steps` even moments inside it, where its speed changes all the
 * time), and the moment it reaches a wall. Between two of them it walks evenly.
 */
export function walkChanges(piece, steps = 8, character = piece.character) {
  const out = [];
  const ramp = rampOf(piece, character);
  let settled = piece.t;
  if (ramp) {
    for (let k = 1; k <= steps; k++) out.push(piece.t + (ramp.ms * k) / steps);
    settled = piece.t + ramp.ms;
  }
  if (piece.d) {
    const x = posAt(piece, settled, character);
    const wall = piece.d > 0 ? ROOM.maxX : ROOM.minX;
    if (x !== wall) out.push(settled + ((wall - x) / (piece.d * walkSpeed(character))) * 1000);
  }
  return out;
}

/** How high a piece is, `ms` after it jumped: `top` at the top (a pawn's PAWN_JUMP_HEIGHT; jumpTopOf). */
export function jumpHeight(ms, top = JUMP_HEIGHT) {
  if (!(ms > 0) || ms >= JUMP_MS) return 0;
  const u = ms / JUMP_MS;
  return 4 * top * u * (1 - u);
}
