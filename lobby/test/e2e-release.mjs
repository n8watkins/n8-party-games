// "New version available", end to end against a local Worker (site/release-switch.js, and the
// room's side in lobby/server/release-points.js). A deploy is simulated the way a real one changes
// things: a file the site serves changes, Wrangler rebuilds, and the Worker, its rooms and
// /api/version come back as a new build while the pages that were open stay on the old one.
//
//   - The Floor, in the lobby: both phones are older; it is a safe point, so each reloads once, by
//     itself, and is back in its own seat with the same session.
//   - The Table, in a game (Count to ten, turn-based: it outlives the restart): the phones are
//     older but the room is busy, so each shows "New version ready, it will load after this round"
//     and does not reload; when the host ends the game, each reloads once, back in its seat.
//   - The front page, shown again after a deploy: it reloads into the new build.
//   - Hot Potato on one device: shown again on its start screen it reloads; in a round it does not.
//   - No page ever reloads twice for one build, and none runs modules of two builds.
//
// The "deploy" writes landing/public/release-test.txt (gitignored; served only by the local
// environment's build, at /preview/landing/) and removes it at the end.
//
//   npm run dev        (or: npx wrangler dev --local --env local --port PORT --persist-to <empty folder>)
//   node lobby/test/e2e-release.mjs --base=http://localhost:8791
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRIGGER = join(ROOT, "landing", "public", "release-test.txt");
const NOTICE = "New version ready, it will load after this round";
const SESSION = "party-kit:session:/api/lobby";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

/** The build the live site serves now. */
async function live() {
  const res = await fetch(`${base}/api/version`, { cache: "no-store" });
  return (await res.json()).release;
}

/** A deploy: a served file changes, and this waits for the Worker to come back as a new build. */
let deploys = 0;
async function deploy() {
  const before = await live();
  deploys += 1;
  writeFileSync(TRIGGER, `deploy ${deploys} at ${Date.now()}\n`);
  const until = Date.now() + 120_000;
  for (;;) {
    let now = null;
    try {
      now = await live();
    } catch {
      // The Worker is restarting.
    }
    if (now && now !== before) return now;
    if (Date.now() > until) throw new Error("the local Worker did not come back as a new build in two minutes");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await launchBrowser({ software: true });
const errors = [];
try {
  /** Every load of each page's main frame, and every module it ran from which build. */
  async function open(name, { width = 390, height = 844 } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: ANDROID });
    const page = await context.newPage();
    page.label = name;
    page.loads = 0;
    page.on("load", () => (page.loads += 1));
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  /** The build a page is running: its own copy of /release.js (a module is fetched once per page load). */
  const buildOf = (page) => page.evaluate(async () => (await import("/release.js")).RELEASE.id);
  const sessionOf = (page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), SESSION);
  /** The page is shown again, as when a phone is unlocked. */
  const shownAgain = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  /** Waits until the page has reloaded into build `id` (a new load, and its /release.js is that build). */
  async function reloadedInto(page, id, loads) {
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      if (page.loads > loads) {
        try {
          if ((await buildOf(page)) === id) return true;
        } catch {
          // Mid-navigation.
        }
      }
      await page.waitForTimeout(200);
    }
    return false;
  }

  // ---------------------------------------------------------------- the Floor, in the lobby
  const ann = await open("Ann");
  await ann.goto(`${base}/lobby/?start&look=flat`);
  await ann.fill("input[name=nickname]", "Ann");
  await ann.click("button[type=submit]");
  await ann.waitForSelector(".bar", { timeout: 60_000 });
  const pin = (await sessionOf(ann)).pin;
  const bo = await open("Bo", { width: 844, height: 390 });
  await bo.goto(`${base}/lobby/?join=${pin}&look=flat`);
  await bo.fill("input[name=nickname]", "Bo");
  await bo.click("button[type=submit]");
  await bo.waitForSelector(".bar", { timeout: 60_000 });
  const first = await live();
  check((await buildOf(ann)) === first && (await buildOf(bo)) === first, `both phones run the live build (${first})`);
  const seats = { ann: await sessionOf(ann), bo: await sessionOf(bo) };
  const loads = { ann: ann.loads, bo: bo.loads };

  const second = await deploy();
  console.log(`     deployed: ${first} -> ${second}`);
  for (const [name, page] of [["Ann", ann], ["Bo", bo]]) {
    const ok = await reloadedInto(page, second, loads[name.toLowerCase()]);
    check(ok, `the Floor in the lobby: ${name}'s phone reloaded itself into the new build`);
    await page.waitForSelector(".bar", { timeout: 60_000 });
    const now = await sessionOf(page);
    const was = seats[name.toLowerCase()];
    check(now?.token === was.token && now?.seat === was.seat, `${name} is back in the same seat (${was.seat}) with the same session`);
    check(!(await page.locator(".release-note").count()), `${name} never saw the notice: the lobby is a safe point`);
  }
  // Settled: a little later, nobody has reloaded again.
  await ann.waitForTimeout(3000);
  check(ann.loads === loads.ann + 1 && bo.loads === loads.bo + 1, `each phone reloaded exactly once (Ann ${ann.loads - loads.ann}, Bo ${bo.loads - loads.bo})`);
  const members = await (await fetch(`${base}/api/lobby/join/${pin}`)).json();
  check(JSON.stringify(members).includes("Ann") && JSON.stringify(members).includes("Bo"), "the party still has both of them");

  // ---------------------------------------------------------------- the Table, in a game
  await ann.click(".rooms-btn");
  await ann.waitForSelector(".mode-choice:visible");
  await ann.click(".mode-choice");
  for (const page of [ann, bo]) await page.waitForSelector(".digits", { timeout: 30_000 });
  await ann.evaluate(() => (location.hash = "#dev"));
  await ann.waitForSelector(".game.test button.game-row");
  await ann.click(".game.test button.game-row");
  for (const page of [ann, bo]) await page.waitForSelector(".stage:not([hidden]) .ctt-count", { timeout: 30_000 });
  check(true, "at the Table, Count to ten is on for both");
  const tableSeats = { ann: await sessionOf(ann), bo: await sessionOf(bo) };
  const tableLoads = { ann: ann.loads, bo: bo.loads };

  const third = await deploy();
  console.log(`     deployed: ${second} -> ${third}`);
  // The phones are shown again (or their sockets come back by themselves): the room says it is busy.
  for (const page of [ann, bo]) await shownAgain(page);
  for (const [name, page] of [["Ann", ann], ["Bo", bo]]) {
    let said = null;
    try {
      said = await page.waitForFunction(() => document.querySelector(".release-note")?.textContent, null, { timeout: 30_000 }).then((h) => h.jsonValue());
    } catch {
      said = null;
    }
    check(said === NOTICE, `the Table in a game: ${name} sees "${NOTICE}" (${JSON.stringify(said)})`);
  }
  check(ann.loads === tableLoads.ann && bo.loads === tableLoads.bo, "and nobody reloads while the game is on");
  check((await ann.locator(".stage:not([hidden]) .ctt-count").count()) === 1, "the game is still on Ann's phone");
  const notice = await ann.locator(".release-note").boundingBox();
  await ann.screenshot({ path: join(ROOT, "lobby", "test", "shots", "release-table-notice-390x844.png") }).catch(() => {});
  check(notice && notice.height <= 40, `the notice is one small line (${notice ? Math.round(notice.height) : "none"} px)`);

  // The host ends the game: back at the Table, a safe point, and both reload.
  await ann.click(".stop");
  await ann.click(".confirm .button:not(.quiet)");
  for (const [name, page] of [["Ann", ann], ["Bo", bo]]) {
    const ok = await reloadedInto(page, third, tableLoads[name.toLowerCase()]);
    check(ok, `the game over: ${name}'s phone reloaded itself into the new build`);
    await page.waitForSelector(".digits", { timeout: 60_000 });
    const now = await sessionOf(page);
    check(now?.token === tableSeats[name.toLowerCase()].token, `${name} is back at the Table in the same seat`);
    check(!(await page.locator(".release-note").count()), `${name}'s notice is gone`);
  }
  await ann.waitForTimeout(3000);
  check(ann.loads === tableLoads.ann + 1 && bo.loads === tableLoads.bo + 1, `each phone reloaded exactly once for this build (Ann ${ann.loads - tableLoads.ann}, Bo ${bo.loads - tableLoads.bo})`);

  // ---------------------------------------------------------------- outside a room
  const front = await open("front page");
  await front.goto(`${base}/`);
  await front.waitForSelector("#releaseLine:not(:empty)");
  const potato = await open("Hot Potato");
  await potato.goto(`${base}/one-device/hot-potato/`);
  await potato.waitForSelector("#s-start");
  const played = await open("Hot Potato in a round");
  await played.goto(`${base}/one-device/hot-potato/`);
  await played.waitForSelector("#s-start");
  await played.click("#s-start");
  let inRound = false;
  try {
    await played.waitForFunction(() => document.getElementById("game")?.dataset.screen === "turn", null, { timeout: 20_000 });
    inRound = true;
  } catch {
    inRound = false;
  }
  const outside = { front: front.loads, potato: potato.loads, played: played.loads };
  const fourth = await deploy();
  console.log(`     deployed: ${third} -> ${fourth}`);
  for (const page of [front, potato, played]) await shownAgain(page);
  check(await reloadedInto(front, fourth, outside.front), "the front page, shown again, reloaded into the new build");
  check((await front.locator("#releaseLine").textContent()).includes(fourth), "and its footer line names it");
  check(await reloadedInto(potato, fourth, outside.potato), "Hot Potato on its start screen, shown again, reloaded into the new build");
  if (inRound) {
    await played.waitForTimeout(4000);
    check(played.loads === outside.played && (await buildOf(played)) === third, "Hot Potato in a round, shown again, did not reload");
  } else console.log("     (Hot Potato did not reach a round in this browser: its in-round check is left out)");

  // ---------------------------------------------------------------- one build per page
  for (const page of [ann, bo, front, potato]) {
    const mixed = await page.evaluate(async () => {
      const own = (await import("/release.js")).RELEASE.id;
      const live = (await (await fetch("/api/version", { cache: "no-store" })).json()).release;
      return { own, live };
    });
    check(mixed.own === mixed.live, `${page.label} runs one build, the live one (${mixed.own})`);
  }
  check(!errors.length, `no page reported an error${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
} finally {
  rmSync(TRIGGER, { force: true });
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall passed");
