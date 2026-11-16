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
//   every body      a slime and a robot are scared (they kick a faded ghost) and spooked (a faded
//                   ghost drifts through them), drawn wide-eyed and pale in the flat look and in
//                   3D, and a page of either look reloaded mid-scare draws the scare
//
//   --shots=DIR     stills of each fright, in each look
import { mkdirSync } from "node:fs";
import { COLOUR_PRESETS, LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { SCARE_MS } from "../shared/ghost.js";
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
/** The pale a fright tints a piece toward (look3d/pieces.js, PALE), as a page shows it. */
const PALE_RGB = { r: 0xee, g: 0xf3, b: 0xfb };

/**
 * Read in each page: what it sent the room (window.__out: fades, boos and looks), a way to send
 * on its own socket (window.__send), how faded a seat's ghost is drawn and how wide-eyed a piece is.
 */
function pageHelpers() {
  window.__out = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
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
  const g = (seat) => document.querySelector(`svg.scene g[data-seat="${seat}"]`);
  window.fadedOn = (seat) => Number(g(seat)?.getAttribute("data-faded") ?? 0);
  // How frightened a seat's piece is drawn, in either look: how wide its eyes (0 to 1) and how pale.
  window.frightOn = (seat) => {
    const room = window.__room3d;
    if (room) {
      const p = room.pieces.get(seat);
      if (!p) return { scared: 0, pale: 0, character: null };
      const tint = p.body.mat?.userData?.tint?.value;
      return { scared: p.fright ? (p.body.scaredK ?? 0) : 0, pale: p.body.pale ?? 0, paint: tint ? tint.w : null, character: p.kind.id };
    }
    const el = g(seat);
    const sat = /saturate\(([\d.]+)\)/.exec(el?.style.filter ?? "");
    return { scared: Number(el?.getAttribute("data-scared") ?? 0), pale: sat ? (1 - Number(sat[1])) / 0.55 : 0, character: el?.dataset.character ?? null };
  };
  window.scaredOn = (seat) => window.frightOn(seat).scared;
  // Keeps, for `ms`, the most frightened a seat's piece was drawn, in window.__fright.
  window.watchFright = (seat, ms) => {
    const most = (window.__fright = { scared: 0, pale: 0, paint: 0, character: null, frames: 0 });
    const until = performance.now() + ms;
    const look = () => {
      most.frames++;
      const f = window.frightOn(seat);
      most.scared = Math.max(most.scared, f.scared);
      most.pale = Math.max(most.pale, f.pale);
      most.paint = Math.max(most.paint, f.paint ?? 0);
      most.character = f.character;
      if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  };
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

  // ================================================================ every body
  section("a slime and a robot are scared and spooked, drawn so in the flat look and in 3D");
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
    const [flat, deep] = [await cy.evaluate(() => window.__fright), await eve.evaluate(() => window.__fright)];
    check(flat.character === character && flat.scared > 0.9 && flat.pale > 0.5, `flat: Ada's ${character} goes wide-eyed and pale when ${what} (${JSON.stringify(flat)})`);
    check(deep.character === character && deep.scared > 0.9 && deep.pale > 0.5 && (character !== "robot" || deep.paint > 0.4), `3D: and so it does on Eve's phone (${JSON.stringify(deep)})`);
    return done;
  };
  for (const character of ["slime", "robot"]) {
    await calmAgain();
    from = ada.seen.length;
    ada.send({ t: "look", c: character });
    await ada.wait((m) => m.room?.members[A]?.character === character, 4000, from);
    await sleep(LOOK_COOLDOWN_MS);

    // Scared: Ada, facing Bea's faded ghost, kicks it.
    await ready(B);
    at = await where();
    ada.goto(at[B].x - 60);
    ada.send({ t: "m", x: at[B].x - 60, d: 1, r: ada.rev });
    ada.send({ t: "m", x: at[B].x - 60, d: 0, r: ada.rev });
    await sleep(300);
    check(!!(await fade(bea, B)), `Bea fades (Ada is a ${character})`);
    const kick = await watched(character, "scared", async () => {
      const mark = ada.seen.length;
      ada.send({ t: "b" });
      return ada.wait((m) => m.t === "b" && m.s === A, 2000, mark).catch(() => null);
    });
    check(kick?.sc === B, `Ada's ${character} kicked Bea's faded ghost and was scared (${JSON.stringify(kick && { to: kick.to, sc: kick.sc })})`);

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

  section("a page of either look reloaded mid-scare draws a scared slime and robot");
  for (const character of ["robot", "slime"]) {
    await calmAgain();
    if ((await where())[A].character !== character) {
      from = ada.seen.length;
      ada.send({ t: "look", c: character });
      await ada.wait((m) => m.room?.members[A]?.character === character, 4000, from);
      await sleep(LOOK_COOLDOWN_MS);
    }
    // The page is reloaded, and Ada kicks `lead` ms later: a 3D page takes about a second to come
    // back, longer than a flat one, and the scare is over in about one and a half. What is judged
    // is a page whose first word to the room came after the kick (it arrived in the middle); a
    // page that was back before the kick is tried again with a shorter lead.
    for (const [page, look, firstLead] of [[cy, "flat", 0], [eve, "3d", 450]]) {
      let lead = firstLead;
      let seen = null;
      for (let attempt = 0; attempt < 4 && !(seen?.after && seen.inTime); attempt++) {
        // Back before the kick: a shorter lead. Back after the scare was over: a longer one.
        if (seen && !seen.after) lead = Math.floor(lead / 2);
        else if (seen && !seen.inTime) lead += seen.back - (SCARE_MS - 700);
        await ready(B);
        await calmAgain();
        at = await where();
        ada.goto(at[B].x - 60);
        ada.send({ t: "m", x: at[B].x - 60, d: 1, r: ada.rev });
        ada.send({ t: "m", x: at[B].x - 60, d: 0, r: ada.rev });
        await sleep(300);
        check(!!(await fade(bea, B)), `Bea fades (Ada is a ${character})`);
        // The room's own address, as a reload does, with the look asked for again.
        const going = page.goto(`${base}/lobby/?${look === "flat" ? "look=flat" : "look=3d&gl=any"}`);
        await sleep(lead);
        from = ada.seen.length;
        const kickAt = Date.now();
        ada.send({ t: "b" });
        const scared = await ada.wait((m) => m.t === "b" && m.s === A, 2000, from).catch(() => null);
        await going;
        await drawn(page, look);
        // Watched from the first frame it draws: how wide its eyes got, and in how many frames.
        await page.evaluate((s) => window.watchFright(s, 1500), A);
        const back = Date.now() - kickAt;
        const after = (await page.evaluate(() => window.__firstSend)) > kickAt;
        await sleep(1600);
        const shown = await page.evaluate(() => window.__fright);
        const wide = shown.scared > 0.5;
        // The page drew in time to see the scare: its first frame came before the scared piece was up again.
        const inTime = back < SCARE_MS - 250;
        seen = { scared, after, inTime, wide, shown, back };
        if (after && shots) await page.screenshot({ path: `${shots}/${look}-${character}-reloaded-mid-scare.png` });
        await sleep(1500);
      }
      const { scared, after, inTime, wide, shown, back } = seen;
      check(scared?.sc === B, `Ada's ${character} kicked Bea's faded ghost (${JSON.stringify(scared && { to: scared.to, sc: scared.sc })})`);
      const missed = !after ? "; it was back before the kick every time" : !inTime ? `; it never drew within the ${SCARE_MS} ms scare, so nothing was judged` : "";
      check(after && inTime && wide && shown.character === character, `${look}: a page that arrived in the middle of the scare (drawn ${back} ms after the kick${missed}) draws Ada's ${character} scared (wide eyes), not knocked (${JSON.stringify(shown)})`);
    }
  }

  section("3D: a scared robot's paint goes pale in every colour, by its pixels");
  for (const [i, { hex, name }] of COLOUR_PRESETS.entries()) {
    await calmAgain();
    from = ada.seen.length;
    ada.send({ t: "look", c: "robot", v: hex });
    await ada.wait((m) => m.room?.members[A]?.character === "robot" && m.room.members[A].colour === hex, 4000, from);
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
      // Its left side: the ghost it kicks stands up to its right.
      const before = await meanColour(eve, await paintBox(eve, A, -1));
      if (!(await fade(ghost, G))) check(false, `the ghost fades for ${name}`);
      from = ada.seen.length;
      ada.send({ t: "b" });
      const kick = await ada.wait((m) => m.t === "b" && m.s === A, 2000, from).catch(() => null);
      // Frozen at its palest: wide-eyed and still.
      const frozen = await eve.waitForFunction((s) => window.frightOn(s).pale > 0.95 && window.frightOn(s).scared > 0.95, A, { timeout: 2000, polling: 16 }).then(() => true, () => false);
      const box = await paintBox(eve, A, -1);
      const pale = await meanColour(eve, box);
      // Still frozen as the picture was taken (it scurries off after), so the box was still on it.
      const still = await eve.evaluate((s) => window.frightOn(s).pale > 0.95, A);
      if (shots && still) await eve.screenshot({ path: `${shots}/3d-robot-pale-${hex.slice(1)}.png`, clip: { x: box.x - 60, y: box.y - 110, width: 130, height: 150 } });
      result = { G, kick, frozen, still, before, pale, attempt };
    }
    const { G, kick, frozen, still, before, pale, attempt } = result;
    const was = apart(before, PALE_RGB);
    const now = apart(pale, PALE_RGB);
    check(kick?.sc === G && frozen && still && (now <= 0.8 * was || now < 30), `${name} (${hex}): scared, its paint goes toward the pale (${JSON.stringify(before)} to ${JSON.stringify(pale)}: ${was} to ${now} from it${attempt ? "; the first picture missed the freeze" : ""}${still ? "" : "; it had moved off by the picture"})`);
  }

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
