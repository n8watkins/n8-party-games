// Research only: searches Freesound for CC0 sounds and lists candidates (id, title, author, length, downloads).
// node search.mjs "air horn" ["more queries"...]
const UA = { "User-Agent": "Mozilla/5.0 (sound research for an open source party game)" };
for (const q of process.argv.slice(2)) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=license:%22Creative+Commons+0%22&s=Downloads+(most+first)`;
  const html = await (await fetch(url, { headers: UA })).text();
  // Each result is a block with a link to /people/<user>/sounds/<id>/ and a title.
  const seen = new Set();
  const rows = [];
  for (const m of html.matchAll(/href="\/people\/([^/]+)\/sounds\/(\d+)\/"[^>]*>([^<]{2,120})<\/a>/g)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    rows.push({ id: m[2], user: m[1], title: m[3].trim() });
  }
  // Durations and downloads appear near each id in data attributes or text; keep it simple: report what we found.
  const durs = [...html.matchAll(/data-duration="([\d.]+)"/g)].map((m) => Number(m[1]));
  console.log(`\n== ${q} (${rows.length})`);
  rows.slice(0, 12).forEach((r, i) => console.log(`${r.id.padStart(7)}  ${(durs[i] ?? 0).toFixed(1).padStart(5)}s  ${r.user.padEnd(18)} ${r.title}`));
  await new Promise((r) => setTimeout(r, 800));
}
