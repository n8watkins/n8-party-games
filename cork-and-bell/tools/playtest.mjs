// The solo playtest: one full run with scripted input in headless Chromium (moves, clicks,
// held keys), with screenshots of the start, the middle, the end card and the game after a
// restart. Run the local server first (npm run dev), then: npm run playtest
//   node cork-and-bell/tools/playtest.mjs [--size=1920x1080] [--touch=1] [--win=0]
// By default it drives Chrome on the Windows side (the real graphics card); --win=0 uses
// Playwright's Chromium in WSL, which renders in software and is far too slow to judge speed.
import { mkdirSync } from "node:fs";
import { BASE, openBrowser, SHOTS } from "./browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const [w, h] = opt("size", "1920x1080").split("x").map(Number);
const base = opt("base", BASE);
const out = opt("out", SHOTS + "/playtest");
const touch = opt("touch", "0") === "1";
mkdirSync(out, { recursive: true });

const browser = await openBrowser({ win: opt("win", "1") === "1", width: w, height: h });
const context = await browser.newContext({ hasTouch: touch, isMobile: touch });
const page = await context.newPage();
const errors = [];
const requests = new Set();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => requests.add(new URL(r.url()).host));
const shot = (name) => page.screenshot({ path: out + "/" + name + ".png" });
const summary = () => page.evaluate(() => window.__cab.summary());
const log = (...a) => console.log(...a);

await page.goto(base + "?seed=11&quality=" + opt("quality", "high"));
await page.waitForFunction(() => window.__cab);
await page.waitForTimeout(2500);
await shot("0-attract");
let s = await summary();
log("attract:", s.mode, "t", s.t, "score", s.stalls[0].score, "(the house plays with no input)");
if (s.mode !== "attract") errors.push("attract mode was not running at load");

// Where things are on screen: ask the page to project the targets.
const targetXY = (id) =>
  page.evaluate((target) => {
    const c = window.__cab;
    const sim = c.session.sims[c.session.mySeat];
    const t = sim.targets().find((x) => x.id === target) ?? sim.targets()[0];
    if (!t) return null;
    // Lead a moving target by its travel during the cork's flight, and hold over for the drop.
    const lead = t.vx * 0.3;
    const hold = t.row === 0 ? 0 : t.row === 1 ? 0.04 : t.row === 2 ? 0.1 : 0.13;
    const [u, v] = c.views[0].view.project(t.x + lead, t.y + hold, t.z);
    return { x: u * innerWidth, y: v * innerHeight, id: t.id };
  }, id);

// The start board: play alone, a battle with friends, and the sound, each spelled out.
const board = await page.evaluate(() => ({
  shown: !document.getElementById("start").hidden,
  choices: [...document.querySelectorAll("#start button b")].map((b) => b.textContent),
  tally: !document.getElementById("tally").hidden,
}));
log("start board:", board.shown ? "shown," : "MISSING,", board.choices.join(" | "));
if (!board.shown || board.choices.length !== 3) errors.push("the start board did not show its three choices");
if (board.tally) errors.push("the tally showed on the start screen");

// First input. With a mouse: moving the pointer leaves the house playing (so the board can be
// read and pressed), and "Play alone" starts the round after a short count. On a phone the very
// first touch on the picture takes the gun and fires where it lifts.
const middlePot = await page.evaluate(() => {
  const [u, v] = window.__cab.views[0].view.project(0, 1.125, -1.52);
  return { x: u * innerWidth, y: v * innerHeight };
});
if (touch) {
  await page.touchscreen.tap(middlePot.x, middlePot.y + Math.min(90, h * 0.11));
} else {
  await page.mouse.move(w * 0.5, h * 0.4, { steps: 3 });
  await page.waitForTimeout(200);
  if ((await summary()).mode !== "attract") errors.push("moving the pointer took the gun before a choice was made");
  await page.locator("#start-solo").click();
  await page.waitForTimeout(1300); // the count-in
}
await page.waitForTimeout(300);
s = await summary();
log("after first input:", s.mode, "t", s.t);
if (s.mode !== "solo") errors.push("the first input did not start a solo round");
if (await page.evaluate(() => !document.getElementById("start").hidden || document.getElementById("tally").hidden)) errors.push("the start board stayed up, or the tally did not show, once the round began");
const first = await targetXY("p2");
if (touch) {
  // Already fired by the first touch.
} else {
  await page.mouse.move(first.x, first.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
}
await page.waitForTimeout(450);
await shot("1-first-click");
s = await summary();
log("first click:", "score", s.stalls[0].score, "shots", s.stalls[0].shots, "hits", s.stalls[0].hits);
if (s.stalls[0].hits < 1) errors.push("the first click did not hit the front row");

// Sound on, from its own control (nothing may sound before this click): every later shot, hit
// and bell runs through the WebAudio code, so an error there would show up in this run.
const silentBefore = await page.evaluate(() => document.getElementById("sound").getAttribute("aria-pressed"));
if (silentBefore !== "false") errors.push("sound was not off at load");
if (touch) await page.locator("#sound").tap();
else await page.locator("#sound").click();
const soundOn = await page.evaluate(() => document.getElementById("sound").getAttribute("aria-pressed"));
log("sound control:", silentBefore === "false" ? "off at load," : "ON AT LOAD,", soundOn === "true" ? "on after its click" : "did not turn on");
if (soundOn !== "true") errors.push("the sound control did not turn sound on");
if (!touch) await page.mouse.move(w * 0.5, h * 0.5);

// The round: aim at what is up, fire in rhythm. Some shots by mouse, some with held keys.
const order = ["p0", "p1", "p3", "p4", "s3", "s4", "d0", "sh", "bell", "d1", "s5", "p2"];
let n = 0;
let midDone = false;
let lateDone = false;
for (;;) {
  s = await summary();
  if (s.over || s.t >= 90) break;
  if (!midDone && s.t > 40) {
    await shot("2-middle");
    midDone = true;
    log("middle:", "t", s.t, "score", s.stalls[0].score, "streak", s.stalls[0].streak, "corks", s.stalls[0].corks);
  }
  if (!lateDone && s.t > 78) {
    await shot("3-last-stretch");
    lateDone = true;
  }
  if (!touch && n % 9 === 8) {
    // Keys: hold an arrow to move the aim, then space to fire.
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(180);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.press("Space");
  } else {
    const p = await targetXY(order[n % order.length]);
    if (p) {
      if (touch) {
        // Drag to aim, release to fire.
        const lift = Math.min(90, h * 0.11);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x - 40, y: p.y + lift + 30 }] });
        await page.waitForTimeout(60);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y + lift }] });
        await page.waitForTimeout(60);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(p.x, p.y, { steps: 4 });
        await page.mouse.down();
        await page.mouse.up();
      }
    }
  }
  n++;
  await page.waitForTimeout(540);
}
await page.waitForTimeout(2600);
await shot("4-end-card");
s = await summary();
const card = await page.evaluate(() => ({ shown: !document.getElementById("card").hidden, title: document.getElementById("card-title").textContent, rows: document.getElementById("card-rows").innerText }));
log("end:", "score", s.stalls[0].score, "hits", s.stalls[0].hits, "of", s.stalls[0].shots, "| card:", card.shown, JSON.stringify(card.title));
if (!card.shown) errors.push("the end card did not show");
if (s.stalls[0].hits < 10) errors.push("the scripted run hit fewer than ten targets");

// Instant restart.
if (touch) await page.locator("#again").tap();
else await page.locator("#again").click();
await page.waitForTimeout(2400);
await shot("5-after-restart");
s = await summary();
log("restart:", s.mode, "t", s.t, "score", s.stalls[0].score, "corks", s.stalls[0].corks);
if (s.mode !== "solo" || s.stalls[0].score !== 0 || s.t > 4) errors.push("restart did not give a fresh round");

const fps = await page.evaluate(() => ({ gpu: window.__cab.gpu(), ...window.__cab.fps() }));
log("frame rate here (software rendering unless the GPU line says otherwise):", JSON.stringify(fps));
const outside = [...requests].filter((host) => host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
log("hosts requested:", [...requests].join(", "));
if (outside.some((host) => !/fonts\.(googleapis|gstatic)\.com$/.test(host))) errors.push("a request left for " + outside.join(", "));
log(errors.length ? "FAILED:\n  " + errors.join("\n  ") : "PASSED");
await browser.close();
process.exit(errors.length ? 1 : 0);
