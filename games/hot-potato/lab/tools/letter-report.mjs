// Prints, for each category, how many entries start with each letter (well known, and with
// lesser-known entries too), how many well-known entries end in each letter, and the dead ends: the letters fewer
// than DEAD_END_BELOW entries start with, which the chain skips back from.
//
//   node games/hot-potato/lab/tools/letter-report.mjs
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../../shared/categories.js";
import { DEAD_END_BELOW, buildIndex, deadLetters, entriesLeft, lastLetter } from "../../shared/logic.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../shared/${name}`, import.meta.url), "utf8"));
const words = load("words.json");
const ABC = [..."abcdefghijklmnopqrstuvwxyz"];

for (const [id, category] of Object.entries(CATEGORIES)) {
  const index = buildIndex(load(category.file), words, category);
  const ends = new Map();
  for (const p of index.places) if (p.known) ends.set(lastLetter(p.name), (ends.get(lastLetter(p.name)) ?? 0) + 1);
  const row = (f) => ABC.map((c) => `${c.toUpperCase()}${f(c)}`).join(" ");
  console.log(`\n${category.label} (${id}): ${index.knownCount} well known${category.wide ? `, ${index.places.length} with lesser-known ones` : ""}`);
  console.log(`  start, well known: ${row((c) => entriesLeft(index, c))}`);
  if (category.wide) console.log(`  start, all:        ${row((c) => entriesLeft(index, c, new Set(), true))}`);
  console.log(`  end, well known:   ${row((c) => ends.get(c) ?? 0)}`);
  const dead = deadLetters(index);
  const hit = dead.filter((c) => ends.get(c));
  console.log(`  dead ends (fewer than ${DEAD_END_BELOW} start with it): ${dead.map((c) => c.toUpperCase()).join(" ") || "none"}`);
  console.log(`  well-known entries ending in a dead end: ${hit.map((c) => `${c.toUpperCase()} ${ends.get(c)}`).join(", ") || "none"}`);
  if (category.wide) console.log(`  dead ends with lesser-known ones:${deadLetters(index, true).map((c) => c.toUpperCase()).join(" ") || "none"}`);
}
