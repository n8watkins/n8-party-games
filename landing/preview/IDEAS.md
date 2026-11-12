# Landing page ideas for "n8 Party"

The name "n8 Party" is a placeholder.
Both mockups keep it in one line of `mock.js` (`SITE.name`), so swapping it is a one-word edit.

## What every direction shares

- "Join with a PIN" is the first thing on the page: four digit boxes and one Join button.
- A QR scan lands on the same page with the PIN already filled in, so joining is one tap.
- Five games on the shelf: Cork & Bell (live), Who Am I? (plays today on its own address, moving in), Flood, Tin Derby and Fox Trouble (coming).
- One filter with three answers: just me, phones only, we have a big screen.
- One badge system for "what you need", described next.

## The badge system (the same in every direction)

Each badge is a small picture of the screens you need, a colour, and two lines of words.
The first line is what to have in your hands, the second is how many people.

| Kind | Picture | Colour | Words |
| --- | --- | --- | --- |
| Any device | one phone beside one laptop | cyan | "Any device" / "Solo or 2 to 4 players" |
| A phone each | three phones in a row | violet | "A phone each" / "2 to 4 players" |
| Phones plus a big screen | a wide screen above three phones | amber | "Phones + a big screen" / "2 to 4 players" |

The picture, the colour and the words each carry the message alone, so it survives a small phone, a dim room and colour blindness.
The filter buttons use the same three pictures, so the filter teaches the badges.

## 1. Lights on

- The idea: the page is a dark room at a party and the only lights in it are screens.
  Each game's art is shown on the devices that game needs: a laptop and a phone for Cork & Bell, two phones for Who Am I?, a television over a row of phones for Tin Derby.
- First thing you see: a big "Got a PIN?" with four glowing digit boxes on the lit grid, in the n8builds navy and cyan.
- The three device kinds: you can read them from the shape of the card art before you read a word, and the badge under it says the same thing in words.
- Coming games: their screens are switched off, on standby, with the game's name glowing faintly on the dark glass.
  That reads as "not on yet", not as broken.
- Risk: three dark standby cards next to one bright live card can make the page look quiet until more games ship.
  Device frames can also look like a stock "app mockup" if they are drawn too glossy, so they stay flat and thin.

## 2. The games cupboard

- The idea: a cupboard of board-game boxes in the workshop.
  Each game is a box standing on a lit shelf, and the "what you need" badge is the strip printed on every real game box ("2 to 4 players, ages 8 and up").
- First thing you see: a slim "Join with a PIN" bar across the cupboard door, then the top shelf.
- The three device kinds: the printed strip on each box, plus a shelf-edge label under the box that repeats it in words.
- Coming games: plain prototype boxes with a typed label, the way real board-game prototypes look.
- Risk: it leans on a physical metaphor, which the owner has found over-done before if it gets fussy.
  Five boxes in a row also need care on a phone, where each box gets its own shelf.

## 3. On the bench

- The idea: the n8builds workshop builds games in the open.
  A finished game is a full-colour photograph; a game still being built is a blueprint drawn on the grid in cyan line.
- First thing you see: the PIN boxes, then Cork & Bell as one large photograph with four blueprints beside it.
- The three device kinds: a badge on each card, and on blueprints the devices are drawn into the plan itself.
- Coming games: the blueprint is the whole point, so "coming" looks deliberate.
- Risk: four of five cards would be line drawings, which is close to the line-drawing look the owner already disliked.
  It also puts the builder's story ahead of the player's.

## 4. The midway

- The idea: follow Cork & Bell's own world.
  The page is a fairground at dusk: a ticket booth for the PIN and one painted stall per game.
- First thing you see: an "Admit one" ticket with four digit boxes under a string of bulbs.
- The three device kinds: enamel signs hung on each stall.
- Coming games: stalls with the shutter down and a painted "Opening soon" board.
- Risk: Flood (blue tiles), Tin Derby (tin toys on a kitchen table) and Who Am I? (flat purple) do not belong in a fairground.
  Drawn in plain CSS it can turn cheesy, and it leaves the n8builds look behind.

## 5. What have you got?

- The idea: turn the filter into the page.
  Under the PIN boxes are three large doors: "Just me", "Phones only", "We have a big screen".
  Picking one shows only the games that fit, already sorted.
- First thing you see: the PIN boxes and the three doors, no games yet.
- The three device kinds: the doors are the kinds, so nobody can pick a game they cannot play.
- Coming games: listed under each door as "next up".
- Risk: it adds a tap before anyone sees a game, and with one live game two of the doors lead to almost nothing today.
  It is the most ordinary-looking of the five.

## Ranking

1. Lights on.
2. The games cupboard.
3. On the bench.
4. What have you got?
5. The midway.

## Recommendation

Build "Lights on".
It has one idea and the idea does real work: the picture on each card is the answer to "what do we need", so the tired person at the party reads it without reading.
It is calm (nothing moves, nothing follows the pointer), it sits inside the n8builds navy, cyan and grid, and it gets better with every game that ships because each new game switches another screen on.
It also carries the two awkward states well: "rooms are full" is a single amber line under the PIN boxes, and the big-screen steps are the same pictures used as instructions.

"The games cupboard" is the runner-up and is mocked up too.
Its printed box strip is the most familiar way to say "what you need", and it is worth stealing for the badges even if the cupboard itself is not chosen.

## What is mocked up

- `lights-on.html`: direction 1.
- `cupboard.html`: direction 2.
- Each has a small "Preview" strip at the bottom to switch between the normal page, the "rooms are full" state and the big-screen room step.
  The strip belongs to the mockup, not to the design.
- The same states open directly with `?state=full` and `?state=screen`.

## Decisions I made that the owner should check

- Who Am I? is shown as "moving in", with a link to where it plays today, because only Cork & Bell is live on this site.
- Who Am I? is a two-player game, so its badge says "2 players", not "2 to 4".
- The kind of each coming game is my reading of the plan: Flood as "a phone each", Tin Derby and Fox Trouble as "phones + a big screen".
- Cork & Bell is "any device" with a note that a big screen is optional, so it shows up under all three filter answers.
- The lobby slimes are only hinted at: a one-eyed blob in each seat colour beside the room PIN, not a character design.
