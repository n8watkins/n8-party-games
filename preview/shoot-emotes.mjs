// Stills and checks of the emotes preview (second round), from the local server's
// /preview/emotes/ (built with --preview: npm run dev). Headless, muted, and closed at the end
// whatever happens.
//
//   node preview/shoot-emotes.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/emotes-v2]
//
// Stills: every candidate's held pose at sideways-phone size (844 x 390), and the list's
// pictures at their real size (a phone showing the whole room, and a big screen) as two sheets,
// for the across-the-room test. Checks: on a sideways phone, an upright phone and a laptop the
// page itself never scrolls, the stage stays where it is while the list scrolls and a row far
// down is tapped, the wheel works by pointer, and no page reports an error.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/emotes-v2"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const SIDEWAYS = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true };
const UPRIGHT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  const errors = [];
  async function open(how, hash = "") {
    const context = await browser.newContext(how);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${hash}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${hash}: ${m.text()}`));
    await page.goto(`${base}/preview/emotes/${hash}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
    return page;
  }

  const first = await open(SIDEWAYS);
  const ids = await first.evaluate(() => [...document.querySelectorAll(".row")].map((r) => r.dataset.id));
  await first.context().close();
  check(ids.length >= 16, `${ids.length} candidates in the list`);
  for (const id of ids) {
    const page = await open(SIDEWAYS, `#still=${id}&look=B`);
    await page.screenshot({ path: `${out}/${id}.png` });
    await page.context().close();
  }
  console.log(`     stills: ${ids.length} held poses`);

  // The across-the-room sheets: the list alone, tall enough to hold every row.
  for (const [name, hash] of [
    ["sheet-phone", ""],
    ["sheet-screen", "#size=screen"],
  ]) {
    const page = await open({ viewport: { width: 760, height: 5200 }, deviceScaleFactor: 1 }, hash);
    await page.locator("#rows").screenshot({ path: `${out}/${name}.png` });
    await page.context().close();
  }
  console.log("     stills: the list's pictures at a phone's and a big screen's real size");

  for (const [name, how] of [
    ["sideways", SIDEWAYS],
    ["upright", UPRIGHT],
    ["laptop", LAPTOP],
  ]) {
    const page = await open(how);
    await page.screenshot({ path: `${out}/page-${name}.png` });
    const scrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1);
    check(!scrolls, `${name}: the page itself does not scroll`);
    const before = await page.locator("#stage").boundingBox();
    // Scroll the list to its end and tap the last row: it plays, and the stage has not moved.
    await page.locator("#pane-list").evaluate((p) => (p.scrollTop = p.scrollHeight));
    const last = page.locator(".row .play").last();
    await last.click();
    await page.waitForTimeout(300);
    const after = await page.locator("#stage").boundingBox();
    const playing = await page.locator(".row.playing").getAttribute("data-id");
    check(Math.abs(before.y - after.y) < 1 && Math.abs(before.x - after.x) < 1 && before.height > 120 && playing === ids.at(-1), `${name}: tapping the last row plays it (${playing}) and the stage stays in view (${Math.round(after.width)} x ${Math.round(after.height)})`);
    await page.screenshot({ path: `${out}/page-${name}-scrolled.png` });
    // The wheel: hold, flick up and to the right, let go.
    await page.locator('[data-pane="wheel"]').click();
    const box = await page.locator("#emote-btn").boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    const opened = await page.locator("#wheel.open").count();
    await page.mouse.move(x + 25, y - 25, { steps: 3 });
    await page.mouse.move(x + 50, y - 30, { steps: 3 });
    await page.screenshot({ path: `${out}/wheel-${name}.png` });
    await page.mouse.up();
    const now = await page.locator("#now .name").textContent();
    check(opened === 1 && (await page.locator("#wheel.open").count()) === 0, `${name}: hold and flick opens the wheel and plays a slot (${now})`);
    await page.locator('[data-pane="picks"]').click();
    await page.locator("#copy").click();
    check((await page.locator("#picks").inputValue()).includes("My wheel:"), `${name}: the picks list is there to copy`);
    await page.context().close();
  }
  // ---------------------------------------------------------------- trying to break it
  for (const [name, how] of [
    ["sideways", SIDEWAYS],
    ["upright", UPRIGHT],
  ]) {
    const page = await open(how);
    const playButtons = page.locator(".row .play");
    const n = await playButtons.count();
    // Every emote back to back, each cut off in the middle by the next: never two sounds from the pawn.
    let most = 0;
    for (let i = 0; i < n; i++) {
      await playButtons.nth(i).click();
      await page.waitForTimeout(i % 3 === 0 ? 900 : 250);
      most = Math.max(most, await page.evaluate(() => globalThis.__preview.board.voices.length));
    }
    check(most <= 1, `${name}: every emote back to back, interrupting each other: at most ${most} sound at a time`);
    // Switching takes while it plays, and tapping as fast as a thumb can.
    const takes = page.locator(".row").first().locator(".take");
    for (let i = 0; i < 6; i++) await takes.nth(i % (await takes.count())).click();
    for (let i = 0; i < 12; i++) await playButtons.nth(i % 4).click({ delay: 10 });
    await page.waitForTimeout(400);
    const voices = await page.evaluate(() => globalThis.__preview.board.voices.length);
    const playing = await page.locator(".row.playing").count();
    check(voices <= 1 && playing === 1, `${name}: take switches and fast taps leave one emote playing (${playing}) and at most one sound (${voices})`);
    // The wheel opened in the middle of an emote, and the phone turned while it is open.
    await playButtons.nth(0).click();
    await page.locator('[data-pane="wheel"]').click();
    const box = await page.locator("#emote-btn").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const tapOpen = await page.locator("#wheel.open.tap").count();
    await page.setViewportSize({ width: how.viewport.height, height: how.viewport.width });
    await page.waitForTimeout(300);
    const afterTurn = await page.locator("#wheel.open").count();
    const scrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1);
    check(tapOpen === 1 && afterTurn === 0 && !scrolls, `${name}: a tap opens the wheel mid-emote; turning the phone closes it and the page still fits`);
    await page.screenshot({ path: `${out}/turned-${name}.png` });
    await page.context().close();
  }
  // A small phone held sideways: the stage must still be a real size.
  {
    const page = await open({ viewport: { width: 568, height: 320 }, deviceScaleFactor: 2, hasTouch: true });
    const box = await page.locator("#stage").boundingBox();
    check(box.height >= 150, `568 x 320 sideways: the stage is ${Math.round(box.width)} x ${Math.round(box.height)}`);
    await page.screenshot({ path: `${out}/page-small-sideways.png` });
    await page.context().close();
  }
  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s). Stills in ${out}` : `\nAll good. Stills in ${out}`);
process.exit(problems.length ? 1 : 0);
