// A session is one round as the browser sees it: the stalls' simulations, the clock, and the
// way inputs leave. LocalSession runs the battle code in the page (solo stall, attract mode,
// the four-stall demo). NetSession follows a room: it sends inputs, mirrors the room's
// simulation for an instant picture, and takes the room's word for everything that matters.
import { COUNT_IN, createBattle, game, landAttacks, loadStall, roundTime, standings, WARNING } from "./shared/battle.js";
import { COCK_SECONDS, ROUND_SECONDS, StallSim } from "./shared/sim.js";

/** Other players' stalls are shown this far in the past, so their shots arrive before they are due. */
export const REMOTE_DELAY = 0.45;

export class LocalSession {
  /**
   * @param {{seed: number, seats: Array<{seat:number,name:string,kind:string}>, mySeat?: number, countIn?: number, botSkill?: number}} opts
   */
  constructor({ seed, seats, mySeat = 0, countIn = COUNT_IN, botSkill = 1 }) {
    this.kind = "local";
    this.now = 0;
    this.state = createBattle({ seed, seats, now: (countIn - COUNT_IN) * 1000, delay: 0, botSkill });
    this.state.keep = true;
    for (const s of seats) this.state.stalls[s.seat].t = -countIn;
    this.seats = this.state.seats;
    this.mySeat = mySeat;
    this.sims = this.state.stalls;
    this.attacks = this.state.attacks;
    this.ended = false;
    this.over = false;
  }

  time() {
    return roundTime(this.state, this.now);
  }

  seatTime() {
    return this.time();
  }

  canFire(seat = this.mySeat) {
    const sim = this.sims[seat];
    const t = this.time();
    return t >= 0 && t < ROUND_SECONDS && !sim.over && sim.corksLeft > 0 && t - sim.lastFire >= COCK_SECONDS - 0.02 && this.state.endAt === null;
  }

  fire(ax, ay) {
    if (!this.canFire()) return false;
    game.input(this.state, this.mySeat, { f: [this.time(), ax, ay] }, this.now);
    return true;
  }

  pick(seat) {
    game.input(this.state, this.mySeat, { pick: seat }, this.now);
  }

  /** For looking at one attack on its own (?state=jam and friends). */
  inflict(type, to = this.mySeat) {
    const t = this.time();
    const atk = { id: 9000 + this.attacks.length, type, from: -1, to, sent: t, at: t + WARNING, returned: false, landed: false, done: false };
    this.attacks.push(atk);
    return { k: "atk", ...atk };
  }

  /** Advances by dt seconds. Returns every event, the stalls' own and the battle's, in order. */
  advance(dt) {
    const out = [];
    const step = 1 / 60;
    let left = dt;
    while (left > 1e-6) {
      const d = Math.min(step, left);
      left -= d;
      this.now += d * 1000;
      for (const s of this.seats) {
        if (s.kind !== "bot") continue;
        for (const input of game.bot(this.state, s.seat, this.now)) game.input(this.state, s.seat, input, this.now);
      }
      const events = game.tick(this.state, this.now);
      out.push(...this.state.simEvents.splice(0), ...events);
    }
    this.ended = this.state.endAt !== null;
    this.over = this.state.over;
    return out;
  }

  result() {
    return standings(this.seats, (seat) => this.sims[seat]);
  }
}

export class NetSession {
  constructor(party, snapshot, mySeat) {
    this.kind = "net";
    this.party = party;
    this.mySeat = mySeat;
    this.queue = [];
    this.ended = false;
    this.over = false;
    this.finalResult = null;
    this.history = [];
    this.drift = {};
    this.adopt(snapshot, true);
    this.off = [
      party.on("events", (events) => this.queue.push(...events)),
      party.on("snapshot", (s, now, full) => (full ? this.adopt(s, true) : this.check(s))),
    ];
  }

  dispose() {
    this.off.forEach((f) => f());
  }

  adopt(snap, rebuild) {
    this.startAt = snap.startAt;
    this.seed = snap.seed;
    this.round = snap.round;
    this.seats = snap.seats;
    if (rebuild) {
      this.sims = {};
      snap.seats.forEach((s, i) => {
        const sim = new StallSim(snap.seed, s.seat);
        if (snap.t > -COUNT_IN + 0.2) loadStall(sim, snap.stalls[i]);
        else sim.t = -COUNT_IN - 1;
        this.sims[s.seat] = sim;
      });
      this.attacks = snap.attacks.map((a) => ({ ...a }));
      this.ended = !!snap.ended;
      this.rebuilt = true;
    }
  }

  time() {
    return (this.party.now() - this.startAt) / 1000 - COUNT_IN;
  }

  seatTime(seat) {
    return this.time() - (seat === this.mySeat ? 0 : REMOTE_DELAY);
  }

  canFire() {
    const sim = this.sims[this.mySeat];
    if (!sim) return false;
    const t = this.time();
    return t >= 0 && t < ROUND_SECONDS && !this.ended && !sim.over && sim.corksLeft > 0 && t - sim.lastFire >= COCK_SECONDS - 0.02;
  }

  /** Aim and fire, with the room's clock. The room decides what it hit; the picture shows it at once. */
  fire(ax, ay) {
    if (!this.canFire()) return false;
    const t = this.time();
    this.sims[this.mySeat].fire(t, ax, ay);
    this.party.sendInput({ f: [Math.round(t * 1000) / 1000, Math.round(ax * 1000) / 1000, Math.round(ay * 1000) / 1000] });
    return true;
  }

  pick(seat) {
    this.party.sendInput({ pick: seat });
  }

  advance() {
    const out = [];
    for (const e of this.queue.splice(0)) {
      if (e.k === "f") {
        if (e.seat !== this.mySeat) this.sims[e.seat]?.fire(e.at, e.ax, e.ay);
        continue;
      }
      if (e.k === "atk") {
        if (!this.attacks.some((a) => a.id === e.id)) this.attacks.push({ ...e });
      } else if (e.k === "block") {
        const atk = this.attacks.find((a) => a.id === e.id);
        if (atk) {
          if (atk.done) continue; // this screen had already seen its own block
          atk.done = true;
        }
      } else if (e.k === "time") this.ended = true;
      out.push(e);
    }
    for (const s of this.seats) {
      const sim = this.sims[s.seat];
      const t = this.seatTime(s.seat);
      landAttacks(this.attacks, sim, t);
      sim.step(t);
      for (const e of sim.events) {
        // A dead-centre hit inside a warning is a block: show it now, the room will confirm it.
        if (e.k === "hit" && e.perfect && s.seat === this.mySeat) {
          const atk = this.attacks.find((a) => a.to === s.seat && !a.landed && !a.done && !a.returned && e.t < a.at && e.t >= a.sent);
          if (atk) {
            atk.done = true;
            out.push({ k: "block", id: atk.id, by: s.seat, t: e.t });
          }
        }
        out.push(e);
      }
      sim.events.length = 0;
    }
    const mine = this.sims[this.mySeat];
    if (mine) {
      this.history.push([mine.t, mine.score]);
      if (this.history.length > 240) this.history.shift();
    }
    return out;
  }

  /** The room's periodic word. A stall that has drifted from it for two seconds running is rebuilt from it. */
  check(snap) {
    if (snap.round !== this.round || snap.startAt !== this.startAt) return this.adopt(snap, true);
    if (snap.ended) this.ended = true;
    snap.seats.forEach((s, i) => {
      const sim = this.sims[s.seat];
      const theirs = snap.stalls[i];
      if (!sim) return;
      let mineScore = sim.score;
      if (s.seat === this.mySeat) {
        // Our own stall runs ahead of the room: compare with where we were at the room's time.
        const past = this.history.find((h) => h[0] >= theirs.t);
        if (past) mineScore = past[1];
      } else if (Math.abs(sim.t - theirs.t) > 0.3) return;
      const wrong = mineScore !== theirs.score;
      this.drift[s.seat] = wrong ? (this.drift[s.seat] ?? 0) + 1 : 0;
      if (this.drift[s.seat] >= 4) {
        loadStall(sim, theirs);
        this.drift[s.seat] = 0;
        this.rebuilt = true;
      }
    });
  }

  /** The room's final word on the round. */
  finish(result) {
    this.over = true;
    this.ended = true;
    this.finalResult = result;
    for (const r of result ?? []) {
      const sim = this.sims[r.seat];
      if (sim) {
        sim.score = r.score;
        sim.hits = r.hits;
        sim.shots = r.shots;
      }
    }
  }

  result() {
    return this.finalResult ?? standings(this.seats, (seat) => this.sims[seat]);
  }
}
