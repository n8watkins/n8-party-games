// Stills of the emotes and sounds preview, from the local server's /preview/emotes/ (built with
// --preview: npm run dev). Headless, muted, and closed at the end whatever happens.
//
//   node preview/shoot-emotes.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/emotes]
//
// Every candidate's held pose at sideways-phone size (844 x 390), the three ways to trigger them,
// and the whole page on a phone held upright and sideways. It also checks that no page reports
// an error and that the page never scrolls sideways. Stills land in --out, which is not
// committed; a chosen dozen are copied to preview/shots/ by hand.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/emotes"));
mkdirSync(out, { recursive: true });
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const SIDEWAYS = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true };
const UPRIGHT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
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

  const ids = await (await open(SIDEWAYS)).evaluate(() => [...document.querySelectorAll(".card")].map((c) => c.dataset.id));
  check(ids.length >= 18, `${ids.length} candidates on the page`);
  for (const id of ids) {
    const page = await open(SIDEWAYS, `#still=${id}&look=B`);
    await page.screenshot({ path: `${out}/${id}.png` });
    await page.context().close();
  }
  console.log(`     stills: ${ids.length} held poses`);
  for (const look of ["A", "C"]) {
    const page = await open(SIDEWAYS, `#still=dab&look=${look}`);
    await page.screenshot({ path: `${out}/dab-${look}.png` });
    await page.context().close();
  }
  for (const how of ["wheel", "slots", "strip"]) {
    const page = await open(SIDEWAYS, `#still=${how}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/trigger-${how}.png`, fullPage: false });
    await page.context().close();
  }
  console.log("     stills: the three ways to trigger, and treatments A and C");

  for (const [name, how] of [
    ["sideways", SIDEWAYS],
    ["upright", UPRIGHT],
  ]) {
    const page = await open(how);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(!wide, `${name}: the page does not scroll sideways`);
    await page.screenshot({ path: `${out}/page-${name}.png`, fullPage: true });
    // The wheel: hold, flick up and to the right, let go: the stage plays that slot.
    await page.locator("#emote-btn").scrollIntoViewIfNeeded();
    const box = await page.locator("#emote-btn").boundingBox();
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    const opened = await page.locator("#wheel.open").count();
    await page.mouse.move(x + 25, y - 25, { steps: 3 });
    await page.mouse.move(x + 50, y - 30, { steps: 3 });
    await page.screenshot({ path: `${out}/wheel-held-${name}.png` });
    await page.mouse.up();
    const now = await page.locator("#now").textContent();
    check(opened === 1 && (await page.locator("#wheel.open").count()) === 0 && !now.startsWith("Tap an emote"), `${name}: hold and flick opens the wheel and plays the slot (${now.trim()})`);
    await page.locator("#copy").click();
    check((await page.locator("#picks").inputValue()).includes("My wheel:"), `${name}: the picks list is there to copy`);
    await page.context().close();
  }
  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s). Stills in ${out}` : `\nAll good. Stills in ${out}`);
process.exit(problems.length ? 1 : 0);
