// Where do the corks end up? Plays one bot round and counts the corks at rest by place.
import { game, createBattle } from "../game/shared/battle.js";

const seats = [{ seat: 0, name: "Bot", kind: "bot" }];
const st = createBattle({ seed: Number(process.argv[2] ?? 7), seats, now: 0, botSkill: 0.95, delay: 0 });
let now = 0;
while (!game.isOver(st) && now < 120000) {
  now += 16;
  for (const d of game.bot(st, 0, now)) game.input(st, 0, d, now);
  game.tick(st, now);
}
const sim = st.stalls[0];
const where = {};
for (const c of sim.rested) {
  const key = c[1] > 1.6 ? "far step" : c[1] > 1.3 ? "mid step" : c[1] > 0.99 ? "front step" : c[1] > 0.9 ? "counter" : "floor";
  where[key] = (where[key] ?? 0) + 1;
}
console.log("score", sim.score, "hits", sim.hits, "shots", sim.shots, "rested", sim.rested.length, JSON.stringify(where));
