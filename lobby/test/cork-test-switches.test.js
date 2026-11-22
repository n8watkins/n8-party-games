// Cork & Bell's test switches on this site. In the party room, cork-auto (the game's bot plays your
// seat) and the other cork-* switches reach the game's page only where the wall the server sent
// has test games on, never from the address alone. On the game's own page, the high score board
// chalks up only the score of the run the page sends, played again by the game's own code, and
// each run once: a score typed into an address (?state=end&score=...) or posted bare gets nowhere.
// lobby/test/e2e-cork-switches.mjs checks the same in real pages against the production settings.
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { TEST_WALL, WALL } = await import("../wall.js");
const { SCORE_BOARDS } = await import("../../games.js");
const cork = await import("cork-and-bell");
const { mount, switchesFor } = await import("../../node_modules/cork-and-bell/game/party-view.js");
const { LocalSession } = await import("../../node_modules/cork-and-bell/game/session.js");
const { game: battle } = await import("../../node_modules/cork-and-bell/game/shared/battle.js");
const { RUN_VERSION } = await import("../../node_modules/cork-and-bell/game/shared/run.js");
const { boardEnv, postScore } = await import("../../party-kit/test/score-board-env.js");

const ASKED = new URLSearchParams("join=1234&look=flat&cork-auto=1&cork-quality=low&cork-grid=row&auto=1&seed=7");

/** The least of a document mount() needs: an iframe it can dress, and a box to put it in. */
function fakeContainer(search = "") {
  const doc = {
    defaultView: { location: { search } },
    createElement: (tag) => ({ tag, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, remove() {} }),
  };
  return { ownerDocument: doc, append() {} };
}
const roomOf = (wall) => ({ boxes: wall.boxes, members: [], code: "BCDFGH" });
const ctx = (wall, params) => ({ room: roomOf(wall), you: { role: "player", seat: 0 }, snapshot: {}, send() {}, now: () => 0, params });

describe("cork-* switches in the party room", () => {
  it("production ignores every one: the house never plays for anyone, whatever the address says", () => {
    expect(switchesFor(roomOf(WALL), ASKED)).toBe("");
    const view = mount(fakeContainer("?" + ASKED), ctx(WALL, null)); // no params: the view reads the room page's own address
    expect(view.frame.partyHost.switches).toBe("");
    expect(new URL(view.frame.src).search).toBe("?party=1");
    view.unmount();
  });

  it("the test wall hands them to the game's page (as lobby/test/e2e-cork.mjs uses cork-auto), never on its address", () => {
    expect(switchesFor(roomOf(TEST_WALL), ASKED)).toBe("auto=1&quality=low&grid=row");
    const view = mount(fakeContainer(), ctx(TEST_WALL, ASKED));
    expect(view.frame.partyHost.switches).toBe("auto=1&quality=low&grid=row");
    expect(new URL(view.frame.src).search).toBe("?party=1");
    view.unmount();
  });
});

describe("cork-round, a test run's short round", () => {
  const SHORT = new URLSearchParams("join=1234&cork-round=20&round=20");
  const SEATS = [{ seat: 0, name: "Ann", kind: "human" }, { seat: 1, name: "Bo", kind: "human" }];
  const post = (env, body) => postScore(env, SCORE_BOARDS, "cork-and-bell", body);
  const mountSent = (wall, params, you = { role: "player", seat: 0 }) => {
    const sent = [];
    const view = mount(fakeContainer(params ? "" : "?" + SHORT), { ...ctx(wall, params), you, send: (d) => sent.push(d) });
    const out = { sent, switches: view.frame.partyHost.switches, search: new URL(view.frame.src).search };
    view.unmount();
    return out;
  };

  it("production's wall runs the plain game, whose battles never take one; only the test wall runs the game that does", () => {
    expect(WALL.games.get("cork-and-bell")).toBe(cork.game);
    expect(TEST_WALL.games.get("cork-and-bell")).toBe(cork.testGame);
    expect(cork.testGame).not.toBe(cork.game);
  });

  it("production: the switch is never handed to the page, and the view asks the room for nothing", () => {
    for (const params of [SHORT, null]) expect(mountSent(WALL, params)).toEqual({ sent: [], switches: "", search: "?party=1" });
  });

  it("production: a hand-made {round: 20} to the room is ignored, in the count-in or later, and the round runs its ninety seconds", () => {
    const state = cork.game.create({ seed: 4, seats: SEATS, now: 0, round: 1, roundSeconds: 20 });
    for (const now of [0, 500, 2900, 3500, 30_000]) for (const d of [{ round: 20 }, { round: 30 }, { round: "20" }]) cork.game.input(state, 0, d, now);
    expect(state.roundSeconds).toBe(90);
    expect(cork.game.snapshot(state, 30_000).roundSeconds).toBe(90);
    const said = [];
    for (let now = 0; !cork.game.isOver(state) && now < 120_000; now += 33) said.push(...cork.game.tick(state, now));
    expect(said.some((e) => e.k === "round")).toBe(false);
    // Nobody fires, so the round runs to its time call: the full ninety seconds.
    expect(said.find((e) => e.k === "time").t).toBeGreaterThanOrEqual(90);
  });

  it("the test wall: a player's view asks for it as it mounts, a screen does not, and the room takes it and tells everyone", () => {
    expect(mountSent(TEST_WALL, SHORT)).toMatchObject({ sent: [{ round: 20 }], switches: "round=20", search: "?party=1" });
    expect(mountSent(TEST_WALL, SHORT, { role: "screen", seat: -1 }).sent).toEqual([]);
    const state = cork.testGame.create({ seed: 4, seats: SEATS, now: 0, round: 1 });
    cork.testGame.input(state, 0, { round: 20 }, 500);
    expect(cork.testGame.tick(state, 533)).toContainEqual({ k: "round", s: 20 });
    expect(cork.testGame.snapshot(state, 533).roundSeconds).toBe(20);
  });

  it("the board refuses a run that names a round length (the page never sends a short round's run: it is a practice run)", async () => {
    const { env, board } = boardEnv();
    const session = new LocalSession({ seed: 5, seats: [{ seat: 0, name: "You", kind: "human" }], mySeat: 0, countIn: 1.2, roundSeconds: 20 });
    for (let i = 0; !session.over && i < 20000; i++) {
      for (const input of battle.bot(session.state, 0, session.now)) session.fire(input.f[1], input.f[2]);
      session.advance(1 / 60);
    }
    expect(session.state.endAt).toBeLessThan(20.05);
    const run = JSON.parse(JSON.stringify({ seed: 5, countIn: session.countIn, shots: session.shots, v: RUN_VERSION }));
    for (const named of [{ round: 20 }, { roundSeconds: 20 }, { roundSeconds: 90 }]) expect((await post(env, { name: "ZZZ", ...run, ...named })).status).toBe(400);
    expect(await board.top()).toEqual([]);
  });
});

describe("Cork & Bell's high score board on this site", () => {
  const rules = SCORE_BOARDS["cork-and-bell"];
  const post = (env, path, body) => postScore(env, SCORE_BOARDS, path, body);

  it("plays runs again with the game's own code, and has the game's ceiling", () => {
    expect(rules.scoreRun).toBe(cork.scoreRun);
    expect(rules.max).toBe(cork.manifest.scores.max);
  });

  /** The page's solo run (game/main.js startLocal), the game's bot standing in for the player's hands, as the page sends it. */
  function played(seed) {
    const session = new LocalSession({ seed, seats: [{ seat: 0, name: "You", kind: "human" }], mySeat: 0, countIn: 1.2 });
    for (let i = 0; !session.over && i < 20000; i++) {
      for (const input of battle.bot(session.state, 0, session.now)) session.fire(input.f[1], input.f[2]);
      session.advance(0.016 + (i % 5) * 0.004);
    }
    return { run: JSON.parse(JSON.stringify({ seed, countIn: session.countIn, shots: session.shots, v: RUN_VERSION })), shown: session.sims[0].score };
  }

  it("chalks up a run at the score the page showed, whatever score it claims, and the same run once", async () => {
    const { env, board } = boardEnv();
    const { run, shown } = played(3_141_592_653);
    expect(shown).toBeGreaterThan(0);
    expect(await post(env, "cork-and-bell", { name: "ANN", ...run, score: rules.max })).toMatchObject({ status: 200, ok: true, score: shown, place: 0 });
    expect(await post(env, "cork-and-bell", { name: "BOB", ...run })).toMatchObject({ status: 409, error: "already_chalked" });
    expect(await board.top()).toEqual([{ name: "ANN", score: shown, at: expect.any(Number) }]);
  });

  it("refuses a score with no run behind it (as ?state=end&score=... once sent), a made-up run, and a run of another version of the rules", async () => {
    const { env, board } = boardEnv();
    expect(await post(env, "cork-and-bell", { name: "ZZZ", score: rules.max })).toMatchObject({ status: 400, error: "bad_request" });
    expect((await post(env, "cork-and-bell", { name: "ZZZ", seed: 7, countIn: 0, shots: [[5, 0, 1], [1, 0, 1]], v: RUN_VERSION })).status).toBe(400);
    expect((await post(env, "cork-and-bell", { name: "ZZZ", seed: 7, countIn: 0, shots: [], v: RUN_VERSION })).status).toBe(400);
    const { run } = played(99);
    expect((await post(env, "cork-and-bell", { name: "ZZZ", ...run, v: RUN_VERSION + 1 })).status).toBe(400);
    expect((await post(env, "cork-and-bell", { name: "ZZZ", ...run, v: undefined })).status).toBe(400);
    expect(await board.top()).toEqual([]);
  });
});

describe("the site's Worker (worker.js)", () => {
  /** A bare score to the kit's e2e-test board through the site's own Worker, with these switches. */
  async function testBoard(vars) {
    const { default: site } = await import("../../worker.js");
    const { env } = boardEnv();
    const request = new Request("https://party.test/api/party/scores/e2e-test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" },
      body: JSON.stringify({ name: "ANN", score: 5 }),
    });
    return (await site.fetch(request, { ...env, ...vars })).status;
  }

  it("has the e2e-test board only where PARTY_TEST_GAMES is on, whatever PARTY_SIM_LATENCY says", async () => {
    expect(await testBoard({ PARTY_TEST_GAMES: "on", PARTY_SIM_LATENCY: "on" })).toBe(200);
    expect(await testBoard({ PARTY_TEST_GAMES: "on", PARTY_SIM_LATENCY: "off" })).toBe(200);
    expect(await testBoard({ PARTY_TEST_GAMES: "off", PARTY_SIM_LATENCY: "on" })).toBe(404);
    expect(await testBoard({ PARTY_SIM_LATENCY: "off" })).toBe(404);
  });
});
