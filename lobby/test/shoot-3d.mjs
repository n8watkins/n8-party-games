// A run through the live party room in the 3D look (?look=3d), in real pages, against a
// running local server: the same evening as lobby/test/shoot.mjs, cut down to what the drawing
// changes. The browser is headless and muted, and is closed at the end whatever happens.
//
//   node lobby/test/shoot-3d.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/3d-live] [--room=bar]
//
// One page is the room's big screen (1920 x 1080), one a player's phone held sideways
// (844 x 390), one a phone held upright; the other players are plain sockets
// (lobby/test/client.mjs). It checks what a still cannot show at a glance: that the 3D look
// really is what drew the room, that the words say what the room says, that nothing spills,
// that no page reported an error, and that a device without hardware WebGL gets the flat room.
//
// WSL has no graphics card, so these pages draw WebGL in software (they ask for it with
// ?gl=any): right for a still, wrong for speed. Frame time is lobby/test/measure-3d.mjs.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { boxCentre, lightHalf } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/3d-live"));
const skin = opt("room", "bar");
// --look=baked runs the same evening in the baked look (the bar as a rendered picture; it needs a wall of five
// boxes, so a server started with --var PARTY_TEST_GAMES:off).
const lookName = opt("look", "3d");
const look = `look=${lookName}&room=${skin}&gl=any`;
mkdirSync(out, { recursive: true });
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const errors = [];
  async function open(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const shot = async (page, name) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log("     still: " + name);
  };
  const words = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => !el.hidden && el.offsetParent !== null).map((el) => el.textContent.trim()), selector);
  /** Text wider than its place, bars whose children leave them, and pages that scroll sideways. */
  async function tidy(page, name) {
    const found = await page.evaluate(() => {
      const bad = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`page is ${document.documentElement.scrollWidth} wide in a ${innerWidth} window`);
      for (const el of document.querySelectorAll(".l3-fit, .l3-fits, .l3-name")) if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) bad.push(`"${el.textContent.slice(0, 30)}" is wider than its place`);
      for (const bar of document.querySelectorAll(".bar")) {
        const box = bar.getBoundingClientRect();
        for (const el of bar.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < box.left - 1 || r.right > box.right + 1)) bad.push(`"${el.textContent.slice(0, 30)}" leaves the bar`);
        }
      }
      return bad;
    });
    check(found.length === 0, `${name}: nothing spills` + (found.length ? ": " + [...new Set(found)].join("; ") : ""));
  }

  // ---------------------------------------------------------------- the big screen
  const screen = await open("screen", { width: 1920, height: 1080 });
  await screen.goto(`${base}/lobby/?start&${look}`);
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector(".look3d canvas", { timeout: 60000 });
  await screen.waitForSelector(".l3-sign");
  const pin = (await screen.locator(".code-digits").textContent()).trim();
  check(/^\d{4}$/.test(pin), "the big screen shows the room in 3D and its code (" + pin + ")");
  check((await screen.evaluate(() => window.__room3d?.look)) === lookName && (await screen.locator("svg.scene").count()) === 0, "the 3D look drew it, and the flat drawing is not in the page");
  check((await screen.locator(".l3-pin").textContent()) === pin && (await screen.evaluate(() => document.querySelector(".l3-qr").naturalWidth > 0)), "the code and its QR code are on the wall");
  const boxes = await screen.evaluate(() => window.__room3d.room.boxes.map((b) => b.name));
  const blurbs = await screen.evaluate(() => window.__room3d.room.boxes.map((b) => b.blurb));
  const N = boxes.length;
  const light = (i, off = 0) => Math.round(boxCentre(i, N) + off);
  const dark = (i) => Math.round(boxCentre(i, N) + lightHalf(N) + 22);
  const signs = await words(screen, ".l3-sign .l3-about");
  check(JSON.stringify(signs) === JSON.stringify(blurbs), "one sign per box, from the game list (" + boxes.join(", ") + ")");
  check((await screen.locator(".l3-sign b").count()) === 0, "a game's name is on its box and not on its sign");
  await sleep(1500);
  await shot(screen, "01-screen-empty-room");
  await tidy(screen, "big screen, empty room");

  // ---------------------------------------------------------------- a phone held sideways
  const phone = await open("phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await phone.goto(`${base}/lobby/?join=${pin}&${look}`);
  await phone.fill("input[name=nickname]", "Dolly");
  await phone.click("text=Join the party");
  await phone.waitForSelector(".look3d canvas", { timeout: 60000 });
  await phone.waitForSelector(".l3-tag.you");
  await sleep(1500);
  await shot(phone, "02-phone-alone-closer");
  await tidy(phone, "phone, alone");
  const why = await words(screen, ".l3-why");
  check(why.some((t) => /Needs 2 players/.test(t)) && why.includes("Coming soon"), "a game the party cannot play says why: " + [...new Set(why)].join(", "));

  const sessions = [];
  for (const nickname of ["Mabel", "Fitch", "Tom"]) sessions.push(await call("POST", "/join/" + pin, { nickname }));
  const [mabel, fitch, tom] = sessions.map(connect);
  await Promise.all([mabel, fitch, tom].map((c) => c.opened));
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 8000, 0);

  // ---------------------------------------------------------------- the vote
  const key = async (k, ms) => {
    await phone.keyboard.down(k);
    await sleep(ms);
    await phone.keyboard.up(k);
  };
  const dollyX = () => mabel.room.members[0].x;
  async function walkTo(x) {
    for (let i = 0; i < 14; i++) {
      await sleep(160);
      const gap = x - (mabel.seen.findLast((m) => m.t === "m" && m.s === 0)?.x ?? dollyX());
      if (Math.abs(gap) < 14) return;
      await key(gap > 0 ? "ArrowRight" : "ArrowLeft", Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
    }
  }
  const [CORK, COIN] = [boxes.indexOf("Cork & Bell"), boxes.indexOf("Coin Flip")];
  check(CORK >= 0 && COIN >= 0, "the wall has Cork & Bell and the test game to vote between");
  mabel.goto(light(CORK, -45));
  fitch.goto(light(CORK, 50));
  await walkTo(light(COIN));
  await sleep(1200);
  await shot(screen, "03-screen-vote-waiting-for-tom");
  await tidy(screen, "big screen, vote");
  await shot(phone, "04-phone-vote-closer");
  await tidy(phone, "phone, vote");
  const tags = await words(screen, ".l3-tag");
  check(["Dolly", "Mabel", "Fitch", "Tom"].every((n) => tags.includes(n)), "every piece has its name over it: " + tags.join(", "));
  check((await words(phone, ".l3-tag.you")).join() === "You", "the phone's own piece is marked You");
  const moved = await screen.evaluate(() => [...window.__room3d.pieces.values()].map((p) => Math.round(p.rx)));
  check(Math.abs(moved[0] - light(COIN)) < 40, "the phone's piece walked to the light it was sent to (" + moved[0] + ")");
  await phone.click(".zoom-btn");
  await sleep(900);
  await shot(phone, "05-phone-vote-whole-room");
  await tidy(phone, "phone, whole room");
  await phone.click(".zoom-btn");
  const waiting = await screen.locator(".status-sub").textContent();
  check(/Waiting for\s*Tom/.test(waiting), 'the big screen says who is in the dark: "' + waiting.replace(/\s+/g, " ").trim() + '"');

  // ---------------------------------------------------------------- the room's life
  // Timed events go by the room's own clock, so two devices in a room must agree on what time
  // it is in the room and on when each thing next happens.
  const readLife = (page) => page.evaluate(() => ({ T: window.__room3d.life.T(performance.now()), next: window.__room3d.life.schedule(performance.now()).map((e) => `${e.name}@${e.at.toFixed(2)}`) }));
  const [onScreen, onPhone] = await Promise.all([readLife(screen), readLife(phone)]);
  check(Math.abs(onScreen.T - onPhone.T) < 1.5, `the big screen and the phone agree what time it is in the room (${onScreen.T.toFixed(2)} s and ${onPhone.T.toFixed(2)} s)`);
  check(onScreen.next.length > 0 && onScreen.next.join() === onPhone.next.join(), "and on when each passing thing next comes: " + onScreen.next.slice(0, 3).join(", "));
  // A bump by the room's feature knocks it on every screen, and announces a name a sound system can listen for.
  for (const page of [screen, phone]) await page.evaluate(() => ((window.__heard = []), window.addEventListener("party-room:sound", (e) => window.__heard.push(e.detail.name))));
  tom.goto(1745);
  fitch.goto(1650);
  await sleep(900);
  fitch.send({ t: "m", x: fitch.x, d: 1, r: fitch.rev });
  fitch.send({ t: "m", x: fitch.x, d: 0, r: fitch.rev });
  fitch.send({ t: "b" });
  await sleep(500);
  await shot(screen, "05b-screen-feature-knocked");
  const heard = await Promise.all([screen, phone].map((page) => page.evaluate(() => window.__heard.filter((n) => /^(jukebox|wheel|pigeons|striker|claw|holo|porthole|stall)\./.test(n)))));
  check(heard[0].length > 0 && heard[0].join() === heard[1].join(), "a bump by the room's feature sets it off on both screens, and says so by name: " + heard[0].join(", "));
  const sent = [mabel, fitch, tom].map((c) => c.seen.length);
  await sleep(2500);
  check([mabel, fitch, tom].every((c, i) => c.seen.length === sent[i]), "none of it sends anything: no message reached a player while the room was only being alive");
  fitch.goto(light(CORK, 50));
  await sleep(700);

  // A jump and a bump, mid-air.
  tom.goto(dark(COIN));
  await phone.keyboard.press("Space");
  await sleep(220);
  await shot(phone, "06-phone-jump");
  fitch.send({ t: "m", x: fitch.x, d: -1, r: fitch.rev });
  fitch.send({ t: "m", x: fitch.x, d: 0, r: fitch.rev });
  // The shared story (lobby/shared/bump.js): the bumper winds up and strikes, the other is thrown, lies down, gets up, is safe.
  // The page itself notes what it draws, frame by frame: a test looking in from outside is too slow to catch a tenth of a second.
  await screen.evaluate(() => {
    window.__states = new Set();
    const look = () => {
      for (const p of window.__room3d.pieces.values()) {
        if (p.attack) window.__states.add("attacking");
        if (p.knock) window.__states.add("knocked");
        if (p.pawn.dizzy) window.__states.add("dizzy");
      }
      if ((window.__looks = (window.__looks ?? 0) + 1) < 400) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  fitch.send({ t: "b" });
  await sleep(160);
  await shot(screen, "07-screen-bump");
  await sleep(2200);
  const states = await screen.evaluate(() => [...window.__states]);
  check(["attacking", "knocked", "dizzy"].every((s) => states.includes(s)), "a bump plays the shared story in 3D: " + states.join(", "));
  await sleep(1200);
  mabel.goto(light(CORK, -45));

  // ---------------------------------------------------------------- the count, the game and back
  tom.goto(light(COIN, 62));
  mabel.goto(light(COIN, -62));
  await screen.waitForSelector(".l3-count:not([hidden])", { timeout: 8000 });
  await screen.waitForSelector(".l3-sign.lead", { timeout: 2000 });
  const lead = boxes[blurbs.indexOf(await screen.locator(".l3-sign.lead .l3-about").textContent())];
  // Software drawing makes a still slow, and the game is three seconds long: start waiting for its card now.
  const result = screen.waitForSelector(".card .places", { timeout: 30000 });
  await shot(screen, "08-screen-count");
  await tidy(screen, "big screen, count");
  await shot(phone, "09-phone-count");
  check(lead === "Coin Flip", "the leading box's sign turns gold");
  await result;
  await shot(screen, "10-screen-result");
  await screen.waitForSelector(".card", { state: "detached", timeout: 15000 });
  await sleep(600);
  await shot(screen, "11-screen-back-with-scores");
  await tidy(screen, "big screen, back with scores");
  const board = (await words(screen, ".l3-board")).join(" ");
  check(/after 1 game/.test(board) && /Dolly/.test(board), "the Tonight board shows the game and the players: " + board.replace(/\s+/g, " ").slice(0, 80));

  // ---------------------------------------------------------------- dropping out
  await sleep(300);
  tom.goto(light(COIN, 0));
  await sleep(400);
  tom.ws.close();
  await sleep(900);
  await shot(screen, "14-screen-reconnecting");
  await tidy(screen, "big screen, reconnecting");
  check((await words(screen, ".l3-tag.grey")).join() === "Tom - reconnecting...", "a dropped phone's piece is marked reconnecting");
  await phone.click(".door-btn");
  await sleep(300);
  await shot(phone, "15-phone-door-button");
  await phone.click("text=Stay");
  // The phone's player leaves for good, which frees a seat for the next device.
  await phone.click(".door-btn");
  await phone.click("text=Leave the party");
  await phone.waitForSelector("text=You left the party");

  // ---------------------------------------------------------------- an upright phone, then a laptop
  const upright = await open("upright", { width: 390, height: 844 }, { deviceScaleFactor: 2, hasTouch: true });
  await upright.goto(`${base}/lobby/?join=${pin}&${look}`);
  await upright.fill("input[name=nickname]", "Pip");
  await upright.click("text=Join the party");
  await upright.waitForSelector(".look3d canvas", { timeout: 150000 });
  await upright.waitForSelector(".l3-tag.you");
  await sleep(1500);
  await shot(upright, "16-upright-turn-your-phone");
  await tidy(upright, "upright phone");
  check(await upright.locator(".turn-hint").isVisible(), "an upright phone gets the turn-your-phone hint over the 3D room");
  await upright.setViewportSize({ width: 1366, height: 768 });
  await sleep(1800);
  await shot(upright, "17-laptop-player");
  await tidy(upright, "laptop player");

  // ---------------------------------------------------------------- leaving, and no WebGL
  await upright.click(".door-btn");
  await upright.click("text=Leave the party");
  await upright.waitForSelector("text=You left the party");
  check((await upright.locator(".look3d").count()) === 0, "leaving takes the 3D room out of the page");

  // ---------------------------------------------------------------- a tie
  // Last, because whichever game wins it, the room is done with here: only the test game plays
  // inside the room, and any other winner sends every page off to that game's own site.
  mabel.goto(light(CORK, 0));
  fitch.goto(light(COIN, 0));
  await screen.waitForFunction(() => document.querySelector(".chip")?.textContent === "TIE", null, { timeout: 30000 });
  const tossed = (await words(screen, ".l3-chip")).length === 2 && (await screen.locator(".l3-toss").isVisible());
  await sleep(600);
  await shot(screen, "12-screen-coin-toss");
  await tidy(screen, "big screen, coin toss");
  check(tossed, "a tie is a coin toss everybody watches, heads on one box and tails on the other");

  // ---------------------------------------------------------------- nobody else pays for it
  // A device that never asked for the 3D look gets today's flat room and downloads none of the
  // 3D look: not its scripts, not three.js, not its fonts or pictures.
  const flatContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const flatPage = await flatContext.newPage();
  const fetched = [];
  flatPage.on("request", (r) => fetched.push(new URL(r.url()).pathname));
  await flatPage.goto(`${base}/lobby/?start`);
  await flatPage.click("text=Use this as the room's screen");
  await flatPage.click("text=Show the room here");
  await flatPage.waitForSelector("svg.scene text");
  await sleep(1500);
  const extra = fetched.filter((path) => /look3d|three|\/vendor\/|AbrilFatface/.test(path));
  check((await flatPage.locator(".look3d").count()) === 0 && extra.length === 0, "without ?look=3d the room is the flat one and nothing of the 3D look is downloaded (" + fetched.length + " requests" + (extra.length ? ", but: " + extra.join(", ") : "") + ")");
  await flatContext.close();

  // A page that asks for 3D in a browser with no WebGL at all gets the flat room, and says so
  // once in the console, which is a warning and not an error of the page's.
  const bare = await chromium.launch({ headless: true, args: ["--mute-audio", "--disable-3d-apis"] });
  try {
    const plain = await (await bare.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    plain.on("pageerror", (e) => errors.push(`no-webgl: ${e.message}`));
    // A room has one screen, and this room's is the page above, so this browser starts a party of its own.
    await plain.goto(`${base}/lobby/?start&look=3d`);
    await plain.click("text=Use this as the room's screen");
    await plain.click("text=Show the room here");
    const flat = await plain.waitForSelector("svg.scene text", { timeout: 20000 }).catch(() => null);
    check(!!flat && (await plain.locator(".look3d").count()) === 0, "without WebGL a device that asked for 3D gets the flat drawing");
    if (flat) await plain.screenshot({ path: `${out}/18-no-webgl-falls-back-to-flat.png` });
  } finally {
    await bare.close();
  }

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""));
  for (const c of [mabel, fitch]) c.ws.close();
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good. Stills are in " + out);
process.exit(problems.length ? 1 : 0);
