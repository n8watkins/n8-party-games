# Tin Derby

Wind-up tin cars race two laps round a breakfast table.
Up to four players, each on their own phone, in the party room's Floor; house cars fill the empty seats and take over a phone that drops.

This folder holds the rules a party room runs, the one data file of numbers, the house cars' driver, the page that shows a race in the party room, and the tests.
It hangs on the Floor's wall (`games.js`, `lobby/wall.js`) in the place its coming-soon box had.

| File | What it is |
| --- | --- |
| `party.js` | `game` and `manifest`, as the kit's contract asks (`party-kit/GAME-CONTRACT.md`) |
| `data/tune.js` | Every tunable number and the table itself (the loop, set pieces, hazards, powers, traits, house habits), as frozen plain data |
| `shared/rules.js` | The race: `makeRules(numbers)` gives `createRace`, `advance`, `game`, `dump`, `load`, `fingerprint` and the rest |
| `shared/course.js` | The table worked out from the data: the loop, the ground, the live kitchen's clocks |
| `shared/house.js` | The house cars' driver |
| `shared/dmath.js` | sin, cos, atan2 built from exact operations only |
| `shared/replica.js` | A page's copy of the race: feed it snapshots and events, ask it for the race now |
| `page/` | The page a party room shows (below, "In the party room"); `split.js` and `map.js` are the big screen's panes and its flat table |
| `tools/` | Scripted players, whole races, a made-up network, the measurements, the parity check against the preview, the cost in workerd |
| `test/` | 159 unit tests: every rule, whole races, balance, determinism, the room, the party room's own rules, the view's test switches, a short smoke; and `e2e-room.mjs`, races in the real party room with real browsers |

## The structure, and why

**The room runs the race and its word is final.**
The room steps the race in fixed steps of 1/120 s, four a tick, thirty ticks a second.
Phones send only what their player holds (a steer and four buttons), never a position or a result.
Bumps, pepper shots, hazards and the finish are all decided in one place, so they are the same for everyone and a leaked room code cannot be used to cheat a result.

The other choice, cars run on each phone with the room judging contacts, was not taken.
It would not make the room cheaper: the room is awake for the whole race either way (a ticking game holds it awake, and four phones sending positions would too), and the race costs it 0.27% of one core.
It would make every bump a disagreement between two phones that the room has to settle after the fact.

**A race is a function of its seed, its seats and its inputs.**
Nothing in the rules reads a clock or calls `Math.random`; chance comes from `hash(seed, n)`.
Every input takes effect at a numbered step.
Angles and distances go through `dmath.js`, because `Math.sin` and friends are allowed to round differently on each engine, and they do: with the engine's own maths, Node (V8) and Bun (JavaScriptCore, the engine of every iPhone browser) ended all eight test races with different bits; with `dmath` they are identical.
So a race can be replayed from its seed and its relayed inputs, house cars are reproducible, and a page can run the same steps as the room.

**What goes over the wire.**
The room sends a whole snapshot once a second, and between snapshots only what a page cannot work out for itself: each input with its step, a seat handed to the house or back, and how far the room has got.
A page keeps its copy in step from those (`shared/replica.js`).
The plain alternative, a snapshot every tick for pages that only draw what they are sent, costs about 97 kB a second to each viewer against 4 to 8 kB; the events are also what make the picture smooth at 60 frames a second from a 30 Hz room.

**The room runs 0.15 s behind its clock** (`NET.DELAY`), so an input stamped by the phone reaches the room before its step and takes effect at exactly the step the phone gave it.
A late input takes effect at the next step.

## For the page

Everything a page needs comes through `makeReplica` (`shared/replica.js`).
A page that only wants to draw what the room has decided uses `replica.auth`; one that wants the player's own car to answer at once uses `replica.predict(now)`.
Both are ordinary race states, the same shape as `load(snapshot)` gives.

```js
import { rules } from "./shared/rules.js";
import { makeReplica } from "./shared/replica.js";

// mount(container, { you, snapshot, send, now }) from the room's page (GAME-CONTRACT.md, "In the browser")
const replica = makeReplica(rules, snapshot, { seat: you.role === "player" ? you.seat : null });
// events(list):        const happened = replica.events(list);   // also returns the race's own events for sound
// snapshot(s, now):    replica.snapshot(s);
// every frame:
const msg = replica.input(now(), steer, go, brake, drift, use);  // null when there is nothing new to say
if (msg) send(msg);
const race = replica.predict(now());                             // or replica.auth, about 0.2 s behind
draw(race, race.cars[replica.car]);
```

### The input message

```js
{ c: [at, steer, go, brake, drift, use], q }
```

- `at`: the room's clock in ms (`now()`) when the page applied it.
- `steer`: -1 (left) to 1 (right); the room rounds it to sixteenths.
- `go`, `brake`, `drift`, `use`: 0 or 1. `use` is a press: it fires once when it goes from 0 to 1.
- `q`: the page's own count of its inputs, 1, 2, 3 ...; optional.
- Send it only when something changed: a button at once, a steer change at most 15 times a second (`NET.SEND_EVERY`). `replica.input` does both. The room takes 20 messages a second from a socket and a message of at most 512 bytes; an input is about 60.
- A tap of Use shorter than a frame must be held by the page until one frame has sent it (the preview's reviewed `app.js` does this). Once sent it cannot be lost: down and up in the same step still fires.
- On a touch screen the preview holds `go` at 1 unless braking.

### The other two messages, and when the house drives

```js
{ h: 1 }      // "still here": replica.beat(now) gives it when the page has said nothing for NET.ALIVE_EVERY (0.25 s)
{ house: 1 }  // "this page cannot show the race: let the house drive my car"
```

- The room drives a player's car with the house while its socket is away (`game.bot`), while its page has said `{house: 1}` (until that page sends hands again), and, once the race is under way, while it has heard nothing at all from the page for `NET.SILENT` (1 s) or nothing yet (a page still loading).
  The next word from the page hands the car back, from the next step.
- So a racing page says hello as soon as it is up, sends a beat whenever it has nothing else to say, and on `visibilitychange` (hidden), `pagehide` and `blur` lets go of every key and sends that at once (`input(..., { force: true })`); hidden, it says nothing more, and the house has the car within a second.
- The room knows the seat by the socket, so `{house: 1}` can only ever give away the sender's own car; it is refused for a house car, a seat not in the race, a finished race, and in any other shape (`test/room.test.js`).

### The events (`game.tick`)

| Event | Meaning |
| --- | --- |
| `{ k: "i", n, c, j, s, b, q? }` | Car `c` holds steer `s` and buttons `b` (1 go, 2 brake, 4 drift, 8 use) from step `n` |
| `{ k: "a", n, c, j, on }` | From step `n` car `c` is driven by the house (`on: 1`: its phone dropped, went silent, or cannot show the race) or is its player's again (`on: 0`) |
| `{ k: "n", n }` | The room has run up to step `n` |

Bumps, spins, laps, pick-ups and the finish are not sent.
A page gets them by running the steps: `replica.events(list)` returns them (`{ k: "bump" | "wall" | "knock" | "hit" | "spill" | "item" | "use" | "pad" | "leap" | "land" | "fall" | "back" | "lap" | "finish" | "lastcall" | "start" | "end" | ..., car, t }`), the same names the preview's `onEvent` already handles.

### The snapshot (`game.snapshot`, once a second, and whole on connect)

About 3 kB of JSON, the same for every viewer.
`rules.load(snapshot)` turns it into a race state; a page should not read the raw form.
The state it gives:

| Field | Unit | Meaning |
| --- | --- | --- |
| `n`, `t` | steps of 1/120 s; seconds | Steps run; race time, negative during the count-in (`t = n / 120 - 3`) |
| `startAt`, `delay` | ms on the room's clock | When the race was made; how far behind its clock the room runs it |
| `over`, `firstFin`, `order` | -, s, car indexes | The race has ended; the first finisher's time (-1 before); cars in finishing order |
| `cars[i]` | | Always four; `i` is the grid slot |
| `.seat`, `.house`, `.auto` | | The room's seat number (negative for a house car); a house car; a player's car the house is driving just now |
| `.name`, `.colour`, `.character`, `.trait` | | For drawing |
| `.x`, `.z`, `.y` | car lengths | On the table, and height above the cloth |
| `.h`, `.mh` | radians | The way it points, and the way it moves (they differ in a slide or a spin) |
| `.v`, `.vy`, `.cap` | car lengths a second | Speed, vertical speed, top speed just now |
| `.u`, `.lat`, `.s` | car lengths | Along the loop (0 to 298.26, `LEN`), across it (+ infield), and distance raced (`s / LEN` is laps) |
| `.st`, `.inSt`, `.inB` | | The wheel, and what the driver holds |
| `.air`, `.fallT`, `.spinT`, `.sneezeT`, `.wobT`, `.boostT`, `.boostKind`, `.phaseT`, `.safeT` | s | What it is doing |
| `.drOn`, `.drDir`, `.drT`, `.drLvl` | | The drift |
| `.item`, `.itemT` | | The power it holds, and the unwrap time left |
| `.lap`, `.fin`, `.finT`, `.place` | | Laps done, finished, its time, its place among all four |
| `cherries`, `drops`, `boxT`, `toast` | | Cherries on the bank, butter pats and pepper shots, when each sweet is back, how much toast is on the road |
| `room.q[i]` | | The highest input number the room has read from car `i` |

The kettle, the toaster, the egg, the syrup and the lazy Susan are not in the snapshot: they are functions of the race's clock (`rules.course.steamAt(n / 120)`, `toasterAt`, `eggAt`, `syrupAt`, `susanThings`).

### Seat, car and phases

- The room's page tells the view who it is: `you = { role: "player", seat }` or a screen. The car is `race.cars.find((c) => c.seat === you.seat)`; `replica.car` is its index, or -1 for a screen or someone who joined mid-race (they watch, and play the next one).
- Countdown: `race.t < 0` (three seconds; cars cannot move; "go" is the `start` event at `t = 0`).
- Racing: `t >= 0` and not `over`. A car with `fin` true has finished and rolls a slow lap of honour.
- Last call: from `firstFin` the rest have `LAST_CALL` (20 s).
- Finished: `race.over`. The room then sends `end` with `result`: `[{ seat, place, time }]` (or `distance` for a car that did not finish), best first, house cars left out. `standings` gives the Tonight board its places.
- No pause: the kit has none for a ticking game, and a paused race would hold the room awake.

### Rates

| What | Rate |
| --- | --- |
| Steps | 120 a second |
| Room ticks | 30 a second (`tickHz`) |
| Events | each tick that has any; "how far" at least 5 a second |
| Snapshots | 1 a second (`snapshotEvery: 30`), and one to any socket that connects |
| Inputs | on change; a steer at most 15 a second |

### Reusing the preview's page (round five, reviewed)

- `art.js`, `table.js`, `sound.js`: as they are. They draw from the track functions (`trackAt`, `groundAt`, `halfAt`, `SHAKERS`, `eggAt`, `susanThings` ...), which are now on `rules.course` with the same names and results, and from `TUNE`, which is `data/tune.js` with the same keys.
- `view.js`: reads the race state. Rename `c.dr.on / .dir / .t / .lvl` to `c.drOn / drDir / drT / drLvl`; everything else it reads has the same name. Give it `replica.predict(now)`.
- `app.js`: its local race (`game.create`, `game.input`, `game.tick`) becomes the replica. Events come from `replica.events(list)` instead of `game.tick`. `state.auto[seat]` is `car.auto`. Its solo and attract races can keep running the rules locally: `rules.createRace({ seats, delay: 0, endless })`, `rules.takeInput`, `rules.advance(state, rules.stepOf(state, now))`, events in `state.ev`.
- `spillAt(u, lat, state)` is now `spillAt(u, lat, tau)` with `tau = state.n / 120`.

## In the party room

The party room mounts `page/party-view.js` (the manifest's `lobby.view`) when the vote's count ends.
As Cork & Bell does, it puts the race page (`page/index.html`) in a frame of the same origin, so taking it away frees everything: listeners, timers, sound and the WebGL context.
The page finds the room's `you`, `snapshot`, `send` and `now` on its frame element (`frameElement.partyHost`) and keeps a replica of the race (`page/main.js`).

- **A player's phone** shows its own car from behind with round five's chase camera, strip, spring, thumbs (slide to steer, it goes by itself, Brake, Drift, Use) and keys.
  Its own inputs go into the replica at once (`replica.predict(now)`), so steering answers before the room has heard it.
  With a big screen in the party it keeps drawing its own car (someone may not see the screen well), and offers a **Controller only** switch: the picture stops, the thumbs grow, and the place, the lap and the power in hand show large; the phone remembers the choice.
- **The big screen** starts on round five's whole table (the owner's choice for now: `SPLIT_BY_DEFAULT` in `page/main.js` is the one-line switch); the host can switch it with one button (or V) to the split view, where the players race, a pane for each player with that player's own chase camera (below, "The big screen"), and the screen remembers the choice.
- **Anyone else** (a phone that joined in the middle of a race) watches the whole table and is told it races in the next one.
- **The count-in** is the 3, 2, 1 and GO of the race itself (three seconds); a page that comes up later joins the race where it is.
- **The end**: once every player is home (and the house cars have had their few seconds) the room ends the game, puts the places on the Tonight board and shows its card; the page is taken away.
- **A dropped phone**: the room's `bot` hands its car to the house (the car paces itself), and back when the phone returns and its page speaks; the returning page starts its replica again from the full snapshot the room sends it, and says "the house is driving your car" meanwhile.
- **A phone that stalls** with its socket still open, or is put away (another tab or app): the room has heard nothing from it for a second, so the house drives its car until it speaks again. A key held when the page was hidden is let go of first.
- **A page that loads late**: the house drives its car from GO until the page's first word; the page then says "Race under way" (and the big screen, which shows no count it missed).
- **A phone that cannot show the race** (no WebGL, a context that cannot be made, or one lost and not restored within 1.5 s), in a party with a big screen: its car is on the big screen, so it becomes a controller ("This phone can't show the race. Steer here: your car is on the big screen.") and keeps sending its hands and beats, so the room knows a real player drives the seat.
  The page hears the big screens come and go (`partyHost.screens` and `on("screens")`, kept current from the room page's optional `room` hook: `lobby/shared/stage.js`, `party-kit/GAME-CONTRACT.md`). When the last one has been gone 10 s (a big screen reloading is back well within it) the controller would be steering blind: it says `{house: 1}` and shows "No big screen now. This phone can't show the race, so the house is driving your car until a big screen is back."; when a screen returns its hands take the car back at once.
  With no big screen in the party it says `{house: 1}` and shows one plain card, "This phone can't show the race. The house is driving your car." (and "Watch the big screen." only where the party has one), with no picture and no buttons.
  A phone that can draw offers the Controller only switch only while there is a big screen, and draws its car again if the last one goes.
- **A big screen that cannot draw in 3D** shows the table as a flat drawing with the cars on it and the places beside it (`map.js`), never a black screen; one that draws 3D in software (SwiftShader, llvmpipe) never starts on the split view by itself.
- **A reload** comes back to the same car from the room's full snapshot.
- **Kept honest**: at every snapshot that is of the same step as its replica (once a second), the page compares the two by `rules.fingerprint`; on any difference, or when the numbered events show it missed one, it starts again from the snapshot.
  A page more than two seconds behind the room's clock (it was asleep) draws the room's word and waits for the next snapshot rather than running the race forward in one frame.
- **Round five's files**: `art.js`, `table.js` and `sound.js` as they were; `view.js` with the drift renames and `me` (whose warning rings grow with distance); each with an import line from `env.js` and an export line.
  three.js is round five's 0.149.0, served from `page/vendor/`, since the site's Content-Security-Policy allows scripts from the site only; for the same reason the page's fonts fall back to the system's (Arial Black, Arial Narrow) and nothing in it uses a style attribute in markup.

- **The big screen's whole table** draws the cars three times their size (true size in its close shots), and its names (2.3% of the screen's height), hint and strip grow with the screen.

### The big screen

The phone is the controller; the big screen is where each player watches their own car (`page/split.js`).
It has one pane per player in the race (house cars get none), each with that player's own chase camera (the phone's `ChaseRig`), framed in the player's colour, and on it their name, place and lap, the power they hold, who is just ahead and behind and how far, and the spring.
Every word on it is at least 2% of the screen's height (2.2% to 3.3%), to be read from a sofa.

| Players | Layout | Why |
| --- | --- | --- |
| 1 | The whole screen; the table from above and the places small in the bottom right corner | The car large; the corner is cloth and scenery in a chase picture |
| 2 | Side by side, the table and the places between them at the bottom | Stacked one above the other was tried (`stills-split/panes-2-stacked-*.png`): each pane, 1920 by 540, spent half its width on the room either side and drew the car half the size, with less road ahead; side by side each is 960 by 1080 with the car large and the road long, and each player has a column of the screen as in the grid |
| 3 | A 2 by 2 grid; the fourth cell holds the table and the places, large | Every pane the same size and shape as with four |
| 4 | A 2 by 2 grid; the table small in the middle, no list (each pane has its place) | The middle is the inner corners of the panes, clear of each car; the bottom right pane's words go to its right, clear of the table |

- **The count-in** is said once across the whole screen; the table in the middle of four panes makes way for it.
- **The finish**: the winner's close shot at the line takes the whole screen in either view (the panes' cameras keep following their cars meanwhile), then each finished player's pane says their place over the live picture until the room shows its card.
- **A dropped phone**: that player's pane carries on, the house driving, and says "The house is driving" over the live picture until the phone is back.
- **A phone that joins mid-race** watches the whole table and races the next one; the big screen keeps its panes.
- **The host's choice**: the big screen starts on the whole table for now (`SPLIT_BY_DEFAULT`); one button (it fades after four quiet seconds; the mouse brings it back) or V switches to the split view and back, remembered on that screen (`localStorage`).
- **No hardware 3D**: a screen that draws 3D in software is never put on the split view by default (one picture a frame, not four; the host can still switch); one that cannot draw 3D at all shows the table from above as a flat drawing with the cars and the places (`page/map.js`), never a black screen.
- **Drawing four pictures**: the split view draws at most `SPLIT_DPR_CAP` (1.25) pixels per CSS pixel, and the frame-rate governor (`page/governor.js`) lowers the resolution of every pane (to half at most) before frames are dropped: after 40 slow frames in a row, measured against the display's own rate, or three frames in a row of a quarter of a second or more; and it raises it again after ten seconds at the display's full rate, which a 60 Hz screen can reach.
- **The middle table with four**: dots of cars running together are eased apart so each stays whole.

Test switches, on the room page's address: `derby-auto=1` (the house's driver holds this phone's hands, through the same path as a thumb), `derby-lag=<ms>` (inputs held back before they are sent), `derby-touch` (thumbs on a computer), `derby-short` (a player's view asks for a test run's short race as it mounts, before the race page has loaded: one lap, a five-second last call) and `derby-tvview=split|table` (the big screen's view, whatever it remembers or draws with).
The short race is decided by the room, not the page: only the test wall runs `testGame` (`party.js`, `lobby/wall.js`), whose races take `{short: 1}` in the count-in and tell everyone (`{k: "len"}`); production's `game` ignores it (`test/room.test.js`, `test/party-view.test.js`).
The gate's step (`npm run test:tin-derby`) is one such race with every trouble at once; the whole-race suite is `npm run test:tin-derby:full`, and whole races, determinism and balance are also checked by the unit tests, in seconds.
They work only where the room has its test games on (`PARTY_TEST_GAMES`, the local environment and the test runs): the view hands them to the page (`partyHost.switches`) only when the wall the server sent has a test box, and the page never reads its own address. In production they do nothing (`test/party-view.test.js`).
The room page's own `lag=<ms>` delays that phone's socket both ways on a local server.

### Measured in the party room

On the owner's PC on 2026-11-16 (a busy machine: load 11 to 25 on 14 threads), `wrangler dev --local` (workerd), browsers on the graphics card.

| What | Figure |
| --- | --- |
| The room in workerd, one race with four cars and one player relaying inputs (`tools/workerd-cost.mjs`) | 1.74 s of CPU over a 68 s race: 0.85 ms a tick, 2.6% of one core, everything the local Worker process did included (the room's sockets and messages, the runtime, the local inspector) |
| The rules alone in Node (`tools/measure.mjs`, below) | 0.09 ms a tick |
| Down to one phone, one player | 3.8 kB a second (3,798 in the browser run, 3,703 on a socket, 11 messages a second) |
| Down to one phone, four players | 5.2 kB a second |
| A frame's prediction on a phone page | 0.6 ms on average, 17 to 23 ms at worst (a loaded machine) |
| 40 ms each way (the room's simulated latency) | the phone's own car: exactly where the room put it (190 steps compared); rivals exactly; no input late (275 sent) |
| 200 ms each way | own car 0.038 car lengths off on average, 0.28 at most (364 steps); rivals 0.0005 on average, 0.047 at most; every one of 593 inputs late, by 4.2 steps (35 ms) on average |

**From a thumb on the phone to the car on the big screen** (`--only=tvlag`): a phone and a big screen, each the same delay from the room both ways, 24 steers (12 presses and 12 releases, half a second apart), timed from the key event on the phone to the first frame each page drew the car holding that steer, on the machine's clock.

| Each way | On the phone | On the big screen |
| --- | --- | --- |
| 40 ms | 16 ms median, 23 at most | 113 ms median, 126 for 90%, 141 at most |
| 200 ms | 13 ms median, 22 at most | 435 ms median, 454 for 90%, 455 at most |

The big screen draws each car from its own copy of the race and the hands the room relays, and it already applies them the moment they arrive, at the step the room gave them, with the same prediction the phone uses (`replica.predict`); what is left is the trip itself: the phone to the room, a wait for the room's next tick (33 ms at most; the kit relays a ticking game's inputs only at its tick), the room to the big screen, and the next frame.
The one saving inside this page was taken: the phone sends its hands on the thumb's own event rather than at its next frame (before, 26 ms median on the phone, and 113 and 444 ms on the big screen: within the noise of one run there).
Relaying an input the moment it arrives instead of at the next tick would save about 16 ms more on average; that is the kit's to change.
What it means: a party in one room, phones and the big screen on the same wifi and a nearby Cloudflare edge (20 to 50 ms each way), sees its steering on the big screen about 0.1 s after the thumb, which is steerable (about what cloud gaming adds); at 200 ms each way (a poor connection) the big screen lags about 0.45 s, too much to steer by, and the phone's own picture (which answers within a frame at any delay) is the one to drive by.

**The big screen's frame rate** (`--only=tvperf`): four players, the big screen at 1920 by 1080, the phones switched to controller only so the big screen is the only page drawing; 12 seconds of frames mid-race.
The owner's PC was busy with other work throughout (load 8 to 30 on 14 threads).

| Drawn by | View | Frames a second | 95% of frames within | The page's own work a frame | Draw calls, triangles |
| --- | --- | --- | --- | --- | --- |
| The graphics card (RX 7800 XT) | four panes | 59.3 (the display's 60) | 16.8 ms | 1.5 ms (12.5 at most) | 227, 404,000 |
| The card, the processor 4x slower | four panes | 60 | 16.7 ms | 6.6 ms (13.3 at most) | 216, 399,000 |
| The same, an earlier run (load 30, each pane still working out the scene's matrices) | four panes | 30, unevenly (127 of 363 frames over 25 ms) | 100 ms | not measured | 216, 371,000 |
| The card, the processor 4x slower | whole table | 60 | 16.8 ms | 4.0 ms | 74, 116,000 |
| SwiftShader (no graphics card) | four panes | 1.4 | 1.6 s | 9.9 ms | 207, 394,000 |
| SwiftShader | whole table | 7 | 0.27 s | 2.2 ms | 71, 115,000 |

There is no laptop graphics chip to try here: a slow laptop is stood in for by Chrome's processor throttling (4x), and a machine with no graphics card by SwiftShader.
Between the 30 and the 60 frames a second with the processor slowed, two things changed and are not told apart: the machine was quieter, and the panes now share one working-out of the scene's matrices a frame.
On the card the four panes are not limited by pixels (its busiest engine stayed under a third); where the processor is the limit, frames come unevenly rather than steadily slow, and lowering the resolution does little: the host's whole-table button is the remedy.
In software the pixels are the limit: the governor lowers every pane's resolution (to half at most) after 40 slow frames in a row, or three in a row of a quarter of a second or more, so at 1.4 frames a second it acts within seconds; the SwiftShader rows were measured before that rule and at full resolution, and a screen that draws in software never starts on the split view by itself anyway.

What the 200 ms run means for steering: the phone turns the car the frame the thumb moves, as at 40 ms; the room takes each input 35 ms later than the phone did, so the car is pulled back by a few hundredths of a length, at most a quarter of a length on a hard turn.
The room runs 0.15 s behind its clock (`NET.DELAY`), so up to about 150 ms one way nothing is late at all.

## Measured

`node floor/games/tin-derby/tools/measure.mjs`, Node 24 on the owner's PC while it was busy (load 14 on 8 cores); CPU time, not wall time.

| What | Figure |
| --- | --- |
| A room tick (four steps, four cars, two of them seats the house is driving) | 0.09 ms of CPU; 2.7 ms a race second, 0.27% of one core |
| The slowest single tick in 43,000 | 6.2 ms of wall time, on a loaded machine |
| Building a snapshot and turning it into text | 0.018 ms |
| A snapshot | 2.9 kB on average, 3.9 kB at most |
| Down to each viewer, 4 players on keys | 4.3 kB a second (events 1.4, snapshots 2.9) |
| Down to each viewer, 4 thumbs that never rest (the most pages may send) | 7.7 kB a second (events 4.7, snapshots 3.0); 28 messages a second |
| Down to each viewer, 1 player and three house cars | 3.5 kB a second |
| Up from each player | 190 bytes a second on keys (3 messages); 890 at the most (14 messages of 63 bytes) |
| A whole race | 240 to 530 kB down to each viewer, 13 to 60 kB up from each player |
| The room is awake | The race: about 68 s with the count-in, never more than 123 s; about 8.8 GB-seconds, less than a round of Cork & Bell (12.1) |

On a made-up network (`tools/net.mjs`), what a phone shows against what the room made of the same step:

| One-way delay | Its own car | Rivals |
| --- | --- | --- |
| 40 ms (in time) | exactly right, every frame | 0.001 car lengths on average, 0.09 at most |
| 200 ms (late) | 0.05 on average, 0.64 at most | 0.03 on average, 1.2 at most |

Not measured: a real phone, a real network (the party room's figures are above).

Balance, 120 seeded races a style on keys (`node tools/race.mjs all 120`), places 1st to 4th, with the loop closed (below): plain 95 / 10 / 15 / 0, first-timer 15 / 19 / 85 / 1, hands off 0 / 0 / 116 / 4; every race finished, no car outside a wall.
Before the loop was closed: 107 / 5 / 8 / 0, 15 / 25 / 78 / 2, 0 / 0 / 117 / 3.
The preview's reviewed copy gave 111 / 6 / 3 / 0, 23 / 23 / 70 / 4 and 0 / 0 / 115 / 5; the differences are the exact maths and the distance rule below.
The tests check 16 races a style each run.

## What differs from round five as reviewed

Numbers: two changed, to close the loop.
The west straight is 10, not 12: the bank is 28 across (radius 14) and the far end was 30 (9 + 12 + 9), so the last corner ended 2 lengths outside the start of the home straight, and in 20 races 137 of 142 crossings moved a car 2 across the road at the seam (5 put it against the wall).
The syrup bottle is at 292, not 294, so it stays at the same point of the shortened corner.
`test/course.test.js` checks the loop closes and that nobody is moved at the seam.
Otherwise `data/tune.js` is the reviewed copy's `tune.js` (Gus's pace 0.78), with one new block, `NET`, for the room: `DELAY` 0.15, `AHEAD` 0.1, `STEER_STEPS` 16, `SEND_EVERY` 0.066, `QUEUE` 32, `BEAT` 6, `CATCH_UP` 480, `ALIVE_EVERY` 0.25, `SILENT` 1.
`tools/parity.mjs <the preview's folder>` runs the preview's `sim.js` beside these rules and compares every car at every frame: with the engine's maths and the rules below switched off they agree exactly (100,000 frames).

Rules that differ, on purpose:

- **Exact maths** (`dmath.js`), so a race is the same on every engine. It agrees with `Math.*` to 1e-15; a given seed's race is not the preview's race bit for bit.
- **Distance raced follows the car.** In the preview a car moved by the lazy Susan, the steam or a post kept its old distance, so a car the turntable carried on finished a length or so past the line. Here every car finishes at the same line.
- **Use is a press that cannot be lost**, even down and up in one step.
- **A finished car is the house's.** In the preview its player's keys still fought the lap of honour.
- **Steering is rounded to sixteenths.**
- **A dropped seat's car** paces itself as an "ace" house car while the house has it, and rolls straight on when handed back until its player's first input.
- **A dome with a `lip`** (round four's kicker) is refused when the rules are built; no dome on this table has one.

## Carried from round five, not changed here

- **Salt and tea do almost nothing at speed.** A slide lets the car's motion follow its nose at 2.0 rad/s (`SLICK_GRIP`), and a car at racing speed cannot turn faster than 1.4 to 1.6.
- **The ghost fades through a post only sometimes**: only when the step that first touches it lands more than 0.05 inside.
- **Driving up any step of 0.3 or more pops the car about 1.2 into the air.**
- Many shape constants are still in the rules, not the data file (knock cooldowns, the cherry's roll, the wall's turn-in): the data file holds what round five's held.

## What the kit lacks

- **The racer** is no longer missing: the party room passes each seat's `character` to `game.create` (`lobby/server/lobby-core.js`), so each player races as the piece they chose (`test/lobby.test.js`).
- **Nothing tells a ticking game that a seat dropped**; it only sees `bot` being called. That is enough, and is what this game uses.
- **`events(list)` in a mounted view carries no clock.** Not needed here, since the room says how far it has got in an event of its own.

## Moving it to its own repository

The contract means a game to be its own package, as Cork & Bell is.
This folder is shaped for that: its rules and page import nothing outside it, and it has its own `package.json` with `"."` as `party.js`.
The site already takes it as a package: `"tin-derby": "file:floor/games/tin-derby"` in `devDependencies`, and `games.js` imports `tin-derby`.
Only the tests reach outside: `room.test.js` takes the kit's `RoomCore` by path (it becomes `n8-party-games/kit/core`), and `lobby.test.js` and `e2e-room.mjs` drive this site's party room, so they would stay here.
The move: copy the rest to a new repository, add the kit as a development dependency, a `vitest.config.js`, a `worker.js` like Cork & Bell's for its own site, and CI; then point the `devDependencies` entry at it.

## Running things

```sh
npx vitest run floor/games/tin-derby                   # the tests (about 40 s)
node floor/games/tin-derby/tools/race.mjs all 120      # the balance sweep
node floor/games/tin-derby/tools/measure.mjs           # the measurements above
node floor/games/tin-derby/tools/fingerprints.mjs --write   # after a meant change to rules or numbers
node floor/games/tin-derby/tools/parity.mjs /path/to/preview
npm run test:tin-derby -- --base=http://localhost:8791        # the gate's step: one short race in the party room, every trouble at once
npm run test:tin-derby:full -- --base=http://localhost:8791   # whole races, real browsers: run this before a change to the game itself (about 10 minutes)
node floor/games/tin-derby/test/e2e-room.mjs --only=lag --base=...   # the 40 and 200 ms runs above
node floor/games/tin-derby/test/e2e-room.mjs --only=panes --panes=1,2,3,4 --out=... --base=...   # the big screen's split view, with stills
node floor/games/tin-derby/test/e2e-room.mjs --only=tvlag,tvperf --base=...   # thumb to big screen, and the big screen's frame rate (below)
node floor/games/tin-derby/tools/workerd-cost.mjs --base=... --pid=<workerd pid>   # the cost in workerd above
```
