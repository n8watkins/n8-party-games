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
6. The fifth miss bursts it; the end screen names who it burst on and shows the chain, with Play again and Change setup.

Escape (or the pause button) pauses; a hidden page pauses by itself, and listening stops until Go on.
The screen is kept on during a round where the browser allows it (Wake Lock).

## Listening, and typing instead

Chrome, Edge and Safari can listen (the Web Speech API).
Where the browser cannot (Firefox, some in-app browsers), the start screen says so and every word is typed instead.
When the microphone is refused, or listening fails, the round goes on by typing and the start screen says how to allow the microphone.
"Type it instead" switches one round to typing, for a loud room.

## Files

- `public/index.html`, `public/style.css`: the screens.
- `public/app.js`: the page: screens, voice, sounds, buzz, pause, keys, storage, wake lock.
- `public/game.js`: the rules of a round, pure (no DOM, no clock of its own): turn order, the fuse and stages, verdicts, appeals, dead ends through the shared matcher, the burst and the end, and `artState()`, all the art is told.
- `public/voice.js`: one turn's listening, restarting the recogniser until it has a word.
- `public/sounds.js`: the sounds (Bell, Knocks, Clock, Crack), made with Web Audio, and the vibration patterns (Tap, Pulse, Climb, Shudder).
- `public/art.js`: the seam between the rules and the potato's look (below).
- `public/art-code.js`, `public/potato-draw.js`: the code-drawn potato: its SVG renderer and its pure, seeded geometry.
- `public/fonts/`: Lilita One (SIL Open Font License, `LILITA-ONE-OFL.txt`), served from this site.
- `shared/`: the matcher (`logic.js`), the categories (`categories.js`) and their lists, shared with the hearing test in `lab/hot-potato/` and served at `/one-device/hot-potato/shared/`. How the lists are built is in `lab/hot-potato/README.md`; sources and licences in `shared/CREDITS.txt`.
- `test/game.test.js`, `test/potato.test.js`: unit tests (part of `npm test`).
- `test/e2e-game.mjs`: the browser test.

## The potato

The potato is drawn in code in the bold, flat, outlined cartoon style of the art picker's "Specimen", and follows what the owner asked of it:

- An ordinary potato merged with a machine, with no face, ever: a steel plate with one status light, two plugs and their cables, a tether from the plate to the stand, and faint circuit traces under the skin.
- It grows and strains; nothing is bolted on.
  Every part exists from the first frame, placed by one seed in the body's own coordinates, so the same pores sit in the same places at every stage and only stretch.
  What appears later is only a consequence of growth: cables pulled straight, creases where they pull, the tether tilting the plate, stretch marks opening, pores glowing through thinner skin, the stand's rod sagging, the frame bowing where it is pushed.
- A proper, framed starting point: at first it sits small and calm in its bay, on its stand.
- Growth is one continuous value the stages ease between (with a little cartoon bounce), not swapped pictures.
- Cute and bold, pulsing, never shaking: the only idle motion is a scale about where it rests, slow when healthy and quicker as it strains.
- The light goes green, dim green, yellow, orange, red, then dark when it bursts.
  Getting worse lets out a puff of steam; a right answer makes it settle; the burst throws chunks that land in the bay and leaves a pile of mash on the stand.

With reduced motion it does not breathe or bounce, the steam is skipped and the burst shows its end at once.

### The seam for other art

`art.js` is the only thing the page knows about the potato's look: `createPotatoArt(host, { seed, reducedMotion })` returns `set(state)`, `play(event)`, `look()` and `destroy()`.
The state is `artState(g)` from `game.js`: `stage`, `growth`, `strain`, `light`, `phase` and `paused`; the events are `right`, `worse`, `burst` and `reset`.
A picture-based renderer (painted stages matching this design) can replace the code-drawn one by exporting the same function from `art.js`, with no change to the rules or the screens.

## Tests

- `npm test` runs `test/game.test.js` (the rules against the real lists) and `test/potato.test.js` (the geometry against the owner's rules).
- `node one-device/hot-potato/test/e2e-game.mjs --base=http://localhost:PORT` plays the game in a headless, muted Chromium against a built site served on that port (run it through `devguard slot --`), with a scripted fake recogniser: whole rounds to the burst in cities (by taps, on a phone) and animals (by keys, on a desktop), the typed fallback, a blocked microphone, pause and a hidden page, what is remembered, storage refused, reduced motion, and the layout at 390x844, 320x568, 844x390 and 1280x720.
  It saves stills of every stage of the potato in `--shots` (default `/tmp/claude-hot-potato-game/shots`).
- The hearing test's own tests (`lab/hot-potato/README.md`) cover the matcher and the lists.

Only a real voice and a real phone can judge how well it hears in a noisy room, how the sounds and vibrations feel, and whether Safari on an iPhone restarts listening within a turn without a new tap.
