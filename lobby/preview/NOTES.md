# Lobby concept pictures: notes (round two)

These are stills, not a build.
Open `index.html` to see them in order.
Re-render with `node lobby/preview/shoot.mjs` from the repository root after `npm install`.
Round one's stills are kept in `shots/round-1/` for comparison.

## How the pictures were made

The room is a real 3D scene (three.js, already a dev dependency) posed by hand for each picture.
All words (signs, name tags, the join sign, the scoreboard, the bottom line) are HTML laid over the render from the same camera.
`scene.html?shot=vote|count|bell|tie|bump|skins|scores`, `&view=phone` and `&room=tech` choose the picture.
The scene only runs through the local server that `shoot.mjs` starts, because it loads three.js from `node_modules` and one Cork & Bell screenshot for the box art.
The browser that takes the pictures is headless and muted.

## What changed from round one, and why

- The warm bar room is the lead look, and the navy room is one extra still (picture 8), because the owner prefers the bar and sees the two as room skins.
- Box art is about twice the area (1.75 m by 2.45 m, was 1.2 m by 1.68 m) and characters are about four fifths the height.
- Game names sit on a sign under each box at nearly twice the size, with one line about the game.
- The join code is about twice the size on the wall and is repeated large at the bottom right.
- The coloured dots under each box are gone; the characters in the light are the only vote count.
- The swinging tie lamp and the countdown ring in the middle of the wall are gone.
- Shoving is in, as "bump".

## Decisions I made that were not specified

### The signs

- Each sign has the name, one line about the game, a coloured badge for what you need, and the player count.
- The badge colours are the ones already in use: cyan "Any device", violet "A phone each", amber "Phones + this screen".
- On the phone the amber badge says "Phones + big screen", because "this screen" would be wrong there.
- The box art no longer carries its own "what you need" strip, so nothing is said twice.
- The one-line descriptions for Tin Derby, Flood and Fox Trouble are my guesses, and so is their box art.
- Game names use the Cork & Bell display face in the bar and a plain bold face in the navy room.

### What starts a game (pictures 1, 3 and 3b)

- Nothing counts while anyone is in the dark; the bottom line names who the room is waiting for ("Waiting for Tom").
- Idea A (picture 3): when everyone is in some light, the game with the most players gets a gold frame, a gold sign and a "Starts in 3" badge on its corner.
- Stepping out of your light stops the count.
- Idea B (picture 3b): no clock; a brass bell drops on a rope at the edge of the leading light, and the game starts only when someone in that light jumps and rings it.
- In both ideas the other three boxes and signs fade, so the winner is obvious without reading.
- The bottom line always says the rule in plain words.

### The tie (picture 4)

- A tie is a coin toss between the two tied games.
- The two tied signs are marked "Heads" and "Tails", and one gold coin spins between the two boxes.
- The coin shows a plain star, not either game, so the picture does not look already decided.
- The server would pick the result; the coin only shows it.

### Bump (picture 5)

- Running into someone knocks them out of their light in an arc.
- A bumped player loses their vote until they walk back in, and the light dims at once.
- The phone gets a bump button next to jump.

### Skins (picture 6)

- The four skins are a chess piece, a robot, a slime and a ghost (the ghost is my pick).
- Every skin keeps the seat colour and the same kind of eyes.
- The ghost is a pale sheet tinted with the seat colour, so it does not read as a second slime.
- The tricks are hints only: chess piece hops higher, robot shoves farther, slime is hard to shove, ghost floats and lands softly.
- The trick is the second line on the name tag in this picture only.

### Scores (picture 7, and the small board in every picture)

- 3 points for first, 2 for second, 1 for third, every game.
- During a vote the scores are a small chalkboard at the right end of the wall.
- Right after a game the same board hangs large in the middle on two chains with what each player just won, and the small board's place on the wall is empty.
- The leader wears a small crown in picture 7 only.
- In the navy room the chalkboard becomes a lit panel.

### The room

- Four boxes on the wall, 2.6 m apart, each with a lamp and a pool 1.9 m across.
- The door and the join sign are at the left end; the scores and the fifth game (Fox Trouble, "Up next" on a shelf) are at the right end.
- The camera, the single walking line and the "one screen wide, never scrolls" rule are unchanged from round one.

### The phone (picture 2)

- The phone stands a little further back than the big screen so the larger boxes fit whole.
- The lamps are just out of frame; the beams and pools still show.
- The controls sit over the front of the floor: left and right at the bottom left; emote, bump and jump at the bottom right.
- The bottom line shows your own vote and who the room is waiting for.
- The phone drops the QR code, the address, the one-line descriptions and the player counts.

## Weakest picture

- Picture 4 (the tie) is still the weakest.
- The coin has to fit in the narrow gap between two large boxes, so it is small, and its spin arrows cross the edge of the box art.
- The words ("Tie!", "Heads", "Tails") carry more of the meaning than the coin does.

## Known rough edges

- Under the lights the blue seat renders lighter than its swatch; the dot in each name tag is the exact colour.
- The robot is dark and small next to the others; it needs a brighter body or a bigger head.
- In picture 3b the bell rope runs up between two boxes and crosses the string of bulbs.
- In picture 6 Mabel's tag sits close under the Cork & Bell sign.
- The box art for Tin Derby, Flood and Fox Trouble is a painted stand-in.

## Open questions the pictures raise

- What starts a game: the count (A) or the bell (B)?
- Can one player standing in the dark hold up the whole room, and if so for how long?
- What happens when the winning game does not fit the party (Who Am I? is for 2, Tin Derby needs a big screen): should that box be dimmed and its light switched off?
- Do skins have tricks, or are they looks only?
- Who picks the room skin?
- What are Tin Derby, Flood and Fox Trouble really about, so the one-line descriptions can be right?
- Does the phone show the whole room, or zoom in and follow you?
