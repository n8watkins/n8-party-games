// The characters' counters, end to end: what happens when their moves overlap (the owner's
// round three), on real pages and real sockets in one room, against a running local server, in
// the flat look and in 3D. The browser is headless and MUTED, and is closed at the end whatever
// happens. With TEST_GPU=1 it draws on the graphics card (lobby/test/browser.mjs).
//
//   node lobby/test/e2e-counters.mjs [--base=http://localhost:8791] [--looks=flat,3d] [--shots=DIR (none: --shots=)]
//
// One phone (Pat, a pawn, played by its keys) and a big screen (1280 x 720) watch, and bare
// sockets (Ada, Bo, Cy) play the other pieces, saying exactly what a phone says. In each look one
// of the two watching pages asks for less motion, so every outcome is checked with it too. Every
// drawn check is judged on the frames each page drew, on that page's own clock, against the
// room's own messages; what the room did is checked from its messages.
//
//   the charged kick   Pat holds his kick: every page draws him wound up and glowing; let go, he
//                      dashes and kicks Bo further than a kick throws
//   into a hard slime  Pat's charged kick bounces off Cy's harden: thrown back further, down longer
//   into a faded ghost Pat's charged kick goes through Ada's fade: frozen longer than a scare
//   speeds             a pawn, a slime and a ghost walk side by side, each at its own speed, and
//                      the ghost floats on when it stops; the pawn jumps highest
//   the hook's counters (Ada a robot): ride the hook (Bo kicks as he is pulled), cut the line
//                      (Pat kicks the chain Bo is on), the cannonball (Cy, a slime, hardens in the
//                      air), steal and tug of war (Cy, now a robot, hooks Bo too: later, then at
//                      once), plant (Cy up on his legs as the hook lands), the empty hook (Bo, now a
//                      ghost, fades in the air)
import { mkdirSync } from "node:fs";
import { GETUP_MS, IMPACT_MS, KICK_CONTACT, STUN_MS, chargeBounce, chargeDash, chargeThrow, knockLanding, landingGround } from "../shared/bump.js";
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { BIG_SCARE_FREEZE_MS, BIG_SCARE_MS, SCARE_FREEZE_MS, SCARE_MS, SCARE_START_MS, SPOOK_REACH } from "../shared/ghost.js";
import { HARDEN_MS } from "../shared/slime.js";
import { MOVED, slideLanding } from "../shared/moves.js";
import { CURL_MS } from "../shared/counters.js";
import { PULL_MS, TUG_HOLD_MS } from "../shared/robot.js";
import { wallFor } from "../shared/rooms.js";
import { FLOAT_MS, JUMP_HEIGHT, LOW_JUMP_HEIGHT, walkSpeed } from "../shared/world.js";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const looks = opt("looks", "flat,3d").split(",").filter(Boolean);
// Stills of each counter, in each look, for the owner (outside every folder the local server watches).
const shots = opt("shots", "/tmp/claude-counters/stills");
if (shots) mkdirSync(shots, { recursive: true });
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
/**
 * A check of what a page drew, judged on the frames it drew: `ok` true or false when a frame fell
 * where it could show the thing, null when none did (a page starved of frames on a busy machine).
 * An unseen check does not fail, but the run fails if more than UNSEEN_SHARE of its drawn checks
 * went unseen, or if one check went unseen every time it ran.
 */
const UNSEEN_SHARE = 0.25;
const drawn = { all: 0, unseen: [], byCheck: new Map() };
const checkId = (what) => what.split(" (")[0].replace(/^(flat|3d|3D): /, "").replace(/-?\d+(\.\d+)?/g, "#");
const seen = (ok, what) => {
  drawn.all++;
  const id = checkId(what);
  const tally = drawn.byCheck.get(id) ?? { seen: 0, unseen: 0 };
  drawn.byCheck.set(id, tally);
  if (ok === null) {
    tally.unseen++;
    drawn.unseen.push(what);
    console.log("seen? " + what + " (not seen: no frame fell inside it)");
    return;
  }
  tally.seen++;
  check(ok, what);
};
const section = (name) => console.log("\n     -- " + name);

/** In each page: every frame its view draws, read in the same call as the frame (what it drew, on its own clock). */
function pageHelpers() {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (window.__ws !== this) {
      window.__heard = [];
      this.addEventListener("message", (e) => {
        let msg = null;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        for (const m of Array.isArray(msg) ? msg : [msg]) {
          if (!m?.t || m.t === "pong") continue;
          window.__heard.push({ ...m, at: performance.now() });
          reactTo(m);
        }
      });
    }
    window.__ws = this;
    return send.call(this, data);
  };
  const raf = window.requestAnimationFrame.bind(window);
  const shown = (el) => !!el && el.getAttribute("display") !== "none" && getComputedStyle(el).display !== "none";
  /** What a seat's piece looks like as drawn now, in either look. */
  window.drawnOf = (seat) => {
    const v = globalThis.__partyRoom?.view;
    const p = v?.pieces?.get(seat);
    if (!p) return null;
    const flat = v.look === "flat";
    const g = flat ? document.querySelector(`svg.scene g[data-seat="${seat}"]`) : null;
    return {
      x: p.rx,
      // The charge's glow: the flat look's attribute it styles by, the 3D pawn's own glow.
      charge: flat ? Number(g?.getAttribute("data-charge") ?? 0) : (p.body?.charge ?? 0),
      // Eyes wide with a fright, and squeezed shut while knocked down.
      scared: flat ? Number(g?.getAttribute("data-scared") ?? 0) : (p.body?.scaredK ?? 0),
      dizzy: flat ? shown(g?.querySelector(".pawn-shut")) : !!p.body?.shut?.visible,
      // How far off the floor its body is drawn: world units in the flat look, metres in 3D.
      rise: flat ? (p.rise ?? 0) : (p.body?.group?.position.y ?? 0),
      fright: p.fright?.kind ?? null,
      knock: !!p.knock,
      charging: !!p.attack?.charging,
      // How far the body is tipped (degrees) and stretched (wide over tall), as drawn.
      tilt: flat ? Number(/rotate\((-?[\d.]+)/.exec(g?.getAttribute("transform") ?? "")?.[1] ?? 0) : ((p.body?.tilt?.rotation.z ?? 0) * 180) / Math.PI,
      stretch: flat ? (([a, b]) => a / b)((/scale\(([\d.]+), ([\d.]+)\)/.exec(g?.getAttribute("transform") ?? "")?.slice(1) ?? [1, 1]).map(Number)) : (p.body?.tilt ? p.body.tilt.scale.x / p.body.tilt.scale.y : 1),
      // A robot's legs, as drawn: how far out (0: down).
      legs: flat ? (g?.querySelector(".robot-stilts")?.getAttribute("display") === "none" ? 0 : (p.legs ?? 0)) : p.body?.legsG?.visible ? (p.body.legs ?? 0) : 0,
    };
  };
  // This page presses its move key the moment it hears a message like `react.on` ({t, o, to, s}: each given must match), `react.after` ms later, once.
  window.__react = null;
  const press = () => {
    for (const type of ["keydown", "keyup"]) document.body.dispatchEvent(new KeyboardEvent(type, { key: "x", code: "KeyX", bubbles: true }));
  };
  const reactTo = (m) => {
    const r = window.__react;
    if (!r || !Object.entries(r.on).every(([k, v]) => m[k] === v)) return;
    window.__react = null;
    setTimeout(press, r.after);
  };
  window.__paths = {};
  // When this page heard its move key come up (its own clock): a charge let go (its own dash starts then).
  addEventListener("keyup", (e) => e.code === "KeyX" && (window.__keyUpAt = performance.now()), true);
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
  /** Every frame drawn for `ms` from now: [clock, ...drawnOf(seat)] for each seat in `seats`. */
  window.watch = (seats, ms) => {
    const until = performance.now() + ms;
    for (const s of seats) window.__paths[s] = [];
    const sample = (t) => {
      if (t > until) return void window.__afterDraw.delete(sample);
      for (const s of seats) {
        const d = window.drawnOf(s);
        if (d) window.__paths[s].push({ t, ...d });
      }
    };
    window.__afterDraw.add(sample);
  };
}

const browser = await launchBrowser({ args: ["--autoplay-policy=user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sockets = [];
try {
  for (const look of looks) {
    const errors = [];
    const contexts = [];
    const lookQuery = look === "flat" ? "look=flat" : "look=3d&gl=any";
    // In the flat look the big screen asks for less motion, in 3D the phone does.
    const calmOn = look === "flat" ? "screen" : "phone";
    async function open(name, viewport, calm) {
      const context = await browser.newContext({ viewport, hasTouch: name === "Pat", reducedMotion: calm ? "reduce" : "no-preference" });
      await context.addInitScript(pageHelpers);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
      contexts.push(context);
      return page;
    }
    const ready = (page) => (look === "flat" ? page.waitForSelector("svg.scene g[data-seat]", { timeout: 30000 }) : page.waitForFunction(() => window.__room3d?.pieces?.size > 0, null, { timeout: 60000 }));

    section(`${look}: a party: Ada, Bo and Cy (bare sockets), Pat (a phone), and the big screen`);
    const host = await call("POST", "/rooms", { nickname: "Ada" });
    const ada = connect(host);
    sockets.push(ada);
    await ada.opened;
    const bo = connect(await call("POST", "/join/" + host.pin, { nickname: "Bo" }));
    const cy = connect(await call("POST", "/join/" + host.pin, { nickname: "Cy" }));
    sockets.push(bo, cy);
    await Promise.all([bo.opened, cy.opened]);
    // A bare socket follows wherever the room puts its piece, as a page does (its next word carries the new rev).
    for (const c of [ada, bo, cy]) {
      c.ws.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string" || ev.data === "pong") return;
        const m = JSON.parse(ev.data);
        const mine = (s) => s === c.seat;
        if (m.t === "b" && mine(m.s) && Number.isFinite(m.kx) && m.sc === undefined && m.bo === undefined) [c.x, c.rev] = [m.kx, m.kr];
        if (m.t === "b" && mine(m.s) && (m.sc !== undefined || m.bo !== undefined)) [c.x, c.rev] = [m.x, m.rev];
        if ((m.t === "spook" || m.t === "shove") && mine(m.to)) [c.x, c.rev] = [m.x, m.rev];
        if (m.t === "hk" && Number.isFinite(m.x) && ((m.o === "pull" && mine(m.to)) || (m.o !== "pull" && mine(m.s)))) [c.x, c.rev] = [m.x, m.rev];
        if (m.t === "hk" && m.o === "bonk" && mine(m.to)) [c.x, c.rev] = [m.ox, m.orev];
        if (m.t === "hk" && m.tr && mine(m.tr.s)) [c.x, c.rev] = [m.tr.x, m.tr.rev];
      });
    }
    const pat = await open("Pat", { width: 844, height: 390 }, calmOn === "phone");
    await pat.goto(`${base}/lobby/?join=${host.pin}&${lookQuery}`);
    await pat.waitForSelector(".door-title");
    await pat.fill("input[name=nickname]", "Pat");
    await pat.click("text=Join the party");
    await ready(pat);
    const screen = await open("screen", { width: 1280, height: 720 }, calmOn === "screen");
    await screen.goto(`${base}/lobby/?join=${host.pin}&as=screen&${lookQuery}`);
    await screen.waitForSelector(".door-title");
    await screen.click("button[type=submit]");
    await ready(screen);
    await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 15000, 0);
    const seat = (name) => ada.room.members.find((m) => m?.name === name).seat;
    const [A, B, C, P] = ["Ada", "Bo", "Cy", "Pat"].map(seat);
    const roomView = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view;
    const where = async () => (await roomView()).members;
    const wallNow = async () => {
      const v = await roomView();
      return { wall: wallFor(v.room, v.boxes), lit: v.boxes.map((b, i) => (v.vote.lights[b.id] === null ? i : -1)).filter((i) => i >= 0) };
    };
    const pages = [["Pat's phone", pat], ["the screen", screen]];
    const calm = (name) => (name === "the screen") === (calmOn === "screen");
    async function be(c, character) {
      const from = ada.seen.length;
      c.send({ t: "look", c: character });
      await ada.wait((m) => m.room?.members[c.seat]?.character === character, 4000, from).catch(() => null);
    }
    // (Bo is a pawn already: everyone is until they choose.)
    await Promise.all([be(ada, "ghost"), be(cy, "slime")]);
    await sleep(LOOK_COOLDOWN_MS);
    const after = (test, ms = 3000, from = ada.seen.length) => ada.wait(test, ms, from).catch(() => null);
    /** Until the seats are up, safe no more and their moves ready, by the room's word. */
    const rested = async (...seats) => {
      for (let i = 0; i < 80; i++) {
        const at = await where();
        if (seats.every((s) => !(at[s].safe > 0) && !(at[s].cool > 0) && !(at[s].slimeCool > 0) && !(at[s].fadeCool > 0) && !(at[s].hookCool > 0) && !(at[s].stiltCool > 0))) return;
        await sleep(200);
      }
    };
    /** Walks Pat's phone (by its keys) to x as the room has it, then faces `face`. */
    const walkPat = async (x, face, near = 12) => {
      for (let i = 0; i < 16; i++) {
        const gap = x - (await where())[P].x;
        if (Math.abs(gap) < near) break;
        const key = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await pat.keyboard.down(key);
        await sleep(Math.max(25, Math.min(900, ((Math.abs(gap) - near / 3) / walkSpeed("pawn")) * 1000)));
        await pat.keyboard.up(key);
        await sleep(260);
      }
      await pat.keyboard.down(face > 0 ? "ArrowRight" : "ArrowLeft");
      await sleep(75);
      await pat.keyboard.up(face > 0 ? "ArrowRight" : "ArrowLeft");
      await sleep(250);
      return (await where())[P].x;
    };
    const watchAll = (seats, ms) => Promise.all(pages.map(([, page]) => page.evaluate(([s, ms]) => window.watch(s, ms), [seats, ms + 1500])));
    const pathOf = (page, s) => page.evaluate((s) => window.__paths[s] ?? [], s);
    const heardOn = (page, test) => page.evaluate((src) => window.__heard.filter(new Function("m", `return (${src})(m)`)).map((m) => ({ ...m })), test.toString());
    /**
     * What a page drew of seat `s` from `fromMs` to `toMs` after it heard the message `test`
     * picks (its last one): ok when every frame in that stretch passes `shows`, null when none fell
     * in it, false when one did not (or the page never heard it). `story` says which.
     */
    async function drewDuring(page, s, test, fromMs, toMs, shows, describe = (f) => `${Math.round(f.x)}`) {
      const at = (await heardOn(page, test)).at(-1)?.at ?? null;
      if (at === null) return { ok: false, story: "the page never heard it" };
      const path = await pathOf(page, s);
      const frames = path.filter((f) => f.t >= at + fromMs && f.t <= at + toMs);
      const bad = frames.filter((f) => !shows(f, at));
      const span = path.length ? `; ${path.length} frames watched, ${Math.round(path[0].t - at)} to ${Math.round(path.at(-1).t - at)} ms` : "; no frame watched";
      return { ok: frames.length === 0 ? null : bad.length === 0, story: `${frames.length - bad.length} of ${frames.length} frames from ${fromMs} to ${toMs} ms after it heard it show it${bad.length ? ` (not at ${bad.map((f) => `${Math.round(f.t - at)}ms:${describe(f)}`).join(", ")})` : ""}${frames.length ? "" : span}` };
    }
    const still = async (name) => {
      if (!shots) return;
      await pat.screenshot({ path: `${shots}/${look}-phone-${name}.png` });
      await screen.screenshot({ path: `${shots}/${look}-screen-${name}.png` });
    };
    /** Holds Pat's kick until the room says he is charging, then for `ms` more, and lets go. */
    async function chargeKick(ms) {
      const mark = ada.seen.length;
      await pat.keyboard.down("KeyX");
      const kc = await after((m) => m.t === "kc" && m.s === P, 3000, mark);
      if (kc) await sleep(ms);
      await pat.keyboard.up("KeyX");
      const b = await after((m) => m.t === "b" && m.s === P, 3000, mark);
      return { kc, b };
    }
    const start = await wallNow();
    // Ada and Cy out of the way by the door until they are needed.
    ada.goto(120);
    cy.goto(220);

    // ================================================================ the charged kick
    section(`${look}: Pat holds his kick, every page draws him wound up and glowing; let go, he dashes and kicks Bo further than a kick`);
    // In the widest stretch of dark on this room's wall, where a full dash stays in the dark.
    const dark = (() => {
      const ground = landingGround(start.wall, start.lit);
      return ground.reduce((a, g) => (g[1] - g[0] > a[1] - a[0] ? g : a));
    })();
    const x0 = await walkPat(Math.round(dark[0] + 30), 1);
    // Bo beyond a kick's reach (130), within a charge's dash and reach.
    bo.goto(x0 + 200);
    await sleep(400);
    let at = await where();
    await watchAll([P, B], 6000);
    let { kc, b } = await chargeKick(650);
    check(!!kc && kc.x === at[P].x, `the room tells everybody Pat is charging, where he stands (${JSON.stringify(kc && { x: kc.x, f: kc.f })})`);
    const { wall, lit } = await wallNow();
    // As far as the charge carries him, never into a light he does not stand in (shared/moves.js, slideLanding).
    const dash = b?.c === undefined ? null : Math.abs(slideLanding(at[P].x, at[P].x + chargeDash(b.c), wall, lit) - at[P].x);
    const kickedTo = b?.c === undefined ? null : knockLanding(at[B].x, 1, wall, lit, chargeThrow(b.c));
    check(b?.c > 0.3 && b.to === B, `let go: a charged kick (power ${b?.c}) that reaches Bo, out of a kick's reach (${JSON.stringify(b && { to: b.to, c: b.c, kx: b.kx, x: b.x })})`);
    const dashTo = b ? Math.round(at[P].x + Math.min(dash, at[B].x - at[P].x - KICK_CONTACT)) : null;
    check(b && Math.abs(b.kx - dashTo) <= 2, `Pat dashed from ${at[P].x} to ${b?.kx}, as far as his charge carries him or up to Bo (the rule has ${dashTo}: a dash of ${Math.round(dash)}, Bo at ${at[B].x})`);
    check(b && Math.abs(b.x - kickedTo) <= 3 && b.x - at[B].x > 230, `and Bo is thrown from ${at[B].x} to ${b?.x}, further than a kick's 210 (the rule has ${kickedTo})`);
    await sleep(1800);
    for (const [name, page] of pages) {
      // Wound up from a moment after the room's word until the release: the glow on (it grows from a tap's length).
      const heardKc = (await heardOn(page, (m) => m.t === "kc")).at(-1)?.at ?? null;
      const heardB = (await heardOn(page, (m) => m.t === "b" && m.c !== undefined)).at(-1)?.at ?? null;
      const path = await pathOf(page, P);
      const holding = heardKc === null || heardB === null ? [] : path.filter((f) => f.t > heardKc + 220 && f.t < heardB - 20);
      seen(heardKc === null || heardB === null ? false : holding.length === 0 ? null : holding.every((f) => f.charge > 0 && f.charging), `${look}: ${name} draws Pat wound up and glowing while he holds (${calm(name) ? "less motion; " : ""}${holding.length} frames: ${holding.map((f) => `${Math.round(f.t - heardKc)}ms:${f.charge}`).join(", ")})`);
      // The dash: from where he stood to where the room put him, within the kick's wind-up: from
      // the room's word on another page, from the release on Pat's own (it dashes at once).
      const dashFrom = page === pat ? await page.evaluate(() => window.__keyUpAt ?? null) : heardB;
      const dashing = dashFrom === null ? [] : path.filter((f) => f.t > dashFrom + 5 && f.t < dashFrom + 100);
      const between = (f) => f.x > Math.min(at[P].x, b.kx) + 3 && f.x < Math.max(at[P].x, b.kx) - 3;
      // (A tenth of a second: a page starved of frames may draw none in it. Judged on whichever pages did.)
      seen(heardB === null || dashFrom === null || !b ? false : dashing.length === 0 ? null : dashing.some(between), `${look}: Pat is drawn dashing (${name}: from ${at[P].x} to ${b?.kx}: ${dashing.map((f) => `${Math.round(f.t - dashFrom)}ms:${Math.round(f.x)}`).join(", ")})`);
      const landed = await drewDuring(page, P, (m) => m.t === "b" && m.c !== undefined, 160, 700, (f) => Math.abs(f.x - b.kx) <= 6);
      seen(b ? landed.ok : false, `${look}: ${name} then draws him where the room put him, ${b?.kx} (${landed.story})`);
      const thrown = await drewDuring(page, B, (m) => m.t === "b" && m.c !== undefined, IMPACT_MS + 80, STUN_MS - GETUP_MS, (f) => f.knock && f.dizzy);
      seen(b ? thrown.ok : false, `${look}: ${name} draws Bo knocked flying, eyes shut (${thrown.story})`);
    }

    // ================================================================ into a hardened slime
    section(`${look}: Pat's charged kick bounces off Cy's harden: thrown back further and down longer`);
    await rested(P, B, C);
    bo.goto(1500);
    const x1 = await walkPat(420, 1);
    cy.goto(x1 + 110);
    await sleep(400);
    at = await where();
    await watchAll([P, C], 7000);
    {
      const mark = ada.seen.length;
      await pat.keyboard.down("KeyX");
      kc = await after((m) => m.t === "kc" && m.s === P, 3000, mark);
      // A strong charge, so a long bounce (shared/bump.js, chargeBounce): Cy hardens part way
      // through it, and Pat lets go well inside the harden.
      await sleep(350);
      cy.send({ t: "slime", k: "harden" });
      const hard = await after((m) => m.t === "slime" && m.s === C, 2000, mark);
      await sleep(Math.max(0, 750 - (Date.now() - (kc?.at ?? Date.now()))));
      check(!!hard && Date.now() - hard.at < HARDEN_MS - 300, `Cy hardens while Pat charges (${hard ? Date.now() - hard.at : "?"} ms before the release)`);
      await pat.keyboard.up("KeyX");
      b = await after((m) => m.t === "b" && m.s === P, 3000, mark);
      // A picture of him thrown back, or lying where he landed (the frames are judged below, not the picture).
      await still("charge-bounced-off-a-hard-slime");
    }
    const bounce = b?.c === undefined ? null : chargeBounce(b.c);
    const bounced = bounce === null ? null : knockLanding(b.kx, -1, (await wallNow()).wall, (await wallNow()).lit, bounce.reach);
    check(b?.bo === C && b.ke > 0 && Math.abs(b.ke - bounce.down) <= 6,`the kick bounces off: Pat is knocked back himself, and down ${b?.ke} ms longer (${JSON.stringify(b && { bo: b.bo, c: b.c, ke: b.ke, x: b.x, kx: b.kx })})`);
    check(b && Math.abs(b.x - bounced) <= 3 && b.kx - b.x > 230, `thrown back from ${b?.kx} to ${b?.x}, further than a kick's bounce (the rule has ${bounced}); Cy stays at ${at[C].x}`);
    await sleep(STUN_MS + (b?.ke ?? 0) + 300);
    for (const [name, page] of pages) {
      // Still lying down, eyes shut, after a plain knock would have had him up.
      const lying = await drewDuring(page, P, (m) => m.t === "b" && m.bo !== undefined, STUN_MS + 20, STUN_MS + (b?.ke ?? 0) - GETUP_MS - 40, (f) => f.knock && f.dizzy, (f) => `${f.knock ? "knocked" : "up"}${f.dizzy ? " shut" : ""}`);
      seen(b?.ke > 0 ? lying.ok : false, `${look}: ${name} draws Pat still down after a kick's knock would be over (${calm(name) ? "less motion; " : ""}${lying.story})`);
    }

    // ================================================================ into a faded ghost
    section(`${look}: Pat's charged kick goes through Ada's fade: frozen longer than a scare`);
    await rested(P, A);
    cy.goto(1680);
    const x2 = await walkPat(420, 1);
    ada.goto(x2 + 110);
    await sleep(400);
    at = await where();
    await watchAll([P, A], 7000);
    {
      const mark = ada.seen.length;
      await pat.keyboard.down("KeyX");
      kc = await after((m) => m.t === "kc" && m.s === P, 3000, mark);
      ada.send({ t: "fade" });
      await after((m) => m.t === "fade" && m.s === A, 2000, mark);
      await sleep(300);
      await pat.keyboard.up("KeyX");
      b = await after((m) => m.t === "b" && m.s === P, 3000, mark);
    }
    check(b?.sc === A && b.c > 0, `the kick passes through Ada and Pat is scared off (${JSON.stringify(b && { sc: b.sc, c: b.c, x: b.x })})`);
    const downFor = (await where())[P].down;
    check(downFor > BIG_SCARE_MS - (Date.now() - (b?.at ?? 0)) - 50 && downFor > SCARE_MS - (Date.now() - (b?.at ?? 0)), `and the room keeps him down for a big scare's time, longer than a scare's (${downFor} ms left, ${Date.now() - (b?.at ?? 0)} ms after)`);
    // A picture of him frozen with fright (a long freeze: well inside it).
    await still("charge-through-a-faded-ghost");
    await sleep(3200);
    for (const [name, page] of pages) {
      // Frozen, eyes wide, at where his dash ended, when a plain scare would already have him running.
      const from = IMPACT_MS + SCARE_START_MS + SCARE_FREEZE_MS + 60;
      const frozen = await drewDuring(page, P, (m) => m.t === "b" && m.sc !== undefined, from, from + BIG_SCARE_FREEZE_MS - 160, (f) => f.fright === "bigscare" && f.scared >= 0.95 && Math.abs(f.x - b.kx) <= 6, (f) => `${f.fright}:${f.scared}@${Math.round(f.x)}`);
      seen(b ? frozen.ok : false, `${look}: ${name} draws Pat frozen with fright, where he kicked, past a scare's freeze (${calm(name) ? "less motion; " : ""}${frozen.story})`);
    }

    // ================================================================ speeds
    section(`${look}: a pawn, a slime and a ghost walk side by side at their own speeds; the ghost floats on when it stops; the pawn jumps highest`);
    await rested(P, A, B, C);
    await walkPat(150, 1);
    // In a line, the slowest in front, so nobody catches anybody up (a slime would shove what it walks into).
    const lane = { [B]: 300, [A]: 640, [C]: 980 };
    // (Each from where the room has it: the charged kick into Cy's hardened slime sent it sliding,
    // a move client.mjs does not follow.)
    at = await where();
    for (const c of [ada, bo, cy]) [c.x, c.rev] = [Math.round(at[c.seat].x), at[c.seat].rev];
    for (const c of [ada, bo, cy]) c.goto(lane[c.seat]);
    await sleep(500);
    // Long enough that a page drawing few frames has caught up with each piece's walk well before it ends.
    const WALK = 1600;
    await watchAll([A, B, C], WALK + 2600);
    let mark = ada.seen.length;
    const boMark = bo.seen.length;
    for (const c of [ada, bo, cy]) c.send({ t: "m", x: lane[c.seat], d: 1, r: c.rev });
    await sleep(WALK);
    at = await where();
    // Each stops where the room has it now; the ghost stops as a page's floaty ghost does, still going at full speed.
    for (const c of [bo, cy]) c.send({ t: "m", x: at[c.seat].x, d: 0, r: c.rev });
    ada.send({ t: "m", x: at[A].x, d: 0, r: ada.rev, v: 1 });
    // (Heard by another socket: a move is relayed to everyone but its sender.)
    const stopped = await bo.wait((m) => m.t === "m" && m.s === A && m.d === 0, 2000, boMark).catch(() => null);
    await sleep(FLOAT_MS + 400);
    const rest = await where();
    for (const [c, name] of [[bo, "pawn"], [cy, "slime"]]) check(rest[c.seat].x === at[c.seat].x, `the ${name} stops where it is (${at[c.seat].x}, ${rest[c.seat].x})`);
    const drift = rest[A].x - at[A].x;
    check(stopped?.v === 1 && Math.abs(drift - (walkSpeed("ghost") * FLOAT_MS) / 2000) <= 4, `the ghost floats on ${drift} units as it stops (the rule: ${Math.round((walkSpeed("ghost") * FLOAT_MS) / 2000)})`);
    await sleep(1800);
    for (const [name, page] of pages) {
      const heardGo = (await heardOn(page, (m) => m.t === "m" && m.d === 1)).at(-1)?.at ?? null;
      const speedOf = async (s) => {
        const path = (await pathOf(page, s)).filter((f) => heardGo !== null && f.t > heardGo + 700 && f.t < heardGo + WALK - 100);
        if (path.length < 2) return null;
        return ((path.at(-1).x - path[0].x) / (path.at(-1).t - path[0].t)) * 1000;
      };
      const speeds = { pawn: await speedOf(B), slime: await speedOf(C), ghost: await speedOf(A) };
      const right = Object.entries(speeds).every(([c, v]) => v !== null && Math.abs(v / walkSpeed(c) - 1) < 0.08);
      seen(Object.values(speeds).some((v) => v === null) ? null : right, `${look}: ${name} draws each walking at its own speed (${Object.entries(speeds).map(([c, v]) => `${c} ${v === null ? "?" : Math.round(v)} of ${Math.round(walkSpeed(c))}`).join(", ")})`);
      // The ghost drawn floating on past where it stopped, to where the room has it.
      // (From a while after: a page drawing few frames eases toward where the room has a piece.)
      const floating = await drewDuring(page, A, (m) => m.t === "m" && m.d === 0 && m.v !== undefined, FLOAT_MS + 900, FLOAT_MS + 2200, (f) => Math.abs(f.x - rest[A].x) <= 4);
      seen(floating.ok, `${look}: ${name} draws the ghost come to rest at ${rest[A].x}, past where it stopped (${floating.story})`);
    }
    // The jump: Bo (a pawn) and Cy (a slime) jump at once.
    await watchAll([B, C], 1200);
    mark = ada.seen.length;
    for (const c of [bo, cy]) c.send({ t: "m", x: rest[c.seat].x, d: 0, r: c.rev, j: 1 });
    await after((m) => m.t === "m" && m.s === C && m.j, 2000, mark);
    await sleep(1400);
    for (const [name, page] of pages) {
      const rise = async (s) => {
        const path = await pathOf(page, s);
        if (path.length < 3) return null;
        const floor = Math.min(...path.map((f) => f.rise));
        return Math.max(...path.map((f) => f.rise)) - floor;
      };
      const [pawn, slime] = [await rise(B), await rise(C)];
      // A frame near the top of each jump shows it; the pawn's goes higher by about the rule's share.
      const ok = pawn === null || slime === null ? null : pawn > slime * 1.12;
      seen(ok, `${look}: ${name} draws the pawn jumping highest (${Math.round(pawn ?? -1)} against the slime's ${Math.round(slime ?? -1)}; the rule: ${JUMP_HEIGHT} and ${LOW_JUMP_HEIGHT})`);
    }

    // ================================================================ the hook's counters
    /** A bare socket's piece stood at x, facing `face`. */
    const stand = (c, x, face) => {
      c.goto(x);
      c.send({ t: "m", x, d: face, r: c.rev });
      c.send({ t: "m", x, d: 0, r: c.rev });
    };
    /**
     * Bare sockets' pieces put at places, `[c, x, face]` each (face 0: just moved there), and the
     * room waited for until it has every one there: the room takes a long way in steps, so a piece
     * sent far is still on its way for a while (and would be in another's way meanwhile).
     */
    // (A bare socket keeps its piece's rev only from the few messages client.mjs reads: the room's
    // own view says where it has the piece after a counter moved it, and which rev to answer.)
    const placeAll = async (...spots) => {
      const now = await where();
      for (const [c] of spots) if (now[c.seat]?.rev !== undefined) [c.x, c.rev] = [Math.round(now[c.seat].x), now[c.seat].rev];
      for (const [c, x, face] of spots) face ? stand(c, x, face) : c.goto(x);
      for (let i = 0; i < 40; i++) {
        const at = await where();
        if (spots.every(([c, x]) => Math.abs(at[c.seat].x - x) <= 8)) return true;
        await sleep(150);
      }
      const at = await where();
      console.log(`  (not all placed: ${spots.map(([c, x]) => `${c.seat} at ${Math.round(at[c.seat].x)} rev ${at[c.seat].rev}, asked ${x} rev ${c.rev}`).join("; ")})`);
      return false;
    };
    /** Once a bare socket hears a message `test` passes, it sends `msg` `ms` later (a player answering what they see). */
    const answer = (c, test, msg, ms = 40) => {
      const from = c.seen.length;
      return c
        .wait(test, 4000, from)
        .then(() => sleep(ms))
        .then(() => c.send(typeof msg === "function" ? msg() : msg))
        .catch(() => null);
    };
    /** Knocked over, as drawn: the knock under way and the body tipped well over. */
    const tipped = (f) => f.knock && Math.abs(f.tilt) > 25;
    const counterShot = (name) => still(`counter-${name}`);
    /** What the room said since `from` (Ada's socket hears it all), short: for a check that fails to say why. */
    const saidSince = (from) =>
      ada.seen
        .slice(from)
        .filter((m) => m.t !== "m" && m.t !== "pong")
        .map((m) => [m.t, m.s, m.o ?? m.k ?? m.why, m.to].filter((v) => v !== undefined).join(":"))
        .join(" ");
    await be(ada, "robot");
    await sleep(LOOK_COOLDOWN_MS);
    const hx = Math.round(dark[0] + 40);

    section(`${look}: ride the hook: Bo, pulled, kicks before he arrives and knocks Ada (a robot) over`);
    await rested(P, A, B);
    // (Bo is a bare socket: his answer reaches the room in time however slow the pages are. A
    // page's own kick in the air, Pilot.flying, is in test/hook-counters.test.js.)
    await walkPat(150, 1);
    await placeAll([cy, 150, 0], [bo, hx + 220, -1], [ada, hx, 1]);
    await sleep(400);
    await watchAll([A, B], 4000);
    mark = ada.seen.length;
    // Bo kicks 60 ms after he hears the room pull him: before he arrives.
    const rideGo = answer(bo, (m) => m.t === "hk" && m.o === "pull" && m.to === B, { t: "b" }, 60);
    ada.send({ t: "hook" });
    await rideGo;
    const rode = await after((m) => m.t === "b" && m.s === B, 3000, mark);
    await counterShot("ride");
    check(rode?.ride === 1 && rode.to === A, `the room tells everybody Bo rode the hook and kicked Ada over (${JSON.stringify(rode && { to: rode.to, ride: rode.ride, x: rode.x })})`);
    await sleep(1500);
    for (const [name, page] of pages) {
      const down = await drewDuring(page, A, (m) => m.t === "b" && m.ride, IMPACT_MS + 150, STUN_MS - GETUP_MS, tipped, (f) => `${f.knock ? "knocked" : "up"}:${Math.round(f.tilt)}`);
      seen(rode ? down.ok : false, `${look}: ${name} draws Ada knocked over by the flying kick (${calm(name) ? "less motion; " : ""}${down.story})`);
    }

    section(`${look}: cut the line: Pat kicks Ada's chain while she pulls Bo, and Bo is freed where he is`);
    await rested(P, A, B);
    // Bo just in front of Pat, as the room has Pat (his turn to face left moves him a little), so
    // Ada's hook reaches Bo first.
    const px = await walkPat(hx + 250, -1);
    await placeAll([bo, px - 25, -1], [ada, hx, 1]);
    await sleep(400);
    await watchAll([B], 3000);
    mark = ada.seen.length;
    await pat.evaluate((s) => (window.__react = { on: { t: "hk", o: "pull", to: s }, after: 40 }), B);
    ada.send({ t: "hook" });
    const cut = await after((m) => m.t === "b" && m.s === P, 3000, mark);
    await counterShot("cut");
    const pulledTo = ada.seen.slice(mark).find((m) => m.t === "hk" && m.s === A)?.x ?? null;
    check(cut?.cut === B && cut.by === A, `Pat's kick cuts the chain (${JSON.stringify(cut && { cut: cut.cut, by: cut.by, x: cut.x })}; the room said ${saidSince(mark)}; Pat's page pressed: ${await pat.evaluate(() => window.__react === null)})`);
    check(cut && pulledTo !== null && Math.abs(cut.x - (px - 25)) < Math.abs(pulledTo - (px - 25)), `and Bo is set down at ${cut?.x}, short of where the pull was taking him (${pulledTo})`);
    await sleep(1200);
    for (const [name, page] of pages) {
      const freed = await drewDuring(page, B, (m) => m.t === "b" && m.cut !== undefined, MOVED.freed.ms + 60, MOVED.freed.ms + 700, (f) => Math.abs(f.x - cut.x) <= 6);
      seen(cut ? freed.ok : false, `${look}: ${name} draws Bo freed where the room set him down, ${cut?.x} (${calm(name) ? "less motion; " : ""}${freed.story})`);
    }

    section(`${look}: cannonball: Cy (a slime), pulled, hardens in the air and bowls Ada over`);
    await rested(A, C);
    await placeAll([bo, 150, 0]);
    await walkPat(150, 1);
    await placeAll([cy, hx + 220, -1], [ada, hx, 1]);
    await sleep(400);
    await watchAll([A, C], 3000);
    mark = ada.seen.length;
    const cannonGo = answer(cy, (m) => m.t === "hk" && m.o === "pull" && m.to === C, { t: "slime", k: "harden" });
    ada.send({ t: "hook" });
    await cannonGo;
    const cannon = await after((m) => m.t === "slime" && m.s === C, 3000, mark);
    await counterShot("cannonball");
    check(cannon?.ct === "cannon" && cannon.to === A, `the room tells everybody Cy bowled Ada over (${JSON.stringify(cannon && { k: cannon.k, ct: cannon.ct, to: cannon.to, x: cannon.x })})`);
    await sleep(1500);
    for (const [name, page] of pages) {
      const down = await drewDuring(page, A, (m) => m.t === "slime" && m.ct === "cannon", 150, STUN_MS - IMPACT_MS - GETUP_MS, tipped, (f) => `${f.knock ? "knocked" : "up"}:${Math.round(f.tilt)}`);
      seen(cannon ? down.ok : false, `${look}: ${name} draws Ada bowled over (${calm(name) ? "less motion; " : ""}${down.story})`);
    }

    section(`${look}: steal and tug of war: Cy (now a robot) and Ada both hook Bo`);
    await be(cy, "robot");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(A, B, C);
    await placeAll([ada, hx, 1], [bo, hx + 220, -1], [cy, hx + 380, -1]);
    await sleep(400);
    await watchAll([B], 3500);
    mark = ada.seen.length;
    // Cy throws a while after Ada: his tip reaches Bo in the air on Ada's chain.
    ada.send({ t: "hook" });
    await sleep(250);
    cy.send({ t: "hook" });
    const stolen = await after((m) => m.t === "hk" && m.s === C && m.o !== "jumped", 3000, mark);
    await counterShot("steal");
    check(stolen?.o === "pull" && stolen.to === B && stolen.st === A, `Cy's hook takes Bo off Ada's chain: the later hook takes it (${JSON.stringify(stolen && { o: stolen.o, to: stolen.to, st: stolen.st, x: stolen.x })})`);
    await sleep(1600);
    for (const [name, page] of pages) {
      const taken = await drewDuring(page, B, (m) => m.t === "hk" && m.st !== undefined, PULL_MS + 80, PULL_MS + 800, (f) => Math.abs(f.x - stolen.x) <= 6);
      seen(stolen ? taken.ok : false, `${look}: ${name} draws Bo taken over to Cy, at ${stolen?.x} (${calm(name) ? "less motion; " : ""}${taken.story})`);
    }
    await rested(A, B, C);
    // Ada and Cy the same way from Bo, throwing together: their tips reach him at once.
    await placeAll([ada, hx, 1], [bo, hx + 220, -1], [cy, hx + 440, -1]);
    await sleep(400);
    await watchAll([B], 3000);
    mark = ada.seen.length;
    ada.send({ t: "hook" });
    cy.send({ t: "hook" });
    const tug = await after((m) => m.t === "hk" && m.o === "tug", 3000, mark);
    // (Each robot's word on it comes in the same wake-up of the room.)
    await sleep(300);
    await counterShot("tug-of-war");
    const both = ada.seen.slice(mark).filter((m) => m.t === "hk" && m.o === "tug");
    check(tug && both.length === 2 && both.every((m) => m.to === B && m.x === tug.x) && new Set(both.map((m) => m.s)).size === 2, `Ada and Cy hook Bo at once: a tug of war, and Bo stays where he is (${JSON.stringify(both.map((m) => ({ s: m.s, to: m.to, x: m.x })))})`);
    await sleep(1200);
    for (const [name, page] of pages) {
      const held = await drewDuring(page, B, (m) => m.t === "hk" && m.o === "tug", 120, TUG_HOLD_MS - 140, (f) => f.fright === "tug" && f.stretch > 1.15 && Math.abs(f.x - tug.x) <= 6, (f) => `${f.fright}:${f.stretch.toFixed(2)}@${Math.round(f.x)}`);
      seen(tug ? held.ok : false, `${look}: ${name} draws Bo stretched between the two chains where he stood (${calm(name) ? "less motion; " : ""}${held.story})`);
    }

    section(`${look}: plant: Cy goes up on his legs as Ada's hook lands, and Ada is dragged to him`);
    await rested(A, C);
    await placeAll([bo, 150, 0], [ada, hx, 1], [cy, hx + 220, -1]);
    await sleep(400);
    await watchAll([A, C], 3000);
    mark = ada.seen.length;
    const cyFrom = cy.seen.length;
    const legsGo = answer(cy, (m) => m.t === "hook" && m.s === A, { t: "stilts" }, 60);
    ada.send({ t: "hook" });
    await legsGo;
    const plant = await after((m) => m.t === "hk" && m.s === A && m.o !== "jumped", 3000, mark);
    await counterShot("plant");
    check(plant?.o === "plant" && plant.to === C && plant.x > hx + 60, `Cy holds his ground and Ada is dragged to him (${JSON.stringify(plant && { o: plant.o, to: plant.to, x: plant.x })}; the room said ${saidSince(mark)}; to Cy: ${cy.seen.slice(cyFrom).filter((m) => /-no$|^no$|err/.test(m.t)).map((m) => `${m.t}:${m.why}`).join(" ")})`);
    await sleep(1200);
    for (const [name, page] of pages) {
      const dragged = await drewDuring(page, A, (m) => m.t === "hk" && m.o === "plant", PULL_MS + 60, PULL_MS + 600, (f) => Math.abs(f.x - plant.x) <= 6);
      seen(plant ? dragged.ok : false, `${look}: ${name} draws Ada dragged to Cy, at ${plant?.x} (${calm(name) ? "less motion; " : ""}${dragged.story})`);
      // Legs out: world units in the flat look, a share of their reach in 3D.
      const up = await drewDuring(page, C, (m) => m.t === "hk" && m.o === "plant", 60, 500, (f) => (look === "3d" ? f.legs > 0.5 : f.legs > 30));
      seen(plant ? up.ok : false, `${look}: ${name} draws Cy up on his legs as he holds (${up.story})`);
    }

    section(`${look}: the empty hook: Bo (now a ghost), pulled, fades and slips the hook; Ada is spooked`);
    await be(bo, "ghost");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(A, B);
    await placeAll([cy, 1780, 0], [ada, hx, 1], [bo, hx + 220, -1]);
    await sleep(400);
    await watchAll([A, B], 3000);
    mark = ada.seen.length;
    const fadeGo = answer(bo, (m) => m.t === "hk" && m.o === "pull" && m.to === B, { t: "fade" }, 60);
    ada.send({ t: "hook" });
    await fadeGo;
    const empty = await after((m) => m.t === "fade" && m.s === B, 3000, mark);
    await counterShot("empty-hook");
    const emptyPull = ada.seen.slice(mark).find((m) => m.t === "hk" && m.s === A)?.x ?? null;
    check(empty?.ct === "empty" && empty.to === A && Math.abs(empty.gx - (hx + 220)) < Math.abs((emptyPull ?? hx) - (hx + 220)), `Bo slips the hook at ${empty?.gx}, short of ${emptyPull}, and Ada is spooked (${JSON.stringify(empty && { ct: empty.ct, gx: empty.gx, to: empty.to, x: empty.x })})`);
    await sleep(1500);
    for (const [name, page] of pages) {
      const slipped = await drewDuring(page, B, (m) => m.t === "fade" && m.ct === "empty", MOVED.freed.ms + 60, MOVED.freed.ms + 700, (f) => Math.abs(f.x - empty.gx) <= 6);
      seen(empty ? slipped.ok : false, `${look}: ${name} draws Bo where he slipped the hook, ${empty?.gx} (${calm(name) ? "less motion; " : ""}${slipped.story})`);
      const spooked = await drewDuring(page, A, (m) => m.t === "fade" && m.ct === "empty", 40, 160, (f) => f.fright === "spook" && f.scared > 0.3, (f) => `${f.fright}:${f.scared}`);
      seen(empty ? spooked.ok : false, `${look}: ${name} draws Ada spooked, eyes wide (${calm(name) ? "less motion; " : ""}${spooked.story})`);
    }
    // ================================================================ the touch counters
    section(`${look}: ghosts that meet: Ada and Bo, both ghosts, faded, drift into each other and pop solid`);
    await be(ada, "ghost");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(A, B);
    await placeAll([cy, 1780, 0], [ada, hx, 1], [bo, hx + 200, -1]);
    await sleep(400);
    mark = ada.seen.length;
    ada.send({ t: "fade" });
    bo.send({ t: "fade" });
    await after((m) => m.t === "fade" && m.s === B, 3000, mark);
    await watchAll([A, B], 3000);
    // Both drift toward each other, and their phones say nothing more: the room sees them meet.
    ada.send({ t: "m", x: hx, d: 1, r: ada.rev });
    bo.send({ t: "m", x: hx + 200, d: -1, r: bo.rev });
    const pop = await after((m) => m.t === "pop", 3000, mark);
    for (const c of [ada, bo]) c.send({ t: "m", x: c.x, d: 0, r: c.rev });
    await counterShot("ghosts-meet");
    check(pop && [pop.s, pop.to].sort().join() === [A, B].sort().join(), `the room sees them meet and both pop solid (${JSON.stringify(pop && { s: pop.s, to: pop.to, x: pop.x, ox: pop.ox })})`);
    const solid = await where();
    check(!(solid[A].faded > 0) && !(solid[B].faded > 0), "and neither is faded any more: each has its vote back");
    await sleep(1000);
    for (const [name, page] of pages) {
      for (const [s, who] of [[A, "Ada"], [B, "Bo"]]) {
        const popped = await drewDuring(page, s, (m) => m.t === "pop", 30, 200, (f) => f.fright === "pop" && f.scared > 0.2, (f) => `${f.fright}:${f.scared}`);
        seen(pop ? popped.ok : false, `${look}: ${name} draws ${who} popped solid with a start (${calm(name) ? "less motion; " : ""}${popped.story})`);
      }
    }

    section(`${look}: boo the stilts: Bo (a ghost, faded) drifts through Ada (a robot) up on her legs, and she topples`);
    await be(ada, "robot");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(A, B);
    await placeAll([ada, hx + 200, -1], [bo, hx, 1]);
    await sleep(400);
    await watchAll([A], 3000);
    mark = ada.seen.length;
    bo.send({ t: "fade" });
    await after((m) => m.t === "fade" && m.s === B, 3000, mark);
    ada.send({ t: "stilts" });
    await after((m) => m.t === "stilts" && m.s === A, 3000, mark);
    // Bo drifts on through her; his phone says so as it reaches her (a boo: main.js, drift), and
    // the room judges it.
    bo.send({ t: "m", x: hx, d: 1, r: bo.rev });
    for (let i = 0; i < 40; i++) {
      const at = await where();
      if (Math.abs(at[B].x - at[A].x) <= SPOOK_REACH - 6) break;
      await sleep(30);
    }
    bo.send({ t: "boo", to: A });
    const topple = await after((m) => m.t === "spook" && m.to === A, 3000, mark);
    bo.send({ t: "m", x: bo.x, d: 0, r: bo.rev });
    await counterShot("boo-the-stilts");
    check(topple?.tp === 1, `Ada, up on her legs, topples (${JSON.stringify(topple && { to: topple.to, tp: topple.tp, x: topple.x })})`);
    await sleep(1000);
    for (const [name, page] of pages) {
      const down = await drewDuring(page, A, (m) => m.t === "spook" && m.tp, 150, STUN_MS - IMPACT_MS - GETUP_MS, tipped, (f) => `${f.knock ? "knocked" : "up"}:${Math.round(f.tilt)} legs ${Math.round(f.legs)}`);
      seen(topple ? down.ok : false, `${look}: ${name} draws Ada toppled off her legs (${calm(name) ? "less motion; " : ""}${down.story})`);
    }

    section(`${look}: dominoes: Pat kicks Bo into Ada, and she goes over too`);
    await be(bo, "pawn");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(P, A, B);
    const kx = await walkPat(hx, 1);
    await placeAll([bo, kx + 90, -1], [ada, kx + 200, -1]);
    await sleep(400);
    await watchAll([A, B], 3000);
    mark = ada.seen.length;
    await pat.keyboard.press("KeyX");
    const domino = await after((m) => m.t === "b" && m.s === P, 3000, mark);
    await counterShot("dominoes");
    check(domino?.to === B && domino.dm?.to === A && domino.dm.at > IMPACT_MS, `Pat's kick throws Bo into Ada, who goes over as he reaches her (${JSON.stringify(domino && { to: domino.to, dm: domino.dm })})`);
    await sleep(1300);
    for (const [name, page] of pages) {
      // Standing until Bo reaches her, then over.
      const before = await drewDuring(page, A, (m) => m.t === "b" && m.dm, 0, (domino?.dm?.at ?? 0) - 30, (f) => !tipped(f), (f) => `${Math.round(f.tilt)}`);
      const after_ = await drewDuring(page, A, (m) => m.t === "b" && m.dm, (domino?.dm?.at ?? 0) + 150, (domino?.dm?.at ?? 0) + STUN_MS - IMPACT_MS - GETUP_MS, tipped, (f) => `${f.knock ? "knocked" : "up"}:${Math.round(f.tilt)}`);
      seen(domino?.dm ? (before.ok === false ? false : after_.ok) : false, `${look}: ${name} draws Ada standing until Bo reaches her, then knocked over (${calm(name) ? "less motion; " : ""}before: ${before.story}; after: ${after_.story})`);
    }

    section(`${look}: the curling stone: Pat's charged kick sends Cy (a hardened slime) sliding into Bo, who votes in a light`);
    await be(cy, "slime");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(P, A, B, C);
    // Bo in the middle of a lit pool with dark before it for Pat and Cy (and the stone's way past it).
    const lightNow = (x) => start.wall.pools.some((p) => start.lit.includes(p.i) && Math.abs(x - p.x) <= p.half);
    const pool = start.wall.pools.filter((p) => start.lit.includes(p.i)).find((p) => !lightNow(p.x - p.half - 240) && !lightNow(p.x - p.half - 150) && p.x - p.half - 240 > 130);
    await placeAll([ada, 1780, 0], [bo, Math.round(pool.x), -1]);
    const sx0 = await walkPat(Math.round(pool.x - pool.half - 240), 1);
    await placeAll([cy, sx0 + 90, -1]);
    await sleep(500);
    await watchAll([B, C], 4000);
    {
      mark = ada.seen.length;
      await pat.keyboard.down("KeyX");
      const kc2 = await after((m) => m.t === "kc" && m.s === P, 3000, mark);
      await sleep(300);
      cy.send({ t: "slime", k: "harden" });
      await after((m) => m.t === "slime" && m.s === C, 2000, mark);
      await sleep(Math.max(0, 700 - (Date.now() - (kc2?.at ?? Date.now()))));
      await pat.keyboard.up("KeyX");
    }
    const curl = await after((m) => m.t === "b" && m.s === P, 3000, mark);
    await counterShot("curling-stone");
    check(curl?.cu?.s === C && curl.cv?.to === B, `the stone slides and knocks Bo over (${JSON.stringify(curl && { bo: curl.bo, c: curl.c, cu: curl.cu, cv: curl.cv })})`);
    check(curl && !lightNow(curl.cv.x) && !lightNow(curl.cu.x) && curl.cu.x > pool.x, `Bo is knocked out of the light, and the stone slides on past it into the dark (${curl?.cv?.x}, ${curl?.cu?.x}; the light ${Math.round(pool.x - pool.half)} to ${Math.round(pool.x + pool.half)})`);
    await sleep(1600);
    for (const [name, page] of pages) {
      const sliding = await drewDuring(page, C, (m) => m.t === "b" && m.cu, IMPACT_MS + 60, IMPACT_MS + CURL_MS - 60, (f) => f.fright === "curl", (f) => `${f.fright}@${Math.round(f.x)}`);
      seen(curl ? sliding.ok : false, `${look}: ${name} draws Cy sliding as a stone (${calm(name) ? "less motion; " : ""}${sliding.story})`);
      const rested_ = await drewDuring(page, C, (m) => m.t === "b" && m.cu, IMPACT_MS + CURL_MS + 80, IMPACT_MS + CURL_MS + 900, (f) => Math.abs(f.x - curl.cu.x) <= 6);
      seen(curl ? rested_.ok : false, `${look}: ${name} draws the stone come to rest where the room put it, ${curl?.cu?.x} (${rested_.story})`);
      const knocked_ = await drewDuring(page, B, (m) => m.t === "b" && m.cv, (curl?.cv?.at ?? 0) + 150, (curl?.cv?.at ?? 0) + STUN_MS - IMPACT_MS - GETUP_MS, tipped, (f) => `${f.knock ? "knocked" : "up"}:${Math.round(f.tilt)}`);
      seen(curl ? knocked_.ok : false, `${look}: ${name} draws Bo knocked over as the stone reaches him (${calm(name) ? "less motion; " : ""}${knocked_.story})`);
    }

    section(`${look}: the slimes: Bo (now a slime, hard) walks into Cy (soft) and is swallowed; both soft, they stick`);
    await be(bo, "slime");
    await sleep(LOOK_COOLDOWN_MS);
    await rested(B, C);
    await walkPat(150, 1);
    for (const kind of ["swallow", "stick"]) {
      await rested(B, C);
      await placeAll([cy, hx + 60, 1], [bo, hx + 220, -1]);
      await sleep(400);
      await watchAll([B, C], 3000);
      mark = ada.seen.length;
      // Cy goes soft (a press held: the harden turned); Bo hardens, or goes soft too.
      cy.send({ t: "slime", k: "harden" });
      bo.send({ t: "slime", k: "harden" });
      await sleep(300);
      cy.send({ t: "slime", k: "absorb" });
      if (kind === "stick") bo.send({ t: "slime", k: "absorb" });
      await after((m) => m.t === "slime" && m.s === C && m.k === "absorb", 2000, mark);
      // Bo walks into Cy, and his phone says nothing more: the room sees them meet.
      bo.send({ t: "m", x: bo.x, d: -1, r: bo.rev });
      const goo = await after((m) => m.t === "goo", 3000, mark);
      bo.send({ t: "m", x: bo.x, d: 0, r: bo.rev });
      await counterShot(kind === "swallow" ? "slime-swallows-slime" : "slimes-stick");
      check(goo?.k === kind, `${kind === "swallow" ? "Cy swallows Bo and spits him out the far side" : "Bo and Cy stick together, then come apart"} (${JSON.stringify(goo && { k: goo.k, s: goo.s, to: goo.to, x: goo.x, ox: goo.ox })})`);
      if (kind === "swallow") check(goo && goo.x < hx + 60, `Bo comes out on Cy's far side, at ${goo?.x} (Cy at ${hx + 60})`);
      await sleep(1200);
      const kindDrawn = kind === "swallow" ? "swallowed" : "stick";
      for (const [name, page] of pages) {
        const drawnIt = await drewDuring(page, B, (m) => m.t === "goo", 60, MOVED[kindDrawn].ms - 80, (f) => f.fright === kindDrawn, (f) => `${f.fright}`);
        seen(goo ? drawnIt.ok : false, `${look}: ${name} draws Bo ${kind === "swallow" ? "swallowed and spat out" : "stuck to Cy"} (${calm(name) ? "less motion; " : ""}${drawnIt.story})`);
        const landed = await drewDuring(page, B, (m) => m.t === "goo", MOVED[kindDrawn].ms + 80, MOVED[kindDrawn].ms + 700, (f) => Math.abs(f.x - goo.x) <= 6);
        seen(goo ? landed.ok : false, `${look}: ${name} then draws Bo where the room put him, ${goo?.x} (${landed.story})`);
      }
    }

    // Back as they were, for the stills.
    await be(bo, "pawn");
    await sleep(LOOK_COOLDOWN_MS);

    if (shots) {
      // Stills for the owner, taken apart from the checks (a picture takes a while on a busy machine).
      section(`${look}: stills`);
      await rested(P, B);
      const sx = await walkPat(Math.round(dark[0] + 30), 1);
      bo.goto(sx + 200);
      await sleep(500);
      const mark = ada.seen.length;
      await pat.keyboard.down("KeyX");
      if (await after((m) => m.t === "kc" && m.s === P, 3000, mark)) await sleep(700);
      await still("charge-held");
      await pat.keyboard.up("KeyX");
      await after((m) => m.t === "b" && m.s === P, 3000, mark);
      await still("charge-let-go");
    }

    section(`${look}: the pages`);
    check(errors.length === 0, `no page reported an error${errors.length ? ":\n       " + [...new Set(errors)].slice(0, 8).join("\n       ") : ""}`);
    for (const c of [ada, bo, cy]) c.ws.close();
    for (const context of contexts) await context.close();
  }
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  for (const c of sockets) c.ws.close();
  await browser.close();
}
console.log(`\n${drawn.unseen.length} of ${drawn.all} drawn checks went unseen (a page drew no frame inside them)${drawn.unseen.length ? ":\n  " + drawn.unseen.join("\n  ") : ""}`);
if (drawn.unseen.length > UNSEEN_SHARE * drawn.all) problems.push(`too many drawn checks went unseen: ${drawn.unseen.length} of ${drawn.all}`);
for (const [id, { seen: n, unseen }] of drawn.byCheck) if (n === 0 && unseen > 0) problems.push(`never seen in the ${unseen} time(s) it ran: ${id}`);
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
