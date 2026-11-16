# Tin Derby: the race rules

Wind-up tin cars race two laps round a breakfast table.
Up to four players, each on their own phone, in the party room's Floor; house cars fill the empty seats and take over a phone that drops.

This folder is the part with no taste in it: the rules a party room runs, the one data file of numbers, the house cars' driver, and the tests.
There is no page here yet, and the game is not on the wall or in `games.js`.

| File | What it is |
| --- | --- |
| `party.js` | `game` and `manifest`, as the kit's contract asks (`party-kit/GAME-CONTRACT.md`) |
| `data/tune.js` | Every tunable number and the table itself (the loop, set pieces, hazards, powers, traits, house habits), as frozen plain data |
| `shared/rules.js` | The race: `makeRules(numbers)` gives `createRace`, `advance`, `game`, `dump`, `load`, `fingerprint` and the rest |
| `shared/course.js` | The table worked out from the data: the loop, the ground, the live kitchen's clocks |
| `shared/house.js` | The house cars' driver |
| `shared/dmath.js` | sin, cos, atan2 built from exact operations only |
| `shared/replica.js` | A page's copy of the race: feed it snapshots and events, ask it for the race now |
| `tools/` | Scripted players, whole races, a made-up network, the measurements, the parity check against the preview |
| `test/` | 130 tests: every rule, whole races, balance, determinism, the room, a short smoke |

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

### The events (`game.tick`)

| Event | Meaning |
| --- | --- |
| `{ k: "i", n, c, j, s, b, q? }` | Car `c` holds steer `s` and buttons `b` (1 go, 2 brake, 4 drift, 8 use) from step `n` |
| `{ k: "a", n, c, j, on }` | From step `n` car `c` is driven by the house (`on: 1`, its phone dropped) or is its player's again (`on: 0`) |
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
| `.u`, `.lat`, `.s` | car lengths | Along the loop (0 to 300.27), across it (+ infield), and distance raced (`s / LEN` is laps) |
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

Not measured: the Workers runtime itself (it is the same V8 as Node), a real phone, a real network.

Balance, 120 seeded races a style on keys (`node tools/race.mjs all 120`), places 1st to 4th: plain 107 / 5 / 8 / 0, first-timer 15 / 25 / 78 / 2, hands off 0 / 0 / 117 / 3.
The preview's reviewed copy gave 111 / 6 / 3 / 0, 23 / 23 / 70 / 4 and 0 / 0 / 115 / 5; the differences are the exact maths and the distance rule below.
The tests check 16 races a style each run.

## What differs from round five as reviewed

Numbers: none changed.
`data/tune.js` is the reviewed copy's `tune.js` (Gus's pace 0.78), with one new block, `NET`, for the room: `DELAY` 0.15, `AHEAD` 0.1, `STEER_STEPS` 16, `SEND_EVERY` 0.066, `QUEUE` 32, `BEAT` 6, `CATCH_UP` 480.
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

- **The loop does not close.** The bank is 28 across and the far end 30 (9 + 12 + 9), so the last corner ends 2 lengths outside the start of the home straight. In 20 races, 137 of 142 crossings moved the car 2 across the road at the seam, and 5 put it against the wall. Making the west straight 10 (`["S", 10, { tag: "west" }]`) closes it. A test marked as a known failure (`test/course.test.js`) will say when it is fixed.
- **Salt and tea do almost nothing at speed.** A slide lets the car's motion follow its nose at 2.0 rad/s (`SLICK_GRIP`), and a car at racing speed cannot turn faster than 1.4 to 1.6.
- **The ghost fades through a post only sometimes**: only when the step that first touches it lands more than 0.05 inside.
- **Driving up any step of 0.3 or more pops the car about 1.2 into the air.**
- Many shape constants are still in the rules, not the data file (knock cooldowns, the cherry's roll, the wall's turn-in): the data file holds what round five's held.

## What the kit lacks

- **The racer.** The party room knows each player's character (`members[seat].character`) but does not pass it to `game.create`, so every player is a pawn and the traits go to the house cars. `create` already reads `seats[i].character`; the room needs one more field in its seat rows (`lobby/server/lobby-core.js`).
- **Nothing tells a ticking game that a seat dropped**; it only sees `bot` being called. That is enough, and is what this game uses.
- **`events(list)` in a mounted view carries no clock.** Not needed here, since the room says how far it has got in an event of its own.

## Moving it to its own repository

The contract means a game to be its own package, as Cork & Bell is.
This folder is shaped for that: it imports nothing outside itself (the tests import the kit's `RoomCore` by path, which becomes `n8-party-games/kit/core`), and it has its own `package.json` with `"."` as `party.js`.
The move: copy the folder to a new repository, add the kit as a development dependency, a `vitest.config.js`, a `worker.js` like Cork & Bell's for its own site, and CI; then add it to this site's `devDependencies` and `games.js`, and remove `floor/games/**` from this repository's test list.

## Running things

```sh
npx vitest run floor/games/tin-derby                   # the tests (about 40 s)
node floor/games/tin-derby/tools/race.mjs all 120      # the balance sweep
node floor/games/tin-derby/tools/measure.mjs           # the measurements above
node floor/games/tin-derby/tools/fingerprints.mjs --write   # after a meant change to rules or numbers
node floor/games/tin-derby/tools/parity.mjs /path/to/preview
```
