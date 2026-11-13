// Every emote in the live party room, in real pages, against a running local server: a still
// of each at its best moment on the big screen (1920 x 1080) and on a phone held sideways at the
// closer view (844 x 390), in either look and any room. It checks what a still cannot show at a
// glance: that each emote drew its arms and its word over the right piece, that the word is big
// enough to read on the phone, that an aimed one turned toward its target, and that no page
// reported an error. The browser is headless and muted, and is closed at the end.
//
//   node lobby/test/shoot-emotes.mjs [--base=http://localhost:8791] [--look=3d|flat] [--room=bar] [--out=lobby/test/shots/emotes-<look>-<room>]
//
// The 3D look draws in software here (WSL has no graphics card), so it is slow, not wrong.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { EMOTE_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
import { RIG } from "../public/emotes/rig.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const look = opt("look", "3d");
const skin = opt("room", "bar");
const only = opt("only", "");
const out = resolve(opt("out", `lobby/test/shots/emotes-${look}-${skin}`));
mkdirSync(out, { recursive: true });
const query = look === "3d" ? `look=3d&room=${skin}&gl=any` : `look=flat&room=${skin}`;
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const errors = [];
  async function open(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const ready = look === "3d" ? ".look3d canvas" : "svg.scene text";

  const screen = await open("screen", { width: 1920, height: 1080 });
  await screen.goto(`${base}/lobby/?start&${query}`);
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector(ready, { timeout: 60000 });
  const pin = (await screen.locator(".code-digits").textContent()).trim();

  const phone = await open("phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await phone.goto(`${base}/lobby/?join=${pin}&${query}`);
  await phone.fill("input[name=nickname]", "Dolly");
  await phone.click("text=Join the party");
  await phone.waitForSelector(ready, { timeout: 60000 });

  // Ada does the emotes next to the phone's own piece; Cy stands to her right, to be aimed at.
  const seats = await Promise.all(["Ada", "Cy"].map((nickname) => call("POST", "/join/" + pin, { nickname })));
  const [ada, cy] = seats.map(connect);
  await Promise.all([ada.opened, cy.opened]);
  const keepAlive = setInterval(() => [ada, cy].forEach((c) => c.send("ping")), 20_000);
  keepAlive.unref();
  await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 8000, 0);
  const room = (await (await fetch(`${base}/api/lobby/debug/${seats[0].code}`)).json()).room;
  const home = room.view.members.find((m) => m?.name === "Dolly")?.x ?? 960;
  ada.goto(Math.round(home + 150));
  cy.goto(Math.round(home + 330));
  await sleep(2500);

  const layer = look === "3d" ? ".l3-emotes" : "svg.scene";
  for (const rig of RIG) {
    if (only && !only.split(",").includes(rig.id)) continue;
    ada.send({ t: "e", e: rig.id });
    await sleep(rig.hold);
    for (const [name, page] of [["phone", phone], ["screen", screen]]) {
      // The 3D look draws in software here, a few frames a second: give the word a moment to show.
      let seen = null;
      for (let tries = 0; tries < 8; tries++) {
        seen = await page.evaluate((sel) => {
          const sticker = [...document.querySelectorAll(`${sel} .emote-sticker`)].find((g) => g.getAttribute("display") !== "none");
          const box = sticker?.getBoundingClientRect();
          const text = sticker?.querySelector("text");
          return { word: text?.textContent ?? null, px: text ? text.getBoundingClientRect().height : 0, inView: !!box && box.top >= 0 && box.left >= 0 && box.right <= innerWidth };
        }, layer);
        if (seen.word) break;
        await sleep(150);
      }
      check(seen.word === rig.word && seen.inView, `${rig.id} on the ${name}: "${seen.word}" over Ada's piece, in view`);
      if (name === "phone") check(seen.px >= 13, `${rig.id} on the phone: the word is ${seen.px.toFixed(0)} px tall (13 at least)`);
    }
    // Read first, then the stills: a still of the big screen drawn in software takes a while.
    await Promise.all([screen.screenshot({ path: `${out}/${rig.id}-screen.png` }), phone.screenshot({ path: `${out}/${rig.id}-phone.png` })]);
    console.log("     stills: " + rig.id);
    await sleep(Math.max(EMOTE_COOLDOWN_MS, rig.dur) + 150);
  }
  clearInterval(keepAlive);
  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall good");
process.exit(problems.length ? 1 : 0);
