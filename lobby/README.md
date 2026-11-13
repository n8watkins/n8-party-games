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
3. Walk with the arrow keys (or A and D), jump with the up arrow (or Space), bump with B, and open the door button with Escape. On a touch screen the same things are four buttons, and on a laptop each button shows its key.
4. Stand one piece just in front of the other and bump: the bumper winds up and slams, the other is thrown back, tips over and gets up. The bump button's ring shows the cooldown.
5. Stand both pieces in Coin Flip's light: "Starts in 3" counts down, the game plays, and both are back by the door with points on the Tonight board.
6. Click the Tonight board on the wall to open it large; click anywhere, press Escape or go back to close it.
7. Stand one piece in each lit light for a tie and its coin toss.
8. Stand both pieces in Cork & Bell's light: the battle starts for the two of you inside the room, each window shows its own stall (a third window as the room's screen shows both), and ninety seconds later both are back by the door with the scores on a card and points on the Tonight board. One piece alone in that light gets a round to itself.
9. Stand both pieces in Who Am I?'s light: "Opens in 3" counts down, a card says where everyone is going, and both windows go to its own site.
10. Close one window to see the piece turn grey, and fade thirty seconds later.

Coin Flip is a test game.
It hangs on the wall only where `PARTY_TEST_GAMES` is `"on"`, which is the `local` environment in `wrangler.jsonc` (`npm run dev` and the test runs).
Production has no such variable, so its wall is Cork & Bell, Who Am I? and the three coming-soon boxes (Tin Derby, Flood, Fox Trouble).
To see the wall as production hangs it: `npx wrangler dev --local --env local --port 8792 --var PARTY_TEST_GAMES:off`.

For a big screen, open a third window, choose "Use this as the room's screen" and type the code.
A room has one screen: a fourth window that asks to be it is told so and offered a seat.
For phones on the same network, `npm run dev:lan` prints the address to open; the QR code on the wall then points at it.
Stills of the main states, from a real run, are in [`shots/`](shots/).
The ones whose names start with `f` are from `npm run test:feel`: the bump moment by moment (wind-up, hit, thrown, on the floor, up and safe), the buttons and the cooldown ring, the board opened large, and the way in on a phone.

## The three drawings

The room is drawn three ways, from the same room state, rules and controls.
Each is a "room view" (`public/room-view.js`), which is all the page knows about a drawing.

- **Flat** (`public/scene.js`): one SVG of plain shapes. It is the default.
- **3D** (`public/look3d/`): a three.js scene in the look of the approved stills, with every word laid over it as HTML. It is a preview until the owner approves it.
- **Baked** (`public/baked/`): the bar as a rendered picture, with the pieces drawn live over it. It is a preview too, and is described under "The baked look" below.

To see the 3D look, add `?look=3d` to the room's address, for example `http://localhost:8791/lobby/?start&look=3d`.
The choice is remembered on that device, because the room's own address carries no query and a phone that scans the code on the wall arrives without one; `?look=flat` goes back.
A device without hardware WebGL 2 gets the flat drawing even when it asks for 3D.

The 3D room has skins: `&room=bar` (the default), `ship` (the star lounge), `arcade`, `camp`, `roof`, `navy` (the studio) or `fair` (the pier fair).
Every skin keeps the layout exactly, and the game boxes and their signs are the same size and in the same place in every room.
A skin changes the wall, the floor, the lamps, the lettering, the trim, and what the room does.
A skin is one description in `public/look3d/skins.js`, and nothing else in the 3D look knows a room by name.
All of them, with a still each, a short loop for the live ones, and three more rooms that are only concepts, are on the rooms page: `/lobby/look3d/rooms/`.
A posed room with nobody connected is at `/lobby/look3d/still.html?room=<skin>`; its header comment lists what it can show, and `&show=1&run=1` plays a little show.

### Rooms that are alive

Each skin lists its life (`life: [...]` in `skins.js`), and `public/look3d/life.js` runs it.
There are three kinds of thing, all drawn on the device from what every device already knows.
None of it sends a message, asks the room anything or changes a rule: it cannot move a piece, block a vote or decide who was bumped.

- **Ambient**: always on. A fire, bulbs that chase round a frame, a sky going by a window.
- **Events**: something passes now and then, such as an owl, a plane or a comet. They run off the room's own clock and a sequence seeded by the room's code, so every screen in a room sees the same owl at the same moment. The clock is how long the room has been open, which the room view already carries as `closesIn`; devices agree to within the lag of one message.
- **Reactions**: set off by pieces, from where they stand, when they jump and who was bumped, all of which every device hears already. Jump under a lamp and it swings. Stand by the campfire and your piece gets sooty. Under the Tonight board every room has one feature of its own (a jukebox, a prize wheel, a claw machine) which is knocked when someone is bumped beside it.

Nothing plays a sound.
Each event and reaction announces itself by name on `window` as a `party-room:sound` event (`detail: {name, room}`), for the sound system to listen for; every skin lists its names and what each should sound like under `sounds`.
People who ask their device for less motion get the ambient life only: events do not fly, and reactions do not wobble, hop or throw sparks.
While only ambient life is running the room is drawn every other frame, and every frame as soon as anything else moves.
Chosen stills of the 3D look, from a live run and from posed rooms, are in [`shots/3d/`](shots/3d/).

How the 3D look stays cheap for a phone:

- The camera never moves. A device shows a different part of the room by sliding and scaling the frame (`public/look3d/space.js`), so the picture is the flat drawing's picture, one world unit to one pixel, and nothing needs real light.
- Walls, floors and box art are painted once on canvases. A lamp's light is a cone of glow and a pool worked out in the floor's own shader. A piece's shadow is a soft blob. There are no shadow maps.
- The picture is drawn at no more than twice the screen's CSS size and never more than about 2560 x 1440 pixels. It steps down if frames are slow, draws a third as often when nothing moves, and stops while the page is hidden.
- A room's life is budgeted the same way: its many small lights are one mesh each, its sparks and smoke are two pools of dots, and its feature is not worked out while it is off the screen.
- Under a game that covers the room (Cork & Bell in its frame) the 3D room is hidden and draws no frames, so the game has the graphics card to itself; it draws again when the game is taken away.
- A device that did not ask for the 3D look downloads none of it: the page loads `look3d/` only when `?look=3d` was given.
- It asks nothing of the room: no message is sent or changed for it, and an idle room still sleeps.

three.js is not a second copy: the 3D look imports the build Cork & Bell already ships (`public/look3d/three.js` is the one line that says where).
The 3D look also loads two small fonts of its own (`public/look3d/fonts/`, with their licences) and borrows Cork & Bell's Abril Fatface.

Pieces move with weight in the 3D look: they lean into a walk, rock from foot to foot, stretch in the air and squash on landing (`public/look3d/pieces.js`).
The bump is the shared one (`shared/bump.js`): the 3D look draws the same states at the same moments as the flat drawing, from the same poses, in `bumpPose` in that file under the heading "THE BUMP, DRAWN".
The bumper winds up and slams forward; whoever it hits is squashed, thrown, lies on the floor with crosses for eyes, gets up and flickers while it cannot be knocked again.
There is a burst of sparks where the blow lands, dust where the piece comes down, a small jolt of the picture, and a ring under your own piece that fills as your bump recharges.
The 3D wall follows the flat one: a game's name is on its box and nowhere else, the sign under it says one thing about the game, how many play and on what, and the Tonight board opens when it is tapped.

### The baked look

To see it, add `?look=baked` to the room's address, for example `http://localhost:8791/lobby/?start&look=baked`.
The choice is remembered on that device like the 3D look's; `?look=flat` goes back.
It is the bar only.

The 3D look's camera never moves, so the room does not have to be drawn every frame: it can be one picture.
The baked look's room is a Cycles render from that same camera, made by the script that renders the landing page's hero (`landing/tools/blender/room.py`, the shots named `plate-*`).
Only what changes is drawn live:

- **The lamps.** The plate is a base picture with no game lamp on, and one more picture per lamp of only what that lamp adds: its bulb, its beam in the haze, its pool on the floor and what bounces off it. Light adds up, so a small shader adds them with one number per lamp, and any combination of lamps on, off and brighter is right without another render. A box that leads tints its lamp's light gold and gets a gold face on its frame.
- **The posters, signs, join code and Tonight board.** They are data, so the plate's frames are empty and the live ones sit in them, placed by the same layout as the 3D look (`look3d/space.js`).
- **The pieces.** Each pool has a real cone of light for whoever stands in it, the room itself (rendered all round from where the pieces stand) is what shines in their lacquer, a piece's shadow leans away from the nearest lit lamp, and a faint reflection stands under it in the floor.
- **The room's life.** The dust, the cat and the moth are the 3D look's, drawn over the plate. The jukebox is a rendered picture standing in the 3D look's jukebox, so it still rocks and flashes when it is knocked, with its running lights live over the rendered tubes.

It is built as the 3D look with its walls swapped for a picture (`RoomBaked extends Room3D`), and it calls `look3d/pieces.js` for every pose, so a change to how a piece moves or is bumped arrives in both.
What it gives up: the lamps are in the picture, so a jump under one does not set it swinging.

A plate is a picture of one wall, so there is one per number of boxes: `public/baked/bar/5/` for production's wall and `public/baked/bar/6/` for the local one, which hangs Coin Flip as a sixth.
A wall with no plate is drawn by the 3D look as it stands, and so is the room on a device where the plate does not arrive.
A device that did not ask for the baked look downloads none of it.

To make a plate again: `landing/tools/blender/plate.sh 5` (about 45 minutes of rendering, every job under ten), then `node lobby/tools/pack-baked.mjs 5`, which writes `public/baked/bar/5/` and prints the bytes.
The raw renders are not committed.
When a game is added to the wall, its plate must be rendered before the baked look shows that wall.

## What is built

- The room in the bar look, drawn with plain shapes as one SVG, the same picture on every device (and, as a preview, in 3D: see above).
- Game boxes from each game's manifest. The name is on the poster, once. The sign under it has one line about the game, how many can play ("1-4 players") and the device badge (cyan any device, violet a phone each, amber phones and a big screen). Every sign says how many can play, the coming-soon ones too. On a phone, with five boxes or more, a sign is too narrow for the line of words at a size worth reading, so it keeps the count and the badge and the words are left to bigger screens.
- The join code and its QR code on the wall, and a Tonight board with 3, 2 and 1 points for first, second and third.
- The Tonight board opens large when it is tapped or clicked, on a phone, a laptop or the big screen: places, names and points, and every game played so far with who won it. A tap, Escape or the back gesture closes it. The piece stays where it stands meanwhile, so its vote carries on, and the open board says what the room is doing.
- Pawns in the four seat colours with name tags: walk, jump, and a bump everyone has (below).
- A player's four buttons as one family: left and right under the left thumb, jump and bump under the right, each with a picture and a word. Bump alone carries the accent colour, because it is the one move with a cooldown.
- A way in that fits the device: a phone leads with playing and keeps "Use this phone as the room's screen" as a small link, a wide screen is offered both as two cards, and either can change its mind.
- One screen per room. A second device that asks to be the screen is told one is connected and offered a seat, and the way in does not offer it at all once the code is typed.
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

## The bump

Everyone has it, and it is meant to be felt: you pick your piece up and knock somebody over.
The bumper lifts and leans back (110 ms), slams forward (60 ms), and both pieces hold still for a moment as the blow lands (50 ms) with a burst, a jolt of the picture and a short buzz on both phones where the phone has one.
Whoever was hit is squashed, thrown back through the air while tipping right over (260 ms), lies on the floor (110 ms) and gets up (150 ms).

| | Chosen | Why |
| --- | --- | --- |
| Reach | 130 units in front, 20 behind | About one and a half pieces: you have to walk up to somebody. |
| Throw | about 210 units, never less than 90, always into the dark | A light is 205 units wide with five boxes on the wall (171 with six), so a knock always clears a piece out of the light it stood in, and it never lands in another light that is on. A light that is off counts as dark. Between two lit lights there are only 51 units of dark (43 with six boxes), so the piece lands in the middle of that. |
| Loss of control | 740 ms from the bump, 570 ms from the blow landing | Long enough to read as being knocked over, short enough not to be a punishment. |
| Safe time | 1,500 ms after getting up | A piece on the floor or just up from it cannot be knocked, so nobody is kept down, whoever takes turns. |
| Cooldown | 2,500 ms, hit or miss | Longer than the floor and the safe time together (2,240 ms), so one player alone can never chain knocks either. |

With every other player bumping one piece as fast as the room allows, that piece is on the floor a third of the time at worst and has its controls for the rest (`npm run test:feel` measures it).

The room is the judge.
A bump is one message; the room decides at once who is hit and where they land, tells everybody, and keeps three numbers with the piece (when it may bump again, until when it is down, until when it is safe).
It refuses a bump that comes too soon and tells that page how long is left, and it ignores a knocked-down piece's moves until it is up.
The cooldown is shown twice: a ring sweeping round the bump button, which is dim until it is ready and pulses when it is, and a ring under the player's own piece for people looking at the room and not at the buttons.

The rules, timings, states (winding, striking, recovering; standing, hit, flying, down, rising, safe) and poses are `shared/bump.js`: plain numbers with tests, no drawing.
`public/bump-draw.js` is the thin part that turns them into SVG, and is the only part a room drawn another way would replace.

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
- No piece skins, no abilities, no chat bubbles, no walking through the door, no "host starts" setting. Other rooms exist only as skins of the 3D preview.
- No sound for the bump, and no buzz on phones whose browser has none (Safari on an iPhone).
- "Back to the room" in the middle of a game: a round runs its ninety seconds, and a player can still leave the party.
- In the room Cork & Bell has no high score entry, no rematch button and no end card of its own: the room's card shows the scores, and the vote is the rematch. The high score board stays on the game's own page.

## How it stays cheap

The owner pays for the time a room's Durable Object is awake, and for requests (an incoming WebSocket message is a twentieth of one).
So the room is built to be asleep, and to hear as little as it can.

- **Each player's page moves its own piece, and says so only when something changes.** A message goes out when a piece changes direction, jumps, or steps into or out of a light that is on. Walking in a straight line sends nothing: movement has one speed and no acceleration, so everyone, the room included, carries a piece forward from where it was last heard of (`shared/world.js`, `posAt`).
- **The room relays and judges only what must be fair.** It passes a move on to the others, works out who stands in which light, starts and stops the count, decides the toss, and decides who a bump lands on. It never trusts a position that could not have been reached, and corrects the page that sent it.
- **Nothing ticks in the lobby.** There is no loop. Everything that depends on time (the count's end, the toss, a dropped phone's thirty seconds, closing) is the object's alarm, which lets it sleep in between.
- **A bump is one event and no wake-up.** The room judges it the moment the message arrives. The knock, the safe time and the cooldown are three times written on a piece and looked at when the next message comes; nothing is scheduled for them, and a knocked piece sends nothing back.
- **The screen's grace is not timed either.** A room has one screen, and when it drops its place is kept for 15 seconds (a reload, a wifi blip). That is only looked at when another device asks to be the screen.
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

The stronger bump did not change this.
Measured again on 2026-11-12 with the knock-back in, the same four players wandering for ten minutes (each pressing bump about once in fourteen seconds, as before) used 0.21 awake seconds per minute, 1.99 messages a second (0.50 per player), 1.6 GB-seconds and 585 requests per room-hour.
That is within the run-to-run spread of the first column (shorter runs the same day gave 2.1 to 2.5 messages a second and 0.24 to 0.28 awake seconds per minute): a bump is still one message, a knocked piece now sends nothing back where it used to send one, and neither the knock, the safe time nor the cooldown sets a wake-up.
Measure on a server nobody else is using and that has been quiet for two minutes: a room that just closed reports its last requests into the same books.

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
| `shared/world.js` | The room as numbers: where things are and how a piece moves. |
| `shared/bump.js` | The bump: who it reaches, where a knocked piece lands, the cooldown, the stun and the safe time, and the states and poses of both pieces. No drawing. |
| `shared/tonight.js` | The Tonight board: standings with shared places, and the games played with who won each. |
| `shared/entry.js` | What the way in offers a device: a phone leads with playing, a wide screen gets both, a taken screen is not offered. |
| `shared/vote.js` | The vote's rules: which games the party can play, who leads, what a place is worth. |
| `shared/pilot.js` | A player's own piece: moves at once, and decides what is worth telling the room. |
| `shared/camera.js` | Which part of the room a device shows. |
| `shared/status.js` | The words under the room. |
| `server/lobby-core.js` | The room as plain logic with an injected clock: seats, the vote, the game seam, the Tonight board, sleeping and closing. |
| `server/lobby-room.js` | The Durable Object around it: sockets, relaying, the alarm, the budget. |
| `public/` | The page at `/lobby/`: the way in (`door.js`), the scene (`scene.js`), the bump as drawn (`bump-draw.js`), the buttons (`controls.js`), the words over the room (`hud.js`), the board opened large (`board.js`), and each game's view. |
| `games/coin-flip.js` | The test game, hung only where `PARTY_TEST_GAMES` is on. |
| `wall.js` | Which boxes hang on the wall (hosted, outside, test, coming soon), which can start, and the wall each environment gets. |
| `public/room-view.js` | The seam between the page and a drawing of the room: the interface both drawings keep, and which one a device gets. |
| `public/baked/` | The baked drawing: `room-baked.js`, and the bar's packed plates in `bar/<boxes>/` (each `plate.json` says what it covers). |
| `tools/pack-baked.mjs` | Packs the rendered plate for the baked look. |
| `public/look3d/` | The 3D drawing: the scene (`room3d.js`), the words over it (`words.js`), the pieces (`pieces.js`), the rooms as skins (`skins.js`), a posed room (`still.html`) and the rooms page (`rooms/`). |
| `test/` | Unit tests, the socket test, the browser run and the cost measurement. |

`shared/` is plain logic used by both the room and the page, and it is served to the browser; `server/` and `test/` never are.

## Tests

- `npm test` runs the unit tests with the kit's: the room's rules (`test/lobby-core.test.js`), the shared logic, the awake meter and the socket rate limit (`test/shared.test.js`), the bump (`test/bump.test.js`), the Tonight board (`test/tonight.test.js`) and the way in (`test/entry.test.js`).
- `npm run test:feel` (with `npm run dev` running) goes through how the room feels in real pages and over sockets: the way in on a phone and on a wide screen, one screen per room and its grace, the four buttons, the cooldown ring and the room enforcing it, the bump frame by frame, that nobody can be kept on the floor, the board opening and closing with the vote carrying on, and that a bump sets no timer. It takes stills of each, the bump's with the page's clock held still.
- `npm run test:lobby` (with `npm run dev` running) puts four socket players through an evening (when the coin toss picks Cork & Bell, a whole round of it over sockets, which makes the run a minute and a half longer), sends a party of two off to an outside game, then checks that a lobby nobody touches goes silent: no messages, no timer, nothing added to the budget.
- `npm run lobby:shots` drives real pages in a headless, muted browser and takes a still of every state on a big screen, a sideways phone and an upright one, checking that no text spills out of its place and that no card runs off a screen. It follows an outside game all the way to its address (the browser is handed a stand-in page, so no test touches the real site), and with `--plain=<a server with the test games off>` it also takes the wall as production hangs it. Stills land in `lobby/test/shots/`, which is not committed; a chosen few are in `lobby/shots/`.
- `npm run test:cork` plays Cork & Bell inside the room in real pages (headless and muted): a party of three and a big screen, clicks that fire, a reload in the middle, the end, that nothing of the game is left on the page, a party of one, and what the two rounds cost. It takes about four minutes. With `-- --win=1` it uses the game's own tool to drive Chrome on the Windows side, on the real graphics card. Without it, Playwright's browser in WSL draws WebGL in software and its pages run seconds behind the room, so the run says so and leaves out the reload, the door sheet and the stills; everything the room decides is checked either way.
- `npm run test:frames` checks in a real browser who may frame the site: a page on another origin is refused for the room, the game and the front page, and a page of the site itself is not (the party room frames a game's page).
- `npm run lobby:measure` is the cost measurement above. `-- --game=cork-and-bell` makes every vote a round of Cork & Bell.
- `npm run lobby:shots:3d` is the same kind of run in the 3D look: a big screen, a sideways phone, an upright phone and a laptop in one live room, with checks that the 3D look drew it, that the words say what the room says, and that a device without hardware WebGL falls back to the flat drawing. Stills land in `lobby/test/shots/3d-live/`.
- `npm run lobby:stills:3d` takes a still of every skin and of the bar at every moment from posed rooms, into `lobby/test/shots/3d/`, and checks that every room's signs are the same size and in the same place. With `-- --only=loops` it takes each live room's five second show frame by frame. `python3 lobby/test/make-room-pictures.py` then turns the stills and the frames into the pictures the rooms page shows. `-- --gpu=1` uses the Windows side's graphics card, which is much quicker.
- `npm run lobby:shots:3d` also checks the rooms' life: that two devices in a room agree what time it is in the room and when each passing thing next comes, that a bump by the room's feature sets it off on both and announces its sound by name, and that none of it sends a message.
- `npm run test:cork:3d` plays several rounds of Cork & Bell inside a room that is in the 3D look, on the Windows side's graphics card: under the game the 3D room is hidden and draws nothing, both pictures keep their WebGL context, the room draws again afterwards, and memory does not climb.
- `npm run lobby:measure:3d` measures the 3D look's frame time on the Windows side's graphics card, in a headless Chrome. It is a desktop card at a phone's screen size, not a phone.
- The baked look uses the same tools with `--look=baked`: `npm run lobby:shots:3d -- --look=baked` (the live run), `npm run test:cork:3d -- --look=baked --room=bar` (the room hides under a round of Cork & Bell and comes back), and `npm run lobby:measure:3d -- --look=baked --rooms=bar`. `node lobby/test/shoot-baked-stills.mjs` takes its posed stills, `node lobby/test/side-by-side.mjs` sets them beside the landing page's hero, and `node lobby/test/weigh-baked.mjs` prints what each look downloads.
- `node lobby/test/e2e-budget.mjs` checks what happens when the allowance is spent; its header says which server to start.
