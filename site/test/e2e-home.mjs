// End to end, in real pages (headless and muted): the front page's three doors, and every way
// out of them.
//
//   node site/test/e2e-home.mjs [--base=http://localhost:8791] [--out=site/test/shots]
//
// Ann, on an upright phone, opens the room door, goes back with the browser's back button, then
// starts a party on the Floor from the room door. Bo, on a laptop by day, joins it from the
// front page's "Got a code? Join" (a wrong code first). Cy starts a party at the Table from the
// "Round the table" door and lands at the Table; Dee joins that one from the front page and lands
// at the Table too. Eve opens a game's card on a phone (Escape closes it, focus comes back),
// reads Who Am I?'s way out, and plays Hot Potato from the device door. With reduced motion the
// doors open at once. Along the way: nothing scrolls sideways, every tap target is at least 44
// pixels, the wall shown is the production wall (no test game), and no page logs an error.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser } from "../../lobby/test/browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "site/test/shots"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID };
const LAPTOP = { viewport: { width: 1280, height: 720 } };
const SESSION = "party-kit:session:/api/lobby";

// Headless and muted; on the graphics card with TEST_GPU=1 (lobby/test/browser.mjs).
const browser = await launchBrowser();
const errors = [];
try {
  async function open(name, device, extra = {}) {
    const context = await browser.newContext({ ...device, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // A code no party has is looked up on purpose and answered 404: the browser logs that answer itself.
      if (/\/api\/lobby\/join\/\d{4}$/.test(m.location()?.url ?? "") && /404/.test(m.text())) return;
      errors.push(`${name}: ${m.text()}`);
    });
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
  const home = async (page) => {
    await page.goto(base + "/");
    await page.waitForSelector("body[data-ready]");
  };
  const view = (page) => page.evaluate(() => document.body.dataset.view);
  const inView = (page, v) => page.waitForFunction((want) => document.body.dataset.view === want, v, { timeout: 5000 });
  const pinOf = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).pin, SESSION);
  async function looksRight(page, label) {
    const m = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll("button, a, input")) {
        if (el.closest("[hidden], [inert]") || el.classList.contains("detail")) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${el.className || el.tagName}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { wide: document.documentElement.scrollWidth > innerWidth, small };
    });
    check(!m.wide, `${label}: nothing scrolls sideways`);
    check(!m.small.length, `${label}: every tap target is at least 44 pixels${m.small.length ? ` (${m.small.join(", ")})` : ""}`);
  }

  // ---------------------------------------------------------------- the doors, the room, the back button
  const ann = await open("Ann", PHONE, { colorScheme: "dark" });
  await home(ann);
  const doors = await ann.locator(".door").allTextContents();
  check(doors.length === 3 && /In the room/.test(doors[0]) && /Round the table/.test(doors[1]) && /Pass one device/.test(doors[2]), "the front page shows three doors: In the room, Round the table, Pass one device");
  check((await ann.locator("h1:visible").textContent()) === "How do you want to play?", "and asks: How do you want to play?");
  check(!/Coin Flip|Count to ten/.test(await ann.locator("body").textContent()), "no test game is named anywhere on the page");
  await looksRight(ann, "the doors on an upright phone");
  await shot(ann, "01-doors-390x844-dark");

  await ann.tap(".door[data-kind=room]");
  await inView(ann, "room");
  check(new URL(ann.url()).hash === "#room", "the room door opens behind the address #room");
  check(await ann.evaluate(() => document.activeElement?.id === "roomTitle"), "focus moves to the room's heading");
  const wall = await ann.evaluate(async () => {
    const { FLOOR } = await import("/home-wall.js");
    return { shown: [...document.querySelectorAll("#roomWall .wall-name")].map((el) => el.textContent), floor: FLOOR.map((b) => b.name) };
  });
  check(wall.shown.length > 0 && JSON.stringify(wall.shown) === JSON.stringify(wall.floor), `"On the wall tonight" is the room's production wall: ${wall.shown.join(", ")}`);
  check((await ann.locator("#roomStart").getAttribute("href")) === "/lobby/?start", "Start a party leads to a new party on the Floor");
  await looksRight(ann, "the room door on an upright phone");
  await shot(ann, "02-room-390x844-dark");
  await ann.goBack();
  await inView(ann, "doors");
  check(new URL(ann.url()).hash === "" && (await ann.evaluate(() => document.activeElement?.dataset.kind)) === "room", "the browser's back button closes the door, with focus back on it");

  await ann.tap(".door[data-kind=room]");
  await inView(ann, "room");
  await ann.tap("#roomStart");
  await ann.waitForURL((url) => url.pathname === "/lobby/" && url.searchParams.has("start"));
  await ann.fill("input[name=nickname]", "Ann");
  await ann.click("button[type=submit]");
  await ann.waitForSelector(".bar", { timeout: 30000 });
  const annPin = await pinOf(ann);
  check(/^\d{4}$/.test(annPin), `Ann started a party on the Floor from the room door (${annPin})`);

  // ---------------------------------------------------------------- joining with a code from the front page
  const bo = await open("Bo", LAPTOP, { colorScheme: "light" });
  await home(bo);
  await looksRight(bo, "the doors on a laptop");
  await shot(bo, "03-doors-1280x720-light");
  await bo.click("#joinOpen");
  check(await bo.evaluate(() => document.activeElement?.id === "joinCode"), "Got a code? Join opens the code box with the cursor in it");
  const wrong = String((Number(annPin) + 5000) % 10000).padStart(4, "0");
  await bo.fill("#joinCode", wrong);
  await bo.click("#joinGo");
  await bo.waitForFunction(() => document.getElementById("joinErr").textContent !== "", null, { timeout: 5000 });
  check(/No party has that code/.test(await bo.locator("#joinErr").textContent()) && new URL(bo.url()).pathname === "/", "a code no party has is said in the box, and the page stays");
  await bo.keyboard.press("Escape");
  check(await bo.locator("#joinPop").isHidden(), "Escape closes the code box");
  await bo.click("#joinOpen");
  await bo.fill("#joinCode", annPin);
  await bo.click("#joinGo");
  await bo.waitForURL((url) => url.pathname === "/lobby/" && url.searchParams.get("join") === annPin);
  await bo.fill("input[name=nickname]", "Bo");
  await bo.click("button[type=submit]");
  await bo.waitForSelector(".bar", { timeout: 30000 });
  check((await pinOf(bo)) === annPin, `Bo joined Ann's party from the front page with its code (${annPin})`);
  const floorParty = await (await fetch(`${base}/api/lobby/join/${annPin}`)).json();
  check(floorParty.preview?.mode === "party-games" && floorParty.preview.players.map((p) => p.name ?? p).join(",").includes("Bo"), "the party is on the Floor with Ann and Bo in it");

  // ---------------------------------------------------------------- a party at the Table
  const cy = await open("Cy", PHONE, { colorScheme: "light" });
  await home(cy);
  await cy.tap(".door[data-kind=table]");
  await inView(cy, "table");
  await looksRight(cy, "the table door on an upright phone");
  await shot(cy, "04-table-390x844-light");
  const masks = await cy.locator('.tile[data-game="paper-masks"] .chip.soon').count();
  const pmLive = await cy.evaluate(async () => (await import("/home-wall.js")).TABLE.find((e) => e.id === "paper-masks")?.soon === false);
  check(pmLive ? masks === 0 : masks === 1, `Paper Masks shows as ${pmLive ? "playable" : "coming soon"}, as the Table's list has it`);
  await cy.tap("#tableStart a.btn-go");
  await cy.waitForURL((url) => url.pathname === "/table/");
  await cy.fill("input[name=nickname]", "Cy");
  await cy.click("button[type=submit]");
  await cy.waitForURL((url) => url.pathname === "/party/", { timeout: 20000 });
  await cy.waitForSelector(".digits", { timeout: 30000 });
  const cyPin = await pinOf(cy);
  check(/^\d{4}$/.test(cyPin) && (await cy.locator(".digits").textContent()).replace(/\D/g, "") === cyPin, `Cy started a party at the Table from the table door, and is at the Table (${cyPin})`);
  await shot(cy, "05-at-the-table-390x844-light");
  await cy.goBack();
  await cy.waitForURL((url) => url.pathname === "/");
  await cy.waitForSelector("body[data-ready]");
  check(new URL(cy.url()).hash === "#table" && (await view(cy)) === "table", "the back button from the Table comes back to the table door, not to the form");

  const dee = await open("Dee", PHONE, { colorScheme: "dark" });
  await home(dee);
  await dee.tap("#joinOpen");
  await dee.fill("#joinCode", cyPin);
  await dee.tap("#joinGo");
  await dee.waitForURL((url) => url.pathname === "/lobby/");
  await dee.fill("input[name=nickname]", "Dee");
  await dee.click("button[type=submit]");
  await dee.waitForURL((url) => url.pathname === "/party/", { timeout: 20000 });
  await dee.waitForSelector(".digits", { timeout: 30000 });
  check((await pinOf(dee)) === cyPin, "Dee joined Cy's party from the front page with its code, and landed at the Table");

  // ---------------------------------------------------------------- a game's card, Who Am I?, Hot Potato
  const eve = await open("Eve", PHONE, { colorScheme: "dark" });
  await home(eve);
  await eve.tap(".door[data-kind=table]");
  await inView(eve, "table");
  await eve.tap('.tile[data-game="who-am-i"]');
  await eve.waitForFunction(() => document.body.dataset.sheet === "open");
  const who = await eve.evaluate(() => {
    const a = document.querySelector("#detail a.btn-go");
    return { href: a?.href, target: a?.target, focus: document.getElementById("detail").contains(document.activeElement) };
  });
  check(who.href === "https://whoami.n8builds.dev/" && who.target === "_blank", "Who Am I?'s card plays it on its own site, in a new tab");
  check(who.focus, "the card takes the focus when it opens");
  await eve.waitForTimeout(600);
  await shot(eve, "06-who-am-i-card-390x844-dark");
  await eve.keyboard.press("Escape");
  await eve.waitForFunction(() => document.body.dataset.sheet !== "open");
  check(await eve.evaluate(() => document.activeElement?.dataset.game === "who-am-i"), "Escape closes the card, with focus back on its tile");
  await eve.goBack();
  await inView(eve, "doors");
  await eve.tap(".door[data-kind=device]");
  await inView(eve, "device");
  await eve.tap('.tile[data-game="hot-potato"]');
  await eve.waitForFunction(() => document.body.dataset.sheet === "open");
  await eve.tap("#detail a.btn-go");
  await eve.waitForURL((url) => url.pathname === "/one-device/hot-potato/");
  check((await eve.title()) === "Hot Potato", "Hot Potato's Play now opens the game");
  await eve.goBack();
  await eve.waitForSelector("body[data-ready]");
  check((await view(eve)) === "device", "and the back button comes back to the device door");

  // ---------------------------------------------------------------- reduced motion
  const still = await open("still", PHONE, { reducedMotion: "reduce" });
  await home(still);
  await still.tap(".door[data-kind=table]");
  check((await view(still)) === "table", "with reduced motion the door opens at once, with no swing to wait for");
  const moving = await still.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  check(moving === 0, `and nothing on the page moves (${moving} animations running)`);

  check(errors.length === 0, `no page logged an error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} catch (err) {
  problems.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} FAILED` : "\nall passed");
process.exit(problems.length ? 1 : 0);
