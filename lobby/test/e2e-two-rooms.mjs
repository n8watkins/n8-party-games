// End to end, in real pages (headless and muted): one party, two waiting rooms.
//
//   node lobby/test/e2e-two-rooms.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/two-rooms]
//
// Ann starts a party on a phone held sideways, Bo joins on an upright phone and a laptop joins as
// the big screen, all on the Floor (/lobby/). Ann opens Rooms and moves the party to the Table:
// every page covers itself for a moment and becomes the Table (/party/), seated as before. Cy
// joins on a small phone while the party is there and lands there. Bo's tap on the switch is
// refused with the reason. Ann switches back: everyone is on the Floor again. Along the way:
// stills at 390x844, 844x390, 320x568 and 1280x720, the Table never
// loads three.js, no page scrolls sideways, every tap target is at least 44 pixels, and no page
// logs an error.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { MODE_COOLDOWN_MS } from "../shared/mode.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/two-rooms"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const errors = [];
/** Every address each page asked for, after it reached the plain room. */
const asked = new Map();
try {
  async function open(name, { width, height, phone = true }) {
    const context = await browser.newContext(phone ? { viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID } : { viewport: { width, height } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    asked.set(page, []);
    page.on("request", (r) => asked.get(page).push(r.url()));
    // What the plain room asks for is counted from the moment the tab arrives there.
    page.on("framenavigated", (f) => f === page.mainFrame() && new URL(f.url()).pathname === "/party/" && asked.set(page, []));
    page.label = name;
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
  const inRoom = (page) => page.waitForSelector(".bar", { timeout: 30000 });
  const inPlain = (page) => page.waitForSelector(".digits", { timeout: 30000 });
  /** Waits until the page's address is `path` and its room is drawn. */
  async function landed(page, path) {
    await page.waitForURL((url) => new URL(url).pathname === path, { timeout: 20000 });
    await (path === "/party/" ? inPlain(page) : inRoom(page));
  }
  /** What a page of the plain room must never do: scroll sideways, cut something off, or have a tap target under 44 pixels. */
  async function looksRight(page, label) {
    const m = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll("button, a")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${el.className || el.tagName}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      const clipped = [];
      for (const el of document.querySelectorAll(".digits, .person-name, .switch-option, .panel h2, .brand, .leave")) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis") clipped.push(el.className);
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.left < -1) clipped.push(`${el.className} off screen`);
      }
      // Nothing lies over anything else: the bar, the switch and each panel keep to their own place.
      const parts = [...document.querySelectorAll(".top, .grid > section:not([hidden])")].map((el) => [el.className, el.getBoundingClientRect()]);
      const over = [];
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const [p, a] = parts[i];
          const [q, b] = parts[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push(`${p} / ${q}`);
        }
      return { wide: document.documentElement.scrollWidth > innerWidth, small, clipped, over };
    });
    check(!m.over.length, `${label}: nothing lies over anything else${m.over.length ? ` (${m.over.join(", ")})` : ""}`);
    check(!m.wide, `${label}: nothing scrolls sideways`);
    check(!m.small.length, `${label}: every tap target is at least 44 pixels${m.small.length ? ` (${m.small.join(", ")})` : ""}`);
    check(!m.clipped.length, `${label}: nothing is cut off${m.clipped.length ? ` (${m.clipped.join(", ")})` : ""}`);
  }

  // ---------------------------------------------------------------- a party in the character room
  const ann = await open("Ann", { width: 844, height: 390 });
  await ann.goto(`${base}/lobby/?start&look=flat`);
  await ann.fill("input[name=nickname]", "Ann");
  await ann.click("button[type=submit]");
  await inRoom(ann);
  const pin = await ann.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin);
  const bo = await open("Bo", { width: 390, height: 844 });
  await bo.goto(`${base}/lobby/?join=${pin}&look=flat`);
  await bo.fill("input[name=nickname]", "Bo");
  await bo.click("button[type=submit]");
  await inRoom(bo);
  const tv = await open("screen", { width: 1280, height: 720, phone: false });
  await tv.goto(`${base}/lobby/?join=${pin}&as=screen&look=flat`);
  await tv.click("button[type=submit]");
  await inRoom(tv);
  check(true, `a party in the character room: Ann (sideways phone), Bo (upright phone) and a big screen (${pin})`);

  // Bo's Rooms: no way to the plain room, since he is not the host.
  await bo.click(".rooms-btn");
  await bo.waitForSelector(".picker");
  check(await bo.locator(".mode-choice").isHidden(), "Bo's Rooms has no switch to the plain room: only the host's does");
  await bo.click(".picker .plain");

  // ---------------------------------------------------------------- Ann moves the party
  await ann.click(".rooms-btn");
  await ann.waitForSelector(".mode-choice:visible");
  await ann.waitForTimeout(400);
  await shot(ann, "10-lobby-rooms-host-844x390");
  const item = await ann.locator(".mode-choice").boundingBox();
  const sheet = await ann.locator(".sheet.picker").boundingBox();
  check(item.height >= 44 && item.y + item.height <= 390, `the host's "Move the party to the Table" is in the picker, on screen, ${Math.round(item.height)} pixels tall`);
  check(sheet.y >= 0, "the picker fits the sideways phone");
  const boBefore = await bo.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).token);
  await ann.click(".mode-choice");
  await ann.waitForSelector(".hop-cover", { timeout: 3000 });
  await shot(ann, "11-switch-cover-844x390");
  check((await ann.locator(".hop-words").textContent()) === "Moving to the Table", "Ann's page says: Moving to the Table");
  await Promise.all([landed(ann, "/party/"), landed(bo, "/party/"), landed(tv, "/party/")]);
  check(true, "every page moved itself to the plain waiting room: both phones and the big screen");
  const boAfter = await bo.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).token);
  check(boBefore === boAfter, "Bo kept his seat's session through the move: the same token");
  await bo.waitForSelector(".line.noting", { timeout: 3000 }).catch(() => null);
  const said = await bo.locator(".line-note").textContent().catch(() => "");
  check(said === "Ann moved the party here", `Bo's Table says who moved it, in the line under its heading: "${said}"`);
  await bo.waitForTimeout(600);
  await shot(bo, "20-table-guest-with-note-390x844");
  await shot(ann, "21-table-host-844x390");
  await shot(tv, "22-table-screen-1280x720");
  // Bo is not the host: no switch, just who chooses; Ann holds the controls and has it.
  check(await bo.locator(".rooms").isHidden(), "Bo's Table has no switch: he cannot use one");
  check(await ann.locator(".rooms").isVisible(), "Ann's Table has the switch at the top");
  await bo.waitForFunction(() => !document.querySelector(".line.noting"), null, { timeout: 8000 });
  const line = await bo.locator(".line-text").textContent();
  check(line === "Ann chooses the room", `once the note has gone, Bo's line says who chooses: "${line}"`);
  await shot(bo, "20-table-guest-390x844");
  await ann.setViewportSize({ width: 390, height: 844 });
  await ann.waitForTimeout(300);
  await shot(ann, "21-table-host-390x844");
  await looksRight(ann, "Table host 390x844");
  await ann.setViewportSize({ width: 844, height: 390 });
  const names = await bo.locator(".person:not(.free) .person-name").allTextContents();
  check(names.join() === "Ann,Bo,The big screen", `who is here, in seat order, then the screen: ${names.join(", ")}`);
  check((await bo.locator(".person.free").count()) === 2, "and the two free seats");
  check((await bo.locator(".person .tag.host").count()) === 1 && (await bo.locator(".person").first().locator(".tag.host").count()) === 1, "Ann's row is marked Host");
  check((await bo.locator(".digits").textContent()) === pin && (await tv.locator(".digits").textContent()) === pin, "the code, large, on the phone and the screen");
  check(await tv.evaluate(() => document.documentElement.classList.contains("as-screen")), "the big screen has the wide layout");
  const tvFits = await tv.evaluate(() => document.documentElement.scrollHeight <= innerHeight);
  check(tvFits, "the big screen shows it all without scrolling (nobody scrolls a TV)");
  const qr = await tv.locator(".qr img").evaluate((img) => img.complete && img.naturalWidth > 0);
  check(qr, "the QR code is drawn");
  for (const [page, label] of [
    [bo, "390x844"],
    [ann, "844x390"],
    [tv, "1280x720"],
  ])
    await looksRight(page, `plain room ${label}`);

  // ---------------------------------------------------------------- a new phone while the party is in the plain room
  const cy = await open("Cy", { width: 320, height: 568 });
  await cy.goto(`${base}/lobby/?join=${pin}&look=flat`);
  await cy.fill("input[name=nickname]", "Cy");
  await cy.click("button[type=submit]");
  await landed(cy, "/party/");
  check(true, "Cy joins by code through the old door and lands in the plain room");
  await ann.waitForFunction(() => document.querySelectorAll(".person:not(.free)").length === 4);
  await cy.waitForTimeout(600);
  await shot(cy, "23-table-guest-320x568");
  await looksRight(cy, "Table 320x568");
  await tv.waitForFunction(() => document.querySelectorAll(".person:not(.free)").length === 4);
  await tv.waitForTimeout(4600); // the notes have gone
  await shot(tv, "26-table-screen-three-players-1280x720");
  check(await tv.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "with three players and the screen, the big screen still needs no scrolling");
  // The plain room loaded on its own: nothing of the 3D room, at any size.
  const plain = await open("plain-direct", { width: 390, height: 844 });
  await plain.goto(`${base}/party/`);
  await plain.waitForSelector(".empty");
  await shot(plain, "24-plain-no-party-390x844");
  for (const page of [ann, bo, tv, cy, plain]) {
    const heavy = asked.get(page).filter((u) => /three|look3d|room3d|baked/.test(u));
    check(!heavy.length, `${page.label}'s plain room loads no three.js and nothing of the 3D room${heavy.length ? `: ${heavy.join(", ")}` : ""}`);
  }

  // ---------------------------------------------------------------- and back, with one phone held by the loop guard
  await ann.waitForTimeout(MODE_COOLDOWN_MS);
  // Bo's phone heard the first switch late, so its page arrived at the Table only a moment ago:
  // the loop guard holds its next hop, and it must go by itself once the guard lets it.
  await bo.evaluate(() => sessionStorage.setItem("n8games:hop", JSON.stringify({ at: Date.now(), to: "/party/", text: "", said: true })));
  await ann.click(".switch-option[data-mode=party-games]");
  await ann.waitForSelector(".hop-cover", { timeout: 4000 });
  await bo.waitForSelector(".hop-link", { timeout: 4000 });
  await shot(bo, "25-table-hop-held-390x844");
  check((await bo.locator(".hop-words").textContent()) === "The party moved to the Floor", "Bo's page, held by the guard, says where the party went, with a link to tap");
  await Promise.all([landed(ann, "/lobby/"), landed(bo, "/lobby/"), landed(tv, "/lobby/"), landed(cy, "/lobby/")]);
  check(true, "Ann switches back: every page, Cy's too, is on the Floor again, and Bo's held page went by itself");
  const boBack = await bo.evaluate(() => history.length);
  check(boBack <= 3, `the moves added no history steps to Bo's tab (history length ${boBack})`);
  await bo.waitForTimeout(1200);
  await shot(bo, "30-back-in-the-room-390x844");
  await shot(ann, "31-back-in-the-room-844x390");
  const members = await ann.evaluate(() => fetch(`/api/lobby/join/${JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin}`).then((r) => r.json()));
  check(members.preview.players.join() === "Ann,Bo,Cy" && members.preview.mode === "party-games", `the same party, seated as before: ${members.preview.players.join(", ")}`);

  // ---------------------------------------------------------------- the Floor's own corners, on small phones
  // A host's first time in a room on an upright phone: the Rooms bubble, with the hint to turn the phone waiting under it.
  const eve = await open("Eve", { width: 390, height: 844 });
  await eve.goto(`${base}/lobby/?start&look=flat`);
  await eve.fill("input[name=nickname]", "Eve");
  await eve.click("button[type=submit]");
  await inRoom(eve);
  await eve.waitForSelector(".rooms-hint", { timeout: 5000 });
  await shot(eve, "40-floor-host-first-time-390x844");
  const hint = await eve.evaluate(() => {
    const turn = document.querySelector(".turn-hint");
    return { bubble: !!document.querySelector(".rooms-hint"), turnShows: !!turn && getComputedStyle(turn).display !== "none" && getComputedStyle(turn).visibility !== "hidden" };
  });
  check(hint.bubble && !hint.turnShows, "the first-time Rooms bubble shows on its own: the hint to turn the phone waits under it");
  await eve.click(".rooms-hint");
  const after = await eve.evaluate(() => {
    const turn = document.querySelector(".turn-hint");
    return !!turn && getComputedStyle(turn).display !== "none" && getComputedStyle(turn).visibility !== "hidden";
  });
  check(after, "and shows once the bubble has gone");
  await shot(eve, "42-floor-host-turn-hint-390x844");
  // The room picker on the smallest phone: its top in reach, the host's way to the Table at its foot.
  const fay = await open("Fay", { width: 320, height: 568 });
  await fay.goto(`${base}/lobby/?start&look=flat`);
  await fay.fill("input[name=nickname]", "Fay");
  await fay.click("button[type=submit]");
  await inRoom(fay);
  await fay.click(".rooms-btn");
  await fay.waitForSelector(".mode-choice:visible");
  await fay.waitForTimeout(400);
  await shot(fay, "41-floor-rooms-host-320x568");
  const picker = await fay.locator(".sheet.picker").boundingBox();
  check(picker.y >= 0 && picker.y + picker.height <= 568, "the room picker fits the 320x568 phone and scrolls inside itself");
  check((await fay.locator(".mode-choice strong").textContent()) === "Move the party to the Table", "and its foot says: Move the party to the Table");
  check(await fay.locator(".picker-title").isVisible(), "it opens at its top, its title in view");

  // A big screen that started a party alone holds the controls: at the Table its switch is in the bar at the top.
  const lone = await open("lone-screen", { width: 1280, height: 720, phone: false });
  await lone.goto(`${base}/lobby/?start&as=screen&look=flat`);
  await lone.click("button[type=submit]");
  await inRoom(lone);
  await lone.click(".rooms-btn");
  await lone.click(".mode-choice");
  await landed(lone, "/party/");
  await lone.waitForSelector(".top .rooms:visible");
  await lone.waitForFunction(() => !document.querySelector(".line.noting"), null, { timeout: 8000 });
  await shot(lone, "27-table-screen-holds-controls-1280x720");
  check(await lone.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "a screen holding the controls: the switch sits in the bar, and nothing scrolls");
  await looksRight(lone, "Table, screen with the switch, 1280x720");
} finally {
  await browser.close();
}
check(!errors.length, `no page logged an error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
console.log(`\nstills in ${out}`);
console.log(problems.length ? `${problems.length} problem(s)` : "all good");
console.log("Not checked here: a real phone, full screen after the move, and a page loaded before this change.");
process.exit(problems.length ? 1 : 0);
