// Tin Derby: the house cars' driver. It reads the race and decides what a phone would send: a steer and
// the buttons. The rules call it for the house cars, for a seat whose phone has dropped (until it comes
// back) and for a finished car's lap of honour. It keeps nothing of its own and draws its chance from the
// race's seed, so the same race always gets the same house cars, in the room and on every page.
import * as dmath from "./dmath.js";
import { clamp, hash } from "./course.js";

/** The buttons, as bits of one number (what the rules keep and the room relays). */
export const BTN = { GO: 1, BRAKE: 2, DRIFT: 4, USE: 8 };

export function makeHouse(T, course, M = dmath) {
  const { atan2, wrapA } = M;
  const { LEN, wrapS, trackAt, halfAt, SHAKERS, blockers, clearAhead, clearLane } = course;
  const TN = T.TUNNEL;
  const tmpA = {}, tmpB = {}, BL = [];

  /** The nearest car ahead of c (by distance raced) within `range`, or null. */
  function carAhead(state, c, range) {
    let best = null, bd = range;
    for (const o of state.cars) {
      if (o === c || o.fallT > 0 || (o.fin && !state.endless)) continue;
      const d = o.s - c.s;
      if (d > 0.6 && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Whether a house car uses its power now: sparingly, after a seeded wait, and only when it makes sense. */
  function houseUse(state, c) {
    if (!c.item || c.itemT > 0 || c.itemWait > 0 || state.t < 0 || c.fin) return false;
    const late = c.itemWait < -7; // held a long time: use it anyway
    const ahead = carAhead(state, c, 26);
    let behind = null;
    for (const o of state.cars) if (o !== c && c.s - o.s > 0.8 && c.s - o.s < 9) behind = o;
    const straight = !trackAt(c.u + 6, 0, tmpA).turn && !c.air;
    switch (c.item) {
      case "overwind": return (straight && clearAhead(state, c.u, 22)) || late;
      case "butter": return !!behind || late;
      case "pepper": return (!!ahead && ahead.s - c.s > 3) || late;
    }
    return false;
  }

  /** What this car's driver holds now. Fills and returns `out`: {st: steer -1 to 1, b: the buttons}. */
  function drive(state, c, out = {}) {
    const h = T.HABITS[c.habit] || T.HABITS.ace;
    const u = c.u, look = 2.6 + Math.max(0, c.v) * 0.32, lu = u + look;
    const span = T.HALF - 0.7;
    const ph = hash(state.seed, c.i) * 6.283, lapN = Math.max(0, Math.floor(c.s / LEN));
    let lane = h.lane + M.sin(state.t * 0.37 + ph) * h.wander;
    const ahead = trackAt(lu, 0, tmpA);
    if (ahead.turn) lane = 1.2 * Math.sign(ahead.k) + M.sin(state.t * 0.5 + ph) * h.wander * 0.5; // the inside of a turn
    // Pads: steer over one ahead; now and then it misses one.
    for (let k = 0; k < T.PADS.length; k++) {
      const p = T.PADS[k], d = wrapS(p.u - u);
      if (d > 1 && d < 16 && hash(state.seed ^ (c.i * 977), lapN * 8 + k) < h.pads) lane = p.lat;
    }
    // Sweets: with nothing in hand it lines up with the nearest one ahead.
    if (!c.item) for (const b of T.BOXES) {
      const d = wrapS(b.u - u);
      if (d > 1 && d < 12) { let best = b.lats[0]; for (const l of b.lats) if (Math.abs(l - lane) < Math.abs(best - lane)) best = l; lane = best; }
    }
    const B = T.BRIDGE, bridge = h.bridge && u > B.u0 - 12 && u < B.u1;
    if (bridge) lane = B.lat; // line up well before the ramp, then hold the middle of the butter knives
    else if (u > T.EDGE.u0 - 4 && u < T.EDGE.u1 + 2) lane = Math.max(lane, -1.0); // well clear of the open edge
    // The shakers: each house car picks a side of each one by its own seeded coin (leaning to the side with the wind-up key),
    // so the pack splits and a player can take the other gap.
    const spanHere = halfAt(lu) - 0.95;
    for (let k = 0; k < SHAKERS.length; k++) {
      const d = wrapS(SHAKERS[k].u - u);
      if (d > -1.5 && d < 3 + Math.max(0, c.v) * 0.9) {
        const pad = T.PADS.find((p) => Math.abs(wrapS(p.u - SHAKERS[k].u)) < 2);
        const padSide = Math.sign((pad && pad.lat) || 1);
        const side = hash(state.seed ^ (c.i * 0x2c1b), lapN * 16 + k) < 0.62 ? padSide : -padSide;
        lane = side * (SHAKERS[k].r + 1.85);
      }
    }
    // Anything standing in the lane ahead (cherries, the egg, the jars on the lazy Susan, butter, spills): pass on the nearer free side.
    if (!bridge) lane = clearLane(blockers(state, BL), u, lane, 1.5 + Math.max(0, c.v) * 0.8, Math.max(span, spanHere));
    // A slower car on its line just ahead: go round it (but never off the bridge).
    if (!bridge) for (const o of state.cars) {
      if (o === c || o.fallT > 0) continue;
      const d = wrapS(o.u - u);
      if (d > 0.3 && d < 2.5 + Math.max(0, c.v - o.v) * 0.6 && Math.abs(o.lat - lane) < 0.95 && o.v < c.v + 0.3) {
        const right = o.lat + 1.15, left = o.lat - 1.15;
        lane = right <= span && (left < -span || Math.abs(right - lane) <= Math.abs(left - lane)) ? right : left;
      }
    }
    // A player coming up fast just behind gets the road: the house car moves out of the player's line
    // instead of being rear-ended (it gives way to the side with more room).
    if (!bridge && c.house) for (const o of state.cars) {
      if (o.house || o.fallT > 0 || o.fin) continue;
      const d = wrapS(u - o.u);
      if (d > 0.2 && d < T.YIELD && o.v > c.v - 0.4 && Math.abs(o.lat - c.lat) < 1.25) {
        const room = Math.max(span, spanHere), away = o.lat >= 0 ? -1 : 1;
        const want = o.lat + away * T.YIELD_W;
        lane = Math.abs(want) <= room ? want : o.lat - away * T.YIELD_W;
      }
    }
    if (Math.abs(wrapS(lu - TN.u)) < TN.len / 2 + TN.funnel + 3) lane = clamp(lane, -0.8, 0.8);
    lane = clamp(lane, -Math.max(span, spanHere), Math.max(span, spanHere));
    // It aims a little nearer than a player looks, so it can thread the slalom.
    const tp = trackAt(u + Math.min(look, 2.2 + Math.max(0, c.v) * 0.2), lane, tmpB);
    const err = wrapA(atan2(tp.z - c.z, tp.x - c.x) - c.h);
    const st = clamp(err * 2.6, -1, 1);
    // Stuck against something (it never should be): back off, turning the other way.
    if (c.slow > 1.2 && state.t > 0) { out.st = -st; out.b = BTN.BRAKE; return out; }
    out.st = st; out.b = BTN.GO | (houseUse(state, c) ? BTN.USE : 0);
    return out;
  }

  return { drive, carAhead };
}
