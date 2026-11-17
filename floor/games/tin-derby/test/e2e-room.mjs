// Tin Derby raced inside the real party room, end to end: a local Worker (workerd), the room's own pages, real
// browsers (headless, muted). Each race is voted for in the room, mounted on every phone and on the big screen,
// raced to the end by the phones themselves (each phone's page drives its own car with the house's driver, through
// the same path as a thumb: ?derby-auto=1), and handed back to the room's Tonight board.
//
//   node floor/games/tin-derby/test/e2e-room.mjs [--base=http://localhost:8791] [--only=solo,two,four,trouble,stalls,look,lag]
//     [--stills=/tmp/claude-tin-derby-room/stills]
//
// The races:
//   solo      one phone and a big screen
//   two       two phones and a big screen
//   four      four phones and a big screen
//   trouble   three phones: one drops its connection and comes back, one reloads, and the big screen joins late
//   stalls    four phones: one with no 3D (its car is the house's), one whose page loads late (the house drives it
//             from GO until it comes up), one whose connection stalls for 5 s without closing (the house's within
//             about a second, then its own again), and a keyboard player who switches tabs holding an arrow
//   look      the big screen at 1920 x 1080, an upright phone, a small one with reduced motion, and a phone whose
//             WebGL context is lost for good: sizes, overlaps, the strip's tokens, still words, the lost picture
//   lag       one phone with 40 ms, then 200 ms, of delay each way (the room's simulated latency): how far what the
//             phone showed was from what the room made of the same moment, and how many inputs came too late
// After every race: each page agreed with the room on the finishing order, no page's copy of the race differed from
// the room's at any snapshot, and the room took the game away again and showed its card.
import { mkdirSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { launchBrowser } from "../../../../lobby/test/browser.mjs";
import { partyApi, sleep } from "../../../../lobby/test/client.mjs";
import { boxCentre } from "../../../../lobby/shared/world.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const only = new Set(opt("only", "solo,two,four,trouble,stalls,look,lag").split(","));
const stills = opt("stills", "");
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

const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const contexts = new Set();
try {
  /** A page of its own (its own storage, so its own seat), with what it complained of kept, and the bytes its sockets received. */
  async function open(name, viewport, { via = browser, ...extra } = {}) {
    const context = await via.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    contexts.add(context);
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
    await page.screenshot({ path: `${resolve(stills)}/${name}.png`, timeout: 60000 }).catch((e) => console.log(`     (no still ${name}: ${e.message})`));
    console.log(`     still ${name}.png: ${caption}`);
  };

  async function screenPage(name = "screen") {
    const page = await open(name, { width: 1280, height: 720 });
    return page;
  }
  /** The room's code (for the debug door) from the pin people type. */
  const codeOf = async (pin) => (await partyApi(base).call("GET", "/join/" + pin)).preview.code;
  /** A party with a big screen: its pin. */
  async function startParty(screen) {
    await screen.goto(base + "/lobby/?start&look=flat");
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
    await screen.waitForSelector("svg.scene text");
    return (await screen.locator(".code-digits").textContent()).trim();
  }
  /** A big screen that comes to a party already going. */
  async function joinScreen(screen, pin) {
    await screen.goto(base + "/lobby/?join=" + pin + "&look=flat");
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
  }
  /** A phone held sideways that joins with a nickname. */
  async function phone(name, pin, query = "", { viewport = { width: 844, height: 390 }, context = { hasTouch: true, isMobile: true }, auto = true, at = base, before = null } = {}) {
    const page = await open(name, viewport, context);
    if (before) await before(page);
    await page.goto(at + "/lobby/?join=" + pin + "&look=flat" + (auto ? "&derby-auto=1" : "") + query);
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    await page.waitForSelector("svg.scene text");
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
  /** The game's frame on a room page, once the race page is running in it. */
  async function derby(page, timeout = 60000) {
    const handle = await page.waitForSelector(FRAME, { timeout });
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => window.__derby?.race, null, { timeout });
    return frame;
  }
  const look = (frame) =>
    frame.evaluate(() => {
      const d = window.__derby, r = d.race;
      const order = d.rules.raceOrder(r).filter((c) => !c.house).map((c) => ({ seat: c.seat, fin: c.fin, finT: c.finT, s: c.s }));
      return { t: r.t, n: r.n, over: r.over, car: d.car, order, cars: r.cars.map((c) => ({ seat: c.seat, house: c.house, auto: c.auto, character: c.character, name: c.name, fin: c.fin })), stats: JSON.parse(JSON.stringify(d.stats)), mode: document.getElementById("app").dataset.mode };
    });

  /**
   * Races one party to the end. `pages` are the room pages showing it (phones and screen), polled until the room
   * takes the game away; `during(t)` runs at race time t (seconds) for the trouble race. Returns the room's
   * `end` message and what each page last saw.
   */
  async function race(label, code, pages, { during = null, still = null } = {}) {
    const frames = new Map();
    for (const p of pages) frames.set(p, await derby(p));
    const last = new Map();
    let end = null, mid = false, countShot = false;
    const t0 = Date.now();
    const watched = pages.find((p) => p.name === "screen") ?? pages[0];
    while (!end && Date.now() - t0 < 200_000) {
      for (const p of [...frames.keys()]) {
        const f = frames.get(p);
        try { last.set(p, await look(f)); } catch { /* the frame was taken away, or is reloading */ }
      }
      const t = last.get(watched)?.t ?? -9;
      if (still && !countShot && t < 0) { countShot = true; await still("countdown", t); }
      if (still && !mid && t > 25) { mid = true; await still("mid-race", t); }
      if (during) await during(t, frames, last);
      if (still && [...last.values()].some((l) => l.order.some((o) => o.fin)) && !last.finShot) { last.finShot = true; await still("finish", t); }
      for (const p of pages) if (!end) end = endOf(p);
      await sleep(250);
    }
    check(!!end, `${label}: the race ended in the room within ${Math.round((Date.now() - t0) / 1000)} s`);
    if (!end) return { end, last };
    const roomOrder = end.result.map((r) => r.seat).join();
    for (const [p, l] of last) {
      const seen = l.order.map((o) => o.seat).join();
      check(seen === roomOrder, `${label}, ${p.name}: the page's finishing order (${seen}) is the room's (${roomOrder})`);
      check(l.stats.diverged === 0, `${label}, ${p.name}: its copy of the race matched the room's at every snapshot it could check (${l.stats.compared} checked, ${l.stats.diverged} differed, ${l.stats.gaps} gaps, ${l.stats.restarts} restarts, ${l.stats.full} full snapshots)`);
    }
    // Every page that showed the race, a big screen that joined late included.
    for (const p of frames.keys()) {
      await p.waitForFunction((sel) => !document.querySelector(sel), FRAME, { timeout: 15000 }).catch(() => {});
      const back = await p.evaluate((sel) => ({ frames: document.querySelectorAll(sel).length, card: !!document.querySelector(".card-back .card") }), FRAME);
      check(back.frames === 0 && back.card, `${label}, ${p.name}: the game is taken away and the room shows its result card`);
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
    check(l0.mode === "phone" && last.get(scr).mode === "tvwide" && l0.car >= 0, `${label}: each phone drives its own car from behind; the big screen shows the whole table`);
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
    const handed = [];
    const during = async (t, frames, last) => {
      if (!dropped && t > 8) {
        dropped = true;
        await bo.context().setOffline(true);
        console.log(`     Bo's phone loses its connection at race time ${t.toFixed(1)} s`);
      }
      if (dropped && !back && t > 16) {
        back = true;
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
      // From the drop on (a page that loaded slowly is driven by the house until its first word, before that).
      const hands = handed.filter((e) => e.c === boCar && e.n > (8 + 3) * 120).map((e) => e.on).join();
      check(hands === "1,0", `trouble: the room handed Bo's car to the house when his phone dropped and back when it returned (${hands || "nothing"})`);
      const boStats = last.get(bo).stats, cyStats = last.get(cy).stats;
      check(boStats.full >= 1 || boStats.restarts >= 1, `trouble: Bo's page started its copy again from the room's full snapshot after the drop (${boStats.full} full, ${boStats.restarts} restarts)`);
      check(last.get(cy).car >= 0 && cyStats.frames > 0, "trouble: Cy's page came back from the reload in the same car");
      check(!!late && last.get(late)?.mode === "tvwide", "trouble: the big screen that joined late shows the whole table");
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
  /** Seat by name, from a page's look: the car index. */
  const carOf = (l, name) => l.cars.findIndex((c) => c.name === name);

  // ---------------------------------------------------------------- phones that cannot drive, stall, load late, or switch tabs
  if (only.has("stalls")) {
    console.log("---- stalls: a phone with no 3D, a page that loads late, a phone that stalls for 5 s, a keyboard player who switches tabs");
    const scr = await screenPage();
    const pin = await startParty(scr);
    // A phone without 3D at all: WebGL off in its browser.
    const flat = await launchBrowser({ software: true, args: ["--disable-webgl", "--disable-3d-apis"] });
    try {
      const nogl = await phone("NoGL", pin, "", { auto: false, context: { hasTouch: true, isMobile: true, via: flat } });
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
      // The page with no 3D: it says so plainly and nothing else is on it.
      const nf = await (await nogl.waitForSelector(FRAME, { timeout: 60000 })).contentFrame();
      await nf.waitForFunction(() => window.__derby?.noPicture, null, { timeout: 60000 });
      const said = await nf.evaluate(() => ({ text: document.getElementById("nopic").innerText.replace(/\s+/g, " ").trim(), sound: !!document.getElementById("bsound").offsetParent, canvas: !!document.getElementById("gl").offsetParent }));
      check(said.text === "This phone can't show the race. The house is driving your car. Watch the big screen.", `stalls: the phone with no 3D says so plainly ("${said.text}")`);
      check(!said.sound && !said.canvas, "stalls: ... with no dead Sound on button and no picture");
      await shot(nogl, "no-3d-phone", "the phone with no 3D (844 x 390, WebGL off): the house drives its car");
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
      const { end, last } = await race("stalls", code, [scr, late, frozen, keys], { during });
      relay.close();
      if (end) {
        const l = last.get(scr), ev = roomEvents(scr), hand = (name) => ev.filter((e) => e.k === "a" && e.c === carOf(l, name));
        const rowOf = (name) => end.result.find((r) => r.seat === l.cars[carOf(l, name)].seat);
        // The phone with no 3D: the house's from the count-in, never handed back, and home with a time.
        const ng = hand("NoGL");
        check(ng.length === 1 && ng[0].on === 1 && ng[0].n <= GO + 4, `stalls: the room gave the no-3D phone's car to the house by GO (${JSON.stringify(ng.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
        check(typeof rowOf("NoGL")?.time === "number", `stalls: ... and the car finished (${JSON.stringify(rowOf("NoGL"))})`);
        // The late page: the house drove its car from GO until it came up, then handed it back; the page said the race was under way.
        const lt = hand("Late"), lateSaid = last.get(late)?.stats.lateWord;
        check(lt.length >= 2 && lt[0].on === 1 && Math.abs(lt[0].n - GO) <= 8 && lt[1].on === 0, `stalls: the late page's car was the house's from GO until the page came up (${JSON.stringify(lt.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
        check(typeof lateSaid === "number" && lateSaid > 0, `stalls: ... and the page said "Race under way" when it came up (race time ${lateSaid})`);
        // The stalled phone: the house's within about a second, its own again after, and home with a time.
        const st = hand("Stall").filter((e) => raceT(e.n) > frozeAt - 1);
        const onT = st[0] && raceT(st[0].n);
        check(st.length >= 2 && st[0].on === 1 && onT - frozeAt < 1.6 && st[1].on === 0, `stalls: the stalled phone's car was the house's ${onT !== undefined ? (onT - frozeAt).toFixed(2) : "?"} s after the stall began (race time ${frozeAt?.toFixed(1)}), and handed back at ${st[1] ? raceT(st[1].n).toFixed(1) : "never"} (${JSON.stringify(st.map((e) => [e.on, +raceT(e.n).toFixed(2)]))})`);
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
    const pin = await startParty(scr);
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
    let lostAt = null, lostSays = null, lostGaveUp = null, overlaps = 0, samples = 0;
    const layout = { up: null, tv: null };
    const during = async (t, frames, last) => {
      if (lostAt === null && t > 10) {
        lostAt = t;
        await frames.get(lost).evaluate(() => window.__derby.app.world.renderer.getContext().getExtension("WEBGL_lose_context").loseContext());
        console.log(`     Lost's picture is taken away at race time ${t.toFixed(1)} s`);
      }
      if (lostAt !== null && lostSays === null && frames.has(lost)) {
        // The page waits 1.5 s for the context to come back (longer here: a page drawing in software is slow to hear it).
        const says = await frames.get(lost).evaluate(() => (window.__derby.noPicture ? document.getElementById("nopic").innerText.replace(/\s+/g, " ").trim() : null)).catch(() => null);
        if (says !== null || t > lostAt + 15) {
          lostSays = says ?? "";
          lostGaveUp = t;
          // It shows the race no more: its copy is not compared with the room's at the end.
          frames.delete(lost);
          last.delete(lost);
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
      if (t > 6 && !layout.up) {
        layout.up = await frames.get(up).evaluate(() => [...document.querySelectorAll(".topmid .strip, .topmid .near span")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { k: e.className || e.textContent.slice(0, 12), l: Math.round(r.left), r: Math.round(r.right) }; }));
        layout.tv = await frames.get(scr).evaluate(() => { const g = document.querySelector(".tag:not([hidden])"); return { h: innerHeight, tag: g ? parseFloat(getComputedStyle(g).fontSize) : 0, hint: parseFloat(getComputedStyle(document.getElementById("hint")).fontSize) }; });
      }
    };
    let finTok = null;
    const still = async (when, t) => {
      if (when === "mid-race") { await shot(scr, "screen-1920-mid-race", `the big screen (1920 x 1080) at race time ${t.toFixed(1)} s`); await shot(up, "upright-phone", `the upright phone (390 x 844) at race time ${t.toFixed(1)} s`); await shot(small, "small-phone", `the small phone (568 x 320, reduced motion) at race time ${t.toFixed(1)} s`); }
      if (when === "finish") {
        await sleep(1500);
        await shot(scr, "screen-1920-finish", `the big screen (1920 x 1080) as the first car finishes, race time ${t.toFixed(1)} s`);
        finTok = await (await scr.$(FRAME)).contentFrame().then((f) => f.evaluate(() => { const line = document.getElementById("tvline").getBoundingClientRect(), places = document.getElementById("tvplaces").getBoundingClientRect(); return { line: line.right, places: places.left, toks: [...document.querySelectorAll("#tvline .tok")].map((e) => e.getBoundingClientRect().right) }; }));
      }
    };
    const { end, last } = await race("look", code, [scr, up, small, lost], { during, still });
    if (end) {
      check(layout.up && layout.up.every((b) => b.l >= 0 && b.r <= 390), `look: the upright phone's strip and chips fit its 390 px (${JSON.stringify(layout.up)})`);
      check(overlaps === 0, `look: on the small phone no rival's name covered the strip or chips (${samples} frames sampled, ${overlaps} overlaps)`);
      check(layout.tv && layout.tv.tag >= 0.02 * layout.tv.h && layout.tv.hint >= 0.02 * layout.tv.h, `look: the big screen's names and hint are at least 2% of its height (${JSON.stringify(layout.tv)})`);
      check(finTok && finTok.toks.every((r) => r <= finTok.line + 1) && finTok.places >= finTok.line, `look: on the big screen's strip every token stays on its line, clear of the places (${JSON.stringify(finTok)})`);
      const l = last.get(scr), lc = carOf(l, "Lost"), ev = roomEvents(scr).filter((e) => e.k === "a" && e.c === lc);
      check(lostSays === "This phone can't show the race. The house is driving your car. Watch the big screen.", `look: the phone whose picture was lost says so plainly, ${lostGaveUp !== null ? (lostGaveUp - lostAt).toFixed(1) : "?"} s after ("${lostSays}")`);
      // The house has it for good once the page gives up (before that, a page stuck drawing in software may go quiet for a second and be handed over and back).
      const final = ev[ev.length - 1];
      check(ev.length >= 1 && final.on === 1 && raceT(final.n) - lostAt < 8, `look: a phone whose picture was lost for good gave its car to the house (${JSON.stringify(ev.map((e) => [e.on, +raceT(e.n).toFixed(2)]))}, lost at ${lostAt?.toFixed(1)})`);
      const row = end.result.find((r) => r.seat === l.cars[lc].seat);
      check(typeof row?.time === "number", `look: ... and its car finished (${JSON.stringify(row)})`);
    }
    await closeAll();
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
