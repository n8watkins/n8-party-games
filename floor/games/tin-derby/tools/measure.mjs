// The figures in README.md, "Measured": what a room tick costs, how big a snapshot is, and how many bytes a
// second a race sends each player. No sockets and no browser (tools/net.mjs).
//   node floor/games/tin-derby/tools/measure.mjs
// Times are CPU time of this process, so a busy machine changes them little; they are still one machine's.
import { rules } from "../shared/rules.js";
import { START, runNet } from "./net.mjs";

const game = rules.game, T = rules.T;
const kb = (n) => (n / 1024).toFixed(2) + " kB";

// ---- A room tick: four steps of four cars, house drivers and all ----
{
  const seats = [0, 1].map((seat) => ({ seat, name: `P${seat}`, kind: "human" }));
  let steps = 0, ticks = 0, worst = 0;
  const cpu0 = process.cpuUsage();
  for (let seed = 1; seed <= 20; seed++) {
    const st = game.create({ seed, seats, now: START, round: 1 });
    for (let k = 1; !game.isOver(st) && k < 30 * 130; k++) {
      const now = START + k * 33;
      game.bot(st, 0, now); game.bot(st, 1, now); // both seats driven by the house: the dearest case
      const t0 = performance.now();
      game.tick(st, now);
      worst = Math.max(worst, performance.now() - t0);
      ticks++;
    }
    steps += st.n;
  }
  const cpu = process.cpuUsage(cpu0), ms = (cpu.user + cpu.system) / 1000;
  console.log(`room tick: ${(ms / ticks).toFixed(3)} ms of CPU a tick on average (${((ms / steps) * 1000).toFixed(1)} microseconds a step), over ${ticks} ticks of 20 races; the slowest single tick took ${worst.toFixed(2)} ms of wall time`);
  console.log(`  a race second costs ${((ms / ticks) * 30).toFixed(2)} ms of CPU: ${(((ms / ticks) * 30) / 10).toFixed(2)}% of one core`);
  const st = game.create({ seed: 1, seats, now: START, round: 1 });
  game.tick(st, START + 30_000);
  const t0 = performance.now();
  for (let k = 0; k < 2000; k++) { st.rev++; JSON.stringify(game.snapshot(st, START, { role: "screen" })); }
  console.log(`  building a snapshot and turning it into text: ${((performance.now() - t0) / 2000).toFixed(3)} ms`);
}

// ---- Bytes on the wire: whole races, every message as the party room sends it ----
for (const [name, phones] of [
  ["4 players on keys (a steer is left, right or nothing)", [0, 1, 2, 3].map((i) => ({ style: i === 2 ? "sloppy" : "plain", up: 40, down: 40 }))],
  ["4 players with thumbs that never rest (the most a page may send)", [0, 1, 2, 3].map((i) => ({ style: i === 2 ? "sloppy" : "plain", up: 40, down: 40, wobble: true }))],
  ["1 player and three house cars", [{ style: "plain", up: 40, down: 40 }]],
]) {
  const net = runNet(rules, { seed: 7, phones, check: false }), s = net.stats, sec = s.seconds;
  const up = s.up.reduce((a, u) => a + u.bytes, 0) / s.up.length, upN = s.up.reduce((a, u) => a + u.n, 0) / s.up.length;
  console.log(`${name}: a race of ${sec.toFixed(0)} s`);
  console.log(`  down, to each viewer: ${kb((s.down.evBytes + s.down.snapBytes) / sec)} a second (events ${kb(s.down.evBytes / sec)} in ${(s.down.ev / sec).toFixed(1)} messages a second, the largest ${s.down.evMax} bytes; snapshots ${kb(s.down.snapBytes / sec)}, one a second, ${Math.round(s.down.snapBytes / s.down.snap)} bytes each, the largest ${s.down.snapMax})`);
  console.log(`  up, from each player: ${Math.round(up / sec)} bytes a second in ${(upN / sec).toFixed(1)} messages a second (${Math.round(up / upN)} bytes each)`);
  console.log(`  a whole race: ${kb(s.down.evBytes + s.down.snapBytes)} down to each viewer, ${kb(up)} up from each player; the room was awake ${sec.toFixed(1)} s: ${(sec * 0.128).toFixed(1)} GB-seconds`);
}
console.log(`for comparison, a snapshot at every tick (no events, pages only draw what they are sent): about ${kb(3300 * 30)} a second to each viewer`);
void T;
