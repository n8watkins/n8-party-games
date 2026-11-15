// Answered inputs, the plain logic (party-kit/src/core/answers.js): what an id is, what an answer
// looks like, the message that carries it, and the answers kept per seat for a repeated id.
import { describe, expect, it } from "vitest";
import { ANSWERS_KEPT, ERROR_MAX, ID_MAX, MESSAGE_MAX, answerMessage, answerOf, inputDigest, inputId, lookup, recall, remember } from "../src/core/answers.js";

describe("an input's id", () => {
  it("is a short string or a whole number, and anything else is no id", () => {
    expect(inputId("q-7")).toBe("q-7");
    expect(inputId("x".repeat(ID_MAX))).toBe("x".repeat(ID_MAX));
    expect(inputId(7)).toBe(7);
    expect(inputId(0)).toBe(0);
    for (const raw of [undefined, null, "", "x".repeat(ID_MAX + 1), 1.5, NaN, Infinity, 2 ** 60, {}, ["a"], true]) expect(inputId(raw)).toBeNull();
  });
});

describe("an answer", () => {
  it("is ok unless the game said ok: false, and a refusal always has a code and a sentence", () => {
    expect(answerOf(null)).toEqual({ ok: true });
    expect(answerOf({ ok: true, duplicate: true })).toEqual({ ok: true });
    expect(answerOf({})).toEqual({ ok: true });
    expect(answerOf({ ok: false, error: "not_your_turn", message: "It is not your turn." })).toEqual({ ok: false, error: "not_your_turn", message: "It is not your turn." });
    expect(answerOf({ ok: false })).toEqual({ ok: false, error: "refused", message: "The game did not take that." });
    expect(answerOf({ ok: false, error: 4, message: "" })).toEqual({ ok: false, error: "refused", message: "The game did not take that." });
  });

  it("goes out as ack or error, with the id", () => {
    expect(answerMessage("q-7", { ok: true })).toEqual({ t: "ack", id: "q-7" });
    expect(answerMessage(3, { ok: false, error: "too_soon", message: "Wait." })).toEqual({ t: "error", id: 3, error: "too_soon", message: "Wait." });
  });
});

describe("an answer's length and an input's fingerprint", () => {
  it("cuts a game's long words, and tells the same input from another one", () => {
    const long = answerOf({ ok: false, error: "e".repeat(500), message: "m".repeat(5000) });
    expect(long.error).toHaveLength(ERROR_MAX);
    expect(long.message).toHaveLength(MESSAGE_MAX);
    expect(inputDigest({ say: "one" })).toBe(inputDigest({ say: "one" }));
    expect(inputDigest({ say: "one" })).not.toBe(inputDigest({ say: "three" }));
    expect(inputDigest(undefined)).toMatch(/^[0-9a-f]{8}$/);
    const book = {};
    remember(book, 0, 1, { ok: true }, inputDigest({ say: "one" }));
    expect(lookup(book, 0, 1, inputDigest({ say: "one" }))).toEqual({ answer: { ok: true } });
    expect(lookup(book, 0, 1, inputDigest({ say: "three" }))).toEqual({ reused: true });
    expect(lookup(book, 0, 2, inputDigest({ say: "one" }))).toBeNull();
    // An answer kept before fingerprints were (an older save) is taken as the same input.
    remember(book, 1, 1, { ok: true });
    expect(lookup(book, 1, 1, inputDigest({ say: "x" }))).toEqual({ answer: { ok: true } });
  });
});

describe("the answers kept per seat", () => {
  it("answer an id again, per seat, with 7 and \"7\" kept apart", () => {
    const book = {};
    remember(book, 0, "a", { ok: true });
    remember(book, 0, 7, { ok: false, error: "x", message: "y" });
    expect(recall(book, 0, "a")).toEqual({ ok: true });
    expect(recall(book, 0, 7)).toEqual({ ok: false, error: "x", message: "y" });
    expect(recall(book, 0, "7")).toBeNull();
    expect(recall(book, 1, "a")).toBeNull();
    expect(recall(undefined, 0, "a")).toBeNull();
    // Plain JSON, so it is saved with the game.
    expect(recall(structuredClone(JSON.parse(JSON.stringify(book))), 0, 7)).toMatchObject({ ok: false });
  });

  it("keep the newest few per seat", () => {
    const book = {};
    for (let i = 0; i < ANSWERS_KEPT + 5; i++) remember(book, 2, i, { ok: true });
    expect(book[2]).toHaveLength(ANSWERS_KEPT);
    expect(recall(book, 2, 4)).toBeNull();
    expect(recall(book, 2, 5)).toEqual({ ok: true });
    expect(recall(book, 2, ANSWERS_KEPT + 4)).toEqual({ ok: true });
  });
});
