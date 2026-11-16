// The categories other than cities (countries, animals, food and drink, any word) through the
// one matcher, against the real shipped lists: plurals, the ordinary-word rule rethought, the
// dead-end letters, and copied reports of every version read back.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_IDS } from "../../../one-device/hot-potato/shared/categories.js";
import { DEAD_END_BELOW, buildIndex, deadLetters, earlyMatch, entriesLeft, matchHeard, nextLetter, singulars } from "../../../one-device/hot-potato/shared/logic.js";
import { parseReport } from "./report.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../../one-device/hot-potato/shared/${name}`, import.meta.url), "utf8"));
const words = load("words.json");
const index = Object.fromEntries(CATEGORY_IDS.map((id) => [id, buildIndex(load(CATEGORIES[id].file), words, CATEGORIES[id])]));
const heard = (...transcripts) => transcripts.map((transcript, i) => ({ transcript, confidence: 0.9 - i * 0.1 }));
const match = (id, text, opts) => matchHeard(index[id], heard(text), opts);
const said = (id, text, opts) => {
  const m = match(id, text, opts);
  return m.ok ? m.said : `no: ${m.reason}`;
};

describe("the lists", () => {
  it("has every category's data, with a sensible size", () => {
    expect(CATEGORY_IDS).toEqual(["cities", "countries", "animals", "food", "anything"]);
    expect(index.countries.knownCount).toBeGreaterThan(250);
    expect(index.animals.knownCount).toBeGreaterThan(400);
    expect(index.animals.places.length).toBeGreaterThan(3000);
    expect(index.food.knownCount).toBeGreaterThan(450);
    expect(index.food.places.length).toBeGreaterThan(2000);
    expect(index.anything.knownCount).toBeGreaterThan(29000);
  });

  it("keeps the common animals, foods and drinks in the default list", () => {
    const common = {
      animals: ["dog", "cat", "lion", "tiger", "elephant", "giraffe", "zebra", "monkey", "penguin", "dolphin", "whale", "shark", "octopus", "spider", "butterfly", "seal", "kangaroo", "koala", "sloth", "meerkat", "polar bear", "guinea pig", "killer whale", "Komodo dragon", "lamb", "kitten", "caterpillar"],
      food: ["apple", "banana", "tomato", "potato", "carrot", "bread", "cheese", "pizza", "sushi", "taco", "curry", "chocolate", "honey", "coffee", "tea", "beer", "wine", "water", "lemonade", "ice cream", "hot dog", "iced tea", "peanut butter", "olive", "date", "lime", "mushroom", "nut"],
      countries: ["France", "Japan", "Brazil", "Kenya", "Peru", "Holland", "Burma", "Czech Republic", "England", "Scotland", "Wales", "Northern Ireland", "America", "USA", "UK", "Ivory Coast"],
    };
    for (const [id, list] of Object.entries(common)) {
      for (const name of list) expect(`${id}: ${name} ${match(id, name).ok}`).toBe(`${id}: ${name} true`);
    }
  });

  it("names what was matched: the entry, and its group or continent", () => {
    const puma = match("animals", "puma");
    expect([puma.said, puma.place.name, puma.place.group]).toEqual(["puma", "cougar", "mammal"]);
    const holland = match("countries", "Holland");
    expect([holland.said, holland.place.name, holland.place.group]).toEqual(["Holland", "The Netherlands", "Europe"]);
    expect(match("food", "iced tea").place.group).toBe("drink");
    // A name that fits two entries takes the bigger one and names the other.
    const congo = match("countries", "Congo");
    expect(congo.place.name).toBe("Democratic Republic of the Congo");
    expect(congo.others.map((p) => p.name)).toEqual(["Republic of the Congo"]);
  });

  it("gives a name WordNet uses for two animals to the one people mean", () => {
    expect(match("animals", "dolphin").place.group).toBe("mammal");
    expect(match("animals", "peacock").place.group).toBe("bird");
    expect(match("animals", "swift").place.group).toBe("bird");
  });

  it("leaves rare entries to hard mode, and other meanings of a word out", () => {
    expect(match("animals", "axolotl").reason).toBe("hard-only");
    expect(match("animals", "axolotl", { hard: true }).ok).toBe(true);
    expect(match("animals", "queen").ok).toBe(false); // WordNet's queen bee or cat: dropped by hand
    expect(match("animals", "queen", { hard: true }).ok).toBe(false);
    expect(match("food", "frank").ok).toBe(false);
    expect(match("food", "dinner").ok).toBe(false); // a meal, not a thing to eat
    expect(match("countries", "West Germany").ok).toBe(false);
  });
});

describe("the ordinary-word rule, per category", () => {
  it("never refuses an animal, a food or a word for being an ordinary word", () => {
    expect(said("animals", "salmon")).toBe("salmon");
    expect(said("animals", "bat")).toBe("bat");
    expect(said("food", "orange")).toBe("orange");
    expect(said("anything", "hello")).toBe("hello");
    expect(said("anything", "xylophone")).toBe("xylophone");
  });

  it("still refuses an ordinary word or a name that is not on the list, saying which", () => {
    expect(match("animals", "hello").reason).toBe("word");
    expect(match("food", "table").reason).toBe("word");
    expect(match("countries", "banana").reason).toBe("word");
    expect(match("animals", "Ralph").reason).toBe("name");
    expect(match("anything", "Ralph").reason).toBe("name");
    // In "Anything" a phrase is not one word.
    expect(match("anything", "hear it").ok).toBe(false);
  });

  it("keeps the whole-phrase rule: a longer phrase is not the entry inside it", () => {
    expect(said("animals", "sea lion")).toBe("sea lion");
    expect(match("animals", "lion king").ok).toBe(false);
    expect(match("food", "apple tree").ok).toBe(false);
  });

  it("never stretches an ordinary word into another animal by sound", () => {
    // "bare" is a word, so it is not mended into bear; "hors" is no word, but horse is one too.
    expect(match("animals", "bare").ok).toBe(false);
    expect(match("animals", "hors").ok).toBe(false);
  });

  it("answers early only on a name no longer name starts with, word or not", () => {
    expect(earlyMatch(index.animals, ["zebra"]).ok).toBe(true);
    expect(earlyMatch(index.animals, ["cat"]).why).toBe("a longer animal name starts with it"); // catfish
    expect(earlyMatch(index.animals, ["lions"]).ok).toBe(false); // a plural waits for the final result
    // Cities keep the m2 rule: never early on a city named after a word.
    expect(earlyMatch(index.cities, ["Nice"]).ok).toBe(false);
  });
});

describe("plurals", () => {
  it("lists the singular forms a plural could be, most likely first", () => {
    expect(singulars("lions")).toEqual(["lion"]);
    expect(singulars("tomatoes")).toEqual(["tomatoe", "tomato"]);
    expect(singulars("berries")).toEqual(["berrie", "berri", "berry"]);
    expect(singulars("wolves")).toEqual(["wolve", "wolv", "wolf", "wolfe"]);
    expect(singulars("mice")).toEqual(["mouse"]);
    expect(singulars("polar bears")).toEqual(["polar bear"]);
    expect(singulars("glass")).toEqual([]);
    expect(singulars("bus")).toEqual([]);
  });

  it("hears a plural as its entry, and the chain goes on from the entry", () => {
    for (const [id, plural, one] of [
      ["animals", "lions", "lion"],
      ["animals", "wolves", "wolf"],
      ["animals", "mice", "mouse"],
      ["animals", "geese", "goose"],
      ["animals", "butterflies", "butterfly"],
      ["animals", "polar bears", "polar bear"],
      ["food", "tomatoes", "tomato"],
      ["food", "cookies", "cookie"],
      ["food", "peaches", "peach"],
      ["food", "loaves", "loaf"],
      ["food", "hot dogs", "hot dog"],
      ["food", "nuts", "nut"],
    ]) {
      const m = match(id, plural);
      expect(`${plural}: ${m.ok} ${m.said} ${m.plural}`).toBe(`${plural}: true ${one} true`);
    }
    expect(nextLetter(index.food, match("food", "tomatoes").said).letter).toBe("o");
  });

  it("takes a plural only where the category allows it", () => {
    expect(match("countries", "Cubas").ok).toBe(false);
    expect(matchHeard(index.cities, heard("Sydneys")).ok).toBe(false);
  });

  it("counts a plural of a name already said as a repeat", () => {
    const m = matchHeard(index.animals, heard("lions"), { usedNames: new Set(["lion"]), used: new Set([match("animals", "lion").place.id]) });
    expect(m.reason).toBe("used");
  });
});

describe("dead ends", () => {
  it("finds the letters few entries start with, per category", () => {
    expect(DEAD_END_BELOW).toBe(3);
    expect(deadLetters(index.cities)).toEqual([]);
    expect(deadLetters(index.countries)).toEqual(["o", "q", "x", "y", "z"]);
    expect(deadLetters(index.animals)).toEqual(["u", "x", "y", "z"]);
    expect(deadLetters(index.food)).toEqual(["u", "x", "z"]);
    expect(deadLetters(index.anything)).toEqual(["x"]);
    // Hard mode has more entries, so fewer dead ends.
    expect(deadLetters(index.animals, true)).toEqual(["x"]);
  });

  it("goes on from the letter before a dead end", () => {
    expect(nextLetter(index.animals, "monkey")).toEqual({ letter: "e", skipped: ["y"] });
    expect(nextLetter(index.animals, "fox")).toEqual({ letter: "o", skipped: ["x"] });
    expect(nextLetter(index.countries, "Mexico")).toEqual({ letter: "c", skipped: ["o"] });
    expect(nextLetter(index.countries, "Iraq")).toEqual({ letter: "a", skipped: ["q"] });
    expect(nextLetter(index.cities, "Oslo")).toEqual({ letter: "o", skipped: [] });
    expect(nextLetter(index.animals, "lion")).toEqual({ letter: "n", skipped: [] });
  });

  it("counts only entries not yet said, so a letter can run out during a game", () => {
    const qs = [...index.animals.startIds.known.get("q")];
    expect(entriesLeft(index.animals, "q")).toBe(qs.length);
    expect(qs.length).toBeGreaterThanOrEqual(DEAD_END_BELOW);
    const used = new Set(qs.slice(0, qs.length - DEAD_END_BELOW + 1));
    expect(nextLetter(index.animals, "iraq", { used }).letter).toBe("a");
  });
});

describe("copied reports of every version", () => {
  const v2 = [
    "Hot Potato hearing test, v2 (matching rules m2)",
    '#1 m2 known t1 snd:on tap final en-US need:- | 5 20 60 640 260 760 760 780 | RIGHT exact Los Angeles US (heard "los angeles", by final) | Los Angeles=0.93 / Los Angeles California=0.41 | n-interim:2',
    '#2 m2 hard t1 snd:on tap final en-US need:s | 5 20 60 640 260 - 760 780 | WRONG word (heard "salmon", by final) | salmon=0.48 / Salman=0.48 | APPEAL:real-city n-interim:1',
  ].join("\n");
  const v3 = [
    "Hot Potato hearing test, v3 (matching rules m3)",
    '#1 m3 animals known t1 snd:on tap final en-US need:- | 5 20 60 640 260 760 760 780 | RIGHT exact-plural lion mammal (heard "lions", by final) | lions=0.91 | n-interim:1',
    '#2 m3 countries known t1 snd:on tap final en-US need:o | 5 20 60 640 260 - 760 780 | RIGHT exact Mexico North-America (heard "mexico", by final) | Mexico=0.9 | dead-end:o>c n-interim:1',
  ].join("\n");

  it("reads v2 turns as cities and v3 turns with their category", () => {
    const a = parseReport(v2);
    expect(a.map((t) => [t.category, t.hard, t.need])).toEqual([["cities", false, ""], ["cities", true, "s"]]);
    expect(a[0].alternatives[0]).toEqual({ transcript: "Los Angeles", confidence: 0.93 });
    const b = parseReport(v3);
    expect(b.map((t) => [t.category, t.need])).toEqual([["animals", ""], ["countries", "o"]]);
  });

  it("replays a v3 turn against its own category", () => {
    const [t] = parseReport(v3);
    const m = matchHeard(index[t.category], t.alternatives, { required: t.need });
    expect([m.ok, m.said, m.plural]).toEqual([true, "lion", true]);
  });
});
