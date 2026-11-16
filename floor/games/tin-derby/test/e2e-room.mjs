// Tin Derby raced inside the real party room, end to end: a local Worker (workerd), the room's own pages, real
// browsers (headless, muted). Each race is voted for in the room, mounted on every phone and on the big screen,
// raced to the end by the phones themselves (each phone's page drives its own car with the house's driver, through
// the same path as a thumb: ?derby-auto=1), and handed back to the room's Tonight board.
//
//   node floor/games/tin-derby/test/e2e-room.mjs [--base=http://localhost:8791] [--only=solo,two,four,trouble,lag]
//     [--stills=/tmp/claude-tin-derby-room/stills]
//
// The races:
//   solo      one phone and a big screen
//   two       two phones and a big screen
//   four      four phones and a big screen
//   trouble   three phones: one drops its connection and comes back, one reloads, and the big screen joins late
//   lag       one phone with 40 ms, then 200 ms, of delay each way (the room's simulated latency): how far what the
//             phone showed was from what the room made of the same moment, and how many inputs came too late
// After every race: each page agreed with the room on the finishing order, no page's copy of the race differed from
// the room's at any snapshot, and the room took the game away again and showed its card.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser } from "../../../../lobby/test/browser.mjs";
import { partyApi, sleep } from "../../../../lobby/test/client.mjs";
import { boxCentre } from "../../../../lobby/shared/world.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const only = new Set(opt("only", "solo,two,four,trouble,lag").split(","));
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

const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const contexts = new Set();
try {
  /** A page of its own (its own storage, so its own seat), with what it complained of kept, and the bytes its sockets received. */
  async function open(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    contexts.add(context);
    const page = await context.newPage();
    page.name = name;
    page.down = [];
    page.on("websocket", (ws) => ws.on("framereceived", (f) => page.down.push([Date.now(), typeof f.payload === "string" ? Buffer.byteLength(f.payload) : f.payload.length, typeof f.payload === "string" ? f.payload : ""])));
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_|net::/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
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
  async function phone(name, pin, query = "") {
    const page = await open(name, { width: 844, height: 390 }, { hasTouch: true, isMobile: true });
    await page.goto(base + "/lobby/?join=" + pin + "&look=flat&derby-auto=1" + query);
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
      const hands = handed.filter((e) => e.c === boCar).map((e) => e.on).join();
      check(hands === "1,0", `trouble: the room handed Bo's car to the house when his phone dropped and back when it returned (${hands || "nothing"})`);
      const boStats = last.get(bo).stats, cyStats = last.get(cy).stats;
      check(boStats.full >= 1 || boStats.restarts >= 1, `trouble: Bo's page started its copy again from the room's full snapshot after the drop (${boStats.full} full, ${boStats.restarts} restarts)`);
      check(last.get(cy).car >= 0 && cyStats.frames > 0, "trouble: Cy's page came back from the reload in the same car");
      check(!!late && last.get(late)?.mode === "tvwide", "trouble: the big screen that joined late shows the whole table");
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
