// The same races, whatever runs them: a fixed set of scripted races and the fingerprint each must end with.
// test/golden.json holds what Node gave; test/determinism.test.js checks Node still gives it and, where Bun is
// installed, that JavaScriptCore (the engine of every iPhone browser) gives the very same.
//   node games/tin-derby/tools/fingerprints.mjs         print them as JSON (bun runs the same file)
//   node games/tin-derby/tools/fingerprints.mjs --write    write test/golden.json again, after a change to
//                                                                the rules or the numbers that was meant
// `fingerprints` imports nothing from Node, so a page can call it and compare with golden.json as well.
import { rules as RULES } from "../shared/rules.js";
import { runRace } from "./race.mjs";

/** The races: one, two, three and four players of every kind, every racer, keys and thumb. */
export const RACES = [
  { name: "plain, seed 1", seed: 1, humans: [{ style: "plain", character: "pawn" }] },
  { name: "sloppy ghost, seed 2", seed: 2, humans: [{ style: "sloppy", character: "ghost" }] },
  { name: "hands off, seed 3", seed: 3, humans: [{ style: "handsoff", character: "slime" }] },
  { name: "thumb robot, seed 4", seed: 4, humans: [{ style: "plain", character: "robot", touch: true }] },
  { name: "two players, seed 5", seed: 5, humans: [{ style: "plain", character: "pawn" }, { style: "sloppy", character: "robot" }] },
  { name: "three players, seed 6", seed: 6, humans: [{ style: "sloppy", character: "slime" }, { style: "plain", character: "ghost" }, { style: "handsoff", character: "pawn" }] },
  { name: "four players, seed 7", seed: 7, humans: [{ style: "plain", character: "pawn" }, { style: "plain", character: "ghost", touch: true }, { style: "sloppy", character: "slime" }, { style: "clean", character: "robot" }] },
  { name: "four players, seed 4000000000", seed: 4000000000, humans: [{ style: "left", character: "robot" }, { style: "right", character: "slime" }, { style: "sloppy", character: "ghost", touch: true }, { style: "plain", character: "pawn" }] },
];

/** {name: "fingerprint frames result"} for every race in RACES. */
export function fingerprints(rules = RULES) {
  const out = {};
  for (const race of RACES) {
    const r = runRace(rules, race);
    out[race.name] = `${r.fingerprint} ${r.frames} ${JSON.stringify(rules.game.result(r.state))}`;
  }
  return out;
}

if (typeof process !== "undefined" && process.argv && process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const prints = fingerprints();
  if (process.argv.includes("--write")) {
    const { writeFileSync } = await import("node:fs");
    const file = new URL("../test/golden.json", import.meta.url);
    writeFileSync(file, JSON.stringify(prints, null, 2) + "\n");
    console.log(`wrote ${Object.keys(prints).length} fingerprints to ${file.pathname}`);
  } else console.log(JSON.stringify(prints));
}
