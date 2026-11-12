// One stall, simulated. The same code runs in the room (the authority) and in every browser
// (for an instant picture), so it is deterministic: fixed steps, and every random number is
// drawn from the seed and the shot's number.
//
// Time `t` is round time in seconds (0 at the opening bell, negative during the count-in).
import { BACK, BELL, CHAIN, COUNTER, HALF_W, JAM, PENDULUMS, PENDULUM_RATE, PLATES, ROWS, SHUTTER, STEPS, muzzle } from "./layout.js";

export const DT = 1 / 120;
export const ROUND_SECONDS = 90;
export const COCK_SECONDS = 0.5;
export const CORKS_PER_ROUND = 70;
export const BELL_FULL = 8;
export const CORK_SPEED = 9.2;
export const CORK_R = 0.012;
const GRAVITY = 9.81;
const DRAG = 0.045;
const RESET_EVERY = 5.2; // mechanism seconds between lifts of the cam bar
const STUN_SECONDS = 2.4;
export const JAM_MAX_SECONDS = 9;

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Mechanism time: the machine speeds up as the round goes on. */
export function mech(t) {
  if (t <= 0) return t;
  const u = Math.min(t, ROUND_SECONDS);
  return u + (0.85 * u * u * u) / (3 * ROUND_SECONDS * ROUND_SECONDS) + (t - u) * 1.85;
}

/** How fast the machine is running at t, 1 at the start and 1.85 at the end. */
export function speedAt(t) {
  const u = Math.max(0, Math.min(t, ROUND_SECONDS)) / ROUND_SECONDS;
  return 1 + 0.85 * u * u;
}

/** Hit areas are generous at first and tighten as the round goes on. */
function padAt(t) {
  const u = Math.max(0, Math.min(1, t / 45));
  return 0.036 - 0.022 * u;
}

export function chainStar(i, t) {
  const d = CHAIN.speed * mech(t) + (i * CHAIN.loop) / CHAIN.count + 1000 * CHAIN.loop;
  const lap = Math.floor(d / CHAIN.loop);
  const u = d - lap * CHAIN.loop;
  const onTop = u < CHAIN.span;
  // Past the end of the run the star tips over the sprocket and goes below.
  let x, y, tip;
  if (onTop) {
    x = -CHAIN.span / 2 + u;
    y = CHAIN.y;
    tip = 0;
    const edge = Math.min(u, CHAIN.span - u);
    if (edge < 0.1) tip = (u < 0.1 ? -1 : 1) * (1 - edge / 0.1) * 0.9;
  } else {
    x = u < CHAIN.span + (CHAIN.loop - 2 * CHAIN.span) / 2 + CHAIN.span / 2 ? CHAIN.span / 2 : -CHAIN.span / 2;
    y = CHAIN.y - 0.3;
    tip = 0;
  }
  return { x, y, lap, onTop, tip, hittable: onTop && Math.min(u, CHAIN.span - u) > 0.06 };
}

export function pendulumAngle(p, t) {
  return p.amp * Math.sin(PENDULUM_RATE * mech(t) * 0.62 + p.phase);
}

export function pendulumBob(p, t) {
  const a = pendulumAngle(p, t);
  return { x: p.px + Math.sin(a) * p.len, y: p.py - Math.cos(a) * p.len, a };
}

/** 0 closed .. 1 open. */
export function shutterOpen(t) {
  const u = mech(t) / SHUTTER.period;
  const f = u - Math.floor(u);
  const edge = 0.05;
  if (f < edge) return f / edge;
  if (f < SHUTTER.open) return 1;
  if (f < SHUTTER.open + edge) return 1 - (f - SHUTTER.open) / edge;
  return 0;
}

export function resetIndex(t) {
  return Math.floor(mech(t) / RESET_EVERY);
}

/** 0..1 through the cam bar's lift, or -1 when it is at rest. The lift takes 0.45 mechanism seconds. */
export function camLift(t) {
  const m = mech(t) / RESET_EVERY;
  const f = (m - Math.floor(m)) * RESET_EVERY;
  return f < 0.45 ? f / 0.45 : -1;
}

function stepTop(z) {
  if (z > COUNTER.zFront + 0.3) return -5; // off the front of the stall: gone
  if (z > COUNTER.zBack) return COUNTER.top;
  if (z > STEPS[0].zFront) return 0;
  if (z > STEPS[1].zFront) return STEPS[0].top;
  if (z > STEPS[2].zFront) return STEPS[1].top;
  return STEPS[2].top;
}

/** The cork's launch velocity for an aim point on the front row's plane. */
export function launch(ax, ay) {
  const [mx, my, mz] = muzzle(ax, ay);
  const dx = ax - mx;
  const dy = ay - my;
  const dz = ROWS[0].z - mz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const time = (dist / CORK_SPEED) * (1 + DRAG * dist * 0.5);
  // Sighted in for the front row: the arc passes through the aim point there and falls away beyond it.
  const vx = dx / time;
  const vy = dy / time + 0.5 * GRAVITY * time;
  const vz = dz / time;
  const k = CORK_SPEED / Math.sqrt(vx * vx + vy * vy + vz * vz);
  return { p: [mx, my, mz], v: [vx * k, vy * k * 1.0 + (1 - k) * 0.0, vz * k] };
}

/** Where a cork aimed at (ax, ay) crosses the plane z, ignoring everything in the way. */
export function predict(ax, ay, z) {
  const { p, v } = launch(ax, ay);
  let [x, y, zz] = p;
  let [vx, vy, vz] = v;
  let time = 0;
  while (zz > z && time < 1.2) {
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const d = DRAG * sp * DT;
    vx -= vx * d;
    vy -= vy * d + GRAVITY * DT;
    vz -= vz * d;
    x += vx * DT;
    y += vy * DT;
    zz += vz * DT;
    time += DT;
  }
  return { x, y, time };
}

export class StallSim {
  constructor(seed, seat = 0) {
    this.seed = (seed ^ Math.imul(seat + 1, 0x51ed270b)) >>> 0;
    this.seat = seat;
    this.t = -3;
    this.score = 0;
    this.streak = 0;
    this.best = 0;
    this.bell = 0;
    this.corksLeft = CORKS_PER_ROUND;
    this.shots = 0;
    this.hits = 0;
    this.lastFire = -10;
    this.plateDown = PLATES.map(() => -1); // time it fell, or -1 when standing
    this.plateUpAt = PLATES.map(() => -10);
    this.lastReset = resetIndex(-3);
    this.starLap = new Array(CHAIN.count).fill(-1); // the lap on which the star was hit
    this.starHitAt = new Array(CHAIN.count).fill(-10);
    this.stunUntil = PENDULUMS.map(() => -10);
    this.shutterHitAt = -10;
    this.bellHitAt = -10;
    this.jamUntil = -10; // a rival's cork is wedged in the cam until this time (or until shot loose)
    this.jamAt = -10;
    this.mothsUntil = -10;
    this.darkUntil = -10;
    this.corks = []; // in flight
    this.rested = []; // where corks came to rest: they stay for the round
    this.pending = []; // fire inputs waiting for their time
    this.events = [];
    this.over = false;
  }

  get jammed() {
    return this.t < this.jamUntil;
  }

  /** True while the round is on and the stall may score. */
  get live() {
    return this.t >= 0 && this.t < ROUND_SECONDS && !this.over;
  }

  /** Queues a shot. `at` is the round time it was fired; `ax, ay` the aim point on the front row's plane. */
  fire(at, ax, ay) {
    if (!Number.isFinite(at) || !Number.isFinite(ax) || !Number.isFinite(ay)) return false;
    this.pending.push({ at: Math.max(at, this.t), ax: Math.max(-1.6, Math.min(1.6, ax)), ay: Math.max(0.2, Math.min(3, ay)) });
    return true;
  }

  doFire(shot) {
    if (this.t < 0 || this.t >= ROUND_SECONDS || this.over) return;
    if (this.t - this.lastFire < COCK_SECONDS - 0.02 || this.corksLeft <= 0) return;
    this.lastFire = this.t;
    this.corksLeft -= 1;
    const n = this.shots++;
    const { p, v } = launch(shot.ax, shot.ay);
    // Each cork has its own small drift and spin: it wanders more the farther it flies.
    const drift = (hash(this.seed, n * 3 + 1) - 0.5) * 1.5;
    const lift = (hash(this.seed, n * 3 + 2) - 0.5) * 0.7;
    this.corks.push({ id: n, p, v, drift, lift, bounces: 0, struck: 0, born: this.t, age: 0, spin: hash(this.seed, n * 3 + 3) });
    this.events.push({ k: "fire", seat: this.seat, id: n, t: this.t, ax: shot.ax, ay: shot.ay });
  }

  /** Advances to round time `to`, in fixed steps. Events gather in this.events. */
  step(to) {
    while (this.t + DT <= to + 1e-9) {
      this.t += DT;
      if (this.pending.length) {
        for (let i = 0; i < this.pending.length; i++) {
          if (this.pending[i].at <= this.t) {
            this.doFire(this.pending[i]);
            this.pending.splice(i--, 1);
          }
        }
      }
      // The cam bar lifts the front row, unless a cork is wedged in it.
      const ri = resetIndex(this.t);
      if (ri !== this.lastReset) {
        this.lastReset = ri;
        if (!this.jammed) {
          let any = false;
          for (let i = 0; i < PLATES.length; i++) {
            if (this.plateDown[i] >= 0) {
              this.plateDown[i] = -1;
              this.plateUpAt[i] = this.t + 0.3;
              any = true;
            }
          }
          this.events.push({ k: "reset", seat: this.seat, t: this.t, any });
        }
      }
      if (this.jamUntil > -5 && this.t >= this.jamUntil && this.jamUntil > this.jamAt) {
        this.events.push({ k: "unjam", seat: this.seat, t: this.t, shot: false });
        this.jamUntil = -10;
      }
      for (let i = 0; i < this.corks.length; i++) {
        if (!this.stepCork(this.corks[i])) this.corks.splice(i--, 1);
      }
    }
  }

  stepCork(c) {
    const p = c.p;
    const v = c.v;
    const x0 = p[0];
    const y0 = p[1];
    const z0 = p[2];
    const sp = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    const d = DRAG * sp * DT;
    v[0] += (-v[0] * d + c.drift * DT * (c.bounces ? 0 : 1));
    v[1] += (-v[1] * d - GRAVITY * DT + c.lift * DT * (c.bounces ? 0 : 1));
    v[2] -= v[2] * d;
    p[0] += v[0] * DT;
    p[1] += v[1] * DT;
    p[2] += v[2] * DT;
    c.age += DT;

    // Targets: thin plates in a plane. A cork crossing the plane inside the shape strikes it.
    if (v[2] !== 0) this.strikeTargets(c, x0, y0, z0);

    // Side walls and the back board.
    if (p[0] > HALF_W - CORK_R || p[0] < -HALF_W + CORK_R) {
      p[0] = p[0] > 0 ? HALF_W - CORK_R : -HALF_W + CORK_R;
      v[0] *= -0.42;
      v[1] *= 0.8;
      v[2] *= 0.8;
      this.bounce(c, "wall");
    }
    if (p[2] < BACK.z + CORK_R && p[1] < BACK.top + 0.36) {
      p[2] = BACK.z + CORK_R;
      v[2] *= -0.36;
      v[0] = v[0] * 0.7 + (c.spin - 0.5) * 0.9;
      v[1] *= 0.7;
      this.bounce(c, "board");
    }
    // The steps, the floor and the counter.
    const top = stepTop(p[2]);
    if (p[1] < top + CORK_R) {
      const before = stepTop(z0);
      if (before < top - 0.02 && y0 < top) {
        // It met a riser: back it comes.
        p[2] = z0;
        v[2] *= -0.3;
        v[0] *= 0.7;
        this.bounce(c, "riser");
      } else {
        p[1] = top + CORK_R;
        if (Math.abs(v[1]) > 0.75) {
          v[1] *= -0.38;
          v[0] = v[0] * 0.62 + (c.spin - 0.5) * 0.5;
          v[2] *= 0.62;
          this.bounce(c, "step");
        } else {
          v[1] = 0;
          v[0] *= 1 - 5.5 * DT;
          v[2] *= 1 - 5.5 * DT;
          if (v[0] * v[0] + v[2] * v[2] < 0.02) return this.rest(c);
        }
      }
    }
    if (p[1] < -1 || p[2] > 1.2 || c.age > 6) return this.rest(c, true);
    return true;
  }

  bounce(c, what) {
    c.bounces += 1;
    if (c.bounces <= 4) this.events.push({ k: "bounce", seat: this.seat, id: c.id, t: this.t, what, x: c.p[0], y: c.p[1], z: c.p[2], s: Math.sqrt(c.v[0] * c.v[0] + c.v[1] * c.v[1] + c.v[2] * c.v[2]) });
  }

  rest(c, lost = false) {
    if (!c.struck) {
      // A clean miss ends the run of hits.
      if (this.streak > 0) this.events.push({ k: "streak", seat: this.seat, t: this.t, streak: 0 });
      this.streak = 0;
    }
    if (!lost) this.rested.push([c.p[0], c.p[1], c.p[2], c.spin * 6.283]);
    this.events.push({ k: "rest", seat: this.seat, id: c.id, t: this.t, x: c.p[0], y: c.p[1], z: c.p[2], yaw: c.spin * 6.283, lost, struck: c.struck });
    return false;
  }

  strikeTargets(c, x0, y0, z0) {
    const p = c.p;
    const pad = padAt(this.t);
    const crossed = (z) => (z0 > z && p[2] <= z) || (z0 < z && p[2] >= z);
    const at = (z) => {
      const f = (z - z0) / (p[2] - z0);
      return [x0 + (p[0] - x0) * f, y0 + (p[1] - y0) * f];
    };
    const inside = (h, cx, cy, rx, ry) => {
      const dx = (h[0] - cx) / (rx + pad);
      const dy = (h[1] - cy) / (ry + pad);
      return dx * dx + dy * dy;
    };
    let hit = null;
    if (crossed(ROWS[0].z)) {
      const h = at(ROWS[0].z);
      for (let i = 0; i < PLATES.length && !hit; i++) {
        const pl = PLATES[i];
        if (this.plateDown[i] >= 0 || this.t < this.plateUpAt[i]) continue;
        const q = inside(h, pl.x, pl.y, pl.rx, pl.ry);
        if (q <= 1) {
          this.plateDown[i] = this.t;
          hit = { target: pl.id, row: 0, pts: ROWS[0].points, q, x: h[0], y: h[1], z: ROWS[0].z };
        }
      }
      if (!hit && this.jammed) {
        const q = inside(h, JAM.x, JAM.y, JAM.r, JAM.r);
        if (q <= 1) {
          this.jamUntil = -10;
          this.events.push({ k: "unjam", seat: this.seat, t: this.t, shot: true });
          hit = { target: "jam", row: 0, pts: 15, q, x: h[0], y: h[1], z: ROWS[0].z };
        }
      }
    }
    if (!hit && crossed(CHAIN.z)) {
      const h = at(CHAIN.z);
      for (let i = 0; i < CHAIN.count && !hit; i++) {
        const s = chainStar(i, this.t);
        if (!s.hittable || this.starLap[i] === s.lap) continue;
        const q = inside(h, s.x, s.y, CHAIN.rx, CHAIN.ry);
        if (q <= 1) {
          this.starLap[i] = s.lap;
          this.starHitAt[i] = this.t;
          hit = { target: `s${i}`, row: 1, pts: ROWS[1].points, q, x: h[0], y: h[1], z: CHAIN.z };
        }
      }
    }
    if (!hit && crossed(ROWS[2].z)) {
      const h = at(ROWS[2].z);
      for (let i = 0; i < PENDULUMS.length && !hit; i++) {
        if (this.t < this.stunUntil[i]) continue;
        const b = pendulumBob(PENDULUMS[i], this.t);
        const q = inside(h, b.x, b.y, PENDULUMS[i].r, PENDULUMS[i].r);
        if (q <= 1) {
          this.stunUntil[i] = this.t + STUN_SECONDS;
          hit = { target: PENDULUMS[i].id, row: 2, pts: ROWS[2].points, q, x: h[0], y: h[1], z: ROWS[2].z };
        }
      }
      if (!hit && shutterOpen(this.t) > 0.5 && this.t - this.shutterHitAt > 1.2) {
        const q = inside(h, SHUTTER.x, SHUTTER.y, SHUTTER.r, SHUTTER.r);
        if (q <= 1) {
          this.shutterHitAt = this.t;
          hit = { target: "sh", row: 2, pts: 100, q, x: h[0], y: h[1], z: ROWS[2].z };
        }
      }
    }
    if (!hit && !c.rang && crossed(BELL.z) && this.t - this.bellHitAt > 0.25) {
      const h = at(BELL.z);
      const q = inside(h, BELL.x, BELL.y, BELL.r, BELL.r);
      if (q <= 1) {
        this.bellHitAt = this.t;
        c.rang = true; // one cork rings it once, however it rattles about behind
        const full = this.bell >= BELL_FULL;
        hit = { target: "bell", row: 3, pts: full ? 100 : 15, q, x: h[0], y: h[1], z: BELL.z, rung: full };
        if (full) this.bell = 0;
      }
    }
    if (!hit) return;

    // The cork glances off the thing it struck.
    const v = c.v;
    const into = v[2] < 0 ? 1 : -1;
    p[0] = hit.x;
    p[1] = hit.y;
    p[2] = hit.z + into * 0.012;
    v[2] *= -0.3;
    v[0] = v[0] * 0.5 + (hit.x - (hit.target === "bell" ? BELL.x : hit.x)) + (c.spin - 0.5) * 1.6;
    v[1] = v[1] * 0.4 + 0.9;
    const ricochet = c.bounces > 0;
    c.bounces += 1;
    c.struck += 1;
    if (!this.live) return;

    const perfect = hit.q <= 0.2;
    this.streak += 1;
    this.hits += 1;
    this.best = Math.max(this.best, this.streak);
    const mult = this.streak >= 8 ? 3 : this.streak >= 4 ? 2 : 1;
    let pts = hit.pts * mult;
    if (ricochet) pts *= 2;
    if (perfect) pts = Math.round(pts * 1.5);
    this.score += pts;
    if (hit.target !== "bell") this.bell = Math.min(BELL_FULL, this.bell + (hit.row === 2 ? 2 : 1));
    else if (!hit.rung) this.bell = Math.min(BELL_FULL, this.bell + 1);
    if (perfect) this.corksLeft = Math.min(CORKS_PER_ROUND, this.corksLeft + 1); // a dead-centre hit earns the cork back
    this.events.push({
      k: "hit", seat: this.seat, id: c.id, t: this.t, target: hit.target, row: hit.row, pts, mult, perfect, ricochet,
      rung: !!hit.rung, streak: this.streak, score: this.score, bell: this.bell, x: hit.x, y: hit.y, z: hit.z, vx: v[0],
    });
  }

  /** A rival's cork wedges into the cam: the front row falls and stays down until it is shot loose. */
  jam(at) {
    this.jamAt = at;
    this.jamUntil = at + JAM_MAX_SECONDS;
    for (let i = 0; i < PLATES.length; i++) if (this.plateDown[i] < 0) this.plateDown[i] = at;
    this.events.push({ k: "jammed", seat: this.seat, t: at });
  }

  /** Everything a bot or a picture needs to know about what can be hit right now. */
  targets(t = this.t) {
    const list = [];
    for (let i = 0; i < PLATES.length; i++) {
      if (this.plateDown[i] < 0 && t >= this.plateUpAt[i]) list.push({ id: PLATES[i].id, row: 0, x: PLATES[i].x, y: PLATES[i].y, z: ROWS[0].z, r: PLATES[i].ry, vx: 0, pts: 10 });
    }
    for (let i = 0; i < CHAIN.count; i++) {
      const s = chainStar(i, t);
      if (s.hittable && this.starLap[i] !== s.lap && Math.abs(s.x) < CHAIN.span / 2 - 0.2) list.push({ id: `s${i}`, row: 1, x: s.x, y: s.y, z: CHAIN.z, r: CHAIN.rx, vx: CHAIN.speed * speedAt(t), pts: 25 });
    }
    for (let i = 0; i < PENDULUMS.length; i++) {
      if (t >= this.stunUntil[i]) {
        const b = pendulumBob(PENDULUMS[i], t);
        const b2 = pendulumBob(PENDULUMS[i], t + 0.05);
        list.push({ id: PENDULUMS[i].id, row: 2, x: b.x, y: b.y, z: ROWS[2].z, r: PENDULUMS[i].r, vx: (b2.x - b.x) / 0.05, pts: 50, swing: i });
      }
    }
    if (shutterOpen(t + 0.25) > 0.5 && shutterOpen(t) > 0.5 && t - this.shutterHitAt > 1.2) list.push({ id: "sh", row: 2, x: SHUTTER.x, y: SHUTTER.y, z: SHUTTER.z, r: SHUTTER.r, vx: 0, pts: 100 });
    list.push({ id: "bell", row: 3, x: BELL.x, y: BELL.y, z: BELL.z, r: BELL.r, vx: 0, pts: this.bell >= BELL_FULL ? 100 : 15 });
    if (t < this.jamUntil) list.push({ id: "jam", row: 0, x: JAM.x, y: JAM.y, z: ROWS[0].z, r: JAM.r, vx: 0, pts: 15 });
    return list;
  }

  /** The numbers the room sends so every screen agrees. */
  summary() {
    return { seat: this.seat, score: this.score, streak: this.streak, best: this.best, bell: this.bell, corks: this.corksLeft, shots: this.shots, hits: this.hits, jam: this.jammed ? 1 : 0, moths: this.t < this.mothsUntil ? 1 : 0, dark: this.t < this.darkUntil ? 1 : 0, over: this.over ? 1 : 0 };
  }
}
