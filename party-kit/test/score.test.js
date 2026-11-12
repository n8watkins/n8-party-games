// The score board's rules: three clean letters, a possible score, ten rows, best first.
import { describe, expect, it } from "vitest";
import { BOARD_SIZE, MAX_SCORE_BODY_BYTES, addScore, cleanBoard, cleanInitials, validScore } from "../src/worker/score-logic.js";
import { RATE_LIMITS } from "../src/worker/limit-logic.js";
import { MAX_ROUND_SCORE } from "../../cork-and-bell/game/shared/battle.js";

describe("initials", () => {
  it("are three letters, capitals in the end", () => {
    expect(cleanInitials("ann")).toBe("ANN");
    expect(cleanInitials(" Bo ")).toBeNull();
    expect(cleanInitials("ABCD")).toBeNull();
    expect(cleanInitials("A1C")).toBeNull();
    expect(cleanInitials("A C")).toBeNull();
    expect(cleanInitials("<b>")).toBeNull();
    expect(cleanInitials("ÀÉÎ")).toBeNull();
    expect(cleanInitials(123)).toBeNull();
    expect(cleanInitials(undefined)).toBeNull();
  });

  it("do not spell the obvious rude ones", () => {
    for (const rude of ["ass", "FUK", "Sex", "cum", "KKK"]) expect(cleanInitials(rude)).toBeNull();
    for (const fine of ["TOM", "MAB", "AAA", "ZZZ", "DOL"]) expect(cleanInitials(fine)).toBe(fine);
  });
});

describe("a score", () => {
  it("is a whole number a round can reach", () => {
    expect(validScore(5120, MAX_ROUND_SCORE)).toBe(true);
    expect(validScore(MAX_ROUND_SCORE, MAX_ROUND_SCORE)).toBe(true);
    expect(validScore(MAX_ROUND_SCORE + 1, MAX_ROUND_SCORE)).toBe(false);
    expect(validScore(0, MAX_ROUND_SCORE)).toBe(false);
    expect(validScore(-5, MAX_ROUND_SCORE)).toBe(false);
    expect(validScore(12.5, MAX_ROUND_SCORE)).toBe(false);
    expect(validScore("5120", MAX_ROUND_SCORE)).toBe(false);
    expect(validScore(Number.NaN, MAX_ROUND_SCORE)).toBe(false);
    expect(validScore(Infinity, MAX_ROUND_SCORE)).toBe(false);
  });

  it("has a ceiling worked out from the game's own rules", () => {
    // 180 shots (one each half second for 90 seconds) at 1350 each, and two challenges at 150.
    expect(MAX_ROUND_SCORE).toBe(180 * 1350 + 300);
  });
});

describe("the board", () => {
  it("keeps the best first and says where a score landed", () => {
    let rows = [];
    let place;
    ({ rows, place } = addScore(rows, { name: "ANN", score: 3000, at: 1 }));
    expect(place).toBe(0);
    ({ rows, place } = addScore(rows, { name: "BOB", score: 5000, at: 2 }));
    expect(place).toBe(0);
    ({ rows, place } = addScore(rows, { name: "CYD", score: 4000, at: 3 }));
    expect(place).toBe(1);
    expect(rows.map((r) => r.name)).toEqual(["BOB", "CYD", "ANN"]);
  });

  it("puts an equal score under the one that was there first", () => {
    const { rows, place } = addScore([{ name: "ANN", score: 3000, at: 1 }], { name: "BOB", score: 3000, at: 2 });
    expect(place).toBe(1);
    expect(rows.map((r) => r.name)).toEqual(["ANN", "BOB"]);
  });

  it("holds ten and turns the eleventh away unless it beats one", () => {
    let rows = [];
    for (let i = 0; i < BOARD_SIZE; i++) rows = addScore(rows, { name: "AAA", score: 1000 + i * 100, at: i }).rows;
    expect(rows).toHaveLength(BOARD_SIZE);
    const low = addScore(rows, { name: "LOW", score: 900, at: 99 });
    expect(low.place).toBe(-1);
    expect(low.rows).toEqual(rows);
    const high = addScore(rows, { name: "TOP", score: 9999, at: 100 });
    expect(high.place).toBe(0);
    expect(high.rows).toHaveLength(BOARD_SIZE);
    expect(high.rows.at(-1).score).toBe(1100); // the lowest fell off
  });

  it("throws away anything stored that is not a proper row", () => {
    expect(cleanBoard(undefined)).toEqual([]);
    expect(cleanBoard("nonsense")).toEqual([]);
    expect(cleanBoard([{ name: "ANN", score: 10, at: 5 }, { name: "ann", score: 10 }, { name: "BOB", score: "10" }, null, { name: "SEX", score: 10 }])).toEqual([{ name: "ANN", score: 10, at: 5 }]);
  });

  it("is posted to through a small body and a tight limit", () => {
    expect(JSON.stringify({ name: "ABC", score: MAX_ROUND_SCORE }).length).toBeLessThan(MAX_SCORE_BODY_BYTES);
    expect(RATE_LIMITS.score_short.limit).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.score_long.limit).toBeLessThanOrEqual(100);
  });
});
