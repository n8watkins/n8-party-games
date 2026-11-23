// The robot's two moves, their rules and their timings, as plain numbers. Nothing here draws.
//
// What the owner chose (character previews, rounds two and three; PARTY-GAMES-STATUS.md):
//
//   the hook     The robot's one move button. A quick skill shot along the floor (a little faster
//                than first shown): a short wind-up with a line of light on the floor as the tell,
//                then it flies straight out, grabs the first piece it meets and drags it across the
//                floor to the robot, upright and unharmed. A miss winds back with the cooldown spent.
//   stilt legs   The robot's jump: its legs telescope out and carry it over a kick (the kick swings
//                through the gap) and over other pieces (a slime cannot shove it). A squat as the
//                tell, a quick rise, a steady hold, a shake as the time runs out, a fast drop and a
//                flash on landing that says it can be hit again. No hook while it is up.
//
// What can happen to a hook (the approved matchups and the first counters):
//   pull      it yanks the piece to the robot (any piece, a robot on stilts too: its legs drop)
//   jumped    the piece was in the air as the hook reached it (a jump dodges it): it flies on
//   parry     a pawn's kick as the hook reaches it bats it away: nothing moves, cooldown spent
//   clang     a hardened slime: the hook clangs off, nothing moves (lobby/shared/slime.js)
//   stuck     an absorbing slime: the hook sticks and the robot is dragged to the slime
//   scare     a faded ghost: the hook passes through and the robot is scared off (shared/ghost.js)
//   bonk      the hook back: two robots hooking each other are both yanked to the middle and
//             bonk heads, briefly stunned (the owner's pick: a head bonk only, no swap)
//   miss      nothing within reach: it winds back
// A robot pulled while its own hook flies keeps its throw, and a robot pulled while it drags a
// catch keeps its catch: all three end in a line (the hook train).
//
// The room judges every hook by its own clock (LobbyCore.hook and dueHooks): where each piece is
// comes from the room's own reckoning (shared/world.js, posAt), never from the robot's page. It is
// judged HOOK_LATE_MS after the tip reaches the piece, so a jump or a kick that left the target's
// phone as the hook arrived is counted. That is one wake-up of the room per hook.
import { IMMUNE_MS } from "./bump.js";
import { JUMP_MS } from "./world.js";

// ---------------------------------------------------------------- the hook

/** The wind-up: the tell, with a line of light along the floor as far as the hook reaches. */
export const HOOK_AIM_MS = 150;
/** How fast the hook flies (world units a second), and how far it reaches past its hand: about four piece widths. */
export const HOOK_SPEED = 1650;
export const HOOK_RANGE = 300;
/** Where the hook leaves the robot, in front of its middle, and how high above the floor it flies (it travels along the floor: a jump clears it). */
export const HOOK_HAND = 36;
export const HOOK_Y = 44;
/** The longest flight, to the end of its reach. */
export const HOOK_FLIGHT_MS = Math.round((HOOK_RANGE / HOOK_SPEED) * 1000);
/** A piece is caught once the tip is within this of its middle, and one just behind the robot's front is not caught at all. */
export const HOOK_GRAB = 30;
export const HOOK_BEHIND = 20;
/** The room judges a hook this long after its tip reaches a piece (or the end of its reach): the network's allowance for a jump or a kick. */
export const HOOK_LATE_MS = 100;
/** From the wind-up to the last moment a hook may still be judged. */
export const HOOK_LIFE_MS = HOOK_AIM_MS + HOOK_FLIGHT_MS + HOOK_LATE_MS;
/** A robot may hook again this long after it threw its last, whatever came of it. */
export const HOOK_COOLDOWN_MS = 6000;
/** A hook that caught nothing winds back in this long. */
export const HOOK_RETRACT_MS = 140;
/** The pull: the piece slides across the floor to the robot in this long, and ends this far from it (touching). */
export const PULL_MS = 260;
export const HOOK_HOLD = 64;
/** A piece pulled by a hook cannot be knocked, hooked or shoved for this long after it arrives. */
export const PULLED_SAFE_MS = IMMUNE_MS;
/** A pawn's kick that the room heard this long before the hook reached it (and up to HOOK_LATE_MS after) bats the hook away. */
export const PARRY_EARLY_MS = 260;
/** A jump the room heard this long before the hook reached the piece (and up to HOOK_LATE_MS after) has it in the air: dodged. */
export const DODGE_EARLY_MS = JUMP_MS - 60;
/** The hook back: both robots are stunned this long where they bonk. */
export const BONK_MS = 600;
/** A robot that hooks the robot that pulled it within this long bonks heads with it (the hook back). */
export const HOOK_BACK_MS = 600;
/** A robot pulled within this long of catching a piece brings that piece with it (the hook train). */
export const TRAIN_MS = PULL_MS + 200;
/** How long a page draws a thrown hook waiting for the room's word before it winds it back by itself. */
export const HOOK_WAIT_MS = 900;

// What an honest page can and cannot send. A page hooks only when its own cooldown is over and its
// legs are down. What no page sends: a hook from a piece that is not a robot (or has not been one
// for a while), or one far too soon. Those count against the socket's rate limit (lobby-room.js).

/** Milliseconds until a robot that last hooked at `hookAt` may hook again (0: ready). */
export function hookLeft(hookAt, now) {
  return Math.max(0, (hookAt ?? -Infinity) + HOOK_COOLDOWN_MS - now);
}

/** Where the tip of `hook` ({at, x0, dir}) is at `t`, along the floor. */
export function hookTipAt(hook, t) {
  const flown = Math.min(HOOK_RANGE, Math.max(0, ((t - hook.at - HOOK_AIM_MS) * HOOK_SPEED) / 1000));
  return hook.x0 + hook.dir * (HOOK_HAND + flown);
}

/** When the tip of `hook` reaches the end of its reach. */
export const hookEndsAt = (hook) => hook.at + HOOK_AIM_MS + HOOK_FLIGHT_MS;

/** How finely the room follows the tip (milliseconds): a piece walks under 3 units in that time. */
const STEP_MS = 5;

/**
 * The first piece the tip of `hook` meets between `from` and `to` (times), and when: {seat, t},
 * or null. `pieces` is [{seat, at(t)}]: where each piece is at t. A piece is met once the tip has
 * reached it (within HOOK_GRAB), never behind the robot; of two met at once, the nearer the robot.
 */
export function firstCatch(hook, pieces, from, to) {
  const start = Math.max(from, hook.at + HOOK_AIM_MS);
  const end = Math.min(to, hookEndsAt(hook));
  if (start > end) return null;
  for (let step = start; ; step += STEP_MS) {
    const t = Math.min(step, end);
    const tip = hookTipAt(hook, t);
    let best = null;
    for (const p of pieces) {
      const x = p.at(t);
      const ahead = (x - hook.x0) * hook.dir;
      if (ahead < -HOOK_BEHIND || (x - tip) * hook.dir > HOOK_GRAB) continue;
      if (!best || ahead < best.ahead) best = { seat: p.seat, ahead };
    }
    if (best) return { seat: best.seat, t };
    if (t >= end) return null;
  }
}

/** Whether a piece that jumped at `jumpAt` (the room's time) is in the air when a hook reaches it at `strikeAt`. */
export function jumpedOver(jumpAt, strikeAt) {
  const since = strikeAt - (jumpAt ?? -Infinity);
  return since >= -HOOK_LATE_MS && since <= DODGE_EARLY_MS;
}

/** Whether a pawn that kicked at `bumpAt` facing `face` bats away a hook from a robot at `robotX`, reaching it at `strikeAt` where it stands at `x`. */
export function battedAway(bumpAt, face, x, robotX, strikeAt) {
  const since = strikeAt - (bumpAt ?? -Infinity);
  return since >= -HOOK_LATE_MS && since <= PARRY_EARLY_MS && Math.sign(robotX - x) === face;
}

/**
 * Whether the room lets a robot hook now: {ok} or {ok: false, why, wait, cooling}. `room` says
 * what the room is doing: {hooks (its character's move is the hook), lobby (the pieces' own
 * time: not a game, its settings or the Table), up (on its stilts), hooking (its last hook is
 * still out)}. A hook is allowed during the count, as a kick is: it is the robot's kick.
 */
export function mayHook(piece, now, { hooks, lobby, up, hooking, slack }) {
  if (!hooks) return { ok: false, why: "Only a robot can hook." };
  if (!lobby) return { ok: false, why: "You can hook in the room, between games." };
  const down = Math.max(0, (piece.stunUntil ?? 0) - now);
  if (down > 0) return { ok: false, why: "Not while you are knocked over.", wait: down };
  if (up) return { ok: false, why: "Not while you are up on your legs.", wait: Math.max(0, piece.stiltsUntil - now) };
  if (hooking) return { ok: false, why: "Your hook is still out." };
  const cooling = hookLeft(piece.hookAt, now);
  if (cooling > slack) return { ok: false, why: "Your hook is not ready yet.", wait: cooling, cooling: true };
  return { ok: true };
}

// ---------------------------------------------------------------- stilt legs

/** How long the legs stay out, from the press: the squat (the tell) is the first STILT_SQUAT_MS. */
export const STILT_MS = 1150;
export const STILT_SQUAT_MS = 90;
/** The legs shake for this long before they drop, and drop in this long (both inside STILT_MS). */
export const STILT_WARN_MS = 300;
export const STILT_DROP_MS = 110;
/** A robot may go up again this long after it last went up. */
export const STILT_COOLDOWN_MS = 2500;
/** How high the legs carry the robot's base (world units): over a pawn's kick, and over a piece. */
export const STILT_RISE = 120;
/** How long the flash on landing lasts, which says it can be hit again. */
export const STILT_FLASH_MS = 420;

/** Milliseconds until a robot that last went up at `stiltAt` may go up again (0: ready). */
export function stiltLeft(stiltAt, now) {
  return Math.max(0, (stiltAt ?? -Infinity) + STILT_COOLDOWN_MS - now);
}

/** Whether a member of the room is up on its stilts at `now`. */
export const isUp = (piece, now) => now < (piece.stiltsUntil ?? 0);

/** Whether the room lets a robot go up on its legs now: {ok} or {ok: false, why, wait, cooling}. Allowed during the count: it changes nobody's vote. */
export function mayStilt(piece, now, { hooks, lobby, hooking, slack }) {
  if (!hooks) return { ok: false, why: "Only a robot has stilt legs." };
  if (!lobby) return { ok: false, why: "You can do that in the room, between games." };
  const down = Math.max(0, (piece.stunUntil ?? 0) - now);
  if (down > 0) return { ok: false, why: "Not while you are knocked over.", wait: down };
  if (hooking) return { ok: false, why: "Your hook is still out." };
  const cooling = stiltLeft(piece.stiltAt, now);
  if (cooling > slack) return { ok: false, why: "Your legs are not ready yet.", wait: cooling, cooling: true };
  return { ok: true };
}

const smooth = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;

/**
 * How far out the legs are `ms` after the press (0 down, 1 fully out; a little below 0 in the
 * squat), and how much they shake: {out, shake, state}. `left`: how much longer the room keeps them
 * up (for a page that arrives in the middle the two agree). `calm`: no shake.
 */
export function stiltPose(ms, calm = false) {
  if (!(ms >= 0) || ms >= STILT_MS + STILT_FLASH_MS) return { out: 0, shake: 0, flash: 0, state: "down" };
  if (ms < STILT_SQUAT_MS) return { out: -0.12 * Math.sin((ms / STILT_SQUAT_MS) * Math.PI * 0.5), shake: 0, flash: 0, state: "squat" };
  const dropAt = STILT_MS - STILT_DROP_MS;
  if (ms < dropAt) {
    // A quick rise with one small overshoot, then a steady hold.
    const u = Math.min(1, (ms - STILT_SQUAT_MS) / 150);
    const rise = u < 1 ? smooth(u) * 1.08 : 1 + 0.08 * Math.exp(-(ms - STILT_SQUAT_MS - 150) / 60) * Math.cos((ms - STILT_SQUAT_MS - 150) / 25);
    const warn = ms >= STILT_MS - STILT_WARN_MS && !calm;
    return { out: rise, shake: warn ? Math.sin(ms / 16) * 0.025 : 0, flash: 0, state: warn ? "warn" : "up" };
  }
  if (ms < STILT_MS) return { out: 1 - smooth((ms - dropAt) / STILT_DROP_MS), shake: 0, flash: 0, state: "drop" };
  // Down with a clank; the flash says it can be hit again.
  return { out: 0, shake: 0, flash: 1 - (ms - STILT_MS) / STILT_FLASH_MS, state: "landed" };
}

// ---------------------------------------------------------------- the hook, drawn
//
// Every page draws a thrown hook from the moment it hears of it ({at, dir} by its own clock) until
// the room's word on it (`verdict`: {at, o, hitX}) has played out. Until the word comes the tip flies
// at the room's speed and stops at the first piece this page sees in its way (`stop`), or at the
// end of its reach, and waits there.

/** The pull, eased the same way for the piece and for the tip that drags it. */
export const pullEase = (u) => 1 - (1 - u) ** 3;

/**
 * Where a thrown hook is drawn at `now`: {state, tip, y, aim, link} or null when it is put away.
 * `robotX`: where the robot is drawn; `stop`: how far out the first piece in its way is (world
 * units from the robot, or null). `tip` is a world x, `y` its height off the floor, `aim` how
 * bright the line of light on the floor is (0 to 1, during the wind-up), `link` how far the chain
 * is paid out (0 to 1). States: aim, fly, wait, pull, stuck, back.
 */
export function hookDrawn(h, now, robotX, stop = null) {
  const t = now - h.at;
  const hand = robotX + h.dir * HOOK_HAND * 0.5;
  const v = h.verdict;
  if (t < 0) return { state: "aim", tip: hand, y: HOOK_Y, aim: 0, link: 0 };
  if (!v && t < HOOK_AIM_MS) return { state: "aim", tip: hand, y: HOOK_Y, aim: 0.45 + 0.55 * Math.abs(Math.sin(t / 28)), link: 0 };
  const reach = Math.min(HOOK_RANGE, Math.max(0, ((t - HOOK_AIM_MS) * HOOK_SPEED) / 1000));
  const limit = v?.hitX !== undefined && v.hitX !== null ? Math.abs(v.hitX - robotX) - HOOK_HAND : stop ?? HOOK_RANGE;
  const flying = robotX + h.dir * (HOOK_HAND + Math.min(reach, Math.max(0, limit)));
  if (!v) {
    if (t > HOOK_AIM_MS + HOOK_FLIGHT_MS + HOOK_WAIT_MS) return null;
    return { state: reach >= limit || reach >= HOOK_RANGE ? "wait" : "fly", tip: flying, y: HOOK_Y, aim: 0, link: 1 };
  }
  const since = now - v.at;
  if (v.o === "pull") {
    if (since >= PULL_MS) return null;
    const from = v.hitX ?? flying;
    return { state: "pull", tip: mix(from, robotX + h.dir * (HOOK_HOLD - 14), pullEase(Math.max(0, since) / PULL_MS)), y: HOOK_Y, aim: 0, link: 1 };
  }
  if (v.o === "stuck") {
    // The robot is dragged to the slime along its own chain: the tip stays where it stuck.
    if (since >= PULL_MS) return null;
    return { state: "stuck", tip: v.hitX ?? flying, y: HOOK_Y, aim: 0, link: 1 };
  }
  // Everything else winds back in from where it was when the word came (a parried hook is knocked up as it goes).
  const at = v.from ?? flying;
  const u = Math.max(0, since) / HOOK_RETRACT_MS;
  if (u >= 1) return null;
  const up = v.o === "parry" ? Math.sin(u * Math.PI) * 46 : 0;
  return { state: "back", tip: mix(at, hand, smooth(u)), y: HOOK_Y + up, aim: 0, link: 1 - u };
}

// ---------------------------------------------------------------- what a hook does to a piece, as a pose
//
// In the same terms as a knock (shared/bump.js, knockPose) and a fright (shared/ghost.js): offsets
// and angles in world units and degrees, about the piece's foot. A pulled piece is dragged upright
// and never looks harmed: it leans back against the pull, its feet sliding, then rights itself.

/** A pulled piece: dragged from `from` to `to`, upright. */
export function pullPose(ms, from, to, safeFor, calm = false) {
  const towards = to < from ? -1 : 1;
  if (!(ms >= 0) || ms >= PULL_MS + safeFor) return { state: "up", x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0 };
  if (ms >= PULL_MS) return { state: "safe", x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0 };
  const u = ms / PULL_MS;
  const lean = Math.sin(Math.min(1, u * 1.3) * Math.PI) * (calm ? 6 : 14);
  // Leaning back against the pull (its top trails), stretched a little by the yank, a skid at the end.
  return { state: "pulled", x: mix(from, to, pullEase(u)), dx: 0, lift: calm ? 0 : Math.sin(u * Math.PI) * 6, tilt: -lean * towards, sx: 1 - 0.06 * Math.sin(u * Math.PI), sy: 1 + 0.08 * Math.sin(u * Math.PI), scared: 0, pale: 0, face: -towards };
}

/** The hook back: yanked to the middle, a bonk of heads, a wobble with its eyes squeezed shut, upright. */
export function bonkPose(ms, from, to, safeFor, calm = false) {
  const towards = to < from ? -1 : 1;
  if (!(ms >= 0) || ms >= BONK_MS + safeFor) return { state: "up", x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0, dizzy: false };
  if (ms >= BONK_MS) return { state: "safe", x: null, dx: 0, lift: 0, tilt: 0, sx: 1, sy: 1, scared: 0, pale: 0, face: 0, dizzy: false };
  const slide = 180;
  if (ms < slide) {
    const u = ms / slide;
    return { state: "pulled", x: mix(from, to, pullEase(u)), dx: 0, lift: 0, tilt: -10 * towards * Math.sin(u * Math.PI), sx: 1, sy: 1, scared: 0, pale: 0, face: towards, dizzy: false };
  }
  // The bonk: knocked back a little, then a wobble while it sees stars.
  const k = (ms - slide) / (BONK_MS - slide);
  const wobble = calm ? 0 : Math.sin(k * Math.PI * 5) * 7 * (1 - k);
  return { state: "bonked", x: to, dx: -towards * 6 * Math.sin(Math.min(1, k * 4) * Math.PI), lift: 0, tilt: wobble, sx: 1, sy: 1 - 0.05 * Math.sin(Math.min(1, k * 4) * Math.PI), scared: 0, pale: 0, face: towards, dizzy: true };
}

/** How a pull and a bonk are named for the drawings (shared/moves.js). */
export const PULL = { kind: "pull", ms: PULL_MS, pose: pullPose };
export const BONK = { kind: "bonk", ms: BONK_MS, pose: bonkPose };
