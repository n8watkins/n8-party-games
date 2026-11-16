// End to end, in real pages (headless and muted): the front page's three doors, and every way
// out of them.
//
//   node site/test/e2e-home.mjs [--base=http://localhost:8791] [--out=/tmp/claude-three-doors/shots]
//
// Ann, on an upright phone, opens the room door, goes back with the browser's back button, then
// starts a party on the Floor from the room door. Bo, on a laptop by day, joins it from the
// front page's "Got a code? Join" (a wrong code first). Cy starts a party at the Table from the
// "Round the table" door, on the Table's own blue way in, reloads while the party is being moved
// and still lands at the Table with the same party. Seven friends join Cy's party from the front
// page, all from one address (as on one Wi-Fi), each costing one look-up and one join, as a join
// typed straight into the party room's way in does; an eighth friend is told at the code that
// the party is full. The party room's own way in is as it always was. Fay's switch to the Table
// does not go through, and "Go to the party" does not leave the form behind the back button. Eve
// opens a game's card on a phone (Escape closes it, focus comes back), reads Who Am I?'s way out,
// and plays Hot Potato from the device door. With reduced motion the doors open at once; with
// scripts blocked, or the wall failing to load, the three ways in are still there as links.
// Along the way: nothing scrolls sideways, nothing is cut short on a 320 pixel phone, every tap
// target is at least 44 pixels, the wall shown is the production wall (no test game), and no
// page logs an error.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser } from "../../lobby/test/browser.mjs";
import { RATE_LIMITS } from "../../party-kit/src/worker/limit-logic.js";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
// Outside the repository: site/ is in the local build's watch list (wrangler.jsonc), so a still
// saved under it would rebuild dist/public under every Worker of the pre-deploy gate mid-run.
const out = resolve(opt("out", "/tmp/claude-three-doors/shots"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID };
const SMALL = { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID };
const LAPTOP = { viewport: { width: 1280, height: 720 } };
const SESSION = "party-kit:session:/api/lobby";
const JOIN_API = /\/api\/lobby\/join\/[^/?]+$/;
/** The Table's seats (lobby/server/lobby-core.js, TABLE_MAX_PLAYERS). */
const TABLE_SEATS = 8;
/** A room's socket, which a test may stand between a page and its room. */
const ROOM_SOCKET = /\/api\/lobby\/rooms\/[^/]+\/ws/;

// Headless and muted; on the graphics card with TEST_GPU=1 (lobby/test/browser.mjs).
const browser = await launchBrowser();
const errors = [];
/** Every look-up or join of a code this run makes: they all come from one address, as on one Wi-Fi. */
const pinHits = [];
try {
  async function open(name, device, extra = {}) {
    const context = await browser.newContext({ ...device, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // A code no party has is looked up on purpose and answered 404: the browser logs that answer itself.
      if (/\/api\/lobby\/join\/\d{4}$/.test(m.location()?.url ?? "") && /404/.test(m.text())) return;
      // A script this run blocks on purpose.
      if (name === "no wall" && /home-wall\.js|ERR_FAILED/.test(`${m.location()?.url ?? ""} ${m.text()}`)) return;
      errors.push(`${name}: ${m.text()}`);
    });
    context.on("request", (r) => JOIN_API.test(r.url()) && pinHits.push({ who: name, method: r.method(), page: new URL(r.frame().url()).pathname }));
    return page;
  }
  /** A still, once the page's entrances (fades, swings: not the floaters' endless drift) have played. */
  const shot = async (page, name, opts = {}) => {
    await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 2500))]));
    await page.screenshot({ path: `${out}/${name}.png`, ...opts });
  };
  const home = async (page) => {
    await page.goto(base + "/");
    await page.waitForSelector("body[data-ready]");
  };
  const view = (page) => page.evaluate(() => document.body.dataset.view);
  const inView = (page, v) => page.waitForFunction((want) => document.body.dataset.view === want, v, { timeout: 5000 });
  const pinOf = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).pin, SESSION);
  const hitsOf = (who) => pinHits.filter((h) => h.who === who);
  async function looksRight(page, label) {
    const m = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll("button, a, input")) {
        if (el.closest("[hidden], [inert]") || el.classList.contains("detail")) continue;
        // A radio button's target is its whole label.
        const r = (el.matches("input[type=radio], input[type=checkbox]") && el.closest("label")) ? el.closest("label").getBoundingClientRect() : el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${el.className || el.tagName}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { wide: document.documentElement.scrollWidth > innerWidth, small };
    });
    check(!m.wide, `${label}: nothing scrolls sideways`);
    check(!m.small.length, `${label}: every tap target is at least 44 pixels${m.small.length ? ` (${m.small.join(", ")})` : ""}`);
  }
  /** Whether the Table's list can start Paper Masks today (it flips the day #65's game lands). */
  const tableGameNow = (page) => page.evaluate(async () => (await import("/home-wall.js")).TABLE.some((e) => !e.soon));

  // ---------------------------------------------------------------- the doors, the room, the back button
  const ann = await open("Ann", PHONE, { colorScheme: "dark" });
  await home(ann);
  const doors = await ann.locator(".door").allTextContents();
  check(doors.length === 3 && /In the room/.test(doors[0]) && /Round the table/.test(doors[1]) && /Pass one device/.test(doors[2]), "the front page shows three doors: In the room, Round the table, Pass one device");
  check((await ann.locator(".door-link").count()) === 0, "and the plain links the HTML holds have given way to them");
  check((await ann.locator("h1:visible").textContent()) === "How do you want to play?", "and asks: How do you want to play?");
  check(!/Coin Flip|Count to ten/.test(await ann.locator("body").textContent()), "no test game is named anywhere on the page");
  await looksRight(ann, "the doors on an upright phone");
  await shot(ann, "01-doors-390x844-dark");

  // What each door's peek calls "Now": only a game that plays behind that door.
  const playsAtTable = await tableGameNow(ann);
  const peeks = await ann.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".door")].map((d) => [
        d.dataset.kind,
        { chips: [...d.querySelectorAll(".peek-game")].map((g) => `${g.querySelector(".peek-name").textContent}=${g.querySelector(".peek-state").textContent}`), said: d.querySelector(".peek .sr").textContent, line: d.querySelector(".peek-names").textContent },
      ]),
    ),
  );
  check(peeks.room.chips.includes("Who Am I?=Own site") && !peeks.room.chips.includes("Who Am I?=Now") && peeks.room.chips.includes("Cork & Bell=Now"), `the room door calls Cork & Bell Now, and says Who Am I? plays on its own site:${peeks.room.chips.join(", ")}`);
  check(peeks.table.chips.includes("Who Am I?=Own site") && !peeks.table.chips.includes("Who Am I?=Now"), `the table door does not call Who Am I? Now: ${peeks.table.chips.join(", ")}`);
  check(playsAtTable ? peeks.table.chips.includes("Paper Masks=Now") : !peeks.table.chips.some((c) => c.endsWith("=Now")), `the table door calls a game Now only when the Table plays one (${playsAtTable ? "it does" : "none yet"})`);
  check(/Who Am I\? on its own site/.test(peeks.table.line) && /Who Am I\? on its own site, playable now/.test(peeks.table.said), `the table door's line says where Who Am I? plays: "${peeks.table.line}"`);

  await ann.tap(".door[data-kind=room]");
  await inView(ann, "room");
  check(new URL(ann.url()).hash === "#room", "the room door opens behind the address #room");
  check(await ann.evaluate(() => document.activeElement?.id === "roomTitle"), "focus moves to the room's heading");
  const wall = await ann.evaluate(async () => {
    const { FLOOR } = await import("/home-wall.js");
    const { COPY } = await import("/home-data.js");
    // A coming-soon game with no picture yet is folded into the last line.
    const folded = (b) => b.soon && !COPY[b.id]?.tile;
    return {
      shown: [...document.querySelectorAll("#roomWall .wall-name")].map((el) => el.textContent),
      pictured: FLOOR.filter((b) => !folded(b)).map((b) => b.name),
      folded: FLOOR.filter(folded).length,
      more: document.querySelector("#roomWall .wall-more")?.textContent ?? "",
      plates: document.querySelectorAll("#roomWall .plain-art").length,
    };
  });
  check(wall.shown.length > 0 && wall.shown.join() === wall.pictured.join(), `"On the wall tonight" is the room's production wall: ${wall.shown.join(", ")}, ${wall.more}`);
  check(wall.plates === 0 && (wall.folded ? wall.more === `and ${wall.folded} more on the way` : wall.more === ""), `coming-soon games with no picture are one line, not lettered plates: "${wall.more}"`);
  const pieces = await ann.evaluate(async () => {
    const { CHARACTERS } = await import("/lobby/shared/characters.js");
    return { shown: [...document.querySelectorAll("#roomPieces .piece-name")].map((el) => el.textContent), room: CHARACTERS.map((c) => c.name) };
  });
  check(pieces.shown.length > 0 && JSON.stringify(pieces.shown) === JSON.stringify(pieces.room), `"Who you walk in as" is the room's own list of characters: ${pieces.shown.join(", ")}`);
  check((await ann.locator("#roomStart").getAttribute("href")) === "/lobby/?start", "Start a party leads to a new party on the Floor");
  check(await ann.evaluate(() => [...document.querySelectorAll("#view-room img")].every((img) => img.loading === "lazy")), "the room's pictures load lazily, as their view opens");
  await looksRight(ann, "the room door on an upright phone");
  await shot(ann, "02-room-390x844-dark", { fullPage: true });
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
  check(!(await bo.evaluate(() => performance.getEntriesByType("resource").some((r) => /room-light\.webp/.test(r.name)))), "the room's big picture is not fetched while its door is shut");
  await looksRight(bo, "the doors on a laptop");
  await shot(bo, "03-doors-1280x720-light");
  await bo.click(".door[data-kind=table]");
  await inView(bo, "table");
  await bo.keyboard.press("Escape");
  await inView(bo, "doors");
  check(new URL(bo.url()).hash === "", "Escape closes an open door");
  await bo.click("#joinOpen");
  check(await bo.evaluate(() => document.activeElement?.id === "joinCode"), "Got a code? Join opens the code box with the cursor in it");
  for (let i = 0; i < 4 && !(await bo.locator("#joinPop").isHidden()); i++) await bo.keyboard.press("Tab");
  check(await bo.locator("#joinPop").isHidden(), "tabbing out of the code box closes it");
  await bo.click("#joinOpen");
  const wrong = String((Number(annPin) + 5000) % 10000).padStart(4, "0");
  await bo.fill("#joinCode", wrong);
  await bo.click("#joinGo");
  await bo.waitForFunction(() => document.getElementById("joinErr").textContent !== "", null, { timeout: 5000 });
  check(/No party has that code/.test(await bo.locator("#joinErr").textContent()) && new URL(bo.url()).pathname === "/", "a code no party has is said in the box, and the page stays");
  await bo.keyboard.press("Escape");
  check(await bo.locator("#joinPop").isHidden(), "Escape closes the code box");
  const boBefore = hitsOf("Bo").length;
  await bo.click("#joinOpen");
  await bo.fill("#joinCode", annPin);
  await bo.click("#joinGo");
  await bo.waitForURL((url) => url.pathname === "/lobby/" && url.searchParams.get("join") === annPin);
  await bo.waitForFunction(() => /In the room: Ann/.test(document.querySelector(".door-who")?.textContent ?? ""), null, { timeout: 5000 });
  await bo.fill("input[name=nickname]", "Bo");
  await bo.click("button[type=submit]");
  await bo.waitForSelector(".bar", { timeout: 30000 });
  check((await pinOf(bo)) === annPin, `Bo joined Ann's party from the front page with its code (${annPin})`);
  const boJoin = hitsOf("Bo").slice(boBefore).map((h) => `${h.method} from ${h.page}`);
  check(boJoin.join() === "GET from /,POST from /lobby/", `a join from the front page looks the code up once, and the party room's way in uses that answer: ${boJoin.join(", ")}`);
  const floorParty = await (await fetch(`${base}/api/lobby/join/${annPin}`)).json();
  pinHits.push({ who: "the test", method: "GET", page: "" });
  check(floorParty.preview?.mode === "party-games" && floorParty.preview.players.map((p) => p.name ?? p).join(",").includes("Bo"), "the party is on the Floor with Ann and Bo in it");

  // ---------------------------------------------------------------- a party at the Table, on the Table's own way in
  const cy = await open("Cy", PHONE, { colorScheme: "light" });
  let creates = 0;
  cy.context().on("request", (r) => r.method() === "POST" && /\/api\/lobby\/rooms$/.test(r.url()) && creates++);
  await home(cy);
  await cy.tap(".door[data-kind=table]");
  await inView(cy, "table");
  await looksRight(cy, "the table door on an upright phone");
  await shot(cy, "04-table-390x844-light", { fullPage: true });
  const masks = await cy.locator('.tile[data-game="paper-masks"] .chip.soon').count();
  check(playsAtTable ? masks === 0 : masks === 1, `Paper Masks shows as ${playsAtTable ? "playable" : "coming soon"}, as the Table's list has it`);
  const start = await cy.evaluate(() => ({ lead: document.getElementById("tableStart").dataset.lead, main: document.getElementById("tableGo").classList.contains("btn-go"), note: document.getElementById("tableNote").textContent, noteFirst: document.getElementById("tableNote").getBoundingClientRect().top < document.getElementById("tableGo").getBoundingClientRect().top }));
  if (playsAtTable) check(start.lead === "start" && start.main && !start.noteFirst, "a game plays at the Table: starting a party there is the main button");
  else check(start.lead === "note" && !start.main && start.noteFirst && /^No game plays at the Table yet/.test(start.note), `no game plays at the Table yet: the note leads and the start is not the main button ("${start.note}")`);

  // The switch to the Table is held back once, so the page can be reloaded while the party is on its way.
  let holdSwitch = true;
  let switchHeld = false;
  await cy.routeWebSocket(ROOM_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (holdSwitch && /"t":"mode"/.test(String(m))) return void (switchHeld = true);
      server.send(m);
    });
  });
  await cy.tap("#tableGo");
  await cy.waitForURL((url) => url.pathname === "/table/");
  await cy.waitForSelector(".door-title");
  const tableForm = await cy.evaluate(() => {
    const door = document.querySelector(".door");
    const title = document.querySelector(".door-title");
    return { room: door.dataset.room, brand: document.querySelector(".brand").textContent, title: title.textContent, sub: document.querySelector(".door-sub").textContent, text: document.querySelector(".door-card").innerText, font: getComputedStyle(title).fontFamily, ground: getComputedStyle(door).backgroundImage };
  });
  check(tableForm.room === "turn-based" && tableForm.brand === "n8games" && tableForm.title === "Start a party at the Table", `/table/ is the Table's own way in: "${tableForm.brand}", "${tableForm.title}"`);
  check(!/QR code|on the wall|n8 Party|your own piece/.test(tableForm.text), `and says nothing of the party room's wall, its QR code or a piece: "${tableForm.sub}"`);
  check(/Baloo 2/.test(tableForm.font) && /rgb\(223, 232, 251\)/.test(tableForm.ground), `in the front page's face and blue (${tableForm.font.split(",")[0]}; ${tableForm.ground.slice(0, 60)})`);
  await looksRight(cy, "/table/ on an upright phone");
  await shot(cy, "05-table-form-390x844-light");
  await cy.fill("input[name=nickname]", "Cy");
  await cy.click("button[type=submit]");
  await cy.waitForFunction(() => sessionStorage.getItem("n8games:table-made"), null, { timeout: 20000 });
  for (let i = 0; i < 100 && !switchHeld; i++) await cy.waitForTimeout(100);
  const firstPin = await pinOf(cy);
  holdSwitch = false;
  await cy.reload();
  await cy.waitForURL((url) => url.pathname === "/party/", { timeout: 20000 });
  await cy.waitForSelector(".digits", { timeout: 30000 });
  const cyPin = await pinOf(cy);
  check(switchHeld && cyPin === firstPin && creates === 1, `a reload while the party is on its way picks the same party up and lands at the Table (${firstPin} -> ${cyPin}, ${creates} made)`);
  check(/^\d{4}$/.test(cyPin) && (await cy.locator(".digits").textContent()).replace(/\D/g, "") === cyPin, `Cy started a party at the Table from the table door, and is at the Table (${cyPin})`);
  await shot(cy, "06-at-the-table-390x844-light");

  // ---------------------------------------------------------------- seven friends on one Wi-Fi join from the front page
  const friends = [];
  for (let i = 1; i < TABLE_SEATS; i++) {
    const name = i === 1 ? "Dee" : `Pal${i}`;
    const page = await open(name, PHONE, { colorScheme: i % 2 ? "dark" : "light" });
    await home(page);
    await page.tap("#joinOpen");
    await page.fill("#joinCode", cyPin);
    await page.tap("#joinGo");
    await page.waitForURL((url) => url.pathname === "/lobby/", { timeout: 10000 });
    await page.fill("input[name=nickname]", name);
    await page.click("button[type=submit]");
    const landed = await page.waitForURL((url) => url.pathname === "/party/", { timeout: 20000 }).then(
      () => true,
      () => false,
    );
    const said = landed ? "" : await page.locator(".door-error:not([hidden])").textContent().catch(() => "");
    const cost = hitsOf(name).map((h) => `${h.method} from ${h.page}`);
    check(landed && (await pinOf(page)) === cyPin, `${name} joined Cy's party from the front page and landed at the Table${said ? `: "${said}"` : ""}`);
    check(cost.join() === "GET from /,POST from /lobby/", `${name}'s join cost one look-up and one join, as one typed into the party room's way in does: ${cost.join(", ")}`);
    friends.push(page);
  }
  const ninth = await open("Ned", PHONE, { colorScheme: "dark" });
  await home(ninth);
  await ninth.tap("#joinOpen");
  await ninth.fill("#joinCode", cyPin);
  await ninth.tap("#joinGo");
  await ninth.waitForFunction(() => document.getElementById("joinErr").textContent !== "", null, { timeout: 5000 });
  const fullWords = await ninth.locator("#joinErr").textContent();
  check(/This party is full/.test(fullWords) && new URL(ninth.url()).pathname === "/" && (await ninth.locator("input[name=nickname]").count()) === 0, `a ninth friend is told at the code, before any name: "${fullWords}"`);
  await shot(ninth, "07-party-full-390x844-dark");
  const spent = pinHits.length;
  check(spent <= RATE_LIMITS.pin_short.limit, `every look-up and join this run made from one address fits the limit on guessing codes: ${spent} of ${RATE_LIMITS.pin_short.limit}`);

  await cy.goBack();
  await cy.waitForURL((url) => url.pathname === "/");
  await cy.waitForSelector("body[data-ready]");
  check(new URL(cy.url()).hash === "#table" && (await view(cy)) === "table", "the back button from the Table comes back to the table door, not to the form");
  for (const page of [...friends, ninth]) await page.context().close();

  // ---------------------------------------------------------------- the party room's own way in, unchanged
  for (const [label, device] of [
    ["phone", PHONE],
    ["laptop", LAPTOP],
  ]) {
    const page = await open(`Floor ${label}`, device);
    await page.goto(base + "/lobby/?start");
    await page.waitForSelector(".door-title");
    const floor = await page.evaluate(() => {
      const door = document.querySelector(".door");
      const style = (sel, prop) => (document.querySelector(sel) ? getComputedStyle(document.querySelector(sel))[prop] : "");
      return {
        room: door.dataset.room ?? null,
        brand: document.querySelector(".brand").textContent,
        title: document.querySelector(".door-title").textContent,
        sub: document.querySelector(".door-sub").textContent,
        roles: [...document.querySelectorAll(".role-words span")].map((s) => s.textContent),
        ground: getComputedStyle(door).backgroundImage,
        titleColour: style(".door-title", "color"),
        titleFont: style(".door-title", "fontFamily"),
        input: `${style(".input", "borderTopColor")} ${style(".input", "backgroundColor")}`,
        button: style(".button", "backgroundColor"),
      };
    });
    const asBefore =
      floor.room === null &&
      floor.brand === "n8 Party" &&
      floor.title === "Start a party" &&
      floor.sub === "You get a room and a code. Friends join with the code or the QR code on the wall." &&
      /rgb\(36, 22, 15\)/.test(floor.ground) &&
      floor.titleColour === "rgb(246, 217, 160)" &&
      /Georgia/.test(floor.titleFont) &&
      floor.input === "rgb(90, 64, 48) rgb(18, 11, 8)" &&
      floor.button === "rgb(244, 180, 83)" &&
      (label === "phone" || floor.roles[0] === "Join as a player, with your own piece.");
    check(asBefore, `the party room's own way in on a ${label} reads and looks as it always has: ${JSON.stringify(floor)}`);
    await page.context().close();
  }

  // ---------------------------------------------------------------- /table/ on a laptop, and a switch that does not go through
  const fay = await open("Fay", LAPTOP, { colorScheme: "dark" });
  await home(fay);
  await fay.click(".door[data-kind=table]");
  await inView(fay, "table");
  await shot(fay, "08-table-1280x720-dark");
  await fay.routeWebSocket(ROOM_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => !/"t":"mode"/.test(String(m)) && server.send(m));
  });
  await fay.click("#tableGo");
  await fay.waitForURL((url) => url.pathname === "/table/");
  await fay.waitForSelector(".door-title");
  const cards = await fay.locator(".role-words span").allTextContents();
  check(cards[0] === "Join as a player and play the games here." && !cards.some((t) => /piece/.test(t)), `/table/ on a laptop offers to play the games here, with no piece: "${cards[0]}"`);
  await looksRight(fay, "/table/ on a laptop");
  await shot(fay, "09-table-form-1280x720-dark");
  await fay.fill("input[name=nickname]", "Fay");
  await fay.click("button[type=submit]");
  await fay.waitForSelector("text=Your party is on the Floor", { timeout: 20000 });
  await shot(fay, "10-switch-stuck-1280x720-dark");
  await fay.click("text=Go to the party");
  await fay.waitForURL((url) => url.pathname === "/lobby/", { timeout: 10000 });
  await fay.goBack();
  await fay.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  check(new URL(fay.url()).pathname === "/", `"Go to the party" replaces the form, so the back button skips it (${new URL(fay.url()).pathname}${new URL(fay.url()).hash})`);
  await fay.context().close();

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
  await shot(eve, "11-who-am-i-card-390x844-dark");
  await eve.keyboard.press("Escape");
  await eve.waitForFunction(() => document.body.dataset.sheet !== "open");
  check(await eve.evaluate(() => document.activeElement?.dataset.game === "who-am-i") && (await view(eve)) === "table", "Escape closes the card, with focus back on its tile, and the door stays open");
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

  // ---------------------------------------------------------------- the smallest phone
  const tiny = await open("tiny", SMALL, { colorScheme: "light" });
  await home(tiny);
  await tiny.waitForTimeout(1200);
  const cut = await tiny.evaluate(() => {
    const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return [...document.querySelectorAll(".door-line, .door-name, .peek-names")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const door = el.closest(".door");
        const clips = s.overflow !== "visible" && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
        // The arrow sits in the door's corner: no words run beneath it.
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = [...range.getClientRects()];
        return clips || s.webkitLineClamp !== "none" || s.textOverflow === "ellipsis" || r.right > door.getBoundingClientRect().right || (!el.matches(".door-name") && lines.some((l) => meet(l, door.querySelector(".door-go").getBoundingClientRect())));
      })
      .map((el) => el.textContent);
  });
  check(cut.length === 0, `on a 320 by 568 phone no door's words are cut short or hidden under the arrow${cut.length ? `: ${cut.join(" | ")}` : ""}`);
  await looksRight(tiny, "the doors on a 320 by 568 phone");
  await shot(tiny, "12-doors-320x568-light");
  await tiny.context().close();

  // ---------------------------------------------------------------- reduced motion
  const still = await open("still", PHONE, { reducedMotion: "reduce" });
  await home(still);
  await still.tap(".door[data-kind=table]");
  check((await view(still)) === "table", "with reduced motion the door opens at once, with no swing to wait for");
  const moving = await still.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  check(moving === 0, `and nothing on the page moves (${moving} animations running)`);

  // ---------------------------------------------------------------- with the scripts blocked, or the wall failing
  const WAYS_IN = ["/lobby/?start", "/table/", "/one-device/hot-potato/"];
  const noScript = await open("no scripts", PHONE, { javaScriptEnabled: false });
  await noScript.goto(base + "/");
  const plain = await noScript.evaluate(() => [...document.querySelectorAll("#doors a")].filter((a) => a.getBoundingClientRect().height > 0).map((a) => `${a.getAttribute("href")} ${a.textContent}`));
  check(plain.map((l) => l.split(" ")[0]).join() === WAYS_IN.join(), `with scripts blocked the three ways in are plain links: ${plain.join(" | ")}`);
  await looksRight(noScript, "the plain links with scripts blocked");
  await shot(noScript, "13-no-scripts-390x844", { fullPage: true });
  const noWall = await open("no wall", PHONE);
  await noWall.route("**/home-wall.js", (r) => r.abort());
  await noWall.goto(base + "/");
  await noWall.waitForTimeout(1500);
  const left = await noWall.evaluate(() => ({ doors: document.querySelectorAll(".door").length, links: [...document.querySelectorAll("#doors a.door-link")].filter((a) => a.getBoundingClientRect().height > 0).map((a) => a.getAttribute("href")) }));
  check(left.doors === 0 && left.links.join() === WAYS_IN.join(), `when the wall does not load the three ways in are still there: ${left.links.join(", ")}`);
  await noWall.tap('a.door-link[href="/table/"]');
  await noWall.waitForURL((url) => url.pathname === "/table/");
  check((await noWall.locator(".door-title").textContent({ timeout: 10000 })) === "Start a party at the Table", "and one of them still leads to its party");

  check(errors.length === 0, `no page logged an error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} catch (err) {
  problems.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} FAILED` : "\nall passed");
process.exit(problems.length ? 1 : 0);
