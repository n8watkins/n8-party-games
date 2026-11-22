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
import { ROOM, clampX, wallOf } from "./world.js";

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

// ---------------------------------------------------------------- the charged kick
//
// The owner's round three ("Pawn charged kick"): hold to wind up for up to about a second, release
// for a short dash and a harder knock. A tap is the normal kick. Punished harder by a hardened
// slime or a faded ghost.
//
// The move button held past CHARGE_MIN_MS is a charge: the pawn's page tells the room (`kc`) and
// the pawn stands still, wound up, until it lets go. The release is the kick (`b` with `c`), and
// the room times the hold by its own clock, from the `kc` it heard: a page cannot make its kick
// harder than it held it. The room judges a charged kick at once, as any kick: the pawn dashes
// forward (CHARGE_DASH at full power, never into a light it does not stand in), and whoever it
// reaches from there is thrown further than a kick throws. A charge held CHARGE_HOLD_MS goes off
// by itself on the page; the room forgets one it hears no release for, with no wake-up of its own.

/** A press held this long is a charge; a shorter one is a tap: the normal kick, on the release. */
export const CHARGE_MIN_MS = 180;
/** From the press, a charge is at full power this long after it (about a second). */
export const CHARGE_FULL_MS = 1000;
/** The longest a page holds a charge before it goes off by itself; the room keeps one no longer than this and a little. */
export const CHARGE_HOLD_MS = 2500;
/** How far the pawn dashes on its release: CHARGE_DASH_MIN at the least charge, CHARGE_DASH at full. */
export const CHARGE_DASH_MIN = 40;
export const CHARGE_DASH = 150;
/** The dash stops this far short of the piece it reaches: the kick lands at the base. */
export const KICK_CONTACT = 56;
/** A full charge throws a piece this much further than a kick (a share of KNOCK_DISTANCE). */
export const CHARGE_THROW = 0.7;
/** A full charge that bounces off a hardened slime throws the pawn back twice as far, and keeps it down this much longer. */
export const CHARGE_BOUNCE = 1;
export const CHARGE_DOWN_MS = 500;

/** How strong a charge held `heldMs` from the press is, 0 (just past a tap) to 1 (full). */
export function chargePower(heldMs) {
  if (!(heldMs >= CHARGE_MIN_MS)) return 0;
  return Math.min(1, (heldMs - CHARGE_MIN_MS) / (CHARGE_FULL_MS - CHARGE_MIN_MS));
}

/** How far a charge of `power` dashes. */
export const chargeDash = (power) => CHARGE_DASH_MIN + (CHARGE_DASH - CHARGE_DASH_MIN) * power;

/** How far a charged kick of `power` throws what it hits (knockLanding's reach). */
export const chargeThrow = (power) => ({ distance: KNOCK_DISTANCE * (1 + CHARGE_THROW * power) });

/** How far, and how much longer down, a charged kick of `power` that bounced off a hardened slime sends the pawn. */
export const chargeBounce = (power) => ({ reach: { distance: KNOCK_DISTANCE * (1 + CHARGE_BOUNCE * power) }, down: Math.round(CHARGE_DOWN_MS * power) });

/**
 * Whether the room takes a pawn's charge now: {ok} or {ok: false, why, wait, cooling}, as mayBump
 * (a piece on the floor cannot, nor one whose kick is cooling), and not twice.
 */
export function mayCharge(piece, now) {
  if (piece.chargeAt !== undefined && piece.chargeAt !== null && now - piece.chargeAt < CHARGE_HOLD_MS + COOLDOWN_SLACK_MS) return { ok: false, why: "Already winding up." };
  const may = mayBump(piece, now);
  return may.ok ? { ok: true } : { ok: false, why: "Not ready yet.", wait: may.wait, cooling: true };
}

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
export function bumpTarget(x, face, others, reach = BUMP_REACH) {
  let best = -1;
  let bestGap = Infinity;
  for (const other of others) {
    const ahead = (other.x - x) * (face || 1);
    if (ahead < -BUMP_BEHIND || ahead > reach) continue;
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
export function landingGround(n, lit = null, clear = KNOCK_CLEAR) {
  // `n` is the wall (shared/world.js) or how many boxes hang evenly on it.
  const w = wallOf(n);
  // Between two lights there may be less dark than twice the margin: then it is the middle of it.
  const margin = Math.min(clear, w.gap / 2);
  const on = lit ? new Set(lit) : null;
  const ground = [];
  let from = ROOM.minX;
  // Only a box with a pool has a light at all (world.js, hasPool); of those, the ones that are on.
  for (const p of w.pools) {
    if (on && !on.has(p.i)) continue;
    ground.push([from, p.x - p.half - margin]);
    from = p.x + p.half + margin;
  }
  ground.push([from, ROOM.maxX]);
  // A stretch that is a single spot (the middle of a narrow gap) may come out a hair inside out.
  return ground.filter(([a, b]) => b >= a - 0.001).map(([a, b]) => [Math.min(a, b), b]);
}

/**
 * Where a piece knocked from `x` in direction `dir` (-1 or 1) lands, on wall `n` (shared/world.js:
 * a wall, or how many boxes hang evenly on it) of whose lights the `lit` ones are on (null: all of them).
 * It is thrown about KNOCK_DISTANCE and always comes down in the dark: the nearest spot to
 * that distance which is clear of every pool of light and at least KNOCK_MIN away. So a knock
 * always puts a piece out of the light it stood in and never into another one. It stops at the
 * walls: a piece with its back to one is knocked against it.
 * `reach` changes how far: {distance, least, most} in place of KNOCK_DISTANCE and KNOCK_MIN,
 * and `most`, the furthest it may go at all (the ghost's spook is weaker than a kick:
 * lobby/shared/ghost.js). With `most`, a piece with no clear dark within it lands on the edge of
 * the dark it is in (it is never moved into a light), and a piece standing in a light with no
 * dark within `most` is moved `distance` (or `most`) inside it: never further.
 */
export function knockLanding(x, dir, n, lit = null, { distance = KNOCK_DISTANCE, least: leastFar = KNOCK_MIN, most = Infinity } = {}) {
  const side = dir < 0 ? -1 : 1;
  const aim = clampX(x + side * Math.min(distance, most));
  let best = null;
  // Clear of the lights by KNOCK_CLEAR and far enough; then clear and any distance; then just out of the light.
  for (const [least, clear] of [[leastFar, KNOCK_CLEAR], [0, KNOCK_CLEAR], [0, 1]]) {
    for (const [a, b] of landingGround(n, lit, clear)) {
      // The part of this stretch that is far enough along in the direction of the blow, and not too far.
      const lo = side > 0 ? Math.max(a, x + least) : Math.max(a, x - most);
      const hi = side > 0 ? Math.min(b, x + most) : Math.min(b, x - least);
      if (lo > hi) continue;
      const spot = Math.min(hi, Math.max(lo, aim));
      if (best === null || Math.abs(spot - aim) < Math.abs(best - aim)) best = spot;
    }
    if (best !== null) break;
  }
  if (best !== null) return Math.round(best);
  // On the very edge of a light, with no more dark that way: it stays on its edge, in the dark.
  const w = wallOf(n);
  const on = lit ? new Set(lit) : null;
  const inLight = w.pools.some((p) => (!on || on.has(p.i)) && Math.abs(x - p.x) <= p.half);
  return inLight ? Math.round(aim) : x;
}

/** What the room writes on a piece that was just knocked at `now`; `extra`: it lies down that much longer (a charge's bounce). */
export function knocked(now, extra = 0) {
  return { stunUntil: now + STUN_MS + extra, immuneUntil: now + STUN_MS + extra + IMMUNE_MS, knockExtra: extra };
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

/** The victim's state `ms` after the bump that hit it. `safeFor` is how long it stays safe after getting up; `extra`, how much longer it lies down. */
export function knockState(ms, safeFor = IMMUNE_MS, extra = 0) {
  if (!(ms >= 0) || ms >= STUN_MS + extra + safeFor) return "up";
  if (ms < IMPACT_MS) return "standing";
  if (ms < IMPACT_MS + HIT_PAUSE_MS) return "hit";
  if (ms < IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS) return "flying";
  if (ms < STUN_MS - GETUP_MS + extra) return "down";
  if (ms < STUN_MS + extra) return "rising";
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
 * `lunge` ({from, to, power}): a charge let go (chargePose): in place of the wind-up it dashes
 * along the floor from `from` to `to` (state "dashing", with `x` and its fading `charge`), then
 * kicks there (`x` is `to` until the kick is over).
 */
export function attackPose(ms, dir = 1, landed = false, lunge = null) {
  const pose = kickPose(ms, dir, landed, lunge);
  // After its dash a charged kick is drawn where the room put it, however late a frame comes.
  return lunge && pose.x === undefined && pose.state !== "idle" ? { ...pose, x: lunge.to } : pose;
}

function kickPose(ms, dir, landed, lunge) {
  const state = attackState(ms, landed);
  const side = dir < 0 ? -1 : 1;
  const down = { dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1 };
  // Picked up, with the base drawn back behind the head.
  const back = { dx: -8 * side, lift: 36, tilt: 40 * side, sx: 0.97, sy: 1.05 };
  if (lunge && state === "winding") {
    // A charge let go: drawn back already, it dashes along the floor to where the room put it, then kicks.
    const u = ms / WINDUP_MS;
    return { state: "dashing", pivot: PIECE_HEAD, ...blend(chargeBack(side, lunge.power ?? 1), back, u), x: mix(lunge.from, lunge.to, smooth(u)), charge: (lunge.power ?? 1) * (1 - u) };
  }
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

/** Drawn back for a charged kick of `power`: further back and higher than a kick's wind-up, and squashed a little, the harder it is held. */
function chargeBack(side, power) {
  return { dx: -12 * side, lift: 38 + 12 * power, tilt: (44 + 16 * power) * side, sx: 0.97 + 0.05 * power, sy: 1.05 - 0.1 * power };
}

/**
 * How a pawn holds itself while it charges its kick, `ms` after the press, facing `dir`: picked up
 * and drawn back as for a kick, then held there, further back and trembling more as the charge
 * grows. {state: "charging", dx, lift, tilt, pivot, sx, sy, charge}: `charge` is how strong it is
 * (0 to 1, shared/bump.js chargePower), for the glow every look draws; `calm`: no tremble.
 */
export function chargePose(ms, dir = 1, calm = false) {
  const side = dir < 0 ? -1 : 1;
  const power = chargePower(ms);
  const t = Math.max(0, ms);
  if (t < WINDUP_MS) {
    const u = t / WINDUP_MS;
    const pose = blend(REST, chargeBack(side, 0), smooth(u));
    return { state: "charging", pivot: PIECE_HEAD, ...pose, lift: chargeBack(side, 0).lift * (1 - (1 - u) * (1 - u)), charge: 0 };
  }
  const k = smooth(Math.min(1, (t - WINDUP_MS) / (CHARGE_FULL_MS - WINDUP_MS)));
  const pose = chargeBack(side, k);
  const shake = calm ? 0 : Math.sin(t / 17) * (0.6 + 2.6 * power);
  return { state: "charging", pivot: PIECE_HEAD, ...pose, dx: pose.dx + shake, charge: power };
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
export function knockPose(ms, from, to, safeFor = IMMUNE_MS, extra = 0) {
  const state = knockState(ms, safeFor, extra);
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
    const u = smooth((ms - extra - (STUN_MS - GETUP_MS)) / GETUP_MS);
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
