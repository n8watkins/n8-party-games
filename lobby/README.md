# The party room (the lobby)

One room that hosts many games.
Up to four players are little pieces in a side-view room.
Game boxes hang on the wall, each with a lamp and a pool of light on the floor, and you vote for a game by standing in its light.
A phone held sideways shows the same room, live, as the big screen.
The group stays in one room and goes from game to game without leaving.

This is a first playable version: a thin slice to find out whether it is fun and what it costs to host.
The pictures it is built from are in the `wave2/lobby-pictures` branch (`lobby/preview/`).

## Try it

```sh
npm run dev          # http://localhost:8791/
```

On one laptop, open the address in two browser windows side by side (two windows, not two tabs: a hidden tab stops drawing).
Make each window short and wide to see what a sideways phone sees, or use the browser's device toolbar at 844 x 390.

1. In the first window choose "Start a party", type a name and start.
2. In the second window type the four-digit code from the sign on the wall, type a name and join.
3. Walk with the arrow keys (or A and D), jump with Space, bump with B, and open the door button with Escape. On a touch screen the same things are buttons.
4. Stand both pieces in Coin Flip's light: "Starts in 3" counts down, the game plays, and both are back by the door with points on the Tonight board.
5. Stand one piece in each lit light for a tie and its coin toss.
6. Close one window to see the piece turn grey, and fade thirty seconds later.

For a big screen, open a third window, choose "Use this as the room's screen" and type the code.
For phones on the same network, `npm run dev:lan` prints the address to open; the QR code on the wall then points at it.
Stills of the main states, from a real run, are in [`shots/`](shots/).

## What is built

- The room in the bar look, drawn with plain shapes as one SVG, the same picture on every device.
- Game boxes from each game's manifest: name, one line about it, the device badge (cyan any device, violet a phone each, amber phones and a big screen) and the player count.
- The join code and its QR code on the wall, and a Tonight board with 3, 2 and 1 points for first, second and third.
- Pawns in the four seat colours with name tags: walk, jump, and a weak bump everyone has.
- The vote: standing in a light is your vote, a visible count runs when every connected player stands in some light, the light with the most players wins, stepping out of every light stops it, and "Waiting for" names who is in the dark.
- A tie is settled by a coin toss everybody watches. A phone in the closer view pulls back to the whole room for the count and the toss.
- A player alone can start: one piece in a light runs the same three-second count.
- A game the party cannot play has its light off and says why in a few words ("Needs 2 players", "Needs a big screen", "Coming soon").
- A big screen that joins with the code and holds no seat, and a player's view with buttons, a "Whole room / Closer" switch and a "turn your phone" hint when upright.
- Joining in the middle of a vote, a dropped phone that turns grey, comes back to its seat or fades with a note, and "Leave the party" behind the door button. Whenever the set of connected players changes, the count starts over.
- Someone who left or dropped and joins again under the same name gets their points back.
- A game started with the party's seats, ended with places, and everyone returned to the lobby with points: the seam in `party-kit/GAME-CONTRACT.md`, "The lobby hooks".

## What is not built

- Cork & Bell does not open inside the room. Its light is on and it can win the vote; the room then shows a card that says so, with a link to the game's own page, and nobody scores.
- Coin Flip is a placeholder, marked "TEST GAME" on its box. Who Am I?, Tin Derby and Flood are names and pictures only.
- No skins, no abilities, no chat bubbles, no walking through the door, no "host starts" setting, no other rooms.
- "Back to the room" in the middle of a game.

## How it stays cheap

The owner pays for the time a room's Durable Object is awake, and for requests (an incoming WebSocket message is a twentieth of one).
So the room is built to be asleep, and to hear as little as it can.

- **Each player's page moves its own piece, and says so only when something changes.** A message goes out when a piece changes direction, jumps, or steps into or out of a light that is on. Walking in a straight line sends nothing: movement has one speed and no acceleration, so everyone, the room included, carries a piece forward from where it was last heard of (`shared/world.js`, `posAt`).
- **The room relays and judges only what must be fair.** It passes a move on to the others, works out who stands in which light, starts and stops the count, decides the toss, and decides who a bump lands on. It never trusts a position that could not have been reached, and corrects the page that sent it.
- **Nothing ticks in the lobby.** There is no loop. Everything that depends on time (the count's end, the toss, a dropped phone's thirty seconds, closing) is the object's alarm, which lets it sleep in between.
- **The keep-alive never wakes the room.** A page sends the text `ping` every 20 seconds and the runtime itself answers `pong` (`setWebSocketAutoResponse`).
- **A timer runs only while a game is played**, at the game's own tick rate.

Other players' pieces look smooth because each page draws them a little way toward where they should be on every frame, instead of jumping to what the network last said.

What was not chosen: a server tick that simulates every piece (the room would be awake all the time anyone is connected, which is exactly the cost to avoid), and pages sending their position many times a second (several times the requests, for the same picture).

## What it costs

Measured on 2026-11-12 with `npm run lobby:measure`: four scripted players for ten minutes against the local server, driven by the same code the page uses to decide what to send.
The room budget's books were read before and after.
These are local measurements of the room's own counting, not a Cloudflare bill: check them against the dashboard after a real evening (`DEPLOY.md`, "The party room").

| | Only wandering | Wandering and voting |
| --- | --- | --- |
| What happened | no game was started | 20 votes won: 8 games of Coin Flip, 12 for Cork & Bell (which does not open here yet), 13 coin tosses |
| Messages to the room | 2.66 a second (0.67 per player) | 3.78 a second (0.94 per player) |
| Awake time | 0.29 seconds per minute | 2.85 seconds per minute, of which Coin Flip's three-second tick loop is 2.4 and the lobby itself 0.45 |
| Duration | 2.2 GB-seconds per room-hour | 21.9 GB-seconds per room-hour |
| Requests | 577 per room-hour | 1,327 per room-hour |
| Room-hours a month the 10% of time buys (40,000 GB-s) | 18,160 | 1,827 |

For scale: a room that is awake all the time, as a game's own room is during a round, uses 461 GB-seconds per room-hour, and the 10% buys 87 hours of that.
The second column is a keen party that starts a vote every half minute; most evenings will sit between the two.

How the awake time is counted: every event (a message, an alarm, a join) as the time its handler took and never less than 2 ms, and a game's tick loop second for second.
The floor is a deliberate overcount, since a handler that only does arithmetic takes well under a millisecond.
Cloudflare bills a Durable Object while it runs code or cannot sleep, and not while it is idle and able to hibernate, even before it has been put to sleep (their pricing page says so in those words).
If it did bill every second in which any message arrived, these same runs would be 375 GB-seconds per room-hour and the 10% would buy about 105 room-hours: that is the worst case, and even then the lobby costs less than a room that is always awake.

**Requests are the tighter of the two allowances.**
The plan includes one million Durable Object requests a month for the whole account, and the owner's 10% rule is about time, not requests.
At the rates above, a million requests is 750 to 1,730 room-hours, and a tenth of it 75 to 173.
Past the included million they cost $0.15 a million: 9 to 20 cents per 1,000 room-hours.
The budget counts the party rooms' requests (`dayRequests` and `monthRequests` beside the time) so the owner can see them, but only time closes anything.

A lobby nobody touches costs nothing: no timer, no messages, nothing counted, and locally the room object is put to sleep while the test waits (`npm run test:lobby` checks all of it over 25 seconds).
Once a real game is hosted in the room, its rounds will cost what they cost in the game's own room: all of the round's time.

## Limits, and what happens when the allowance is spent

- A room closes one minute after the last person goes, and after twenty minutes in which nobody did anything (the kit's two rules). A page warns its player two minutes before the second.
- A room closes four hours after it was made, never in the middle of a game. Pages warn five minutes before.
- One socket may send a burst of 40 messages, then 20 a second. More are dropped, and a socket that keeps flooding is closed and its seat given up. A message over 512 bytes, or one that is not JSON, is dropped and counts five times.
- When the day's or month's allowance is spent: no new party can start (the front page's way in answers that the rooms are full, and that each game still plays on its own page); an open room finishes the game it is playing, starts no other, tells everyone "This room closes in 3:00", and closes three minutes later.

## Layout

| Path | What it is |
| --- | --- |
| `shared/world.js` | The room as numbers: where things are, how a piece moves, who a bump reaches. |
| `shared/vote.js` | The vote's rules: which games the party can play, who leads, what a place is worth. |
| `shared/pilot.js` | A player's own piece: moves at once, and decides what is worth telling the room. |
| `shared/camera.js` | Which part of the room a device shows. |
| `shared/status.js` | The words under the room. |
| `server/lobby-core.js` | The room as plain logic with an injected clock: seats, the vote, the game seam, the Tonight board, sleeping and closing. |
| `server/lobby-room.js` | The Durable Object around it: sockets, relaying, the alarm, the budget. |
| `games/coin-flip.js` | The test game. |
| `wall.js` | Which boxes hang on the wall and which can start. |
| `public/` | The page at `/lobby/`: the way in, the scene, the buttons and words over it, and each game's view. |
| `test/` | Unit tests, the socket test, the browser run and the cost measurement. |

`shared/` is plain logic used by both the room and the page, and it is served to the browser; `server/` and `test/` never are.

## Tests

- `npm test` runs the unit tests with the kit's: the room's rules (`test/lobby-core.test.js`) and the shared logic, the awake meter and the socket rate limit (`test/shared.test.js`).
- `npm run test:lobby` (with `npm run dev` running) puts four socket players through an evening, then checks that a lobby nobody touches goes silent: no messages, no timer, nothing added to the budget.
- `npm run lobby:shots` drives real pages in a headless, muted browser and takes a still of every state on a big screen, a sideways phone and an upright one, checking that no text spills out of its place. Stills land in `lobby/test/shots/`, which is not committed; a chosen few are in `lobby/shots/`.
- `npm run lobby:measure` is the cost measurement above.
- `node lobby/test/e2e-budget.mjs` checks what happens when the allowance is spent; its header says which server to start.
