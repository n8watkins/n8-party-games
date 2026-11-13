# Party kit

Rooms for small multiplayer games on Cloudflare Durable Objects.
Lifted from Who Am I (PIN directory, rate limiter, room-per-object, reconnect and presence) and reshaped for real-time games with 2 to 4 seats.

What a game gets:

- Create a room and get a 4-digit PIN and a QR code.
- Join by PIN with a nickname.
- 2 to 4 seats, each with a fixed colour.
- Presence: who is connected, who is ready, who dropped.
- Reconnect to the same seat within 30 seconds.
- A bot takes a seat the moment its player drops or leaves, so a round always finishes.
- A seed owned by the room; each round derives its own seed from it.
- An authoritative room: clients send inputs, the room runs the game and broadcasts events and snapshots.
- Simulated latency for tests.
- Idle rooms shut down after one minute with nobody connected.
- A plain waiting room with two slots: the lobby toy and the characters.

Everything runs locally with `npm run dev` (`wrangler dev --local --env local`).
The site is live at https://partygames.n8builds.dev; `DEPLOY.md` at the repository root is the checklist for every deploy.

The top level of `wrangler.jsonc` is the production Worker (rate limits on, no simulated latency, the 10% room budget, logs on).
The `local` environment is for local play and the tests (simulated latency allowed, rate limits off).
Only `dist/public` is served: `scripts/build-public.mjs` copies the files a browser loads into it from an allowlist and writes its `_headers` (CSP and the other security headers), and wrangler runs it before every `dev` and `deploy`.
A hosted game is listed in `games.js` at the repository root, and its manifest names its public files; `npm run assets:list` prints exactly what will be public.

## Taking the kit into a game

The kit is not its own repository.
A game in its own repository takes it from this one as a development dependency, pinned to a tag:

```json
"devDependencies": { "n8-party-games": "github:n8watkins/n8-party-games#v0.1.0" }
```

Only the kit is installed that way (the `files` list in this repository's `package.json`): the worker code, the browser files, the build helper and the end-to-end checks.

| Import | What it is |
| --- | --- |
| `n8-party-games/kit` | The Worker side: `createPartyRoom`, `PinDirectory`, `RateLimiter`, `RoomBudget`, `handlePartyApi`. |
| `n8-party-games/kit/core`, `/kit/rng`, `/kit/http` | The room as plain logic, the seeded generator, and the HTTP helpers (no Workers runtime needed, so tests can use them). |
| `n8-party-games/kit/build` | `buildPublic` and `kitClientEntry`: builds a site's public folder from an allowlist. |
| `n8-party-games/kit/client/*` | The browser files. A site serves them at `/party-kit/client/`; a game imports them by that site path. |

What a game must export so the party site can host it is in [GAME-CONTRACT.md](GAME-CONTRACT.md).

## Layout

| Path | What it is |
| --- | --- |
| `src/core/room-core.js` | The room as plain logic with an injected clock: seats, ready, start, drop and rejoin, bots, idle. No network. |
| `src/core/rng.js` | `makeRng(seed)`, `hashSeed`, `newSeed`. |
| `src/worker/index.js` | `handlePartyApi(request, env)`, `createPartyRoom(game)`, `PinDirectory`, `RateLimiter`. |
| `src/worker/room.js` | The Durable Object around `RoomCore`: WebSockets, the tick loop, saving, shutdown. |
| `src/worker/pin-directory.js`, `pin-logic.js` | 4-digit PINs: 15 minute life, 10 minute cooldown before reuse. |
| `src/worker/rate-limiter.js`, `limit-logic.js` | Fixed-window limits per client address, and the message rate one open socket may keep. |
| `src/worker/room-budget.js`, `budget-logic.js` | The room budget: a cap on hosted room time per day and per month, and the meter a room counts its awake time with. |
| `src/worker/score-board.js`, `score-logic.js` | The score board: a game's ten best scores under three letters. |
| `src/worker/http.js` | Responses and security headers, the body limit, the origin check, the QR allowlist. |
| `src/worker/turnstile.js` | The optional bot check on new rooms (Cloudflare Turnstile). |
| `client/party-client.js` | The browser client (ES module, no build). |
| `client/lobby.js`, `client/lobby.css` | The waiting room. |
| `build/public.mjs` | Builds a site's public folder from an allowlist and writes its security headers. |
| `client/bot-check.js` | Loads and runs the Turnstile widget, only when the server hands out a site key. |
| `test/` | Unit tests (`npm test` at the repository root). |

## Worker side

```js
// worker.js
import { createPartyRoom, PinDirectory, RateLimiter, RoomBudget, handlePartyApi } from "./party-kit/src/worker/index.js";
import { game } from "./my-game/server.js";

export const PartyRoom = createPartyRoom(game);
export { PinDirectory, RateLimiter, RoomBudget };

export default {
  async fetch(request, env) {
    return (await handlePartyApi(request, env)) ?? env.ASSETS.fetch(request);
  },
};
```

`wrangler.jsonc` needs three Durable Object bindings, all SQLite classes:

```jsonc
"durable_objects": { "bindings": [
  { "name": "PARTY_ROOMS", "class_name": "PartyRoom" },
  { "name": "PARTY_PINS", "class_name": "PinDirectory" },
  { "name": "PARTY_LIMITER", "class_name": "RateLimiter" },
  { "name": "PARTY_BUDGET", "class_name": "RoomBudget" }
] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["PartyRoom", "PinDirectory", "RateLimiter", "RoomBudget"] }]
```

Variables (all optional):

| Variable | Meaning |
| --- | --- |
| `PARTY_PUBLIC_ORIGIN` | The address phones can reach, used in the join link and QR code (for local play: `http://<laptop LAN address>:<port>`). |
| `PARTY_SIM_LATENCY` | `"on"` lets a client ask for simulated latency with `?lag=<ms>` on its socket. Otherwise a socket asking for it is refused (400). Off in production. |
| `TURNSTILE_SITE_KEY` | The Turnstile widget's public site key. The lobby shows the bot check only when this and the secret are both set. |
| `TURNSTILE_SECRET_KEY` | A secret, never a plain variable. When set, `POST /api/party/rooms` needs a Turnstile token (`turnstile` in the body). Joining by PIN never does. |
| `PARTY_RATE_LIMIT` | `"off"` disables the limits (for local test runs with many headless players). |
| `PARTY_ROOM_BUDGET_SHARE` | The part of the Workers Paid plan's included Durable Object time that rooms may use each month (`"0.05"` is 5%). Unset means no budget. |
| `PARTY_ROOM_BUDGET_DAY_SHARE` | The part of that monthly budget one day may use. Default `"0.1"`. |
| `PARTY_DEBUG` | `"on"` lets the party site answer `GET /api/lobby/debug` (the budget's books) and `/api/lobby/debug/<code>` (a party room's inner state) for tests and measurements. Local only; never set in production. |

### What hosting costs, and the room budget

Solo play runs in the browser and static files are served free, so rooms are the only real cost.
A room is a Durable Object, billed as 128 MB for every second it is awake.
The Workers Paid plan includes 400,000 GB-seconds a month for the whole account, which is about 870 room-hours.

A room is awake only while a round is on.
In the lobby and on the results screen it holds its sockets through the WebSocket Hibernation API and runs no timer, so waiting costs nothing; a message or the alarm wakes it for a moment.
The client pings every 2 seconds during a round and every 10 seconds otherwise.
A room nobody has touched for 20 minutes outside a round is closed (`STALE_ROOM_MS`), and an empty one after 1 minute.

With `PARTY_ROOM_BUDGET_SHARE` set, each room reports its awake time to the `RoomBudget` object, once a minute and at the end of the round.
When the day's or the month's allowance is spent, `POST /api/party/rooms` answers `battles_full` (503) with a message that solo play still works, and open rooms finish the round in play but cannot start another.
The day's allowance resets at 00:00 UTC and the month's on the first.
All games served by one Worker, and the party room, share the one allowance.
A game's own room (`createPartyRoom`) reports its rounds; the brief moments it wakes for a ping in its waiting room are not counted.
The party room counts everything, with the kit's `AwakeMeter` (below).
The PIN directory, the limiter, the score board and the budget object themselves are not counted.

New rooms are also limited per client address: 5 in ten minutes and 20 in a day.

### Counting all awake time: `AwakeMeter`

A room that relays messages while people merely stand around is awake in many short moments, not in rounds.
`AwakeMeter` (`budget-logic.js`) adds those up, so a room can report all of it with `spendRoomTime(env, ms, requests)`.

- An event (a message, an alarm, a join, a socket closing) counts as the time its handler took, and never less than `EVENT_FLOOR_MS` (2 ms). The Workers clock does not move while code runs, so a handler that only does arithmetic cannot be timed; the floor is charged instead, and it is set high on purpose.
- A hold (a span with a timer running, such as a game's tick loop) counts in full, second for second.
- Requests are counted beside the time: an incoming message is a twentieth of one, anything else is one.

The budget keeps the requests per day and per month for the owner's report (`RoomBudget.report()`), but only time closes anything: the budget is a budget of time.
Cloudflare bills a Durable Object while it runs code or cannot sleep, and not while it is idle and able to hibernate, even before it has been put to sleep.

### One socket's message rate

`limit-logic.js` has a token bucket for one open socket (`SOCKET_RATE`: a burst of 40, then 20 a second).
A message that finds the bucket empty is dropped, and a message that cannot be read at all (too long, not JSON) counts as five.
After 60 drops the socket is closed.
Incoming messages are billed whether or not they are dropped, so a client that keeps flooding has to lose its connection, not only its messages.
The party room uses it; a game's own room keeps its simpler size cap.

### A second kind of room on one site

`handlePartyApi(request, env, { prefix, rooms, fullMessage })` serves the same API under another path for another room class: the party site's lobby is `prefix: "/api/lobby"`, `rooms: env.PARTY_LOBBIES`.
The room class answers the same calls as the kit's (`create`, `preview`, `join`, `fetch`), and every guard (origin check, body cap, rate limits, the bot check) applies to both.
In the browser, `new PartyClient({ api: "/api/lobby" })` talks to it and keeps its own saved session.
`quietPing: { text, everyMs }` makes the client send a fixed text outside a round instead of the clock ping; a room that registers that text with `setWebSocketAutoResponse` is not woken by it at all.
Messages the kit does not know are passed on as the `message` event.

### The score board

A game gets a high score board by naming itself to the API: `handlePartyApi(request, env, { scores: { "my-game": { max: 243300 } } })`, with the `PARTY_SCORES` binding and the `ScoreBoard` class exported.
Nobody signs in.
A score goes up under three capital letters, and the obvious rude three-letter words are refused.
Scores come from the browser, so they cannot be trusted; the board only keeps abuse cheap and bounded.
A score must be a whole number no higher than `max` (the most a round of the game can reach), the body is at most 128 bytes, the origin check applies, and one connection may post 6 scores in ten minutes and 60 in a day.
Only the ten best are kept, and a score that does not make the ten writes nothing.

The board is one Durable Object per game that wakes for a single read or write: no timer, no socket, no alarm.
It costs nothing while nobody plays and it does not count against the room budget.
Posting a score is one Worker request and three Durable Object requests (two rate-limit windows and the board).
Reading the board is one Worker request and one Durable Object request, and browsers may keep the answer for 20 seconds.

### The game object

The room calls these; the game never touches sockets.

```js
export const game = {
  id: "my-game",
  minSeats: 2,
  maxSeats: 4,
  tickHz: 30,          // room ticks per second while a round is on
  snapshotEvery: 15,   // a full snapshot every N ticks

  // A round begins (first start and every rematch). seed is this round's seed.
  create({ seed, seats, now, round }) { return state; },

  // An input from a human seat, or from this game's own bot. Inputs only: decide results in tick.
  input(state, seat, data, now) {},

  // Optional. Inputs for a seat a bot is holding, called once per tick.
  bot(state, seat, now) { return [/* data */]; },

  // Advance to `now`. Return the events every client should hear about.
  tick(state, now) { return events; },

  snapshot(state, now) { return json; },
  isOver(state) { return false; },
  result(state) { return json; },   // optional, shown in the room view after the round
};
```

`now` is always the room's clock in milliseconds.
Use `makeRng(seed)` for every random choice so a round can be replayed.

### HTTP API

| Request | Answer |
| --- | --- |
| `POST /api/party/rooms` `{nickname, as?: "player" or "screen", turnstile?}` | `{code, pin, token, seat, role}` |
| `GET /api/party/join/:pinOrCode` | `{preview: {code, game, phase, players, full}}` |
| `POST /api/party/join/:pinOrCode` `{nickname, as?}` | `{code, pin, token, seat, role}` |
| `GET /api/party/rooms/:code/ws?token=...&lag=150` | WebSocket |
| `GET /api/party/qr.svg?text=<this site's join link>` | A QR code as SVG (only `<origin>/<path>?join=<PIN or code>`) |
| `GET /api/party/config` | `{publicOrigin, simLatency, turnstileSiteKey}` |
| `GET /api/party/scores/:game` | `{top: [{name, score, at}]}`: the game's ten best, best first |
| `POST /api/party/scores/:game` `{name: "ABC", score}` | `{top, place}` (`place` is -1 when the score did not make the ten) |

Requests whose `Origin` names another site are refused (403 `forbidden_origin`), so no other page can open rooms or sockets through a visitor's browser.
Bodies are JSON objects of at most 4 KiB.
Every answer carries `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and a deny-all CSP.

The token is the seat: a random 144-bit value made by the room, kept by the client in `sessionStorage`.
It needs no signing secret, so local development needs no `.dev.vars`.

### WebSocket messages

Client to room: `ping {c}`, `in {d}` (an input), `ready {v}`, `name {v}`, `character {v}`, `addBot`, `removeBot {seat}`, `start`, `leave`.

Room to client: `hello {you, room}`, `room {room}`, `pong {c, s}`, `start {room, s, now}`, `ev {ev, now}`, `snap {s, now}`, `end {room, result, now}`, `error {error, message}`.

The room view (`room`) holds `pin`, `code`, `phase` (`lobby`, `playing`, `ended`), `round`, `seed`, `startAt`, `canStart`, `hostSeat`, `screens`, and `seats`: for each seat `{seat, name, kind: "human" or "bot", colour, connected, ready, away, character}`.
Tokens never appear in it.

## Browser side

```js
import { PartyClient } from "../party-kit/client/party-client.js";
import { mountLobby } from "../party-kit/client/lobby.js";

const party = new PartyClient({ lag: 0 });
const lobby = mountLobby(document.body, party, { title: "My game" });
lobby.open({ pin: new URLSearchParams(location.search).get("join") ?? "" });

party.on("start", ({ room, s }) => { lobby.close(); /* begin the round from snapshot s */ });
party.on("events", (events, now) => { /* what the room decided */ });
party.on("snapshot", (s, now) => { /* correct any drift */ });
party.on("end", ({ result }) => { lobby.open(); });

party.sendInput({ fire: 1, at: party.now() });   // inputs only, with the room's clock
```

`PartyClient` methods: `create`, `preview`, `join`, `resume`, `sendInput`, `setReady`, `rename`, `setCharacter`, `addBot`, `removeBot`, `start`, `leave`, `now`, `joinUrl`, `qrUrl`, and `dropConnection({reconnectAfterMs})` for tests.
Events: `room`, `start`, `events`, `snapshot`, `end`, `status`, `error`, `closed` (with the room's own reason for closing the socket as a second argument, when it gave one), and `message` for anything the kit does not know.
Options: `base`, `lag`, `storage`, `api` and `quietPing` (see "A second kind of room on one site").

A screen (`create({as: "screen"})` or `join(pin, {as: "screen"})`) holds no seat and receives everything: use it for the shared big screen.

## The lobby and its two slots

`mountLobby(parent, client, options)` draws the door (nickname, PIN, make a room, shared screen) and the waiting room (PIN, QR code, seats with colours, ready, start, add a stand-in, leave).
It is the only join flow; games do not build their own.
It is plain on purpose and takes its look from CSS variables: `--pk-bg`, `--pk-ink`, `--pk-soft`, `--pk-line`, `--pk-accent`, `--pk-accent-ink`, `--pk-font`, `--pk-display`.

### Lobby toy slot

```js
mountLobby(parent, client, {
  toy(container, { client, room }) {
    // Draw something to fiddle with while waiting. container is <div class="pk-toy" data-slot="lobby-toy">.
    return () => { /* cleanup */ };
  },
});
```

Called each time the waiting room is drawn; the previous cleanup runs first.
With no `toy`, the box stays hidden.

### Lobby characters slot

The characters (cartoon slimes) are being designed separately; nothing in the kit draws one.
They plug in here:

```js
mountLobby(parent, client, {
  character(el, seat, room) {
    // el is an empty 56 px box beside the seat's name. seat.colour is the seat's colour.
    // seat.character is whatever that player's client sent with client.setCharacter(data).
  },
});
client.setCharacter({ slime: "wobbly", hat: "bowler" });   // stored on the seat, sent to everyone
```

With no `character` hook each seat shows a plain disc in its colour.

## Rules the room keeps

- Start needs at least one connected human and every connected human ready. Empty seats up to `minSeats` are filled with bots at the start.
- The first arrival is the host (a screen counts). The host starts the round and adds or removes stand-ins. If the host is gone, anyone may start.
- After a round, the rematch starts the moment every connected human is ready again.
- A dropped player's seat is played by a bot at once and held for 30 seconds (`RECONNECT_GRACE_MS`). Inside that time the same token gets the seat back; after it the bot keeps the seat and the token is refused (socket close code 4003).
- A player who leaves on purpose gets no grace.
- A newcomer may take over a bot seat that nobody is coming back to, even during a round.
- One minute with nobody connected (`IDLE_SHUTDOWN_MS`) and the room closes its sockets (code 4000), releases its PIN and deletes its storage.
- The lobby (seats, tokens, PIN) is saved and survives the object sleeping. A round in progress lives in memory only.

## Simulated latency

With `PARTY_SIM_LATENCY="on"`, a socket opened with `?lag=150` has every message delayed by 150 ms in each direction, in order (`new PartyClient({ lag: 150 })`).
The delay runs inside the room (`LagLine`), so the room's view of time is the real one.

## Tests

`npm test` at the repository root runs `party-kit/test/room-core.test.js`: seats and colours, nickname cleaning, ready and start, round seeds, the authoritative round, drop, rejoin inside and outside the grace, leaving, late joiners, stand-ins, idle shutdown, saving and restoring, the latency line, the seeded generator, PIN picking and the rate-limit window.
`npm run test:room` (with `npm run dev` running) checks the Durable Object wiring end to end over real sockets, with no browser: create, PIN lookup, QR code, join, a wrong PIN, simulated latency, start, an input relayed to the other seat, a drop with a stand-in, the same seat back with a full snapshot, and with `-- --full=1` the length of a whole round and the instant rematch.
The games' multiplayer playtests (for example `npm run playtest:battle`) drive the same path through real browsers.
`npm test` also checks the deploy settings (`test/deploy-config.test.js`), the API guards (`test/http.test.js`) and the score board's rules (`test/score.test.js`).
`npm run test:production -- <base>` checks the production settings end to end and `npm run test:turnstile` the bot check with Cloudflare's test keys; each file's header says which server to start.
The awake meter, the request count in the budget and the per-socket rate limit are tested with the party room, which uses them (`lobby/test/shared.test.js`); the party room's own tests are listed in `lobby/README.md`.
