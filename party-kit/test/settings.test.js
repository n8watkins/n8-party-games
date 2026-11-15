// A game's settings and what a rematch carries, the plain logic (party-kit/src/core/settings.js):
// how a manifest describes the choices, what makes a game's settings wrong, the game's own check,
// one change from the host, and the carry kept for the same people in the same seats.
import { describe, expect, it } from "vitest";
import * as cork from "cork-and-bell";
import { game as coinFlip } from "../../lobby/games/coin-flip.js";
import { CARRY_MAX_BYTES, SETTINGS_MAX_BYTES, applyChange, carryFor, carryOf, checkSettings, fieldDefaults, hasCarry, hasSettings, seatsKey, settingFields, settingsProblems } from "../src/core/settings.js";

const FIELDS = [
  { key: "mode", label: "Mode", options: [{ value: "twenty_questions", label: "20 questions" }, { value: "describe_it", label: "Describe it" }] },
  { key: "timer", label: "Turn timer", options: [0, 60, 90], default: 60 },
  { key: "hints", options: [true, false] },
];

const withSettings = (settings, extra = {}) => ({ settings, ...extra });

describe("how a manifest describes a game's settings", () => {
  it("puts every field in one shape: labels, options with labels, and a default", () => {
    const { fields, problems } = settingFields(FIELDS);
    expect(problems).toEqual([]);
    expect(fields).toEqual([
      { key: "mode", label: "Mode", options: [{ value: "twenty_questions", label: "20 questions" }, { value: "describe_it", label: "Describe it" }], default: "twenty_questions" },
      { key: "timer", label: "Turn timer", options: [{ value: 0, label: "0" }, { value: 60, label: "60" }, { value: 90, label: "90" }], default: 60 },
      { key: "hints", label: "hints", options: [{ value: true, label: "true" }, { value: false, label: "false" }], default: true },
    ]);
    expect(fieldDefaults(fields)).toEqual({ mode: "twenty_questions", timer: 60, hints: true });
  });

  it("says nothing for a game with none, and leaves out a field it cannot use, saying why", () => {
    expect(settingFields(undefined)).toEqual({ fields: [], problems: [] });
    expect(settingFields({ mode: [] }).problems).toEqual(["manifest.settings is a list of fields."]);
    const { fields, problems } = settingFields([
      { key: "ok", options: ["a"] },
      { key: "ok", options: ["b"] },
      { key: "2bad", options: ["a"] },
      { key: "none", options: [] },
      { key: "obj", options: [{ value: { a: 1 } }] },
      { key: "twice", options: ["a", "a"] },
      { key: "lost", options: ["a", "b"], default: "c" },
      null,
    ]);
    expect(fields.map((f) => f.key)).toEqual(["ok"]);
    expect(problems).toEqual([
      'manifest.settings[1].key "ok" is used twice.',
      "manifest.settings[2].key is a name of letters, digits and _, of up to 32 characters.",
      "manifest.settings[3].options is a list of 1 to 24 choices.",
      "manifest.settings[4].options are strings, numbers or true and false.",
      "manifest.settings[5].options has the same value twice.",
      "manifest.settings[6].default is one of its options.",
      "manifest.settings[7] is an object.",
    ]);
  });
});

describe("what makes a game's settings wrong", () => {
  it("finds nothing wrong with the games on the wall, which have none", () => {
    for (const game of [cork.game, coinFlip]) {
      expect(hasSettings(game)).toBe(false);
      expect(hasCarry(game)).toBe(false);
      expect(settingsProblems(game, undefined)).toEqual([]);
    }
  });

  it("asks for functions, and for a description of the choices", () => {
    expect(settingsProblems({ settings: {}, carry: 1 })).toEqual(["settings, when given, is a function.", "carry, when given, is a function."]);
    expect(settingsProblems(withSettings((v) => v), undefined)).toEqual(["A game with settings describes them in manifest.settings: a list of fields with their options."]);
    expect(settingsProblems(withSettings((v) => v), [{ key: "x", options: [] }])).toEqual(["manifest.settings[0].options is a list of 1 to 24 choices."]);
    expect(settingsProblems(withSettings((v) => v, { carry: () => null }), FIELDS)).toEqual([]);
  });
});

describe("the game's own check", () => {
  const game = withSettings((v) => {
    if (v.timer === 0 && v.mode === "describe_it") return { ok: false, error: "no_timer", message: "Describe it needs a timer." };
    return { mode: v.mode ?? "twenty_questions", timer: v.timer ?? 60, hints: v.hints ?? true };
  });

  it("gives back the game's clean object, defaults filled in", () => {
    expect(checkSettings(game, {})).toEqual({ ok: true, settings: { mode: "twenty_questions", timer: 60, hints: true } });
  });

  it("passes on the game's refusal in its own words, cut to the usual lengths", () => {
    expect(checkSettings(game, { mode: "describe_it", timer: 0 })).toEqual({ ok: false, error: "no_timer", message: "Describe it needs a timer." });
    const long = withSettings(() => ({ ok: false, error: "e".repeat(100), message: "m".repeat(300) }));
    const said = checkSettings(long, {});
    expect([said.error.length, said.message.length]).toEqual([64, 200]);
    expect(checkSettings(withSettings(() => ({ ok: false })), {})).toEqual({ ok: false, error: "bad_settings", message: "Those settings cannot be used." });
  });

  it("refuses what is not a small plain-JSON object, and a check that throws", () => {
    for (const bad of [null, 3, "x", [1], { when: new Date() }, { big: "x".repeat(SETTINGS_MAX_BYTES) }]) {
      const said = checkSettings(withSettings(() => bad), {});
      expect(said).toMatchObject({ ok: false, error: "bad_settings" });
      expect(said.thrown).toBeInstanceOf(Error);
    }
    const thrown = checkSettings(
      withSettings(() => {
        throw new Error("boom");
      }),
      {},
    );
    expect(thrown).toMatchObject({ ok: false, error: "bad_settings", message: "Those settings cannot be used." });
    expect(thrown.thrown.message).toBe("boom");
  });

  it("never lets the game change the object it was given", () => {
    const picks = { mode: "describe_it" };
    checkSettings(
      withSettings((v) => {
        v.mode = "changed";
        return v;
      }),
      picks,
    );
    expect(picks).toEqual({ mode: "describe_it" });
  });
});

describe("one change from the host", () => {
  const { fields } = settingFields(FIELDS);
  const picks = fieldDefaults(fields);

  it("takes a known field and one of its options", () => {
    expect(applyChange(fields, picks, { timer: 90, hints: false })).toEqual({ ok: true, picks: { mode: "twenty_questions", timer: 90, hints: false } });
    expect(picks.timer).toBe(60);
  });

  it("refuses anything else before the game is asked", () => {
    expect(applyChange(fields, picks, { colour: "red" })).toEqual({ ok: false, error: "bad_setting", message: "That is not one of this game's settings." });
    expect(applyChange(fields, picks, { timer: 30 })).toEqual({ ok: false, error: "bad_setting", message: "That is not a choice for Turn timer." });
    expect(applyChange(fields, picks, { timer: "60" })).toMatchObject({ ok: false, error: "bad_setting" });
    for (const nothing of [null, {}, [], "timer"]) expect(applyChange(fields, picks, nothing)).toMatchObject({ ok: false, error: "bad_setting" });
  });
});

describe("what a rematch carries", () => {
  const game = { carry: (state) => state.carry };

  it("is the game's small plain-JSON object, or nothing", () => {
    expect(carryOf({}, {})).toBeNull();
    expect(carryOf(game, { carry: undefined })).toBeNull();
    expect(carryOf(game, { carry: null })).toBeNull();
    expect(carryOf(game, { carry: { loser: 1, used: ["a", "b"] } })).toEqual({ loser: 1, used: ["a", "b"] });
    expect(() => carryOf(game, { carry: [1] })).toThrow("carry() gives back a plain object.");
    expect(() => carryOf(game, { carry: { seen: new Set() } })).toThrow(TypeError);
    expect(() => carryOf(game, { carry: { big: "x".repeat(CARRY_MAX_BYTES) } })).toThrow(RangeError);
  });

  it("is kept for the same people in the same seats, in any order, and dropped for anyone else", () => {
    const seats = [
      { seat: 0, who: "ann" },
      { seat: 1, who: "bo" },
    ];
    const kept = () => ({ turns: { seats: seatsKey(seats), carry: { loser: 1 } } });
    expect(carryFor(kept(), "turns", [...seats].reverse())).toEqual({ loser: 1 });
    expect(carryFor(kept(), "other", seats)).toBeNull();
    for (const other of [[seats[0]], [...seats, { seat: 2, who: "cy" }], [seats[0], { seat: 1, who: "cy" }], [seats[0], { seat: 2, who: "bo" }]]) {
      const store = kept();
      expect(carryFor(store, "turns", other)).toBeNull();
      expect(store).toEqual({});
    }
  });
});
