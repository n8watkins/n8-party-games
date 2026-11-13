// Cork & Bell played inside the party room while the room is in the 3D look, several rounds
// running, against a running local server. The room's 3D picture and the game are two WebGL
// pictures on one device (the game in its own frame), so this checks they do not fight:
//
//   - under the game the 3D room is not shown and draws no frames at all
//   - both pictures keep their WebGL context through every round
//   - the room draws again when the game is taken away, for the result and the next vote
//   - what the page holds in memory does not climb from round to round
//
//   node lobby/test/e2e-cork-3d.mjs [--base=http://localhost:8791] [--rounds=3] [--room=ship] [--soft=1]
//
// A round is ninety seconds and nothing shortens it, so three take about five minutes. It
// drives a headless, muted Chrome on the Windows side, on the real graphics card
// (node_modules/cork-and-bell/tools/browser.mjs: no window, its own profile, closed at the end).
// --soft=1 uses the software renderer inside WSL instead, which is very slow.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowser } from "../../node_modules/cork-and-bell/tools/browser.mjs";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

// Its own Chrome profile on the Windows side, so it never meets another tool's browser.
process.env.CAB_PROFILE ??= join(tmpdir(), "party-room-3d-chrome-profile");
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const rounds = Number(opt("rounds", "3"));
const skin = opt("room", "ship");
const soft = opt("soft", "0") === "1";
const { api, call } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const FRAME = 'iframe[title="Cork & Bell"]';

const b = await openBrowser({ win: !soft, width: 844, height: 390 });
try {
  const context = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/lobby/?start&look=3d&room=${skin}&cork-auto=1&cork-quality=low${soft ? "&gl=any" : ""}`);
  await page.fill("input[name=nickname]", "Sol");
  await page.click("text=Start the party");
  await page.waitForSelector(".look3d canvas", { timeout: 60000 });
  const pin = (await page.locator(".l3-pin").textContent()).trim();
  const code = (await call("GET", "/join/" + pin)).preview.code;
  const room = async () => (await (await fetch(api + "/debug/" + code)).json()).room?.view;
  const until = async (test, ms, what) => {
    for (const from = Date.now(); Date.now() - from < ms; await sleep(200)) {
      const view = await room();
      if (view && test(view)) return view;
    }
    throw new Error("timed out waiting for " + what);
  };
  const first = await until((v) => v.members[0]?.connected, 10000, "the player to be in the room");
  const n = first.boxes.length;
  const corkAt = Math.round(boxCentre(first.boxes.findIndex((box) => box.id === "cork-and-bell"), n));
  const key = async (k, ms) => {
    await page.keyboard.down(k);
    await sleep(ms);
    await page.keyboard.up(k);
  };
  const walkTo = async (x) => {
    for (let i = 0; i < 16; i++) {
      const gap = x - (await room()).members[0].x;
      if (Math.abs(gap) < 16) return;
      await key(gap > 0 ? "ArrowRight" : "ArrowLeft", Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
      await sleep(150);
    }
  };
  /** What the room's own 3D picture is doing: frames drawn, whether its context is alive, whether it is shown. */
  const look = () =>
    page.evaluate(() => {
      const r = window.__room3d;
      return { frames: r.drawn.frames, lost: r.renderer.getContext().isContextLost(), shown: getComputedStyle(r.el).visibility !== "hidden", heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, textures: r.renderer.info.memory.textures, geometries: r.renderer.info.memory.geometries };
    });
  const start = await look();
  console.log(`     the 3D room (${skin}) is up: ${start.textures} textures, ${start.geometries} geometries, ${start.heap ?? "?"} MB of script memory`);
  const heaps = [];

  for (let round = 1; round <= rounds; round++) {
    await walkTo(corkAt);
    await until((v) => v.phase === "playing" && v.game?.id === "cork-and-bell", 15000, `round ${round} to start`);
    await page.waitForSelector(FRAME, { timeout: 30000 });
    const frame = await (await page.$(FRAME)).contentFrame();
    await frame.waitForFunction(() => window.__cab?.views?.length > 0, null, { timeout: 90000 });
    await sleep(2500);
    const a = await look();
    await sleep(4000);
    const during = await look();
    const game = await frame.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
      return { canvas: !!canvas, lost: gl ? gl.isContextLost() : null, fps: window.__cab.fps?.() ?? null };
    });
    check(!during.shown && during.frames === a.frames, `round ${round}: under the game the 3D room is hidden and draws nothing (${during.frames - a.frames} frames in four seconds)`);
    check(!during.lost && game.canvas && game.lost === false, `round ${round}: the room's picture and the game's both hold their WebGL context`);
    await until((v) => v.phase === "lobby", 130000, `round ${round} to end`);
    await page.waitForSelector(FRAME, { state: "detached", timeout: 20000 });
    await sleep(1500);
    const b1 = await look();
    await sleep(1500);
    const after = await look();
    check(after.shown && !after.lost && after.frames > b1.frames, `round ${round}: the game is taken away and the 3D room draws again (${after.frames - b1.frames} frames in a second and a half)`);
    check(after.textures === start.textures && after.geometries <= start.geometries + 30, `round ${round}: the room holds what it held before (${after.textures} textures, ${after.geometries} geometries)`);
    heaps.push(after.heap);
    // The card with the result goes away by itself; then the next vote.
    await page.waitForSelector(".card", { state: "detached", timeout: 15000 }).catch(() => {});
    await sleep(6500);
  }
  if (heaps[0] !== null) check(heaps[heaps.length - 1] < heaps[0] * 1.5 + 20, `script memory after each round: ${heaps.join(", ")} MB (it does not climb round on round)`);
  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await b.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
