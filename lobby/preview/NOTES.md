# Lobby concept pictures: notes (round three)

These are stills, not a build.
Open `index.html` to see them in order.
Re-render with `node lobby/preview/shoot.mjs` from the repository root after `npm install`.
Round one's stills are kept in `shots/round-1/` and round two's in `shots/round-2/`, as they were rendered.

## How the pictures were made

The room is a real 3D scene (three.js, already a dev dependency) posed by hand for each picture.
All words (signs, name tags, the join sign, the scoreboard, the bottom line) are HTML laid over the render from the same camera.
`scene.html?shot=...` chooses the moment, `&view=phone` the phone, `&zoom=1.25` the closer phone view, and `&room=bar|tech|fair|attic|roof|camp` the room skin.
`game.html?frame=arrive|end|menu|phone|display` draws the frames that happen inside Cork & Bell or on a second screen, on top of real Cork & Bell screenshots.
`chart.html` is the "who beats who" sheet.
Everything runs through the local server that `shoot.mjs` starts, in a headless, muted browser.
The small move pictures and the "push in" frame are crops of full-size renders.

## Owner decisions drawn in this round

- The address on the sign is `partygames.n8builds.dev`.
- A game starts on the count, not the bell: everyone in a light, leading box gold, "Starts in 3", stepping out stops it.
- The bell is dropped, because nobody knew who was meant to ring it.
- "Host starts" is an alternative room setting, drawn as one phone frame.
- A game the party cannot play has its light off and its box dim, with the reason on its sign.
- A game that needs a big screen says how to get one, and a laptop or TV can join as the room's screen.
- One move per skin, no punch on the robot.
- The slime has two answers, absorb and harden, and every move has a cooldown shown on the phone button.
- The phone opens closer in on you, with a way out to the whole room.
- Things on the wall can be touched.
- Leaving has two cases: the door button, and a dropped phone.
- The chalkboard, the coin toss and the ghost stay as they were.

## Decisions I made that were not specified

### Rooms

- I drew four new rooms: a fairground midway, an attic, a rooftop and a campfire clearing.
- Each keeps the layout exactly, so a player who knows one room knows them all.
- Each changes six things: wall, floor, lamps, lettering, sign style and the small extras (bunting, cupboard, skyline, campfire).
- The fairground uses cream signs with red lettering and ties straight to Cork & Bell.
- The attic puts all four boxes in one long cupboard and the lights on a rug.
- The rooftop frames each box in its own neon colour and swaps the chalkboard for a lit panel.
- The campfire hangs the boxes between trees, uses paper lanterns for lamps and a tent for the door.
- Seat colours, badge colours and the bottom line never change between rooms.

### Starting, and games that cannot be played

- The host-starts frame is drawn on the host's phone: one large "Start Cork & Bell" button under "You are the host".
- The cannot-play frame is drawn on a phone, because "Needs a big screen" only makes sense when there is not one.
- A switched-off game keeps a faint ring on the floor so the room still has four places, but there is no light to stand in.
- The reason is a pale chip in a few words ("Needs 2 players", "Needs a big screen").
- The laptop frame offers two choices after the code: "Play on this device" or "Use this as the room's screen".

### The phone

- Closer in is 1.25 times, centred on your piece; the floor stays where it is and the tops of the posters are cropped.
- The switch is a small "Whole room" / "Closer" button at the bottom left, next to the arrows, and a pinch would do the same.
- The ability button replaces round two's bump button and sits between emote and jump.
- Touching a poster means hopping under it; a cream card opens beside it with one line of how to play and the best scores.

### Moves

- Chess piece: charge, a short dash that knocks one player back out of their light.
- Robot: hook, a claw on a chain fired from the chest that drags one player over to the robot.
- Slime: absorb (hold) turns a hook round so the robot is dragged to the slime; harden (tap) throws a charging chess piece back.
- Ghost: fade, nothing touches it for a moment and it does not count as a vote while faded.
- The slime's two answers share one button: tap to harden, hold to absorb.
- I chose tap and hold over a button that switches modes because there is no mode to remember or be stuck in, and because the two threats arrive at different speeds: a charge is fast (tap), a hook can be seen coming (hold).
- The wrong answer does nothing: a hardened slime is still pulled by a hook, and an absorbing slime is still knocked back by a charge.
- The slime and the ghost cannot move anyone; they only answer.
- The cooldown is a ring around the button that drains on use and refills, with the seconds left in the middle and the icon greyed.
- The five move pictures carry no words; the chart carries the rules.
- The numbers on the chart ("about half a second", "2" seconds left) are placeholders.

### Alternative moves, one or two per skin

- Chess piece: a hop that lands with a small shockwave and nudges everyone near it half a step.
- Chess piece: swap places with the player it touches, so their vote becomes yours and yours theirs.
- Robot: a magnet pulse that tugs every player in the room one step toward the robot.
- Robot: drop a small decoy copy of itself in a light; it counts as nothing but looks like a vote until someone bumps it.
- Slime: leave a sticky patch in a light for a few seconds, and whoever stands in it cannot be moved or leave.
- Slime: split in two for a moment and stand in two lights, counting as half a vote in each.
- Ghost: blow out one lamp for two seconds, so nobody in that light counts until it relights.
- Ghost: pass through one player and trade name tags with them for a few seconds.

### Into the game and back (storyboards A and B)

- The game is behind its own poster: the poster swings open on its left edge like a cupboard door and fold-down steps reach the floor.
- The other three lights go fully out first, so the open poster is the only bright thing in the room.
- The pieces walk up the steps in a line, and the view pushes in through the doorway after them.
- Inside Cork & Bell each player keeps their seat colour and name.
- The end card adds one column to the game's own scores: what each place gives tonight.
- "Back to the room" on the end card counts down by itself, with "Stay for a rematch" under it.
- Coming back, the winner walks out first wearing the crown and the new points are chalked in yellow on the small board.
- The name plates and the end card in the game frames are drawn over real Cork & Bell screenshots, so the names match the room.

### Leaving (storyboard C)

- The door button is a small round button at the top right of every game.
- "Back to the room" shows how many have asked so far ("1 of 4"); "Leave the party" is the plainer second choice.
- On a phone the two choices rise as a sheet with "Keep playing" under them.
- The phone frame is upright because Cork & Bell's own phone layout is upright.
- Pressing leave: the door on the left opens, the piece walks out, and a note at the top names who left.
- A dropped phone: the piece turns grey with "reconnecting" on its tag and keeps its spot; if it does not come back the piece fades, a "Tom left" note shows and the vote stops counting.
- Walking to the door is not how you leave.

## Weakest picture

- The ghost's fade (move 5) is the weakest.
- "Cannot be hit" reads well, but "does not vote while faded" rests on the light being dim, which is easy to miss.
- Next weakest is the slime hardening: the faceted shape reads as hard, but its pale front face looks a little like paper.

## Known rough edges

- In the storyboard frames on the steps the name tags are left off, because four tags stacked on a staircase were unreadable.
- The open poster door is seen almost edge-on, so it reads as a dark flap beside the frame.
- The fairground and bar rooms share a warm palette; the attic, rooftop and campfire are more clearly their own.
- The join sign's address is small now that it is longer.
- The box art for Tin Derby, Flood and Fox Trouble is still a painted stand-in.
- The laptop frame is plain next to the others.

## Open questions the pictures raise

- Which room to build first, and who picks the room.
- How long the count runs, and whether "host starts" should exist as a setting.
- Cooldown lengths and the slime's timing window, which decide whether the slime is too strong.
- Does a basic bump (just running into someone) still exist for everyone, or is the chess piece's charge the only knock-back?
- Can the room's big screen also be a player's own laptop?
- Two modes from one engine: the owner floated every game having an "everyone on their own phone" mode and an "everyone on one shared screen" mode. If so, "Needs a big screen" would become a choice of mode, not a switched-off light. No picture yet.
- The lobby phone is sideways and Cork & Bell's phone is upright: should entering a game ask people to turn their phone?
- What happens to a "Back to the room" request that never reaches most players: does it time out?
- When someone leaves mid-count, does the count restart?
- What are Tin Derby, Flood and Fox Trouble really about, so their one-line descriptions can be right?
