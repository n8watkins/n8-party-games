// The front page's own words and pictures: the three doors, and what each game is like to play.
//
// What is playable, and for how many, is not written here. It comes from the party room's wall
// (lobby/wall.js), which the build copies to /home-wall.js, and from the one-device games below,
// whose pages the site serves. home-model.js puts the two together, and site/test/home.test.js
// fails if the page could call a game playable that the wall or the site does not serve.

/** Where things live. */
export const LINKS = {
  /** The party room (the Floor): a new party, or the way in with a code. */
  floorStart: "/lobby/?start",
  join: (code) => `/lobby/?join=${encodeURIComponent(code)}`,
  /** A new party that goes straight to the Table (site/table/). */
  tableStart: "/table/",
  /** The source. */
  code: "https://github.com/n8watkins/n8-party-games",
  /**
   * How n8games is made, on n8builds.dev. Empty until that page exists: the link is not shown.
   * The page will be https://n8builds.dev/builds/n8games.
   */
  howItWorks: "",
};

/**
 * Games played on one phone or laptop passed round the group: no server, no room, so they are
 * not on the wall. `path` is the game's page on this site; the test checks the site serves it,
 * and that the player counts match the game's own rules.
 */
export const ONE_DEVICE = [{ id: "hot-potato", name: "Hot Potato", line: "Say a word out loud, pass it on, before the potato bursts.", min: 2, max: 8, path: "/one-device/hot-potato/" }];

/** The three doors: the kinds of evening, not the games. */
export const KINDS = [
  {
    id: "room",
    name: "In the room",
    line: "Walk little pieces round one room, bump your friends, and vote on the next game.",
    inside: "Everyone joins on their own phone and walks a little piece round the room. Put the room on a TV if you have one.",
    needs: ["phones", "tv"],
    door: "door-room",
    focus: "62% 62%",
    pieces: ["pawn", "robot"],
  },
  {
    id: "table",
    name: "Round the table",
    line: "Sit together, talk and take turns. Answer and guess on your own phone.",
    inside: "Sit together and take turns. Everyone answers on their own phone; the talking happens round the table.",
    needs: ["phones"],
    door: "door-table",
    focus: "50% 55%",
    pieces: ["ghost"],
  },
  {
    id: "device",
    name: "Pass one device",
    line: "One phone or laptop goes round the group. Nobody else needs anything.",
    inside: "One phone or laptop goes round the group. Nobody installs anything, nobody signs up.",
    needs: ["one"],
    door: "door-device",
    focus: "50% 50%",
    pieces: ["slime"],
  },
];

/** How the room picks its next game: a real sequence, so the steps are numbered. */
export const ROOM_VOTE = [
  "Every game has a lamp on the room's wall.",
  "Stand your piece in a game's light to vote. When everyone is in a light, a ten-second count starts.",
  "The light with the most pieces wins, and the whole party plays it. A tie is settled by a coin toss. Bumping a friend out of a light is allowed.",
];

/**
 * What each game is like, by its id on the wall (or in ONE_DEVICE). A game with no entry here is
 * still listed, with its line from the wall and a plain picture.
 * tile: the square picture; wide: the picture on its card; focus: where the square crops it.
 */
export const COPY = {
  "cork-and-bell": { tile: "tile-cork", piece: "pawn" },
  "tin-derby": { tile: "tile-derby", piece: "robot" },
  "paper-masks": {
    tile: "tile-masks",
    wide: "wide-masks",
    piece: "ghost",
    line: "Everyone answers in secret. Guess who wrote what.",
    about: "A question about the group, answered behind a paper mask. The answers are read out with no names on them.",
    steps: ["A question about the group comes up on every phone.", "Everyone types an answer in secret.", "The answers are read out, and the table guesses who wrote each one."],
    suits: "Friends who know each other well, or are about to.",
  },
  "who-am-i": {
    tile: "tile-who",
    focus: "50% 38%",
    wide: "wide-who",
    piece: "ghost",
    line: "You each have a secret name. Ask questions to guess yours.",
    about: "Each of you gets a secret identity that only the other player can see: a famous person, a character or a mascot.",
    steps: ["Each of you gets a secret name, shown only on the other's phone.", "Take turns asking questions that can be answered yes or no.", "First to guess their own name wins the round."],
    suits: "Two people on a sofa with ten minutes.",
  },
  "hot-potato": {
    tile: "tile-potato",
    wide: "wide-potato",
    piece: "slime",
    about: "A word chain said out loud into one device. The potato is a lab specimen, and it gets less stable with every turn.",
    steps: ["Pick a category, like cities, and how many are playing.", "Say a word out loud. The device listens and checks it.", "The next player's word starts with your last letter. Too slow, and the potato bursts on you."],
    suits: "A group round one screen. Nobody needs their own phone.",
  },
};

/**
 * The moving things behind everything: picture, size in px, where it rests (% of the screen),
 * how far it drifts (px), and how long a drift and a bob take (s).
 */
export const FLOATERS = [
  { img: "fl-pawn.webp", w: 64, x: 6, y: 18, dx: 30, dy: -24, drift: 26, bob: 4.2, r: -4 },
  { img: "fl-ghost.webp", w: 62, x: 92, y: 40, dx: -36, dy: 26, drift: 30, bob: 5.0, r: 5 },
  { img: "fl-slime.webp", w: 70, x: 84, y: 78, dx: -28, dy: -20, drift: 24, bob: 3.8, r: -3 },
  { img: "fl-robot.webp", w: 60, x: 10, y: 74, dx: 34, dy: -18, drift: 28, bob: 4.6, r: 4 },
  { img: "fl-potato.svg", w: 58, x: 50, y: 92, dx: 40, dy: -16, drift: 22, bob: 3.6, r: -6 },
  { img: "fl-car-red.webp", w: 84, x: 60, y: 56, dx: -50, dy: 10, drift: 32, bob: 4.0, r: 3 },
  { img: "fl-mask-jester.webp", w: 60, x: 30, y: 6, dx: 26, dy: 22, drift: 27, bob: 4.8, r: -7 },
  { img: "fl-cork.svg", w: 34, x: 94, y: 52, dx: -22, dy: 30, drift: 21, bob: 3.4, r: 20 },
  { img: "fl-key.webp", w: 48, x: 2, y: 46, dx: 24, dy: 26, drift: 25, bob: 4.4, r: -10 },
  { img: "fl-mask-fox.webp", w: 58, x: 62, y: 4, dx: -30, dy: 24, drift: 29, bob: 5.2, r: 6 },
  { img: "fl-card.webp", w: 36, x: 40, y: 60, dx: 30, dy: -28, drift: 23, bob: 4.1, r: 9 },
  { img: "fl-trophy.webp", w: 46, x: 22, y: 94, dx: 20, dy: -24, drift: 26, bob: 3.9, r: -5 },
];
