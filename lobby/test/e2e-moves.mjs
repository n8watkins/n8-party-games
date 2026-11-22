// The robot's and the slime's moves, end to end: real pages and real sockets in one room, against
// a running local server, in the flat look and in 3D. The browser is headless and MUTED, and is
// closed at the end whatever happens. With TEST_GPU=1 it draws on the graphics card
// (lobby/test/browser.mjs).
//
//   node lobby/test/e2e-moves.mjs [--base=http://localhost:8791] [--looks=flat,3d]
//
// Three phones (Rob a robot, Sam a slime, Pat a pawn) and a bare socket (Ada, a second robot), in
// each look. What it goes through, by the keys a player presses and as every phone draws it:
//   the buttons     Rob's move button says Hook and his jump button Legs; Sam's says Harden
//   hook            Rob throws his hook at Pat: Pat is dragged across the floor to him, upright,
//                   and every phone draws the chain and the pull
//   jumped          Pat jumps as the hook arrives: it passes under him
//   kicked away     Pat kicks toward Rob as the hook arrives: it is batted away
//   hook train      Rob drags Pat in and Ada hooks Rob mid-pull: all three end in a line
//   bonk            Rob and Ada hook each other: both are yanked together and bonk heads
//   stilt legs      Rob's legs go up and Pat's kick swings under him; every phone draws the legs
//   harden          Sam taps Harden and Pat's kick bounces off; every phone draws the gem
//   absorb          Sam holds Harden (goes soft) and Rob's hook sticks: Rob is dragged to Sam
//   shove           Sam walks into Pat and shoves him along
//   a reload        a phone reloaded while Rob's legs are up, and Sam's own phone reloaded while
//                   it is soft, draw them so
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { HOOK_AIM_MS, HOOK_COOLDOWN_MS, PULL_MS, STILT_COOLDOWN_MS, STILT_DROP_MS, STILT_MS, STILT_SQUAT_MS, pullEase } from "../shared/robot.js";
import { ABSORB_MS, HARDEN_MS, HOLD_MS, MELT_MS, SLIME_COOLDOWN_MS, SNAP_MS } from "../shared/slime.js";
import { MOVED, slideLanding } from "../shared/moves.js";
import { wallFor } from "../shared/rooms.js";
import { clampX } from "../shared/world.js";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const looks = opt("looks", "flat,3d").split(",").filter(Boolean);
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
/**
 * A check of what a phone drew, judged on the frames it drew: `ok` true or false when a frame fell
 * where it could show the thing, null when none did (a page starved of frames on a busy machine).
 * An unseen check does not fail, but the run counts them, and fails if more than UNSEEN_SHARE of
 * its drawn checks went unseen: a run that saw nothing cannot pass as clean. What the room did is
 * checked from its messages in every run, frames or not.
 */
const UNSEEN_SHARE = 0.25;
const drawnChecks = { all: 0, unseen: [], byCheck: new Map() };
/** Which check this is, the same in each look and attempt: its words before the details, numbers left out. */
const checkId = (what) => what.split(" (")[0].replace(/^(flat|3d|3D): /, "").replace(/-?\d+(\.\d+)?/g, "#");
const seen = (ok, what) => {
  drawnChecks.all++;
  const id = checkId(what);
  const tally = drawnChecks.byCheck.get(id) ?? { seen: 0, unseen: 0 };
  drawnChecks.byCheck.set(id, tally);
  if (ok === null) {
    tally.unseen++;
    drawnChecks.unseen.push(what);
    console.log("seen? " + what + " (not seen: no frame fell inside it)");
    return;
  }
  tally.seen++;
  check(ok, what);
};
/**
 * Problems with what went unseen: more than UNSEEN_SHARE of the run's drawn checks, or any one
 * check unseen every time it ran, once it ran at least NEVER_SEEN_AFTER times (once in each look).
 * A single starved attempt is allowed on purpose: one look's page drawing no frame inside a
 * move that lasts a few hundred milliseconds, on a machine running the gate's other steps beside
 * it, says nothing about the drawing; the same check starved in both looks does.
 */
const NEVER_SEEN_AFTER = 2;
const unseenProblems = () => {
  const out = [];
  if (drawnChecks.unseen.length > UNSEEN_SHARE * drawnChecks.all) out.push(`too many drawn checks went unseen: ${drawnChecks.unseen.length} of ${drawnChecks.all} (at most ${Math.floor(UNSEEN_SHARE * drawnChecks.all)})`);
  for (const [id, { seen: n, unseen }] of drawnChecks.byCheck) if (n === 0 && unseen >= NEVER_SEEN_AFTER) out.push(`never seen in the ${unseen} times it ran: ${id}`);
  return out;
};
const section = (name) => console.log("\n     -- " + name);

/** Read in each page: what a seat's piece is doing with its moves, in either look, and the most of it seen over a while. */
function pageHelpers() {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    // When this page heard the room's word on each hook (its own clock): {t, s, to, at}.
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
          if (m && ["hook", "hk", "stilts", "slime", "shove", "hook-no", "stilts-no", "slime-no"].includes(m.t)) window.__heard.push({ t: m.t, s: m.s, to: m.to, o: m.o, k: m.k, why: m.why, wait: m.wait, at: performance.now() });
          // Told to (__jumpOnHookOf: a robot's seat), this page jumps the moment it hears that robot
          // throw, as a player who sees it coming does: the jump is timed by the page, not the test.
          if (m?.t === "hook" && m.s === window.__jumpOnHookOf) {
            window.__jumpOnHookOf = null;
            window.__jumpedAt = performance.now();
            for (const type of ["keydown", "keyup"]) document.body.dispatchEvent(new KeyboardEvent(type, { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
          }
          // Likewise (__kickOnHook: {of, after}), this page kicks `after` ms after it hears that robot throw.
          if (m?.t === "hook" && m.s === window.__kickOnHook?.of) {
            const { after } = window.__kickOnHook;
            window.__kickOnHook = null;
            setTimeout(() => {
              for (const type of ["keydown", "keyup"]) document.body.dispatchEvent(new KeyboardEvent(type, { key: "x", code: "KeyX", bubbles: true }));
            }, after);
          }
          // Every whole room this page heard (its own clock), and each seat's move state in it: its
          // harden cooldown, how long its legs have been up and how long it stays soft
          // (shared/robot.js, slime.js). A page that is loading takes in the last one before it
          // draws (main.js, roomHeardAt): the readers judge it by that one (roomAt).
          const members = m?.room?.members ?? m?.members;
          if (Array.isArray(members)) {
            const room = { at: performance.now(), slimeCool: members.map((x) => x?.slimeCool ?? 0), stilts: members.map((x) => x?.stilts ?? null), soft: members.map((x) => x?.soft ?? null) };
            window.__firstRoom ??= room;
            (window.__rooms ??= []).push(room);
          }
        }
      });
    }
    window.__ws = this;
    // What this page sent, and when (its own clock): {k, at} for a slime's moves.
    if (typeof data === "string" && data.includes('"t":"slime"')) (window.__sent ??= []).push({ k: /"k":"(\w+)"/.exec(data)?.[1], at: performance.now() });
    // A message the test holds back on its way to the room (a slow network): {test, ms}.
    const late = window.__late;
    if (late && typeof data === "string" && late.test.test(data)) return void setTimeout(() => send.call(this, data), late.ms);
    return send.call(this, data);
  };
  // Frames held back (a page that stalls drawing) until performance.now() reaches window.__stallUntil.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    const wait = (window.__stallUntil ?? 0) - performance.now();
    return wait > 0 ? setTimeout(() => raf(cb), wait) : raf(cb);
  };
  window.__send = (m) => window.__ws.send(JSON.stringify(m));
  const view = () => globalThis.__partyRoom?.view;
  // `now`: the moment it is read for (a frame's own clock when read right after it was drawn: a
  // 3D frame on a busy machine can take a few hundred milliseconds to draw, and the goo's state
  // must be the one that frame drew, not the one it has once the drawing is done).
  window.movesOn = (seat, now = performance.now()) => {
    const v = view();
    const p = v?.pieces?.get(seat);
    if (!p) return null;
    const flat = !window.__room3d;
    const g = flat ? document.querySelector(`svg.scene g[data-seat="${seat}"]`) : null;
    const chainEl = flat ? document.querySelector(`.robot-hook[data-seat="${seat}"]`) : null;
    // The chain itself as drawn: in the flat look its dashed steel path (not the dark outline under
    // it) with a line to draw, shown; in 3D its links, shown, in a hook shown.
    const visible = (el) => !!el && el.getAttribute("display") !== "none" && el.getAttribute("visibility") !== "hidden" && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
    const steel = chainEl?.querySelector("path[stroke-dasharray]");
    const hook3d = v.hooks?.hooks.get(seat);
    const chain = flat ? visible(chainEl) && visible(steel) && !!steel.getAttribute("d") : !!hook3d && hook3d.group.visible !== false && hook3d.chain.visible !== false && hook3d.chain.count > 0;
    const legs = flat ? (g?.querySelector(".robot-stilts")?.getAttribute("display") === "none" ? 0 : p.legs ?? 0) : p.body.legsG?.visible ? p.body.legs : 0;
    const gem = flat ? !!g?.querySelector(".slime-gem") && g.querySelector(".slime-gem").getAttribute("display") !== "none" : !!p.body.gem?.visible;
    // Soft as drawn now: from its turn until its soft time and melt are over (move-state.js gooNow
    // clears p.goo only when a frame draws it, so a goo whose time is up can still be there).
    const soft = !!p.goo && p.goo.turnAt !== null && now - p.goo.at - p.goo.turnAt < p.goo.softFor + window.__MELT_MS;
    // frightAt: when the page began drawing the piece's fright (its own clock), and from where.
    // goo, stilt: what the page holds of a slime's harden or absorb and a robot's legs (move-state.js), for a failure's message.
    return { x: p.rx, hook: p.hook ? (p.hook.verdict?.o ?? "out") : null, chain, legs, gem, soft, fright: p.fright?.kind ?? null, frightAt: p.fright?.at ?? null, frightFrom: p.fright?.from ?? null, knock: !!p.knock, character: p.kind?.id, goo: p.goo ? { at: Math.round(p.goo.at), turnAt: p.goo.turnAt, softFor: p.goo.softFor, hardFor: p.goo.hardFor } : null, stilt: p.stilt ? { at: Math.round(p.stilt.at) } : null };
  };
  window.__moves = {};
  // When this page heard the move key go down (its own clock).
  // With __stallOnKey set, the page draws nothing for that long from the press (once).
  addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "KeyX" || e.repeat) return;
      window.__keyAt = performance.now();
      if (window.__stallOnKey) [window.__stallUntil, window.__stallOnKey] = [window.__keyAt + window.__stallOnKey, 0];
    },
    true,
  );
  // Calls each of window.__afterDraw (now) right after the page's view has drawn a frame, inside
  // the same call: what is read then is exactly what that frame drew, on the frame's own clock (a
  // read in a later task could see a message the page took in after the frame, with the frame's
  // pose from before it).
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
  window.watchMoves = (seat, ms) => {
    // path: every frame drawn, [its clock, x, legs, soft, chain, gem, fright, knocked, the move button's class].
    const most = (window.__moves[seat] = { legs: 0, chain: false, gem: false, soft: false, frights: [], knocked: false, hooks: [], minX: Infinity, maxX: -Infinity, frames: 0, from: performance.now(), path: [] });
    const until = performance.now() + ms;
    const sample = (frameAt) => {
      if (frameAt > until) return void window.__afterDraw.delete(sample);
      const m = window.movesOn(seat, frameAt);
      if (m) {
        most.frames++;
        most.legs = Math.max(most.legs, m.legs);
        most.chain ||= m.chain;
        most.gem ||= m.gem;
        most.soft ||= m.soft;
        most.knocked ||= m.knock;
        if (m.fright && !most.frights.includes(m.fright)) most.frights.push(m.fright);
        if (m.hook && !most.hooks.includes(m.hook)) most.hooks.push(m.hook);
        most.minX = Math.min(most.minX, m.x);
        most.maxX = Math.max(most.maxX, m.x);
        most.path.push([frameAt, m.x, m.legs, m.soft, m.chain, m.gem, m.fright, m.knock, document.querySelector(".ctl-bump")?.className ?? null, m.frightAt, m.frightFrom, m.goo, m.stilt]);
      }
      // The first frame this page's own move button showed ready.
      if (window.__readyAt == null && document.querySelector(".ctl-bump")?.classList.contains("ready")) window.__readyAt = frameAt;
    };
    window.__afterDraw.add(sample);
  };
  // A page about to be reloaded can be told to watch a seat from the first frame it draws after
  // (sessionStorage outlives the reload): window.__moves[seat] then holds every frame from the first.
  const onLoad = JSON.parse(sessionStorage.getItem("watchOnLoad") ?? "null");
  if (onLoad) {
    sessionStorage.removeItem("watchOnLoad");
    const wait = () => (window.movesOn(onLoad.seat) ? window.watchMoves(onLoad.seat, onLoad.ms) : requestAnimationFrame(wait));
    requestAnimationFrame(wait);
  }
}

const browser = await launchBrowser({ args: ["--autoplay-policy=user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sockets = [];
try {
  for (const look of looks) {
    const errors = [];
    const pages = [];
    async function open(name) {
      const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
      await context.addInitScript({ content: `window.__MELT_MS = ${MELT_MS};` });
      await context.addInitScript(pageHelpers);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
      pages.push(context);
      return page;
    }
    const lookQuery = look === "flat" ? "look=flat" : "look=3d&gl=any";
    const drawn = (page) => (look === "flat" ? page.waitForSelector("svg.scene g[data-seat]", { timeout: 20000 }) : page.waitForFunction(() => window.__room3d?.pieces?.size > 0, null, { timeout: 40000 }));
    async function join(name, pin) {
      const page = await open(name);
      await page.goto(`${base}/lobby/?join=${pin}&${lookQuery}`);
      await page.waitForSelector(".door-title");
      await page.fill("input[name=nickname]", name);
      await page.click("text=Join the party");
      await drawn(page);
      return page;
    }

    section(`${look}: a party of four: Ada (a bare socket), Rob, Sam and Pat (phones)`);
    const host = await call("POST", "/rooms", { nickname: "Ada" });
    const ada = connect(host);
    sockets.push(ada);
    ada.ws.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      const m = JSON.parse(ev.data);
      // The room moves Ada's piece itself by a hook (shared/robot.js): she follows.
      if (m.t === "hk" && m.s === ada.seat && Number.isFinite(m.x)) [ada.x, ada.rev] = [m.x, m.rev];
      if (m.t === "hk" && m.to === ada.seat && Number.isFinite(m.x) && m.o === "pull") [ada.x, ada.rev] = [m.x, m.rev];
      if (m.t === "hk" && m.o === "bonk" && m.to === ada.seat) [ada.x, ada.rev] = [m.ox, m.orev];
    });
    await ada.opened;
    const rob = await join("Rob", host.pin);
    const sam = await join("Sam", host.pin);
    const pat = await join("Pat", host.pin);
    await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 10000, 0);
    const seat = (name) => ada.room.members.find((m) => m?.name === name).seat;
    const [A, R, S, P] = ["Ada", "Rob", "Sam", "Pat"].map(seat);
    const roomView = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view;
    const where = async () => (await roomView()).members;
    /** Where the room drags a piece from `from` toward `to` to rest (shared/moves.js: never in another's light). */
    const landing = async (from, to) => {
      const v = await roomView();
      const lit = v.boxes.map((b, i) => (v.vote.lights[b.id] === null ? i : -1)).filter((i) => i >= 0);
      return slideLanding(from, clampX(to), wallFor(v.room, v.boxes), lit);
    };
    // Each phone becomes its character (the picker itself is test:characters' business).
    async function become(page, s, c) {
      const from = ada.seen.length;
      await page.evaluate((c) => window.__send({ t: "look", c }), c);
      const ok = await ada.wait((m) => m.room?.members[s]?.character === c, 4000, from).catch(() => null);
      await sleep(LOOK_COOLDOWN_MS);
      return !!ok;
    }
    check(await become(rob, R, "robot"), "Rob picks the robot");
    check(await become(sam, S, "slime"), "Sam picks the slime");
    ada.send({ t: "look", c: "robot" });
    await ada.wait((m) => m.room?.members[A]?.character === "robot", 4000, 0);
    await sleep(LOOK_COOLDOWN_MS);
    check((await rob.locator(".ctl-bump .ctl-word").textContent()) === "Hook" && (await rob.locator(".ctl-jump .ctl-word").textContent()) === "Legs", "Rob's move button says Hook, and his jump button Legs");
    check((await sam.locator(".ctl-bump .ctl-word").textContent()) === "Harden", "Sam's move button says Harden");
    check((await pat.locator(".ctl-bump .ctl-word").textContent()) === "Bump", "Pat's (a pawn) still says Bump");

    /** Walks a phone's piece (by its keys) to x, as the room has it, then faces `face`. */
    const walkTo = async (page, s, x, face = 0, near = 14) => {
      for (let i = 0; i < 16; i++) {
        const gap = x - (await where())[s].x;
        if (Math.abs(gap) < near) break;
        const key = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await sleep(Math.max(25, Math.min(900, ((Math.abs(gap) - near / 3) / 430) * 1000)));
        await page.keyboard.up(key);
        await sleep(260);
      }
      if (face) {
        // A tap the other way first would walk it off: a tap toward `face` turns it there, a step at most.
        // Held past the page's send gap (60 ms), so the turn reaches the room.
        await page.keyboard.down(face > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(75);
        await page.keyboard.up(face > 0 ? "ArrowRight" : "ArrowLeft");
        await sleep(250);
      }
    };
    const after = (test, ms = 3000, from = ada.seen.length) => ada.wait(test, ms, from).catch(() => null);
    /**
     * Waits until a seat's move is ready again and it is up and safe no more, by the room's word,
     * and its own phone's move button says ready too. A reloaded phone takes the room's cooldown
     * from the first message it gets, so it can come ready a moment after the room does: a press in
     * that moment is dropped on the phone and the room never hears it.
     */
    const pageOf = { [R]: rob, [S]: sam, [P]: pat };
    /**
     * Waits until the room has the seats standing still: not walking, and at the same place over
     * two looks 200 ms apart. On a busy machine a walk's key-up can reach a page late, so a piece
     * walkTo left close to its mark can still be drifting a few units when the next move begins.
     */
    const settled = async (...seats) => {
      let last = await where();
      for (let i = 0; i < 40; i++) {
        await sleep(200);
        const now = await where();
        if (seats.every((s) => now[s].d === 0 && now[s].x === last[s].x)) return now;
        last = now;
      }
      return last;
    };
    const rested = async (...seats) => {
      for (let i = 0; i < 80; i++) {
        const at = await where();
        const roomSays = seats.every((s) => !(at[s].safe > 0) && !(at[s].hookCool > 0) && !(at[s].slimeCool > 0) && !(at[s].cool > 0) && !(at[s].stiltCool > 0));
        const pagesSay = roomSays && (await Promise.all(seats.map((s) => pageOf[s]?.evaluate(() => document.querySelector(".ctl-bump")?.classList.contains("ready") ?? true) ?? true))).every(Boolean);
        if (pagesSay) return;
        await sleep(200);
      }
    };
    // On every phone at once, and for longer than the move takes: on a busy machine each call into a
    // page can take a while, and a watch that began late would miss the start of the move.
    const watchAll = (s, ms) => Promise.all([rob, sam, pat].map((page) => page.evaluate(([s, ms]) => window.watchMoves(s, ms), [s, ms + 1500])));
    const seenOn = (page, s) => page.evaluate((s) => window.__moves[s] ?? {}, s);
    /**
     * What a phone reloaded in the middle of a move ("legs" or "soft") drew of seat `s`, judged
     * against the room's word on that move in the first room the phone heard, on the phone's own
     * clock (it watched from its first frame: watchOnLoad). Still running when the phone first drew
     * (by more than LEAD ms, the time the move takes to show): it must be drawn. Over by more
     * than TAIL ms (the legs fold, the goo melts): it must not be. In between: it was ending
     * as the phone came back, and either is right.
     */
    /** The last whole room `page` heard at or before `t` (its own clock), or the first if none was yet. */
    async function roomAt(page, t) {
      const rooms = await page.evaluate(() => window.__rooms ?? []);
      return rooms.filter((r) => r.at <= t).at(-1) ?? rooms[0] ?? null;
    }
    async function reloadedDraws(page, s, kind) {
      const LEAD = kind === "legs" ? 450 : 100;
      const TAIL = 400;
      const path = (await seenOn(page, s)).path ?? [];
      // The room the page drew from: the last whole room it heard before its first frame.
      const first = await roomAt(page, path[0]?.[0] ?? Infinity);
      if (!first) return { ok: false, story: "the phone heard no room after the reload" };
      if (!path.length) return { ok: null, story: "the phone drew no frame in the time it was watched after the reload" };
      // How long the move had left when the room's word reached the phone (null: it was over by then).
      const heardLeft = kind === "legs" ? (first.stilts[s] === null ? null : STILT_MS - first.stilts[s]) : first.soft[s];
      const shows = ([, , legs, soft]) => (kind === "legs" ? legs > 30 : soft);
      const leftAt = (t) => (heardLeft ?? -1e9) - (t - first.at);
      const firstLeft = leftAt(path[0][0]);
      const drawnShowing = path.filter(shows).length;
      // What the page held of the move in its first frames, its times from when it heard the room.
      const held = path.slice(0, 3).map((f) => {
        const g = f[11];
        const s = f[12];
        return kind === "legs" ? `${Math.round(f[0] - first.at)}ms: legs ${Math.round(f[2])}, stilt ${s ? `from ${s.at - Math.round(first.at)}` : "none"}` : `${Math.round(f[0] - first.at)}ms: soft ${f[3]}, goo ${g ? `from ${g.at - Math.round(first.at)} turn ${g.turnAt} soft ${Math.round(g.softFor)}` : "none"}`;
      });
      const at = `it first drew ${Math.round(path[0][0] - first.at)} ms after it heard the room, with ${heardLeft === null ? "the move over" : `${Math.round(heardLeft)} ms of it left`}; ${drawnShowing} of ${path.length} frames show it (${held.join("; ")})`;
      if (heardLeft !== null && firstLeft > LEAD) return { ok: path.some((f) => leftAt(f[0]) > 0 && shows(f)), story: `still running as it drew: ${at}` };
      if (firstLeft < -TAIL) return { ok: drawnShowing === 0, story: `over before it drew: ${at}` };
      return { ok: null, story: `ending as it came back, either is right: ${at}` };
    }
    /**
     * What a phone drew of seat `s` over a stretch after it heard a message (`heard` picks which:
     * the last one so far), judged on its own clock: every frame from `fromMs` to `toMs` after it
     * heard it must pass `shows` (a frame: [t, x, legs, soft, chain, gem, fright, knock]), and no
     * frame it drew may have the piece knocked over. ok null: no frame fell in that stretch.
     */
    async function drewDuring(page, s, heard, fromMs, toMs, shows) {
      const path = (await seenOn(page, s)).path ?? [];
      const at = (await page.evaluate(() => window.__heard ?? [])).filter(heard).at(-1)?.at ?? null;
      if (at === null) return { ok: false, story: "the phone never heard it" };
      const frames = path.filter(([t]) => t >= at + fromMs && t <= at + toMs);
      const knocked = path.some((f) => f[7]);
      const span = path.length ? `; ${path.length} frames watched, from ${Math.round(path[0][0] - at)} to ${Math.round(path.at(-1)[0] - at)} ms` : "; no frame watched";
      const missing = frames.filter((f) => !shows(f)).map(([t]) => `${Math.round(t - at)}ms`);
      return { ok: knocked ? false : frames.length === 0 ? null : frames.every(shows), story: `${frames.filter(shows).length} of ${frames.length} frames from ${fromMs} to ${toMs} ms after it heard it show it${missing.length ? ` (not at ${missing.join(", ")})` : ""}${knocked ? "; a frame drew it knocked over" : ""}${frames.length ? "" : span}` };
    }
    ada.goto(1700);

    // ================================================================ the hook
    section(`${look}: Rob throws his hook at Pat: Pat is dragged to him, upright, on every phone`);
    await walkTo(pat, P, 900);
    await walkTo(rob, R, 700, 1);
    await sleep(300);
    let at = await where();
    await watchAll(P, 1600);
    await watchAll(R, 1600);
    let mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    const thrown = await after((m) => m.t === "hook" && m.s === R, 2000, mark);
    const pulled = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    check(thrown?.f === 1, `the room tells everybody Rob threw his hook, to the right (${JSON.stringify(thrown && { f: thrown.f, x: thrown.x })})`);
    check(pulled?.o === "pull" && pulled.to === P && Math.abs(pulled.x - at[R].x - 64) <= 2, `it caught Pat and dragged him from ${at[P].x} to ${pulled?.x} (Rob at ${at[R].x})`);
    await sleep(1700);
    for (const [name, page] of [["Sam", sam], ["Pat", pat]]) {
      const { path, from, ...pawn } = await seenOn(page, P);
      // Each frame the page drew, by its own clock, against where the room's pull has Pat then:
      // standing before the page heard the verdict, sliding (eased, PULL_MS) after, then landed.
      const heardAt = (await page.evaluate(() => window.__heard ?? [])).find((h) => h.t === "hk" && h.s === R)?.at ?? null;
      const start = at[P].x;
      const end = pulled?.x ?? 0;
      const due = (t) => {
        const u = (t - heardAt) / PULL_MS;
        return u <= 0 ? start : u >= 1 ? end : start + (end - start) * pullEase(u);
      };
      // On the path within a frame either way: the page starts the slide as it handles the verdict
      // and draws at its own moment in the frame, a little before or after what this watch times.
      const FRAME_LAG = 40;
      const onPath = (t, x) => {
        const [a, b] = [due(t - FRAME_LAG), due(t + FRAME_LAG)];
        return x >= Math.min(a, b) - 6 && x <= Math.max(a, b) + 6;
      };
      // Once the slide is over, another phone's piece that the page last drew part way along it (it
      // drew no frame at the end of the slide) eases on to the landing from there (the look's
      // ordinary ease toward where the room has it): between that last drawing and the landing.
      const settling = (i, t, x) => {
        if (!(t > heardAt + PULL_MS) || i === 0) return false;
        const last = path[i - 1][1];
        return x >= Math.min(last, end) - 6 && x <= Math.max(last, end) + 6;
      };
      const wrong = heardAt === null ? [] : path.filter(([t, x], i) => !onPath(t, x) && !settling(i, t, x));
      const inSlide = heardAt === null ? [] : path.filter(([t]) => t > heardAt && t < heardAt + PULL_MS);
      const story = `${path.length} frames from ${heardAt === null ? "?" : Math.round(from - heardAt)} ms, ${inSlide.length} in the slide (${inSlide.map(([t, x]) => `${Math.round(t - heardAt)}ms:${Math.round(x)}`).join(", ")}); ${wrong.length ? `off the room's path: ${wrong.map((f) => `${Math.round(f[0] - heardAt)}ms:${Math.round(f[1])} (due ${Math.round(due(f[0]))}; fright ${f[6] ?? "none"}${f[9] != null ? ` begun ${Math.round(f[9] - heardAt)} ms after it heard the verdict, from ${Math.round(f[10])}` : ""})`).join(", ")}` : "every frame on the room's path"}; ${JSON.stringify({ frights: pawn.frights, knocked: pawn.knocked })}`;
      const ok = heardAt === null || wrong.length || pawn.knocked ? false : inSlide.length === 0 ? null : pawn.frights.includes("pull");
      seen(ok, `${name}'s phone draws Pat pulled across the floor from ${start} to ${end}, upright, never knocked (${story})`);
    }
    // The chain out: every frame Sam's phone drew while Rob's hook flew (after its aim, until the
    // phone heard the verdict) shows it.
    const chainPath = (await seenOn(sam, R)).path ?? [];
    const samHeard = await sam.evaluate(() => window.__heard ?? []);
    const flewAt = samHeard.find((h) => h.t === "hook" && h.s === R)?.at ?? null;
    const landedAt = samHeard.find((h) => h.t === "hk" && h.s === R)?.at ?? null;
    // From a frame's lag after the aim (the tip clears the hand at once) until the pull that
    // follows the verdict is nearly over (the chain drags Pat in: shared/robot.js, its "pull").
    const flying = flewAt === null || landedAt === null ? [] : chainPath.filter(([t]) => t > flewAt + HOOK_AIM_MS + 100 && t < landedAt + PULL_MS - 60);
    seen(flewAt === null || landedAt === null ? false : flying.length === 0 ? null : flying.every((f) => f[4]), `Sam's phone draws Rob's chain out while the hook flies (${flying.length} frames in the flight, ${flying.filter((f) => f[4]).length} with the chain: ${flying.map((f) => `${Math.round(f[0] - flewAt)}ms:${f[4] ? "out" : "-"}`).join(", ")}; the verdict ${landedAt === null || flewAt === null ? "?" : Math.round(landedAt - flewAt)} ms after the throw)`);

    section(`${look}: a jump clears the hook; a kick toward the robot bats it away`);
    await rested(R, P);
    await walkTo(pat, P, 900);
    await walkTo(rob, R, 700, 1);
    await sleep(300);
    await sam.evaluate((s) => window.watchMoves(s, 2500), R);
    mark = ada.seen.length;
    // Pat's phone jumps as it hears Rob throw: a key press from here could reach it too late on a busy machine.
    await pat.evaluate((s) => (window.__jumpOnHookOf = s), R);
    await rob.keyboard.press("KeyX");
    const jumped = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    check(jumped?.o === "jumped" && jumped.to === P, `Pat jumps as it arrives: the hook passes under him (${JSON.stringify(jumped && { o: jumped.o, to: jumped.to })})`);
    const miss = await after((m) => m.t === "hk" && m.s === R && m.o !== "jumped", 3000, mark);
    check(miss?.o === "miss", `and flies on to the end of its reach and winds back (${miss?.o})`);
    await sleep(900);
    // Every frame Sam's phone drew while this hook flew on to the end of its reach (after its aim,
    // until the phone heard the miss) shows the chain out.
    const pathNow = (await seenOn(sam, R)).path ?? [];
    const heardNow = await sam.evaluate(() => window.__heard ?? []);
    const threw = heardNow.filter((h) => h.t === "hook" && h.s === R).at(-1)?.at ?? null;
    const missed = threw === null ? null : (heardNow.find((h) => h.t === "hk" && h.s === R && h.at > threw && h.o === "miss")?.at ?? null);
    const outFrames = threw === null || missed === null ? [] : pathNow.filter(([t]) => t > threw + HOOK_AIM_MS + 100 && t < missed);
    seen(threw === null || missed === null ? false : outFrames.length === 0 ? null : outFrames.every((f) => f[4]), `Sam's phone draws the chain out while the hook flies on past Pat (${outFrames.length} frames in the flight, ${outFrames.filter((f) => f[4]).length} with the chain)`);
    await rested(R, P);
    // Pat out of a kick's reach of Rob (130), well within his hook's.
    await walkTo(pat, P, 960, -1);
    await walkTo(rob, R, 700, 1);
    await sleep(300);
    const before = (await where())[P].x;
    mark = ada.seen.length;
    // Pat's phone kicks 100 ms after it hears Rob throw, timed by the page: the hook reaches Pat
    // about 290 ms after the throw, and a kick from 260 ms before to 100 ms after bats it away.
    await pat.evaluate((s) => (window.__kickOnHook = { of: s, after: 100 }), R);
    await rob.keyboard.press("KeyX");
    const parried = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    const kicked = ada.seen.slice(mark).find((m) => m.t === "b" && m.s === P);
    check(parried?.o === "parry" && parried.to === P, `Pat kicks toward Rob as it arrives: batted away (${JSON.stringify(parried && { o: parried.o, to: parried.to })}; Pat's kick ${JSON.stringify(kicked && { to: kicked.to, f: kicked.f })})`);
    check(Math.abs((await where())[P].x - before) < 2, "and Pat stays where he was");

    section(`${look}: the hook train, and the hook back (a bonk)`);
    await rested(R, P);
    at = await where();
    // Ada (a robot) on the left facing right, Rob in the middle facing right, Pat on the right.
    await walkTo(pat, P, 980);
    await walkTo(rob, R, 820, 1);
    ada.goto(560);
    ada.send({ t: "m", x: 560, d: 1, r: ada.rev });
    ada.send({ t: "m", x: 560, d: 0, r: ada.rev });
    await sleep(400);
    await watchAll(P, 2000);
    mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    // Ada throws as Rob's hook reaches Pat: hers reaches Rob while he drags Pat in.
    await sleep(170);
    ada.send({ t: "hook" });
    const robs = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    const adas = await after((m) => m.t === "hk" && m.s === A, 3000, mark);
    at = await where();
    check(robs?.o === "pull" && robs.to === P, `Rob's hook drags Pat in (${robs?.o})`);
    check(adas?.o === "pull" && adas.to === R && adas.tr?.s === P, `Ada's hook catches Rob mid-pull and Pat comes along behind (${JSON.stringify(adas && { o: adas.o, to: adas.to, tr: adas.tr })})`);
    check(at[A].x < at[R].x && at[R].x < at[P].x, `all three end in a line: Ada ${at[A].x}, Rob ${at[R].x}, Pat ${at[P].x}`);
    await sleep(1800);
    const train = await drewDuring(sam, P, (h) => h.t === "hk" && h.s === A, 20, MOVED.pull.ms - 20, (f) => f[6] === "pull");
    seen(train.ok, `Sam's phone draws Pat pulled along, upright (${train.story})`);

    await rested(R, A);
    // Pat well out of the way, so each robot's hook meets the other first.
    await walkTo(pat, P, 1450);
    await walkTo(rob, R, 900, -1);
    ada.goto(680);
    ada.send({ t: "m", x: 680, d: 1, r: ada.rev });
    ada.send({ t: "m", x: 680, d: 0, r: ada.rev });
    await sleep(400);
    await watchAll(R, 1500);
    mark = ada.seen.length;
    await rob.keyboard.press("KeyX");
    ada.send({ t: "hook" });
    const bonk = await after((m) => m.t === "hk" && m.o !== "jumped", 3000, mark);
    at = await where();
    check(bonk?.o === "bonk", `Rob and Ada hook each other: both yanked together, and they bonk heads (${bonk?.o})`);
    check(Math.abs(at[R].x - at[A].x) <= 70, `they end head to head (${at[A].x} and ${at[R].x})`);
    await sleep(1600);
    const bonked = await drewDuring(pat, R, (h) => h.t === "hk" && h.o === "bonk", 20, MOVED.bonk.ms - 20, (f) => f[6] === "bonk");
    seen(bonked.ok, `Pat's phone draws Rob's bonk, upright (${bonked.story})`);

    // ================================================================ the legs
    section(`${look}: Rob's legs go up, and Pat's kick swings under him; every phone draws the legs`);
    // Ada (bonked into the middle just now) well out of the way of every kick and hook from here on.
    await rested(A);
    ada.goto(1780);
    await rested(R, P);
    await walkTo(rob, R, 900);
    await walkTo(pat, P, 820, 1);
    await sleep(300);
    await watchAll(R, 1600);
    mark = ada.seen.length;
    await rob.keyboard.press("ArrowUp");
    const up = await after((m) => m.t === "stilts" && m.s === R, 2000, mark);
    const upAt = Date.now();
    check(up?.for === STILT_MS, `the room tells everybody Rob's legs are up for ${up?.for} ms`);
    await sleep(200);
    if (look === "flat") {
      // Up on its legs, the robot's name tag stays clear of the row of signs over the boxes.
      const overlap = await sam.evaluate((s) => {
        const v = globalThis.__partyRoom.view;
        const tag = v.pieces.get(s).tag.getBoundingClientRect();
        return v.boxes.some((b) => {
          const r = b.sign.getBoundingClientRect();
          return tag.left < r.right && tag.right > r.left && tag.top < r.bottom - 1 && tag.bottom > r.top;
        });
      }, R);
      check(!overlap, "Rob's name tag, lifted with his legs, stays clear of the signs");
    }
    await pat.keyboard.press("KeyX");
    const under = await after((m) => m.t === "b" && m.s === P, 2000, mark);
    check(under?.to === -1, `Pat's kick swings through the gap: it hits nobody (${JSON.stringify(under && { to: under.to })})`);
    await sleep(Math.max(0, STILT_MS + 200 - (Date.now() - upAt)));
    // Fully out from their rise until they start to drop (shared/robot.js, stiltPose). Judged
    // before any page reloads: a page loading the 3D view can starve the others of frames.
    for (const [name, page] of [["Sam", sam], ["Rob", rob]]) {
      const legs = await drewDuring(page, R, (h) => h.t === "stilts" && h.s === R, STILT_SQUAT_MS + 250, STILT_MS - STILT_DROP_MS - 50, (f) => f[2] > 80);
      seen(legs.ok, `${name}'s phone draws Rob's legs out (${legs.story})`);
    }
    // Up again, and a phone reloaded while they are up draws them up if they still are when it
    // draws again, and down if they came down before it was back (a busy machine can take seconds
    // to reload). The room's own address, as a reload of the room's page is (the join link would
    // ask for a name again).
    await rested(R);
    mark = ada.seen.length;
    await rob.keyboard.press("ArrowUp");
    const upAgain = await after((m) => m.t === "stilts" && m.s === R, 2000, mark);
    // When not: what Rob's own page heard of its legs (a refusal says why), and its key's arrival.
    const upWhy = upAgain ? "" : `; Rob's page heard ${JSON.stringify((await rob.evaluate(() => window.__heard ?? [])).filter((h) => h.t.startsWith("stilts")).slice(-3))}, holds ${JSON.stringify(await rob.evaluate(() => globalThis.__partyRoom?.moves ?? null))}, the room has him ${JSON.stringify((await where())[R])}`;
    check(upAgain?.for === STILT_MS, `Rob's legs go up again (${upAgain?.for} ms${upWhy})`);
    await pat.evaluate((s) => sessionStorage.setItem("watchOnLoad", JSON.stringify({ seat: s, ms: 2500 })), R);
    await pat.goto(`${base}/lobby/?${lookQuery}`);
    await drawn(pat);
    await sleep(1200);
    const legsJudged = await reloadedDraws(pat, R, "legs");
    seen(legsJudged.ok, `Pat's phone, reloaded mid-legs, draws Rob as the room has him when it is back (${legsJudged.story})`);
    await sleep(STILT_MS);

    // ================================================================ the slime
    section(`${look}: Sam taps Harden and Pat's kick bounces off; every phone draws the gem`);
    await rested(S, P);
    // Rob out of the way first: the heavy slime walking over to 1000 would push him along in front
    // of it, into Pat's kick (and Pat it pushes along too, so he walks back after).
    await walkTo(rob, R, 1500);
    await walkTo(sam, S, 1000);
    await rested(P);
    await walkTo(pat, P, 920, 1);
    await sleep(300);
    await watchAll(S, 1200);
    mark = ada.seen.length;
    await sam.keyboard.press("KeyX");
    const hard = await after((m) => m.t === "slime" && m.s === S, 2000, mark);
    check(hard?.k === "harden", `a tap: the room tells everybody Sam hardened (${hard?.k})`);
    await sleep(100);
    at = await where();
    await pat.keyboard.press("KeyX");
    const bounced = await after((m) => m.t === "b" && m.s === P, 2000, mark);
    check(bounced?.bo === S && bounced.to === -1, `Pat's kick bounces off and Pat is knocked back himself (${JSON.stringify(bounced && { to: bounced.to, bo: bounced.bo, x: bounced.x })})`);
    check(bounced && bounced.x < at[P].x - 60 && Math.abs((await where())[S].x - at[S].x) < 2, "Pat lands back the way he came; Sam stays put");
    await sleep(1300);
    for (const [name, page] of [["Rob", rob], ["Pat", pat]]) {
      const gem = await drewDuring(page, S, (h) => h.t === "slime" && h.s === S && h.k === "harden", SNAP_MS + 50, HARDEN_MS - 150, (f) => f[5]);
      seen(gem.ok, `${name}'s phone draws Sam as a gem (${gem.story})`);
    }

    section(`${look}: Sam holds Harden (goes soft), Rob's hook sticks, and Rob is dragged to Sam`);
    await rested(S, R, P);
    await walkTo(pat, P, 1500);
    await walkTo(sam, S, 1000);
    await walkTo(rob, R, 800, 1);
    // Where Sam stands as he goes soft: Rob is dragged to touch him there (a soft slime stays put).
    const stood = await settled(S, R);
    await watchAll(S, 1500);
    mark = ada.seen.length;
    await sam.keyboard.down("KeyX");
    await sleep(HOLD_MS + 120);
    const soft = await after((m) => m.t === "slime" && m.s === S && m.k === "absorb", 2000, mark);
    // When it did not: what the room said about Sam's moves meanwhile, and what Sam's own page thought.
    const softWhy = soft
      ? ""
      : `; the room said ${JSON.stringify(ada.seen.slice(mark).filter((m) => (m.s === S && m.t !== "m") || m.t === "vote").map((m) => m.t + (m.k ? ":" + m.k : "") + (m.t === "vote" ? (m.vote.count ? ":count" : "") : "")))}, Sam's room record ${JSON.stringify((await where())[S])}, his page ${JSON.stringify(await sam.evaluate(() => ({ phase: globalThis.__partyRoom?.view?.room?.phase, note: document.querySelector(".note")?.textContent ?? null, active: document.activeElement?.tagName })))}`;
    check(soft?.for === ABSORB_MS, `held: the room tells everybody Sam went soft (${soft?.k}${softWhy})`);
    // Sam's own phone, reloaded while soft, draws itself soft.
    await rob.keyboard.press("KeyX");
    const stuck = await after((m) => m.t === "hk" && m.s === R, 3000, mark);
    await sam.keyboard.up("KeyX");
    at = await where();
    check(stuck?.o === "stuck" && stuck.to === S, `Rob's hook sticks to Sam (${stuck?.o})`);
    // Touching Sam, unless that spot is in a light that is on (a box's pool): then just short of it.
    const dragTo = await landing(stood[R].x, stood[S].x - 64);
    check(Math.abs(at[R].x - dragTo) <= 2 && at[S].x === stood[S].x, `and Rob is dragged across to Sam (${at[R].x}, where the room's landing rule puts him: ${Math.round(dragTo)}; Sam at ${at[S].x}, where he stood as he went soft: ${stood[S].x})`);
    await sleep(1200);
    for (const [name, page] of [["Rob", rob], ["Pat", pat]]) {
      const soft = await drewDuring(page, S, (h) => h.t === "slime" && h.s === S && h.k === "absorb", 100, ABSORB_MS - 100, (f) => f[3]);
      seen(soft.ok, `${name}'s phone draws Sam soft (${soft.story})`);
    }

    section(`${look}: Sam's own phone reloaded while it is soft draws it soft`);
    await rested(S);
    mark = ada.seen.length;
    // Held until the room says Sam went soft (a fixed hold could reach a busy page as a tap).
    await sam.keyboard.down("KeyX");
    const wentSoft = await after((m) => m.t === "slime" && m.s === S && m.k === "absorb", 2000, mark);
    await sam.keyboard.up("KeyX");
    if (!wentSoft) check(false, `Sam went soft before the reload (the room said ${JSON.stringify(ada.seen.slice(mark).filter((m) => m.s === S && m.t !== "m").map((m) => m.t + (m.k ? ":" + m.k : "")))})`);
    // Soft for ABSORB_MS, then melting (SLIME's MELT_MS): drawn soft if it still is when the phone
    // draws again, and not if the absorb was over before it was back.
    // Watched long enough to see its move button come ready too (the cooldown is SLIME_COOLDOWN_MS).
    await sam.evaluate(([s, ms]) => sessionStorage.setItem("watchOnLoad", JSON.stringify({ seat: s, ms })), [S, SLIME_COOLDOWN_MS + 1000]);
    await sam.goto(`${base}/lobby/?${lookQuery}`);
    await drawn(sam);
    await sleep(1200);
    const softJudged = await reloadedDraws(sam, S, "soft");
    seen(softJudged.ok, `Sam's own phone, reloaded while soft, draws Sam as the room has him when it is back (${softJudged.story})`);
    // The reloaded phone takes its harden's cooldown from the room: its move button is ready when
    // the room's cooldown ends, not however long the view took to load later (a press in between
    // would be dropped on the phone, the room never hearing it).
    // Judged on the page's own clock: when its button came ready, against when the first room it
    // heard said the cooldown ends.
    const readyAt = await sam.evaluate(
      () =>
        new Promise((done) => {
          const t0 = performance.now();
          const tick = () => {
            // Seen ready by the watch from the phone's first frame, or now.
            if (window.__readyAt != null) return done(window.__readyAt);
            if (document.querySelector(".ctl-bump")?.classList.contains("ready")) return done(performance.now());
            if (performance.now() - t0 > 8000) return done(null);
            setTimeout(tick, 5);
          };
          tick();
        }),
    );
    // Not before the phone draws its first frame (the button is not on the screen until then), and
    // by the room it drew from: the last whole room it heard before that frame.
    const ownPath = (await seenOn(sam, S)).path ?? [];
    const firstFrameAt = ownPath[0]?.[0] ?? null;
    const first = await roomAt(sam, firstFrameAt ?? Infinity);
    const dueAt = first && firstFrameAt !== null ? Math.max(first.at + first.slimeCool[S], firstFrameAt) : null;
    const lag = readyAt === null || dueAt === null ? null : Math.round(readyAt - dueAt);
    // Ready by the second frame drawn from then (the button is set in the page's own frame, which
    // can run after the watch's in the same one), or within 100 ms where frames come faster.
    const frameAfter = dueAt === null ? null : ownPath.filter(([t]) => t >= dueAt - 1)[1]?.[0] ?? null;
    const inTime = lag !== null && (lag < 100 || (frameAfter !== null && readyAt <= frameAfter));
    const firstFrames = ownPath.slice(0, 6).map(([t, , , , , , , , cls]) => `${Math.round(t - (dueAt ?? t))}ms:${cls}`);
    check(inTime, `Sam's reloaded phone has its move ready when the room said it would be (${lag} ms after${frameAfter !== null ? `, the next frame ${Math.round(frameAfter - dueAt)} ms after` : ""}; the first room it heard gave ${first?.slimeCool[S]} ms, and it first drew ${first && firstFrameAt !== null ? Math.round(firstFrameAt - first.at) : "?"} ms after hearing it${inTime ? "" : `; its first frames, from when it was due: ${firstFrames.join(", ")}`})`);

    section(`${look}: a hold survives a page that stalls drawing; an absorb the room refuses is taken back on Sam's own phone`);
    await rested(S);
    // Sam's page draws no frame for 900 ms from the press: the hold still turns soft (a timer, not a frame).
    // The key stays down until the page sends its absorb (or 2 s): on a busy machine the key's
    // events can reach the page late, and a fixed hold could reach it as a tap. Judged by the
    // page's own clock: the absorb went HOLD_MS after the page heard the key, while it drew nothing.
    mark = ada.seen.length;
    await sam.evaluate(() => {
      window.__stallOnKey = 900;
      window.__sent = [];
    });
    await sam.keyboard.down("KeyX");
    await sam.waitForFunction(() => window.__sent.some((m) => m.k === "absorb"), null, { timeout: 2000, polling: 15 }).catch(() => null);
    await sam.keyboard.up("KeyX");
    const stalled = await after((m) => m.t === "slime" && m.s === S && m.k === "absorb", 2000, mark);
    const stallTimes = await sam.evaluate(() => ({ key: window.__keyAt, stallUntil: window.__stallUntil, absorb: window.__sent.find((m) => m.k === "absorb")?.at ?? null }));
    const sentIn = stallTimes.absorb === null ? null : Math.round(stallTimes.absorb - stallTimes.key);
    check(sentIn !== null && sentIn >= HOLD_MS - 20 && stallTimes.absorb < stallTimes.stallUntil, `Sam's page sent the absorb ${sentIn} ms after it heard the key (the hold is ${HOLD_MS} ms), ${stallTimes.absorb === null ? "-" : Math.round(stallTimes.stallUntil - stallTimes.absorb)} ms before it drew again`);
    // When it did not: what the room said about Sam meanwhile, and what Sam's own page had.
    const stalledWhy = stalled
      ? ""
      : `; the room said ${JSON.stringify(ada.seen.slice(mark).filter((m) => m.s === S && m.t !== "m").map((m) => m.t + (m.k ? ":" + m.k : "")))}, Sam's room record ${JSON.stringify((await where())[S])}, his page ${JSON.stringify(await sam.evaluate((s) => ({ phase: globalThis.__partyRoom?.view?.room?.phase, goo: globalThis.__partyRoom?.view?.pieces?.get(s)?.goo ?? null, active: document.activeElement?.tagName, visible: document.visibilityState, focus: document.hasFocus() }), S))}`;
    check(stalled?.for === ABSORB_MS, `held while the page drew nothing: Sam still goes soft (${stalled?.k ?? "no absorb"}${stalledWhy})`);
    await sleep(1400);
    await rested(S);
    // The absorb reaches the room 0.75 s late, after the harden it would turn: refused (slime-no),
    // and Sam's own phone takes back the soft it drew at once, not when its own absorb would have ended.
    await sam.evaluate(() => {
      window.__late = { test: /"k":"absorb"/, ms: 750 };
      window.__sent = [];
    });
    mark = ada.seen.length;
    // Every frame Sam's phone draws from before the press, judged on its own clock.
    await sam.evaluate((s) => window.watchMoves(s, 4000), S);
    // Held until the page sends its (held back) absorb; the press is timed from when the page heard the key.
    await sam.keyboard.down("KeyX");
    await sam.waitForFunction(() => window.__sent.some((m) => m.k === "absorb"), null, { timeout: 2000, polling: 15 }).catch(() => null);
    await sam.keyboard.up("KeyX");
    await sleep(2200);
    await sam.evaluate(() => (window.__late = null));
    // When, after the press, Sam's phone stopped drawing him soft: by about 1.05 s with the refusal,
    // 1.44 s (its own absorb's end and melt) without it.
    // Judged on the phone's own clock against when it heard the refusal: soft before it, firm from
    // the first frame after it (a frame's grace). A refusal heard only after its own absorb would
    // have ended anyway (a busy machine) shows nothing either way: not seen.
    const lateSeen = await sam.evaluate((s) => ({ key: window.__keyAt, path: window.__moves[s]?.path ?? [], refused: (window.__heard ?? []).filter((h) => h.t === "slime-no").at(-1)?.at ?? null }), S);
    const since = (t) => t - lateSeen.key;
    const softFrames = lateSeen.path.filter(([t, , , soft]) => soft && t >= lateSeen.key);
    const refusedAt = lateSeen.refused === null ? null : since(lateSeen.refused);
    const softAfter = refusedAt === null ? [] : softFrames.filter(([t]) => since(t) > refusedAt + 40);
    const refusedRoom = !ada.seen.slice(mark).some((m) => m.t === "slime" && m.k === "absorb");
    check(refusedRoom && refusedAt !== null, `the late absorb is refused by the room, and Sam's phone hears so (${refusedAt === null ? "never" : `${Math.round(refusedAt)} ms after the press`})`);
    // Its own absorb would have ended HOLD_MS + ABSORB_MS + MELT_MS after the press.
    const ownEnd = HOLD_MS + ABSORB_MS + MELT_MS;
    seen(refusedAt === null ? false : softFrames.length === 0 || refusedAt > ownEnd - 100 ? null : softAfter.length === 0, `and Sam's phone, which drew it soft (${softFrames.length} frames from ${Math.round(softFrames.length ? since(softFrames[0][0]) : -1)} ms), draws it firm again once it hears the refusal (${softAfter.length ? `soft still at ${softAfter.map(([t]) => `${Math.round(since(t))}ms`).join(", ")}` : "none soft after"})`);

    section(`${look}: Sam walks into Pat and shoves him along`);
    await rested(S, P);
    await walkTo(pat, P, 1100);
    await walkTo(sam, S, 900, 1);
    await sleep(300);
    at = await where();
    // Watched for as long as the walk may take (up to 5 s).
    await watchAll(P, 5500);
    mark = ada.seen.length;
    // Walked until the room has shoved Pat twice and 100 units along (or 5 s): a page that draws few
    // frames on a busy machine looks for the touch less often, so a fixed walk could end first.
    // Whether it also walked through him at some moment is said, not judged: the room holds a touch
    // on a walk the phone has not confirmed for TOUCH_GRACE_MS and then counts it as it was, a step
    // on, so a phone that draws few frames (and so confirms late) can see its slime catch up with
    // Pat and pass him; a slime that never pushes him along at all still fails.
    await sam.keyboard.down("ArrowRight");
    const walkFrom = Date.now();
    let shoves = [];
    let through = false;
    while (Date.now() - walkFrom < 5000) {
      await sleep(100);
      shoves = ada.seen.slice(mark).filter((m) => m.t === "shove" && m.s === S && m.to === P);
      const now = await where();
      through ||= now[S].x > now[P].x;
      if (shoves.length >= 2 && now[P].x - at[P].x >= 100) break;
    }
    await sam.keyboard.up("ArrowRight");
    await sleep(400);
    const moved = (await where())[P].x - at[P].x;
    check(shoves.length >= 2 && moved >= 100, `Sam's walk shoves Pat ${shoves.length} times, ${moved} units along in ${Date.now() - walkFrom - 400} ms${through ? " (and at one moment walked through him)" : ""}`);
    await sleep(900);
    const shoved = await drewDuring(rob, P, (h) => h.t === "shove" && h.to === P, 20, MOVED.shove.ms - 20, (f) => f[6] === "shove");
    seen(shoved.ok, `Rob's phone draws Pat shoved, upright (${shoved.story})`);

    if (look === "3d") {
      // The host changes room, and Pat's phone takes long to load the next view: while it does,
      // its view is a stand-in (view-api.js). Rob's hook catches Pat and his legs go up meanwhile:
      // the page must not fail on any of it, and once the new view is up it draws what it heard.
      section(`${look}: Rob hooks Pat and raises his legs while the host changes room and Pat's view is slow to load`);
      // Held by construction: once `slow`, every file Pat's page asks for waits until the test lets
      // it go (`release`), after the hook and the legs have both been heard, however long that takes.
      let slow = false;
      let release;
      const released = new Promise((done) => (release = done));
      await pat.route("**/lobby/**", async (route) => {
        if (slow && route.request().resourceType() !== "websocket") await released;
        await route.continue();
      });
      await rested(R, P);
      await walkTo(pat, P, 1000);
      await walkTo(rob, R, 820, 1);
      await settled(R, P);
      const failedBefore = errors.length;
      slow = true;
      mark = ada.seen.length;
      ada.send({ t: "pick", v: "ship" });
      const standing = await pat.waitForFunction(() => globalThis.__partyRoom?.view?.paused === true, null, { timeout: 8000, polling: 10 }).then(
        () => true,
        () => false,
      );
      check(standing, "Pat's view stands in while the next one loads");
      await rob.keyboard.press("KeyX");
      const caught = await after((m) => m.t === "hk" && m.s === R, 4000, mark);
      // The legs need only the hook back in (not its cooldown): a moment after the verdict.
      await sleep(400);
      await rob.keyboard.press("ArrowUp");
      const legsUp = await after((m) => m.t === "stilts" && m.s === R, 3000, mark);
      // Pat's page heard both while it stood in (it keeps them to hand on): only now may it load on.
      await pat.waitForFunction((r) => (window.__heard ?? []).some((h) => h.t === "stilts" && h.s === r), R, { timeout: 5000, polling: 20 }).catch(() => null);
      const stillStanding = await pat.evaluate(() => globalThis.__partyRoom?.view?.paused === true);
      slow = false;
      release();
      await pat.waitForFunction(() => globalThis.__partyRoom?.view && !globalThis.__partyRoom.view.paused && window.__room3d?.pieces?.size > 0, null, { timeout: 40000 });
      await sleep(1200);
      check(stillStanding && caught && legsUp, `the hook (${caught?.o}) and the legs (${!!legsUp}) came while Pat's view stood in (${stillStanding})`);
      const failed = errors.slice(failedBefore);
      check(failed.length === 0, `Pat's page took them in without an error${failed.length ? ": " + [...new Set(failed)].slice(0, 3).join("; ") : ""}`);
      // Drawn where the room has them now: Pat where the hook pulled him, Rob where he stands (the
      // 3D look eases everyone else's piece to where the room says, so it is given a moment).
      const roomNow = await where();
      await pat
        .waitForFunction(
          ([r, p, rx, px]) => {
            // The page's view now (a busy page may have gone to the simpler, flat room meanwhile).
            const pieces = globalThis.__partyRoom?.view?.pieces;
            return Math.abs(pieces?.get(r)?.rx - rx) <= 3 && Math.abs(pieces?.get(p)?.rx - px) <= 3;
          },
          [R, P, roomNow[R].x, roomNow[P].x],
          // A page drawing few frames eases slowly: it is given up to 8 s to get there.
          { timeout: 8000, polling: 50 },
        )
        .catch(() => null);
      const drawnNow = await pat.evaluate(
        ([r, p]) => {
          const pieces = globalThis.__partyRoom?.view?.pieces;
          const rob = pieces?.get(r);
          return { page: globalThis.__partyRoom?.moves ?? null, look: globalThis.__partyRoom?.view?.look, r: rob?.rx, p: pieces?.get(p)?.rx, rNet: rob?.net, rRev: rob?.rev, room: globalThis.__partyRoom?.view?.room?.room, fright: rob?.fright ? { kind: rob.fright.kind, from: rob.fright.from, to: rob.fright.to, since: performance.now() - rob.fright.at } : null, knock: !!rob?.knock, stilt: !!rob?.stilt, hook: rob?.hook ? { at: performance.now() - rob.hook.at, verdict: rob.hook.verdict?.o } : null };
        },
        [R, P],
      );
      const ok = Math.abs(drawnNow.p - roomNow[P].x) <= 3 && Math.abs(drawnNow.r - roomNow[R].x) <= 3;
      // A page that has drawn no frame for a while (its browser starved of drawing on a busy
      // machine: requestAnimationFrame does not come) has drawn nothing to judge: not seen.
      const starved = !ok && (drawnNow.page?.lastFrameAgo ?? 0) > 2000;
      (starved ? (o, w) => seen(null, w) : check)(ok,`Pat's new view draws Pat at ${Math.round(drawnNow.p)} and Rob at ${Math.round(drawnNow.r)}, where the room has them (${roomNow[P].x}, ${roomNow[R].x})${ok ? "" : `; Rob on Pat's page: net ${JSON.stringify(drawnNow.rNet)} rev ${drawnNow.rRev}, room rev ${roomNow[R].rev} d ${roomNow[R].d}; room ${drawnNow.room}, look ${drawnNow.look}; ${JSON.stringify({ fright: drawnNow.fright, knock: drawnNow.knock, stilt: drawnNow.stilt, hook: drawnNow.hook, page: drawnNow.page })}`}`);
      await pat.unroute("**/lobby/**");
    }

    section(`${look}: the pages`);
    check(errors.length === 0, `no page reported an error${errors.length ? ":\n       " + [...new Set(errors)].slice(0, 8).join("\n       ") : ""}`);
    ada.ws.close();
    for (const context of pages) await context.close();
  }
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  for (const c of sockets) c.ws.close();
  await browser.close();
}
console.log(`\n${drawnChecks.unseen.length} of ${drawnChecks.all} drawn checks went unseen (a page drew no frame inside them)${drawnChecks.unseen.length ? ":\n  " + drawnChecks.unseen.join("\n  ") : ""}`);
problems.push(...unseenProblems());
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
