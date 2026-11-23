// The ghost's move, its rules and its timings, as plain numbers. Nothing here draws.
//
// What the owner chose (character previews, rounds two and three; PARTY-GAMES-STATUS.md):
//
//   the fade    The ghost's one move. It goes see-through for FADE_MS and cannot fade again until
//               FADE_COOLDOWN_MS after it began. While faded nothing can touch it, and it has no
//               vote: the light it stands in does not count it. It can be hit again the moment
//               it turns solid.
//   the scare   A kick that reaches a faded ghost passes through it, and the kicker is scared:
//               it starts, freezes with wide eyes and shivers for about 0.75 s, then scurries
//               off as far as a kick would have thrown it, with a pale tint while it lasts.
//   boo         While faded, the ghost drifts through a piece and spooks it out of place: the
//               same start and scurry, shorter and weaker than a kick. Its cap: a fade spooks
//               each piece once at most, a piece cannot be spooked again for SPOOK_AGAIN_MS
//               whoever does it, and a ghost never spooks another ghost.
//
// None of it can happen during a count, a coin toss or a game starting: the fade is refused
// then, and the scare and boo need a fade. The count waits for a faded ghost (it is not standing
// in a light), so a fade can hold a count back by FADE_MS at most.
//
// The room judges all of it at once and tells everybody, as it does a bump: nothing is timed on
// its side but the times written on the piece (fadedUntil, stunUntil, immuneUntil, spookedUntil),
// and one wake-up when a fade ends, so the vote is looked at again.
import { COOLDOWN_SLACK_MS, IMPACT_MS, KNOCK_DISTANCE, isDown } from "./bump.js";
import { POSITION_SLACK } from "./world.js";

/** How long a fade lasts, and how long after one begins the next may. */
export const FADE_MS = 2500;
export const FADE_COOLDOWN_MS = 8000;

/** The scare, from the moment the kick reaches the ghost: the start (a jump on the spot), then frozen and shivering. Together "about 0.75 s". */
export const SCARE_START_MS = 160;
export const SCARE_FREEZE_MS = 590;
/** Then it scurries to where the room put it: a kick's distance away, in the dark. */
export const SCARE_RUN_MS = 420;
/** From the kick until the kicker has its piece back. */
export const SCARE_MS = IMPACT_MS + SCARE_START_MS + SCARE_FREEZE_MS + SCARE_RUN_MS;

/** Boo: how close the faded ghost must come to a piece, and how far the piece is spooked (weaker than a kick). */
export const SPOOK_REACH = 46;
export const SPOOK_DISTANCE = 120;
export const SPOOK_MIN = 60;
/**
 * The furthest a spook ever moves a piece, wherever it starts: well under a kick's
 * KNOCK_DISTANCE. A spook lands in the dark when there is dark within this; a piece spooked in
 * the middle of a wide pool of light is moved SPOOK_DISTANCE inside it instead (it keeps its vote).
 */
export const SPOOK_MOST = 150;
/** The room believes a ghost that says it touched a piece this much further off than it works out (the two pieces' last news may be a moment old). */
export const SPOOK_SLACK = 70;

// What an honest page can and cannot send. A page boos only while the room has told it that its
// ghost is faded, and stops BOO_EARLY_MS before that fade ends by its own clock; a boo can still
// arrive just after the room's fade ended, or about a piece the room has just kicked or another
// ghost has just spooked. Those are refused and cost nothing. What no page sends: a boo from a
// piece that is not a ghost, from a ghost whose fade ended more than BOO_LATE_MS ago (or that
// never faded), about a seat that is not a piece, or about a piece further off than SPOOK_FAR
// (the most the room ever believes a position is off, POSITION_SLACK, on top of the boo's own
// reach and slack). Those count against the socket's rate limit (lobby-room.js, ghostMove).
export const BOO_EARLY_MS = 200;
export const BOO_LATE_MS = 1500;
export const SPOOK_FAR = SPOOK_REACH + SPOOK_SLACK + POSITION_SLACK;
/** A spooked piece starts, then scurries: no freeze. */
export const SPOOK_RUN_MS = 380;
export const SPOOK_MS = SCARE_START_MS + SPOOK_RUN_MS;
/** A piece cannot be spooked again this soon, by any ghost. */
export const SPOOK_AGAIN_MS = 6000;

/**
 * How faded a faded ghost is drawn, 0 (solid) to 1: 1 for everyone else, less on its own
 * player's phone, so they can always find themselves. Everyone else still sees its outline, its
 * face and its name tag, so the room's lights and spots still read.
 */
export const OWN_FADED = 0.5;

/** How long the ghost's own boo lasts on its body when it scares or spooks someone (it swells, its eyes and mouth go wide). */
export const BOO_MS = 520;

/** How far into its boo a ghost is, 0 to 1, `ms` after it began: up quickly, held, and down. */
export function booAmount(ms) {
  if (!(ms >= 0 && ms < BOO_MS)) return 0;
  const u = ms / BOO_MS;
  return Math.sin(Math.min(1, u * 2.2) * Math.PI * 0.5) * (1 - Math.max(0, (u - 0.5) * 2) ** 2);
}

/** How hard each reaction is drawn: the scare is "big and clear", the spook a smaller version of it. */
export const SCARE_HOP = 40;
export const SPOOK_HOP = 26;

// ---------------------------------------------------------------- the rules

/** Whether a member of the room is a faded ghost at `now` (any piece that fades: `fades` says whether its character's move is the fade). */
export function isFaded(piece, now, fades = true) {
  return fades && now < (piece.fadedUntil ?? 0);
}

/** Milliseconds until a piece that last faded at `fadeAt` may fade again (0: ready). */
export function fadeLeft(fadeAt, now) {
  return Math.max(0, (fadeAt ?? -Infinity) + FADE_COOLDOWN_MS - now);
}

/** How full the fade's cooldown is, 0 (just faded) to 1 (ready), for whatever shows it. */
export function fadeFraction(left) {
  return 1 - Math.min(1, Math.max(0, left / FADE_COOLDOWN_MS));
}

/**
 * Whether the room lets a piece fade now: {ok} or {ok: false, why, wait}. `room` says what the
 * room is doing: {fades (its character's move is the fade), lobby (the pieces' own time: not a
 * game, its settings or the Table), busy (a count, a coin toss or a game starting)}. `wait` is
 * set only when waiting will do: the cooldown (then `cooling` is set too), or getting up off
 * the floor.
 */
export function mayFade(piece, now, { fades, lobby, busy }) {
  if (!fades) return { ok: false, why: "Only a ghost can fade." };
  if (!lobby) return { ok: false, why: "You can fade in the room, between games." };
  if (busy) return { ok: false, why: busy };
  const down = Math.max(0, (piece.stunUntil ?? 0) - now);
  if (down > 0) return { ok: false, why: "Not while you are knocked over.", wait: down };
  const cooling = fadeLeft(piece.fadeAt, now);
  if (cooling > COOLDOWN_SLACK_MS) return { ok: false, why: "Your fade is not ready yet.", wait: cooling, cooling: true };
  return { ok: true };
}

/**
 * Whether a faded ghost at `ghostX` may spook `target` ({x, seat, fades, ...times}) at `now`:
 * {ok} or {ok: false, why}. `spooked` is the seats this fade has spooked already. `touched`: the
 * room itself saw the ghost drift through it along its path (LobbyCore.sweep), so where the two
 * stand now is not asked.
 */
export function maySpook(ghostX, target, now, spooked = [], touched = false) {
  if (target.fades) return { ok: false, why: "A ghost cannot spook a ghost." };
  if (spooked.includes(target.seat)) return { ok: false, why: "Already spooked by this fade." };
  if (now < (target.spookedUntil ?? 0)) return { ok: false, why: "Spooked a moment ago." };
  if (isDown(target, now) || now < (target.immuneUntil ?? 0)) return { ok: false, why: "Knocked over, or just up." };
  if (!touched && Math.abs(target.x - ghostX) > SPOOK_REACH + SPOOK_SLACK) return { ok: false, why: "Too far away." };
  return { ok: true };
}

/**
 * What the room writes on a kicker that was just scared at `now`, and on a piece that was just
 * spooked. `fright` says which, so a page that arrives in the middle draws it as that (and not
 * as a knock): the room view carries it while the piece is down or safe.
 */
export function scared(now, immune) {
  return { stunUntil: now + SCARE_MS, immuneUntil: now + SCARE_MS + immune, fright: "scare" };
}
export function spooked(now, immune) {
  return { stunUntil: now + SPOOK_MS, immuneUntil: now + SPOOK_MS + immune, spookedUntil: now + SPOOK_AGAIN_MS, fright: "spook" };
}

/** How long a scare or a spook keeps a piece down, by its `fright`. */
export const frightMs = (fright) => (fright === "scare" ? SCARE_MS : SPOOK_MS);

/** How far a spook sends a piece: for knockLanding (lobby/shared/bump.js). A scare uses a kick's own. */
export const SPOOK_LANDING = { distance: SPOOK_DISTANCE, least: SPOOK_MIN, most: SPOOK_MOST };
export const SCARE_LANDING = { distance: KNOCK_DISTANCE };

// ---------------------------------------------------------------- the reaction, as a pose
//
// Scared and spooked pieces play the same short story, whatever their character, in the same
// terms as a knocked one (lobby/shared/bump.js, knockPose): offsets and angles in world units and
// degrees, about the piece's foot. A character only decides how wide its eyes go and how its
// paint pales (`scared` and `pale`, 0 to 1).
//
//   standing (the kick is still on its way: the kicker's own kick is drawn) -> start (a jump on
//   the spot, stretched tall, leaning back from the ghost) -> frozen (tense, shivering) ->
//   running (scurries to where the room put it, leaning into it, in small quick hops) -> safe
//   (its own again, and cannot be knocked for a while) -> up

const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;

/** A scare: the kick reaches the ghost at IMPACT_MS. A spook: at once, with no freeze. */
export const SCARE = { lead: IMPACT_MS, freeze: SCARE_FREEZE_MS, run: SCARE_RUN_MS, hop: SCARE_HOP };
export const SPOOK = { lead: 0, freeze: 0, run: SPOOK_RUN_MS, hop: SPOOK_HOP };

/**
 * A scare or a spook already under way, for a page that arrives in the middle (a reload): the
 * room view says the piece at `x` is down for `down` more milliseconds and safe for `safe`, and
 * which fright it is. The drawing's record {at, from, to, how, safeFor}, as a fright heard live
 * makes it; the piece is already where the room put it, so it finishes the story there.
 */
export function frightResumed(x, down, safe, fright, now) {
  return { at: now - (frightMs(fright) - down), from: x, to: x, how: fright === "scare" ? SCARE : SPOOK, safeFor: Math.max(0, safe - down) };
}

/** The state of a scared or spooked piece `ms` after it began; `safeFor` is how long it stays safe after. */
export function frightState(ms, how, safeFor) {
  const startEnds = how.lead + SCARE_START_MS;
  const frozenEnds = startEnds + how.freeze;
  const runEnds = frozenEnds + how.run;
  if (!(ms >= 0) || ms >= runEnds + safeFor) return "up";
  if (ms < how.lead) return "standing";
  if (ms < startEnds) return "start";
  if (ms < frozenEnds) return "frozen";
  if (ms < runEnds) return "running";
  return "safe";
}

/**
 * How a scared or spooked piece holds itself `ms` after it began, sent from `from` to `to`:
 * {state, x, dx, lift, tilt, sx, sy, scared, pale, face}. `calm`: the viewer asked for less
 * motion, so it does not shiver and its jumps are small. `face` is the way it looks: back at
 * whatever frightened it until it runs, then the way it runs (0: leave it as it is).
 */
export function frightPose(ms, from, to, how, safeFor, calm = false) {
  const state = frightState(ms, how, safeFor);
  const away = to < from ? -1 : 1;
  const hop = calm ? how.hop * 0.4 : how.hop;
  const rest = { state, x: from, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0 };
  if (state === "standing") return rest;
  const startEnds = how.lead + SCARE_START_MS;
  const frozenEnds = startEnds + how.freeze;
  if (state === "start") {
    const u = (ms - how.lead) / SCARE_START_MS;
    const arc = Math.sin(u * Math.PI);
    // Straight up, stretched tall, leaning back from what frightened it.
    return { ...rest, lift: hop * arc, tilt: -7 * away * arc, sx: 1 - 0.1 * arc, sy: 1 + 0.16 * arc, scared: Math.min(1, u * 3), pale: Math.min(1, u * 2), face: -away };
  }
  if (state === "frozen") {
    const t = ms - startEnds;
    // Tense and still, shivering on the spot.
    const shiver = calm ? 0 : Math.sin(t / 19) * 2.4 + Math.sin(t / 7.3) * 0.8;
    return { ...rest, dx: shiver, sx: 0.96, sy: 1.05, scared: 1, pale: 1, face: -away };
  }
  if (state === "running") {
    const u = (ms - frozenEnds) / how.run;
    // Off it goes, quick at first, in small hops, leaning into it.
    const go = 1 - (1 - u) * (1 - u);
    const skip = calm ? 0 : Math.abs(Math.sin(u * Math.PI * 3)) * 9;
    return { ...rest, x: mix(from, to, go), lift: skip, tilt: 9 * away * Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5) * (1 - smooth(Math.max(0, (u - 0.75) / 0.25))), scared: 1 - smooth(Math.max(0, (u - 0.6) / 0.4)) * 0.6, pale: 1 - 0.5 * u, face: away };
  }
  if (state === "safe") return { ...rest, x: null, face: 0 };
  return { ...rest, x: null };
}
