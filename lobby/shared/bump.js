// The bump: its rules, its timings and its states, as plain numbers. Nothing here draws.
//
// A bump is one message to the room. The room judges it at once (who, if anyone, is hit and
// where they land) and tells everybody; nothing is timed on the room's side but three numbers
// kept with a piece: when it may bump again, until when it is knocked down, and until when it
// cannot be knocked again. So a bump costs one event and no wake-up.
//
// Every page then plays the same short story from the moment it hears of it:
//
//   the bumper   winding (picked up by its head, base swung back) -> striking (the base kicks
//                forward and up) -> recovering (follows through, is set back down)
//   the victim   standing -> hit (kicked low, both hold still) -> flying (thrown back feet first, tipping
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
 * not teetering on the edge of a light either. `lit` lists the lights that are on, by their
 * place on the wall (null: all of them); a light that is off is just more dark. Returns
 * [[from, to]], left to right.
 */
export function landingGround(n, lit = null) {
  const half = lightHalf(n);
  // Between two lights there may be less dark than twice the margin: then it is the middle of it.
  const gap = n > 1 ? boxCentre(1, n) - boxCentre(0, n) - 2 * half : Infinity;
  const margin = Math.min(KNOCK_CLEAR, gap / 2);
  const on = lit ? new Set(lit) : null;
  const ground = [];
  let from = ROOM.minX;
  for (let i = 0; i < n; i++) {
    if (on && !on.has(i)) continue;
    const centre = boxCentre(i, n);
    ground.push([from, centre - half - margin]);
    from = centre + half + margin;
  }
  ground.push([from, ROOM.maxX]);
  // A stretch that is a single spot (the middle of a narrow gap) may come out a hair inside out.
  return ground.filter(([a, b]) => b >= a - 0.001).map(([a, b]) => [Math.min(a, b), b]);
}

/**
 * Where a piece knocked from `x` in direction `dir` (-1 or 1) lands, in a room of `n` boxes
 * of which the `lit` ones are on (null: all of them).
 * It is thrown about KNOCK_DISTANCE and always comes down in the dark: the nearest spot to
 * that distance which is clear of every pool of light and at least KNOCK_MIN away. So a knock
 * always puts a piece out of the light it stood in and never into another one. It stops at the
 * walls: a piece with its back to one is knocked against it.
 */
export function knockLanding(x, dir, n, lit = null) {
  const side = dir < 0 ? -1 : 1;
  const aim = clampX(x + side * KNOCK_DISTANCE);
  let best = null;
  for (const least of [KNOCK_MIN, 0]) {
    for (const [a, b] of landingGround(n, lit)) {
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
//
// The bump is a kick. The bumper is picked up by its head, as if a hand had pinched the top:
// the head is the pivot, and the base swings back behind it like a leg drawn back, then whips
// forward and up into the other piece low down. Whoever is hit has its base swept out from
// under it and goes up and back feet first.

const REST = { dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1 };
const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;
const blend = (a, b, u) => ({ dx: mix(a.dx, b.dx, u), lift: mix(a.lift, b.lift, u), tilt: mix(a.tilt, b.tilt, u), sx: mix(a.sx, b.sx, u), sy: mix(a.sy, b.sy, u) });

/** How high a piece's head is above its foot: what the bumper swings from, like a pendulum held at the top. */
export const PIECE_HEAD = 113;
/** How high on the knocked piece the kick lands: its belly, well below its middle. */
export const KICK_HEIGHT = 40;

/** The share of the recovery spent following through, and the share at its end spent being set down. */
const FOLLOW = 0.26;
const SETTLE = 0.24;

/**
 * How the bumper holds itself `ms` after its bump, facing `dir`:
 * {state, dx, lift, tilt, pivot, sx, sy}.
 * dx: its head, sideways from where it stands (it barely moves). lift: off the floor.
 * tilt: degrees, clockwise, about a point `pivot` above its foot: its head, so a tilt swings
 * the base (clockwise swings it to the left). sx, sy: stretch, about its foot.
 */
export function attackPose(ms, dir = 1, landed = false) {
  const state = attackState(ms, landed);
  const side = dir < 0 ? -1 : 1;
  const down = { dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1 };
  // Picked up, with the base drawn back behind the head.
  const back = { dx: -8 * side, lift: 36, tilt: 40 * side, sx: 0.97, sy: 1.05 };
  // The base has whipped forward and up into the other piece's belly; the head has hardly moved.
  const contact = { dx: 12 * side, lift: 12, tilt: -46 * side, sx: 0.97, sy: 1.07 };
  // The follow-through: the base carries on up past where the other piece was.
  const through = { dx: 18 * side, lift: 28, tilt: -62 * side, sx: 0.98, sy: 1.04 };
  // Hanging upright just off the floor, about to be set down.
  const held = { dx: 0, lift: 7, tilt: 0, sx: 1, sy: 1 };
  if (state === "winding") {
    const u = ms / WINDUP_MS;
    // The hand lifts first; the base swings back a moment behind it.
    const pose = blend(down, back, smooth(u));
    return { state, pivot: PIECE_HEAD, ...pose, lift: back.lift * (1 - (1 - u) * (1 - u)) };
  }
  if (state === "striking") {
    // The kick itself, gathering speed all the way, then (if it landed) held for the pause.
    const u = Math.min(1, (ms - WINDUP_MS) / STRIKE_MS);
    return { state, pivot: PIECE_HEAD, ...blend(back, contact, u * u) };
  }
  if (state === "recovering") {
    const u = (ms - IMPACT_MS - (landed ? HIT_PAUSE_MS : 0)) / RECOVER_MS;
    if (u < FOLLOW) {
      const v = u / FOLLOW;
      return { state, pivot: PIECE_HEAD, ...blend(contact, through, 1 - (1 - v) * (1 - v)) };
    }
    if (u < 1 - SETTLE) return { state, pivot: PIECE_HEAD, ...blend(through, held, smooth((u - FOLLOW) / (1 - SETTLE - FOLLOW))) };
    // Set back down, with a small settle as the base takes the weight.
    const v = (u - (1 - SETTLE)) / SETTLE;
    const give = Math.sin(v * Math.PI) * 0.07;
    return { state, pivot: PIECE_HEAD, dx: 0, lift: held.lift * (1 - smooth(Math.min(1, v * 2))), tilt: 0, sx: 1 + give * 0.7, sy: 1 - give };
  }
  return { state, pivot: 0, ...REST };
}

/**
 * How a knocked piece holds itself `ms` after the bump that sent it from `from` to `to`:
 * {state, x, lift, tilt, sx, sy}. x: where it is along the floor. lift: off the floor (below
 * zero as it lies down, since it turns about its middle). tilt: degrees, clockwise, about
 * PIECE_PIVOT above its foot. sx, sy: stretch.
 *
 * It is kicked low, so its base goes first: it tips with its feet leading the way it is
 * thrown and its head trailing, and comes down on its back with its feet pointing away from
 * whoever kicked it.
 */
export function knockPose(ms, from, to, safeFor = IMMUNE_MS) {
  const state = knockState(ms, safeFor);
  const side = to < from ? -1 : 1;
  // Lying down, a piece rests on its side: its middle is nearer the floor than when it stands.
  const lying = { lift: -36, tilt: -90 * side };
  // The moment after the blow: the base is already going, the head has not caught up.
  const swept = { x: from + 6 * side, lift: 8, tilt: -18 * side, sx: 0.84, sy: 1.14 };
  if (state === "standing") return { state, x: from, ...REST };
  if (state === "hit") {
    const u = (ms - IMPACT_MS) / HIT_PAUSE_MS;
    return { state, x: mix(from, swept.x, u), lift: swept.lift * u, tilt: swept.tilt * u, sx: mix(1, swept.sx, u), sy: mix(1, swept.sy, u) };
  }
  if (state === "flying") {
    const u = (ms - IMPACT_MS - HIT_PAUSE_MS) / FLIGHT_MS;
    const out = 1 - (1 - u) * (1 - u);
    return { state, x: mix(swept.x, to, out), lift: swept.lift * (1 - u) + 4 * 64 * u * (1 - u) + lying.lift * u * u, tilt: mix(swept.tilt, lying.tilt, smooth(u)), sx: mix(swept.sx, 1, u), sy: mix(swept.sy, 1, u) };
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

/**
 * Where the blow lands, for the burst: low on the knocked piece, on the side the kick came
 * from. `from` and `to` are where the piece stood and where it lands.
 */
export function impactPoint(from, to) {
  const side = to < from ? -1 : 1;
  return { x: from - side * 24, y: ROOM.floorY - KICK_HEIGHT };
}
