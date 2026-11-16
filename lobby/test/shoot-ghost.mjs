// The ghost's second half, moment by moment (lobby/shared/ghost.js): the fade, the scare and boo,
// in the flat and the 3D look, on a big screen (1280 x 720) and an upright phone (390 x 844).
// Real pages against a running local server, with each page's clock held still so every still
// is the moment named; the players are sockets, so the moments are exact. The browser is headless
// and muted, and is closed at the end whatever happens. The pictures are for a person to look at;
// nothing is compared.
//
//   node lobby/test/shoot-ghost.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/ghost] [--looks=flat,3d]
//
// For each look and device: Gus (a ghost) fades, Cy (a pawn) kicks him and is scared off, then Gus
// fades again and drifts through Ada (a pawn), who is spooked. The phone is Bea's, a pawn standing
// by; a second upright phone, Gwen's, is a ghost and shows how her own faded ghost looks to her.
// Besides one still per moment, each story is laid side by side in a strip (ffmpeg).
//
// Software drawing whatever TEST_GPU says, as the other still tools (AGENTS.md).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { IMPACT_MS, WINDUP_MS } from "../shared/bump.js";
import { FADE_COOLDOWN_MS, SCARE_FREEZE_MS, SCARE_MS, SCARE_START_MS, SPOOK_MS } from "../shared/ghost.js";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/ghost"));
const looks = opt("looks", "flat,3d").split(",");
mkdirSync(out, { recursive: true });
const { api, call, connect } = partyApi(base);

/** Puts a socket player's piece at x, starting from where the room says it is now. */
async function place(c, x) {
  const room = (await (await fetch(`${api}/debug/${c.room.code}`)).json()).room;
  const me = room.view.members[c.seat];
  c.x = me.x;
  c.rev = me.rev;
  c.goto(x);
  await sleep(250);
}
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

/** The moments of each story, in page milliseconds after the message that starts it. */
const FADE = [
  ["a-fading", 120],
  ["b-faded", 700],
];
const SCARE = [
  ["a-wind-up", WINDUP_MS - 10],
  ["b-start", IMPACT_MS + SCARE_START_MS * 0.5],
  ["c-frozen", IMPACT_MS + SCARE_START_MS + SCARE_FREEZE_MS * 0.4],
  ["d-frozen-late", IMPACT_MS + SCARE_START_MS + SCARE_FREEZE_MS * 0.9],
  ["e-running", IMPACT_MS + SCARE_START_MS + SCARE_FREEZE_MS + 140],
  ["f-away", SCARE_MS + 250],
];
const SPOOK = [
  ["a-boo", 60],
  ["b-start", 130],
  ["c-running", 300],
  ["d-away", SPOOK_MS + 250],
];

/** Lays stills side by side in one picture. */
function strip(files, to) {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `hstack=inputs=${files.length}`, to]);
    console.log(`     strip: ${to}`);
  } catch (e) {
    console.log(`     (no strip: ${e.message.split("\n")[0]})`);
  }
}

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

  for (const look of looks) {
    console.log(`\n     -- the ${look} look`);
    // "real": the Star Lounge made of rendered layers (look3d/rendered/), the 3D look's own pieces over it; "baked": the bar's baked drawing.
    const query = { "3d": "look=3d&gl=any", real: "look=real&gl=any", baked: "look=baked&gl=any" }[look] ?? "look=flat";
    const drawn = look === "flat" ? "svg.scene text" : ".look3d canvas";
    const screen = await open(`${look} screen`, { width: 1280, height: 720 });
    await screen.goto(`${base}/lobby/?start&${query}${look === "real" ? "&room=ship" : ""}`);
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
    await screen.waitForSelector(drawn, { timeout: 60000 });
    await screen.waitForSelector(".code-digits");
    const pin = (await screen.locator(".code-digits").textContent()).trim();
    const join = async (name, viewport) => {
      const page = await open(`${look} ${name}`, viewport, { hasTouch: true });
      await page.goto(`${base}/lobby/?join=${pin}&${query}`);
      await page.fill("input[name=nickname]", name);
      await page.click("text=Join the party");
      await page.waitForSelector(drawn, { timeout: 60000 });
      return page;
    };
    const phone = await join("Bea", { width: 390, height: 844 });
    const [gus, cy, ada] = await Promise.all(["Gus", "Cy", "Ada"].map(async (nickname) => connect(await call("POST", "/join/" + pin, { nickname }))));
    await Promise.all([gus, cy, ada].map((c) => c.opened));
    await gus.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 8000, 0);
    gus.send({ t: "look", c: "ghost", v: "#8a5bc4" });
    await gus.wait((m) => m.room?.members[gus.seat]?.character === "ghost", 4000, 0);
    const N = gus.room.boxes.length;
    const mid = Math.round(boxCentre(0, N));
    // Gus in the first light; Bea's phone piece stands a little to his left, so her phone frames it.
    gus.goto(mid);
    ada.goto(mid + 420);
    cy.goto(mid + 260);
    const B = gus.room.members.find((m) => m?.name === "Bea").seat;
    await phone.keyboard.down("ArrowRight");
    await sleep(Math.max(80, ((mid - 150 - gus.room.members[B].x) / 430) * 1000));
    await phone.keyboard.up("ArrowRight");
    await sleep(look !== "flat" ? 2500 : 900);
    const drawer = await screen.evaluate(() => window.__room3d?.constructor?.name ?? "flat");
    console.log(`     the screen draws the room with: ${drawer}`);

    for (const [page, device] of [
      [screen, "screen"],
      [phone, "phone"],
    ]) {
      const shoot = async (story, moments) => {
        let at = 0;
        const files = [];
        for (const [name, ms] of moments) {
          await page.clock.runFor(Math.max(0, Math.round(ms - at)));
          at = Math.round(ms);
          // A software-drawn 3D frame can lag a step behind the clock: one more frame.
          if (look !== "flat") await page.clock.runFor(17).then(() => (at += 17));
          const file = `${out}/${look}-${device}-${story}-${name}.png`;
          await page.screenshot({ path: file, timeout: 120000 });
          files.push(file);
        }
        strip(files, `${out}/strip-${look}-${device}-${story}.png`);
      };
      // The scare: Gus in the light, Ada well away, Cy right of Gus, facing him, close enough to kick.
      await place(gus, mid);
      await place(ada, mid + 420);
      await place(cy, mid + 70);
      cy.send({ t: "m", x: cy.x, d: -1, r: cy.rev });
      cy.send({ t: "m", x: cy.x, d: 0, r: cy.rev });
      await sleep(1200);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 400));
      let mark = gus.seen.length;
      gus.send({ t: "fade" });
      check(!!(await gus.wait((m) => m.t === "fade" && m.s === gus.seat, 3000, mark).catch(() => null)), `${look} ${device}: Gus fades`);
      await sleep(250);
      await shoot("1-fade", FADE);
      await page.clock.resume();
      // The scare: a fresh fade, and the kick straight after it (a software still takes longer
      // than the fade lasts, so the fade above is long over by now).
      await sleep(FADE_COOLDOWN_MS + 300);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 400));
      mark = gus.seen.length;
      gus.send({ t: "fade" });
      await gus.wait((m) => (m.t === "fade" && m.s === gus.seat) || m.t === "fade-no", 3000, mark).catch(() => null);
      cy.send({ t: "b" });
      const blow = await gus.wait((m) => m.t === "b" && m.s === cy.seat, 3000, mark).catch(() => null);
      check(blow?.sc === gus.seat, `${look} ${device}: Cy's kick goes through, and Cy is scared off (${JSON.stringify(blow)}; the room had ${JSON.stringify((await (await fetch(`${api}/debug/${gus.room.code}`)).json()).room.view.members.filter(Boolean).map((m) => [m.name, m.x, m.faded ?? 0, m.safe]))})`);
      await sleep(250);
      await shoot("2-scare", SCARE);
      await page.clock.resume();

      // Boo: once the fade is ready again, Gus fades and drifts through Ada.
      await sleep(FADE_COOLDOWN_MS + 300);
      // Cy at the far wall, in the dark: with everyone in a light the count would run, and a ghost cannot fade during it.
      await place(gus, mid);
      await place(cy, 1880);
      await place(ada, mid + 30);
      await sleep(900);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 400));
      mark = gus.seen.length;
      gus.send({ t: "fade" });
      await gus.wait((m) => m.t === "fade" && m.s === gus.seat, 3000, mark).catch(() => null);
      gus.send({ t: "m", x: gus.x, d: 1, r: gus.rev });
      gus.send({ t: "boo", to: ada.seat });
      const spook = await gus.wait((m) => m.t === "spook" || m.t === "boo-no", 3000, mark).catch(() => null);
      gus.send({ t: "m", x: gus.x, d: 0, r: gus.rev });
      check(spook?.to === ada.seat && spook.t === "spook", `${look} ${device}: Gus drifts through Ada and spooks her (${spook?.t} ${spook?.why ?? ""} ${JSON.stringify(gus.seen.slice(mark).filter((m) => m.t !== "m" && m.t !== "vote").map((m) => m.t + (m.why ? ":" + m.why : "")))})`);
      await sleep(250);
      await shoot("3-boo", SPOOK);
      await page.clock.resume();
      // Everyone back for the next device: Ada and Cy where they were, and the cooldowns over.
      await sleep(FADE_COOLDOWN_MS + 300);
      await place(ada, mid + 420);
      await place(cy, mid + 260);
      // A 3D page drawn in software takes the whole machine for every frame: the next device gets its stills only once this one is gone.
      if (look !== "flat" && device === "screen") await page.context().close();
    }

    // Gwen's own phone: her ghost faded, as she sees it. Ada leaves to make room (four players at most).
    ada.send({ t: "leave" });
    await sleep(800);
    const gwen = await join("Gwen", { width: 390, height: 844 });
    // A software-drawn 3D page on a busy machine can take a while to settle its bar.
    await gwen.locator(".look-btn").click({ timeout: 90000 });
    await gwen.locator('.look-card[data-character="ghost"]').click({ timeout: 90000 });
    await gwen.locator(".look-sheet >> text=Done").click({ timeout: 90000 });
    await gus.wait((m) => m.room?.members.some((x) => x?.name === "Gwen" && x.character === "ghost"), 4000, 0);
    await sleep(look !== "flat" ? 2000 : 600);
    await gwen.keyboard.press("KeyX");
    await sleep(800);
    await gwen.screenshot({ path: `${out}/${look}-phone-4-own-fade.png` });
    console.log(`     still: ${look}-phone-4-own-fade`);
    check((await gwen.locator(".ctl-bump .ctl-word").textContent()) === "Fade", `${look}: Gwen's move button is Fade`);
    await gwen.context().close();

    check(!errors.length, `no page reported an error in the ${look} look` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    errors.length = 0;
    for (const c of [gus, cy, ada]) c.ws.close();
    if (look === "flat") await screen.context().close();
    await phone.context().close();
  }
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good. Stills are in " + out);
process.exit(problems.length ? 1 : 0);
