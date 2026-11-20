// The words on the page: a recommendation for every take, what was cut, and the notes.

/** emote id -> take id -> [verdict, words]. Verdicts: "pick" (my choice for this emote), "ok", "weak". */
export const RECS = {
  popcorn: {
    wisp: ["pick", "One wisp holds the bucket, the other carries each piece to the mouth. The striped bucket and the chewing still read at phone size."],
    float: ["ok", "The same motion. The hand under the bucket is a loose dot at phone size."],
    haunt: ["ok", "The bucket hangs in the air and the pieces drift up to the mouth by themselves. Ghostly, but it looks less like eating."],
  },
  slowclap: {
    float: ["pick", "Two flat hands meet in front of the chest, under the face. Close to the body, they need no arms."],
    wisp: ["ok", "The same clap with two wisps coming round from the sides. Busier, and no clearer."],
  },
  pointlaugh: {
    wisp: ["pick", "The arm makes it plain who is pointing, even at phone size, and the wide mouth sells the laugh."],
    float: ["weak", "The pointing hand hangs between the two pieces. At phone size it is not clear whose it is."],
  },
  redcard: {
    wisp: ["pick", "The arm thrusts the card up and the other rests on the hip. Reads at once at every size."],
    float: ["ok", "A hand holds the card up. Reads, because the card does the work."],
    haunt: ["ok", "The card rises by itself. The most ghostly of the three, and still reads."],
  },
  hurry: {
    float: ["pick", "The stopwatch is held out toward the target and the other hand taps it. Cleanest of the three."],
    wisp: ["ok", "The tapping arm crosses the chest and muddies the picture a little."],
    haunt: ["weak", "A stopwatch floating beside it. Without the tapping finger it says clock, not hurry up."],
  },
  thumbsup: {
    wisp: ["pick", "The arm reaches out and the thumb pops toward the target. The arm ties the thumb to the ghost."],
    float: ["ok", "A lone thumb beside it. Reads, a little less warmly."],
  },
  confetti: {
    wisp: ["pick", "One arm aims the popper, the other pulls the string. The pop and the rain over the target are the room's own."],
    float: ["ok", "The same with loose hands. The pulling hand is hard to make out at phone size."],
  },
  boo: {
    float: ["pick", "Two thumbs down, one each side, shaken. A clear outline, and nothing like the ghost's scare."],
    wisp: ["ok", "The same on two short arms. Fine, slightly heavier."],
  },
  trophy: {
    float: ["pick", "Two hands hold the cup out with a little bow."],
    wisp: ["ok", "The two wisps meet under the cup and read as a tray. It still says here, this is yours."],
    haunt: ["ok", "The cup floats over toward the target by itself. Reads, with less of the handing over."],
  },
  shush: {
    float: ["pick", "One finger to the lips and a lean toward the target. At phone size the finger is a few pixels: the little shh cloud carries it."],
    wisp: ["ok", "The same with a short wisp behind the hand. It adds nothing this close to the body."],
  },
  lighter: {
    wisp: ["pick", "The arm holds the lighter high and sways with the body, eyes shut, singing."],
    float: ["ok", "A hand holds it up. Reads the same; the sway is a touch less connected."],
    haunt: ["ok", "The flame floats over its head like a candle. Nearly my pick: it suits a ghost."],
  },
  scratch: {
    float: ["pick", "A hand scratches the side of the head, eyes drifting up."],
    wisp: ["ok", "The same on a short arm up the side of the body."],
  },
  steam: {
    float: ["pick", "No hands needed: the whole sheet goes red, it swells, steams from the top and bounces on the spot (it has no feet to stomp)."],
  },
  tomato: {
    wisp: ["pick", "A throw needs an arm: the wind-up and the follow-through are what you read. The tomato lands on the floor short of the target, as in the room."],
    float: ["ok", "The hand winds up and throws by itself. The lob still reads, the wind-up less."],
  },
};

/** What was tried and taken out, and what was left out on purpose. */
export const CUTS = [
  ["Boo, as the ghost's own boo.", "Not offered. A ghost that swells and shouts boo is its scare, which is a move in the game. Everyone would read it as an attack, not a joke."],
  ["Haunted confetti and haunted tomato.", "Pulling a string and throwing both need a hand. With the prop going off by itself, nothing showed that this player did it."],
  ["Haunted takes of the six hand emotes.", "Slow clap, point and laugh, thumbs up, boo, shh and huh? are nothing but a hand, so there is nothing left to float."],
  ["A loose fist on the hip (red card, tomato) in the Hands take.", "Without an arm it was a stray dot beside the body. The Wisps take keeps it."],
  ["Hands in the pale colour of the hem.", "They vanished against the hem. Hands are now the player's full colour, as a pawn's are."],
  ["Squeezed-shut happy eyes on thumbs up, GG and confetti.", "On this face they read as bored. The eyes stay open and a curved smile does the work; only the laugh squeezes them shut."],
];

/** The Notes tab: [title, a paragraph or a list of [lead, words]]; "CUTS" is where the list above goes. */
export const NOTES = [
  [
    "My view in short",
    [
      ["If you want one style everywhere: wisps.", "An arm that grows out of the sheet shows whose hand it is, which matters most at phone size."],
      ["Mixing is fine.", "Both styles are drawn from the same numbers, so each emote can use whichever you star."],
      ["Haunted", "is the ghost's own trick. It works where the prop is the whole message (red card, lighter, GG) and fails where a hand does something."],
    ],
  ],
  ["CUTS", null],
  [
    "The faded form",
    [
      ["Faded,", "the ghost is see-through and floats higher. Its hands stay a little more solid than its body, and props and words are not faded at all, so the emote still reads."],
      ["A question for you:", "whether a faded ghost may send emotes at all. This page only shows how they would look."],
    ],
  ],
  [
    "Sizes",
    [
      ["Phone size", "is a pawn 72 pixels tall and TV size 141. These are the numbers from the character previews, not measured in the live room. The word bubble is sized by the room's own rule at both."],
      ["Large", "is whatever fits your screen, so on a small phone it is close to TV size."],
      ["On a small phone, upright or sideways,", "there is no room for the phone-size picture beside the large one. Use the Phone button there."],
    ],
  ],
  [
    "Sound",
    [
      ["These are the room's own recordings,", "one per emote, the same files a pawn's emotes play. All are public domain (CC0); the credits are in the room's sound folder."],
      ["The ghost keeps the pawn's timing,", "so the three claps, the pop and the flick of the lighter happen at the same moments as on the pawn."],
      ["I cannot hear.", "Nothing here was judged by ear. If a sound does not suit the ghost, say which."],
    ],
  ],
  [
    "What is the room's own, and what is new",
    [
      ["The room's own:", "the props, the effects, the word bubble, the drop of sweat and the flinch at the target, and the hands themselves (the mitten and the small cartoon hand)."],
      ["The ghost", "is the one you approved in the character previews: the same sheet, face, hover and fade."],
      ["New here:", "where the ghost's hands go for each emote, the wisp arms, its mouth shapes and the red of fuming."],
      ["Not shown:", "name tags, and the flat look of the room (the ghost exists only in 3D so far)."],
    ],
  ],
  ["Not checked", "This was checked in a desktop browser at phone sizes, not on a real phone. Sound was not heard. Smoothness on a mid-range phone is an open question."],
];
