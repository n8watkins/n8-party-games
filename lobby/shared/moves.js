// What the characters' moves do to a piece, in one place for both drawings and the room: every way
// the room moves a piece other than a kick (a knock), named by the `fright` the room writes on it.
//
//   scare      a pawn kicked a faded ghost (shared/ghost.js)
//   bigscare   the same with a charged kick: frozen longer (shared/ghost.js, BIG_SCARE)
//   spook      a faded ghost drifted through it (shared/ghost.js)
//   hookscare  a robot's hook passed through a faded ghost: the robot is scared (shared/robot.js)
//   pull       a robot's hook dragged it across the floor, upright (shared/robot.js)
//   bonk       the hook back: two robots yanked together, heads bonked (shared/robot.js)
//   shove      a slime walked into it (shared/slime.js)
//   freed      freed from a pull where it was: its chain cut, or a ghost that slipped the hook (shared/robot.js)
//   tug        held between two hooks that reached it at once (shared/robot.js)
//   curl       a hardened slime sent sliding by a charged kick: the curling stone (shared/counters.js)
//   swallowed  a hardened slime swallowed by a soft one and spat out the far side (shared/counters.js)
//   stick      two soft slimes stuck together, wobbling, then apart (shared/counters.js)
//   pop        two faded ghosts that met, popped solid (shared/counters.js)
//
// And the one rule every slide across the floor keeps (slideLanding): a piece the room drags may
// leave the light it stands in (as a kick does), but it never comes to rest in another light that
// is on. So no move ever puts a vote somewhere its player did not choose, during a count or not.
import { IMMUNE_MS, KNOCK_CLEAR, landingGround } from "./bump.js";
import { BIG_SCARE, BIG_SCARE_MS, SCARE, SCARE_MS, SPOOK, SPOOK_MS, frightPose, SCARE_START_MS, SCARE_FREEZE_MS, SCARE_RUN_MS, SCARE_HOP } from "./ghost.js";
import { BONK, FREED, PULL, PULLED_SAFE_MS, TUG } from "./robot.js";
import { SHOVE } from "./slime.js";
import { CURL, POPPED, STUCK, SWALLOWED } from "./counters.js";
import { lightAt } from "./world.js";

/** A piece a touch counter moved (shared/counters.js) cannot be knocked, shoved or spooked again for this long after: a counter resolves once. */
export const COUNTER_SAFE_MS = 600;

/** A robot scared by its own hook: the start, the freeze and the scurry, from the moment the room says so (no kick on its way first). */
export const HOOK_SCARE = { lead: 0, freeze: SCARE_FREEZE_MS, run: SCARE_RUN_MS, hop: SCARE_HOP };
export const HOOK_SCARE_MS = SCARE_START_MS + SCARE_FREEZE_MS + SCARE_RUN_MS;

/**
 * Each kind: how it is drawn (`how`: a fright's, or one with a pose of its own), how long the piece
 * is down (`ms`) and how long it is safe after (`safe`), as the room writes them.
 */
export const MOVED = {
  scare: { how: SCARE, ms: SCARE_MS, safe: IMMUNE_MS },
  bigscare: { how: BIG_SCARE, ms: BIG_SCARE_MS, safe: IMMUNE_MS },
  spook: { how: SPOOK, ms: SPOOK_MS, safe: IMMUNE_MS },
  hookscare: { how: HOOK_SCARE, ms: HOOK_SCARE_MS, safe: IMMUNE_MS },
  pull: { how: PULL, ms: PULL.ms, safe: PULLED_SAFE_MS },
  bonk: { how: BONK, ms: BONK.ms, safe: PULLED_SAFE_MS },
  shove: { how: SHOVE, ms: SHOVE.ms, safe: 0 },
  freed: { how: FREED, ms: FREED.ms, safe: PULLED_SAFE_MS },
  tug: { how: TUG, ms: TUG.ms, safe: PULLED_SAFE_MS },
  curl: { how: CURL, ms: CURL.ms, safe: COUNTER_SAFE_MS },
  swallowed: { how: SWALLOWED, ms: SWALLOWED.ms, safe: COUNTER_SAFE_MS },
  stick: { how: STUCK, ms: STUCK.ms, safe: COUNTER_SAFE_MS },
  pop: { how: POPPED, ms: POPPED.ms, safe: COUNTER_SAFE_MS },
};

/** Whether `kind` is one of the room's frights (a page may hear of a kind newer than it is: drawn as a knock). */
export const isMoved = (kind) => typeof kind === "string" && Object.hasOwn(MOVED, kind);

/** A record for the drawings: {at, from, to, how, safeFor, kind}, the way a fright heard live makes it. */
export function moved(kind, from, to, at, safeFor = MOVED[kind].safe) {
  return { at, from, to, how: MOVED[kind].how, safeFor, kind };
}

/**
 * A move already under way, for a page that arrives in the middle (a reload): the room view says
 * the piece at `x` is down for `down` more milliseconds and safe for `safe`, and which kind it is.
 * The piece is already where the room put it, so it finishes the story there.
 */
export function movedResumed(x, down, safe, kind, now) {
  const { ms } = MOVED[kind];
  return { at: now - (ms - down), from: x, to: x, how: MOVED[kind].how, safeFor: Math.max(0, safe - down), kind };
}

/**
 * How a moved piece holds itself `ms` after it began: the same shape as frightPose (shared/ghost.js),
 * {state, x, dx, lift, tilt, sx, sy, scared, pale, face, dizzy}. `state` is "up" when it is over.
 */
export function movedPose(f, ms, calm = false) {
  if (f.how.pose) return f.how.pose(ms, f.from, f.to, f.safeFor, calm);
  return frightPose(ms, f.from, f.to, f.how, f.safeFor, calm);
}

/**
 * Where a piece the room drags from `from` toward `to` comes to rest, on wall `n` (shared/world.js:
 * a wall, or how many boxes hang evenly on it) of whose lights the `lit` ones are on: `to` itself,
 * unless that is in a light that is on and is not the one it stood in; then the nearest spot short
 * of it that is in the dark (at least KNOCK_CLEAR clear of the light, where there is that much
 * dark) or still in its own light. It never goes past `to`, and `from` itself is always allowed.
 */
export function slideLanding(from, to, n, lit) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  // The dark, clear of every light that is on; and the piece's own light (with its margins), if it stands in one.
  const ground = landingGround(n, lit, KNOCK_CLEAR);
  const spans = ground.map(([a, b]) => [a, b]);
  const inDark = ground.some(([a, b]) => from >= a - 0.001 && from <= b + 0.001);
  if (!inDark) {
    // Between two stretches of dark: its own light (or the narrow margin by one), which it may stay in.
    let a = -Infinity;
    let b = Infinity;
    for (const [s, e] of ground) {
      if (e < from) a = Math.max(a, e);
      if (s > from) b = Math.min(b, s);
    }
    // A piece standing in the dark margin by a light (not in it) may not use that light: only where it is.
    const i = lightAt(from, n);
    const ownLit = i !== -1 && (lit === null || lit.includes(i));
    spans.push(ownLit ? [a, b] : [from, from]);
  }
  let best = from;
  for (const [a, b] of spans) {
    const s = Math.max(a, lo);
    const e = Math.min(b, hi);
    if (s > e) continue;
    const spot = Math.min(e, Math.max(s, to));
    if (Math.abs(spot - to) < Math.abs(best - to)) best = spot;
  }
  return Math.round(best);
}

/**
 * How long the room holds a touch it worked out on a walk its phone has not confirmed (LobbyCore
 * sweep). A walking phone says nothing until it stops or turns, so the room's reckoning runs on
 * past where the player let go of the key by however long that word takes to arrive: up to
 * SEND_GAP_MS (60, shared/pilot.js) while the page gathers it, a frame or two (about 35 ms), and
 * the trip to the room (50 to 150 ms on a phone). 250 ms covers that with room to spare, and is
 * short enough that a stalled phone's touch still lands while its piece is plainly there.
 */
export const TOUCH_GRACE_MS = 250;

/**
 * The swept touch: the gap from one piece to another goes from `r0` to `r1` (both walking at a
 * steady speed in between, so evenly), and a touch is that gap in [lo, hi]. Returns how far
 * through (0 to 1) the gap first comes into it, or null when it never does. A gap that jumps
 * right across in one step (a slow phone's walk, a long wait between the room's looks) still
 * touches, at the moment it reached the near edge: the room judges the path, not where it ends.
 */
export function touchAt(r0, r1, lo, hi) {
  if (r0 >= lo && r0 <= hi) return 0;
  if (r0 > hi && r1 <= hi) return (r0 - hi) / (r0 - r1);
  if (r0 < lo && r1 >= lo) return (lo - r0) / (r1 - r0);
  return null;
}
