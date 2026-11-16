// The pure parts of the Hot Potato hearing test: normalising, the chain rule and the matcher,
// against the real shipped city list.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex, editDistance, followsChain, lastLetter, firstLetter, matchHeard, median, normalize, soundKey, spans } from "../public/logic.js";

const doc = JSON.parse(readFileSync(new URL("../public/cities.json", import.meta.url), "utf8"));
const index = buildIndex(doc);
const heard = (...transcripts) => transcripts.map((transcript, i) => ({ transcript, confidence: 0.9 - i * 0.1 }));

describe("normalising", () => {
  it("drops accents, case and punctuation and spells out short forms", () => {
    expect(normalize("São Paulo")).toBe("sao paulo");
    expect(normalize("  Zürich! ")).toBe("zurich");
    expect(normalize("St. Louis")).toBe("saint louis");
    expect(normalize("Xi’an")).toBe("xian");
    expect(normalize("Kraków")).toBe("krakow");
    expect(normalize("Łódź")).toBe("lodz");
    expect(normalize("Malmö & Göteborg")).toBe("malmo and goteborg");
    expect(normalize("Winston-Salem")).toBe("winston salem");
    expect(normalize("")).toBe("");
  });
});

describe("the chain rule", () => {
  it("reads first and last letters from letters only", () => {
    expect(lastLetter("New York")).toBe("k");
    expect(firstLetter("São Paulo")).toBe("s");
    expect(lastLetter("São Paulo")).toBe("o");
    expect(lastLetter("Xi’an")).toBe("n");
  });

  it("needs the next name to start with the previous one's last letter", () => {
    expect(followsChain("", "Anything")).toBe(true);
    expect(followsChain("Los Angeles", "Sydney")).toBe(true);
    expect(followsChain("Sydney", "York")).toBe(true);
    expect(followsChain("New York", "Kyoto")).toBe(true);
    expect(followsChain("New York", "Oslo")).toBe(false);
    expect(followsChain("São Paulo", "Oslo")).toBe(true);
  });
});

describe("the helpers", () => {
  it("measures edit distance and stops early", () => {
    expect(editDistance("rome", "roam")).toBe(2);
    expect(editDistance("sydney", "sidney")).toBe(1);
    expect(editDistance("abcdefgh", "zzzzzzzz", 2)).toBe(3);
  });

  it("gives sound-alikes one key", () => {
    expect(soundKey("roam")).toBe(soundKey("Rome"));
    expect(soundKey("burn")).toBe(soundKey("Bern"));
    expect(soundKey("Sidney")).toBe(soundKey("Sydney"));
    expect(soundKey("Filadelfia")).toBe(soundKey("Philadelphia").replace(/^p/, "f"));
  });

  it("lists word runs longest first", () => {
    expect(spans("uh Sydney please", 2)).toEqual(["uh sydney", "sydney please", "uh", "sydney", "please"]);
  });

  it("takes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([null, undefined])).toBe(null);
  });
});

describe("the matcher", () => {
  it("finds an exact name and prefers the biggest city", () => {
    const m = matchHeard(index, heard("Sydney"), { required: "s" });
    expect(m).toMatchObject({ ok: true, kind: "exact", said: "Sydney" });
    expect(m.place.country).toBe("AU");
  });

  it("plays an alias by the name that was said, so New York ends in K", () => {
    const m = matchHeard(index, heard("New York"), { required: "n" });
    expect(m).toMatchObject({ ok: true, kind: "exact", said: "New York" });
    expect(m.place.name).toBe("New York City");
    expect(lastLetter(m.said)).toBe("k");
  });

  it("plays an abbreviation as the main name", () => {
    const m = matchHeard(index, heard("NYC"), { required: "n" });
    expect(m).toMatchObject({ ok: true, said: "New York City" });
  });

  it("matches accents and filler words", () => {
    expect(matchHeard(index, heard("Sao Paulo"), { required: "s" })).toMatchObject({ ok: true, kind: "exact" });
    expect(matchHeard(index, heard("um I say Sydney"), { required: "s" })).toMatchObject({ ok: true, said: "Sydney" });
    expect(matchHeard(index, heard("Los Angeles"), {})).toMatchObject({ ok: true, said: "Los Angeles" });
  });

  it("uses a later alternative when the first guess does not fit", () => {
    const m = matchHeard(index, heard("roam", "Rome"), { required: "r" });
    expect(m).toMatchObject({ ok: true, kind: "alternative", said: "Rome", alternative: 1 });
    expect(m.place.country).toBe("IT");
  });

  it("forgives a mishearing by sound, among names with the required letter", () => {
    expect(matchHeard(index, heard("roam"), { required: "r" })).toMatchObject({ ok: true, kind: "sound-alike", said: "Rome" });
    expect(matchHeard(index, heard("burn"), { required: "b" })).toMatchObject({ ok: true, kind: "sound-alike", said: "Bern" });
    expect(matchHeard(index, heard("Sidnee"), { required: "s" })).toMatchObject({ ok: true, kind: "sound-alike", said: "Sydney" });
    expect(matchHeard(index, heard("Lundun"), { required: "l" })).toMatchObject({ ok: true, kind: "sound-alike", said: "London" });
  });

  it("does not stretch a short or unrelated word into a small town", () => {
    expect(matchHeard(index, heard("the dog"), { required: "t" })).toMatchObject({ ok: false, reason: "not-a-city" });
  });

  it("refuses a city with the wrong letter, a repeat, an echo and a non-city", () => {
    expect(matchHeard(index, heard("Oslo"), { required: "k" })).toMatchObject({ ok: false, reason: "wrong-letter" });
    const sydney = matchHeard(index, heard("Sydney"), { required: "s" }).place.id;
    // Saying Sydney again is a repeat, though Sydney in Canada is another place.
    expect(matchHeard(index, heard("Sydney"), { required: "s", used: new Set([sydney]), usedNames: new Set(["sydney"]) })).toMatchObject({ ok: false, reason: "used" });
    // A place played by another of its names is a repeat too: New York, then NYC.
    const ny = matchHeard(index, heard("New York"), { required: "n" }).place.id;
    expect(matchHeard(index, heard("NYC"), { required: "n", used: new Set([ny]), usedNames: new Set(["new york"]) })).toMatchObject({ ok: false, reason: "used" });
    expect(matchHeard(index, heard("Los Angeles"), { required: "l", previous: "Los Angeles" })).toMatchObject({ ok: false, reason: "echo" });
    expect(matchHeard(index, heard("xylophone quartet"), { required: "x" })).toMatchObject({ ok: false, reason: "not-a-city" });
    expect(matchHeard(index, [], {})).toMatchObject({ ok: false, reason: "not-a-city" });
  });
});
