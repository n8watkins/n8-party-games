# Hot Potato hearing test

An unlisted, throwaway test page at `/lab/hot-potato/` that answers one question: can a browser's own speech recognition hear spoken city names well enough, and fast enough, for the Hot Potato word-chain game?
It works the same in a desktop browser with a laptop, desk or headset microphone and on a phone.
Nothing is stored or sent by the page; the browser's speech service may send the audio to its maker.

## Files

- `public/index.html`, `public/style.css`, `public/app.js`: the page.
- `public/logic.js`: the pure rules and the matcher (no DOM), shared with the unit tests.
- `public/device.js`: which device and kind of microphone the page is on, for the report.
- `public/cities.json`: GeoNames places, built by `tools/make-cities.py`.
- `public/words.json`: ordinary English words and common names, built by `tools/make-words.py`.
- `tools/famous-places.txt`: famous places kept in the default list by hand.
- `tools/replay-report.mjs`: replays a copied report through the current matcher.
- `test/logic.test.js`, `test/device.test.js`: unit tests (part of `npm test`).
- `test/fixtures/hearing-report-1.txt`: the owner's first real run (v1, desktop Chrome on Windows, 20 turns).
- `test/e2e-hearing.mjs`: the page in a headless, muted Chromium with a scripted fake recogniser.

## Matching rules, version m2

Each turn line in the copied report starts with the rules version (`m2`), so reports from different versions can be compared.

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
   Hard mode (a switch, off by default) adds every town over 15,000.
   A city heard exactly that is only in the full list is refused in the default list with "only in hard mode".
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

Download the files listed at the top of `tools/make-words.py` and `tools/make-cities.py` into an empty folder of their own, then:

```sh
python3 -I lab/hot-potato/tools/make-words.py <en_50k.txt> <scowl final/> <census folder> lab/hot-potato/public/words.json <date>
python3 -I lab/hot-potato/tools/make-cities.py <geonames folder> lab/hot-potato/public/words.json lab/hot-potato/tools/famous-places.txt lab/hot-potato/public/cities.json <date>
```

Sources and licences are in `public/CREDITS.txt`.

## Tests

- `npm test` runs the unit tests, including the 20 turns of the first report, about 60 well-known cities and 100 ordinary words and names.
- `node lab/hot-potato/test/e2e-hearing.mjs --base=http://localhost:8875` checks the page in a headless, muted Chromium against a built site served on that port (run it through `devguard slot --`).
