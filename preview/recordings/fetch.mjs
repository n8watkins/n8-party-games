// Fetches candidate sounds from Freesound: reads each sound's own page, keeps it only when the
// page itself says Creative Commons 0, records where it came from, and downloads the page's HQ
// preview (128 kbps MP3) into raw/. Run: node fetch.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const UA = { "User-Agent": "Mozilla/5.0 (sound research for an open source party game)" };
mkdirSync(`${DIR}/raw`, { recursive: true });

/** [slot, Freesound id] */
const WANT = [
  ["horn", 414208], ["horn", 68999], ["horn", 174819],
  ["trombone", 175409], ["trombone", 362206],
  ["applause", 462362], ["applause", 484513], ["applause", 32260],
  ["ooh", 870650], ["ooh", 324890], ["ooh", 264499],
  ["laugh", 371562], ["laugh", 452749], ["laugh", 242244], ["laugh", 333403],
  ["rimshot", 383898], ["rimshot", 271208], ["rimshot", 132418],
  ["scratch", 43404], ["scratch", 74385], ["scratch", 71853],
  ["crickets", 129678], ["crickets", 146033],
  ["boing", 540790], ["boing", 61847], ["boing", 403002], ["boing", 497092],
  ["ding", 685111], ["ding", 116779], ["ding", 149268],
  ["violin", 234311], ["violin", 577070], ["violin", 90061],
  ["popcorn", 575722], ["popcorn", 641145], ["popcorn", 316926],
  ["slowclap", 561020], ["slowclap", 154399],
  ["whistle", 218318], ["whistle", 538422],
  ["boo", 353925], ["boo", 403060],
  ["tick", 188033], ["tick", 275802],
  ["popper", 26349],
  ["handbell", 352242], ["handbell", 200318],
  ["snore", 432997], ["snore", 20545],
  ["buzzer", 648462], ["buzzer", 331912],
  ["yay", 563845], ["yay", 182571],
  ["shush", 151224], ["shush", 412673], ["shush", 701175],
  ["lighter", 398977], ["lighter", 742836], ["lighter", 407428],
];

const today = new Date().toISOString().slice(0, 10);
const records = [];
for (const [slot, id] of WANT) {
  const page = `https://freesound.org/s/${id}/`;
  const res = await fetch(page, { headers: UA, redirect: "follow" });
  const html = await res.text();
  const url = res.url;
  const title = /og:audio:title" content="([^"]*)"/.exec(html)?.[1] ?? "";
  const author = /\/people\/([^/]+)\/sounds\//.exec(url)?.[1] ?? "";
  const duration = Number(/data-duration="([\d.]+)"/.exec(html)?.[1] ?? 0);
  const licence = /href="(http[s]?:\/\/creativecommons\.org\/[^"]+)"[^>]*>([^<]+)<\/a>/.exec(html);
  const line = /<div class="text-grey\s+v-spacing-top-1">\s*([^<]+)</.exec(html)?.[1]?.trim() ?? "";
  const preview = /https:\/\/cdn\.freesound\.org\/previews\/[^"]+-hq\.mp3/.exec(html)?.[0];
  const cc0 = licence && licence[2].trim() === "Creative Commons 0" && /publicdomain\/zero\/1\.0/.test(licence[1]);
  const rec = { slot, id, title: decode(title), author: decode(author), page: url, licence: licence?.[2]?.trim() ?? "none found", licenceUrl: licence?.[1] ?? "", licenceLine: decode(line), duration, fetched: today, preview, file: `raw/${slot}-${id}.mp3`, kept: !!cc0 && !!preview };
  if (rec.kept && !existsSync(`${DIR}/${rec.file}`)) {
    const audio = Buffer.from(await (await fetch(preview, { headers: UA })).arrayBuffer());
    writeFileSync(`${DIR}/${rec.file}`, audio);
  }
  records.push(rec);
  console.log(`${rec.kept ? "kept" : "SKIP"} ${slot.padEnd(9)} ${String(id).padStart(7)} ${duration.toFixed(1).padStart(6)}s  ${rec.licence.padEnd(20)} ${rec.author} / ${rec.title}`);
  await new Promise((r) => setTimeout(r, 700));
}
writeFileSync(`${DIR}/records.json`, JSON.stringify(records, null, 2));

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/%20/g, " ");
}
