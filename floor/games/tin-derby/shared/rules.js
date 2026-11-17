// Tin Derby: the race rules, and the game object a party room runs (party-kit/GAME-CONTRACT.md).
// No drawing and no browser APIs: the room runs this file as it is, and a page runs the very same code
// to show the race before the room's word arrives (shared/replica.js).
//
// A race is a pure function of three things: its seed, its seats, and the list of inputs with the step
// each one took effect at. Time moves in fixed steps of 1/120 s, counted in whole numbers (state.n);
// nothing reads a clock, nothing calls Math.random, and every angle and distance goes through dmath.js,
// so the same three things give the same race, to the last bit, in the room, in Node and in every browser.
//
// What a seat may send (small, stamped with the room's clock, never a result):
//   { c: [at, steer, go, brake, drift, use], q }
// steer is -1 (left) to 1 (right); the others are 0 or 1. `at` is the room's clock (ms) when the page
// applied it to its own copy; the room gives it the same step when it arrives in time. `q` (optional)
// numbers the page's inputs 1, 2, 3 ...; the room says the highest it has read, so a page knows which of
// its own inputs the room's answer already holds.
//
// What the room sends everyone (game.tick): only what a page cannot work out for itself.
//   { k: "i", n, c, j, s, b, q? }  car c's input (steer s, buttons b) takes effect at step n
//   { k: "a", n, c, j, on }        from step n, car c is driven by the house (its phone dropped), or handed back
//   { k: "n", n }                  the room has run up to step n: nothing new will take effect at or before it
// (j counts what the room has told about car c: 1, 2, 3 ...; q is the page's own number for its input.)
// Everything else that happens (a bump, a spin, a lap, the finish) each page gets from running the same
// steps; state.ev holds those events for whoever ran them.
import * as dmath from "./dmath.js";
import { DT, SUB, clamp, hash, makeCourse } from "./course.js";
import { BTN, makeHouse } from "./house.js";
import { TUNE } from "../data/tune.js";

export { DT, SUB, hash, BTN };
/** The rules' version: a snapshot says which rules made it, and a page with other rules must reload. */
export const VERSION = 1;
export const HOUSE = [
  { name: "Pip", habit: "pip" },
  { name: "Gus", habit: "gus" },
  { name: "Dot", habit: "dot" },
];
export const CHARACTERS = ["pawn", "ghost", "slime", "robot"];
/**
 * The house cars' paints, in the order they are tried: each house car takes the first that is not close to a colour
 * already in the race, so no house car wears a player's colour (they all wore the default red, as the first player does).
 * The first four are none of the party room's colour presets and stand out on the red and cream cloth: lime, sky blue,
 * chocolate, indigo (each at least 112 apart from every preset, as `far` measures; the cloth's red and cream at least
 * 43 apart in CIE Lab). The rest are the presets, for a party that has taken those.
 */
export const HOUSE_COLOURS = ["#9cc43a", "#4a9be0", "#7b4a2c", "#2b2f7a", "#1d1d1d", "#3aa9a0", "#d9619a", "#8a5bc4", "#d9a02a", "#3f7a4a"];
const rgbOf = (hex) => { const n = parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** How far apart two colours look, roughly ("redmean"): plain arithmetic and a square root, the same on every engine. */
export function colourGap(a, b) {
  const p = rgbOf(a), q = rgbOf(b), r = (p[0] + q[0]) / 2, dr = p[0] - q[0], dg = p[1] - q[1], db = p[2] - q[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}
/** The first house paint far enough from every colour the rows so far wear (the last one if none is). */
function houseColour(rows) {
  const far = (hex) => rows.every((r) => colourGap(hex, r.colour || "#c8382c") > 110);
  return HOUSE_COLOURS.find(far) || HOUSE_COLOURS[rows.length % HOUSE_COLOURS.length];
}
export const GRID_ORDER = [0, 2, 1, 3];
const TAU = dmath.TAU;
/** The timers every car counts down each step. */
const TIMERS = ["postT", "springT", "boostT", "wobT", "wallT", "knockT", "safeT", "itemT", "spinT", "sneezeT", "cherryT", "eggT", "pepperT", "spillCool", "phaseT", "phaseCD"];
const newStats = () => ({ pads: 0, drifts: 0, minis: 0, bigDrifts: 0, walls: 0, posts: 0, bumps: 0, falls: 0, jumps: 0, airT: 0, raced: 0, stuck: 0, items: 0, used: 0, hits: 0, slicks: 0, spills: 0, phases: 0, steadied: 0 });

/**
 * The rules for the numbers `T` (data/tune.js). The options are for the parity check against the preview only
 * (tools/parity.mjs): `math` swaps in the engine's own maths, and `preview` turns off the rules that differ
 * from the preview's on purpose (README.md, "Rules that differ from round five"). A race is the same on every
 * device only with the defaults.
 */
export function makeRules(T = TUNE, { math: M = dmath, preview: PREVIEW = false } = {}) {
  const { sin, cos, atan, atan2, hypot, wrapA } = M;
  const course = makeCourse(T, M);
  const house = makeHouse(T, course, M);
  const { LEN, TAG, wrapU, wrapS, trackAt, locate, EDGE_SIDE, onEdge, sideLimit, groundAt, susanH, toastH, BANK_SIDE, SHAKERS, ARM_TAU, steamAt, toasterAt, eggAt, syrupAt, spillAt, SUSAN_AT, susanThings, cherryPlan } = course;
  const KT = T.KETTLE, CH = T.CHERRY, EG = T.EGG, SY = T.SYRUP, SU = T.SUSAN, TS = T.TOASTER, BK = TAG.bank, NET = T.NET;
  const AHEAD_STEPS = Math.round(NET.AHEAD / DT);
  const START_STEP = Math.round(T.COUNT_IN / DT); // the step at which the race starts (GO)

  function makeCar(i, row, slot) {
    const u = T.LINE_U + slot[0], p = trackAt(u, slot[1], {});
    // One of the four racers; anything else (a character a newer room offers) races as the pawn.
    const character = CHARACTERS.includes(row.character) ? row.character : "pawn";
    return {
      // Who it is (never changes in a race).
      i, seat: row.seat, house: row.kind === "house", name: row.name || "", character, colour: row.colour || "#c8382c",
      habit: row.habit || "ace", trait: T.TRAITS[character] ? character : "pawn",
      // Where it is and how it moves. (x, z) on the table, h the way it points, mh the way it moves, y its height.
      x: p.x, z: p.z, h: p.th, mh: p.th, v: 0, y: 0, vy: 0, air: false, airT: 0, u, lat: slot[1], s: slot[0],
      // What its driver holds (inSt, inB: the steer and the buttons), the wheel (st), and a press of Use not yet acted on.
      st: 0, inSt: 0, inB: 0, press: false, auto: false,
      drOn: false, drDir: 0, drT: 0, drLvl: 0, boostT: 0, boostKind: "", wobT: 0, wallT: 0, knockT: 0, safeT: 0,
      fallT: 0, fallU: 0, lastPad: -1, lastPadT: -9, cap: T.TOP_SPEED, slow: 0, slick: "",
      item: null, itemT: 0, itemWait: 0, picks: 0,
      spinT: 0, spinDir: 1, spinLen: 0.55, spun: false, springT: 0, postT: 0, sneezeT: 0, cherryT: 0, eggT: 0, steamN: -1, pepperT: 0, spillCool: 0, spill: "",
      // The racer's trait (a ghost's fade: phaseCD counts down to the next one; phaseT is a fade running now).
      phaseCD: 0, phaseT: 0, onSusan: false, onToast: false,
      lap: 0, fin: false, finT: 0, place: 0,
    };
  }
  const CAR_KEYS = Object.keys(makeCar(0, { seat: 0 }, T.GRID[0]));

  /**
   * A race begins. `seats` are the party's players (up to four): {seat, name, colour, character?}; house cars
   * fill the rest and take the characters nobody chose. `delay` (seconds) is how far behind its clock the room
   * runs the race; a page playing alone passes 0.
   */
  function createRace({ seed = 1, seats = [], now = 0, round = 1, endless = false, house: houseRows = [], delay = NET.DELAY } = {}) {
    const rows = seats.slice(0, 4).map((s) => ({ ...s, kind: "human" }));
    const free = CHARACTERS.filter((ch) => !rows.some((r) => (CHARACTERS.includes(r.character) ? r.character : "pawn") === ch));
    for (let h = 0; rows.length < 4; h++) rows.push({ seat: -1 - h, kind: "house", name: HOUSE[h % 3].name, habit: HOUSE[h % 3].habit, character: free[h % (free.length || 1)] || "pawn", colour: houseColour(rows), ...(houseRows[h] || {}) });
    return fresh({
      seed: seed >>> 0, round, startAt: now, delay: Math.round(delay * 1000), n: 0, endless: !!endless, toast: 0, over: false, firstFin: -1, homeAt: null,
      cars: rows.map((r, i) => makeCar(i, r, T.GRID[GRID_ORDER[i]])),
      order: [], cherries: [], cherryN: 0, drops: [], dropN: 0, boxT: T.BOXES.map((b) => b.lats.map(() => 0)),
      toastWarn: -1, kettleWarn: -1, eggWarn: -1, syrupWarn: -1,
      // Inputs and hand-overs waiting for their step: [step, car, 0, on] or [step, car, 1, steer, buttons], in the order they take effect.
      queue: [],
      // What the room has heard from each car's page: the highest input number read (q), the last input taken (sent) and its
      // step (lastN); and how many things it has told everyone about each car (count).
      room: { q: [0, 0, 0, 0], sent: [[0, 0], [0, 0], [0, 0], [0, 0]], lastN: [0, 0, 0, 0], count: [0, 0, 0, 0] },
    });
  }
  /** Adds what a race keeps beside its saved state: this tick's events, the room's own notes, the checks' tallies. */
  function fresh(state) {
    state.t = state.n * DT - T.COUNT_IN;
    state.ev = []; // what happened in the steps just run (for a page's picture and sound, and the tests)
    state.net = []; // what the room has to tell everyone at its next tick
    // The room's own notes on each car's page, never sent: whether its socket was away at the last tick (away), when
    // it last heard anything from it (heard, ms on its clock; -1 before the first word), whether the page said it
    // cannot show the race (gave), and whether the house has the car just now (want).
    state.host = { mark: [false, false, false, false], away: [false, false, false, false], heard: [-1, -1, -1, -1], gave: [false, false, false, false], want: [false, false, false, false], ticks: 0 };
    state.rev = 0;
    state.stats = state.cars.map(newStats);
    return state;
  }

  const carOf = (state, seat) => state.cars.find((c) => c.seat === seat);
  /** Laps in this race: T.LAPS, or the test runs' short race (takeMessage, `short`). */
  const lapsOf = (state) => state.laps || T.LAPS;
  /** The test runs' short race: one lap and a five-second last call. Never where the room has no test games. */
  const SHORT = { laps: 1, call: 5 };
  const emit = (state, e) => { e.t = state.t; state.ev.push(e); };
  /** The step the race is in at `ms` on the room's clock (step n covers the 1/120 s that ends at n). */
  const stepOf = (state, ms) => Math.floor((ms - state.startAt) / 1000 / DT);

  /** Round once in `len` seconds, losing `lose` of its speed, still rolling the way it was going. */
  function spinCar(c, len, lose, dir) {
    c.spinT = len; c.spinLen = len; c.spinDir = dir; c.v *= 1 - lose; c.spun = true; c.drOn = false;
  }
  /** The racer's trait numbers (a missing number is 1, or 0 for the ghost's fade). */
  const TR = (c) => T.TRAITS[c.trait] || {};
  /** A ghost with its fade ready passes through this knock instead (it fades for a moment). Returns true when it did. */
  function phaseThrough(state, c, what) {
    if (c.trait !== "ghost") return false;
    if (c.phaseT > 0) return true;
    if (c.phaseCD > 0) return false;
    const tr = TR(c);
    c.phaseT = tr.phaseT; c.phaseCD = tr.phaseEvery; state.stats[c.i].phases++;
    emit(state, { k: "trait", car: c.i, trait: "ghost", what });
    return true;
  }

  // ---- Inputs: every one takes effect at a step, in the room and on every page alike ----
  /** Puts something in the queue, after everything due earlier and, in the same step, a hand-over before an input. */
  function enqueue(state, entry) {
    const q = state.queue;
    let k = q.length;
    while (k > 0 && (q[k - 1][0] > entry[0] || (q[k - 1][0] === entry[0] && q[k - 1][2] > entry[2]))) k--;
    q.splice(k, 0, entry);
    state.rev++;
  }
  /** A driver's hands: the steer and the buttons. A press of Use is noted the moment the button goes down. */
  function hold(c, st, b) {
    if (b & BTN.USE && !(c.inB & BTN.USE)) c.press = true;
    c.inSt = st; c.inB = b;
  }
  /** What a message asks for, in the form the rules keep: a steer rounded to STEER_STEPS, and the buttons as bits. */
  function readInput(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.c)) return null;
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const [at, st, go, br, dr, use] = data.c;
    return {
      at: typeof at === "number" && Number.isFinite(at) ? at : null,
      st: Math.round(clamp(num(st), -1, 1) * NET.STEER_STEPS) / NET.STEER_STEPS + 0,
      b: (num(go) > 0.5 ? BTN.GO : 0) | (num(br) > 0.5 ? BTN.BRAKE : 0) | (num(dr) > 0.5 ? BTN.DRIFT : 0) | (num(use) > 0.5 ? BTN.USE : 0),
      q: Number.isSafeInteger(data.q) && data.q > 0 ? data.q : 0,
    };
  }
  /**
   * The room takes an input from a seat's page: it is given the step of its stamp when that is still to come,
   * otherwise the next step, and everyone is told. Returns the step, or 0 when nothing was taken.
   */
  function takeInput(state, seat, data, now) {
    const c = carOf(state, seat), inp = readInput(data);
    if (!c || c.house || !inp || state.over) return 0;
    const R = state.room, i = c.i;
    if (inp.q > R.q[i]) { R.q[i] = inp.q; state.rev++; }
    if (inp.st === R.sent[i][0] && inp.b === R.sent[i][1]) return 0; // nothing changed: nothing to do or to tell
    let waiting = 0;
    for (const e of state.queue) if (e[1] === i && e[2] === 1) waiting++;
    if (waiting >= NET.QUEUE) return 0;
    // Never in the past (a late input takes effect now), never before this car's last one, never far ahead of the clock.
    const next = state.n + 1, latest = stepOf(state, now) + 1 + AHEAD_STEPS;
    const n = Math.max(next, R.lastN[i], Math.min(latest, inp.at === null ? next : stepOf(state, inp.at) + 1));
    R.lastN[i] = n; R.sent[i] = [inp.st, inp.b];
    enqueue(state, [n, i, 1, inp.st, inp.b]);
    const e = { k: "i", n, c: i, j: ++R.count[i], s: inp.st, b: inp.b };
    if (inp.q) e.q = inp.q;
    state.net.push(e);
    return n;
  }
  /**
   * Should the house drive this player's car just now? When its socket was away at the last tick, when its page
   * said it cannot show the race, and, once the race is under way, when the room has heard nothing at all from
   * the page for NET.SILENT (a phone that stalled without closing its socket), or nothing yet (a page still loading).
   * A racing page says it is there every NET.ALIVE_EVERY even when its hands are still, so a quiet straight is not silence.
   */
  function houseWanted(state, c, now) {
    const H = state.host, i = c.i;
    if (H.away[i] || H.gave[i]) return true;
    if (stepOf(state, now - state.delay) < START_STEP) return false; // in the count-in no car moves: nothing to drive yet
    return H.heard[i] < 0 || now - H.heard[i] > NET.SILENT * 1000;
  }
  /** Hands a car to the house or back when what it should be has changed. */
  function settleHouse(state, c, now) {
    if (state.over || c.house || c.fin) return;
    const on = houseWanted(state, c, now);
    if (on === state.host.want[c.i]) return;
    state.host.want[c.i] = on;
    handOver(state, c, on);
  }
  /**
   * Anything a seat's page sends: hands ({c: [...]}), a sign that it is still there ({h: 1}), or word that it cannot
   * show the race and the house should drive its car ({house: 1}; for its own car only, since the room knows the
   * seat by the socket). Hands also take the car back from the house. Anything else is not even a sign of life.
   */
  function takeMessage(state, seat, data, now) {
    const c = carOf(state, seat);
    if (!c || c.house || state.over || !data || typeof data !== "object") return 0;
    // A test run's short race ({short: 1}): only where the room was made by the test wall (`state.tests`, set by
    // testGame, which only a room with PARTY_TEST_GAMES on runs), and only in the count-in, before any car moves.
    // Everyone is told ({k: "len"}), and the snapshot carries it.
    if (data.short === 1) {
      if (state.tests === true && !state.laps && state.n + 1 < START_STEP) {
        state.laps = SHORT.laps; state.call = SHORT.call; state.rev++;
        state.net.push({ k: "len", laps: SHORT.laps, call: SHORT.call });
      }
      return 0;
    }
    const H = state.host, i = c.i, hands = readInput(data);
    if (hands) H.gave[i] = false;
    else if (data.house === 1) H.gave[i] = true;
    else if (data.h !== 1) return 0;
    H.heard[i] = now;
    settleHouse(state, c, now);
    return hands ? takeInput(state, seat, data, now) : 0;
  }
  /** The room hands a seat to the house (its phone dropped) or back, from the next step, and everyone is told. */
  function handOver(state, c, on) {
    const R = state.room;
    enqueue(state, [state.n + 1, c.i, 0, on ? 1 : 0]);
    if (!on) R.sent[c.i] = [0, BTN.GO];
    state.net.push({ k: "a", n: state.n + 1, c: c.i, j: ++R.count[c.i], on: on ? 1 : 0 });
  }
  /**
   * A page hears what the room told everyone (game.tick's events) and keeps its copy of the race in step.
   * The room numbers what it tells about each car (j: 1, 2, 3 ...), and a snapshot says how far it had counted, so
   * something a snapshot already held is not taken twice (a socket that opens between two ticks gets a snapshot
   * holding an input whose event is still to come).
   */
  function hear(state, e) {
    const R = state.room;
    if (e.k === "len") { if (!state.laps && Number.isInteger(e.laps) && e.laps > 0 && e.call > 0) { state.laps = e.laps; state.call = e.call; } return; }
    if (e.k !== "i" && e.k !== "a") return;
    if (e.j <= R.count[e.c]) return;
    R.count[e.c] = e.j;
    if (e.k === "i") {
      enqueue(state, [e.n, e.c, 1, e.s, e.b]);
      R.lastN[e.c] = e.n; R.sent[e.c] = [e.s, e.b];
      if (e.q > R.q[e.c]) R.q[e.c] = e.q;
    } else {
      enqueue(state, [e.n, e.c, 0, e.on]);
      if (!e.on) R.sent[e.c] = [0, BTN.GO];
    }
  }

  // ---- The powers ----
  /** A car's place right now (for the draw: cars behind get stronger powers). */
  function placeOf(state, c) { let p = 1; for (const o of state.cars) if (o !== c && (o.fin ? !c.fin || o.finT < c.finT : !c.fin && o.s > c.s)) p++; return p; }

  /** One kitchen power, drawn for car i by its place (seeded: the race's seed, the car, how many it has drawn). */
  function drawItem(seed, i, picks, place) {
    const row = T.ODDS[clamp(place, 1, 4) - 1], total = row.reduce((a, b) => a + b, 0);
    let r = hash(seed ^ 0x51ed, i * 1009 + picks * 7 + 3) * total;
    for (let k = 0; k < row.length; k++) { r -= row[k]; if (r < 0) return T.ITEMS[k]; }
    return T.ITEMS[T.ITEMS.length - 1];
  }

  const UP = {};
  /** Uses the power c holds. Returns true when it was used. */
  function useItem(state, c) {
    const it = c.item;
    if (!it || c.itemT > 0) return false;
    let to = -1;
    if (it === "overwind") { c.boostT = Math.max(c.boostT, T.OVERWIND_T); c.boostKind = "overwind"; }
    else if (it === "butter") {
      const bx = c.x - cos(c.h) * 1.15, bz = c.z - sin(c.h) * 1.15; locate(bx, bz, c.u, UP);
      const lim = sideLimit(UP.u), lat = clamp(UP.lat, -lim, lim), p = trackAt(UP.u, lat, {});
      state.drops.push({ k: "butter", id: ++state.dropN, x: p.x, z: p.z, u: UP.u, lat, y: groundAt(UP.u, lat, state), life: T.BUTTER_LIFE, by: c.i, safe: 0.6 });
    } else if (it === "pepper") {
      // The pepper shot: a peppercorn flying along the loop to the car ahead (straight on if there is none).
      const o = house.carAhead(state, c, T.PEPPER_RANGE); to = o ? o.i : -1;
      state.drops.push({ k: "shot", id: ++state.dropN, u: wrapU(c.u + 0.9), lat: c.lat, s: c.s + 0.9, y: c.y + 0.45, to, by: c.i, life: o ? 3.2 : 1.4 });
    }
    c.item = null; state.stats[c.i].used++;
    emit(state, { k: "use", car: c.i, item: it, to });
    return true;
  }

  /** A car is hit by something it should have seen coming: what, and by whom (a car's index, or -1 for the kitchen). */
  function hit(state, c, what, by, extra = {}) {
    state.stats[c.i].hits++;
    emit(state, { k: "hit", car: c.i, what, by, ...extra });
  }

  /** The leading player's distance, for the house cars' rubber band (a car the house drives does not count). */
  function leaderS(state) {
    let best = -Infinity;
    for (const c of state.cars) if (!c.house && !c.auto && c.s > best) best = c.s;
    return best;
  }

  // ---- One car, one step ----
  const P = {}, Q = {}, STH = [], EGQ = {};
  /**
   * Something other than its own wheels moved the car (a post it slid round, the turntable, the steam): where it is on
   * the loop is read again, and the distance it has raced moves with it. So the distance raced (s) and the place on
   * the loop (u) never drift apart, and every car finishes at the same line on the table. (The preview left s alone
   * here, so a car the turntable had carried on finished a length or so past the line.)
   */
  function moved(c) {
    locate(c.x, c.z, c.u, Q);
    if (!PREVIEW) c.s += wrapS(Q.u - c.u);
    c.u = Q.u; c.lat = Q.lat;
  }
  function stepCar(state, c, lead) {
    const t = state.t, racing = t >= 0, S = state.stats[c.i];
    for (const k of TIMERS) if (c[k] > 0) c[k] -= DT;
    const tr = TR(c);
    if (c.item && c.itemT <= 0) c.itemWait -= DT;
    if (racing && !c.fin) S.raced += DT;
    // Off the table: it falls; then the Hand of the House sets it back near where it fell.
    if (c.fallT > 0) {
      c.fallT -= DT;
      c.press = false;
      if (c.fallT > T.HAND_T) { c.vy -= T.GRAVITY * DT; c.y = Math.max(-8, c.y + c.vy * DT); c.x += cos(c.mh) * c.v * 0.5 * DT; c.z += sin(c.mh) * c.v * 0.5 * DT; }
      if (c.fallT <= 0) {
        const u = wrapU(c.fallU - 1), p = trackAt(u, -0.8, P);
        if (!PREVIEW) c.s += wrapS(u - c.u); // set back a little before where it went over: that much less raced
        c.fallT = 0; c.x = p.x; c.z = p.z; c.h = c.mh = p.th; c.u = u; c.lat = -0.8; c.v = 3; c.y = groundAt(u, -0.8, state); c.vy = 0; c.air = false;
        c.safeT = 1.2; c.st = 0; c.drOn = false; c.slow = 0; c.spinT = 0; c.spun = false; c.sneezeT = 0;
        emit(state, { k: "back", car: c.i });
      }
      return;
    }
    const go = (c.inB & BTN.GO) !== 0, brake = (c.inB & BTN.BRAKE) !== 0, drift = (c.inB & BTN.DRIFT) !== 0;
    const grounded = !c.air;
    const drive = racing; // a finished car rolls on slowly, driven by the house (a lap of honour)
    const spinning = c.spinT > 0, sneezing = c.sneezeT > 0;
    // A spin on butter ends facing the way the car slides.
    if (!spinning && c.spun) { c.h = c.mh; c.spun = false; }
    // The power: a press (not a hold) uses it.
    if (c.press) { if (drive && c.item && !c.fin) useItem(state, c); c.press = false; }
    // The wheel: toward the input, quickly back to centre. A tap turns it a little; a hold turns it all the way.
    const target = drive && !spinning ? c.inSt * (sneezing ? 0.5 : 1) : 0;
    const rate = Math.abs(target) > Math.abs(c.st) && target * c.st >= 0 ? T.STEER_IN : T.STEER_OUT;
    c.st += clamp(target - c.st, -rate * DT, rate * DT);
    // Drift: hold it while turning; let go for a boost that grows with how long you held.
    if (!c.drOn) {
      if (drive && !spinning && drift && grounded && c.v > T.DRIFT_MIN && Math.abs(c.st) > 0.3) { c.drOn = true; c.drDir = Math.sign(c.st); c.drT = 0; c.drLvl = 0; S.drifts++; emit(state, { k: "drift", car: c.i, dir: c.drDir }); }
    } else if (!drift || !drive || spinning || c.v < T.DRIFT_MIN * 0.6) {
      if (!drift && drive && c.drLvl > 0 && !spinning) {
        c.boostT = Math.max(c.boostT, (c.drLvl === 2 ? T.MINI_2 : T.MINI_1) * (tr.miniK || 1)); c.boostKind = "drift" + c.drLvl;
        S.minis++; if (c.drLvl === 2) S.bigDrifts++;
        emit(state, { k: "mini", car: c.i, lvl: c.drLvl });
      }
      c.drOn = false; c.drT = 0; c.drLvl = 0;
    } else {
      c.drT += DT;
      const ck = tr.chargeK || 1, lvl = c.drT >= T.DRIFT_2 * ck ? 2 : c.drT >= T.DRIFT_1 * ck ? 1 : 0;
      if (lvl > c.drLvl) { c.drLvl = lvl; emit(state, { k: "charge", car: c.i, lvl }); }
    }
    // Speed. House cars drive at their own pace, eased toward the leading player (the rubber band).
    let cap = T.TOP_SPEED * (tr.topK || 1), rb = 1;
    if (c.house || c.auto) {
      const hb = T.HABITS[c.habit] || T.HABITS.ace;
      cap *= hb.pace;
      if (lead > -Infinity && c.house) {
        const lastLap = lead >= (lapsOf(state) - 1) * LEN, aim = lastLap && hb.lastAim !== undefined ? hb.lastAim : hb.aim || 0;
        const gap = clamp((lead + aim - c.s) / T.RUBBER_D, -1, 1);
        // On the last lap it waits less for a player behind it, so a race is won by driving, not by the band.
        // A "lastFree" car (Gus) does not wait at all on the last lap.
        rb = gap < 0 ? (lastLap && hb.lastFree ? 1 : Math.max(T.RUBBER_FLOOR, 1 + gap * T.RUBBER_AHEAD * (lastLap ? T.RUBBER_LAST_WAIT : 1))) : 1 + gap * T.RUBBER_BEHIND * (lastLap && !hb.lastPush ? T.RUBBER_LAST : 1);
        cap *= rb;
      }
    }
    if (c.boostT > 0) cap = Math.max(cap, T.TOP_SPEED * (c.boostKind === "overwind" ? T.OVERWIND : T.BOOST) * Math.min(1, rb));
    // On syrup: sticky, slow (a boost still pulls you out).
    if (c.spill === "syrup" && !c.air) cap = Math.min(cap, T.TOP_SPEED * T.SYRUP_CAP * (c.boostT > 0 ? 1.5 : 1));
    if (c.drOn) cap *= 0.97;
    if (c.fin && !state.endless) cap = Math.min(cap, 4);
    c.cap = cap;
    if (grounded && drive && !spinning) {
      if (brake) {
        if (c.v > 0.3) c.v = Math.max(0, c.v - T.BRAKE * DT);
        else c.v = Math.max(-T.REVERSE, c.v - T.ACCEL * 0.6 * DT);
      } else if ((go && !sneezing) || c.boostT > 0) {
        if (c.v < cap) c.v = Math.min(cap, c.v + T.ACCEL * (c.boostT > 0 ? 1.8 : c.springT > 0 ? 1.7 : 1) * (1 - 0.55 * clamp(c.v / cap, 0, 1)) * DT);
        else c.v = Math.max(cap, c.v - (c.spill === "syrup" ? 14 : T.OVER_BLEED) * DT);
      } else {
        c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), T.COAST * DT);
        if (c.v > cap) c.v = Math.max(cap, c.v - T.OVER_BLEED * DT);
      }
    } else if (grounded) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (spinning ? 4 : 6) * DT);
    // A drift that has turned the car more than about 70 degrees off the road's direction ends (no boost), so
    // a drift held at boost speed into the bank can not swing a car right round.
    if (c.drOn && Math.abs(wrapA(c.h - trackAt(c.u, 0, P).th)) > 1.22) { c.drOn = false; c.drT = 0; c.drLvl = 0; }
    // Turning: speed-sensitive, and a drift turns tighter the way it leans.
    const av = Math.abs(c.v);
    let yaw = T.TURN * (tr.turnK || 1) * clamp(av / 2.2, 0, 1) * (1 - (1 - T.TURN_HI) * clamp(av / T.TOP_SPEED, 0, 1));
    if (c.drOn) yaw *= c.drDir * (0.72 + 0.5 * clamp(c.st * c.drDir, -1, 1));
    else yaw *= c.st;
    if (c.air) yaw *= T.AIR_STEER;
    // Steering help: hands off the wheel, the car eases back toward the way the track runs (never against a steer).
    if (T.ASSIST > 0 && Math.abs(c.inSt) < 0.05 && !c.drOn && !c.air && c.v > 1 && !spinning) {
      // (Even turned right round by a knock, hands off it comes back to face the right way.)
      const rel = wrapA(trackAt(c.u, 0, P).th - c.h);
      yaw += clamp(rel, -1.1, 1.1) * T.ASSIST;
    }
    if (c.wobT > 0) yaw += sin(t * 40) * 0.6 * (c.wobT / T.WOBBLE_T);
    if (spinning) c.h = wrapA(c.h + (TAU / c.spinLen) * c.spinDir * DT);
    else c.h = wrapA(c.h + yaw * Math.sign(c.v || 1) * DT);
    // Spills: each does one thing. Slide (salt, tea): the way the car moves only slowly follows the way it points.
    // Spin (oatmeal): round once, quickly, still rolling. Slow (syrup): sticky. A slime sticks: it never slides or spins.
    const sl = !c.air ? spillAt(c.u, c.lat, state.n * DT) : null;
    const sticks = c.trait === "slime";
    if (sl && c.spill !== sl.name) {
      S.spills++; if (sl.does === "slide") S.slicks++;
      let did = sl.does;
      if (sticks && sl.does !== "slow") did = "stuck";
      else if (sl.does === "spin" && c.spillCool <= 0 && !spinning) { spinCar(c, T.SPIN_T, T.SPIN_LOSE, hash(state.seed, c.i * 31 + state.n) < 0.5 ? -1 : 1); c.spillCool = 1.4; }
      emit(state, { k: "spill", car: c.i, what: sl.name, does: did });
      if (did === "stuck") emit(state, { k: "trait", car: c.i, trait: "slime", what: sl.name });
    }
    c.spill = sl ? sl.name : "";
    c.slick = sl && sl.does === "slide" && !sticks ? sl.name : "";
    if (!spinning && !c.air) { const g = c.slick ? T.SLICK_GRIP : 9; c.mh = wrapA(c.mh + clamp(wrapA(c.h - c.mh), -g * DT, g * DT)); }
    // Move, unless the ground ahead stands up higher than a car can drive (nothing on the course does, by design).
    const fx = cos(c.mh), fz = sin(c.mh);
    let nx = c.x + fx * c.v * DT, nz = c.z + fz * c.v * DT;
    locate(nx, nz, c.u, Q);
    let gN = groundAt(Q.u, Q.lat, state);
    if (gN > c.y + T.CLIMB) {
      // Too high to drive up (the side of a ramp): slide along it, as along a wall, never stop dead.
      trackAt(c.u, 0, P);
      const mx = nx - c.x, mz = nz - c.z, along = mx * P.dx + mz * P.dz, across = -mx * P.dz + mz * P.dx;
      const tries = [[P.dx * along, P.dz * along], [-P.dz * across, P.dx * across]];
      let moved = false;
      for (const [ax, az] of tries) {
        if (Math.abs(ax) + Math.abs(az) < 1e-5) continue;
        locate(c.x + ax, c.z + az, c.u, P); const g2 = groundAt(P.u, P.lat, state);
        if (g2 <= c.y + T.CLIMB) { nx = c.x + ax; nz = c.z + az; Q.u = P.u; Q.lat = P.lat; gN = g2; moved = true; break; }
      }
      if (!moved) {
        // A car running straight along a ramp's side edge (the spoon's outside) meets its tall end square on and has
        // nothing across to slide by: it steps sideways off the edge, to whichever side is drivable, so it is never wedged.
        nx = c.x; nz = c.z;
        trackAt(c.u, 0, P);
        const rx = -P.dz, rz = P.dx;
        for (const d of [0.15, -0.15, 0.3, -0.3]) {
          locate(c.x + rx * d, c.z + rz * d, c.u, Q);
          if (groundAt(Q.u, Q.lat, state) <= c.y + T.CLIMB && Math.abs(Q.lat) <= sideLimit(Q.u) + 0.05) { nx = c.x + rx * d; nz = c.z + rz * d; moved = true; break; }
        }
        locate(nx, nz, c.u, Q); gN = groundAt(Q.u, Q.lat, state);
      }
      // Turn the car along the obstacle (toward the loop's own direction), and lose a little speed.
      trackAt(c.u, 0, P);
      const rel = wrapA(c.mh - P.th);
      if (Math.abs(rel) < dmath.PI / 2) { c.mh = wrapA(P.th + rel * 0.6); if (!spinning) c.h = c.mh; }
      c.v *= moved ? 0.97 : 0.6;
      if (c.knockT <= 0) { emit(state, { k: "knock", car: c.i, hard: 2 }); c.knockT = 0.4; S.walls++; }
    } else if (!c.air && gN - c.y > 0.3) { c.v *= 0.8; if (c.knockT <= 0) { emit(state, { k: "clunk", car: c.i }); c.knockT = 0.3; } }
    c.x = nx; c.z = nz;
    // Along the loop: progress.
    const du = wrapS(Q.u - c.u);
    c.u = Q.u; c.lat = Q.lat; c.s += du;
    // Height: follow the ground, or fly off it when it falls away faster than a car falls.
    if (c.air) {
      c.vy -= T.GRAVITY * DT; c.y += c.vy * DT; c.airT += DT;
      if (c.y <= gN && c.vy > 0) c.y = gN; // the ground rose under a car still going up: ride it, still flying
      else if (c.y <= gN) {
        const hard = Math.max(0, -c.vy);
        c.y = gN; c.vy = 0; c.air = false;
        if (c.airT > 0.12) { emit(state, { k: "land", car: c.i, hard, u: c.u, s: c.s, air: c.airT }); S.airT += c.airT; }
        c.airT = 0;
      }
    } else {
      // One step ahead: does the ground fall away faster than a car falls? Then it flies (a ramp's lip, a crest).
      const L = DT;
      locate(c.x + fx * c.v * L, c.z + fz * c.v * L, c.u, P);
      const gA = groundAt(P.u, P.lat, state), zA = c.y + c.vy * L - 0.5 * T.GRAVITY * L * L;
      if (gA < zA - 0.012 && c.v > 1.2) {
        c.air = true; c.airT = 0; c.vy -= T.GRAVITY * DT; c.y += c.vy * DT;
        S.jumps++;
        emit(state, { k: "leap", car: c.i, u: c.u, s: c.s, v: c.v, vy: c.vy });
      } else {
        locate(c.x + fx * 0.05, c.z + fz * 0.05, c.u, P); const gF = groundAt(P.u, P.lat, state);
        locate(c.x - fx * 0.05, c.z - fz * 0.05, c.u, P); const gB = groundAt(P.u, P.lat, state);
        // A ramp's tall side just ahead is a wall, not a slope (read as a slope it braked a car running along the
        // spoon's outside edge to a standstill).
        const sl2 = gF - gN > T.CLIMB || gB - gN > T.CLIMB ? 0 : (gF - gB) / 0.1;
        c.vy = clamp(sl2 * c.v, -6, 6); c.y = gN;
        if (drive && sl2 > 0.02 && c.v > 0) c.v -= T.GRAVITY * T.GRADE * sl2 * DT; // climbing slows a little
      }
    }
    // Solid props: the shakers, the jars riding the lazy Susan, the rolling egg, the cherries. The car slides round them.
    const above = c.y - gN, tau = state.n * DT;
    for (const sh of SHAKERS) if (above < sh.h) post(state, c, sh.x, sh.z, sh.r, sh.kind, null);
    // The lazy Susan: standing on it, it carries you round (one side on along the road, the other back); its jars ride round too.
    if (!c.air && susanH(c.u, c.lat) > 0 && above < 0.05) {
      const w = SU.spin * DT * (tr.pushK || 1), rx = c.x - SUSAN_AT.x, rz = c.z - SUSAN_AT.z, cw = cos(w), sw = sin(w);
      c.x = SUSAN_AT.x + rx * cw - rz * sw; c.z = SUSAN_AT.z + rx * sw + rz * cw;
      c.h = wrapA(c.h + w); c.mh = wrapA(c.mh + w);
      if (!c.onSusan) { c.onSusan = true; emit(state, { k: "susan", car: c.i, side: Math.sign(-rx * SUSAN_AT.dz + rz * SUSAN_AT.dx) }); }
      moved(c);
    } else c.onSusan = false;
    for (const th of susanThings(tau, STH)) if (above < th.h) post(state, c, th.x, th.z, th.r, th.kind, null);
    {
      const eg = eggAt(tau, EGQ);
      if ((eg.stage === "roll" || eg.stage === "stop") && above < 2 * EG.r) {
        const p = trackAt(EG.u, eg.lat, P), ex = p.x, ez = p.z;
        // Rolling into a car: it knocks the car on across the road (the egg keeps rolling); a car into it slides round it.
        if (hypot(c.x - ex, c.z - ez) < EG.r + T.CAR_R && c.eggT <= 0 && eg.stage === "roll" && !phaseThrough(state, c, "egg")) { c.eggT = 1.2; c.v *= 0.8; c.wobT = T.WOBBLE_T; hit(state, c, "egg", -1); }
        post(state, c, ex, ez, EG.r, "egg", null);
      }
    }
    for (const ch of state.cherries) if ((ch.stage === "roll" || ch.stage === "rest") && above < 0.9) post(state, c, ch.x, ch.z, CH.r, "cherry", ch);
    // The kettle's steam: a push across the track, away from the kettle (toward the infield), while it blows.
    if (steamAt(tau) === 2 && !c.fin && above < 1.6) {
      const du2 = wrapS(c.u - KT.u0), span2 = KT.u1 - KT.u0;
      if (du2 >= 0 && du2 <= span2) {
        const f = sin((dmath.PI * du2) / span2) * -Math.sign(KT.lat) * (tr.pushK || 1), pr = trackAt(c.u, 0, P);
        c.x -= pr.dz * KT.push * f * DT; c.z += pr.dx * KT.push * f * DT; // away from the kettle's side, across the track
        const n = Math.floor(tau / KT.period);
        if (c.steamN !== n) { c.steamN = n; hit(state, c, "steam", -1); }
        moved(c);
      }
    }
    // The walls, last, after anything that pushes: soft. Touching one turns the car along it and costs a little speed, never a stop.
    const lim = sideLimit(c.u), side = c.lat > lim ? 1 : c.lat < -lim ? -1 : 0;
    if (side) {
      const open = side === EDGE_SIDE && onEdge(c.u);
      if (!open) {
        // The wall's own direction (where it curves in round a shaker it is not parallel to the loop).
        const slope = (sideLimit(c.u + 0.1) - sideLimit(c.u - 0.1)) / 0.2;
        trackAt(c.u, side * lim, P); c.x = P.x; c.z = P.z; c.lat = side * lim;
        const wallTh = P.th + atan(side * slope), rel = wrapA(c.mh - wallTh);
        if (sin(rel) * side * Math.sign(c.v || 1) > 0) {
          // Moving into it: the car slides along it the way it was going, and turns part of the way to it.
          const into = Math.abs(c.v * sin(rel));
          c.v -= Math.sign(c.v) * into * T.WALL_HIT;
          // Which way along it: the way the car faces (a car driving on slides on, even if a knock had it sliding back).
          const fwd = cos(wrapA((spinning ? c.mh : c.h) - wallTh)) * Math.sign(c.v || 1) >= 0;
          c.mh = fwd ? wallTh : wrapA(wallTh + dmath.PI);
          if (!spinning) c.h = fwd ? wrapA(wallTh + clamp(wrapA(c.h - wallTh), -0.6, 0.6) * 0.35) : c.h;
          if (into > 1.5 && c.wallT <= 0) { emit(state, { k: "wall", car: c.i, hard: into }); S.walls++; if (into > 3.5) c.wobT = T.WOBBLE_T * 0.6; }
          c.wallT = 0.35;
        }
        c.v -= c.v * T.SCRAPE * DT;
        if (c.wallT <= 0) c.wallT = 0.1;
      } else if (c.lat < -(T.HALF + T.EDGE.out) && !c.fin) {
        c.fallT = T.FALL_T + T.HAND_T; c.fallU = c.u; c.air = true; c.vy = 0.8; S.falls++; c.drOn = false; c.boostT = 0;
        emit(state, { k: "fall", car: c.i, u: c.u });
        return;
      }
    }
    // Butter pats on the track, each in its slick: drive over one and you spin round once (a slime only slows a little).
    for (let k = state.drops.length - 1; k >= 0; k--) {
      const d = state.drops[k];
      if (d.k !== "butter" || (d.by === c.i && d.safe > 0) || c.air || spinning) continue;
      if (hypot(c.x - d.x, c.z - d.z) < T.BUTTER_R + 0.25) {
        if (c.trait === "slime") { c.v *= 0.85; emit(state, { k: "trait", car: c.i, trait: "slime", what: "butter" }); }
        else spinCar(c, T.BUTTER_SPIN, T.BUTTER_LOSE, hash(state.seed, d.id) < 0.5 ? -1 : 1);
        state.drops.splice(k, 1);
        hit(state, c, "butter", d.by);
        emit(state, { k: "buttergone", id: d.id, burst: true });
      }
    }
    // The toast lying across the road: driving up it is a hop (said once a time, so the page can name it).
    const onToast = !c.air && state.toast > 0 && toastH(c.u, c.lat, state.toast) > 0.05;
    if (onToast && !c.onToast) emit(state, { k: "onto", car: c.i, what: "toast" });
    c.onToast = onToast;
    // Boost pads: a painted key that winds you up as you cross it.
    if (racing && !c.fin) for (let p = 0; p < T.PADS.length; p++) {
      const pd = T.PADS[p], d = wrapS(c.u - pd.u);
      if (d >= 0 && d < 1.2 && Math.abs(c.lat - pd.lat) < pd.hw && c.y < groundAt(pd.u, pd.lat, state) + 0.3 && !(c.lastPad === p && t - c.lastPadT < 2)) {
        c.lastPad = p; c.lastPadT = t; c.boostT = Math.max(c.boostT, T.PAD_T); c.boostKind = "pad"; S.pads++;
        emit(state, { k: "pad", car: c.i, pad: p });
      }
    }
    // Sweets on doilies: drive through one with nothing in hand and you get a power.
    if (racing && !c.fin && !c.item) {
      const lapN = Math.floor(c.s / LEN);
      for (let k = 0; k < T.BOXES.length && !c.item; k++) {
        const b = T.BOXES[k], d = wrapS(c.u - b.u);
        if (Math.abs(d) > T.BOX_R) continue;
        for (let j = 0; j < b.lats.length; j++) {
          if (state.boxT[k][j] > tau || Math.abs(c.lat - b.lats[j]) > T.BOX_R || c.y - groundAt(b.u, b.lats[j], state) > 1.3) continue;
          // A house car leaves some sweets for the players: one seeded coin for each row of sweets each lap.
          if (c.house && hash(state.seed ^ (c.i * 131), k * 100 + lapN) > T.HOUSE_TAKE) continue;
          state.boxT[k][j] = tau + T.BOX_BACK;
          const place = placeOf(state, c);
          c.item = drawItem(state.seed, c.i, c.picks, place); c.picks++; c.itemT = T.UNWRAP_T; S.items++;
          c.itemWait = 3 + 6 * hash(state.seed ^ 0x3ac, c.i * 50 + c.picks);
          emit(state, { k: "item", car: c.i, item: c.item, box: k, sweet: j, place });
          break;
        }
      }
    }
    // Never stuck: how long it has been below walking pace while it should be racing.
    if (drive && Math.abs(c.v) < 1.0) { c.slow += DT; S.stuck = Math.max(S.stuck, c.slow); } else c.slow = 0;
    // Laps and the line.
    const lapNow = Math.floor(c.s / LEN);
    if (c.s >= 0 && lapNow > c.lap) {
      c.lap = lapNow;
      if (!state.endless && lapNow >= lapsOf(state) && !c.fin) {
        // The moment it crossed the line, between two steps.
        c.fin = true; c.finT = t - (c.s - lapsOf(state) * LEN) / Math.max(c.v, 0.05);
        state.order.push(c.i); c.place = state.order.length;
        if (state.firstFin < 0) { state.firstFin = c.finT; emit(state, { k: "lastcall", car: c.i }); }
        emit(state, { k: "finish", car: c.i, place: c.place, time: c.finT });
      } else emit(state, { k: "lap", car: c.i, lap: lapNow + 1 });
    }
  }

  /** A post at (px, pz) of radius r: a car touching it is put back outside and slides round it, losing a share of
   *  the speed it had into the post. A head-on hit turns it to the side nearer the way the track runs, so it is never pinned. */
  function post(state, c, px, pz, r, what, cherry) {
    const dx = c.x - px, dz = c.z - pz, d = hypot(dx, dz), R = r + T.CAR_R;
    if (d >= R) return;
    // A ghost with its fade ready drifts through (a cherry or an egg too); the fade lasts a moment.
    if (c.phaseT > 0 || (d < R - 0.05 && phaseThrough(state, c, what))) return;
    const nx = dx / (d || 1), nz = dz / (d || 1), S = state.stats[c.i];
    c.x = px + nx * R; c.z = pz + nz * R;
    const vx = cos(c.mh) * c.v, vz = sin(c.mh) * c.v, vn = vx * nx + vz * nz;
    if (vn < 0 && c.v > 0) {
      const into = -vn / c.v; // 1 head-on, 0 glancing
      // Slide along the tangent nearer the way it was going (on a near dead-centre hit, the one nearer the way the track runs).
      const t1 = atan2(nx, -nz), t2 = wrapA(t1 + dmath.PI);
      const pref = Math.abs(wrapA(t1 - c.mh)) - Math.abs(wrapA(t2 - c.mh));
      const tr = trackAt(c.u, 0, P);
      let tan = Math.abs(pref) < 0.25 ? (Math.abs(wrapA(t1 - tr.th)) < Math.abs(wrapA(t2 - tr.th)) ? t1 : t2) : pref < 0 ? t1 : t2;
      const across = (a) => cos(a) * -tr.dz + sin(a) * tr.dx, fwd = (a) => cos(a) * tr.dx + sin(a) * tr.dz;
      // A car already turned part-way by one knock could pick the tangent that runs back down the road on the next
      // (a rolling cherry touches for several steps), and drive the wrong way. A car going on keeps going on.
      if (fwd(tan) < 0 && fwd(c.mh) >= 0) tan = tan === t1 ? t2 : t1;
      // Squeezed between the post and a wall: it bounces back out toward the middle of the track (still facing
      // forward), never on into the corner, so it can never be pinned there.
      if (Math.abs(c.lat) > sideLimit(c.u) - 0.45 && across(tan) * Math.sign(c.lat) > 0) {
        tan = tan === t1 ? t2 : t1;
        if (fwd(tan) < 0) tan = wrapA(tr.th - (Math.sign(c.lat) * dmath.PI) / 4); // out toward the middle
        c.mh = tan; c.v *= 0.7; // it bounces out, still facing on
      } else {
        // A near head-on knock also turns the nose along the post's side (pointing in, a car that was not steering
        // drove back into the post and was pinned there).
        c.mh = tan; if (c.spinT <= 0) c.h = wrapA(tan + clamp(wrapA(c.h - tan), -0.25, 0.25) * (into > 0.6 ? 0.1 : 1));
      }
      // The knock costs speed once; while it slides round the post after that, it only scrubs a little.
      const steady = TR(c).bumpK || 1;
      c.v *= 1 - T.POST_HIT * into * steady * (c.postT > 0 ? 0.04 : 1);
      if (steady < 1 && into > 0.3 && c.postT <= 0) { S.steadied++; emit(state, { k: "trait", car: c.i, trait: "pawn", what }); }
      if (c.postT <= 0) c.postT = 0.35;
      if (cherry) {
        // The cherry is knocked on, away from the car.
        const pr = trackAt(cherry.u, 0, P), along = -nx * pr.dx - nz * pr.dz, acr = nx * pr.dz - nz * pr.dx;
        cherry.vu += along * c.v * 0.5; cherry.vl += acr * c.v * 0.5; cherry.stage = "roll";
      }
      if (-vn > 1.5 && c.knockT <= 0) {
        emit(state, { k: "knock", car: c.i, hard: -vn, what }); c.knockT = 0.4; S.posts++; c.springT = 0.8; // the tin springs back: quick to pick up speed again
        if (what === "pepper" && c.pepperT <= 0) { c.pepperT = 2; hit(state, c, "pepper cloud", -1); }
        if (what === "cherry") hit(state, c, "cherry", -1);
      }
    }
    moved(c);
  }

  /** Bumps: cars push apart; the one doing the hitting loses a little speed, the other is nudged. Nobody flips. */
  function collide(state) {
    const cars = state.cars, R = T.CAR_R * 2;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (a.fallT > 0 || b.fallT > 0 || a.safeT > 0 || b.safeT > 0 || a.fin || b.fin || Math.abs(a.y - b.y) > 0.5) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = hypot(dx, dz);
      if (d >= R || d < 1e-6) continue;
      // A ghost fading (or ready to) slips through a rival.
      if (a.phaseT > 0 || b.phaseT > 0 || phaseThrough(state, a, "car") || phaseThrough(state, b, "car")) continue;
      const nx = dx / d, nz = dz / d, over = R - d;
      a.x -= nx * over * 0.5; a.z -= nz * over * 0.5; b.x += nx * over * 0.5; b.z += nz * over * 0.5;
      const avn = cos(a.mh) * a.v * nx + sin(a.mh) * a.v * nz, bvn = cos(b.mh) * b.v * nx + sin(b.mh) * b.v * nz;
      const closing = avn - bvn;
      if (Math.abs(closing) > 0.3) {
        const rear = closing > 0 ? a : b, front = closing > 0 ? b : a, cl = Math.abs(closing);
        const steady = TR(rear).bumpK || 1, S = state.stats[rear.i];
        rear.v = Math.max(0, rear.v - cl * T.BUMP_LOSE * steady);
        if (steady < 1 && cl > 1.2 && rear.knockT <= 0) { S.steadied++; emit(state, { k: "trait", car: rear.i, trait: "pawn", what: "car" }); }
        front.v = Math.min(front.cap * 1.05, front.v + cl * 0.15);
        if (cl > 2.5) front.wobT = Math.max(front.wobT, T.WOBBLE_T * 0.6);
        if (rear.knockT <= 0) { emit(state, { k: "bump", car: rear.i, into: front.i, hard: cl }); rear.knockT = 0.4; S.bumps++; }
      }
    }
  }

  /** The kitchen moves: the toast, the cherries, the butter and the pepper shots. */
  const TOA = {}, SYQ = {};
  function stepKitchen(state) {
    const tau = state.n * DT;
    toasterAt(tau, TOA); state.toast = TOA.k;
    if (TOA.stage === "warn" && state.toastWarn !== Math.floor((tau + 2.2) / TS.period)) { state.toastWarn = Math.floor((tau + 2.2) / TS.period); emit(state, { k: "toaster" }); }
    if (steamAt(tau) === 1 && state.kettleWarn !== Math.floor(tau / KT.period)) { state.kettleWarn = Math.floor(tau / KT.period); emit(state, { k: "kettle" }); }
    const eg = eggAt(tau, EGQ);
    if (eg.stage === "warn" && state.eggWarn !== Math.floor((tau + EG.phase) / EG.every)) { state.eggWarn = Math.floor((tau + EG.phase) / EG.every); emit(state, { k: "eggwarn" }); }
    const sy = syrupAt(tau, SYQ);
    if (sy.stage === "warn" && state.syrupWarn !== Math.floor((tau + SY.phase) / SY.every)) { state.syrupWarn = Math.floor((tau + SY.phase) / SY.every); emit(state, { k: "syrupwarn" }); }
    // Cherries: each warns on the rim, falls, rolls across toward the outside, slows up the bank, and is gone.
    // On the first lap the bowl drops only every other one.
    for (;;) {
      const plan = cherryPlan(state.seed, state.cherryN);
      if (tau < plan.at - CH.warn) break;
      state.cherryN++;
      if (state.cherries.length >= CH.max || (plan.at < ARM_TAU && plan.n % 2 === 1)) continue;
      const p = trackAt(plan.u, plan.lat, P);
      state.cherries.push({ id: plan.n, at: plan.at, u: plan.u, lat: plan.lat, x: p.x, z: p.z, vu: 0, vl: 0, stage: "warn" });
      emit(state, { k: "cherry", id: plan.n, u: plan.u });
    }
    for (let k = state.cherries.length - 1; k >= 0; k--) {
      const ch = state.cherries[k], since = tau - ch.at;
      if (since < 0) { ch.stage = "warn"; continue; }
      if (since < CH.fall) { ch.stage = "fall"; continue; }
      if (ch.stage === "fall") {
        // It lands: a car right under it takes a soft knock (its shadow warned it).
        ch.stage = "roll"; ch.vl = -CH.roll * BANK_SIDE;
        for (const c of state.cars) if (c.fallT <= 0 && !c.air && hypot(c.x - ch.x, c.z - ch.z) < CH.r + T.CAR_R && c.cherryT <= 0) { c.cherryT = 1; c.v *= 0.8; c.wobT = T.WOBBLE_T; hit(state, c, "cherry", -1, { landed: true }); }
      }
      // Rolling: across toward the outside, slowing as it climbs the bank; a knock from a car sends it on.
      ch.vl -= Math.sign(ch.vl) * Math.min(Math.abs(ch.vl), 0.9 * DT);
      ch.vu -= Math.sign(ch.vu) * Math.min(Math.abs(ch.vu), 2.5 * DT);
      ch.lat += ch.vl * DT; ch.u = wrapU(ch.u + ch.vu * DT);
      const lim = T.HALF - CH.r;
      if (Math.abs(ch.lat) > lim) { ch.lat = Math.sign(ch.lat) * lim; ch.vl = 0; ch.stage = "rest"; }
      trackAt(ch.u, ch.lat, P); ch.x = P.x; ch.z = P.z;
      if (since > CH.fall + CH.life || Math.abs(wrapS(ch.u - (BK.u0 + BK.len / 2))) > BK.len / 2 + 10) { state.cherries.splice(k, 1); emit(state, { k: "cherrygone", id: ch.id }); }
    }
    // Butter pats melt away; pepper shots fly along the loop toward their target and burst on whoever they meet.
    for (let k = state.drops.length - 1; k >= 0; k--) {
      const d = state.drops[k];
      d.life -= DT; if (d.safe > 0) d.safe -= DT;
      if (d.k === "shot") {
        const tg = d.to >= 0 ? state.cars[d.to] : null;
        d.s += T.PEPPER_SPEED * DT; d.u = wrapU(d.u + T.PEPPER_SPEED * DT);
        if (tg) d.lat += clamp(tg.lat - d.lat, -8 * DT, 8 * DT);
        const gy = groundAt(d.u, d.lat, state) + 0.4 + (tg ? Math.max(0, tg.y - groundAt(tg.u, tg.lat, state)) : 0);
        d.y += clamp(gy - d.y, -6 * DT, 6 * DT);
        let done = false;
        for (const c of state.cars) {
          if (c.i === d.by || c.fallT > 0 || (c.fin && !state.endless)) continue;
          if (Math.abs(c.s - d.s) < 0.9 && Math.abs(c.lat - d.lat) < 0.95 && Math.abs(c.y + 0.3 - d.y) < 0.75) {
            c.sneezeT = T.SNEEZE_T; c.v *= 1 - T.PEPPER_LOSE; c.wobT = T.WOBBLE_T; c.drOn = false; c.pepperT = 2;
            hit(state, c, "pepper", d.by); done = true; break;
          }
        }
        if (done || d.life <= 0) { state.drops.splice(k, 1); emit(state, { k: "shotgone", id: d.id, burst: done }); }
      } else if (d.life <= 0) { state.drops.splice(k, 1); emit(state, { k: "buttergone", id: d.id }); }
    }
  }

  const HANDS = {};
  function substep(state) {
    const was = state.t;
    state.n++;
    const t = (state.t = state.n * DT - T.COUNT_IN);
    if (was < 0 && t >= 0) emit(state, { k: "start" });
    // What takes effect at this step: a seat handed to the house or back, then the players' inputs.
    const queue = state.queue;
    while (queue.length && queue[0][0] <= state.n) {
      const e = queue.shift(), c = state.cars[e[1]];
      if (!c || c.house) continue;
      if (e[2] === 0) {
        c.auto = !!e[3];
        // Handed back: it rolls straight on until its player's first input arrives.
        if (!c.auto) { c.inSt = 0; c.inB = BTN.GO; }
        emit(state, { k: "auto", car: c.i, on: c.auto });
      } else if (!c.auto && !(c.fin && !state.endless)) hold(c, e[3], e[4]);
    }
    // The house drives its own cars, a dropped seat, and a finished car's lap of honour: one decision a room tick.
    if (state.n % SUB === 0) for (const c of state.cars) if (c.house || c.auto || (c.fin && !state.endless)) { house.drive(state, c, HANDS); hold(c, HANDS.st, HANDS.b); }
    stepKitchen(state);
    const lead = leaderS(state);
    for (const c of state.cars) stepCar(state, c, lead);
    collide(state);
    if (!state.endless && !state.over) {
      let humans = true, every = true;
      for (const c of state.cars) { if (!c.fin) { every = false; if (!c.house) humans = false; } }
      // Once every player is home, the house cars get a few seconds to finish too, so the card shows times.
      if (humans && state.homeAt === null) state.homeAt = t;
      if (every || (humans && t >= state.homeAt + T.HOUSE_GRACE) || (state.firstFin >= 0 && t >= state.firstFin + (state.call || T.LAST_CALL)) || t >= T.RACE_CAP) { state.over = true; emit(state, { k: "end" }); }
    }
  }

  /** Runs the race up to step `to` (never past its end). What happened is added to state.ev. */
  function advance(state, to) {
    while (state.n < to && !state.over) substep(state);
    state.rev++;
    return state;
  }

  /** Every car, best first: finishers by time, the rest by how far round they got. Fills `out` (no new array a frame). */
  function raceOrder(state, out = []) {
    out.length = 0;
    for (const c of state.cars) out.push(c);
    out.sort((a, b) => (a.fin && b.fin ? a.finT - b.finT : a.fin ? -1 : b.fin ? 1 : b.s - a.s));
    return out;
  }

  /** The seats only (house cars never take a place), place 1 best, equal results sharing a place. */
  function standings(state) {
    const rows = raceOrder(state).filter((c) => !c.house);
    const key = (c) => (c.fin ? "t" + Math.round(c.finT * 1000) : "s" + Math.round(c.s * 100));
    let place = 0;
    return rows.map((c, i) => { if (i === 0 || key(c) !== key(rows[i - 1])) place = i + 1; return { seat: c.seat, place }; });
  }

  // ---- A race as plain data: what a snapshot carries, and what a page starts or corrects itself from ----
  /** The whole race as plain JSON: enough to carry on from, in the room or on a page. Shares nothing with `state`. */
  /** Everything a race keeps but its cars, copied (the same names in a race and in a dump). */
  function copyRace(src) {
    return {
      seed: src.seed, round: src.round, startAt: src.startAt, delay: src.delay, n: src.n, endless: src.endless,
      over: src.over, firstFin: src.firstFin, homeAt: src.homeAt, toast: src.toast,
      order: src.order.slice(), cherries: src.cherries.map((c) => ({ ...c })), cherryN: src.cherryN, drops: src.drops.map((d) => ({ ...d })), dropN: src.dropN,
      boxT: src.boxT.map((row) => row.slice()), toastWarn: src.toastWarn, kettleWarn: src.kettleWarn, eggWarn: src.eggWarn, syrupWarn: src.syrupWarn,
      queue: src.queue.map((e) => e.slice()),
      room: { q: src.room.q.slice(), sent: src.room.sent.map((s) => s.slice()), lastN: src.room.lastN.slice(), count: src.room.count.slice() },
      // A test run's short race only (absent otherwise, so every other race is as it was, to the bit).
      ...(src.laps ? { laps: src.laps, call: src.call } : {}),
    };
  }
  /** The whole race as plain JSON: enough to carry on from, in the room or on a page. Shares nothing with `state`.
   *  Each car is a list of values in the order of CAR_KEYS (the names would be half of every snapshot). */
  function dump(state) {
    return { v: VERSION, ...copyRace(state), cars: state.cars.map((c) => CAR_KEYS.map((k) => c[k])) };
  }
  /** A race to carry on from a dump (a snapshot). Throws when other rules made it. */
  function load(d) {
    if (!d || d.v !== VERSION) throw new Error(`tin derby: this race was saved by rules version ${d && d.v}, and these are version ${VERSION}`);
    const state = copyRace(d);
    state.cars = d.cars.map((row) => { const c = {}; for (let k = 0; k < CAR_KEYS.length; k++) c[CAR_KEYS[k]] = row[k]; return c; });
    return fresh(state);
  }
  /** A separate copy of a race, to run ahead of the room's word and throw away. */
  const clone = (state) => load(dump(state));
  /** A short word for a race as it stands: two races are the same, to the last bit, when their words are. (What the room has only heard is left out.) */
  function fingerprint(state) {
    const d = dump(state);
    delete d.room;
    const text = JSON.stringify(d);
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); a = Math.imul(a ^ ch, 16777619); b = Math.imul(b + ch, 0x5bd1e995) ^ (b >>> 13); }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }

  const snaps = new WeakMap();
  const game = {
    id: "tin-derby",
    minSeats: 1,
    maxSeats: 4,
    tickHz: 30,
    snapshotEvery: 30, // a whole race once a second; pages stay in step from the events in between
    create(ctx) { return createRace(ctx); },
    /** A message from a seat's page (takeMessage): hands are queued for their step, and everyone is told at the next tick. */
    input(state, seat, data, now) { takeMessage(state, seat, data, now); },
    /**
     * The room calls this each tick for a seat whose phone has dropped. It sends no inputs: it notes that the
     * seat is the house's this tick, and the rules drive the car themselves from the next step (as they drive the
     * house cars), until a tick comes in which the room no longer asks.
     */
    bot(state, seat) {
      const c = carOf(state, seat);
      if (c && !c.house) state.host.mark[c.i] = true;
      return [];
    },
    /** Advances the race to `now`, less the delay, in fixed steps. Returns what every page must be told. */
    tick(state, now) {
      const H = state.host;
      state.ev.length = 0;
      for (const c of state.cars) {
        if (c.house) continue;
        H.away[c.i] = H.mark[c.i];
        H.mark[c.i] = false;
        settleHouse(state, c, now);
      }
      const before = state.n;
      advance(state, Math.min(stepOf(state, now - state.delay), state.n + NET.CATCH_UP));
      H.ticks++;
      if (state.net.length || (state.n > before && H.ticks % NET.BEAT === 0) || (state.over && !H.said)) { state.net.push({ k: "n", n: state.n }); H.said = state.over; }
      return state.net.splice(0);
    },
    /** The whole race, the same for every viewer: nothing in a race is secret. */
    snapshot(state) {
      const kept = snaps.get(state);
      if (kept && kept.rev === state.rev) return kept.s;
      const s = dump(state);
      snaps.set(state, { rev: state.rev, s });
      return s;
    },
    isOver(state) { return state.over; },
    /** Best first: each seat's place, and its time (finished) or how far it got in car lengths (not finished). */
    result(state) {
      return standings(state).map((p) => { const c = carOf(state, p.seat); return { seat: p.seat, place: p.place, ...(c.fin ? { time: Math.round(c.finT * 1000) / 1000 } : { distance: Math.round(c.s * 100) / 100 }) }; });
    },
    standings,
  };
  /**
   * The same game for a room with its test games on (lobby/wall.js hangs it only on the test wall, where
   * PARTY_TEST_GAMES is "on"): its races take a test run's {short: 1}. Production's wall has `game`, which never does.
   */
  const testGame = { ...game, create(ctx) { const state = createRace(ctx); state.tests = true; return state; } };

  return { T, course, house, game, testGame, VERSION, DT, SUB, LEN, CAR_KEYS, createRace, carOf, stepOf, readInput, takeInput, takeMessage, hear, hold, enqueue, advance, raceOrder, standings, placeOf, drawItem, dump, load, clone, fingerprint, lapsOf };
}

/** The rules for the numbers in data/tune.js: what the party room runs. */
export const rules = makeRules(TUNE);
export const game = rules.game;
/** The same, for a room with its test games on only (lobby/wall.js, the test wall): it takes a test run's short race. */
export const testGame = rules.testGame;
