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
The ground heats with the potato: navy, blue, teal, purple, then magenta with a slow pink pulse; a verdict tints it green or red for a moment under a big "Yes!" or "Nope!" (or "Too slow!", "Again?", "Overturned!"), while the appeal stays in full view; the burst lights it up briefly and names who was holding it.
The pulse stays soft enough that every word keeps 4.5:1 at its brightest; the lives are solid blocks, and lost ones empty outlines, so they read by shape as well as colour (`test/contrast.test.js` checks both against `style.css`).
Sideways on a small phone the start screen puts the title over the potato and the setup down the right, so a note (this browser cannot listen, the microphone is blocked) still fits.

### The layouts

The same screens, in the same order, on a phone or a computer, laid out for the screen they are on (container queries on the screen in `style.css`, "The layouts"):

| Layout | When | How |
| --- | --- | --- |
| Phone upright | narrower than 600, taller than wide | who is up beside the category at the top, the potato in the middle, the turn under it |
| Phone sideways | wider than tall, under 500 high | the potato on the left; on the right the top bar, then the turn centred: the last word, the microphone beside the letter, the verdict, the buttons |
| Roomy upright | 600 wide or more, taller than wide (tablets, a portrait monitor) | as on a phone, but the turn is one centred group led by who is up, and everything scales with the screen |
| Roomy wide | wider than tall, 500 high or more (tablets sideways, laptops, desktops, TVs, ultrawide) | the potato on the left (about 45%); on the right the category with sound and pause, the lives and the fuse as one long bar, then one centred group: who is up, the last word, the microphone beside the giant letter, what is heard, the verdict, the buttons, the keys |

Type is fluid (clamp) between a readable floor and a ceiling, so the last word and the letter stay the biggest words on any screen; on a 1080-high screen the letter is 324 px.
An ultrawide screen keeps the 16:9 proportions, centred on the band.
On the wide layout the start and end screens are one group centred on the height, with no gap between the pitch and the categories; a long chain scrolls in its own box.
The keys (Space or Enter starts a turn, Esc pauses) show wherever the main pointer is a mouse or trackpad; Buzz shows only on a touch device that can vibrate (desktop Chrome has the call but nothing to vibrate).
A typed word takes the keyboard at once, and Enter sends it.
Resizing a window or turning a phone re-lays the same screen: the turn, the fuse and the listening go on, and the potato's drawing refits its new box.

## The potato

The Specimen is the picker's drawing, ported: an angular, faceted tan potato with a face, held in a lab rig (two antennas with bulbs, a test tube each side, two clamp arms and a tray with four lights).

- It grows at every stage, about the point it sits on, past the clamps; growth is one continuous value the stages ease between, with a little cartoon bounce.
- The same potato in the same rig at every stage: every part is drawn from the start and only shown, sized or moved, so nothing is added; the browser test checks the same parts at every stage.
- It heats as the picker drew it: greener skin, glowing spots under it (away from its face), glowing veins, sprouts pushing out, a third eye once it strains.
  The rig reacts as well: the clamps are pushed open (creaking once it strains), the tubes fill and bubble over, one bulb flickers, then sparks fly to the potato and the bulbs flash pink, the tray's lights go out one by one, the tray cracks.
- Its face follows the stage, from several per stage (the picker's own first, then a choice by the round's seed that changes between turns): deadpan, side-eye, smug, a yawn, dozing; one brow up, a squint, uneasy, whistling innocently; a gasp, gritted teeth, worried and sweating, a wince; three eyes, cross-eyed, a grimace; a screech (a cartoon wail with buck teeth and a tongue), panic, a scream.
  Thirty faces in all, with the listening face and the reactions below: cute, never scary.
  Listening, it looks up, and once the fuse burns its eyes follow the spark.
  Between turns it blinks, glances at whoever is up and sighs.
  A verdict shows a reaction for a moment: relieved or proud on a right answer, sheepish when the group calls a refusal right, a flinch on a wrong word, jolted awake by silence, an eye-roll at a repeat, betrayed when its word is overturned; the last miss panics until it bursts.
  `test/stills.mjs` saves a contact sheet of every face.
- The burst is the picker's: a splat with "BREACH!" and chunks flying out, the clamps springing open (they stay in the rig), a brief light flash; `reset` brings a fresh, deadpan potato.
- The drawing's view holds all of it, the potato at its biggest and shakiest, the sprouts, the sweat and the burst, so nothing leaves the screen (`test/specimen.test.js` and the browser test check it).

### How stressed it is

Between two lost lives there are finer steps.
The rules hand the art a `stress`, 0 to 1 within the stage (`stressOf` in `game.js`): the stage's baseline (0 after one miss, 0.25 after two in a row, 0.45 after three or more), climbing while a turn's fuse burns (up to 90% of the way to 1), easing by 0.3 after a right answer, and 1 on the last miss.
The rules of losing do not change.
The Specimen acts on one level, the stage plus 0.7 of the stress (`levelOf`), so a slow turn visibly winds it up, an answer calms it a notch, and a lost life is always a clear jump to the next stage.
Its `LADDER` (in `specimen-draw.js`) sets every sign at each level, eased in between:

| Level | Breath | Blinks | Eyes | Sweat | Shaking | Rig |
| --- | --- | --- | --- | --- | --- | --- |
| Calm (0) | slow and deep, 6 s | lazy, every 4.2 s | glances, sighs | none | none | clamps shut, all lights on |
| Warm (1) | 4.6 s | every 2.6 s | dart about | a bead forms and rolls now and then | none | a bulb flickers, clamps nudged |
| Hot (2) | 3.4 s, a throb of 5% | every 2 s | dart | three beads, rolling faster | short shivers every 3.2 s | a light out, sparks, clamps pushed |
| Strain (3) | 2.6 s, throb 7% | every 1.7 s | dart | four beads, drops flung off | a steady fine tremble | two lights out, clamps creak with each beat, pink alarms |
| Critical (4) | 2 s, bulging throb 9% | every 1.5 s | dart | four beads, more drops flung | a hard shake in its rig | three lights out (the last flickers), tubes overflowing |

Within each stage the stress also moves the clamps, the tray lights (the next one flickers before it goes), the tubes, the bulbs' pace, the sweat and a slight size creep (up to 4%); the life at risk and the fuse warm from yellow to pink with it.
Only the potato moves, inside its own drawing: the screen, the layout, the text and the potato's box never do.
With reduced motion it does not move at all (faces still change): the stress shows in still signs (the sweat, the face, the colour, the rig) and the burst shows its end at once.
`test/stills.mjs` saves a strip of each stage's stress steps and twelve frames of each stage's motion over one second.

It is redrawn only while something moves: still on the start screen, still once the burst has settled, still while paused, and the browser does not draw a hidden page.

### The seam for other art

`art.js` is the only thing the page knows about the potato's look: `createPotatoArt(host, { seed, reducedMotion })` returns `set(state)`, `play(event, detail)`, `look()` and `destroy()`.
The state is `artState(g)` from `game.js`: `stage`, `growth`, `stress`, `strain`, `fuse`, `light`, `phase` and `paused` (the plain potato ignores `stress`); the events are `right`, `worse`, `doom`, `burst` and `reset`, with the verdict's reason as `detail`.
It picks the Specimen, or the plain potato with `#plain` in the address; another renderer can take their place by exporting the same function, with no change to the rules or the screens.

## Tests

- `npm test` runs `test/game.test.js` (the rules against the real lists, and the stress they hand the art), `test/specimen.test.js` (the Specimen against the owner's rules: the same parts at every stage, faces that follow the state and are never scary, the stress ladder rising at every step with no tremble when calm and nothing moving with reduced motion, everything inside its drawing, a drawing loop that stops), `test/contrast.test.js` (the colours in `style.css`) and `test/potato.test.js` (the plain potato's geometry).
- `npm run test:hot-potato -- --base=http://localhost:PORT` (`node one-device/hot-potato/test/e2e-game.mjs`) plays the game in a headless, muted Chromium (on the graphics card with `TEST_GPU=1`) against a built site served on that port (run it through `devguard slot --`), with a scripted fake recogniser: whole rounds to the burst in cities (by taps, on a phone) and animals (by keys, on a desktop), the typed fallback (and that it fits at 320 wide), a blocked microphone, three broken recognisers (one that never starts, one that ends at once, one that starts and aborts), pause (and that it holds the keyboard, and where the keyboard goes when it ends straight after a verdict) and a hidden page, the appeal in full view through a verdict, what is remembered, storage refused, reduced motion, that the potato is not redrawn when nothing moves, its faces and reactions, that the stress climbs during a slow turn, that the screen and the layout never move while the potato shakes, that the last stage and the burst stay inside the screen with a light flash, the start screen's notes on sideways phones (568x320, 667x375, 740x340, 844x390), one pass with `#plain`, and the layout at 390x844, 320x568, 568x320, 844x390 and 1280x720.
  It begins with the layout walk: every key screen (start, ready, listening, a verdict with its appeal, a typed turn, the pause, the last stage, the burst, the end) at 17 sizes (320x568, 360x640, 390x844, 430x932, 568x320, 667x375, 844x390, 932x430, 768x1024, 1024x768 and 820x1180 by touch; 1280x720, 1366x768, 1440x900, 1920x1080, 2560x1080 and 1080x1920 by mouse), resized in place without touching the round: nothing outside the screen, cut short, overlapping or scrolling, every control at least 40 px, the potato filling its box, and the last word and the letter the biggest words (the letter at least 16% of the shorter side, 22% from 600 up; the word at least 7%).
  Then a phone turned both ways and a window resized and maximised in the middle of a listening turn: the same turn, the fuse burning, listening not restarted, the potato refitted, the word counted.
  `--only=layout` runs just that part (about a minute).
  It saves stills of every stage of the potato at 390x844 and 1280x720 in `--shots` (default `/tmp/claude-hot-potato-game/shots`).
- `node one-device/hot-potato/test/screens.mjs --base=http://localhost:PORT` saves stills of the key screens at all 17 sizes in `--out` (default `/tmp/claude-hp-game/responsive-stills`; `--sizes=390x844,1280x720` for a few).
- `node one-device/hot-potato/test/stills.mjs --base=http://localhost:PORT` saves stills of every screen at 390x844, 320x568, 568x320, 844x390 and 1280x720 (and of the start screen's note and a typed turn), the faces' contact sheet, each stage's stress steps and twelve frames of each stage's motion, in `--out` (default `/tmp/claude-hp-game/specimen-stills`).
- `npm run test:hearing -- --base=http://localhost:PORT` runs the hearing test's browser test; its unit tests (`lab/hot-potato/README.md`) cover the matcher and the lists.
- Both browser tests are steps of the predeploy gate (`npm run predeploy`, see `AGENTS.md`).

Only a real voice and a real phone can judge how well it hears in a noisy room, how the sounds and vibrations feel, and whether Safari on an iPhone restarts listening within a turn without a new tap.
