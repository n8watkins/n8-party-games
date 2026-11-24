// The Hot Potato categories: what each list is, where its data lives, and the few ways the one
// matcher (logic.js) treats it differently. Pure data, shared by the game (games/hot-potato),
// the hearing test (games/hot-potato/lab) and their unit tests. The lists sit beside this file, and
// the site serves this folder at /one-device/hot-potato/shared/.
//
//  - file, format: the list's JSON (built by tools/) and how its rows read ("cities" for
//    tools/make-cities.py, "entries" for tools/make-categories.py, "words" for words.json).
//  - one, a, plural: how the page names an entry ("a city", "cities").
//  - wide: what the wider list ("Also allow lesser-known ones", off by default) adds on top of
//    the well-known list, or null when the category has only one list. The wider list accepts
//    MORE answers, so it makes the game easier, not harder. wideOff: what is accepted without it.
//  - plurals: "tomatoes" is heard as tomato, "wolves" as wolf (the chain goes on from the entry).
//  - wordNames: a name that is also an ordinary word is told apart from the word ("Orange, the
//    city, not the word") and never answered early from an interim result. Only for cities: in
//    the other lists the entries are themselves ordinary words.

export const CATEGORIES = {
  cities: {
    label: "Cities",
    file: "cities.json",
    format: "cities",
    one: "city",
    a: "a city",
    plural: "cities",
    wide: "every town over 15,000 people",
    wideOff: "well-known cities only",
    plurals: false,
    wordNames: true,
  },
  countries: {
    label: "Countries",
    file: "countries.json",
    format: "entries",
    one: "country",
    a: "a country",
    plural: "countries",
    wide: null,
    plurals: false,
    wordNames: false,
  },
  animals: {
    label: "Animals",
    file: "animals.json",
    format: "entries",
    one: "animal",
    a: "an animal",
    plural: "animals",
    wide: "rarer animals too, every one WordNet names",
    wideOff: "well-known animals only",
    plurals: true,
    wordNames: false,
  },
  food: {
    label: "Food and drink",
    file: "food.json",
    format: "entries",
    one: "food or drink",
    a: "a food or drink",
    plural: "foods and drinks",
    wide: "rarer foods and drinks too, every one WordNet names",
    wideOff: "well-known ones only",
    plurals: true,
    wordNames: false,
  },
  anything: {
    label: "Anything",
    file: "words.json",
    format: "words",
    one: "word",
    a: "an ordinary word",
    plural: "words",
    wide: null,
    plurals: true,
    wordNames: false,
  },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);
export const DEFAULT_CATEGORY = "cities";

/** Where a list (cities.json, words.json ...) is: beside this file, for every page that imports it. */
export const dataUrl = (file) => new URL(file, import.meta.url).href;
