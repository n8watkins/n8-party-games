// The scripted players' brains, carried over from the preview (round five, tools/drivers.mjs). Each looks ahead
// on the track and decides which keys to hold, the way a person on a keyboard would: left, right, up, down,
// drift, and the power key. The tests race them against the house cars (test/races.test.js).
//   plain:    an ordinary player. Steers round what it sees, takes pads and sweets on its line, drifts the long
//             turns, uses its power when it makes sense, never the bridge.
//   sloppy:   a first-timer. Reacts late, wanders, over-holds a key now and then, never drifts, ignores pads,
//             sees obstacles late (and misses some), uses a power as soon as it has one.
//   handsoff: holds Up and nothing else, ever.
//   left, right: the plain player, but always through the left (or right) gap of every shaker.
//   clean:    the plain player, giving every spill a wide berth.
//   zigzag, zagzig: the plain player, weaving the shakers right-left-right, or left-right-left.
// Like the rules, a driver draws its chance from a seed and uses only exact maths, so a scripted race is the
// same race on every engine.
import { atan2, cos, sin, wrapA } from "../shared/dmath.js";
import { hash } from "../shared/course.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function makeDriver(style, seed = 1) {
  return { style, seed, steerKey: 0, drift: false, noise: 0, holdT: 0, holdDir: 0, rnd: 0, useT: 0, stillT: 0, backT: 0, usedLast: false };
}

/**
 * One decision, sixty times a second. rules: makeRules(...). c0: the car as the driver sees it ({x, z, h, v, u, lat,
 * s, air, item, itemT}, plus `lag` seconds and `yaw` when the picture is late); t: race seconds; others: the other
 * cars; state: the race, for what blocks the track.
 * Returns {left, right, up, down, drift, use}.
 */
export function decide(rules, m, c0, t, others = [], state = null) {
  const T = rules.T, { trackAt, wrapS, halfAt, SHAKERS, blockers, clearLane, clearAhead, LEN } = rules.course;
  if (m.style === "handsoff") return { left: false, right: false, up: true, down: false, drift: false, use: false };
  const sloppy = m.style === "sloppy", forced = m.style === "left" ? -1 : m.style === "right" ? 1 : 0, clean = m.style === "clean";
  const tp = {}, BL = [];
  // A person sees the picture a little late but expects where the car is going: the seen state (c0) is carried
  // forward over part of the lag (c0.lag seconds) along its heading and turn rate (c0.yaw).
  let c = c0;
  if (c0.lag) {
    const L = c0.lag * (sloppy ? 0.4 : 0.75), h = c0.h + (c0.yaw || 0) * L * 0.5;
    c = { ...c0, x: c0.x + cos(h) * c0.v * L, z: c0.z + sin(h) * c0.v * L, h: c0.h + (c0.yaw || 0) * L, u: c0.u + c0.v * L };
  }
  const u = c.u, look = (sloppy ? 2.2 : 2.6) + Math.max(0, c.v) * (sloppy ? 0.26 : 0.32), lu = u + look;
  const ahead = trackAt(lu, 0, tp);
  // A wandering line: a slow random walk across the track (a plain driver wanders a little, a first-timer a lot).
  m.rnd++;
  const amp = sloppy ? 1.4 : 0.45;
  m.noise += (hash(m.seed, m.rnd) - 0.5) * (sloppy ? 0.12 : 0.08); m.noise *= 0.995; m.noise = clamp(m.noise, -amp, amp);
  let lane = (sloppy ? 0 : 0.2) + m.noise;
  if (ahead.turn) lane = (sloppy ? 0.6 : 1.3) * Math.sign(ahead.k) + (sloppy ? m.noise * 0.5 : 0);
  if (!sloppy) for (const p of T.PADS) { const d = wrapS(p.u - u); if (d > 1 && d < 15) lane = p.lat; }
  // A forced side: through that gap of every shaker, whatever is in it.
  if (forced) for (const s of SHAKERS) { const d = wrapS(s.u - u); if (d > -1.5 && d < 4 + Math.max(0, c.v) * 0.9) lane = forced * (s.r + 1.85); }
  // "zigzag" takes the shakers right, left, right; "zagzig" left, right, left.
  const zz = m.style === "zigzag" ? 1 : m.style === "zagzig" ? -1 : 0;
  if (zz) SHAKERS.forEach((s, k) => { const d = wrapS(s.u - u); if (d > -1.5 && d < 4 + Math.max(0, c.v) * 0.9) lane = zz * (k % 2 ? -1 : 1) * (s.r + 1.85); });
  // Sweets: an ordinary player with nothing in hand lines up with the nearest one.
  if (!sloppy && !c.item) for (const b of T.BOXES) { const d = wrapS(b.u - u); if (d > 1 && d < 12) { let best = b.lats[0]; for (const l of b.lats) if (Math.abs(l - lane) < Math.abs(best - lane)) best = l; lane = best; } }
  if (u > T.EDGE.u0 - 4 && u < T.EDGE.u1 + 2) lane = Math.max(lane, sloppy ? -1.6 : -0.8);
  // What stands in the way: a first-timer sees it later, and now and then not at all (this lap).
  const span = Math.max(T.HALF, halfAt(lu)) - 0.7;
  const list = blockers(state, BL).filter((b) => (!sloppy || hash(m.seed * 13 + Math.floor((c.s || 0) / LEN), Math.round(b[0] * 10)) > 0.15) && !((forced || zz) && b[3] === "spill"));
  // The clean driver gives every spill (and the syrup) a wide berth: a spill's band grows by 0.8 each side and is seen further off.
  if (clean) for (const b of list) if (b[3] === "spill" || b[3] === "syrup" || b[3] === "butter") { b[1] -= 0.8; b[2] += 0.8; b[4] += 4; }
  lane = clearLane(list, u, lane, sloppy ? 1.2 + Math.max(0, c.v) * 0.45 : 1.5 + Math.max(0, c.v) * 0.8, span, sloppy ? 0.4 : 0.7);
  const spillNear = clean && list.some((b) => (b[3] === "spill" || b[3] === "syrup") && wrapS(b[0] - u) > -3 && wrapS(b[0] - u) < 32);
  // Round a slower car just ahead (a first-timer only notices late, and not always).
  if (!sloppy || hash(m.seed, Math.floor(t)) < 0.5) for (const o of others) {
    const d = wrapS(o.u - u);
    if (d > 0.3 && d < (sloppy ? 1.8 : 2.8) && Math.abs(o.lat - lane) < 0.95 && o.v < c.v + 0.3) lane = o.lat + (o.lat > 0 ? -1.15 : 1.15);
  }
  if (Math.abs(wrapS(lu - T.TUNNEL.u)) < T.TUNNEL.len / 2 + T.TUNNEL.funnel + 3) lane = clamp(lane, -0.7, 0.7);
  lane = clamp(lane, -span, span);
  trackAt(u + Math.min(look, (sloppy ? 2.4 : 2.2) + Math.max(0, c.v) * 0.2), lane, tp);
  const err = wrapA(atan2(tp.z - c.z, tp.x - c.x) - c.h);
  // Keys with a dead band (hysteresis), as a person taps and holds.
  const on = sloppy ? 0.12 : 0.05, off = sloppy ? 0.05 : 0.02;
  let dir = m.steerKey;
  if (dir === 0) { if (err > on) dir = 1; else if (err < -on) dir = -1; }
  else if (err * dir < off) dir = 0;
  // A first-timer now and then holds a key too long.
  if (sloppy) {
    if (m.holdT > 0) { m.holdT -= 1 / 60; dir = m.holdDir; }
    else if (dir !== 0 && hash(m.seed * 7 + 3, m.rnd) < 0.004) { m.holdT = 0.45; m.holdDir = dir; }
  }
  m.steerKey = dir;
  // Stopped against something: a person backs off with the wheel turned the other way.
  m.stillT = Math.abs(c.v) < 0.8 && t > 1 ? m.stillT + 1 / 60 : 0;
  if (m.stillT > 0.8 || m.backT > 0) {
    if (!(m.backT > 0)) m.backT = 0.7;
    m.backT -= 1 / 60;
    return { left: err > 0, right: err < 0, up: false, down: true, drift: false, use: false };
  }
  // Drift through the long turns (the bank and the two corners at the far end), let go on the way out.
  let drift = false;
  if (!sloppy) {
    const here = trackAt(u + 1.5, 0, {});
    const inTurn = here.turn && Math.sign(here.k) > 0;
    if (inTurn && c.v > T.DRIFT_MIN + 0.5 && (m.drift || dir === 1) && !spillNear) drift = true;
    // During a drift, lean on the key to hold the line: more into the turn when wide, less when tight.
    if (m.drift && drift) dir = err > -0.02 ? 1 : 0;
  }
  m.drift = drift;
  // The power key: a press, then let go. A first-timer presses as soon as it can; a plain player waits for a good moment.
  let use = false;
  if (c.item && !(c.itemT > 0)) {
    m.useT += 1 / 60;
    if (sloppy) use = m.useT > 0.4;
    else {
      const s = c.s || 0;
      const ah = others.some((o) => o.s - s > 0.8 && o.s - s < 26), bh = others.some((o) => s - o.s > 0.8 && s - o.s < 9);
      const straight = !trackAt(u + 6, 0, {}).turn;
      use = (m.useT > 6 && !(clean && c.item === "overwind")) || (c.item === "overwind" && straight && clearAhead(state, u, 22) && !spillNear) || (c.item === "butter" && bh) || (c.item === "pepper" && ah);
    }
    if (use) { if (m.usedLast) use = false; m.usedLast = !m.usedLast; } // a press is one frame down, the next up
  } else { m.useT = 0; m.usedLast = false; }
  return { left: dir < 0, right: dir > 0, up: true, down: false, drift, use };
}

/**
 * A person at the keys of one car, sixty frames a second: sees the picture a little late (a plain driver about
 * 0.1 s, a first-timer about 0.22 s), decides, and gives the message a page would send. `touch` drives the thumb
 * pad instead (a slide of 40 px on the 48 px ring: 0.81 of full steer).
 */
export function makePlayer(rules, style, seed, { touch = false, lag = style === "sloppy" ? 13 : 6 } = {}) {
  const m = makeDriver(style, seed), hist = [];
  return {
    style,
    /** The message for this frame: {c: [at, steer, go, brake, drift, use]}. `at` is the stamp to put on it. */
    frame(state, c, at) {
      hist.push({ x: c.x, z: c.z, h: c.h, v: c.v, u: c.u, lat: c.lat, s: c.s, air: c.air, item: c.item, itemT: c.itemT });
      const i = Math.max(1, hist.length - 1 - lag), seen = { ...hist[Math.min(i, hist.length - 1)] };
      seen.yaw = hist.length > 1 ? wrapA(hist[Math.min(i, hist.length - 1)].h - hist[i - 1].h) * 60 : 0; seen.lag = lag / 60;
      if (hist.length > 40) hist.shift();
      const k = decide(rules, m, { ...seen, v: c.v, item: c.item, itemT: c.itemT, s: c.s }, state.t, state.cars.filter((o) => o !== c), state);
      const steer = ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * (touch ? 0.81 : 1);
      return { c: [at, steer, touch ? (k.down ? 0 : 1) : k.up ? 1 : 0, k.down ? 1 : 0, k.drift ? 1 : 0, k.use ? 1 : 0] };
    },
  };
}
