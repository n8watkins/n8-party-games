# Hot Potato

The first one-device game of n8games, at `/one-device/hot-potato/`.
One phone or one desktop browser is passed around a group of 2 to 8.
It is a word chain by voice: say a word in the chosen category, and the next person's word must start with the last letter of yours.
Keep the potato alive: right answers keep it steady, wrong answers or silence make it grow and strain, and on the fifth miss it bursts on whoever is holding it.

The page is all there is: no server code, no accounts, nothing sent anywhere by the page.
It keeps the category, the number of players and the sound and buzz switches in this browser's storage, and works without it.
The browser's own speech service may send what it hears to its maker.

## How a round goes

1. The start screen: a category (cities, countries, animals, food and drink, anything), 2 to 8 players, Sound (off until tapped) and Buzz (vibration, where the device has it).
2. The potato is passed to a player, who taps their button (or presses Space or Enter) to start the turn.
   The fuse does not burn while it is being passed, nor before the microphone is on.
3. The fuse burns: 10 seconds when healthy, then 9, 8, 7 and 6 as it gets worse.
   A word heard is judged by the shared matcher (rules m3, see `lab/hot-potato/README.md`), and the verdict says why in plain words: `"Salmon" is not a city`, `Paris starts with P, not S`, `Lima was said already`, `Too slow`.
4. Right: it settles (damage stays; it does not heal) and the letter moves on, skipping back past dead-end letters (`Y is a dead end, so E`).
   Wrong or too slow: it gets worse by one stage and the potato passes on.
5. Every verdict has one appeal ("That was right" on a refusal, "That was wrong" on an acceptance), usable until the next turn starts, because recognisers mishear.
   An appeal on the fifth miss can still save it in the moment before it bursts.
   House rule: the group has the last word, so any refused word can be called right, even one the game is sure is not in the category.
   The only exception is a refusal with no word in it (silence, or nothing readable such as "???"), which offers no "That was right": there would be nothing to put in the chain.
6. The fifth miss bursts it; the end screen names who it burst on and shows the chain, with Play again and Change setup.
   Each new round starts with the next player along.

Escape (or the pause button) pauses; a hidden page pauses by itself, and listening stops until Go on.
While paused, the game behind the pause box is inert (Tab stays in the box), and Go on puts the keyboard back where it was.
The screen is kept on during a round where the browser allows it (Wake Lock).

## Listening, and typing instead

Chrome, Edge and Safari can listen (the Web Speech API).
Where the browser cannot (Firefox, some in-app browsers), the start screen says so and every word is typed instead.
When the microphone is refused, or listening fails, the round goes on by typing and the start screen says how to allow the microphone.
"Type it instead" switches one round to typing, for a loud room.

A turn never waits for ever on the microphone.
The fuse is lit when the recogniser says it has started; if it has not after 4 seconds, that turn is typed instead, saying why, and the next turn listens again.
When a recognition session ends having heard nothing, the next starts by itself; sessions that end almost at once are restarted with a growing wait (150 ms, doubling, at most 2 s), and after 4 of those in a row, or 12 restarts in one turn, that turn is typed instead.

## Files

- `public/index.html`, `public/style.css`: the screens.
- `public/app.js`: the page: screens, voice, sounds, buzz, pause, keys, storage, wake lock.
- `public/game.js`: the rules of a round, pure (no DOM, no clock of its own): turn order, the fuse and stages, verdicts, appeals, dead ends through the shared matcher, the burst and the end, and `artState()`, all the art is told.
- `public/voice.js`: one turn's listening, restarting the recogniser until it has a word.
- `public/sounds.js`: the sounds (Bell, Knocks, Clock, Crack), made with Web Audio, and the vibration patterns (Tap, Pulse, Climb, Shudder).
- `public/art.js`: the seam between the rules and the potato's look (below).
- `public/art-specimen.js`, `public/specimen-draw.js`: the Specimen, the default potato: its SVG renderer and its pure drawing (faces, motion, the scene).
- `public/art-code.js`, `public/potato-draw.js`: the plain, faceless potato on a steel stand, kept for comparison (`#plain` in the address).
- `public/fonts/`: Anton (SIL Open Font License, `ANTON-OFL.txt`), served from this site.
- `shared/`: the matcher (`logic.js`), the categories (`categories.js`) and their lists, shared with the hearing test in `lab/hot-potato/` and served at `/one-device/hot-potato/shared/`. How the lists are built is in `lab/hot-potato/README.md`; sources and licences in `shared/CREDITS.txt`.
- `test/game.test.js`, `test/specimen.test.js`, `test/potato.test.js`: unit tests (part of `npm test`).
- `test/e2e-game.mjs`: the browser test; `test/stills.mjs`: stills of every screen and a contact sheet of every face, for looking at.

## The look

The screens and the potato are the Game Art Picker's first Hot Potato look, "The Specimen", which the owner picked: a deep navy screen with a lighter diagonal band, bold condensed capitals (Anton) slanted a little, yellow and green on ink, thick dark outlines and flat colours.
The phone is passed round and read upright.
On a turn: the category on a yellow tag and who is up, the lives and the fuse, the potato in its rig, the last word with the letter the next word needs boxed in yellow, and the green microphone (the go button while it is passed, "Say it now" while it listens) beside the giant letter.
The ground heats with the potato: navy, blue, teal, purple, then magenta with a slow pink pulse; a verdict tints it green or red for a moment under a big "Yes!" or "Nope!" (or "Too slow!", "Again?", "Overturned!"); the burst flashes it white and names who was holding it.

## The potato

The Specimen is the picker's drawing, ported: an angular, faceted tan potato with a face, held in a lab rig (two antennas with bulbs, a test tube each side, two clamp arms and a tray with four lights).

- It grows at every stage, about the point it sits on, past the clamps; growth is one continuous value the stages ease between, with a little cartoon bounce.
- The same potato in the same rig at every stage: every part is drawn from the start and only shown, sized or moved, so nothing is added; the browser test checks the same parts at every stage.
- It heats as the picker drew it: greener skin, lumps crawling under it, glowing veins, sprouts pushing out, a third eye once it strains.
  The rig reacts as well: the clamps strain open (creaking once it strains), the tubes fill and bubble over, one bulb flickers, then sparks fly to the potato and the bulbs flash pink, the tray's lights go out one by one, the tray cracks.
- Its face follows the stage, from several per stage (the picker's own first, then a choice by the round's seed that changes between turns): deadpan, side-eye, smug, a yawn, dozing; one brow up, a squint, uneasy; a gasp, gritted teeth, worried and sweating; three eyes, cross-eyed, a grimace; a screech, panic, a scream.
  Listening, it looks up, and once the fuse burns its eyes follow the spark.
  Between turns it blinks, glances at whoever is up and sighs.
  A verdict shows a reaction for a moment: relieved or proud on a right answer, sheepish when the group calls a refusal right, a flinch on a wrong word, jolted awake by silence, an eye-roll at a repeat, betrayed when its word is overturned; the last miss panics until it bursts.
  `test/stills.mjs` saves a contact sheet of every face.
- The burst is the picker's: a splat with "BREACH!" and chunks flying out, the clamps flung wide; `reset` brings a fresh, deadpan potato.
- Motion is the picker's breathing (calm), twitch (warm) and throb (hot and after): scales about where it sits, a few degrees of skew in the twitch and a degree or so of rock at the end; never a shake, and the screen never moves.

With reduced motion it does not move (faces still change) and the burst shows its end at once.
It is redrawn only while something moves: still on the start screen, still once the burst has settled, still while paused, and the browser does not draw a hidden page.

### The seam for other art

`art.js` is the only thing the page knows about the potato's look: `createPotatoArt(host, { seed, reducedMotion })` returns `set(state)`, `play(event, detail)`, `look()` and `destroy()`.
The state is `artState(g)` from `game.js`: `stage`, `growth`, `strain`, `fuse`, `light`, `phase` and `paused`; the events are `right`, `worse`, `doom`, `burst` and `reset`, with the verdict's reason as `detail`.
It picks the Specimen, or the plain potato with `#plain` in the address; another renderer can take their place by exporting the same function, with no change to the rules or the screens.

## Tests

- `npm test` runs `test/game.test.js` (the rules against the real lists), `test/specimen.test.js` (the Specimen against the owner's rules: the same parts at every stage, faces that follow the state, no shake, a drawing loop that stops) and `test/potato.test.js` (the plain potato's geometry).
- `npm run test:hot-potato -- --base=http://localhost:PORT` (`node one-device/hot-potato/test/e2e-game.mjs`) plays the game in a headless, muted Chromium against a built site served on that port (run it through `devguard slot --`), with a scripted fake recogniser: whole rounds to the burst in cities (by taps, on a phone) and animals (by keys, on a desktop), the typed fallback, a blocked microphone, three broken recognisers (one that never starts, one that ends at once, one that starts and aborts), pause (and that it holds the keyboard) and a hidden page, what is remembered, storage refused, reduced motion, that the potato is not redrawn when nothing moves, its faces and reactions, that nothing shakes, one pass with `#plain`, and the layout at 390x844, 320x568, 844x390 and 1280x720.
  It saves stills of every stage of the potato at 390x844 and 1280x720 in `--shots` (default `/tmp/claude-hot-potato-game/shots`).
- `node one-device/hot-potato/test/stills.mjs --base=http://localhost:PORT` saves stills of every screen at those four sizes and the faces' contact sheet in `--out` (default `/tmp/claude-hp-game/specimen-stills`).
- `npm run test:hearing -- --base=http://localhost:PORT` runs the hearing test's browser test; its unit tests (`lab/hot-potato/README.md`) cover the matcher and the lists.
- Neither browser test is part of the predeploy gate.

Only a real voice and a real phone can judge how well it hears in a noisy room, how the sounds and vibrations feel, and whether Safari on an iPhone restarts listening within a turn without a new tap.
