# Hot Potato hearing test

An unlisted, throwaway test page at `/lab/hot-potato/` that answers one question: can a browser's own speech recognition hear spoken words well enough, and fast enough, for the Hot Potato word-chain game?
It works the same in a desktop browser with a laptop, desk or headset microphone and on a phone.
The page sends nothing; it keeps only the chosen category and the suggestions switch, in this browser's own storage; the browser's speech service may send the audio to its maker.

## Files

- `public/index.html`, `public/style.css`, `public/app.js`: the page.
- `public/device.js`: which device and kind of microphone the page is on, for the report.

The matcher and the lists belong to the game and live in `one-device/hot-potato/shared/`, served at `/one-device/hot-potato/shared/`.
This page imports them from there; nothing is copied.

- `shared/logic.js`: the pure rules and the matcher (no DOM), shared with the game and the unit tests.
- `shared/categories.js`: the categories, as data: each list's file and format, its words for the page, and the few ways the matcher treats it differently.
- `shared/cities.json`: GeoNames places, built by `tools/make-cities.py`.
- `shared/countries.json`, `shared/animals.json`, `shared/food.json`: built by `tools/make-categories.py` from GeoNames and Open English WordNet, with the hand lists `tools/countries-extra.txt`, `tools/countries-drop.txt`, `tools/animals-add.txt`, `tools/animals-drop.txt`, `tools/food-add.txt` and `tools/food-drop.txt`.
- `shared/words.json`: ordinary English words and common names, built by `tools/make-words.py`; also the "Anything" list.
- `shared/CREDITS.txt`: sources and licences of the lists.
- `tools/famous-places.txt`: famous places kept in the default list by hand.
- `tools/replay-report.mjs`: replays a copied report through the current matcher, each turn in its own category.
- `tools/letter-report.mjs`: how many entries start and end with each letter, per category, and the dead ends.
- `shared/suggest.js`: the suggestions this page shows (the game does not use it).
- `test/logic.test.js`, `test/categories.test.js`, `test/suggest.test.js`, `test/device.test.js`: unit tests (part of `npm test`).
- `test/fixtures/hearing-report-1.txt`: the owner's first real run (v1, desktop Chrome on Windows, 20 turns).
- `test/e2e-hearing.mjs`: the page in a headless, muted Chromium with a scripted fake recogniser.

## Categories

The category picker sits above the game; the choice is remembered on this device, and changing it starts a new game (the log is kept, and each turn names its category).
A category's list is loaded only when it is first chosen.

| Category | Well known (default) | With "Also allow lesser-known ones" | Source | Size |
|---|---|---|---|---|
| Cities | 5,987 | 31,782 (every town over 15,000 people) | GeoNames | 1.3 MB |
| Countries | 254 (no lesser-known ones) | - | GeoNames, plus England, Scotland, Wales and Northern Ireland | 8 KB |
| Animals | 452 | 3,636 (rarer animals) | Open English WordNet | 114 KB |
| Food and drink | 505 | 2,312 (rarer foods and drinks) | Open English WordNet | 65 KB |
| Anything | 29,998 (no lesser-known ones) | - | `words.json` (FrequencyWords and SCOWL) | 395 KB (always loaded) |

"Also allow lesser-known ones" is a switch, off by default, that accepts more answers, so it makes the game easier, not harder.
Until 2026-11-16 it was called "hard mode", which said the opposite of what it does; reports from before then (v1 to v3) mark its turns `hard`, and `test/report.js` still reads them.
In the code it is the `wide` option of `matchHeard`, `nextLetter`, `deadLetters` and `entriesLeft`, the `wide` field of a category, and the refusal reason `lesser-known`.
The game (`one-device/hot-potato`) has no such switch and always plays the well-known list.

### Suggestions

To help a player who does not know many cities, the page shows three or four answers for the letter needed ("Try: Tokyo · Toronto · Tehran · more"), from the well-known list, never one already said this game.
Cities are ranked by fame (population, with capitals and big cities of English-speaking countries first), other categories by how common the word is; "more" shows the next few.
Tapping a suggestion does nothing: this is a hearing test, so the player says it.
A switch hides them (on by default, remembered on this device).
Each turn line in the report ends with `sugg:read` when the answer was one of the suggestions shown, `sugg:own` when it was not, or `sugg:hidden` when they were off.
The game does not show suggestions; there they would be cheating.

Countries are the countries and territories of ISO 3166 by their common English names ("Holland", "Burma", "Czech Republic", "USA", "America"), without formal names ("Republic of Turkey") or names of former states.
Animals, food and drink are the nouns WordNet files under animals (not humans) and under food, drink and edible nuts.
The well-known ones are those whose animal or food sense is one of the word's first three senses in WordNet and that are among the 40,000 most frequent words in film subtitles, plus a hand list of names of two or three words ("polar bear", "iced tea") and of words the rule misses ("seal" is first a fastener in WordNet).
A hand list leaves out names whose everyday meaning is something else ("queen", "frank"), people's names ("Molly"), meals ("dinner") and the rude.
The page names the entry it matched and its broad group: "Yes: puma (cougar, mammal)", "Yes: Holland (The Netherlands, Europe)", "Yes: iced tea (drink)".

## Matching rules, version m3

Each turn line in the copied report starts with the rules version (`m3`) and the category, so reports from different versions can be compared.
m3 keeps every rule of m2 below, for every category, and adds three:

- **Categories.** The list is the chosen category's, and the words on the page follow it ("Next: an animal starting with N").
  Rule 3's ordinary-word test ("Orange" the city needs 250,000 people) and rule 6's "never early on a name that is a word" are for cities only: animals, foods and words are ordinary words themselves, so they are never refused for it.
  An ordinary word that is not on the list is still refused, saying so: `No: heard "hello", an ordinary word, not an animal`.
  Sound-alike still never mends an ordinary word, so in those categories it rarely applies.
- **Plurals** count for animals, food and drink, and words: "lions" is lion, "tomatoes" tomato, "wolves" wolf, "mice" mouse, "polar bears" polar bear.
  The chain goes on from the entry, not the plural (tomato needs an O), and a plural of a name already said is a repeat.
  An early answer is never taken from a plural.
- **Dead ends.** When fewer than three entries not yet said start with the last letter, the chain goes on from the letter before it (and so on).
  The page names the dead ends of the chosen category and says, after a turn, when one was skipped; the report marks it as `dead-end:y>e`.

### Dead ends per category

From `node lab/hot-potato/tools/letter-report.mjs` (entries per starting letter count every name of an entry, so "Holland" counts for H).

- **Cities:** none; even X (56 well known) and Q (67) have plenty.
- **Countries:** O (only Oman), Q (Qatar), X, Y (Yemen) and Z (Zambia, Zimbabwe).
  15 countries end in O (Mexico, Morocco, Congo ...) and 12 in Y (Germany, Italy ...): after Mexico the next country starts with C, after Germany with N, after Iraq with A.
- **Animals:** U, X, Y and Z (the yak is the only well-known Y, the zebra the only Z).
  32 well-known animals end in Y (monkey, turkey, donkey, pony ...), 5 in X (fox, ox, lynx, red fox, Arctic fox), 2 in U (emu, nandu) and 1 in Z (spitz): after monkey the next animal starts with E, after fox with O.
  With lesser-known animals allowed, only X is a dead end.
- **Food and drink:** U, X and Z; 2 end in U (tofu, tiramisu) and 1 in X (lox).
  Y has 4 (yogurt, yam, yolk, and swede by its other name yellow turnip), so it holds until two of them are said, then becomes a dead end too.
  35 well-known foods end in Y (candy, curry, jelly ...).
- **Anything:** X (82 words end in it, 2 start with it).

Two simpler rules were weighed: "any letter after a dead end" makes 32 animals free passes, and keeping the dead letter ends the game on monkey.
Going back one letter keeps the chain a chain, and it is the house rule many people already play.

## Matching rules, version m2

The m2 rules, as written for cities.

1. **The whole phrase decides.**
   After accents, capitals, punctuation and a few fillers ("um", "how about", "please") are dropped, what was heard must be a name of the place, all of it.
   "Leopold" is not Léo, "Edmonton" is not Edmond, and "Sydney Opera House" is not Sydney.
2. **Only believable guesses count.**
   The recogniser returns up to ten guesses, each with how sure it is.
   A guess counts if it is at least half as sure as the best one, or is another spelling of a counted guess with the same consonants.
   In the first report, "Rogers" at 0.02 beside "Rodger" at 0.67 does not count; "Derby" at 0.44 beside "Darby" at 0.77 does.
3. **Two lists, well-known places by default.**
   The default list holds national capitals, US, Canadian and Australian state capitals, cities of 100,000 people or more, and the hand list in `tools/famous-places.txt` (Venice, Aspen, Cannes, Montpelier).
   A city whose name is also an ordinary English word (Orange, Surprise, Independence) needs 250,000 people, a capital or the hand list (Nice, Bath, Cork, Mobile, Split).
   "Also allow lesser-known cities" (a switch, off by default) adds every town over 15,000, so it accepts more.
   A city heard exactly that is only in the wider list is refused in the default list as lesser known: `No: Orange (United States) is a lesser-known town of 141k, not on the well-known list (taken with "Also allow lesser-known cities" on)`.
4. **Sound-alike only mends the recogniser's spelling of a well-known city, never a different word.**
   It is tried only when the recogniser's best guess is not an ordinary English word or a common first or family name ("salmon", "hello", "apple", "ratchet", "Ralph" are refused as what they are).
   The city must be well known and its name must not itself be an ordinary word.
   It must start with the same letter, have the same consonants, and be one letter off (two for heard words of six letters or more; with the same consonants, that means vowels).
   A swap of two neighbouring letters is one letter ("Dehli" is Delhi).
   "Sidnee" is Sydney and "Lundun" is London.
5. **Ambiguity is shown, not hidden.**
   When a name fits two places, the bigger one is named with its state or province and country, and the others are mentioned.
6. **The final result decides by default.**
   In the first report the final result came about when speech ended (median end of speech to final: -10 ms), so waiting costs almost nothing.
   With "Answer early" on, an interim result is taken only when it is exactly a well-known city whose name is not an ordinary word, no longer name in the list starts with it ("Edmond" could still become Edmonton, "Dar" Dar es Salaam), no longer interim guess starts with it, and it stays the same for 0.3 seconds.
   Whether the switch is on or off, each turn records what an early answer would have taken and whether it differed from the final.
7. **The chain rules are unchanged:** letters A to Z only (São Paulo runs S to O, New York ends in K), the chain goes on from the name said ("NYC" plays as New York City), and a place or name said once cannot be said again.

Every verdict says why, for example `No: heard "salmon", an ordinary word, not a city`.
Every verdict has one appeal button ("That was a real city" on a refusal, "That was wrong" on an acceptance), counted in the report, so a real player can show where the rules are still off.

## The first report, replayed

`node lab/hot-potato/tools/replay-report.mjs lab/hot-potato/test/fixtures/hearing-report-1.txt` prints every turn.
In short: v1 accepted 10 of the 20 turns, 8 of them wrongly (five loose sound-alikes, Léo from "Leopold", Orange, Rogers from "Rodger") and 2 as the wrong city (Edmond for Edmonton, Dar for Darby).
m2 accepts 2: Edmonton, and Derby from the recogniser's own guess for "Darby".
v1 answered 7 turns early from an interim result and 5 of those differed from the final; m2's early rule would have answered none of those 7 interims.

## The device

The report's device line names the kind of device, the system and the browser, such as `desktop (Windows, Chrome 157)`.
Space or Enter starts a turn and Escape stops listening on a keyboard.
When the browser names more than one microphone, a picker appears.
Chrome and Edge on a computer can listen to a chosen microphone (`SpeechRecognition.start(audioTrack)`); where the browser cannot, the page says so and the system's default microphone is used.
The report names only the kind of microphone (built-in, headset, webcam, USB, other), never its own name.

## Rebuilding the data

Download the files listed at the top of `tools/make-words.py`, `tools/make-cities.py` and `tools/make-categories.py` into an empty folder of their own, then:

```sh
python3 -I lab/hot-potato/tools/make-words.py <en_50k.txt> <scowl final/> <census folder> one-device/hot-potato/shared/words.json <date>
python3 -I lab/hot-potato/tools/make-cities.py <geonames folder> one-device/hot-potato/shared/words.json lab/hot-potato/tools/famous-places.txt one-device/hot-potato/shared/cities.json <date>
python3 -I lab/hot-potato/tools/make-categories.py <download folder> lab/hot-potato/tools one-device/hot-potato/shared <date>
node lab/hot-potato/tools/letter-report.mjs
```

`make-categories.py` prints each list's size and letter counts; `letter-report.mjs` prints the counts the page uses, every name included, and the dead ends.
Sources and licences are in `one-device/hot-potato/shared/CREDITS.txt`.

## Tests

- `npm test` runs the unit tests, including the 20 turns of the first report, about 60 well-known cities and 100 ordinary words and names, and (`test/categories.test.js`) the common entries of every category, plurals, the ordinary-word rule per category, the dead ends and reports of every version read back, and (`test/suggest.test.js`) that every suggestion is a right answer for its letter and category, from the well-known list, never one already said.
- `node lab/hot-potato/test/e2e-hearing.mjs --base=http://localhost:8875` checks the page in a headless, muted Chromium against a built site served on that port (run it through `devguard slot --`), including a game in each category, the plural and dead-end lines, that only the chosen list is fetched, the remembered choice, and a browser that refuses storage; suggestions shown with the turn button still above the fold at 390x844 and 844x390, "more", a tap on one starting nothing, the switch remembered, and the `sugg:` token on every turn line.
