// The Hot Potato categories: what each list is, where its data lives, and the few ways the one
// matcher (logic.js) treats it differently. Pure data, shared by the page and the unit tests.
//
//  - file, format: the list's JSON (built by tools/) and how its rows read ("cities" for
//    tools/make-cities.py, "entries" for tools/make-categories.py, "words" for words.json).
//  - one, a, plural: how the page names an entry ("a city", "cities").
//  - hard: what hard mode adds, or null when the list has no hard-mode part.
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
    hard: "any town over 15,000 people",
    hardOff: "well-known places only",
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
    hard: null,
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
    hard: "rare animals too, every one WordNet names",
    hardOff: "well-known animals only",
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
    hard: "rare foods and drinks too, every one WordNet names",
    hardOff: "well-known ones only",
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
    hard: null,
    plurals: true,
    wordNames: false,
  },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);
export const DEFAULT_CATEGORY = "cities";
