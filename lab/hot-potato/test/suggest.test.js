// Suggestions on the hearing test (shared/suggest.js), against the real shipped lists: every one
// is a right answer for the letter and the category, from the well-known list only, never one
// already said, and "more" pages through others.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_IDS } from "../../../one-device/hot-potato/shared/categories.js";
import { buildIndex, firstLetter, matchHeard, nextLetter, normalize } from "../../../one-device/hot-potato/shared/logic.js";
import { FAMOUS_CITIES, SKIP_NAMES, SKIP_WORDS, SUGGESTION_COUNT, suggestible, suggestions } from "../../../one-device/hot-potato/shared/suggest.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../../one-device/hot-potato/shared/${name}`, import.meta.url), "utf8"));
const words = load("words.json");
const index = Object.fromEntries(CATEGORY_IDS.map((id) => [id, buildIndex(load(CATEGORIES[id].file), words, CATEGORIES[id])]));
const ABC = [..."abcdefghijklmnopqrstuvwxyz"];
const names = (list) => list.map((s) => s.name);

describe("suggestions", () => {
  it("are right answers for the letter, in every category, from the well-known list only", () => {
    for (const id of CATEGORY_IDS) {
      for (const letter of ["", ...ABC]) {
        for (const page of [0, 1, 2]) {
          for (const s of suggestions(index[id], { letter, page })) {
            const where = `${id} ${letter || "any"} page ${page}: ${s.name}`;
            if (letter) expect(firstLetter(s.name), where).toBe(letter);
            expect(index[id].places[s.id].known, where).toBe(true);
            // Said as shown, it is taken, on the default (well-known) list, as that entry.
            const m = matchHeard(index[id], [{ transcript: s.name, confidence: 0.9 }], { required: letter });
            expect([m.ok, m.place?.id], where).toEqual([true, s.id]);
          }
        }
      }
    }
  });

  it("shows three or four, famous first, and a few for the first turn of different letters", () => {
    expect(SUGGESTION_COUNT).toBe(4);
    expect(names(suggestions(index.cities, { letter: "t" }))).toEqual(["Tokyo", "Toronto", "Tampa", "Tucson"]);
    expect(names(suggestions(index.cities, { letter: "l" }))).toEqual(["London", "Los Angeles", "Lisbon", "Las Vegas"]);
    const first = names(suggestions(index.cities));
    expect(first).toHaveLength(4);
    expect(new Set(first.map((n) => firstLetter(n))).size).toBe(4);
    expect(names(suggestions(index.animals, { letter: "l" }))).toContain("lion");
    for (const id of CATEGORY_IDS) {
      for (const letter of ABC) {
        const n = suggestions(index[id], { letter }).length;
        // Fewer only when the list has fewer for that letter (dead ends such as X).
        if (n < 3) expect(index[id].startIds.known.get(letter)?.size ?? 0, `${id} ${letter}`).toBeLessThan(6);
      }
    }
  });

  it("never suggests an entry or a name already said", () => {
    const tokyo = index.cities.places.find((p) => p.name === "Tokyo").id;
    const s = suggestions(index.cities, { letter: "t", used: new Set([tokyo]), usedNames: new Set(["toronto"]) });
    expect(names(s)).not.toContain("Tokyo");
    expect(names(s)).not.toContain("Toronto");
    expect(s).toHaveLength(4);
    // A whole game of saying the first suggestion each time never repeats one.
    const used = new Set();
    const usedNames = new Set();
    let letter = "";
    for (let i = 0; i < 40; i++) {
      const [first] = suggestions(index.animals, { letter, used, usedNames });
      if (!first) break;
      expect(used.has(first.id)).toBe(false);
      used.add(first.id);
      usedNames.add(normalize(first.name));
      letter = nextLetter(index.animals, first.name, { used }).letter;
    }
    expect(used.size).toBe(40);
  });

  it("never suggests a lesser-known entry, even where the wider list has many", () => {
    for (const id of ["cities", "animals", "food"]) {
      for (const letter of ABC) {
        for (const page of [0, 1, 2, 3]) {
          for (const s of suggestions(index[id], { letter, page })) expect(index[id].places[s.id].known, `${id} ${s.name}`).toBe(true);
        }
      }
    }
    expect(names(suggestions(index.animals, { letter: "a", page: 3 }))).not.toContain("axolotl");
  });

  it("shows others on 'more', then goes round", () => {
    const a = names(suggestions(index.cities, { letter: "b", page: 0 }));
    const b = names(suggestions(index.cities, { letter: "b", page: 1 }));
    expect(b.some((n) => a.includes(n))).toBe(false);
    expect(names(suggestions(index.cities, { letter: "b", page: 4 }))).toEqual(a);
    // Only one well-known Y animal: "more" has nothing else to show.
    expect(names(suggestions(index.animals, { letter: "y", page: 1 }))).toEqual(["yak"]);
  });

  it("never suggests a word on the skip list, for any letter, category or page, or deeper into a game", () => {
    const skipped = (name) => SKIP_NAMES.has(normalize(name)) || normalize(name).split(" ").some((w) => SKIP_WORDS.has(w));
    for (const id of CATEGORY_IDS) {
      for (const letter of ["", ...ABC]) {
        // The first 16 for the letter, then the next 16 once those are said.
        const first = [0, 1, 2, 3].flatMap((page) => suggestions(index[id], { letter, page }));
        const used = new Set(first.map((s) => s.id));
        const later = [0, 1, 2, 3].flatMap((page) => suggestions(index[id], { letter, page, used }));
        for (const s of [...first, ...later]) expect(skipped(s.name), `${id} ${letter || "any"}: ${s.name}`).toBe(false);
      }
    }
    expect(names(suggestions(index.animals, { letter: "a" }))).not.toContain("ass");
    expect(names(suggestions(index.animals))).toEqual(["dog", "horse", "fish", "cat"]);
  });

  it("still takes a skipped word as an answer: the skip list is for suggestions only", () => {
    expect(suggestible("ass")).toBe(false);
    expect(suggestible("blue tit")).toBe(false);
    expect(suggestible("cocktail")).toBe(true);
    expect(matchHeard(index.animals, [{ transcript: "ass", confidence: 0.9 }])).toMatchObject({ ok: true, said: "ass" });
    expect(matchHeard(index.food, [{ transcript: "date", confidence: 0.9 }])).toMatchObject({ ok: true, said: "date" });
  });

  it("skips very short words in Anything", () => {
    for (const s of suggestions(index.anything, { letter: "t" })) expect(s.name.length).toBeGreaterThanOrEqual(4);
  });

  it("has every hand-listed famous city on the well-known list", () => {
    for (const name of FAMOUS_CITIES) {
      const found = (index.cities.byKey.get(normalize(name)) ?? []).filter((e) => index.cities.places[e.id].known);
      expect(found.length, name).toBeGreaterThan(0);
    }
  });
});
