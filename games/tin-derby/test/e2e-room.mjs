// Tin Derby raced inside the real party room, end to end: a local Worker (workerd), the room's own pages, real
// browsers (headless, muted). Each race is voted for in the room, mounted on every phone and on the big screen,
// raced to the end by the phones themselves (each phone's page drives its own car with the house's driver, through
// the same path as a thumb: ?derby-auto=1), and handed back to the room's Tonight board.
//
//   node games/tin-derby/test/e2e-room.mjs [--base=http://localhost:8791] [--only=short,solo,two,four,panes,trouble,stalls,noscreen,screens,look,lag,tvlag,tvperf]
//     [--out=/tmp/claude-tin-derby-room/stills]   where the stills are saved (that folder by default)
//
// The races (`npm run test:tin-derby` is the gate's: short; `npm run test:tin-derby:full` is the rest but tvperf, the
// suite to run before a change to the game itself):
//   short     one lap (derby-short, a test run's short race the room takes only where its test games are on): four
//             phones and a big screen in the split view to the finish, with a drop and return, a reload, a phone
//             with no 3D (a controller, driving by the big screen), a phone that stalls 4 s, and a phone switched to
//             controller only; the big screen's four panes are checked all race; the result reaches the Tonight
//             board once. (A late big screen does not fit: a room has one screen, already there. trouble has it.)
//   solo      one phone and a big screen
//   two       two phones and a big screen
//   four      four phones and a big screen
//   panes     the big screen's split view at 1920 x 1080 with 1, 2 (side by side, and stacked), 3 and 4 players, in short
//             races: panes, cameras, word sizes and overlaps all race, a dropped player's pane, a phone that joins
//             mid-race, the winner's close shot; stills of each
//   trouble   three phones: one drops its connection and comes back, one reloads, and the big screen joins late
//   stalls    four phones: one with no 3D (a controller), one whose page loads late (the house drives it from GO
//             until it comes up), one whose connection stalls for 5 s without closing (the house's within about a
//             second, then its own again), and a keyboard player who switches tabs holding an arrow
//   noscreen  no big screen: a phone with no 3D, and one whose picture is lost, show the plain card and the house drives their cars
//   screens   a phone with no 3D drives by the big screen; the screen reloads (nothing lost), leaves for good (the house
//             takes the car after 10 s, the phone says so), and another screen joins (the phone takes its car back)
//   look      the big screen at 1920 x 1080 (its default view and the host's button), an upright phone, a small one
//             with reduced motion, and a phone whose WebGL context is lost for good (it becomes a controller)
//   lag       one phone with 40 ms, then 200 ms, of delay each way (the room's simulated latency): how far what the
//             phone showed was from what the room made of the same moment, and how many inputs came too late
//   tvlag     a phone and a big screen, each 40 ms, then 200 ms, from the room each way: steers on the phone timed to
//             the frame the phone and the big screen show them
//   tvperf    a measurement, not in the full suite: the big screen's frame rate at 1920 x 1080 with four panes, on
//             the graphics card, with the processor slowed 4x, and in software (split, and the whole table)
// After every race: each page agreed with the room on the finishing order, no page's copy of the race differed from
// the room's at any snapshot, and the room took the game away again and showed its card.
import { mkdirSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { boxCentre } from "@n8games/lobby/world";
import { launchBrowser } from "@n8games/lobby/testing/browser";
import { partyApi, sleep } from "@n8games/lobby/testing/client";
import { still as takeStill } from "@n8games/lobby/testing/stills";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const only = new Set(opt("only", "solo,two,four,panes,trouble,stalls,noscreen,screens,look,lag,tvlag").split(","));
// Where the stills go: outside every folder the local build watches (lobby/test/predeploy-writes.test.js).
const stills = opt("out", "/tmp/claude-tin-derby-room/stills");
if (stills) mkdirSync(resolve(stills), { recursive: true });
const { api } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const inner = async (code) => (await (await fetch(api + "/debug/" + code)).json()).room;
const FRAME = 'iframe[title="Tin Derby"]';
const errors = [];
const report = {};

/**
 * A local relay in front of the site for one phone: everything passes straight through, until freeze(ms) holds
 * every byte both ways for that long without closing anything (a phone that stalls with its socket still open).
 */
function stallingRelay(target) {
  let until = 0;
  const pipe = (from, to) => {
    const queue = [];
    let timer = null;
    const drain = () => {
      timer = null;
      while (queue.length && Date.now() >= until) { const b = queue.shift(); if (!to.destroyed) to.write(b); }
      if (queue.length) timer = setTimeout(drain, Math.max(5, until - Date.now()));
    };
    from.on("data", (b) => { queue.push(b); if (!timer) drain(); });
    from.on("close", () => { const end = () => (queue.length ? setTimeout(end, 20) : to.destroy()); end(); });
    from.on("error", () => {});
  };
  const server = net.createServer((client) => {
    const site = net.connect(Number(target.port) || 80, target.hostname);
    site.on("error", () => client.destroy());
    client.on("error", () => site.destroy());
    pipe(client, site);
    pipe(site, client);
  }).listen(0);
  return { get port() { return server.address().port; }, freeze(ms) { until = Date.now() + ms; }, close() { server.close(); } };
}

/**
 * Started in each race page (derby): the page tells the run what it shows, as it draws, instead of the run asking.
 * With every page drawn in software on a small machine (a 4-core GitHub runner), a question put to a page waits behind
 * its drawing: polls of five pages took up to 7 s each there, so the run looked at the race a few times and missed
 * its end. Each frame the page draws, after the game's own step, it sends its look (and the panes, where asked) when
 * a car came home, went to the house or back, or the race ended, and otherwise every 200 ms of its own time; the run
 * keeps the latest per frame (`probes`). A page that draws nothing sends nothing, and the checks say how old the word
 * they judge is. window.__derbyLook is the same look, for a question put to the page directly.
 */
function PROBE({ panes }) {
  const d = window.__derby;
  if (panes) window.__derbyProbePanes = true;
  window.__derbyLook = () => {
    const r = d.race;
    const order = d.rules.raceOrder(r).filter((c) => !c.house).map((c) => ({ seat: c.seat, fin: c.fin, finT: c.finT, s: c.s }));
    return { t: r.t, room: d.app?.replica?.auth?.t ?? null, n: r.n, over: r.over, laps: d.rules.lapsOf(r), car: d.car, order, cars: r.cars.map((c) => ({ seat: c.seat, house: c.house, auto: c.auto, character: c.character, name: c.name, fin: c.fin })), stats: JSON.parse(JSON.stringify(d.stats)), mode: document.getElementById("app").dataset.mode, pad: !!d.app?.pad };
  };
  if (window.__derbyProbe) return;
  window.__derbyProbe = true;
  let key = "", at = -Infinity;
  const beat = () => {
    requestAnimationFrame(beat);
    const r = d.race;
    if (!r || typeof window.__derbySaw !== "function") return;
    const now = performance.now();
    const k = `${r.over}|${r.cars.map((c) => `${c.fin ? 1 : 0}${c.house ? 1 : 0}${c.auto ? 1 : 0}`).join("")}`;
    if (k === key && now - at < 200) return;
    key = k;
    at = now;
    const rec = window.__derbyLook();
    if (window.__derbyProbePanes) try { rec.P = d.panes(); } catch { /* not a big screen */ }
    window.__derbySaw(rec);
  };
  requestAnimationFrame(beat);
}
/** The latest word from each race page's probe, by its frame: {rec, at (this machine's clock when it came)}. */
const probes = new Map();

const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const contexts = new Set();
try {
  /** A page of its own (its own storage, so its own seat), with what it complained of kept, and the bytes its sockets received. */
  async function open(name, viewport, { via = browser, ...extra } = {}) {
    const context = await via.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    contexts.add(context);
    // A page load is a step to the race, not a thing timed: with two CPUs for every page, one took over 30 s.
    context.setDefaultNavigationTimeout(90_000);
    // What each race page tells of itself as it draws (see PROBE below).
    await context.exposeBinding("__derbySaw", ({ frame }, rec) => void probes.set(frame, { rec, at: Date.now() }));
    const page = await context.newPage();
    page.name = name;
    page.down = [];
    page.on("websocket", (ws) => ws.on("framereceived", (f) => page.down.push([Date.now(), typeof f.payload === "string" ? Buffer.byteLength(f.payload) : f.payload.length, typeof f.payload === "string" ? f.payload : ""])));
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    // page.quiet: what a page is expected to complain of (three.js says so when it cannot make a WebGL context).
    page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_|net::/.test(m.text()) && !(page.quiet && page.quiet.test(m.text())) && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const closeAll = async () => {
    for (const c of contexts) await c.close().catch(() => {});
    contexts.clear();
  };
  const shot = async (page, name, caption) => {
    if (!stills) return;
    if (await takeStill(page, { path: `${resolve(stills)}/${name}.png` })) console.log(`     still ${name}.png: ${caption}`);
  };

  async function screenPage(name = "screen", viewport = { width: 1280, height: 720 }) {
    const page = await open(name, viewport);
    return page;
  }
  /** The room's code (for the debug door) from the pin people type. */
  const codeOf = async (pin) => (await partyApi(base).call("GET", "/join/" + pin)).preview.code;
  /**
   * A party with a big screen: its pin. `query` goes on the screen's address (derby-tvview=split|table: its view,
   * whatever the screen remembers or draws with; by default a screen drawing in software shows the whole table).
   */
  async function startParty(screen, query = "&derby-tvview=split") {
    await screen.goto(base + "/lobby/?start&look=flat" + query);
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
    await screen.waitForSelector("svg.scene text");
    return (await screen.locator(".code-digits").textContent()).trim();
  }
  /** A big screen that comes to a party already going. */
  async function joinScreen(screen, pin, query = "&derby-tvview=split") {
    await screen.goto(base + "/lobby/?join=" + pin + "&look=flat" + query);
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
  }
  /** A phone held sideways that joins with a nickname. */
  async function phone(name, pin, query = "", { viewport = { width: 844, height: 390 }, context = { hasTouch: true, isMobile: true }, auto = true, at = base, before = null, midRace = false } = {}) {
    const page = await open(name, viewport, context);
    if (before) await before(page);
    await page.goto(at + "/lobby/?join=" + pin + "&look=flat" + (auto ? "&derby-auto=1" : "") + query);
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    // In the middle of a race the room's own scene is under the race (callers wait for the race's frame instead).
    if (!midRace) await page.waitForSelector("svg.scene text");
    return page;
  }
  /** Walks each phone's piece into Tin Derby's light with the keyboard, reading where it is from the room. */
  async function vote(code, phones) {
    for (const page of phones) {
      for (let i = 0; i < 20; i++) {
        const room = await inner(code);
        const v = room.view, N = v.boxes.length, at = v.boxes.findIndex((b) => b.id === "tin-derby");
        const m = v.members.find((x) => x?.name === page.name);
        const gap = boxCentre(at, N) - m.x;
        if (Math.abs(gap) < 14) break;
        const k = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(k);
        await sleep(Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
        await page.keyboard.up(k);
        await sleep(150);
      }
    }
  }
  /**
   * The game's frame on a room page, once the race page is running in it, with the probe started in it. `panes`: the
   * probe also sends the big screen's panes (paneCheck) with each word.
   */
  async function derby(page, timeout = 60000, { panes = false } = {}) {
    const handle = await page.waitForSelector(FRAME, { timeout });
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => window.__derby?.race, null, { timeout });
    await frame.evaluate(PROBE, { panes });
    return frame;
  }
  /** What a race page says of itself just now (the probe's own look: see PROBE). */
  const look = (frame) => frame.evaluate(() => window.__derbyLook());
  /** The big screen's panes, from the page's own state (main.js, paneCheck). */
  const panesOf = (frame) => frame.evaluate(() => window.__derby.panes());
  const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  /** On a phone: the page's buttons (Controller only, Sound) that cover the strip or the chips under it, by name. */
  const buttonsOverStrip = (frame) => frame.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, t: (e.className || e.id || e.textContent).toString().slice(0, 16) }; };
    const btns = [...document.querySelectorAll("#btns .btn")].filter((e) => e.offsetParent !== null).map(box);
    const words = [...document.querySelectorAll("#brand b, .topmid .strip, .topmid .near span, #padinfo :is(.pplace, .plap, .pline)")].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width).map(box);
    const out = [];
    for (const b of btns) for (const w of words) if (b.x < w.r && w.x < b.r && b.y < w.b && w.y < b.b) out.push(`${b.t} over ${w.t}`);
    return out;
  });
  /**
   * The big screen's split view at one moment: a pane per player and no more, each pane's camera behind that
   * player's own car with the car in the pane, every word at least 2% of the screen's height, inside its own pane,
   * clear of the other panes' words and of the table between the panes. Returns what failed (an empty list: all well).
   */
  function paneFaults(P, names) {
    const bad = [];
    if (P.mode !== "split" || P.close) return bad.concat(P.mode !== "split" ? [`mode ${P.mode}`] : []);
    if (P.n !== names.length || P.panes.length !== names.length) bad.push(`${P.panes.length} panes for ${names.length} players`);
    if (P.panes.map((p) => p.name).sort().join() !== [...names].sort().join()) bad.push(`panes for ${P.panes.map((p) => p.name)}`);
    for (const p of P.panes) {
      if (p.focus !== p.car) bad.push(`${p.name}'s pane follows car ${p.focus}, not ${p.car}`);
      // Falling off the table, the camera stays where the car went over: the car is out of its picture for a moment.
      // In the air (a leap off the bread board), the camera rises after the car on purpose (round five's chase camera),
      // so at a few frames a second the car can pass over the pane's top edge for a moment: the distance still holds.
      if (!p.fall && (p.camDist < 0.3 || p.camDist > 5 || (!p.inPane && !p.air))) bad.push(`${p.name}'s camera ${p.camDist} from the car, car in its pane: ${p.inPane} (race time ${P.t}, at ${JSON.stringify(p.at)}${p.fin ? ", home" : ""})`);
      if (p.smallest < 0.02 * P.h) bad.push(`${p.name}'s smallest word ${p.smallest}px < 2% of ${P.h}`);
      const box = { x: p.box.x, y: p.box.y, r: p.box.x + p.box.w, b: p.box.y + p.box.h };
      for (const w of p.words) {
        if (w.x < box.x - 1 || w.r > box.r + 1 || w.y < box.y - 1 || w.b > box.b + 1) bad.push(`${p.name}'s "${w.t}" leaves its pane`);
        if (P.map && overlap(w, P.map)) bad.push(`${p.name}'s "${w.t}" under the table`);
        for (const q of P.panes) if (q !== p) for (const v of q.words) if (overlap(w, v)) bad.push(`${p.name}'s "${w.t}" over ${q.name}'s "${v.t}"`);
      }
    }
    for (let i = 0; i < P.panes.length; i++) for (let j = i + 1; j < P.panes.length; j++) {
      const a = P.panes[i].box, b = P.panes[j].box;
      if (overlap({ x: a.x + 1, y: a.y + 1, r: a.x + a.w - 1, b: a.y + a.h - 1 }, { x: b.x + 1, y: b.y + 1, r: b.x + b.w - 1, b: b.y + b.h - 1 })) bad.push(`panes ${i} and ${j} overlap`);
    }
    return bad;
  }

  /**
   * Races one party to the end. `pages` are the room pages showing it (phones and screen), followed by what their
   * probes say until the room takes the game away; `during(t, frames, last)` runs every 0.1 s (t: the watched page's
   * race time, seconds). `panes`: the page whose probe also sends its panes (last.get(page).P). Returns the room's
   * `end` message and what each page last said (`last`, with `seenAt`: this machine's clock when it came).
   */
  async function race(label, code, pages, { during = null, still = null, panes = null, watch = null } = {}) {
    // Each page joins the watch as soon as its own race is up: one page slow to load (a phone that comes up after GO)
    // must not hold up watching the others, or the troubles timed by them. Each must come up, as before.
    const frames = new Map();
    const coming = pages.map((p) => derby(p, undefined, { panes: p === panes }).then((f) => void frames.set(p, f)));
    const up = Promise.all(coming);
    let allUp = false;
    up.then(() => (allUp = true), () => {}); // (awaited below)
    const last = new Map();
    // `watch`: given the frames and the pages' last words at once, as they fill (`during` runs once every page is up).
    if (watch) Object.assign(watch, { frames, last });
    let end = null, mid = false, countShot = false;
    const t0 = Date.now();
    const watched = pages.find((p) => p.name === "screen") ?? pages[0];
    const seenAt = new Map();
    let endAt = 0;
    // The longest wait for any page's word, for the log: how far behind its pages the run was.
    let stalest = 0;
    while (!end && Date.now() - t0 < 200_000) {
      for (const [p, f] of frames) {
        const said = probes.get(f);
        if (said) { last.set(p, said.rec); seenAt.set(p, said.at); stalest = Math.max(stalest, Date.now() - said.at); }
      }
      const t = last.get(watched)?.t ?? -9;
      if (still && !countShot && t < 0) { countShot = true; await still("countdown", t); }
      if (still && !mid && t > 25) { mid = true; await still("mid-race", t); }
      if (during && allUp) await during(t, frames, last);
      const home = [...last.values()].some((l) => l.cars.some((c) => c.fin));
      if (still && home && !last.finShot) { last.finShot = true; await still("finish", t); }
      for (const p of pages) if (!end) { end = endOf(p); if (end) endAt = Date.now(); }
      await sleep(100);
    }
    check(!!end, `${label}: the race ended in the room within ${Math.round((Date.now() - t0) / 1000)} s`);
    console.log(`     (the oldest word a page had sent when looked at during the race: ${(stalest / 1000).toFixed(1)} s)`);
    // Every page's race came up (derby's own wait, 60 s): a page that never did fails the run here, as it always has.
    await up;
    if (!end) return { end, last };
    // The room's card is up for some six seconds after the end: each page is watched for it from now, all at once
    // (one after another, a page drawn in software could be reached only once its card had gone).
    const cards = new Map([...frames.keys()].map((p) => [p, p.waitForFunction((sel) => !document.querySelector(sel) && !!document.querySelector(".card-back .card"), FRAME, { timeout: 15000 }).then(() => null, () => p.evaluate((sel) => ({ frames: document.querySelectorAll(sel).length, card: !!document.querySelector(".card-back .card") }), FRAME).catch((e) => ({ error: e.message })))]));
    // Each page's own last word, once its copy has reached the end too (where its frame is still there): two cars the
    // last call caught side by side can swap places in the last moments.
    await Promise.all([...frames].map(async ([p, f]) => {
      try {
        await f.waitForFunction(() => window.__derby.race.over, null, { timeout: 5000 });
        last.set(p, await look(f));
        seenAt.set(p, Date.now());
      } catch {
        // Taken away already: its probe's last word stands.
        const said = probes.get(f);
        if (said) { last.set(p, said.rec); seenAt.set(p, said.at); }
      }
    }));
    const roomOrder = end.result.map((r) => r.seat).join();
    for (const [p, l] of last) {
      const seen = l.order.map((o) => o.seat).join();
      // The cars home when the page was last looked at must be the room's first places, in its order. A car still
      // racing when the last call closed the race is placed by where it was at the room's last step, which no look
      // at a page can catch exactly (the page goes the moment the race ends): those may differ only in the seconds
      // after the last look.
      const home = l.order.filter((o) => o.fin).map((o) => o.seat), roomSeats = end.result.map((r) => r.seat);
      // The page must have been seen near the end: at the end itself, with a car home, or within 3 s of it (with no
      // car home at a look long before the end, the comparison would prove nothing).
      const ago = endAt - (seenAt.get(p) ?? 0), near = l.over || home.length > 0 || ago < 3000;
      const settled = near && (l.over || home.length === roomSeats.length ? seen === roomOrder : home.every((s, k) => roomSeats[k] === s) && !end.result.slice(0, home.length).some((r) => typeof r.time !== "number"));
      check(settled, `${label}, ${p.name}: the page's finishing order (${seen}; home ${home.join() || "none"}; ${l.over ? "seen at the end" : `last seen ${(ago / 1000).toFixed(1)} s before it`}) is the room's (${roomOrder})`);
      check(l.stats.diverged === 0, `${label}, ${p.name}: its copy of the race matched the room's at every snapshot it could check (${l.stats.compared} checked, ${l.stats.diverged} differed, ${l.stats.gaps} gaps, ${l.stats.restarts} restarts, ${l.stats.full} full snapshots)`);
    }
    // Every page that showed the race, a big screen that joined late included.
    for (const [p, seen] of cards) {
      const missed = await seen;
      check(!missed, `${label}, ${p.name}: the game is taken away and the room shows its result card${missed ? ` (not seen together within 15 s; now ${JSON.stringify(missed)})` : ""}`);
    }
    return { end, last };
  }
  /** The room's `end` message, as one page's socket received it, or null. */
  function endOf(page) {
    for (const [, , s] of page.down) {
      if (!s.includes('"t":"end"')) continue;
      try { const m = JSON.parse(s); if (m.t === "end") return m; } catch { /* not one message */ }
    }
    return null;
  }
  /** Bytes a second down one page's sockets between two times. */
  const rate = (page, from, to) => page.down.filter((d) => d[0] >= from && d[0] <= to).reduce((n, d) => n + d[1], 0) / ((to - from) / 1000);

  async function party(label, names, { query = "", screen = true, still = null } = {}) {
    const scr = screen ? await screenPage() : null;
    let pin;
    if (scr) pin = await startParty(scr);
    const phones = [];
    for (const name of names) {
      if (!pin) {
        const p = await open(name, { width: 844, height: 390 }, { hasTouch: true, isMobile: true });
        await p.goto(base + "/lobby/?start&look=flat&derby-auto=1" + query);
        await p.fill("input[name=nickname]", name);
        await p.click("text=Start the party");
        await p.waitForSelector("svg.scene text");
        pin = await p.evaluate(() => [...document.querySelectorAll("svg.scene text")].map((t) => t.textContent).find((t) => /^\d{4}$/.test(t)));
        phones.push(p);
      } else phones.push(await phone(name, pin, query));
    }
    const code = await codeOf(pin);
    await vote(code, phones);
    return { code, pin, scr, phones };
  }

  // ---------------------------------------------------------------- one, two and four phones with a big screen
  for (const [label, names] of [["solo", ["Ada"]], ["two", ["Ada", "Bo"]], ["four", ["Ada", "Bo", "Cy", "Di"]]]) {
    if (!only.has(label)) continue;
    console.log(`---- ${label}: ${names.length} phone${names.length > 1 ? "s" : ""} and a big screen`);
    const { scr, phones } = await party(label, names);
    const pages = [...phones, scr];
    const stillFn = label === "four" ? async (when, t) => {
      for (const [p, who] of [[phones[0], "phone"], [scr, "screen"]]) await shot(p, `${when}-${who}`, `${who === "phone" ? "Ada's phone (844 x 390, held sideways)" : "the big screen (1280 x 720)"}, four players, ${when} at race time ${t.toFixed(1)} s`);
    } : null;
    const started = Date.now();
    const { end, last } = await race(label, null, pages, { still: stillFn });
    if (!end) continue;
    const l0 = last.get(phones[0]);
    check(l0.mode === "phone" && !l0.pad && last.get(scr).mode === "split" && l0.car >= 0, `${label}: each phone drives and draws its own car from behind; the big screen shows a pane per player`);
    const humans = l0.cars.filter((c) => !c.house);
    check(humans.map((c) => c.name).sort().join() === [...names].sort().join() && l0.cars.length === 4, `${label}: the race holds the ${names.length} player${names.length > 1 ? "s" : ""} and ${4 - names.length} house car${names.length === 3 ? "" : "s"}`);
    report[label] = {
      rows: end.last.rows.map((r) => `${r.name} ${r.place}${r.points ? ` (+${r.points})` : ""}`).join(", "),
      bytesPerSecondPhone: Math.round(rate(phones[0], started + 6000, Date.now() - 4000)),
      ownErr: l0.stats.ownErr, rivalErr: l0.stats.rivalErr, predictMs: l0.stats.predictMs, late: l0.stats.late, sent: l0.stats.sent,
    };
    console.log(`     ${JSON.stringify(report[label])}`);
    await closeAll();
  }

  // ---------------------------------------------------------------- a drop, a reconnect, a reload and a late screen
  if (only.has("trouble")) {
    console.log("---- trouble: three phones; Bo drops and comes back, Cy reloads, the big screen joins late");
    const { code, pin, phones } = await party("trouble", ["Ada", "Bo", "Cy"], { screen: false });
    const [ada, bo, cy] = phones;
    let dropped = false, back = false, reloaded = false, late = null;
    const droppedT = { drop: 0, back: 0 };
    const handed = [];
    const during = async (t, frames, last) => {
      if (!dropped && t > 8) {
        dropped = true;
        // The race time on Ada's page at that moment (`t` is a poll's, a little older).
        droppedT.drop = await frames.get(ada).evaluate(() => window.__derby.race.t).catch(() => t);
        await bo.context().setOffline(true);
        console.log(`     Bo's phone loses its connection at race time ${t.toFixed(1)} s`);
      }
      if (dropped && !back && t > 16) {
        back = true;
        droppedT.back = await frames.get(ada).evaluate(() => window.__derby.race.t).catch(() => t);
        await bo.context().setOffline(false);
        console.log(`     Bo's phone has its connection again at ${t.toFixed(1)} s`);
      }
      if (!reloaded && t > 22) {
        reloaded = true;
        frames.delete(cy);
        last.delete(cy);
        await cy.reload();
        await cy.waitForSelector(FRAME, { timeout: 60000 });
        frames.set(cy, await derby(cy));
        console.log(`     Cy's phone reloaded at ${t.toFixed(1)} s and is racing again`);
      }
      if (!late && t > 30) {
        late = await screenPage("screen");
        await joinScreen(late, pin);
        frames.set(late, await derby(late));
        console.log(`     the big screen joined at ${t.toFixed(1)} s`);
      }
      for (const ev of ada.down.map((d) => d[2]).filter((s) => s.includes('"k":"a"'))) for (const e of JSON.parse(ev).ev ?? []) if (e.k === "a" && !handed.some((h) => h.j === e.j && h.c === e.c)) handed.push(e);
    };
    const { end, last } = await race("trouble", code, [ada, bo, cy], { during });
    if (end) {
      const boCar = last.get(ada).cars.findIndex((c) => c.name === "Bo");
      // The house had Bo's car while his phone was away, and gave it back once it returned. (It may also have had it for a
      // moment before: a page drawing in software can go a second without a word, and a page that loads late is the house's until it speaks.)
      const bo2 = handed.filter((e) => e.c === boCar).sort((a, b) => a.j - b.j);
      const houseAt = (t) => { let on = 0; for (const e of bo2) if (e.n <= (t + 3) * 120) on = e.on; return on; };
      // (The room runs 0.15 s behind its clock, so a hand-back can carry a step a little before the page's own moment.)
      const afterBack = bo2.filter((e) => e.n > (droppedT.back - 0.5 + 3) * 120);
      check(houseAt(droppedT.drop + 4) === 1 && houseAt(droppedT.back - 0.5) === 1 && afterBack.some((e) => e.on === 0), `trouble: the room handed Bo's car to the house when his phone dropped (${droppedT.drop.toFixed(2)}) and back when it returned (${droppedT.back.toFixed(2)}): ${JSON.stringify(bo2.map((e) => [e.on, +(e.n / 120 - 3).toFixed(2)]))}`);
      const boStats = last.get(bo).stats, cyStats = last.get(cy).stats;
      check(boStats.full >= 1 || boStats.restarts >= 1, `trouble: Bo's page started its copy again from the room's full snapshot after the drop (${boStats.full} full, ${boStats.restarts} restarts)`);
      check(last.get(cy).car >= 0 && cyStats.frames > 0, "trouble: Cy's page came back from the reload in the same car");
      check(!!late && last.get(late)?.mode === "split", `trouble: the big screen that joined late shows a pane per player (${last.get(late)?.mode})`);
    }
    await closeAll();
  }

  /** Everything the room told one page's sockets, as events (the hand-overs, the inputs, how far it got). */
  const roomEvents = (page) => {
    const out = [];
    for (const [, , s] of page.down) {
      if (!s.includes('"ev"')) continue;
      try { const m = JSON.parse(s); if (m.t === "ev") out.push(...m.ev); } catch { /* not one message */ }
    }
    return out;
  };
  const raceT = (n) => n / 120 - 3;
  const GO = 3 * 120;
  /**
   * Was this hand-over the room's rule for a silent page, kept to the tick? Judged on the room's own clock, which a
   * busy machine cannot stretch: a test run's room says how long it had heard nothing (quiet, ms) and how long
   * before that it last looked (gap, ms). Right when the silence was over NET.SILENT (1 s) at this look and not yet
   * at the one before, so the car went at the first look it could. (How late that look came is the machine's doing;
   * the checks keep only a loose bound on it by the wall clock.)
   */
  const SILENT_MS = 1000;
  const atFirstLook = (e) => !!e && typeof e.quiet === "number" && e.quiet > SILENT_MS && e.gap >= 0 && e.quiet - e.gap <= SILENT_MS;
  const silence = (e) => (e && typeof e.quiet === "number" ? `silent ${Math.round(e.quiet)} ms on the room's clock, its look before ${Math.round(e.gap)} ms earlier` : "the room did not say how long it was silent");
  /** Seat by name, from a page's look: the car index. */
  const carOf = (l, name) => l.cars.findIndex((c) => c.name === name);

  // ---------------------------------------------------------------- the gate's short race: everything at once, one lap
  if (only.has("short")) {
    console.log("---- short: a one-lap race (derby-short) with two phones and a big screen to the finish; Bo drops, comes back and reloads, a phone with no 3D, a phone that stalls");
    const began = Date.now();
    const scr = await screenPage();
    const pin = await startParty(scr);
    const flat = await launchBrowser({ software: true, args: ["--disable-webgl", "--disable-3d-apis"] });
    const relay = stallingRelay(new URL(base));
    try {
      const ada = await phone("Ada", pin, "&derby-short=1");
      const bo = await phone("Bo", pin, "&derby-short=1");
      // A phone with no 3D in a party with a big screen: a controller, driving its car by the big screen.
      const nogl = await phone("NoGL", pin, "", { context: { hasTouch: true, isMobile: true, via: flat } });
      nogl.quiet = /WebGL|webgl/;
      const stall = await phone("Stall", pin, "&derby-short=1", { at: `http://localhost:${relay.port}` });
      const code = await codeOf(pin);
      await vote(code, [ada, bo, nogl, stall]);
      const at = { drop: null, back: null, reload: null, freeze: null, pad: null, padBack: null, houseNote: null };
      const names = ["Ada", "Bo", "NoGL", "Stall"], faults = new Set();
      let samples = 0, sampled = null;
      // How far along each player's car was at each word from the big screen: [race time, {seat: distance}].
      const along = [];
      // race()'s frames and last words, from the moment it starts (`watch`).
      const maps = {};
      const during = async (t, frames, last) => {
        const sl = last.get(scr);
        if (sl && sl.t > (along.at(-1)?.[0] ?? -9)) along.push([sl.t, Object.fromEntries(sl.order.map((o) => [o.seat, o.s]))]);
        // The big screen's panes, as its probe sent them with each word, from GO until a car is home (by that same
        // word): one per player, each following its own car.
        if (sl?.P && sl !== sampled) {
          // The screen's frame rate since its word before (for the log, with any fault).
          const fps = sampled && sl.t > sampled.t ? (sl.stats.frames - sampled.stats.frames) / (sl.t - sampled.t) : null;
          sampled = sl;
          if (sl.t > 0.5 && !sl.cars.some((c) => c.fin)) { samples++; for (const b of paneFaults(sl.P, names)) faults.add(`${b} [screen at ${fps?.toFixed(1)} frames a second]`); }
        }
      };
      // The troubles, on the room's own clock and word, as the big screen's socket hears them (this run reads the
      // socket's frames as they arrive, whatever the page has drawn): the race time of the room's latest step, moved on
      // by how long ago it came, and who drives each car by the room's latest hand-over. Looked at every 0.1 s, and
      // nothing here waits on a page: on a small machine drawing every page in software a question to a page, or a
      // click (Playwright waits for two drawn frames), can take seconds, and the race is only some 30 s long. (Timed by
      // what the pages drew, they came 15 s late on GitHub's runner, too late for the reload to come back before the
      // end.) Each waits for its phone to be driving its own car first (a page that loads after GO is the house's until
      // it speaks, so there would be nothing to take).
      const roomWord = { read: 0, n: null, at: 0, on: new Map(), onAt: new Map() };
      const hearRoom = () => {
        const down = scr.down;
        for (; roomWord.read < down.length; roomWord.read++) {
          const [when, , s] = down[roomWord.read];
          if (!s.includes('"ev"')) continue;
          let m = null;
          try { m = JSON.parse(s); } catch { /* not one message */ }
          if (m?.t !== "ev") continue;
          for (const e of m.ev ?? []) {
            if (e.k === "n" && (roomWord.n === null || e.n >= roomWord.n)) { roomWord.n = e.n; roomWord.at = when; }
            if (e.k === "a") { roomWord.on.set(e.c, e.on); roomWord.onAt.set(e.c, raceT(e.n)); }
          }
        }
        return roomWord.n === null ? null : raceT(roomWord.n) + (Date.now() - roomWord.at) / 1000;
      };
      let reloading = null, clicking = null, raced = false;
      const troubles = (async () => {
        // Until Bo has reloaded and the stall has come (a phone driven by the house can stall only once it speaks again).
        while ((at.reload === null || at.freeze === null) && !raced) {
          await sleep(100);
          // The cars' names, from any word of the big screen's (they do not change).
          const said = maps.frames && probes.get(maps.frames.get(scr)), now = hearRoom();
          if (!said || now === null) continue;
          const r = said.rec;
          if (r.over) return;
          const own = (name) => roomWord.on.get(carOf(r, name)) === 0;
          // Bo makes his phone a controller only, before his drop and reload: it must be so again after the reload.
          if (at.pad === null && now > 1 && maps.frames.has(bo)) {
            const bf = maps.frames.get(bo);
            at.pad = {};
            clicking = bf.click("#bpad").then(() => bf.evaluate(() => ({ pad: window.__derby.app.pad, stage: getComputedStyle(document.getElementById("stage")).visibility, info: document.getElementById("padinfo").innerText.replace(/\s+/g, " ").trim(), kept: localStorage.getItem("tin-derby-controller-only") }))).then((v) => (at.pad = v), (e) => (at.pad = { error: e.message }));
          }
          // Bo drops. (His switch need only be on before his reload, after the drop: a click can take seconds to land on
          // a page drawn in software, and does not hold the drop up.)
          if (at.drop === null && now > 3 && own("Bo")) { at.drop = now; await bo.context().setOffline(true); }
          // Bo's pane on the big screen while the house has his car, from panes the screen drew 2.5 s after the drop.
          // Each step of Bo's trouble waits on the one before, as the room and the screen tell it, not on a fixed time:
          // the room hands his car to the house once it notices the closed socket (0.2 s on the card, up to 2 s drawn
          // in software), the screen's pane says so in a word the screen drew half a second after that, and then his
          // phone is back. (A fixed 5 s away, then 3 s, left the reload too late on GitHub's runner: the house drove
          // his car home before the reloaded page was up, and a car over the line is not handed back.)
          const boCar = carOf(r, "Bo"), boHouseAt = roomWord.on.get(boCar) === 1 && at.drop !== null && roomWord.onAt.get(boCar) >= at.drop - 0.5 ? roomWord.onAt.get(boCar) : null;
          if (at.drop !== null && at.back === null && at.houseNote === null && boHouseAt !== null && r.t > boHouseAt + 0.5 && r.P) at.houseNote = r.P.panes.find((p) => p.name === "Bo")?.note ?? "";
          if (at.drop !== null && at.back === null && at.houseNote !== null && now > at.drop + 2) { at.back = now; await bo.context().setOffline(false); }
          if (at.freeze === null && now > 5 && own("Stall")) { at.freeze = now; relay.freeze(4000); }
          // He reloads once his switch has landed (at.pad says what it did), so the reload shows it was kept.
          // He reloads once the room has given his car back after the drop.
          if (at.reload === null && at.back !== null && own("Bo") && roomWord.onAt.get(boCar) >= at.back - 0.5 && at.pad && Object.keys(at.pad).length) {
            at.reload = now;
            // On the room's clock, as the hand-overs are (the room cannot hand the car over before this).
            at.reloadRoom = now;
            maps.frames.delete(bo); maps.last.delete(bo);
            // Not awaited: a slow reload must not stop the other pages being watched. (Drawn in software on a loaded
            // machine, the reloaded race page can take 10 s to come up and then hold its thread for 10 s more; on the
            // graphics card it is up and drawing in about 1.5 s.)
            // How long each part of the way back took (s), for the log: the room's page loaded, the game's frame put in
            // it, the race up in that frame.
            const r0 = Date.now(), took = () => ((Date.now() - r0) / 1000).toFixed(1);
            at.reloadSteps = [];
            reloading = bo.reload({ timeout: 90_000 })
              .then(() => { at.reloadSteps.push(`room page ${took()}`); return bo.waitForSelector(FRAME, { timeout: 90_000 }); })
              .then(() => { at.reloadSteps.push(`game frame ${took()}`); return derby(bo, 90_000); })
              .then(async (f) => { at.reloadSteps.push(`race ${took()}`); maps.frames.set(bo, f); at.padBack = await f.evaluate(() => window.__derby.app.pad).catch(() => null); }, (e) => at.reloadSteps.push(`stopped: ${String(e?.message).split("\n")[0]}`));
          }
        }
      })();
      const { end, last } = await race("short", code, [ada, bo, stall, nogl, scr], { during, panes: scr, watch: maps }).finally(() => (raced = true));
      await troubles;
      await clicking;
      console.log(`     the troubles, on the room's race clock: Bo's switch then his drop ${at.drop?.toFixed(1)}, back ${at.back?.toFixed(1)}, reload ${at.reload?.toFixed(1)} (back: ${at.reloadSteps?.join(", ") || "not yet"} s after); the stall ${at.freeze?.toFixed(1)}`);
      // Bo's page may still be on its way back with the race already over: its frame is gone, so this ends with the race.
      await Promise.race([reloading, sleep(2000)]);
      if (end) {
        const l = last.get(scr), ev = roomEvents(scr), hand = (name) => ev.filter((e) => e.k === "a" && e.c === carOf(l, name)).map((e) => [e.on, +raceT(e.n).toFixed(2)]);
        check(l.laps === 1 && ev.some((e) => e.k === "len" && e.laps === 1), `short: the race was the test run's one lap (${l.laps})`);
        // The result on the Tonight board, once.
        const room = (await inner(code)).view;
        const points = room.members.filter(Boolean).reduce((n, m) => n + (m.points || 0), 0);
        check(end.last.rows.length === 4 && points === end.last.rows.reduce((n, r) => n + r.points, 0) && room.tonight?.games === 1 && room.tonight.played?.length === 1, `short: the result reached the Tonight board once (${end.last.rows.map((r) => `${r.name} ${r.place}`).join(", ")}; ${points} points in all; ${room.tonight?.games} game played, ${room.tonight?.played?.length} on the list)`);
        const ng = hand("NoGL"), row = (name) => end.result.find((r) => r.seat === l.cars[carOf(l, name)].seat);
        // The phone with no 3D drove its own car by the big screen: its hands reached the room all race, the page never
        // gave its car to the house itself (no {house: 1}: neither the no-picture card nor the 10 s no-big-screen rule),
        // and the house never kept the car. The room may hand any phone's car over when it hears nothing from it for a
        // second (NET.SILENT, by design: a stalled phone), which a machine drawing every page in software causes now and
        // then for all of them at once. Judged on the room's own word, in the order it told it (each car's events are
        // numbered, j): every hand-over after the first seconds was that rule, at the room's first look after a second
        // of silence, and the room took no hands from the phone while the house had its car (the phone's first word
        // takes the car back, before its hands count). How long the phone was silent is the machine's doing, not the
        // room's: on a small runner one was 2.3 s.
        const ngCar = carOf(l, "NoGL"), ngEv = ev.filter((e) => (e.k === "a" || e.k === "i") && e.c === ngCar).sort((a, b) => a.j - b.j);
        const ngIn = ngEv.filter((e) => e.k === "i" && raceT(e.n) > 1).length;
        const ngAsked = last.get(nogl)?.stats.houseAsked, ngFinT = row("NoGL")?.time;
        let held = false;
        const ngBad = [];
        for (const e of ngEv) {
          if (e.k === "a") {
            held = e.on === 1;
            if (held && raceT(e.n) > 2 && !atFirstLook(e)) ngBad.push(`to the house at ${raceT(e.n).toFixed(2)} not for a second of silence (${silence(e)})`);
          // (A car over the line is not handed back: hands the phone sends after that change nothing.)
          } else if (held && !(typeof ngFinT === "number" && raceT(e.n) >= ngFinT)) ngBad.push(`hands taken at ${raceT(e.n).toFixed(2)} while the house had the car`);
        }
        check(ngIn >= 5 && ngAsked === 0 && ngBad.length === 0 && typeof ngFinT === "number", `short: the phone with no 3D drove its car by the big screen: ${ngIn} inputs after GO, asked the house ${ngAsked} times, handed over ${JSON.stringify(ng)}, each for a second of silence and back at its next word${ngBad.length ? ` (not so: ${ngBad.slice(0, 4).join("; ")})` : ""}, home (${JSON.stringify(row("NoGL"))})`);
        const ngp = last.get(nogl);
        check(ngp?.pad === true && ngp.car >= 0 && ngp.stats.frames > 0, `short: ... its page is a controller (pad ${ngp?.pad}, car ${ngp?.car}, ${ngp?.stats.frames} frames)`);
        check(samples > 5 && faults.size === 0, `short: the big screen showed a pane per player, each following its own car, words at least 2% of its height and clear of each other (${samples} samples${faults.size ? ": " + [...faults].slice(0, 6).join("; ") : ""})`);
        check(at.pad?.pad === true && at.pad.stage === "hidden" && at.pad.kept === "1" && /big screen/.test(at.pad.info), `short: Bo's "Controller only" switch hid the picture and kept the thumbs (${JSON.stringify(at.pad)})`);
        // (A reloaded page drawn in software on a loaded machine can come up only after the race ends: then this is not seen, and the line says so.)
        check(at.padBack === true || (at.padBack === null && !last.get(bo)), `short: ... and his phone remembered it through the reload (${at.padBack === null ? "not seen: the reloaded page was not up before the end" : at.padBack})`);
        check(/^The house is driving/.test(at.houseNote ?? ""), `short: Bo's pane said the house was driving while his phone was away ("${at.houseNote}")`);
        const b = hand("Bo");
        // The house took it while he was away (how soon the room notices a closed socket depends on how busy the
        // machine is: about 0.2 s on the card, up to 2 s with every page drawn in software).
        check(b.some(([o, et]) => o === 1 && et >= at.drop - 0.5 && et <= at.back) && b.some(([o, et]) => o === 0 && et > at.back - 0.5), `short: Bo's car was the house's while his phone was away (${at.drop?.toFixed(2)}) and his again on return (${at.back?.toFixed(2)}): ${JSON.stringify(b)}`);
        // Came back: the room took Bo's car back from the house for his reloaded page (only his seat's own word does
        // that), and, where the test saw that page racing before the end, it drew from that car.
        // The hand-over for the reload is the first to the house at or after the room's step then; the hand-back is the next one back.
        const reloadOff = at.reload !== null && b.find(([o, et]) => o === 1 && et >= at.reloadRoom);
        const lb = last.get(bo), backAfterReload = !!reloadOff && b.find(([o, et]) => o === 0 && et >= reloadOff[1]);
        // Or, where the house drove his car over the line before the reloaded page was up (a car over the line is not
        // handed back: rules.js, settleHouse), the page came up in that same car.
        const boFinT = row("Bo")?.time, homeFirst = !!reloadOff && !backAfterReload && typeof boFinT === "number" && boFinT >= reloadOff[1] && lb?.car === carOf(l, "Bo") && lb.stats.frames > 0;
        check((!!backAfterReload && (!lb || (lb.car >= 0 && lb.stats.frames > 0))) || homeFirst, `short: Bo's page came back from its reload (at ${at.reload?.toFixed(1)} on the room's clock) in the same car (${backAfterReload ? `the room's at ${backAfterReload[1]}` : homeFirst ? `the house had driven it home at ${boFinT}, before the page was up` : "never"}; ${lb ? `seen racing, car ${lb.car}, ${lb.stats.frames} frames` : "not seen racing before the end"})`);
        const s = hand("Stall"), sOn = s.find(([o, et]) => o === 1 && et > at.freeze - 0.5);
        // Home: over the line, or, when the last call closed the race first, driven on from the hand-back: at least 40
        // along the table and a quarter of what Ada's car, the untroubled phone driven the same way, made in that time.
        // (A phone's driver steers once a drawn frame, and a loaded machine draws these pages at 2 to 4 frames a second,
        // so both phone cars can fall more than the short race's 5 s last call behind the house's, and one can lose
        // half its pace to a spill; a car left stuck after the hand-back makes next to nothing.)
        const backT = sOn ? (s.find(([o, et]) => o === 0 && et > sOn[1])?.[1] ?? Infinity) : Infinity, from = along.find(([t]) => t >= backT)?.[1], to = along.at(-1)?.[1];
        const gain = (name) => (from && to ? to[row(name)?.seat] - from[row(name)?.seat] : NaN), sGain = gain("Stall"), aGain = gain("Ada");
        const home = typeof row("Stall")?.time === "number" || (sGain >= 40 && sGain >= aGain / 4);
        // The hand-over itself, as the room told it: at its first look after a second of silence. By the wall clock
        // only that it came well inside the 4 s stall (about 1 s on a quiet machine, 2 s seen with the machine at load 59).
        const sRaw = sOn && ev.find((e) => e.k === "a" && e.c === carOf(l, "Stall") && e.on === 1 && +raceT(e.n).toFixed(2) === sOn[1]);
        check(!!sOn && atFirstLook(sRaw) && sOn[1] - at.freeze < 3.5 && backT < Infinity && home, `short: the stalled phone's car was the house's at the room's first look after a second of silence (${silence(sRaw)}), ${sOn ? (sOn[1] - at.freeze).toFixed(2) : "?"} s after the stall (${at.freeze?.toFixed(2)}), its own again after, and home (${JSON.stringify(s)}; ${JSON.stringify(row("Stall"))}; after ${backT}: Stall +${sGain?.toFixed(1)}, Ada +${aGain?.toFixed(1)})`);
      }
      report.short = { seconds: Math.round((Date.now() - began) / 1000) };
      console.log(`     the short race, party to card: ${report.short.seconds} s`);
    } finally {
      relay.close();
      await closeAll();
      await flat.close().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- phones that cannot drive, stall, load late, or switch tabs
  if (only.has("stalls")) {
    console.log("---- stalls: a phone with no 3D, a page that loads late, a phone that stalls for 5 s, a keyboard player who switches tabs");
    const scr = await screenPage();
    const pin = await startParty(scr);
    // A phone without 3D at all: WebGL off in its browser.
    const flat = await launchBrowser({ software: true, args: ["--disable-webgl", "--disable-3d-apis"] });
    try {
      const nogl = await phone("NoGL", pin, "", { context: { hasTouch: true, isMobile: true, via: flat } });
      nogl.quiet = /WebGL|webgl/;
      // A page whose race files take six seconds to arrive.
      const late = await phone("Late", pin, "", { before: (p) => p.route("**/tin-derby/page/**", async (route) => { await sleep(6000); await route.continue(); }) });
      // A phone whose connection stalls without closing (its traffic held both ways for 5 s): through a local relay.
      const relay = stallingRelay(new URL(base));
      const frozen = await phone("Stall", pin, "", { at: `http://localhost:${relay.port}` });
      // A keyboard player at a computer (no thumbs), driving by hand.
      const keys = await phone("Keys", pin, "", { auto: false, viewport: { width: 1024, height: 600 }, context: {} });
      const code = await codeOf(pin);
      await vote(code, [nogl, late, frozen, keys]);
      // The page with no 3D, in a party with a big screen: a controller, and it says why there is no picture.
      const nf = await (await nogl.waitForSelector(FRAME, { timeout: 60000 })).contentFrame();
      await nf.waitForFunction(() => window.__derby?.race, null, { timeout: 60000 });
      const said = await nf.evaluate(() => ({ pad: window.__derby.app.pad, text: document.querySelector("#padinfo .pline").innerText.trim(), switch: !document.getElementById("bpad").hidden, drift: !!document.querySelector(".tb.drift")?.offsetParent, card: !document.getElementById("nopic").hidden }));
      check(said.pad && said.text === "This phone can't show the race. Steer here: your car is on the big screen." && !said.switch && said.drift && !said.card, `stalls: the phone with no 3D is a controller and says why (${JSON.stringify(said)})`);
      await shot(nogl, "no-3d-phone", "the phone with no 3D (844 x 390, WebGL off) with a big screen in the party: a controller");
      let frozeAt = null, thawAt = null, hidAt = null, shownAt = null;
      const kf = () => derby(keys);
      const keysFrame = await kf();
      await keysFrame.evaluate(() => window.focus());
      await keys.keyboard.down("ArrowUp");
      await keys.keyboard.down("ArrowLeft");
      const during = async (t, frames) => {
        // Each moment is the race time on the room's clock as the page that acts saw it then (`t` here is a poll's, older).
        if (frozeAt === null && t > 12) {
          frozeAt = await frames.get(scr).evaluate(() => window.__derby.race.t);
          relay.freeze(5000);
          console.log(`     Stall's connection holds everything for 5 s from race time ${frozeAt.toFixed(2)} s`);
        }
        if (frozeAt !== null && thawAt === null && t > frozeAt + 5) thawAt = t;
        if (hidAt === null && t > 8) {
          // Keys switches to another tab, an arrow still held: the page is hidden.
          hidAt = await frames.get(keys).evaluate(() => { const at = window.__derby.race.t; Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); return at; });
          console.log(`     Keys switches tab at race time ${hidAt.toFixed(2)} s, holding Up and Left`);
        }
        if (hidAt !== null && shownAt === null && t > hidAt + 4) {
          shownAt = t;
          await keys.keyboard.up("ArrowLeft");
          await keys.keyboard.up("ArrowUp");
          // Back on the tab; from here the house's driver holds this page's hands, so the race does not wait for the last call.
          shownAt = await frames.get(keys).evaluate(() => { delete document.hidden; delete document.visibilityState; window.__derby.app.autoDrive = true; document.dispatchEvent(new Event("visibilitychange")); return window.__derby.app.replica.auth.t; });
          console.log(`     Keys is back at race time ${t.toFixed(1)} s`);
        }
      };
      const { end, last } = await race("stalls", code, [scr, late, frozen, keys, nogl], { during });
      relay.close();
      if (end) {
        const l = last.get(scr), ev = roomEvents(scr), hand = (name) => ev.filter((e) => e.k === "a" && e.c === carOf(l, name));
        const rowOf = (name) => end.result.find((r) => r.seat === l.cars[carOf(l, name)].seat);
        // The phone with no 3D: its own hands drove its car (the house had it at most for a moment while it loaded), home with a time.
        const ng = hand("NoGL"), ngIn = ev.filter((e) => e.k === "i" && e.c === carOf(l, "NoGL") && raceT(e.n) > 1).length;
        check(ngIn >= 5 && !ng.some((e) => e.on === 1 && raceT(e.n) > 2) && (!ng.length || ng[ng.length - 1].on === 0), `stalls: the no-3D phone drove its own car (${ngIn} inputs; house ${JSON.stringify(ng.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
        check(typeof rowOf("NoGL")?.time === "number", `stalls: ... and the car finished (${JSON.stringify(rowOf("NoGL"))})`);
        // The late page: the house drove its car from GO until it came up, then handed it back; the page said the race was under way.
        const lt = hand("Late"), lateSaid = last.get(late)?.stats.lateWord;
        check(lt.length >= 2 && lt[0].on === 1 && Math.abs(lt[0].n - GO) <= 8 && lt[1].on === 0, `stalls: the late page's car was the house's from GO until the page came up (${JSON.stringify(lt.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
        check(typeof lateSaid === "number" && lateSaid > 0, `stalls: ... and the page said "Race under way" when it came up (race time ${lateSaid}; it said hello at ${last.get(late)?.stats.upAt})`);
        // The stalled phone: the house's within about a second, its own again after, and home with a time.
        const st = hand("Stall").filter((e) => raceT(e.n) > frozeAt - 1);
        const onT = st[0] && raceT(st[0].n);
        check(st.length >= 2 && st[0].on === 1 && atFirstLook(st[0]) && onT - frozeAt < 4 && st[1].on === 0, `stalls: the stalled phone's car was the house's at the room's first look after a second of silence (${silence(st[0])}), ${onT !== undefined ? (onT - frozeAt).toFixed(2) : "?"} s after the stall began (race time ${frozeAt?.toFixed(1)}), and handed back at ${st[1] ? raceT(st[1].n).toFixed(1) : "never"} (${JSON.stringify(st.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
        check(typeof rowOf("Stall")?.time === "number", `stalls: ... and the car finished (${JSON.stringify(rowOf("Stall"))})`);
        // The keyboard player: Left and Up let go of the moment the tab was hidden, the house's within about a second, its own on the way back.
        const kc = carOf(l, "Keys"), kin = ev.filter((e) => e.k === "i" && e.c === kc && raceT(e.n) > hidAt - 0.5);
        const letGo = kin.find((e) => e.s === 0 && e.b === 0);
        check(!!letGo && raceT(letGo.n) - hidAt < 0.6, `stalls: the keyboard player's held arrows were let go of when the tab was hidden (${letGo ? (raceT(letGo.n) - hidAt).toFixed(2) + " s later" : "never"})`);
        const kh = hand("Keys").filter((e) => raceT(e.n) > hidAt - 0.5);
        check(kh.length >= 2 && kh[0].on === 1 && raceT(kh[0].n) - hidAt < 1.6 && kh[1].on === 0 && raceT(kh[1].n) >= shownAt - 0.5, `stalls: ... the house drove the car while the tab was hidden and handed it back on return (${JSON.stringify(kh.map((e) => [e.on, +raceT(e.n).toFixed(2)]))}; hidden ${hidAt?.toFixed(1)}, back ${shownAt?.toFixed(1)})`);
      }
    } finally {
      await closeAll();
      await flat.close().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- the big screen at 1920 x 1080, an upright phone, a small one, and a lost picture
  if (only.has("look")) {
    console.log("---- look: the big screen at 1920 x 1080, an upright phone (390 x 844), a small one with reduced motion (568 x 320), and a phone whose picture is lost");
    const scr = await open("screen", { width: 1920, height: 1080 });
    // No view asked for: the screen's own default (the split view on a graphics card, the whole table in software),
    // then the host's button to the whole table, remembered on this screen.
    const pin = await startParty(scr, "");
    const up = await phone("Upright", pin, "", { viewport: { width: 390, height: 844 } });
    const small = await phone("Small", pin, "", { viewport: { width: 568, height: 320 }, context: { hasTouch: true, isMobile: true, reducedMotion: "reduce" } });
    const lost = await phone("Lost", pin);
    lost.quiet = /WebGL|context/i;
    const code = await codeOf(pin);
    await vote(code, [up, small, lost]);
    /** Whether the big words that came up in the next few seconds moved (scale, tilt, drift) or only faded. */
    const wordsMove = (frame) => frame.evaluate(async () => {
      const seen = { words: 0, moved: false };
      // The count-in's 3, 2, 1 and GO, or the first words of the race: up to 20 s, a second past the first word seen.
      for (let k = 0, stop = 200; k < stop; k++) {
        for (const w of document.querySelectorAll(".words .word")) { if (!seen.words) stop = k + 10; seen.words++; for (const a of w.getAnimations()) if (a.effect.getKeyframes().some((f) => f.transform)) seen.moved = true; }
        await new Promise((r) => setTimeout(r, 100));
      }
      return seen;
    });
    const [upF, smallF] = [await derby(up), await derby(small)];
    const [upWords, smallWords] = await Promise.all([wordsMove(upF), wordsMove(smallF)]);
    check(upWords.words > 0 && upWords.moved, `look: the count-in's big words pop and tilt on a phone (${JSON.stringify(upWords)})`);
    check(smallWords.words > 0 && !smallWords.moved, `look: ... and only fade where the phone asks for reduced motion (${JSON.stringify(smallWords)})`);
    let lostAt = null, lostSays = null, lostGaveUp = null, overlaps = 0, samples = 0, viewSwitch = null;
    const layout = { up: null, tv: null };
    const during = async (t, frames, last) => {
      if (lostAt === null && t > 10) {
        lostAt = t;
        await frames.get(lost).evaluate(() => window.__derby.app.world.renderer.getContext().getExtension("WEBGL_lose_context").loseContext());
        console.log(`     Lost's picture is taken away at race time ${t.toFixed(1)} s`);
      }
      if (lostAt !== null && lostSays === null && frames.has(lost)) {
        // The page waits 1.5 s for the context to come back (longer here: a page drawing in software is slow to hear it).
        // With a big screen in the party, it carries on as a controller (its car is on the big screen).
        const says = await frames.get(lost).evaluate(() => (window.__derby.lostPicture && window.__derby.app.pad ? document.querySelector("#padinfo .pline").innerText.trim() : null)).catch(() => null);
        if (says !== null || t > lostAt + 15) {
          lostSays = says ?? "";
          lostGaveUp = t;
        }
      }
      if (t > 4 && samples < 40) {
        samples++;
        // The small phone: no rival's name over the strip and chips.
        overlaps += await frames.get(small).evaluate(() => {
          const boxes = [...document.querySelectorAll(".topmid .strip, .topmid .near span")].map((e) => e.getBoundingClientRect()).filter((q) => q.width);
          const hit = (r) => boxes.some((q) => r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom);
          return [...document.querySelectorAll(".tag:not([hidden])")].filter((g) => hit(g.getBoundingClientRect())).length;
        });
      }
      if (t > 1 && !viewSwitch) {
        const sf = frames.get(scr);
        const read = () => sf.evaluate(() => ({ mode: document.getElementById("app").dataset.mode, kept: localStorage.getItem("tin-derby-big-screen-view"), button: document.getElementById("bview").textContent, renderer: window.__derby.stats.renderer }));
        // Its default, one press, another press, and (if need be) a third, to end on the whole table for the checks below.
        viewSwitch = [await read()];
        for (let k = 0; k < 2; k++) { await sf.click("#bview"); viewSwitch.push(await read()); }
        if (viewSwitch[2].mode !== "tvwide") { await sf.click("#bview"); viewSwitch.push(await read()); }
      }
      if (t > 6 && !layout.up) {
        layout.covered = [...(await buttonsOverStrip(frames.get(up))).map((s) => "upright: " + s), ...(await buttonsOverStrip(frames.get(small))).map((s) => "small: " + s)];
        layout.up = await frames.get(up).evaluate(() => [...document.querySelectorAll(".topmid .strip, .topmid .near span")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { k: e.className || e.textContent.slice(0, 12), l: Math.round(r.left), r: Math.round(r.right) }; }));
        layout.tv = await frames.get(scr).evaluate(() => { const g = document.querySelector(".tag:not([hidden])"); return { h: innerHeight, tag: g ? parseFloat(getComputedStyle(g).fontSize) : 0, hint: parseFloat(getComputedStyle(document.getElementById("hint")).fontSize) }; });
      }
    };
    let finTok = null;
    const still = async (when, t) => {
      if (when === "mid-race") { await shot(scr, "screen-1920-mid-race", `the big screen (1920 x 1080) at race time ${t.toFixed(1)} s`); await shot(up, "upright-phone", `the upright phone (390 x 844) at race time ${t.toFixed(1)} s`); await shot(small, "small-phone", `the small phone (568 x 320, reduced motion) at race time ${t.toFixed(1)} s`); }
      if (when === "finish") {
        // A car is home: the strip's tokens are read now, while the race is still up.
        const tv = await scr.$(FRAME);
        finTok = tv ? await (await tv.contentFrame()).evaluate(() => { const line = document.getElementById("tvline").getBoundingClientRect(), places = document.getElementById("tvplaces").getBoundingClientRect(); return { line: line.right, places: places.left, toks: [...document.querySelectorAll("#tvline .tok")].map((e) => e.getBoundingClientRect().right) }; }).catch(() => null) : null;
        await shot(scr, "screen-1920-finish-close", `the big screen (1920 x 1080) as the first car finishes (its close shot at the line), race time ${t.toFixed(1)} s`);
        await sleep(4000); // past the close shot: the whole table again, a car home (if the race is still up)
        if (await scr.$(FRAME)) await shot(scr, "screen-1920-finish", `the big screen (1920 x 1080) a few seconds after the first car finished`);
      }
    };
    const { end, last } = await race("look", code, [scr, up, small, lost], { during, still });
    if (end) {
      const vs = viewSwitch ?? [], soft = /SwiftShader|llvmpipe/i.test(vs[0]?.renderer ?? "");
      // The whole table is the default for now (the owner's choice), on a graphics card or not; the button reaches the split view.
      check(vs.length >= 3 && vs[0].mode === "tvwide" && vs[0].kept === null && vs[1].mode === "split" && vs[1].kept === "split" && vs[2].mode === "tvwide" && vs[2].kept === "table",
        `look: the big screen starts on the whole table${soft ? " (drawing in software)" : ""}, and its one button switches to the split view and back, remembered each press (${JSON.stringify(vs.map((v) => [v.mode, v.kept, v.button]))})`);
      check(layout.covered && layout.covered.length === 0, `look: on the upright and the small phone (each with the Controller only switch) no button covers the strip or chips (${JSON.stringify(layout.covered)})`);
      check(layout.up && layout.up.every((b) => b.l >= 0 && b.r <= 390), `look: the upright phone's strip and chips fit its 390 px (${JSON.stringify(layout.up)})`);
      check(overlaps === 0, `look: on the small phone no rival's name covered the strip or chips (${samples} frames sampled, ${overlaps} overlaps)`);
      check(layout.tv && layout.tv.tag >= 0.02 * layout.tv.h && layout.tv.hint >= 0.02 * layout.tv.h, `look: the big screen's names and hint are at least 2% of its height (${JSON.stringify(layout.tv)})`);
      check(finTok && finTok.toks.every((r) => r <= finTok.line + 1) && finTok.places >= finTok.line, `look: on the big screen's strip every token stays on its line, clear of the places (${JSON.stringify(finTok)})`);
      const l = last.get(scr), lc = carOf(l, "Lost"), ev = roomEvents(scr).filter((e) => e.k === "a" && e.c === lc);
      check(lostSays === "This phone can't show the race. Steer here: your car is on the big screen.", `look: the phone whose picture was lost became a controller and says why, ${lostGaveUp !== null ? (lostGaveUp - lostAt).toFixed(1) : "?"} s after ("${lostSays}")`);
      // Its own hands keep driving: the house never has the car for good (a page stuck drawing in software may go quiet for a second and be handed over and back).
      const final = ev[ev.length - 1], lostIn = roomEvents(scr).filter((e) => e.k === "i" && e.c === lc && raceT(e.n) > (lostGaveUp ?? 99) + 1).length;
      check((!final || final.on === 0) && lostIn >= 3, `look: ... and it kept driving its car (${lostIn} inputs after; house ${JSON.stringify(ev.map((e) => [e.on, +raceT(e.n).toFixed(2)]))}, lost at ${lostAt?.toFixed(1)})`);
      const row = end.result.find((r) => r.seat === l.cars[lc].seat);
      check(typeof row?.time === "number", `look: ... and its car finished (${JSON.stringify(row)})`);
    }
    await closeAll();
  }

  // ---------------------------------------------------------------- the big screen's split view at 1, 2 and 3 players
  // (four is the gate's short race). Short races, the big screen at 1920 x 1080; stills of each.
  if (only.has("panes")) {
    // --panes=1,2,3,4: which of them (all by default).
    const counts = new Set(opt("panes", "1,2,3,4").split(",").map(Number));
    const runs = [["panes-1", ["Ada"], ""], ["panes-2", ["Ada", "Bo"], ""], ["panes-3", ["Ada", "Bo", "Cy"], ""], ["panes-4", ["Ada", "Bo", "Cy", "Di"], ""]].filter(([, names]) => counts.has(names.length));
    for (const [label, names, q] of runs) {
      console.log(`---- ${label}: ${names.length} phone${names.length > 1 ? "s" : ""} and a big screen at 1920 x 1080 in the split view`);
      const scr = await screenPage("screen", { width: 1920, height: 1080 });
      const pin = await startParty(scr, "&derby-tvview=split" + q);
      const phones = [];
      for (const name of names) phones.push(await phone(name, pin, "&derby-short=1"));
      const code = await codeOf(pin);
      await vote(code, phones);
      const faults = new Set();
      let samples = 0, mid = false, drop = null, joiner = null, closeSeen = null, pad = null;
      const shots = [];
      // With two side by side, Bo's phone drops for a few seconds; with three, a fourth phone joins in the middle.
      const dropper = label === "panes-2" ? phones[1] : null;
      const during = async (t, frames, last) => {
        const f = frames.get(scr);
        // From the first car home, only the close shot is looked for: the polls go quickly to catch the race's end.
        const home = last.get(scr)?.cars.some((c) => c.fin);
        if (home && closeSeen === null) closeSeen = (await panesOf(f).catch(() => null))?.close ?? null;
        if (t > 0.5 && !home) { const P = await panesOf(f).catch(() => null); if (P) { samples++; for (const b of paneFaults(P, names)) faults.add(b); } }
        // Stills are not waited for: a 1920 x 1080 still can take many seconds while the card is shared, and the race
        // must be watched meanwhile (one run lost 50 s of it to a still). They are all waited for after the race.
        if (!mid && t > 9) { mid = true; shots.push(shot(scr, `${label}-mid-race`, `the big screen (1920 x 1080), ${names.length} player${names.length > 1 ? "s" : ""}, race time ${t.toFixed(1)} s`)); }
        // With two, Ada's phone is a controller only for a while (a still of it), then draws the race again.
        if (dropper && !pad && t > 2) { pad = { on: true, before: await buttonsOverStrip(frames.get(phones[0])) }; await frames.get(phones[0]).click("#bpad"); }
        if (pad?.on && !pad.shot && t > 6) {
          pad.shot = true;
          pad.during = await buttonsOverStrip(frames.get(phones[0]));
          await shot(phones[0], "phone-controller-only", `Ada's phone (844 x 390) switched to controller only: no picture, big thumbs, place and power, race time ${t.toFixed(1)} s`);
          await frames.get(phones[0]).click("#bpad");
          pad.back = await frames.get(phones[0]).evaluate(() => ({ pad: window.__derby.app.pad, stage: getComputedStyle(document.getElementById("stage")).visibility, kept: localStorage.getItem("tin-derby-controller-only") }));
        }
        if (dropper && !drop && t > 4) { drop = { at: t }; await dropper.context().setOffline(true); }
        if (drop && !drop.note && t > drop.at + 2.5) {
          drop.note = (await panesOf(f)).panes.find((p) => p.name === "Bo")?.note ?? "";
          await shot(scr, "split-dropped-player", `the big screen, two players: Bo's phone is away and the house drives his car, race time ${t.toFixed(1)} s`); // waited for: Bo stays away until it is taken
          await dropper.context().setOffline(false);
        }
        if (names.length === 3 && !joiner && t > 5) {
          joiner = { t };
          const p = await phone("Dee", pin, "", { midRace: true });
          console.log(`     Dee joins at race time ${t.toFixed(1)} s`);
          const jf = await derby(p);
          joiner = await look(jf);
          joiner.hint = await jf.evaluate(() => document.getElementById("hint").textContent);
          joiner.panes = (await panesOf(f)).n;
          console.log(`     Dee watches: ${JSON.stringify({ car: joiner.car, mode: joiner.mode, panes: joiner.panes })}`);
        }
      };
      const still = async (when, t) => {
        if (when === "countdown") shots.push(shot(scr, `${label}-count`, `the big screen (1920 x 1080), ${names.length} player${names.length > 1 ? "s" : ""}: the count-in, race time ${t.toFixed(1)} s`));
        if (when === "finish") {
          shots.push(shot(scr, `${label}-finish-close`, `the big screen as the first car finishes: the close shot at the line across the whole screen`));
          shots.push(sleep(3200).then(async () => { if (await scr.$(FRAME).catch(() => null)) await shot(scr, `${label}-finish`, `the big screen a few seconds after the first car finished`); }));
        }
      };
      const { end, last } = await race(label, code, [...phones, scr], { during, still });
      await Promise.all(shots);
      if (end) {
        check(samples > 5 && faults.size === 0, `${label}: a pane per player, each following its own car, words at least 2% of the height, nothing over anything (${samples} samples${faults.size ? ": " + [...faults].slice(0, 6).join("; ") : ""})`);
        check(phones.every((p) => last.get(p)?.mode === "phone" && !last.get(p)?.pad), `${label}: every phone still draws its own car`);
        check(closeSeen === true, `${label}: the winner's close shot took the whole big screen (${closeSeen})`);
        if (dropper) check(/^The house is driving/.test(drop?.note ?? ""), `${label}: Bo's pane said the house was driving while his phone was away ("${drop?.note}")`);
        if (dropper) check(pad && !pad.before?.length && !pad.during?.length, `${label}: on Ada's phone (844 x 390) no button covers the strip, the chips or the controller's words, drawing the race or not (${JSON.stringify(pad && [pad.before, pad.during])})`);
        if (dropper) check(pad?.back?.pad === false && pad.back.stage === "visible" && pad.back.kept === "0", `${label}: Ada's phone came back from controller only to drawing the race, and remembers that (${JSON.stringify(pad?.back)})`);
        if (names.length === 3) check(joiner && joiner.car === -1 && joiner.mode === "tvwide" && /next one/.test(joiner.hint) && joiner.panes === 3, `${label}: a phone that joined mid-race watches the whole table and races next time; the big screen keeps its three panes (${JSON.stringify(joiner && { car: joiner.car, mode: joiner.mode, hint: joiner.hint, panes: joiner.panes })})`);
      }
      await closeAll();
    }
  }

  // ---------------------------------------------------------------- no big screen: a phone with no 3D gives its car to the house
  if (only.has("noscreen")) {
    console.log("---- noscreen: three phones and no big screen; one has no 3D and one loses its picture, so the house drives their cars");
    const flat = await launchBrowser({ software: true, args: ["--disable-webgl", "--disable-3d-apis"] });
    try {
      const ada = await open("Ada", { width: 844, height: 390 }, { hasTouch: true, isMobile: true });
      await ada.goto(base + "/lobby/?start&look=flat&derby-auto=1&derby-short=1");
      await ada.fill("input[name=nickname]", "Ada");
      await ada.click("text=Start the party");
      await ada.waitForSelector("svg.scene text");
      const pin = await ada.evaluate(() => [...document.querySelectorAll("svg.scene text")].map((t) => t.textContent).find((t) => /^\d{4}$/.test(t)));
      const nogl = await phone("NoGL", pin, "", { auto: false, context: { hasTouch: true, isMobile: true, via: flat } });
      nogl.quiet = /WebGL|webgl/;
      // A phone whose picture is lost for good mid-race, with no big screen to drive by: its car goes to the house.
      const lost = await phone("Lost", pin, "&derby-short=1");
      lost.quiet = /WebGL|context/i;
      const code = await codeOf(pin);
      await vote(code, [ada, nogl, lost]);
      const nf = await (await nogl.waitForSelector(FRAME, { timeout: 60000 })).contentFrame();
      await nf.waitForFunction(() => window.__derby?.noPicture, null, { timeout: 60000 });
      const said = await nf.evaluate(() => ({ text: document.getElementById("nopic").innerText.replace(/\s+/g, " ").trim(), sound: !!document.getElementById("bsound").offsetParent, canvas: !!document.getElementById("gl").offsetParent }));
      check(said.text === "This phone can't show the race. The house is driving your car." && !said.sound && !said.canvas, `noscreen: with no big screen, the phone with no 3D says so plainly (no big screen mentioned), with no dead button and no picture (${JSON.stringify(said)})`);
      await shot(nogl, "no-3d-phone-no-screen", "the phone with no 3D (844 x 390, WebGL off) in a party with no big screen: the house drives its car");
      let lostAt = null, lostSays = null, scr = null, lateSwitch = null;
      const during = async (t, frames, last) => {
        // A big screen joins once the race is on (after Lost has gone to the house): Ada's phone, which mounted with
        // none, now offers the Controller only switch, and it works.
        if (!scr && t > 6) { scr = await screenPage(); await joinScreen(scr, pin); }
        if (scr && !lateSwitch && t > 10) {
          const af = frames.get(ada);
          if (await af.evaluate(() => !document.getElementById("bpad").hidden)) {
            await af.click("#bpad");
            lateSwitch = await af.evaluate(() => ({ shown: true, pad: window.__derby.app.pad }));
            await af.click("#bpad");
            lateSwitch.after = await af.evaluate(() => window.__derby.app.pad);
          } else if (t > 20) lateSwitch = { shown: false };
        }
        if (lostAt === null && t > 3 && frames.has(lost)) { lostAt = t; await frames.get(lost).evaluate(() => window.__derby.app.world.renderer.getContext().getExtension("WEBGL_lose_context").loseContext()); }
        if (lostAt !== null && lostSays === null && frames.has(lost)) {
          lostSays = await frames.get(lost).evaluate(() => (window.__derby.noPicture ? document.getElementById("nopic").innerText.replace(/\s+/g, " ").trim() : null)).catch(() => null);
          if (lostSays !== null) { frames.delete(lost); last.delete(lost); } // it shows the race no more: not compared at the end
        }
      };
      const { end, last } = await race("noscreen", code, [ada, lost], { during });
      if (end) {
        const l = last.get(ada), ev = roomEvents(ada), handed = (name) => ev.filter((e) => e.k === "a" && e.c === carOf(l, name)), row = (name) => end.result.find((r) => r.seat === l.cars[carOf(l, name)].seat);
        const ng = handed("NoGL");
        check(ng.length === 1 && ng[0].on === 1 && ng[0].n <= GO + 4 && typeof row("NoGL")?.time === "number", `noscreen: the room gave its car to the house by GO and the car finished (${JSON.stringify(ng.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
        check(lateSwitch?.shown === true && lateSwitch.pad === true && lateSwitch.after === false, `noscreen: when a big screen joined mid-race, the phone that began with none offered Controller only, and it switched on and off (${JSON.stringify(lateSwitch)})`);
        const lh = handed("Lost"), final = lh[lh.length - 1];
        check(lostSays === "This phone can't show the race. The house is driving your car." && final?.on === 1 && raceT(final.n) > lostAt - 0.5 && typeof row("Lost")?.time === "number", `noscreen: a phone whose picture was lost for good, with no big screen, says so and gives its car to the house, which brings it home ("${lostSays}"; lost at ${lostAt?.toFixed(1)}; ${JSON.stringify(lh.map((e) => [e.on, +raceT(e.n).toFixed(2)]))}; ${JSON.stringify(row("Lost"))})`);
      }
    } finally {
      await closeAll();
      await flat.close().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- the big screen reloads, then leaves, then another comes
  if (only.has("screens")) {
    console.log("---- screens: a phone with no 3D drives by the big screen; the screen reloads (nothing lost), leaves for good (the house takes the car), and another joins (the phone takes it back)");
    const flat = await launchBrowser({ software: true, args: ["--disable-webgl", "--disable-3d-apis"] });
    try {
      let scr = await screenPage();
      const pin = await startParty(scr);
      const ada = await phone("Ada", pin);
      const nogl = await phone("NoGL", pin, "", { context: { hasTouch: true, isMobile: true, via: flat } });
      nogl.quiet = /WebGL|webgl/;
      const code = await codeOf(pin);
      await vote(code, [ada, nogl]);
      const at = { reload: null, back: null, close: null, blind: null, join: null, unblind: null, blindDuringReload: false };
      const blindOf = (frames) => frames.get(nogl).evaluate(() => ({ blind: !!window.__derby.app.blind, text: document.getElementById("nopic").hidden ? "" : document.getElementById("nopic").innerText.replace(/\s+/g, " ").trim(), t: window.__derby.race.t })).catch(async (e) => {
        // Say what the phone's page shows instead of its race, then fail plainly.
        const was = await nogl.evaluate((sel) => ({ frames: document.querySelectorAll(sel).length, url: location.href, card: !!document.querySelector(".card-back .card"), text: document.body.innerText.slice(0, 200) }), FRAME).catch(() => null);
        throw new Error(`the no-3D phone's race went (${e.message}): ${JSON.stringify(was)}`);
      });
      const during = async (t, frames) => {
        if (at.reload === null && t > 3) { at.reload = t; await scr.reload(); await derby(scr); at.back = (await blindOf(frames)).t; }
        if (at.back !== null && at.close === null && t < at.back + 11) at.blindDuringReload ||= (await blindOf(frames)).blind;
        if (at.back !== null && at.close === null && t > at.back + 11) { at.close = t; await scr.close(); }
        if (at.close !== null && at.blind === null) { const b = await blindOf(frames); if (b.blind) at.blind = b; }
        if (at.blind && at.join === null && t > at.close + 17) { at.join = t; scr = await screenPage("screen2"); await joinScreen(scr, pin); }
        if (at.join !== null && at.unblind === null) { const b = await blindOf(frames); if (!b.blind) at.unblind = b; }
      };
      const { end, last } = await race("screens", code, [ada, nogl], { during });
      if (end) {
        const l = last.get(ada), ev = roomEvents(ada), c = carOf(l, "NoGL");
        const hand = ev.filter((e) => e.k === "a" && e.c === c).map((e) => [e.on, +raceT(e.n).toFixed(2)]);
        const inputs = (from, to) => ev.filter((e) => e.k === "i" && e.c === c && raceT(e.n) > from && raceT(e.n) < to).length;
        check(!at.blindDuringReload && !hand.some(([o, et]) => o === 1 && et > 1 && et < at.close), `screens: while the big screen reloaded (${at.reload?.toFixed(1)} to ${at.back?.toFixed(1)}) the no-3D phone kept driving its car (house ${JSON.stringify(hand)}; ${inputs(at.reload, at.close)} inputs)`);
        const off = hand.find(([o, et]) => o === 1 && et > at.close);
        check(!!at.blind && at.blind.text === "No big screen now. This phone can't show the race, so the house is driving your car until a big screen is back." && !!off && off[1] - at.close >= 9 && off[1] - at.close < 14, `screens: with the big screen gone for good (${at.close?.toFixed(1)}), the phone said so and the house took its car ${off ? (off[1] - at.close).toFixed(1) : "?"} s later ("${at.blind?.text}")`);
        const on = off && hand.find(([o, et]) => o === 0 && et > off[1]);
        check(!!at.unblind && !!on && on[1] > at.join - 1 && inputs(on[1], 999) >= 3 && typeof end.result.find((r) => r.seat === l.cars[c].seat)?.time === "number", `screens: when another big screen joined (${at.join?.toFixed(1)}) the phone took its car back (${on ? on[1] : "never"}) and drove it home (${inputs(on?.[1] ?? 999, 999)} inputs after)`);
      }
    } finally {
      await closeAll();
      await flat.close().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- a thumb on the phone to the car on the big screen
  if (only.has("tvlag")) {
    for (const lag of [40, 200]) {
      console.log(`---- tvlag ${lag}: one phone and a big screen, each ${lag} ms from the room each way: a steer on the phone, timed to the frame the big screen shows it`);
      const scr = await screenPage();
      const pin = await startParty(scr, `&derby-tvview=split&lag=${lag}`);
      const ada = await phone("Ada", pin, `&derby-short=1&lag=${lag}`, { auto: false });
      const code = await codeOf(pin);
      await vote(code, [ada]);
      const [af, sf] = [await derby(ada), await derby(scr)];
      const car = await af.evaluate(() => window.__derby.car);
      // Each page logs, each frame, when the car's held steer (inSt) changes in the race it draws, on the machine's clock.
      const recorder = (i) => { const log = (window.__steerLog = []); let was = null; const tick = () => { const r = window.__derby.race; if (r && r.cars[i].inSt !== was) { was = r.cars[i].inSt; log.push([performance.timeOrigin + performance.now(), was]); } requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
      await af.evaluate(recorder, car); await sf.evaluate(recorder, car);
      await af.waitForFunction(() => window.__derby.race.t > 1.5, null, { timeout: 60000 });
      // Twelve presses and releases, right and left in turn, half a second each: a key event, as a thumb's would be.
      const presses = [];
      for (let k = 0; k < 12; k++) {
        const code = k % 2 ? "KeyA" : "KeyD", value = k % 2 ? -1 : 1;
        presses.push([await af.evaluate((c) => { const at = performance.timeOrigin + performance.now(); window.dispatchEvent(new KeyboardEvent("keydown", { code: c })); return at; }, code), value]);
        await sleep(500);
        presses.push([await af.evaluate((c) => { const at = performance.timeOrigin + performance.now(); window.dispatchEvent(new KeyboardEvent("keyup", { code: c })); return at; }, code), 0]);
        await sleep(500);
      }
      const [phoneLog, tvLog] = [await af.evaluate(() => window.__steerLog), await sf.evaluate(() => window.__steerLog)];
      await af.evaluate(() => { window.__derby.app.autoDrive = true; }); // the house's driver takes the thumbs to the finish
      const delays = (log) => presses.map(([at, v]) => { const hit = log.find(([t, s]) => t >= at && s === v); return hit ? hit[0] - at : null; });
      const stat = (list) => { const d = list.filter((x) => x !== null).sort((a, b) => a - b); const q = (f) => d[Math.min(d.length - 1, Math.floor(f * d.length))]; return { n: d.length, missed: list.length - d.length, median: Math.round(q(0.5)), p90: Math.round(q(0.9)), max: Math.round(d[d.length - 1]), min: Math.round(d[0]) }; };
      const r = { phone: stat(delays(phoneLog)), screen: stat(delays(tvLog)) };
      report["tvlag" + lag] = r;
      console.log(`     ${JSON.stringify(r)}`);
      const { end } = await race(`tvlag ${lag}`, code, [ada, scr]);
      check(!!end && r.screen.missed === 0 && r.phone.missed === 0, `tvlag ${lag}: every one of ${presses.length} steers showed on the phone (median ${r.phone.median} ms) and on the big screen (median ${r.screen.median} ms, 90% within ${r.screen.p90}, at most ${r.screen.max})`);
      await closeAll();
    }
  }

  // ---------------------------------------------------------------- the big screen's frame rate with four panes
  if (only.has("tvperf")) {
    const profiles = [["card", {}], ["card, processor 4x slower", { cpu: 4 }], ["card, processor 4x slower, whole table", { cpu: 4, view: "table" }], ["software", { software: true }], ["software, whole table", { software: true, view: "table" }]].filter(([name]) => !opt("profile", "") || name === opt("profile", ""));
    for (const [name, prof] of profiles) {
      console.log(`---- tvperf: four players, the big screen at 1920 x 1080 (${name}); the phones are controllers only, so only the big screen draws`);
      const via = prof.software ? await launchBrowser({ software: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }) : browser;
      try {
        const scr = await open("screen", { width: 1920, height: 1080 }, { via });
        const pin = await startParty(scr, `&derby-tvview=${prof.view ?? "split"}`);
        const phones = [];
        for (const n of ["Ada", "Bo", "Cy", "Di"]) phones.push(await phone(n, pin, "&derby-short=1"));
        const code = await codeOf(pin);
        await vote(code, phones);
        for (const p of phones) {
          const f = await derby(p).catch(async (e) => { const v = (await inner(code)).view; await shot(p, `perf-fail-${p.name}`, "no race came up"); throw new Error(`${p.name}: no race (${v.phase}, ${JSON.stringify(v.vote)}): ${e.message}`); });
          await f.click("#bpad");
        }
        const sf = await derby(scr);
        if (prof.cpu) { const cdp = await scr.context().newCDPSession(scr); await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu }); }
        await sf.waitForFunction(() => window.__derby.race.t > 3, null, { timeout: 60000 });
        const m = await sf.evaluate(async () => {
          const gaps = [];
          window.__derby.stats.workMs = { n: 0, sum: 0, max: 0 }; // the page's own work each frame (the drawing calls included, not the card's)
          let last = performance.now();
          await new Promise((done) => { const end = last + 12000; const tick = (ts) => { gaps.push(ts - last); last = ts; if (ts < end) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
          gaps.shift();
          const s = [...gaps].sort((a, b) => a - b), q = (f) => +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(1);
          const d = window.__derby, a = d.app;
          const wk = d.stats.workMs;
          return { workAvg: +(wk.sum / Math.max(1, wk.n)).toFixed(1), workMax: +wk.max.toFixed(1), fps: +(1000 / (gaps.reduce((x, y) => x + y, 0) / gaps.length)).toFixed(1), median: q(0.5), p95: q(0.95), p99: q(0.99), over25: gaps.filter((g) => g > 25).length, frames: gaps.length, scale: a.scale, mode: a.mode, panes: a.split?.n, draws: d.stats.draws, triangles: d.stats.triangles, renderer: d.stats.renderer };
        });
        report["tvperf " + name] = m;
        console.log(`     ${JSON.stringify(m)}`);
        await shot(scr, `perf-${name.replace(/[^a-z0-9]+/gi, "-")}`, `the big screen measured (${name}): ${m.fps} frames a second, resolution scale ${m.scale}`);
        // A measurement only: the race is left (the other races check how one ends), and the party closed.
      } finally {
        await closeAll();
        if (via !== browser) await via.close().catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- steering at 40 and 200 ms each way
  if (only.has("lag")) {
    for (const lag of [40, 200]) {
      console.log(`---- lag ${lag}: one phone with ${lag} ms each way (the room's simulated latency)`);
      const { phones, scr } = await party(`lag ${lag}`, ["Ada"], { query: `&lag=${lag}` });
      const { end, last } = await race(`lag ${lag}`, null, [phones[0], scr]);
      if (end) {
        const s = last.get(phones[0]).stats;
        const avg = (t) => (t.n ? t.sum / t.n : 0);
        report["lag" + lag] = {
          ownAvg: +avg(s.ownErr).toFixed(4), ownMax: +s.ownErr.max.toFixed(3), rivalAvg: +avg(s.rivalErr).toFixed(4), rivalMax: +s.rivalErr.max.toFixed(3),
          compared: s.ownErr.n, sent: s.sent, late: s.late, lateSteps: s.lateSteps, predictMsAvg: +avg(s.predictMs).toFixed(3), predictMsMax: +s.predictMs.max.toFixed(2),
        };
        console.log(`     ${JSON.stringify(report["lag" + lag])}`);
      }
      await closeAll();
    }
  }
} finally {
  await browser.close().catch(() => {});
}
console.log("REPORT " + JSON.stringify(report));
if (errors.length) console.log("page errors:\n  " + [...new Set(errors)].slice(0, 20).join("\n  "));
check(errors.length === 0, `no page reported an error (${errors.length})`);
if (problems.length) {
  console.log(`\n${problems.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
