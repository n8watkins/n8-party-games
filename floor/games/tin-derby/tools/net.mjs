// A party room and its phones, on a made-up clock with made-up delays: no sockets, no timers, no browser.
// The room side does exactly what the party room does for a ticking game (lobby/server/lobby-core.js, gameTick):
// each tick it asks game.bot for every seat whose phone is not connected, calls game.tick, sends the events to
// everyone as {t: "ev", ev, now}, and every game.snapshotEvery ticks a snapshot as {t: "snap", s, now}; a phone's
// input arrives as {t: "in", d}. Every message really is turned into text and back, and its length counted.
// Each phone runs the replica (shared/replica.js) and a scripted player (tools/drivers.mjs) who sees only what
// the replica predicts. The tests and tools/measure.mjs use it.
import { makeReplica } from "../shared/replica.js";
import { BTN } from "../shared/rules.js";
import { makePlayer } from "./drivers.mjs";

export const START = 1_700_000_000_000;
const COLOURS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"];

/**
 * phones: one a seat, {style, character?, touch?, up, down (ms each way), jitter (ms, added at random to each
 * message), dropAt, backAt (seconds of race clock: the socket closes, and opens again), reload (a fresh page on
 * the way back, not just a new socket), wobble (a thumb that never rests: the steer changes every frame), freezeAt,
 * freezeFor (seconds: the page stalls without closing its socket, hearing and saying nothing), silent (seconds of
 * race clock before the page says its first word, as one that loads late; true: it never does)}.
 * screens: [{down, joinAt}] watch without a seat. `check` compares every phone's copy with the room's at every
 * step the room says it has reached. `until` (seconds on the race clock) stops early.
 */
export function runNet(rules, { seed = 1, phones = [{ style: "plain" }], screens = [], tickMs = Math.round(1000 / rules.game.tickHz), frameMs = 1000 / 60, tickJitter = 0, check = true, until = Infinity, onTick = null } = {}) {
  const game = rules.game, T = rules.T;
  const seats = phones.map((p, i) => ({ seat: p.seat ?? i, name: p.name || `P${i + 1}`, kind: "human", colour: COLOURS[i], ...(p.character ? { character: p.character } : {}) }));
  const state = game.create({ seed, seats, now: START, round: 1 });
  let rnd = 0;
  const chance = () => rules.course ? hashOf(seed, ++rnd) : 0;
  const hashOf = (a, b) => { let h = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const text = (m) => JSON.stringify(m);
  const stats = { ticks: 0, steps: 0, relay: [], prints: new Map(), down: { ev: 0, snap: 0, evBytes: 0, snapBytes: 0, snapMax: 0, evMax: 0 }, up: phones.map(() => ({ n: 0, beats: 0, bytes: 0 })), mismatches: [], checked: 0, maxQueue: 0, tickSteps: [] };

  const viewers = [];
  const start = text({ t: "snap", s: game.snapshot(state, START, { role: "screen" }), now: START, full: true });
  phones.forEach((p, i) => viewers.push({ kind: "phone", i, seat: seats[i].seat, p, connected: true, inbox: [], replica: makeReplica(rules, JSON.parse(start).s, { seat: seats[i].seat }), player: makePlayer(rules, p.style || "plain", seed + i * 1009, { touch: !!p.touch }), nextFrame: START + (i * frameMs) / 4, shown: new Map(), sent: 0, wasDropped: false }));
  screens.forEach((s) => viewers.push({ kind: "screen", p: s, connected: !(s.joinAt > 0), inbox: [], replica: s.joinAt > 0 ? null : makeReplica(rules, JSON.parse(start).s), nextFrame: Infinity, shown: new Map() }));
  const toRoom = []; // [arrives, seat, text]
  const lag = (ms, p) => ms + (p.jitter ? chance() * p.jitter : 0);

  function deliver(v, message, now) {
    if (!v.connected) return;
    const at = now + lag(v.p.down || 0, v.p);
    // A socket keeps its order: nothing overtakes what was sent before it.
    v.inbox.push([Math.max(at, v.inbox.length ? v.inbox[v.inbox.length - 1][0] : 0), message]);
  }
  function roomTick(now) {
    for (const v of viewers) if (v.kind === "phone" && !v.connected) for (const data of game.bot(state, v.seat, now) ?? []) game.input(state, v.seat, data, now);
    const before = state.n;
    const events = game.tick(state, now) ?? [];
    stats.ticks++; stats.steps = state.n; stats.tickSteps.push(state.n - before);
    stats.maxQueue = Math.max(stats.maxQueue, state.queue.length);
    for (const e of events) stats.relay.push(e);
    // (Before the first step and after the last, several ticks end at the same step, with more heard each time.)
    if (check) stats.prints.set(state.n, [...(stats.prints.get(state.n) || []), rules.fingerprint(state)]);
    if (events.length) { const m = text({ t: "ev", ev: events, now }); stats.down.ev++; stats.down.evBytes += m.length; stats.down.evMax = Math.max(stats.down.evMax, m.length); for (const v of viewers) deliver(v, m, now); }
    if (stats.ticks % (game.snapshotEvery ?? 15) === 0 || game.isOver(state)) { const m = text({ t: "snap", s: game.snapshot(state, now, { role: "screen" }), now }); stats.down.snap++; stats.down.snapBytes += m.length; stats.down.snapMax = Math.max(stats.down.snapMax, m.length); for (const v of viewers) deliver(v, m, now); }
    if (onTick) onTick(state, now, api);
  }
  /** A socket opens (again): the room sends the whole race, as it does to any socket that connects mid-game. */
  function connect(v, now, fresh) {
    v.connected = true; v.inbox.length = 0;
    const m = text({ t: "snap", s: game.snapshot(state, now, { role: "screen" }), now, full: true });
    stats.down.snapBytes += m.length;
    // Until that snapshot lands the page shows nothing new; a reloaded page then starts a new copy from it.
    v.fresh = true;
    if (fresh) v.replica = null;
    deliver(v, m, now);
  }
  function read(v, now) {
    while (v.inbox.length && v.inbox[0][0] <= now) {
      const m = JSON.parse(v.inbox.shift()[1]);
      if (m.t === "snap") {
        if (!v.replica) v.replica = makeReplica(rules, m.s, v.kind === "phone" ? { seat: v.seat } : {});
        else v.replica.snapshot(m.s);
        v.fresh = false;
      } else if (m.t === "ev" && v.replica && !v.fresh) {
        v.replica.events(m.ev);
        const last = m.ev[m.ev.length - 1];
        if (check && last && last.k === "n") {
          stats.checked++;
          const want = stats.prints.get(last.n), got = rules.fingerprint(v.replica.auth);
          if (v.replica.auth.n !== last.n || !want || !want.includes(got)) stats.mismatches.push({ viewer: viewers.indexOf(v), n: last.n, at: v.replica.auth.n });
        }
      }
    }
  }
  function up(v, msg, now) {
    const t = text({ t: "in", d: msg }), u = stats.up[v.i];
    if (msg.c) u.n++; else u.beats++;
    u.bytes += t.length;
    toRoom.push([now + lag(v.p.up || 0, v.p), v.seat, t]);
    toRoom.sort((a, b) => a[0] - b[0]);
  }
  function frame(v, now) {
    // A phone that stalls without closing its socket (freezeAt, freezeFor): it hears nothing and says nothing.
    const sec = (now - START) / 1000 - T.COUNT_IN;
    if (v.p.freezeAt !== undefined && sec >= v.p.freezeAt && sec < v.p.freezeAt + (v.p.freezeFor || 0)) return;
    read(v, now);
    if (!v.connected || !v.replica || v.fresh) return;
    const pred = v.replica.predict(now);
    v.shown.set(pred.n, pred.cars.map((c) => [c.x, c.z]));
    const c = pred.cars[v.replica.car];
    if (c.fin || pred.over) return;
    const quiet = v.p.silent !== undefined && sec < (v.p.silent === true ? Infinity : v.p.silent);
    if (!quiet) {
      const m = v.player.frame(pred, c, now);
      let steer = m.c[1];
      if (v.p.wobble) steer = Math.max(-1, Math.min(1, steer * 0.6 + Math.sin(now / 90 + v.i) * 0.4));
      const msg = v.replica.input(now, steer, m.c[2], m.c[3], m.c[4], m.c[5]);
      if (msg) up(v, msg, now);
    }
    // A page with nothing new to say still says it is there (`silent`: a page that has not loaded yet says nothing).
    const beat = quiet ? null : v.replica.beat(now);
    if (beat) up(v, beat, now);
  }

  const api = { state, viewers, stats, connect };
  let nextTick = START + tickMs, now = START;
  const raceAt = (sec) => START + (T.COUNT_IN + sec) * 1000;
  for (let guard = 0; guard < 2_000_000 && !game.isOver(state) && now < raceAt(until); guard++) {
    // Whatever is next: an input reaching the room, a tick, or a phone's frame.
    let t = nextTick, what = -1;
    if (toRoom.length && toRoom[0][0] <= t) { t = toRoom[0][0]; what = -2; }
    for (let k = 0; k < viewers.length; k++) if (viewers[k].kind === "phone" && viewers[k].nextFrame < t) { t = viewers[k].nextFrame; what = k; }
    now = t;
    for (const v of viewers) {
      const p = v.p, sec = (now - START) / 1000 - T.COUNT_IN;
      if (v.kind === "phone" && v.connected && p.dropAt !== undefined && sec >= p.dropAt && !v.wasDropped) { v.connected = false; v.wasDropped = true; v.inbox.length = 0; }
      if (v.kind === "phone" && !v.connected && v.wasDropped && p.backAt !== undefined && sec >= p.backAt && !v.back) { v.back = true; connect(v, now, !!p.reload); }
      if (v.kind === "screen" && !v.connected && sec >= v.p.joinAt) connect(v, now, true);
    }
    if (what === -2) { const [, seat, m] = toRoom.shift(); const v = viewers.find((x) => x.seat === seat); if (v.connected) game.input(state, seat, JSON.parse(m).d, now); }
    else if (what === -1) { roomTick(now); nextTick += tickMs + (tickJitter ? Math.round((chance() - 0.3) * tickJitter) : 0); }
    else { frame(viewers[what], now); viewers[what].nextFrame += frameMs; }
  }
  // Let what is still in flight land, so every copy has heard the end.
  for (const v of viewers) read(v, now + 5000);
  stats.seconds = (now - START) / 1000;
  return api;
}

/**
 * How far what each phone showed was from what the room made of the same step, in car lengths: its own car, and
 * the others. The room's race at every step is made again from what it relayed (a race is a function of that).
 */
export function shownError(rules, net) {
  const seats = net.state.cars.filter((c) => !c.house).map((c) => ({ seat: c.seat, name: c.name, character: c.character, colour: c.colour }));
  const truth = rules.createRace({ seed: net.state.seed, seats, now: net.state.startAt });
  // Everything the room relayed, heard at once: each entry carries its own step.
  for (const e of net.stats.relay) if (e.k !== "n") rules.hear(truth, e);
  const out = net.viewers.map(() => ({ own: { n: 0, sum: 0, max: 0 }, rivals: { n: 0, sum: 0, max: 0 } }));
  for (let n = 1; n <= net.state.n; n++) {
    rules.advance(truth, n);
    net.viewers.forEach((v, vi) => {
      const shown = v.shown.get(n);
      if (!shown || truth.t < 0) return;
      truth.cars.forEach((c, i) => {
        if (c.fallT > 0) return;
        const d = Math.hypot(shown[i][0] - c.x, shown[i][1] - c.z), into = v.replica && i === v.replica.car ? out[vi].own : out[vi].rivals;
        into.n++; into.sum += d; into.max = Math.max(into.max, d);
      });
    });
  }
  return { rows: out.map((o) => ({ own: { mean: o.own.n ? o.own.sum / o.own.n : 0, max: o.own.max, frames: o.own.n }, rivals: { mean: o.rivals.n ? o.rivals.sum / o.rivals.n : 0, max: o.rivals.max } })), truth: rules.fingerprint(truth) };
}

export { BTN };
