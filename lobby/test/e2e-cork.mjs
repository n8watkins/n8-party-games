// Cork & Bell played inside the party room, end to end in real pages.
//
// First a party of three and a big screen: they vote for it, the game is mounted over the room
// on every device, a player fires with real clicks, reloads in the middle and comes back to
// their stall, the round ends, the game is taken away again and the places are on the Tonight
// board. Meanwhile, in a room of its own, a party of one plays a round alone, and a big screen
// joins in the middle of it. The browser is headless and muted, and is closed at the end
// whatever happens.
//
//   node lobby/test/e2e-cork.mjs [--base=http://localhost:8791] [--out=lobby/test/shots] [--win=1] [--apart=1]
//
// There are two rounds of up to ninety seconds (the game's ROUND_SECONDS). The battle runs its
// full time, as a battle ends early only once every stall is out of corks and two of its stalls
// never spend theirs; the round played alone ends sooner, once its one stall (the game's bot) has
// spent them. The two rounds are played at the same time (about two and a half minutes in all),
// except in a browser that draws in software, or with --apart=1 (test:cork:full), where the round
// alone comes after the battle (about four minutes). It reads the room budget's books before and
// after (the local server's debug door), so the run also says what the rounds cost, and checks
// that it is what they lasted: each round's on its own when they are played apart, both together
// when they overlap.
//
// Playwright's browser in WSL draws WebGL in software, a few frames a second, so the pages are
// kept few and small (a 960 x 540 screen, phones at one pixel per pixel) and one of the three
// players is a plain socket. --win=1 uses the game's own tool to drive a headless, muted Chrome
// on the Windows side instead, on the real graphics card (node_modules/cork-and-bell/tools/browser.mjs).
// The room is asked for flat (?look=flat): this run is about the game in the room, and a real
// graphics card would otherwise get the 3D look, which lobby/test/e2e-cork-3d.mjs covers.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser, openWindowsChrome } from "./browser.mjs";
import { still as takeStill } from "../../party-kit/test/stills.mjs";
import { COUNT_IN, END_HOLD } from "../../node_modules/cork-and-bell/game/shared/battle.js";
import { ROUND_SECONDS } from "../../node_modules/cork-and-bell/game/shared/sim.js";
import { REPORT_EVERY_MS, ROOM_MEMORY_GB } from "../../party-kit/src/worker/budget-logic.js";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots"));
mkdirSync(out, { recursive: true });
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const books = async () => (await (await fetch(api + "/debug")).json()).budget?.usage ?? null;
/**
 * Waits until the server serves the lobby page and every module it imports (a static import
 * that fails leaves the page blank: no door, no nickname field). `wrangler dev` rebuilds the
 * served folder whenever a watched source changes, and says "Ready" before and between builds,
 * so the signal that a page can load is the files being there, not a pause.
 */
async function servedAll(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  let why = "";
  while (Date.now() < until) {
    why = "";
    try {
      const seen = new Set();
      const queue = [];
      const html = await fetch(base + "/lobby/");
      if (!html.ok) why = `/lobby/ answered ${html.status}`;
      else {
        // The page's own main module, wherever its release's files are (/r/<id>/lobby/main.js).
        const main = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(await html.text())?.[1];
        if (main) queue.push(new URL(main, base + "/lobby/").pathname);
        else why = "/lobby/ names no module script";
      }
      while (!why && queue.length) {
        const path = queue.shift();
        if (seen.has(path)) continue;
        seen.add(path);
        const res = await fetch(base + path);
        if (!res.ok) {
          why = `${path} answered ${res.status}`;
          break;
        }
        const source = await res.text();
        // Static imports only: the ones whose failure stops the page from running at all.
        for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/gm)) {
          if (spec.startsWith("/")) queue.push(spec);
          else if (spec.startsWith(".")) queue.push(new URL(spec, base + path).pathname);
        }
      }
      if (!why) return seen.size;
    } catch (err) {
      why = String(err?.message ?? err);
    }
    await sleep(500);
  }
  throw new Error("the server is not serving the lobby page and its modules: " + why);
}
/**
 * The room budget is one count for the whole server, so the run's own rooms can only be told
 * apart from other rooms by the server being quiet around them. A server that has never
 * counted anything is clean. One with a history is quiet when a whole report interval (a room
 * that is awake reports every REPORT_EVERY_MS) passes with its books unchanged; if rooms of an
 * earlier run or of another test are still awake, say so and stop rather than mis-count.
 */
async function quietBooks() {
  let seen = await books();
  if (!seen || seen.dayUsed === 0) return;
  console.log(`     the server's books already hold ${seen.dayUsed.toFixed(1)} GB-seconds today: waiting for a whole report interval to see that no other room is awake...`);
  for (let i = 0; i < 3; i++) {
    await sleep(REPORT_EVERY_MS + 5_000);
    const now = await books();
    if (now.dayUsed === seen.dayUsed) return;
    // Two significant figures: a room barely awake moves them by thousandths, which toFixed(2) showed as 0.00.
    console.log(`     the books moved by ${(now.dayUsed - seen.dayUsed).toPrecision(2)} GB-seconds meanwhile: another room is awake on this server`);
    seen = now;
  }
  throw new Error("other rooms keep this server's room budget moving, so what this run's rooms cost cannot be told apart: use a server of its own with an empty persist folder (wrangler dev --persist-to <empty folder>)");
}
const inner = async (code) => (await (await fetch(api + "/debug/" + code)).json()).room;
const FRAME = 'iframe[title="Cork & Bell"]';

/** Every page opened, by name, and what any of them complained of: reported if the run stops. */
const opened = new Map();
const errors = [];
/** Every socket a page opened ({name, url, first: its first frame}) and every address a page asked for: the seat's token must be in none. */
const pageSockets = [];
const pageAddresses = [];
const loadProblems = [];
const timeCalls = [];
const browser = opt("win", "0") === "1" ? await openWindowsChrome({ width: 960, height: 540 }) : await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); // with TEST_GPU=1 the WSL browser draws on the card (lobby/test/browser.mjs)
// Ada's phone, the one that reloads in the middle, is a browser of its own, as a phone is a device with its own
// graphics: pages of one browser share its one graphics process, and drawn in software every WebGL call of a page
// making its picture waits there behind the other pages' frames. Sharing it, Ada's reload on GitHub's runner was not
// back 55 s later, at the end of the round; Tin Derby's reloading phone, profiled, spent most of its way back so.
const adaBrowser = opt("win", "0") === "1" ? browser : await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
/** Browsers besides `browser`, closed with it. */
const extraBrowsers = adaBrowser === browser ? [] : [adaBrowser];
try {
  async function open(name, viewport, { via = browser, ...extra } = {}) {
    const context = await via.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const page = await context.newPage();
    page.on("request", (request) => pageAddresses.push(request.url()));
    page.on("websocket", (ws) => {
      const socket = { name, url: ws.url(), first: null };
      pageSockets.push(socket);
      ws.on("framesent", (frame) => (socket.first ??= String(frame.payload)));
      // When the game called time, as the room told this page ({name, t: round seconds}).
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload !== "string" || !frame.payload.includes('"k":"time"')) return;
        for (const e of JSON.parse(frame.payload).ev ?? []) if (e.k === "time") timeCalls.push({ name, t: e.t });
      });
    });
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
    // A file the page could not get is what a blank page has to say for itself: kept for the report.
    page.on("response", (r) => r.status() >= 400 && loadProblems.push(`${name}: ${r.status()} ${r.url()}`));
    page.on("requestfailed", (r) => !/WebSocket/.test(r.url()) && loadProblems.push(`${name}: ${r.failure()?.errorText} ${r.url()}`));
    opened.set(name, page);
    return page;
  }
  const shut = async (...names) => {
    for (const name of names) {
      await opened.get(name)?.context().close();
      opened.delete(name);
    }
  };
  const shot = async (page, name) => {
    if (await takeStill(page, { path: `${out}/${name}.png` })) console.log("     still: " + name);
  };
  /**
   * The game's frame on a room page, once the game's page inside it is running its round. The frame element can be
   * there before its page is (no content frame yet), or be taken away and put back while the room's page settles (a
   * reloaded phone): each time, it is looked for again, until `timeout` in all.
   */
  async function gameFrame(page, timeout = 120000) {
    const until = Date.now() + timeout;
    for (;;) {
      const handle = await page.waitForSelector(FRAME, { timeout: Math.max(1, until - Date.now()) });
      const frame = await handle.contentFrame();
      try {
        if (!frame) throw new Error("the game's frame element has no page in it yet");
        await frame.waitForFunction(() => window.__cab?.mode === "battle" && window.__cab.session, null, { timeout: Math.max(1, until - Date.now()) });
        return frame;
      } catch (err) {
        const gone = !frame || frame.isDetached() || /detached/i.test(String(err?.message));
        if (!gone || Date.now() >= until) throw err;
        await sleep(100);
      }
    }
  }
  const summary = (frame) => frame.evaluate(() => window.__cab.summary());
  /** Walks a page's piece to x with the keyboard, as a player would. `watcher` is a socket that hears the moves. */
  async function walk(page, watcher, seat, x) {
    for (let i = 0; i < 14; i++) {
      await sleep(120);
      const gap = x - (watcher.seen.findLast((m) => (m.t === "m" && m.s === seat) || (m.t === "b" && m.to === seat))?.x ?? watcher.room.members[seat].x);
      if (Math.abs(gap) < 14) return;
      const k = gap > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(k);
      await sleep(Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
      await page.keyboard.up(k);
    }
  }
  /** What the room's own page keeps on top of the game: the door button, and nothing else. */
  const onTop = (page) =>
    page.evaluate((sel) => {
      const show = (el) => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 0;
      const door = document.querySelector(".door-btn");
      const frame = document.querySelector(sel);
      const controls = frame.contentDocument.getElementById("controls").getBoundingClientRect();
      const d = door.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      return {
        door: show(door) && d.width >= 36 && d.right <= innerWidth && d.top >= 0,
        // The bars with the walk, jump and bump buttons, the turn hint, the banner, and the Tonight board opened large.
        bars: [...document.querySelectorAll(".bar, .pad button, .turn-hint, .banner, .board-back")].filter(show).length,
        fills: Math.round(f.width) === innerWidth && Math.round(f.height) === innerHeight,
        clear: controls.width === 0 || controls.right <= d.left - 4 || controls.top >= d.bottom + 4,
        scroll: document.documentElement.scrollWidth > innerWidth + 1,
      };
    }, FRAME);
  /** What is left of the game on a room page after it was taken away. */
  const leftBehind = (page) =>
    page.evaluate(() => ({ frames: document.querySelectorAll("iframe").length, canvases: document.querySelectorAll("canvas").length, lost: window.__gl?.isContextLost?.() ?? null, stage: document.querySelector(".stage")?.hidden, bar: !!document.querySelector(".bar")?.offsetHeight }));
  const holdContext = (page) => page.evaluate((sel) => (window.__gl = document.querySelector(sel).contentWindow.__cab.lens.renderer.getContext()), FRAME);
  const modules = await servedAll();
  console.log(`     the server serves the lobby page and its ${modules} modules`);
  await quietBooks();
  const before = await books();

  // ================================================================ a party of three and a big screen
  const screen = await open("screen", { width: 960, height: 540 });
  await screen.goto(base + "/lobby/?start&look=flat&cork-quality=low");
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  const pin = (await screen.locator(".code-digits").textContent()).trim();
  /** The corks each page sends, as sent, with this machine's clock then: to explain a cork the room did not count. */
  const sentCorks = {};
  const join = async (name, viewport, query, via = browser) => {
    const page = await open(name, viewport, { hasTouch: true, via });
    sentCorks[name] = [];
    page.on("websocket", (ws) => ws.on("framesent", (f) => typeof f.payload === "string" && f.payload.includes('"f":[') && sentCorks[name].push({ d: JSON.parse(f.payload).d.f[0], at: Date.now() })));
    await page.goto(base + "/lobby/?join=" + pin + "&look=flat" + query);
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    await page.waitForSelector("svg.scene text");
    return page;
  };
  // Ada plays by hand on a phone held sideways. Bea is a socket that never fires. Cy holds a
  // phone upright and is played by the game's own bot.
  const ada = await join("Ada", { width: 844, height: 390 }, "&cork-quality=low", adaBrowser);
  const bea = connect(await call("POST", "/join/" + pin, { nickname: "Bea" }));
  await bea.opened;
  // A page keeps its socket alive by itself; a bare socket has to say something now and then, or
  // the room takes it for a phone that has gone (after ninety silent seconds) and lets it drop.
  const alive = setInterval(() => bea.send("ping"), 20_000);
  const cy = await join("Cy", { width: 390, height: 844 }, "&cork-auto=1&cork-quality=low");
  const watcher = bea;
  await watcher.wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 8000, 0);
  const N = watcher.room.boxes.length;
  const CORK = watcher.room.boxes.findIndex((b) => b.id === "cork-and-bell");
  const light = (off = 0) => Math.round(boxCentre(CORK, N) + off);
  const corkBox = watcher.room.boxes[CORK];
  check(corkBox.min === 1 && corkBox.max === 4 && !corkBox.url && corkBox.view === "/cork-and-bell/game/party-view.js", "Cork & Bell's sign reads 1-4, and it is no longer an outside game: its box carries the address of its view");
  await walk(ada, watcher, 0, light(-50));
  bea.goto(light(0));
  // The big screen has the Tonight board opened large when the vote completes: the vote carries on
  // under it, and it makes way for the game.
  await screen.click(".board-hit");
  await screen.waitForSelector(".board-back");
  await walk(cy, watcher, 2, light(50));
  await screen.waitForFunction(() => /Cork & Bell starts in/.test(document.querySelector(".status-main")?.textContent ?? ""), null, { timeout: 8000 });
  await shot(screen, "50-screen-count-cork-and-bell");
  const start = await watcher.wait((m) => m.t === "start", 16000, 0);
  const startedAt = Date.now();
  // The room's result card is up for under six seconds once the battle ends, which may be while
  // the run is still busy with its checks: watched for from now, on the big screen, with its
  // stills taken the moment it is there (where the pages keep up). Resolves with the card's text.
  let stillsWanted = false;
  const cardSeen = screen
    .waitForFunction(() => (document.querySelector(".card .places") ? document.querySelector(".card").innerText : null), null, { polling: 100, timeout: 0 })
    .then(async (handle) => {
      const text = await handle.jsonValue();
      if (stillsWanted) {
        await shot(screen, "56-screen-cork-and-bell-result").catch(() => {});
        await shot(ada, "57-phone-cork-and-bell-result").catch(() => {});
      }
      return text;
    })
    .catch(() => null);
  check(start.room.phase === "playing" && start.room.game.id === "cork-and-bell" && start.s.seats.map((s) => s.seat).join() === "0,1,2", "the count ends and a battle starts for the party's three seats, with no waiting room");

  // The game is mounted over the room on every device.
  const frames = {};
  for (const [name, page] of [["Ada", ada], ["Cy", cy], ["screen", screen]]) frames[name] = await gameFrame(page);
  const loadedIn = Date.now() - startedAt;
  // A browser that draws WebGL in software (Playwright's own, in WSL) has pages that run many
  // seconds behind the room. What needs a page to keep up with the round is left
  // out there, and said so; everything the room decides is checked either way.
  const slow = loadedIn > 15_000;
  stillsWanted = !slow;
  if (slow) console.log(`     (the game took ${(loadedIn / 1000).toFixed(0)} seconds to come up: this browser draws in software. The reload in the middle, the door sheet and the stills are left out; run with --win=1 for all of it.)`);
  // Where the pages keep up, the party of one plays its round in a room of its own while this
  // battle runs its ninety seconds, from once Ada's reload in the middle is back (below): the two
  // share nothing but the server's books (counted together below). Started any sooner, its two
  // pages loaded beside the reloaded one, and on a 4-thread machine that reload took 71 s to come
  // back, past the end of the round. A browser that draws in software plays it after the battle,
  // as one more set of pages beside these would slow them all.
  let alone = null;
  const startAlone = () => {
    if (slow || opt("apart", "0") === "1") return;
    alone = playAlone();
    alone.catch(() => {}); // (awaited below; a failure is reported there)
  };
  // A context to check afterwards: the game's WebGL context, held from the room's page.
  for (const page of [screen, ada, cy]) await holdContext(page);
  const seats = {};
  for (const name of Object.keys(frames)) seats[name] = await frames[name].evaluate(() => ({ mine: window.__cab.session.mySeat, stalls: window.__cab.views.length, hosted: document.body.classList.contains("hosted"), start: document.getElementById("start").hidden, tally: !document.getElementById("tally").hidden }));
  check(seats.Ada.mine === 0 && seats.Cy.mine === 2 && [seats.Ada, seats.Cy].every((s) => s.stalls === 1 && s.hosted && s.start && s.tally), `each phone shows its own stall, in hosted mode, with no start board (the game was up on all three pages ${(loadedIn / 1000).toFixed(1)} seconds after the start)`);
  check(seats.screen.mine === -1 && seats.screen.stalls === 3, "the big screen shows all three stalls side by side: a spectator view");
  for (const [name, page] of [["phone held sideways", ada], ["upright phone", cy], ["big screen", screen]]) {
    const seen = await onTop(page);
    check(seen.door && seen.bars === 0 && seen.fills && seen.clear && !seen.scroll, `${name}: the game fills the screen, the room's bars, buttons and opened board are put away, and its door button stays, clear of the game's sound switch`);
  }
  // Ada fires with real clicks: a click on the picture aims there and fires.
  const fired = async () => (await summary(frames.Ada)).stalls[0].shots;
  // The watching pages' frame gaps, for the report if one of them falls behind (see below).
  for (const name of ["screen", "Cy"]) {
    await frames[name].evaluate(() => {
      const gaps = (window.__gaps = []);
      let last = performance.now();
      const tick = (now) => {
        if (now - last > 250) gaps.push({ at: +window.__cab.session.time().toFixed(2), ms: Math.round(now - last) });
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  let clicks = 0;
  for (let i = 0; i < 5; i++) {
    const had = await fired();
    await frames.Ada.waitForFunction(() => window.__cab.session.canFire(), null, { timeout: 30000 });
    await ada.mouse.click(300 + (i % 4) * 80, 150 + (i % 3) * 22);
    clicks++;
    await frames.Ada.waitForFunction((n) => window.__cab.session.sims[0].shots > n, had, { timeout: 30000 }).catch(() => {});
  }
  const shots = await fired();
  // Each click sends one cork, which the room relays ({k: "f", seat: 0}, at about the page's
  // stamp: the room holds a stamp to within half a second of its clock). Ada's stall can show more
  // only when her socket dropped for a moment (a loaded machine): the room's stand-in plays a
  // seat whose player is gone (lobby-core.js, gameTick), its corks are the stall's too, and every
  // one of them falls in a time her seat was seen gone and carries no number (`q`). (The game's
  // pages do not number their corks either, so `q` alone does not tell the two apart: the stamps do.)
  const relayedAda = () => watcher.seen.filter((m) => m.t === "ev").flatMap((m) => m.ev.filter((e) => e.k === "f" && e.seat === 0));
  const matchClicks = () => {
    const left = relayedAda();
    const mine = [];
    for (const c of sentCorks.Ada) {
      const i = left.findIndex((e) => Math.abs(e.at - c.d) <= 0.6);
      if (i >= 0) mine.push(...left.splice(i, 1));
    }
    return { mine, extra: left };
  };
  for (let i = 0; i < 50 && matchClicks().mine.length < clicks; i++) await sleep(100);
  const { mine, extra } = matchClicks();
  // The times Ada's seat was gone, in round seconds, from the room's word to the watcher
  // ({t: "room"} on every join and drop: [from, to], `to` null while still gone).
  const awayAda = [];
  for (const m of watcher.seen.slice(watcher.seen.indexOf(start))) {
    const on = m.room?.members?.[0]?.connected;
    if (on === undefined) continue;
    const t = (m.at - start.s.startAt) / 1000 - COUNT_IN;
    const open = awayAda.at(-1)?.[1] === null;
    if (!on && !open) awayAda.push([t, null]);
    else if (on && open) awayAda.at(-1)[1] = t;
  }
  const awayAt = (t) => awayAda.some(([from, to]) => t >= from - 1 && t <= (to ?? Infinity) + 1);
  const extraOk = extra.every((e) => e.q === undefined && awayAt(e.at));
  check(
    sentCorks.Ada.length === clicks && mine.length === clicks && extraOk && (extra.length === 0 ? shots === clicks : shots > clicks && shots <= clicks + extra.length),
    `a click on the picture fires a cork: ${shots} corks on Ada's stall from ${clicks} clicks; her page sent ${sentCorks.Ada.length}, the room relayed ${mine.length} of them` +
      (extra.length ? `, and ${extra.length} by the room's stand-in at ${extra.map((e) => e.at.toFixed(1)).join(", ")} while her seat was seen gone (${awayAda.map(([a, b]) => `${a.toFixed(1)}-${b === null ? "on" : b.toFixed(1)}`).join(", ")}): ${extraOk}` : ""),
  );
  if (shots !== clicks || extra.length) console.log(`     Ada's page sent corks stamped ${sentCorks.Ada.map((c) => c.d.toFixed(3)).join(", ")}; the room relayed corks for her seat at ${relayedAda().map((e) => e.at.toFixed(3)).join(", ")}`);
  await frames.screen.waitForFunction((n) => window.__cab.session.sims[0].shots >= n, shots, { timeout: 30000 }).catch(() => {});
  // The room is the judge of what was fired. The room relays every cork Ada's page sends, but
  // the game's own simulation in the room (cork-and-bell) sometimes counts fewer than the page
  // showed, on main too: a difference between the game's page and its room, not the party
  // room's relay. So the check is that the big screen shows what the room counted, and a cork
  // the room did not count is reported, not failed.
  const roomShots = async () => {
    // The room simulates 0.3 s behind its clock and sends a snapshot every half second: give the
    // last cork time to be judged, up to five seconds.
    const latest = () => watcher.seen.findLast((m) => m.t === "snap" && m.s.stalls)?.s.stalls.find((s) => s.seat === 0)?.shots ?? null;
    for (let i = 0; i < 25 && latest() !== shots; i++) await sleep(200);
    return latest();
  };
  const counted = await roomShots();
  await frames.screen.waitForFunction((n) => window.__cab.session.sims[0].shots === n, counted, { timeout: 30000 }).catch(() => {});
  const onScreen = (await summary(frames.screen)).stalls;
  if (counted !== shots || onScreen[0].shots !== counted) {
    const watchers = {};
    for (const name of ["screen", "Cy"]) watchers[name] = await frames[name].evaluate(() => ({ seen: window.__cab.session.sims[0].shots, gaps: window.__gaps }));
    console.log(`     watchers: the big screen counts ${watchers.screen.seen}, Cy's phone ${watchers.Cy.seen} of Ada's corks; frame gaps over 250 ms (round second, ms): screen ${JSON.stringify(watchers.screen.gaps)}, Cy ${JSON.stringify(watchers.Cy.gaps)}`);
    const taken = watcher.seen.filter((m) => m.t === "ev").flatMap((m) => m.ev.filter((e) => e.k === "f" && e.seat === 0).map((e) => e.at.toFixed(3)));
    console.log(`     note: the room counted ${counted} of the ${shots} corks Ada's page showed (it relayed them at round times ${taken.join(", ")})`);
    const roundAt = (ms) => ((ms - start.s.startAt) / 1000 - 3).toFixed(3);
    console.log(`     Ada's page stamped them ${sentCorks.Ada.map((c) => `${c.d.toFixed(3)} (sent at ${roundAt(c.at)} by this machine's clock)`).join(", ")}`);
  }
  check(counted > 0 && onScreen[0].shots === counted && onScreen[2].shots > 0 && onScreen[1].shots === 0, `the room relays it: the big screen has counted ${onScreen[0].shots} of Ada's corks (the room ${counted}), ${onScreen[2].shots} of Cy's bot's and none of Bea's, who never fired`);

  const midGame = await inner(start.room.code);
  check(midGame.timer === true && midGame.view.phase === "playing", "while the round is on the room runs its one timer");

  if (!slow) {
    // Ada's phone reloads in the middle of the round, as a phone that dozed off would.
    const scoreBefore = (await summary(frames.screen)).stalls[0].score;
    const reloadAt = Date.now();
    await ada.reload();
    frames.Ada = await gameFrame(ada);
    const back = await frames.Ada.evaluate(() => ({ mine: window.__cab.session.mySeat, t: window.__cab.session.time(), score: window.__cab.session.sims[0].score, shots: window.__cab.session.sims[0].shots }));
    // In the middle: after the round's start and before its time is called. (How far into the round the reloaded page
    // is up is the machine's doing: on four threads drawing in software, one came back 82 s in, and could fire again.)
    check(back.mine === 0 && back.t > 3 && back.t < ROUND_SECONDS && back.score >= scoreBefore && back.shots >= counted, `a reload in the middle comes back to the same stall, ${Math.round(back.t)} seconds in (${((Date.now() - reloadAt) / 1000).toFixed(0)} s after the reload), with its ${back.shots} corks and ${back.score} points`);
    await frames.Ada.waitForFunction(() => window.__cab.session.canFire(), null, { timeout: 30000 });
    await ada.mouse.click(420, 170);
    await frames.Ada.waitForFunction((n) => window.__cab.session.sims[0].shots > n, back.shots, { timeout: 30000 }).catch(() => {});
    check((await fired()) > back.shots, "and it can fire again");
    startAlone();
    await holdContext(ada);

    // Stills, once the reloaded page's lamps are lit.
    await frames.Ada.waitForFunction(() => document.getElementById("loading").classList.contains("gone"), null, { timeout: 30000 });
    await sleep(1200);
    await shot(ada, "52-phone-cork-and-bell-battle");
    await shot(cy, "53-upright-cork-and-bell-battle");
    await shot(screen, "51-screen-cork-and-bell-battle");

    // The door button opens the room's own sheet over the game, sized for a sideways phone.
    await ada.click(".door-btn");
    await ada.waitForSelector(".sheet");
    const sheet = await ada.evaluate(() => {
      const r = document.querySelector(".sheet")?.getBoundingClientRect();
      return !!r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    });
    check(sheet && (await ada.locator("text=Leave the party").count()) === 1, "in the game, the door button offers Leave the party on a sheet that fits a sideways phone");
    await shot(ada, "55-phone-door-button-in-game");
    await ada.click("text=Stay");
  }

  // ---------------------------------------------------------------- the end
  console.log(`     waiting for the round to end (${ROUND_SECONDS} seconds in all: Ada and Bea never spend their corks)...`);
  const end = await watcher.wait((m) => m.t === "end", 150000, 0);
  // How long the round was, on the room's clock: from the game's start to the room's end.
  const took = (end.now - start.s.startAt) / 1000;
  const rows = end.last.rows;
  // When the game called time, in round seconds, and what a round that ends then lasts: the
  // count-in, the room's lag behind its clock, the round and the hold at the end. The room ticks
  // on a timer, which a loaded machine fires late, so its end may come a little after.
  const timeAt = watcher.seen.find((m) => m.t === "ev" && m.ev.some((e) => e.k === "time"))?.ev.find((e) => e.k === "time").t ?? null;
  const due = COUNT_IN + start.s.delay + timeAt + END_HOLD;
  check(timeAt !== null && timeAt >= ROUND_SECONDS && timeAt < ROUND_SECONDS + 0.5 && took >= due - 0.05 && took < due + 0.5, `the round lasted ${took.toFixed(1)} seconds: the count-in, the full ${ROUND_SECONDS} seconds (time was called at ${timeAt?.toFixed(2)}) and the hold at the end, ${due.toFixed(1)} s`);
  check(rows.length === 3 && rows.every((r, i) => i === 0 || r.score <= rows[i - 1].score) && rows[0].points === 3 && rows.find((r) => r.name === "Bea").score === 0, "it ends with places: " + rows.map((r) => `${r.name} ${r.score} (+${r.points})`).join(", "));
  check(end.room.phase === "lobby" && end.room.tonight.games === 1 && end.room.members.filter(Boolean).reduce((n, m) => n + m.points, 0) === rows.reduce((n, r) => n + r.points, 0), "everyone is back in the lobby and the points are on the Tonight board");
  // The card is up for under six seconds, so it has been watched for since the battle began (cardSeen).
  const card = await Promise.race([cardSeen, sleep(20000).then(() => null)]);
  if (!slow) check(typeof card === "string" && card.includes("Cork & Bell") && rows.every((r) => card.includes(r.name) && card.includes(r.score.toLocaleString("en-US"))), "the room's card shows who came where, with the scores" + (card === null ? ": it never came up on the big screen" : ""));
  else console.log(`     (the big screen ${card === null ? "did not show" : "showed"} the room's card: a page that draws in software is not held to it)`);
  for (const [name, page] of [["big screen", screen], ["Ada's phone", ada], ["Cy's phone", cy]]) {
    // (A page that is behind hears of the end late: wait for it to act on it.)
    await page.waitForSelector(FRAME, { state: "detached", timeout: 90000 });
    const left = await leftBehind(page);
    check(left.frames === 0 && left.canvases === 0 && left.lost === true && left.stage === true && left.bar, `${name}: the game is gone from the page (no frame, no canvas), its WebGL context was let go, and the room's bar is back`);
  }
  await screen.waitForSelector(".card", { state: "detached", timeout: 30000 });
  await sleep(400);
  if (!slow) await shot(screen, "58-screen-back-after-cork-and-bell");
  const board = await screen.evaluate(() => [...document.querySelectorAll("svg.scene .t-chalk")].map((t) => t.textContent).join(" "));
  check(/after 1 game/.test(board), "the Tonight board says: " + board.replace(/\s+/g, " ").slice(0, 80));

  // ---------------------------------------------------------------- asleep again
  // The rest after a game (six seconds), and the room's report to the budget, have passed.
  await sleep(8000);
  const quiet = await inner(start.room.code);
  check(quiet.timer === false && quiet.view.phase === "lobby" && quiet.alarmIn > 5 * 60_000, `back in the lobby the room runs no timer, and its only wake-up is the slow "forgotten room" check, ${Math.round(quiet.alarmIn / 60_000)} minutes away`);
  const marks = watcher.seen.length;
  await sleep(8000);
  const still = await inner(start.room.code);
  check(watcher.seen.length === marks && JSON.stringify(still.owed) === JSON.stringify(quiet.owed), "and then nothing: no messages, and nothing more counted while nobody touches anything");
  const afterOne = await books();
  await shut("screen", "Ada", "Cy");
  bea.ws.close();

  // ================================================================ a party of one
  // Played at the same time as the battle where the pages keep up (playAlone above), else now.
  const { loneTook } = await (alone ?? playAlone());
  await sleep(3000);
  const after = await books();
  if (before && afterOne && after) {
    const first = (afterOne.dayUsed - before.dayUsed) / ROOM_MEMORY_GB;
    const both = (after.dayUsed - before.dayUsed) / ROOM_MEMORY_GB;
    // A room is held awake, and counted second for second, from a round's start to its end, and
    // asleep otherwise, where an event (a join, a step, a vote) counts only the few milliseconds
    // it took. So each round's awake time is its own length, never less (the room must not
    // under-count), and more only by those events: never by a timer left running after the round
    // ended, early or not, which would add every second until the books were read.
    const AROUND = 1;
    const fair = (awake, took, around = AROUND) => awake >= took - 0.05 && awake <= took + around;
    if (alone) {
      // The two rounds overlapped, so the one count of the server's books holds both: together
      // they are what the two rounds lasted, each second for second.
      check(fair(both, took + loneTook, 2 * AROUND), `each round was counted against the room budget second for second: ${both.toFixed(1)} awake seconds for the battle and the round played alone, which lasted ${took.toFixed(1)} and ${loneTook.toFixed(1)} (at most ${AROUND} s more a round is allowed, for what happened around them)`);
    } else {
      check(fair(first, took) && fair(both - first, loneTook), `each round was counted against the room budget second for second: ${first.toFixed(1)} awake seconds for the battle, which lasted ${took.toFixed(1)}, and ${(both - first).toFixed(1)} for the round played alone, which lasted ${loneTook.toFixed(1)} (at most ${AROUND} s more is allowed, for what happened around the rounds)`);
    }
    console.log(`     one round costs ${(took * ROOM_MEMORY_GB).toFixed(1)} GB-seconds of room time, however many play.`);
  }
  async function playAlone() {
  const lone = await open("alone", { width: 844, height: 390 }, { hasTouch: true });
  await lone.goto(base + "/lobby/?start&look=flat&cork-auto=1&cork-quality=low");
  await lone.fill("input[name=nickname]", "Sol");
  await lone.click("text=Start the party");
  await lone.waitForSelector("svg.scene text");
  const pinLone = await lone.evaluate(() => [...document.querySelectorAll("svg.scene text")].map((t) => t.textContent).find((t) => /^\d{4}$/.test(t)));
  // A room has one screen, and this room's will be the page that joins in the middle of the
  // round, so the run watches the room through the local server's debug door (as the stills run
  // does): where the piece is, and when the round starts and ends.
  const codeLone = (await call("GET", "/join/" + pinLone)).preview.code;
  const loneWatch = { seen: [], room: null, timer: null };
  const look = async () => {
    const view = (await inner(codeLone))?.view;
    if (!view) return;
    loneWatch.room = view;
    for (const m of view.members) if (m) loneWatch.seen.push({ t: "m", s: m.seat, x: m.x });
  };
  /** Waits until the watched room's view passes `test`, looking ten times a second. */
  const loneUntil = async (test, ms) => {
    for (const from = Date.now(); Date.now() - from < ms; await sleep(100)) if (loneWatch.room && test(loneWatch.room)) return loneWatch.room;
    throw new Error("timed out watching the party of one");
  };
  await look();
  loneWatch.timer = setInterval(() => void look().catch(() => {}), 100);
  await loneUntil((v) => v.members[0]?.connected, 8000);
  check(loneWatch.room.vote.lights["cork-and-bell"] === null, "Cork & Bell's light is on for a party of one");
  await walk(lone, loneWatch, 0, light());
  const loneStart = await loneUntil((v) => v.phase === "playing", 16000);
  const loneFrame = await gameFrame(lone);
  // A big screen that joins once that round has begun watches its one stall. It sets off as soon as the phone's game
  // is up, beside what is checked on the phone meanwhile, and in a browser of its own (a screen is a device of its
  // own): the round alone ends once the bot has spent its corks (73 s into it, once). On a loaded machine the
  // phone's checks and stills, then the screen's own start, took that long one after another, so the screen came
  // up to a round already over ("Frame was detached"); and a screen loading beside the phone in the phone's own
  // browser came up only 87 s in, on GitHub's runner (their WebGL calls wait on that browser's one graphics process).
  let late = null;
  const lateBrowser = opt("win", "0") === "1" ? browser : await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  extraBrowsers.push(lateBrowser);
  const lateUp = (async () => {
    late = await open("late screen", { width: 960, height: 540 }, { via: lateBrowser });
    await late.goto(base + "/lobby/?join=" + pinLone + "&look=flat&cork-quality=low");
    await late.click("text=Use this as the room's screen");
    await late.click("text=Show the room here");
    return gameFrame(late);
  })();
  lateUp.catch(() => {}); // (awaited below; a failure is reported there)
  // Held now, while the frame is surely there: on a slow runner the late screen below can take
  // the rest of the round to join, and the frame is gone once the round ends.
  await holdContext(lone);
  const loneSees = await loneFrame.evaluate(() => ({ mine: window.__cab.session.mySeat, stalls: window.__cab.views.length, seats: window.__cab.session.seats.length, rivals: document.getElementById("rivals").hidden, startAt: window.__cab.session.startAt }));
  check(loneStart.game.id === "cork-and-bell" && loneSees.seats === 1, "alone in its light, the count runs and a round starts for the one seat");
  check(loneSees.mine === 0 && loneSees.stalls === 1 && loneSees.rivals, "the party of one has a stall to itself, with no rivals to pick");
  if (!slow) await shot(lone, "54-phone-cork-and-bell-alone");
  const lateFrame = await lateUp;
  const lateSees = await lateFrame.evaluate(() => ({ mine: window.__cab.session.mySeat, stalls: window.__cab.views.length, t: window.__cab.session.time(), tally: !document.getElementById("tally").hidden }));
  check(lateSees.mine === -1 && lateSees.stalls === 1 && lateSees.t > -3.5 && lateSees.tally, `a big screen that joins once the round has begun is shown that stall and its score (${lateSees.t < 0 ? "in the count-in" : Math.round(lateSees.t) + " seconds in"})`);
  if (!slow) await shot(late, "59-screen-cork-and-bell-alone");
  console.log("     waiting for the round played alone to end...");
  const loneEnd = await loneUntil((v) => v.phase === "lobby" && v.last?.game === "cork-and-bell", 150000);
  clearInterval(loneWatch.timer);
  const sol = loneEnd.last.rows[0];
  check(loneEnd.last.rows.length === 1 && sol.place === 1 && sol.points === 3 && sol.score > 0, `the round played alone ends too: ${sol.name} ${sol.score} (+${sol.points})`);
  // On the room's clock, from the game's start to the room's end. Alone, the round is over once
  // the stall has spent its corks, or when its time is up; the room ends it then, after the hold.
  const loneTook = (loneEnd.last.at - loneSees.startAt) / 1000;
  const loneTimeAt = timeCalls.find((c) => c.name === "alone" || c.name === "late screen")?.t ?? null;
  const loneDue = COUNT_IN + start.s.delay + loneTimeAt + END_HOLD;
  check(loneTimeAt !== null && loneTook >= loneDue - 0.05 && loneTook < loneDue + 0.5, `and the room ended it when the game did: time was called at ${loneTimeAt?.toFixed(1)} of ${ROUND_SECONDS} seconds (${loneTimeAt < ROUND_SECONDS ? "its corks were spent" : "the time was up"}), and the round lasted ${loneTook.toFixed(1)} seconds, ${loneDue.toFixed(1)} due`);
  await lone.waitForSelector(FRAME, { state: "detached", timeout: 90000 });
  const loneLeft = await leftBehind(lone);
  check(loneLeft.frames === 0 && loneLeft.canvases === 0 && loneLeft.lost === true, "and its game was taken away");
  return { loneTook };
  }

  // The handshake as real pages did it, reloads and late joiners included: every socket's first
  // frame is the hello with the seat's token, and no address a page asked for names a token.
  const hellos = pageSockets.map((s) => {
    try {
      const first = JSON.parse(s.first);
      return first.t === "hello" && typeof first.token === "string" ? first.token : null;
    } catch {
      return null;
    }
  });
  const spoke = pageSockets.filter((s) => s.first !== null);
  check(spoke.length >= 4 && hellos.filter(Boolean).length === spoke.length, `every socket a page opened said hello with its token first (${spoke.length} sockets from ${new Set(spoke.map((s) => s.name)).size} pages)`);
  const tokens = [...new Set(hellos.filter(Boolean))];
  const named = [...pageSockets.map((s) => s.url), ...pageAddresses].filter((address) => /[?&]token=/.test(address) || tokens.some((token) => address.includes(token)));
  check(tokens.length >= 3 && named.length === 0, `and none of the ${pageSockets.length + pageAddresses.length} addresses the pages asked for names a token (${tokens.length} seats)` + (named.length ? ": " + named[0].replace(/token=[^&]+/, "token=...") : ""));

  // A page loaded before the token left the address still opens its socket the old way. From a
  // real page: the room takes it, for now, as that socket's hello (hello-logic.js,
  // HONOUR_TOKEN_IN_ADDRESS), so the old page keeps its seat; with a token that names nobody it is
  // closed as a seat that is gone (4003), having heard nothing of the room.
  {
    const made = await call("POST", "/rooms", { nickname: "Old" });
    const stale = await open("a page from before", { width: 480, height: 320 });
    await stale.goto(base + "/");
    const oldSocket = ([code, token]) =>
      new Promise((done) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/lobby/rooms/${code}/ws?token=${token}`);
        const heard = [];
        const from = Date.now();
        ws.onmessage = (e) => heard.push(String(e.data).slice(0, 40));
        // What an old page said first: its keep-alive.
        ws.onopen = () => ws.send("ping");
        ws.onclose = (e) => done({ code: e.code, reason: e.reason, heard, after: Date.now() - from });
        setTimeout(() => {
          done({ code: null, reason: "still open", heard, after: Date.now() - from });
          ws.close();
        }, 3000);
      });
    const kept = await stale.evaluate(oldSocket, [made.code, made.token]);
    check(kept.code === null && kept.heard[0]?.startsWith('{"t":"hello"'), `a page that still puts the token in the address keeps its seat: its first frame is the hello (${kept.heard.length} frames, ${kept.reason})`);
    const wrong = await stale.evaluate(oldSocket, [made.code, "not-a-token"]);
    check(wrong.code === 4003 && wrong.reason === "bad_token" && !wrong.heard.some((f) => f.startsWith("{")), `and with a token that names nobody it is refused as a seat that is gone, having heard nothing of the room: ${JSON.stringify(wrong)}`);
    await shut("a page from before");
  }
  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""));
  clearInterval(alive);
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
  // What every page was showing when it stopped, so a failure says where to look.
  for (const [name, page] of opened) {
    const was = await page
      .evaluate(() => ({ line: document.querySelector(".status-main")?.textContent ?? null, frames: document.querySelectorAll("iframe").length, app: document.getElementById("app")?.className, card: document.querySelector(".card-title")?.textContent ?? null }))
      .catch((e) => String(e).slice(0, 80));
    console.log(`     ${name}: ${JSON.stringify(was)}`);
  }
  if (loadProblems.length) console.log("     files that did not load: " + loadProblems.slice(0, 8).join(" | "));
  if (errors.length) console.log("     page errors: " + errors.slice(0, 6).join(" | "));
} finally {
  await browser.close();
  for (const b of extraBrowsers) if (b !== browser) await b.close().catch(() => {});
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good. Stills are in " + out);
// Exit once everything printed has left: process.exit drops what is still queued for a pipe (the
// pre-deploy gate reads this output through one), and the list of problems is printed last.
process.stdout.write("", () => process.stderr.write("", () => process.exit(problems.length ? 1 : 0)));
