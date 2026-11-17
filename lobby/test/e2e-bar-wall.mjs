// The bar on the production wall, in real pages: five boxes, hung under the painting's gold frames
// in the bar and evenly in every other room (lobby/shared/rooms.js). The other browser suites run
// on the test wall (six boxes, evenly everywhere), so none of this is seen there. Against a
// running local server WITHOUT the test game; the browser is headless and muted, and is closed
// at the end whatever happens.
//
//   npx wrangler dev --local --env local --port 8857 --var PARTY_TEST_GAMES:off
//   node lobby/test/e2e-bar-wall.mjs [--base=http://localhost:8857] [--shots=<folder>]
//
// What it goes through:
//   a change of room   in the flat look, with a player who walked since the last whole room
//                      message: after the change every piece is drawn in the same light or the
//                      same dark it stood in, at its carried place, even before the room's own
//                      message with the new places arrives (it is held back once, to see); the
//                      room keeps every vote and starts no count on the change
//   light = counted    in the flat, 3D and real looks of the bar: each look's drawn pool, cone or
//                      beam and the warmth on a piece end where the room counts, with stills of
//                      a piece just inside and one just outside an edge
//   signs              the flat and 3D signs under the bar's narrow boxes: no line of words is
//                      cut short, and no part of a sign runs into another or off it, on the big
//                      screen and a phone
//   the QR             on the real bar's sign at 1280 x 720: at least nine tenths of the flat
//                      look's size on the same screen
import { mkdirSync } from "node:fs";
import { wallFor } from "../shared/rooms.js";
import { acrossWalls, drawnLight, evenWall, lightAt } from "../shared/world.js";
import { launchBrowser } from "./browser.mjs";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8857");
const shots = opt("shots", "");
if (shots) mkdirSync(shots, { recursive: true });
const { call, connect } = partyApi(base);
const BAR = wallFor("bar", 5);
const EVEN = evenWall(5);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log("\n     -- " + name);

/**
 * In each page: the socket's incoming messages can be held back. With window.__holdRoomAfterPick
 * set, the first whole room message after a change of room is dropped, so the page has only the
 * change itself to go on (window.__held counts what was dropped).
 */
function pageHelpers() {
  const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");
  Object.defineProperty(WebSocket.prototype, "onmessage", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(fn) {
      desc.set.call(
        this,
        fn &&
          function (event) {
            try {
              const m = JSON.parse(event.data);
              if (m.t === "pick") window.__afterPick = true;
              else if (m.t === "room" && window.__afterPick && window.__holdRoomAfterPick) {
                window.__afterPick = false;
                window.__held = (window.__held ?? 0) + 1;
                return;
              }
            } catch {
              // A keep-alive: not JSON.
            }
            return fn.call(this, event);
          },
      );
    },
  });
  /** Where the flat look draws a seat's piece, in world units: its x. */
  window.drawnX = (seat) => {
    const g = document.querySelector(`svg.scene g[data-seat="${seat}"]`);
    const m = /translate\(([-\d.]+)/.exec(g?.getAttribute("transform") ?? "");
    return m ? Number(m[1]) : null;
  };
}

const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sockets = [];
const errors = [];
try {
  async function page(name, viewport, extra = {}) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra });
    await context.addInitScript(pageHelpers);
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return p;
  }
  const shot = async (p, name) => {
    if (!shots) return;
    await p.screenshot({ path: `${shots}/${name}.png`, timeout: 120000 });
    console.log(`     still: ${shots}/${name}.png`);
  };
  /** A screen showing the bar in a look; returns the page and the party's code. */
  async function screenIn(look, viewport = { width: 1280, height: 720 }) {
    const p = await page(`${look} screen`, viewport);
    await p.goto(`${base}/lobby/?start&look=${look}&room=bar&gl=any${look === "real" ? "&rung=0&ladder=off" : ""}`);
    await p.click("text=Use this as the room's screen");
    await p.click("text=Show the room here");
    await p.waitForSelector(look === "flat" ? "svg.scene" : ".look3d canvas", { timeout: 90000, state: "attached" });
    await p.waitForSelector(".code-digits");
    const pin = (await p.locator(".code-digits").first().textContent()).trim();
    return { p, pin };
  }

  // ---------------------------------------------------------------- a change of room, flat
  section("a change of room: every piece drawn in the light or dark it stood in, and every vote kept");
  const host = await page("host", { width: 1280, height: 720 });
  await host.goto(`${base}/lobby/?start&look=flat`);
  await host.fill("input[name=nickname]", "Nat");
  await host.click("button[type=submit]");
  await host.waitForSelector("svg.scene", { timeout: 60000, state: "attached" });
  await sleep(1500);
  const pin = await host.evaluate(() => JSON.parse(sessionStorage.getItem("party-kit:session:/api/lobby"))?.pin ?? null);
  const bo = connect(await call("POST", "/join/" + pin, { nickname: "Bo" }));
  sockets.push(bo);
  await bo.opened;
  await bo.wait((m) => m.t === "room" && m.room?.members?.[bo.seat]);
  await sleep(800);
  check(JSON.stringify(bo.room.boxes.map((b) => b.id)).length > 0 && bo.room.boxes.length === 5, `the server has the production wall: ${bo.room.boxes.length} boxes`);
  // Bo walks into Who Am I?'s light, near its right edge, after the last whole room message.
  const at = Math.round(BAR.xs[1] + BAR.half - 6);
  bo.goto(at);
  await sleep(1500);
  const voteBefore = bo.room.vote.standing[bo.seat] ?? null;
  const drawnBefore = await host.evaluate((s) => window.drawnX(s), bo.seat);
  check(Math.abs(drawnBefore - at) < 2, `the host's page draws Bo where he walked (${drawnBefore?.toFixed(1)}, at ${at})`);
  check(voteBefore === bo.room.boxes[1].id, `Bo stands in Who Am I?'s light (${voteBefore})`);

  for (const [to, from, wallTo, hold] of [
    ["ship", BAR, EVEN, true],
    ["bar", EVEN, BAR, false],
  ]) {
    await host.evaluate((h) => (window.__holdRoomAfterPick = h), hold);
    const mark = bo.seen.length;
    const shownAt = await host.evaluate((s) => window.drawnX(s), bo.seat);
    // The picker stays open after a pick (it says what was picked): opened only when it is not.
    if (!(await host.locator(".picker").isVisible().catch(() => false))) await host.click(".rooms-btn");
    await host.waitForSelector(".picker");
    await host.click(`.room-card[data-room=${to}]`, { force: true });
    const picked = await bo.wait((m) => m.t === "pick" || m.t === "pick-no", 6000, mark).catch(() => null);
    check(picked?.t === "pick" && picked.v === to, `the host moves the party to ${to} (${JSON.stringify(picked && { t: picked.t, v: picked.v, why: picked.why })})`);
    const room = await bo.wait((m) => m.t === "room" && m.room.room === to, 4000, mark).catch(() => null);
    await sleep(1200);
    const want = acrossWalls(shownAt, from, wallTo);
    const drawn = await host.evaluate((s) => window.drawnX(s), bo.seat);
    const held = await host.evaluate(() => window.__held ?? 0);
    check(Math.abs(drawn - want) < 2 && lightAt(drawn, wallTo) === 1, `${hold ? "with the room's message held back, " : ""}the host's page draws Bo in Who Am I?'s light in ${to}: ${drawn?.toFixed(1)} (carried to ${want.toFixed(1)})${hold ? `; held ${held}` : ""}`);
    check(!!room && Math.abs(room.room.members[bo.seat].x - want) < 1, `the room carried Bo there too and said so (${room?.room.members[bo.seat].x?.toFixed?.(1)})`);
    check(room?.room.vote.standing[bo.seat] === voteBefore, `Bo's vote is the same in ${to} (${room?.room.vote.standing[bo.seat]})`);
    check(!room?.room.vote.count, "and no count starts on the change");
    await host.evaluate(() => (window.__holdRoomAfterPick = false));
    // The room may be changed again a few seconds later (ROOM_COOLDOWN_MS).
    await sleep(4500);
  }

  // ---------------------------------------------------------------- light = counted, each look
  const flatQr = { w: 0 };
  for (const look of ["flat", "3d", "real"]) {
    section(`${look}: the light each look draws ends where the room counts`);
    const { p, pin: code } = await screenIn(look);
    const ann = connect(await call("POST", "/join/" + code, { nickname: "Ann" }));
    const cy = connect(await call("POST", "/join/" + code, { nickname: "Cy" }));
    sockets.push(ann, cy);
    await Promise.all([ann.opened, cy.opened]);
    await sleep(800);
    // Two players: Cork & Bell and Who Am I? are both lit. Ann just inside Cork & Bell's right edge, Cy just outside Who Am I?'s left edge, in the gap.
    const inside = Math.round(BAR.xs[0] + BAR.half - 3);
    const outside = Math.round(BAR.xs[1] - BAR.half - 4);
    ann.goto(inside);
    cy.goto(outside);
    await sleep(2500);
    const standing = ann.room.vote.standing;
    check(standing[ann.seat] === ann.room.boxes[0].id && !standing[cy.seat], `the room counts Ann (${inside}) in Cork & Bell's light and Cy (${outside}) in the dark`);
    const want = drawnLight(BAR);
    if (look === "flat") {
      const rx = await p.evaluate((y) => [...document.querySelectorAll("svg.scene ellipse")].filter((e) => Number(e.getAttribute("cy")) === y).map((e) => Number(e.getAttribute("rx"))), 896);
      check(rx.length >= 5 && rx.every((r) => Math.abs(r - BAR.half) < 0.01), `every pool and ring is drawn to the counted edge: rx ${[...new Set(rx.map((r) => r.toFixed(1)))].join(", ")} (half ${BAR.half.toFixed(1)})`);
      const cones = await p.evaluate(() => [...document.querySelectorAll("svg.scene polygon")].map((c) => c.getAttribute("points")).filter((pts) => pts.endsWith("898")));
      const feet = cones.map((pts) => {
        const xs = pts.split(" ").slice(2).map((pt) => Number(pt.split(",")[0]));
        return (xs[0] - xs[1]) / 2;
      });
      check(feet.length >= 5 && feet.every((f) => Math.abs(f - BAR.half) < 0.01), `every cone's foot is the counted width: ${[...new Set(feet.map((f) => f.toFixed(1)))].join(", ")}`);
      const qr = await p.evaluate(() => document.querySelector("svg.scene image")?.getBoundingClientRect().width ?? 0);
      flatQr.w = qr;
    } else {
      const got = await p.evaluate(() => ({ light: window.__room3d.drawn, half: window.__room3d.half, rung: window.__room3d.stats?.().rung ?? "" }));
      const same = got.half === BAR.half && ["pool", "cone", "lit", "fade"].every((k) => got.light?.[k] === want[k]);
      check(same, `the ${got.rung || look} look draws its pools, rings, cones and beams to ${got.light?.pool?.toFixed(1)} and warms pieces to ${got.light?.lit?.toFixed(1)} (counted half ${BAR.half.toFixed(1)})${same ? "" : `: ${JSON.stringify(got)} against ${JSON.stringify(want)}`}`);
      const warm = await p.evaluate(([a, b]) => [window.__room3d.lightAt(a), window.__room3d.lightAt(b)], [inside, outside]);
      const ambient = await p.evaluate((x) => window.__room3d.life.warmth(x), outside);
      check(warm[0] > ambient + 0.2 && Math.abs(warm[1] - ambient) < 1e-6, `Ann is warmed by her lamp (${warm[0].toFixed(2)}), Cy in the gap only by the room (${warm[1].toFixed(2)})`);
    }
    if (look === "real") {
      const qr = await p.evaluate(() => document.querySelector(".l3-qr")?.getBoundingClientRect().width ?? 0);
      check(qr >= flatQr.w * 0.9, `the real bar's QR is ${qr.toFixed(0)} px wide at 1280 x 720, beside the flat look's ${flatQr.w.toFixed(0)} px`);
    }
    await shot(p, `${look}-edges-1280x720`);
    {
      section(`${look}: the bar's signs`);
      const phone = await page(`${look} phone`, { width: 844, height: 390 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      await phone.goto(`${base}/lobby/?join=${code}&look=${look}&gl=any${look === "real" ? "&rung=0&ladder=off" : ""}`);
      await phone.fill("input[name=nickname]", "Di");
      await phone.click("text=Join the party");
      await phone.waitForSelector(look === "flat" ? "svg.scene" : ".look3d canvas", { timeout: 90000, state: "attached" });
      await sleep(2500);
      for (const [where, pg] of [
        ["1280x720 screen", p],
        ["844x390 phone", phone],
      ]) {
        const faults = await pg.evaluate((flat) => {
          const out = [];
          const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
          if (flat) {
            for (const g of document.querySelectorAll("svg.scene g[data-box]")) {
              const sign = g.querySelector("[data-sign]").getBoundingClientRect();
              const parts = [...g.querySelectorAll("[data-sign-part]")].filter((e) => e.getAttribute("display") !== "none" && e.getBoundingClientRect().width > 0);
              const boxes = parts.map((e) => e.getBoundingClientRect());
              boxes.forEach((r, i) => {
                if (!inside(r, sign)) out.push(`box ${g.dataset.box}: "${parts[i].textContent.trim()}" runs off its sign`);
                for (let j = i + 1; j < boxes.length; j++) if (overlap(r, boxes[j])) out.push(`box ${g.dataset.box}: "${parts[i].textContent.trim()}" runs into "${parts[j].textContent.trim()}"`);
              });
            }
          } else {
            for (const sign of document.querySelectorAll(".l3-sign")) {
              const about = sign.querySelector(".l3-about");
              if (about && getComputedStyle(about).display !== "none" && about.scrollHeight > about.clientHeight + 1) out.push(`"${about.textContent}" is cut short`);
              const s = sign.getBoundingClientRect();
              const parts = [about, sign.querySelector(".l3-seats"), sign.querySelector(".l3-need")].filter((e) => e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0);
              const boxes = parts.map((e) => e.getBoundingClientRect());
              boxes.forEach((r, i) => {
                if (!inside(r, s)) out.push(`"${parts[i].textContent.trim()}" runs off its sign`);
                for (let j = i + 1; j < boxes.length; j++) if (overlap(r, boxes[j])) out.push(`"${parts[i].textContent.trim()}" runs into "${parts[j].textContent.trim()}"`);
              });
              const row = sign.querySelector(".l3-row");
              if (row && row.scrollWidth > row.clientWidth + 1) out.push(`the row "${row.textContent}" is cut short`);
            }
          }
          return out;
        }, look === "flat");
        check(faults.length === 0, `on the ${where}, every sign's words fit it${faults.length ? ": " + faults.join("; ") : ""}`);
      }
      await shot(phone, `${look}-signs-844x390`);
      await phone.context().close();
    }
    for (const c of [ann, cy]) c.ws.close();
    await p.context().close();
  }
  check(errors.length === 0, `no page logged an error${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  for (const c of sockets) c.ws.close();
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join("\n- ")}` : "\nAll good.");
process.exit(problems.length ? 1 : 0);
