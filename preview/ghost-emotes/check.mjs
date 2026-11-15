// Checks the built page in a headless, muted browser and writes pictures to look at.
//
//   node preview/ghost-emotes/check.mjs <out-dir> [sheets] [layout] [stress]
//
//   sheets  every emote and take held at its best moment, six to a picture, solid and faded
//   layout  the whole page at four phone sizes, with measurements: no page scroll, nothing
//           overlapping, nothing outside the screen, no request to anywhere
//   stress  spam taps, an emote cut off halfway, a rotation, the size and fade buttons
//
// Run it through the machine's heavy-job slot: devguard slot -- node preview/ghost-emotes/check.mjs ...
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) throw new Error("Give a folder for the pictures.");
const want = new Set(process.argv.slice(3));
const all = want.size === 0;
await mkdir(out, { recursive: true });
const url = pathToFileURL(join(here, "dist", "wrapped.html")).href;
const { GHOST_RIG } = await import("./src/ghost-rig.js");

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`FAIL  ${msg}`);
};

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => fail(`${width}x${height}: page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && fail(`${width}x${height}: console error: ${m.text()}`));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  return { page, context, requests };
}

if (all || want.has("sheets")) {
  const { page, context } = await open(844, 390);
  const stage = page.locator("#stage");
  for (const faded of [false, true]) {
    if (faded) await page.locator("#faded").tap();
    const shots = [];
    for (const rig of GHOST_RIG)
      for (const take of rig.takes) {
        await page.evaluate(([id, t, ms]) => window.__ghostEmotes.stage.freeze(id, t, ms), [rig.id, take, rig.hold]);
        shots.push({ name: `${rig.id} / ${take}`, png: await stage.screenshot() });
      }
    const meta = await sharp(shots[0].png).metadata();
    const [w, h] = [meta.width, meta.height];
    for (let i = 0; i < shots.length; i += 6) {
      const group = shots.slice(i, i + 6);
      const label = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="40"><rect width="${w}" height="40" fill="#000"/><text x="12" y="28" font-family="sans-serif" font-size="26" fill="#fff">${s}</text></svg>`);
      const file = join(out, `sheet-${faded ? "faded" : "solid"}-${String(i / 6 + 1).padStart(2, "0")}.jpg`);
      await sharp({ create: { width: w * 3, height: (h + 40) * 2, channels: 3, background: "#000" } })
        .composite(group.flatMap((s, j) => [{ input: label(s.name), left: (j % 3) * w, top: Math.floor(j / 3) * (h + 40) }, { input: s.png, left: (j % 3) * w, top: Math.floor(j / 3) * (h + 40) + 40 }]))
        .jpeg({ quality: 82 })
        .toFile(file);
      console.log(file);
    }
  }
  await context.close();
}

const SIZES = [[390, 844], [844, 390], [667, 375], [360, 640], [640, 360], [412, 915]];

/** Measures the page: scrolling, things outside the screen, things on top of each other. */
function measure() {
  const out = [];
  const doc = document.scrollingElement;
  if (doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1) out.push(`the page scrolls: ${doc.scrollWidth}x${doc.scrollHeight} in ${innerWidth}x${innerHeight}`);
  const box = (el) => el.getBoundingClientRect();
  const shown = (el) => el.getClientRects().length > 0 && !el.closest("[hidden]");
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const stage = box(document.getElementById("stage"));
  const side = box(document.getElementById("side"));
  if (hit(stage, side)) out.push("the stage and the panel overlap");
  for (const r of [stage, side]) if (r.left < 15.5 || r.right > innerWidth - 15.5 || r.top < 0 || r.bottom > innerHeight) out.push(`a panel leaves the screen or its gutter: ${JSON.stringify(r)}`);
  // The stage's own controls: inside the stage, none on another, none under the phone-size picture.
  const ctl = [...document.querySelectorAll("#strip button, #inset, #size-now")].filter(shown);
  for (const el of ctl) {
    const r = box(el);
    if (r.left < stage.left || r.right > stage.right + 0.5 || r.top < stage.top || r.bottom > stage.bottom + 0.5) out.push(`${el.id || el.textContent} leaves the stage`);
  }
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) if (hit(box(ctl[i]), box(ctl[j]))) out.push(`${ctl[i].id || ctl[i].textContent} is on ${ctl[j].id || ctl[j].textContent}`);
  // In Large mode the word bubble never runs under the phone-size corner picture.
  const inset = document.getElementById("inset");
  if (document.getElementById("stage").dataset.size === "large" && inset && shown(inset)) {
    const ir = box(inset);
    for (const s of document.querySelectorAll('#overlay svg:not([style*="display: none"]) .emote-sticker:not([display="none"])'))
      if (hit(box(s), ir)) out.push("the word bubble overlaps the phone-size picture");
  }
  // Every row: its controls inside it and beside each other; no text cut off.
  for (const row of document.querySelectorAll(".row")) {
    if (!shown(row)) continue;
    const rr = box(row);
    const kids = [...row.querySelectorAll("button")];
    for (const k of kids) {
      const r = box(k);
      if (r.left < rr.left - 0.5 || r.right > rr.right + 0.5) out.push(`${row.dataset.id}: a control leaves its row`);
      if (k.scrollWidth > k.clientWidth + 1) out.push(`${row.dataset.id}: "${k.textContent}" is cut off`);
      if (r.height < 36 || (r.width < 36 && !k.closest(".seg"))) out.push(`${row.dataset.id}: "${k.textContent || k.className}" is too small to tap (${r.width.toFixed(0)}x${r.height.toFixed(0)})`);
    }
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(box(kids[i]), box(kids[j]))) out.push(`${row.dataset.id}: two controls overlap`);
  }
  for (const b of document.querySelectorAll(".tabs button, #strip button")) if (b.scrollWidth > b.clientWidth + 1) out.push(`"${b.textContent}" is cut off`);
  return out;
}

if (all || want.has("layout")) {
  for (const [w, h] of SIZES) {
    const { page, context, requests } = await open(w, h);
    await page.evaluate(() => window.__ghostEmotes.stage.freeze("redcard", "wisp", 1100));
    for (const m of await page.evaluate(measure)) fail(`${w}x${h}: ${m}`);
    await page.screenshot({ path: join(out, `layout-${w}x${h}.png`) });
    for (const mode of ["tv", "phone"]) {
      await page.locator(`#sizes [data-v="${mode}"]`).tap();
      await page.evaluate(() => window.__ghostEmotes.stage.freeze("redcard", "wisp", 1100));
      for (const m of await page.evaluate(measure)) fail(`${w}x${h} ${mode}: ${m}`);
      await page.locator("#stage").screenshot({ path: join(out, `layout-${w}x${h}-${mode}.png`) });
    }
    for (const tab of ["picks", "notes"]) {
      await page.locator(`.tabs [data-pane="${tab}"]`).tap();
      for (const m of await page.evaluate(measure)) fail(`${w}x${h} ${tab}: ${m}`);
      await page.screenshot({ path: join(out, `layout-${w}x${h}-${tab}.png`) });
    }
    const outside = requests.filter((r) => r !== url && !r.startsWith("data:") && !r.startsWith("blob:"));
    if (outside.length) fail(`${w}x${h}: asked for ${outside.join(", ")}`);
    console.log(`${w}x${h}: size ${await page.locator("#stage").getAttribute("data-size")}, ${requests.length} request(s)`);
    await context.close();
  }
}

if (all || want.has("stress")) {
  const { page, context, requests } = await open(390, 844);
  const rows = page.locator(".row .play");
  const n = await rows.count();
  // Spam: forty taps across rows, takes, stars and crosses, as fast as they go.
  for (let i = 0; i < 40; i++) {
    const row = page.locator(".row").nth((i * 5) % n);
    const what = [".play", ".seg button", ".mark.yes", ".mark.no"][i % 4];
    await row.locator(what).last().tap({ timeout: 4000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
  // Cut one off halfway with another: only the new one may be on the stage.
  await rows.nth(0).tap();
  await page.waitForTimeout(900);
  await rows.nth(3).tap();
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    playing: window.__ghostEmotes.stage.playing,
    lit: [...document.querySelectorAll('.row[data-on="1"]')].map((r) => r.dataset.id),
    stickers: [...document.querySelectorAll('#overlay svg:not([style*="display: none"]) .emote-sticker:not([display="none"]) text')].map((t) => t.textContent),
  }));
  console.log("after an interruption:", JSON.stringify(state));
  if (state.playing?.id !== "redcard" || state.lit.join() !== "redcard") fail(`an interrupted emote: ${JSON.stringify(state)}`);
  if (state.stickers.some((s) => s !== "RED CARD")) fail(`a word from the emote before is still showing: ${state.stickers}`);
  await page.screenshot({ path: join(out, "stress-interrupted.png") });
  // Faded and each size, while it plays.
  await page.locator("#faded").tap();
  for (const mode of ["tv", "phone", "large"]) {
    await page.locator(`#sizes [data-v="${mode}"]`).tap();
    await page.waitForTimeout(150);
  }
  // Rotate mid-emote, and back.
  await rows.nth(6).tap();
  await page.waitForTimeout(700);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  for (const m of await page.evaluate(measure)) fail(`after a rotation: ${m}`);
  await page.screenshot({ path: join(out, "stress-rotated.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  for (const m of await page.evaluate(measure)) fail(`after rotating back: ${m}`);
  await page.screenshot({ path: join(out, "stress-rotated-back.png") });
  // The picks: what was starred is in the text.
  await page.locator('.tabs [data-pane="picks"]').tap();
  console.log(await page.locator("#picks-text").textContent());
  const outside = requests.filter((r) => r !== url && !r.startsWith("data:") && !r.startsWith("blob:"));
  if (outside.length) fail(`asked for ${outside.join(", ")}`);
  await context.close();
}

await browser.close();
console.log(failures.length ? `${failures.length} failure(s)` : "all checks passed");
process.exit(failures.length ? 1 : 0);
