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
| `game` | The server game definition for `createPartyRoom(game)`: `id`, `minSeats`, `maxSeats`, `tickHz`, `snapshotEvery`, `create`, `input`, `bot`, `tick`, `snapshot`, `isOver`, `result` (see the kit's README, "The game object"). |
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
It is a proposal that is built and tested for one game: Coin Flip, a placeholder in this repository (`lobby/games/coin-flip.js`) that hangs on the wall only where `PARTY_TEST_GAMES` is `"on"` (local play and the tests).
Cork & Bell does not go through it yet: it hangs as an outside game (below) that points at its own page. What hosting it would take is at the end.
The room is `lobby/server/lobby-core.js` (the rules) and `lobby/server/lobby-room.js` (the Durable Object).

### A room holds one current activity

The room's `activity` is `{ kind: "lobby" }` or `{ kind: "game", id, state, startedAt, ticks, seats }`.
Every client sees it in the room view as `phase` (`"lobby"` or `"playing"`) and `game` (`{ id, name, round }` or `null`).
The seats, the join code, the big screens and the Tonight board belong to the room, not to the activity, so they carry across.
In the lobby nothing ticks: the room is asleep unless somebody moves.
In a game the room ticks at the game's `tickHz`, and all of that time counts against the room budget.

### Start: with the party's seats

When the vote's count ends, the room calls `game.create({ seed, seats, now, round })`.
`seats` is one entry for each player in the party, `{ seat, name, kind: "human", colour }`, with the seat numbers and colours they have in the lobby.
There is no waiting room and no ready step: the vote was the ready step.
The room sends everyone `start { room, s, now }`, the same message the kit's own rooms send, where `s` is `game.snapshot(state, now)`.
From then on it is the kit's round protocol unchanged: `in { d }` from a player goes to `game.input`, and `ev { ev, now }` and `snap { s, now }` come from `game.tick` and `game.snapshot`.
The room answers the kit client's clock ping while a game is on, so `party.now()` works as it does in a game's own room.
A seat whose player dropped is played by `game.bot`, if the game has one, so the round can finish.
Someone who joins while a game is on gets a seat in the room and a full snapshot, watches, and plays in the next one.

### End: with places

When `game.isOver(state)` is true the room asks the game for places in one shape for every game:

```js
// Optional export on the game object. Place 1 is best; equal results share a place.
standings(state) { return [{ seat: 2, place: 1 }, { seat: 0, place: 2 }, { seat: 1, place: 2 }]; }
```

A game without `standings` is read from `game.result(state)` instead, when that is a list of rows, best first, each with `seat` and `score` (Cork & Bell's is).
The room turns places into points for the night: 3 for first, 2 for second, 1 for third.
It sends `end { room, result, last, now }`, where `result` is the game's own result and `last` is the room's card: `{ round, game, name, rows: [{ seat, name, colour, place, points }] }`.

### Return: everyone is back in the lobby

The moment a game ends the activity is the lobby again.
Every piece is put back in the dark by the door, the points are on the Tonight board, and the room rests for six seconds before a new count may start, so the result can be read.
The board is saved with the room and survives the room sleeping.
A game in progress is not saved: if the room is restarted mid-game, everyone is back in the lobby with the points they had.
Asking to go back to the room before a game is over (the door sheet in the design) is not built: a game runs to its end, and a player can still leave the party.

### In the browser

The room's page shows a game by mounting its view over the room when `start` arrives and unmounting it at `end`:

```js
// lobby/public/games/views.js maps a game id to this function.
export function mount(container, { room, you, snapshot }) {
  return {
    events(list) {},     // what game.tick returned
    snapshot(s) {},      // game.snapshot, every few ticks
    unmount() {},        // the game is over: free everything
  };
}
```

`room.members[seat]` gives each seat's name and colour, and `you` is `{ role, seat }`.
A game in its own repository would name the module in its manifest (`lobby: { view: "game/party-view.js" }`, under its public path) and the room's page would import it from there.
That part is proposed, not built: Coin Flip's view lives in this repository.

### What the manifest adds for the lobby

| Name | What it is |
| --- | --- |
| `manifest.blurb` | One line for the game's box on the wall. Until a game's manifest has it, the site supplies one (`lobby/wall.js`). |
| `manifest.devices.sharedScreen` | `true`: the game can use a big screen. `"required"`: it needs one, and its light stays off until a screen has joined the room. |

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

### What hosting Cork & Bell through this would take

On the server it is small.
Its `game` already has everything the room calls, its result rows already give places, and a party of two to four needs no stand-ins to start.
In `lobby/wall.js` the hosted game stops being hung as an outside game and its own `game` goes into the wall's `games`.

In the browser it is the real work, and it is not small.
Cork & Bell's page (`game/main.js`) is built around the kit's waiting room and around being the whole page.
It needs an entry in the shape of `mount` above: begin a round from a `start` message with given seats, without its own waiting room, and give the screen back at the end.
It also loads a three.js scene, which the room's page would have to load on every phone when the game is chosen.

So the order of work is: give Cork & Bell a mountable view in its own repository, name it in the manifest, then switch the wall over.
