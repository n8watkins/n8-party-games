// Replays a copied hearing-test report through the current matcher and prints, per turn, what
// the page said then and what it says now, with the well-known list and with lesser-known
// entries allowed too. Each turn is checked against its own category (reports before v3 are all
// cities). Reports before v4 name the wider list "hard"; report.js reads both.
//
//   node games/hot-potato/lab/tools/replay-report.mjs games/hot-potato/lab/test/fixtures/hearing-report-1.txt
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../../shared/categories.js";
import { RULES_VERSION, buildIndex, earlyMatch, matchHeard } from "../../shared/logic.js";
import { parseReport } from "../test/report.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../shared/${name}`, import.meta.url), "utf8"));
const words = load("words.json");
const indexes = new Map();
const indexFor = (id) => {
  if (!indexes.has(id)) indexes.set(id, buildIndex(load(CATEGORIES[id].file), words, CATEGORIES[id]));
  return indexes.get(id);
};
const turns = parseReport(readFileSync(process.argv[2], "utf8"));

const where = (m) => {
  const w = m.place.country ?? m.place.group ?? "";
  return w ? ` (${w})` : "";
};
const show = (m) => (m.ok ? `yes ${m.said}${where(m)} ${m.kind}${m.plural ? ", plural" : ""}` : `no: ${m.reason}${m.place ? ` ${m.said}${where(m)}` : ""} "${m.heard}"`);
const before = (t) => t.verdictText.replace(/ \(heard.*$/, "").replace(/ \(by .*$/, "");

console.log(`| # | category | need | heard (best) | before (as the report says) | now (${RULES_VERSION}, well known) | now (${RULES_VERSION}, lesser-known allowed) | early answer now |`);
console.log("|---|---|---|---|---|---|---|---|");
let earlyTried = 0;
let earlyTaken = 0;
for (const t of turns) {
  const index = indexFor(t.category);
  const opts = { required: t.need };
  const best = t.alternatives[0]?.transcript ?? "-";
  const now = t.alternatives.length ? matchHeard(index, t.alternatives, opts) : null;
  const wide = t.alternatives.length ? matchHeard(index, t.alternatives, { ...opts, wide: true }) : null;
  let early = "-";
  if (t.interim) {
    earlyTried++;
    const e = earlyMatch(index, [t.interim], opts);
    if (e.ok) earlyTaken++;
    early = e.ok ? `takes "${t.interim}" as ${e.said}` : `waits ("${t.interim}": ${e.why})`;
  }
  console.log(`| ${t.n} | ${t.category} | ${t.need || "-"} | ${best} | ${before(t)} | ${now ? show(now) : "nothing heard"} | ${wide ? show(wide) : "nothing heard"} | ${early} |`);
}
console.log(`\nearly answers: the report took ${earlyTried} interims; ${RULES_VERSION} would take ${earlyTaken}.`);
