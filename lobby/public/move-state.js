// What both drawings keep about the robot's and the slime's moves on each piece, from what the
// room says (lobby/shared/robot.js, slime.js): a thrown hook and the room's word on it, the legs,
// the harden and the absorb. The flat look (scene.js) and the 3D looks (look3d/room3d.js, and the
// baked and made-real looks through it) keep the same records on their pieces and draw them their
// own way; nothing here draws.
//
//   p.hook   {at, dir, verdict}   verdict: {at, o, hitX, from} once the room has judged it
//   p.stilt  {at}                 when its legs went up (by this page's clock)
//   p.goo    {at, turnAt, hardFor, softFor}   the slime's press, and when (if) it turned soft
import { HARDEN_MS, slimeLook } from "./shared/slime.js";
import { HOOK_HAND, STILT_MS, hookDrawn, stiltPose } from "./shared/robot.js";
import { CHARGE_HOLD_MS, CHARGE_MIN_MS, IMPACT_MS, attackPose, chargeDash, chargePose } from "./shared/bump.js";
import { posAt } from "./shared/world.js";

// ---------------------------------------------------------------- which way a piece faces
//
// A piece is drawn facing the way it last walked, or the way its page said it turned (`f` on a
// move, a kick, a charge or a hook). A drawing made in the middle of a party (a reload, a late
// join, a change of look) has heard none of that: the whole room says it (LobbyCore.view).

/** Which way the whole room has member `m` facing: left only when it says so (`f: -1`). */
export const facingOf = (m) => (m?.f === -1 ? -1 : 1);

/**
 * The page heard which way a piece faces now (`f`: -1 or 1; anything else is no word on it). Kept
 * on its member of the last whole room, as the room itself would say it, so a drawing built from
 * that room later (a change of look, a wall that moved) faces the piece as it is now.
 */
export function keepFacing(m, f) {
  if (!m || (f !== 1 && f !== -1)) return;
  if (f === -1) m.f = -1;
  else delete m.f;
}

// ---------------------------------------------------------------- the pawn's kick, and its charge
//
//   p.attack {at, dir, landed}             a kick from `at` (its press, or the room's word)
//            {at, dir, charging: true}      the move button held: a charge, from its press at `at`
//            {at, dir, landed, lunge}       a charge let go at `at`: it dashes from lunge.from to
//                                           lunge.to (where the room put it), then kicks

/**
 * Where to draw a piece the room moved (a knock or a fright, `rec` {to, landed}) once its move is
 * over (`state` "safe" or "up"): where the room put it, on the first such frame only (after that it
 * is wherever it walks); null otherwise. A page that draws few frames would otherwise leave it
 * where its last frame of the move had it and ease it over from there.
 *
 * (#86 also asked `now >= rec.at` before drawing an "up" piece at its landing. It is not needed:
 * every knock's and fright's `at` is at or before the moment its message arrived, so no frame
 * judges one before it began, though movedPose would call a negative time "up".)
 */
export function landing(rec, state) {
  if ((state !== "safe" && state !== "up") || rec.landed) return null;
  rec.landed = true;
  return rec.to;
}

/** A piece's place as the room last said it, for posAt (shared/world.js): at `x` now, walking `d`, and for a floaty one still easing, going at `v`. */
export const netOf = (x, d, now, v) => (v === undefined || v === null ? { x, d, t: now } : { x, d, t: now, v, vt: now });

/** How a piece's kick has it now, either look (shared/bump.js: attackPose, chargePose), or null; the record goes once it is over. */
export function attackDrawn(p, now, calm) {
  const a = p.attack;
  if (!a) return null;
  if (a.charging) {
    // A charge whose release this page never heard (a dropped phone): put away after the longest hold.
    if (now - a.at > CHARGE_HOLD_MS + 1500) {
      p.attack = null;
      return null;
    }
    return chargePose(now - a.at, a.dir, calm);
  }
  const pose = attackPose(now - a.at, a.dir, a.landed, a.lunge ?? null);
  if (pose.state === "idle") {
    p.attack = null;
    // A charged kick's dash that no frame drew the end of (a page starved of frames): the first
    // frame after it puts the piece where the dash took it, as landing() does for a knock, rather
    // than easing it over from where the last frame had it.
    return a.lunge ? { ...pose, x: a.lunge.to } : null;
  }
  return pose;
}

/** The viewer's own pawn holds its kick past CHARGE_MIN_MS: the wind-up it began at the press goes on as a charge. */
export function startCharge(p, now) {
  const pressed = p.attack && !p.attack.lunge && !p.attack.charging && now - p.attack.at < CHARGE_MIN_MS + 400 ? p.attack.at : now - CHARGE_MIN_MS;
  p.attack = { at: pressed, dir: p.face || 1, landed: false, charging: true };
}

/** A pawn's charge let go at `now`, of `power`: it dashes toward `to` (the room's word; until then, as far as the charge carries). */
export function startRelease(p, power, now, to = null) {
  const dir = p.attack?.dir ?? p.face ?? 1;
  p.attack = { at: now, dir, landed: false, lunge: { from: p.rx, to: to ?? p.rx + dir * chargeDash(power), power } };
}

/** A pawn began to charge its kick ({t: "kc", s, f, x}): it stands where the room stopped it, wound up. `own`: the viewer's seat. */
export function heardCharge(pieces, own, msg, now) {
  const p = pieces.get(msg.s);
  if (!p) return;
  p.face = msg.f || p.face;
  if (msg.s === own) {
    // Its own page began the charge at the hold. A quick release can beat the room's word of it
    // here: the dash it began is then left alone, not wound back into a charge and dashed again.
    if (!p.attack?.charging && !p.attack?.lunge) startCharge(p, now);
    return;
  }
  p.net = { x: msg.x, d: 0, t: now };
  p.attack = { at: now - CHARGE_MIN_MS, dir: p.face || 1, landed: false, charging: true };
}

/**
 * A charged kick, as the room judged it ({t: "b", s, f, c, kx}): the kicker dashes to `kx`. The
 * viewer's own began its dash at the release (startRelease) and is told where it ends; anyone
 * else's dashes from where it is drawn. Returns when the kick began, for whoever it hits.
 */
export function heardChargedKick(p, msg, now, own) {
  p.face = msg.f || p.face;
  const to = Number.isFinite(msg.kx) ? msg.kx : p.rx;
  // The viewer's own dash began at its release (startRelease), however late the room's answer comes:
  // it is told where it ends, and never drawn a second time.
  if (own && p.attack?.lunge) {
    p.attack.lunge.to = to;
    p.attack.lunge.power = msg.c;
    p.attack.landed = msg.to >= 0;
    return p.attack.at;
  }
  // From where the room had it as it charged (it stood still), not where a page starved of frames
  // last drew it: such a page would otherwise draw the dash from somewhere it never was. The
  // viewer's own piece (its drawn dash already over) goes on from where it is drawn: its `net` is
  // only the room's last snapshot, which can be from before it walked anywhere.
  const from = own ? p.rx : p.net ? Math.round(posAt(p.net, now, p.kind?.id)) : p.rx;
  p.attack = { at: now, dir: msg.f || p.face || 1, landed: msg.to >= 0, lunge: { from, to, power: msg.c } };
  p.net = { x: to, d: 0, t: now };
  if (Number.isFinite(msg.kr)) p.rev = msg.kr;
  return now;
}

/** A robot threw its hook (`msg` {s, f}): drawn from now, unless this page already began it at the press. */
export function startHook(p, dir, now) {
  if (p.hook && !p.hook.verdict && now - p.hook.at < 400) {
    p.hook.dir = dir || p.hook.dir;
    return;
  }
  p.hook = { at: now, dir: dir || p.face || 1, verdict: null };
}

/**
 * The room's word on a hook (`hk` {s, o, to, hx, x}): what the robot's drawn hook does now. `tip`
 * is where this page has the tip at that moment, so a hook winding back starts from where it is.
 */
export function judgeHook(p, msg, now, tip) {
  if (!p.hook) p.hook = { at: now - 400, dir: p.face || 1, verdict: null };
  // A hook that a jump cleared flies on: no word yet on where it ends.
  if (msg.o === "jumped") return;
  const hitX = Number.isFinite(msg.hx) ? msg.hx : null;
  p.hook.verdict = { at: now, o: msg.o, hitX, from: tip ?? hitX };
}

/** Where a piece's hook is drawn now (shared/robot.js, hookDrawn), or null; the record goes once it is put away. */
export function hookNow(p, now, robotX, stop) {
  if (!p.hook) return null;
  const drawn = hookDrawn(p.hook, now, robotX, stop);
  if (!drawn) p.hook = null;
  return drawn;
}

/** How far out the first piece in a hook's way is, from the robot at `x` facing `dir`, among `others` ([x]): for a hook still waiting for the room's word. */
export function hookStop(x, dir, others) {
  let best = null;
  for (const ox of others) {
    const ahead = (ox - x) * dir;
    if (ahead < HOOK_HAND - 20) continue;
    const out = ahead - HOOK_HAND - 18;
    if (best === null || out < best) best = Math.max(0, out);
  }
  return best;
}

/** A robot's legs went up `since` milliseconds before `now`. */
export function startStilts(p, now, since = 0) {
  p.stilt = { at: now - since };
}

/** How far out a robot's legs are now (shared/robot.js, stiltPose), or null when they are down and the flash is over. */
export function stiltsNow(p, now, calm) {
  if (!p.stilt) return null;
  const pose = stiltPose(now - p.stilt.at, calm);
  if (pose.state === "down") p.stilt = null;
  return pose;
}

/** The legs are down at once (knocked, hooked, or the room says they are). */
export function dropStilts(p, now) {
  if (p.stilt && now - p.stilt.at < STILT_MS) p.stilt = { at: now - STILT_MS };
}

/** A slime pressed (`kind` "harden") or held (`kind` "absorb"): its look from now. `left`: for a page that arrives in the middle, how long the room keeps it so. */
export function startGoo(p, kind, now, left = null) {
  if (kind === "harden") {
    p.goo = { at: left === null ? now : now - (HARDEN_MS - left), turnAt: null, hardFor: HARDEN_MS, softFor: 0 };
    return;
  }
  const softFor = left ?? 1000;
  // Turned soft: the harden ends there.
  if (!p.goo || p.goo.turnAt !== null) p.goo = { at: now, turnAt: 0, hardFor: 0, softFor };
  else {
    p.goo.turnAt = now - p.goo.at;
    p.goo.softFor = softFor;
  }
}

/** The room said the slime is neither hard nor soft (a refusal, a change of character): it melts back. */
export function endGoo(p, now) {
  if (!p.goo) return;
  const ms = now - p.goo.at;
  if (p.goo.turnAt === null) p.goo.hardFor = Math.min(p.goo.hardFor, ms);
  else p.goo.softFor = Math.min(p.goo.softFor, ms - p.goo.turnAt);
}

/** How hard and how soft a slime is drawn now: {hard, soft, ms} (0 to 1 each), or null. */
export function gooNow(p, now) {
  if (!p.goo) return null;
  const ms = now - p.goo.at;
  const look = slimeLook(ms, p.goo.hardFor, p.goo.turnAt, p.goo.softFor);
  if (look.hard === 0 && look.soft === 0 && ms > 100) {
    p.goo = null;
    return null;
  }
  return { ...look, ms };
}

// ---------------------------------------------------------------- what the room says, for either drawing
//
// Both drawings hand these their pieces (seat -> piece, each with rx, face, net, rev) and a way to
// start a piece's slide or fright (`fright(p, x, at, kind)`, the look's own: bump-draw.js or
// look3d/pieces.js) and a spark (`spark(x, y, now)`, world units).

/** A robot threw its hook ({t: "hook", s, f, x}): it stands where the room stopped it, and the hook flies. `own`: the viewer's seat. */
export function heardHook(pieces, own, msg, now) {
  const p = pieces.get(msg.s);
  if (!p) return;
  p.face = msg.f || p.face;
  if (msg.s !== own) p.net = { x: msg.x, d: 0, t: now };
  startHook(p, msg.f, now);
}

/**
 * What came of a hook ({t: "hk", s, o, to, hx, x, rev, ox, orev, tr}): the piece it caught is
 * dragged to the robot (and a hook train's catch behind it), or the robot to an absorbing slime,
 * or both robots bonk, or the robot is scared off a faded ghost; anything else winds it back, with
 * a spark where it clangs off or is batted away.
 */
export function heardVerdict(pieces, msg, now, { fright, spark }) {
  const r = pieces.get(msg.s);
  if (r) judgeHook(r, msg, now, r.hook ? hookDrawn(r.hook, now, r.rx, null)?.tip : null);
  const hit = pieces.get(msg.to);
  const slide = (p, x, rev, kind) => {
    if (!p || !Number.isFinite(x)) return;
    p.net = { x, d: 0, t: now };
    p.rev = rev;
    dropStilts(p, now);
    fright(p, x, now, kind);
  };
  if (msg.o === "pull") {
    slide(hit, msg.x, msg.rev, "pull");
    if (msg.tr) slide(pieces.get(msg.tr.s), msg.tr.x, msg.tr.rev, "pull");
    // Stolen off another robot's chain (shared/robot.js, steal): that robot's hook snaps back empty.
    const robbed = Number.isInteger(msg.st) ? pieces.get(msg.st) : null;
    if (robbed?.hook) judgeHook(robbed, { o: "off" }, now, hookDrawn(robbed.hook, now, robbed.rx, null)?.tip);
  } else if (msg.o === "stuck" || msg.o === "plant") slide(r, msg.x, msg.rev, "pull");
  else if (msg.o === "tug") {
    // Two hooks at once (shared/robot.js, tug): held where it is, stretched between them. Each
    // robot's word says it, and the first is enough: the second is known by the room's own count of
    // the piece's moves (`rev`, the same in both), not by what is drawn, which a page that draws no
    // frames (a hidden tab) never clears, so that a later tug would be passed over.
    if (hit && !(hit.fright?.kind === "tug" && hit.rev === msg.rev)) slide(hit, msg.x, msg.rev, "tug");
  } else if (msg.o === "scare") {
    slide(r, msg.x, msg.rev, "hookscare");
    if (hit) hit.booAt = now;
  } else if (msg.o === "bonk") {
    slide(r, msg.x, msg.rev, "bonk");
    slide(hit, msg.ox, msg.orev, "bonk");
    if (hit?.hook && !hit.hook.verdict) judgeHook(hit, { o: "off" }, now, hookDrawn(hit.hook, now, hit.rx, null)?.tip);
  } else if ((msg.o === "clang" || msg.o === "parry") && hit) spark(hit.rx - (r?.hook?.dir ?? r?.face ?? 1) * 30, 44, now);
}

// ---------------------------------------------------------------- the hook's counters (shared/robot.js)
//
// Each look hands these its pieces and its own way to start a fright, a knock and a spark
// ({fright(p, x, at, kind), knock(p, x, at), spark(x, h, now)}).

/** A robot's hook snaps back from wherever it is drawn (its catch was cut free, stolen, or slipped). */
function snapBack(r, now) {
  if (r?.hook) judgeHook(r, { o: "off" }, now, hookDrawn(r.hook, now, r.rx, null)?.tip);
}

/** A pawn's kick cut a chain ({t: "b", s, cut, by, x, rev}): the piece on it is set down where it was, and the chain snaps back. */
export function heardCut(pieces, msg, now, { fright, spark }) {
  const p = pieces.get(msg.cut);
  const r = pieces.get(msg.by);
  snapBack(r, now);
  if (!p || !Number.isFinite(msg.x)) return;
  spark((p.rx + (r?.rx ?? p.rx)) / 2, 44, now);
  p.net = { x: msg.x, d: 0, t: now };
  p.rev = msg.rev;
  fright(p, msg.x, now, "freed");
}

/** A slime in the air on a robot's chain hardened ({t: "slime", ct: "cannon", to, x, rev}): it bowls the robot over. */
export function heardCannon(pieces, msg, now, { knock, spark }) {
  const r = pieces.get(msg.to);
  const slime = pieces.get(msg.s);
  if (!r || !Number.isFinite(msg.x)) return;
  spark(r.rx, 70, now);
  snapBack(r, now);
  r.net = { x: msg.x, d: 0, t: now };
  r.rev = msg.rev;
  dropStilts(r, now);
  // The blow lands at once, as the slime meets it: the knock's story from its impact (shared/bump.js).
  knock(r, msg.x, now - IMPACT_MS);
  if (slime) slime.face = Math.sign(r.rx - slime.rx) || slime.face;
}

/** A ghost in the air on a robot's chain faded ({t: "fade", ct: "empty", gx, grev, to, x, rev}): it slips the hook where it is, and the robot is spooked. */
export function heardEmpty(pieces, msg, now, { fright }) {
  const g = pieces.get(msg.s);
  const r = Number.isInteger(msg.to) ? pieces.get(msg.to) : null;
  if (g && Number.isFinite(msg.gx)) {
    g.net = { x: msg.gx, d: 0, t: now };
    g.rev = msg.grev;
    fright(g, msg.gx, now, "freed");
    g.booAt = now;
  }
  if (r && Number.isFinite(msg.x)) {
    snapBack(r, now);
    r.net = { x: msg.x, d: 0, t: now };
    r.rev = msg.rev;
    fright(r, msg.x, now, "spook");
  }
}

// ---------------------------------------------------------------- the touch counters (shared/counters.js)

/**
 * What a kick set going besides itself ({t: "b", dm, cv, cu}), from `began` (when the kick began
 * on this page): a piece the knocked one flew into (`dm`, dominoes) and one a curling stone reached
 * (`cv`) are knocked over as it reaches them (`at` ms from the kick); the stone itself (`cu`)
 * slides off as the kick lands.
 */
export function heardKickCounters(pieces, msg, began, { fright, knock }) {
  for (const hit of [msg.dm, msg.cv]) {
    const p = hit ? pieces.get(hit.to) : null;
    if (!p || !Number.isFinite(hit.x)) continue;
    p.net = { x: hit.x, d: 0, t: began };
    p.rev = hit.rev;
    dropStilts(p, began);
    knock(p, hit.x, began + hit.at - IMPACT_MS);
  }
  const stone = msg.cu ? pieces.get(msg.cu.s) : null;
  if (stone && Number.isFinite(msg.cu.x)) {
    stone.net = { x: msg.cu.x, d: 0, t: began };
    stone.rev = msg.cu.rev;
    fright(stone, msg.cu.x, began + IMPACT_MS, "curl");
  }
}

/**
 * The slimes met ({t: "goo", k, s, to, x, rev, ox, orev}): the soft one (`s`) swallowed the
 * hardened one (`to`) and spat it out at `x` ("swallow"), or the two stuck together and came apart
 * at `x` and `ox` ("stick"); or two faded ghosts met ({t: "pop", s, to, x, rev, ox, orev}) and
 * popped solid where they were.
 */
export function heardTouch(pieces, msg, now, { fright }) {
  const a = pieces.get(msg.s);
  const b = pieces.get(msg.to);
  const move = (p, x, rev, kind) => {
    if (!p || !Number.isFinite(x)) return;
    p.net = { x, d: 0, t: now };
    p.rev = rev;
    fright(p, x, now, kind);
  };
  if (msg.t === "pop") {
    for (const g of [a, b]) if (g) g.fadeUntil = 0;
    move(a, msg.x, msg.rev, "pop");
    move(b, msg.ox, msg.orev, "pop");
    return;
  }
  if (msg.k === "swallow") {
    if (a) endGoo(a, now);
    if (b) endGoo(b, now);
    move(b, msg.x, msg.rev, "swallowed");
  } else if (msg.k === "stick") {
    for (const p of [a, b]) if (p) endGoo(p, now);
    move(a, msg.x, msg.rev, "stick");
    move(b, msg.ox, msg.orev, "stick");
  }
}

/** A robot's legs went up ({t: "stilts", s}): drawn from now, unless this page began them at the press. */
export function heardStilts(pieces, msg, now) {
  const p = pieces.get(msg.s);
  if (p && !(p.stilt && now - p.stilt.at < 400)) startStilts(p, now);
}

/** A slime hardened or went soft ({t: "slime", s, k}), unless this page began it at the press. */
export function heardSlime(pieces, msg, now) {
  const p = pieces.get(msg.s);
  if (!p) return;
  if (msg.k === "harden" && p.goo && p.goo.turnAt === null && now - p.goo.at < 400) return;
  if (msg.k === "absorb" && p.goo && p.goo.turnAt !== null && now - p.goo.at - p.goo.turnAt < 400) return;
  startGoo(p, msg.k === "absorb" ? "absorb" : "harden", now);
}

/** A walking slime shoved a piece a step on ({t: "shove", s, to, x, rev}). */
export function heardShove(pieces, msg, now, { fright }) {
  const p = pieces.get(msg.to);
  if (!p) return;
  p.net = { x: msg.x, d: 0, t: now };
  p.rev = msg.rev;
  fright(p, msg.x, now, "shove");
}

/** The room turned down the viewer's own move ("hook", "stilts", "slime", "charge"): what this page began at once is taken back. */
export function refusedOwn(p, what, now) {
  if (!p) return;
  if (what === "hook" && p.hook && !p.hook.verdict) judgeHook(p, { o: "off" }, now, null);
  if (what === "stilts") dropStilts(p, now);
  if (what === "slime") endGoo(p, now);
  if (what === "charge" && p.attack?.charging) p.attack = null;
  // A refused kick (a ride the room heard too late, a press while it still cooled): not drawn on.
  if (what === "kick" && p.attack && !p.attack.charging) p.attack = null;
  // A refused absorb: the turn this page drew is taken back, and the harden runs on.
  if (what === "absorb" && p.goo && p.goo.turnAt !== null) {
    p.goo.turnAt = null;
    p.goo.softFor = 0;
  }
}

/**
 * The room view's word on a piece's moves (LobbyCore.bumpView), for a page that arrives in the
 * middle or missed a message: a hook out, legs up, a harden or an absorb. `own`: the viewer's own
 * piece, whose moves this page began itself (left alone when it has them already).
 */
export function resumeMoves(p, m, now, own = false) {
  if (m.hook && !p.hook) p.hook = { at: now - m.hook.in, dir: m.hook.f, verdict: null };
  else if (!m.hook && p.hook && !p.hook.verdict && now - p.hook.at > 500 && !own) p.hook.verdict = { at: now, o: "off", hitX: null, from: null };
  if (m.stilts !== undefined && !p.stilt) startStilts(p, now, m.stilts);
  else if (m.stilts === undefined && !own) dropStilts(p, now);
  if (m.hard > 0 && !p.goo) startGoo(p, "harden", now, m.hard);
  else if (m.soft > 0 && !(p.goo && p.goo.turnAt !== null)) startGoo(p, "absorb", now, m.soft);
  else if (!(m.hard > 0) && !(m.soft > 0) && p.goo && !own && now - p.goo.at > 300) endGoo(p, now);
  // A pawn charging its kick (`charge`: how long since the press), or no longer.
  if (m.charge !== undefined && !own && !p.attack?.charging) p.attack = { at: now - m.charge, dir: p.face || 1, landed: false, charging: true };
  else if (m.charge === undefined && !own && p.attack?.charging) p.attack = null;
}
