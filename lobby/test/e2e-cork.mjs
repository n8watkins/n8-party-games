// Cork & Bell played inside the party room, end to end in real pages.
//
// First a party of three and a big screen: they vote for it, the game is mounted over the room
// on every device, a player fires with real clicks, reloads in the middle and comes back to
// their stall, the round ends, the game is taken away again and the places are on the Tonight
// board. Then a party of one plays a round alone, and a big screen joins in the middle of it.
// The browser is headless and muted, and is closed at the end whatever happens.
//
//   node lobby/test/e2e-cork.mjs [--base=http://localhost:8791] [--out=lobby/test/shots] [--win=1]
//
// It takes about four minutes: a round is ninety seconds, there are two, and nothing shortens
// them. It reads the room budget's books before and after (the local server's debug door), so
// the run also says what the two rounds cost.
//
// Playwright's browser in WSL draws WebGL in software, a few frames a second, so the pages are
// kept few and small (a 960 x 540 screen, phones at one pixel per pixel) and one of the three
// players is a plain socket. --win=1 uses the game's own tool to drive a headless, muted Chrome
// on the Windows side instead, on the real graphics card (node_modules/cork-and-bell/tools/browser.mjs).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openBrowser } from "../../node_modules/cork-and-bell/tools/browser.mjs";
import { ROOM_MEMORY_GB } from "../../party-kit/src/worker/budget-logic.js";
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
const inner = async (code) => (await (await fetch(api + "/debug/" + code)).json()).room;
const FRAME = 'iframe[title="Cork & Bell"]';

/** Every page opened, by name, and what any of them complained of: reported if the run stops. */
const opened = new Map();
const errors = [];
const browser = await openBrowser({ win: opt("win", "0") === "1", width: 960, height: 540 });
try {
  async function open(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
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
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
    console.log("     still: " + name);
  };
  /** The game's frame on a room page, once the game's page inside it is running its round. */
  async function gameFrame(page, timeout = 120000) {
    const handle = await page.waitForSelector(FRAME, { timeout });
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => window.__cab?.mode === "battle" && window.__cab.session, null, { timeout });
    return frame;
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
        bars: [...document.querySelectorAll(".bar, .turn-hint, .banner")].filter(show).length,
        fills: Math.round(f.width) === innerWidth && Math.round(f.height) === innerHeight,
        clear: controls.width === 0 || controls.right <= d.left - 4 || controls.top >= d.bottom + 4,
        scroll: document.documentElement.scrollWidth > innerWidth + 1,
      };
    }, FRAME);
  /** What is left of the game on a room page after it was taken away. */
  const leftBehind = (page) =>
    page.evaluate(() => ({ frames: document.querySelectorAll("iframe").length, canvases: document.querySelectorAll("canvas").length, lost: window.__gl?.isContextLost?.() ?? null, stage: document.querySelector(".stage")?.hidden, bar: !!document.querySelector(".bar")?.offsetHeight }));
  const holdContext = (page) => page.evaluate((sel) => (window.__gl = document.querySelector(sel).contentWindow.__cab.lens.renderer.getContext()), FRAME);
  const before = await books();
  let loneWatch = null;

  // ================================================================ a party of three and a big screen
  const screen = await open("screen", { width: 960, height: 540 });
  await screen.goto(base + "/lobby/?start&cork-quality=low");
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  const pin = (await screen.locator(".code-digits").textContent()).trim();
  const join = async (name, viewport, query) => {
    const page = await open(name, viewport, { hasTouch: true });
    await page.goto(base + "/lobby/?join=" + pin + query);
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    await page.waitForSelector("svg.scene text");
    return page;
  };
  // Ada plays by hand on a phone held sideways. Bea is a socket that never fires. Cy holds a
  // phone upright and is played by the game's own bot.
  const ada = await join("Ada", { width: 844, height: 390 }, "&cork-quality=low");
  const bea = connect(await call("POST", "/join/" + pin, { nickname: "Bea" }));
  await bea.opened;
  // A page keeps its socket alive by itself; a bare socket has to say something now and then, or
  // the room takes it for a phone that has gone (after ninety silent seconds) and lets it drop.
  const alive = setInterval(() => [bea, loneWatch].forEach((c) => c?.send("ping")), 20_000);
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
  await walk(cy, watcher, 2, light(50));
  await screen.waitForFunction(() => /Cork & Bell starts in/.test(document.querySelector(".status-main")?.textContent ?? ""), null, { timeout: 8000 });
  await shot(screen, "50-screen-count-cork-and-bell");
  const start = await watcher.wait((m) => m.t === "start", 9000, 0);
  const startedAt = Date.now();
  check(start.room.phase === "playing" && start.room.game.id === "cork-and-bell" && start.s.seats.map((s) => s.seat).join() === "0,1,2", "the count ends and a battle starts for the party's three seats, with no waiting room");

  // The game is mounted over the room on every device.
  const frames = {};
  for (const [name, page] of [["Ada", ada], ["Cy", cy], ["screen", screen]]) frames[name] = await gameFrame(page);
  const loadedIn = Date.now() - startedAt;
  // A browser that draws WebGL in software (Playwright's own, in WSL) has pages that run many
  // seconds behind the room. What needs a page to keep up with a ninety-second round is left
  // out there, and said so; everything the room decides is checked either way.
  const slow = loadedIn > 15_000;
  if (slow) console.log(`     (the game took ${(loadedIn / 1000).toFixed(0)} seconds to come up: this browser draws in software. The reload in the middle, the door sheet and the stills are left out; run with --win=1 for all of it.)`);
  // A context to check afterwards: the game's WebGL context, held from the room's page.
  for (const page of [screen, ada, cy]) await holdContext(page);
  const seats = {};
  for (const name of Object.keys(frames)) seats[name] = await frames[name].evaluate(() => ({ mine: window.__cab.session.mySeat, stalls: window.__cab.views.length, hosted: document.body.classList.contains("hosted"), start: document.getElementById("start").hidden, tally: !document.getElementById("tally").hidden }));
  check(seats.Ada.mine === 0 && seats.Cy.mine === 2 && [seats.Ada, seats.Cy].every((s) => s.stalls === 1 && s.hosted && s.start && s.tally), `each phone shows its own stall, in hosted mode, with no start board (the game was up on all three pages ${(loadedIn / 1000).toFixed(1)} seconds after the start)`);
  check(seats.screen.mine === -1 && seats.screen.stalls === 3, "the big screen shows all three stalls side by side: a spectator view");
  for (const [name, page] of [["phone held sideways", ada], ["upright phone", cy], ["big screen", screen]]) {
    const seen = await onTop(page);
    check(seen.door && seen.bars === 0 && seen.fills && seen.clear && !seen.scroll, `${name}: the game fills the screen, the room's bars are put away, and its door button stays, clear of the game's sound switch`);
  }
  // Ada fires with real clicks: a click on the picture aims there and fires.
  const fired = async () => (await summary(frames.Ada)).stalls[0].shots;
  let clicks = 0;
  for (let i = 0; i < 5; i++) {
    const had = await fired();
    await frames.Ada.waitForFunction(() => window.__cab.session.canFire(), null, { timeout: 30000 });
    await ada.mouse.click(300 + (i % 4) * 80, 150 + (i % 3) * 22);
    clicks++;
    await frames.Ada.waitForFunction((n) => window.__cab.session.sims[0].shots > n, had, { timeout: 30000 }).catch(() => {});
  }
  const shots = await fired();
  check(shots === clicks, `a click on the picture fires a cork: ${shots} corks from ${clicks} clicks`);
  await frames.screen.waitForFunction((n) => window.__cab.session.sims[0].shots >= n, shots, { timeout: 30000 }).catch(() => {});
  const onScreen = (await summary(frames.screen)).stalls;
  check(onScreen[0].shots === shots && onScreen[2].shots > 0 && onScreen[1].shots === 0, `the room relays it: the big screen has counted ${onScreen[0].shots} of Ada's corks, ${onScreen[2].shots} of Cy's bot's and none of Bea's, who never fired`);

  const midGame = await inner(start.room.code);
  check(midGame.timer === true && midGame.view.phase === "playing", "while the round is on the room runs its one timer");

  if (!slow) {
    // Ada's phone reloads in the middle of the round, as a phone that dozed off would.
    const scoreBefore = (await summary(frames.screen)).stalls[0].score;
    await ada.reload();
    frames.Ada = await gameFrame(ada);
    const back = await frames.Ada.evaluate(() => ({ mine: window.__cab.session.mySeat, t: window.__cab.session.time(), score: window.__cab.session.sims[0].score, shots: window.__cab.session.sims[0].shots }));
    check(back.mine === 0 && back.t > 3 && back.t < 80 && back.score >= scoreBefore && back.shots >= shots, `a reload in the middle comes back to the same stall, ${Math.round(back.t)} seconds in, with its ${back.shots} corks and ${back.score} points`);
    await frames.Ada.waitForFunction(() => window.__cab.session.canFire(), null, { timeout: 30000 });
    await ada.mouse.click(420, 170);
    await frames.Ada.waitForFunction((n) => window.__cab.session.sims[0].shots > n, back.shots, { timeout: 30000 }).catch(() => {});
    check((await fired()) > back.shots, "and it can fire again");
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
  console.log("     waiting for the round to end (ninety seconds in all)...");
  const end = await watcher.wait((m) => m.t === "end", 150000, 0);
  const took = (end.at - start.at) / 1000;
  const rows = end.last.rows;
  check(took > 93 && took < 98, `the round lasted ${took.toFixed(1)} seconds: the count-in, ninety seconds and the hold at the end`);
  check(rows.length === 3 && rows.every((r, i) => i === 0 || r.score <= rows[i - 1].score) && rows[0].points === 3 && rows.find((r) => r.name === "Bea").score === 0, "it ends with places: " + rows.map((r) => `${r.name} ${r.score} (+${r.points})`).join(", "));
  check(end.room.phase === "lobby" && end.room.tonight.games === 1 && end.room.members.filter(Boolean).reduce((n, m) => n + m.points, 0) === rows.reduce((n, r) => n + r.points, 0), "everyone is back in the lobby and the points are on the Tonight board");
  if (!slow) {
    // The card is up for under six seconds: a page that keeps up shows it at once.
    await screen.waitForSelector(".card .places", { timeout: 20000 });
    const card = await screen.locator(".card").innerText();
    await shot(screen, "56-screen-cork-and-bell-result");
    await shot(ada, "57-phone-cork-and-bell-result");
    check(card.includes("Cork & Bell") && rows.every((r) => card.includes(r.name) && card.includes(r.score.toLocaleString("en-US"))), "the room's card shows who came where, with the scores");
  }
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
  const lone = await open("alone", { width: 844, height: 390 }, { hasTouch: true });
  await lone.goto(base + "/lobby/?start&cork-auto=1&cork-quality=low");
  await lone.fill("input[name=nickname]", "Sol");
  await lone.click("text=Start the party");
  await lone.waitForSelector("svg.scene text");
  const pinLone = await lone.evaluate(() => [...document.querySelectorAll("svg.scene text")].map((t) => t.textContent).find((t) => /^\d{4}$/.test(t)));
  // A socket that watches the room, to hear where the piece is and when the round starts and ends.
  loneWatch = connect(await call("POST", "/join/" + pinLone, { as: "screen" }));
  await loneWatch.opened;
  await loneWatch.wait((m) => m.room?.members[0]?.connected, 8000, 0);
  check(loneWatch.room.vote.lights["cork-and-bell"] === null, "Cork & Bell's light is on for a party of one");
  await walk(lone, loneWatch, 0, light());
  const loneStart = await loneWatch.wait((m) => m.t === "start", 9000, 0);
  check(loneStart.room.game.id === "cork-and-bell" && loneStart.s.seats.length === 1, "alone in its light, the count runs and a round starts for the one seat");
  const loneFrame = await gameFrame(lone);
  const loneSees = await loneFrame.evaluate(() => ({ mine: window.__cab.session.mySeat, stalls: window.__cab.views.length, rivals: document.getElementById("rivals").hidden }));
  check(loneSees.mine === 0 && loneSees.stalls === 1 && loneSees.rivals, "the party of one has a stall to itself, with no rivals to pick");
  if (!slow) await shot(lone, "54-phone-cork-and-bell-alone");
  // A big screen that joins in the middle of that round watches its one stall.
  const late = await open("late screen", { width: 960, height: 540 });
  await late.goto(base + "/lobby/?join=" + pinLone + "&cork-quality=low");
  await late.click("text=Use this as the room's screen");
  await late.click("text=Show the room here");
  const lateFrame = await gameFrame(late);
  const lateSees = await lateFrame.evaluate(() => ({ mine: window.__cab.session.mySeat, stalls: window.__cab.views.length, t: window.__cab.session.time(), tally: !document.getElementById("tally").hidden }));
  check(lateSees.mine === -1 && lateSees.stalls === 1 && lateSees.t > 0.5 && lateSees.tally, `a big screen that joins in the middle of the round is shown that stall and its score, ${Math.round(lateSees.t)} seconds in`);
  if (!slow) await shot(late, "59-screen-cork-and-bell-alone");
  await holdContext(lone);
  console.log("     waiting for the round played alone to end...");
  const loneEnd = await loneWatch.wait((m) => m.t === "end", 150000, 0);
  const sol = loneEnd.last.rows[0];
  check(loneEnd.last.rows.length === 1 && sol.place === 1 && sol.points === 3 && sol.score > 0 && loneEnd.room.phase === "lobby", `the round played alone ends too: ${sol.name} ${sol.score} (+${sol.points})`);
  await lone.waitForSelector(FRAME, { state: "detached", timeout: 90000 });
  const loneLeft = await leftBehind(lone);
  check(loneLeft.frames === 0 && loneLeft.canvases === 0 && loneLeft.lost === true, "and its game was taken away");

  // ================================================================ what it cost
  await sleep(3000);
  const after = await books();
  if (before && afterOne && after) {
    const first = (afterOne.dayUsed - before.dayUsed) / ROOM_MEMORY_GB;
    const both = (after.dayUsed - before.dayUsed) / ROOM_MEMORY_GB;
    check(first > 93 && first < 101 && both - first > 93 && both - first < 101, `each round was counted against the room budget second for second: ${first.toFixed(1)} awake seconds for the battle and ${(both - first).toFixed(1)} for the round played alone`);
    console.log(`     one round costs ${(first * ROOM_MEMORY_GB).toFixed(1)} GB-seconds of room time, however many play.`);
  }

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""));
  clearInterval(alive);
  loneWatch.ws.close();
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
  if (errors.length) console.log("     page errors: " + errors.slice(0, 6).join(" | "));
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good. Stills are in " + out);
process.exit(problems.length ? 1 : 0);
