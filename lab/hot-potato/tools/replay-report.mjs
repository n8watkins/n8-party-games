// Replays a copied hearing-test report through the current matcher and prints, per turn, what
// the page said then and what it says now, in the default list and in hard mode.
//
//   node lab/hot-potato/tools/replay-report.mjs lab/hot-potato/test/fixtures/hearing-report-1.txt
import { readFileSync } from "node:fs";
import { buildIndex, earlyMatch, matchHeard } from "../public/logic.js";
import { parseReport } from "../test/report.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8"));
const index = buildIndex(load("cities.json"), load("words.json"));
const turns = parseReport(readFileSync(process.argv[2], "utf8"));

const show = (m) => (m.ok ? `yes ${m.said} (${m.place.country}) ${m.kind}` : `no: ${m.reason}${m.place ? ` ${m.said} (${m.place.country})` : ""} "${m.heard}"`);
const before = (t) => t.verdictText.replace(/ \(heard.*$/, "").replace(/ \(by .*$/, "");

console.log("| # | need | heard (best) | before (v1, as he saw it) | now (m2, default) | now (m2, hard mode) | early answer now |");
console.log("|---|---|---|---|---|---|---|");
let earlyTried = 0;
let earlyTaken = 0;
for (const t of turns) {
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
  console.log(`| ${t.n} | ${t.need || "-"} | ${best} | ${before(t)} | ${now ? show(now) : "nothing heard"} | ${hard ? show(hard) : "nothing heard"} | ${early} |`);
}
console.log(`\nearly answers: v1 took ${earlyTried} interims; m2 would take ${earlyTaken}.`);
