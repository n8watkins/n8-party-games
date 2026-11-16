// The pure parts of Hot Potato's hearing: normalising what was heard, the last-letter rule, and
// matching what the recogniser returned against a category's list (cities, countries, animals,
// food and drink, any word; categories.js says how each list differs). No DOM, no browser APIs,
// so it runs the same in the game (one-device/hot-potato), the hearing test (lab/hot-potato)
// and their unit tests. Both pages import this one file; neither keeps a copy.
//
// Matching rules, version m3: the rules of m2 below, said for cities, hold for every category,
// with three additions (each is said in plain words in index.html and README.md):
//  - Categories: the list is the chosen category's; "a city" reads "an animal" and so on. Rule 3's
//    ordinary-word test and rule 6's "not an ordinary word" apply to cities only, since animals,
//    foods and words are ordinary words themselves.
//  - Plurals: in categories that allow them, "tomatoes" is tomato and "wolves" is wolf, and the
//    chain goes on from the entry (tomato needs an O).
//  - Dead ends: when fewer than DEAD_END_BELOW entries not yet said start with the last letter,
//    the chain goes on from the letter before it (monkey needs an E among the animals).
//
// Matching rules, version m2:
//  1. The whole phrase decides: after accents, case, punctuation and a few filler words ("um",
//     "how about") are dropped, what was heard must equal a name of the place. "Leopold" is not
//     Léo, "Edmonton" is not Edmond.
//  2. Only the recogniser's believable guesses count: those rated at least half as sure as its
//     best guess, and spellings of a counted guess that sound the same. "Rogers" at 0.02 beside
//     "Rodger" at 0.67 does not count.
//  3. Two lists. The default list holds well-known places: capitals, US, Canadian and Australian
//     state capitals, places of 100,000 people or more, and a hand list of famous small towns.
//     A place whose name is also an ordinary word (Orange, Surprise) needs 250,000 people, a
//     capital or the hand list (Nice, Bath, Cork, Reading, Mobile). Hard mode adds every town
//     over 15,000.
//  4. Sound-alike only mends the recogniser's spelling of a well-known city, never a different
//     word: the best guess must not be an ordinary English word or a common name, the city's name
//     must not be an ordinary word, it must start with the same letter, have the same consonants,
//     and be one letter off (two for six letters or more, vowels only). "Sidnee" is Sydney;
//     "salmon" is a fish.
//  5. When a name fits two places, the bigger one is named, and the other is shown.
//  6. Answering early (off by default) takes an interim result only when it is exactly a
//     well-known city, no longer name in the list starts with it, and it stays the same for a
//     moment; otherwise the final result decides.

import { CATEGORIES } from "./categories.js";

export const RULES_VERSION = "m3";

/** Letters that NFD does not split into a base letter and a mark. */
const FOLD = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i", ħ: "h" };
/** Short forms spoken or written either way: "St. Louis" and "Saint Louis" are one key. */
const WORDS = { st: "saint", ste: "sainte", ft: "fort", mt: "mount" };

/**
 * Lower case, accents removed (NFD, then the marks dropped), "&" as "and", punctuation and
 * hyphens as spaces, "St"/"Ft"/"Mt" spelled out, single spaces. "São Paulo" -> "sao paulo".
 */
export function normalize(text) {
  const s = String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþıħ]/g, (c) => FOLD[c])
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s ? s.split(" ").map((w) => WORDS[w] ?? w).join(" ") : "";
}

/** Only the letters a to z, after normalising: what the chain rule looks at. */
export const letters = (text) => normalize(text).replace(/[^a-z]/g, "");
export const firstLetter = (text) => letters(text).charAt(0);
export const lastLetter = (text) => letters(text).slice(-1);

/**
 * The chain rule: the new name starts with the last letter of the previous one, both read from
 * letters only, so "New York" ends in K and "São Paulo" runs from S to O. The first turn (no
 * previous word) takes any letter.
 */
export function followsChain(previous, next) {
  if (!previous) return true;
  return firstLetter(next) === lastLetter(previous);
}

/**
 * Edit distance counting a swap of two neighbouring letters as one edit ("Dehli" is one off
 * "Delhi"), stopping early once it is above `max`.
 */
export function editDistance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A rough sound key for English speech, the consonant skeleton: the first letter kept, common
 * spellings of one sound folded together (ph/f, c/k/q, z/s, y/i), silent letters dropped, then
 * the vowels dropped and doubled letters merged. "Sidnee" and "Sydney" are both "sdn".
 */
export function soundKey(text) {
  let s = letters(text);
  if (!s) return "";
  s = s
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^ps/, "s")
    .replace(/ph/g, "f")
    .replace(/gh/g, "")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/dg/g, "j")
    .replace(/([^aeiou])h/g, "$1")
    .replace(/y/g, "i")
    .replace(/w(?![aeiou])/g, "");
  const head = s[0];
  const tail = s.slice(1).replace(/[aeiouh]/g, "");
  return (head + tail).replace(/(.)\1+/g, "$1");
}

/** Words said around a city that are not part of it: "um", "how about", "I'll say", "please". */
const LEADING_FILLERS = [
  "um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "so", "okay", "ok", "well", "maybe", "like",
  "i say", "ill say", "i will say", "lets say", "let me say", "how about", "what about",
  "its", "it is", "the city of", "city of",
].map((f) => f.split(" "));
const TRAILING_FILLERS = ["please", "i guess", "maybe", "i think"].map((f) => f.split(" "));

/** The heard phrase with filler words dropped from both ends: "um how about Sydney" -> "sydney". */
export function trimFillers(text) {
  let words = normalize(text).split(" ").filter(Boolean);
  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    for (const f of LEADING_FILLERS) {
      if (words.length > f.length && f.every((w, i) => words[i] === w)) {
        words = words.slice(f.length);
        changed = true;
        break;
      }
    }
    for (const f of TRAILING_FILLERS) {
      if (words.length > f.length && f.every((w, i) => words[words.length - f.length + i] === w)) {
        words = words.slice(0, words.length - f.length);
        changed = true;
        break;
      }
    }
  }
  return words.join(" ");
}

/**
 * The rows of a category's JSON, read into one shape: {name, names (every spoken form, the
 * name first), abbrs, known, and what the page says about it}.
 *  - "cities" (cities.json): {countries, regions, rows: [[name, ascii|0, alts|0, abbrs|0,
 *    country, population, why|0, region number|0]]}, biggest first (a region number counts from
 *    1 into `regions`). Well known when it has a "why".
 *  - "entries" (countries, animals, food): {groups, rows: [[name, alts|0, abbrs|0, known 1|0,
 *    group number|0]]}, best known first.
 *  - "words" (words.json): {words}, most frequent first; every word of two letters or more.
 */
function readRows(doc, format) {
  if (format === "words") {
    return (doc.words ?? []).filter((w) => w.length > 1).map((w) => ({ name: w, names: [w], abbrs: [], known: true, group: "" }));
  }
  if (format === "entries") {
    const groups = doc.groups ?? [];
    return doc.rows.map(([name, alts, abbrs, known, group]) => ({ name, names: [name, ...(alts || [])], abbrs: abbrs || [], known: Boolean(known), group: (group && groups[group - 1]) || "" }));
  }
  const countries = doc.countries ?? {};
  const regions = doc.regions ?? [];
  return doc.rows.map(([name, ascii, alts, abbrs, country, population, why, region]) => ({
    name,
    names: [name, ...(ascii ? [ascii] : []), ...(alts || [])],
    abbrs: abbrs || [],
    known: Boolean(why),
    country,
    countryName: countries[country] ?? country,
    population,
    why: why || "",
    region: (region && regions[region - 1]) || "",
  }));
}

/**
 * Turns a category's shipped JSON (and words.json, {words, names}) into an index. Each entry
 * gets an id (its row number); every name, ASCII name, other name and abbreviation is a key
 * (an abbreviation also without its dots: "U.S." is "us"). An entry is well known (in the default
 * list) or hard mode only. `category` is one of CATEGORIES (cities when left out).
 */
export function buildIndex(doc, wordsDoc = { words: [], names: [] }, category = CATEGORIES.cities) {
  const ordinary = new Set(wordsDoc.words ?? []);
  const names = new Set(wordsDoc.names ?? []);
  const places = [];
  const byKey = new Map();
  const byLetter = new Map();
  const keySet = { known: new Set(), all: new Set() };
  // Which entries can be played after each letter, well known and all: for the dead-end rule.
  const startIds = { known: new Map(), all: new Map() };
  const starts = (letter, id, known) => {
    if (!/[a-z]/.test(letter)) return;
    for (const [list, on] of [[startIds.all, true], [startIds.known, known]]) {
      if (!on) continue;
      if (!list.has(letter)) list.set(letter, new Set());
      list.get(letter).add(id);
    }
  };
  const add = (key, entry) => {
    if (!key) return;
    const list = byKey.get(key);
    if (!list) byKey.set(key, [entry]);
    else if (!list.some((e) => e.id === entry.id)) list.push(entry);
  };
  readRows(doc, category.format).forEach((row, id) => {
    const { names: spoken, abbrs, ...place } = row;
    place.id = id;
    places.push(place);
    const known = place.known;
    for (const n of spoken) {
      const key = normalize(n);
      if (!key) continue;
      const word = isPlainWords(key, ordinary);
      add(key, { id, via: n, abbr: false, word });
      keySet.all.add(key);
      if (known) keySet.known.add(key);
      starts(firstLetter(n), id, known);
      const letter = key.charAt(0);
      // Sound-alikes are only ever looked for among well-known entries whose name is not a word.
      if (!known || word || !/[a-z]/.test(letter)) continue;
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter).push({ id, via: n, abbr: false, compact: letters(n), sound: soundKey(n) });
    }
    for (const a of abbrs) {
      for (const key of new Set([normalize(a), letters(a)])) {
        add(key, { id, via: a, abbr: true, word: isPlainWords(key, ordinary) });
        keySet.all.add(key);
        if (known) keySet.known.add(key);
      }
    }
  });
  const sortedKeys = { known: [...keySet.known].sort(), all: [...keySet.all].sort() };
  return { category, places, byKey, byLetter, ordinary, names, sortedKeys, startIds, knownCount: places.filter((p) => p.known).length };
}

/** Plurals that do not end in a plain "s" or "es". */
const IRREGULAR = {
  mice: "mouse", lice: "louse", geese: "goose", oxen: "ox", teeth: "tooth", feet: "foot", children: "child",
  people: "person", cacti: "cactus", octopi: "octopus", fungi: "fungus", larvae: "larva", dice: "die",
};

/**
 * The singular forms a plural phrase might be, most likely first, changing its last word only:
 * "lions" -> lion, "cookies" -> cookie, "tomatoes" -> tomato, "berries" -> berry, "wolves" ->
 * wolf, "polar bears" -> polar bear, "mice" -> mouse. The caller keeps the first that is on the
 * list, so "cookies" is cookie, not cooky.
 */
export function singulars(key) {
  const words = key.split(" ");
  const last = words.at(-1) ?? "";
  const head = words.slice(0, -1);
  const out = [];
  const add = (w) => {
    if (w.length > 1 && w !== last && !out.includes(w)) out.push(w);
  };
  if (IRREGULAR[last]) add(IRREGULAR[last]);
  if (last.length > 3 && last.endsWith("s") && !last.endsWith("ss")) {
    add(last.slice(0, -1));
    if (last.endsWith("es")) add(last.slice(0, -2));
    if (last.endsWith("ies")) add(`${last.slice(0, -3)}y`);
    if (last.endsWith("ves")) {
      add(`${last.slice(0, -3)}f`);
      add(`${last.slice(0, -3)}fe`);
    }
  }
  if (last.endsWith("men") && last.length > 4) add(`${last.slice(0, -3)}man`);
  return out.map((w) => [...head, w].join(" "));
}

/** True when every word of a normalised phrase is in the set. */
function isPlainWords(key, set) {
  const words = key.split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => set.has(w));
}

/**
 * What kind of thing a heard phrase is, when it is not a city: "word" (every word an ordinary
 * English word: "salmon", "hear it"), "name" (made of ordinary words and common first or family
 * names, at least one a name: "Ralph", "Rodger"), or "" (neither: "Sidnee").
 */
export function wordKind(index, key) {
  const words = key.split(" ").filter(Boolean);
  if (!words.length) return "";
  if (words.every((w) => index.ordinary.has(w))) return "word";
  if (words.every((w) => index.ordinary.has(w) || index.names.has(w))) return "name";
  return "";
}

/** Guesses below this share of the best guess's confidence do not count. */
export const MIN_SHARE_OF_BEST = 0.5;
/** Guesses this close to the best guess's confidence are its equals. */
const TIE = 0.05;

/**
 * The guesses that count, best first: those rated at least half as sure as the best one, plus
 * lower-rated spellings that sound the same as a counted guess (the recogniser spelling one word
 * two ways). When the recogniser gives no confidences (all 0: interim results, some browsers),
 * the first guess counts, with its sound-the-same spellings. Each comes with its trimmed key.
 */
export function usableAlternatives(alternatives) {
  const alts = (alternatives ?? [])
    .map((a, i) => ({ transcript: a?.transcript ?? "", confidence: Number(a?.confidence) || 0, i }))
    .map((a) => ({ ...a, key: trimFillers(a.transcript) }))
    .filter((a) => a.key);
  if (!alts.length) return [];
  const best = Math.max(...alts.map((a) => a.confidence));
  const kept = best > 0 ? alts.filter((a) => a.confidence >= best * MIN_SHARE_OF_BEST) : [alts[0]];
  const sounds = new Set(kept.map((a) => soundKey(a.key)));
  const rescued = alts.filter((a) => !kept.includes(a) && sounds.has(soundKey(a.key)));
  return [...kept, ...rescued].sort((a, b) => b.confidence - a.confidence || a.i - b.i);
}

/** How many letters a sound-alike may be off, by the heard word's length (same consonants only). */
const allowedDistance = (n) => (n >= 6 ? 2 : 1);
/** Heard words shorter than this never match by sound. */
const SOUND_ALIKE_MIN_LETTERS = 4;

/**
 * Matches what the recogniser returned against the list, under the chain rule.
 *
 * `alternatives` is [{transcript, confidence}] in the recogniser's order. `required` is the
 * letter the answer must start with (or "" on the first turn), `used` a Set of place ids already
 * played and `usedNames` a Set of the normalised names already said (so a second "Sydney" is a
 * repeat even though Sydney in Canada is another place), `previous` the last accepted spoken name
 * (a guess that is just that word again is an echo, not an answer), `hard` true for hard mode
 * (every town over 15,000; otherwise well-known places only).
 *
 * Returns {ok, kind, place, said, heard, alternative, others, reason, rules}:
 *  - ok true: kind is "exact" (the best guess), "alternative" (another counted guess) or
 *    "sound-alike"; `said` is the name the chain goes on from; `others` lists other places of
 *    that name in the list, biggest first.
 *  - ok false: reason is "used", "wrong-letter", "echo", "hard-only" (only in the full list),
 *    "word" (an ordinary word), "name" (a common name) or "not-a-city"; `place` says what it came
 *    closest to, when anything.
 */
export function matchHeard(index, alternatives, { required = "", used = new Set(), usedNames = new Set(), previous = "", hard = false } = {}) {
  const alts = usableAlternatives(alternatives);
  const rules = RULES_VERSION;
  if (!alts.length) return { ok: false, reason: "not-a-city", kind: null, place: null, said: "", heard: "", others: [], rules };
  const said = (e) => (e.abbr ? index.places[e.id].name : e.via);
  const isUsed = (e) => used.has(e.id) || usedNames.has(normalize(said(e)));
  const inList = (e) => hard || index.places[e.id].known;
  const prevKey = previous ? normalize(previous) : "";
  let wrongLetter = null;
  let usedHit = null;
  let hardOnly = null;
  let echo = false;

  const result = (kind, entry, alt, extra = {}) => {
    const place = index.places[entry.id];
    const name = said(entry);
    const others = (index.byKey.get(normalize(name)) ?? [])
      .filter((e) => e.id !== entry.id && inList(e))
      .sort((a, b) => a.id - b.id)
      .map((e) => index.places[e.id]);
    return { ok: true, kind, place, said: name, heard: alt.key, alternative: alt.i, others, wordName: entry.word, rules, ...extra };
  };
  const fail = (reason, hit, heardKey) => ({
    ok: false,
    reason,
    kind: null,
    place: hit ? index.places[hit.entry.id] : null,
    said: hit ? said(hit.entry) : "",
    heard: hit ? hit.alt.key : heardKey ?? alts[0].key,
    alternative: hit ? hit.alt.i : alts[0].i,
    others: [],
    rules,
  });

  // 1. Exact: a counted guess, as a whole, is a name of a place. Best-rated guess first; among
  //    places of one name, the biggest (rows are sorted by population, so a lower id is bigger).
  for (const [rank, alt] of alts.entries()) {
    if (prevKey && alt.key === prevKey) {
      echo = true;
      continue;
    }
    const found = lookup(index, alt.key);
    if (!found) continue;
    const sorted = [...found.entries].sort((a, b) => a.id - b.id);
    const listed = sorted.filter(inList);
    if (!listed.length) {
      hardOnly ??= { entry: sorted[0], alt };
      continue;
    }
    const fits = listed.filter((e) => !required || firstLetter(said(e)) === required);
    const fresh = fits.find((e) => !isUsed(e));
    if (fresh) return result(rank === 0 ? "exact" : "alternative", fresh, alt, found.plural ? { plural: true } : {});
    if (fits.length) usedHit ??= { entry: fits[0], alt };
    else wrongLetter ??= { entry: listed[0], alt };
  }

  // A name heard exactly that was already played is a repeat, not a cue to guess at another place.
  if (usedHit) return fail("used", usedHit);

  // 2. Sound-alike, only when the recogniser's best guesses are not ordinary words or names.
  const top = alts.filter((a) => a.confidence >= alts[0].confidence - TIE);
  const plain = top.map((a) => ({ alt: a, kind: wordKind(index, a.key) })).find((x) => x.kind);
  if (!plain) {
    let best = null;
    for (const [rank, alt] of alts.entries()) {
      if (prevKey && alt.key === prevKey) continue;
      if (wordKind(index, alt.key)) continue;
      const heard = letters(alt.key);
      if (heard.length < SOUND_ALIKE_MIN_LETTERS) continue;
      const letter = heard.charAt(0);
      if (required && letter !== required) continue;
      const key = soundKey(alt.key);
      const max = allowedDistance(heard.length);
      for (const e of index.byLetter.get(letter) ?? []) {
        if (e.sound !== key || Math.abs(e.compact.length - heard.length) > max) continue;
        const d = editDistance(heard, e.compact, max);
        if (d > max || isUsed(e)) continue;
        // Fewest letters off, then the better-rated guess, then the bigger city.
        const score = [d, rank, e.id];
        if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))) {
          best = { score, entry: e, alt, d };
        }
      }
    }
    if (best) return result("sound-alike", best.entry, best.alt, { distance: best.d });
  }

  if (wrongLetter) return fail("wrong-letter", wrongLetter);
  if (hardOnly) return fail("hard-only", hardOnly);
  if (plain) return fail(plain.kind, null, plain.alt.key);
  if (echo) return fail("echo", null);
  return fail("not-a-city", null);
}

/**
 * The entries a whole heard phrase names: the phrase as it is, or, in a category that allows
 * plurals, the first of its singular forms on the list. Returns {entries, plural} or null.
 */
function lookup(index, key) {
  const direct = index.byKey.get(key);
  if (direct) return { entries: direct, plural: false };
  if (!index.category?.plurals) return null;
  for (const s of singulars(key)) {
    const entries = index.byKey.get(s);
    if (entries) return { entries, plural: true };
  }
  return null;
}

/** Fewer entries than this left to start with a letter make it a dead end. */
export const DEAD_END_BELOW = 3;

/** How many entries in the list (well known, or all in hard mode) start with a letter, not counting those already said. */
export function entriesLeft(index, letter, used = new Set(), hard = false) {
  const ids = (hard ? index.startIds.all : index.startIds.known).get(letter);
  if (!ids) return 0;
  let n = 0;
  for (const id of ids) if (!used.has(id)) n++;
  return n;
}

/**
 * The letter the next answer must start with, after `said`: its last letter, unless fewer than
 * DEAD_END_BELOW entries not yet said start with that letter (a dead end), when the chain goes
 * on from the letter before it, and so on ("monkey" needs an E among the animals, where only
 * the yak starts with Y). Returns {letter, skipped}: the letters passed over, last first; letter
 * is "" (any letter) when every letter of the name is a dead end.
 */
export function nextLetter(index, said, { used = new Set(), hard = false } = {}) {
  const word = letters(said);
  const skipped = [];
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word[i];
    if (skipped.includes(c)) continue;
    if (entriesLeft(index, c, used, hard) >= DEAD_END_BELOW) return { letter: c, skipped };
    skipped.push(c);
  }
  return { letter: "", skipped };
}

/** The letters that are dead ends in a fresh game: fewer than DEAD_END_BELOW entries start with them. */
export function deadLetters(index, hard = false) {
  return [..."abcdefghijklmnopqrstuvwxyz"].filter((c) => entriesLeft(index, c, new Set(), hard) < DEAD_END_BELOW);
}

/** True when some other name in the list (well known, or all in hard mode) starts with this key. */
export function longerNameStartsWith(index, key, hard = false) {
  const keys = hard ? index.sortedKeys.all : index.sortedKeys.known;
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] <= key) lo = mid + 1;
    else hi = mid;
  }
  // Keys that start with `key` sort right after it.
  return lo < keys.length && keys[lo].startsWith(key);
}

/** How long an interim result must stay the same before an early answer is taken. */
export const EARLY_STABLE_MS = 300;

/**
 * Whether an interim result may be answered early (the "answer early" switch). Only an exact
 * name of a well-known city whose name is not an ordinary word, that fits the chain, when no
 * longer name in the list starts with it ("Edmond" could still become "Edmonton", "Dar" "Dar es
 * Salaam") and no other interim guess is longer and starts with it. The caller also waits
 * EARLY_STABLE_MS for the interim to stay the same. Returns a match (as matchHeard) or
 * {ok: false, why}.
 */
export function earlyMatch(index, interimTranscripts, opts = {}) {
  const texts = (interimTranscripts ?? []).map((t) => (typeof t === "string" ? t : t?.transcript ?? ""));
  const key = trimFillers(texts[0] ?? "");
  if (!key) return { ok: false, why: "nothing yet" };
  if (texts.slice(1).some((t) => {
    const k = trimFillers(t);
    return k.length > key.length && k.startsWith(key);
  })) return { ok: false, why: "a longer guess starts with it" };
  const m = matchHeard(index, [{ transcript: key, confidence: 0 }], { ...opts, hard: false });
  const one = index.category?.one ?? "city";
  if (!m.ok || m.kind !== "exact" || m.plural) return { ok: false, why: `not exactly a well-known ${one}` };
  if (m.wordName && index.category?.wordNames !== false) return { ok: false, why: "also an ordinary word" };
  if (longerNameStartsWith(index, key, Boolean(opts.hard))) return { ok: false, why: `a longer ${one} name starts with it` };
  return m;
}

/** The median of a list of numbers (null when there are none). */
export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}
