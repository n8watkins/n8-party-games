// Stills and checks of a room made real (?look=real) in the live party room, in real pages against
// a running local server, with the same moments in today's 3D look of that room to set beside them
// (--look=3d). The browser is headless and muted, and is closed at the end whatever happens.
//
//   npx wrangler dev --local --env local --port 8857 --var PARTY_TEST_GAMES:off
//   node lobby/test/shoot-real.mjs [--room=ship|bar] [--base=http://localhost:8857] [--out=<folder>] [--look=real|3d] [--rung=0]
//
// --room: the Star Lounge (ship, the default) or the bar. The rendered picture is of a wall of five
// boxes, so the server runs without the test game. One page is the room's big screen (1280 x 720),
// one a player's phone (Dolly) whose window is set to each phone size in turn; Mabel (a violet
// ghost), Fitch (a teal pawn) and Tom (a cream ghost) are plain sockets (lobby/test/client.mjs).
// It shoots: a vote in progress (Dolly, Mabel and Fitch in Cork & Bell's light, Tom in the dark
// by Flood's poster), an emote playing, the Tonight board open, the room's own moment (the Star Lounge's chart table
// set off; the bar's lightning), and each thing that passes the window held at its entry, middle
// and exit. It checks that the look asked for is the one drawing, that nothing passing changes a
// pixel that is not glass, what the device fetched, that the ladder and the fall back work, and
// that no page logged an error; for the bar also that the eye moves with the view while the
// pieces keep their places on the screen, and that a bump does not shake the picture.
//
// WSL has no graphics card, so these pages draw WebGL in software (?gl=any): right for a still,
// wrong for speed (the frame times it prints are a software renderer's).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { wallFor } from "../shared/rooms.js";
import { RENDERED } from "../public/look3d/rendered/switch.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8857");
const lookName = opt("look", "real");
const roomId = opt("room", "ship");
const DEF = RENDERED[roomId];
if (!DEF) throw new Error(`no rendered room "${roomId}": ${Object.keys(RENDERED).join(", ")}`);
const out = resolve(opt("out", `lobby/test/shots/${lookName}-${DEF.name}`));
const rung = opt("rung", "0");
const only = opt("only", "");
const query = `look=${lookName}&room=${roomId}&gl=any${lookName === "real" ? `&rung=${rung}` : ""}`;
/**
 * What is the room's own. `passing`: each thing that passes the window, the points of its way to
 * hold it at for its entry, middle and exit stills, and where (the bar's: which window, which way).
 * `late`: one layer to hold back, to show the room does not wait for it.
 */
const ROOMS = {
  ship: {
    passing: [["rocket", [0.37, 0.5, 0.63]], ["liner", [0.39, 0.5, 0.61]], ["saucer", [0.37, 0.5, 0.63]], ["rock0", [0.37, 0.5, 0.63]], ["rock1", [0.37, 0.5, 0.63]], ["rock2", [0.37, 0.5, 0.63]], ["star", [0.2, 0.5, 0.8]]].map(([name, at]) => ({ name, at, opts: {} })),
    late: "planet.webp",
  },
  bar: {
    passing: [
      { name: "umbrella", at: [0.32, 0.47, 0.62], opts: { win: "left", dir: -1, r: 0.3 }, tag: "left" },
      { name: "umbrella", at: [0.32, 0.47, 0.62], opts: { win: "right", dir: 1, r: 0.7 }, tag: "right" },
      { name: "cat", at: [0.18, 0.5, 0.86], opts: { win: "right", dir: 1, r: 0.5 } },
      { name: "boat", at: [0.2, 0.5, 0.8], opts: { win: "right", dir: 1, r: 0.5 } },
      { name: "shop", at: [0.05, 0.5, 0.95], opts: { win: "right", dir: 1, r: 0.5 }, tag: "right" },
      { name: "shop", at: [0.05, 0.5, 0.95], opts: { win: "left", dir: 1, r: 0.5 }, tag: "left" },
    ],
    late: "street-right.webp",
  },
};
const OWN = ROOMS[roomId];
mkdirSync(out, { recursive: true });
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const want = (name) => !only || name.includes(only);

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sockets = [];
try {
  const errors = [];
  async function open(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    // three.js's own warnings count too (a material with no side, say): they mean something in the drawing is wrong.
    page.on("console", (m) => (m.type() === "error" || (m.type() === "warning" && /THREE\./.test(m.text()))) && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const shot = async (page, name) => {
    if (!want(name)) return;
    // (A software renderer on a busy machine can take a while to give a frame.)
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
    console.log("     still: " + `${out}/${name}.png`);
  };
  /** What the page is drawing with: its look, rung and the bytes it fetched of the rendered layers. */
  const drawn = (page) =>
    page.evaluate(() => {
      const v = window.__room3d;
      const layers = performance.getEntriesByType("resource").filter((r) => r.name.includes("/look3d/rendered/"));
      return { stats: v?.stats(), meter: document.querySelector(".frame-meter")?.textContent ?? "", fetched: layers.length, bytes: layers.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0), files: layers.map((r) => r.name.split("/").pop()) };
    });

  // ---------------------------------------------------------------- the big screen
  const screen = await open("screen", { width: 1280, height: 720 });
  await screen.goto(`${base}/lobby/?start&${query}&meter=1`);
  await screen.click("text=Use this as the room's screen");
  await screen.click("text=Show the room here");
  await screen.waitForSelector(".look3d canvas", { timeout: 90000 });
  await screen.waitForSelector(".l3-sign");
  const pin = (await screen.locator(".code-digits").textContent()).trim();
  await sleep(2500);
  const s0 = await drawn(screen);
  console.log(`     the screen draws: ${JSON.stringify(s0.stats?.rung ?? s0.stats?.skin)}; meter "${s0.meter}"; fetched ${s0.fetched} rendered files, ${s0.bytes} bytes`);
  if (lookName === "real") {
    check(s0.stats?.look === "real", `the rendered ${DEF.name} drew the room (${s0.stats?.rung})`);
    check(s0.meter.startsWith(`real ${DEF.name}`), `the frame meter names it: "${s0.meter.split(" · ")[0]}"`);
  } else {
    // Only the switch itself (look3d/rendered/switch.js: a few lines of logic the room view asks) is fetched by everyone.
    check(s0.files.join() === "switch.js", `today's 3D look fetched none of the rendered layers or drawing, only the switch (${s0.files.join(", ")}: ${s0.bytes} bytes)`);
  }
  check((await screen.locator(".l3-pin").textContent()) === pin, "the code is on the wall: " + pin);
  const boxes = await screen.evaluate(() => window.__room3d.room.boxes.map((b) => b.name));
  const N = boxes.length;
  check(N === 5, "a wall of five boxes: " + boxes.join(", "));
  await shot(screen, "01-screen-1280x720-empty");

  // ---------------------------------------------------------------- the phone, and three more players
  const phone = await open("phone", { width: 844, height: 390 }, { deviceScaleFactor: 2, hasTouch: true });
  await phone.goto(`${base}/lobby/?join=${pin}&${query}`);
  await phone.fill("input[name=nickname]", "Dolly");
  await phone.click("text=Join the party");
  await phone.waitForSelector(".look3d canvas", { timeout: 90000 });
  await phone.waitForSelector(".l3-tag.you");
  const sessions = [];
  for (const nickname of ["Mabel", "Fitch", "Tom"]) sessions.push(await call("POST", "/join/" + pin, { nickname }));
  const [mabel, fitch, tom] = sessions.map((s) => connect(s));
  sockets.push(mabel, fitch, tom);
  await Promise.all(sockets.map((c) => c.opened));
  await mabel.wait((m) => m.room?.members.filter((x) => x?.connected).length === 4, 8000, 0);
  // Characters in their chosen colours: Mabel a violet ghost, Fitch a teal pawn, Tom a cream ghost (Dolly stays a gilt pawn).
  mabel.send({ t: "look", c: "ghost", v: "#8a5bc4" });
  fitch.send({ t: "look", c: "pawn", v: "#3aa9a0" });
  tom.send({ t: "look", c: "ghost", v: "#f4ead4" });
  await mabel.wait((m) => m.room?.members.filter((x) => x?.character === "ghost").length === 2, 8000, 0);
  await sleep(600);
  const kinds = await screen.evaluate(() => [...window.__room3d.pieces.values()].map((p) => `${p.member.name} ${p.kind.id} ${p.member.colour}`).sort());
  check(kinds.length === 4 && kinds.filter((k) => k.includes("ghost")).length === 2, "the room draws each character in its colour: " + kinds.join(", "));

  // The room's wall (shared/rooms.js): where it hangs its boxes and its pools lie (the bar's are under its painted frames).
  const WALL = wallFor(roomId, N);
  /** A place in box i's light, `off` from its middle, kept inside a narrow pool. */
  const light = (i, off = 0) => Math.round(WALL.xs[i] + Math.sign(off) * Math.min(Math.abs(off), WALL.half - 10));
  /** A place in the dark past box i's light. */
  const dark = (i) => Math.round(WALL.xs[i] + WALL.half + 30);
  const key = async (k, ms) => {
    await phone.keyboard.down(k);
    await sleep(ms);
    await phone.keyboard.up(k);
  };
  async function walkTo(x) {
    for (let i = 0; i < 14; i++) {
      await sleep(160);
      const gap = x - (mabel.seen.findLast((m) => m.t === "m" && m.s === 0)?.x ?? mabel.room.members[0].x);
      if (Math.abs(gap) < 14) return;
      await key(gap > 0 ? "ArrowRight" : "ArrowLeft", Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
    }
  }
  // Cork & Bell is the one game open on the production wall: three stand in its light and Tom holds out in the dark by Flood's poster.
  const [CORK, FLOOD] = [boxes.indexOf("Cork & Bell"), boxes.indexOf("Flood")];
  mabel.goto(light(CORK, -60));
  fitch.goto(light(CORK, 62));
  tom.goto(dark(N - 1) + 50);
  await walkTo(light(CORK, 4));
  await sleep(2500);
  const lit = await screen.evaluate(() => window.__room3d.boxes.map((b) => +b.level.toFixed(2)));
  check(lit[CORK] > 1.3 && lit.every((l, i) => i === CORK || l === 0), "the vote's light is on where the pieces stand, and only the open game's: " + lit.join(", "));
  const waiting = (await screen.locator(".status-sub").textContent()).replace(/\s+/g, " ").trim();
  check(/Waiting for\s*Tom/.test(waiting), 'a vote in progress: "' + waiting + '"');
  if (roomId === "bar" && lookName === "real") {
    // The bar's posters hang in its painted frames, not where the 3D look hangs them: a tap on one must open that game's card.
    const off = await screen.evaluate(() => {
      const v = window.__room3d;
      const box = v.el.getBoundingClientRect();
      const spots = [...document.querySelectorAll(".spot-poster")].map((e) => e.getBoundingClientRect());
      return v.boxes.map((b, i) => {
        const p = new v.camera.position.constructor(b.at.x, b.at.y, b.at.z).project(v.camera);
        const [x, y] = [box.left + ((p.x + 1) / 2) * box.width, box.top + ((1 - p.y) / 2) * box.height];
        const r = spots[i];
        return r ? Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y) : 999;
      });
    });
    check(off.length === 5 && Math.max(...off) < 12, `each poster's touch spot is over its painted frame (worst ${Math.max(...off).toFixed(1)} px off its poster's middle)`);
    // The bar hangs its boxes in its painting's frames, and the room counts the vote there: each pool is under its poster.
    const under = await screen.evaluate(() => {
      const v = window.__room3d;
      const V = v.camera.position.constructor;
      return v.boxes.map((b) => {
        const poster = new V(b.at.x, b.at.y, b.at.z).project(v.camera).x;
        const pool = new V(b.pool.x, 0, b.pool.y).project(v.camera).x;
        return Math.abs(poster - pool) * v.el.clientWidth * 0.5;
      });
    });
    check(Math.max(...under) < 6, `each pool of light is under its painted poster (worst ${Math.max(...under).toFixed(1)} px apart across)`);
  }

  // The same moments at each phone size, and the big screen.
  const SIZES = [
    { name: "844x390", w: 844, h: 390 },
    { name: "667x375", w: 667, h: 375 },
    { name: "640x360", w: 640, h: 360 },
    { name: "390x844", w: 390, h: 844 },
  ];
  await shot(screen, "02-screen-1280x720-vote");
  for (const s of SIZES) {
    await phone.setViewportSize({ width: s.w, height: s.h });
    await sleep(1500);
    await shot(phone, `03-phone-${s.name}-vote-closer`);
    if (s.name === "844x390") {
      await phone.click(".zoom-btn");
      await sleep(1500);
      await shot(phone, `04-phone-${s.name}-vote-whole-room`);
      await phone.click(".zoom-btn");
      await sleep(900);
    }
  }
  await phone.setViewportSize({ width: 844, height: 390 });
  await sleep(1200);
  // (On a very busy machine a socket can fall silent long enough to be let go, and then the three left in the light start Cork & Bell.)
  check((await screen.evaluate(() => window.__room3d.room.phase)) === "lobby", "the room is still voting after the stills at every size (no game started under them)");

  // An emote: Mabel claps slowly, and Tom (in the dark) throws a tomato.
  mabel.send({ t: "e", e: "slowclap" });
  tom.send({ t: "e", e: "tomato" });
  await sleep(600);
  await shot(screen, "05-screen-1280x720-emote");
  await shot(phone, "05-phone-844x390-emote");
  await sleep(1800);

  if (roomId === "ship") {
    // A bump by the chart table sets it off.
    tom.goto(1745);
    fitch.goto(1650);
    await sleep(1200);
    fitch.send({ t: "m", x: fitch.x, d: 1, r: fitch.rev });
    fitch.send({ t: "m", x: fitch.x, d: 0, r: fitch.rev });
    fitch.send({ t: "b" });
    await sleep(450);
    await shot(screen, "06-screen-1280x720-chart-knocked");
    fitch.goto(light(CORK, 50));
    tom.goto(dark(FLOOD) + 60);
    await sleep(1500);
  } else if (lookName === "real") {
    // The bar's lightning, held at its brightest: one soft cold glow over the street and by the windows.
    await Promise.all([phone, screen].map((p) => p.evaluate(() => window.__room3d.holdFlash(0.42))));
    await sleep(700);
    await shot(screen, "06-screen-1280x720-lightning");
    await Promise.all([phone, screen].map((p) => p.evaluate(() => window.__room3d.holdFlash(null))));
    // Nothing shakes: the phone's own piece bumps, and the picture does not jolt.
    await key("b", 60);
    const jolts = [];
    for (let i = 0; i < 6; i++) {
      jolts.push(await phone.evaluate(() => window.__room3d.jolt(performance.now())));
      await sleep(30);
    }
    check(jolts.every((j) => j.x === 0 && j.y === 0), "a bump does not shake the bar's picture: " + JSON.stringify(jolts[0]));
    await sleep(1200);
    // The eye moves with the view, and the pieces keep their places: on the phone, closer, at two places in the room,
    // every piece is drawn where the room's numbers put it on the screen, and the wall has moved against them.
    const placed = () =>
      phone.evaluate(() => {
        const v = window.__room3d;
        const s = v.el.clientWidth / v.view.width;
        const off = [...v.pieces.values()].map((p) => {
          const at = p.body.group.position.clone().project(v.camera);
          return Math.abs(((at.x + 1) / 2) * v.el.clientWidth - (p.rx - v.view.x) * s);
        });
        const poster = v.boxes[2].art ? v.stuff.children.find((g) => g.isGroup && g.children[0]?.material === v.boxes[2].art) : null;
        const wall = poster ? poster.position.clone().project(v.camera) : null;
        return { eye: v.camera.position.x, worst: Math.max(...off), wallX: wall ? ((wall.x + 1) / 2) * v.el.clientWidth + v.view.x * s : null };
      });
    // (The phone is in its "Closer" view here, which follows its piece.)
    await walkTo(300);
    await sleep(1800);
    const left = await placed();
    await walkTo(1650);
    await sleep(1800);
    const right = await placed();
    check(left.eye < -0.2 && right.eye > 0.2, `the eye moves with the view: ${left.eye.toFixed(2)} m at the left, ${right.eye.toFixed(2)} m at the right`);
    check(left.worst < 2 && right.worst < 2, `every piece is where the room's numbers put it on the screen (worst ${Math.max(left.worst, right.worst).toFixed(2)} px off)`);
    check(left.wallX !== null && Math.abs(right.wallX - left.wallX) > 4, `and the wall moves against them: a poster slides ${Math.abs(right.wallX - left.wallX).toFixed(1)} px between the two places`);
    await walkTo(light(CORK, 4));
    await sleep(1200);
  }

  // The Tonight board, opened from the wall on the phone.
  // (A tap on the board on a phone lands on the room's touch layer, which opens the same board.)
  await phone.evaluate(() => document.querySelector(".l3-board").click());
  await sleep(900);
  await shot(phone, "07-phone-844x390-tonight-open");
  await phone.keyboard.press("Escape");
  await phone.evaluate(() => history.state?.board && history.back());
  await sleep(900);

  // Each thing that passes the window, held at its entry, middle and exit (the rendered look only).
  if (lookName === "real") {
    await phone.click(".zoom-btn");
    await sleep(1500);
    for (const { name, at, opts, tag } of OWN.passing) {
      const label = tag ? `${name}-${tag}` : name;
      if (!want(`08-${label}`)) continue;
      for (const [k, u] of at.entries()) {
        await Promise.all([phone, screen].map((p) => p.evaluate(([n, v, o]) => window.__room3d.hold(n, v, o), [name, u, opts])));
        await sleep(700);
        await shot(phone, `08-${label}-${["entry", "middle", "exit"][k]}-phone-844x390-whole-room`);
        if (k === 1) await shot(screen, `08-${label}-middle-screen-1280x720`);
      }
    }
    // Pixel by pixel: nothing outside may change a pixel that is not glass, anywhere along its way, on the phone (whole room) or the big screen.
    for (const { name, opts, tag } of OWN.passing) {
      const label = tag ? `${name}-${tag}` : name;
      if (!want(`08-${label}`)) continue;
      for (const [where, page] of [["phone 844x390 whole room", phone], ["screen 1280x720", screen]]) {
        const r = await page.evaluate(([n, o]) => window.__room3d.leaks(n, 16, o), [name, opts]);
        const leaked = r.leaked.reduce((a, b) => a + b, 0);
        check(leaked === 0 && Math.max(...r.changed) > 0, `${label} on the ${where}: changed up to ${Math.max(...r.changed)} pixels along its way, ${leaked} of them not glass (glass is ${r.glass} of ${r.pixels})`);
      }
    }
    await Promise.all([phone, screen].map((p) => p.evaluate(() => window.__room3d.hold(null))));
    await phone.click(".zoom-btn");
    await sleep(900);
  }

  if (lookName === "real" && want("09")) {
    // The bottom of the ladder, forced: the phone draws today's 3D look of the room in place, with a note, and says so.
    await phone.evaluate(() => window.__room3d.fallBack());
    // (The note goes by itself after twelve seconds, which a busy machine's screenshot can take: it is counted first.)
    const noted = await phone.locator(".rendered-note").count();
    const fits = await phone.evaluate(() => {
      const r = document.querySelector(".rendered-note")?.getBoundingClientRect();
      return !!r && r.left >= 0 && r.right <= innerWidth && r.top >= 0;
    });
    check(fits, "the note fits on the phone's screen, wrapped");
    await sleep(2500);
    await shot(phone, "09-phone-844x390-fell-back");
    const fell = await drawn(phone);
    check(fell.stats.rung === `3d ${DEF.name}` && noted === 1, `fallen back in place: ${fell.stats.rung}, with its note`);
    check((await phone.evaluate(() => localStorage.getItem("party-room:real-rung"))) === null, "a forced rung (?rung=) is never remembered");

    // The ladder itself, on real (slow, software) frames: a posed room with the ladder on comes down it by itself.
    // (Small, so that a software frame stays under the quarter second the ladder takes for a page that was hidden.)
    const slow = await open("ladder", { width: 640, height: 360 }, { deviceScaleFactor: 1 });
    await slow.goto(`${base}/lobby/look3d/still.html?look=real&room=${roomId}&ladder=on&gl=any&shot=live&as=player&zoom=room`);
    await slow.waitForSelector("html[data-ready]", { timeout: 90000, state: "attached" });
    const seen = [];
    let done = "";
    for (let i = 0; i < 160 && !done; i++) {
      const now = await slow.evaluate(() => `${window.__room3d.lookName} ${window.__room3d.drawing.skin} @${window.__room3d.ratio.toFixed(2)}x`);
      if (seen.at(-1) !== now) seen.push(now);
      done = await slow.evaluate(() => window.__room3d.ladder?.done ?? "");
      await sleep(500);
    }
    const end = await slow.evaluate(() => ({ look: window.__room3d.lookName, taken: window.__room3d.taken, remembered: localStorage.getItem("party-room:real-rung") }));
    await shot(slow, "10-ladder-640x360-end");
    // Two right ends: every step helped but not enough (fall back to the 3D look, remembered), or the steps changed
    // nothing, so something else holds the device back (all undone, the rendered look kept). Which one a software
    // renderer on a busy machine gets depends on what is slowing it; either way it went through every rung.
    const gaveUp = done === "fell back" && end.look === "3d" && end.remembered === "3d";
    const capped = done === "capped" && end.look === "real" && end.taken.length === 0 && end.remembered === null;
    check(seen.some((s) => s.includes("lite 3")) && (gaveUp || capped), `on slow frames the ladder came down every rung and stopped (${done || "not yet"}): ${seen.join(" > ")}`);
  }

  if (roomId === "bar" && lookName === "real" && want("12")) {
    // A device that asked for less motion: the street's things do not pass, no lightning, the rain slower and thinner.
    const calm = await open("calm", { width: 844, height: 390 }, { deviceScaleFactor: 1, reducedMotion: "reduce" });
    await calm.goto(`${base}/lobby/look3d/still.html?look=real&room=bar&rung=0&ladder=off&gl=any&shot=vote&as=player&zoom=room`);
    await calm.waitForSelector("html[data-ready]", { timeout: 90000, state: "attached" });
    const seen = [];
    for (let i = 0; i < 8; i++) {
      seen.push(await calm.evaluate(() => ({ calm: window.__room3d.scenery?.calm, passing: window.__room3d.streetEv?.thing?.name ?? null, timed: window.__room3d.street?.now?.thing?.name ?? null, flash: window.__room3d.flash })));
      await sleep(2500);
    }
    await shot(calm, "12-calm-phone-844x390");
    check(seen.every((s) => s.calm && s.passing === null && s.flash === 0), `with less motion asked for nothing passes and no lightning comes (the street's own timetable had ${seen.filter((s) => s.timed).length} of ${seen.length} moments with something due)`);
    await calm.close();
  }

  if (lookName === "real" && want("11")) {
    // A layer that is very slow to come (the Star Lounge's planet, the bar's street, held back for 90 seconds) does not
    // hold the room: after a few seconds the room is drawn the 3D look's way, long before the layer is let through,
    // and it is never used. (A big screen's size: on a phone's, the way in says "Use this phone as the room's screen".)
    const late = await open("late", { width: 1280, height: 720 }, { deviceScaleFactor: 1 });
    let held = 0;
    let released = false;
    await late.route(`**/look3d/rendered/${DEF.name}/layers/${OWN.late}`, async (route) => {
      held++;
      await sleep(90000);
      released = true;
      await route.continue().catch(() => {});
    });
    // (A party of its own, as its big screen: this party already has its four players.)
    await late.goto(`${base}/lobby/?start&${query}`);
    await late.click("text=Use this as the room's screen");
    const t0 = Date.now();
    await late.click("text=Show the room here");
    await late.waitForSelector(".look3d canvas", { timeout: 80000 });
    await late.waitForSelector(".l3-sign", { timeout: 80000 });
    const took = (Date.now() - t0) / 1000;
    const what = await drawn(late);
    await shot(late, "11-late-layer-screen-1280x720");
    // (Today's 3D look has no rung in its stats: only a rendered room names one.)
    check(held === 1 && !released && what.stats.skin === roomId && !what.stats.rung, `with ${OWN.late} held back the room still came up, the 3D look's way, ${took.toFixed(1)} s after "Show the room here" (software renderer, busy machine), while it was still held`);
    await late.close();
  }

  const s1 = await drawn(phone);
  console.log(`     the phone draws: ${s1.stats?.rung ?? s1.stats?.skin}; meter "${s1.meter}"; ${s1.stats?.calls} draw calls, ${s1.stats?.triangles} triangles; fetched ${s1.fetched} rendered files, ${s1.bytes} bytes: ${s1.files.join(" ")}`);
  if (lookName === "real") {
    const layers = s1.files.filter((f) => /\.(webp|json)$/.test(f)).sort();
    check(JSON.stringify(layers) === JSON.stringify([...DEF.files].sort()), `the phone fetched the ${DEF.name}'s layers, each once: ${layers.length} files`);
  } else check(s1.files.join() === "switch.js", "today's 3D look on the phone fetched none of the rendered layers or drawing, only the switch");
  check(errors.length === 0, "no page logged an error" + (errors.length ? ":\n     " + [...new Set(errors)].join("\n     ") : ""));
} finally {
  for (const c of sockets) c.ws.close();
  await browser.close();
}
console.log(problems.length ? `${problems.length} problem(s)` : "all checks passed");
process.exit(problems.length ? 1 : 0);
