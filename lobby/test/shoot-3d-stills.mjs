// Stills and short loops of the 3D look from posed rooms (lobby/public/look3d/still.html),
// against a running local server. The browser is headless and muted, and is closed at the end
// whatever happens.
//
//   node lobby/test/shoot-3d-stills.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/3d]
//        [--rooms=bar,navy] [--only=rooms|views|loops] [--publish=1] [--gpu=1]
//
// "rooms" is one big-screen still per skin, mid-vote, with one of the room's passing things
//         held in view: the picture the rooms page shows.
// "views" is the bar on every kind of device and at every moment a posed room can show.
// "loops" is a five second show per live room, taken frame by frame in stepped time: something
//         passes, someone is bumped by the room's feature, someone jumps under a lamp. The
//         frames land in <out>/loops/<room>/ ; lobby/test/make-loops.py turns them into the
//         looping pictures the rooms page shows.
// With --publish=1 the room stills are also written as JPEGs to lobby/public/look3d/rooms/.
//
// WSL has no graphics card, so by default this browser draws WebGL in software: right for a
// still, slow for many. With --gpu=1 it drives a headless Chrome on the Windows side instead
// (Cork & Bell's tools/browser.mjs: no window, a throwaway profile, closed at the end).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { openBrowser } from "../../node_modules/cork-and-bell/tools/browser.mjs";
import { SKINS } from "../public/look3d/skins.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/3d"));
const only = opt("only", "");
const rooms = opt("rooms", Object.keys(SKINS).join(",")).split(",");
const publish = opt("publish", "0") === "1";
const gpu = opt("gpu", "0") === "1";
mkdirSync(out, { recursive: true });
const problems = [];

const SCREEN = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true };
const UPRIGHT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };
const LOOP = { viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 };

/** Which passing thing each room's still holds in view, and how far through it is. */
const HELD = {
  bar: "event=cat.walk&u=0.56",
  ship: "event=planet.rise&u=0.4",
  arcade: "event=pawn.run&u=0.42",
  camp: "event=owl.pass&u=0.5",
  roof: "event=signal.on&u=0.5",
  navy: "event=applause.on&u=0.6",
  fair: "event=fireworks.burst&u=0.45",
  submarine: "event=whale.pass&u=0.76",
  train: "event=express.pass&u=0.5",
  alley: "event=cat.walk&u=0.5",
};
const LOOP_SECONDS = 5;
const LOOP_FPS = 8;

const pictures = [];
if (!only || only === "rooms") for (const id of rooms) pictures.push({ file: `room-${id}`, query: `room=${id}&${HELD[id] ?? ""}`, device: SCREEN, publish: `${id}.jpg` });
if (!only || only === "views") {
  pictures.push(
    { file: "bar-screen-count", query: "shot=count", device: SCREEN },
    { file: "bar-screen-toss", query: "shot=toss", device: SCREEN },
    { file: "bar-screen-lights-off", query: "shot=off", device: SCREEN },
    { file: "bar-screen-empty", query: "shot=empty", device: SCREEN },
    { file: "bar-phone-whole-room", query: "as=player&zoom=room", device: PHONE },
    { file: "bar-phone-closer", query: "as=player&zoom=closer", device: PHONE },
    { file: "bar-phone-count", query: "as=player&zoom=closer&shot=count", device: PHONE },
    { file: "bar-upright", query: "as=player&zoom=closer", device: UPRIGHT },
    { file: "ship-upright", query: "room=ship&as=player&zoom=closer", device: UPRIGHT },
    { file: "ship-phone-closer", query: "room=ship&as=player&zoom=closer&event=comet.pass&u=0.5", device: PHONE },
    { file: "bar-laptop-player", query: "as=player", device: LAPTOP },
  );
}
if (only === "loops") for (const id of rooms.filter((r) => SKINS[r]?.live)) pictures.push({ file: `loop-${id}`, query: `room=${id}&show=1&clock=step&bare=1`, device: LOOP, loop: id });

const b = gpu ? await openBrowser({ win: true }) : { browser: await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }) };
const newContext = (device) => (gpu ? b.newContext(device) : b.browser.newContext(device));
try {
  for (const picture of pictures) {
    const context = await newContext(picture.device);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/lobby/look3d/still.html?${gpu ? "" : "gl=any&"}${picture.query}`);
    const ready = await page.waitForSelector("html[data-ready]", { timeout: 60000, state: "attached" }).catch(() => null);
    if (!ready) {
      console.log("FAIL " + picture.file + ": the room never drew: " + (errors.join(" | ") || "no error reported"));
      problems.push(picture.file);
      await context.close();
      continue;
    }
    if (picture.loop) {
      const dir = `${out}/loops/${picture.loop}`;
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < LOOP_SECONDS * LOOP_FPS; i++) {
        await page.evaluate((s) => window.__still.advance(s), 1 / LOOP_FPS);
        await page.screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
      }
    } else {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${picture.file}.png` });
      if (publish && picture.publish) await page.screenshot({ path: resolve("lobby/public/look3d/rooms", picture.publish), type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: 1920, height: 990 }, scale: "css" });
    }
    // What a still cannot be trusted to show: a line of words wider than its place.
    const spills = await page.evaluate(() => [...document.querySelectorAll(".l3-fit, .l3-fits, .l3-name")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
    // Every sign is the same size, whatever the room.
    const signs = await page.evaluate(() => [...document.querySelectorAll(".l3-sign")].map((el) => `${Math.round(el.offsetWidth / window.__room3d.words.k)}x${Math.round(el.offsetHeight / window.__room3d.words.k)}@${Math.round(el.offsetTop / window.__room3d.words.k)}`));
    picture.signs = [...new Set(signs)].join(" ");
    const bad = [...errors, ...spills.map((s) => `"${s}" is wider than its place`)];
    console.log((bad.length ? "FAIL " : "ok   ") + picture.file + (bad.length ? ": " + bad.join(" | ") : "") + (picture.publish ? "   signs " + picture.signs : ""));
    if (bad.length) problems.push(picture.file);
    await context.close();
  }
  // Same containers everywhere: on the same screen, every room's signs have one size and one place.
  const sizes = new Set(pictures.filter((p) => p.publish && p.signs).map((p) => p.signs));
  if (sizes.size > 1) {
    console.log("FAIL the signs are not the same size and place in every room: " + [...sizes].join(" | "));
    problems.push("sign sizes");
  } else if (sizes.size === 1) console.log("ok   every room's signs are the same size and in the same place (" + [...sizes][0] + ")");
} finally {
  await (gpu ? b.close() : b.browser.close());
}
console.log(problems.length ? `\n${problems.length} problem(s): ${problems.join(", ")}` : `\nAll good. Stills are in ${out}`);
process.exit(problems.length ? 1 : 0);
