// Replays a copied hearing-test report through the current matcher and prints, per turn, what
// the page said then and what it says now, in the default list and in hard mode. Each turn is
// checked against its own category (reports before v3 are all cities).
//
//   node lab/hot-potato/tools/replay-report.mjs lab/hot-potato/test/fixtures/hearing-report-1.txt
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../public/categories.js";
import { RULES_VERSION, buildIndex, earlyMatch, matchHeard } from "../public/logic.js";
import { parseReport } from "../test/report.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8"));
const words = load("words.json");
const indexes = new Map();
const indexFor = (id) => {
  if (!indexes.has(id)) indexes.set(id, buildIndex(load(CATEGORIES[id].file), words, CATEGORIES[id]));
  return indexes.get(id);
};
const turns = parseReport(readFileSync(process.argv[2], "utf8"));

const where = (m) => m.place.country ?? m.place.group ?? "";
const show = (m) => (m.ok ? `yes ${m.said} (${where(m)}) ${m.kind}${m.plural ? ", plural" : ""}` : `no: ${m.reason}${m.place ? ` ${m.said} (${where(m)})` : ""} "${m.heard}"`);
const before = (t) => t.verdictText.replace(/ \(heard.*$/, "").replace(/ \(by .*$/, "");

console.log(`| # | category | need | heard (best) | before (as the report says) | now (${RULES_VERSION}, default) | now (${RULES_VERSION}, hard mode) | early answer now |`);
console.log("|---|---|---|---|---|---|---|---|");
let earlyTried = 0;
let earlyTaken = 0;
for (const t of turns) {
  const index = indexFor(t.category);
  const opts = { required: t.need };
  const best = t.alternatives[0]?.transcript ?? "-";
  const now = t.alternatives.length ? matchHeard(index, t.alternatives, opts) : null;
  const hard = t.alternatives.length ? matchHeard(index, t.alternatives, { ...opts, hard: true }) : null;
  let early = "-";
  if (t.interim) {
    earlyTried++;
    const e = earlyMatch(index, [t.interim], opts);
    if (e.ok) earlyTaken++;
    early = e.ok ? `takes "${t.interim}" as ${e.said}` : `waits ("${t.interim}": ${e.why})`;
  }
  console.log(`| ${t.n} | ${t.category} | ${t.need || "-"} | ${best} | ${before(t)} | ${now ? show(now) : "nothing heard"} | ${hard ? show(hard) : "nothing heard"} | ${early} |`);
}
console.log(`\nearly answers: the report took ${earlyTried} interims; ${RULES_VERSION} would take ${earlyTaken}.`);
