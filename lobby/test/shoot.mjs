// A run through the party room in real pages, with a still of every state on a big screen and
// on a phone, against a running local server. The browser is headless and muted, and is closed
// at the end whatever happens.
//
//   node lobby/test/shoot.mjs [--base=http://localhost:8791] [--out=lobby/test/shots]
//
// One page is the room's big screen (1920 x 1080), one is a player's phone held sideways
// (844 x 390) and, at the end, one is a phone held upright (390 x 844). The other players are
// plain sockets (lobby/test/client.mjs), so each state can be set up exactly.
// It also checks what a still cannot show at a glance: no page errors, no text spilling out of
// its box, and no page scrolling sideways.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { boxCentre, lightHalf } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots"));
mkdirSync(out, { recursive: true });
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const N = 5;
const [CORK, COIN] = [0, 1];
const light = (i, off = 0) => Math.round(boxCentre(i, N) + off);
const dark = (i) => Math.round(boxCentre(i, N) + lightHalf(N) + 22);

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
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

  /**
   * What a still cannot be trusted to show: text wider than the box it sits in. Every sign's
   * lines must fit the sign, every bar's children must fit the bar, and the page must not scroll.
   */
  async function tidy(page, name) {
    const found = await page.evaluate(() => {
      const bad = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > innerWidth + 1) bad.push(`page is ${doc.scrollWidth} wide in a ${innerWidth} window`);
      for (const bar of document.querySelectorAll(".bar")) {
        const box = bar.getBoundingClientRect();
        for (const el of bar.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < box.left - 1 || r.right > box.right + 1)) bad.push(`"${el.textContent.slice(0, 30)}" leaves the bar`);
        }
        const kids = [...bar.children].map((k) => k.getBoundingClientRect()).filter((r) => r.width && r.height);
        // Children share a row only when their middles line up; a wrapped row sits below.
        for (let i = 1; i < kids.length; i++) {
          const sameRow = Math.abs(kids[i].top + kids[i].height / 2 - (kids[i - 1].top + kids[i - 1].height / 2)) < kids[i].height / 2;
          if (sameRow && kids[i].left < kids[i - 1].right - 1) bad.push("bar children overlap");
        }
      }
      for (const el of document.querySelectorAll(".status-main, .status-sub, .who-name, .card-title")) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis") bad.push(`"${el.textContent.slice(0, 30)}" is clipped`);
      }
      // In the room: every line of text marked to fit a width does fit it.
      for (const el of document.querySelectorAll("svg.scene [data-fit]")) {
        if (el.getComputedTextLength() > Number(el.dataset.fit) + 0.5) bad.push(`"${el.textContent}" is wider than its place`);
      }
      return bad;
    });
    check(found.length === 0, `${name}: nothing spills or overlaps` + (found.length ? ": " + [...new Set(found)].join("; ") : ""));
  }

  // ---------------------------------------------------------------- the way in
  const front = await open("front", { width: 1280, height: 800 });
  await front.goto(base + "/");
  check((await front.locator("text=Start a party").count()) > 0 && (await front.locator("text=Join with a code").count()) > 0, "the front page offers Start a party and Join with a code");
  await shot(front, "00-front-page");
  const cork = await front.request.get(base + "/cork-and-bell/");
  check(cork.ok() && (await cork.text()).includes("party-kit/client/lobby.css"), "Cork & Bell's own page is still served at /cork-and-bell/");
  await front.click("a.button");
  await front.waitForSelector(".door-title");
  await shot(front, "01-start-a-party");
  await front.close();

  // The big screen starts the party and holds no seat.
  const screen = await open("screen", { width: 1920, height: 1080 });
  await screen.goto(base + "/lobby/?start");
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  const pin = (await screen.locator(".code-digits").textContent()).trim();
  check(/^\d{4}$/.test(pin), "the big screen shows the room and its code (" + pin + ")");
  await sleep(600);
  await shot(screen, "02-screen-empty-room");
  await tidy(screen, "big screen, empty room");

  // A phone held sideways joins with the code.
  const phone = await open("phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await phone.goto(base + "/lobby/?join=" + pin);
  await phone.waitForSelector(".door-title");
  await phone.fill("input[name=nickname]", "Dolly");
  await shot(phone, "03-phone-join");
  await phone.click("text=Join the party");
  await phone.waitForSelector("svg.scene text");
  await sleep(900);
  await shot(phone, "04-phone-alone-closer");
  await tidy(phone, "phone, alone");
  await shot(screen, "05-screen-one-player");
  const whyNot = await screen.evaluate(() => [...document.querySelectorAll("svg.scene text")].filter((t) => !t.closest("[display=none]")).map((t) => t.textContent).filter((t) => /Needs|Coming soon/.test(t)));
  check(whyNot.includes("Needs 2 players") && !whyNot.includes("Needs a player") && whyNot.filter((t) => t === "Coming soon").length === 3, "a game the party cannot play says why: " + [...new Set(whyNot)].join(", "));

  // Three more players, as sockets.
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
  /** Walks the phone's piece to x with the keyboard, as a player would. */
  async function walkTo(x) {
    for (let i = 0; i < 12; i++) {
      await sleep(120);
      const gap = x - (mabel.seen.findLast((m) => m.t === "m" && m.s === 0)?.x ?? dollyX());
      if (Math.abs(gap) < 14) return;
      await key(gap > 0 ? "ArrowRight" : "ArrowLeft", Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
    }
  }
  mabel.goto(light(CORK, -40));
  fitch.goto(light(CORK, 45));
  await walkTo(light(COIN));
  await sleep(700);
  await shot(screen, "06-screen-vote-waiting-for-tom");
  await tidy(screen, "big screen, vote");
  await shot(phone, "07-phone-vote-closer");
  await tidy(phone, "phone, vote");
  await phone.click(".zoom-btn");
  await sleep(700);
  await shot(phone, "08-phone-vote-whole-room");
  await tidy(phone, "phone, whole room");
  await phone.click(".zoom-btn");
  const waiting = await screen.locator(".status-sub").textContent();
  check(/Waiting for\s*Tom/.test(waiting), 'the big screen says who is in the dark: "' + waiting.replace(/\s+/g, " ").trim() + '"');

  // A jump and a bump, mid-air.
  tom.goto(light(COIN, 70));
  tom.goto(dark(COIN));
  await phone.keyboard.press("Space");
  await sleep(200);
  await shot(phone, "09-phone-jump");
  fitch.send({ t: "m", x: fitch.x, d: -1, r: fitch.rev });
  fitch.send({ t: "m", x: fitch.x, d: 0, r: fitch.rev });
  fitch.send({ t: "b" });
  await sleep(140);
  await shot(screen, "10-screen-bump");
  await sleep(500);
  mabel.goto(light(CORK, -40));

  // ---------------------------------------------------------------- the count, the game and back
  tom.goto(light(COIN, 60));
  mabel.goto(light(COIN, -60));
  await sleep(450);
  await shot(screen, "11-screen-count");
  await tidy(screen, "big screen, count");
  await shot(phone, "12-phone-count");
  const counting = await screen.locator(".status-main").textContent();
  check(/Coin Flip starts in [123]\./.test(counting), 'a visible count: "' + counting + '"');
  await screen.waitForSelector(".flip", { timeout: 6000 });
  await sleep(500);
  await shot(screen, "13-screen-game-coin-flip");
  await shot(phone, "14-phone-game-coin-flip");
  await screen.waitForSelector(".card .places", { timeout: 8000 });
  await sleep(300);
  await shot(screen, "15-screen-result");
  await shot(phone, "16-phone-result");
  await tidy(phone, "phone, result");
  await screen.waitForSelector(".card", { state: "detached", timeout: 9000 });
  await sleep(300);
  await shot(screen, "17-screen-back-with-scores");
  await tidy(screen, "big screen, back with scores");
  const board = await screen.evaluate(() => [...document.querySelectorAll("svg.scene .t-chalk")].map((t) => t.textContent).join(" "));
  check(/after 1 game/.test(board) && /Dolly/.test(board), "the Tonight board shows the game and the players: " + board.replace(/\s+/g, " ").slice(0, 90));

  // ---------------------------------------------------------------- a tie
  mabel.goto(light(CORK, -45));
  fitch.goto(light(CORK, 45));
  tom.goto(light(COIN, 55));
  await walkTo(light(COIN, -40));
  await screen.waitForFunction(() => /tie/i.test(document.querySelector(".status-main")?.textContent ?? ""), null, { timeout: 12000 });
  await sleep(300);
  await shot(screen, "18-screen-tie-count");
  await screen.waitForFunction(() => document.querySelector(".chip")?.textContent === "TIE", null, { timeout: 6000 });
  await sleep(900);
  await shot(screen, "19-screen-coin-toss");
  await tidy(screen, "big screen, coin toss");
  await shot(phone, "20-phone-coin-toss");
  await tidy(phone, "phone, coin toss");
  await sleep(1700);
  await shot(screen, "21-screen-coin-landed");
  await screen.waitForSelector(".card", { timeout: 9000 });
  await sleep(300);
  const standIn = (await screen.locator(".card-kicker").first().textContent()) === "NOT IN THE ROOM YET";
  await shot(screen, standIn ? "22-screen-cork-and-bell-not-yet" : "22-screen-second-result");
  await shot(phone, standIn ? "23-phone-cork-and-bell-not-yet" : "23-phone-second-result");
  await tidy(phone, "phone, after the toss");
  await screen.waitForSelector(".card", { state: "detached", timeout: 9000 });

  // ---------------------------------------------------------------- leaving
  await sleep(300);
  mabel.goto(light(CORK, -40));
  fitch.goto(light(CORK, 40));
  tom.goto(light(COIN, 0));
  await sleep(300);
  tom.ws.close();
  await sleep(700);
  await shot(screen, "24-screen-reconnecting");
  await tidy(screen, "big screen, reconnecting");
  await shot(phone, "25-phone-reconnecting");
  const grey = await screen.evaluate(() => [...document.querySelectorAll("svg.scene text")].some((t) => t.textContent === "Tom - reconnecting..."));
  check(grey, "a dropped phone's piece is marked reconnecting");
  await phone.click(".door-btn");
  await sleep(300);
  await shot(phone, "26-phone-door-button");
  await tidy(phone, "phone, door sheet");
  check((await phone.locator("text=Leave the party").count()) === 1, "the door button offers Leave the party");
  await phone.click("text=Stay");
  console.log("     waiting for the dropped phone's grace to run out (30 seconds)...");
  await screen.waitForSelector(".note", { timeout: 40000 });
  await sleep(450);
  await shot(screen, "27-screen-tom-left");
  await shot(phone, "28-phone-tom-left");
  check((await screen.locator(".note").textContent()) === "Tom left", "then it fades and a note says Tom left");

  // ---------------------------------------------------------------- an upright phone
  const upright = await open("upright", { width: 390, height: 844 }, { deviceScaleFactor: 2, hasTouch: true });
  await upright.goto(base + "/lobby/?join=" + pin);
  await upright.fill("input[name=nickname]", "Pip");
  await shot(upright, "29-upright-join");
  await upright.click("text=Join the party");
  await upright.waitForSelector("svg.scene text");
  await sleep(900);
  await upright.locator("[aria-label='Walk right']").dispatchEvent("pointerdown", { pointerId: 1 });
  await sleep(700);
  await upright.locator("[aria-label='Walk right']").dispatchEvent("pointerup", { pointerId: 1 });
  await sleep(400);
  await shot(upright, "30-upright-turn-your-phone");
  await tidy(upright, "upright phone");
  check((await upright.locator(".turn-hint").isVisible()) && (await upright.locator("[aria-label='Jump']").isVisible()), "an upright phone gets a turn-your-phone hint and still works");
  const moved = await mabel.wait((m) => m.t === "m" && m.s === 3 && m.x > 200, 3000, 0).catch(() => null);
  check(!!moved, "its walk button moves its piece for everyone");

  // A player on a laptop: the whole room, with the same buttons.
  await upright.setViewportSize({ width: 1280, height: 720 });
  await sleep(700);
  await shot(upright, "31-laptop-player");
  await tidy(upright, "laptop player");

  // Leave the party from the phone.
  await phone.click(".door-btn");
  await phone.click("text=Leave the party");
  await phone.waitForSelector("text=You left the party");
  await shot(phone, "32-phone-left");
  await sleep(300);
  await shot(screen, "33-screen-dolly-left");

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
