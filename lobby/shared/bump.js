// The bump: its rules, its timings and its states, as plain numbers. Nothing here draws.
//
// A bump is one message to the room. The room judges it at once (who, if anyone, is hit and
// where they land) and tells everybody; nothing is timed on the room's side but three numbers
// kept with a piece: when it may bump again, until when it is knocked down, and until when it
// cannot be knocked again. So a bump costs one event and no wake-up.
//
// Every page then plays the same short story from the moment it hears of it:
//
//   the bumper   winding (lifts and leans back) -> striking (slams forward) -> recovering
//   the victim   standing -> hit (squashed, both hold still) -> flying (thrown back, tipping
//                over) -> down (lying on the floor) -> rising -> up, and safe for a while
//
// The poses are offsets and angles in world units and degrees, so any drawing (the SVG room of
// today, a 3D room later) can show them: lobby/public/bump-draw.js is the thin part that does.
import { ROOM, boxCentre, clampX, lightHalf } from "./world.js";

/** How far in front of a piece a bump reaches (a piece just behind its back counts too). */
export const BUMP_REACH = 130;
export const BUMP_BEHIND = 20;
/** About how far a knocked piece is thrown. Where exactly it lands depends on the lights: see knockLanding. */
export const KNOCK_DISTANCE = 210;
/** It is never thrown less than this, unless a wall is in the way. */
export const KNOCK_MIN = 90;
/** A knocked piece lands at least this far from the edge of any light, where there is that much dark. */
export const KNOCK_CLEAR = 34;

/** The bumper lifts and leans back for this long, then slams forward for STRIKE_MS. */
export const WINDUP_MS = 110;
export const STRIKE_MS = 60;
/** When the blow lands, counted from the bump. */
export const IMPACT_MS = WINDUP_MS + STRIKE_MS;
/** Both pieces hold still for a moment when it lands: the hit is felt. */
export const HIT_PAUSE_MS = 50;
export const RECOVER_MS = 220;
/** The victim is in the air this long, lies on the floor this long, and takes this long to get up. */
export const FLIGHT_MS = 260;
export const DOWN_MS = 110;
export const GETUP_MS = 150;
/** From the bump until the victim has its piece back: 740 ms, of which 570 after the blow lands. */
export const STUN_MS = IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS + DOWN_MS + GETUP_MS;
/** After getting up a piece cannot be knocked again for this long, so nobody is kept on the floor. */
export const IMMUNE_MS = 1500;
/** A piece may bump again this long after its last bump, hit or miss. */
export const BUMP_COOLDOWN_MS = 2500;
/** The room allows a bump this much early: two messages are never exactly as far apart as they were sent. */
export const COOLDOWN_SLACK_MS = 150;

/** How high the middle of a piece is: what it turns around when it tips over. */
export const PIECE_PIVOT = 70;

// ---------------------------------------------------------------- the rules

/** Milliseconds until a piece that last bumped at `bumpAt` may bump again (0: ready). */
export function cooldownLeft(bumpAt, now) {
  return Math.max(0, bumpAt + BUMP_COOLDOWN_MS - now);
}

/** How full the cooldown is, 0 (just bumped) to 1 (ready), for whatever shows it. */
export function cooldownFraction(left) {
  return 1 - Math.min(1, Math.max(0, left / BUMP_COOLDOWN_MS));
}

/** A piece is knocked down (no walking, jumping or bumping) until `stunUntil`. */
export function isDown(piece, now) {
  return now < (piece.stunUntil ?? 0);
}

/** A piece that is down, or has just got up, cannot be knocked. */
export function isSafe(piece, now) {
  return now < (piece.immuneUntil ?? 0);
}

/**
 * Whether the room lets a piece bump now: {ok} or {ok: false, wait} with the milliseconds
 * until it may. A piece on the floor cannot bump, and the cooldown runs hit or miss.
 */
export function mayBump(piece, now) {
  const down = Math.max(0, (piece.stunUntil ?? 0) - now);
  const cooling = cooldownLeft(piece.bumpAt ?? -Infinity, now);
  if (down > 0 || cooling > COOLDOWN_SLACK_MS) return { ok: false, wait: Math.max(down, cooling) };
  return { ok: true, wait: 0 };
}

/**
 * Who a bump lands on: the nearest other piece within reach in front of the bumper (a piece
 * standing right on top of it counts too). `others` is [{seat, x}], already without the pieces
 * that cannot be knocked. Returns a seat or -1.
 */
export function bumpTarget(x, face, others) {
  let best = -1;
  let bestGap = Infinity;
  for (const other of others) {
    const ahead = (other.x - x) * (face || 1);
    if (ahead < -BUMP_BEHIND || ahead > BUMP_REACH) continue;
    if (Math.abs(ahead) < bestGap) {
      bestGap = Math.abs(ahead);
      best = other.seat;
    }
  }
  return best;
}

/**
 * The stretches of floor a knocked piece may land on, in a room of `n` boxes: the dark, and
 * not teetering on the edge of a light either. Returns [[from, to]], left to right.
 */
export function landingGround(n) {
  const half = lightHalf(n);
  // Between two lights there may be less dark than twice the margin: then it is the middle of it.
  const gap = n > 1 ? boxCentre(1, n) - boxCentre(0, n) - 2 * half : Infinity;
  const margin = Math.min(KNOCK_CLEAR, gap / 2);
  const ground = [];
  let from = ROOM.minX;
  for (let i = 0; i < n; i++) {
    const centre = boxCentre(i, n);
    ground.push([from, centre - half - margin]);
    from = centre + half + margin;
  }
  ground.push([from, ROOM.maxX]);
  // A stretch that is a single spot (the middle of a narrow gap) may come out a hair inside out.
  return ground.filter(([a, b]) => b >= a - 0.001).map(([a, b]) => [Math.min(a, b), b]);
}

/**
 * Where a piece knocked from `x` in direction `dir` (-1 or 1) lands, in a room of `n` boxes.
 * It is thrown about KNOCK_DISTANCE and always comes down in the dark: the nearest spot to
 * that distance which is clear of every pool of light and at least KNOCK_MIN away. So a knock
 * always puts a piece out of the light it stood in and never into another one. It stops at the
 * walls: a piece with its back to one is knocked against it.
 */
export function knockLanding(x, dir, n) {
  const side = dir < 0 ? -1 : 1;
  const aim = clampX(x + side * KNOCK_DISTANCE);
  let best = null;
  for (const least of [KNOCK_MIN, 0]) {
    for (const [a, b] of landingGround(n)) {
      // The part of this stretch that is far enough along in the direction of the blow.
      const lo = side > 0 ? Math.max(a, x + least) : a;
      const hi = side > 0 ? b : Math.min(b, x - least);
      if (lo > hi) continue;
      const spot = Math.min(hi, Math.max(lo, aim));
      if (best === null || Math.abs(spot - aim) < Math.abs(best - aim)) best = spot;
    }
    if (best !== null) break;
  }
  return Math.round(best ?? aim);
}

/** What the room writes on a piece that was just knocked at `now`. */
export function knocked(now) {
  return { stunUntil: now + STUN_MS, immuneUntil: now + STUN_MS + IMMUNE_MS };
}

// ---------------------------------------------------------------- the states

/** The bumper's state `ms` after its bump. `landed`: it hit somebody, so both hold still for a moment. */
export function attackState(ms, landed = false) {
  const pause = landed ? HIT_PAUSE_MS : 0;
  if (!(ms >= 0) || ms >= IMPACT_MS + pause + RECOVER_MS) return "idle";
  if (ms < WINDUP_MS) return "winding";
  if (ms < IMPACT_MS + pause) return "striking";
  return "recovering";
}

/** The victim's state `ms` after the bump that hit it. `safeFor` is how long it stays safe after getting up. */
export function knockState(ms, safeFor = IMMUNE_MS) {
  if (!(ms >= 0) || ms >= STUN_MS + safeFor) return "up";
  if (ms < IMPACT_MS) return "standing";
  if (ms < IMPACT_MS + HIT_PAUSE_MS) return "hit";
  if (ms < IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS) return "flying";
  if (ms < STUN_MS - GETUP_MS) return "down";
  if (ms < STUN_MS) return "rising";
  return "safe";
}

// ---------------------------------------------------------------- the poses

const REST = { dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1 };
const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;

/**
 * How the bumper holds itself `ms` after its bump, facing `dir`: {state, dx, lift, tilt, sx, sy}.
 * dx: sideways from where it stands. lift: off the floor. tilt: degrees, clockwise, about its
 * foot. sx, sy: stretch, about its foot.
 */
export function attackPose(ms, dir = 1, landed = false) {
  const state = attackState(ms, landed);
  const side = dir < 0 ? -1 : 1;
  const back = { dx: -26 * side, lift: 38, tilt: -20 * side, sx: 0.94, sy: 1.08 };
  const through = { dx: 62 * side, lift: 4, tilt: 28 * side, sx: 1.1, sy: 0.92 };
  if (state === "winding") {
    const u = smooth(ms / WINDUP_MS);
    return { state, dx: back.dx * u, lift: back.lift * u, tilt: back.tilt * u, sx: mix(1, back.sx, u), sy: mix(1, back.sy, u) };
  }
  if (state === "striking") {
    // The slam itself, then (if it landed) held for the pause.
    const u = Math.min(1, (ms - WINDUP_MS) / STRIKE_MS);
    const v = u * u;
    return { state, dx: mix(back.dx, through.dx, v), lift: mix(back.lift, through.lift, v), tilt: mix(back.tilt, through.tilt, v), sx: mix(back.sx, through.sx, v), sy: mix(back.sy, through.sy, v) };
  }
  if (state === "recovering") {
    const u = smooth((ms - IMPACT_MS - (landed ? HIT_PAUSE_MS : 0)) / RECOVER_MS);
    return { state, dx: through.dx * (1 - u), lift: through.lift * (1 - u), tilt: through.tilt * (1 - u), sx: mix(through.sx, 1, u), sy: mix(through.sy, 1, u) };
  }
  return { state, ...REST };
}

/**
 * How a knocked piece holds itself `ms` after the bump that sent it from `from` to `to`:
 * {state, x, lift, tilt, sx, sy}. x: where it is along the floor. lift: off the floor (below
 * zero as it lies down, since it turns about its middle). tilt: degrees, clockwise, about
 * PIECE_PIVOT above its foot. sx, sy: stretch.
 */
export function knockPose(ms, from, to, safeFor = IMMUNE_MS) {
  const state = knockState(ms, safeFor);
  const side = to < from ? -1 : 1;
  // Lying down, a piece rests on its side: its middle is nearer the floor than when it stands.
  const lying = { lift: -36, tilt: 90 * side };
  if (state === "standing") return { state, x: from, ...REST };
  if (state === "hit") {
    const u = (ms - IMPACT_MS) / HIT_PAUSE_MS;
    return { state, x: from + 10 * side * u, lift: 0, tilt: 12 * side * u, sx: mix(1, 0.8, u), sy: mix(1, 1.16, u) };
  }
  if (state === "flying") {
    const u = (ms - IMPACT_MS - HIT_PAUSE_MS) / FLIGHT_MS;
    const out = 1 - (1 - u) * (1 - u);
    return { state, x: mix(from + 10 * side, to, out), lift: 4 * 64 * u * (1 - u) + lying.lift * u * u, tilt: mix(12 * side, lying.tilt, smooth(u)), sx: mix(0.8, 1, u), sy: mix(1.16, 1, u) };
  }
  if (state === "down") {
    // A small bounce as it comes to rest.
    const u = (ms - (STUN_MS - GETUP_MS - DOWN_MS)) / DOWN_MS;
    return { state, x: to, lift: lying.lift + Math.sin(Math.min(1, u * 1.6) * Math.PI) * 9, tilt: lying.tilt, sx: 1, sy: 1 };
  }
  if (state === "rising") {
    const u = smooth((ms - (STUN_MS - GETUP_MS)) / GETUP_MS);
    return { state, x: to, lift: lying.lift * (1 - u) + Math.sin(u * Math.PI) * 14, tilt: lying.tilt * (1 - u), sx: 1, sy: 1 };
  }
  return { state, x: to, ...REST };
}

/** Where the blow lands, for the burst: between the two pieces, at the height of a piece's middle. */
export function impactPoint(bumperX, victimX) {
  return { x: (bumperX + victimX) / 2, y: ROOM.floorY - PIECE_PIVOT };
}
