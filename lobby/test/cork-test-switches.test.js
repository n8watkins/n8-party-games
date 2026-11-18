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
