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
- A seed owned by the room; each round derives its own seed from it. The seed never leaves the room.
- An authoritative room: clients send inputs, the room runs the game and sends events and snapshots.
- Per-seat views: each socket gets the snapshot its viewer may see, and an event can be for one seat only, so a game can keep a secret per seat.
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
| `src/core/views.js` | Per-seat views: the viewer a socket gets, events filtered by `only`, and one message built per kind of viewer. |
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
  tickHz: 30,          // room ticks per second while a round is on (0: turn-based, below)
  snapshotEvery: 15,   // a full snapshot every N ticks

  // A round begins (first start and every rematch). seed is this round's seed.
  create({ seed, seats, now, round }) { return state; },

  // An input from a human seat, or from this game's own bot. Inputs only: decide results in tick.
  input(state, seat, data, now) {},

  // Optional. Inputs for a seat a bot is holding, called once per tick.
  bot(state, seat, now) { return [/* data */]; },

  // Advance to `now`. Return the events clients should hear about.
  // An event with `only: seat` (or `only: [seats]`) reaches only the players in those seats.
  tick(state, now) { return events; },

  // What this viewer may see. A game that shows everyone the same can leave `viewer` out.
  snapshot(state, now, viewer) { return json; },
  isOver(state) { return false; },
  result(state) { return json; },   // optional, shown in the room view after the round: sent to everyone

  // Turn-based games only (tickHz: 0, below), all optional.
  nextDeadline(state) { return ms; },                        // when the room must wake, or null
  serialize(state) { return text; }, restore(text) { return state; },
  reconnectGraceMs: 120_000,                                 // how long a dropped seat is held (Infinity: while the room lives)
  presence(state, seat, { connected, away }, now) { return true; },  // who is here changed; true or events when the state did
  abandon(state, seat, now) { return { standings, result, events }; }, // a seat is gone for good: the game ends
  idleShutdownMs: 60_000, staleRoomMs: 1_200_000,            // the room's lifetimes while this game is played

  // Optional, in the party room (below): settings chosen after the vote, and a rematch carry.
  settings(value) { return clean; },  // or { ok: false, error, message }; `create` then gets `settings`
  carry(state) { return json; },      // when a game ends; the next `create` for the same seats gets `carry`
};
```

`now` is always the room's clock in milliseconds.
Use `makeRng(seed)` for every random choice so a round can be replayed.

### Per-seat views

A game with a secret per seat (Who Am I?: each phone shows the other player's identity, never its own) shapes what each socket receives.
`viewer` is one of these:

| `viewer` | Who it is |
| --- | --- |
| `{ role: "player", seat }` | A player's phone, and the seat is in the round. |
| `{ role: "screen" }` | The shared big screen, which holds no seat. |
| `{ role: "screen", seat }` | A member of the room whose seat is not in the round, who watches (in the kit's own room: someone who took a seat after the round ended, since a mid-round joiner takes over a bot's seat in the round). They get a screen's view; `seat` is there so a later version can tell a watching phone from the big screen. |

A game should treat any viewer it does not recognise as a screen, so new roles stay safe.
The room calls `snapshot` once for each kind of viewer and sends each socket its own: the `start` message, every `snap` (on schedule, at the end of the round, and the full one a socket gets when it connects mid-round) are all shaped this way.
Events are filtered the same way: an event whose `only` names seats goes to those players and to nobody else (no screen, no watcher); every other event goes to everyone.
The field is `only`, not `to`, because games already use `to` for their own meaning (Cork & Bell's shots).
What is not shaped: the room view and `end`'s `result` (from `game.result`) go to everyone, so they must hold no secret.

The room's seed is never sent (it used to be in the room view), because every round's seed is drawn from it: a game that drew a secret from its round seed would otherwise give it away.
A game that wants its clients to have a seed puts one in its own snapshot, as Cork & Bell does; a game with secrets keeps them out of it, and Who Am I? draws its identities from `crypto.getRandomValues` instead.
`game.privateSeed` is therefore not needed: the kit keeps every room's seed private.

A game that ignores `viewer` and puts no `only` on its events gets the same frames on every socket as before this existed.
The helpers are plain logic in `src/core/views.js`, also exported from `n8-party-games/kit/core` (`viewerFor`, `viewerKey`, `eventsFor`, `fanOut`), so another kind of room can shape its messages the same way.

### Turn-based games

A game that says `tickHz: 0` is turn-based: no timer ticks it, each input is applied the moment it arrives, the game's `nextDeadline(state)` (a turn timer) is the room's alarm and calls `tick` once, and the game is saved after every input (with `serialize` and `restore` when it has them, as plain JSON otherwise) and restored when the room wakes.
The rules are in `GAME-CONTRACT.md`, "Turn-based games".
The party room runs such games today.
This kit's own room (`createPartyRoom`) does not yet: it ticks every game on a timer and keeps a round in memory only, so do not give it a game with `tickHz: 0`.
The logic either room needs is plain, in `src/core/turns.js`: `isTurnBased`, `gameProblems` (what is wrong with a game definition), `deadlineOf`, `inputOutcome` (an input's events, and the game's answer to its sender), and `saveState` and `loadState` (which refuse a state that is not plain JSON instead of letting it come back changed).
The client keeps quiet during such a game: when the room view's `game` says `turns: true`, `PartyClient` sends its keep-alive instead of a clock ping every two seconds, after three clock pings when the game begins and after a reconnect.

A turn-based game is humans only: nobody stands in for a player, and `bot` is never called for it.
A seat whose phone drops keeps its place for the game's grace (`reconnectGraceMs`, `Infinity` for "while the room lives"; two minutes when the game says nothing).
The game hears who is here through an optional `presence(state, seat, { connected, away }, now)`, called whenever that changes for one of its seats: a socket closing or coming back, a page hidden with its socket open (`away`), a wake from sleep that finds a socket gone.
What it changes is saved and sent like an input's, and `nextDeadline` is asked again, so a game can pause its turn timer and allow its own overrides.
A seat gone for good (its player left the party, or the grace ran out) ends the game early through an optional `abandon(state, seat, now)`, whose `{ standings, result, events }` decide the result; without it the game ends with no points.
While the game is played the room closes one nobody has touched after its `staleRoomMs`, and an empty one after its `idleShutdownMs` or the end of the longest grace still running, whichever is later (the room's own values when it says nothing); the party's four hours and a budget close end the game with a note.
An input is applied to a copy of the state, kept only when `input` returned; for a game with `serialize`, the copy is `restore(serialize(state))`, so `serialize` must be complete: a field it leaves out is lost on the next input; a callback that throws (`input`: the sender is answered `game_error`; `tick` or `presence`: the game ends with no points and a note) never leaves a half-changed game.
A refusal that changed nothing is not saved and only its sender hears of it; its answer is kept in memory only until the next save, so after a sleep a retry of that id is judged afresh (never applied twice, but perhaps answered differently).
The rules are in `GAME-CONTRACT.md`, "Who is here during a turn-based game".
An input may carry an id, and the party room then answers its sender `ack {id}` or `error {id, error, message}`, once, however often the same id is sent with the same data, and `id_reused` when it comes with other data (`GAME-CONTRACT.md`, "Answered inputs"; the logic is `src/core/answers.js`: `inputId`, `answerOf`, `answerMessage`, `inputDigest`, `lookup`, `recall`, `remember`; and `copyState` and `stateKey` in `src/core/turns.js`).
The plain logic for presence is `src/core/presence.js`: `presenceSignal`, `allAway`, `reportOf`, `graceOf`, `goneWhy`, `graceEndsAt`, `presenceOutcome`, `abandonOutcome`, `lifetimesOf` and `presenceProblems` (which `gameProblems` includes).

### Settings and a rematch carry

A game may have settings that the party's host chooses after the vote, before the game starts.
It declares `settings(value)`, which checks a settings object and returns it clean with its defaults filled in, or refuses it with `{ ok: false, error, message }`.
Its manifest describes the choices for the page as `manifest.settings`, a list of fields, each with `key`, `label`, `options` (each `{ value, label }` or a bare value: a string, a number, `true` or `false`) and `default`.
When the game wins the vote the party room is in a short settings step; the host's picks are checked by the game, shown to everyone, and passed to `create` as `settings`.
A game may also declare `carry(state)`, which returns a small plain-JSON object when a game ends; the room keeps it for that game and the same people in the same seats, and passes it to the next `create` of that game for them as `carry` (null when there is none).
The rules are in `GAME-CONTRACT.md`, "Settings after the vote" and "What a rematch carries".
The party room runs both; this kit's own room (`createPartyRoom`) does not read them yet.
The plain logic is `src/core/settings.js`: `hasSettings`, `hasCarry`, `settingFields` (the manifest's fields in one shape, with what is wrong), `fieldDefaults`, `settingsProblems`, `checkSettings` (the game's own check), `applyChange` (one change from the host, checked against the fields), `carryOf`, `seatsKey` and `carryFor`.

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

Client to room: `ping {c}`, `in {d, id?}` (an input; `id` asks the party room for an answer in a turn-based game), `ready {v}`, `name {v}`, `character {v}`, `addBot`, `removeBot {seat}`, `start`, `leave`.
The party room also takes `away` and `back` from a player's page whose socket stays open while it is hidden and shown again; the seat is away when every open socket of it is, and its room view member says `away: true`.
This kit's own room does not read them yet.

Room to client: `hello {you, room}`, `room {room}`, `pong {c, s}`, `start {room, s, now}`, `ev {ev, now}`, `snap {s, now, full?}`, `end {room, result, now}`, `error {error, message}`.
The party room answers an input with an id in a turn-based game with `ack {id}` or `error {id, error, message}`, to its sender only ("Turn-based games").
`s` in `start` and `snap`, and the list in `ev`, are shaped for the socket's viewer ("Per-seat views"); a socket left with no events after filtering gets no `ev` message for that tick.

The room view (`room`) holds `pin`, `code`, `phase` (`lobby`, `playing`, `ended`), `round`, `startAt`, `canStart`, `hostSeat`, `screens`, and `seats`: for each seat `{seat, name, kind: "human" or "bot", colour, connected, ready, away, character}`.
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

// A turn-based game in the party room: wait for the room's answer.
try {
  await party.sendInput({ type: "guess", text: "owl" }, { id: party.nextInputId() });
} catch (err) {
  // err.code: the game's error ("not_your_turn"), or "game_error", "id_reused", "timeout", "disconnected", "not_connected"
}
```

`sendInput(data)` without an id is fire and forget and returns whether it was sent, as every ticking game uses it.
With `{ id }` (a string of up to 64 characters or a whole number, unique for the seat for the whole game, also across reloads: `nextInputId()` makes one, from a random part chosen when the page loaded and a count) it returns a promise: it resolves with `{ ok: true, id }` on `ack` and rejects with a `PartyError` on `error` (its `code` the game's error, its `id` the input's), after `timeoutMs` (default `ANSWER_TIMEOUT_MS`, ten seconds) with `"timeout"`, and when the connection drops first with `"disconnected"`.
The fresh snapshot arrives before the answer.
Sending the same id again while it waits returns the same promise, and the room never applies it twice, so a page may send the same input again after a reconnect.
The same id with other data is refused with `"id_reused"`.
In a ticking game nothing is answered: the input goes without its id and the promise resolves at once with `{ ok: true, id, answered: false }`.
An `error` with an id goes to its promise; one that no promise waits for any more (it timed out) goes to the `error` event.
The follow-up clock pings a turn-based game sends when it begins belong to one connection, and are dropped when it closes.

`PartyClient` methods: `create`, `preview`, `join`, `resume`, `sendInput`, `nextInputId`, `setReady`, `rename`, `setCharacter`, `addBot`, `removeBot`, `start`, `leave`, `now`, `joinUrl`, `qrUrl`, and `dropConnection({reconnectAfterMs})` for tests.
Events: `room`, `start`, `events`, `snapshot`, `end`, `status`, `error`, `closed` (with the room's own reason for closing the socket as a second argument, when it gave one), and `message` for anything the kit does not know.
Options: `base`, `lag`, `storage`, `api` and `quietPing` (see "A second kind of room on one site").

A screen (`create({as: "screen"})` or `join(pin, {as: "screen"})`) holds no seat and receives the screen's view of the game: use it for the shared big screen.

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
- The lobby (seats, tokens, PIN) is saved and survives the object sleeping. A round in progress lives in memory only (in this room; the party room saves a turn-based game, "Turn-based games").

## Simulated latency

With `PARTY_SIM_LATENCY="on"`, a socket opened with `?lag=150` has every message delayed by 150 ms in each direction, in order (`new PartyClient({ lag: 150 })`).
The delay runs inside the room (`LagLine`), so the room's view of time is the real one.

## Tests

`npm test` at the repository root runs `party-kit/test/room-core.test.js`: seats and colours, nickname cleaning, ready and start, round seeds, the authoritative round, drop, rejoin inside and outside the grace, leaving, late joiners, stand-ins, idle shutdown, saving and restoring, the latency line, the seeded generator, PIN picking and the rate-limit window.
`party-kit/test/views.test.js` drives the room's Durable Object class itself, with fake sockets that keep every frame as sent: with a game that holds a secret per seat, no frame to a seat carries its own secret, the other seat's frames carry it, the screen and a later arrival get neither, the room's seed is in no frame, and a game that ignores the viewer sends every socket the same frames.
`party-kit/test/turns.test.js` covers the turn-based logic in `src/core/turns.js`, and `party-kit/test/party-client-ping.test.js` how often the client pings in the lobby, in a turn-based game and in a ticking one.
The party room's turn-based games are proved on its real Durable Object class in `lobby/test/party-room-turns.test.js`.
`npm run test:room` (with `npm run dev` running) checks the Durable Object wiring end to end over real sockets, with no browser: create, PIN lookup, QR code, join, a wrong PIN, simulated latency, start, an input relayed to the other seat, a drop with a stand-in, the same seat back with a full snapshot, and with `-- --full=1` the length of a whole round and the instant rematch.
The games' multiplayer playtests (for example `npm run playtest:battle`) drive the same path through real browsers.
`npm test` also checks the deploy settings (`test/deploy-config.test.js`), the API guards (`test/http.test.js`) and the score board's rules (`test/score.test.js`).
`npm run test:production -- <base>` checks the production settings end to end and `npm run test:turnstile` the bot check with Cloudflare's test keys; each file's header says which server to start.
The awake meter, the request count in the budget and the per-socket rate limit are tested with the party room, which uses them (`lobby/test/shared.test.js`); the party room's own tests are listed in `lobby/README.md`.
