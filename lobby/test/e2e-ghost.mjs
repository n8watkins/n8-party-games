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
import { LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log("\n     -- " + name);

/**
 * Read in each page: what it sent the room (window.__out: fades, boos and looks), a way to send
 * on its own socket (window.__send), how faded a seat's ghost is drawn and how wide-eyed a piece is.
 */
function pageHelpers() {
  window.__out = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    window.__ws = this;
    try {
      const m = JSON.parse(data);
      if (m && (m.t === "boo" || m.t === "fade" || m.t === "look")) window.__out.push({ ...m, at: performance.now() });
    } catch {
      // A keep-alive ("ping"): not JSON.
    }
    return send.call(this, data);
  };
  window.__send = (m) => window.__ws.send(JSON.stringify(m));
  const g = (seat) => document.querySelector(`svg.scene g[data-seat="${seat}"]`);
  window.fadedOn = (seat) => Number(g(seat)?.getAttribute("data-faded") ?? 0);
  window.scaredOn = (seat) => Number(g(seat)?.getAttribute("data-scared") ?? 0);
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
  const drawn = (page) => page.waitForSelector("svg.scene g[data-seat]", { timeout: 20000 });
  async function join(name, pin) {
    const page = await open(name);
    await page.goto(`${base}/lobby/?join=${pin}&look=flat`);
    await page.waitForSelector(".door-title");
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    await drawn(page).catch(async (err) => {
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
    };
    sockets.push(c);
    return c;
  }

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
  check(!asked.includes(A) && !ada.seen.slice(from).some((m) => m.t === "spook"), `and her page never asks about Ada, spooked a moment ago (it asked about seats ${JSON.stringify(asked)})`);

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
  check((await cy.evaluate((s) => window.fadedOn(s), C)) === 0, "and so does his own phone");
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
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
