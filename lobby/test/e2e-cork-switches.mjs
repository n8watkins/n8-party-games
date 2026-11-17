// Cork & Bell's test switches against the production settings, end to end in real pages: nobody
// can have the house play for them, or put a score on the board, by adding something to an address.
//
// It needs a server with the production settings (the top level of wrangler.jsonc: no test games,
// no simulated latency) and fresh storage, so the limits and the score board start empty:
//
//   npx wrangler dev --local --env="" --port 8804 --local-upstream localhost:8804 --persist-to <empty folder>
//   node lobby/test/e2e-cork-switches.mjs --base=http://localhost:8804
//
// 1. A party of one starts Cork & Bell in the party room with ?cork-auto=1 on the room's address
//    and touches nothing: no cork may be fired for it, and the Tonight board must show 0.
// 2. Two pages make a battle on the game's own page with ?auto=1&host=1 and ?auto=1&join=<pin>:
//    the game's bot may not play either seat.
// 3. The game's own page with ?state=end&score=<the most a round can score> offers no high score
//    entry, and the board's API refuses a bare score and a made-up run: the board stays empty.
// 4. A real run from the start board (the game's bot stands in for the player's hands, through
//    the page's own fire call) still goes on the board, at exactly the score the page showed.
//
// The local test server (npm run dev) honours all of these: lobby/test/e2e-cork.mjs uses
// ?cork-auto=1 there. The browser is headless and muted, and is closed whatever happens.
import { launchBrowser } from "./browser.mjs";
import { boxCentre } from "../shared/world.js";
import { partyApi, sleep } from "./client.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith("--" + k + "=")) ?? "--" + k + "=" + d).split("=").slice(1).join("=");
const base = opt("base", "http://localhost:8804");
const { call, connect } = partyApi(base);
const problems = [];
const check = (ok, what) => {
  console.log((ok ? "ok   " : "FAIL ") + what);
  if (!ok) problems.push(what);
};
const FRAME = 'iframe[title="Cork & Bell"]';
/** Round seconds the pages are left alone for: the game's bot fires its first cork within about two. */
const HANDS_OFF = 12;

const config = await (await fetch(base + "/api/party/config")).json();
if (config.simLatency) {
  console.log("FAIL this server has the test switches on (PARTY_SIM_LATENCY): start one with the production settings, see the top of this file");
  process.exit(1);
}

const errors = [];
const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); // with TEST_GPU=1 the browser draws on the card
const open = async (name, viewport, extra = {}) => {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra })).newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_|status of 4\d\d/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  return page;
};

try {
  // ================================================================ 1. the party room
  const sol = await open("Sol", { width: 844, height: 390 }, { hasTouch: true });
  await sol.goto(base + "/lobby/?start&look=flat&cork-auto=1&cork-quality=low");
  await sol.fill("input[name=nickname]", "Sol");
  await sol.click("text=Start the party");
  await sol.waitForSelector("svg.scene text");
  const pin = await sol.evaluate(() => [...document.querySelectorAll("svg.scene text")].map((t) => t.textContent).find((t) => /^\d{4}$/.test(t)));
  // The room is watched by a socket that joins as its big screen: it hears where the piece is, and the round.
  const watcher = connect(await call("POST", "/join/" + pin, { as: "screen" }));
  await watcher.opened;
  const alive = setInterval(() => watcher.send("ping"), 20_000);
  await watcher.wait((m) => m.room?.members[0]?.connected, 8000, 0);
  const boxes = watcher.room.boxes;
  check(!boxes.some((b) => b.test), "the wall the server sent has no test games on it (production)");
  const light = Math.round(boxCentre(boxes.findIndex((b) => b.id === "cork-and-bell"), boxes.length));
  for (let i = 0; i < 14; i++) {
    await sleep(120);
    const gap = light - (watcher.seen.findLast((m) => m.t === "m" && m.s === 0)?.x ?? watcher.room.members[0].x);
    if (Math.abs(gap) < 14) break;
    const k = gap > 0 ? "ArrowRight" : "ArrowLeft";
    await sol.keyboard.down(k);
    await sleep(Math.max(40, Math.min(1500, (Math.abs(gap) / 430) * 1000)));
    await sol.keyboard.up(k);
  }
  await watcher.wait((m) => m.room?.phase === "playing", 20000);
  const frame = await (await sol.waitForSelector(FRAME, { timeout: 120000 })).contentFrame();
  await frame.waitForFunction(() => window.__cab?.mode === "battle" && window.__cab.session, null, { timeout: 120000 });
  check(!/[?&]auto=/.test(frame.url()), `the game's page is opened without the switch (${new URL(frame.url()).search})`);
  await frame.waitForFunction((t) => window.__cab.session.time() > t, HANDS_OFF, { timeout: 120000 });
  const played = await frame.evaluate(() => ({ auto: window.__cab.params.auto, ...window.__cab.summary().stalls[0] }));
  check(played.shots === 0, `with ?cork-auto=1 on the room's address and no touch, no cork is fired for the player (${played.shots} fired, ${played.score} points, ${HANDS_OFF} s in)`);
  console.log("     waiting for the round to end...");
  const end = await watcher.wait((m) => m.room?.phase === "lobby" && m.room.last?.game === "cork-and-bell", 150000);
  const row = end.room.last.rows[0];
  check(row.score === 0, `the Tonight board's card shows what the player did: ${row.name} ${row.score}`);
  clearInterval(alive);
  watcher.ws.close();
  await sol.context().close();

  // ================================================================ 2. a battle on the game's own page
  const ann = await open("Ann", { width: 640, height: 360 });
  await ann.goto(base + "/cork-and-bell/?auto=1&host=1&seats=2&name=Ann&quality=low");
  await ann.waitForFunction(() => window.__cab?.session, null, { timeout: 120000 });
  // A test server makes the room by itself; production does not: the page is left as anyone would find it.
  const made = await ann
    .waitForFunction(() => window.__cab.party.session?.pin ?? null, null, { timeout: 15000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  if (!made) check(true, "?auto=1&host=1 on the game's own page makes no room by itself");
  else {
    const bo = await open("Bo", { width: 640, height: 360 });
    await bo.goto(base + `/cork-and-bell/?auto=1&join=${made}&name=Bo&quality=low`);
    const started = await ann
      .waitForFunction(() => window.__cab.mode === "battle" && window.__cab.session.time() > 12, null, { timeout: 90000 })
      .then(() => true)
      .catch(() => false);
    const shots = started ? await ann.evaluate(() => window.__cab.summary().stalls.map((s) => s.shots)) : [];
    check(!started || shots.every((n) => n === 0), started ? `?auto=1 on the game's own page plays nobody's seat in a battle (corks fired by each seat: ${shots.join(", ")})` : "?auto=1 on the game's own page starts no battle by itself");
    await bo.context().close();
  }
  await ann.context().close();

  // ================================================================ 3. the high score board
  const scores = base + "/api/party/scores/cork-and-bell";
  const MOST = 243300;
  const endCard = await open("end card", { width: 640, height: 360 });
  await endCard.goto(base + `/cork-and-bell/?state=end&score=${MOST}&quality=low`);
  await endCard.waitForSelector("#card:not([hidden])", { timeout: 120000 });
  const offered = await endCard.evaluate(() => !document.getElementById("initials").hidden);
  if (offered) {
    await endCard.fill("#initials-in", "ZZZ");
    await endCard.click("#initials-ok");
    await endCard.waitForFunction(() => document.getElementById("initials").hidden || /please|Try/.test(document.getElementById("initials-say").textContent), null, { timeout: 15000 }).catch(() => {});
  }
  check(!offered, "?state=end&score=... shows the end card without the high score entry");
  await endCard.context().close();
  const bare = await fetch(scores, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "YYY", score: 5000 }) });
  check(bare.status >= 400, `the board refuses a bare score with no run behind it (${bare.status})`);
  const madeUp = await fetch(scores, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "XXW", run: "made-up", countIn: 0, shots: [] }) });
  check(madeUp.status >= 400, `the board refuses a run it never handed out (${madeUp.status})`);
  const board = await (await fetch(scores)).json();
  check(Array.isArray(board.top) && board.top.length === 0, `the board is still empty: ${JSON.stringify(board.top)}`);

  // ================================================================ 4. a real run still goes on the board
  const player = await open("player", { width: 640, height: 360 });
  await player.goto(base + "/cork-and-bell/?quality=low");
  await player.waitForFunction(() => window.__cab?.session && window.__cab.mode === "attract", null, { timeout: 120000 });
  // The board's ticket for the run is asked for as the page opens; give it a moment, as a visitor reading the start board does.
  await player.waitForTimeout(1500);
  await player.click("#start-solo");
  await player.waitForFunction(() => window.__cab.mode === "solo", null, { timeout: 30000 });
  const ticketed = await player.evaluate(() => !!window.__cab.session.run);
  check(ticketed, "a run started from the start board is played on a seed the board handed out");
  // The player's hands: the game's own bot aims, and the page fires through the same call a click
  // does. The mouse moves over the stall meanwhile, as a player's does: a stall left alone for a
  // minute goes back to the house.
  await player.evaluate(async () => {
    const { game } = await import("/cork-and-bell/game/shared/battle.js");
    const stage = document.getElementById("stage");
    let n = 0;
    const hands = () => {
      const s = window.__cab.session;
      if (window.__cab.mode !== "solo" || s.over) return;
      for (const input of game.bot(s.state, 0, s.now)) s.fire(input.f[1], input.f[2]);
      n += 1;
      stage.dispatchEvent(new PointerEvent("pointermove", { clientX: 300 + (n % 40), clientY: 160, pointerType: "mouse", bubbles: true }));
      requestAnimationFrame(hands);
    };
    requestAnimationFrame(hands);
  });
  console.log("     playing a whole round alone...");
  await player.waitForSelector("#initials:not([hidden])", { timeout: 150000 });
  const shown = await player.evaluate(() => window.__cab.session.sims[0].score);
  await player.fill("#initials-in", "ANN");
  await player.click("#initials-ok");
  await player.waitForFunction(() => /Number|board/.test(document.getElementById("card-note").textContent), null, { timeout: 15000 });
  const chalked = (await (await fetch(scores)).json()).top;
  check(chalked.length === 1 && chalked[0].name === "ANN" && chalked[0].score === shown, `a real run goes on the board at the score the page showed: ${JSON.stringify(chalked)} (shown ${shown})`);
  await player.context().close();

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log(problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.");
process.exit(problems.length ? 1 : 0);
