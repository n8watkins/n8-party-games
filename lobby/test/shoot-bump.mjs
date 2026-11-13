// The bump, moment by moment, in both drawings of the room: the flat one and the 3D one
// (?look=3d). Real pages against a running local server, with each page's clock held still so
// every still is exactly the moment named. The browser is headless and muted, and is closed
// at the end whatever happens.
//
//   node lobby/test/shoot-bump.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/bump] [--looks=flat,3d]
//
// For each look: a big screen (1920 x 1080) and a phone held sideways (844 x 390) watch two
// socket players. One kicks the other; the stills are the wind-up, the contact, the
// follow-through, the victim in the air, landed, getting up and up again. Besides the stills
// it checks what the eye is asked to judge: that in the flat drawing the bumper's base, not
// its head, is what travels (lobby/shared/bump.js decides that; this reads it off the page).
//
// WSL has no graphics card, so the 3D pages draw WebGL in software (?gl=any).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { BUMP_COOLDOWN_MS, DOWN_MS, FLIGHT_MS, GETUP_MS, HIT_PAUSE_MS, IMMUNE_MS, IMPACT_MS, PIECE_HEAD, RECOVER_MS, STUN_MS, WINDUP_MS } from "../shared/bump.js";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/bump"));
const looks = opt("looks", "flat,3d").split(",");
mkdirSync(out, { recursive: true });
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

/** The moments worth a still, in milliseconds after the bump. */
const MOMENTS = [
  ["0-before", 1],
  ["1-wind-up", WINDUP_MS - 6],
  ["2-contact", IMPACT_MS + 20],
  ["3-follow-through", IMPACT_MS + HIT_PAUSE_MS + RECOVER_MS * 0.27],
  ["4-airborne", IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS * 0.5],
  ["5-landed", IMPACT_MS + HIT_PAUSE_MS + FLIGHT_MS + DOWN_MS * 0.7],
  ["6-getting-up", STUN_MS - GETUP_MS * 0.45],
  ["7-up", STUN_MS + 200],
];

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
    const query = look === "3d" ? "&look=3d&gl=any" : "";
    const drawn = look === "3d" ? "canvas" : "svg.scene text";
    const screen = await open(`${look} screen`, { width: 1920, height: 1080 });
    await screen.goto(base + "/lobby/?start" + query);
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
    await screen.waitForSelector(drawn);
    await screen.waitForSelector(".code-digits");
    const pin = (await screen.locator(".code-digits").textContent()).trim();
    // Software WebGL at twice the pixels is too slow for a still to be taken in time, so the 3D phone is drawn at one.
    const phone = await open(`${look} phone`, { width: 844, height: 390 }, { deviceScaleFactor: look === "3d" ? 1 : 2, hasTouch: true });
    await phone.goto(base + "/lobby/?join=" + pin + query);
    await phone.fill("input[name=nickname]", "Dolly");
    await phone.click("text=Join the party");
    await phone.waitForSelector(drawn);
    const [fitch, tom] = [await call("POST", "/join/" + pin, { nickname: "Fitch" }), await call("POST", "/join/" + pin, { nickname: "Tom" })].map(connect);
    await Promise.all([fitch.opened, tom.opened]);
    await fitch.wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 8000, 0);
    const N = fitch.room.boxes.length;
    // The two stand in the first light, the kicker on the left facing right; the phone's own piece walks over to watch.
    const mid = Math.round(boxCentre(0, N));
    fitch.goto(mid - 40);
    fitch.send({ t: "m", x: fitch.x, d: 1, r: fitch.rev });
    fitch.send({ t: "m", x: fitch.x, d: 0, r: fitch.rev });
    await phone.keyboard.down("ArrowRight");
    await sleep(280);
    await phone.keyboard.up("ArrowRight");
    await sleep(look === "3d" ? 2500 : 900);
    check(look !== "3d" || (await screen.evaluate(() => !!window.__room3d)), `the ${look} look is what drew the room`);

    for (const [page, device, clip] of [
      [screen, "screen", { x: 200, y: 380, width: 760, height: 610 }],
      [phone, "phone", undefined],
    ]) {
      tom.goto(mid + 36);
      await sleep(BUMP_COOLDOWN_MS + 400);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 400));
      const mark = fitch.seen.length;
      fitch.send({ t: "b" });
      const blow = await fitch.wait((m) => m.t === "b" && m.s === fitch.seat, 3000, mark);
      check(blow.to === tom.seat, `(${look}, ${device}: the kick lands)`);
      await sleep(300); // the message reaches the page, whose clock stands still
      let at = 0;
      const seen = {};
      for (const [name, ms] of MOMENTS) {
        await page.clock.runFor(Math.round(ms - at));
        at = Math.round(ms);
        // A software-drawn 3D frame can lag a step behind the clock: one more frame, with no time passing to speak of.
        if (look === "3d") await page.clock.runFor(17).then(() => (at += 17));
        await page.screenshot({ path: `${out}/${look}-${device}-${name}.png`, clip });
        console.log(`     still: ${look}-${device}-${name}`);
        if (look === "flat") {
          // Where the bumper's head and base are drawn, from its transform, as offsets from where it stands.
          seen[name] = await page.evaluate(
            ([seat, head]) => {
              const t = document.querySelector(`svg.scene g[data-seat="${seat}"]`).getAttribute("transform");
              const tr = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(t);
              const ro = /rotate\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/.exec(t);
              const [x, y, a, pivot] = [Number(tr[1]), Number(tr[2]), ((ro ? Number(ro[1]) : 0) * Math.PI) / 180, ro ? -Number(ro[3]) : 0];
              return { baseX: x - pivot * Math.sin(a), baseY: y - pivot * (1 - Math.cos(a)), headX: x + (head - pivot) * Math.sin(a), headY: y - pivot - (head - pivot) * Math.cos(a) };
            },
            [fitch.seat, PIECE_HEAD],
          );
        }
      }
      if (look === "flat") {
        const [rest, wind, hit, through] = [seen["0-before"], seen["1-wind-up"], seen["2-contact"], seen["3-follow-through"]];
        check(wind.baseX < rest.baseX - 50 && wind.baseY < rest.baseY - 25 && Math.abs(wind.headX - rest.headX) < 14, `${device}: winding up, the piece is off the floor and its base is swung back ${Math.round(rest.baseX - wind.baseX)} units while its head moves ${Math.round(Math.abs(wind.headX - rest.headX))}`);
        check(hit.baseX > rest.baseX + 75 && Math.abs(hit.headX - rest.headX) < 18, `${device}: at contact the base is ${Math.round(hit.baseX - rest.baseX)} units forward and the head ${Math.round(hit.headX - rest.headX)}: a kick, not a headbutt`);
        check(hit.baseY < rest.baseY - 25 && hit.baseY > rest.baseY - 75, `${device}: and it lands low, ${Math.round(rest.baseY - hit.baseY)} units off the floor`);
        check(through.baseY < hit.baseY - 20, `${device}: the follow-through carries the base on up`);
      }
      await page.clock.runFor(IMMUNE_MS + 600);
      await page.clock.resume();
      // A 3D page drawn in software takes the whole machine for every frame: the next device gets its stills only once this one is gone.
      if (look === "3d" && device === "screen") await page.context().close();
    }
    check(!errors.length, `no page reported an error in the ${look} look` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
    errors.length = 0;
    for (const c of [fitch, tom]) c.ws.close();
    if (look !== "3d") await screen.context().close();
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
