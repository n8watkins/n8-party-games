// Turns the downloaded CC0 recordings into the clips the preview plays: the leading silence
// trimmed, cut to a length that suits the emote, faded in and out, brought to one loudness, and
// made mono MP3 (decoded by Safari on iPhone and Chrome on Android alike). Writes them to
// preview/sounds/ (ignored by git) with sounds.json: where each came from and its licence.
// Run: node process.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const OUT = new URL("../sounds", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const records = JSON.parse(readFileSync(`${DIR}/records.json`, "utf8"));
const byId = (id) => records.find((r) => r.id === id);

/** emote -> [[freesound id, longest seconds, seconds to skip after the silence]] in the order A, B, C. */
const PLAN = {
  violin: [[234311, 3.5, 0], [577070, 3.5, 0], [90061, 3.5, 0]],
  popcorn: [[641145, 1.5, 0], [316926, 2, 0]],
  slowclap: [[561020, 3.5, 0], [154399, 3, 0]],
  pointlaugh: [[452749, 2.5, 0], [242244, 2.2, 0], [333403, 2.5, 0]],
  redcard: [[538422, 1, 0], [218318, 2, 0]],
  hurry: [[275802, 2, 0]],
  thumbsup: [[685111, 2, 0]],
  boo: [[353925, 2.5, 0], [403060, 2.5, 0]],
  trophy: [[462362, 3, 0], [484513, 3, 0], [32260, 3, 0]],
  confetti: [[26349, 1, 0], [182571, 2.5, 0]],
  shush: [[151224, 1, 0], [412673, 2, 0], [701175, 1.2, 0]],
  lighter: [[398977, 1.2, 0], [742836, 2, 0], [407428, 1, 0]],
  scratch: [[170768, 1, 0], [170779, 1, 0], [445871, 2, 0]],
};

const run = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

/**
 * Brings tmp.wav to one loudness and encodes it: a single gain that puts it at -18 LUFS, or
 * lower if that would push its true peak over -1.5 dBFS (MP3 adds a little) (loudnorm cannot judge clips this short).
 */
function encode(to) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", `${DIR}/tmp.wav`, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr.split("Summary")[1];
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(r)[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r)[1]);
  const gain = Math.min(-18 - lufs, -1.5 - peak);
  run(["-i", `${DIR}/tmp.wav`, "-af", `volume=${gain.toFixed(2)}dB`, "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "64k", to]);
}

const out = [];
for (const [emote, takes] of Object.entries(PLAN)) {
  takes.forEach(([id, longest, skip], i) => {
    const rec = byId(id);
    if (!rec?.kept) throw new Error(`not a kept CC0 recording: ${id}`);
    const label = "ABC"[i];
    const file = `${emote}-${label}.mp3`;
    const fade = Math.min(0.25, longest / 6);
    // What counts as silence is relative to the recording's own loudest moment: some are quiet.
    const peak = Number(/Peak level dB: (-?[\d.]+)/.exec(spawnSync("ffmpeg", ["-hide_banner", "-i", `${DIR}/${rec.file}`, "-af", "astats", "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1] ?? 0);
    const quiet = Math.max(-70, peak - 35).toFixed(1);
    const silent = Math.max(-75, peak - 45).toFixed(1);
    // 1. Mono, leading silence removed, cut to length, a short fade in and a gentle fade out.
    run([
      "-i", `${DIR}/${rec.file}`,
      "-af",
      [
        "aformat=channel_layouts=mono",
        `silenceremove=start_periods=1:start_threshold=${quiet}dB:start_silence=0.02`,
        `atrim=start=${skip}:duration=${longest}`,
        "asetpts=N/SR/TB",
        "afade=t=in:d=0.01",
        `areverse,silenceremove=start_periods=1:start_threshold=${silent}dB,afade=t=in:d=${fade},areverse`,
      ].join(","),
      "-ar", "44100", `${DIR}/tmp.wav`,
    ]);
    // 2. One loudness for every clip (EBU R128), the peaks kept under -2 dBFS, then small MP3.
    encode(`${OUT}/${file}`);
    const seconds = probe(`${OUT}/${file}`);
    out.push({ emote, label, file, seconds: Math.round(seconds * 100) / 100, bytes: statSync(`${OUT}/${file}`).size, source: { title: rec.title, author: rec.author, page: rec.page, licence: rec.licence, licenceUrl: rec.licenceUrl, licenceLine: rec.licenceLine, fetched: rec.fetched, freesoundId: id } });
    console.log(`${file.padEnd(18)} ${seconds.toFixed(2)}s ${String(statSync(`${OUT}/${file}`).size).padStart(7)} B  ${rec.author} / ${rec.title}`);
  });
}
// A slow clap made of one clean clap from semccab's "hand clap.wav" (CC0), three times, slowly.
{
  const rec = byId(154399);
  run(["-i", `${DIR}/${rec.file}`, "-af", "aformat=channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-35dB,atrim=start=0.34:duration=0.4,asetpts=N/SR/TB,afade=t=out:st=0.25:d=0.15", "-ar", "44100", `${DIR}/clap.wav`]);
  run(["-i", `${DIR}/clap.wav`, "-filter_complex", "[0]asplit=3[a][b][c];[b]adelay=800[b2];[c]adelay=1600[c2];[a][b2][c2]amix=inputs=3:normalize=0,apad=pad_dur=0.1", "-ar", "44100", `${DIR}/tmp.wav`]);
  encode(`${OUT}/slowclap-C.mp3`);
  const file = "slowclap-C.mp3";
  out.push({ emote: "slowclap", label: "C", file, seconds: Math.round(probe(`${OUT}/${file}`) * 100) / 100, bytes: statSync(`${OUT}/${file}`).size, edit: "one clap from the recording, three times, 0.8 s apart", source: { title: rec.title, author: rec.author, page: rec.page, licence: rec.licence, licenceUrl: rec.licenceUrl, licenceLine: rec.licenceLine, fetched: rec.fetched, freesoundId: 154399 } });
  console.log("slowclap-C.mp3 (three single claps)");
}
writeFileSync(`${OUT}/sounds.json`, JSON.stringify(out, null, 2));
console.log(`${out.length} clips, ${(out.reduce((n, c) => n + c.bytes, 0) / 1024).toFixed(0)} KiB`);
