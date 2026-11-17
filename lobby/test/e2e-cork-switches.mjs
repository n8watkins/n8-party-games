// Cork & Bell's test switches against the production settings, end to end in real pages: nobody
// can have the house play for them, or put a score on the board, by adding something to an address
// or by posting to the board.
//
// It needs a server with the production settings (the top level of wrangler.jsonc: no test games,
// no simulated latency, rate limits on) and fresh storage, so the limits and the board start empty.
// The predeploy gate starts one for it (.github/scripts/predeploy-steps.mjs, `env: ""`); by hand:
//
//   npx wrangler dev --local --env="" --port 8804 --local-upstream localhost:8804 --persist-to <empty folder>
//   node lobby/test/e2e-cork-switches.mjs --base=http://localhost:8804
//
// 1. A party of one starts Cork & Bell in the party room with ?cork-auto=1 on the room's address
//    and touches nothing: the game's page is handed no switch, and five seconds into the round no
//    cork has been fired for the player (the bot fires its first within about two).
// 2. ?auto=1&host=1 on the game's own page: once the page has the server's /config, it has asked
//    for no room and made none.
// 3. Practice runs: ?state=end&score=<the most a round can score>, ?seed=7 and ?view=wide end
//    without the high score entry. The board's API refuses a bare score, a made-up run, a run of
//    another version of the rules and a body over 16 KB: the board stays empty.
// 4. A real run from the start board still goes on the board, at exactly the score the page
//    showed: the page's own session is played to the end at once (the game's bot fires through the
//    page's fire call, then the round moves on 1/60 s), so the round takes a second or two, not 90.
//    The same run sent again, now claiming the most a round can score, is turned away.
// The board's API is posted to six times in all: the production limit is six scores per address in
// ten minutes.
//
// The local test server (npm run dev) honours the switches: lobby/test/e2e-cork.mjs uses
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
/** When the checks began: after the browser is up (with TEST_GPU=1 it may first wait for a card slot). */
let started = Date.now();
const lap = (what) => console.log(`     (${what}: ${((Date.now() - started) / 1000).toFixed(1)} s)`);
const FRAME = 'iframe[title="Cork & Bell"]';
/** Round seconds the party room's page is left alone for: the game's bot fires its first cork within about two. */
const HANDS_OFF = 5;
const SCORES = base + "/api/party/scores/cork-and-bell";
const MOST = 243300;

const config = await (await fetch(base + "/api/party/config")).json();
if (config.simLatency || config.testGames !== false) {
  console.log("FAIL this server has its test switches on (PARTY_SIM_LATENCY or PARTY_TEST_GAMES): start one with the production settings, see the top of this file");
  process.exit(1);
}

const errors = [];
const browser = await launchBrowser({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); // with TEST_GPU=1 the browser draws on the card
lap("browser up");
started = Date.now();
const open = async (name, viewport, extra = {}) => {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra })).newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_|status of 4\d\d/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  return page;
};
const post = async (body) => {
  const res = await fetch(SCORES, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: res.status, error: (await res.json().catch(() => ({}))).error };
};
/** Plays the page's own solo session to the end at once: the game's bot at the gun, through the page's fire call. */
const playToTheEnd = () =>
  (async () => {
    const { game } = await import("/cork-and-bell/game/shared/battle.js");
    const s = window.__cab.session;
    for (let i = 0; i < 20000 && !s.over; i++) {
      for (const input of game.bot(s.state, 0, s.now)) s.fire(input.f[1], input.f[2]);
      s.advance(1 / 60);
    }
    return { over: s.over, score: s.sims[0].score, seed: s.seed, countIn: s.countIn, shots: s.shots };
  })();

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
  const frameEl = await sol.waitForSelector(FRAME, { timeout: 120000 });
  const frame = await frameEl.contentFrame();
  await frame.waitForFunction(() => window.__cab?.mode === "battle" && window.__cab.session, null, { timeout: 120000 });
  const handed = await frameEl.evaluate((f) => f.partyHost?.switches);
  check(handed === "", `the game's page is handed no switch from the room's address (partyHost.switches ${JSON.stringify(handed)})`);
  check(!/[?&]auto=/.test(frame.url()), `the game's page is opened without the switch (${new URL(frame.url()).search})`);
  await frame.waitForFunction((t) => window.__cab.session.time() > t, HANDS_OFF, { timeout: 120000 });
  const played = await frame.evaluate(() => ({ auto: window.__cab.params.auto, ...window.__cab.summary().stalls[0] }));
  check(!played.auto && played.shots === 0, `with ?cork-auto=1 on the room's address and no touch, no cork is fired for the player (${played.shots} fired, ${HANDS_OFF} s in)`);
  watcher.ws.close();
  await sol.context().close();
  lap("party room");

  // ================================================================ 2. ?auto=1&host=1 on the game's own page
  const ann = await open("Ann", { width: 640, height: 360 });
  const roomCalls = [];
  ann.on("request", (r) => r.method() === "POST" && /\/api\/party\/(rooms|join)/.test(r.url()) && roomCalls.push(r.url()));
  await ann.goto(base + "/cork-and-bell/?auto=1&host=1&seats=2&name=Ann&quality=low");
  await ann.waitForFunction(() => window.__cab?.session, null, { timeout: 120000 });
  // The page decides as soon as it has the server's /config (a fetch it makes once): no waiting for a room that never comes.
  const said = await ann.evaluate(() => window.__cab.party.config());
  await ann.waitForTimeout(300);
  const roomPin = await ann.evaluate(() => window.__cab.party.session?.pin ?? null);
  check(said.testGames === false && roomCalls.length === 0 && roomPin === null, `?auto=1&host=1 asks for no room and makes none in production (testGames ${said.testGames}, room requests ${roomCalls.length}, pin ${roomPin})`);
  lap("?auto=1&host=1");

  // ================================================================ 3. practice runs and the board's API
  await ann.goto(base + `/cork-and-bell/?state=end&score=${MOST}&quality=low`);
  await ann.waitForSelector("#card:not([hidden])", { timeout: 120000 });
  const card = await ann.evaluate(() => ({ form: !document.getElementById("initials").hidden, note: document.getElementById("card-note").textContent }));
  check(!card.form && /practice/i.test(card.note), `?state=end&score=... is a practice card with no high score entry ("${card.note}")`);
  for (const q of ["seed=7", "view=wide"]) {
    await ann.goto(base + `/cork-and-bell/?${q}&quality=low`);
    await ann.waitForFunction(() => window.__cab?.mode === "attract", null, { timeout: 120000 });
    await ann.evaluate(() => document.getElementById("start-solo").click());
    await ann.waitForFunction(() => window.__cab.mode === "solo", null, { timeout: 30000 });
    const run = await ann.evaluate(playToTheEnd);
    await ann.waitForSelector("#card:not([hidden])", { timeout: 15000 });
    const end = await ann.evaluate(() => ({ form: !document.getElementById("initials").hidden, note: document.getElementById("card-note").textContent }));
    check(run.over && run.score > 0 && !end.form && /practice/i.test(end.note), `?${q}: a practice run of ${run.score} with no high score entry ("${end.note}")`);
  }
  await ann.context().close();
  const bare = await post({ name: "YYY", score: 5000 });
  check(bare.status === 400 && bare.error === "bad_request", `the board refuses a bare score (${bare.status} ${bare.error})`);
  const madeUp = await post({ name: "XXW", seed: 7, countIn: 0, shots: [[5000, 0, 1.4], [1000, 0, 1.4]], v: 1, score: MOST });
  check(madeUp.status === 400 && madeUp.error === "bad_request", `the board refuses a made-up run that claims the most a round can score (${madeUp.status} ${madeUp.error})`);
  const huge = await post(JSON.stringify({ name: "BIG", seed: 8, countIn: 0, shots: [], v: 1, pad: "x".repeat(16500) }));
  check(huge.status === 400, `the board refuses a body over 16 KB (${huge.status} ${huge.error})`);
  const empty = (await (await fetch(SCORES)).json()).top;
  check(Array.isArray(empty) && empty.length === 0, `the board is still empty: ${JSON.stringify(empty)}`);
  lap("practice runs and the board's API");

  // ================================================================ 4. a real run still goes on the board
  const player = await open("player", { width: 640, height: 360 });
  // The page asks for the board as it opens; a score makes the board only once the page has it.
  const boardRead = player.waitForResponse((r) => r.url() === SCORES && r.request().method() === "GET", { timeout: 120000 });
  await player.goto(base + "/cork-and-bell/?quality=low");
  await boardRead;
  await player.waitForFunction(() => window.__cab?.session && window.__cab.mode === "attract", null, { timeout: 120000 });
  await player.click("#start-solo");
  await player.waitForFunction(() => window.__cab.mode === "solo", null, { timeout: 30000 });
  const real = await player.evaluate(playToTheEnd);
  await player.waitForSelector("#initials:not([hidden])", { timeout: 15000 });
  await player.fill("#initials-in", "ANN");
  await player.click("#initials-ok");
  await player.waitForFunction(() => /Number|board/.test(document.getElementById("card-note").textContent), null, { timeout: 15000 });
  const note = await player.evaluate(() => document.getElementById("card-note").textContent);
  const chalked = (await (await fetch(SCORES)).json()).top;
  check(chalked.length === 1 && chalked[0].name === "ANN" && chalked[0].score === real.score, `a real run goes on the board at the score the page showed, ${real.score} ("${note}"): ${JSON.stringify(chalked)}`);
  check(chalked.every((r) => !("seed" in r)), "the board shows no seed");
  const v = await player.evaluate(async () => (await import("/cork-and-bell/game/shared/run.js")).RUN_VERSION);
  const again = await post({ name: "ZZZ", seed: real.seed, countIn: real.countIn, shots: real.shots, v, score: MOST });
  check(again.status === 409 && again.error === "already_chalked", `the same run sent again, claiming ${MOST}, is turned away (${again.status} ${again.error})`);
  const otherRules = await post({ name: "ZZZ", seed: (real.seed + 1) >>> 0, countIn: real.countIn, shots: real.shots, v: v + 1 });
  check(otherRules.status === 400, `a run of another version of the rules is not scored (${otherRules.status} ${otherRules.error})`);
  const after = (await (await fetch(SCORES)).json()).top;
  check(JSON.stringify(after.map((r) => [r.name, r.score])) === JSON.stringify([["ANN", real.score]]), `the board holds only that run: ${JSON.stringify(after)}`);
  await player.context().close();
  lap("a real run");

  check(errors.length === 0, "no page reported an error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
} catch (err) {
  console.log("FAIL the run stopped: " + (err?.stack ?? err));
  problems.push("the run stopped");
} finally {
  await browser.close();
}
console.log((problems.length ? `\n${problems.length} problem(s):\n- ` + problems.join("\n- ") : "\nAll good.") + ` (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
