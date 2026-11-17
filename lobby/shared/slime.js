// The slime's moves, their rules and their timings, as plain numbers: every number the slime uses
// is in this one file. Nothing here draws.
//
// What the owner chose (character previews, rounds two and three; PARTY-GAMES-STATUS.md):
//
//   heavy     The slime shoves other pieces just by walking into them, slowly: each touch pushes
//             the piece a step on. Nobody can shove a slime, and it stops shoving while it hardens
//             or absorbs. It never shoves a robot up on its legs (the robot steps over it) or a
//             faded ghost (nothing touches one).
//   harden    Its one move button, tapped: glossy and solid like a gem for HARDEN_MS. A pawn that
//             kicks it bounces off and is knocked back itself; a robot's hook clangs off it and
//             nothing moves. Then it is soft again, and open to being hit until it can harden again
//             (SLIME_COOLDOWN_MS after it began): the window in which it can itself be hit.
//   absorb    The same button held: the slime hardens on the press and, held past HOLD_MS, goes soft
//             and sticky instead for ABSORB_MS. A robot's hook that reaches it sticks, and the robot
//             is dragged across the floor to the slime: the hook turned around. A kick still lands.
//
// One button, one cooldown: a tap is a harden; a hold is a harden that turns into an absorb (the
// turn is free, but it must come soon after the harden it turns: ABSORB_TURN_MS).
//
// Nothing here changes a vote by itself: a shoved piece may be pushed out of its light (as a kick
// does), but never into another one (shared/moves.js, slideLanding). All of it is allowed during
// the count, as a kick is, and none of it holds a count back.
import { POSITION_SLACK } from "./world.js";

/** How long a harden lasts, and how long an absorb lasts from the moment the press turned into one. */
export const HARDEN_MS = 1000;
export const ABSORB_MS = 1000;
/** A slime may harden again this long after its last harden began, whatever it turned into. */
export const SLIME_COOLDOWN_MS = 5000;
/** The button held this long after the press turns the harden into an absorb. */
export const HOLD_MS = 280;
/** The room takes an absorb only this soon after the harden it turns (a page sends it at HOLD_MS). */
export const ABSORB_TURN_MS = 700;

/** A slime touches a piece when their middles are this close, and pushes it this far on each touch, over SHOVE_MS. */
export const SHOVE_REACH = 70;
export const SHOVE_STEP = 60;
export const SHOVE_MS = 200;
/** A piece is not shoved again for this long after a shove (by any slime): the slime catches up with it as it walks. */
export const SHOVE_AGAIN_MS = 320;
/** The room believes a slime that says it touched a piece this much further off than it works out. */
export const SHOVE_SLACK = 70;
/** Further than this no page says it touched a piece (the most the room believes a position is off on top). */
export const SHOVE_FAR = SHOVE_REACH + SHOVE_SLACK + POSITION_SLACK;
/** A shove that came this long after the slime stopped, hardened or became something else is an honest one a moment late. */
export const SHOVE_LATE_MS = 400;

/** Milliseconds until a slime that last hardened at `slimeAt` may harden again (0: ready). */
export function slimeLeft(slimeAt, now) {
  return Math.max(0, (slimeAt ?? -Infinity) + SLIME_COOLDOWN_MS - now);
}

/** Whether a member of the room is hardened, or absorbing, at `now`. */
export const isHard = (piece, now) => now < (piece.hardUntil ?? 0);
export const isSoft = (piece, now) => now < (piece.softUntil ?? 0);

/**
 * Whether the room lets a slime harden (`kind` "harden") or turn its harden into an absorb
 * ("absorb") now: {ok} or {ok: false, why, wait, cooling}. `room`: {slimes (its character's move
 * is the slime's), lobby (the pieces' own time), slack}.
 */
export function maySlime(piece, kind, now, { slimes, lobby, slack }) {
  if (!slimes) return { ok: false, why: "Only a slime can do that." };
  if (!lobby) return { ok: false, why: "You can do that in the room, between games." };
  const down = Math.max(0, (piece.stunUntil ?? 0) - now);
  if (down > 0) return { ok: false, why: "Not while you are knocked over.", wait: down };
  if (kind === "absorb") {
    // Only the harden just begun turns: the absorb has no cooldown of its own.
    if (!(now - (piece.slimeAt ?? -Infinity) <= ABSORB_TURN_MS) || piece.slimeTurned) return { ok: false, why: "Hold the button to go soft." };
    return { ok: true };
  }
  const cooling = slimeLeft(piece.slimeAt, now);
  if (cooling > slack) return { ok: false, why: "Not ready yet.", wait: cooling, cooling: true };
  return { ok: true };
}

/**
 * Whether a slime at `slimeX`, walking in direction `d`, may shove `target` ({x, seat, slime,
 * up, faded, ...times}) at `now`: {ok} or {ok: false, why}. A slime shoves only what is in front
 * of it as it walks.
 */
export function mayShove(slimeX, d, target, now) {
  if (!d) return { ok: false, why: "Not walking." };
  if (target.slime) return { ok: false, why: "Nobody can shove a slime." };
  if (target.up) return { ok: false, why: "It steps over you." };
  if (target.faded) return { ok: false, why: "Nothing touches a faded ghost." };
  if (now < (target.shovedUntil ?? 0)) return { ok: false, why: "Shoved a moment ago." };
  if (now < (target.stunUntil ?? 0) || now < (target.immuneUntil ?? 0)) return { ok: false, why: "Knocked over, or just up." };
  const ahead = (target.x - slimeX) * d;
  if (ahead < -SHOVE_SLACK / 2 || ahead > SHOVE_REACH + SHOVE_SLACK) return { ok: false, why: "Too far away." };
  return { ok: true };
}

/** What the room writes on a piece that was just shoved at `now`: it slides, and cannot be shoved again for a moment. */
export function shoved(now) {
  return { stunUntil: now + SHOVE_MS, immuneUntil: now + SHOVE_MS, shovedUntil: now + SHOVE_AGAIN_MS, fright: "shove" };
}

const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;

// ---------------------------------------------------------------- how it looks, as numbers

/** How quickly the slime snaps hard and melts soft again (ms). */
export const SNAP_MS = 70;
export const MELT_MS = 160;

/**
 * How hard (0 to 1) and how soft (0 to 1) a slime is `ms` after its press, for a harden that
 * lasts `hardFor` and (when it turned) an absorb from `turnAt` that lasts `softFor`.
 */
export function slimeLook(ms, hardFor, turnAt = null, softFor = 0) {
  if (!(ms >= 0)) return { hard: 0, soft: 0 };
  const end = turnAt !== null ? Math.min(hardFor, turnAt) : hardFor;
  const hardIn = Math.min(1, ms / SNAP_MS);
  const hardOut = ms < end ? 1 : 1 - Math.min(1, (ms - end) / (turnAt !== null ? SNAP_MS : MELT_MS));
  const hard = Math.max(0, Math.min(hardIn, hardOut));
  if (turnAt === null) return { hard, soft: 0 };
  const s = ms - turnAt;
  const soft = s < 0 ? 0 : s < softFor ? Math.min(1, s / SNAP_MS) : Math.max(0, 1 - (s - softFor) / MELT_MS);
  return { hard, soft };
}

/** A shoved piece: it slides a step on, upright, leaning back as it skids. */
export function shovePose(ms, from, to, safeFor, calm = false) {
  const away = to < from ? -1 : 1;
  if (!(ms >= 0) || ms >= SHOVE_MS + safeFor) return { state: "up", x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0 };
  if (ms >= SHOVE_MS) return { state: "safe", x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0 };
  const u = ms / SHOVE_MS;
  const k = Math.sin(u * Math.PI);
  return { state: "shoved", x: mix(from, to, 1 - (1 - u) * (1 - u)), dx: 0, lift: 0, tilt: (calm ? 3 : 8) * away * k, sx: 1 + 0.04 * k, sy: 1 - 0.04 * k, scared: 0, pale: 0, face: 0 };
}

export const SHOVE = { kind: "shove", ms: SHOVE_MS, pose: shovePose };

/** How the slime's surface ripples while it is soft (0 to 1 soft), for the drawings: a slow wobble. */
export const softWobble = (now, soft, calm) => (calm ? 0 : soft * Math.sin(now / 90) * 0.05);

/** The flash a harden gives as it snaps (0 to 1), `ms` after the press. */
export const hardenFlash = (ms) => (ms >= 0 && ms < 220 ? 1 - smooth(ms / 220) : 0);
