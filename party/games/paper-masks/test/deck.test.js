// Paper Masks: the question deck and answer tidying.
import { describe, expect, it } from "vitest";
import { PACKS, promptsForPage, QUESTIONS } from "../questions.js";
import { create } from "../rules.js";
import { ANSWER_MAX, matchKey, tidyAnswer } from "../text.js";
import { Table } from "./table.js";

describe("the question deck", () => {
  it("has at least 80 prompts, at least 50 family-safe, in the five packs", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(80);
    expect(QUESTIONS.filter((q) => q.family).length).toBeGreaterThanOrEqual(50);
    const packs = new Set(PACKS.map((p) => p.id));
    for (const q of QUESTIONS) expect(packs.has(q.pack), q.id).toBe(true);
    for (const p of PACKS) expect(QUESTIONS.filter((q) => q.pack === p.id).length).toBeGreaterThanOrEqual(12);
    for (const p of PACKS) expect(QUESTIONS.filter((q) => q.pack === p.id && q.family).length).toBeGreaterThanOrEqual(8);
    expect(QUESTIONS.filter((q) => q.best).length).toBe(10);
  });

  it("has unique ids and unique texts", () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    expect(new Set(QUESTIONS.map((q) => q.text.toLowerCase())).size).toBe(QUESTIONS.length);
  });

  it("every prompt fits a phone and has two different ghost answers that tidying leaves alone", () => {
    for (const q of QUESTIONS) {
      expect(typeof q.text).toBe("string");
      expect(q.text.length, q.id).toBeLessThanOrEqual(120);
      expect(typeof q.family).toBe("boolean");
      expect(q.ghosts.length, q.id).toBe(2);
      expect(matchKey(q.ghosts[0]), q.id).not.toBe(matchKey(q.ghosts[1]));
      for (const g of q.ghosts) {
        expect([...g].length, `${q.id}: ${g}`).toBeLessThanOrEqual(ANSWER_MAX);
        expect(tidyAnswer(g), `${q.id}: ${g}`).toEqual({ ok: true, text: g });
      }
    }
  });

  it("the page list carries no ghost answers", () => {
    for (const p of promptsForPage()) expect(Object.keys(p).sort()).toEqual(["best", "family", "id", "pack", "text"]);
  });

  it("never repeats a prompt within a match, even when the chosen pack runs out", () => {
    const t = new Table([0, 1, 2, 3, 4, 5, 6, 7], { rounds: "everyone", pack: "the-group", family: true }, 3);
    const seen = [];
    while (t.phase !== "over") {
      seen.push(t.r.prompt.id);
      t.playRound();
      t.do(t.state.host, { t: "nextRound" });
    }
    expect(seen.length).toBe(8);
    expect(new Set(seen).size).toBe(8);
    for (const id of seen) expect(QUESTIONS.find((q) => q.id === id).family).toBe(true);
  });

  it("deals the chosen pack first, then other prompts with the same family rule", () => {
    const s = create([0, 1, 2], { pack: "if-we", family: true }, 9);
    const inPack = QUESTIONS.filter((q) => q.pack === "if-we" && q.family).length;
    const first = s.deck.slice(0, inPack).map((id) => QUESTIONS.find((q) => q.id === id));
    expect(first.every((q) => q.pack === "if-we" && q.family)).toBe(true);
    expect(s.deck.map((id) => QUESTIONS.find((q) => q.id === id)).every((q) => q.family)).toBe(true);
    expect(new Set(s.deck).size).toBe(s.deck.length);
    const mixed = create([0, 1, 2], {}, 9);
    expect(mixed.deck.length).toBe(QUESTIONS.length);
  });
});

describe("tidying an answer", () => {
  const tidy = (s) => tidyAnswer(s).text;

  it.each([
    ["  hello   world  ", "Hello world"],
    ["line one\nline two\r\nthree", "Line one line two three"],
    ["tab\there", "Tab here"],
    ["pizza \u{1F355}\u{1F355}", "Pizza"],
    ["thumbs \u{1F44D}\u{1F3FD} up", "Thumbs up"],
    ["flag \u{1F1EC}\u{1F1E7}", "Flag"],
    ["keycap 1\u{FE0F}\u{20E3}", "Keycap 1"],
    ["I LOVE TOAST", "I love toast"],
    ["NASA rocks", "NASA rocks"],
    ["OK", "OK"],
    ["hello.", "Hello"],
    ["wait...", "Wait..."],
    ["3 eggs", "3 eggs"],
    ['"quoted" thing', '"Quoted" thing'],
    ["éclair", "Éclair"],
    ["éclair", "Éclair"],
    ["ź̂̃̄̅alg", "Ź̂̃alg"], // NFC makes z + acute one letter; two marks stay
    ["zero​width", "Zerowidth"],
    ["right‮left", "Rightleft"],
    ["nbsp space", "Nbsp space"],
    ["<b>bold</b> & 'quotes'", "<B>bold</b> & 'quotes'"], // kept as text: the page escapes, not the rules
    ["ctrl\u0007bell", "Ctrlbell"],
    ["50% off for £5", "50% off for £5"],
  ])("%j becomes %j", (input, output) => {
    expect(tidy(input)).toBe(output);
  });

  it("refuses what is not text, too long or empty", () => {
    expect(tidyAnswer(null)).toEqual({ ok: false, error: "not_text" });
    expect(tidyAnswer("x".repeat(81))).toEqual({ ok: false, error: "too_long" });
    expect(tidyAnswer("x".repeat(70) + "\u{1F600}".repeat(30))).toEqual({ ok: true, text: "X" + "x".repeat(69) });
    expect(tidyAnswer("...")).toEqual({ ok: false, error: "empty" });
    expect(tidyAnswer("\u{1F600}")).toEqual({ ok: false, error: "empty" });
    expect(tidyAnswer("\n\n\t")).toEqual({ ok: false, error: "empty" });
  });

  it("counts characters, not UTF-16 units", () => {
    expect(tidyAnswer("日".repeat(80)).ok).toBe(true);
    expect(tidyAnswer("\u{20000}".repeat(80)).ok).toBe(true);
    expect(tidyAnswer("\u{20000}".repeat(81)).ok).toBe(false);
  });

  it("tidying twice changes nothing", () => {
    for (const s of ["  HELLO there.", "a\nb", "pizza \u{1F355}", "...ok.", "x."]) {
      const once = tidy(s);
      expect(tidy(once)).toBe(once);
    }
  });

  it("finds identical answers ignoring case and punctuation", () => {
    expect(matchKey("Pizza, obviously!")).toBe(matchKey("pizza obviously"));
    expect(matchKey("Soup")).not.toBe(matchKey("Soap"));
    expect(matchKey("!!!")).toBe("!!!");
  });
});
