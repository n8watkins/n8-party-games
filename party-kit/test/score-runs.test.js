// A score board whose game plays a run again (`scoreRun`): the board hands out each run's seed,
// takes each run back once, and chalks up only the score the game's own code gives it. A bare
// score, a run it never handed out, a run sent twice or a run too old gets nowhere.
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { MAX_RUN_BODY_BYTES, RUN_PREFIX, RUN_TTL_MS, isRunId, runId, runTime } = await import("../src/worker/score-logic.js");
const { RATE_LIMITS } = await import("../src/worker/limit-logic.js");
const { boardEnv, postScore } = await import("./score-board-env.js");

/** A toy game: its run is a list of numbers, and its score the seed's last digit plus their sum; anything else is not a run. */
const toyScoreRun = ({ seed, taps }) => (Array.isArray(taps) && taps.every(Number.isInteger) ? (seed % 10) + taps.reduce((a, b) => a + b, 0) : null);
const SCORES = { toy: { max: 1000, scoreRun: toyScoreRun }, plain: { max: 1000 } };

const post = (env, path, body) => postScore(env, SCORES, path, body);

describe("a run's id", () => {
  it("says when it was handed out, sorts by it, and is nothing else", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    const id = runId(1_794_893_877_082, hex);
    expect(isRunId(id)).toBe(true);
    expect(runTime(id)).toBe(1_794_893_877_082);
    expect(runId(1000, hex) < runId(999_999_999, hex)).toBe(true);
    for (const bad of [null, 5, "", "made-up", id + "0", id.toUpperCase(), id.replace(".", "-")]) expect(isRunId(bad)).toBe(false);
  });
});

describe("a board that plays runs again", () => {
  it("hands out a run with a seed, and chalks up the game's score for it, not the page's", async () => {
    const { env } = boardEnv();
    const started = await post(env, "toy/runs");
    expect(started).toMatchObject({ status: 200, ok: true });
    expect(isRunId(started.run)).toBe(true);
    expect(Number.isInteger(started.seed) && started.seed >= 0 && started.seed < 2 ** 32).toBe(true);
    const sent = await post(env, "toy", { name: "ANN", run: started.run, taps: [5, 7], score: 999 });
    expect(sent).toMatchObject({ status: 200, ok: true, place: 0, score: (started.seed % 10) + 12 });
    expect(sent.top).toEqual([{ name: "ANN", score: (started.seed % 10) + 12, at: expect.any(Number) }]);
  });

  it("takes each run back once, and only runs it handed out", async () => {
    const { env, board } = boardEnv();
    const { run } = await post(env, "toy/runs");
    expect((await post(env, "toy", { name: "ANN", run, taps: [5] })).status).toBe(200);
    expect(await post(env, "toy", { name: "BOB", run, taps: [9] })).toMatchObject({ status: 400, ok: false });
    for (const made of ["made-up", runId(Date.now(), "0".repeat(32)), undefined]) expect((await post(env, "toy", { name: "CYD", run: made, taps: [9] })).status).toBe(400);
    expect((await board.top()).map((r) => r.name)).toEqual(["ANN"]);
  });

  it("refuses a bare score, and a run the game will not score, which is then spent", async () => {
    const { env, board } = boardEnv();
    expect(await post(env, "toy", { name: "ANN", score: 500 })).toMatchObject({ status: 400, ok: false });
    const { run } = await post(env, "toy/runs");
    expect((await post(env, "toy", { name: "ANN", run, taps: ["x"] })).status).toBe(400);
    expect((await post(env, "toy", { name: "ANN", run, taps: [1] })).status).toBe(400);
    expect(await board.top()).toEqual([]);
  });

  it("lets letters be tried again without spending the run", async () => {
    const { env } = boardEnv();
    const { run } = await post(env, "toy/runs");
    expect(await post(env, "toy", { name: "SEX", run, taps: [1] })).toMatchObject({ status: 400, error: "bad_name" });
    expect((await post(env, "toy", { name: "SAM", run, taps: [1] })).status).toBe(200);
  });

  it("refuses a run kept too long, and drops the old ones it no longer keeps when it hands out the next", async () => {
    const { board, storage } = boardEnv();
    const t0 = 1_800_000_000_000;
    const old = await board.startRun(t0);
    const fresh = await board.startRun(t0 + RUN_TTL_MS - 1000);
    expect(await board.takeRun(old.run, t0 + RUN_TTL_MS + 1)).toBeNull();
    const kept = await board.startRun(t0 + 2 * RUN_TTL_MS - 2000);
    expect([...storage.map.keys()].filter((k) => k.startsWith(RUN_PREFIX)).sort()).toEqual([RUN_PREFIX + fresh.run, RUN_PREFIX + kept.run].sort());
    expect(await board.takeRun(fresh.run, t0 + RUN_TTL_MS)).toEqual({ seed: fresh.seed });
    expect(await board.takeRun(fresh.run, t0 + RUN_TTL_MS)).toBeNull();
  });

  it("hands out runs under a limit of their own, and only for a game that plays runs again", async () => {
    const { env, hits } = boardEnv();
    await post(env, "toy/runs");
    expect(hits.map((h) => h.rule)).toEqual([RATE_LIMITS.run_short, RATE_LIMITS.run_long]);
    expect((await post(env, "plain/runs")).status).toBe(404);
    expect((await post(env, "nothing/runs")).status).toBe(404);
    const refused = boardEnv({ allow: false });
    expect((await post(refused.env, "toy/runs")).status).toBe(429);
    expect(await refused.storage.list({ prefix: RUN_PREFIX })).toEqual(new Map());
  });

  it("still takes a bare score on a board whose game does not play runs again", async () => {
    const { env } = boardEnv();
    expect(await post(env, "plain", { name: "ANN", score: 500 })).toMatchObject({ status: 200, ok: true, place: 0 });
  });

  it("reads a run's body up to its own size, and no further", async () => {
    const { env } = boardEnv();
    const { run } = await post(env, "toy/runs");
    const big = await post(env, "toy", { name: "ANN", run, taps: Array.from({ length: MAX_RUN_BODY_BYTES / 2 }, () => 1) });
    expect(big.status).toBe(400);
    expect(RATE_LIMITS.run_short.limit).toBeLessThanOrEqual(60);
    expect(RATE_LIMITS.run_long.limit).toBeLessThanOrEqual(500);
  });
});
