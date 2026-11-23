// What a typed question may carry once tidied (nothing invisible, no piles of combining marks,
// emoji intact), and how much of a turn's log is kept: neither may grow without end.
import { describe, expect, it } from "vitest";
import { LOG_KEPT, tidyQuestion, view } from "../rules.js";
import { Table } from "./table.js";

const tidy = (text) => tidyQuestion(text).text;

describe("a question's text", () => {
  it("loses invisible characters: word joiner and invisible operators, the Arabic letter mark, tags, the soft hyphen", () => {
    expect(tidy("a⁠b⁡c⁢d⁣e⁤f")).toBe("abcdef");
    expect(tidy("x؜y")).toBe("xy");
    expect(tidy("tag\u{E0041}\u{E0042}\u{E007F}s")).toBe("tags");
    expect(tidy("soft­hyphen")).toBe("softhyphen");
    expect(tidy("zero​width‌ and‎ marks‏")).toBe("zerowidth and marks");
    expect(tidy("bidi ‮esrever‬ ⁦isolate⁩")).toBe("bidi esrever isolate");
    expect(tidyQuestion("⁠­\u{E0041}")).toEqual({ error: "empty" });
  });

  it("keeps at most three combining marks on a character", () => {
    const zalgo = tidy("z" + "́".repeat(130) + " zalgo");
    expect(zalgo).toBe("ź́́ zalgo");
    // Ordinary accents are untouched.
    expect(tidy("Am I Beyoncé? Phạm?")).toBe("Am I Beyoncé? Phạm?");
  });

  it("keeps the zero-width joiner inside an emoji sequence, and drops it anywhere else", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    const coder = "\u{1F469}\u{1F3FD}‍\u{1F4BB}";
    const flag = "\u{1F3F3}️‍\u{1F308}";
    expect(tidy(`Am I ${family}?`)).toBe(`Am I ${family}?`);
    expect(tidy(`Am I ${coder}?`)).toBe(`Am I ${coder}?`);
    expect(tidy(`Am I ${flag}?`)).toBe(`Am I ${flag}?`);
    expect(tidy("join‍ed")).toBe("joined");
    expect(tidy("\u{1F600}‍x")).toBe("\u{1F600}x");
  });
});

describe("the turn log", () => {
  it(`keeps only the latest ${LOG_KEPT} entries, in the state and in every view, however long a round runs`, () => {
    const t = new Table([0, 1], { turnFormat: "trade", questions: "app", timer: 60, hints: false }, 11);
    t.begin();
    for (let i = 0; i < 300; i++) {
      const g = t.guesser;
      t.do(g, { t: "ask", text: `Question number ${i}?` }, 11_000);
      t.do(t.judge, { t: "answer", id: t.turn.log.at(-1).id, answer: "no" });
      t.do(g, { t: "pass" });
    }
    const log = t.turn.log;
    expect(log).toHaveLength(LOG_KEPT);
    expect(log.at(-1).text).toBe("Question number 298?");
    for (const track of Object.values(t.state.round.tracks)) expect(track.log.length).toBeLessThanOrEqual(LOG_KEPT);
    for (const seat of [0, 1, -1]) expect(t.view(seat).turn.log).toHaveLength(LOG_KEPT);
    expect(JSON.stringify(t.state).length).toBeLessThan(40_000);
    expect(JSON.stringify(view(t.state, 0)).length).toBeLessThan(20_000);
    // The counter still counts every question.
    expect(t.turn.questionCount).toBe(99);
  });
});
