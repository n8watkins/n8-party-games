// End to end, on touch: does a host's tap on a room card change the room? In real pages
// (headless and muted, phones emulated with touch), the ways a host can come to the picker:
//
//   node lobby/test/e2e-room-pick.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/room-pick]
//
// - A phone that started the party alone, standing by the door: a tap changes the room at
//   once, the card says "Going there" first, and the picker closes as the lights go down.
// - The same phone standing in a light (alone, that starts the count): every card looks
//   disabled and the picker says to step out of the light; a tap on a card says it again.
// - Straight after a change: the cards wait the few seconds and say how many.
// - After a reload, and after leaving and rejoining: still the host, and a tap still works.
// - A party started on a big screen: the first phone to join picks (the screen can too).
// - A guest's picker says who picks, and its cards look disabled.
// The 3D pages draw in software (?gl=any): they are checked for the room they draw, not speed.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/room-pick"));
mkdirSync(out, { recursive: true });
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
try {
  async function phone(name) {
    const page = await (await browser.newContext(PHONE)).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }
  const skin = (page) => page.evaluate(() => window.__room3d?.skin.id);
  const session = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")));
  /** Opens the picker and taps a card; returns what the page said and did. */
  async function tapCard(page, id) {
    await page.tap(".rooms-btn");
    await page.waitForSelector(".picker");
    await page.tap(`.room-card[data-room=${id}]`, { force: true });
    const going = await page.locator(`.room-card[data-room=${id}].going`).count();
    const why = (await page.locator(".picker-why:not([hidden])").textContent({ timeout: 300 }).catch(() => "")) ?? "";
    return { going, why };
  }
  const waitSkin = (page, id) => page.waitForFunction((want) => window.__room3d?.skin.id === want, id, { timeout: 30000 }).then(() => true, () => false);

  // ---------------------------------------------------------------- a phone starts the party alone
  const nat = await phone("host phone");
  await nat.goto(`${base}/lobby/?start&gl=any`);
  await nat.fill("input[name=nickname]", "Nat");
  await nat.tap("button[type=submit]");
  await nat.waitForSelector(".look3d canvas", { timeout: 60000 });
  await sleep(1500);
  check((await nat.locator(".rooms-hint").count()) === 1, "the first time, a bubble says what Rooms is for");
  await nat.screenshot({ path: `${out}/01-host-phone-rooms-hint.png` });
  let tap = await tapCard(nat, "ship");
  check(tap.going === 1 && !tap.why, "a host's tap answers at once: the card says it is going there");
  await nat.waitForSelector(".picker", { state: "detached", timeout: 5000 }).catch(() => {});
  check((await nat.locator(".picker").count()) === 0, "and the picker closes when the room answers");

  // Straight after: the cards wait a few seconds, and say so.
  tap = await tapCard(nat, "camp");
  check(/just changed/i.test(tap.why) && (await nat.locator(".room-card.off").count()) >= 5, `straight after a change the cards look disabled and say why: "${tap.why}"`);
  await nat.screenshot({ path: `${out}/02-host-phone-just-changed.png` });
  await nat.tap("text=Done");
  check(await waitSkin(nat, "ship"), "and the room changes to the star lounge, lights down and up");

  // Alone in a light: the count runs, the cards are disabled, and the picker says what to do.
  const { code, pin } = await session(nat);
  const watcher = connect(await call("POST", "/join/" + pin, { as: "screen" }));
  await watcher.opened;
  await watcher.wait((m) => m.t === "hello", 5000, 0);
  // Coin Flip's light: if the count runs out, the test game is three seconds long.
  const x = Math.round(boxCentre(1, 6));
  for (let i = 0; i < 12; i++) {
    const at = watcher.seen.findLast((m) => (m.t === "m" && m.s === 0) || m.room?.members?.[0]);
    const now = at?.room ? at.room.members[0].x : at?.x;
    if (Math.abs(x - now) < 30) break;
    const k = x > now ? "ArrowRight" : "ArrowLeft";
    await nat.keyboard.down(k);
    await sleep(Math.max(50, Math.min(1500, (Math.abs(x - now) / 430) * 1000)));
    await nat.keyboard.up(k);
    await sleep(250);
  }
  await watcher.wait((m) => (m.t === "vote" ? m.vote : m.room?.vote)?.count, 6000).catch(() => null);
  tap = await tapCard(nat, "camp");
  check(/step out of the light/i.test(tap.why) && (await nat.locator(".room-card.off").count()) >= 5, `alone in a light the count runs, every card looks disabled, and the picker says: "${tap.why}"`);
  await nat.screenshot({ path: `${out}/03-host-phone-in-a-light.png` });
  await nat.tap("text=Done");
  // Step out, wait out the rest after a game if one started, and the cards work again.
  for (let i = 0; i < 3; i++) {
    await nat.keyboard.down("ArrowLeft");
    await sleep(800);
    await nat.keyboard.up("ArrowLeft");
  }
  for (let i = 0; i < 60 && (watcher.room.phase !== "lobby" || watcher.room.vote.count); i++) await sleep(500);
  // The rest after a game, if the count ran out and Coin Flip was played.
  await sleep(7000);

  // ---------------------------------------------------------------- after a reload
  // (A reload to the room's own address, with ?gl=any again: this browser has no graphics card.)
  await nat.goto(`${base}/lobby/?gl=any`);
  await nat.waitForSelector(".look3d canvas", { timeout: 60000 });
  await sleep(1200);
  tap = await tapCard(nat, "roof");
  check(tap.going === 1 && (await waitSkin(nat, "roof")), "after a reload the phone is still the host, and a tap changes the room");

  // ---------------------------------------------------------------- after leaving and rejoining
  await nat.tap(".door-btn");
  await nat.tap(".sheet .choice");
  await nat.waitForURL(base + "/", { timeout: 8000 });
  await nat.tap(".note-act");
  await nat.waitForSelector(".bar", { timeout: 60000 });
  await sleep(5000);
  // Back in the room (drawn flat here: the rejoin link has no ?gl=any), so the room's own word is checked.
  let mark = watcher.seen.length;
  tap = await tapCard(nat, "fair");
  const moved = await watcher.wait((m) => m.t === "pick" && m.v === "fair", 6000, mark).catch(() => null);
  check(tap.going === 1 && !!moved, "after leaving and rejoining alone, the phone is the host again, and a tap changes the room");

  // ---------------------------------------------------------------- a guest
  const guest = await phone("guest phone");
  await guest.goto(`${base}/lobby/?join=${pin}&gl=any`);
  await guest.fill("input[name=nickname]", "Bo");
  await guest.tap("button[type=submit]");
  await guest.waitForSelector(".look3d canvas", { timeout: 60000 });
  await sleep(1000);
  tap = await tapCard(guest, "bar");
  check(/only nat can change the room/i.test(tap.why) && (await guest.locator(".room-card.off").count()) >= 6, `a guest's cards look disabled and the picker says who chooses: "${tap.why}"`);
  await guest.screenshot({ path: `${out}/04-guest-phone.png` });
  watcher.ws.close();
  void code;
  void mark;

  // ---------------------------------------------------------------- a party started on a big screen
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await tv.goto(`${base}/lobby/?start&as=screen&gl=any`);
  await tv.click("button[type=submit]");
  await tv.waitForSelector(".look3d canvas", { timeout: 60000 });
  const tvPin = (await session(tv)).pin;
  const first = await phone("first phone");
  await first.goto(`${base}/lobby/?join=${tvPin}&gl=any`);
  await first.fill("input[name=nickname]", "Ada");
  await first.tap("button[type=submit]");
  await first.waitForSelector(".look3d canvas", { timeout: 60000 });
  await sleep(1200);
  tap = await tapCard(first, "arcade");
  check(tap.going === 1 && (await waitSkin(first, "arcade")) && (await waitSkin(tv, "arcade")), "a party started on a big screen: the first phone picks, and the screen follows");
} finally {
  await browser.close();
}
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 4).join("; ") : ""));
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
