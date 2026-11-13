// End to end, in real pages (headless and muted) and over sockets: every way out of the party
// room lands somewhere real, and the room the party is in is one shared choice.
//
//   node lobby/test/e2e-leave-rooms.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/leave-rooms]
//
// Leaving: a player and the room's screen leave and land on the front page with a line and the
// way back in, which works; a seat given up after a drop, a screen whose place was taken, a
// wrong code, a full party, a second screen and "Stay in the room" each end with a clear next
// step; the lines for a room that closed (untouched, four hours, allowance) are what the front
// page says; and a rejoin that cannot work shows nothing and never moves the page.
// Rooms: the host's pick reaches every device, others' taps do not apply, nothing changes
// during the count or a game, a latecomer gets the party's room, a start link's ?room= is the
// starting choice, it survives the room sleeping, and a device without 3D loads none of it.
// The 3D pages draw in software (?gl=any), so they are checked for what they draw, not how fast.
// It takes about two minutes, most of it waiting out a dropped phone's thirty seconds.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/leave-rooms"));
mkdirSync(out, { recursive: true });
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const N = 6;
const [COIN, WHO] = [1, 2];
const light = (i, off = 0) => Math.round(boxCentre(i, N) + off);
const WHO_SITE = "https://whoami.n8builds.dev/";

// Two browsers: a plain one, which like WSL has no hardware 3D and so gets the flat room, and one
// that draws WebGL in software for the pages that ask for the 3D look with ?gl=any.
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const soft = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
const timers = [];
try {
  async function open(name, viewport, extra = {}, threeD = false) {
    const context = await (threeD ? soft : browser).newContext({ viewport, deviceScaleFactor: 1, ...extra });
    await context.route(WHO_SITE + "**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stand-in</title>" }));
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
  const chip = (page) => page.locator(".note-chip").textContent({ timeout: 6000 }).catch(() => null);
  const keepAlive = (...cs) => timers.push(setInterval(() => cs.forEach((c) => c.send("ping")), 20_000));

  async function join(page, pin, nickname, extra = "") {
    await page.goto(`${base}/lobby/?join=${pin}${extra}`);
    if (nickname) await page.fill("input[name=nickname]", nickname);
    await page.click("button[type=submit]");
    await page.waitForSelector(".bar", { timeout: 60000 });
  }
  async function leaveRoom(page) {
    await page.click(".door-btn");
    await page.click(".sheet .choice");
    await page.waitForURL(base + "/", { timeout: 8000 });
  }
  /** Walks Ada's piece (the laptop's) to x with the keyboard, as a player would; Wes's socket hears where it is. */
  async function walkAda(x) {
    await host.bringToFront();
    for (let i = 0; i < 16; i++) {
      await sleep(250);
      const last = watcher.seen.findLast((m) => (m.t === "m" && m.s === 0) || (m.t === "b" && m.to === 0) || m.room?.members?.[0]);
      const at = last?.room ? last.room.members[0].x : last?.x ?? watcher.room.members[0].x;
      const gap = x - at;
      if (Math.abs(gap) < 30) return;
      const k = gap > 0 ? "ArrowRight" : "ArrowLeft";
      await host.keyboard.down(k);
      await sleep(Math.max(50, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
      await host.keyboard.up(k);
    }
  }
  const pinOf = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin);

  // ---------------------------------------------------------------- a party: a laptop starts it in the star lounge
  const host = await open("laptop", { width: 1280, height: 800 });
  await host.goto(`${base}/lobby/?start&room=ship`);
  await host.fill("input[name=nickname]", "Ada");
  await host.click("button[type=submit]");
  await host.waitForSelector(".bar");
  const pin = await pinOf(host);
  const code = await host.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).code);
  const words = await host.locator(".corner").innerText();
  check(/Rooms/.test(words) && /Leave/.test(words), `the corner says what its buttons do when the room opens: "${words.replace(/\s+/g, " ")}"`);
  await shot(host, "01-laptop-corner-with-words");
  await sleep(9500);
  check((await host.locator(".corner.folded").count()) === 1, "and folds to its pictures a few seconds later");
  const flatLoads = await host.evaluate(() => performance.getEntriesByType("resource").filter((r) => /look3d|three\.module/.test(r.name)).length);
  check(flatLoads === 0 && (await host.locator("svg.scene").count()) === 1, `(${flatLoads} 3D files, ${await host.locator("svg.scene").count()} flat scene) a device without hardware 3D draws the flat room and fetches none of the 3D look`);

  const watcher = connect(await call("POST", "/join/" + pin, { nickname: "Wes" }));
  await watcher.opened;
  keepAlive(watcher);
  await watcher.wait((m) => m.t === "hello", 5000, 0);
  check(watcher.room.room === "ship", `a start link's ?room= is the party's starting room (${watcher.room.room})`);
  check(watcher.room.picker?.seat === 0, "and the player who started the party picks the room");

  // ---------------------------------------------------------------- rooms: shared, with lights down and up, on two 3D devices
  const tv = await open("big screen", { width: 1920, height: 1080 }, {}, true);
  await join(tv, pin, "", "&as=screen&gl=any");
  await tv.waitForSelector(".look3d canvas", { timeout: 60000 });
  const phone = await open("sideways phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true }, true);
  await join(phone, pin, "Bo", "&gl=any");
  await phone.waitForSelector(".look3d canvas", { timeout: 60000 });
  await sleep(1500);
  const skins = async () => [await tv.evaluate(() => window.__room3d?.skin.id), await phone.evaluate(() => window.__room3d?.skin.id)];
  check((await skins()).join() === "ship,ship", "the 3D look is the default where it can be drawn, and both devices are in the party's room: " + (await skins()).join());
  await shot(tv, "02-screen-star-lounge");
  await phone.click(".rooms-btn");
  await sleep(500);
  await shot(phone, "03-phone-picker-not-host");
  const line = await phone.locator(".picker-why").textContent();
  check(/Only Ada can change the room/.test(line), `a guest sees who picks: "${line}"`);
  await phone.click(".room-card[data-room=camp]", { force: true });
  await sleep(600);
  check((await phone.locator(".picker").count()) === 1 && watcher.room.room === "ship", "and a guest's tap changes nothing");
  await phone.click("text=Done");
  // The other devices watch for the lights going down.
  for (const p of [tv, phone])
    await p.evaluate(() => {
      window.__notes = [];
      new MutationObserver(() => {
        if (document.querySelector(".room-dim.on")) window.__dimmed = true;
        for (const n of document.querySelectorAll(".note")) if (!window.__notes.includes(n.textContent)) window.__notes.push(n.textContent);
      }).observe(document.getElementById("app"), { subtree: true, attributes: true, childList: true });
    });
  await host.click(".rooms-btn");
  await sleep(400);
  await shot(host, "04-laptop-picker-host");
  check(/Everyone in the party sees the room you choose/.test(await host.locator(".picker-line").textContent()), "the host is told their pick moves everyone");
  await host.click(".room-card[data-room=camp]");
  const moved = await watcher.wait((m) => m.t === "pick", 5000).catch(() => null);
  check(moved?.v === "camp" && moved.by === 0, "the host's pick is one relayed message: " + JSON.stringify(moved && { v: moved.v, by: moved.by }));
  await tv.waitForFunction(() => window.__room3d?.skin.id === "camp", null, { timeout: 30000 }).catch(() => {});
  await phone.waitForFunction(() => window.__room3d?.skin.id === "camp", null, { timeout: 30000 }).catch(() => {});
  check((await skins()).join() === "camp,camp", "every device moves to the campfire: " + (await skins()).join());
  check((await tv.evaluate(() => window.__dimmed)) && (await phone.evaluate(() => window.__dimmed)), "with the lights going down and up on each");
  await sleep(1200);
  check((await tv.locator(".room-dim.on").count()) === 0, "and the lights are up again");
  await shot(tv, "05-screen-campfire");
  await shot(phone, "06-phone-campfire");
  const noted = await phone.evaluate(() => window.__notes);
  check(noted.some((t) => /Ada picked the campfire/.test(t)), "a note says who moved the party where: " + noted.join(" | "));

  // Not by a guest's message either: the room is the judge.
  watcher.send({ t: "pick", v: "roof" });
  const refusedGuest = await watcher.wait((m) => m.t === "pick-no", 4000).catch(() => null);
  check(refusedGuest?.why === "Only the host picks the room.", "a guest's pick message is refused by the room: " + refusedGuest?.why);

  // A latecomer gets the party's room.
  const late = await open("late phone", { width: 390, height: 844 }, { deviceScaleFactor: 2, hasTouch: true }, true);
  await join(late, pin, "Cy", "&gl=any");
  await late.waitForSelector(".look3d canvas", { timeout: 60000 });
  check((await late.evaluate(() => window.__room3d?.skin.id)) === "camp", "a latecomer arrives in the campfire");
  await sleep(800);
  await shot(late, "07-upright-latecomer-campfire");
  await late.click(".rooms-btn");
  await sleep(500);
  await shot(late, "08-upright-picker");
  await late.click("text=Done");

  // The count: everyone stands in Coin Flip's light. The guest page's picker says why it is shut.
  // The other pages leave (their pieces fade after the grace); Ada's page and Wes's socket vote.
  for (const p of [phone, late, tv]) {
    await p.click(".door-btn");
    await p.click(".sheet .choice");
  }
  await host.bringToFront();
  await sleep(1500);
  // Wes stands in the light; Ada's page walks there.
  let mark = watcher.seen.length;
  watcher.goto(light(COIN, 40));
  await walkAda(light(COIN, -40));
  const counting = await watcher.wait((m) => m.t === "vote" && m.vote.count, 6000, mark).catch(() => null);
  check(!!counting, "the count runs");
  await host.click(".rooms-btn");
  const lockLine = await host.locator(".picker-why").textContent();
  check(/count is running/.test(lockLine), `the picker says why it is shut during the count: "${lockLine}"`);
  await shot(host, "09-laptop-picker-during-count");
  await host.click(".room-card[data-room=roof]", { force: true });
  const quiet = await watcher.wait((m) => m.t === "pick", 1500).catch(() => null);
  check(!quiet, "and the host's tap does nothing then");
  await host.keyboard.press("Escape");
  const started = await watcher.wait((m) => m.t === "start", 15000, mark).catch(() => null);
  check(started?.room.phase === "playing", "Coin Flip starts");
  watcher.send({ t: "pick", v: "roof" });
  const inGame = await watcher.wait((m) => m.t === "pick-no", 3000).catch(() => null);
  check(!!inGame, "no pick is taken during a game");
  await watcher.wait((m) => m.t === "end", 12000, mark).catch(() => null);
  check(watcher.room.room === "camp", "the party is still in the campfire after it");

  // It survives the room sleeping: nobody touches it for a while.
  console.log("     leaving the room alone for 25 seconds...");
  await sleep(25_000);
  const inner = await fetch(`${api}/debug/${code}`).then((r) => r.json()).catch(() => null);
  if (inner?.room) {
    console.log(`     the room object ${inner.room.wokeAgo < 20_000 ? "was put to sleep and woken by this check" : "stayed in memory"} (${inner.room.wokeAgo} ms)`);
    check(inner.room.view.room === "camp", `after the quiet, the party is still in the campfire (${inner.room.view.room})`);
  }

  // ---------------------------------------------------------------- leaving: a player, from a sideways phone
  const leaver = await open("leaving phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await join(leaver, pin, "Dee");
  await shot(leaver, "10-phone-door-button-says-leave");
  await leaver.click(".door-btn");
  await shot(leaver, "11-phone-leave-sheet");
  await leaver.click(".sheet .choice");
  await leaver.waitForURL(base + "/", { timeout: 8000 });
  const left = await chip(leaver);
  check(left?.startsWith(`You left party ${pin}.`) && /Rejoin/.test(left), `leaving lands on the front page with a line and Rejoin: "${left}"`);
  check((await leaver.locator("text=Start a party").count()) > 0, "the front page offers Start a party and Join with a code beside it");
  await shot(leaver, "12-phone-front-you-left");
  await leaver.click(".note-act");
  await leaver.waitForSelector(".bar", { timeout: 15000 });
  check(watcher.room.members.some((m) => m?.name === "Dee" && m.connected), "Rejoin takes the player straight back into the party");
  await leaveRoom(leaver);
  await chip(leaver);
  await leaver.click(".note-close");
  await sleep(400);
  await leaver.reload();
  await sleep(1500);
  check((await leaver.locator(".note-chip").count()) === 0, "a dismissed line stays dismissed");

  // The same on an upright phone and on the laptop.
  const upright = await open("upright phone", { width: 390, height: 844 }, { deviceScaleFactor: 2, hasTouch: true });
  await join(upright, pin, "Eve");
  await leaveRoom(upright);
  check((await chip(upright))?.startsWith(`You left party ${pin}.`), "an upright phone lands on the front page the same way");
  await shot(upright, "13-upright-front-you-left");

  // ---------------------------------------------------------------- the room's screen stops showing it
  const tv2 = await open("screen leaving", { width: 1920, height: 1080 });
  await join(tv2, pin, "", "&as=screen");
  const tvWords = await tv2.locator(".door-btn").innerText();
  check(tvWords.trim() === "Stop showing", `the screen's door button says what it does: "${tvWords.trim()}"`);
  await tv2.click(".door-btn");
  const sheetWords = await tv2.locator(".sheet").innerText();
  check(/Stop showing the room/.test(sheetWords), "and its sheet offers to stop showing the room");
  await tv2.click(".sheet .choice");
  await tv2.waitForURL(base + "/", { timeout: 8000 });
  const stopped = await chip(tv2);
  check(stopped?.startsWith(`This screen stopped showing party ${pin}.`) && /Show it again/.test(stopped), `the screen lands on the front page: "${stopped}"`);
  await shot(tv2, "14-screen-front-stopped-showing");
  await tv2.click(".note-act");
  await tv2.waitForSelector(".bar-screen", { timeout: 15000 });
  check(true, "Show it again makes it the room's screen again");

  // ---------------------------------------------------------------- the screen's place is taken while it was away
  await tv2.goto("about:blank");
  console.log("     the screen is away for 16 seconds...");
  await sleep(16_500);
  const other = await call("POST", "/join/" + pin, { as: "screen" });
  check(other.ok, "after the screen's grace, another device becomes the room's screen");
  const otherWs = connect(other);
  await otherWs.opened;
  keepAlive(otherWs);
  await tv2.goto(`${base}/lobby/`);
  await tv2.waitForURL(base + "/", { timeout: 10000 });
  const taken = await chip(tv2);
  check(taken?.startsWith(`Another screen is showing party ${pin} now.`) && /Join as a player/.test(taken), `the old screen comes back to the front page and is offered a seat: "${taken}"`);
  await shot(tv2, "15-screen-front-another-screen");

  // ---------------------------------------------------------------- a player's seat is given up after a drop
  const dropper = await open("dropping phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await join(dropper, pin, "Fay");
  await dropper.goto("about:blank");
  console.log("     a phone drops for longer than its seat is held (12 s and then 120 s)...");
  await sleep(135_000);
  watcher.goto(light(COIN, 200)); // a move, so the room looks at its clock
  await sleep(1500);
  await dropper.goto(`${base}/lobby/`);
  await dropper.waitForURL(base + "/", { timeout: 10000 });
  const lost = await chip(dropper);
  check(lost?.startsWith(`You were away too long, so party ${pin} let your seat go.`) && /Rejoin/.test(lost), `a dropped phone lands on the front page with the way back: "${lost}"`);
  await shot(dropper, "16-phone-front-seat-given-up");

  // ---------------------------------------------------------------- the lines for a room that closed
  const front = await open("front page", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await front.goto(base + "/");
  for (const [kind, said] of [
    ["room_idle", "Party 4821 closed: nobody moved for twenty minutes."],
    ["room_expired", "Party 4821 is over: a party lasts four hours."],
    ["allowance_spent", "Party rooms are closed for today. Each game still plays on its own page."],
    ["room_closed", "Party 4821 has ended."],
  ]) {
    await front.evaluate(([k]) => sessionStorage.setItem("party-room:note", JSON.stringify({ kind: k, pin: "4821", at: Date.now() })), [kind]);
    await front.reload();
    const text = await chip(front);
    check(text?.startsWith(said), `${kind}: "${text}"`);
    if (kind === "room_idle") await shot(front, "17-phone-front-room-closed");
    await front.reload();
    await sleep(600);
    check((await front.locator(".note-chip").count()) === 0, `${kind}: said once, not again on a reload`);
  }

  // A rejoin that cannot work: nothing shows, nothing moves, nothing flashes.
  await front.evaluate(() => sessionStorage.setItem("party-room:note", JSON.stringify({ kind: "left", pin: "0001", at: Date.now() })));
  await front.evaluate(() => (window.__seen = 0));
  await front.reload();
  await front.evaluate(() => new MutationObserver(() => document.querySelector(".note-chip") && (window.__seen = 1)).observe(document.body, { childList: true }));
  await sleep(2500);
  check(front.url() === base + "/" && (await front.locator(".note-chip").count()) === 0 && !(await front.evaluate(() => window.__seen)), "a party that has gone: no chip, no flash, the page stays");

  // ---------------------------------------------------------------- the way in: a wrong code, a full party, a second screen
  await front.goto(base + "/");
  await front.fill("#join", "0001");
  await front.click(".join button");
  await front.fill("input[name=nickname]", "Gus");
  await sleep(600);
  const unknown = await front.locator(".door-who").textContent();
  check(/No party has that code/.test(unknown), `a wrong code is said as soon as it is typed: "${unknown}"`);
  await front.click("button[type=submit]");
  const wrong = await front.locator(".door-error:not([hidden])").textContent({ timeout: 5000 }).catch(() => "");
  check(/No open room matches that/.test(wrong) && (await front.locator("text=Start a party instead").count()) === 1, `and joining says so, with Start a party beside it: "${wrong}"`);
  await shot(front, "18-phone-wrong-code");

  // Fill the party: Ada, Wes and two more.
  const filler = [];
  for (const nickname of ["Hal", "Ivy"]) {
    const s = await call("POST", "/join/" + pin, { nickname });
    if (s.ok) {
      const c = connect(s);
      await c.opened;
      filler.push(c);
    }
  }
  keepAlive(...filler);
  const full = await open("fifth phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await full.goto(`${base}/lobby/?join=${pin}`);
  await full.fill("input[name=nickname]", "Jo");
  await full.click("button[type=submit]");
  const fullWords = await full.locator(".door-error:not([hidden])").textContent({ timeout: 5000 }).catch(() => "");
  check(/full/i.test(fullWords) && (await full.locator("text=Start a party instead").count()) === 1, `a full party says so and offers a party of your own: "${fullWords}"`);
  await shot(full, "19-phone-party-full");
  const second = await open("second screen", { width: 1280, height: 800 });
  await second.goto(`${base}/lobby/?join=${pin}&as=screen`);
  await sleep(700);
  const offered = await second.locator(".door-card").innerText();
  check(!/Show the room here/.test(offered) && /Join/.test(offered), "a second screen is not offered the screen, only a seat");
  await shot(second, "20-laptop-second-screen");

  // ---------------------------------------------------------------- the outside game's send-off: "Stay in the room"
  for (const c of filler) c.ws.close();
  await sleep(800);
  // Ada and Wes stand in Who Am I?'s light; Ada stays.
  watcher.goto(light(WHO, 40));
  await walkAda(light(WHO, -40));
  await host.waitForSelector(".card.away", { timeout: 15000 }).catch(() => {});
  check((await host.locator(".card.away").count()) === 1, "an outside game's send-off card comes up");
  await host.click("text=Stay in the room");
  await sleep(7000);
  check(host.url().startsWith(base + "/lobby/") && (await host.locator(".bar").count()) === 1 && (await host.locator(".card").count()) === 0, "Stay in the room keeps you in the live room, with nothing over it");
  await shot(host, "21-laptop-stayed");
} finally {
  for (const t of timers) clearInterval(t);
  await browser.close();
  await soft.close();
}
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 6).join("; ") : ""));
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
