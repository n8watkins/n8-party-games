// What happens when the characters touch in the middle of their moves (the owner's round three,
// "Counters"), as plain numbers. Nothing here draws.
//
//   curling stone   a pawn's charged kick sends a hardened slime sliding along the floor; it knocks
//                   the first piece in its way over (a voter out of its light) and slides on into
//                   the dark (the decided rule: nothing the room moves comes to rest in another
//                   box's light, so it never stops in the light it emptied)
//   dominoes        a kicked piece that flies into another knocks it over too (once: the one it
//                   knocks does not knock a third)
//   boo the stilts  a faded ghost that drifts through a robot up on its legs topples it
//   swallow         a slime going soft swallows a hardened one it touches and spits it out the far side
//   stick           two slimes gone soft that touch stick together, wobble, and come apart
//   ghosts meet     two faded ghosts that drift into each other both pop solid with a little shock
//
// The two limits on every counter hold here too: each resolves once (nothing it moves starts
// another), and all are judged by the room at the moment of the touch, as every touch is
// (LobbyCore.sweep). None of them puts a piece in a light its player did not walk into.
import { FLIGHT_MS, HIT_PAUSE_MS, IMPACT_MS } from "./bump.js";

// ---------------------------------------------------------------- the curling stone

/** How far a fully charged kick sends a hardened slime sliding, and the least (a charge just past a tap). */
export const CURL_DISTANCE = 600;
export const CURL_DISTANCE_MIN = 320;
/** How long its slide takes, slowing as it goes. */
export const CURL_MS = 760;
/** The stone meets a piece when their middles are this close. */
export const CURL_CONTACT = 64;

/** How far a charged kick of `power` sends the stone. */
export const curlDistance = (power) => CURL_DISTANCE_MIN + (CURL_DISTANCE - CURL_DISTANCE_MIN) * power;

/** How far along its slide the stone is, 0 to 1, `ms` into it: fast off the kick, slowing to a stop. */
export const curlEase = (ms) => {
  const u = Math.min(1, Math.max(0, ms / CURL_MS));
  return 1 - (1 - u) ** 2;
};

/** When, `ms` from the kick, a stone sliding `dist` reaches `reach` along its way (null: it never does). */
export function curlReaches(dist, reach) {
  if (!(reach >= 0) || reach > dist) return null;
  // Solves 1 - (1 - u)^2 = reach / dist for u.
  return Math.round((1 - Math.sqrt(1 - reach / dist)) * CURL_MS);
}

// ---------------------------------------------------------------- dominoes

/** A piece in the way of a knocked piece's flight is met when their middles come this close. */
export const DOMINO_CONTACT = 60;

/**
 * When, from the kick, a piece knocked from `from` to `to` (shared/bump.js, knockPose) reaches the
 * spot `x` ahead of it (its middle within DOMINO_CONTACT of it), or null when its flight never comes
 * that near. A spot already that near as the flight begins is reached at once (as the curling stone
 * meets a piece standing against it: LobbyCore.curl); one level with it or behind is never reached.
 * `dir`: which way it was knocked, for a flight that goes nowhere (a wall at its back).
 */
export function flightReaches(from, to, x, dir = Math.sign(to - from) || 1) {
  const ahead = (x - from) * dir;
  const span = Math.abs(to - from);
  if (!(ahead > 0) || ahead - DOMINO_CONTACT > span) return null;
  const reach = Math.max(0, ahead - DOMINO_CONTACT);
  // Against a wall it does not fly, and still meets what stands against it, at once.
  if (!(span > 0)) return IMPACT_MS + HIT_PAUSE_MS;
  // knockPose's flight eases out: 1 - (1 - u)^2 of the way after the blow and the pause.
  const u = 1 - Math.sqrt(1 - reach / span);
  return Math.round(IMPACT_MS + HIT_PAUSE_MS + u * FLIGHT_MS);
}

// ---------------------------------------------------------------- the slimes

/** Two slimes touch when their middles are this close (about a slime's width). */
export const GOO_REACH = 74;
/** A swallowed slime is spat out this far past the middle of the one that swallowed it, in this long. */
export const SWALLOW_OUT = 96;
export const SWALLOW_MS = 560;
/** Two slimes stuck together wobble this long, and come apart this far between their middles. */
export const STICK_MS = 820;
export const STICK_APART = 96;

// ---------------------------------------------------------------- the ghosts

/** Two faded ghosts that drift into each other pop solid and start for this long. */
export const POP_MS = 420;

// ---------------------------------------------------------------- how each looks, as a pose
//
// The same terms as a knock and a fright (shared/bump.js, ghost.js): offsets and angles in world
// units and degrees about the piece's foot, `x` along the floor (null: wherever it walks).

const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;
const rest = (state) => ({ state, x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0 });

/** The curling stone: it slides along the floor, glossy and upright, spinning a little, slowing to a stop. */
export function curlPose(ms, from, to, safeFor, calm = false) {
  // Until the kick lands it stands where it was (the kicker's kick is drawn meanwhile).
  if (ms < 0) return { ...rest("standing"), x: from };
  if (!(ms >= 0) || ms >= CURL_MS + safeFor) return rest("up");
  if (ms >= CURL_MS) return rest("safe");
  const u = ms / CURL_MS;
  const spin = calm ? 0 : Math.sin(u * Math.PI * 6) * 5 * (1 - u);
  return { state: "curling", x: mix(from, to, curlEase(ms)), dx: 0, lift: 0, tilt: spin, sx: 1.05, sy: 0.95, scared: 0, pale: 0, face: Math.sign(to - from) };
}

/** Swallowed: sucked into the soft slime it touched (squeezed small), and spat out the far side. */
export function swallowedPose(ms, from, to, safeFor, calm = false) {
  if (!(ms >= 0) || ms >= SWALLOW_MS + safeFor) return rest("up");
  if (ms >= SWALLOW_MS) return rest("safe");
  const u = ms / SWALLOW_MS;
  // In for the first two fifths (shrinking into the middle between), held, then out with a spring.
  const mid = (from + to) / 2;
  const x = u < 0.4 ? mix(from, mid, smooth(u / 0.4)) : u < 0.6 ? mid : mix(mid, to, smooth((u - 0.6) / 0.4));
  const small = u < 0.4 ? 1 - 0.55 * smooth(u / 0.4) : u < 0.6 ? 0.45 : 0.45 + 0.55 * smooth((u - 0.6) / 0.4);
  const pop = u >= 0.6 && !calm ? Math.sin(((u - 0.6) / 0.4) * Math.PI) * 14 : 0;
  return { state: "swallowed", x, dx: 0, lift: pop, tilt: 0, sx: small, sy: small, scared: 0.4, pale: 0, face: 0 };
}

/** Stuck to another slime: leaning in to it and wobbling, then pulled apart to where it ends. */
export function stickPose(ms, from, to, safeFor, calm = false) {
  if (!(ms >= 0) || ms >= STICK_MS + safeFor) return rest("up");
  if (ms >= STICK_MS) return rest("safe");
  const u = ms / STICK_MS;
  // The other slime is the way it comes apart from (to is away from it).
  const toward = -(Math.sign(to - from) || 1);
  const wobble = calm ? 0 : Math.sin(ms / 40) * 0.06 * (1 - u);
  const apart = u < 0.72 ? 0 : smooth((u - 0.72) / 0.28);
  return { state: "stuck", x: mix(from, to, apart), dx: toward * 10 * (1 - apart), lift: 0, tilt: toward * 9 * (1 - apart), sx: 1 + 0.12 * (1 - apart) + wobble, sy: 1 - 0.08 * (1 - apart) - wobble, scared: 0, pale: 0, face: toward };
}

/** Two faded ghosts met: a little shock, popped solid on the spot. */
export function popPose(ms, from, to, safeFor, calm = false) {
  if (!(ms >= 0) || ms >= POP_MS + safeFor) return rest("up");
  if (ms >= POP_MS) return rest("safe");
  const u = ms / POP_MS;
  const jolt = Math.sin(Math.min(1, u * 2.2) * Math.PI);
  const shake = calm ? 0 : Math.sin(ms / 14) * 3 * (1 - u);
  return { state: "popped", x: to, dx: shake, lift: (calm ? 6 : 16) * jolt, tilt: 0, sx: 1 + 0.1 * jolt, sy: 1 + 0.1 * jolt, scared: 1 - u, pale: 0, face: 0 };
}

/** How each is named for the drawings (shared/moves.js). */
export const CURL = { kind: "curl", ms: CURL_MS, pose: curlPose };
export const SWALLOWED = { kind: "swallowed", ms: SWALLOW_MS, pose: swallowedPose };
export const STUCK = { kind: "stick", ms: STICK_MS, pose: stickPose };
export const POPPED = { kind: "pop", ms: POP_MS, pose: popPose };
