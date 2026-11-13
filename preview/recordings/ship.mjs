// Makes the sounds the party room ships, from the CC0 recordings the owner chose and the CC0
// Kenney packs: trimmed, mono, brought to one loudness per kind, small MP3s (Safari on iPhone and
// Chrome on Android both decode them). Writes lobby/public/sounds/<name>.mp3, its CREDITS.txt and
// sources.json here, with where every file came from and its licence.
//
//   node preview/recordings/fetch.mjs       (once) reads each Freesound page, keeps CC0 only, downloads
//   node preview/recordings/ship.mjs        makes the room's sounds
//
// The Kenney packs (kenney.nl: Impact Sounds, Interface Sounds, Casino Audio, RPG Audio, each
// CC0 per its License.txt) are unpacked into raw/kenney/ by hand; raw/ is not committed.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const OUT = new URL("../../lobby/public/sounds", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const records = JSON.parse(readFileSync(`${DIR}/records.json`, "utf8"));
const fs = (id) => records.find((r) => r.id === id);

/** How loud each kind is (LUFS) and the highest its peak may be (dBFS). */
const LEVEL = { emote: [-18, -1.5], room: [-23, -3], ambient: [-29, -6] };

const KENNEY = {
  "impact-sounds": "https://kenney.nl/assets/impact-sounds",
  "interface-sounds": "https://kenney.nl/assets/interface-sounds",
  "casino-audio": "https://kenney.nl/assets/casino-audio",
  "rpg-audio": "https://kenney.nl/assets/rpg-audio",
};
const PACK = { "impact-sounds": "Impact Sounds", "interface-sounds": "Interface Sounds", "casino-audio": "Casino Audio", "rpg-audio": "RPG Audio" };

/**
 * name: the file and the name the page plays it by. src: a Freesound id, or a Kenney pack and file.
 * max: seconds at most. kind: its loudness. loudest: start where the recording is loudest (a
 * kettle that heats before it whistles). claps: one clap, three times, this far apart.
 */
const SHIP = [
  // What each emote carries. The owner's picks: popcorn B, slow clap C, red card B, lighter C.
  { name: "emote-popcorn", src: 316926, max: 2, kind: "emote" },
  { name: "emote-slowclap", src: 154399, claps: 0.8, kind: "emote" },
  { name: "emote-pointlaugh", src: 452749, max: 2.5, kind: "emote" },
  { name: "emote-redcard", src: 218318, max: 2, kind: "emote" },
  { name: "emote-hurry", src: 275802, max: 2, kind: "emote" },
  { name: "emote-thumbsup", src: 685111, max: 2, kind: "emote" },
  { name: "emote-confetti", src: 26349, max: 1, kind: "emote" },
  { name: "emote-boo", src: 353925, max: 2.5, kind: "emote" },
  { name: "emote-trophy", src: 462362, max: 3, kind: "emote" },
  { name: "emote-shush", src: 701175, max: 1.2, kind: "emote" },
  { name: "emote-lighter", src: 407428, max: 1, kind: "emote" },
  { name: "emote-scratch", src: 170768, max: 1, kind: "emote" },
  { name: "emote-steam", src: 181718, max: 2.4, kind: "emote", loudest: true },
  { name: "emote-tomato", src: 382637, max: 1.5, kind: "emote" },
  // The room's own: moving, the kick, the lights, the count, the toss, coming and going.
  { name: "step-1", src: ["impact-sounds", "footstep_carpet_000.ogg"], max: 0.4, kind: "room" },
  { name: "step-2", src: ["impact-sounds", "footstep_carpet_001.ogg"], max: 0.4, kind: "room" },
  { name: "jump", src: ["interface-sounds", "pluck_001.ogg"], max: 0.5, kind: "room" },
  { name: "land", src: ["impact-sounds", "impactSoft_medium_001.ogg"], max: 0.5, kind: "room" },
  { name: "kick-swing", src: 60013, max: 0.5, kind: "room" },
  { name: "kick-hit", src: ["impact-sounds", "impactPunch_heavy_000.ogg"], max: 0.6, kind: "room" },
  { name: "kick-tumble", src: ["impact-sounds", "impactSoft_heavy_002.ogg"], max: 0.6, kind: "room" },
  { name: "light-in", src: ["interface-sounds", "switch_002.ogg"], max: 0.4, kind: "room" },
  { name: "light-out", src: ["interface-sounds", "switch_003.ogg"], max: 0.4, kind: "room" },
  { name: "count-tick", src: ["interface-sounds", "tick_001.ogg"], max: 0.3, kind: "room" },
  { name: "count-last", src: ["interface-sounds", "tick_002.ogg"], max: 0.3, kind: "room" },
  { name: "count-go", src: ["interface-sounds", "confirmation_002.ogg"], max: 1, kind: "room" },
  { name: "toss-flip", src: 181189, max: 1.5, kind: "room" },
  { name: "toss-land", src: ["casino-audio", "chip-lay-1.ogg"], max: 0.6, kind: "room" },
  { name: "join", src: ["interface-sounds", "drop_002.ogg"], max: 0.6, kind: "room" },
  { name: "leave", src: ["interface-sounds", "back_002.ogg"], max: 0.6, kind: "room" },
  { name: "lights-down", src: ["interface-sounds", "minimize_006.ogg"], max: 0.8, kind: "room" },
  { name: "lights-up", src: ["interface-sounds", "maximize_006.ogg"], max: 0.8, kind: "room" },
  { name: "tap", src: ["interface-sounds", "click_002.ogg"], max: 0.3, kind: "room" },
  { name: "game-start", src: ["interface-sounds", "confirmation_003.ogg"], max: 1, kind: "room" },
  { name: "result", src: ["interface-sounds", "confirmation_004.ogg"], max: 1.2, kind: "room" },
  // The rooms' own life, quiet: the bar and the star lounge.
  { name: "amb-lamp-swing", src: ["rpg-audio", "creak1.ogg"], max: 1.2, kind: "ambient" },
  { name: "amb-piece-land", src: ["impact-sounds", "impactWood_light_000.ogg"], max: 0.5, kind: "ambient" },
  { name: "amb-jukebox-skip", src: 43404, max: 1.6, kind: "ambient" },
  { name: "amb-cat", src: 412017, max: 1.8, kind: "ambient" },
  { name: "amb-moth", src: ["rpg-audio", "cloth1.ogg"], max: 0.6, kind: "ambient" },
  { name: "amb-star-fall", src: ["interface-sounds", "glass_001.ogg"], max: 0.8, kind: "ambient" },
  { name: "amb-comet", src: ["interface-sounds", "glass_004.ogg"], max: 0.8, kind: "ambient" },
  { name: "amb-rocket", src: 683101, max: 1.6, kind: "ambient" },
  { name: "amb-satellite", src: ["interface-sounds", "question_001.ogg"], max: 0.8, kind: "ambient" },
  { name: "amb-holo", src: ["interface-sounds", "glitch_001.ogg"], max: 0.8, kind: "ambient" },
];

const run = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
const peakOf = (file) => Number(/Peak level dB: (-?[\d.]+)/.exec(spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "astats", "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1] ?? 0);

/** Where in a recording it is loudest, in seconds, by half-second windows. */
function loudestAt(file) {
  const out = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "aformat=channel_layouts=mono,asetnsamples=22050,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const levels = [...out.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -120 : Number(m[1])));
  let best = 0;
  levels.forEach((v, i) => v > levels[best] && (best = i));
  return Math.max(0, best * 0.5 - 0.3);
}

function encode(src, to, kind) {
  const [target, ceiling] = LEVEL[kind];
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", src, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr.split("Summary")[1];
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(r)[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(r)[1]);
  // Clips too short for the loudness meter (it needs 400 ms) are set by their peak alone.
  const gain = lufs < -69 ? ceiling - peak : Math.min(target - lufs, ceiling - peak);
  run(["-i", src, "-af", `volume=${gain.toFixed(2)}dB`, "-ac", "1", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "64k", to]);
}

const today = new Date().toISOString().slice(0, 10);
const shipped = [];
const kenneyLicence = (pack) => readFileSync(`${DIR}/raw/kenney/${pack}/License.txt`, "utf8").match(/License: \(([^)]+)\)/)?.[1] ?? "";
for (const item of SHIP) {
  let file;
  let source;
  if (Array.isArray(item.src)) {
    const [pack, name] = item.src;
    file = `${DIR}/raw/kenney/${pack}/Audio/${name}`;
    source = { title: `${PACK[pack]}: ${name.replace(/\.ogg$/, "")}`, author: "Kenney (kenney.nl)", page: KENNEY[pack], licence: "Creative Commons 0", licenceUrl: "http://creativecommons.org/publicdomain/zero/1.0/", licenceLine: `License.txt in the pack: "${kenneyLicence(pack)}"`, fetched: today };
  } else {
    const rec = fs(item.src);
    if (!rec?.kept) throw new Error(`not a kept CC0 recording: ${item.src}`);
    file = `${DIR}/${rec.file}`;
    source = { title: rec.title, author: rec.author, page: rec.page, licence: rec.licence, licenceUrl: rec.licenceUrl, licenceLine: rec.licenceLine, fetched: rec.fetched, freesoundId: rec.id };
  }
  const tmp = `${DIR}/ship.wav`;
  if (item.claps) {
    run(["-i", file, "-af", "aformat=channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-35dB,atrim=start=0.34:duration=0.4,asetpts=N/SR/TB,afade=t=out:st=0.25:d=0.15", "-ar", "44100", `${DIR}/clap.wav`]);
    const gap = Math.round(item.claps * 1000);
    run(["-i", `${DIR}/clap.wav`, "-filter_complex", `[0]asplit=3[a][b][c];[b]adelay=${gap}[b2];[c]adelay=${gap * 2}[c2];[a][b2][c2]amix=inputs=3:normalize=0,apad=pad_dur=0.1`, "-ar", "44100", tmp]);
  } else {
    const peak = peakOf(file);
    const quiet = Math.max(-70, peak - 35).toFixed(1);
    const silent = Math.max(-75, peak - 45).toFixed(1);
    const start = item.loudest ? loudestAt(file) : 0;
    const fade = Math.min(0.2, item.max / 6);
    run(["-i", file, "-af", [
      "aformat=channel_layouts=mono",
      `atrim=start=${start}`,
      "asetpts=N/SR/TB",
      `silenceremove=start_periods=1:start_threshold=${quiet}dB:start_silence=0.01`,
      `atrim=duration=${item.max}`,
      "asetpts=N/SR/TB",
      "afade=t=in:d=0.005",
      `areverse,silenceremove=start_periods=1:start_threshold=${silent}dB,afade=t=in:d=${fade},areverse`,
    ].join(","), "-ar", "44100", tmp]);
  }
  const to = `${OUT}/${item.name}.mp3`;
  encode(tmp, to, item.kind);
  shipped.push({ file: `${item.name}.mp3`, kind: item.kind, seconds: Math.round(probe(to) * 100) / 100, bytes: statSync(to).size, edit: item.claps ? `one clap from the recording, three times, ${item.claps} s apart` : item.loudest ? "the loudest part of the recording" : "trimmed", source });
}
writeFileSync(`${DIR}/sources.json`, JSON.stringify(shipped, null, 2) + "\n");

// The credits, beside the files: every sound, where it came from, and its licence.
const lines = [
  "Sounds of the party room",
  "",
  "Every file in this folder was made from a recording released under Creative Commons Zero",
  "(CC0 1.0, public domain: https://creativecommons.org/publicdomain/zero/1.0/). CC0 asks for no",
  "credit; it is given here anyway, with thanks. Each was trimmed, made mono and brought to an even",
  "loudness for the room (preview/recordings/ship.mjs); the slow clap is one clap repeated.",
  "",
];
for (const s of shipped) {
  lines.push(`${s.file}`);
  lines.push(`  "${s.source.title}" by ${s.source.author}`);
  lines.push(`  ${s.source.page}`);
  lines.push(`  ${s.source.licence}, read on ${s.source.fetched}${s.edit !== "trimmed" ? `; ${s.edit}` : ""}`);
  lines.push("");
}
writeFileSync(`${OUT}/CREDITS.txt`, lines.join("\n"));
const total = shipped.reduce((n, s) => n + s.bytes, 0);
for (const s of shipped) console.log(`${s.file.padEnd(24)} ${s.seconds.toFixed(2)}s ${String(s.bytes).padStart(6)} B  ${s.kind.padEnd(8)} ${s.source.author} / ${s.source.title}`);
console.log(`${shipped.length} sounds, ${(total / 1024).toFixed(0)} KiB`);
