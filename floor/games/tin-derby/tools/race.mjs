// Whole races, headless, on the rules alone: scripted players (tools/drivers.mjs) in the seats, house cars in
// the rest. The tests use runRace; run as a script it prints a table of places, as the preview's simrace did.
//   node floor/games/tin-derby/tools/race.mjs [plain|sloppy|handsoff|all] [races=40] [seed0=1] [humans=1]
// Every frame it also checks every car is inside the walls (except off the open edge), is facing the way the
// road runs, and is making ground.
import { fileURLToPath } from "node:url";
import { wrapA } from "../shared/dmath.js";
import { rules as RULES } from "../shared/rules.js";
import { makePlayer } from "./drivers.mjs";

const COLOURS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"];

/**
 * One race. `humans`: one entry a seat, each {style, character?, touch?, seat?}. Inputs are given the way a solo
 * page gives them (no delay, taking effect at the next step), sixty frames a second.
 * `onFrame(state, frame)` is called after each frame, for a test that wants to look or to meddle.
 */
export function runRace(rules, { seed = 1, humans = [{ style: "plain" }], onFrame = null, capSeconds = rules.T.RACE_CAP + 10 } = {}) {
  const T = rules.T, { sideLimit, trackAt, onEdge, jumpAt, wrapS } = rules.course;
  const seats = humans.map((h, i) => ({ seat: h.seat ?? i, name: h.name || (humans.length === 1 ? "You" : `P${i + 1}`), character: h.character, colour: COLOURS[i] }));
  const st = rules.createRace({ seed, seats, now: 0, delay: 0 });
  const players = humans.map((h, i) => makePlayer(rules, h.style, seed + i * 1009, { touch: !!h.touch }));
  const hits = {}, items = {}, used = {}, spills = {}, jumps = [], events = {};
  const wrong = [0, 0, 0, 0], sHist = [[], [], [], []], lastLeap = [null, null, null, null];
  let clock = 0, outside = 0, worstOut = 0, wrongWay = 0, leastGain = Infinity, frames = 0, bad = "";
  const tp = {};
  for (let f = 0; f < 60 * capSeconds && !st.over; f++) {
    clock += 1000 / 60;
    for (let i = 0; i < humans.length; i++) { const c = st.cars[i]; if (!c.fin) rules.takeInput(st, c.seat, players[i].frame(st, c, null), clock); }
    rules.advance(st, rules.stepOf(st, clock));
    frames++;
    for (const e of st.ev) {
      events[e.k] = (events[e.k] || 0) + 1;
      if (e.car === undefined || st.cars[e.car].house) continue;
      const c = st.cars[e.car];
      if (e.k === "leap" && !c.fin) lastLeap[e.car] = e; // not the slow lap of honour after the finish
      if (e.k === "land" && lastLeap[e.car]) {
        const L = lastLeap[e.car]; lastLeap[e.car] = null;
        const j = jumpAt(L.u);
        if (j) jumps.push({ name: j.name, v: L.v, cleared: j.clear ? wrapS(e.u - j.clear) >= 0 : true, air: e.air });
      }
      if (e.k === "hit") hits[e.what] = (hits[e.what] || 0) + 1;
      if (e.k === "spill") spills[e.what] = (spills[e.what] || 0) + 1;
      if (e.k === "item") items[e.item] = (items[e.item] || 0) + 1;
      if (e.k === "use") used[e.item] = (used[e.item] || 0) + 1;
    }
    st.ev.length = 0;
    for (const o of st.cars) {
      for (const k of ["x", "z", "h", "mh", "v", "y", "vy", "u", "lat", "s", "st"]) if (!Number.isFinite(o[k]) && !bad) bad = `frame ${f}: ${o.name}'s ${k} is ${o[k]}`;
      if (o.fallT > 0) continue;
      // Inside the walls: the open edge's outside is the only way out, and it ends in a fall.
      const lim = sideLimit(o.u) + 0.02, open = o.lat < 0 && onEdge(o.u), over = open ? 0 : Math.abs(o.lat) - lim;
      if (over > 0) { outside++; worstOut = Math.max(worstOut, over); }
      // Ground made over any 4 s of racing (a car stuck, or sliding backwards round the loop, would show here).
      if (st.t > 0 && !o.fin && f % 15 === 0) { const sh = sHist[o.i]; sh.push(o.s); if (sh.length > 16) leastGain = Math.min(leastGain, o.s - sh.shift()); }
      // Facing the wrong way round the loop (a knock that turned a car round): how long, at most.
      if (st.t > 0 && !o.fin && Math.abs(wrapA(o.h - trackAt(o.u, 0, tp).th)) > 2.0) { wrong[o.i] += 1 / 60; wrongWay = Math.max(wrongWay, wrong[o.i]); } else wrong[o.i] = 0;
    }
    if (onFrame) onFrame(st, f);
  }
  const order = rules.raceOrder(st);
  return {
    seed, state: st, frames, bad, over: st.over,
    /** Each human's place among all four cars, in seat order. */
    places: humans.map((h, i) => order.indexOf(st.cars[i]) + 1),
    times: humans.map((h, i) => (st.cars[i].fin ? st.cars[i].finT : null)),
    allFinished: st.cars.every((c) => c.fin),
    stuck: Math.max(...st.stats.map((s) => s.stuck)),
    falls: st.stats.map((s) => s.falls), stats: st.stats,
    outside, worstOut, wrongWay, leastGain, hits, items, used, spills, jumps, events,
    field: order.map((c) => `${c.name}${c.fin ? " " + c.finT.toFixed(1) : ""}`).join(", "),
    fingerprint: rules.fingerprint(st),
  };
}

/** Places 1st to 4th of the first seat over `races` seeds, and what went wrong in any of them. */
export function tally(rules, style, races, seed0 = 1, more = {}) {
  const rows = [];
  for (let k = 0; k < races; k++) rows.push(runRace(rules, { seed: seed0 + k, humans: [{ style, ...more }] }));
  return {
    rows, places: [1, 2, 3, 4].map((p) => rows.filter((r) => r.places[0] === p).length),
    finished: rows.filter((r) => r.times[0] !== null).length, outside: rows.reduce((a, r) => a + r.outside, 0),
    stuck: Math.max(...rows.map((r) => r.stuck)), wrongWay: Math.max(...rows.map((r) => r.wrongWay)), leastGain: Math.min(...rows.map((r) => r.leastGain)),
    bad: rows.map((r) => r.bad).filter(Boolean),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [which = "all", nArg = "40", s0 = "1", nHumans = "1"] = process.argv.slice(2);
  const styles = which === "all" ? ["plain", "sloppy", "handsoff"] : [which];
  const sum = (rows, key) => { const o = {}; for (const r of rows) for (const [k, v] of Object.entries(r[key])) o[k] = (o[k] || 0) + v; return Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ") || "none"; };
  for (const style of styles) {
    const more = process.env.TOUCH === "1" ? { touch: true } : {};
    if (+nHumans > 1) {
      const rows = [];
      for (let k = 0; k < +nArg; k++) rows.push(runRace(RULES, { seed: +s0 + k, humans: Array.from({ length: +nHumans }, (_, i) => ({ style, character: ["pawn", "ghost", "slime", "robot"][i], ...more })) }));
      for (const r of rows) console.log(`seed ${r.seed}: places ${r.places.join("/")}  [${r.field}]  slowest ${r.stuck.toFixed(2)}s`);
      continue;
    }
    const t = tally(RULES, style, +nArg, +s0, { character: process.env.CHAR || "pawn", ...more });
    console.log(`=== ${style}: ${t.rows.length} races from seed ${s0}`);
    console.log(`places 1st..4th: ${t.places.join(" / ")}   finished ${t.finished}/${t.rows.length}   worst slow stretch (any car) ${t.stuck.toFixed(2)}s   frames outside a wall ${t.outside}   longest facing the wrong way ${t.wrongWay.toFixed(2)}s   least ground made in any 4 s ${t.leastGain.toFixed(1)} lengths`);
    console.log(`powers drawn: ${sum(t.rows, "items")}; used: ${sum(t.rows, "used")}; hits taken: ${sum(t.rows, "hits")}; spills driven into: ${sum(t.rows, "spills")}`);
    if (t.bad.length) console.log("BAD: " + t.bad.join("; "));
  }
}
