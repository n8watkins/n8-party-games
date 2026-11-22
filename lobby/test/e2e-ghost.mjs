// The ghost's page, end to end, where only a real page can show it: real pages and real sockets
// in one room, against a running local server, in the flat look. The browser is headless and
// MUTED, and is closed at the end whatever happens.
//
//   node lobby/test/e2e-ghost.mjs [--base=http://localhost:8791]
//
// What it goes through (each was a fault found in review of the ghost's second half):
//   two ghosts      a ghost's page does not ask the room to spook a piece it saw another ghost
//                   spook a moment ago (the room would refuse it)
//   a change        a ghost that becomes a pawn mid-fade is drawn solid at once on every page,
//                   and solid again as a ghost
//   a reload        a page reloaded in the middle of a scare draws it as a scare (wide eyes), not
//                   a knock; a ghost's page reloaded mid-fade still spooks for the rest of its fade
//   every body      a robot is scared (its hook goes through a faded ghost; only the pawn kicks),
//                   a slime and a robot are spooked (a faded ghost drifts through them), drawn
//                   wide-eyed and pale in the flat look and in 3D, and a page of either look
//                   reloaded mid-scare draws the robot's scare
//
//   --shots=DIR     stills of each fright, in each look
import { mkdirSync } from "node:fs";
import { COLOUR_PRESETS, LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { SCARE_FREEZE_MS, SCARE_START_MS } from "../shared/ghost.js";
import { MOVED, moved, movedPose } from "../shared/moves.js";
import { ROOM } from "../shared/world.js";
import { apart, meanColour, paintBox } from "./pixels.mjs";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log("\n     -- " + name);
/**
 * A check of what a phone drew, judged on the frames it drew: `ok` null when no frame fell where it
 * could show the thing (a page starved of frames on a busy machine). An unseen check does not
 * fail, but the run counts them, and fails if more than UNSEEN_SHARE of its drawn checks went
 * unseen. What the room did is checked from its messages in every run, frames or not.
 */
const UNSEEN_SHARE = 0.25;
const drawnChecks = { all: 0, unseen: [] };
const seenCheck = (ok, what) => {
  drawnChecks.all++;
  if (ok === null) {
    drawnChecks.unseen.push(what);
    console.log("seen? " + what + " (not seen: no frame fell inside it)");
    return;
  }
  check(ok, what);
};
/** The pale a fright tints a piece toward (look3d/pieces.js, PALE), as a page shows it. */
const PALE_RGB = { r: 0xee, g: 0xf3, b: 0xfb };

/**
 * Read in each page: what it sent the room (window.__out: fades, boos and looks), a way to send
 * on its own socket (window.__send), how faded a seat's ghost is drawn and how wide-eyed a piece is.
 */
function pageHelpers() {
  window.__out = [];
  const send = WebSocket.prototype.send;
  // A page told to (holdHello, set before a reload) keeps everything it would send to the room
  // until the test lets it (window.__goHello): so it arrives in the room at a moment of the test's choosing.
  let holding = sessionStorage.getItem("holdHello") === "1";
  sessionStorage.removeItem("holdHello");
  const heldSends = [];
  window.__goHello = () => {
    holding = false;
    for (const [ws, data] of heldSends.splice(0)) ws.send(data);
  };
  WebSocket.prototype.send = function (data) {
    if (holding) return void heldSends.push([this, data]);
    // The first whole room this page heard (its own clock), and how long each seat is still down in it.
    if (window.__ws !== this)
      this.addEventListener("message", (e) => {
        let m = null;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        const members = m?.room?.members ?? m?.members;
        if (Array.isArray(members) && !window.__firstRoom) window.__firstRoom = { at: performance.now(), down: members.map((x) => x?.down ?? null) };
        // When this page heard each fright (its own clock): a spook, a hook's verdict, a kick.
        if (m && ["spook", "hk", "b"].includes(m.t)) (window.__heardFrights ??= []).push({ t: m.t, s: m.s, to: m.to, o: m.o, sc: m.sc, at: performance.now() });
      });
    window.__ws = this;
    // When this page first spoke to the room (its hello): for a page that must arrive in the middle of something.
    window.__firstSend ??= Date.now();
    try {
      const m = JSON.parse(data);
      if (m && (m.t === "boo" || m.t === "fade" || m.t === "look")) window.__out.push({ ...m, at: performance.now() });
    } catch {
      // A keep-alive ("ping"): not JSON.
    }
    return send.call(this, data);
  };
  window.__send = (m) => window.__ws.send(JSON.stringify(m));
  // While window.__holdFrames is set, the page draws no new frame (the last one stays on the
  // screen): a picture of a pose is taken of the very frame that was judged to show it.
  const raf = window.requestAnimationFrame.bind(window);
  const held = [];
  window.requestAnimationFrame = (cb) => (window.__holdFrames ? (held.push(cb), -1) : raf(cb));
  window.releaseFrames = () => {
    window.__holdFrames = false;
    for (const cb of held.splice(0)) raf(cb);
  };
  const g = (seat) => document.querySelector(`svg.scene g[data-seat="${seat}"]`);
  window.fadedOn = (seat) => Number(g(seat)?.getAttribute("data-faded") ?? 0);
  // How frightened a seat's piece is drawn, in either look: how wide its eyes (0 to 1) and how pale.
  window.frightOn = (seat) => {
    const room = window.__room3d;
    if (room) {
      const p = room.pieces.get(seat);
      if (!p) return { scared: 0, pale: 0, character: null };
      const tint = p.body.mat?.userData?.tint?.value;
      // glow and lit: how brightly its paint is drawn (a robot's emissive and the light it stands in).
      const r2 = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
      return { scared: p.fright ? (p.body.scaredK ?? 0) : 0, pale: p.body.pale ?? 0, paint: tint ? tint.w : null, character: p.kind.id, glow: r2(p.body.mat?.emissiveIntensity), lit: r2(p.body.lit) };
    }
    const el = g(seat);
    const sat = /saturate\(([\d.]+)\)/.exec(el?.style.filter ?? "");
    return { scared: Number(el?.getAttribute("data-scared") ?? 0), pale: sat ? (1 - Number(sat[1])) / 0.55 : 0, character: el?.dataset.character ?? null };
  };
  window.scaredOn = (seat) => window.frightOn(seat).scared;
  // Calls each of window.__afterDraw (now) right after the page's view has drawn a frame, inside
  // the same call: what is read then is exactly what that frame drew, with the frame's own clock.
  window.__afterDraw = new Set();
  const patch = () => {
    const view = globalThis.__partyRoom?.view;
    if (view && typeof view.frame === "function" && !view.__watched) {
      const draw = view.frame.bind(view);
      view.frame = (now, ...rest) => {
        const out = draw(now, ...rest);
        for (const cb of window.__afterDraw) cb(now);
        return out;
      };
      view.__watched = true;
    }
    raf(patch);
  };
  raf(patch);
  // Keeps, for `ms`, the most frightened a seat's piece was drawn, in window.__fright.
  window.watchFright = (seat, ms) => {
    // path: every frame drawn, [its clock, scared, pale, paint].
    const most = (window.__fright = { scared: 0, pale: 0, paint: 0, character: null, frames: 0, path: [] });
    const until = performance.now() + ms;
    const look = (now) => {
      if (now > until) return void window.__afterDraw.delete(look);
      most.frames++;
      const f = window.frightOn(seat);
      most.scared = Math.max(most.scared, f.scared);
      most.pale = Math.max(most.pale, f.pale);
      most.paint = Math.max(most.paint, f.paint ?? 0);
      most.character = f.character;
      most.path.push([now, f.scared, f.pale, f.paint ?? null]);
    };
    window.__afterDraw.add(look);
  };
  // A page about to be reloaded can be told to watch a seat from the first frame it draws after
  // (sessionStorage outlives the reload): window.__frightPath, every frame it draws [its clock, how
  // wide-eyed, what the page holds of the fright then: its kind and how far into it, or "flat"].
  const onLoad = JSON.parse(sessionStorage.getItem("frightOnLoad") ?? "null");
  if (onLoad) {
    sessionStorage.removeItem("frightOnLoad");
    window.__frightPath = [];
    let until = null;
    const look = (now) => {
      const f = window.frightOn(onLoad.seat);
      if (!f.character) return;
      until ??= now + onLoad.ms;
      if (now > until) return void window.__afterDraw.delete(look);
      const p = window.__room3d?.pieces.get(onLoad.seat);
      window.__frightPath.push([now, f.scared, window.__room3d ? `${p?.fright?.kind ?? "none"}@${p?.fright ? Math.round(now - p.fright.at) : "-"}` : "flat"]);
    };
    window.__afterDraw.add(look);
  }
}

const browser = await launchBrowser({ args: ["--autoplay-policy=user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sockets = [];
try {
  const errors = [];
  async function open(name) {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
    await context.addInitScript(pageHelpers);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  // The 3D look is asked for with gl=any: this browser may draw in software, which a page only accepts when told to.
  const drawn = (page, look = "flat") =>
    look === "flat" ? page.waitForSelector("svg.scene g[data-seat]", { timeout: 20000 }) : page.waitForFunction(() => window.__room3d?.pieces?.size > 0, null, { timeout: 40000 });
  async function join(name, pin, look = "flat") {
    const page = await open(name);
    await page.goto(`${base}/lobby/?join=${pin}&${look === "flat" ? "look=flat" : `look=${look}&gl=any`}`);
    await page.waitForSelector(".door-title");
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    await drawn(page, look).catch(async (err) => {
      console.log(`     (${name}'s page instead says: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)})`);
      throw err;
    });
    return page;
  }
  /** A bare socket that follows the room moving its own piece by a spook or a scare too. */
  function bare(session) {
    const c = connect(session);
    const orig = c.ws.onmessage;
    c.ws.onmessage = (ev) => {
      orig(ev);
      const m = c.seen.at(-1);
      if (m?.t === "spook" && m.to === c.seat) [c.x, c.rev] = [m.x, m.rev];
      if (m?.t === "b" && m.sc !== undefined && m.s === c.seat) [c.x, c.rev] = [m.x, m.rev];
      // A robot's hook through a faded ghost scares the robot off (shared/robot.js).
      if (m?.t === "hk" && m.s === c.seat && Number.isFinite(m.x)) [c.x, c.rev] = [m.x, m.rev];
    };
    sockets.push(c);
    return c;
  }
  /**
   * Ada goes at the faded ghost in front of her with her move: a pawn kicks it, a robot throws its
   * hook into it (only the pawn kicks; lobby/shared/robot.js). Resolves {to, sc} as a kick's
   * answer reads (`sc`: the ghost, when she was scared off), or null.
   */
  const goAt = async ({ look = false } = {}) => {
    // Where everyone stood just before (asked only where a round trip's wait does not matter).
    const stoodBefore = look ? Object.fromEntries((await where()).filter(Boolean).map((x) => [x.seat, `${Math.round(x.x)}${x.d ? ` d${x.d}` : ""}${x.faded ? " faded" : ""}`])) : null;
    const mark = ada.seen.length;
    const robot = ada.room?.members[ada.seat]?.character === "robot";
    ada.send({ t: robot ? "hook" : "b" });
    const m = await ada.wait((m) => m.s === ada.seat && (robot ? m.t === "hk" : m.t === "b"), 2000, mark).catch(() => null);
    // What the room said around it (for a failure's message): the last few moves and frights.
    const around = ada.seen
      .slice(Math.max(0, mark - 6))
      .filter((x) => ["spook", "fade", "hook", "hk", "b", "m"].includes(x.t))
      .map((x) => `${x.t}${x.o ? ":" + x.o : ""} ${x.s ?? ""}${x.to !== undefined ? ">" + x.to : ""}${x.t === "m" ? ` d${x.d}` : ""}`);
    return m && (robot ? { to: m.to, sc: m.o === "scare" ? m.to : undefined, o: m.o, around, stoodBefore } : { to: m.to, sc: m.sc, around, stoodBefore });
  };

  section("a party of four: Ada (a bare socket), Bea, Eve and Cy (phones)");
  const host = await call("POST", "/rooms", { nickname: "Ada" });
  const ada = bare(host);
  await ada.opened;
  const bea = await join("Bea", host.pin);
  const eve = await join("Eve", host.pin);
  const cy = await join("Cy", host.pin);
  await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 10000, 0);
  const seat = (name) => ada.room.members.find((m) => m?.name === name).seat;
  const [A, B, E, C] = ["Ada", "Bea", "Eve", "Cy"].map(seat);
  const where = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view.members;
  const lookAs = async (page, s, c) => {
    const from = ada.seen.length;
    await page.evaluate((c) => window.__send({ t: "look", c }), c);
    await ada.wait((m) => m.room?.members[s]?.character === c, 4000, from);
    await sleep(LOOK_COOLDOWN_MS);
  };
  await lookAs(bea, B, "ghost");
  await lookAs(eve, E, "ghost");
  check(true, "Bea and Eve are ghosts");
  /** A phone's ghost fades (its button), and the room says so. */
  const fade = async (page, s) => {
    const from = ada.seen.length;
    await page.keyboard.press("KeyX");
    return ada.wait((m) => m.t === "fade" && m.s === s, 3000, from).catch(() => null);
  };
  /** Waits until a ghost's fade is ready again, by the room's word. */
  const ready = async (s) => {
    for (let i = 0; i < 60 && (await where())[s].fadeCool > 0; i++) await sleep(200);
    await sleep(200);
  };
  /** A phone's piece walks a moment toward x. */
  const step = async (page, s, x, ms = 160) => {
    const key = x > (await where())[s].x ? "ArrowRight" : "ArrowLeft";
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
  };

  // ================================================================ two ghosts
  section("two ghosts: the second does not ask about a piece the first just spooked");
  let at = await where();
  ada.goto(at[B].x + 30);
  await sleep(300);
  check(!!(await fade(bea, B)), "Bea fades");
  let from = ada.seen.length;
  await step(bea, B, at[B].x + 30);
  const first = await ada.wait((m) => m.t === "spook" && m.s === B, 2000, from).catch(() => null);
  check(first?.to === A, `walking through Ada, Bea's faded ghost spooks her (${JSON.stringify(first && { to: first.to, x: first.x })})`);
  // Ada stands just ahead of Eve, spooked a moment ago (the room would refuse to spook her again).
  await sleep(700);
  at = await where();
  ada.goto(at[E].x + 30);
  await sleep(300);
  check(!!(await fade(eve, E)), "Eve fades");
  from = ada.seen.length;
  await eve.evaluate(() => (window.__out = []));
  await step(eve, E, at[E].x + 30);
  await sleep(500);
  const passed = Math.abs((await where())[E].x - ada.x);
  const asked = (await eve.evaluate(() => window.__out)).filter((m) => m.t === "boo").map((m) => m.to);
  check(passed < 46 || (await where())[E].x > ada.x, `Eve's faded ghost drifts through Ada (${passed} apart after)`);
  // About Ada only: someone else standing near may be spooked on the way (on the bar's production
  // wall the four arrive 100 apart by the door, so Cy stands just past Ada).
  check(!asked.includes(A) && !ada.seen.slice(from).some((m) => m.t === "spook" && m.to === A), `and her page never asks about Ada, spooked a moment ago (it asked about seats ${JSON.stringify(asked)})`);

  // ================================================================ a change mid-fade
  section("a ghost that becomes a pawn mid-fade is drawn solid at once, and solid as a ghost again");
  await lookAs(cy, C, "ghost");
  check(!!(await fade(cy, C)), "Cy, now a ghost, fades");
  const seenFaded = await bea.waitForFunction((s) => window.fadedOn(s) > 0.8, C, { timeout: 2000, polling: 30 }).then(() => true, () => false);
  check(seenFaded, "Bea's phone draws him faded");
  const changed = Date.now();
  from = ada.seen.length;
  await cy.evaluate(() => window.__send({ t: "look", c: "pawn" }));
  const ended = await ada.wait((m) => m.t === "fade" && m.s === C && m.for === 0, 2000, from).catch(() => null);
  check(!!ended, "the room tells everybody his fade is over");
  const solid = await bea.waitForFunction((s) => window.fadedOn(s) === 0, C, { timeout: 2000, polling: 30 }).then(() => true, () => false);
  check(solid && Date.now() - changed < 1500, `Bea's phone draws his pawn solid at once (${Date.now() - changed} ms after the change; the fade had 2.5 s to run)`);
  // His own page takes the same message on its own socket: waited for as Bea's is, not read once (a busy machine can be a frame behind).
  const solidOwn = await cy.waitForFunction((s) => window.fadedOn(s) === 0, C, { timeout: 2000, polling: 30 }).then(() => true, () => false);
  check(solidOwn && Date.now() - changed < 1500, `and so does his own phone (${Date.now() - changed} ms after the change)`);
  await sleep(LOOK_COOLDOWN_MS);
  await cy.evaluate(() => window.__send({ t: "look", c: "ghost" }));
  await ada.wait((m) => m.room?.members[C]?.character === "ghost", 3000, from);
  await sleep(200);
  const again = [await bea.evaluate((s) => window.fadedOn(s), C), await cy.evaluate((s) => window.fadedOn(s), C), await eve.evaluate((s) => window.fadedOn(s), C)];
  check(again.every((f) => f === 0), `back to a ghost straight after, he is drawn solid on every phone (${again.join(", ")})`);

  // ================================================================ a reload mid-scare
  section("a page reloaded in the middle of a scare draws a scare");
  // Bea's fade is ready again 8 s after it began.
  await ready(B);
  at = await where();
  ada.goto(at[B].x - 60);
  ada.send({ t: "m", x: at[B].x - 60, d: 1, r: ada.rev });
  ada.send({ t: "m", x: at[B].x - 60, d: 0, r: ada.rev });
  await sleep(300);
  check(!!(await fade(bea, B)), "Bea fades again");
  from = ada.seen.length;
  ada.send({ t: "b" });
  const scare = await ada.wait((m) => m.t === "b" && m.s === A, 2000, from).catch(() => null);
  check(scare?.sc === B, `Ada kicks her faded ghost and is scared (${JSON.stringify(scare && { to: scare.to, sc: scare.sc })})`);
  const reloadAt = Date.now();
  await cy.reload();
  await drawn(cy);
  const loaded = Date.now() - reloadAt;
  const wide = await cy.waitForFunction((s) => window.scaredOn(s) > 0.5, A, { timeout: 1500, polling: 20 }).then(() => true, () => false);
  check(wide, `Cy's phone, reloaded ${loaded} ms into it, draws Ada scared (wide eyes), not knocked over`);

  // ================================================================ a reload mid-fade
  section("a ghost's page reloaded mid-fade still spooks for the rest of its fade");
  // Eve's fade is ready again, and Ada is up and safe no more.
  await ready(E);
  for (let i = 0; i < 40 && ((await where())[A].safe > 0 || (await where())[A].spooked > 0); i++) await sleep(200);
  at = await where();
  ada.goto(at[E].x + 30);
  await sleep(300);
  check(!!(await fade(eve, E)), "Eve fades");
  const reloadEve = Date.now();
  await eve.reload();
  await drawn(eve);
  console.log(`     (Eve's page is back ${Date.now() - reloadEve} ms into her fade)`);
  from = ada.seen.length;
  await step(eve, E, at[E].x + 30);
  const late = await ada.wait((m) => m.t === "spook" && m.s === E, 1500, from).catch(() => null);
  check(late?.to === A, `walking through Ada after the reload, Eve's ghost spooks her (${JSON.stringify(late && { to: late.to })})`);

  // ================================================================ every body
  section("a robot is scared and a slime and a robot spooked, drawn so in the flat look and in 3D");
  // The room is full (four), so Eve's phone, her ghost's, turns to the 3D look: Cy's stays flat.
  await eve.goto(`${base}/lobby/?look=3d&gl=any`);
  await drawn(eve, "3d");
  /** Waits until Ada is up, not safe and not lately spooked, by the room's word. */
  const calmAgain = async () => {
    for (let i = 0; i < 60 && ((await where())[A].safe > 0 || (await where())[A].spooked > 0); i++) await sleep(200);
  };
  /** Watches Ada's piece on the flat page (Cy) and the 3D one (Eve) through a fright, with a still of each at its height. */
  const watched = async (character, what, act) => {
    for (const page of [cy, eve]) await page.evaluate((s) => window.watchFright(s, 2400), A);
    const done = await act();
    await sleep(420);
    if (shots) {
      await cy.screenshot({ path: `${shots}/flat-${character}-${what}.png` });
      await eve.screenshot({ path: `${shots}/3d-${character}-${what}.png` });
    }
    await sleep(2100);
    // Each frame each page drew, by its own clock, against the fright's own pose (shared/moves.js)
    // from when that page heard it, within a frame's timing either way: how wide-eyed and how pale.
    // Unseen when no frame fell where the pose is at its widest and palest.
    for (const [page, label] of [[cy, "flat: Ada's " + character + " goes wide-eyed and pale when " + what], [eve, "3D: and so it does on Eve's phone"]]) {
      const { watch, heard } = await page.evaluate(() => ({ watch: window.__fright, heard: window.__heardFrights ?? [] }));
      const h = heard.filter((x) => (x.t === "spook" && x.to === A) || (x.t === "hk" && x.s === A && x.o === "scare") || (x.t === "b" && x.s === A && x.sc !== undefined)).at(-1);
      if (!h) {
        check(false, `${label} (the page never heard the fright)`);
        continue;
      }
      const kind = h.t === "spook" ? "spook" : h.t === "hk" ? "hookscare" : "scare";
      const f = moved(kind, 0, 0, 0);
      const pose = (ms) => movedPose(f, Math.max(0, ms));
      const LAG = 40;
      const near = (key, ms, v) => {
        const vals = [-LAG, -LAG / 2, 0, LAG / 2, LAG].map((d) => pose(ms + d)[key]);
        return v >= Math.min(...vals) - 0.15 && v <= Math.max(...vals) + 0.15;
      };
      const frames = watch.path.map(([t, scared, pale, paint]) => ({ ms: t - h.at, scared, pale, paint })).filter((x) => x.ms >= 0 && x.ms <= MOVED[kind].ms);
      const off = frames.filter((x) => !near("scared", x.ms, x.scared) || !near("pale", x.ms, x.pale) || (character === "robot" && page === eve && x.paint !== null && Math.abs(x.paint - 0.5 * x.pale) > 0.1));
      const peak = frames.filter((x) => pose(x.ms).scared > 0.9 && pose(x.ms).pale > 0.5);
      const story = `${kind}; ${frames.length} frames in it, ${peak.length} at its widest and palest; ${off.length ? `off its pose: ${off.map((x) => `${Math.round(x.ms)}ms scared ${x.scared.toFixed(2)} (due ${pose(x.ms).scared.toFixed(2)}) pale ${x.pale.toFixed(2)} (due ${pose(x.ms).pale.toFixed(2)})`).join(", ")}` : "every frame on its pose"}`;
      seenCheck(watch.character !== character || off.length ? false : peak.length ? true : null, `${label} (${story})`);
    }
    return done;
  };
  for (const character of ["slime", "robot"]) {
    await calmAgain();
    from = ada.seen.length;
    ada.send({ t: "look", c: character });
    await ada.wait((m) => m.room?.members[A]?.character === character, 4000, from);
    await sleep(LOOK_COOLDOWN_MS);

    // Scared: Ada's robot, facing Bea's faded ghost, throws its hook into it. (Only the pawn kicks,
    // so a slime is never scared: a slime is only spooked, below.)
    if (character === "robot") {
      await ready(B);
      at = await where();
      ada.goto(at[B].x - 60);
      ada.send({ t: "m", x: at[B].x - 60, d: 1, r: ada.rev });
      ada.send({ t: "m", x: at[B].x - 60, d: 0, r: ada.rev });
      await sleep(300);
      check(!!(await fade(bea, B)), `Bea fades (Ada is a ${character})`);
      const kick = await watched(character, "scared", goAt);
      check(kick?.sc === B, `Ada's ${character} hooked Bea's faded ghost and was scared (${JSON.stringify(kick && { to: kick.to, sc: kick.sc })})`);
    }

    // Spooked: Eve's faded ghost drifts through Ada.
    await ready(E);
    await calmAgain();
    at = await where();
    ada.goto(at[E].x + 30);
    await sleep(300);
    check(!!(await fade(eve, E)), `Eve fades (Ada is a ${character})`);
    const spook = await watched(character, "spooked", async () => {
      const mark = ada.seen.length;
      await step(eve, E, at[E].x + 30);
      return ada.wait((m) => m.t === "spook" && m.s === E, 1500, mark).catch(() => null);
    });
    check(spook?.to === A, `Eve's faded ghost spooked Ada's ${character} (${JSON.stringify(spook && { to: spook.to })})`);
  }

  section("a page of either look reloaded mid-scare draws a scared robot (its hook went through a faded ghost)");
  for (const character of ["robot"]) {
    await calmAgain();
    if ((await where())[A].character !== character) {
      from = ada.seen.length;
      ada.send({ t: "look", c: character });
      await ada.wait((m) => m.room?.members[A]?.character === character, 4000, from);
      await sleep(LOOK_COOLDOWN_MS);
    }
    // The page is reloaded and holds back its first word to the room (holdHello) until Ada's hook
    // has gone through Bea and Ada is scared: so it arrives in the middle of the scare by
    // construction, however long the reload takes. Then it is judged on its own frames against
    // the room's word on the scare (still on when it drew: wide-eyed; over: calm). Tried once
    // more only when no frame could be judged.
    for (const [page, look] of [[cy, "flat"], [eve, "3d"]]) {
      let seen = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        await ready(B);
        await calmAgain();
        at = await where();
        ada.goto(at[B].x - 60);
        ada.send({ t: "m", x: at[B].x - 60, d: 1, r: ada.rev });
        ada.send({ t: "m", x: at[B].x - 60, d: 0, r: ada.rev });
        await sleep(300);
        check(!!(await fade(bea, B)), `Bea fades (Ada is a ${character})`);
        // The room's own address, as a reload does, with the look asked for again.
        const reload = () => page.goto(`${base}/lobby/?${look === "flat" ? "look=flat" : "look=3d&gl=any"}`);
        // Watched from the first frame the reloaded page draws (frightOnLoad), on its own clock,
        // and holding back its first word to the room until told (holdHello).
        await page.evaluate((s) => {
          sessionStorage.setItem("frightOnLoad", JSON.stringify({ seat: s, ms: 2500 }));
          sessionStorage.setItem("holdHello", "1");
        }, A);
        await reload();
        from = ada.seen.length;
        const scared = await goAt();
        // The scare began when the room's word on the hook came: now the page may speak.
        const kickAt = ada.seen.slice(from).find((m) => m.t === "hk" && m.s === A)?.at ?? Date.now();
        await page.evaluate(() => window.__goHello?.());
        await drawn(page, look);
        const back = Date.now() - kickAt;
        const firstSend = await page.evaluate(() => window.__firstSend);
        const after = firstSend > kickAt;
        console.log(`     (${look} ${character}: the page first spoke ${firstSend - kickAt} ms after the kick and drew ${back} ms after it)`);
        await sleep(1600);
        // Judged on the page's own clock against the first room it heard: how long Ada was still
        // down then. Still scared (by more than LEAD ms) when it first drew: it must draw her
        // wide-eyed while she is. Over (by more than TAIL ms) before it drew: it must draw her calm.
        // In between, or no frame at all: not seen.
        const LEAD = 250;
        const TAIL = 200;
        const { first, path, character: drawnAs } = await page.evaluate((s) => ({ first: window.__firstRoom ?? null, path: window.__frightPath ?? [], character: window.frightOn(s).character }), A);
        const heardLeft = first?.down?.[A] ?? null;
        const leftAt = (t) => (heardLeft ?? -1e9) - (t - first.at);
        const firstLeft = path.length && first ? leftAt(path[0][0]) : null;
        const story = `it first drew ${path.length && first ? Math.round(path[0][0] - first.at) : "?"} ms after it heard the room, with ${heardLeft === null ? "the scare over" : `${heardLeft} ms of it left`}; ${path.filter(([, s]) => s > 0.5).length} of ${path.length} frames wide-eyed (${path.slice(0, 6).map(([t, s, held]) => `${Math.round(t - first.at)}ms:${s.toFixed(2)} ${held}`).join(", ")})`;
        const judged = !first ? { ok: false, how: "heard no room" } : !path.length ? { ok: null, how: "drew no frame" } : firstLeft > LEAD ? { ok: path.some(([t, s]) => leftAt(t) > 0 && s > 0.5) && drawnAs === character, how: "still scared as it drew" } : firstLeft < -TAIL ? { ok: path.every(([, s]) => s <= 0.5) && drawnAs === character, how: "over before it drew, drawn calm" } : { ok: null, how: "ending as it came back" };
        seen = { scared, after, judged, story, back };
        if (shots) await page.screenshot({ path: `${shots}/${look}-${character}-reloaded-mid-scare.png` });
        await sleep(1500);
        if (seen.judged.ok !== null) break;
      }
      const { scared, after, judged, story, back } = seen;
      check(scared?.sc === B, `Ada's ${character} hooked Bea's faded ghost (${JSON.stringify(scared?.sc === B ? { to: scared.to, sc: scared.sc } : scared)})`);
      const what = `${look}: a page that arrived in the middle of the scare (drawn ${back} ms after the kick) draws Ada's ${character} as the room has her when it is back: ${judged.how} (${story})`;
      if (!after) check(false, `${what}; it spoke to the room before the kick though held back`);
      else seenCheck(judged.ok, what);
    }
  }

  section("3D: a scared robot's paint goes pale in every colour, by its pixels");
  // Cy out of the way, at the far end: Ada stands just left of a ghost to hook it, and a piece
  // left standing there (Cy ended beside Eve after the reloads above) is caught by the hook first.
  await step(cy, C, ROOM.maxX, Math.ceil(((ROOM.maxX - (await where())[C].x) / 430) * 1000) + 300);
  await sleep(400);
  // Eve's page asks for less motion while the pictures are taken: the room's lamps and candles
  // flicker and its lightning flashes otherwise (look3d/rendered/bar/room.js), so two pictures a
  // second apart are lit differently, enough to hide a near-white paint's turn to the pale.
  await eve.emulateMedia({ reducedMotion: "reduce" });
  for (const [i, { hex, name }] of COLOUR_PRESETS.entries()) {
    await calmAgain();
    from = ada.seen.length;
    ada.send({ t: "look", c: "robot", v: hex });
    // A piece that already is that robot is told so (look-ok), with no room view.
    await ada.wait((m) => (m.room?.members[A]?.character === "robot" && m.room.members[A].colour === hex) || (m.t === "look-ok" && m.c === "robot" && m.v === hex), 4000, from);
    await sleep(LOOK_COOLDOWN_MS);
    // The two ghosts take turns, so one's fade recharges while the other's is used. A picture
    // that a busy machine took after the freeze (the robot had scurried off) is taken again,
    // once: the colour it read was not the robot's.
    let result = null;
    for (let attempt = 0; attempt < 2 && !result?.still; attempt++) {
      const [ghost, G] = (i + attempt) % 2 ? [eve, E] : [bea, B];
      await ready(G);
      await calmAgain();
      at = await where();
      const x = at[G].x - 60;
      ada.goto(x);
      ada.send({ t: "m", x, d: 1, r: ada.rev });
      ada.send({ t: "m", x, d: 0, r: ada.rev });
      // Standing there on Eve's phone (it eases to where the room says), and seen before the fright.
      await eve.waitForFunction(([s, x]) => Math.abs((window.__room3d.pieces.get(s)?.rx ?? -1e9) - x) < 1, [A, x], { timeout: 4000, polling: 50 }).catch(() => null);
      await sleep(250);
      // Left of its middle: the ghost it kicks stands up to its right. Halfway out, not at its edge:
      // a box on the edge takes in the dark wall behind as the scared robot leans, which turned the
      // near-white paints (Cream) darker by however much of the edge was in it.
      const PAINT_SIDE = -0.5;
      const before = await meanColour(eve, await paintBox(eve, A, PAINT_SIDE));
      const drawnBefore = await eve.evaluate((s) => window.frightOn(s), A);
      if (!(await fade(ghost, G))) check(false, `the ghost fades for ${name}`);
      // Frozen at its palest: wide-eyed and still. Judged on the frame Eve's page draws, right after
      // it draws it: the first frame in the freeze itself (not the start's hop, where it is drawn
      // higher and so lit differently), at its palest. The page then draws nothing more until the
      // picture is taken, so the picture is of that frame however long a busy machine takes.
      await eve.evaluate(
        ([s, from, to]) => {
          const hold = (now) => {
            const p = window.__room3d?.pieces.get(s);
            const since = p?.fright ? now - p.fright.at : -1;
            const f = window.frightOn(s);
            if (since >= from && since <= to && f.pale > 0.95 && f.scared > 0.95) {
              window.__holdFrames = true;
              window.__afterDraw.delete(hold);
            }
          };
          window.__afterDraw.add(hold);
          window.__dropHold = () => window.__afterDraw.delete(hold);
        },
        [A, SCARE_START_MS + 40, SCARE_START_MS + SCARE_FREEZE_MS - 40],
      );
      from = ada.seen.length;
      const kick = await goAt({ look: true });
      const frozen = await eve.waitForFunction(() => window.__holdFrames === true, null, { timeout: 2000, polling: 16 }).then(
        () => true,
        () => false,
      );
      await eve.evaluate(() => window.__dropHold?.());
      let box, pale, still, drawnPale;
      try {
        box = await paintBox(eve, A, PAINT_SIDE);
        pale = await meanColour(eve, box);
        // Still frozen as the picture was taken (it scurries off after), so the box was still on it.
        drawnPale = await eve.evaluate((s) => window.frightOn(s), A);
        still = drawnPale.pale > 0.95;
        if (shots && still) await eve.screenshot({ path: `${shots}/3d-robot-pale-${hex.slice(1)}.png`, clip: { x: box.x - 60, y: box.y - 110, width: 130, height: 150 } });
      } finally {
        await eve.evaluate(() => window.releaseFrames());
      }
      result = { G, kick, frozen, still, before, pale, attempt, drawnBefore, drawnPale, box, first: result ?? { G, kick, frozen } };
    }
    const { G, kick, frozen, still, before, pale, attempt, drawnBefore, drawnPale, box } = result;
    const was = apart(before, PALE_RGB);
    const now = apart(pale, PALE_RGB);
    // At least 15% of the way toward the pale. Taken in the freeze every time now (not the start's
    // hop), every paint but Cream moves 30 to 40%; Cream, near-white already, moves 19 to 21%
    // (237 to 189-191), which sat right on the old 20% and failed about one run in three.
    const paler = now <= 0.85 * was || now < 30;
    check(kick?.sc === G && frozen && still && paler, `${name} (${hex}): scared, its paint goes toward the pale (${JSON.stringify(before)} to ${JSON.stringify(pale)}: ${was} to ${now} from it${kick?.sc === G ? "" : `; the last hook ${JSON.stringify(kick)} at seat ${G}`}${paler ? "" : `; drawn ${JSON.stringify(drawnPale)} in ${JSON.stringify(box)}, before ${JSON.stringify(drawnBefore)}`}${attempt ? `; taken twice: the first try ${result.first.kick?.sc !== result.first.G ? `scared nobody (the hook: ${JSON.stringify(result.first.kick)}, at seat ${result.first.G})` : result.first.frozen ? "had moved off by the picture" : "never froze within 2 s"}` : ""}${still ? "" : "; it had moved off by the picture"})`);
  }

  await eve.emulateMedia({ reducedMotion: null });

  section("the pages");
  check(sockets.every((c) => c.ws.readyState === 1), "no socket was closed");
  check(errors.length === 0, `no page reported an error${errors.length ? ":\n       " + [...new Set(errors)].slice(0, 8).join("\n       ") : ""}`);
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  for (const c of sockets) c.ws.close();
  await browser.close();
}
console.log(`\n${drawnChecks.unseen.length} of ${drawnChecks.all} drawn checks went unseen (a page drew no frame inside them)${drawnChecks.unseen.length ? ":\n  " + drawnChecks.unseen.join("\n  ") : ""}`);
if (drawnChecks.unseen.length > UNSEEN_SHARE * drawnChecks.all) problems.push(`too many drawn checks went unseen: ${drawnChecks.unseen.length} of ${drawnChecks.all} (at most ${Math.floor(UNSEEN_SHARE * drawnChecks.all)})`);
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
