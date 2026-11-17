# The game contract

What a game package gives the party site so the site can host it.
It is as small as what exists today needs.
Cork & Bell (`n8watkins/cork-and-bell`) is the first game that keeps it.

A game is its own repository and its own npm package.
It plays on its own (`npm install`, `npm run dev`) with the kit as a development dependency.
The party site installs the game as a development dependency and serves it beside the others.

## What the package exports

The package's main export is one module with two names.

```js
// party.js, the "." export of the game's package.json
export { game } from "./game/shared/battle.js";

export const manifest = {
  id: "cork-and-bell",          // also the game's id for the room and for its score board
  name: "Cork & Bell",
  path: "/cork-and-bell/",      // the route prefix: the game's page and files live under it on every site
  players: { min: 2, max: 4, solo: true },
  devices: { phone: true, desktop: true, sharedScreen: true, sideways: "preferred" },
  scores: { max: 243300 },      // optional: a high score board, and the most a round can score
  public: [                     // what a browser loads, copied to <path>/<to> by the site's build
    { from: "index.html", to: "index.html" },
    { from: "game", to: "game" },
  ],
};
```

| Name | What it is |
| --- | --- |
| `game` | The server game definition for `createPartyRoom(game)`: `id`, `minSeats`, `maxSeats`, `tickHz`, `snapshotEvery`, `create`, `input`, `bot`, `tick`, `snapshot`, `isOver`, `result` (see the kit's README, "The game object" and "Per-seat views"). A turn-based game (`tickHz: 0`) may add `nextDeadline`, `serialize`, `restore`, `reconnectGraceMs`, `presence`, `abandon`, `idleShutdownMs` and `staleRoomMs` ("Turn-based games" and "Who is here during a turn-based game" below). Any game may add `settings` and `carry` ("Settings after the vote" and "What a rematch carries"). |
| `manifest.id` | A short name in lower case with dashes. It matches `game.id`. |
| `manifest.name` | The name people read. |
| `manifest.path` | Where the game lives on a site, with a slash at both ends. The same on the party site and on the game's own site, so a join link works on either. |
| `manifest.players` | Seats in a room (`min`, `max`) and whether it also plays alone in the browser (`solo`). |
| `manifest.devices` | What it is played on, for the lobby to show: `phone`, `desktop`, `sharedScreen` (a screen that holds no seat), and `sideways` (`"preferred"`, `"required"` or `false`). Optional `upright: true`: the game is laid out for a phone held upright, and the party room stops asking for sideways while it is played ("An upright game"). |
| `manifest.audience` | Optional. `true`: a party larger than `players.max` may vote for the game; its players are chosen on spots and everyone else watches as its audience ("Fewer seats than the party"). |
| `manifest.scores` | Optional. `{ max }`: the game has a high score board, and no round can score more than `max`. The host binds the kit's `ScoreBoard` and answers `/api/party/scores/<id>`. |
| `scoreRun` | Optional, beside `game` and `manifest`, for a game with a board: `scoreRun(run) -> score \| null` plays a run again from what its page sent and the seed the board handed out (`run.seed`). The host passes it to the board (`{ max, scoreRun }`, `games.js` `SCORE_BOARDS`), which then hands out each run's seed and chalks up only this score, never one a page sends (party-kit README, "The score board"). Cork & Bell's is `game/shared/run.js`. |
| `manifest.public` | Files and folders the browser loads, relative to the package root. Nothing else in the package is served. |
| `manifest.settings` | Optional, and required with `game.settings`: the choices the host is offered after the vote ("Settings after the vote"). |

## Rules a game keeps

- **Server code names no kit.** `game` and everything it imports is plain JavaScript with no import from the kit, so a site's bundle holds one copy of the kit: the site's own. A game's own `worker.js` imports the kit as `n8-party-games/kit`; the party site resolves that name to its local folder (the `alias` in `wrangler.jsonc` and `vitest.config.js`).
- **Browser code takes the kit by site path.** The kit's browser files are served at `/party-kit/client/` on every site: `import { PartyClient } from "/party-kit/client/party-client.js"`, `<link rel="stylesheet" href="/party-kit/client/lobby.css">`. The game never bundles or copies them into its own folder.
- **The game's own files stay under its path.** Pages and scripts refer to each other with relative addresses, and to the API as `/api/party/...`.
- **Everything served is listed.** The site's build copies `manifest.public` and the kit's client and nothing else (`buildPublic` in `n8-party-games/kit/build`).
- **The package has no `prepare` script** and its `files` list holds what a host needs: `party.js`, the public files, and the tools a host may run.
- **Secrets stay in the views.** A game that hides something from some seats does it in `snapshot(state, now, viewer)` and with `only` on its events (the kit's README, "Per-seat views"); anything else it hands the room (`result`, `standings`) goes to everyone. An unknown viewer is treated as a screen. The room never sends its seed, and a game with secrets does not draw them from its round seed.

## What a site does with it

```js
// worker.js of a site (the party site, or a game's own)
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, handlePartyApi } from "n8-party-games/kit";
import { game, manifest } from "cork-and-bell";   // a game's own site: "./party.js"

export const PartyRoom = createPartyRoom(game);
export { PinDirectory, RateLimiter, RoomBudget };
```

A game's own page makes rooms of that one game: one room class, one game.
On the party site the party room (the lobby) is a second room class beside it, and it is the one that holds several games (below).

## The lobby hooks

The party room keeps a group in one room while it switches games.
This is how a game plugs into it.
Two games go through it.
Cork & Bell, from its own repository, is the real one: the room runs its `game` and the page mounts the view its manifest names.
Coin Flip is a placeholder in this repository (`lobby/games/coin-flip.js`) that hangs on the wall only where `PARTY_TEST_GAMES` is `"on"` (local play and the tests).
The room is `lobby/server/lobby-core.js` (the rules) and `lobby/server/lobby-room.js` (the Durable Object).

### A room holds one current activity

The room's `activity` is `{ kind: "lobby" }`, `{ kind: "settings", id, picks, seats, endsAt, startedAt }` (a game's settings are being chosen) or `{ kind: "game", id, state, startedAt, ticks, seats }`.
Every client sees it in the room view as `phase` (`"lobby"`, `"settings"` or `"playing"`) and `game` (`{ id, name, round }` or `null`), and during the settings step as `choosing` too.
The seats, the join code, the big screen (a room has one) and the Tonight board belong to the room, not to the activity, so they carry across.
In the lobby nothing ticks: the room is asleep unless somebody moves.
In a ticking game the room ticks at the game's `tickHz`, and all of that time counts against the room budget.
In a turn-based game (`tickHz: 0`) nothing ticks either: the room wakes for an input or the game's next deadline, and only that time counts ("Turn-based games").

### Start: with the party's seats

When the vote's count ends, the room calls `game.create({ seed, seats, now, round })`; a game with settings is first given a settings step ("Settings after the vote"), and its `create` also gets `settings`; a game with `carry` also gets `carry` ("What a rematch carries").
`seats` is one entry for each player in the party, `{ seat, name, kind: "human", colour, character }`, with the seat numbers, colours and characters (the piece each chose) they have in the lobby; for a game with an audience voted for by a larger party, one for each player chosen on its spots ("Fewer seats than the party").
Seat numbers are the room's and may have gaps (seats 0 and 2 when seat 1 left earlier), and there may be only one: the room does not look at `game.minSeats`, since the wall already kept the light off for a party the game does not take.
There is no waiting room and no ready step: the vote was the ready step (a game with settings has the settings step, and its players are the party as it was when the vote ended; a game whose players are chosen on spots has that step, and its players are the pieces on the spots at Start).
`seed` is the game's own, drawn fresh from the platform's secure source for each game, so nothing a game shows its players leads to the room's seed or to another game's draw.
The room sends everyone `start { room, s, now }`, the same message the kit's own rooms send, where `s` is `game.snapshot(state, now, viewer)`.
From then on it is the kit's round protocol unchanged: `in { d }` from a player goes to `game.input`, and `ev { ev, now }` and `snap { s, now }` come from `game.tick` and `game.snapshot`.
Every message that carries the game's state (the start, each snapshot, the last one, the full one a socket gets when it connects mid-game, and the events) is built per viewer, as in the kit's own room (the kit's README, "Per-seat views"): a phone whose seat is in `activity.seats` is `{ role: "player", seat }`, the big screen is `{ role: "screen" }`, and a member whose seat is not in the game is `{ role: "screen", seat }`, or `{ role: "audience", seat }` when the game opts in to an audience (`game.audience: true` or `manifest.audience: true`).
The one place that decides is `LobbyCore.viewerOf`, by the kit's `viewerFor` (`party-kit/src/core/views.js`).
Messages about the room itself (pieces, the vote, emotes, the Tonight board, the result at the end) are the same for everyone.
The room answers the kit client's clock ping while a game is on, so `party.now()` works as it does in a game's own room.
In a ticking game, a seat whose player dropped is played by `game.bot`, if the game has one, so the round can finish.
A turn-based game has no stand-in ("Who is here during a turn-based game").
Someone who joins while a game is on gets a seat in the room and a full snapshot, watches as a screen (`{ role: "screen", seat }`, also in a game that opted in to an audience: "Late joiners see no secrets"), and plays or is the audience in the next one.
They are never given a seat that is in the game, even one whose player left the party in the middle of it: in a ticking game that seat's stall is still being played by the stand-in.

### Turn-based games

A game of people talking, with a tap now and then and a turn timer (Who Am I?), says `tickHz: 0`.
The room then runs no timer for it, sleeps between taps and saves the game after every one.

```js
export const game = {
  tickHz: 0,                          // turn-based: never ticked on a timer
  input(state, seat, data, now) {     // applied the moment it arrives
    return { ok: true, events: [] };  // optional: events for the viewers; the rest is the game's answer
  },
  nextDeadline(state) { return state.turnEndsAt; },  // optional: when the room must wake, or null
  tick(state, now) { return events; },               // called once when that deadline comes
  serialize(state) { return JSON.stringify(state); }, // optional, with restore: the game's own save
  restore(text) { return JSON.parse(text); },
  reconnectGraceMs: Infinity,         // optional: how long a dropped seat is held (below)
  presence(state, seat, { connected, away }, now) { return true; },   // optional: who is here changed
  abandon(state, seat, now) { return { standings, result, events }; },  // optional: a seat is gone for good
  idleShutdownMs: 60 * 60_000,        // optional: the room's lifetimes while this game is played
  staleRoomMs: 60 * 60_000,
  // create, snapshot, isOver, result, standings: as for any game
};
```

- **An input** from a seat in the game is applied at once with `game.input`, to a copy of the state (through `serialize` and `restore` when the game has them, a structured clone otherwise) that replaces the state only once `input` has returned. So `input` sees `restore(serialize(state))`: `serialize` must write down everything the game needs, since a field it leaves out is gone after the next input, not only after a sleep. The game is saved, and only then does each viewer get a fresh `snap { s, now }` (its own, as above) and the events the input produced (`ev { ev, now }`, filtered by `only`).
- **An input the game turns down** still gets its sender a fresh snapshot. When it changed nothing (the state as it would be saved is the same before and after), nothing is saved and nobody else hears of it: the sender gets its own share of the events, its snapshot and its answer. When it changed something (an input may end a timed-out turn before it is refused), it is saved and sent to everyone like any input.
- **An input that throws** leaves nothing behind: the copy is dropped, nothing is saved or sent, the room logs it with the game's id, and the sender is answered `error { id, "game_error" }`. It may be sent again with the same id.
- **What `input` returns** may carry events: a list, or `events` on an object. Anything else on the object is the game's answer to the sender: `{ ok: false, error, message }` turns the input down (`error` a short code of up to 64 characters, `message` a sentence for people of up to 200; longer ones are cut, and the room fills in `"refused"` and a plain sentence when they are missing), and anything else means it was applied.
- **Answered inputs.** An input may carry an id: `in { d, id }`, a string of up to 64 characters or a whole number. An id must be unique for its seat for the whole game, also across reloads of the page: use `PartyClient.nextInputId()` (a random part made when the page loaded, and a count), or, in a game's view, the `inputId()` it is given ("In the browser"). The room answers the sender only, after the input is saved and after the sender's fresh snapshot: `ack { id }` when it was applied, or `error { id, error, message }` when the game turned it down, or when the room did not take it (`not_in_game` from a screen or a member who is not playing, `not_playing` when no turn-based game is on). The same id from the same seat with the same data is answered again the same way and never applied twice; the sender gets the game as it is now and nobody else hears anything. The same id with other data is refused, `error { id, "id_reused" }`, never applied and never acked, and the first answer stays. The room keeps the last 32 answers per seat with a short fingerprint of each input, saved with the game, so a phone that sends again after a reconnect or a wake is safe, and it keeps the ended game's answers until the next game starts, so the winning tap sent twice is answered `ack`, not refused. One exception, to spare a write per refusal: a refusal that changed nothing is not saved, so its answer (and the time it counts as somebody doing something) is kept only in memory until the next save. If the room sleeps first, a retry of that id is judged afresh by the game: it is still never applied twice (it was never applied), but it may be answered differently, for example `ack` once it has become that player's turn. An input with no id is not answered, as before. `PartyClient.sendInput(data, { id })` returns a promise for the answer (the kit's README, "Browser side"). A ticking game's inputs are fire and forget: nothing is answered.
- **Time is the alarm.** `nextDeadline(state)` is the next moment the game needs the room awake: a turn timer running out. It is a time in the room's clock, or `null` when the game is waiting on nobody's clock (a paused timer). When it comes, the room calls `game.tick(state, now)` once, saves, and sends the events and fresh snapshots. A deadline that moved before the alarm rang ticks nothing. `nextDeadline` must move on once `tick` has handled it. A deadline that moved forward but is still in the past (a game that steps its deadline by a fixed amount, woken late after a deploy) is ticked again on the next alarm, so the game catches up one tick at a time; each of those ticks moves the deadline forward, so they end. A deadline that `tick` did not move at all (still at or before the one it ticked) is logged once and not a wake-up any more, until the next input that changes the state or the next change in who is here. A `tick` that throws ends the game with no points and a note (`why: "error"`); so does a `presence` that throws. A `nextDeadline` that throws is taken as no deadline.
- **Saved after every input.** The room's save holds the game: its id, its seats, when it started, and its state, written by `game.serialize` (which returns plain JSON, a string being the usual) or, without it, the state itself copied as plain JSON. A state that is not plain JSON (a `Map`, a `Set`, a `Date`, a class instance, `undefined` in a list, a number that is not finite) is refused by its path instead of coming back changed; give such a game `serialize` and `restore`. `serialize` and `restore` come together or not at all.
- **Restored when the room wakes**, after an eviction or a deploy: the same game, the same seats (so every phone, the screen and anyone who arrived mid-game see what they saw before), and the same pending deadline. Phones whose sockets stayed open through the sleep play on as if nothing happened, and nobody is sent anything for the wake itself. A save that cannot be read (the game left the wall, or its `restore` refused it) sends everyone back to the lobby, as a ticking game does.
- **It ends** when `isOver` is true after an input or a deadline, through the same finish as a ticking game: the last snapshots, then `end`, then places and points on the Tonight board ("End", below).
- **Pages stay quiet.** The room view's `game` says `turns: true`, and the kit's client then keeps to the keep-alive the runtime answers without waking the room, after a few clock pings when the game begins and after a reconnect.
- **What it costs** is only the time the room is really awake: each input, each deadline, each socket opening or closing. A quiet turn costs nothing.
- **Fewer seats than the party** (KR-12), its settings and a rematch carry (KR-8) are below.

A room refuses to start a game whose definition does not fit these rules (`gameProblems` in `party-kit/src/core/turns.js`, which includes `presenceProblems` from `presence.js`, and `settingsProblems` from `settings.js`), and logs why.

### Settings after the vote

A game whose host picks how it is played (Who Am I?: category, mode, turn timer, questions, hints, difficulty, who starts, match length) declares them on both sides:

```js
export const game = {
  settings(value) {                   // check and clean; missing fields get their defaults
    if (value.mode === "describe_it" && value.timer === 0) return { ok: false, error: "no_timer", message: "Describe it needs a timer." };
    return { mode: value.mode ?? "twenty_questions", timer: value.timer ?? 60 };
  },
  create({ seed, seats, now, round, settings }) { /* ... */ },
};
export const manifest = {
  // ...
  settings: [
    { key: "mode", label: "Mode", options: [{ value: "twenty_questions", label: "20 questions" }, { value: "describe_it", label: "Describe it" }] },
    { key: "timer", label: "Turn timer", options: [{ value: 0, label: "No timer" }, { value: 60, label: "60 seconds" }], default: 60 },
  ],
};
```

- **The fields** (`manifest.settings`) are a list of choices, up to 16: `key` (letters, digits and `_`), `label`, `options` (1 to 24, each `{ value, label }` or a bare value; a value is a string of up to 64 characters, a number, `true` or `false`) and `default` (one of the options; the first when left out). Checked, they weigh at most 8 KB as JSON. A game with `settings` whose fields are missing, wrong or too heavy is refused, and the room logs why (`settingFields` and `settingsProblems` in `party-kit/src/core/settings.js`). The site keeps them beside the wall (`lobby/wall.js`, `fields`); they reach the pages only in the step's `choosing`, and the game's box on the wall says no more than `settings: true`.
- **The check** is `game.settings(value)`. It returns the clean object (plain JSON, at most 2 KB), or `{ ok: false, error, message }` to refuse, with a sentence for people (cut to 64 and 200 characters, as an input's answer). One that throws, or returns something else, is refused as `bad_settings`. It is given a copy, so it may change it.
- **The step.** When such a game wins the vote, the room does not start it. Its activity is the settings step, with a time limit of 90 seconds (`SETTINGS_MS`), and the room view carries `choosing: { id, name, fields, picks, seats, by, endsIn, of }`: the fields in one shape, the picks as they stand, the seats that will play (the party when the vote ended; anyone who joins meanwhile is never given one of these seats, even one whose player left, and watches the game; at Start only the people the step was opened for play), who chooses (`by`: a seat, or -1 for the room's screen) and the time left. The first picks are the settings the game was last started with in this room, when it still takes them, and otherwise the fields' defaults, cleaned by `game.settings`. A game that refuses its own defaults is not started, and the room logs why.
- **Who chooses** is the party's host, the same device that picks the room (`pickerToken`): the device that made the party, or while it is away the first connected player. Everyone else's page shows "Choosing settings" with the picks. That may be a member who does not play (someone who joined later, in a lower seat, while the host is away, or a host who did not take a spot): choosing the settings and starting the game is the host's part whether or not they play.
- **A change** from the host is `{ t: "settings", v: { key: value } }`. Every key must be a field and every value one of its options (otherwise `bad_setting`), then the whole is checked by `game.settings`. What it gives back is saved and sent to everyone in the room view. A refusal goes to the sender alone, `settings-no { error, message }`, with the game's own words, and nothing is saved.
- **Start** (`{ t: "settings-start" }`) creates the game with `settings` set to the picks, after the same budget check as the vote's end. When the time limit comes first, the game starts the same way, with the picks as they stand: the first picks, unless the host changed them.
- **Back to the room** (`{ t: "settings-cancel" }`) ends the step with nobody playing: everyone gets `note { k: "cancelled", text }`, the pieces are put back by the door and the room rests for six seconds before a new count may start. The step also ends this way when a player it was chosen for leaves the party and fewer than the game needs are left.
- **Refused.** A change, Start or Cancel from anyone but the host (another player, the big screen) is refused with `settings-no { error: "not_host" }`, and outside the step with `not_choosing`.
- **What it costs.** Nothing ticks: the room is asleep between the host's taps, and its only wake-up of its own is the time limit (the alarm). The step is saved with the room and restored after a sleep or a deploy with its picks and its time limit; nobody is sent anything for the wake. A saved step for a game that is no longer on the wall, or no longer has settings, sends everyone back to the lobby. The room cannot be changed during it, the pieces do not move and no count runs. A dropped phone's piece does not fade while settings are chosen.
- A game without `settings` starts the moment the vote ends, and `create` is called exactly as before, with no `settings` in its context.

### Fewer seats than the party: spots and an audience

A game for two (Who Am I?) can be played in a party of up to four, with the others watching:

```js
export const game = { audience: true, /* ... */ };    // optional here: the manifest's flag opts in too
export const manifest = {
  players: { min: 2, max: 2 },                         // the game's seats
  audience: true,                                      // a larger party may vote for it; the rest watch
  devices: { phone: true, desktop: false, upright: true },
};
```

- **The wall.** The game's light stays on for a party larger than `players.max` (it still goes off below `players.min`). Without `audience: true` nothing changes: the light is off for a party the game does not fit.
- **The spots.** When such a game wins the vote with more members than seats, the room does not start it: it enters the settings step ("Settings after the vote") even when the game has no settings. The pieces start again by the door, and `players.max` lights on the wall are lit as spots: the game's own light and the ones beside it (`spotLights` in `lobby/shared/vote.js`), drawn as any light is; every other light is out. Each spot is taken by the first connected piece to stop in its light (a piece walking across it does not take it, and a holder keeps it while it moves inside the light), a piece holds one spot at most, and a spot is free again the moment its piece steps off, drops or leaves (`takeSpots` in `party-kit/src/core/audience.js`). The room view's `choosing` carries `spots: [{ place, seat }]` (the light's box id and who stands there, or null) and `seats` (the seats on the spots); the pieces walk during this step and nobody bumps.
- **Who plays.** The pieces on the spots at Start, and nobody else: the room writes down who stepped on, by the token it knows them by (never sent to a page), and at Start only a seat still held by that same person plays. Someone who joins during the step may walk onto a free spot like anyone else, in plain sight; nobody plays who was not seen standing on a spot.
- **Start.** The host starts (`{ t: "settings-start" }`) once every spot is taken; with a spot empty it is refused, `settings-no { error: "spots_open" }`, and from anyone else `not_host` as before. When the time limit comes with every spot taken the game starts with those players; with a spot empty nobody plays, everyone gets `note { k: "cancelled", text }` and is back in the room. A game with settings has its choices and its spots on the same card. A party with exactly as many members as seats (or fewer) needs no spots: everyone plays, as before.
- **The audience** is every member of the party not in the game's seats who was in the party when the match began: each gets `{ role: "audience", seat }` (with the opt-in) and the big screen stays `{ role: "screen" }`.
  Someone who joined later is not the audience of that match ("Late joiners see no secrets"). Events addressed with `only` never reach the audience; what the audience may see is the game's snapshot for that viewer (Who Am I? shows its audience both identities and the big screen neither). An input from the audience is refused (`not_in_game`), the audience never places and gets no points, and coming, going, dropping or hiding a page is nothing to the game (presence and ending early are about the game's seats). A hidden audience page is closed like any silent socket; only a player's gets the game's grace. A player who leaves for good ends the game as before.
- **Who counts.** Whether spots are needed is decided by the members whose phones are here (as the game's light is): a party of three with one phone dropped plays a two-seat game at once, with the two who are here. During the step every member still in the party may take a spot (a dropped phone may come back), and when fewer members are left than there are spots the step ends at once with `note { k: "cancelled" }`.
- **The wall too small.** A wall with fewer lights than the game's seats has no spots to offer: the members whose phones are here play first, then the rest, each by seat, up to the game's seats.

#### Late joiners see no secrets

The audience may be shown more than the big screen (Who Am I? shows it both identities), so a player who opened the room on a second phone or tab in the middle of a match could read their own secret there as its audience.
The room closes that for every game with an audience, whether or not it has secrets: the contract has no flag that says a game has secrets, so the rule cannot be limited to those that do.

- **The moment.** A match begins, for this rule, when the room leaves the lobby for it: the instant the vote's game is taken up, when the spot or settings step opens, or when the game starts at once with no step.
  Its players are fixed or being chosen from then on, so a later moment (Start) would leave the whole spot step open to a player on a spot opening a second phone.
  The room writes down the tokens of everyone in the party at that moment (its members, and the seats it holds for players whose pieces faded), with the activity, in storage only and never in a view.
- **Late.** A member whose token is not on that list and who does not play the match gets `{ role: "screen", seat }`, the big screen's view, for the rest of it: no secrets, and the game is told of no new role.
  Someone who joins during a spot step may still take a free spot and play, in plain sight; a player's view is the same whoever holds the seat.
- **Kept.** Being in the party when the match began holds through anything that keeps the token: a dropped connection and return, a locked phone, a second socket on the same token, the room sleeping and waking.
  The list is saved with the step and with a turn-based game, so the mark survives a sleep; a step or game saved before the list existed marks nobody.
- **Cleared.** The list goes with the activity: every way a match ends (it is over, a seat is abandoned or its grace runs out, the host goes back to the room, the step's time runs out with a spot empty, a refused start) puts the room back in the lobby, and the next match takes the party afresh.
  From the next match, the rematch included, a late joiner is the audience as anyone else, or a player if they take a spot.
- **The page.** The room view's `game` carries `late: [seat]` while anyone is marked, so the room's page tells its view `you: { role: "screen", seat }` and says "You joined mid-game: you will see everything next match".
  A game's view must already handle `{ role: "screen", seat }`: a game with no audience gives it to everyone not in the round.

### An upright game

`manifest.devices.upright: true` says the game is laid out for a phone held upright.
While it is played, the room's page stops asking for sideways on the phones of its players and its audience: the turn hint is hidden and a sideways lock the page took on the way in is let go (`allowUpright` in `lobby/public/screen-fit.js`).
A phone that stays sideways still plays: the game's container is letterboxed to an upright shape in the middle of the screen.
When the game ends the page asks for sideways again as before. The big screen is not changed. The room view's `game` says `upright: true`, and the mounted view is told `upright` ("In the browser").

### What a rematch carries

```js
carry(state) { return { loser: 1, used: ["id-17", "id-42"] }; },   // optional, when a game ends
create({ seed, seats, now, round, carry }) { /* carry: the last one for these seats, or null */ },
```

- When a game ends, `game.carry(state)` is asked for a small plain-JSON object (at most 4 KB), and the room keeps it for that game and its seats, in place of the one before. Who Am I? lists the last match's identities, so the next draw avoids them, and who lost, so they guess first.
- **The same seats** means the same people in the same seats of the game: each seat's player is known by the token the room holds for them, so a seat number given to someone new after its player left is not the same seat. The next `create` for that game with exactly those seats gets the carry as `carry`; with any other seats it gets `carry: null`, and the kept one is dropped. Seats are the game's own (`activity.seats`), so when a game is played by two seats chosen on spots out of a larger party, the carry follows those two: the same two people on the spots next time get it, any other pair does not.
- It is kept with the room and survives a sleep. Nothing is kept after a game that ended because one of its callbacks threw, or when `carry` throws or gives back something that is not a small plain-JSON object (the room logs it); the game still ends as usual.
- A game with `carry` gets the `carry` key in `create`'s context, null for a first game; a game without it gets no such key. A game may have `carry` without settings.
- It is never sent to any page: it is only for `create`, so it may name what the players must not see.

### Who is here during a turn-based game

A turn-based game is humans only: nobody stands in for a player, and `bot` is never called for it.
Everything here is about the game's own seats (`activity.seats`), never about the rest of the party: a member who is not playing, or the big screen, can come, go or hide their page without the game hearing of it.

- **A dropped phone keeps its seat.** Its socket closed (signal lost, the page closed, or the room's page parking it while a phone is locked), and the seat stays the player's, in the room and in the game, for the game's grace: `reconnectGraceMs`, `Infinity` for "while the room lives", and two minutes (`TURN_GRACE_MS`, the same as a seat held in the lobby) when the game says nothing. The phone comes back to the same seat with its token, gets `hello` and a full snapshot, and plays on.
- **Away.** A player's page whose socket stays open while it is hidden says `away` and, shown again, `back` (`{ t: "away" }`, `{ t: "back" }`). The seat is away when every open socket of it is. The room view's member says `away: true`. Being away never runs the grace down: that phone can still be reached. The kit's client says it with `party.setAway(hidden)`, which it says again on every new connection. During a turn-based game the room's own page does this when it is hidden, on a phone and on a desktop, and keeps its socket (`lobby/public/connection.js`); in the lobby and in a ticking game it still closes a locked phone's socket. A hidden page's browser slows or stops its keep-alive, so a socket that said `away`, of a seat in the turn-based game, is not taken for silent and closed before the game's grace (at least the room's 25 seconds); one that stays silent longer is closed then, as a drop dated from when it was last heard, so the seat is held one grace from its last sign of life and is gone at once. With an `Infinity` grace such a ghost is never closed and the game is told only that the seat is away (so it can offer its own override): the room's four hours end it while the other player keeps tapping, and the stale limit (`staleRoomMs`) once nobody does. A page shown again after its socket died while it was hidden reconnects at once and takes its seat back: the room took the gap for a drop.
- **The game hears it.** Whenever a seat's `{ connected, away }` changes, the room calls `game.presence(state, seat, { connected, away }, now)` (a player who is not connected is never away). It returns nothing or `false` when nothing changed, `true` when the state did, or a list of events (or `{ events }`) for the viewers. When it changed, the game is saved, every viewer gets a fresh snapshot and the events, and `nextDeadline` is asked again: a game pauses its turn timer by returning `null` from it, and its own overrides (Who Am I?'s "confirm your own guess when the other phone has been gone 30 seconds") are ordinary inputs it checks against what it was told. What the game was last told is saved with it, also when `presence` said nothing changed, so a wake tells it only what changed while the room slept (a socket that did not come through the sleep is reported then). At the start, everyone is taken to be here, and a seat that is not is reported before the first snapshot; the events `presence` returns then go out right after `start`.
- **Ending early.** A seat is gone for good when its player leaves the party on purpose (or is put out for flooding) or its phone's grace runs out. The room then ends the game at once through `game.abandon(state, seat, now)`: what it returns decides the result, `{ standings, result, events }` (standings as `game.standings` gives them, so places become points; `result` is sent with `end`; events go to the viewers first). Without `abandon`, or when it returns nothing or throws, the game ends with no points. Everyone gets a note first, `note { k: "ended", why, seat, name, colour, text }` (`text` is "Bo left the party, so Who Am I? ended."), so a page has the reason when it puts the game away; then the last snapshots and `end`, whose card says why too: `last.early = { seat, name, why, text }`. `why` is `"left"` or `"gone"` for a seat, and, with `seat: -1` and no name, `"error"` (a callback of the game threw; no last snapshot is sent), `"expired"` (the party's four hours are up) or the reason the room is closing (`"budget"`). Everyone is back in the lobby, where a dropped player's piece fades by the lobby's own rule.
- **A match decided before the seat went.** A game may have decided its match before it says `isOver` (Who Am I?'s "Match over" summary waits for a tap on "See final results"), and a player may leave in between.
  `abandon` then returns the match's real standings and result, the seat that is gone placed with the rest.
  A place for the seat that is gone is how the room knows the match was decided: it ends as a finished match, with no `ended` note and no `last.early` (the "left" note still says who left).
  A seat that forfeits a match still being played gets no place, and the game ends early as above.
  The card keeps a row for every seat the game placed, a seat whose player has left included, under the name it played with ("End: with places").
- **Lifetimes.** While the game is played the room closes when nobody has done anything (an input, a socket opening) for its `staleRoomMs`; a turn timer running out is not somebody doing something. An empty room (every phone dropped, no big screen) waits for the longest of: the game's `idleShutdownMs`, a seat the lobby holds, and the end of every dropped seat's grace; with a grace that never ends, it waits the game's `idleShutdownMs` when the game chose one and its `staleRoomMs` when it did not. Both default to the room's own values (a minute and twenty minutes). The room view's `idleLimit` is the stale limit in force. Who Am I? asks for an hour of each, so two locked phones do not lose the match. The party's four hours and a budget close are checked at every wake during the game too: when either comes, the game ends with no points and a note, and the room closes.
- **A ghost.** A phone that loses its signal without closing its socket is noticed when it has said nothing (not even the keep-alive) for 25 seconds, the next time the room is awake for an input or a deadline. Nothing wakes the room only to look. A message counts as the socket saying something before it is handled, so the sender of an input is never the ghost.

A ticking game keeps its behaviour as before: its stand-in plays a dropped or departed seat, none of these hooks is called, and no stale limit is checked during its round. Only `idleShutdownMs` is read for it, when it names one (Cork & Bell does not).

### End: with places

When `game.isOver(state)` is true the room asks the game for places in one shape for every game:

```js
// Optional export on the game object. Place 1 is best; equal results share a place.
standings(state) { return [{ seat: 2, place: 1 }, { seat: 0, place: 2 }, { seat: 1, place: 2 }]; }
```

A game without `standings` is read from `game.result(state)` instead, when that is a list of rows, best first, each with `seat` and `score` (Cork & Bell's is).
The room turns places into points for the night: 3 for first, 2 for second, 1 for third.
It sends `end { room, result, last, now }`, where `result` is the game's own result and `last` is the room's card: `{ round, game, name, rows: [{ seat, name, colour, place, points, score? }] }`.
A row carries `score` when the game's result rows do; the card then shows it beside the points.
A seat whose player left the party after the game placed it (a decided match, "Who is here during a turn-based game") keeps its row, with the name and colour it played with.
The Tonight board lists only who is in the party, so that row's points are kept for its name, as everyone's points are when they leave: they are back on the board if that player joins again tonight with the same name.
The players who stayed get the points their own places earn.

### Return: everyone is back in the lobby

The moment a game ends the activity is the lobby again (with what it carries for a rematch kept, and its settings kept as the first picks for the next time it wins the vote).
Every piece is put back in the dark by the door, the points are on the Tonight board, and the room rests for six seconds before a new count may start, so the result can be read.
The board is saved with the room and survives the room sleeping.
A ticking game in progress is not saved: if the room is restarted mid-game, everyone is back in the lobby with the points they had.
A turn-based game in progress is saved and carries on ("Turn-based games").
Asking to go back to the room before a game is over (the door sheet in the design) is not built: a game runs to its end, and a player can still leave the party.
A turn-based game a player leaves ends there ("Who is here during a turn-based game").

### In the browser

The room's page shows a game by mounting its view over the room when `start` arrives and unmounting it at `end`:

```js
// The module a game's manifest names: lobby: { view: "game/party-view.js" }, under its public path.
export function mount(container, { room, you, upright, snapshot, send, inputId, now, inset, params }) {
  return {
    full: true,                  // optional: the view covers the whole container
    events(list) {},             // what game.tick returned
    snapshot(s, now, full) {},   // game.snapshot, every few ticks; `full` after a reconnect
    unmount() {},                // the game is over: free everything
  };
}
export function preload() {}     // optional: fetch the big files while the vote is still counting
```

| Given | What it is |
| --- | --- |
| `container` | An empty box laid over the room. The view puts itself inside it and nowhere else. |
| `room`, `you` | The room view (`room.members[seat]` has each seat's name and colour; `room.game.seats` the game's seats for a game with an audience) and who this device is: `{ role: "player", seat }`, `{ role: "screen", seat: -1 }` for the big screen, or, in a game that opts in to an audience, `{ role: "audience", seat }` for a member who is not in it, or `{ role: "screen", seat }` for one who joined in the middle of it (`room.game.late`; worked out the same way as the room's viewer). In a game without the opt-in, a player whose seat is not in the round arrived in the middle of it and watches. |
| `upright` | `true` when the game's manifest says `devices.upright` and this device is a phone of a player or the audience: the page has stopped asking for sideways, so the view may lay itself out upright, and is letterboxed to an upright shape on a phone held sideways. `false` otherwise (the big screen, any other game). |
| `snapshot` | `game.snapshot` at the start, or a later one for a page that came in or came back mid-round. |
| `send(data, opts)` | One input for `game.input`, as this device's seat. With `opts = { id }` in a turn-based game it returns a promise for the room's answer (`PartyClient.sendInput`, "Answered inputs"); without, it is fire and forget. |
| `inputId()` | A new id for `send`, unique for this seat for the whole game, also across reloads (`PartyClient.nextInputId`). |
| `now()` | The room's clock in ms. |
| `inset` | `{ top, right }` in CSS pixels: the corner where the room's own door button stays on top of the view. |
| `params` | The room page's query as it was opened, for a game's own test switches. A view honours them only where the room has its test games on, which it reads from the wall the server sent (a box with `test: true`, hung only where `PARTY_TEST_GAMES` is `"on"`), never from the address: in production nobody can have a game play, or change a round, for them by adding a switch to the room's link (Tin Derby's and Cork & Bell's `switchesFor`). |

The room's page (`lobby/public/main.js`) imports the module from the address on the game's box (`view`, which is `manifest.path + manifest.lobby.view`) the first time it is needed, and calls `preload` when a count begins for that game.
Whatever the room says before the module has arrived is kept and handed over in order.
While a view with `full` is up, the room's bars are put away and the room is not drawn; the door button, the notes and the word about the connection stay on top, so "Leave the party" works in every game and is drawn once, for a phone held sideways.
At `end` the page calls `unmount`, hides the container and shows the room's own card.

The view must leave nothing behind: no listeners on the room's window or document, no timers, no sound, no WebGL context.
Cork & Bell does that by showing its own page in a frame of the same origin: everything it makes belongs to the frame's document and goes with it (its README, "Inside a party room").
That is why this site's pages may be framed by this site's pages, and by nobody else (`frames: "self"` in `scripts/build-public.mjs`; the kit's default is no framing at all).
Coin Flip's view lives in this repository (`lobby/public/games/`), mapped by id in `views.js`.

### What the manifest adds for the lobby

| Name | What it is |
| --- | --- |
| `manifest.blurb` | One line for the game's box on the wall. |
| `manifest.lobby.view` | The module, under the game's public path, whose `mount` shows the game inside the room ("In the browser"). A hosted game without it hangs as an outside game that points at its own page. |
| `manifest.players.solo` | The game also plays with one: its sign reads from 1, and a party of one can start it. |
| `manifest.devices.sharedScreen` | `true`: the game can use a big screen. `"required"`: it needs one, and its light stays off until a screen has joined the room. |
| `manifest.lobby.emotes` | Optional. Whether players may send emotes while the game is played ("Emotes"). Default `true`. |
| `manifest.lobby.emoteSounds` | Optional. Whether an emote's own short sound plays while the game is played. Default `false`. |

### Emotes

The party room has emotes: a player picks one from a wheel and their piece performs it on every device, and an emote may carry a short sound of its own.
They belong to the kit (`party-kit/client/emotes.js`), and the room turns them on.
In the room's lobby both are always allowed.
While a game is played, the game decides, and a game that says nothing needs to do nothing:

```js
lobby: { view: "game/party-view.js", emotes: true, emoteSounds: false },   // these are the defaults
```

- Emotes default to on: they cost the game nothing and disturb nobody.
- Their sounds default to off: a game has sounds of its own, and a sound in the middle of a round is the game's call to allow.
- The room enforces `emotes`: an emote the game does not allow is refused with `{ t: "wait", in: -1 }`, and nothing is relayed. The pages keep `emoteSounds` (the emote arrives either way; only its sound stays quiet).
- A game's view does not need to show them; the room's page shows who did what over the game.

Cork & Bell says nothing, so it gets the defaults.

The device badge on a box comes from `devices`: amber "Phones + big screen" when a screen is required, violet "A phone each" when it plays on phones only, and cyan "Any device" otherwise.
The box's player count is `players.min` to `players.max`, or from 1 when the game also plays alone (`players.solo`), and its light is off, with the reason in a few words, only when the party is too small or too large.
The game's name is written once, on its poster; the sign under it carries the blurb and the badges.

### Outside games

A game that is not on the kit and plays on a site of its own can still hang on the wall.
It keeps none of this contract: the site lists it in `lobby/wall.js` (`OUTSIDE`) with what a box needs and an address.

```js
{ id: "who-am-i", name: "Who Am I?", blurb: "Ask questions, guess your name", players: { min: 2, max: 2 }, devices: { phone: true, desktop: false }, url: "https://whoami.n8builds.dev/" }
```

`players` is what the game itself allows, so its light goes off for a party that does not fit, like any other.
It has no `game`, so the room never calls `create`: when it wins the vote the room sends every socket `away { id, name, url, in }`, each page shows where it is going for `in` milliseconds and then goes to `url`.
Nothing of the party carries over (not the code, the seats or the points), no points go on the Tonight board, and the party room empties and closes by its usual rules.
A hosted game whose view cannot be mounted in the room yet is hung the same way, with its own `manifest.path` as the address.

### Games at the Table

The party has two waiting rooms (`lobby/shared/mode.js`): the Floor, where the vote above chooses a game, and the Table (`/party/`), a plain page where the host picks a turn-based game from a list.
A Table game keeps the same contract as any turn-based game ("Turn-based games", "Who is here during a turn-based game"), run by the same room, with these differences.

- **The rules.** A Table game is a pure rules module, the shape Paper Masks set (`party/games/paper-masks/README.md`):

  ```js
  export const GAME_ID, MIN_PLAYERS, MAX_PLAYERS, SYSTEM;
  create(seats, options, seed, now)  // -> state, or { refused, message }; seats are seat numbers; options.host is the host's seat
  apply(state, seat, move, now)      // -> a new state, or { refused, message }; never changes `state`
  view(state, seat)                  // what that seat may see; -1 is a big screen. Nothing else is ever sent
  nextDeadline(state), done(state), result(state), standings(state)
  ```

  The state is plain JSON, kept and saved on the server; only `view` output reaches a page.
  The room sends its own moves as `SYSTEM`, and `apply` must refuse them from a player (`not_system`):
  `{ t: "tick" }` at `nextDeadline` (a Durable Object alarm: nothing ticks in memory, and the room sleeps between moves), `{ t: "join", seat }` when someone in the party who is not in the match is here (a late joiner; the game makes them a watcher, or refuses, and then they wait at the Table), `{ t: "leave", seat }` when a seat is gone for good (it left the party, or its phone was gone past the grace; the game goes on without it, or ends by itself), and `{ t: "host", seat }` when the host's controls pass to another player.
  `create` gets `seed`, a fresh seed per match from the platform's secure source; the room's own seed, which pages may learn, is never used.
  `party/games/table-game.js` (`tableGame(rules)`) turns the module into the kit's turn-based `game`: the room's `join`, `leave` and `host` hooks (`lobby/server/lobby-core.js`, `turnUpkeep`) are those three moves, and a refusal is the answer to the input.
  A seat taken in by `join` is the game's from then on (it may send moves, and gets `view` for its seat); a seat gone by `leave` is kept out of the party until the match ends, so nobody new sits in it.
- **Where it lives.** The rules in `party/games/<id>/` (server only), with an `index.js` that exports `game` and `manifest`, and the view in `party/public/games/` (served at `/party/games/`).
  It goes in `TURN_GAMES` (`games.js`); its manifest has `path: "/party/"`, `table: { view: "games/<id>.js" }` and `public: []`, since its view is already one of the party's pages, so the build looks up no package for it.
  A game from its own package goes in `TURN_GAMES` the same way, and lists its public files.
  Count to ten has the same shape and is added by `lobby/wall.js` only where `PARTY_TEST_GAMES` is on.
  Nothing in `party/games`, `lobby/server`, `worker.js` or `games.js` can reach the site: `scripts/build-public.mjs` refuses to copy them (`SERVER_ONLY`), and `lobby/test/public-files.test.js` fails if a served file imports them, so server-only data such as Paper Masks' `questions.js` stays on the server.
- **What it is to the wall.** The game must be turn-based (`tickHz: 0`) and must not have `settings` yet: the Table has no settings step, so a rules module's `options` are its defaults (and `host`).
  The manifest adds `table: { view }`, the module under `manifest.path` whose `mount` shows the game at the Table ("In the browser"), and may add `pitch` (one line about the game) and `art` (the address of its door picture).
  `buildTurnWall` in `lobby/wall.js` refuses a game that breaks any of this when the Worker loads, not when a party picks it.
  A game in `TABLE_SOON` with the same id is replaced by the real one.
- **The places.** The Table has eight places (`TABLE_MAX_PLAYERS`), the Floor four (`MAX_PLAYERS`).
  A party of more than four cannot move to the Floor (`mode-no`, "The Floor has room for 4, and 5 are here"); one of four or fewer is seated in the Floor's four places on the way, and the sockets of whoever moved speak for the new seat at once.
  Seats 4 to 7 take the picker's next four colours (`seatColour`).
- **The list.** The room view carries `table`: every entry (`id`, `name`, `pitch`, `min`, `max`, `art`, `soon`, `test`, `view`) with `why`, the reason the party cannot play it now in a few words ("Needs 3 or more", "For exactly 2", "Coming soon"), or null.
  The party's size is its connected players (`lobby/shared/table.js`, `tableWhyNot`).
  An entry marked `test` is on the list only where `PARTY_TEST_GAMES` is on (never in production, where a `play` for it is refused as not on the list), and is shown only on a page whose address ends in `#dev`.
- **The pick.** The host (or whoever holds the controls while the host is away, the same rule as every host tap) sends `{ t: "play", id }`.
  It is refused to that page alone with `play-no { error, message }` unless the party is at the Table, nothing else is going on (no game, no settings step, no other start, no switch being saved, the room not closing), the game can start and the party's size is in range.
  A yes is a beat of `PLAY_BEAT_MS` (three seconds) that everyone sees in the room view as `starting: { id, name, by, in }`; nothing may switch rooms or start another game meanwhile.
  At its end the size is checked again, and the game starts as any game does (the budget check, `create`, `start`), or does not, with a `cancelled` note.
  The beat lives in memory only: a restart during it starts nothing, and the host picks again.
- **The players.** The seats are the phones connected when the game starts, and any the game takes in later (`join`).
  The room view's `game` carries `seats` at the Table, so every page knows who plays; it is sent again when they change, before the new seat's view.
  A player's page shows the game's view; the big screen shows it with `{ role: "screen", seat: -1 }`.
  Anyone else (a late joiner the game turned down, or a game without a `join` hook) stays on the Table and sees that a game is on; the room sends them the screen's view, which must hold no secret.
  There is no audience at the Table.
- **The end.** As for any turn-based game, plus one way more: the host sends `{ t: "stop" }` and the game ends with no points and a note, `note { k: "ended", why: "host", seat, name, text }` ("Ann ended Count to ten."), the card's `last.early` saying the same; anyone else is refused, `stop-no { error, message }`.
  Everyone is back at the Table, with the card.
  A game whose match is already decided though not yet over (a final screen still up, Paper Masks' curtain) says so with the optional `game.decided(state)` (the adapter passes the rules' `decided` on): `stop` then ends it as a finished match, its places scored once, with no `ended` note and no `last.early`.
  Its view may also call the optional `ctx.decided(true)` so the Table's own "End the game" steps aside while its final screen offers the way back.

Count to ten (`party/games/count-to-ten/`, view in `party/public/games/`) is the test game that shows the whole shape through the same adapter: per-seat secrets from the match's seed, a turn timer on the alarm, `join` (a watcher), `leave` (it goes on, and the last one left wins), `host`, and a view that keeps to `mount`.

The kit-level hooks are open to any turn-based game, not only Table ones: `game.join(state, seat, now)`, `game.leave(state, seat, now)` and `game.host(state, seat, now)` return `false` or `{ ok: false }` to turn it down, otherwise nothing, `true`, events or `{ events }`; one that throws ends the game with no points.
A game without `leave` ends when a seat is gone for good, through `abandon`, as before.
A game whose `leave` makes it over with nobody placed (Paper Masks' waiting step, left with two) ends as an abandoned one does: the `ended` note and the card's `last.early` say who left.

### What hosting a game through this takes

On the server, nothing new: a `game` the kit's own rooms can run already has everything the party room calls, and result rows with a score already give places.
`lobby/wall.js` puts a hosted game whose manifest names a view into the wall's `games`.

In the browser, a view in the shape of `mount` above: begin from a snapshot for seats the room already has, with no waiting room of the game's own, and give the screen back at the end.
A game built to be the whole page can keep being one and be shown in a frame, as Cork & Bell is.

What a ticking game costs is the round: the room is awake for all of it, as a game's own room is, and that time is counted against the shared room budget second for second (`lobby/README.md`, "What it costs").
A turn-based game costs only the moments the room is awake for an input or a deadline.
