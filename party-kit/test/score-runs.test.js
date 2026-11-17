// A score board whose game plays a run again (`scoreRun`): the page sends the run (its seed and
// what its player did), and the board chalks up only the score the game's own code gives it. A
// bare score, a run the game will not score, or the same run sent twice gets nowhere. Rows stored
// before seeds were kept still read back as they were.
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { MAX_RUN_BODY_BYTES, addScore, cleanBoard, isSeed, shownBoard } = await import("../src/worker/score-logic.js");
const { RATE_LIMITS } = await import("../src/worker/limit-logic.js");
const { boardEnv, postScore } = await import("./score-board-env.js");
const { handlePartyApi } = await import("../src/worker/index.js");

/** A toy game: its run is a seed and a list of numbers, its score the seed's last digit plus their sum; anything else is not a run. */
const toyScoreRun = ({ seed, taps }) => (Number.isInteger(seed) && Array.isArray(taps) && taps.every(Number.isInteger) ? (seed % 10) + taps.reduce((a, b) => a + b, 0) : null);
const throwing = () => {
  throw new Error("boom");
};
const SCORES = { toy: { max: 1000, scoreRun: toyScoreRun }, plain: { max: 1000 }, throws: { max: 1000, scoreRun: throwing } };

const post = (env, path, body) => postScore(env, SCORES, path, body);
const get = async (env, path) => {
  const res = await handlePartyApi(new Request(`https://party.test/api/party/scores/${path}`), env, { scores: SCORES });
  return { status: res.status, ...(await res.json()) };
};

describe("a run's seed", () => {
  it("is a whole number from 0 to 2^32 - 1, and nothing else", () => {
    for (const ok of [0, 1, 4_294_967_295]) expect(isSeed(ok)).toBe(true);
    for (const bad of [-1, 4_294_967_296, 1.5, "7", null, undefined, NaN, Infinity]) expect(isSeed(bad)).toBe(false);
  });
});

describe("a board that plays runs again", () => {
  it("chalks up the game's score for the run, never the score the page claims, and never shows the seed", async () => {
    const { env, storage } = boardEnv();
    const sent = await post(env, "toy", { name: "ANN", seed: 4_000_000_003, taps: [5, 7], score: 999 });
    expect(sent).toMatchObject({ status: 200, ok: true, place: 0, score: 15 });
    expect(sent.top).toEqual([{ name: "ANN", score: 15, at: expect.any(Number) }]);
    expect((await get(env, "toy")).top).toEqual([{ name: "ANN", score: 15, at: expect.any(Number) }]);
    // The seed is kept with the row, for the board's own use only.
    expect(storage.map.get("top")).toEqual([{ name: "ANN", score: 15, at: expect.any(Number), seed: 4_000_000_003 }]);
  });

  it("turns the same run away the second time, whoever sends it, and leaves the board as it was", async () => {
    const { env, board } = boardEnv();
    const run = { seed: 77, taps: [5, 4] };
    expect((await post(env, "toy", { name: "ANN", ...run })).status).toBe(200);
    expect(await post(env, "toy", { name: "BOB", ...run })).toMatchObject({ status: 409, ok: false, error: "already_chalked" });
    expect(await post(env, "toy", { name: "BOB", ...run, taps: [90] })).toMatchObject({ status: 409, error: "already_chalked" });
    expect((await post(env, "toy", { name: "BOB", seed: 78, taps: [5, 4] })).status).toBe(200);
    expect((await board.top()).map((r) => r.name)).toEqual(["BOB", "ANN"]);
  });

  it("refuses a bare score, a missing or impossible seed, a run the game will not score, and one that scores nothing", async () => {
    const { env, board } = boardEnv();
    expect(await post(env, "toy", { name: "ANN", score: 500 })).toMatchObject({ status: 400, ok: false, error: "bad_request" });
    for (const seed of [undefined, -1, 2 ** 32, 1.5, "7"]) expect((await post(env, "toy", { name: "ANN", seed, taps: [1] })).status).toBe(400);
    expect(await post(env, "toy", { name: "ANN", seed: 7, taps: ["x"] })).toMatchObject({ status: 400, error: "bad_request" });
    expect(await post(env, "toy", { name: "ANN", seed: 10, taps: [] })).toMatchObject({ status: 400, error: "bad_request" });
    expect(await post(env, "toy", { name: "ANN", seed: 9, taps: [995] })).toMatchObject({ status: 400, error: "bad_request" });
    expect(await post(env, "throws", { name: "ANN", seed: 7, taps: [1] })).toMatchObject({ status: 400, error: "bad_request" });
    expect(await board.top()).toEqual([]);
  });

  it("lets letters be tried again with the same run", async () => {
    const { env } = boardEnv();
    expect(await post(env, "toy", { name: "SEX", seed: 5, taps: [1] })).toMatchObject({ status: 400, error: "bad_name" });
    expect((await post(env, "toy", { name: "SAM", seed: 5, taps: [1] })).status).toBe(200);
  });

  it("has no way to hand out runs: a page picks its own seed", async () => {
    const { env } = boardEnv();
    expect((await post(env, "toy/runs")).status).toBe(404);
    expect((await post(env, "plain/runs")).status).toBe(404);
    expect(Object.keys(RATE_LIMITS).filter((k) => k.startsWith("run_"))).toEqual([]);
  });

  it("counts a run against the score limits, and nothing else", async () => {
    const { env, hits } = boardEnv();
    await post(env, "toy", { name: "ANN", seed: 1, taps: [1] });
    expect(hits.map((h) => h.rule)).toEqual([RATE_LIMITS.score_short, RATE_LIMITS.score_long]);
    const refused = boardEnv({ allow: false });
    expect(await post(refused.env, "toy", { name: "ANN", seed: 1, taps: [1] })).toMatchObject({ status: 429, error: "rate_limited" });
    expect(await refused.board.top()).toEqual([]);
  });

  it("still takes a bare score on a board whose game does not play runs again", async () => {
    const { env } = boardEnv();
    expect(await post(env, "plain", { name: "ANN", score: 500 })).toMatchObject({ status: 200, ok: true, place: 0 });
  });

  it("reads a run's body up to its own size, and no further", async () => {
    const { env } = boardEnv();
    const big = await post(env, "toy", { name: "ANN", seed: 1, taps: Array.from({ length: MAX_RUN_BODY_BYTES / 2 }, () => 1) });
    expect(big).toMatchObject({ status: 400, error: "bad_request" });
    expect(MAX_RUN_BODY_BYTES).toBe(16384);
  });

  it("never deletes anything it has stored", async () => {
    const { env, storage } = boardEnv();
    const deleted = [];
    const real = storage.delete;
    storage.delete = async (keys) => (deleted.push(keys), real(keys));
    for (let i = 0; i < 14; i++) await post(env, "toy", { name: "ANN", seed: 100 + i, taps: [i + 1] });
    await post(env, "toy", { name: "ANN", seed: 100, taps: [1] });
    expect(deleted).toEqual([]);
    expect(storage.map.get("top")).toHaveLength(10);
  });
});

describe("a board stored before seeds were kept", () => {
  /** As a board kept them: {name, score, at}, best first (and one older row with no time). */
  const OLD = [
    { name: "MAB", score: 9000, at: 1_790_000_000_000 },
    { name: "TOM", score: 700, at: 1_790_000_000_500 },
    { name: "FIT", score: 40 },
  ];

  it("reads back exactly as it was stored", async () => {
    const { env, storage, board } = boardEnv();
    storage.map.set("top", structuredClone(OLD));
    const expected = [OLD[0], OLD[1], { ...OLD[2], at: 0 }];
    expect(await board.top()).toEqual(expected);
    expect((await get(env, "toy")).top).toEqual(expected);
    expect(cleanBoard(OLD)).toEqual(expected);
    expect(shownBoard(OLD)).toEqual(expected);
  });

  it("takes runs among its old rows, keeps every old row as it was, and shows no seed", async () => {
    const { env, storage } = boardEnv();
    storage.map.set("top", structuredClone(OLD));
    const sent = await post(env, "toy", { name: "ANN", seed: 3, taps: [800] });
    expect(sent).toMatchObject({ status: 200, place: 1, score: 803 });
    expect(sent.top).toEqual([OLD[0], { name: "ANN", score: 803, at: expect.any(Number) }, OLD[1], { ...OLD[2], at: 0 }]);
    expect(storage.map.get("top")).toEqual([OLD[0], { name: "ANN", score: 803, at: expect.any(Number), seed: 3 }, OLD[1], { ...OLD[2], at: 0 }]);
    // An old row has no seed, so it never makes a run look like a replay.
    expect(addScore(OLD, { name: "BOB", score: 1, at: 1, seed: 0 }).replayed).toBeUndefined();
    // A bare score (no seed) never counts as a replay either.
    expect(addScore(storage.map.get("top"), { name: "BOB", score: 2, at: 1 }).replayed).toBeUndefined();
  });

  it("keeps only seeds that are seeds", () => {
    expect(cleanBoard([{ name: "ANN", score: 5, at: 1, seed: "x" }, { name: "BOB", score: 4, at: 1, seed: 2 ** 32 }])).toEqual([
      { name: "ANN", score: 5, at: 1 },
      { name: "BOB", score: 4, at: 1 },
    ]);
  });
});
