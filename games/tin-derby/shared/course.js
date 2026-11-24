// Tin Derby: the table. Everything here is worked out from the data file (data/tune.js): the loop and
// where a point is on it, the height of the ground, what stands on the road, and the live kitchen's
// clocks (the kettle, the toaster, the egg, the syrup, the lazy Susan, the cherries).
// Nothing here changes a race or keeps anything between calls: every function answers from its
// arguments, the race's own clock (tau, seconds since the race was made) and the race's seed.
// No drawing, no browser APIs, no Math.sin and friends (see dmath.js for why).
import * as dmath from "./dmath.js";

export const DT = 1 / 120; // one fixed step
export const SUB = 4; // steps in a room tick (tickHz 30)
const RAD = dmath.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** A number from 0 up to 1 that depends only on its two whole-number arguments: the rules' only source of chance. */
export function hash(seed, n) {
  let h = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The table built from the numbers `T`. `M` is the maths it uses: dmath always, except in the parity
 * check against the preview (tools/parity.mjs), which passes the engine's own.
 */
export function makeCourse(T, M = dmath) {
  const { sin, cos, atan2, hypot, wrapA } = M;

  // ---- The loop, built once from T.TRACK: straight pieces and turns, end to end ----
  const SEGS = [];
  const TAG = {}; // tag -> its piece
  {
    let x = T.START_X, z = T.START_Z, th = 0, u = 0;
    for (const p of T.TRACK) {
      const o = typeof p[p.length - 1] === "object" ? p[p.length - 1] : {};
      const g = { k: p[0], u0: u, x0: x, z0: z, th0: th, bank: (o.bank || 0) * RAD, tag: o.tag || "" };
      if (p[0] === "S") { g.len = p[1]; g.r = 0; g.sg = 0; x += cos(th) * g.len; z += sin(th) * g.len; }
      else {
        g.r = p[1]; g.sg = Math.sign(p[2]); g.len = (g.r * Math.abs(p[2]) * dmath.PI) / 180;
        // The turn's middle: to the right of the heading for a right turn (right is (-sin, cos)).
        g.cx = x + g.sg * g.r * -sin(th); g.cz = z + g.sg * g.r * cos(th);
        th += (p[2] * dmath.PI) / 180;
        x = g.cx - g.sg * g.r * -sin(th); z = g.cz - g.sg * g.r * cos(th);
      }
      g.u1 = u + g.len; u = g.u1;
      g.i = SEGS.length;
      SEGS.push(g);
      if (g.tag) TAG[g.tag] = g;
    }
  }
  const LEN = SEGS[SEGS.length - 1].u1; // one lap
  const segAt = (u) => { for (let i = 0; i < SEGS.length; i++) if (u < SEGS[i].u1) return SEGS[i]; return SEGS[SEGS.length - 1]; };
  const wrapU = (u) => ((u % LEN) + LEN) % LEN;
  /** A difference of two distances along the loop, -LEN/2 to LEN/2. */
  const wrapS = (d) => (((d % LEN) + 1.5 * LEN) % LEN) - LEN / 2;

  /** The middle of the loop at u, which way it runs, and how sharply it turns. `lat` moves the point to the right. */
  function trackAt(u, lat = 0, out = {}) {
    u = wrapU(u);
    const g = segAt(u), d = u - g.u0;
    let x, z, th;
    if (g.k === "S") { th = g.th0; x = g.x0 + cos(th) * d; z = g.z0 + sin(th) * d; out.k = 0; }
    else { th = g.th0 + (g.sg * d) / g.r; x = g.cx - g.sg * g.r * -sin(th); z = g.cz - g.sg * g.r * cos(th); out.k = g.sg / g.r; }
    const dx = cos(th), dz = sin(th);
    out.x = x - dz * lat; out.z = z + dx * lat; out.dx = dx; out.dz = dz; out.th = th; out.turn = g.k === "A";
    return out;
  }

  /** Where a point on the table is along the loop (u) and across it (lat), searching near `hint` (a u) when given. */
  function locate(x, z, hint, out = {}) {
    let best = Infinity;
    const n = SEGS.length, i0 = hint === undefined ? 0 : segAt(wrapU(hint)).i;
    const k0 = hint === undefined ? 0 : -1, k1 = hint === undefined ? n : 2;
    for (let k = k0; k < k1; k++) {
      const g = SEGS[(i0 + k + n) % n];
      let d, lat, dist;
      if (g.k === "S") {
        const dx = cos(g.th0), dz = sin(g.th0), px = x - g.x0, pz = z - g.z0;
        const along = px * dx + pz * dz;
        d = clamp(along, 0, g.len); lat = -px * dz + pz * dx;
        dist = Math.abs(lat) + Math.max(0, -along, along - g.len);
      } else {
        const wx = x - g.cx, wz = z - g.cz, rr = hypot(wx, wz) || 1e-6;
        const th = atan2(g.sg * wx, -g.sg * wz), mid = g.th0 + (g.sg * g.len) / (2 * g.r);
        const raw = g.len / 2 + g.sg * g.r * wrapA(th - mid);
        d = clamp(raw, 0, g.len); lat = -g.sg * (rr - g.r);
        dist = Math.abs(lat) + Math.max(0, -raw, raw - g.len);
      }
      if (dist < best) { best = dist; out.u = g.u0 + d; out.lat = lat; }
    }
    out.u = wrapU(out.u);
    return out;
  }

  // ---- The course ----
  const TN = T.TUNNEL;
  /** Half the width of the loop at u: it narrows through the cereal box and widens round the shakers and the lazy Susan. */
  function halfAt(u) {
    const d = Math.abs(wrapS(u - TN.u)), core = TN.len / 2;
    if (d <= core) return TN.half;
    if (d < core + TN.funnel) return TN.half + ((T.HALF - TN.half) * (d - core)) / TN.funnel;
    let h = T.HALF;
    for (const w of T.WIDEN) {
      const a = wrapS(u - w.u0), b = wrapS(w.u1 - u);
      if (a >= 0 && b >= 0) return w.half;
      const out = a < 0 ? -a : -b;
      if (out < w.ease) { const k = 1 - out / w.ease; h = Math.max(h, T.HALF + (w.half - T.HALF) * k * k * (3 - 2 * k)); }
    }
    return h;
  }
  /** The open edge: on this stretch the outside (-lat) has no wall, and the table ends EDGE.out beyond it. */
  const EDGE_SIDE = -1;
  const onEdge = (u) => u >= T.EDGE.u0 && u <= T.EDGE.u1;
  /** How far across the loop a car's middle may be at u before it touches a wall (the same on both sides). */
  const sideLimit = (u) => halfAt(u) - T.CAR_W / 2;

  function deckH(dk, u, lat) {
    if (lat < dk.lat[0] || lat > dk.lat[1]) return 0;
    const p = dk.pts;
    if (u < p[0][0] || u >= p[p.length - 1][0]) return 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (u >= a[0] && u < b[0]) return a[1] + ((b[1] - a[1]) * (u - a[0])) / (b[0] - a[0]);
    }
    return 0;
  }
  /** A dome (the butter dish's cover): a low plate (`rim`, `rimH`) with half an ellipsoid on it. */
  function domeH(dm, u, lat) {
    const du = u - dm.u, dl = lat - dm.lat, base = dm.rimH || 0;
    let h = 0;
    if (dm.rim && hypot(du, dl) < dm.rim) h = base;
    const q = (du * du) / (dm.ru * dm.ru) + (dl * dl) / (dm.rl * dm.rl);
    if (q < 1) h = Math.max(h, base + (dm.h - base) * Math.sqrt(1 - q));
    return h;
  }
  // (Round four's domes could carry a `lip`, a kicker shaped by a fractional power. No dome on this table has
  // one, and a fractional power is not exact on every engine, so it is refused here instead of ignored.)
  for (const dm of T.DOMES) if (dm.lip) throw new Error(`tin derby: the dome "${dm.name}" has a lip, which the rules do not drive yet`);
  /** A pancake stack: a flat round top at its height and a straight side, as drawn (a step down onto the next one). */
  function stackH(s, u, lat) {
    const du = wrapS(u - s.u) / s.ru, dl = (lat - s.lat) / s.rl;
    return du * du + dl * dl < 1 ? s.h : 0;
  }
  const SU = T.SUSAN;
  /** The lazy Susan: a low round platform with a bevelled edge (it turns; its height does not). */
  function susanH(u, lat) {
    const d = hypot(wrapS(u - SU.u), lat - SU.lat);
    if (d >= SU.r) return 0;
    return d < SU.r - SU.bevel ? SU.h : (SU.h * (SU.r - d)) / SU.bevel;
  }
  const TS = T.TOASTER;
  /** The toast lying across the track, `k` 0 (not there) to 1: a wedge that rises toward its far end, then drops. */
  function toastH(u, lat, k) {
    if (!(k > 0) || lat < TS.lat0 || lat > TS.lat1) return 0;
    const d = u - (TS.land - TS.len / 2);
    if (d < 0 || d > TS.len) return 0;
    return TS.hgt * k * Math.min(1, 0.25 + (0.75 * d) / (TS.len * 0.85));
  }
  /** How far the bank leans in at u, 0 to 1 (it eases in and out over the ends of the turn). */
  const BANK_EASE = 4;
  const BK = TAG.bank;
  if (!BK) throw new Error('tin derby: the track needs one turn tagged "bank" (the fruit bowl hangs over it)');
  function bankAt(u) {
    const d = wrapS(u - BK.u0);
    if (d < -BANK_EASE || d > BK.len + BANK_EASE) return 0;
    const e = clamp((d + BANK_EASE) / (2 * BANK_EASE), 0, 1) * clamp((BK.len + BANK_EASE - d) / (2 * BANK_EASE), 0, 1);
    return e * e * (3 - 2 * e);
  }
  const BANK_SIDE = BK.sg; // the inside of the bank, as a side across the loop
  const BANK_TAN = M.tan(BK.bank);

  /** Height of the ground at u, `lat` across. `race` is the race (for its toast), or null for the bare table. */
  function groundAt(u, lat = 0, race = null) {
    u = wrapU(u);
    const toast = race ? race.toast : 0;
    let g = 0;
    for (const dk of T.DECKS) g = Math.max(g, deckH(dk, u, lat));
    for (const s of T.STACKS) g = Math.max(g, stackH(s, u, lat));
    for (const dm of T.DOMES) g = Math.max(g, domeH(dm, u, lat));
    g = Math.max(g, susanH(u, lat));
    if (toast > 0) g = Math.max(g, toastH(u, lat, toast));
    const b = bankAt(u);
    if (b > 0) g += b * BANK_TAN * clamp(T.HALF + 0.6 - BANK_SIDE * lat, 0, 2 * T.HALF + 1.2);
    return g;
  }

  // ---- The obstacles ----
  // Shakers stand on the track as solid posts.
  const SHAKERS = T.SHAKERS.map(([u, lat, kind]) => { const p = trackAt(u, lat, {}); return { u, lat, kind, x: p.x, z: p.z, r: T.SHAKER_R, h: T.SHAKER_H }; });

  // The live kitchen's clocks, from the race's own time (tau: seconds since the race was made, count-in included).
  const KT = T.KETTLE, CH = T.CHERRY, EG = T.EGG, SY = T.SYRUP;
  const SYQ = {}, SYRUP_SPILL = { name: "syrup", does: "slow" };
  /** When the first lap's grace ends, on the race's own clock. */
  const ARM_TAU = T.ARM_T + T.COUNT_IN;
  /** A cycle that only starts once armed: how far into its cycle tau is, or null while not armed. */
  function armedCycle(tau, period, phase) {
    const x = tau + phase, n = Math.floor(x / period), start = n * period - phase;
    if (start < ARM_TAU) return null;
    return x - n * period;
  }
  /** The kettle: 0 quiet, 1 the lid rattling and the whistle (a warning), 2 steam across the track. */
  function steamAt(tau) { const p = ((tau % KT.period) + KT.period) % KT.period; return p < KT.warn ? 1 : p < KT.warn + KT.blow ? 2 : 0; }
  /** The toaster: its phase in the cycle and how much toast lies on the track (0 to 1). Idle until armed. */
  function toasterAt(tau, out = {}) {
    const c = armedCycle(tau, TS.period, 2.2), p = c === null ? TS.period - 0.01 : c;
    const t0 = TS.warn + TS.fly;
    out.p = p; out.stage = p < TS.warn ? "warn" : p < t0 ? "fly" : p < t0 + TS.lie ? "lie" : p < t0 + TS.lie + TS.gone ? "gone" : "idle";
    out.k = out.stage === "lie" ? Math.min(1, (p - t0) / 0.08) : out.stage === "gone" ? 1 - (p - t0 - TS.lie) / TS.gone : 0;
    out.fly = out.stage === "fly" ? (p - TS.warn) / TS.fly : out.stage === "warn" ? 0 : 1;
    return out;
  }
  /** The egg: "cup" (sitting in it), "warn" (rocking), "roll" (across the road), "stop" (at the far rail), then back in its cup. */
  const EGG_DIST = EG.from - EG.to;
  function eggAt(tau, out = {}) {
    const c = armedCycle(tau, EG.every, EG.phase), rollT = EGG_DIST / EG.roll;
    out.lat = EG.from; out.stage = "cup"; out.k = 0;
    if (c === null) return out;
    if (c < EG.warn) { out.stage = "warn"; out.k = c / EG.warn; }
    else if (c < EG.warn + rollT) { out.stage = "roll"; out.lat = EG.from - EG.roll * (c - EG.warn); out.k = (c - EG.warn) / rollT; }
    else if (c < EG.warn + rollT + EG.rest) { out.stage = "stop"; out.lat = EG.to; out.k = (c - EG.warn - rollT) / EG.rest; }
    return out;
  }
  /** The syrup bottle: "idle", "warn" (it tips, a strand starts), then the patch on the road grows ("grow"), stays, and dries. k: the patch's size, 0 to 1. */
  function syrupAt(tau, out = {}) {
    const c = armedCycle(tau, SY.every, SY.phase);
    out.stage = "idle"; out.k = 0; out.c = c;
    if (c === null) return out;
    const g0 = SY.warn, g1 = g0 + SY.grow, s1 = g1 + SY.stay, d1 = s1 + SY.dry;
    if (c < g0) out.stage = "warn";
    else if (c < g1) { out.stage = "grow"; out.k = (c - g0) / SY.grow; }
    else if (c < s1) { out.stage = "stay"; out.k = 1; }
    else if (c < d1) { out.stage = "dry"; out.k = 1 - (c - s1) / SY.dry; }
    return out;
  }
  /** Is this point (u, lat) on a spill? The spills on the cloth, and (given the race's clock, tau) the syrup patch. */
  function spillAt(u, lat, tau) {
    for (const s of T.SPILLS) { const du = wrapS(u - s.u) / s.ru, dl = (lat - s.lat) / s.rl; if (du * du + dl * dl < 1) return s; }
    if (tau !== undefined) {
      const sy = syrupAt(tau, SYQ);
      if (sy.k > 0 && hypot(wrapS(u - SY.u), lat - SY.lat) < SY.r * sy.k) return SYRUP_SPILL;
    }
    return null;
  }
  /** The lazy Susan's middle on the table, and where each thing on it is at tau (x, z, and u, lat). */
  const SUSAN_AT = trackAt(SU.u, SU.lat, {});
  function susanThings(tau, out = []) {
    const dir = SUSAN_AT;
    for (let k = 0; k < SU.things.length; k++) {
      const th = SU.things[k];
      const a = th.a + SU.spin * tau, rx = cos(a) * th.at, rz = sin(a) * th.at;
      const o = out[k] || (out[k] = {});
      o.x = SUSAN_AT.x + rx; o.z = SUSAN_AT.z + rz; o.r = th.r; o.h = th.h; o.kind = th.kind; o.a = a;
      o.u = wrapU(SU.u + rx * dir.dx + rz * dir.dz); o.lat = SU.lat - rx * dir.dz + rz * dir.dx;
    }
    out.length = SU.things.length;
    return out;
  }
  /** The n-th cherry off the fruit bowl: when it falls, and where along the bank. */
  function cherryPlan(seed, n) {
    const at = 2 + n * CH.every + hash(seed ^ 0xc4e1, n) * 1.2;
    const u = BK.u0 + BK.len * (0.12 + 0.72 * hash(seed ^ 0x77, n));
    // It falls from the rim's lip straight down onto the inside of the track (the rim overhangs it).
    return { n, at, u, lat: clamp(BK.sg * (BK.r - (T.BOWL.rim - 0.7)), -(T.HALF - 0.6), T.HALF - 0.6) };
  }

  // The jumps the checks measure: each with the u it takes off from and the u a landing must reach (0: any landing).
  const JUMPS = [...T.DECKS, ...T.DOMES].filter((f) => f.jump).map((f) => {
    const from = f.jump.from || (f.pts ? f.pts[f.pts.length - 1][0] : f.u);
    return { name: f.name, from, clear: f.jump.clear, win: f.jump.win || [from - 1.6, from + 1.6] };
  });
  /** The jump a take-off at u belongs to, if any. */
  const jumpAt = (u) => JUMPS.find((j) => wrapS(u - j.win[0]) >= 0 && wrapS(u - j.win[1]) <= 0);

  const BTH = [], BEG = {}, BSY = {};
  /** What blocks the track, as stretches across it a car's middle must keep out of: [u, lat0, lat1, what, reach, k].
   *  The house cars and the scripted players read this to steer round things; the rules themselves use the shapes.
   *  `race` (optional) adds what moves: the jars, the egg, the syrup, the cherries, butter pats. */
  function blockers(race, out = []) {
    out.length = 0;
    const R = T.CAR_R + 0.08;
    for (let k = 0; k < SHAKERS.length; k++) { const s = SHAKERS[k]; out.push([s.u, s.lat - s.r - R, s.lat + s.r + R, "shaker", s.r + R, k]); }
    for (const s of T.SPILLS) out.push([s.u, s.lat - s.rl - 0.35, s.lat + s.rl + 0.35, "spill", s.ru]);
    if (race) {
      const tau = race.n * DT;
      for (const th of susanThings(tau, BTH)) out.push([th.u, th.lat - th.r - R - 0.3, th.lat + th.r + R + 0.3, th.kind, th.r + R]);
      const eg = eggAt(tau, BEG);
      if (eg.stage === "roll" || eg.stage === "warn") { const l0 = eg.stage === "warn" ? T.HALF : eg.lat - EG.r - R - 0.8; out.push([EG.u, Math.min(l0, eg.lat - EG.r - R - 0.8), eg.lat + EG.r + R, "egg", EG.r + R]); }
      else if (eg.stage === "stop") out.push([EG.u, eg.lat - EG.r - R, eg.lat + EG.r + R, "egg", EG.r + R]);
      const sy = syrupAt(tau, BSY);
      if (sy.stage !== "idle") out.push([SY.u, SY.lat - SY.r - 0.4, SY.lat + SY.r + 0.4, "syrup", SY.r]);
      for (const ch of race.cherries) out.push([ch.u, ch.lat - CH.r - R, ch.lat + CH.r + R, "cherry", CH.r + R]);
      for (const d of race.drops) if (d.k === "butter") out.push([d.u, d.lat - T.BUTTER_R - 0.3, d.lat + T.BUTTER_R + 0.3, "butter", T.BUTTER_R]);
    }
    return out;
  }
  const CLEAR = [];
  /** Nothing standing on the track for `dist` ahead of u (a good place to use a big boost). */
  function clearAhead(race, u, dist) { return !blockers(race, CLEAR).some((b) => { const d = wrapS(b[0] - u); return d > 0 && d < dist; }); }
  /** Moves `lane` out of whatever blocks it within `reach` ahead of u, to the nearer free side inside ±span. */
  function clearLane(list, u, lane, reach, span, margin = 0.4) {
    // The farthest first, so the nearest thing not yet passed has the last word; one just passed no longer counts
    // (the line can already swing toward the next one).
    const near = [];
    for (const b of list) { const d = wrapS(b[0] - u); if (d > -0.5 && d < reach + b[4]) near.push([d, b]); }
    near.sort((a, b) => b[0] - a[0]);
    for (const [, [, l0, l1]] of near) {
      if (lane > l0 - 0.25 && lane < l1 + 0.25) {
        const left = l0 - margin, right = l1 + margin;
        const okL = left >= -span, okR = right <= span;
        lane = okL && (!okR || Math.abs(lane - left) <= Math.abs(right - lane)) ? left : okR ? right : lane;
      }
    }
    return lane;
  }

  return {
    SEGS, TAG, LEN, segAt, wrapU, wrapS, trackAt, locate, halfAt, EDGE_SIDE, onEdge, sideLimit,
    groundAt, susanH, toastH, bankAt, BANK_SIDE, BANK_EASE, SHAKERS, ARM_TAU, steamAt, toasterAt, eggAt, EGG_DIST, syrupAt, spillAt,
    SUSAN_AT, susanThings, cherryPlan, JUMPS, jumpAt, blockers, clearAhead, clearLane,
  };
}
