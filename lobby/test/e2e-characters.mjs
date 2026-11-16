// Choosing a character and a colour, and the ghost, the slime and the robot, end to end: real
// pages and real sockets in one room, against a running local server, once in each of the three
// looks. The browser is headless and MUTED, and is closed at the end whatever happens. With
// TEST_GPU=1 it draws on the graphics card (lobby/test/browser.mjs).
//
//   node lobby/test/e2e-characters.mjs [--base=http://localhost:8791] [--looks=flat,3d,baked] [--shots=DIR] [--measure]
//
// What it goes through, in each look:
//   the picker        a phone opens "Your piece", picks the ghost and a colour; the room carries it
//   a second page     another phone and the big screen see that piece as a ghost in that colour,
//                     and the others as pawns
//   slime and robot   the second phone picks the slime and a colour on its own sheet, then the
//                     robot and another; the first phone and the big screen see each, in its colour
//   the 14 emotes     a ghost does each one where the second page can see it: its word over its
//                     head, and its hands the way the owner chose (floating hands; wisps for GG,
//                     Lighter up and Huh?; a cuff on the pointing hand; none for Fuming); then a
//                     slime does each (hands on arms of its goo) and a robot (hands on jointed arms)
//   a knock           a ghost that is bumped squeezes its eyes shut (it never gets crosses); a
//                     knocked slime's eyes swirl or squeeze shut, a robot's are crosses
//   a reconnect       the phone reloads and is still its ghost; the choice is back on a new party
//   the same choice   a second player picks the same character and colour, and the room lets them
//   a bad choice      an unknown character and a bad colour are refused, to the sender only
//
// --shots=DIR also saves pictures of the second page (for a person to look at; nothing is compared).
// --measure adds what four of each character cost in the 3D look on this machine: the frame
// meter's own numbers, the draws and triangles of a picture, and the time one piece's pose takes.
import { mkdirSync } from "node:fs";
import { EMOTES, EMOTE_COOLDOWN_MS } from "../../party-kit/client/emotes.js";
import { ghostRigById } from "../public/characters/ghost-rig.js";
import { ROBOT_RIG } from "../public/characters/robot.js";
import { SLIME_RIG } from "../public/characters/slime.js";
import { CHARACTERS, LOOK_COOLDOWN_MS } from "../shared/characters.js";
import { boxCentre } from "../shared/world.js";
import { gpu, launchBrowser } from "./browser.mjs";
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
const TEAL = "#3aa9a0";
const MARMALADE = "#d9662b";
/** The two new characters' rigs, by id. */
const RIGS = { slime: SLIME_RIG, robot: ROBOT_RIG };

// On the graphics card with TEST_GPU=1 (browser.mjs drops the software flags then); in software otherwise.
const browser = await launchBrowser({ args: ["--autoplay-policy=user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

/**
 * Read in each page: how faded a seat's ghost is drawn (0 to 1), and watchFright(), which keeps,
 * for the next few seconds, how wide-eyed each piece went and how far it was moved, in
 * window.__fright[seat] = {scared, moved}.
 */
function pageHelpers() {
  const flatX = (g) => Number(/translate\(([-\d.]+)/.exec(g.getAttribute("transform") ?? "")?.[1] ?? NaN);
  window.fadedOn = (seat) => {
    const room = window.__room3d;
    if (room) return room.pieces.get(seat)?.faded ?? 0;
    return Number(document.querySelector(`svg.scene g[data-seat="${seat}"]`)?.getAttribute("data-faded") ?? 0);
  };
  window.watchFright = () => {
    window.__fright = {};
    const start = {};
    const until = performance.now() + 2600;
    const look = () => {
      const room = window.__room3d;
      const seats = room ? [...room.pieces.keys()] : [...document.querySelectorAll("svg.scene g[data-seat]")].map((g) => Number(g.dataset.seat));
      for (const seat of seats) {
        let scared, x;
        if (room) {
          const p = room.pieces.get(seat);
          scared = p.fright ? (p.body.scaredK ?? 0) : 0;
          x = p.rx;
        } else {
          const g = document.querySelector(`svg.scene g[data-seat="${seat}"]`);
          scared = Number(g.getAttribute("data-scared") ?? 0);
          x = flatX(g);
        }
        start[seat] ??= x;
        const was = window.__fright[seat] ?? { scared: 0, moved: 0 };
        window.__fright[seat] = { scared: Math.max(was.scared, scared), moved: Math.round(Math.max(was.moved, Math.abs(x - start[seat]))) };
      }
      if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  };
}

try {
  const errors = [];
  async function open(name, viewport = { width: 844, height: 390 }) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    await context.addInitScript(pageHelpers);
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
  /** What a page draws for a seat's piece: its character, its emote's word, hands, wisps (or goo) and rods, and whether its eyes show it was knocked. */
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
        return { look: "3d", character: p.kind.id, colour: p.member.colour, words: word, hands: on ? limbs.filter((l) => l.g.visible).length : 0, wisps: (arms?.wisps ?? []).filter((w) => w.visible).length, rods: (arms?.rods ?? []).filter((r) => r.g.visible).length, sticks: on ? limbs.filter((l) => l.g.visible && l.upper.visible).length : 0, shut: !!p.body.dizzy, outlined: (arms?.hulls ?? []).length > 0 };
      }
      const g = document.querySelector(`svg.scene g[data-seat="${seat}"]`);
      if (!g) return null;
      const limbs = [...g.querySelectorAll(".emote-limb")].filter(shown);
      const shut = g.querySelector(".ghost-shut, .slime-dizzy, .robot-crosses");
      // The flat look paints a piece's colour into its body: read back the fill of its first painted shape for the colour check.
      return {
        look: "flat",
        character: g.dataset.character,
        colour: null,
        words: word,
        hands: limbs.length,
        wisps: limbs.filter((l) => l.querySelector(".emote-wisp") && shown(l.querySelector(".emote-wisp"))).length,
        rods: limbs.filter((l) => l.querySelector(".emote-rod")).length,
        sticks: limbs.filter((l) => !l.querySelector(".emote-wisp") && !l.querySelector(".emote-rod")).length,
        shut: !!shut && shown(shut),
        outlined: limbs.some((l) => l.querySelector("rect")?.getAttribute("stroke") === "#1a1210"),
      };
    }, seat);
  /** Whether a page draws a seat's piece as `character` in `colour` (the 3D looks keep the member's colour on the piece; the flat look is read from its paint). */
  const drawsAs = (page, seat, character, colour) =>
    page
      .waitForFunction(
        ([seat, character, colour]) => {
          const room = window.__room3d;
          if (room) {
            const p = room.pieces.get(seat);
            return p?.kind.id === character && p.member?.colour === colour;
          }
          const g = document.querySelector(`svg.scene g[data-seat="${seat}"]`);
          if (g?.dataset.character !== character) return false;
          // The flat drawing tints its paint from the colour: a stop or a fill of the piece carries a shade of it.
          const n = parseInt(colour.slice(1), 16);
          const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
          const near = (s) => {
            const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(s ?? "");
            if (!m) return false;
            const c = m.slice(1).map(Number);
            // A shade toward white or black keeps the colour's direction: compare the order of its channels and their spread.
            const d = c.map((v, i) => v - rgb[i]);
            return Math.max(...d) - Math.min(...d) < 70;
          };
          return [...g.querySelectorAll("stop, rect, path, ellipse")].some((e) => near(e.getAttribute("stop-color")) || near(e.getAttribute("fill")));
        },
        [seat, character, colour],
        { timeout: 8000 },
      )
      .then(() => true, () => false);
  const shot = async (page, look, name) => shots && (await page.screenshot({ path: `${shots}/${look}-${name}.png` }));

  for (const look of looks) {
    // ================================================================ the picker
    section(`${look}: a phone picks the ghost and a colour, and the room carries it`);
    // The party is started by its big screen; Ada is a bare socket, Bea and Cy are phones.
    const screen = await open(`screen (${look})`, { width: 1280, height: 720 });
    await screen.goto(`${base}/lobby/?start&${query(look)}`);
    await screen.click("text=Use this as the room's screen");
    await screen.click("text=Show the room here");
    await screen.waitForSelector(look === "flat" ? "svg.scene" : ".look3d canvas", { timeout: 60000 });
    const pin = (await screen.locator(".code-digits").textContent()).trim();
    const host = { pin, ...(await call("POST", "/join/" + pin, { nickname: "Ada" })) };
    const ada = connect(host);
    await ada.opened;
    const bea = await open(`bea (${look})`);
    await join(bea, host.pin, "Bea", look);
    const cy = await open(`cy (${look})`);
    await join(cy, host.pin, "Cy", look);
    await ada.wait((m) => m.room?.members.filter((x) => x?.connected).length === 3, 10000, 0);
    check((await screen.locator(".look-btn").count()) === 0, "the big screen has no piece of its own, and no button for one");
    const B = ada.room.members.find((m) => m?.name === "Bea").seat;
    const C = ada.room.members.find((m) => m?.name === "Cy").seat;
    check(ada.room.members.filter(Boolean).every((m) => m.character === "pawn"), "everyone starts as a pawn");
    check((await bea.locator(".bar .look-btn").count()) === 1 && (await bea.locator(".look-btn svg").count()) === 1, "the phone has its own piece in the bar, as a button");
    const corner = await bea.evaluate(() => [...document.querySelectorAll(".corner button")].filter((b) => b.offsetWidth).map((b) => b.className.split(" ").find((c) => c.endsWith("-btn"))));
    check(corner.length === 3 && !corner.includes("look-btn"), `and the corner keeps its three buttons, as on main, clear of the posters: ${corner.join(", ")}`);

    await bea.locator(".look-btn").click();
    await bea.waitForSelector(".look-sheet");
    check((await bea.locator(".look-card").count()) === CHARACTERS.length, `the sheet offers the ${CHARACTERS.length} characters: ${(await bea.locator(".look-name").allTextContents()).join(", ")}`);
    check((await bea.locator('.look-card[aria-pressed="true"]').getAttribute("data-character")) === "pawn", "with the pawn marked as hers now");
    // Every card has its picture, and none of them is cut off by the card or by another.
    const cards = await bea.evaluate(() =>
      [...document.querySelectorAll(".look-card")].map((card) => {
        const r = card.getBoundingClientRect();
        const pic = card.querySelector("svg")?.getBoundingClientRect();
        return { id: card.dataset.character, pic: !!pic && pic.width > 20 && pic.height > 20, inside: !!pic && pic.left >= r.left - 0.5 && pic.right <= r.right + 0.5 && pic.top >= r.top - 0.5 && pic.bottom <= r.bottom + 0.5, w: r.width };
      }),
    );
    check(cards.every((c) => c.pic && c.inside && c.w >= 44), `and each card shows its character whole, at a size a thumb can tap: ${cards.map((c) => `${c.id} ${Math.round(c.w)}px`).join(", ")}`);
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
    // The ghost and the violet are two room views a second apart (the second tap waits out the
    // cooldown), and a page drawing 3D in software may be a frame or two behind: wait for both,
    // not only the first, before reading what Cy's phone draws.
    await drawsAs(cy, B, "ghost", VIOLET);
    const seenB = await pieceOn(cy, B);
    check(seenB?.character === "ghost" && (seenB.colour === null || seenB.colour === VIOLET), `on Cy's phone Bea's piece is a ghost${seenB?.colour ? " in " + seenB.colour : ""}`);
    check((await pieceOn(cy, ada.seat))?.character === "pawn" && (await pieceOn(cy, C))?.character === "pawn", "and Ada's and his own are still pawns");
    check((await pieceOn(bea, B))?.character === "ghost", "on her own phone too");
    const big = await pieceOn(screen, B);
    check(big?.character === "ghost" && (big.colour === null || big.colour === VIOLET) && (await pieceOn(screen, ada.seat))?.character === "pawn", "and on the big screen: Bea a ghost, Ada a pawn");
    await shot(screen, look, "03-big-screen");
    await sleep(400);
    await shot(cy, look, "03-a-ghost-among-pawns");

    // ================================================================ the slime and the robot
    section(`${look}: the second phone picks the slime, then the robot, and the others see each in its colour`);
    await cy.locator(".look-btn").click();
    await cy.waitForSelector(".look-sheet");
    for (const [character, colour] of [
      ["slime", TEAL],
      ["robot", MARMALADE],
    ]) {
      await sleep(LOOK_COOLDOWN_MS);
      from = ada.seen.length;
      await cy.locator(`.look-card[data-character="${character}"]`).click();
      await ada.wait((m) => m.room?.members[C]?.character === character, 5000, from);
      await cy.locator(`.look-swatch[data-colour="${colour}"]`).click();
      await ada.wait((m) => m.room?.members[C]?.colour === colour, 5000, from);
      await cy.waitForSelector(`.look-card[data-character="${character}"][aria-pressed="true"]`, { timeout: 4000 });
      check(ada.room.members[C].character === character && ada.room.members[C].colour === colour, `a tap on the ${character} and on ${colour}: the room has Cy as a ${character} in ${colour}`);
      check(await drawsAs(bea, C, character, colour), `and Bea's phone draws him as a ${character} in ${colour}`);
      check(await drawsAs(screen, C, character, colour), `and so does the big screen`);
      check(await drawsAs(cy, C, character, colour), `and his own phone`);
      check((await cy.locator(".look-btn svg.character-portrait").count()) === 1, "with his own piece on the chip in the bar");
      await shot(cy, look, `03-picker-${character}`);
      await sleep(300);
      await shot(bea, look, `03-${character}-seen-from-the-other-phone`);
    }
    // Back to a pawn in his seat's colour: the knock below is the pawn's kick.
    await sleep(LOOK_COOLDOWN_MS);
    from = ada.seen.length;
    await cy.locator('.look-card[data-character="pawn"]').click();
    await ada.wait((m) => m.room?.members[C]?.character === "pawn", 5000, from);
    await cy.keyboard.press("Escape");

    // ================================================================ the 14 emotes
    section(`${look}: a ghost does each of the 14 emotes, with the hands the owner chose`);
    // Ada (a bare socket) becomes a ghost too, and stands beside Bea, so each emote has a piece to aim at.
    await sleep(LOOK_COOLDOWN_MS);
    from = ada.seen.length;
    ada.send({ t: "look", c: "ghost", v: "#3aa9a0" });
    await ada.wait((m) => m.room?.members[ada.seat]?.character === "ghost", 5000, from);
    ada.goto(ada.room.members[B].x - 200);
    await sleep(900);
    /** Waits for Cy's phone to show Ada's emote `id` with what `want` says: {hands (null: one or more), wisps, rods}. Never a pawn's stick arm. */
    const emoteSeen = (id, word, dur, want) =>
      cy
        .waitForFunction(
          ({ seat, word, want }) => {
            const shown = (el) => el.getAttribute("display") !== "none";
            if (![...document.querySelectorAll(".emote-sticker")].some((g) => shown(g) && g.textContent === word)) return false;
            const room = window.__room3d;
            let hands, wisps, sticks, rods;
            if (room) {
              const arms = room.pieces.get(seat)?.emote?.arms;
              if (!arms) return false;
              const limbs = (arms.arms ?? arms).limbs;
              hands = arms.group.visible ? limbs.filter((l) => l.g.visible).length : 0;
              wisps = (arms.wisps ?? []).filter((w) => w.visible).length;
              rods = (arms.rods ?? []).filter((r) => r.g.visible).length;
              sticks = arms.group.visible ? limbs.filter((l) => l.g.visible && l.upper.visible).length : 0;
            } else {
              const limbs = [...document.querySelectorAll(`svg.scene g[data-seat="${seat}"] .emote-limb`)].filter(shown);
              hands = limbs.length;
              wisps = limbs.filter((l) => l.querySelector(".emote-wisp") && shown(l.querySelector(".emote-wisp"))).length;
              rods = limbs.filter((l) => l.querySelector(".emote-rod")).length;
              sticks = limbs.filter((l) => !l.querySelector(".emote-wisp") && !l.querySelector(".emote-rod")).length;
            }
            return sticks === 0 && wisps === want.wisps && rods === (want.rods ?? 0) && (want.hands === null ? hands >= 1 : hands === want.hands);
          },
          { seat: ada.seat, word, want },
          { timeout: dur + 2500, polling: 50 },
        )
        .then(() => true, () => false);
    for (const e of EMOTES) {
      const rig = ghostRigById(e.id);
      await sleep(EMOTE_COOLDOWN_MS + 150);
      ada.send({ t: "e", e: e.id });
      const want = rig.take === "none" ? { hands: 0, wisps: 0 } : rig.take === "wisp" ? { hands: e.id === "scratch" ? 1 : 2, wisps: e.id === "scratch" ? 1 : 2 } : { hands: null, wisps: e.id === "pointlaugh" ? 1 : 0 };
      // Looked for until it is there: a loaded machine draws late, and the emote lasts seconds.
      const ok = await emoteSeen(e.id, rig.word, rig.dur, want);
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

    // The slime's and the robot's emotes: each of the 14, hands joined on by goo or by a jointed arm.
    for (const [character, colour] of [
      ["slime", TEAL],
      ["robot", MARMALADE],
    ]) {
      section(`${look}: a ${character} does each of the 14 emotes, its hands on ${character === "slime" ? "arms of its goo" : "jointed arms"}`);
      await sleep(Math.max(LOOK_COOLDOWN_MS, EMOTE_COOLDOWN_MS) + 3000);
      from = ada.seen.length;
      ada.send({ t: "look", c: character, v: colour });
      await ada.wait((m) => m.room?.members[ada.seat]?.character === character, 5000, from);
      check(await drawsAs(cy, ada.seat, character, colour), `Cy's phone draws Ada as a ${character} in ${colour}`);
      for (const e of EMOTES) {
        const rig = RIGS[character].find((r) => r.id === e.id);
        await sleep(EMOTE_COOLDOWN_MS + 150);
        ada.send({ t: "e", e: e.id });
        const n = rig.pose(rig.hold, true, 200).hands.length;
        const want = rig.take === "none" ? { hands: 0, wisps: 0, rods: 0 } : character === "slime" ? { hands: n, wisps: n, rods: 0 } : { hands: n, wisps: 0, rods: n };
        const ok = await emoteSeen(e.id, rig.word, rig.dur, want);
        const got = ok ? null : await pieceOn(cy, ada.seat);
        check(ok, `${character}: ${e.name}: "${rig.word}" over its head, ${rig.take === "none" ? "no hands" : `${n} hand${n > 1 ? "s" : ""} ${character === "slime" ? "on goo" : "on jointed arms"}`}, never a pawn's stick arm${ok ? "" : ` (saw ${JSON.stringify(got)})`}`);
        if (["popcorn", "trophy", "steam", "tomato"].includes(e.id)) await shot(cy, look, `05-${character}-${e.id}`);
      }
    }

    // ================================================================ a knock
    section(`${look}: a ghost that is bumped squeezes its eyes shut`);
    await sleep(2600);
    const watchKnock = (seat) =>
      cy.evaluate((seat) => {
        window.__shut = false;
        let n = 0;
        const watch = () => {
          const room = window.__room3d;
          const el = document.querySelector(`svg.scene g[data-seat="${seat}"] :is(.ghost-shut, .slime-dizzy, .robot-crosses)`);
          const shut = room ? !!room.pieces.get(seat)?.body.dizzy : !!el && el.getAttribute("display") !== "none";
          if (shut) window.__shut = true;
          if (++n < 900) requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }, seat);
    // Cy's own piece (a pawn: the kick is its move) walks up to a piece and bumps it. Where everyone is, is the room's word.
    const where = async () => (await (await fetch(`${api}/debug/${host.code}`)).json()).room.view.members;
    async function bump(target) {
      let blow = null;
      for (let tries = 0; tries < 3 && !(blow?.to === target); tries++) {
        for (let i = 0; i < 12; i++) {
          const at = await where();
          const gap = at[target].x - at[C].x;
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
        if (blow?.to !== target) await sleep(2800);
      }
      return blow;
    }
    await watchKnock(B);
    // Ada steps well away, so the only piece in reach is Bea's.
    ada.goto(1500);
    await sleep(600);
    let blow = await bump(B);
    check(blow?.to === B, `Cy's pawn bumps Bea's ghost (the room says it hit seat ${blow?.to ?? "nobody"})`);
    await sleep(650);
    await shot(cy, look, "06-ghost-knocked");
    await sleep(900);
    check(await cy.evaluate(() => window.__shut), "and the ghost's eyes are squeezed shut while it is thrown and lying");

    // ================================================================ the ghost's move: fade, scare, boo
    /** Walks a phone's piece (by its keys) to x, as the room has it. */
    const walkTo = async (page, seat, x, near = 40) => {
      for (let i = 0; i < 14; i++) {
        const gap = x - (await where())[seat].x;
        if (Math.abs(gap) < near) return;
        const key = gap > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await sleep(Math.max(50, Math.min(900, ((Math.abs(gap) - near / 2) / 430) * 1000)));
        await page.keyboard.up(key);
        await sleep(300);
      }
    };
    /** Walks a phone's piece up to another's, from where it is, so it faces it `gap` away. */
    const walkUp = async (page, seat, other, gap = 70) => {
      const at = await where();
      const side = at[seat].x <= at[other].x ? -1 : 1;
      await walkTo(page, seat, at[other].x + side * gap, 25);
      // A last step toward it, so it faces it.
      const key = side < 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await sleep(30);
      await page.keyboard.up(key);
      await sleep(300);
    };

    section(`${look}: a ghost's button is Fade; it fades, and the other phone still sees it`);
    await sleep(2600);
    check((await bea.locator(".ctl-bump .ctl-word").textContent()) === "Fade" && (await bea.locator(".ctl-bump").getAttribute("aria-label")) === "Fade, ready", "Bea's move button says Fade, and it is ready");
    check((await cy.locator(".ctl-bump .ctl-word").textContent()) === "Bump", "Cy's (a pawn) still says Bump");
    ada.goto(1700);
    // Cy walks up to Bea, so he faces her within a kick's reach.
    await walkUp(cy, C, B);
    let mark = ada.seen.length;
    await bea.keyboard.press("KeyX");
    const fade = await ada.wait((m) => m.t === "fade" && m.s === B, 3000, mark).catch(() => null);
    check(fade?.for === 2500, "a tap on Fade: the room tells everybody Bea's ghost has faded for 2.5 s");
    const seenFaded = await cy.waitForFunction((seat) => window.fadedOn(seat) > 0.8, B, { timeout: 2000, polling: 30 }).then(() => true, () => false);
    const others = await cy.evaluate((seat) => window.fadedOn(seat), B);
    const own = await bea.evaluate((seat) => window.fadedOn(seat), B);
    check(seenFaded && (await pieceOn(cy, B))?.character === "ghost", `on Cy's phone her ghost is faded (${others}) and still there, a ghost`);
    check(own > 0.3 && own < others, `on her own phone it is faded less (${own}), so she can always find herself`);
    await sleep(300);
    await shot(cy, look, "09-faded-ghost-seen-by-cy");
    await shot(bea, look, "09-faded-ghost-own-phone");

    section(`${look}: a kick into a faded ghost scares the kicker, on both phones`);
    for (const page of [bea, cy]) await page.evaluate(() => window.watchFright());
    mark = ada.seen.length;
    await cy.keyboard.press("KeyX");
    const scare = await ada.wait((m) => m.t === "b" && m.s === C, 3000, mark).catch(() => null);
    check(scare?.sc === B && scare.to === -1, `Cy's kick passes through Bea's faded ghost and scares Cy (the room says ${JSON.stringify(scare && { to: scare.to, sc: scare.sc })})`);
    await sleep(350);
    await shot(cy, look, "10-scare-cy-phone");
    await shot(bea, look, "10-scare-bea-phone");
    // Tapping the kick while scared, and the fade while it recharges: nothing more happens.
    for (let i = 0; i < 4; i++) {
      await cy.keyboard.press("KeyX");
      await bea.keyboard.press("KeyX");
    }
    await sleep(1600);
    const seenCy = await cy.evaluate((seat) => window.__fright[seat] ?? null, C);
    const seenBea = await bea.evaluate((seat) => window.__fright[seat] ?? null, C);
    check(!!seenCy && seenCy.scared > 0.9 && seenCy.moved > 60, `on Cy's phone his pawn starts, freezes wide-eyed and scurries off (${JSON.stringify(seenCy)})`);
    check(!!seenBea && seenBea.scared > 0.9 && seenBea.moved > 60, `and Bea's phone shows the same (${JSON.stringify(seenBea)})`);
    const later = ada.seen.slice(mark).filter((m) => (m.t === "b" && m.s === C) || (m.t === "fade" && m.s === B));
    check(later.length === 1, `tapping both buttons again and again while scared and recharging sends nothing more (${later.length} event${later.length === 1 ? "" : "s"})`);
    // A script asking for a fade again and again is told no, with the time left.
    mark = ada.seen.length;
    ada.send({ t: "fade" });
    await ada.wait((m) => m.t === "fade" && m.s === ada.seat, 3000, mark).catch(() => null);
    ada.send({ t: "fade" });
    const refused = await ada.wait((m) => m.t === "fade-no", 3000, mark).catch(() => null);
    check(refused?.wait > 7000, `a second fade straight after the first is refused to the sender, with ${refused?.wait} ms to wait ("${refused?.why}")`);

    section(`${look}: a faded ghost drifting through a piece spooks it (boo), on both phones`);
    // Bea's fade is ready again 8 s after it began.
    await sleep(6000);
    await walkUp(bea, B, C, 150);
    for (const page of [bea, cy]) await page.evaluate(() => window.watchFright());
    const soundMark = await bea.evaluate(() => globalThis.__partyRoom.sounds.log.length);
    mark = ada.seen.length;
    await bea.keyboard.press("KeyX");
    const again = await ada.wait((m) => m.t === "fade" && m.s === B, 3000, mark).catch(() => null);
    check(!!again, "Bea fades again once her cooldown is over");
    // Straight through Cy's piece while faded.
    const at = await where();
    const dir = at[C].x > at[B].x ? "ArrowRight" : "ArrowLeft";
    await bea.keyboard.down(dir);
    const spook = await ada.wait((m) => m.t === "spook" && m.s === B, 2000, mark).catch(() => null);
    await sleep(120);
    await bea.keyboard.up(dir);
    check(spook?.to === C, `the room spooks Cy's pawn out of place (${spook ? `from ${at[C].x} to ${spook.x}` : "nothing"})`);
    await sleep(150);
    await shot(cy, look, "11-boo-cy-phone");
    await sleep(900);
    const booCy = await cy.evaluate((seat) => window.__fright[seat] ?? null, C);
    const booBea = await bea.evaluate((seat) => window.__fright[seat] ?? null, C);
    check(!!booCy && booCy.scared > 0.9 && !!booBea && booBea.scared > 0.9, `both phones show the spook as Cy's pawn's own start and scurry (${JSON.stringify(booCy)} / ${JSON.stringify(booBea)})`);
    const booSound = await bea.evaluate((n) => globalThis.__partyRoom.sounds.log.slice(n).map((l) => `${l.name}:${l.what}`), soundMark);
    check(booSound.some((s) => s.startsWith("ghost-fade:")) && booSound.some((s) => s.startsWith("ghost-boo:")), `and the ghost's own sounds were asked for on Bea's phone: ${booSound.join(", ")}`);

    section(`${look}: no fade during the count`);
    await sleep(2800);
    const light = Math.round(boxCentre(0, ada.room.boxes.length));
    ada.send({ t: "look", c: "pawn" });
    await sleep(300);
    ada.goto(light - 60);
    await walkTo(bea, B, light);
    await walkTo(cy, C, light + 60);
    const counting = await ada.wait((m) => m.t === "vote" && !!m.vote.count, 5000, mark).then(() => true, () => !!ada.room.vote?.count);
    check(counting, "everyone stands in a light, and the count runs");
    mark = ada.seen.length;
    await bea.keyboard.press("KeyX");
    await sleep(500);
    check(!ada.seen.slice(mark).some((m) => m.t === "fade"), "Bea taps Fade during the count: nothing is sent, nobody fades");
    check((await bea.locator(".note", { hasText: "Not during the count." }).count()) > 0, "and her phone says why: Not during the count.");
    await shot(bea, look, "12-no-fade-during-count");
    // A script asking anyway is refused by the room, with the reason.
    ada.send({ t: "look", c: "ghost" });
    await ada.wait((m) => m.room?.members[ada.seat]?.character === "ghost", 3000, mark).catch(() => null);
    const during = ada.seen.length;
    ada.send({ t: "fade" });
    const noCount = await ada.wait((m) => m.t === "fade-no", 3000, during).catch(() => null);
    check(noCount?.why === "Not during the count.", `and the room refuses one from a script too: "${noCount?.why}"`);
    // The count is stopped before it starts a game: Ada steps out of the light.
    ada.goto(light - 400);
    await ada.wait((m) => m.t === "vote" && !m.vote.count, 3000, during).catch(() => null);
    check(!ada.room.vote?.count && ada.room.phase !== "playing", "Ada steps out, and the count stops");
    await sleep(400);

    section(`${look}: a knocked slime's eyes squeeze shut and it flattens; a knocked robot's eyes are crosses`);
    for (const character of ["slime", "robot"]) {
      await sleep(Math.max(LOOK_COOLDOWN_MS, 2800));
      from = ada.seen.length;
      ada.send({ t: "look", c: character });
      await ada.wait((m) => m.room?.members[ada.seat]?.character === character, 5000, from);
      // Ada comes over beside Cy, on the far side from Bea.
      const at = await where();
      ada.goto(at[C].x + (at[B].x > at[C].x ? -260 : 260));
      await sleep(900);
      await watchKnock(ada.seat);
      blow = await bump(ada.seat);
      check(blow?.to === ada.seat, `Cy's pawn bumps Ada's ${character} (the room says it hit seat ${blow?.to ?? "nobody"})`);
      await sleep(600);
      await shot(cy, look, `06-${character}-knocked`);
      await sleep(900);
      check(await cy.evaluate(() => window.__shut), `and the ${character}'s eyes show it while it is thrown and lying`);
    }

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
    await sleep(LOOK_COOLDOWN_MS);
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
    const before = { c: ada.room.members[ada.seat].character, v: ada.room.members[ada.seat].colour };
    from = ada.seen.length;
    ada.send({ t: "look", c: "dragon" });
    const no = await ada.wait((m) => m.t === "look-no", 3000, from).catch(() => null);
    ada.send({ t: "look", v: "not-a-colour" });
    await sleep(500);
    check(!!no && no.c === before.c && ada.seen.slice(from).filter((m) => m.t === "look-no").length === 2, `an unknown character and a bad colour are both refused ("${no?.why}"), and she is told what she still is (a ${no?.c})`);
    check(ada.room.members[ada.seat].character === before.c && ada.room.members[ada.seat].colour === before.v, "and nothing changed");

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
    for (const page of [bea, cy, screen]) await page.context().close();
  }

  // ================================================================ what it costs
  if (measure) {
    section(`3D look: four of each character, on this machine (${gpu ? "on the graphics card" : "in software"})`);
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
        for (let i = 0; i < N; i++) p.kind.pose(p.body, p, t0 + i * 16.7, 1 / 60, { walking: false, lit: 0.5, calm: false });
        const ms = (performance.now() - t0) / N;
        // And walking, when everything about it moves every frame.
        const t1 = performance.now();
        for (let i = 0; i < N; i++) {
          p.rx = saved.rx + Math.sin(i / 40) * 120;
          p.kind.pose(p.body, p, t1 + i * 16.7, 1 / 60, { walking: true, lit: 0.5, calm: false });
        }
        const walking = (performance.now() - t1) / N;
        p.rx = saved.rx;
        // One piece's own draws and triangles, as the renderer counts them, from the meshes that would be drawn.
        let draws = 0;
        let triangles = 0;
        p.body.group.traverseVisible((o) => {
          if (!o.isMesh && !o.isSprite) return;
          draws++;
          const g = o.geometry;
          const n = g.index ? g.index.count : g.attributes.position.count;
          triangles += (n / 3) * (o.isInstancedMesh ? o.count : 1);
        });
        for (const extra of [p.body.blob]) extra.traverseVisible((o) => o.isMesh && (draws++, (triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3)));
        return { ms, walking, calls: room.renderer.info.render.calls, triangles: room.renderer.info.render.triangles, own: { draws, triangles: Math.round(triangles) } };
      });
      console.log(`     ${label}: ${line}`);
      console.log(`     ${label}: one piece's pose ${(pose.ms * 1000).toFixed(1)} microseconds standing, ${(pose.walking * 1000).toFixed(1)} walking; one piece is ${pose.own.draws} draws and ${pose.own.triangles} triangles with its shadow; the last picture took ${pose.calls} draws, ${pose.triangles} triangles`);
      return { line, ...pose };
    };
    const drawing = (r) => Number(/drawing ([\d.]+) ms/.exec(r.line ?? "")?.[1] ?? NaN);
    const results = { pawn: await read("four pawns ") };
    for (const character of ["ghost", "slime", "robot"]) {
      await sleep(LOOK_COOLDOWN_MS);
      for (const c of four) c.send({ t: "look", c: character });
      await screen.locator(".look-btn").click();
      await screen.locator(`.look-card[data-character="${character}"]`).click();
      await screen.keyboard.press("Escape");
      await screen.waitForFunction((character) => [...window.__room3d.pieces.values()].every((p) => p.kind.id === character), character, { timeout: 8000 });
      results[character] = await read(`four ${character}s`.padEnd(11));
      await shot(screen, "3d", `08-four-${character}s`);
    }
    for (const [character, r] of Object.entries(results)) console.log(`     ${character.padEnd(6)} drawing ${drawing(r)} ms a picture; pose ${(r.ms * 1000).toFixed(1)} us standing, ${(r.walking * 1000).toFixed(1)} us walking; one piece ${r.own.draws} draws, ${r.own.triangles} triangles; picture ${r.calls} draws, ${r.triangles} triangles`);
    for (const character of ["ghost", "slime", "robot"]) check(Number.isFinite(results[character].walking) && results[character].walking < 1, `a ${character}'s pose takes under a millisecond here, even walking (${(results[character].walking * 1000).toFixed(1)} microseconds)`);
    for (const character of ["slime", "robot"]) check(results[character].own.draws <= results.ghost.own.draws + 2, `a ${character} is no more than two draws over a ghost (${results[character].own.draws} against ${results.ghost.own.draws})`);
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
