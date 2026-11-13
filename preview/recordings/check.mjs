// Looks at every clip the preview will play: length, loudness (LUFS), true peak, and how long
// before the sound starts and after it ends. Run: node check.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const OUT = new URL("../sounds", import.meta.url).pathname;
const clips = JSON.parse(readFileSync(`${OUT}/sounds.json`, "utf8"));
let bad = 0;
for (const c of clips) {
  const f = `${OUT}/${c.file}`;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split("Summary")[1] ?? "")?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr.split("Summary")[1] ?? "")?.[1]);
  // Silence at the start and at the end, at -45 dB.
  const sd = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "silencedetect=n=-45dB:d=0.05", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const starts = [...sd.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...sd.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const lead = starts[0] === 0 || (starts.length && starts[0] < 0.01) ? ends[0] ?? 0 : 0;
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
  const fine = dur <= 4 && peak <= -0.9 && lead < 0.25 && lufs > -24 && lufs < -14;
  if (!fine) bad++;
  console.log(`${fine ? "ok  " : "LOOK"} ${c.file.padEnd(18)} ${dur.toFixed(2)}s  ${String(lufs).padStart(6)} LUFS  peak ${String(peak).padStart(5)} dBFS  silent start ${lead.toFixed(2)}s`);
}
console.log(`${clips.length} clips, ${bad} to look at`);
