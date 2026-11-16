// Stills of the four characters side by side in the live party room, in every look, for a person
// to look at (nothing is compared): real pages and sockets against a running local server. The
// browser is headless and muted, and is closed at the end whatever happens.
//
//   node lobby/test/shoot-characters.mjs [--base=http://localhost:8791] [--out=lobby/test/shots/characters]
//        [--looks=flat,3d,baked,real] [--only=line|emotes|colours]
//
// The made-real look (real) is drawn for a wall of five boxes, so for it the server must run
// without the test game (--var PARTY_TEST_GAMES:off). With TEST_GPU=1 the pages draw on the
// graphics card (lobby/test/browser.mjs).
//
// In each look a laptop (1280 x 720) is a pawn and a phone held upright (390 x 844) picks the ghost
// through its own sheet; two sockets are a slime and a robot. The four stand in a row, and it shoots:
//   line     the row under a game's lamp and in the dark between two, from both devices
//   emotes   the slime and the robot doing each of the fourteen emotes at once, at each one's best moment
//   colours  the slime and the robot in each of the ten preset colours, lit and in the dark (phone)
//   motion   the phone as a slime, then a robot: setting off, walking, stopping, and bumped by the pawn
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EMOTES, EMOTE_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
import { SLIME_RIG } from "../public/characters/slime.js";
import { COLOUR_PRESETS, LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { boxCentre } from "../shared/world.js";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const out = resolve(opt("out", "lobby/test/shots/characters"));
const looks = opt("looks", "flat,3d,baked,real").split(",").filter(Boolean);
const only = opt("only", "");
const want = (part) => !only || only.split(",").includes(part);
mkdirSync(out, { recursive: true });
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};

const query = (look) => (look === "flat" ? "look=flat" : look === "real" ? "look=real&room=ship&gl=any" : `look=${look}&gl=any`);
const SPACING = 135;

const browser = await launchBrowser({ args: ["--autoplay-policy=user-gesture-required", "--ignore-gpu-blocklist"] });
try {
  const errors = [];
  async function open(name, viewport, extra) {
    const context = await browser.newContext({ viewport, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => (m.type() === "error" || (m.type() === "warning" && /THREE\./.test(m.text()))) && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const drawn = (page, look) => (look === "flat" ? page.waitForSelector("svg.scene g[data-seat]", { timeout: 30000 }) : page.waitForFunction(() => window.__room3d?.pieces?.size > 0, null, { timeout: 60000 }));
  const shot = async (page, name) => {
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
    console.log(`     still: ${out}/${name}.png`);
  };

  for (const look of looks) {
    console.log(`\n     -- ${look}`);
    const host = await call("POST", "/rooms", { nickname: "Gus" });
    const gus = connect(host);
    await gus.opened;
    const rob = connect({ pin: host.pin, ...(await call("POST", "/join/" + host.pin, { nickname: "Rob" })) });
    await rob.opened;
    const laptop = await open(`laptop (${look})`, { width: 1280, height: 720 }, { deviceScaleFactor: 1 });
    const phone = await open(`phone (${look})`, { width: 390, height: 844 }, { deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    for (const [page, name] of [
      [laptop, "Lea"],
      [phone, "Pat"],
    ]) {
      await page.goto(`${base}/lobby/?join=${host.pin}&${query(look)}`);
      await page.waitForSelector(".door-title");
      await page.fill("input[name=nickname]", name);
      await page.click("text=Join the party");
      await drawn(page, look);
    }
    await gus.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 10000, 0);
    const seatOf = (name) => gus.room.members.find((m) => m?.name === name).seat;
    const [G, R, L, P] = ["Gus", "Rob", "Lea", "Pat"].map(seatOf);

    // The phone picks the ghost and violet on its own sheet; the sockets are a teal slime and a red robot.
    await phone.locator(".look-btn").click();
    await phone.waitForSelector(".look-sheet");
    await phone.locator('.look-card[data-character="ghost"]').click();
    await gus.wait((m) => m.room?.members[P]?.character === "ghost", 5000, 0);
    await phone.locator('.look-swatch[data-colour="#8a5bc4"]').click();
    if (look === looks[0]) await shot(phone, `picker-390x844`);
    await gus.wait((m) => m.room?.members[P]?.colour === "#8a5bc4", 5000, 0);
    await phone.click(".look-sheet >> text=Done");
    gus.send({ t: "look", c: "slime", v: "#3aa9a0" });
    rob.send({ t: "look", c: "robot", v: "#c8382c" });
    await gus.wait((m) => m.room?.members[G]?.character === "slime" && m.room?.members[R]?.character === "robot", 5000, 0);

    const n = gus.room.boxes.length;
    const where = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view.members;
    /** Walks a page's own piece to x with its arrow keys, as a player would. */
    async function walkTo(page, seat, x) {
      let gap = Infinity;
      for (let i = 0; i < 20; i++) {
        gap = x - (await where())[seat].x;
        if (Math.abs(gap) < 18) return;
        const key = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await sleep(Math.max(30, Math.min(1500, (Math.abs(gap) / 430) * 1000 - 40)));
        await page.keyboard.up(key);
        await sleep(300);
      }
      check(false, `${look}: seat ${seat} walked to ${Math.round(x)} (still ${Math.round(gap)} away)`);
    }
    /** Stands the four in a row centred on x: the pawn, the ghost, the slime, the robot. */
    async function row(x) {
      gus.goto(x + SPACING * 0.5);
      rob.goto(x + SPACING * 1.5);
      await walkTo(laptop, L, x - SPACING * 1.5);
      await walkTo(phone, P, x - SPACING * 0.5);
      // Facing the middle of the row, and still.
      await sleep(1200);
    }
    const lit = boxCentre(0, n);
    // The dark: between two games that are not built yet, whose lamps are off.
    const off = gus.room.boxes.map((b, i) => (b.soon ? i : -1)).filter((i) => i >= 0);
    const dark = off.length >= 2 ? (boxCentre(off[0], n) + boxCentre(off[1], n)) / 2 : boxCentre(Math.min(n - 1, 3), n);

    if (want("line")) {
      await row(lit);
      await shot(phone, `${look}-line-lit-390x844`);
      await shot(laptop, `${look}-line-lit-1280x720`);
      await row(dark);
      await shot(phone, `${look}-line-dark-390x844`);
      await shot(laptop, `${look}-line-dark-1280x720`);
    }

    if (want("emotes")) {
      await row(lit);
      for (const e of EMOTES) {
        const rig = SLIME_RIG.find((r) => r.id === e.id);
        gus.send({ t: "e", e: e.id });
        rob.send({ t: "e", e: e.id });
        await sleep(rig.hold);
        await Promise.all([shot(phone, `${look}-emote-${e.id}-390x844`), shot(laptop, `${look}-emote-${e.id}-1280x720`)]);
        await sleep(Math.max(EMOTE_COOLDOWN_MS, rig.dur - rig.hold) + 200);
      }
    }

    if (want("colours")) {
      for (const [place, x] of [
        ["lit", lit],
        ["dark", dark],
      ]) {
        await row(x);
        for (const c of COLOUR_PRESETS) {
          await sleep(LOOK_COOLDOWN_MS + 50);
          const from = gus.seen.length;
          gus.send({ t: "look", v: c.hex });
          rob.send({ t: "look", v: c.hex });
          await gus.wait((m) => m.room?.members[G]?.colour === c.hex && m.room?.members[R]?.colour === c.hex, 5000, from).catch(() => check(false, `${look}: ${c.name} reached the room`));
          await sleep(500);
          await shot(phone, `${look}-colour-${place}-${c.hex.slice(1)}-390x844`);
        }
      }
    }

    if (want("motion")) {
      // The phone becomes each of the new characters in turn: it sets off, walks, stops, and is bumped by the laptop's pawn.
      for (const c of ["slime", "robot"]) {
        await row(dark);
        // The two sockets step well away to the left, clear of where the phone's piece is walked and thrown.
        gus.goto(dark - 700);
        rob.goto(dark - 560);
        await sleep(LOOK_COOLDOWN_MS + 50);
        await phone.locator(".look-btn").click();
        await phone.locator(`.look-card[data-character="${c}"]`).click();
        await gus.wait((m) => m.room?.members[P]?.character === c, 5000, 0);
        await phone.click(".look-sheet >> text=Done");
        await sleep(1200);
        await phone.keyboard.down("ArrowRight");
        for (const ms of [90, 200, 420]) {
          await sleep(ms);
          await shot(phone, `${look}-motion-${c}-walk-${ms}`);
        }
        await phone.keyboard.up("ArrowRight");
        for (const ms of [0, 90, 200]) {
          await sleep(ms);
          await shot(phone, `${look}-motion-${c}-stop-${ms}`);
        }
        // Bumped: the pawn walks up behind it and kicks.
        await sleep(1500);
        const x = (await where())[P].x;
        await walkTo(laptop, L, x - 80);
        await laptop.keyboard.press("ArrowRight");
        await sleep(300);
        await laptop.keyboard.press("KeyX");
        for (const [i, ms] of [200, 150, 200, 450].entries()) {
          await sleep(ms);
          await shot(phone, `${look}-motion-${c}-bumped-${i + 1}`);
        }
        await sleep(2600);
      }
    }

    for (const c of [gus, rob]) c.ws.close();
    for (const page of [laptop, phone]) await page.context().close();
  }
  check(errors.length === 0, `no page reported an error${errors.length ? ":\n       " + [...new Set(errors)].slice(0, 8).join("\n       ") : ""}`);
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
