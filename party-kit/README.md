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

Everything runs locally with `wrangler dev --local`.
Nothing here deploys anything.

## Layout

| Path | What it is |
| --- | --- |
| `src/core/room-core.js` | The room as plain logic with an injected clock: seats, ready, start, drop and rejoin, bots, idle. No network. |
| `src/core/rng.js` | `makeRng(seed)`, `hashSeed`, `newSeed`. |
| `src/worker/index.js` | `handlePartyApi(request, env)`, `createPartyRoom(game)`, `PinDirectory`, `RateLimiter`. |
| `src/worker/room.js` | The Durable Object around `RoomCore`: WebSockets, the tick loop, saving, shutdown. |
| `src/worker/pin-directory.js`, `pin-logic.js` | 4-digit PINs: 15 minute life, 10 minute cooldown before reuse. |
| `src/worker/rate-limiter.js`, `limit-logic.js` | Fixed-window limits per client address. |
| `client/party-client.js` | The browser client (ES module, no build). |
| `client/lobby.js`, `client/lobby.css` | The waiting room. |
| `test/` | Unit tests (`npm test` at the repository root). |

## Worker side

```js
// worker.js
import { createPartyRoom, PinDirectory, RateLimiter, handlePartyApi } from "./party-kit/src/worker/index.js";
import { game } from "./my-game/server.js";

export const PartyRoom = createPartyRoom(game);
export { PinDirectory, RateLimiter };

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
  { "name": "PARTY_LIMITER", "class_name": "RateLimiter" }
] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["PartyRoom", "PinDirectory", "RateLimiter"] }]
```

Variables (all optional):

| Variable | Meaning |
| --- | --- |
| `PARTY_PUBLIC_ORIGIN` | The address phones can reach, used in the join link and QR code (for local play: `http://<laptop LAN address>:<port>`). |
| `PARTY_SIM_LATENCY` | `"on"` lets a client ask for simulated latency with `?lag=<ms>` on its socket. Leave it off in production. |
| `PARTY_RATE_LIMIT` | `"off"` disables the limits (for local test runs with many headless players). |

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
| `POST /api/party/rooms` `{nickname, as?: "player" or "screen"}` | `{code, pin, token, seat, role}` |
| `GET /api/party/join/:pinOrCode` | `{preview: {code, game, phase, players, full}}` |
| `POST /api/party/join/:pinOrCode` `{nickname, as?}` | `{code, pin, token, seat, role}` |
| `GET /api/party/rooms/:code/ws?token=...&lag=150` | WebSocket |
| `GET /api/party/qr.svg?text=...` | A QR code as SVG |
| `GET /api/party/config` | `{publicOrigin, simLatency}` |

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
Events: `room`, `start`, `events`, `snapshot`, `end`, `status`, `error`, `closed`.

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
The Durable Object wiring is exercised end to end by the games' multiplayer playtests (for example `npm run playtest:battle`).
