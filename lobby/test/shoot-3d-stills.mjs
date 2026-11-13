// Stills of the 3D look from posed rooms (lobby/public/look3d/still.html), against a running
// local server. The browser is headless and muted, and is closed at the end whatever happens.
//
//   node lobby/test/shoot-3d-stills.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/3d]
//        [--rooms=bar,navy] [--only=rooms|views] [--publish=1]
//
// "rooms" is one big-screen still per skin, mid-vote: the picture the rooms page shows.
// "views" is the bar on every kind of device and at every moment a posed room can show.
// With --publish=1 the room stills are also written as JPEGs to lobby/public/look3d/rooms/,
// where the rooms page reads them.
//
// WSL has no graphics card, so this browser draws WebGL in software: right for a still, wrong
// for speed. Frame time is measured by lobby/test/measure-3d.mjs.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { SKINS } from "../public/look3d/skins.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/3d"));
const only = opt("only", "");
const rooms = opt("rooms", Object.keys(SKINS).join(",")).split(",");
const publish = opt("publish", "0") === "1";
mkdirSync(out, { recursive: true });
const problems = [];

const SCREEN = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true };
const UPRIGHT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
const LAPTOP = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };

const pictures = [];
if (only !== "views") for (const id of rooms) pictures.push({ file: `room-${id}`, query: `room=${id}`, device: SCREEN, publish: `${id}.jpg` });
if (only !== "rooms") {
  pictures.push(
    { file: "bar-screen-count", query: "shot=count", device: SCREEN },
    { file: "bar-screen-toss", query: "shot=toss", device: SCREEN },
    { file: "bar-screen-lights-off", query: "shot=off", device: SCREEN },
    { file: "bar-screen-empty", query: "shot=empty", device: SCREEN },
    { file: "bar-phone-whole-room", query: "as=player&zoom=room", device: PHONE },
    { file: "bar-phone-closer", query: "as=player&zoom=closer", device: PHONE },
    { file: "bar-phone-count", query: "as=player&zoom=closer&shot=count", device: PHONE },
    { file: "bar-upright", query: "as=player&zoom=closer", device: UPRIGHT },
    { file: "bar-laptop-player", query: "as=player", device: LAPTOP },
  );
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const picture of pictures) {
    const context = await browser.newContext(picture.device);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/lobby/look3d/still.html?gl=any&${picture.query}`);
    const ready = await page.waitForSelector("html[data-ready]", { timeout: 60000, state: "attached" }).catch(() => null);
    if (!ready) {
      console.log("FAIL " + picture.file + ": the room never drew: " + (errors.join(" | ") || "no error reported"));
      problems.push(picture.file);
      await context.close();
      continue;
    }
    await page.waitForTimeout(1200);
    // What a still cannot be trusted to show: a line of words wider than its place.
    const spills = await page.evaluate(() => [...document.querySelectorAll(".l3-fit, .l3-fits, .l3-name")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
    await page.screenshot({ path: `${out}/${picture.file}.png` });
    if (publish && picture.publish) await page.screenshot({ path: resolve("lobby/public/look3d/rooms", picture.publish), type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: 1920, height: 990 } });
    const bad = [...errors, ...spills.map((s) => `"${s}" is wider than its place`)];
    console.log((bad.length ? "FAIL " : "ok   ") + picture.file + (bad.length ? ": " + bad.join(" | ") : ""));
    if (bad.length) problems.push(picture.file);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s): ${problems.join(", ")}` : `\nAll good. Stills are in ${out}`);
process.exit(problems.length ? 1 : 0);
