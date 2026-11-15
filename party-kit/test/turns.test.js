// Turn-based games, the plain logic (party-kit/src/core/turns.js): which games are turn-based,
// what makes a game definition wrong, the deadline, what an input gives back, and how a game's
// state is written down and read back.
import { describe, expect, it } from "vitest";
import * as cork from "cork-and-bell";
import { game as coinFlip } from "../../lobby/games/coin-flip.js";
import { SAVE_VERSION, copyState, deadlineOf, gameProblems, inputOutcome, isTurnBased, loadState, plainJson, saveState, stateKey } from "../src/core/turns.js";

const base = () => ({ create: () => ({}), input: () => {}, tick: () => [], snapshot: () => ({}), isOver: () => false });
const turns = (extra = {}) => ({ ...base(), tickHz: 0, ...extra });

describe("which games are turn-based", () => {
  it("is a game that says tickHz: 0, and no other", () => {
    expect(isTurnBased(turns())).toBe(true);
    expect(isTurnBased({ ...base(), tickHz: 30 })).toBe(false);
    // Saying nothing is the room's default tick rate, not turns.
    expect(isTurnBased(base())).toBe(false);
    expect(isTurnBased({ ...base(), tickHz: "0" })).toBe(false);
    expect(isTurnBased(null)).toBe(false);
    expect(isTurnBased(cork.game)).toBe(false);
    expect(isTurnBased(coinFlip)).toBe(false);
  });
});

describe("what makes a game definition wrong", () => {
  it("finds nothing wrong with the games on the wall, ticking or turn-based", () => {
    expect(gameProblems(cork.game)).toEqual([]);
    expect(gameProblems(coinFlip)).toEqual([]);
    expect(gameProblems(turns())).toEqual([]);
    // No deadlines and no tick: a game moved only by its players.
    const { tick, ...untimed } = turns();
    expect(tick).toBeTypeOf("function");
    expect(gameProblems(untimed)).toEqual([]);
    expect(gameProblems(turns({ nextDeadline: () => null, serialize: (s) => JSON.stringify(s), restore: (t) => JSON.parse(t) }))).toEqual([]);
  });

  it("says what is missing or does not fit", () => {
    expect(gameProblems(null)).toEqual(["A game is an object."]);
    const { input, ...noInput } = turns();
    expect(input).toBeTypeOf("function");
    expect(gameProblems(noInput)).toEqual(["A game needs input()."]);
    const { tick, ...ticker } = { ...base(), tickHz: 30 };
    expect(tick).toBeTypeOf("function");
    expect(gameProblems(ticker)).toEqual(["A ticking game needs tick()."]);
    expect(gameProblems({ ...base(), tickHz: -1 })[0]).toMatch(/^tickHz/);
    expect(gameProblems({ ...base(), tickHz: Infinity })[0]).toMatch(/^tickHz/);
    expect(gameProblems(turns({ nextDeadline: 5 }))).toEqual(["nextDeadline, when given, is a function."]);
    const { tick: t2, ...deadlineNoTick } = turns({ nextDeadline: () => 1 });
    expect(t2).toBeTypeOf("function");
    expect(gameProblems(deadlineNoTick)).toEqual(["A turn-based game with deadlines needs tick(), called when one is reached."]);
    expect(gameProblems(turns({ serialize: () => "" }))).toEqual(["serialize and restore come together, or not at all."]);
    expect(gameProblems(turns({ restore: () => ({}) }))).toEqual(["serialize and restore come together, or not at all."]);
  });
});

describe("the deadline", () => {
  it("is a finite time from nextDeadline, and null when there is none or the game is over", () => {
    expect(deadlineOf(turns({ nextDeadline: (s) => s.at }), { at: 5000 })).toBe(5000);
    expect(deadlineOf(turns(), { at: 5000 })).toBeNull();
    expect(deadlineOf(turns({ nextDeadline: () => null }), {})).toBeNull();
    // A paused timer may say so in any way; only a real time is a wake-up.
    for (const at of [undefined, NaN, Infinity, "5000"]) expect(deadlineOf(turns({ nextDeadline: () => at }), {})).toBeNull();
    expect(deadlineOf(turns({ nextDeadline: () => 5000, isOver: () => true }), {})).toBeNull();
  });
});

describe("what an input gives back", () => {
  it("splits events for the viewers from the game's answer to the sender", () => {
    expect(inputOutcome(undefined)).toEqual({ events: [], answer: null });
    expect(inputOutcome([{ k: "said" }])).toEqual({ events: [{ k: "said" }], answer: null });
    // Who Am I? answers every input (KR-7) and says nothing else.
    expect(inputOutcome({ ok: true, duplicate: false })).toEqual({ events: [], answer: { ok: true, duplicate: false } });
    expect(inputOutcome({ ok: false, error: "not_your_turn", events: [{ k: "nudge", only: 1 }] })).toEqual({ events: [{ k: "nudge", only: 1 }], answer: { ok: false, error: "not_your_turn" } });
    expect(inputOutcome({ ok: true, events: "not a list" })).toEqual({ events: [], answer: { ok: true } });
  });
});

describe("a copy to apply an input to, and comparing states", () => {
  it("copies through the game's own save when it has one, and compares states as they would be saved", () => {
    const plain = turns();
    const state = { moves: [{ say: "a" }], when: 1 };
    const copy = copyState(plain, state);
    copy.moves.push({ say: "b" });
    expect(state.moves).toHaveLength(1);
    const own = turns({ serialize: (s) => JSON.stringify(s), restore: (t) => ({ ...JSON.parse(t), restored: true }) });
    expect(copyState(own, state)).toMatchObject({ moves: [{ say: "a" }], restored: true });
    expect(stateKey(plain, state)).toBe(stateKey(plain, structuredClone(state)));
    expect(stateKey(plain, state)).not.toBe(stateKey(plain, copy));
    // A state that cannot be saved has no key: it is never taken as unchanged.
    expect(stateKey(plain, { when: new Date(0) })).toBeNull();
  });
});

describe("saving and restoring a game's state", () => {
  const state = () => ({ turn: 1, deadline: 1_700_000_030_000, seats: [0, 2], secrets: { 0: "owl", 2: "fox" }, moves: [{ seat: 0, say: "Am I alive?" }], over: false, nothing: null });

  it("copies a plain game's state as JSON, and gives back an equal copy that shares nothing", () => {
    const s = state();
    const saved = saveState(turns(), s);
    expect(saved).toEqual({ v: SAVE_VERSION, by: "json", data: s });
    // Through storage, which clones it (structuredClone), and back.
    const back = loadState(turns(), structuredClone(saved));
    expect(back).toEqual(s);
    back.moves.push({ seat: 2, say: "Can I fly?" });
    expect(s.moves).toHaveLength(1);
    expect(saved.data.moves).toHaveLength(1);
  });

  it("lets a game write and read its own (Who Am I? keeps a string), and asks it to", () => {
    const own = turns({ serialize: (s) => JSON.stringify({ shape: 1, s }), restore: (text) => ({ ...JSON.parse(text).s, restored: true }) });
    const saved = saveState(own, state());
    expect(saved.by).toBe("game");
    expect(typeof saved.data).toBe("string");
    expect(loadState(own, structuredClone(saved))).toEqual({ ...state(), restored: true });
  });

  it("refuses a state that would not come back the same, by its path", () => {
    expect(() => saveState(turns(), { seen: new Set([1]) })).toThrow("state.seen is a Set, not a plain object.");
    expect(() => saveState(turns(), { at: new Date(0) })).toThrow("state.at is a Date");
    expect(() => saveState(turns(), { by: new Map() })).toThrow("state.by is a Map");
    expect(() => saveState(turns(), { list: [1, undefined] })).toThrow("state.list[1] is undefined");
    expect(() => saveState(turns(), { f: () => 1 })).toThrow("state.f is a function");
    expect(() => saveState(turns(), { score: NaN })).toThrow("state.score is NaN");
    expect(() => saveState(turns(), { big: 10n })).toThrow("state.big is a bigint");
    const loop = { a: {} };
    loop.a.back = loop;
    expect(() => saveState(turns(), loop)).toThrow("state.a.back refers back to itself.");
    expect(() => saveState(turns({ serialize: () => new Map(), restore: () => ({}) }), {})).toThrow("serialize() is a Map");
  });

  it("leaves out keys whose value is undefined, as JSON does, and allows the same object twice", () => {
    const shared = { n: 1 };
    expect(plainJson({ a: undefined, b: shared, c: [shared] })).toEqual({ b: { n: 1 }, c: [{ n: 1 }] });
    expect(plainJson(Object.assign(Object.create(null), { x: 1 }))).toEqual({ x: 1 });
  });

  it("does not read a save that is not one, or one written the other way", () => {
    const own = turns({ serialize: (s) => JSON.stringify(s), restore: (t) => JSON.parse(t) });
    expect(() => loadState(turns(), null)).toThrow("Not a saved game.");
    expect(() => loadState(turns(), { v: 99, by: "json", data: {} })).toThrow("Not a saved game.");
    expect(() => loadState(turns(), { v: SAVE_VERSION, by: "other", data: {} })).toThrow("Not a saved game.");
    expect(() => loadState(turns(), saveState(own, state()))).toThrow("has no restore()");
    expect(() => loadState(own, saveState(turns(), state()))).toThrow("restores its own saves");
    // A game's own restore may refuse what it does not recognise (Who Am I? checks its schema).
    const strict = turns({ serialize: (s) => s, restore: () => { throw new Error("Not a saved Who Am I? game"); } });
    expect(() => loadState(strict, saveState(strict, {}))).toThrow("Not a saved Who Am I? game");
  });
});
