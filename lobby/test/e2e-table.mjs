// End to end, in real pages (headless and muted): a game at the Table.
//
//   node lobby/test/e2e-table.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/table]
//
// Ann, Bo and Cy form a party on the Floor on upright phones, and Ann moves it to the Table. The
// test game shows only on Ann's page, whose address has #dev. Ann picks Count to ten: every page
// sees it starting, then becomes the game. They play it in turns; Bo's page reloads mid-game and
// comes back to the game with his own secret word. Nobody's page ever shows another's word. When
// someone says ten, all three are back at the Table with the result. Along the way: stills at
// 390x844, nothing scrolls sideways, every tap target is at least 44 pixels, and no page logs an
// error.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/table"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const errors = [];
try {
  async function open(name) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    page.label = name;
    return page;
  }
  const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
  const inRoom = (page) => page.waitForSelector(".bar", { timeout: 30000 });
  async function atTable(page) {
    await page.waitForURL((url) => new URL(url).pathname === "/party/", { timeout: 20000 });
    await page.waitForSelector(".digits", { timeout: 30000 });
  }
  async function looksRight(page, label) {
    const m = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll("button, a")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.height < 44 || r.width < 44)) small.push(`${el.className || el.tagName}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { wide: document.documentElement.scrollWidth > innerWidth, small };
    });
    check(!m.wide, `${label}: nothing scrolls sideways`);
    check(!m.small.length, `${label}: every tap target is at least 44 pixels${m.small.length ? ` (${m.small.join(", ")})` : ""}`);
  }

  // ---------------------------------------------------------------- a party, moved to the Table
  const ann = await open("Ann");
  await ann.goto(`${base}/lobby/?start&look=flat`);
  await ann.fill("input[name=nickname]", "Ann");
  await ann.click("button[type=submit]");
  await inRoom(ann);
  const pin = await ann.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin);
  const players = { ann };
  for (const name of ["Bo", "Cy"]) {
    const page = await open(name);
    await page.goto(`${base}/lobby/?join=${pin}&look=flat`);
    await page.fill("input[name=nickname]", name);
    await page.click("button[type=submit]");
    await inRoom(page);
    players[name.toLowerCase()] = page;
  }
  const { bo, cy } = players;
  const all = [ann, bo, cy];
  await ann.click(".rooms-btn");
  await ann.waitForSelector(".mode-choice:visible");
  await ann.click(".mode-choice");
  await Promise.all(all.map(atTable));
  check(true, `Ann, Bo and Cy are at the Table (${pin})`);

  // ---------------------------------------------------------------- the list
  await ann.evaluate(() => (location.hash = "#dev"));
  await ann.waitForSelector(".game.test button.game-row");
  check((await bo.locator(".game.test").count()) === 0, "the test game is hidden without #dev: Bo does not see it");
  const soon = await bo.locator(".game.off .game-why").allTextContents();
  check(soon.join() === "Coming soon,Coming soon", `Paper Masks and Who Am I? are listed as coming soon: ${soon.join(", ")}`);
  check((await bo.locator("button.game-row").count()) === 0, "Bo is not the host: no game is a button for him");
  await ann.waitForFunction(() => !document.querySelector(".line.noting"), null, { timeout: 8000 });
  await shot(ann, "10-table-list-host-dev-390x844");
  await ann.locator(".games").scrollIntoViewIfNeeded();
  await shot(ann, "11-table-games-host-dev-390x844");
  await looksRight(ann, "Table list, host");

  // ---------------------------------------------------------------- the pick, and the beat
  await ann.click(".game.test button.game-row");
  await Promise.all(all.map((p) => p.waitForSelector(".banner.starting", { timeout: 4000 })));
  const beat = await cy.locator(".banner.starting .banner-title").textContent();
  check(beat === "Count to ten is starting", `everyone sees it starting: "${beat}"`);
  await cy.locator(".banner").scrollIntoViewIfNeeded();
  await shot(cy, "20-starting-390x844");
  await Promise.all(all.map((p) => p.waitForSelector(".stage:not([hidden]) .ctt-count", { timeout: 8000 })));
  check(true, "then every page shows the game");
  const words = {};
  for (const [name, page] of Object.entries(players)) words[name] = await page.locator(".ctt-secret strong").textContent();
  check(new Set(Object.values(words)).size === 3, `each player has their own secret word: ${Object.values(words).join(", ")}`);
  check(await ann.locator(".stop").isVisible(), "the host has End the game");
  check(await bo.locator(".stop").isHidden(), "Bo has not");
  const line = await bo.locator(".line-text").textContent();
  check(line.includes(pin), `the code stays in the line while the game is on: "${line}"`);

  // ---------------------------------------------------------------- playing, with a reload
  /** Whoever's turn it is presses +1; returns that page's label. */
  async function pressOnce(add) {
    for (let tries = 0; tries < 100; tries++) {
      for (const page of all) {
        const button = page.locator(`.ctt-add[data-add="${add}"]:not([disabled])`);
        if (await button.count()) {
          const before = await page.locator(".ctt-count").textContent();
          await button.click();
          await page.waitForFunction((b) => document.querySelector(".ctt-count")?.textContent !== b || !document.querySelector(".ctt-count"), before, { timeout: 5000 });
          return page.label;
        }
      }
      await ann.waitForTimeout(100);
    }
    throw new Error("nobody could press");
  }
  await pressOnce(2);
  await pressOnce(2);
  await shot(ann, "30-game-host-390x844");
  await shot(bo, "31-game-bo-390x844");
  const count = await ann.locator(".ctt-count").textContent();
  check(count === "4", `two presses of two: the count is ${count} on Ann's page`);
  await bo.reload();
  await bo.waitForSelector(".stage:not([hidden]) .ctt-count", { timeout: 15000 });
  const again = await bo.locator(".ctt-secret strong").textContent();
  const boCount = await bo.locator(".ctt-count").textContent();
  check(again === words.bo && boCount === "4", `Bo reloaded mid-game and is back in it, with his own word (${again}) and the count (${boCount})`);
  await looksRight(bo, "the game, Bo after a reload");
  for (const [name, page] of Object.entries(players)) {
    const text = await page.evaluate(() => document.body.innerText);
    const others = Object.entries(words).filter(([who]) => who !== name).map(([, w]) => w);
    check(!others.some((w) => new RegExp(`\\b${w}\\b`).test(text)), `${page.label}'s page shows nobody else's word`);
  }
  let presses = 2;
  while ((await ann.locator(".ctt-count").count()) && (await ann.locator(".ctt-count").textContent()) !== "10" && presses < 20) {
    await pressOnce(2);
    presses++;
    if (!(await ann.locator(".stage:not([hidden])").count())) break;
  }

  // ---------------------------------------------------------------- back at the Table, with the result
  await Promise.all(all.map((p) => p.waitForSelector(".card:not([hidden]) .card-rows li", { timeout: 8000 })));
  check(true, `someone said ten after ${presses} presses: all three are back at the Table with the card`);
  for (const page of all) check(new URL(page.url()).pathname === "/party/" && (await page.locator(".stage").isHidden()), `${page.label}'s page is the Table again`);
  const title = await bo.locator(".card-head h3").textContent();
  const rows = await bo.locator(".card-rows li").count();
  check(/^Count to ten: (Ann|Bo|Cy) won$/.test(title) && rows === 3, `the card: "${title}", ${rows} rows`);
  await bo.locator(".card").scrollIntoViewIfNeeded();
  await shot(bo, "40-result-390x844");
  await looksRight(bo, "the Table with the card");
  const points = await bo.locator(".person .tag.points").count();
  check(points === 3, `everyone placed scored, on who is here: ${points} with points`);
  await bo.click(".card-done");
  check(await bo.locator(".card").isHidden(), "Done puts the card away");
} finally {
  await browser.close();
}
check(!errors.length, `no page logged an error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
console.log(`\nstills in ${out}`);
console.log(problems.length ? `${problems.length} problem(s)` : "all good");
console.log("Not checked here: a real phone, a sideways phone or big screen during a game, and the host ending a game (unit tests cover it).");
process.exit(problems.length ? 1 : 0);
