// Does the room fill the screen? Stills of the whole room in every look and room, on phones held
// sideways (narrow to very wide) and on big screens, in real pages against a running local
// server, with a measure of any dark band at either end of the picture: the room's art ending and
// the camera showing past it (lobby/public/reach.js). The browser is headless and muted, and is
// closed at the end whatever happens.
//
//   npx wrangler dev --local --env local --port 8857 --var PARTY_TEST_GAMES:off
//   node lobby/test/shoot-fill.mjs [--base=http://localhost:8857] [--out=<folder>]
//        [--looks=flat,3d,baked,real] [--rooms=bar,ship,...] [--sizes=844x390,...]
//
// The server runs without the test game: the wall of five the Floor hangs (the bar in its
// painting's frames). For each look and room one page is the room's screen and one a player's
// phone in "whole room" (the Closer button off); each is shot at every size it is a device of.
// The baked look draws only an evenly hung bar, which that wall is not, so it is shot from the
// posed room (look3d/still.html?look=baked), a player's whole room on its wall of five.
//
// What it checks: in the flat, baked and real looks, no still has a band of dark columns at either
// end of the picture (the strip above the bottom bar, below the corner buttons), measured against
// the picture's middle; a narrow one (BAND) is allowed, the fault this looks for took a sixth of a
// sideways phone. The 3D rooms are dark rooms whose own end walls are in the picture at its ends,
// so there it checks that none of the picture is the empty background past the room.
//
// It also measures how much of the Tonight board the corner buttons (sound, Rooms, the door)
// cover in each still, once they have folded to their pictures, and writes it to
// <out>/corner.json. With --compare=<a corner.json from another run> (main's, say) it fails a
// still where they cover more of the board than there, by more than a few pixels.
//
// WSL has no graphics card, so these pages draw WebGL in software (?gl=any): right for a still.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { launchBrowser } from "./browser.mjs";
import { sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8857");
const out = resolve(opt("out", "lobby/test/shots/fill"));
const LOOKS = opt("looks", "flat,3d,baked,real").split(",");
const ALL_ROOMS = { flat: ["bar", "ship"], "3d": ["bar", "ship", "arcade", "camp", "roof", "navy", "fair"], baked: ["bar"], real: ["bar", "ship"] };
const roomsAsked = opt("rooms", "");
const SIZES = opt("sizes", "667x375,844x390,915x412,932x430,1280x720,1920x1080")
  .split(",")
  .map((s) => s.split("x").map(Number));
const isPhone = ([w, h]) => Math.min(w, h) < 520;
/** The widest band of dark columns allowed at either end, as a share of the width. */
const BAND = 0.05;
/** How much more of the board (square CSS pixels) the corner may cover than in the run compared with. */
const COVER_SLACK = 16;
const compareTo = opt("compare", "");
const before = compareTo ? JSON.parse(readFileSync(compareTo, "utf8")) : null;
const cover = {};
mkdirSync(out, { recursive: true });

const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

/**
 * The dark band at each end of a still: how many columns, from either edge, are much darker than
 * the picture's middle. Rows from `top` to `bottom` (the picture above the bar, below the corner buttons).
 */
async function darkEnds(png, top, bottom) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const [y0, y1] = [Math.max(0, Math.round(top)), Math.min(height, Math.round(bottom))];
  const col = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * channels;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    col[x] = sum / Math.max(1, y1 - y0);
  }
  const middle = [...col.slice(Math.round(width * 0.3), Math.round(width * 0.7))].sort((a, b) => a - b);
  const ref = middle[Math.floor(middle.length / 2)];
  // A column is "dark" at under a third of the middle's brightness.
  const dark = (x) => col[x] < ref / 3;
  let left = 0;
  while (left < width && dark(left)) left++;
  let right = 0;
  while (right < width && dark(width - 1 - right)) right++;
  return { left: left / width, right: right / width };
}

/** The 3D look's empty background (look3d/room3d.js, scene.background 0x03050c): what shows past the room. */
const EMPTY = [3, 5, 12];
/**
 * How many of the picture's columns (rows `top` to `bottom`) are mostly the 3D look's empty
 * background, as a share of the width: a strip past the room. (A room whose own sky is that dark,
 * the star lounge's space through its window, has it in patches, never down a whole column.)
 */
async function emptyShare(png, top, bottom) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const [y0, y1] = [Math.max(0, Math.round(top)), Math.min(height, Math.round(bottom))];
  let columns = 0;
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * channels;
      if (EMPTY.every((v, c) => Math.abs(data[i + c] - v) <= 1)) n++;
    }
    if (n > 0.8 * (y1 - y0)) columns++;
  }
  return columns / width;
}

const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
try {
  async function page(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return p;
  }
  const drawn = (look) => (look === "flat" ? "svg.scene" : ".look3d canvas");
  /** One still and its measure. */
  async function still(p, look, room, who, [w, h]) {
    await p.setViewportSize({ width: w, height: h });
    // The corner's buttons lose their words a few seconds in (room-menu.js, fold): every still is
    // taken after that, and after their 0.4 s fold, so none catches them part way.
    if (await p.locator(".corner").count()) await p.waitForSelector(".corner.folded", { timeout: 30000, state: "attached" });
    await sleep(look === "flat" ? 1200 : 2500);
    const name = `${look}-${room}-${who}-${w}x${h}`;
    const png = await p.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
    const { bar, drew, covered } = await p.evaluate(() => {
      // How much of the Tonight board (the flat look's, or the 3D looks' words on the wall) the corner buttons cover, in square CSS pixels.
      const board = document.querySelector(".board-hit, .l3-board")?.getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".corner .corner-btn, .corner .door-btn")].map((b) => b.getBoundingClientRect());
      const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return {
        bar: document.querySelector(".bar")?.offsetHeight ?? 0,
        drew: window.__roomRendered ? "real" : window.__roomBaked ? "baked" : window.__room3d ? "3d" : document.querySelector("svg.scene") ? "flat" : "?",
        covered: board ? Math.round(buttons.reduce((sum, b) => sum + area(board, b), 0)) : null,
      };
    });
    cover[name] = covered;
    if (before && covered != null && before[name] != null)
      check(covered <= before[name] + COVER_SLACK, `${name}: the corner buttons cover no more of the Tonight board than before (${covered} px², before ${before[name]})`);
    const ends = await darkEnds(png, 64, h - bar);
    check(drew === look, `${name}: drawn by the ${drew} look`);
    const band = `left ${(ends.left * 100).toFixed(1)}%, right ${(ends.right * 100).toFixed(1)}% of the width`;
    if (look === "3d") {
      const empty = await emptyShare(png, 64, h - bar);
      check(empty < 0.005, `${name}: nothing past the room shows (${(empty * 100).toFixed(1)}% of the width is a strip of empty background; dark at the ends: ${band})`);
    } else check(ends.left < BAND && ends.right < BAND, `${name}: no dark band at either end (${band})`);
  }

  for (const look of LOOKS) {
    const rooms = roomsAsked ? roomsAsked.split(",").filter((r) => ALL_ROOMS[look].includes(r)) : ALL_ROOMS[look];
    for (const room of rooms) {
      console.log(`\n     -- ${look}, ${room}`);
      if (look === "baked") {
        for (const [who, sizes] of [
          ["screen", SIZES.filter((s) => !isPhone(s))],
          ["phone", SIZES.filter(isPhone)],
        ]) {
          if (!sizes.length) continue;
          const p = await page(`baked ${who}`, { width: sizes[0][0], height: sizes[0][1] }, who === "phone" ? { hasTouch: true, isMobile: true } : {});
          await p.goto(`${base}/lobby/look3d/still.html?gl=any&look=baked&room=${room}&shot=live${who === "phone" ? "&as=player&zoom=room" : ""}`);
          await p.waitForSelector("html[data-ready]", { timeout: 90000, state: "attached" });
          for (const size of sizes) await still(p, look, room, who, size);
          await p.context().close();
        }
        continue;
      }
      const q = `look=${look}&room=${room}&gl=any${look === "real" ? "&rung=0&ladder=off" : ""}`;
      const screen = await page(`${look} ${room} screen`, { width: 1280, height: 720 });
      await screen.goto(`${base}/lobby/?start&${q}`);
      await screen.click("text=Use this as the room's screen");
      await screen.click("text=Show the room here");
      await screen.waitForSelector(drawn(look), { timeout: 90000, state: "attached" });
      await screen.waitForSelector(".code-digits");
      const pin = (await screen.locator(".code-digits").first().textContent()).trim();
      for (const size of SIZES.filter((s) => !isPhone(s))) await still(screen, look, room, "screen", size);

      const phone = await page(`${look} ${room} phone`, { width: 844, height: 390 }, { hasTouch: true, isMobile: true });
      await phone.goto(`${base}/lobby/?join=${pin}&${q}`);
      await phone.fill("input[name=nickname]", "Di");
      await phone.click("text=Join the party");
      await phone.waitForSelector(drawn(look), { timeout: 90000, state: "attached" });
      // A phone starts close; "whole room" is when its button offers "Closer". Waited for, as long as a busy machine takes to show it.
      const zoom = phone.locator(".zoom-btn");
      await zoom.waitFor({ state: "visible", timeout: 90000 });
      if (!/closer/i.test((await zoom.textContent({ timeout: 90000 })) ?? "")) {
        await zoom.click({ timeout: 90000 });
        await phone.waitForFunction(() => /closer/i.test(document.querySelector(".zoom-btn")?.textContent ?? ""), null, { timeout: 30000 });
      }
      for (const size of SIZES.filter(isPhone)) await still(phone, look, room, "phone", size);
      await screen.context().close();
      await phone.context().close();
    }
  }
  check(errors.length === 0, `no page reported an error${errors.length ? ": " + errors.slice(0, 5).join("; ") : ""}`);
} finally {
  await browser.close();
  writeFileSync(`${out}/corner.json`, JSON.stringify(cover, null, 1) + "\n");
}
console.log(`\n     stills in ${out}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nall ok");
