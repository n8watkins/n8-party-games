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
- `public/art-code.js`, `public/potato-draw.js`: the code-drawn potato: its SVG renderer and its pure, seeded geometry.
- `public/fonts/`: Lilita One (SIL Open Font License, `LILITA-ONE-OFL.txt`), served from this site.
- `shared/`: the matcher (`logic.js`), the categories (`categories.js`) and their lists, shared with the hearing test in `lab/hot-potato/` and served at `/one-device/hot-potato/shared/`. How the lists are built is in `lab/hot-potato/README.md`; sources and licences in `shared/CREDITS.txt`.
- `test/game.test.js`, `test/potato.test.js`: unit tests (part of `npm test`).
- `test/e2e-game.mjs`: the browser test.

## The potato

The potato is drawn in code in the bold, flat, outlined cartoon style of the art picker's "Specimen", and follows what the owner asked of it:

- An ordinary potato merged with a machine, with no face, ever: a steel plate with a status lamp (a wide pill in a dark bezel, with vent slots, so it reads as a readout and never as an eye), two plugs and their cables, a tether from the plate to the stand, and faint circuit traces under the skin.
- It grows and strains; nothing is bolted on, and nothing first appears as it grows.
  Every part is drawn from the calm start, placed by one seed in the body's own coordinates, so the same pores sit in the same places at every stage and only stretch.
  The marks that tell of strain are there from the start, faint and closed: a pucker where each cable meets the skin, short stretch lines, a faint glow in each pore.
  Growth only deepens them: the creases fan out as the cables pull straight, the stretch lines open and glow, the pores brighten; the tether tilts the plate, the stand's rod sags, and once it presses on the frame both sides bow out together.
  The browser test checks that every stage draws exactly the same parts.
- It stays a potato: it grows rounder and lumpier (knobs all round that swell, bulging over the ends of its stand), not into a flat slab.
- A proper, framed starting point: at first it sits small and calm in its bay, on its stand.
- Growth is one continuous value the stages ease between (with a little cartoon bounce), not swapped pictures.
- Cute and bold, pulsing, never shaking: the only idle motion is a scale about where it rests, slow when healthy and quicker as it strains.
- The light goes green, dim green, yellow, orange, red, then dark when it bursts.
  Getting worse lets out a puff of steam; a right answer makes it settle; the burst pops a splat that shrinks away at full colour, throws chunks that land inside the bay, and leaves a pile of mash on the stand.

With reduced motion it does not breathe or bounce, the steam is skipped and the burst shows its end at once.
It is redrawn only while something moves: still on the start screen, still once the burst has settled, still while paused, and the browser does not draw a hidden page.

### The seam for other art

`art.js` is the only thing the page knows about the potato's look: `createPotatoArt(host, { seed, reducedMotion })` returns `set(state)`, `play(event)`, `look()` and `destroy()`.
The state is `artState(g)` from `game.js`: `stage`, `growth`, `strain`, `light`, `phase` and `paused`; the events are `right`, `worse`, `burst` and `reset`.
A picture-based renderer (painted stages matching this design) can replace the code-drawn one by exporting the same function from `art.js`, with no change to the rules or the screens.

## Tests

- `npm test` runs `test/game.test.js` (the rules against the real lists) and `test/potato.test.js` (the geometry against the owner's rules).
- `npm run test:hot-potato -- --base=http://localhost:PORT` (`node one-device/hot-potato/test/e2e-game.mjs`) plays the game in a headless, muted Chromium against a built site served on that port (run it through `devguard slot --`), with a scripted fake recogniser: whole rounds to the burst in cities (by taps, on a phone) and animals (by keys, on a desktop), the typed fallback, a blocked microphone, three broken recognisers (one that never starts, one that ends at once, one that starts and aborts), pause (and that it holds the keyboard) and a hidden page, what is remembered, storage refused, reduced motion, that the potato is not redrawn when nothing moves, and the layout at 390x844, 320x568, 844x390 and 1280x720.
  It saves stills of every stage of the potato at 390x844 and 1280x720 in `--shots` (default `/tmp/claude-hot-potato-game/shots`).
- `npm run test:hearing -- --base=http://localhost:PORT` runs the hearing test's browser test; its unit tests (`lab/hot-potato/README.md`) cover the matcher and the lists.
- Neither browser test is part of the predeploy gate.

Only a real voice and a real phone can judge how well it hears in a noisy room, how the sounds and vibrations feel, and whether Safari on an iPhone restarts listening within a turn without a new tap.
