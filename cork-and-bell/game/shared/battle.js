// The battle: two to four stalls, 90 seconds, attacks and blocks. This is the party kit "game"
// object the room runs. The same code runs in the browser for the solo stall and attract mode,
// with one seat and no delay.
//
// Inputs (never results):  {f: [at, ax, ay]}  fire at round time `at`, aiming at (ax, ay) on the front row's plane
//                          {pick: seat}       choose which rival your attacks go to (-1: the leader)
import { BELL_FULL, COCK_SECONDS, JAM_MAX_SECONDS, RICOCHET_TIMES, ROUND_SECONDS, StallSim, TASKS, pendulumBob, predict, resetIndex } from "./sim.js";
import { PENDULUMS } from "./layout.js";

export const COUNT_IN = 3;
export const SIM_DELAY = 0.3; // the room simulates this far behind its clock, so inputs arrive before their time
export const WARNING = 1.5;
export const MOTHS_SECONDS = 4;
export const DARK_SECONDS = 3;
export const END_HOLD = 1.2;
export const ATTACK_NAMES = { jam: "a jammed cork", moths: "a swarm of moths", dark: "a blackout" };

function hash(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function roundTime(state, now) {
  return (now - state.startAt) / 1000 - COUNT_IN;
}

export function createBattle({ seed, seats, now, round = 1, delay = SIM_DELAY, botSkill = 0.75 }) {
  const state = {
    seed: seed >>> 0,
    round,
    startAt: now,
    delay,
    seats: seats.map((s) => ({ seat: s.seat, name: s.name, kind: s.kind })),
    stalls: {},
    picks: {},
    bots: {},
    botSkill,
    attacks: [],
    rest: {},
    nextAttack: 1,
    out: [],
    over: false,
    endAt: null,
    keep: false, // the browser keeps the stalls' own events (for the picture and the sound)
    simEvents: [],
  };
  for (const s of seats) {
    const sim = new StallSim(state.seed, s.seat);
    sim.t = -COUNT_IN - delay;
    state.stalls[s.seat] = sim;
  }
  return state;
}

/** How many attacks are on their way to, or at work on, this stall. */
function load(state, seat, t) {
  const sim = state.stalls[seat];
  let n = 0;
  for (const a of state.attacks) if (a.to === seat && !a.done && !a.landed) n++;
  if (t < sim.jamUntil) n++;
  if (t < sim.mothsUntil) n++;
  if (t < sim.darkUntil) n++;
  return n;
}

function rivalOf(state, seat) {
  const pick = state.picks[seat];
  if (pick !== undefined && pick !== seat && state.stalls[pick] && !state.stalls[pick].over) return pick;
  let best = -1;
  for (const s of state.seats) {
    if (s.seat === seat || state.stalls[s.seat].over) continue;
    if (best === -1 || state.stalls[s.seat].score > state.stalls[best].score) best = s.seat;
  }
  return best;
}

/** One player cannot rain the same attack: each kind rests a while after it is sent. */
const REST = { jam: 7, moths: 9, dark: 0 };

function sendAttack(state, type, from, to, t, returned = false) {
  if (to < 0) return;
  if (!returned) {
    const key = `${from}:${type}`;
    if (t < (state.rest[key] ?? -99)) return;
    state.rest[key] = t + REST[type];
  }
  if (load(state, to, t) >= 2) {
    // Never more than two at once: the third one fizzles.
    state.out.push({ k: "fizz", type, from, to, t });
    return;
  }
  const atk = { id: state.nextAttack++, type, from, to, sent: t, at: t + WARNING + state.delay * 1.6, returned, landed: false, done: false };
  state.attacks.push(atk);
  state.out.push({ k: "atk", ...atk });
}

function applyAttack(sim, atk) {
  if (atk.type === "jam") sim.jam(atk.at);
  else if (atk.type === "moths") sim.mothsUntil = atk.at + MOTHS_SECONDS;
  else if (atk.type === "dark") sim.darkUntil = atk.at + DARK_SECONDS;
}

/** Shared by the room and the browsers: land the attacks whose time has come on this stall. */
export function landAttacks(attacks, sim, upTo) {
  for (const a of attacks) {
    if (a.to !== sim.seat || a.landed || a.done || a.at > upTo) continue;
    a.landed = true;
    applyAttack(sim, a);
  }
}

export const game = {
  id: "cork-and-bell",
  minSeats: 2,
  maxSeats: 4,
  tickHz: 30,
  snapshotEvery: 15,

  create(ctx) {
    return createBattle(ctx);
  },

  input(state, seat, data, now) {
    const sim = state.stalls[seat];
    if (!sim || !data || typeof data !== "object") return;
    if (Array.isArray(data.f) && data.f.length === 3) {
      const tNow = roundTime(state, now);
      // The client's own timestamp is used when it is believable, so its picture and the room agree.
      const at = Math.max(tNow - 0.5, Math.min(tNow + 0.08, Number(data.f[0])));
      if (!sim.fire(at, Number(data.f[1]), Number(data.f[2]))) return;
      state.out.push({ k: "f", seat, at: Math.max(at, sim.t), ax: data.f[1], ay: data.f[2] });
    } else if (Number.isInteger(data.pick)) {
      if (data.pick === -1) delete state.picks[seat];
      else if (state.stalls[data.pick] && data.pick !== seat) state.picks[seat] = data.pick;
      state.out.push({ k: "pick", seat, to: state.picks[seat] ?? -1 });
    }
  },

  /** A simple bot: it picks something worth hitting, leads it, holds over for the drop, and is a little off. */
  bot(state, seat, now) {
    const sim = state.stalls[seat];
    const t = roundTime(state, now) - state.delay;
    if (!sim || t < 0.4 || t >= ROUND_SECONDS || sim.over || sim.corksLeft <= 0) return [];
    const b = (state.bots[seat] ??= { next: 0.5 + hash(state.seed, seat * 977) * 0.8, n: 0 });
    if (t < b.next) return [];
    const r = (k) => hash(state.seed ^ (seat * 7919), b.n * 16 + k);
    b.n += 1;
    const skill = state.botSkill;
    b.next = t + COCK_SECONDS + 0.2 + r(0) * (0.9 / skill);
    const options = sim.targets(t).filter((o) => o.id !== "bell" || sim.bell >= BELL_FULL || r(5) < 0.12);
    if (!options.length) return [];
    // Worth more: the jam (it frees the row), a full bell, then by points and by how near the row is.
    let choice = options[0];
    let bestW = -1;
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      let w = o.id === "jam" ? 6 : o.id === "bell" && sim.bell >= BELL_FULL ? 5 : o.row === 0 ? 2.2 : o.row === 1 ? 1.5 : o.id === "sh" ? 1.6 : 1.0;
      if (t < 12 && o.row === 0) w *= 2;
      w *= 0.4 + hash(state.seed ^ (seat * 31 + i), b.n);
      if (w > bestW) {
        bestW = w;
        choice = o;
      }
    }
    // Lead it: where will it be when the cork gets there?
    let tx = choice.x;
    let ty = choice.y;
    let ax = tx;
    let ay = ty;
    for (let i = 0; i < 3; i++) {
      const p = predict(ax, ay, choice.z);
      if (choice.swing !== undefined) {
        const bob = pendulumBob(PENDULUMS[choice.swing], t + 0.03 + p.time);
        tx = bob.x;
        ty = bob.y;
      } else tx = choice.x + choice.vx * (p.time + 0.03);
      ax += tx - p.x;
      ay += ty - p.y;
    }
    let err = (0.062 + choice.row * 0.022) / skill;
    if (t < sim.mothsUntil) err += 0.05;
    if (t < sim.darkUntil) err += 0.07;
    const gx = (r(1) + r(2) + r(3) - 1.5) * 1.4;
    const gy = (r(4) + r(6) + r(7) - 1.5) * 1.4;
    return [{ f: [t + state.delay + 0.02, ax + gx * err, ay + gy * err] }];
  },

  tick(state, now) {
    const t = roundTime(state, now) - state.delay;
    for (const s of state.seats) {
      const sim = state.stalls[s.seat];
      landAttacks(state.attacks, sim, t);
      sim.step(t);
      for (const e of sim.events) {
        if (e.k !== "hit") continue;
        if (state.seats.length < 2) continue;
        // Defence: a dead-centre hit inside the warning sends the attack back.
        if (e.perfect) {
          const atk = state.attacks.find((a) => a.to === s.seat && !a.landed && !a.done && !a.returned && e.t < a.at && e.t >= a.sent);
          if (atk) {
            atk.done = true;
            state.out.push({ k: "block", id: atk.id, by: s.seat, t: e.t });
            sendAttack(state, atk.type, s.seat, atk.from, e.t, true);
          }
        }
        if (e.target === "jam") continue;
        if (e.rung) sendAttack(state, "dark", s.seat, rivalOf(state, s.seat), e.t);
        else if (e.ricochet) sendAttack(state, "moths", s.seat, rivalOf(state, s.seat), e.t);
        if (e.streak > 0 && e.streak % 3 === 0) sendAttack(state, "jam", s.seat, rivalOf(state, s.seat), e.t);
      }
      if (state.keep) for (const e of sim.events) state.simEvents.push(e);
      sim.events.length = 0;
      // Out of corks, and the last one has come to rest: this stall has stopped scoring.
      if (!sim.over && sim.corksLeft <= 0 && sim.corks.length === 0 && sim.pending.length === 0 && t < ROUND_SECONDS) {
        sim.over = true;
        state.out.push({ k: "out", seat: s.seat, t });
      }
    }
    for (const a of state.attacks) if (a.landed && !a.done && t > a.at + JAM_MAX_SECONDS + 1) a.done = true;
    if (state.endAt === null) {
      const scoring = state.seats.filter((s) => !state.stalls[s.seat].over).length;
      const lastOne = state.seats.length > 1 ? scoring <= 1 : scoring === 0;
      if (t >= ROUND_SECONDS || lastOne) {
        state.endAt = t;
        state.out.push({ k: "time", t });
      }
    } else if (!state.over && t >= state.endAt + END_HOLD) {
      state.over = true;
    }
    return state.out.splice(0);
  },

  snapshot(state, now) {
    const t = roundTime(state, now) - state.delay;
    return {
      t,
      startAt: state.startAt,
      seed: state.seed,
      round: state.round,
      delay: state.delay,
      seats: state.seats,
      picks: state.picks,
      ended: state.endAt !== null,
      stalls: state.seats.map((s) => dumpStall(state.stalls[s.seat])),
      attacks: state.attacks.filter((a) => !a.done),
    };
  },

  isOver(state) {
    return state.over;
  },

  result(state) {
    return standings(state.seats, (seat) => state.stalls[seat]);
  },
};

/**
 * No round can score more than this: a shot every time the lever cocks, each one the dearest hit
 * there is (the shutter star, on a run of eight, off a ricochet, dead centre), and both of the
 * dearest challenges. Nobody will come near it; a score above it was not played.
 */
export const MAX_ROUND_SCORE = Math.floor(ROUND_SECONDS / COCK_SECONDS) * Math.round(100 * 3 * RICOCHET_TIMES * 1.5) + 2 * Math.max(...TASKS.map((task) => task.bonus));

export function standings(seats, stallOf) {
  return seats
    .map((s) => {
      const sim = stallOf(s.seat);
      return { seat: s.seat, name: s.name, kind: s.kind, score: sim.score, hits: sim.hits, shots: sim.shots, best: sim.best };
    })
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Everything needed to rebuild a stall on a screen that has just (re)joined. */
export function dumpStall(sim) {
  return {
    ...sim.summary(),
    t: r3(sim.t),
    lastFire: r3(sim.lastFire),
    plateDown: sim.plateDown.map(r3),
    plateUpAt: sim.plateUpAt.map(r3),
    starLap: sim.starLap,
    stunUntil: sim.stunUntil.map(r3),
    shutterHitAt: r3(sim.shutterHitAt),
    jamUntil: r3(sim.jamUntil),
    jamAt: r3(sim.jamAt),
    mothsUntil: r3(sim.mothsUntil),
    darkUntil: r3(sim.darkUntil),
    rested: sim.rested.map((c) => c.map(r3)),
    // Only the lamps that are out and the prizes that have been knocked: most rounds, nothing.
    lamps: sim.lampOut.flatMap((until, i) => (until > sim.t ? [[i, r3(until)]] : [])),
    vases: sim.vaseKnocks.flatMap((n, i) => (n ? [[i, n, r3(sim.vaseDown[i])]] : [])),
    tasks: [sim.taskDone, sim.taskMoons, sim.taskCentres],
  };
}

export function loadStall(sim, d) {
  sim.score = d.score;
  sim.streak = d.streak;
  sim.best = d.best;
  sim.bell = d.bell;
  sim.corksLeft = d.corks;
  sim.shots = d.shots;
  sim.hits = d.hits;
  sim.over = !!d.over;
  sim.t = d.t;
  sim.lastFire = d.lastFire;
  sim.plateDown = d.plateDown.slice();
  sim.plateUpAt = d.plateUpAt.slice();
  sim.starLap = d.starLap.slice();
  sim.stunUntil = d.stunUntil.slice();
  sim.shutterHitAt = d.shutterHitAt;
  sim.jamUntil = d.jamUntil;
  sim.jamAt = d.jamAt;
  sim.mothsUntil = d.mothsUntil;
  sim.darkUntil = d.darkUntil;
  sim.rested = d.rested.map((c) => c.slice());
  sim.lampOut.fill(-10);
  for (const [i, until] of d.lamps ?? []) sim.lampOut[i] = until;
  if (d.tasks) {
    sim.taskDone = d.tasks[0].slice();
    sim.taskMoons = d.tasks[1];
    sim.taskCentres = d.tasks[2];
  }
  sim.vaseKnocks.fill(0);
  sim.vaseDown.fill(-1);
  for (const [i, n, down] of d.vases ?? []) {
    sim.vaseKnocks[i] = n;
    sim.vaseDown[i] = down;
  }
  sim.corks = [];
  sim.pending = [];
  sim.lastReset = resetIndex(d.t);
  return sim;
}
