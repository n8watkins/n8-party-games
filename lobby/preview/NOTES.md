# Lobby concept pictures: notes

These are stills, not a build.
Open `index.html` to see them in order.
Re-render with `node lobby/preview/shoot.mjs` from the repository root after `npm install`.

## How the pictures were made

The room is a real 3D scene (three.js, already a dev dependency) posed by hand for each picture.
All words (name tags, plates, the join sign, the countdown) are HTML laid over the render from the same camera.
`scene.html?shot=vote|countdown|tie|shove`, `&view=phone` and `&theme=lantern` choose the picture.
The scene only runs through the local server that `shoot.mjs` starts, because it loads three.js from `node_modules` and one Cork & Bell screenshot for the box art.

## Decisions I made that were not specified

### Camera

- The camera looks straight at the back wall from the front, slightly above head height, with the frame slid downward.
- That keeps walls upright (it reads as side-on, flat play) while the floor still opens toward the viewer, so each pool is a clear ellipse and the room has depth.
- The camera never moves or scrolls: the room is exactly one screen wide on the big screen and on the phone.
- Everyone walks on one line through the middle of the pools; there is no walking toward or away from the viewer.

### The room

- Each game box hangs in a lit recess on the back wall, above head height, so characters never hide a box or its plate.
- One lamp hangs over each pool; the box, the lamp and the pool line up as one "spot".
- The four pools have a drawn edge and a dark gap between them a little narrower than a pool, so "in" and "out" are never in doubt.
- A character counts as in a pool when its centre is inside the edge.
- The door at the left end is where latecomers arrive; the shelf at the right end is where spare games wait.
- The front edge of the stage carries one line of plain help text on the big screen.

### How a pool shows its vote count

- The plate under each box has four pips, and each voter lights one pip in their seat colour.
- The pool, its beam and the lamp get brighter with every voter, in clear steps (empty, one, two, three, four).
- An empty pool stays faintly lit so it still reads as a place to stand.
- Brightness alone carries the lead from across a room; the pips give the exact count up close.

### The fifth game

- I chose the shelf, not a lever.
- Fox Trouble sits dimmed on a shelf at the right end, tagged "On the shelf".
- The intended rule is that after a game is played its box goes up on the shelf and the waiting box comes down into that spot, so no extra control is needed.
- This rule is not drawn as its own picture.

### Where the PIN lives

- On the big screen the QR code, the PIN and the address are on a sign above the door at the left end, in the room and out of the way of play.
- The PIN is repeated in small type at the right of the stage front.
- The PIN is 4827 and the address is the placeholder `games.n8builds.dev`, as in the landing mockups; the site name "n8 Party" is the same placeholder.

### What the phone hides or shrinks

- The phone shows the whole room, the same framing as the big screen, cropped at the top.
- It hides the lamps (only their beams show), the QR code and address (the sign keeps the PIN only) and the "what you need" line on each plate.
- It keeps game names, pips and name tags, and enlarges tags relative to the room.
- The stage front becomes the control strip: left and right at the bottom left, emote and jump at the bottom right, "Your vote" in the middle.
- The controls sit below the floor, so no thumb covers a character or a pool.
- Your own character has a white "You" tag with a pointer and a white ring on the floor; the picture is drawn from Dolly's phone (gold seat).
- The phone picture is rendered at 844x390 at three times density (2532x1170 pixels).

### Characters

- Characters are drawn as plain playing pieces (pawns) in the four seat colours with two dot eyes and a name tag.
- A playing piece fits the game-box theme and is clearly a stand-in, not a slime or any other skin.
- The eyes are there only to show which way a character faces.
- The skins inset is on the page under picture 1, not inside a picture, so the pictures stay clean frames.
- The names (Mabel, Fitch, Dolly, Tom) are borrowed from the Cork & Bell chalkboard.

### Countdown, tie and shove

- The countdown is one ring with one number and the game's name on the wall, plus the winning light turned up and the others turned down.
- In the countdown picture the count has started on a majority (three against one), with everyone standing in some light.
- The tie is settled by one extra lamp on a long cord that swings between the two tied pools and stops over one; the server would pick the result at random and the swing only shows it.
- The shove picture shows the shoved player's pip as a dashed outline, meaning the vote is lost until they step back in.

### Box art

- Cork & Bell and Who Am I? copy the landing "cupboard" boxes; the three unfinished games are prototype boxes with a typed sticker, as on the landing page.
- The strip at the bottom of each box uses the landing colours: cyan for any device, violet for a phone each, amber for phones plus a big screen.

### Second direction

- Picture 6 is the same layout in a warm "lantern room": wooden boards, a green dado, red shades and a string of bulbs, closer to Cork & Bell than to the n8builds.dev navy.

## Weakest picture

- Picture 4 (the tie) is the weakest.
- A swing is motion, and a still can only hint at it with fading copies of the lamp and a dotted line on the floor.
- The light also sits nearer one pool in the frame, which can read as "already chosen".

## Known rough edges

- Under the bright lights the blue seat renders lighter than its swatch (#2f6f8f); the dot in each name tag is the exact colour.
- On the phone the lamps are out of frame, so the beams enter from above with no visible source.
- The winning box in picture 3 is slightly washed by its own beam.

## The three biggest open questions

- What starts the count: everyone standing in a light with a majority (drawn), or full agreement; and can one person hold the party hostage by standing in the dark?
- What happens when the party cannot play the winning game: Who Am I? is a 2-player game and Tin Derby needs a big screen, so should those boxes be dimmed and their pools switched off when the party does not fit?
- Is the lobby a toy or a menu: shoving (picture 5), jumping and emotes make it a small game of its own, which is fun but slows down getting to the next game.
