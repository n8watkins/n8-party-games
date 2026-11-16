// The pure parts of the Hot Potato hearing test: normalising, the chain rule and the matcher,
// against the real shipped city and word lists, and the owner's first real run (fixtures/).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RULES_VERSION,
  buildIndex,
  earlyMatch,
  editDistance,
  firstLetter,
  followsChain,
  lastLetter,
  longerNameStartsWith,
  matchHeard,
  median,
  normalize,
  soundKey,
  trimFillers,
  usableAlternatives,
} from "../../../one-device/hot-potato/shared/logic.js";
import { parseReport } from "./report.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../../one-device/hot-potato/shared/${name}`, import.meta.url), "utf8"));
const index = buildIndex(load("cities.json"), load("words.json"));
const heard = (...transcripts) => transcripts.map((transcript, i) => ({ transcript, confidence: 0.9 - i * 0.1 }));
const fixture = parseReport(readFileSync(new URL("./fixtures/hearing-report-1.txt", import.meta.url), "utf8"));
const turn = (n) => fixture.find((t) => t.n === n);
const replay = (n, opts = {}) => matchHeard(index, turn(n).alternatives, { required: turn(n).need, ...opts });

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

  it("drops filler words from the ends, but never the whole phrase", () => {
    expect(trimFillers("um how about Sydney")).toBe("sydney");
    expect(trimFillers("I'll say Oslo please")).toBe("oslo");
    expect(trimFillers("the city of Bath")).toBe("bath");
    expect(trimFillers("how about")).toBe("how about");
    expect(trimFillers("Sydney uh")).toBe("sydney uh");
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
    expect(editDistance("dehli", "delhi")).toBe(1);
    expect(editDistance("abcdefgh", "zzzzzzzz", 2)).toBe(3);
  });

  it("gives the same consonant skeleton to spellings of one sound, and different ones to different words", () => {
    expect(soundKey("Sidnee")).toBe(soundKey("Sydney"));
    expect(soundKey("Lundun")).toBe(soundKey("London"));
    expect(soundKey("roam")).toBe(soundKey("Rome"));
    expect(soundKey("salmon")).not.toBe(soundKey("Salmas"));
    expect(soundKey("Rodger")).not.toBe(soundKey("Rogers"));
  });

  it("knows when a longer name starts with a heard one", () => {
    expect(longerNameStartsWith(index, "edmond", true)).toBe(true);
    expect(longerNameStartsWith(index, "dar")).toBe(true);
    expect(longerNameStartsWith(index, "oslo")).toBe(false);
  });

  it("takes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([null, undefined])).toBe(null);
  });
});

describe("which of the recogniser's guesses count", () => {
  const keys = (alts) => usableAlternatives(alts).map((a) => a.key);

  it("keeps guesses at least half as sure as the best, best first", () => {
    // Turn 13: Halbert 0.81, halibut 0.72, Albert 0.51 count; "how" at 0.10 does not.
    expect(keys(turn(13).alternatives)).toEqual(["halbert", "halibut", "albert"]);
    // Turn 10: Derby at 0.44 beside Darby at 0.77 counts.
    expect(keys(turn(10).alternatives)).toContain("derby");
  });

  it("drops a different word the recogniser was barely sure of (turn 19: Rogers 0.02 beside Rodger 0.67)", () => {
    expect(keys(turn(19).alternatives)).toEqual(["rodger", "rajar", "roger"]);
  });

  it("keeps a low-rated spelling that sounds the same as a counted guess", () => {
    expect(keys([{ transcript: "Sidnee", confidence: 0.8 }, { transcript: "Sydney", confidence: 0.05 }])).toEqual(["sidnee", "sydney"]);
  });

  it("takes only the first guess (and its same-sounding spellings) when there are no confidences", () => {
    expect(keys([{ transcript: "Oslo", confidence: 0 }, { transcript: "Hello", confidence: 0 }])).toEqual(["oslo"]);
  });
});

describe("the two lists", () => {
  const known = (name, cc) => index.places.some((p) => p.known && p.country === cc && [p.name, normalize(p.name)].includes(name));

  it("keeps capitals, state capitals, big cities and the hand list in the default list", () => {
    expect(index.knownCount).toBeGreaterThan(5000);
    expect(index.knownCount).toBeLessThan(7000);
    expect(index.places.length).toBeGreaterThan(31000);
    expect(known("Bern", "CH")).toBe(true); // capital
    expect(known("Juneau", "US")).toBe(true); // state capital, 32,000 people
    expect(known("Montpelier", "US")).toBe(true); // state capital under 15,000, from the hand list
    expect(known("Venice", "IT")).toBe(true); // hand list, 51,000
    expect(known("Bath", "GB")).toBe(true);
  });

  it("leaves small places, and middling places named after ordinary words, to hard mode", () => {
    expect(known("Edmond", "US")).toBe(false);
    expect(known("Orange", "US")).toBe(false);
    expect(known("Surprise", "US")).toBe(false);
    expect(known("Salmās", "IR")).toBe(false);
    expect(known("Rogers", "US")).toBe(false);
  });
});

describe("the owner's first run (fixtures/hearing-report-1.txt), replayed", () => {
  it("reads all 20 turns", () => {
    expect(fixture).toHaveLength(20);
    expect(fixture.filter((t) => t.verdict === "NONE").map((t) => t.n)).toEqual([15, 18]);
  });

  it("refuses the five loose sound-alikes, saying why", () => {
    for (const [n, kind, word] of [[1, "word", "hello"], [2, "word", "apple"], [11, "word", "ratchet"], [14, "word", "hear it"], [20, "word", "salmon"]]) {
      const m = replay(n);
      expect(m, `turn ${n}`).toMatchObject({ ok: false, reason: kind, heard: word });
      expect(matchHeard(index, turn(n).alternatives, { required: turn(n).need, hard: true }), `turn ${n}, hard mode`).toMatchObject({ ok: false });
    }
  });

  it("refuses the names and words he tried", () => {
    expect(replay(3)).toMatchObject({ ok: false, reason: "word", heard: "dog" });
    expect(replay(4)).toMatchObject({ ok: false, reason: "word", heard: "meteor" });
    expect(replay(5)).toMatchObject({ ok: false });
    expect(replay(7)).toMatchObject({ ok: false, reason: "name", heard: "edgar" });
    expect(replay(8)).toMatchObject({ ok: false, reason: "word" });
    expect(replay(12)).toMatchObject({ ok: false, reason: "name" });
    expect(replay(13)).toMatchObject({ ok: false });
    expect(replay(16)).toMatchObject({ ok: false });
    expect(replay(17)).toMatchObject({ ok: false, reason: "name", heard: "ralph" });
  });

  it("does not take Leopold as Léo: the whole phrase decides", () => {
    expect(replay(5)).toMatchObject({ ok: false });
    expect(replay(5, { hard: true })).toMatchObject({ ok: false });
  });

  it("refuses 'orange' in the default list (a middling city named after a word) and takes it in hard mode, naming the bigger one", () => {
    const m = replay(6);
    expect(m).toMatchObject({ ok: false, reason: "hard-only", said: "Orange" });
    expect(m.place.country).toBe("US");
    const h = replay(6, { hard: true });
    expect(h).toMatchObject({ ok: true, kind: "exact", said: "Orange" });
    expect(h.place.region).toBe("California");
    expect(h.place.country).toBe("US");
    expect(h.others.map((p) => p.country)).toContain("AU");
  });

  it("takes Edmonton as Edmonton, not Edmond", () => {
    const m = replay(9);
    expect(m).toMatchObject({ ok: true, kind: "exact", said: "Edmonton" });
    expect(m.place.country).toBe("CA");
  });

  it("takes Darby as Derby from the recogniser's own guess (0.44 beside 0.77), not Dar", () => {
    const m = replay(10);
    expect(m).toMatchObject({ ok: true, kind: "alternative", said: "Derby" });
    expect(m.place.country).toBe("GB");
  });

  it("refuses Rodger: a name, and Rogers at 0.02 is not a believable guess (nor a well-known city)", () => {
    expect(replay(19)).toMatchObject({ ok: false, reason: "name", heard: "rodger" });
    expect(replay(19, { hard: true })).toMatchObject({ ok: false, reason: "name" });
  });

  it("would not have answered any of the seven interims early, where v1 answered all seven and five differed from the final", () => {
    const interims = fixture.filter((t) => t.interim);
    expect(interims.map((t) => t.interim)).toEqual(["hello", "leo", "orange", "edmond", "dar", "ratch", "hear"]);
    expect(interims.filter((t) => /final-differs/.test(t.verdictText))).toHaveLength(5);
    for (const t of interims) expect(earlyMatch(index, [t.interim], { required: t.need }).ok, t.interim).toBe(false);
  });

  it("accepts exactly two of the 20 turns, against ten in v1", () => {
    const v1 = fixture.filter((t) => t.verdict === "RIGHT").length;
    const v2 = fixture.filter((t) => t.alternatives.length && replay(t.n).ok).map((t) => t.n);
    expect(v1).toBe(10);
    expect(v2).toEqual([9, 10]);
  });
});

// About 60 cities a casual player would say, with an exact recogniser spelling and, where the
// name is not an ordinary word, a plausible one-letter (or vowel) slip.
const CITIES = [
  ["Oslo", "Osllo"], ["Bern", "Berne"], ["Reno", "Rheno"], ["Nice"], ["Bath"], ["Cork"], ["Venice", "Venise"],
  ["Geneva", "Geneeva"], ["Salem", "Saleem"], ["Reykjavik", "Reykjavick"], ["Paris", "Pariz"], ["London", "Lundun"],
  ["Sydney", "Sidnee"], ["Tokyo", "Tokio"], ["Berlin", "Berlinn"], ["Madrid", "Madridd"], ["Rome", "Romee"],
  ["Lisbon", "Lisben"], ["Dublin", "Dubblin"], ["Prague"], ["Vienna", "Viena"], ["Budapest", "Budapesht"],
  ["Warsaw", "Warsau"], ["Moscow", "Moskow"], ["Cairo"], ["Nairobi", "Nairoby"], ["Lagos", "Laggos"],
  ["Mumbai", "Mumbay"], ["Delhi", "Dehli"], ["Beijing", "Beijeng"], ["Shanghai"], ["Seoul"],
  ["Bangkok", "Bangkock"], ["Hanoi", "Hannoi"], ["Manila", "Manilla"], ["Jakarta", "Jakkarta"], ["Toronto", "Torronto"],
  ["Chicago", "Chicaggo"], ["Houston", "Houstan"], ["Denver", "Denvor"], ["Boston", "Bostin"], ["Seattle", "Seatle"],
  ["Miami", "Miammi"], ["Atlanta", "Atlantta"], ["Dallas", "Dalas"], ["Phoenix"], ["Edmonton", "Edmontin"],
  ["Vancouver", "Vancuver"], ["Montreal", "Montreel"], ["Havana", "Havanna"], ["Lima", "Limma"], ["Bogota", "Bogata"],
  ["Santiago", "Santiaggo"], ["Buenos Aires"], ["Rio de Janeiro"], ["Auckland", "Aukland"], ["Perth", "Perrth"],
  ["Kyoto", "Kioto"], ["Istanbul", "Istanbool"], ["Athens", "Athenns"], ["Florence", "Florrence"], ["Oxford"], ["York"],
  ["Mobile"], ["Reading"], ["Derby"], ["Juneau"], ["Cairns"], ["Split"],
];

describe("what sound-alike will not mend (on purpose)", () => {
  it("refuses a slip that is itself a name or a word, or changes the first letter", () => {
    expect(matchHeard(index, heard("Parris"), { required: "p" })).toMatchObject({ ok: false, reason: "name" });
    expect(matchHeard(index, heard("Huston"), { required: "h" })).toMatchObject({ ok: false, reason: "name" });
    expect(matchHeard(index, heard("Kairo"), { required: "c" })).toMatchObject({ ok: false });
    // "shanghai" is also a verb, so Shanghai is taken only when heard exactly.
    expect(matchHeard(index, heard("Shanghi"), { required: "s" })).toMatchObject({ ok: false });
  });
});

describe("about 60 well-known cities", () => {
  it(`has ${CITIES.length} cities to try`, () => expect(CITIES.length).toBeGreaterThanOrEqual(60));

  for (const [name, slip] of CITIES) {
    it(`takes "${name}" heard exactly${slip ? `, and the slip "${slip}"` : ""}`, () => {
      const m = matchHeard(index, heard(name), { required: firstLetter(name) });
      expect(m, name).toMatchObject({ ok: true, kind: "exact" });
      expect(m.place.known).toBe(true);
      if (!slip) return;
      const s = matchHeard(index, heard(slip), { required: firstLetter(name) });
      expect(s, slip).toMatchObject({ ok: true });
      expect(normalize(s.place.name) === normalize(m.place.name) || s.place.id === m.place.id, `${slip} -> ${s.said}`).toBe(true);
    });
  }

  it("takes a name of a city heard among later guesses", () => {
    expect(matchHeard(index, heard("roam", "Rome"), { required: "r" })).toMatchObject({ ok: true, kind: "alternative", said: "Rome" });
  });

  it("never stretches a city named after a word by sound", () => {
    expect(matchHeard(index, heard("Neece"), { required: "n" })).toMatchObject({ ok: false });
    expect(matchHeard(index, heard("Baath"), { required: "b" })).toMatchObject({ ok: false });
  });
});

// 100 ordinary words and common first names a player might say by mistake, or that the
// recogniser might hear in a noisy room. None may be taken as a city in the default list.
const NOT_CITIES = [
  "hello", "apple", "salmon", "ratchet", "dog", "meteor", "elementary", "table", "window", "garden", "pencil", "orange",
  "banana", "rocket", "silver", "yellow", "tomato", "monkey", "kitchen", "blanket", "summer", "winter", "shadow",
  "basket", "button", "candle", "dinner", "engine", "forest", "guitar", "hammer", "island", "jacket", "ladder",
  "marble", "needle", "pepper", "rabbit", "saddle", "turtle", "velvet", "wallet", "pillow", "puzzle", "carrot",
  "potato", "letter", "bottle", "mirror", "number", "teacher", "doctor", "flower", "castle", "dragon", "parrot",
  "halibut", "computer", "elephant", "umbrella", "Michael", "Jennifer", "Ralph", "Edgar", "Rodger", "Harrington",
  "Leopold", "Albert", "Barbara", "Patricia", "Linda", "Susan", "Thomas", "Daniel", "Matthew", "Anthony", "Mark",
  "Steven", "Kevin", "Brian", "Gary", "Timothy", "Ronald", "Jason", "Jeffrey", "Ryan", "Nicholas", "Eric", "Stephen",
  "Jonathan", "Larry", "Justin", "Scott", "Melissa", "Frank", "Gregory", "Raymond", "Samuel", "Patrick", "Dennis",
];

describe("100 ordinary words and first names", () => {
  it("has 100", () => expect(NOT_CITIES).toHaveLength(100));

  for (const word of NOT_CITIES) {
    it(`refuses "${word}"`, () => {
      const m = matchHeard(index, heard(word), { required: firstLetter(word) });
      expect(m, `${word} -> ${m.said}`).toMatchObject({ ok: false });
    });
  }
});

describe("the matcher's other rules", () => {
  it("finds an exact name and prefers the biggest city, naming the others", () => {
    const m = matchHeard(index, heard("Sydney"), { required: "s" });
    expect(m).toMatchObject({ ok: true, kind: "exact", said: "Sydney" });
    expect(m.place.country).toBe("AU");
    expect(m.rules).toBe(RULES_VERSION);
  });

  it("plays an alias by the name that was said, so New York ends in K", () => {
    const m = matchHeard(index, heard("New York"), { required: "n" });
    expect(m).toMatchObject({ ok: true, kind: "exact", said: "New York" });
    expect(m.place.name).toBe("New York City");
    expect(lastLetter(m.said)).toBe("k");
  });

  it("plays an abbreviation as the main name", () => {
    expect(matchHeard(index, heard("NYC"), { required: "n" })).toMatchObject({ ok: true, said: "New York City" });
  });

  it("matches accents and filler words, but not a city inside a longer phrase", () => {
    expect(matchHeard(index, heard("Sao Paulo"), { required: "s" })).toMatchObject({ ok: true, kind: "exact" });
    expect(matchHeard(index, heard("um I say Sydney"), { required: "s" })).toMatchObject({ ok: true, said: "Sydney" });
    expect(matchHeard(index, heard("Los Angeles"), {})).toMatchObject({ ok: true, said: "Los Angeles" });
    expect(matchHeard(index, heard("Sydney Opera House"), { required: "s" })).toMatchObject({ ok: false });
  });

  it("refuses a city with the wrong letter, a repeat, an echo and a non-city", () => {
    expect(matchHeard(index, heard("Oslo"), { required: "k" })).toMatchObject({ ok: false, reason: "wrong-letter" });
    const sydney = matchHeard(index, heard("Sydney"), { required: "s" }).place.id;
    // Saying Sydney again is a repeat, though Sydney in Canada is another place.
    expect(matchHeard(index, heard("Sydney"), { required: "s", used: new Set([sydney]), usedNames: new Set(["sydney"]) })).toMatchObject({ ok: false, reason: "used" });
    const ny = matchHeard(index, heard("New York"), { required: "n" }).place.id;
    expect(matchHeard(index, heard("NYC"), { required: "n", used: new Set([ny]), usedNames: new Set(["new york"]) })).toMatchObject({ ok: false, reason: "used" });
    expect(matchHeard(index, heard("Los Angeles"), { required: "l", previous: "Los Angeles" })).toMatchObject({ ok: false, reason: "echo" });
    expect(matchHeard(index, heard("the dog"), { required: "t" })).toMatchObject({ ok: false, reason: "word" });
    expect(matchHeard(index, heard("Zqxv"), { required: "z" })).toMatchObject({ ok: false, reason: "not-a-city" });
    expect(matchHeard(index, [], {})).toMatchObject({ ok: false, reason: "not-a-city" });
  });

  it("tells hard-mode-only towns apart from non-cities", () => {
    expect(matchHeard(index, heard("Leo"), { required: "l" })).toMatchObject({ ok: false, reason: "hard-only" });
    expect(matchHeard(index, heard("Leo"), { required: "l", hard: true })).toMatchObject({ ok: true, said: "Léo" });
  });
});

describe("answering early (off by default)", () => {
  it("takes an exact, well-known city that no longer name starts with", () => {
    expect(earlyMatch(index, ["Oslo"], { required: "o" })).toMatchObject({ ok: true, said: "Oslo" });
    expect(earlyMatch(index, ["Edmonton"], { required: "e" })).toMatchObject({ ok: true, said: "Edmonton" });
  });

  it("waits while a longer name could still come", () => {
    expect(earlyMatch(index, ["San"], {})).toMatchObject({ ok: false });
    expect(earlyMatch(index, ["New York"], { required: "n" })).toMatchObject({ ok: false }); // New York City
    expect(earlyMatch(index, ["Edmond"], { required: "e", hard: true })).toMatchObject({ ok: false }); // Edmonton
    expect(earlyMatch(index, ["Paris"], { required: "p" })).toMatchObject({ ok: true });
    expect(earlyMatch(index, ["Paris", "Paris Texas"], { required: "p" })).toMatchObject({ ok: false });
  });

  it("never answers early on a city named after a word, a sound-alike or a small town", () => {
    expect(earlyMatch(index, ["Nice"], { required: "n" })).toMatchObject({ ok: false });
    expect(earlyMatch(index, ["Sidnee"], { required: "s" })).toMatchObject({ ok: false });
    expect(earlyMatch(index, ["Edmond"], { required: "e", hard: true })).toMatchObject({ ok: false });
  });
});
