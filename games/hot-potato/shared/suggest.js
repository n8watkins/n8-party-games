// Suggestions: a few answers a player could say next, for the hearing test (games/hot-potato/lab), where
// a player who does not know many cities reads one out. Pure, no DOM. The game does not use it:
// there a suggestion would be the answer. It lives beside the matcher so a deliberate "hint"
// in the game could use it later.
//
// Every suggestion is on the well-known list (never a lesser-known entry), starts with the letter
// needed, and has not been said this game. Cities come from FAMOUS_CITIES first, a hand list of
// cities English speakers know and can say, then the rest of the well-known cities by FAME;
// other categories come in their list's own order, which is most common first.

import { firstLetter, normalize } from "./logic.js";

/** How many suggestions are shown at a time. */
export const SUGGESTION_COUNT = 4;
/** How many of the best candidates "more" pages through before it starts again. */
export const SUGGESTION_POOL = 16;
/** In "Anything", words shorter than this are not suggested: "to" and "it" are heard as anything. */
const MIN_WORD_LETTERS = 4;

// Suggestions are read aloud at a party, so they skip words that double as swearing or read crude
// or grim out of context, and names that are confusing on their own. This only limits what is
// suggested: every one of these is still a right answer when a player says it.

/** A name with any of these words in it is never suggested ("ass", "blue tit"). Lower case, whole words. */
export const SKIP_WORDS = new Set([
  "ass", "asses", "arse", "jackass", "asshole", "bitch", "bastard", "damn", "dammit", "hell", "crap",
  "shit", "shitty", "fuck", "fucking", "fucked", "fucker", "piss", "pissed", "dick", "cock", "prick",
  "pussy", "puss", "pussycat", "tit", "tits", "titty", "titmouse", "bushtit", "boob", "boobs",
  "booby", "boobies", "shag", "slut", "whore", "hooker", "sex", "sexy", "naked", "nude", "penis",
  "bollocks", "wanker", "twat", "bloody", "screw", "screwed", "horny", "idiot", "stupid", "jerk",
  "moron", "wiener", "weenie", "woodcock", "beaver", "crumpet", "booze", "hooch", "hash", "doggy",
  "nut", "nuts", "loin", "tart", "winkle", "kill", "kills", "killed", "killing", "killer", "dead",
  "death", "die", "died", "dies", "murder", "suicide", "violence", "victim", "victims", "drugs",
  "rump", "virgin", "violent", "blood", "shoot", "shooting", "shooter", "gun", "guns", "gunshot",
  "gunshots", "gunfire", "weapon", "weapons", "bomb", "bombs", "goddamn", "damned", "drug", "knife",
  "bullshit", "murdered", "murderer", "murders", "dumb", "ugly", "cancer", "suck", "sucks", "sexual",
  "butt", "freak", "freaking", "motherfucker", "bastards", "loser", "rape", "raped", "assault",
  "kidnapped", "kidnapping", "torture", "idiots", "corpse", "stab", "stabbed", "bitches", "porn",
  "bang", "banging", "blow", "blows", "blowing", "killers", "deaths", "deadly", "hate", "hated", "hates",
]);

/**
 * Names never suggested as a whole: confusing on their own (a "date" is not obviously food,
 * "martin" not obviously a bird), brands, odd dictionary names, and mouthfuls. Normalised.
 */
export const SKIP_NAMES = new Set([
  // animals
  "martin", "merlin", "guinea", "ursine dasyure", "nag",
  // food and drink
  "pop", "punch", "date", "sub", "shake", "brat", "chop", "patty", "preserve", "dressing", "filling",
  "spirits", "nan", "mace", "jello", "danish", "irish potato", "italian sandwich", "sole", "fowl",
  "grain", "marrow", "herb", "port", "rye", "roe", "greens", "italian rice",
  // countries
  "heard island and mcdonald islands", "united states minor outlying islands", "french southern territories",
  // anything
  "john",
]);

/** Whether a name may be suggested (it is never refused as an answer either way). */
export function suggestible(name) {
  const key = normalize(name);
  return !SKIP_NAMES.has(key) && !key.split(" ").some((w) => SKIP_WORDS.has(w));
}

/**
 * Famous, easy-to-say cities, best first within each letter, as spoken in English. Each must be
 * a well-known city in cities.json (the unit tests check it); the spelling here is what the page
 * shows ("Zurich", "Quebec").
 */
export const FAMOUS_CITIES = [
  "Amsterdam", "Athens", "Atlanta", "Austin", "Auckland", "Adelaide", "Anchorage", "Albuquerque",
  "Boston", "Berlin", "Barcelona", "Bangkok", "Brussels", "Buenos Aires", "Baltimore", "Brisbane",
  "Chicago", "Cairo", "Copenhagen", "Cape Town", "Cleveland", "Calgary", "Cincinnati", "Charlotte",
  "Dallas", "Denver", "Dublin", "Detroit", "Dubai", "Delhi", "Durban", "Dakar",
  "Edinburgh", "Edmonton", "El Paso", "Exeter",
  "Florence", "Frankfurt", "Fresno", "Fort Worth", "Fukuoka", "Fargo",
  "Glasgow", "Geneva", "Guadalajara", "Gothenburg",
  "Houston", "Hong Kong", "Havana", "Honolulu", "Hamburg", "Helsinki",
  "Istanbul", "Indianapolis", "Islamabad", "Irvine",
  "Jakarta", "Jerusalem", "Johannesburg", "Jacksonville", "Jersey City",
  "Kansas City", "Kyoto", "Kingston", "Kabul", "Kolkata", "Krakow",
  "London", "Los Angeles", "Lisbon", "Las Vegas", "Lima", "Liverpool",
  "Miami", "Madrid", "Moscow", "Melbourne", "Manchester", "Mumbai", "Memphis", "Milan",
  "New York City", "Nashville", "Nairobi", "Naples", "New Orleans", "Nice",
  "Orlando", "Oslo", "Ottawa", "Oakland", "Osaka", "Omaha", "Oxford",
  "Paris", "Phoenix", "Prague", "Philadelphia", "Portland", "Perth",
  "Quebec", "Quito", "Qingdao",
  "Rome", "Rio de Janeiro", "Reno", "Richmond", "Rotterdam", "Raleigh",
  "Sydney", "Seattle", "San Francisco", "Seoul", "Singapore", "Stockholm",
  "Tokyo", "Toronto", "Tampa", "Tucson", "Tel Aviv", "Toledo",
  "Utrecht", "Ulan Bator",
  "Vancouver", "Vienna", "Venice", "Valencia", "Virginia Beach",
  "Washington", "Warsaw", "Wellington", "Winnipeg", "Wichita",
  "Xi'an", "Xiamen",
  "Yokohama", "York", "Yonkers", "Yerevan",
  "Zurich", "Zagreb",
];

/** Countries whose cities English speakers hear of most. */
const ENGLISH_SPEAKING = new Set(["US", "GB", "CA", "AU", "IE", "NZ"]);

/** How famous a well-known city is likely to be, for the cities not on the hand list. */
const fame = (place) => place.population * (place.why.includes("c") ? 4 : 1) * (ENGLISH_SPEAKING.has(place.country) ? 3 : 1);

/** The well-known entry a name on the hand list stands for (the biggest of that name). */
function knownEntry(index, name) {
  const found = index.byKey.get(normalize(name)) ?? [];
  return found.filter((e) => !e.abbr && index.places[e.id].known).sort((a, b) => a.id - b.id)[0] ?? null;
}

const ranked = new WeakMap();

/**
 * Every well-known entry as a suggestion {id, name}, best first: for cities the hand list, then
 * the others by fame; otherwise the list's own order. Built once per index.
 */
function candidates(index) {
  if (ranked.has(index)) return ranked.get(index);
  let list;
  if (index.category?.format === "cities") {
    const seen = new Set();
    const hand = [];
    for (const name of FAMOUS_CITIES) {
      const e = knownEntry(index, name);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        hand.push({ id: e.id, name });
      }
    }
    const rest = index.places
      .filter((p) => p.known && !seen.has(p.id))
      .sort((a, b) => fame(b) - fame(a))
      .map((p) => ({ id: p.id, name: p.name }));
    list = [...hand, ...rest];
  } else {
    // An entry's other names come after every entry's own name, only to fill a letter its own
    // names leave short: swede is suggested for Y as "yellow turnip".
    const others = new Map();
    for (const entries of index.byKey.values()) {
      for (const e of entries) {
        if (e.abbr || !index.places[e.id].known || e.via === index.places[e.id].name) continue;
        if (!others.has(e.id)) others.set(e.id, []);
        others.get(e.id).push(e.via);
      }
    }
    const short = index.category?.format === "words";
    const main = index.places.filter((p) => p.known && (!short || p.name.length >= MIN_WORD_LETTERS)).map((p) => ({ id: p.id, name: p.name }));
    const alt = index.places.filter((p) => others.has(p.id)).flatMap((p) => others.get(p.id).map((name) => ({ id: p.id, name, alt: true })));
    list = [...main, ...alt];
  }
  list = list.filter((c) => suggestible(c.name));
  ranked.set(index, list);
  return list;
}

/**
 * Up to SUGGESTION_COUNT suggestions {id, name} for the next answer: well known, starting with
 * `letter` (any letter when "": then the best of each starting letter), not in `used` (entry ids) or `usedNames` (normalised names).
 * `page` 0 is the best few; each next page ("more") the few after them, among the best
 * SUGGESTION_POOL, going round to the start after the last.
 */
export function suggestions(index, { letter = "", used = new Set(), usedNames = new Set(), page = 0, count = SUGGESTION_COUNT } = {}) {
  const pool = [];
  const letters = new Set(); // with any letter, one per starting letter, so the few differ
  const ids = new Set();
  for (const c of candidates(index)) {
    const first = firstLetter(c.name);
    if (letter ? first !== letter : letters.has(first)) continue;
    if (ids.has(c.id) || used.has(c.id) || usedNames.has(normalize(c.name))) continue;
    // Other names ("Panthera leo") only fill in where an entry's own names run short.
    if (c.alt && (pool.length >= count || !letter)) break;
    letters.add(first);
    ids.add(c.id);
    pool.push(c);
    if (pool.length >= SUGGESTION_POOL) break;
  }
  if (pool.length <= count) return pool;
  const start = (Math.max(0, page) * count) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
}
