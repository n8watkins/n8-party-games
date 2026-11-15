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
| `game` | The server game definition for `createPartyRoom(game)`: `id`, `minSeats`, `maxSeats`, `tickHz`, `snapshotEvery`, `create`, `input`, `bot`, `tick`, `snapshot`, `isOver`, `result` (see the kit's README, "The game object" and "Per-seat views"). A turn-based game (`tickHz: 0`) may add `nextDeadline`, `serialize`, `restore`, `reconnectGraceMs`, `presence`, `abandon`, `idleShutdownMs` and `staleRoomMs` ("Turn-based games" and "Who is here during a turn-based game" below). |
| `manifest.id` | A short name in lower case with dashes. It matches `game.id`. |
| `manifest.name` | The name people read. |
| `manifest.path` | Where the game lives on a site, with a slash at both ends. The same on the party site and on the game's own site, so a join link works on either. |
| `manifest.players` | Seats in a room (`min`, `max`) and whether it also plays alone in the browser (`solo`). |
| `manifest.devices` | What it is played on, for the lobby to show: `phone`, `desktop`, `sharedScreen` (a screen that holds no seat), and `sideways` (`"preferred"`, `"required"` or `false`). |
| `manifest.scores` | Optional. `{ max }`: the game has a high score board, and no round can score more than `max`. The host binds the kit's `ScoreBoard` and answers `/api/party/scores/<id>`. |
| `manifest.public` | Files and folders the browser loads, relative to the package root. Nothing else in the package is served. |

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

The room's `activity` is `{ kind: "lobby" }` or `{ kind: "game", id, state, startedAt, ticks, seats }`.
Every client sees it in the room view as `phase` (`"lobby"` or `"playing"`) and `game` (`{ id, name, round }` or `null`).
The seats, the join code, the big screen (a room has one) and the Tonight board belong to the room, not to the activity, so they carry across.
In the lobby nothing ticks: the room is asleep unless somebody moves.
In a ticking game the room ticks at the game's `tickHz`, and all of that time counts against the room budget.
In a turn-based game (`tickHz: 0`) nothing ticks either: the room wakes for an input or the game's next deadline, and only that time counts ("Turn-based games").

### Start: with the party's seats

When the vote's count ends, the room calls `game.create({ seed, seats, now, round })`.
`seats` is one entry for each player in the party, `{ seat, name, kind: "human", colour }`, with the seat numbers and colours they have in the lobby.
Seat numbers are the room's and may have gaps (seats 0 and 2 when seat 1 left earlier), and there may be only one: the room does not look at `game.minSeats`, since the wall already kept the light off for a party the game does not take.
There is no waiting room and no ready step: the vote was the ready step.
`seed` is the game's own, drawn fresh from the platform's secure source for each game, so nothing a game shows its players leads to the room's seed or to another game's draw.
The room sends everyone `start { room, s, now }`, the same message the kit's own rooms send, where `s` is `game.snapshot(state, now, viewer)`.
From then on it is the kit's round protocol unchanged: `in { d }` from a player goes to `game.input`, and `ev { ev, now }` and `snap { s, now }` come from `game.tick` and `game.snapshot`.
Every message that carries the game's state (the start, each snapshot, the last one, the full one a socket gets when it connects mid-game, and the events) is built per viewer, as in the kit's own room (the kit's README, "Per-seat views"): a phone whose seat is in `activity.seats` is `{ role: "player", seat }`, the big screen is `{ role: "screen" }`, and a member whose seat is not in the game is `{ role: "screen", seat }`.
Messages about the room itself (pieces, the vote, emotes, the Tonight board, the result at the end) are the same for everyone.
The room answers the kit client's clock ping while a game is on, so `party.now()` works as it does in a game's own room.
In a ticking game, a seat whose player dropped is played by `game.bot`, if the game has one, so the round can finish.
A turn-based game has no stand-in ("Who is here during a turn-based game").
Someone who joins while a game is on gets a seat in the room and a full snapshot, watches, and plays in the next one.
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

- **An input** from a seat in the game is applied at once with `game.input`. The game is saved, and only then does each viewer get a fresh `snap { s, now }` (its own, as above) and the events the input produced (`ev { ev, now }`, filtered by `only`). Every input gets fresh snapshots, also one the game turned down, since an input may end a timed-out turn before it is refused.
- **What `input` returns** may carry events: a list, or `events` on an object. Anything else on the object is the game's answer to the sender: `{ ok: false, error, message }` turns the input down (`error` a short code, `message` a sentence for people; the room fills in `"refused"` and a plain sentence when they are missing), and anything else means it was applied.
- **Answered inputs.** An input may carry an id: `in { d, id }`, a string of up to 64 characters or a whole number, unique on the sending page. The room answers the sender only, after the input is saved and after the sender's fresh snapshot: `ack { id }` when it was applied, or `error { id, error, message }` when the game turned it down, or when the room did not take it (`not_in_game` from a screen or a member who is not playing, `not_playing` when no turn-based game is on). The same id from the same seat is answered again the same way and never applied twice; the sender gets the game as it is now and nobody else hears anything. The room keeps the last 32 answers per seat, saved with the game, so a phone that sends again after a reconnect or a wake is safe, and it keeps the ended game's answers until the next game starts, so the winning tap sent twice is answered `ack`, not refused. An input with no id is not answered, as before. `PartyClient.sendInput(data, { id })` returns a promise for the answer (the kit's README, "Browser side"). A ticking game's inputs are fire and forget: nothing is answered.
- **Time is the alarm.** `nextDeadline(state)` is the next moment the game needs the room awake: a turn timer running out. It is a time in the room's clock, or `null` when the game is waiting on nobody's clock (a paused timer). When it comes, the room calls `game.tick(state, now)` once, saves, and sends the events and fresh snapshots. A deadline that moved before the alarm rang ticks nothing. `nextDeadline` must move on once `tick` has handled it.
- **Saved after every input.** The room's save holds the game: its id, its seats, when it started, and its state, written by `game.serialize` (which returns plain JSON, a string being the usual) or, without it, the state itself copied as plain JSON. A state that is not plain JSON (a `Map`, a `Set`, a `Date`, a class instance, `undefined` in a list, a number that is not finite) is refused by its path instead of coming back changed; give such a game `serialize` and `restore`. `serialize` and `restore` come together or not at all.
- **Restored when the room wakes**, after an eviction or a deploy: the same game, the same seats (so every phone, the screen and anyone who arrived mid-game see what they saw before), and the same pending deadline. Phones whose sockets stayed open through the sleep play on as if nothing happened, and nobody is sent anything for the wake itself. A save that cannot be read (the game left the wall, or its `restore` refused it) sends everyone back to the lobby, as a ticking game does.
- **It ends** when `isOver` is true after an input or a deadline, through the same finish as a ticking game: the last snapshots, then `end`, then places and points on the Tonight board ("End", below).
- **Pages stay quiet.** The room view's `game` says `turns: true`, and the kit's client then keeps to the keep-alive the runtime answers without waking the room, after a few clock pings when the game begins and after a reconnect.
- **What it costs** is only the time the room is really awake: each input, each deadline, each socket opening or closing. A quiet turn costs nothing.
- **Not yet**: the game's settings and a rematch carry (KR-8 in Who Am I?'s plan), and a game for fewer seats than the party (KR-12): the game is still started with every member present.

A room refuses to start a game whose definition does not fit these rules (`gameProblems` in `party-kit/src/core/turns.js`, which includes `presenceProblems` from `presence.js`), and logs why.

### Who is here during a turn-based game

A turn-based game is humans only: nobody stands in for a player, and `bot` is never called for it.
Everything here is about the game's own seats (`activity.seats`), never about the rest of the party: a member who is not playing, or the big screen, can come, go or hide their page without the game hearing of it.

- **A dropped phone keeps its seat.** Its socket closed (signal lost, the page closed, or the room's page parking it while a phone is locked), and the seat stays the player's, in the room and in the game, for the game's grace: `reconnectGraceMs`, `Infinity` for "while the room lives", and two minutes (`TURN_GRACE_MS`, the same as a seat held in the lobby) when the game says nothing. The phone comes back to the same seat with its token, gets `hello` and a full snapshot, and plays on.
- **Away.** A player's page whose socket stays open while it is hidden says `away` and, shown again, `back` (`{ t: "away" }`, `{ t: "back" }`). The seat is away when every open socket of it is. The room view's member says `away: true`. Being away never runs the grace down: that phone can still be reached. The room's own page closes a phone's socket when it is locked (`lobby/public/connection.js`), so a locked phone in the party room is a dropped one; `away` is for a page that keeps its socket, such as a desktop tab put behind another.
- **The game hears it.** Whenever a seat's `{ connected, away }` changes, the room calls `game.presence(state, seat, { connected, away }, now)` (a player who is not connected is never away). It returns nothing or `false` when nothing changed, `true` when the state did, or a list of events (or `{ events }`) for the viewers. When it changed, the game is saved, every viewer gets a fresh snapshot and the events, and `nextDeadline` is asked again: a game pauses its turn timer by returning `null` from it, and its own overrides (Who Am I?'s "confirm your own guess when the other phone has been gone 30 seconds") are ordinary inputs it checks against what it was told. What the game was last told is saved with it, so a wake tells it only what changed while the room slept (a socket that did not come through the sleep is reported then). At the start, everyone is taken to be here, and a seat that is not is reported before the first snapshot.
- **Ending early.** A seat is gone for good when its player leaves the party on purpose (or is put out for flooding) or its phone's grace runs out. The room then ends the game at once through `game.abandon(state, seat, now)`: what it returns decides the result, `{ standings, result, events }` (standings as `game.standings` gives them, so places become points; `result` is sent with `end`; events go to the viewers first). Without `abandon`, or when it returns nothing or throws, the game ends with no points. Everyone gets a note, `note { k: "ended", why: "left" or "gone", seat, name, colour, text }` (`text` is "Bo left the party, so Who Am I? ended."), then the last snapshots and `end`, whose card says why: `last.early = { seat, name, why, text }`. Everyone is back in the lobby, where a dropped player's piece fades by the lobby's own rule.
- **Lifetimes.** While the game is played the room closes when it has been empty for the game's `idleShutdownMs`, and when nobody has done anything (an input, a socket opening) for its `staleRoomMs`; a turn timer running out is not somebody doing something. Both default to the room's own values (a minute and twenty minutes). The room view's `idleLimit` is the stale limit in force. Who Am I? asks for an hour of each, so two locked phones do not lose the match. The room's four-hour life is still checked in the lobby only.
- **A ghost.** A phone that loses its signal without closing its socket is noticed when it has said nothing (not even the keep-alive) for 25 seconds, the next time the room is awake for an input or a deadline. Nothing wakes the room only to look.

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

### Return: everyone is back in the lobby

The moment a game ends the activity is the lobby again.
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
export function mount(container, { room, you, snapshot, send, now, inset, params }) {
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
| `room`, `you` | The room view (`room.members[seat]` has each seat's name and colour) and `{ role, seat }`: a player, or a screen with seat -1. A player whose seat is not in the round arrived in the middle of it and watches. |
| `snapshot` | `game.snapshot` at the start, or a later one for a page that came in or came back mid-round. |
| `send(data)` | One input for `game.input`, as this device's seat. |
| `now()` | The room's clock in ms. |
| `inset` | `{ top, right }` in CSS pixels: the corner where the room's own door button stays on top of the view. |
| `params` | The room page's query as it was opened, for a game's own test switches. |

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

### What hosting a game through this takes

On the server, nothing new: a `game` the kit's own rooms can run already has everything the party room calls, and result rows with a score already give places.
`lobby/wall.js` puts a hosted game whose manifest names a view into the wall's `games`.

In the browser, a view in the shape of `mount` above: begin from a snapshot for seats the room already has, with no waiting room of the game's own, and give the screen back at the end.
A game built to be the whole page can keep being one and be shown in a frame, as Cork & Bell is.

What a ticking game costs is the round: the room is awake for all of it, as a game's own room is, and that time is counted against the shared room budget second for second (`lobby/README.md`, "What it costs").
A turn-based game costs only the moments the room is awake for an input or a deadline.
