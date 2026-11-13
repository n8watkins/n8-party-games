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
6. Stand both pieces in Cork & Bell's light: the battle starts for the two of you inside the room, each window shows its own stall (a third window as the room's screen shows both), and ninety seconds later both are back by the door with the scores on a card and points on the Tonight board. One piece alone in that light gets a round to itself.
7. Stand both pieces in Who Am I?'s light: "Opens in 3" counts down, a card says where everyone is going, and both windows go to its own site.
8. Close one window to see the piece turn grey, and fade thirty seconds later.

Coin Flip is a test game.
It hangs on the wall only where `PARTY_TEST_GAMES` is `"on"`, which is the `local` environment in `wrangler.jsonc` (`npm run dev` and the test runs).
Production has no such variable, so its wall is Cork & Bell, Who Am I? and the three coming-soon boxes (Tin Derby, Flood, Fox Trouble).
To see the wall as production hangs it: `npx wrangler dev --local --env local --port 8792 --var PARTY_TEST_GAMES:off`.

For a big screen, open a third window, choose "Use this as the room's screen" and type the code.
For phones on the same network, `npm run dev:lan` prints the address to open; the QR code on the wall then points at it.
Stills of the main states, from a real run, are in [`shots/`](shots/).

## What is built

- The room in the bar look, drawn with plain shapes as one SVG, the same picture on every device.
- Game boxes from each game's manifest. The name is on the poster, once. The sign under it has one line about the game, how many can play ("1-4 players") and the device badge (cyan any device, violet a phone each, amber phones and a big screen). Every sign says how many can play, the coming-soon ones too. On a phone, with five boxes or more, a sign is too narrow for the line of words at a size worth reading, so it keeps the count and the badge and the words are left to bigger screens.
- The join code and its QR code on the wall, and a Tonight board with 3, 2 and 1 points for first, second and third.
- Pawns in the four seat colours with name tags: walk, jump, and a weak bump everyone has.
- The vote: standing in a light is your vote, a visible count runs when every connected player stands in some light, the light with the most players wins, stepping out of every light stops it, and "Waiting for" names who is in the dark.
- A tie is settled by a coin toss everybody watches. A phone in the closer view pulls back to the whole room for the count and the toss.
- A player alone can start: one piece in a light runs the same three-second count.
- A game the party cannot play has its light off and says why in a few words ("Needs 2 players", "For 2 players", "Needs a big screen", "Coming soon").
- Outside games: a game that plays on a site of its own hangs on the wall with an address instead of a hosted game (below).
- A big screen that joins with the code and holds no seat, and a player's view with buttons, a "Whole room / Closer" switch and a "turn your phone" hint when upright.
- Joining in the middle of a vote, a dropped phone that turns grey, comes back to its seat or fades with a note, and "Leave the party" behind the door button. Whenever the set of connected players changes, the count starts over.
- Someone who left or dropped and joins again under the same name gets their points back.
- A game started with the party's seats, ended with places, and everyone returned to the lobby with points: the seam in `party-kit/GAME-CONTRACT.md`, "The lobby hooks".
- Cork & Bell played inside the room through that seam (below).

## Outside games

An outside game is not on the kit: it has a site and rooms of its own.
In `wall.js` it is an entry with a `url` where a hosted game has a server definition (`OUTSIDE`), and its poster says "ON ITS OWN SITE".
Who Am I? (`https://whoami.n8builds.dev/`) is the first.

- Its light follows the same rule as any game's: on when the party is a size the game takes. Who Am I? is for exactly two players (its engine's `MAX_PLAYERS`, and it needs both to start), so with one player its sign says "Needs 2 players" and with three or four "For 2 players".
- The count reads "Who Am I? opens in 3", not "starts".
- When it wins the count or the coin toss, the room sends every page `away { id, name, url, in }`. Every player's page and the big screen show a card, "Off to Who Am I?", for six seconds (`AWAY_MS`) and then go to the address. The card says the party's code does not work there (one of them makes a room on that site and the others join it) and that nobody scores. "Go now" goes at once; "Stay in the room" keeps that one device here.
- Nothing starts in the room, so nothing ticks and no room time is spent: it costs the one wake-up that ended the count.
- The Tonight board gets no points from an outside game, and it does not count as a game played.
- Afterwards the party room is left alone. The pieces are put back by the door, and a new count cannot start for twelve seconds, so anyone who stayed is not sent off again at once. Once the pages have gone the room is empty: the seats are let go after thirty seconds and the room closes a minute after the last page left, by the usual rules. Coming back to the room's address inside that minute finds the same seat and points; after it, the party has ended and a new one is started.
- The page only ever follows an `https` address or a page of this site, and only one that came from the room's own wall.

A hosted game whose manifest names no view for the room would hang the same way, with its own page on this site as the address.
Cork & Bell did until it got one.

## Cork & Bell in the room

Cork & Bell is its own repository and package (`games.js`), and it is the first real game played inside the room.

- **The wall.** Its sign reads "1-4 players": a battle is two to four stalls, and one player plays alone (`players.solo` in its manifest), so its light is on for any party.
- **The start.** When it wins the count or the toss, the room calls its `game.create` with the party's seats, names and colours, and ticks it at its own thirty times a second. There is no waiting room and no ready step.
- **On a player's device.** The room's page fetches the view the game's manifest names (`/cork-and-bell/game/party-view.js`) and mounts it over the room: the player's own stall, full screen, with the rivals' tokens to pick a target. The game's files are fetched ahead while the count is still running.
- **On the big screen.** A spectator view: every stall in the round side by side, with names and scores, as the game's own shared screen shows a battle. Someone who joins the party in the middle of a round sees the same until it ends.
- **A party of one** gets a round to itself, the same ninety seconds with nobody to send attacks to. It is first of one, so it puts three points on the Tonight board.
- **The room's own things** on top of the game are the door button (already drawn for a phone held sideways: "Leave the party" works mid-round), the notes ("Tom left") and the word about the connection. The room's bars are put away and the room is not drawn under the game.
- **A phone that drops** has its stall played by the game's stand-in until it is back; a reload in the middle comes back to the same stall with its score.
- **The end.** After ninety seconds (or when only one stall still has corks) the game is taken away, everyone is back by the door, and the room's card shows who came where with the scores: 3, 2 and 1 points for the Tonight board, equal scores sharing a place.
- **Nothing is left behind.** The game runs in a frame of its own page, so its listeners, timers, sound and WebGL context go when the frame goes; the view also lets the WebGL context and the sound go at once. `npm run test:cork` checks it on every device.

The game's own page at `/cork-and-bell/` is unchanged: solo with the high score board, and battles in rooms of its own.

## What is not built

- Coin Flip is a placeholder for local play and the tests, marked "TEST GAME" on its box. Tin Derby, Flood and Fox Trouble are names and pictures only.
- A party's code, seats and points do not carry over to an outside game's site.
- No skins, no abilities, no chat bubbles, no walking through the door, no "host starts" setting, no other rooms.
- "Back to the room" in the middle of a game: a round runs its ninety seconds, and a player can still leave the party.
- In the room Cork & Bell has no high score entry, no rematch button and no end card of its own: the room's card shows the scores, and the vote is the rematch. The high score board stays on the game's own page.

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

Measured on 2026-11-12 with `npm run lobby:measure`: four scripted players for ten minutes against a local server with fresh storage and nothing else on it, driven by the same code the page uses to decide what to send.
The room budget's books were read before and after.
(Fresh storage matters: the books are shared by every room on a server, so rooms left over from other runs are counted too.)
These are local measurements of the room's own counting, not a Cloudflare bill: check them against the dashboard after a real evening (`DEPLOY.md`, "The party room").

| | Only wandering | Wandering and voting, short games | Cork & Bell, round after round |
| --- | --- | --- | --- |
| What happened | no game was started | 24 votes won: 11 games of Coin Flip (three seconds each) and 13 that sent everyone to an outside game, 20 coin tosses | 5 rounds of Cork & Bell in 10.2 minutes, each player firing a cork about every 1.3 seconds (1,372 corks) |
| Messages to the room | 2.55 a second (0.64 per player) | 3.76 a second (0.94 per player) | 2.98 a second (0.75 per player) |
| Awake time | 0.28 seconds per minute | 3.77 seconds per minute, of which Coin Flip's tick loop is 3.3 and the lobby itself 0.47 | 46.4 seconds per minute, of which the rounds are 46.3 (94.6 seconds each) and the lobby itself 0.07 |
| Duration | 2.2 GB-seconds per room-hour | 28.9 GB-seconds per room-hour | 356 GB-seconds per room-hour |
| Requests | 562 per room-hour | 1,243 per room-hour | 838 per room-hour |
| Room-hours a month the 10% of time buys (40,000 GB-s) | 18,385 | 1,383 | 112 |

For scale: a room that is awake all the time, as a game's own room is during a round, uses 461 GB-seconds per room-hour, and the 10% buys 87 hours of that.
The second column is a keen party that starts a vote every half minute, measured before Cork & Bell opened in the room (a vote for it then sent everyone to its own page).
An outside game winning the vote costs one wake-up and no duration: nothing is played in the room.

**A round of Cork & Bell is what a party room costs.**
The room is awake for all of a round, as the game's own room is: 94.6 seconds (the count-in, ninety seconds and the hold at the end), which is 12.1 GB-seconds, whether one plays or four.
`npm run test:cork` reads the same figure from the books for a battle of three and for a round played alone.
The 10% of a month (40,000 GB-seconds) is about 3,300 rounds, and a day's tenth of that (4,000) about 330 rounds across every party room there is.
Everything between rounds costs next to nothing by comparison, so an evening costs its rounds: a party that plays six rounds in an hour uses about 73 GB-seconds, and the 10% buys about 550 such hours a month.
The third column is the ceiling: a party that votes again the moment each round ends.
All of it is counted against the shared room budget second for second (`PARTY_ROOM_BUDGET_SHARE`), and when the day's or month's allowance is spent the round in play finishes and no other starts (below).
After a round the room is asleep again: no timer, and the next wake-up is the slow "forgotten room" check twenty minutes away (both checked by `test:cork`).

How the awake time is counted: every event (a message, an alarm, a join) as the time its handler took and never less than 2 ms, and a game's tick loop second for second.
The floor is a deliberate overcount, since a handler that only does arithmetic takes well under a millisecond.
Cloudflare bills a Durable Object while it runs code or cannot sleep, and not while it is idle and able to hibernate, even before it has been put to sleep (their pricing page says so in those words).
If it did bill every second in which any message arrived, the first two runs would be 350 to 385 GB-seconds per room-hour and the 10% would buy about 105 to 115 room-hours: that is the worst case, and even then the lobby costs less than a room that is always awake.
(For the third run that reading makes little difference, 422 against 356: the room is awake for the rounds anyway.)

**Requests are the tighter of the two allowances.**
The plan includes one million Durable Object requests a month for the whole account, and the owner's 10% rule is about time, not requests.
That holds for the lobby and for short games; with Cork & Bell round after round it is time that runs out first (112 room-hours against 119).
At the rates above, a million requests is 800 to 1,780 room-hours, and a tenth of it 80 to 178.
Past the included million they cost $0.15 a million: 8 to 19 cents per 1,000 room-hours.
The budget counts the party rooms' requests (`dayRequests` and `monthRequests` beside the time) so the owner can see them, but only time closes anything.

A lobby nobody touches costs nothing: no timer, no messages, nothing counted, and locally the room object is put to sleep while the test waits (`npm run test:lobby` checks all of it over 25 seconds).

## Limits, and what happens when the allowance is spent

- A room closes one minute after the last person goes, and after twenty minutes in which nobody did anything (the kit's two rules). A page warns its player two minutes before the second. The minute is counted from when the room emptied, also when the room was put to sleep in between (it used to start over at every waking, which kept an empty room, waking once a minute, until the second rule closed it).
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
| `games/coin-flip.js` | The test game, hung only where `PARTY_TEST_GAMES` is on. |
| `wall.js` | Which boxes hang on the wall (hosted, outside, test, coming soon), which can start, and the wall each environment gets. |
| `public/` | The page at `/lobby/`: the way in, the scene, the buttons and words over it, and each game's view. |
| `test/` | Unit tests, the socket test, the browser run and the cost measurement. |

`shared/` is plain logic used by both the room and the page, and it is served to the browser; `server/` and `test/` never are.

## Tests

- `npm test` runs the unit tests with the kit's: the room's rules (`test/lobby-core.test.js`) and the shared logic, the awake meter and the socket rate limit (`test/shared.test.js`).
- `npm run test:lobby` (with `npm run dev` running) puts four socket players through an evening (when the coin toss picks Cork & Bell, a whole round of it over sockets, which makes the run a minute and a half longer), sends a party of two off to an outside game, then checks that a lobby nobody touches goes silent: no messages, no timer, nothing added to the budget.
- `npm run lobby:shots` drives real pages in a headless, muted browser and takes a still of every state on a big screen, a sideways phone and an upright one, checking that no text spills out of its place and that no card runs off a screen. It follows an outside game all the way to its address (the browser is handed a stand-in page, so no test touches the real site), and with `--plain=<a server with the test games off>` it also takes the wall as production hangs it. Stills land in `lobby/test/shots/`, which is not committed; a chosen few are in `lobby/shots/`.
- `npm run test:cork` plays Cork & Bell inside the room in real pages (headless and muted): a party of three and a big screen, clicks that fire, a reload in the middle, the end, that nothing of the game is left on the page, a party of one, and what the two rounds cost. It takes about four minutes. With `-- --win=1` it uses the game's own tool to drive Chrome on the Windows side, on the real graphics card. Without it, Playwright's browser in WSL draws WebGL in software and its pages run seconds behind the room, so the run says so and leaves out the reload, the door sheet and the stills; everything the room decides is checked either way.
- `npm run lobby:measure` is the cost measurement above. `-- --game=cork-and-bell` makes every vote a round of Cork & Bell.
- `node lobby/test/e2e-budget.mjs` checks what happens when the allowance is spent; its header says which server to start.
