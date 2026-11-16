// End to end, in real pages (headless and muted): one party, two waiting rooms.
//
//   node lobby/test/e2e-two-rooms.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/two-rooms]
//
// Ann starts a party on a phone held sideways, Bo joins on an upright phone and a laptop joins as
// the big screen, all in the character room (/lobby/). Ann opens Rooms and moves the party to
// Turn-based: every page covers itself for a moment and becomes the plain waiting room (/party/),
// seated as before. Cy joins on a small phone while the party is there and lands there. Bo's tap
// on the switch is refused with the reason. Ann switches back: everyone is in the character room
// again. Along the way: stills at 390x844, 844x390, 320x568 and 1280x720, the plain room never
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
  const inPlain = (page) => page.waitForSelector(".switch", { timeout: 30000 });
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
      return { wide: document.documentElement.scrollWidth > innerWidth, small, clipped };
    });
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
  check(item.height >= 44 && item.y + item.height <= 390, `the host's "Move the party to Turn-based" is in the picker, on screen, ${Math.round(item.height)} pixels tall`);
  check(sheet.y >= 0, "the picker fits the sideways phone");
  const boBefore = await bo.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).token);
  await ann.click(".mode-choice");
  await ann.waitForSelector(".hop-cover", { timeout: 3000 });
  await shot(ann, "11-switch-cover-844x390");
  check((await ann.locator(".hop-words").textContent()) === "Moving to Turn-based", "Ann's page says: Moving to Turn-based");
  await Promise.all([landed(ann, "/party/"), landed(bo, "/party/"), landed(tv, "/party/")]);
  check(true, "every page moved itself to the plain waiting room: both phones and the big screen");
  const boAfter = await bo.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).token);
  check(boBefore === boAfter, "Bo kept his seat's session through the move: the same token");
  await bo.waitForSelector(".note", { timeout: 3000 }).catch(() => null);
  const said = await bo.locator(".note").first().textContent().catch(() => "");
  check(said === "Ann moved the party here", `Bo's plain room says who moved it: "${said}"`);
  await bo.waitForTimeout(600);
  await shot(bo, "20-plain-guest-390x844");
  await shot(ann, "21-plain-host-844x390");
  await shot(tv, "22-plain-screen-1280x720");
  const names = await bo.locator(".person-name").allTextContents();
  check(names.join() === "Ann,Bo,The big screen", `who is here, in seat order, then the screen: ${names.join(", ")}`);
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
  await ann.waitForFunction(() => document.querySelectorAll(".person").length === 4);
  await cy.waitForTimeout(600);
  await shot(cy, "23-plain-guest-320x568");
  await looksRight(cy, "plain room 320x568");
  await tv.waitForFunction(() => document.querySelectorAll(".person").length === 4);
  await tv.waitForTimeout(4600); // the notes have gone
  await shot(tv, "26-plain-screen-three-players-1280x720");
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

  // ---------------------------------------------------------------- Bo may not switch
  // The option says it is not his to tap (aria-disabled), but a finger can tap it anyway.
  await bo.click(".switch-option[data-mode=party-games]", { force: true });
  await bo.waitForSelector(".switch-why:visible");
  const why = await bo.locator(".switch-why").textContent();
  check(/Only Ann can switch rooms/.test(why), `Bo's tap on the switch is refused, with the reason: "${why}"`);
  await bo.waitForTimeout(500);
  await shot(bo, "25-plain-guest-refused-390x844");
  check(new URL(bo.url()).pathname === "/party/", "and Bo stays where he is");

  // ---------------------------------------------------------------- and back
  await ann.waitForTimeout(MODE_COOLDOWN_MS);
  await ann.click(".switch-option[data-mode=party-games]");
  await ann.waitForSelector(".hop-cover", { timeout: 4000 });
  await Promise.all([landed(ann, "/lobby/"), landed(bo, "/lobby/"), landed(tv, "/lobby/"), landed(cy, "/lobby/")]);
  check(true, "Ann switches back: every page, Cy's too, is in the character room again");
  await bo.waitForTimeout(1200);
  await shot(bo, "30-back-in-the-room-390x844");
  await shot(ann, "31-back-in-the-room-844x390");
  const members = await ann.evaluate(() => fetch(`/api/lobby/join/${JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby")).pin}`).then((r) => r.json()));
  check(members.preview.players.join() === "Ann,Bo,Cy" && members.preview.mode === "party-games", `the same party, seated as before: ${members.preview.players.join(", ")}`);
} finally {
  await browser.close();
}
check(!errors.length, `no page logged an error${errors.length ? `: ${errors.join(" | ")}` : ""}`);
console.log(`\nstills in ${out}`);
console.log(problems.length ? `${problems.length} problem(s)` : "all good");
console.log("Not checked here: a real phone, full screen after the move, and a page loaded before this change.");
process.exit(problems.length ? 1 : 0);
