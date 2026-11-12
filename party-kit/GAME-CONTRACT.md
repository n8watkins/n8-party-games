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

Today a site has one room class, so the party site hosts one game's battles at a time.
Hosting several games in one room is the lobby's work (below).

## Planned, not built: the lobby hooks

The shared lobby will keep a group in one room while it switches games.
It will need three things from a game, and none of them exists yet:

| Hook | What it will be |
| --- | --- |
| start | The lobby hands the game its seats (names, colours, characters) and a seed, and the game begins a round without its own waiting room. Today: `game.create({ seed, seats, now, round })` on the server, and the kit's `start` message in the browser. |
| end with scores | The game reports the round's result in one shape for every game, so the lobby can keep a running table. Today: `game.result(state)` returns the game's own rows (Cork & Bell: `{ seat, name, kind, score, hits, shots, best }`, best first). |
| leave | The game gives the screen back to the lobby (after a round, or when the group votes to stop) and frees what it holds. Today: the game's page is the whole page, and leaving is closing it. |

When the lobby is designed these become named exports beside `game` and `manifest`, and this page is where they are written down.
