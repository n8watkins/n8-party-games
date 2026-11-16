// Choosing a character and a colour, and the ghost, end to end: real pages and real sockets in
// one room, against a running local server, once in each of the three looks. The browser is
// headless and MUTED, and is closed at the end whatever happens.
//
//   node lobby/test/e2e-characters.mjs [--base=http://localhost:8791] [--looks=flat,3d,baked] [--shots=DIR] [--measure]
//
// What it goes through, in each look:
//   the picker        a phone opens "Your piece", picks the ghost and a colour; the room carries it
//   a second page     another phone sees that piece as a ghost in that colour, and the others as pawns
//   the 14 emotes     a ghost does each one where the second page can see it: its word over its
//                     head, and its hands the way the owner chose (floating hands; wisps for GG,
//                     Lighter up and Huh?; a cuff on the pointing hand; none for Fuming)
//   a knock           a ghost that is bumped squeezes its eyes shut (it never gets crosses)
//   a reconnect       the phone reloads and is still its ghost; the choice is back on a new party
//   the same choice   a second player picks the same character and colour, and the room lets them
//   a bad choice      an unknown character and a bad colour are refused, to the sender only
//
// --shots=DIR also saves pictures of the second page (for a person to look at; nothing is compared).
// --measure adds what four ghosts cost against four pawns in the 3D look on this machine: the
// frame meter's own numbers, and the time one piece's pose takes.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { EMOTES, EMOTE_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
import { ghostRigById } from "../public/characters/ghost-rig.js";
import { CHARACTERS, LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8791");
const looks = opt("looks", "flat,3d,baked").split(",").filter(Boolean);
const shots = opt("shots", "");
const measure = args.includes("--measure");
const { api, call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const section = (name) => console.log("\n     -- " + name);
if (shots) mkdirSync(shots, { recursive: true });

const VIOLET = "#8a5bc4";
const CREAM = "#f4ead4";

const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--autoplay-policy=user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const errors = [];
  async function open(name, viewport = { width: 844, height: 390 }) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }
  const query = (look) => (look === "flat" ? "look=flat" : `look=${look}&gl=any`);
  const drawn = (page, look) => (look === "flat" ? page.waitForSelector("svg.scene g[data-seat]", { timeout: 20000 }) : page.waitForFunction(() => window.__room3d?.pieces?.size > 0, null, { timeout: 40000 }));
  async function join(page, pin, name, look) {
    await page.goto(`${base}/lobby/?join=${pin}&${query(look)}`);
    await page.waitForSelector(".door-title");
    await page.fill("input[name=nickname]", name);
    await page.click("text=Join the party");
    await drawn(page, look);
  }
  /** What a page draws for a seat's piece: its character, its emote's word, hands and wisps, and whether its eyes are squeezed shut. */
  const pieceOn = (page, seat) =>
    page.evaluate((seat) => {
      const shown = (el) => el.getAttribute("display") !== "none";
      const word = [...document.querySelectorAll(".emote-sticker")].filter(shown).map((g) => g.textContent);
      const room = window.__room3d;
      if (room) {
        const p = room.pieces.get(seat);
        if (!p) return null;
        const arms = p.emote?.arms;
        const limbs = arms ? (arms.arms ?? arms).limbs : [];
        const on = !!arms && arms.group.visible;
        return { look: "3d", character: p.kind.id, colour: p.member.colour, words: word, hands: on ? limbs.filter((l) => l.g.visible).length : 0, wisps: (arms?.wisps ?? []).filter((w) => w.visible).length, sticks: on ? limbs.filter((l) => l.g.visible && l.upper.visible).length : 0, shut: !!p.pawn.dizzy, outlined: (arms?.hulls ?? []).length > 0 };
      }
      const g = document.querySelector(`svg.scene g[data-seat="${seat}"]`);
      if (!g) return null;
      const limbs = [...g.querySelectorAll(".emote-limb")].filter(shown);
      const shut = g.querySelector(".ghost-shut");
      return { look: "flat", character: g.dataset.character, colour: null, words: word, hands: limbs.length, wisps: limbs.filter((l) => l.querySelector(".emote-wisp") && shown(l.querySelector(".emote-wisp"))).length, sticks: limbs.filter((l) => !l.querySelector(".emote-wisp")).length, shut: !!shut && shown(shut), outlined: limbs.some((l) => l.querySelector("rect")?.getAttribute("stroke") === "#1a1210") };
    }, seat);
  const shot = async (page, look, name) => shots && (await page.screenshot({ path: `${shots}/${look}-${name}.png` }));

  for (const look of looks) {
    // ================================================================ the picker
    section(`${look}: a phone picks the ghost and a colour, and the room carries it`);
    const host = await call("POST", "/rooms", { nickname: "Ada" });
    const ada = connect(host);
    await ada.opened;
    const bea = await open(`bea (${look})`);
    await join(bea, host.pin, "Bea", look);
    const cy = await open(`cy (${look})`);
    await join(cy, host.pin, "Cy", look);
    await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 10000, 0);
    const B = ada.room.members.find((m) => m?.name === "Bea").seat;
    const C = ada.room.members.find((m) => m?.name === "Cy").seat;
    check(ada.room.members.filter(Boolean).every((m) => m.character === "pawn"), "everyone starts as a pawn");
    check((await bea.locator(".look-btn").count()) === 1 && (await bea.locator(".look-btn svg").count()) === 1, "the phone has its own piece in the corner, as a button");

    await bea.locator(".look-btn").click();
    await bea.waitForSelector(".look-sheet");
    check((await bea.locator(".look-card").count()) === CHARACTERS.length, `the sheet offers the ${CHARACTERS.length} characters: ${(await bea.locator(".look-name").allTextContents()).join(", ")}`);
    check((await bea.locator('.look-card[aria-pressed="true"]').getAttribute("data-character")) === "pawn", "with the pawn marked as hers now");
    await shot(bea, look, "01-picker");
    let from = ada.seen.length;
    await bea.locator('.look-card[data-character="ghost"]').click();
    await ada.wait((m) => m.room?.members[B]?.character === "ghost", 5000, from);
    await bea.waitForSelector('.look-card[data-character="ghost"][aria-pressed="true"]', { timeout: 4000 });
    check(true, "a tap on the ghost: the room has her as a ghost, and the sheet marks it");
    from = ada.seen.length;
    await bea.locator(`.look-swatch[data-colour="${VIOLET}"]`).click();
    await ada.wait((m) => m.room?.members[B]?.colour === VIOLET, 5000, from);
    check(ada.room.members[B].character === "ghost", "a tap on violet straight after: the room has her colour, and she is still a ghost");
    await bea.waitForSelector(`.look-swatch[data-colour="${VIOLET}"][aria-pressed="true"]`, { timeout: 4000 });
    await shot(bea, look, "02-picker-ghost-violet");
    await bea.click(".look-sheet >> text=Done");
    check((await bea.locator(".look-sheet").count()) === 0, "Done closes the sheet");

    // ================================================================ a second page
    section(`${look}: the second phone sees her as a ghost`);
    await cy.waitForFunction((seat) => (window.__room3d ? window.__room3d.pieces.get(seat)?.kind.id : document.querySelector(`svg.scene g[data-seat="${seat}"]`)?.dataset.character) === "ghost", B, { timeout: 5000 }).catch(() => {});
    const seenB = await pieceOn(cy, B);
    check(seenB?.character === "ghost" && (seenB.colour === null || seenB.colour === VIOLET), `on Cy's phone Bea's piece is a ghost${seenB?.colour ? " in " + seenB.colour : ""}`);
    check((await pieceOn(cy, ada.seat))?.character === "pawn" && (await pieceOn(cy, C))?.character === "pawn", "and Ada's and his own are still pawns");
    check((await pieceOn(bea, B))?.character === "ghost", "on her own phone too");
    await sleep(400);
    await shot(cy, look, "03-a-ghost-among-pawns");

    // ================================================================ the 14 emotes
    section(`${look}: a ghost does each of the 14 emotes, with the hands the owner chose`);
    // Ada (a bare socket) becomes a ghost too, and stands beside Bea, so each emote has a piece to aim at.
    await sleep(LOOK_COOLDOWN_MS);
    from = ada.seen.length;
    ada.send({ t: "look", c: "ghost", v: "#3aa9a0" });
    await ada.wait((m) => m.room?.members[ada.seat]?.character === "ghost", 5000, from);
    ada.goto(ada.room.members[B].x - 200);
    await sleep(900);
    for (const e of EMOTES) {
      const rig = ghostRigById(e.id);
      await sleep(EMOTE_COOLDOWN_MS + 150);
      ada.send({ t: "e", e: e.id });
      const want = rig.take === "none" ? { hands: 0, wisps: 0 } : rig.take === "wisp" ? { hands: e.id === "scratch" ? 1 : 2, wisps: e.id === "scratch" ? 1 : 2 } : { hands: null, wisps: e.id === "pointlaugh" ? 1 : 0 };
      // Looked for until it is there: a loaded machine draws late, and the emote lasts seconds.
      const ok = await cy
        .waitForFunction(
          ({ seat, word, want }) => {
            const shown = (el) => el.getAttribute("display") !== "none";
            if (![...document.querySelectorAll(".emote-sticker")].some((g) => shown(g) && g.textContent === word)) return false;
            const room = window.__room3d;
            let hands, wisps, sticks;
            if (room) {
              const arms = room.pieces.get(seat)?.emote?.arms;
              if (!arms) return false;
              const limbs = (arms.arms ?? arms).limbs;
              hands = arms.group.visible ? limbs.filter((l) => l.g.visible).length : 0;
              wisps = (arms.wisps ?? []).filter((w) => w.visible).length;
              sticks = arms.group.visible ? limbs.filter((l) => l.g.visible && l.upper.visible).length : 0;
            } else {
              const limbs = [...document.querySelectorAll(`svg.scene g[data-seat="${seat}"] .emote-limb`)].filter(shown);
              hands = limbs.length;
              wisps = limbs.filter((l) => l.querySelector(".emote-wisp") && shown(l.querySelector(".emote-wisp"))).length;
              sticks = limbs.filter((l) => !l.querySelector(".emote-wisp")).length;
            }
            return sticks === 0 && wisps === want.wisps && (want.hands === null ? hands >= 1 : hands === want.hands);
          },
          { seat: ada.seat, word: rig.word, want },
          { timeout: rig.dur + 2500, polling: 50 },
        )
        .then(() => true, () => false);
      const got = await pieceOn(cy, ada.seat);
      check(ok, `${e.name}: "${rig.word}" over its head, ${rig.take === "none" ? "no hands" : rig.take === "wisp" ? "hands on wisps of the sheet" : e.id === "pointlaugh" ? "floating hands, the pointing one with a cuff" : "floating hands"}, never a pawn's stick arm${ok ? "" : ` (saw ${JSON.stringify(got)})`}`);
      if (["trophy", "pointlaugh", "boo", "steam", "lighter", "popcorn"].includes(e.id)) await shot(cy, look, `04-emote-${e.id}`);
    }

    // A very pale colour: the hands get an outline.
    section(`${look}: on a very pale colour the ghost's hands are outlined`);
    await sleep(Math.max(LOOK_COOLDOWN_MS, EMOTE_COOLDOWN_MS) + 200);
    from = ada.seen.length;
    ada.send({ t: "look", v: CREAM });
    await ada.wait((m) => m.room?.members[ada.seat]?.colour === CREAM, 5000, from);
    ada.send({ t: "e", e: "thumbsup" });
    const pale = await cy.waitForFunction(
      (seat) => {
        const room = window.__room3d;
        if (room) return (room.pieces.get(seat)?.emote?.arms?.hulls ?? []).length > 0;
        return [...document.querySelectorAll(`svg.scene g[data-seat="${seat}"] .emote-limb rect`)].some((r) => r.getAttribute("stroke") === "#1a1210");
      },
      ada.seat,
      { timeout: 4000, polling: 50 },
    ).then(() => true, () => false);
    check(pale, "cream hands on a white sheet have a dark outline");
    await sleep(500);
    await shot(cy, look, "05-pale-hands-outlined");

    // ================================================================ a knock
    section(`${look}: a ghost that is bumped squeezes its eyes shut`);
    await sleep(2600);
    await cy.evaluate((seat) => {
      window.__shut = false;
      let n = 0;
      const watch = () => {
        const room = window.__room3d;
        const shut = room ? !!room.pieces.get(seat)?.pawn.dizzy : document.querySelector(`svg.scene g[data-seat="${seat}"] .ghost-shut`)?.getAttribute("display") !== "none";
        if (shut) window.__shut = true;
        if (++n < 900) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, B);
    // Ada steps well away, so the only piece in reach is Bea's. Then Cy's own piece (a pawn: the
    // kick is its move) walks up to Bea's ghost and bumps it. Where everyone is, is the room's word.
    const where = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view.members;
    ada.goto(1500);
    await sleep(600);
    let blow = null;
    for (let tries = 0; tries < 3 && !(blow?.to === B); tries++) {
      for (let i = 0; i < 12; i++) {
        const at = await where();
        const gap = at[B].x - at[C].x;
        if (Math.abs(gap) < 100) break;
        const dir = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await cy.keyboard.down(dir);
        await sleep(Math.max(60, Math.min(900, ((Math.abs(gap) - 70) / 430) * 1000)));
        await cy.keyboard.up(dir);
        await sleep(350);
      }
      const mark = ada.seen.length;
      await cy.keyboard.press("KeyX");
      blow = await ada.wait((m) => m.t === "b" && m.s === C, 3000, mark).catch(() => null);
      if (blow?.to !== B) await sleep(2800);
    }
    check(blow?.to === B, `Cy's pawn bumps Bea's ghost (the room says it hit seat ${blow?.to ?? "nobody"})`);
    await sleep(650);
    await shot(cy, look, "06-ghost-knocked");
    await sleep(900);
    check(await cy.evaluate(() => window.__shut), "and the ghost's eyes are squeezed shut while it is thrown and lying");

    // ================================================================ a reconnect
    section(`${look}: the choice survives a reconnect, and comes back on a new party`);
    // Back to the room's own address, as a reload does (the look is asked for again: this browser draws 3D in software, which a page only accepts when told to).
    await bea.goto(`${base}/lobby/?${query(look)}`);
    await drawn(bea, look);
    await sleep(600);
    check(ada.room.members[B]?.character === "ghost" && ada.room.members[B]?.colour === VIOLET && (await pieceOn(bea, B))?.character === "ghost", "after a reload Bea is still her violet ghost, in the room and on her phone");

    // ================================================================ the same choice
    section(`${look}: two players may pick the same character and colour`);
    await cy.locator(".look-btn").click();
    await cy.waitForSelector(".look-sheet");
    from = ada.seen.length;
    await cy.locator('.look-card[data-character="ghost"]').click();
    await ada.wait((m) => m.room?.members[C]?.character === "ghost", 5000, from);
    from = ada.seen.length;
    await cy.locator(`.look-swatch[data-colour="${VIOLET}"]`).click();
    await ada.wait((m) => m.room?.members[C]?.colour === VIOLET, 5000, from);
    await cy.keyboard.press("Escape");
    const both = ada.room.members.filter((m) => m && m.character === "ghost" && m.colour === VIOLET).map((m) => m.name);
    check(both.join() === "Bea,Cy", `Bea and Cy are both violet ghosts (${both.join(", ")})`);
    await sleep(500);
    check((await pieceOn(bea, C))?.character === "ghost" && (await pieceOn(bea, B))?.character === "ghost", "and Bea's phone draws both");
    await shot(bea, look, "07-three-ghosts");

    // ================================================================ a bad choice
    section(`${look}: a bad choice is refused, to the sender only`);
    await sleep(LOOK_COOLDOWN_MS);
    from = ada.seen.length;
    ada.send({ t: "look", c: "slime" });
    const no = await ada.wait((m) => m.t === "look-no", 3000, from).catch(() => null);
    ada.send({ t: "look", v: "not-a-colour" });
    await sleep(500);
    check(!!no && no.c === "ghost" && ada.seen.slice(from).filter((m) => m.t === "look-no").length === 2, `an unknown character and a bad colour are both refused ("${no?.why}"), and she is told what she still is`);
    check(ada.room.members[ada.seat].character === "ghost" && ada.room.members[ada.seat].colour === CREAM, "and nothing changed");

    // A new party on the same phone: the piece chosen last comes back by itself.
    const next = await call("POST", "/rooms", { nickname: "Dot" });
    const dot = connect(next);
    await dot.opened;
    await bea.goto(`${base}/lobby/?join=${next.pin}&${query(look)}`);
    await bea.waitForSelector(".door-title");
    await bea.fill("input[name=nickname]", "Bea");
    await bea.click("text=Join the party");
    await drawn(bea, look);
    const back = await dot.wait((m) => m.room?.members.some((x) => x?.name === "Bea" && x.character === "ghost" && x.colour === VIOLET), 6000, 0).then(() => true, () => false);
    check(back, "in a new party on the same phone, Bea is her violet ghost again without choosing");

    for (const c of [ada, dot]) c.ws.close();
    for (const page of [bea, cy]) await page.context().close();
  }

  // ================================================================ what it costs
  if (measure) {
    section("3D look: four ghosts against four pawns, on this machine");
    const host = await call("POST", "/rooms", { nickname: "P1" });
    const others = [];
    for (const name of ["P2", "P3"]) others.push(await call("POST", "/join/" + host.pin, { nickname: name }));
    const four = [host, ...others].map(connect);
    await Promise.all(four.map((c) => c.opened));
    // The fourth is a phone, with the frame meter on.
    const screen = await open("phone (measure)", { width: 844, height: 390 });
    await screen.goto(`${base}/lobby/?join=${host.pin}&look=3d&gl=any&meter=1`);
    await screen.waitForSelector(".door-title");
    await screen.fill("input[name=nickname]", "P4");
    await screen.click("text=Join the party");
    await screen.waitForFunction(() => window.__room3d?.pieces?.size === 4, null, { timeout: 40000 });
    // Close together near the phone's own piece, so they are all in its picture.
    const mine = four[0].room?.members.find((m) => m?.name === "P4")?.x ?? 300;
    four.forEach((c, i) => c.goto(mine + 110 + i * 110));
    const read = async (label) => {
      await sleep(5000);
      const line = await screen.locator(".frame-meter").textContent();
      // One piece's pose, timed in the page itself: the part of a frame that is this lane's code.
      const pose = await screen.evaluate(() => {
        const room = window.__room3d;
        const p = [...room.pieces.values()][0];
        const saved = { rx: p.rx };
        const t0 = performance.now();
        const N = 3000;
        for (let i = 0; i < N; i++) p.kind.pose(p.pawn, p, t0 + i * 16.7, 1 / 60, { walking: false, lit: 0.5, calm: false });
        const ms = (performance.now() - t0) / N;
        // And walking, when everything about it moves every frame.
        const t1 = performance.now();
        for (let i = 0; i < N; i++) {
          p.rx = saved.rx + Math.sin(i / 40) * 120;
          p.kind.pose(p.pawn, p, t1 + i * 16.7, 1 / 60, { walking: true, lit: 0.5, calm: false });
        }
        const walking = (performance.now() - t1) / N;
        p.rx = saved.rx;
        return { ms, walking, calls: room.renderer.info.render.calls, triangles: room.renderer.info.render.triangles };
      });
      console.log(`     ${label}: ${line}`);
      console.log(`     ${label}: one piece's pose ${(pose.ms * 1000).toFixed(1)} microseconds standing, ${(pose.walking * 1000).toFixed(1)} walking; the last picture took ${pose.calls} draws, ${pose.triangles} triangles`);
      return { line, ...pose };
    };
    const pawns = await read("four pawns ");
    for (const c of four) c.send({ t: "look", c: "ghost" });
    await screen.locator(".look-btn").click();
    await screen.locator('.look-card[data-character="ghost"]').click();
    await screen.keyboard.press("Escape");
    await screen.waitForFunction(() => [...window.__room3d.pieces.values()].every((p) => p.kind.id === "ghost"), null, { timeout: 8000 });
    const ghosts = await read("four ghosts");
    const drawing = (r) => Number(/drawing ([\d.]+) ms/.exec(r.line ?? "")?.[1] ?? NaN);
    console.log(`     difference: drawing ${drawing(pawns)} ms -> ${drawing(ghosts)} ms a picture (software drawing in this browser, not a phone's); pose ${(pawns.ms * 1000).toFixed(1)} -> ${(ghosts.ms * 1000).toFixed(1)} microseconds a piece standing, ${(pawns.walking * 1000).toFixed(1)} -> ${(ghosts.walking * 1000).toFixed(1)} walking; draws ${pawns.calls} -> ${ghosts.calls}; triangles ${pawns.triangles} -> ${ghosts.triangles}`);
    check(Number.isFinite(ghosts.walking) && ghosts.walking < 1, `a ghost's pose takes under a millisecond here, even walking (${(ghosts.walking * 1000).toFixed(1)} microseconds)`);
    await shot(screen, "3d", "08-four-ghosts");
    for (const c of four) c.ws.close();
    await screen.context().close();
  }

  section("the pages");
  check(errors.length === 0, `no page reported an error${errors.length ? ":\n       " + [...new Set(errors)].slice(0, 8).join("\n       ") : ""}`);
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
