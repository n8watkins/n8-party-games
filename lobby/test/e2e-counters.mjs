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
import { mkdirSync } from "node:fs";
import { GETUP_MS, IMPACT_MS, KICK_CONTACT, STUN_MS, chargeBounce, chargeDash, chargeThrow, knockLanding, landingGround } from "../shared/bump.js";
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { BIG_SCARE_FREEZE_MS, BIG_SCARE_MS, SCARE_FREEZE_MS, SCARE_MS, SCARE_START_MS } from "../shared/ghost.js";
import { HARDEN_MS } from "../shared/slime.js";
import { slideLanding } from "../shared/moves.js";
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
        for (const m of Array.isArray(msg) ? msg : [msg]) if (m?.t && m.t !== "pong") window.__heard.push({ ...m, at: performance.now() });
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
    };
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
        if (seats.every((s) => !(at[s].safe > 0) && !(at[s].cool > 0) && !(at[s].slimeCool > 0) && !(at[s].fadeCool > 0))) return;
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
      // A strong charge, so a long bounce (shared/bump.js, chargeBounce): Cy hardens late in it
      // and Pat lets go just after. The release is timed from the harden, not from the start of
      // the charge: a busy machine that stalls during the charge then cannot use up the harden.
      await sleep(Math.max(0, 620 - (Date.now() - (kc?.at ?? Date.now()))));
      cy.send({ t: "slime", k: "harden" });
      const hard = await after((m) => m.t === "slime" && m.s === C, 2000, mark);
      await sleep(120);
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
      // Each against the others (the rule's shares), and each roughly at its own speed: a page short
      // of frames draws all three a little fast or slow alike as it catches up with the room.
      const right =
        Object.values(speeds).every((v) => v !== null) &&
        Object.entries(speeds).every(([c, v]) => Math.abs(v / walkSpeed(c) - 1) < 0.2 && Math.abs(v / speeds.slime / (walkSpeed(c) / walkSpeed("slime")) - 1) < 0.06);
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
