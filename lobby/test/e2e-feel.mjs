// How the room feels, checked end to end in real pages and over real sockets, against a running
// local server. The browser is headless and muted, and is closed at the end whatever happens.
//
//   node lobby/test/e2e-feel.mjs [--base=http://localhost:8791] [--out=lobby/test/shots]
//
// What it goes through, each as a player would meet it:
//   the way in     a phone leads with playing; a wide screen is offered both; a room has one screen
//   the buttons    one family of four, each named, with bump the accent and jump like the walk buttons
//   the cooldown   a ring round the bump button, dim until ready, a pulse, and the room enforcing it
//   the bump       wind-up, strike, the knock-back, getting up, the safe time after, and nobody kept down
//   the board      a tap opens it large; a tap, Escape or the back gesture closes it; the vote carries on
//   the cost       a bump sets no timer and no wake-up
//
// Stills of each land in --out with names starting "f"; the bump's are taken with the page's
// clock held still, so they show exactly the moments named.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { SCREEN_GRACE_MS } from "../server/lobby-core.js";
import { BUMP_COOLDOWN_MS, DOWN_MS, FLIGHT_MS, HIT_PAUSE_MS, IMMUNE_MS, IMPACT_MS, KNOCK_MIN, STUN_MS, WINDUP_MS, knockLanding } from "../shared/bump.js";
import { ROOM, boxCentre, lightAt, lightHalf } from "../shared/world.js";
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
const section = (name) => console.log("\n     -- " + name);
/** What the room budget has counted, or one room's inner state (the local server's debug door). */
const debug = async (code = "") => (await fetch(api + "/debug" + (code ? "/" + code : ""))).json();

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
  const PHONE = [{ width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true }];
  const UPRIGHT = [{ width: 390, height: 844 }, { deviceScaleFactor: 2, hasTouch: true }];
  const shot = async (page, name, clip = undefined) => {
    await page.screenshot({ path: `${out}/${name}.png`, clip });
    console.log("     still: " + name);
  };
  const top = async (page, selector) => (await page.locator(selector).first().boundingBox())?.y ?? null;
  const tap = (page, selector) => page.locator(selector).dispatchEvent("pointerdown", { pointerId: 1 });
  /** Nothing wider than the page, and nothing in a bar overlapping or leaving it. */
  async function tidy(page, name) {
    const found = await page.evaluate(() => {
      const bad = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push("the page scrolls sideways");
      for (const bar of document.querySelectorAll(".bar")) {
        const box = bar.getBoundingClientRect();
        const kids = [...bar.querySelectorAll(".ctl, .pill-btn, .status")].map((k) => k.getBoundingClientRect()).filter((r) => r.width);
        for (const r of kids) if (r.left < box.left - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1) bad.push("something leaves the bar");
        const row = (r) => Math.round((r.top + r.height / 2) / 20);
        kids.sort((p, q) => row(p) - row(q) || p.left - q.left);
        for (let i = 1; i < kids.length; i++) if (row(kids[i]) === row(kids[i - 1]) && kids[i].left < kids[i - 1].right - 1) bad.push("buttons overlap");
      }
      for (const el of document.querySelectorAll(".board-name, .door-title, .ctl-word")) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis") bad.push(`"${el.textContent}" is clipped`);
      }
      const board = document.querySelector(".board")?.getBoundingClientRect();
      if (board && (board.left < -1 || board.right > innerWidth + 1)) bad.push("the board is wider than the page");
      return bad;
    });
    check(found.length === 0, `${name}: nothing spills or overlaps` + (found.length ? ": " + [...new Set(found)].join("; ") : ""));
  }

  // ================================================================ the way in
  section("the way in: a phone leads with playing");
  for (const [label, device] of [
    ["upright phone", UPRIGHT],
    ["sideways phone", PHONE],
  ]) {
    const front = await open("front", ...device);
    await front.goto(base + "/");
    const [join, start, minor] = [await top(front, "form.join"), await top(front, "a.start"), await top(front, "a.minor")];
    check(join !== null && start !== null && join < start, `${label}, front page: joining with a code comes first, starting a party second`);
    check(minor !== null && minor > start && (await front.locator("a.minor").textContent()) === "Use this phone as the room's screen", `${label}, front page: being the room's screen is a small link below`);
    const [joinSize, minorSize] = await front.evaluate(() => [parseFloat(getComputedStyle(document.querySelector(".join .button")).fontSize), parseFloat(getComputedStyle(document.querySelector("a.minor")).fontSize)]);
    check(minorSize < joinSize, `${label}, front page: and it is smaller than the buttons (${minorSize}px against ${joinSize}px)`);
    if (label === "upright phone") {
      await shot(front, "f01-upright-front-page");
      await front.click("a.minor");
      await front.waitForSelector(".door-title");
      check((await front.locator(".door .button").textContent()) === "Show the room here" && (await front.locator(".door-swap").textContent()) === "Play on this phone instead", "its link opens the way in as the screen, with the way back to playing one tap away");
    } else await shot(front, "f02-sideways-front-page");
    await front.context().close();
  }
  const wideFront = await open("front", { width: 1280, height: 800 });
  await wideFront.goto(base + "/");
  check((await top(wideFront, "a.start")) < (await top(wideFront, "form.join")) && !(await wideFront.locator("a.minor").isVisible()), "a wide screen's front page leads with starting a party, as before");
  await shot(wideFront, "f03-wide-front-page");
  await wideFront.context().close();

  const door = await open("door", ...UPRIGHT);
  await door.goto(base + "/lobby/?start");
  await door.waitForSelector(".door-title");
  check((await door.locator(".roles").count()) === 0 && (await door.locator("input[name=nickname]").isVisible()) && (await door.locator(".door .button").textContent()) === "Start the party", "a phone starting a party is asked for a name and plays: no choice of roles in the way");
  check((await door.locator(".door-swap").textContent()) === "Use this phone as the room's screen", "with the screen as a small link under the form");
  await door.fill("input[name=nickname]", "Pip");
  await shot(door, "f04-upright-start-leads-with-playing");
  await door.click(".door-swap");
  check((await door.locator(".door .button").textContent()) === "Show the room here" && (await door.locator("input[name=nickname]").count()) === 0, "tapping it makes the phone the screen: no name is asked");
  await shot(door, "f05-upright-start-as-screen");
  await door.click(".door-swap");
  check((await door.locator(".door .button").textContent()) === "Start the party" && (await door.inputValue("input[name=nickname]")) === "Pip", "and tapping again undoes it, with the name still there");
  await door.context().close();

  section("the way in: a wide screen is offered both");
  const screen = await open("screen", { width: 1920, height: 1080 });
  await screen.goto(base + "/lobby/?start");
  await screen.waitForSelector(".door-title");
  const cards = await screen.locator(".role strong").allTextContents();
  check(cards.join("|") === "Play on this device|Use this as the room's screen" && (await screen.locator(".door-swap").count()) === 0, "a wide screen starting a party sees both choices as two cards: " + cards.join(" / "));
  await shot(screen, "f06-wide-start-both-choices");
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector("svg.scene text");
  const pin = (await screen.locator(".code-digits").textContent()).trim();
  check(/^\d{4}$/.test(pin), "the big screen shows the room (" + pin + ")");

  section("one room screen");
  const second = await call("POST", "/join/" + pin, { as: "screen" });
  check(second.status === 409 && second.error === "screen_taken" && /already has its screen/.test(second.message), `a second device asking to be the screen is refused by the room: "${second.message}"`);
  const preview = await call("GET", "/join/" + pin);
  check(preview.preview.screen === true, "looking the code up says the screen is taken");
  const joiner = await open("joiner", ...UPRIGHT);
  await joiner.goto(base + "/lobby/?join=" + pin);
  await joiner.waitForSelector(".door-who:not([hidden])");
  check(!(await joiner.locator(".door-swap").isVisible()) && (await joiner.locator("input[name=nickname]").isVisible()), "a phone joining that party is not offered the screen: it just plays");
  await joiner.fill("input[name=nickname]", "Pip");
  await shot(joiner, "f07-upright-join-screen-taken");
  await joiner.goto(base + "/lobby/?join=" + pin + "&as=screen");
  await joiner.waitForSelector(".door-note:not([hidden])");
  check(/already has its screen/.test(await joiner.locator(".door-note").textContent()) && (await joiner.locator(".door .button").textContent()) === "Join the party", "and a phone that asked to be its screen is told one is there, and offered a seat");
  await joiner.context().close();
  const wideJoin = await open("wide-join", { width: 1280, height: 800 });
  await wideJoin.goto(base + "/lobby/?join=" + pin + "&as=screen");
  await wideJoin.waitForSelector(".door-note:not([hidden])");
  check((await wideJoin.locator(".roles").count()) === 0 && (await wideJoin.locator("input[name=nickname]").isVisible()) && (await wideJoin.locator(".door .button").textContent()) === "Join the party", "a laptop that came to be the screen is offered a seat instead");
  await shot(wideJoin, "f08-wide-join-screen-taken");
  await wideJoin.context().close();

  // A second party, to race for its screen and to time the grace.
  const host = await call("POST", "/rooms", { nickname: "Host" });
  const H = connect(host);
  await H.opened;
  const racer = await open("racer", { width: 1280, height: 800 });
  await racer.goto(base + "/lobby/?join=" + host.pin);
  await racer.waitForSelector(".roles");
  await sleep(400);
  check(await racer.locator(".roles").isVisible(), "a party without a screen offers a wide device both choices when joining");
  await racer.click("text=Use this as the room's screen");
  const s1 = await call("POST", "/join/" + host.pin, { as: "screen" }); // another device gets there first
  const took = Date.now();
  check(s1.ok && s1.role === "screen", "meanwhile another device takes the screen");
  await racer.click("text=Show the room here");
  await racer.waitForSelector(".door-error:not([hidden])");
  const told = await racer.locator(".door-error").textContent();
  check(/screen is already connected/i.test(told) && /join as a player/i.test(told), `the one that lost the race is told: "${told}"`);
  check((await racer.locator(".roles").count()) === 0 && (await racer.locator("input[name=nickname]").isVisible()), "and is offered to join as a player, with the screen no longer on offer");
  await shot(racer, "f09-wide-screen-already-connected");
  await racer.fill("input[name=nickname]", "Rae");
  await racer.click("text=Join the party");
  await racer.waitForSelector("svg.scene text");
  check((await racer.locator(".bar-player").count()) === 1, "it joins as a player");
  await racer.context().close();

  // A third party, whose screen is a real page that loses its connection for longer than the grace.
  const lost = await open("lost-screen", { width: 1280, height: 720 });
  let cut = false;
  const wires = [];
  await lost.routeWebSocket(/\/api\/lobby\/rooms\//, (ws) => {
    if (cut) return void ws.close({ code: 1001, reason: "offline" });
    wires.push([ws, ws.connectToServer()]);
  });
  const party3 = await call("POST", "/rooms", { nickname: "Host" });
  const H3 = connect(party3);
  await H3.opened;
  await lost.goto(base + "/lobby/?join=" + party3.pin);
  await lost.waitForSelector(".roles");
  await lost.click("text=Use this as the room's screen");
  await lost.click("text=Show the room here");
  await lost.waitForSelector("svg.scene text");
  await H3.wait((m) => m.room?.screens === 1, 4000, 0);
  cut = true;
  for (const [page, server] of wires) {
    server.close();
    page.close({ code: 1001, reason: "offline" });
  }
  const cutAt = Date.now();
  await H3.wait((m) => m.t === "room" && m.room.screens === 0, 4000);
  // While the other party's grace is timed below, this one's runs out; then another device takes its place.
  let S3 = null;
  const takeover = sleep(SCREEN_GRACE_MS + 600).then(async () => {
    const s = await call("POST", "/join/" + party3.pin, { as: "screen" });
    check(s.ok, `in a third party the screen's wifi dies; ${Date.now() - cutAt} ms later another device takes its place`);
    S3 = connect(s);
    await S3.opened;
  });

  const S1 = connect(s1);
  await S1.opened;
  await S1.wait((m) => m.t === "hello", 4000, 0);
  S1.ws.close();
  await sleep(300);
  const dropped = Date.now();
  const early = await call("POST", "/join/" + host.pin, { as: "screen" });
  check(early.status === 409, `the screen drops: its place is kept, so a second device is still refused ${Date.now() - dropped} ms later`);
  const back = connect(s1);
  await back.opened;
  const helloBack = await back.wait((m) => m.t === "hello", 4000, 0).catch(() => null);
  check(helloBack?.you.role === "screen", "and the same screen gets back in within the grace (a reload)");
  back.ws.close();
  await sleep(300);
  const droppedAgain = Date.now();
  console.log(`     waiting out the screen's grace (${SCREEN_GRACE_MS / 1000} seconds)...`);
  // Asked well inside the grace: on a loaded machine a request can take a couple of seconds to be answered.
  await sleep(SCREEN_GRACE_MS - 4000 - (Date.now() - droppedAgain));
  const almost = await call("POST", "/join/" + host.pin, { as: "screen" });
  check(almost.status === 409, `still refused ${Date.now() - droppedAgain} ms after it dropped`);
  await sleep(SCREEN_GRACE_MS + 400 - (Date.now() - droppedAgain));
  const s2 = await call("POST", "/join/" + host.pin, { as: "screen" });
  check(s2.ok, `the place frees up ${Date.now() - droppedAgain} ms after the first screen dropped (grace ${SCREEN_GRACE_MS} ms; it took the place ${Date.now() - took} ms ago)`);
  const S2 = connect(s2);
  await S2.opened;
  await S2.wait((m) => m.t === "hello", 4000, 0);
  const late = connect(s1);
  // Node's own WebSocket can sit in "closing" when a socket is refused the moment it opens, so
  // this looks at what matters: the room says nothing to it and its socket is on the way out.
  // (The page further down shows what a browser makes of the same refusal.)
  await Promise.race([late.closed, sleep(1500)]);
  check(late.ws.readyState >= 2 && !late.seen.some((m) => m.t === "hello"), "the first screen, back too late, is turned away: its old place is no longer good");
  const screensNow = (await debug(host.code)).room.view.screens;
  check(screensNow === 1, `and the room has one screen, never two (${screensNow})`);
  S2.send({ t: "leave" });
  await S2.closed;
  const s3 = await call("POST", "/join/" + host.pin, { as: "screen" });
  check(s3.ok, '"Stop showing the room" frees the place at once');
  H.ws.close();
  await takeover;

  // The screen page whose wifi died, back too late: it says another screen has the room and offers a seat.
  cut = false;
  // It lands on the front page, which says so and offers a seat (lobby/test/e2e-leave-rooms.mjs has every way out).
  await lost.waitForSelector(".note-chip", { timeout: 15000 });
  const lostTitle = (await lost.locator(".note-chip > span").first().textContent()).trim();
  const lostLink = lost.locator(".note-chip .note-act");
  check(lostTitle === `Another screen is showing party ${party3.pin} now.` && (await lostLink.textContent()) === "Join as a player" && (await lostLink.getAttribute("href")) === `/lobby/?join=${party3.pin}&rejoin`, `a screen that was away longer than the grace is told "${lostTitle}" and offered "Join as a player"`);
  await shot(lost, "f09b-screen-lost-its-place");
  await lost.context().close();
  H3.ws.close();
  S3.ws.close();

  // ================================================================ the buttons
  section("the buttons: one family, each one named");
  const phone = await open("phone", ...PHONE);
  await phone.goto(base + "/lobby/?join=" + pin);
  await phone.waitForSelector(".door-title");
  await phone.fill("input[name=nickname]", "Dolly");
  await phone.click("text=Join the party");
  await phone.waitForSelector("svg.scene text");
  await sleep(700);
  const mabelSeat = await call("POST", "/join/" + pin, { nickname: "Mabel" });
  const fitchSeat = await call("POST", "/join/" + pin, { nickname: "Fitch" });
  const tomSeat = await call("POST", "/join/" + pin, { nickname: "Tom" });
  const [mabel, fitch, tom] = [mabelSeat, fitchSeat, tomSeat].map(connect);
  await Promise.all([mabel, fitch, tom].map((c) => c.opened));
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 8000, 0);
  const N = mabel.room.boxes.length;
  const COIN = mabel.room.boxes.findIndex((b) => b.id === "coin-flip");
  const litBox = (i) => mabel.room.vote.lights[mabel.room.boxes[i].id] === null;
  /** Makes a socket player face a way without moving. */
  const face = (c, d) => {
    c.send({ t: "m", x: c.x, d, r: c.rev });
    c.send({ t: "m", x: c.x, d: 0, r: c.rev });
  };
  const roomCode = mabelSeat.code;

  const buttons = await phone.evaluate(() =>
    [...document.querySelectorAll(".bar-player .ctl")].map((b) => {
      const r = b.getBoundingClientRect();
      const css = getComputedStyle(b);
      return { name: b.getAttribute("aria-label"), word: b.querySelector(".ctl-word")?.textContent, icon: !!b.querySelector("svg.ctl-icon path"), x: r.left + r.width / 2, w: r.width, h: r.height, radius: css.borderRadius, border: css.borderTopWidth + " " + css.borderTopStyle, background: css.backgroundColor, key: getComputedStyle(b.querySelector(".ctl-key")).display };
    }),
  );
  // Five buttons since the emote wheel joined the bar (emotes/wheel.js): it sits before jump, under the right thumb.
  check(buttons.map((b) => b.word).join() === "Left,Right,Emote,Jump,Bump" && buttons.every((b) => b.icon), "five buttons, each with a picture and a word: " + buttons.map((b) => b.word).join(", "));
  check(new Set(buttons.map((b) => `${b.w}x${b.h}/${b.radius}/${b.border}`)).size === 1 && buttons[0].w >= 48, `they are one family: the same size, shape and outline (${buttons[0].w} x ${buttons[0].h} px)`);
  check(buttons[0].background === buttons[1].background && buttons[1].background === buttons[3].background && buttons[2].background === buttons[3].background, "jump and the emote button look like the walk buttons: " + buttons[3].background);
  check(buttons[4].background !== buttons[3].background && /244, 180, 83/.test(buttons[4].background), "bump alone carries the amber accent when it is ready: " + buttons[4].background);
  const half = 844 / 2;
  check(buttons[0].x < buttons[1].x && buttons[1].x < half && buttons[2].x > half && buttons[3].x > buttons[2].x && buttons[4].x > buttons[3].x, "walking is under the left thumb, emote, jump and bump under the right, bump in the corner");
  check(buttons.every((b) => b.key === "none"), "a phone shows no keyboard hints");
  await shot(phone, "f10-phone-buttons-bump-ready");
  await tidy(phone, "sideways phone, buttons");

  // ================================================================ the cooldown
  section("the cooldown: the room enforces it, the page shows it");
  let mark = mabel.seen.length;
  await tap(phone, ".ctl-bump");
  await tap(phone, ".ctl-bump"); // a second tap straight away does nothing
  await sleep(250);
  const cooling = await phone.evaluate(() => {
    const b = document.querySelector(".ctl-bump");
    return { classes: b.className, label: b.getAttribute("aria-label"), dash: document.querySelector(".ctl-bump .ctl-ring-sweep").getAttribute("stroke-dasharray"), background: getComputedStyle(b).backgroundColor, ring: getComputedStyle(b.querySelector(".ctl-ring")).opacity };
  });
  check(/cooling/.test(cooling.classes) && cooling.label === "Bump, recharging" && !/244, 180, 83/.test(cooling.background) && cooling.ring === "1", "after a bump the button is dim and its ring shows: " + cooling.background);
  await shot(phone, "f11-phone-bump-cooling");
  const fills = [parseFloat(cooling.dash)];
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    fills.push(parseFloat(await phone.locator(".ctl-bump .ctl-ring-sweep").getAttribute("stroke-dasharray")));
  }
  check(fills.every((f, i) => i === 0 || f > fills[i - 1]) && fills[0] < 25 && fills.at(-1) > 55, "the ring sweeps round as it recharges: " + fills.map((f) => f + "%").join(", "));
  await shot(phone, "f12-phone-bump-ring-most-of-the-way");
  await phone.waitForSelector(".ctl-bump.ready.pulse", { timeout: 3000 });
  check((await phone.locator(".ctl-bump").getAttribute("aria-label")) === "Bump, ready", "when it is ready the button lights up again with a pulse");
  check(mabel.seen.slice(mark).filter((m) => m.t === "b" && m.s === 0).length === 1, "the two taps were one bump: the page did not send the second");

  // The room's own rule, whatever a page does.
  mark = mabel.seen.length;
  const fitchMark = fitch.seen.length;
  fitch.send({ t: "b" });
  fitch.send({ t: "b" });
  await sleep(400);
  const fitchBumps = mabel.seen.slice(mark).filter((m) => m.t === "b" && m.s === 2);
  const refusal = fitch.seen.slice(fitchMark).find((m) => m.t === "cd");
  check(fitchBumps.length === 1, "a client that asks twice gets one bump: the room enforces the cooldown");
  check(refusal && refusal.in > BUMP_COOLDOWN_MS - 1000 && refusal.in <= BUMP_COOLDOWN_MS, `and is told how long is left (${refusal?.in} ms of ${BUMP_COOLDOWN_MS})`);
  await sleep(BUMP_COOLDOWN_MS - 700);
  mark = mabel.seen.length;
  fitch.send({ t: "b" });
  await sleep(500);
  fitch.send({ t: "b" });
  await sleep(300);
  check(mabel.seen.slice(mark).filter((m) => m.t === "b" && m.s === 2).length === 1, `it may bump again once ${BUMP_COOLDOWN_MS} ms have passed, and not before`);

  // A player at a keyboard.
  const laptop = await open("laptop", { width: 1280, height: 720 });
  const rae = await call("POST", "/join/" + pin, { nickname: "Rae" });
  check(rae.status === 409, "(the party is full at four: the laptop takes Tom's seat instead)");
  tom.send({ t: "leave" });
  await tom.closed;
  await laptop.goto(base + "/lobby/?join=" + pin);
  await laptop.waitForSelector(".door-title");
  await laptop.fill("input[name=nickname]", "Tom");
  await laptop.click("text=Join the party");
  await laptop.waitForSelector("svg.scene text");
  await sleep(600);
  const keys = await laptop.evaluate(() => [...document.querySelectorAll(".ctl-key")].map((k) => [k.textContent, getComputedStyle(k).display !== "none"]));
  check(keys.every(([, shown]) => shown) && keys.map(([k]) => k).join() === "←,→,1-6,↑,B", "a laptop player sees the same five buttons with their keys: " + keys.map(([k]) => k).join(", "));
  await laptop.keyboard.press("b");
  await sleep(300);
  check(await laptop.evaluate(() => document.querySelector(".ctl-bump").classList.contains("cooling")), "pressing B bumps, and the button in the bottom bar shows the cooldown");
  const ring = await laptop.evaluate(() => {
    const sweep = [...document.querySelectorAll("svg.scene ellipse[pathLength]")].find((e) => !e.closest("[display=none]"));
    return sweep ? parseFloat(sweep.getAttribute("stroke-dasharray")) : null;
  });
  check(ring !== null && ring > 0 && ring < 40, `and a ring under their own piece shows it too (${ring}% round)`);
  await shot(laptop, "f13-laptop-keys-and-cooldown");
  await tidy(laptop, "laptop player");
  const upright = await open("upright", ...UPRIGHT);

  // ================================================================ the bump
  section("the bump: wind-up, strike, knock-back, up again");
  await sleep(BUMP_COOLDOWN_MS);
  /** Records how a seat's piece is drawn on a page, frame by frame, for `ms`. */
  const record = (page, ms) =>
    page.evaluate(
      (ms) =>
        new Promise((done) => {
          const frames = [];
          const t0 = performance.now();
          const step = () => {
            const t = performance.now() - t0;
            frames.push({ t, pieces: Object.fromEntries([...document.querySelectorAll("svg.scene g[data-seat]")].map((g) => [g.dataset.seat, g.getAttribute("transform") ?? ""])) });
            if (t < ms) requestAnimationFrame(step);
            else done(frames);
          };
          requestAnimationFrame(step);
        }),
      ms,
    );
  /** Reads "translate(x, y) rotate(a, ...) scale(sx, sy)" into numbers. */
  const read = (t) => {
    const tr = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(t);
    const ro = /rotate\(([-\d.]+)/.exec(t);
    const sc = /scale\(([-\d.]+),\s*([-\d.]+)\)/.exec(t);
    return { x: Number(tr?.[1] ?? 0), y: Number(tr?.[2] ?? 0), tilt: Number(ro?.[1] ?? 0), sx: Number(sc?.[1] ?? 1), sy: Number(sc?.[2] ?? 1) };
  };

  // Mabel stands just in front of Dolly (the phone), who has not moved from the door.
  const dollyX = mabel.room.members[0].x;
  mabel.goto(dollyX + 70);
  fitch.goto(1700);
  await sleep(400);
  const lit = mabel.room.boxes.map((_, i) => i).filter(litBox);
  const landing = knockLanding(dollyX + 70, 1, N, lit);
  mark = mabel.seen.length;
  const recording = record(screen, 1400);
  await sleep(120);
  await tap(phone, ".ctl-bump");
  const hit = await mabel.wait((m) => m.t === "b" && m.s === 0, 3000, mark);
  check(hit.to === 1 && hit.x === landing && hit.x - (dollyX + 70) >= KNOCK_MIN, `the phone's bump lands on the player in front and throws her ${hit.x - (dollyX + 70)} units (the room judged it)`);
  const frames = (await recording).map((f) => ({ t: f.t, a: read(f.pieces[0]), v: read(f.pieces[1]) }));
  const still = frames[0];
  const attack = frames.filter((f) => Math.abs(f.a.tilt) > 0.5 || Math.abs(f.a.x - still.a.x) > 0.5);
  // A kick: picked up by its head, the base swings back (a clockwise tilt about the head, facing right), then whips forward (anticlockwise).
  const wound = attack.filter((f) => f.a.tilt > 15 && f.a.y < still.a.y - 12);
  const struck = attack.filter((f) => f.a.tilt < -30 && Math.abs(f.a.x - still.a.x) < 25);
  check(wound.length >= 2 && struck.length >= 2 && wound[0].t < struck[0].t, `on the big screen the bumper is lifted with its base swung back, then kicks it forward while its head stays put (${wound.length} frames wound up, ${struck.length} striking)`);
  check(frames.at(-1).a.x === still.a.x && frames.at(-1).a.tilt === 0, "and is back on its feet where it stood");
  const flying = frames.filter((f) => f.v.y < still.v.y - 20 && Math.abs(f.v.tilt) > 15);
  const flat = frames.filter((f) => Math.abs(f.v.tilt) > 85);
  const squashed = frames.filter((f) => f.v.sx < 0.9);
  const last = frames.at(-1).v;
  check(squashed.length >= 1 && flying.length >= 4 && flat.length >= 3, `the one hit is squashed, thrown through the air and tips right over (${squashed.length} frames squashed, ${flying.length} in the air, ${flat.length} flat on the floor)`);
  check(Math.abs(last.x - landing) < 1 && last.tilt === 0 && Math.abs(last.y - still.v.y) < 1, `then rights itself where the room put it (x ${last.x}, upright)`);
  const firstMove = frames.find((f) => Math.abs(f.v.x - still.v.x) > 12)?.t ?? 0;
  const upAgain = frames.find((f) => f.t > firstMove && f.v.tilt === 0 && Math.abs(f.v.x - landing) < 1)?.t ?? Infinity;
  check(upAgain - firstMove < 700, `from being thrown to standing again takes ${Math.round(upAgain - firstMove)} ms on the screen`);

  section("the bump: what is fair");
  // Still knocked down, Mabel's page cannot move her; once up, it can.
  await sleep(Math.max(0, BUMP_COOLDOWN_MS + 200 - (Date.now() - hit.at)));
  mabel.goto(dollyX + 70);
  await sleep(300);
  mark = fitch.seen.length;
  const beforeTap = mabel.seen.length;
  await tap(phone, ".ctl-bump");
  const hit2 = await mabel.wait((m) => m.t === "b" && m.s === 0 && m.to === 1, 3000, beforeTap);
  mabel.send({ t: "m", x: hit2.x, d: -1, r: hit2.rev });
  await sleep(STUN_MS - 250);
  check(!fitch.seen.slice(mark).some((m) => m.t === "m" && m.s === 1), `for ${STUN_MS} ms the knocked player has no control: the room ignores her page`);
  await sleep(330);
  mabel.send({ t: "m", x: hit2.x, d: -1, r: hit2.rev });
  mabel.send({ t: "m", x: hit2.x, d: 0, r: hit2.rev });
  const moved = await fitch.wait((m) => m.t === "m" && m.s === 1, 2000, mark).catch(() => null);
  check(!!moved, "then she is up and walks again (well under a second after the bump)");

  // Nobody is kept on the floor. In a party of their own, two players stand either side of a
  // third and bump as fast as the room lets them, following wherever the knocks throw her.
  const gang = [await call("POST", "/rooms", { nickname: "Vic" })];
  for (const nickname of ["Ada", "Bea"]) gang.push(await call("POST", "/join/" + gang[0].pin, { nickname }));
  const [vic, ada, bea] = gang.map(connect);
  await Promise.all([vic, ada, bea].map((c) => c.opened));
  await vic.wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 8000, 0);
  vic.goto(960);
  await sleep(200);
  /** Stands an attacker a little way off the victim, facing her, and says so only when she has moved. */
  const close = (c, side) => {
    const want = Math.min(ROOM.maxX, Math.max(ROOM.minX, vic.x + side * 110));
    if (c.x === want) return;
    c.goto(want);
    face(c, vic.x >= want ? 1 : -1);
  };
  const spamFor = 9000;
  const from = Date.now();
  const sinceSpam = vic.seen.length;
  const spam = setInterval(() => {
    close(ada, -1);
    close(bea, 1);
    ada.send({ t: "b" });
    bea.send({ t: "b" });
  }, 220);
  await sleep(spamFor);
  clearInterval(spam);
  const swings = vic.seen.slice(sinceSpam).filter((m) => m.t === "b");
  const hits = swings.filter((m) => m.to === 0).map((m) => m.at - from);
  const gaps = hits.slice(1).map((t, i) => t - hits[i]);
  check(hits.length >= 3, `two players bumping one as fast as they can for ${spamFor / 1000} seconds land ${hits.length} knocks (of ${swings.length} bumps the room allowed)`);
  check(gaps.every((g) => g >= STUN_MS + IMMUNE_MS - 80), `never sooner than ${STUN_MS + IMMUNE_MS} ms after the last one (${gaps.map((g) => Math.round(g)).join(", ")} ms apart)`);
  const downShare = (hits.length * STUN_MS) / spamFor;
  check(downShare < 0.36, `so she is on the floor ${Math.round(downShare * 100)}% of the time at worst, and has her piece for the rest`);

  // The safe time itself: knocked by one, she cannot be knocked by the other until she has been up a while.
  // Set out afresh in the middle of the room, so nothing but the safe time decides it.
  await sleep(BUMP_COOLDOWN_MS + 200);
  vic.goto(700);
  ada.goto(590);
  bea.goto(1500);
  face(ada, 1);
  await sleep(300);
  mark = vic.seen.length;
  ada.send({ t: "b" });
  const first = await vic.wait((m) => m.t === "b" && m.s === 1, 3000, mark);
  check(first.to === 0, "(one player knocks her)");
  await sleep(STUN_MS + 150); // she is up
  bea.goto(first.x + 110);
  face(bea, -1);
  await sleep(150);
  mark = vic.seen.length;
  bea.send({ t: "b" });
  const safe = await vic.wait((m) => m.t === "b" && m.s === 2, 3000, mark);
  check(safe.to === -1, `${safe.at - first.at} ms after a knock, just up, a second player's bump from ${bea.x - vic.x} units away hits nothing (it hit ${safe.to === -1 ? "nobody" : "seat " + safe.to}): she is safe for ${IMMUNE_MS} ms after getting up`);
  await sleep(BUMP_COOLDOWN_MS + 100);
  mark = vic.seen.length;
  bea.send({ t: "b" });
  const again = await vic.wait((m) => m.t === "b" && m.s === 2, 3000, mark);
  check(again.to === 0, "and once that has passed she can be knocked again");
  for (const c of [vic, ada, bea]) c.ws.close();

  // Knocked out of a light: the vote changes for everyone.
  section("the bump: out of the light");
  const c = boxCentre(COIN, N);
  /** Half the width of a light: it depends on how many boxes hang, so places in a light are given as parts of it. */
  const lh = lightHalf(N);
  const xOf = async (seat) => (await debug(roomCode)).room.view.members[seat].x;
  /** Walks a page's piece to about x with the arrow keys, as its player would. */
  async function walkPage(page, seat, x) {
    for (let tries = 0; tries < 12; tries++) {
      const gap = x - (await xOf(seat));
      if (Math.abs(gap) <= 12) return;
      const key = gap > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      // A long way: hold the key until nearly there. Close by: a tap of it.
      if (Math.abs(gap) > 60) for (let i = 0; i < 300 && (x - (await xOf(seat))) * Math.sign(gap) > 40; i++) await sleep(10);
      else await sleep(12);
      await page.keyboard.up(key);
      await sleep(120);
    }
  }
  check(litBox(COIN), "Coin Flip's light is on");
  // The phone's piece in the left of the light, facing right; Mabel just in front of it; the rest further along.
  await walkPage(phone, 0, c - lh * 0.62);
  // However it got there, it ends on a tap of the right arrow: the piece faces right, toward the others.
  await phone.keyboard.down("ArrowRight");
  await sleep(12);
  await phone.keyboard.up("ArrowRight");
  await sleep(200);
  const me = await xOf(0);
  mabel.goto(Math.round(me + 45));
  fitch.goto(Math.round(c + lh * 0.3));
  mark = mabel.seen.length;
  await walkPage(laptop, 3, c + lh * 0.62);
  const voting = await mabel.wait((m) => (m.t === "vote" ? m.vote : m.room?.vote)?.count, 6000, mark).catch(() => null);
  const standing = (await debug(roomCode)).room.view.vote.standing;
  check(!!voting && Object.values(standing).every((v) => v === "coin-flip"), "four players stand in Coin Flip's light and the count runs");
  await sleep(300);
  await shot(phone, "f20-phone-before-the-knock");
  mark = mabel.seen.length;
  await tap(phone, ".ctl-bump");
  const thrown = await mabel.wait((m) => m.t === "b" && m.s === 0, 3000, mark);
  const stopped = await mabel.wait((m) => m.t === "vote" && !m.vote.count, 3000, mark).catch(() => null);
  check(thrown.to === 1 && !lit.includes(lightAt(thrown.x, N)) && Math.abs(thrown.x - c) > lightHalf(N) + 20, `the phone's bump throws her out of the light, into the dark (${Math.round(thrown.x - c)} units from its middle; the light is ${Math.round(lightHalf(N))} either side)`);
  check(!!stopped && stopped.vote.standing[1] === null && stopped.vote.waiting.includes(1), "which stops the count: the room is waiting for her again");
  await sleep(1000);
  await shot(phone, "f21-phone-after-the-knock-count-stopped");
  await tidy(phone, "sideways phone, after a knock");

  // ================================================================ the board
  section("the Tonight board");
  // A game first, so the board has something on it. Everyone into Coin Flip's light.
  await sleep(BUMP_COOLDOWN_MS);
  mark = mabel.seen.length;
  mabel.goto(Math.round(c + 20));
  fitch.goto(Math.round(c - lh * 0.75));
  await walkPage(phone, 0, c - lh * 0.4);
  await walkPage(laptop, 3, c + lh * 0.62);
  const ended = await mabel.wait((m) => m.t === "end", 28000, mark).catch(() => null);
  check(!!ended && ended.last.rows.length === 4, "a game of Coin Flip is played, so the board has a result on it");
  const winner = ended?.last.rows[0].name;
  // What the room itself says the night stands at: the board has to agree with it.
  const night = ended.room;
  const leader = [...night.members].filter(Boolean).sort((p, q) => q.points - p.points)[0];
  const played = night.tonight.games;
  await phone.waitForSelector(".card", { state: "detached", timeout: 12000 });
  await sleep(300);

  // The phone: back in the dark by the door. It walks into Coin Flip's light, then opens the board.
  await phone.click(".zoom-btn"); // the whole room, so the board is on the screen
  await sleep(700);
  await walkPage(phone, 0, c - lh * 0.4);
  await sleep(300);
  const before = (await debug(roomCode)).room.view;
  check(before.vote.standing[0] === "coin-flip", "the phone's piece stands in Coin Flip's light: that is its vote");
  const historyBefore = await phone.evaluate(() => history.length);
  await phone.locator(".board-hit").click();
  await phone.waitForSelector(".board");
  await sleep(250);
  const boardText = (await phone.locator(".board").innerText()).replace(/\s+/g, " ");
  const places = await phone.locator(".board-places li").allInnerTexts();
  check(/Tonight/.test(boardText) && boardText.includes(played === 1 ? "After 1 game" : `After ${played} games`), "tapping the board on the wall opens it large: " + boardText.slice(0, 60) + "...");
  check(places.length === 4 && /^1st/.test(places[0]) && places[0].includes(leader.name) && new RegExp(`\\b${leader.points}\\s*pts`).test(places[0].replace(/\n/g, " ")), "it shows places, names and points: " + places.map((p) => p.replace(/\s+/g, " ")).join(" | "));
  const games = (await phone.locator(".board-games").innerText()).replace(/\s+/g, " ");
  check(games.includes("Coin Flip") && games.includes(`${winner} won`), "and the games played so far with who won each: " + games);
  const size = await phone.evaluate(() => ({ name: parseFloat(getComputedStyle(document.querySelector(".board-name")).fontSize), board: document.querySelector(".board").getBoundingClientRect().height, page: innerHeight }));
  check(size.name >= 18 && size.board <= size.page, `it is readable on a sideways phone (names ${size.name}px) and fits the screen (${Math.round(size.board)} of ${size.page} px)`);
  await shot(phone, "f40-phone-board-open");
  await tidy(phone, "sideways phone, board open");

  // The vote carries on behind it.
  await phone.keyboard.down("ArrowLeft");
  await sleep(400);
  await phone.keyboard.up("ArrowLeft");
  const during = (await debug(roomCode)).room.view;
  check(during.vote.standing[0] === "coin-flip" && during.members[0].x === before.members[0].x, "with the board open the piece stays where it stood and keeps its vote (keys do not walk it away)");
  mark = mabel.seen.length;
  mabel.goto(Math.round(c + 20));
  fitch.goto(Math.round(c - lh * 0.75));
  await walkPage(laptop, 3, c + lh * 0.62);
  const counted = await mabel.wait((m) => (m.t === "vote" ? m.vote : m.room?.vote)?.count, 9000, mark).catch(() => null);
  check(!!counted, "everyone else steps into the light and the count starts, with the phone's vote in it");
  await sleep(500);
  const foot = await phone.locator(".board-now").textContent();
  check(/Coin Flip starts in \d+/.test(foot), `the open board says what the room is doing: "${foot}"`);
  await shot(phone, "f41-phone-board-open-count-running");
  await phone.waitForSelector(".flip", { timeout: 14000 });
  check((await phone.locator(".board").count()) === 0, "and when the game starts the board makes way for it");
  await phone.waitForSelector(".card", { state: "detached", timeout: 15000 });
  await sleep(400);

  // Three ways to close it. None of them leaves the room.
  const stillHere = async (how) => {
    await sleep(250);
    const ok = (await phone.locator(".board").count()) === 0 && (await phone.locator("svg.scene").count()) === 1 && new URL(phone.url()).pathname === "/lobby/";
    check(ok, `${how} closes it, and the player is still in the room`);
  };
  await phone.locator(".board-hit").click();
  await phone.waitForSelector(".board");
  await phone.locator(".board-back").click({ position: { x: 12, y: 12 } });
  await stillHere("a tap");
  await phone.locator(".board-hit").click();
  await phone.waitForSelector(".board");
  await phone.keyboard.press("Escape");
  await stillHere("Escape");
  check((await phone.locator(".sheet").count()) === 0, "(Escape closed the board, not opened the leave sheet)");
  await phone.locator(".board-hit").click();
  await phone.waitForSelector(".board");
  await phone.evaluate(() => history.back()); // what a phone's back gesture does
  await stillHere("the back gesture");
  check((await phone.evaluate(() => history.length)) <= historyBefore + 1, "opening and closing it does not pile up browser history");

  // The big screen and an upright phone.
  await screen.locator(".board-hit").click();
  await screen.waitForSelector(".board");
  await sleep(250);
  const rows2 = await screen.locator(".board-games li").count();
  check(rows2 === played + 1 && (await screen.locator(".board-places li").count()) === 4, "a click on the big screen's board opens it there too, with the game just played added");
  await shot(screen, "f42-screen-board-open");
  await tidy(screen, "big screen, board open");
  await screen.keyboard.press("Escape");
  await sleep(200);
  check((await screen.locator(".board").count()) === 0, "and Escape closes it");
  await laptop.locator(".board-hit").focus();
  await laptop.keyboard.press("Enter");
  await laptop.waitForSelector(".board");
  await shot(laptop, "f43-laptop-board-open");
  await laptop.keyboard.press("Escape");

  mabel.send({ t: "leave" });
  await mabel.closed;
  await upright.goto(base + "/lobby/?join=" + pin);
  await upright.waitForSelector(".door-title");
  await upright.fill("input[name=nickname]", "Mabel");
  await upright.click("text=Join the party");
  await upright.waitForSelector("svg.scene text");
  await sleep(800);
  const uprightButtons = await upright.evaluate(() => [...document.querySelectorAll(".bar-player .ctl")].map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.left + r.width / 2, w: r.width })));
  check(uprightButtons.length === 5 && uprightButtons.every((b) => b.w >= 56) && uprightButtons[1].x < 195 && uprightButtons[2].x > 195, "an upright phone has the same five buttons, larger, walking on the left and emote, jump and bump on the right");
  await shot(upright, "f44-upright-buttons");
  await tidy(upright, "upright phone, buttons");
  // Its camera is close in: the board is along the wall to the right.
  await upright.locator("[aria-label='Walk right']").dispatchEvent("pointerdown", { pointerId: 1 });
  await sleep(4200);
  await upright.locator("[aria-label='Walk right']").dispatchEvent("pointerup", { pointerId: 1 });
  await sleep(500);
  await upright.locator(".board-hit").click();
  await upright.waitForSelector(".board");
  await sleep(250);
  await shot(upright, "f45-upright-board-open");
  await tidy(upright, "upright phone, board open");
  await upright.locator(".board-back").click({ position: { x: 8, y: 8 } });

  // ================================================================ the cost
  section("the cost: a bump sets no timer and no wake-up");
  await sleep(BUMP_COOLDOWN_MS);
  for (let i = 0; i < 30 && (await debug(roomCode)).room.alarmIn < 60_000; i++) await sleep(1000);
  fitch.send({ t: "b" });
  await sleep(300);
  const after = (await debug(roomCode)).room;
  check(after.timer === false && after.alarmIn > 5 * 60_000, `after a bump no timer runs and the only wake-up is the slow "forgotten room" check (${Math.round(after.alarmIn / 60_000)} minutes away)`);
  await sleep(3000);
  const later = (await debug(roomCode)).room;
  check(JSON.stringify(later.owed) === JSON.stringify(after.owed), `and nothing is counted while the knock, the safe time and the cooldown run out (owed ${JSON.stringify(later.owed)} before and after)`);

  // ================================================================ the stills, with time held still
  // Last of all: holding a page's clock still restarts the page's own count of time, so
  // nothing else is asked of these pages afterwards.
  section("the bump, moment by moment (the page's clock is held still for each still)");
  const cork = boxCentre(0, N);
  fitch.goto(Math.round(cork - 45));
  face(fitch, 1);
  for (const [page, name, clip] of [
    [screen, "screen", { x: 250, y: 470, width: 620, height: 520 }],
    [phone, "phone", undefined],
  ]) {
    // Tom, on the laptop, stands in Cork & Bell's light just in front of Fitch.
    await walkPage(laptop, 3, cork + 30);
    await sleep(BUMP_COOLDOWN_MS + 300);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 400));
    mark = fitch.seen.length;
    fitch.send({ t: "b" });
    const blow = await fitch.wait((m) => m.t === "b" && m.s === 2, 3000, mark);
    check(blow.to === 3, `(a bump for the ${name}'s stills lands)`);
    await sleep(250); // the message reaches the page, whose clock stands still
    let at = 0;
    const moment = async (ms, still) => {
      await page.clock.runFor(Math.round(ms - at));
      at = Math.round(ms);
      await shot(page, still, clip);
    };
    await moment(1, `f30-${name}-bump-0-before`);
    await moment(WINDUP_MS - 8, `f31-${name}-bump-1-wind-up`);
    await moment(IMPACT_MS + 24, `f32-${name}-bump-2-hit`);
    await moment(IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS * 0.5, `f33-${name}-bump-3-thrown`);
    await moment(IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS + DOWN_MS * 0.7, `f34-${name}-bump-4-on-the-floor`);
    await moment(STUN_MS - 70, `f35-${name}-bump-5-getting-up`);
    await moment(STUN_MS + 190, `f36-${name}-bump-6-up-and-safe`);
    await page.clock.runFor(IMMUNE_MS + 400);
    await page.clock.resume();
  }

  // Two things a browser logs here are the test's own doing: the room's refusal of a second
  // screen (a 409 the page then explains), and the socket this test cut from under a page.
  const meant = [/^racer: Failed to load resource: .*409/, /^lost-screen: WebSocket is already in CLOSING or CLOSED state/];
  const real = errors.filter((e) => !meant.some((m) => m.test(e)));
  check(real.length === 0, "no page reported an error" + (real.length ? ": " + real.slice(0, 4).join(" | ") : ""));
  fitch.ws.close();
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good. Stills are in " + out);
process.exit(problems.length ? 1 : 0);
