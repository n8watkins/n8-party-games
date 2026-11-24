// A check for whoever carries a change from the preview into these rules (or back): runs the preview's own
// sim.js and these rules side by side, on the preview's numbers and with the engine's own maths (the one
// place the rules are built without dmath), fed the same key presses by the preview's scripted drivers,
// and compares every car at every frame. They must agree exactly: any difference is a rule that was
// carried over wrongly, and the first frame it shows at is printed.
//   node games/tin-derby/tools/parity.mjs <the preview's folder> [races=6] [seed0=1]
// The preview's folder holds src/sim.js, src/tune.js and tools/drivers.mjs (round five reviewed and later).
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { makeRules } from "../shared/rules.js";
import { TUNE, retune } from "../data/tune.js";

const [dir, nArg = "6", s0 = "1"] = process.argv.slice(2);
if (!dir) { console.error("usage: node tools/parity.mjs <the preview's folder> [races] [seed0]"); process.exit(2); }
const from = (p) => import(pathToFileURL(resolve(dir, p)).href);
const [{ game: theirs }, { TUNE: THEIR_TUNE }, { makeDriver, decide }] = await Promise.all([from("src/sim.js"), from("src/tune.js"), from("tools/drivers.mjs")]);

const engine = { sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2, hypot: Math.hypot, wrapA: (a) => Math.atan2(Math.sin(a), Math.cos(a)) };
const ours = makeRules(retune({}, { ...JSON.parse(JSON.stringify(THEIR_TUNE)), NET: TUNE.NET }), { math: engine, preview: true });
const differs = Object.keys(THEIR_TUNE).filter((k) => JSON.stringify(THEIR_TUNE[k]) !== JSON.stringify(TUNE[k]));
console.log(differs.length ? `numbers that differ between the preview and data/tune.js: ${differs.join(", ")}` : "the preview's numbers and data/tune.js are the same");

const FIELDS = ["x", "z", "h", "mh", "v", "y", "vy", "u", "lat", "s", "st", "boostT", "spinT", "item", "fin", "finT", "lap", "fallT"];
const CHARS = ["pawn", "ghost", "slime", "robot"];
let bad = 0, frames = 0;
for (const style of ["plain", "sloppy", "handsoff"]) {
  for (let k = 0; k < +nArg; k++) {
    const seed = +s0 + k, character = CHARS[k % 4];
    const seats = [{ seat: 0, name: "You", character, colour: "#c8382c" }];
    const house = CHARS.filter((c) => c !== character).map((c) => ({ character: c }));
    const a = theirs.create({ seed, seats, now: 0, house });
    const b = ours.createRace({ seed, seats, now: 0, house, delay: 0 });
    const m = makeDriver(style, seed);
    let clock = 0, first = null;
    for (let f = 0; f < 60 * 140 && !a.over && !first; f++) {
      clock += 1000 / 60;
      const c = a.cars[0];
      const key = decide(m, { x: c.x, z: c.z, h: c.h, v: c.v, u: c.u, lat: c.lat, s: c.s, air: c.air, item: c.item, itemT: c.itemT }, a.t, a.cars.slice(1), a);
      const msg = { c: [null, (key.right ? 1 : 0) - (key.left ? 1 : 0), key.up ? 1 : 0, key.down ? 1 : 0, key.drift ? 1 : 0, key.use ? 1 : 0] };
      // (Once home, the keys are let go: the preview lets a finished car's player fight the house's lap of honour
      // for three steps in four, and these rules do not, on purpose.)
      if (!c.fin) { theirs.input(a, 0, msg, clock); ours.takeInput(b, 0, msg, clock); }
      theirs.tick(a, clock);
      ours.advance(b, ours.stepOf(b, clock));
      frames++;
      for (let i = 0; i < 4 && !first; i++) for (const fld of FIELDS) if (a.cars[i][fld] !== b.cars[i][fld]) { first = `frame ${f} (t ${a.t.toFixed(2)}), car ${i} ${a.cars[i].name}, ${fld}: preview ${a.cars[i][fld]}, rules ${b.cars[i][fld]}`; break; }
      if (!first && a.over !== b.over) first = `frame ${f}: preview over ${a.over}, rules over ${b.over}`;
    }
    if (first) { bad++; console.log(`DIFFERENT ${style} seed ${seed} as the ${character}: ${first}`); }
    else console.log(`same      ${style} seed ${seed} as the ${character}: to the end (t ${a.t.toFixed(1)}), result ${JSON.stringify(theirs.result(a))}`);
    if (!first && JSON.stringify(theirs.result(a)) !== JSON.stringify(ours.game.result(b))) { bad++; console.log(`DIFFERENT result: rules ${JSON.stringify(ours.game.result(b))}`); }
  }
}
console.log(bad ? `FAILED: ${bad} races differ` : `PASSED: every car the same at every one of ${frames} frames`);
process.exit(bad ? 1 : 0);
