// The lobby concept stills. One 3D room, posed by ?shot= and framed by ?view=.
//   ?shot=   which moment (every key of STATES below)
//   ?view=   screen (16:9, the default) or phone (held sideways)
//   ?room=   room skin: bar (the lead look), tech, fair, attic, roof, camp
//   ?only=   draw one seat's piece (0-3) or "none"; ?alpha=1 drops the room and leaves the pieces on a clear page
//   ?hide=   comma list of overlays to leave out: brand, fascia, tags, words
// Nothing here is playable: every pose is written down in STATES below.
// Copied from the lobby concept pictures (branch wave2/lobby-pictures) and extended for the landing page:
// the third and fourth boxes are Flood and the bathtub regatta (a wind-up boat race that has no art yet), and the states named l* are the landing's.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { generate } from "lean-qr";

const Q = new URLSearchParams(location.search);
const SHOT = Q.get("shot") || "vote";
const PHONE = Q.get("view") === "phone";
const ONLY = Q.get("only");
const ALPHA = Q.get("alpha") === "1";
for (const h of (Q.get("hide") || "").split(",").filter(Boolean)) document.body.classList.add(`hide-${h}`);
document.documentElement.classList.toggle("alpha", ALPHA);

const PIN = "4827";
const JOIN_ADDRESS = "partygames.n8builds.dev";
const SITE_NAME = "n8 Party";

// Seat colours are the party kit's. The names are the chalkboard names from Cork & Bell.
const SEATS = [
  { name: "Mabel", hex: "#c8382c" },
  { name: "Fitch", hex: "#2f6f8f" },
  { name: "Dolly", hex: "#d9a02a" },
  { name: "Tom", hex: "#3f7a4a" },
];
const NEED = {
  any: { color: "#38bdf8", plate: "Any device" },
  phones: { color: "#b39dfc", plate: "A phone each" },
  screen: { color: "#fbbf24", plate: PHONE ? "Phones + big screen" : "Phones + this screen" },
};
// The one-line descriptions are placeholders for the three games that are not built yet.
const GAMES = [
  { id: "cork", name: "Cork & Bell", about: "Pop the targets, ring the bell", need: "any", seats: "1-4 players" },
  { id: "who", name: "Who Am I?", about: "Ask questions, guess your name", need: "phones", seats: "2 players" },
  { id: "flood", name: "Flood", about: "A tile puzzle race", need: "phones", seats: "2-4 players" },
  { id: "wind", name: "Bathtub Regatta", about: "Still on the workbench", need: "screen", seats: "2-4 players" },
];
const SPARE = { id: "fox", name: "Fox Trouble", need: "screen" };
// The night so far: 3 points for first, 2 for second, 1 for third. "last" is what the game just played gave.
const SCORES = [
  { seat: 2, pts: 7, last: 3 },
  { seat: 0, pts: 5, last: 1 },
  { seat: 3, pts: 4, last: 2 },
  { seat: 1, pts: 2, last: 0 },
];

// ---- The room, in metres. x runs along the stage, y is up, z comes toward the viewer.
const ROOM = { w: 14.2, h: 6.8, zBack: -2.5, zFront: 3.0, fasciaH: 1.6 };
const WALK_Z = 0.6;
const POOL_X = [-3.9, -1.3, 1.3, 3.9];
const POOL_R = 0.95;
const LAMP_Y = 5.25;
const CAM = { y: 4.2, z: 17.5 };
const END_X = 6.05;  // the door and join sign at the left end, the scores and the shelf at the right end
const YOU = 2;       // on the phone, the player holding it
const CH = 0.78;     // character scale
const BOX_W = 1.75, BOX_H = 2.45, BOX_D = 0.3, BOX_Y = 3.83;
const BELL_DX = 0.84; // the bell rope hangs this far from the middle of its light
// The steps that fold down when a poster opens: six of them, from the light up to the frame.
const STEP = { rise: 0.42, run: 0.45, z0: 0.1, w: 1.5 };
const onStep = (k) => ({ y: (k + 1) * STEP.rise, z: STEP.z0 - k * STEP.run, ground: (k + 1) * STEP.rise });

const SOON = { 2: { why: "Coming soon" }, 3: { why: "Coming soon" } };
const who = (seat) => `<span class="who"><i style="--seat:${SEATS[seat].hex}"></i>${SEATS[seat].name}</span>`;
const SKINS4 = ["pawn", "robot", "slime", "ghost"];

// ---- What is happening in each picture.
const STATES = {
  vote: {
    votes: [[0, 1], [], [2], []],
    players: [
      { seat: 0, x: -4.32, face: 0.5 },
      { seat: 1, x: -3.45, face: -0.55, bubble: "hi!" },
      { seat: 2, x: 1.3, face: 0.1 },
      { seat: 3, x: 2.6, face: 0.7, lean: -0.1, y: 0.06, bubble: "hmm..." },
    ],
    hint: `<span class="k">Vote</span>Stand in a light to pick that game.<span class="soft">Waiting for ${who(3)}</span>`,
    mine: "Waiting for Tom",
  },
  // The phone with an ability button. The player holding it is the slime.
  ability: {
    votes: [[0, 1], [], [2], []],
    players: [
      { seat: 0, x: -4.32, face: 0.5, skin: "pawn" },
      { seat: 1, x: -3.35, face: -0.55, skin: "robot" },
      { seat: 2, x: 1.3, face: 0.1, skin: "slime" },
      { seat: 3, x: 2.6, face: 0.6, y: 0.2, skin: "ghost" },
    ],
    mine: "Waiting for Tom",
    button: { skin: "slime", cool: 0.62, tip: ["Tap: harden", "Hold: absorb"] },
  },
  count: {
    votes: [[], [1], [0, 2, 3], []],
    levels: [0.1, 0.42, 1.5, 0.1],
    winner: 2,
    count: 3,
    players: [
      { seat: 1, x: -1.3, face: 0.7, bubble: "fine..." },
      { seat: 0, x: 0.72, face: 0.35 },
      { seat: 2, x: 1.34, face: 0, y: 0.2, squash: 1.05 },
      { seat: 3, x: 1.94, face: -0.35 },
    ],
    hop: 2,
    hint: `<span class="k">Everyone is in a light</span>Tin Derby starts in 3.<span class="soft">Step out of your light to stop the count.</span>`,
  },
  bell: {
    votes: [[], [1], [0, 2, 3], []],
    levels: [0.1, 0.42, 1.5, 0.1],
    winner: 2,
    bell: 2,
    players: [
      { seat: 1, x: -1.3, face: 0.7 },
      { seat: 0, x: 0.66, face: 0.6 },
      { seat: 3, x: 1.28, face: 0.75 },
      { seat: 2, x: POOL_X[2] + BELL_DX, face: 0.1, y: 0.4, squash: 1.07, tagAt: [0.62, 0.42] },
    ],
    hint: `<span class="k">Everyone is in a light</span>Tin Derby leads 3 to 1.<span class="soft">Nothing starts until someone in that light rings the bell.</span>`,
  },
  tie: {
    votes: [[], [0, 3], [1, 2], []],
    levels: [0.06, 0.6, 0.6, 0.06],
    tied: [1, 2],
    players: [
      { seat: 0, x: -1.78, face: 0.6 },
      { seat: 3, x: -1.0, face: 0.8 },
      { seat: 1, x: 1.0, face: -0.8 },
      { seat: 2, x: 1.78, face: -0.6 },
    ],
    hint: `<span class="k">Tie, 2 each</span>A coin toss picks.<span class="soft">Heads is Who Am I?, tails is Tin Derby.</span>`,
  },
  bump: {
    votes: [[0], [], [1], [3]],
    players: [
      { seat: 0, x: -3.9, face: 0.7 },
      { seat: 1, x: 1.52, face: 0.75, lean: -0.3, squash: 0.95 },
      { seat: 2, x: 2.72, face: 0.25, lean: -0.75, y: 0.5, bubble: "hey!", shock: true },
      { seat: 3, x: 4.2, face: -0.7 },
    ],
    fx: { charge: [1, 2] },
    hint: `<span class="k">Bump</span>Run into someone to knock them out of their light.<span class="soft">${who(2)} has to walk back in.</span>`,
  },
  skins: {
    votes: [[0], [1, 2], [], [3]],
    players: [
      { seat: 0, x: -3.9, face: 0.2, y: 0.4, squash: 1.06, skin: "pawn", note: "Hops higher", name: "Chess piece" },
      { seat: 1, x: -2.2, face: 1.1, skin: "robot", arm: 0.62, note: "Shoves farther", name: "Robot" },
      { seat: 2, x: -0.82, face: -0.35, lean: -0.06, squash: 0.92, skin: "slime", note: "Hard to shove", name: "Slime" },
      { seat: 3, x: 3.7, face: -0.3, y: 0.3, skin: "ghost", note: "Floats, lands softly", name: "Ghost" },
    ],
    hint: `<span class="k">Skins</span>Pick any look. Each one has its own trick for messing with the vote.`,
  },
  scores: {
    votes: [[], [], [], []],
    levels: [0.3, 0.3, 0.3, 0.3],
    bigBoard: true,
    players: [
      { seat: 0, x: -3.5, face: 0.75 },
      { seat: 3, x: -2.2, face: 0.9 },
      { seat: 2, x: 0, face: 0, crown: true },
      { seat: 1, x: 3.1, face: -0.85, lean: 0.08, bubble: "rematch!" },
    ],
    hint: `<span class="k">Tin Derby is done</span>${who(2)} won it and leads the night.<span class="soft">The next vote opens in a moment.</span>`,
  },

  // ---- Round three: the four skins lined up, for the ability sheet.
  cast: {
    votes: [[0], [1], [2], [3]],
    levels: [1, 1, 1, 1],
    noTags: true,
    players: SKINS4.map((skin, i) => ({ seat: i, x: POOL_X[i], face: 0.25, skin, y: skin === "ghost" ? 0.18 : 0 })),
  },
  // ---- Round three: one move per skin, each caught mid-action. No words in these.
  charge: { // the chess piece charges and knocks the robot out of its light
    votes: [[], [], [0], []],
    noTags: true,
    players: [
      { seat: 0, x: 1.42, face: 0.75, lean: -0.32, squash: 0.95, skin: "pawn" },
      { seat: 1, x: 2.74, face: -0.5, lean: -0.7, y: 0.55, skin: "robot" },
    ],
    fx: { charge: [0, 1] },
  },
  hook: { // the robot fires a hook on a chain and drags the chess piece out of its light
    votes: [[], [1], [], []],
    levels: [0.16, 0.6, 0.6, 0.16],
    noTags: true,
    players: [
      { seat: 1, x: -1.45, face: 1.45, skin: "robot", hook: 2.0 },
      { seat: 0, x: 0.38, z: 0.9, face: -0.5, lean: 0.3, skin: "pawn", shock: true },
    ],
    fx: { drag: 1 },
  },
  absorb: { // the slime goes soft and wide, and the robot that hooked it is dragged over instead
    votes: [[], [], [2], []],
    levels: [0.16, 0.6, 0.6, 0.16],
    noTags: true,
    players: [
      { seat: 2, x: 1.3, z: 0.83, face: -0.5, squash: 0.8, skin: "slime", mode: "soft" },
      { seat: 1, x: -0.25, y: 0.3, face: 1.45, lean: -0.3, skin: "robot", hook: 1.25 },
    ],
    fx: { reverse: [0, 1] },
  },
  harden: { // the slime turns hard, and the chess piece that charged it is thrown back
    votes: [[], [], [2], []],
    noTags: true,
    players: [
      { seat: 2, x: 1.3, face: -0.5, skin: "slime", mode: "hard" },
      { seat: 0, x: -0.05, y: 0.6, face: 0.6, lean: 0.75, skin: "pawn", shock: true },
    ],
    fx: { bounce: [0, 1] },
  },
  fade: { // the ghost fades: the charge goes straight through it, and its light stops counting it
    votes: [[], [], [], []],
    noTags: true,
    players: [
      { seat: 3, x: 1.2, y: 0.22, face: -0.2, skin: "ghost", fade: true },
      { seat: 0, x: 1.62, face: 0.75, lean: -0.32, squash: 0.95, skin: "pawn", shock: true },
    ],
    fx: { through: [0, 1] },
  },

  // ---- Round three storyboard A: from the room into the game.
  go1: {
    votes: [[0, 2, 3], [1], [], []],
    levels: [1.5, 0.42, 0.1, 0.1],
    winner: 0, count: 1, before: true,
    players: [
      { seat: 2, x: -4.5, face: 0.6 },
      { seat: 3, x: -3.9, face: 0.2, y: 0.2, squash: 1.05 },
      { seat: 0, x: -3.3, face: -0.3 },
      { seat: 1, x: -1.3, face: -0.7 },
    ],
    hop: 1,
    hint: `<span class="k">Everyone is in a light</span>Cork &amp; Bell starts in 1.<span class="soft">Step out of your light to stop the count.</span>`,
  },
  // ---- Round three: phone frames.
  // A room setting: the host starts the game instead of the count.
  host: {
    votes: [[0, 2, 3], [1], [], []],
    levels: [1.5, 0.42, 0.1, 0.1],
    winner: 0,
    players: [
      { seat: 0, x: -4.75, face: 0.6 },
      { seat: 2, x: -3.9, face: 0.1 },
      { seat: 3, x: -3.05, face: -0.3 },
      { seat: 1, x: -1.3, face: -0.7 },
    ],
    start: "Start Cork &amp; Bell", startNote: "You are the host",
  },
  // Games this party cannot play: the light is off, the box is dim, and the sign says why.
  cant: {
    votes: [[0], [], [], [1]],
    levels: [0.6, 0, 0, 0.6],
    cant: { 1: { why: "Needs 2 players" }, 2: { why: "Needs a big screen", how: ["On a TV or laptop, open", JOIN_ADDRESS, `and type ${PIN}`] } },
    focus: 0.3,
    players: [
      { seat: 0, x: -3.9, face: 0.6 },
      { seat: 2, x: 0.1, face: 0.5 },
      { seat: 1, x: 3.9, face: -0.5 },
    ],
    mine: "3 here, phones only",
  },
  // Things to poke at: stand under a poster and touch it.
  poke: {
    votes: [[2], [], [0], [3]],
    focus: -2.2,
    players: [
      { seat: 2, x: -3.9, face: 0.1, y: 0.32, squash: 1.05 },
      { seat: 0, x: 1.3, face: -0.5 },
      { seat: 3, x: 3.9, face: -0.5 },
    ],
    hop: 0,
    card: { x: -2.72, y: 5.05, html: `<small>How to play</small><h4>Cork &amp; Bell</h4><p>Aim, pop the targets, and three in a row rings the bell.</p><div class="best"><span>Best tonight</span><b><i style="--seat:${SEATS[2].hex}"></i>Dolly</b><s>1715</s></div><div class="best"><span>Best ever here</span><b><i style="--seat:${SEATS[0].hex}"></i>Mabel</b><s>2658</s></div>` },
    mine: "Touching a poster",
  },
  go2: {
    votes: [[0, 2, 3], [], [], []],
    levels: [1.5, 0, 0, 0],
    winner: 0, dark: true, before: true,
    players: [
      { seat: 2, x: -4.45, face: 0.6 },
      { seat: 3, x: -3.8, face: 0.4 },
      { seat: 0, x: -3.2, face: -0.3 },
      { seat: 1, x: -2.2, face: -0.8, lean: 0.12, y: 0.05 },
    ],
    hint: `<span class="k">Cork &amp; Bell</span>The other lights go out.`,
  },
  go3: {
    votes: [[], [], [], []],
    levels: [1.5, 0, 0, 0],
    winner: 0, dark: true, open: 0, before: true,
    players: [
      { seat: 2, x: -5.0, face: 1.0 },
      { seat: 3, x: -2.75, face: -1.0 },
      { seat: 0, x: -3.9, z: 0.85, face: 2.7 },
      { seat: 1, x: -2.05, face: -1.0 },
    ],
    hint: `<span class="k">Cork &amp; Bell</span>The poster swings open like a door and the steps come down.`,
  },
  go4: {
    votes: [[], [], [], []],
    levels: [1.5, 0, 0, 0],
    winner: 0, dark: true, open: 0, before: true, noTags: true,
    players: [
      { seat: 0, x: -3.9, ...onStep(5), face: 2.9 },
      { seat: 2, x: -3.6, ...onStep(3), face: 2.7 },
      { seat: 3, x: -4.2, ...onStep(1), face: 2.8 },
      { seat: 1, x: -3.75, z: 0.75, face: 2.6 },
    ],
    hint: `<span class="k">Cork &amp; Bell</span>Everyone walks up and in.`,
  },
  // ---- Storyboard B: from the game back into the room.
  back1: {
    votes: [[], [], [], []],
    levels: [1.5, 0, 0, 0],
    dark: true, open: 0, fresh: true, noTags: true,
    players: [
      { seat: 2, x: -3.2, face: 0.5, crown: true },
      { seat: 3, x: -3.65, ...onStep(1), face: 0.2 },
      { seat: 0, x: -4.15, ...onStep(3), face: 0.1 },
      { seat: 1, x: -3.9, ...onStep(5), face: 0.0 },
    ],
    hint: `<span class="k">Back in the room</span>Everyone walks out of the poster. The points go up on the board.`,
  },
  back2: {
    votes: [[], [], [], []],
    players: [
      { seat: 2, x: -2.6, face: 0.6, crown: true },
      { seat: 3, x: -0.4, face: 0.8, lean: -0.08, y: 0.05 },
      { seat: 0, x: -4.2, face: 0.3 },
      { seat: 1, x: -5.3, face: 0.7 },
    ],
    hint: `<span class="k">Vote</span>The lights come back on. Stand in one to pick the next game.`,
  },
  // ---- Storyboard C: leaving.
  leave: {
    votes: [[0, 1], [], [2], []],
    doorOpen: true, here: 3,
    toast: `${who(3)} left the party`,
    players: [
      { seat: 0, x: -4.32, face: 0.2 },
      { seat: 1, x: -3.45, face: -0.2 },
      { seat: 2, x: 1.3, face: -0.6 },
      { seat: 3, x: -END_X + 0.05, z: -1.75, face: 2.7, bubble: "bye!" },
    ],
    hint: `<span class="k">Door</span>${who(3)} pressed the door button and walks out.<span class="soft">3 here.</span>`,
  },
  drop1: {
    votes: [[0, 1], [3], [2], []],
    players: [
      { seat: 0, x: -4.32, face: 0.5 },
      { seat: 1, x: -3.45, face: -0.55 },
      { seat: 2, x: 1.3, face: 0.6 },
      { seat: 3, x: -1.3, face: 0.2, grey: true, label: "Tom - reconnecting..." },
    ],
    hint: `<span class="k">Lost signal</span>${who(3)} dropped out.<span class="soft">The room holds the spot for a moment.</span>`,
  },
  drop2: {
    votes: [[0, 1], [], [2], []],
    here: 3,
    toast: `${who(3)} left`,
    players: [
      { seat: 0, x: -4.32, face: 0.5 },
      { seat: 1, x: -3.45, face: -0.55 },
      { seat: 2, x: 1.3, face: 0.6 },
      { seat: 3, x: -1.3, face: 0.2, grey: true, gone: true, noTag: true },
    ],
    hint: `<span class="k">Vote</span>${who(3)} did not come back, so that vote no longer counts.<span class="soft">3 here.</span>`,
  },

  // ---- The landing page's pictures. Cork & Bell and Who Am I? are lit; the two boxes that are
  // not built yet have their lights off and say so.
  lhero: {
    votes: [[0, 1], [2], [], []], levels: [1.2, 0.6, 0, 0], cant: SOON,
    players: [
      { seat: 0, x: -4.32, face: 0.5 },
      { seat: 1, x: -3.45, face: -0.55, bubble: "hi!" },
      { seat: 2, x: -1.3, face: 0.1 },
      { seat: 3, x: 1.9, face: -0.7, lean: 0.1, y: 0.06, bubble: "hmm..." },
    ],
    hint: `<span class="k">Vote</span>Stand in a light to pick that game.<span class="soft">Waiting for ${who(3)}</span>`,
    mine: "Waiting for Tom",
  },
  lcount: {
    votes: [[0, 2, 3], [1], [], []], levels: [1.5, 0.42, 0, 0], cant: SOON,
    winner: 0, count: 3,
    players: [
      { seat: 2, x: -4.5, face: 0.6 },
      { seat: 3, x: -3.9, face: 0.2, y: 0.2, squash: 1.05 },
      { seat: 0, x: -3.3, face: -0.3 },
      { seat: 1, x: -1.3, face: -0.7, bubble: "fine..." },
    ],
    hop: 1,
    hint: `<span class="k">Everyone is in a light</span>Cork &amp; Bell starts in 3.<span class="soft">Step out of your light to stop the count.</span>`,
  },
  ltie: {
    votes: [[0, 3], [1, 2], [], []], levels: [0.6, 0.6, 0, 0], cant: SOON,
    tied: [0, 1],
    players: [
      { seat: 0, x: -4.38, face: 0.6 },
      { seat: 3, x: -3.6, face: 0.8 },
      { seat: 1, x: -1.6, face: -0.8 },
      { seat: 2, x: -0.82, face: -0.6 },
    ],
    hint: `<span class="k">Tie, 2 each</span>A coin toss picks.<span class="soft">Heads is Cork &amp; Bell, tails is Who Am I?</span>`,
  },
  lbump: {
    votes: [[0], [1], [], []], cant: SOON, levels: [0.6, 0.6, 0, 0],
    players: [
      { seat: 0, x: -3.9, face: 0.7 },
      { seat: 1, x: -1.08, face: 0.75, lean: -0.3, squash: 0.95 },
      { seat: 2, x: 0.12, face: 0.25, lean: -0.75, y: 0.5, bubble: "hey!", shock: true },
      { seat: 3, x: -4.5, face: 0.4 },
    ],
    fx: { charge: [1, 2] },
    hint: `<span class="k">Bump</span>Run into someone to knock them out of their light.<span class="soft">${who(2)} has to walk back in.</span>`,
  },
  lscores: {
    votes: [[], [], [], []], levels: [0.3, 0.3, 0, 0], cant: SOON,
    bigBoard: true,
    players: [
      { seat: 0, x: -3.5, face: 0.75 },
      { seat: 3, x: -2.2, face: 0.9 },
      { seat: 2, x: 0, face: 0, crown: true },
      { seat: 1, x: 3.1, face: -0.85, lean: 0.08, bubble: "rematch!" },
    ],
    hint: `<span class="k">Cork &amp; Bell is done</span>${who(2)} won it and leads the night.<span class="soft">The next vote opens in a moment.</span>`,
  },
  lwalk: {
    votes: [[], [1], [], []], levels: [0.16, 0.6, 0, 0], cant: SOON,
    players: [
      { seat: 2, x: -5.2, face: 0.9, bubble: "made it" },
      { seat: 0, x: -3.2, face: 0.9, lean: -0.08, y: 0.04 },
      { seat: 1, x: -1.3, face: -0.5 },
      { seat: 3, x: 0.9, face: -0.8, y: 0.5, squash: 1.06 },
    ],
    hop: 3,
    hint: `<span class="k">Vote</span>Stand in a light to pick that game.`,
  },
  lcharge: {
    votes: [[], [0], [], []], cant: SOON, levels: [0.16, 0.6, 0, 0], noTags: true,
    players: [
      { seat: 0, x: -1.18, face: 0.75, lean: -0.32, squash: 0.95, skin: "pawn" },
      { seat: 1, x: 0.14, face: -0.5, lean: -0.7, y: 0.55, skin: "robot" },
    ],
    fx: { charge: [0, 1] },
  },
  lhook: {
    votes: [[1], [], [], []], cant: SOON, levels: [0.6, 0.6, 0, 0], noTags: true,
    players: [
      { seat: 1, x: -4.05, face: 1.45, skin: "robot", hook: 2.0 },
      { seat: 0, x: -2.22, z: 0.9, face: -0.5, lean: 0.3, skin: "pawn", shock: true },
    ],
    fx: { drag: 1 },
  },
  labsorb: {
    votes: [[], [2], [], []], cant: SOON, levels: [0.16, 0.6, 0, 0], noTags: true,
    players: [
      { seat: 2, x: -1.3, z: 0.83, face: -0.5, squash: 0.8, skin: "slime", mode: "soft" },
      { seat: 1, x: -2.85, y: 0.3, face: 1.45, lean: -0.3, skin: "robot", hook: 1.25 },
    ],
    fx: { reverse: [0, 1] },
  },
  lharden: {
    votes: [[], [2], [], []], cant: SOON, levels: [0.16, 0.6, 0, 0], noTags: true,
    players: [
      { seat: 2, x: -1.3, face: -0.5, skin: "slime", mode: "hard" },
      { seat: 0, x: -2.65, y: 0.6, face: 0.6, lean: 0.75, skin: "pawn", shock: true },
    ],
    fx: { bounce: [0, 1] },
  },
  lfade: {
    votes: [[], [], [], []], cant: SOON, levels: [0.16, 0.6, 0, 0], noTags: true,
    players: [
      { seat: 3, x: -1.4, y: 0.22, face: -0.2, skin: "ghost", fade: true },
      { seat: 0, x: -0.98, face: 0.75, lean: -0.32, squash: 0.95, skin: "pawn", shock: true },
    ],
    fx: { through: [0, 1] },
  },
  lcast: {
    votes: [[0], [1], [2], [3]], levels: [1, 1, 1, 1], noTags: true,
    players: SKINS4.map((skin, i) => ({ seat: i, x: POOL_X[i], face: 0.25, skin, y: skin === "ghost" ? 0.18 : 0 })),
  },
};
const S = STATES[SHOT] || STATES.vote;
if (ONLY !== null) S.players = S.players.filter((p) => String(p.seat) === ONLY);
const LEVEL_BY_VOTES = [0.16, 0.6, 1.2, 1.4, 1.55];
const levels = S.levels || S.votes.map((v) => LEVEL_BY_VOTES[v.length]);
const isLead = (i) => S.winner === i || (S.tied && S.tied.includes(i));
const isOff = (i) => ((S.winner !== undefined || S.tied || S.dark) && !isLead(i)) || !!S.cant?.[i];
const DARK = S.dark ? 0.32 : 1;

await Promise.all([
  '400 40px "Abril Fatface"', '900 40px "Nunito"', '800 40px "Nunito"', '700 40px "Caveat"', '600 40px "Caveat"',
  '700 40px "JetBrains Mono"', '500 40px "JetBrains Mono"',
  '500 40px "Inter"', '600 40px "Inter"', '700 40px "Inter"', '800 40px "Inter"',
].map((f) => document.fonts.load(f))).catch(() => {});

// ---- Small painting helpers.
function canvasOf(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}
function textureOf(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}
const paint = (w, h, draw) => textureOf(canvasOf(w, h, draw));
// Deterministic random numbers, so two renders of the same picture match.
function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
function speckle(g, w, h, n, alpha) {
  const rnd = seeded();
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${rnd() * alpha})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}
function stars(g, w, yMax, n, seed) {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`;
    const r = 1 + rnd() * 2.2;
    g.beginPath(); g.arc(rnd() * w, rnd() * yMax, r, 0, 7); g.fill();
  }
}
function planks(g, w, h, k, size, base, lightRgb) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const plank = size * k;
  for (let y = 0, i = 0; y < h; y += plank, i++) {
    g.fillStyle = `rgba(${i % 2 ? lightRgb : "0,0,0"},${0.03 + (i * 13 % 4) * 0.02})`;
    g.fillRect(0, y, w, plank - 2);
    g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(0, y + plank - 2, w, 2);
    for (let x = ((i * 733) % 400); x < w; x += 2.4 * k) { g.fillRect(x, y, 2, plank); }
  }
}

// ---- Room skins. Same layout and rules in every one; only the world changes.
// Each paints its own wall and floor (k is pixels per metre) and may add things to the scene.
const ROOMS = {
  bar: {
    light: 0xffd9a6, accent: 0xf6b35c, hemiSky: 0xb08a72, hemiGround: 0x140b08, hemi: 1.0, fill: 0xffd2b0,
    frame: 0x4a2c1c, panel: 0x241511, shade: 0x7a2f22, fascia: 0x140b08, cord: 0x1a0f0b, door: 0x2a5a4e, plank: 0x6a4028,
    lamp: "shade", bulbs: ["#ffd08a"], ink: "#fff3e2", rope: 0xb89868, skirt: true,
    wall(g, w, h, k) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#150d0b"); grad.addColorStop(0.55, "#2b1913"); grad.addColorStop(1, "#22130e");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // Tongue-and-groove boards.
      const board = 0.3 * k;
      for (let x = 0, i = 0; x < w; x += board, i++) {
        g.fillStyle = `rgba(255,200,150,${0.012 + (i * 37 % 5) * 0.008})`;
        g.fillRect(x, 0, board - 2, h);
        g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(x + board - 2, 0, 2, h);
      }
      // Painted dado: dark green below the rail.
      const dado = h - 1.25 * k;
      g.fillStyle = "rgba(18,50,44,.78)"; g.fillRect(0, dado, w, h - dado);
      g.fillStyle = "#b9853f"; g.fillRect(0, dado - 5, w, 5);
      speckle(g, w, h, 5000, 0.05);
    },
    floor(g, w, h, k) { planks(g, w, h, k, 0.22, "#4a3020", "255,210,160"); speckle(g, w, h, 9000, 0.06); },
  },
  tech: {
    light: 0xe6f3ff, accent: 0x38bdf8, hemiSky: 0x7896ea, hemiGround: 0x0a1022, hemi: 1.25, fill: 0xbcd0ff,
    frame: 0x1c2854, panel: 0x101a3c, shade: 0x1d2a56, fascia: 0x060a18, cord: 0x0a1024, door: 0x22336e, plank: 0x2a3a78,
    lamp: "shade", bulbs: null, ink: "#eaf2ff", rope: 0x7f95d6, skirt: true, led: true,
    wall(g, w, h, k) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#060a1a"); grad.addColorStop(0.5, "#0e1a40"); grad.addColorStop(1, "#0e1a40");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      const dado = h - 1.25 * k;
      const panel = g.createLinearGradient(0, dado, 0, h);
      panel.addColorStop(0, "#16255a"); panel.addColorStop(1, "#101c48");
      g.fillStyle = panel; g.fillRect(0, dado, w, h - dado);
      const step = 0.5 * k;
      for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) { g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`; g.fillRect(Math.round(x), 0, 1.5, h); }
      for (let y = h, i = 0; y > 0; y -= step, i++) { g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`; g.fillRect(0, Math.round(y), w, 1.5); }
      g.fillStyle = "rgba(96,200,255,.75)"; g.fillRect(0, dado - 3, w, 3);
      const glow = g.createLinearGradient(0, dado - 46, 0, dado + 46);
      glow.addColorStop(0, "rgba(56,189,248,0)"); glow.addColorStop(0.5, "rgba(56,189,248,.13)"); glow.addColorStop(1, "rgba(56,189,248,0)");
      g.fillStyle = glow; g.fillRect(0, dado - 46, w, 92);
      speckle(g, w, h, 4000, 0.03);
    },
    floor(g, w, h, k) {
      g.fillStyle = "#1b2748"; g.fillRect(0, 0, w, h);
      const step = 0.5 * k;
      for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) { g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`; g.fillRect(Math.round(x), 0, 2, h); }
      for (let y = 0, i = 0; y < h; y += step, i++) { g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`; g.fillRect(0, Math.round(y), w, 2); }
      speckle(g, w, h, 9000, 0.035);
    },
  },
  // A fairground midway at night: striped canvas under a scalloped edge, sawdust underfoot, coloured bulbs.
  fair: {
    light: 0xffe6b8, accent: 0xffcf5c, hemiSky: 0xa9a0c8, hemiGround: 0x1a1208, hemi: 1.1, fill: 0xffe0c0,
    frame: 0xc99a3a, panel: 0x3a0f0d, shade: 0xe9d9b4, fascia: 0x0b0f2a, cord: 0x0b0f2a, door: 0x8c1d18, plank: 0xc99a3a,
    lamp: "shade", bulbs: ["#ff6b5c", "#ffd45c", "#6fc7ff", "#7fe08a"], ink: "#fff3dc", rope: 0xe9d9b4, skirt: true,
    wall(g, w, h, k) {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#070b26"); sky.addColorStop(0.3, "#161b52");
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      const top = h - 5.32 * k, stripe = 0.42 * k;
      stars(g, w, top - 20, 160, 11);
      for (let x = 0, i = 0; x < w; x += stripe, i++) { g.fillStyle = i % 2 ? "#e4d4ae" : "#9c2720"; g.fillRect(x, top, stripe + 1, h - top); }
      // The canvas sags a little between its poles.
      for (let x = 0, i = 0; x < w; x += stripe, i++) { g.fillStyle = "rgba(0,0,0,.16)"; g.fillRect(x + stripe - 5, top, 5, h - top); }
      const shade = g.createLinearGradient(0, top, 0, h);
      shade.addColorStop(0, "rgba(12,6,30,.62)"); shade.addColorStop(0.5, "rgba(12,6,30,.45)"); shade.addColorStop(1, "rgba(12,6,30,.6)");
      g.fillStyle = shade; g.fillRect(0, top, w, h - top);
      // Scalloped edge and its gold trim.
      for (let x = 0, i = 0; x < w; x += stripe, i++) {
        g.beginPath(); g.arc(x + stripe / 2, top, stripe / 2, Math.PI, 0); g.fillStyle = i % 2 ? "#8f857a" : "#5b1512"; g.fill();
        g.strokeStyle = "#d9a441"; g.lineWidth = 4; g.stroke();
      }
      g.fillStyle = "#d9a441"; g.fillRect(0, top - 2, w, 6);
      // Painted boards below the rail, as in the Cork & Bell stall.
      const dado = h - 1.25 * k;
      g.fillStyle = "#141d45"; g.fillRect(0, dado, w, h - dado);
      for (let x = 0; x < w; x += 0.28 * k) { g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(x, dado, 2, h - dado); }
      g.fillStyle = "#d9a441"; g.fillRect(0, dado - 7, w, 9);
      speckle(g, w, h, 6000, 0.05);
    },
    floor(g, w, h, k) {
      planks(g, w, h, k, 0.34, "#6b583a", "255,230,170");
      // Sawdust and straw.
      const rnd = seeded(5);
      for (let i = 0; i < 2600; i++) {
        g.strokeStyle = `rgba(240,210,140,${0.08 + rnd() * 0.2})`; g.lineWidth = 1.5;
        const x = rnd() * w, y = rnd() * h, a = rnd() * 6.3, l = 4 + rnd() * 9;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5); g.stroke();
      }
      speckle(g, w, h, 9000, 0.07);
    },
    extras() {
      // Bunting strung under the lamps.
      const cols = [0xc8382c, 0xf2c14e, 0x2f6f8f, 0xe9d9b4];
      for (let i = 0; i < 40; i++) {
        const t = i / 39, x = (t - 0.5) * (ROOM.w - 0.5), sag = Math.pow((t * 5) % 1 - 0.5, 2) * 0.9;
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % 4]).multiplyScalar(0.75 * DARK) }));
        flag.rotation.set(Math.PI, 0, 0); flag.scale.z = 0.1;
        flag.position.set(x, 6.02 + sag, ROOM.zBack + 0.3);
        scene.add(flag);
      }
    },
  },
  // An attic at night: papered walls, one long games cupboard, a worn rug, fabric lampshades.
  attic: {
    light: 0xffe9c4, accent: 0x8fd3c1, hemiSky: 0x93a9b0, hemiGround: 0x101414, hemi: 1.05, fill: 0xe6ecf0,
    frame: 0x6b4a2f, panel: 0x241a12, shade: 0xe8dcc0, fascia: 0x0c1418, cord: 0x2a2018, door: 0x7d8c84, plank: 0x6b4a2f,
    lamp: "drum", bulbs: null, ink: "#eef6f2", rope: 0xe8dcc0, skirt: false,
    wall(g, w, h, k) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#15232a"); grad.addColorStop(0.5, "#27404a"); grad.addColorStop(1, "#22383f");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // Wallpaper: pale stripes with a small diamond repeat.
      for (let x = 0; x < w; x += 0.4 * k) { g.fillStyle = "rgba(225,240,232,.035)"; g.fillRect(x, 0, 0.2 * k, h); }
      for (let y = 0, r = 0; y < h; y += 0.3 * k, r++) for (let x = (r % 2) * 0.2 * k + 0.1 * k; x < w; x += 0.4 * k) {
        g.fillStyle = "rgba(225,240,232,.1)";
        g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 7, y); g.lineTo(x, y + 9); g.lineTo(x - 7, y); g.fill();
      }
      // A dark roof beam along the top.
      g.fillStyle = "#231710"; g.fillRect(0, 0, w, h - 6.15 * k);
      g.fillStyle = "rgba(255,220,170,.12)"; g.fillRect(0, h - 6.15 * k - 4, w, 4);
      // Painted panelling below the rail.
      const dado = h - 1.25 * k;
      g.fillStyle = "#4b5a54"; g.fillRect(0, dado, w, h - dado);
      for (let x = 0.12 * k; x < w; x += 0.9 * k) {
        g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 3; g.strokeRect(x, dado + 0.16 * k, 0.66 * k, 0.86 * k);
        g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 1.5; g.strokeRect(x + 4, dado + 0.16 * k + 4, 0.66 * k, 0.86 * k);
      }
      g.fillStyle = "#cbbf9c"; g.fillRect(0, dado - 8, w, 9);
      speckle(g, w, h, 5000, 0.04);
    },
    floor(g, w, h, k) {
      planks(g, w, h, k, 0.3, "#51443a", "255,235,210");
      // A long worn rug under all four lights.
      const x0 = (ROOM.w / 2 - 5.75) * k, x1 = (ROOM.w / 2 + 5.75) * k, y0 = (-0.75 - ROOM.zBack) * k, y1 = (2.15 - ROOM.zBack) * k;
      g.fillStyle = "#6a2030"; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = "#d9c79a"; g.lineWidth = 7; g.strokeRect(x0 + 16, y0 + 16, x1 - x0 - 32, y1 - y0 - 32);
      g.strokeStyle = "#274a52"; g.lineWidth = 10; g.strokeRect(x0 + 34, y0 + 34, x1 - x0 - 68, y1 - y0 - 68);
      for (let x = x0 + 90; x < x1 - 60; x += 86) for (let y = y0 + 84; y < y1 - 50; y += 78) {
        g.fillStyle = "rgba(217,199,154,.5)";
        g.beginPath(); g.moveTo(x, y - 17); g.lineTo(x + 22, y); g.lineTo(x, y + 17); g.lineTo(x - 22, y); g.fill();
      }
      g.fillStyle = "#d9c79a";
      for (let y = y0 + 3; y < y1; y += 9) { g.fillRect(x0 - 16, y, 16, 3); g.fillRect(x1, y, 16, 3); }
      speckle(g, w, h, 12000, 0.08);
    },
    extras() {
      // The cupboard: one long top and one long shelf that tie the four frames together.
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6 });
      const span = POOL_X[3] - POOL_X[0] + BOX_W + 0.9;
      for (const [y, t, d] of [[BOX_Y + BOX_H / 2 + 0.2, 0.14, 0.62], [BOX_Y - BOX_H / 2 - 0.16, 0.1, 0.56]]) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(span, t, d), wood);
        board.position.set(0, y, ROOM.zBack + d / 2);
        scene.add(board);
      }
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, BOX_H + 0.36, 0.56), wood);
        side.position.set(sx * span / 2, BOX_Y + 0.02, ROOM.zBack + 0.28);
        scene.add(side);
      }
    },
  },
  // A rooftop at night: the city behind a brick parapet, the boxes as lit signs, neon ring lamps.
  roof: {
    light: 0xffd8f2, accent: 0xff5fb0, hemiSky: 0x8a7ad8, hemiGround: 0x100a1e, hemi: 1.15, fill: 0xd8c8ff,
    frame: 0x1a1230, panel: 0x150d2a, shade: 0x2a1a44, fascia: 0x0a0618, cord: 0x0a0618, door: 0x4a4f6a, plank: 0x3a2f55,
    lamp: "ring", bulbs: null, ink: "#fff0fa", rope: 0xff9fd0, skirt: false, led: true,
    neon: [0xff5fb0, 0x4fe3ff, 0xffd45c, 0x8f7bff],
    wall(g, w, h, k) {
      const horizon = h - 1.25 * k;
      const sky = g.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, "#0c0728"); sky.addColorStop(0.55, "#2c1458"); sky.addColorStop(0.85, "#7a2a68"); sky.addColorStop(1, "#c2496a");
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      stars(g, w, horizon * 0.45, 150, 23);
      // Two rows of buildings with lit windows.
      const rnd = seeded(31);
      for (const [tone, lo, hi, lit] of [["#1b1140", 2.4, 5.0, 0.3], ["#0e0926", 1.5, 3.9, 0.42]]) {
        for (let x = -30; x < w;) {
          const bw = (0.7 + rnd() * 1.1) * k, bh = (lo + rnd() * (hi - lo)) * k;
          g.fillStyle = tone; g.fillRect(x, h - bh, bw, bh);
          for (let wy = h - bh + 16; wy < horizon - 14; wy += 26) for (let wx = x + 12; wx < x + bw - 16; wx += 22) {
            if (rnd() > lit) continue;
            g.fillStyle = rnd() > 0.75 ? "rgba(120,225,255,.7)" : "rgba(255,206,120,.75)";
            g.fillRect(wx, wy, 9, 12);
          }
          x += bw + rnd() * 10;
        }
      }
      // The brick parapet at the roof's edge.
      g.fillStyle = "#3a2836"; g.fillRect(0, horizon, w, h - horizon);
      for (let y = horizon, r = 0; y < h; y += 0.11 * k, r++) {
        g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(0, y, w, 2);
        for (let x = (r % 2) * 0.17 * k; x < w; x += 0.34 * k) g.fillRect(x, y, 2, 0.11 * k);
      }
      g.fillStyle = "#6a5670"; g.fillRect(0, horizon - 4, w, 0.1 * k);
      g.fillStyle = "rgba(255,95,176,.35)"; g.fillRect(0, horizon - 7, w, 3);
      speckle(g, w, h, 5000, 0.04);
    },
    floor(g, w, h, k) {
      g.fillStyle = "#262330"; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 1.2 * k) { g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(x, 0, 3, h); }
      for (let y = 0; y < h; y += 1.2 * k) { g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(0, y, w, 3); }
      // Wet patches that pick up the neon.
      const rnd = seeded(9);
      for (let i = 0; i < 16; i++) {
        const x = rnd() * w, y = rnd() * h, rx = (0.4 + rnd() * 0.9) * k, ry = rx * (0.25 + rnd() * 0.2);
        const r = g.createRadialGradient(x, y, 0, x, y, rx);
        r.addColorStop(0, `rgba(${i % 2 ? "255,110,190" : "110,220,255"},.16)`); r.addColorStop(1, "rgba(0,0,0,0)");
        g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
        g.fillStyle = r; g.beginPath(); g.arc(x, y, rx, 0, 7); g.fill(); g.restore();
      }
      speckle(g, w, h, 14000, 0.07);
    },
  },
  // A clearing in the woods: the boxes strung between trees, paper lanterns, a campfire, a tent for a door.
  camp: {
    light: 0xffc98a, accent: 0xff9d4a, hemiSky: 0x6f8fb0, hemiGround: 0x0a120a, hemi: 1.0, fill: 0xbfd2e6,
    frame: 0x5a3f26, panel: 0x1a140c, shade: 0xff9d4a, fascia: 0x070d0a, cord: 0x3a2a18, door: 0x000000, plank: 0x5a3f26,
    lamp: "lantern", bulbs: null, ink: "#fff1dc", rope: 0xc9a878, skirt: false, tent: true,
    wall(g, w, h, k, side) {
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#050d1c"); sky.addColorStop(0.5, "#0b2230"); sky.addColorStop(1, "#0f2a1e");
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      stars(g, w, h * 0.4, 170, 41);
      const rnd = seeded(17);
      const pines = (tone, lo, hi, step) => {
        for (let x = -40; x < w + 40; x += step * k * (0.7 + rnd() * 0.6)) {
          const ph = (lo + rnd() * (hi - lo)) * k, pw = ph * 0.3;
          g.fillStyle = tone;
          for (let t = 0; t < 4; t++) {
            const y0 = h - ph + t * ph * 0.2, half = pw * (0.35 + t * 0.22);
            g.beginPath(); g.moveTo(x, y0); g.lineTo(x + half, y0 + ph * 0.34); g.lineTo(x - half, y0 + ph * 0.34); g.fill();
          }
          g.fillRect(x - 5, h - ph * 0.3, 10, ph * 0.3);
        }
      };
      pines("#0c2a2a", 3.0, 4.6, 0.8);
      pines("#081c1a", 3.6, 5.8, 1.5);
      // Mist low between the trees.
      const mist = g.createLinearGradient(0, h - 1.8 * k, 0, h);
      mist.addColorStop(0, "rgba(120,170,160,0)"); mist.addColorStop(1, "rgba(120,170,160,.16)");
      g.fillStyle = mist; g.fillRect(0, h - 1.8 * k, w, 1.8 * k);
      if (!side) {
        // The near trunks the boxes are strung between.
        for (const xm of [-5.2, -2.6, 0, 2.6, 5.2]) {
          const x = (xm + ROOM.w / 2) * k, tw = 0.3 * k;
          const bark = g.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
          bark.addColorStop(0, "#1c120b"); bark.addColorStop(0.5, "#3a281a"); bark.addColorStop(1, "#150d08");
          g.fillStyle = bark; g.fillRect(x - tw / 2, 0, tw, h);
          for (let y = 10; y < h; y += 34) { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x - tw / 2 + ((y * 7) % 20), y, 3, 20); }
        }
        // The tent latecomers crawl out of.
        const tx = (-END_X + ROOM.w / 2) * k, half = 1.2 * k, apex = h - 2.45 * k;
        g.fillStyle = "#c4672d"; g.beginPath(); g.moveTo(tx, apex); g.lineTo(tx + half, h); g.lineTo(tx - half, h); g.fill();
        g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.moveTo(tx, apex); g.lineTo(tx + half, h); g.lineTo(tx, h); g.fill();
        const inside = g.createLinearGradient(0, h - 1.9 * k, 0, h);
        inside.addColorStop(0, "#3a1c08"); inside.addColorStop(1, "#ffb45c");
        g.fillStyle = inside; g.beginPath(); g.moveTo(tx, h - 1.95 * k); g.lineTo(tx + 0.5 * k, h); g.lineTo(tx - 0.5 * k, h); g.fill();
        g.strokeStyle = "#f2c9a0"; g.lineWidth = 4; g.beginPath(); g.moveTo(tx - half, h); g.lineTo(tx, apex); g.lineTo(tx + half, h); g.stroke();
      }
      // Fireflies.
      for (let i = 0; i < 46; i++) {
        const x = rnd() * w, y = h - (0.4 + rnd() * 3.4) * k, r = 9 + rnd() * 8;
        const glow = g.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, "rgba(230,255,140,.95)"); glow.addColorStop(0.25, "rgba(210,255,120,.4)"); glow.addColorStop(1, "rgba(210,255,120,0)");
        g.fillStyle = glow; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      speckle(g, w, h, 5000, 0.04);
    },
    floor(g, w, h, k) {
      g.fillStyle = "#1d2c1a"; g.fillRect(0, 0, w, h);
      // The trodden path the lights fall on.
      const y0 = (-0.7 - ROOM.zBack) * k, y1 = (2.0 - ROOM.zBack) * k;
      const path = g.createLinearGradient(0, y0, 0, y1);
      path.addColorStop(0, "rgba(72,56,38,0)"); path.addColorStop(0.2, "rgba(72,56,38,.95)"); path.addColorStop(0.8, "rgba(72,56,38,.95)"); path.addColorStop(1, "rgba(72,56,38,0)");
      g.fillStyle = path; g.fillRect(0, y0, w, y1 - y0);
      const rnd = seeded(3);
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * w, y = rnd() * h, onPath = y > y0 + 40 && y < y1 - 40;
        if (onPath && rnd() > 0.12) continue;
        g.strokeStyle = `rgba(${90 + rnd() * 60},${150 + rnd() * 60},${80 + rnd() * 30},${0.2 + rnd() * 0.3})`; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y - 6 - rnd() * 9); g.stroke();
      }
      speckle(g, w, h, 14000, 0.09);
    },
    extras() {
      // The campfire, behind the walking line and between the two middle lights.
      const at = new THREE.Vector3(0, 0, -1.25);
      const log = new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.9 });
      for (const a of [0.5, -0.6, 1.7]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 10), log);
        m.rotation.set(Math.PI / 2 - 0.25, a, 0, "YXZ"); m.position.copy(at).setY(0.14);
        scene.add(m);
      }
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        const stone = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a5a58, roughness: 1 }));
        stone.scale.y = 0.7; stone.position.set(at.x + Math.sin(a) * 0.5, 0.06, at.z + Math.cos(a) * 0.38);
        scene.add(stone);
      }
      for (const [dx, hgt, r, col] of [[0, 0.95, 0.2, 0xff8a2a], [-0.14, 0.62, 0.15, 0xffb03a], [0.15, 0.7, 0.14, 0xffb03a], [0.02, 0.5, 0.1, 0xfff0a0]]) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(r, hgt, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), transparent: true, opacity: 0.92 }));
        flame.position.set(at.x + dx, 0.18 + hgt / 2, at.z + (col === 0xff8a2a ? 0 : 0.06));
        scene.add(flame);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xff8a3a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
      glow.scale.setScalar(3.6); glow.position.set(at.x, 0.6, at.z + 0.1);
      scene.add(glow);
      const fire = new THREE.PointLight(0xff8a3a, 3.2, 7, 1.1);
      fire.position.set(at.x, 0.8, at.z + 0.5);
      scene.add(fire);
    },
  },
};
const ROOM_SKIN = ROOMS[Q.get("room")] ? Q.get("room") : "bar";
const T = ROOMS[ROOM_SKIN];
document.body.classList.toggle("phone", PHONE);
document.body.classList.add(`room-${ROOM_SKIN}`);
document.body.classList.toggle("led", !!T.led);

// ---- Camera. It looks straight ahead and the frame is slid down, the way a building is
// photographed: walls stay upright while the floor still opens up toward the viewer.
// The phone is a wider, shorter frame, so it stands a little further back to keep the boxes whole.
const W = innerWidth, H = innerHeight;
const D_WALL = CAM.z - ROOM.zBack;
const D_FRONT = CAM.z - ROOM.zFront;
const wallEq = (y, d) => CAM.y + (y - CAM.y) * D_WALL / d; // where a point at distance d lines up on the back wall
// On the phone ?zoom= moves in on the player holding it: the floor stays put and the top of the wall is cropped.
const ZOOM = PHONE ? Math.max(1, Number(Q.get("zoom")) || 1) : 1;
const yTopFull = PHONE ? 5.3 : 6.25;
const yBot = wallEq(-(PHONE ? 0.5 : 0.55), D_FRONT);
const yTop = yBot + (yTopFull - yBot) / ZOOM;
const halfW = (yTop - yBot) * (W / H) / 2;
const slack = (yTopFull - yBot) * (W / H) / 2 - halfW;
const focusX = S.focus ?? S.players.find((p) => p.seat === YOU)?.x ?? 0;
const CX = Math.max(-slack, Math.min(slack, focusX * D_WALL / (CAM.z - WALK_Z)));
const U = W / (2 * halfW);
document.documentElement.style.setProperty("--u", `${U}px`);
document.documentElement.style.setProperty("--t", PHONE ? "1.5" : "1");

const camera = new THREE.PerspectiveCamera();
camera.position.set(0, CAM.y, CAM.z);
camera.updateMatrixWorld();
{
  const n = 1, k = n / D_WALL;
  camera.projectionMatrix.makePerspective((CX - halfW) * k, (CX + halfW) * k, (yTop - CAM.y) * k, (yBot - CAM.y) * k, n, 90);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
const tmp = new THREE.Vector3();
function px(x, y, z = WALK_Z) {
  tmp.set(x, y, z).project(camera);
  return { x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H };
}

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("gl"), antialias: true, preserveDrawingBuffer: true, alpha: ALPHA });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = ALPHA ? null : new THREE.Color(0x03050c);

const wallTexture = (mw, mh, side) => paint(Math.round(mw * 150), Math.round(mh * 150), (g, w, h) => T.wall(g, w, h, 150, side));
const RADIAL = paint(256, 256, (g) => {
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.5)"); r.addColorStop(0.6, "rgba(255,255,255,.12)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
});
// A pool of light: nearly even across, a touch dimmer toward its edge, then a clean stop.
const POOL = paint(256, 256, (g) => {
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.55, "rgba(255,255,255,.8)"); r.addColorStop(0.9, "rgba(255,255,255,.42)"); r.addColorStop(0.985, "rgba(255,255,255,.3)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
});

// ---- Box art. Cork & Bell uses its own screenshot; the others are painted stand-ins.
function fitText(g, text, x, y, maxW, size, font) {
  let s = size;
  do { g.font = font.replace("%", s); s -= 2; } while (g.measureText(text).width > maxW && s > 10);
  g.fillText(text, x, y);
}
let corkImg = new Image();
corkImg.src = "cork-stall.jpg";
await corkImg.decode().catch(() => { corkImg = null; });
function boxCanvas(game) {
  const img = corkImg;
  return canvasOf(700, 980, (g, w, h) => {
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.lineCap = "round";
    if (game.id === "cork") {
      g.fillStyle = "#6d1512"; g.fillRect(0, 0, w, h);
      const top = 196;
      if (img) {
        const ah = h - top, scale = ah / 1000, sw = w / scale;
        g.drawImage(img, (img.width - sw) / 2 + 4, 40, sw, 1000, 0, top, w, ah);
      }
      const band = g.createLinearGradient(0, 0, 0, top);
      band.addColorStop(0, "#8c1d18"); band.addColorStop(1, "#5c110f");
      g.fillStyle = band; g.fillRect(0, 0, w, top);
      g.fillStyle = "#e2b45a"; g.fillRect(0, top - 8, w, 8);
      g.fillStyle = "#f6dfae";
      fitText(g, "Cork & Bell", w / 2, 100, 620, 124, '400 %px "Abril Fatface", serif');
    } else if (game.id === "who") {
      g.fillStyle = "#fff6ea"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(74,53,181,.09)";
      for (let y = 40; y < h; y += 70) for (let x = 40 + (y / 70 % 2) * 35; x < w; x += 70) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
      g.fillStyle = "#33238a"; g.beginPath(); g.roundRect(160, 150, 380, 420, 88); g.fill();
      g.fillStyle = "#4a35b5"; g.beginPath(); g.roundRect(160, 126, 380, 404, 88); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(350, 328, 124, 0, 7); g.fill();
      g.fillStyle = "#4a35b5"; g.font = '900 190px "Nunito", sans-serif';
      g.fillText("?", 350, 342);
      g.fillStyle = "#1d1830";
      fitText(g, "Who Am I?", w / 2, 760, 600, 132, '900 %px "Nunito", sans-serif');
      g.fillStyle = "#4a35b5"; g.fillRect(250, 850, 200, 12);
    } else if (game.id === "wind") {
      // Not drawn yet: a plain prototype box, the way a board game looks before it has its art.
      g.fillStyle = "#b58a5a"; g.fillRect(0, 0, w, h);
      const rnd = seeded(23);
      for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(${rnd() > 0.5 ? "255,235,200" : "60,35,15"},${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 26, 1.5); }
      g.fillStyle = "rgba(240,222,190,.5)"; g.fillRect(w / 2 - 46, 0, 92, h);   // packing tape
      g.fillStyle = "#f6efe2"; g.fillRect(90, 300, w - 180, 330);
      g.strokeStyle = "rgba(40,25,10,.25)"; g.lineWidth = 3; g.strokeRect(90, 300, w - 180, 330);
      g.fillStyle = "#2a1c12";
      g.font = '700 46px "JetBrains Mono", monospace'; g.fillText("PROTOTYPE", w / 2, 366);
      g.fillStyle = "rgba(42,28,18,.35)"; g.fillRect(140, 404, w - 280, 3);
      fitText(g, "Bathtub Regatta", w / 2, 470, w - 240, 62, '700 %px "JetBrains Mono", monospace');
      g.font = '500 38px "JetBrains Mono", monospace'; g.fillStyle = "rgba(42,28,18,.7)";
      g.fillText("art not drawn yet", w / 2, 556);
    } else if (game.id === "flood") {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#132a66"); bg.addColorStop(1, "#2a56b6");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = "#ffe9a8"; g.beginPath(); g.arc(560, 150, 62, 0, 7); g.fill();
      g.fillStyle = "#132a66"; g.beginPath(); g.arc(532, 134, 54, 0, 7); g.fill();
      g.fillStyle = "#fff";
      g.font = '900 190px "Nunito", sans-serif'; g.fillText("FLOOD", w / 2, 330);
      // A house going under.
      g.save(); g.translate(w / 2, 640); g.rotate(-0.07);
      g.fillStyle = "#f3e3c2"; g.fillRect(-120, -60, 240, 240);
      g.fillStyle = "#c8382c"; g.beginPath(); g.moveTo(-160, -56); g.lineTo(0, -190); g.lineTo(160, -56); g.fill();
      g.fillStyle = "#8a2a20"; g.fillRect(60, -170, 40, 80);
      g.fillStyle = "#ffd76a"; g.fillRect(-70, -10, 56, 60); g.fillRect(20, -10, 56, 60);
      g.restore();
      const wave = (y0, amp, len, phase, fillStyle, crest) => {
        g.beginPath(); g.moveTo(0, h);
        for (let x = 0; x <= w; x += 10) g.lineTo(x, y0 + Math.sin(x / len + phase) * amp);
        g.lineTo(w, h); g.closePath(); g.fillStyle = fillStyle; g.fill();
        g.beginPath();
        for (let x = 0; x <= w; x += 10) { const y = y0 + Math.sin(x / len + phase) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.strokeStyle = crest; g.lineWidth = 9; g.stroke();
      };
      wave(676, 22, 52, 0.6, "#4f86e6", "rgba(255,255,255,.85)");
      wave(770, 20, 60, 2.1, "#3a6dcf", "rgba(255,255,255,.55)");
      wave(868, 18, 48, 4.0, "#2a56b6", "rgba(255,255,255,.4)");
    } else {
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#3c9460"); bg.addColorStop(1, "#1f5a3a");
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = "#fff1cf";
      fitText(g, "Fox Trouble", w / 2, 150, 620, 130, '400 %px "Abril Fatface", serif');
      g.save(); g.translate(w / 2, 590);
      g.fillStyle = "#e57a2e";
      g.beginPath(); g.moveTo(-250, -210); g.lineTo(-90, -120); g.lineTo(-220, 10); g.fill();
      g.beginPath(); g.moveTo(250, -210); g.lineTo(90, -120); g.lineTo(220, 10); g.fill();
      g.beginPath(); g.moveTo(-240, -90); g.lineTo(240, -90); g.lineTo(0, 260); g.fill();
      g.fillStyle = "#fff6ea";
      g.beginPath(); g.moveTo(-200, 0); g.lineTo(-40, 60); g.lineTo(0, 260); g.fill();
      g.beginPath(); g.moveTo(200, 0); g.lineTo(40, 60); g.lineTo(0, 260); g.fill();
      g.fillStyle = "#1b1a17";
      g.beginPath(); g.arc(0, 236, 34, 0, 7); g.fill();
      g.beginPath(); g.ellipse(-92, -6, 20, 30, 0.3, 0, 7); g.fill();
      g.beginPath(); g.ellipse(92, -6, 20, 30, -0.3, 0, 7); g.fill();
      g.restore();
    }
    // A soft printed edge.
    g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  });
}
const SIDE = { cork: "#4a0e0c", who: "#cfc4b2", wind: "#8a6540", flood: "#10224f", fox: "#143d27" };
function makeBox(tex, game, glow) {
  const sideMat = new THREE.MeshStandardMaterial({ color: SIDE[game.id], roughness: 0.7 });
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow });
  return new THREE.Mesh(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), [sideMat, sideMat, sideMat, sideMat, front, sideMat]);
}

// ---- Room shell.
const dim = (hex) => new THREE.Color(hex).multiplyScalar(DARK);
const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), new THREE.MeshBasicMaterial({ map: wallTexture(ROOM.w, ROOM.h, false), color: dim(0xffffff) }));
back.position.set(0, ROOM.h / 2, ROOM.zBack);
scene.add(back);
const sideTex = wallTexture(ROOM.zFront - ROOM.zBack, ROOM.h, true);
for (const sgn of [-1, 1]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.zFront - ROOM.zBack, ROOM.h), new THREE.MeshBasicMaterial({ map: sideTex, color: dim(0x9aa4c4) }));
  m.position.set(sgn * ROOM.w / 2, ROOM.h / 2, (ROOM.zFront + ROOM.zBack) / 2);
  m.rotation.y = -sgn * Math.PI / 2;
  scene.add(m);
}
const FLOOR_TEX = paint(Math.round(ROOM.w * 150), Math.round((ROOM.zFront - ROOM.zBack) * 150), (g, w, h) => T.floor(g, w, h, 150));
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM.w, ROOM.zFront - ROOM.zBack),
  new THREE.MeshStandardMaterial({ map: FLOOR_TEX, roughness: 0.78, metalness: 0.0, emissive: 0xffffff, emissiveMap: FLOOR_TEX, emissiveIntensity: 0.22 * DARK }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, (ROOM.zFront + ROOM.zBack) / 2);
floor.receiveShadow = true;
scene.add(floor);
// The front of the stage, and the lit edge along it.
const fascia = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w + 10, ROOM.fasciaH), new THREE.MeshBasicMaterial({ color: T.fascia }));
fascia.position.set(0, -ROOM.fasciaH / 2, ROOM.zFront);
scene.add(fascia);
const lip = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 10, 0.022, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent).multiplyScalar(0.55) }));
lip.position.set(0, -0.02, ROOM.zFront + 0.02);
scene.add(lip);
if (T.skirt) {
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.4 * DARK }));
  skirt.position.set(0, 0.03, ROOM.zBack + 0.02);
  scene.add(skirt);
}

scene.add(new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemi * DARK));
const fill = new THREE.DirectionalLight(T.fill, 1.25 * DARK);
fill.position.set(-3, 5, 14);
scene.add(fill);

// ---- Lamps, cones and pools.
const coneMat = (strength, color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uStrength: { value: strength }, uColor: { value: new THREE.Color(color) } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
  // The beam is faint where it crosses the box art and gathers toward the floor.
  fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
    void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
      float along = mix(1.0, 0.3, smoothstep(0.25, 0.75, vH)) * smoothstep(0.0, 0.08, vH);
      gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
});
function makeLampHead(level) {
  const g = new THREE.Group();
  const on = level > 0;
  const bright = on ? Math.min(1, 0.25 + level * 0.7) : 0.04;
  const lit = new THREE.Color(T.light).multiplyScalar(bright * 1.6);
  if (T.lamp === "lantern") {
    // A paper lantern.
    const paper = new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.shade).multiplyScalar(0.35 + bright * 0.9) }));
    paper.scale.y = 1.12; paper.position.y = 0.3;
    g.add(paper);
    for (const y of [0.02, 0.58]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 16), new THREE.MeshBasicMaterial({ color: 0x1a120a })); cap.position.y = y; g.add(cap); }
    for (const y of [0.16, 0.3, 0.44]) { const rib = new THREE.Mesh(new THREE.TorusGeometry(y === 0.3 ? 0.272 : 0.235, 0.006, 6, 40), new THREE.MeshBasicMaterial({ color: 0x7a3a10 })); rib.rotation.x = Math.PI / 2; rib.position.y = y; g.add(rib); }
  } else if (T.lamp === "ring") {
    // A neon ring.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 12, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent).multiplyScalar(on ? 1.5 : 0.15) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.08;
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 10, 48), new THREE.MeshBasicMaterial({ color: lit }));
    inner.rotation.x = Math.PI / 2; inner.position.y = 0.08;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 12), new THREE.MeshBasicMaterial({ color: 0x1a1230 }));
    cap.position.y = 0.26;
    g.add(ring, inner, cap);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6), cap.material); spoke.position.set(Math.sin(a) * 0.16, 0.16, Math.cos(a) * 0.16); spoke.rotation.set(Math.cos(a) * 1.05, 0, -Math.sin(a) * 1.05); g.add(spoke); }
  } else {
    const drum = T.lamp === "drum";
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(drum ? 0.27 : 0.07, 0.36, drum ? 0.36 : 0.3, 40, 1, true),
      drum
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(T.shade).multiplyScalar(0.3 + bright * 0.6), side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: T.shade, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
    );
    shade.position.y = drum ? 0.18 : 0.15;
    g.add(shade);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 20), new THREE.MeshStandardMaterial({ color: T.cord, roughness: 0.5 }));
    cap.position.y = drum ? 0.42 : 0.36;
    g.add(cap);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), new THREE.MeshBasicMaterial({ color: lit }));
    bulb.rotation.x = Math.PI / 2;
    bulb.position.y = 0.03;
    g.add(bulb);
  }
  if (on) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: T.light, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.18 + 0.5 * Math.min(level, 1.3) }));
    halo.scale.setScalar(1.1 + level * 0.9);
    halo.position.y = T.lamp === "lantern" ? 0.3 : 0.02;
    g.add(halo);
  }
  return g;
}
const cordMat = new THREE.MeshBasicMaterial({ color: T.cord });
function addPool(i) {
  const x = POOL_X[i], level = levels[i], on = level > 0;
  const head = makeLampHead(level);
  head.position.set(x, LAMP_Y, WALK_Z);
  scene.add(head);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 3, 8), cordMat);
  cord.position.set(x, LAMP_Y + 0.4 + 1.5, WALK_Z);
  scene.add(cord);
  // The pool keeps a faint edge even when its lamp is out, so it still reads as a place.
  const ring = new THREE.Mesh(new THREE.RingGeometry(POOL_R - 0.018, POOL_R + 0.018, 96), new THREE.MeshBasicMaterial({ color: T.light, transparent: true, opacity: on ? 0.16 + 0.34 * Math.min(level, 1.2) : 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.006, WALK_Z);
  scene.add(ring);
  if (!on) return;

  const spot = new THREE.SpotLight(T.light, 2.2 + 5.2 * level, 0, Math.atan((POOL_R + 0.04) / LAMP_Y), 0.3, 0);
  spot.position.set(x, LAMP_Y, WALK_Z);
  spot.target.position.set(x, 0, WALK_Z);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0008;
  spot.shadow.radius = 5;
  scene.add(spot, spot.target);
  // A little light thrown back up from the floor, so faces are not black under a top light.
  const bounce = new THREE.PointLight(T.light, 1.5 * level, 4.5, 1.2);
  bounce.position.set(x, 0.5, WALK_Z + 1.9);
  scene.add(bounce);

  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, POOL_R, LAMP_Y, 64, 1, true), coneMat(Math.min(0.3, 0.06 + 0.18 * level), T.light));
  cone.position.set(x, LAMP_Y / 2, WALK_Z);
  scene.add(cone);
  const wash = new THREE.Mesh(new THREE.CircleGeometry(POOL_R, 96), new THREE.MeshBasicMaterial({ map: POOL, color: T.light, transparent: true, opacity: Math.min(0.8, 0.05 + 0.44 * level), blending: THREE.AdditiveBlending, depthWrite: false }));
  wash.rotation.x = -Math.PI / 2;
  wash.position.set(x, 0.004, WALK_Z);
  scene.add(wash);
  // Light spilling up the wall behind a bright pool.
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.0), new THREE.MeshBasicMaterial({ map: RADIAL, color: T.light, transparent: true, opacity: 0.1 * level, blending: THREE.AdditiveBlending, depthWrite: false }));
  spill.position.set(x, 0.1, ROOM.zBack + 0.03);
  scene.add(spill);
}
POOL_X.forEach((_, i) => addPool(i));

// ---- The four spots on the wall: a lit frame with the game's box in it.
const NICHE = { w: BOX_W + 0.1, h: BOX_H + 0.1, d: 0.4 };
const frameMat = new THREE.MeshStandardMaterial({ color: T.frame, roughness: 0.6 });
const leadFrameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent) });
const canvases = [...GAMES, SPARE].map(boxCanvas);
const textures = canvases.map(textureOf);
function addNiche(i) {
  const x = POOL_X[i];
  const lead = isLead(i), off = isOff(i), open = S.open === i;
  const g = new THREE.Group();
  g.position.set(x, BOX_Y, ROOM.zBack);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w, NICHE.h), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.panel).multiplyScalar(off ? 0.6 : 1.25) }));
  inner.position.z = 0.012;
  g.add(inner);
  const neon = T.neon && !off ? new THREE.MeshBasicMaterial({ color: new THREE.Color(T.neon[i]).multiplyScalar(1.25) }) : null;
  const bar = 0.07;
  for (const [w, h, X, Y] of [[bar, NICHE.h + bar * 2, -NICHE.w / 2 - bar / 2, 0], [bar, NICHE.h + bar * 2, NICHE.w / 2 + bar / 2, 0], [NICHE.w, bar, 0, NICHE.h / 2 + bar / 2], [NICHE.w, bar, 0, -NICHE.h / 2 - bar / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, NICHE.d), S.winner === i ? leadFrameMat : neon || frameMat);
    m.position.set(X, Y, NICHE.d / 2);
    g.add(m);
  }
  if (neon) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w + 1.3, NICHE.h + 1.3), new THREE.MeshBasicMaterial({ map: RADIAL, color: T.neon[i], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = 0.02;
    g.add(glow);
  }
  const box = makeBox(textures[i], GAMES[i], off ? 0.16 * (S.dark ? 0.5 : 1) : lead ? 0.9 : 0.62);
  if (open) {
    // The poster is a door: it swings out on its left edge, and the game is behind it.
    const hinge = new THREE.Group();
    hinge.position.set(-BOX_W / 2, 0, 0.2);
    box.position.set(BOX_W / 2, 0, 0);
    hinge.rotation.y = -1.5;
    hinge.add(box);
    g.add(hinge);
    const inside = paint(700, 980, (c, w, h) => {
      c.fillStyle = "#ffd9a0"; c.fillRect(0, 0, w, h);
      if (corkImg) c.drawImage(corkImg, 603, 40, 714, 1000, 0, 0, w, h);
      const v = c.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, 640);
      v.addColorStop(0, "rgba(255,230,180,.25)"); v.addColorStop(1, "rgba(255,200,120,0)");
      c.fillStyle = v; c.fillRect(0, 0, w, h);
    });
    const way = new THREE.Mesh(new THREE.PlaneGeometry(BOX_W, BOX_H), new THREE.MeshBasicMaterial({ map: inside, color: new THREE.Color(1.25, 1.2, 1.1) }));
    way.position.z = 0.03;
    g.add(way);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w + 2.6, NICHE.h + 2.6), new THREE.MeshBasicMaterial({ map: RADIAL, color: 0xffc070, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = 0.06;
    g.add(glow);
    const spill = new THREE.PointLight(0xffc880, 7, 8, 1.1);
    spill.position.set(x, BOX_Y - 0.4, ROOM.zBack + 1.3);
    scene.add(spill);
    // The fold-down steps.
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.7, emissive: 0x4a2a10, emissiveIntensity: 0.55 });
    for (let k = 0; k < 6; k++) {
      const s = onStep(k);
      const step = new THREE.Mesh(new THREE.BoxGeometry(STEP.w, s.y, STEP.run), wood);
      step.position.set(x, s.y / 2, s.z);
      step.castShadow = step.receiveShadow = true;
      scene.add(step);
    }
  } else {
    box.position.set(0, 0, 0.2);
    g.add(box);
  }
  if (S.winner === i && !open) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(NICHE.w + 1.5, NICHE.h + 1.5), new THREE.MeshBasicMaterial({ map: RADIAL, color: T.accent, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.z = 0.02;
    g.add(glow);
  }
  scene.add(g);
}
POOL_X.forEach((_, i) => addNiche(i));

// ---- Left end: the door latecomers come through. Right end: the shelf where the fifth game waits.
if (!T.tent) {
  const x = -END_X, w = 1.0, h = 2.2;
  const warm = new THREE.Color(0xffc777);
  const doorMat = new THREE.MeshStandardMaterial({ color: dim(T.door), roughness: 0.55 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), doorMat);
  const leaf = new THREE.Group(); // hinged on its left edge
  leaf.position.set(x - w / 2, 0, ROOM.zBack + 0.04);
  door.position.set(w / 2, h / 2, 0);
  leaf.add(door);
  scene.add(leaf);
  for (const [bw, bh, X, Y] of [[0.08, h + 0.08, -w / 2 - 0.04, h / 2 + 0.04], [0.08, h + 0.08, w / 2 + 0.04, h / 2 + 0.04], [w + 0.16, 0.08, 0, h + 0.04]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), frameMat);
    m.position.set(x + X, Y, ROOM.zBack + 0.06);
    scene.add(m);
  }
  const port = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.MeshBasicMaterial({ color: warm }));
  port.position.set(w / 2, 1.6, 0.035);
  const portRing = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.175, 40), frameMat);
  portRing.position.set(w / 2, 1.6, 0.037);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 0.7 }));
  knob.position.set(w / 2 + 0.36, 1.05, 0.06);
  leaf.add(port, portRing, knob);
  if (S.doorOpen) {
    // Open, with the hallway light behind it.
    leaf.rotation.y = -1.25;
    const way = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(1.3) }));
    way.position.set(x, h / 2, ROOM.zBack + 0.02);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: warm, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    glow.scale.set(3.6, 4.4, 1); glow.position.set(x, 1.2, ROOM.zBack + 0.3);
    const light = new THREE.PointLight(0xffc777, 4, 6, 1.1);
    light.position.set(x, 1.4, ROOM.zBack + 0.9);
    scene.add(way, glow, light);
  } else {
    const portGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: warm, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22 }));
    portGlow.scale.setScalar(1.2); portGlow.position.set(x, 1.6, ROOM.zBack + 0.1);
    const sill = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, 0.03), new THREE.MeshBasicMaterial({ color: warm }));
    sill.position.set(x, 0.02, ROOM.zBack + 0.075);
    scene.add(portGlow, sill);
  }
}
const SHELF_Y = 1.15, FOX_SCALE = 0.42;
{
  const x = END_X;
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.5), new THREE.MeshBasicMaterial({ color: dim(T.plank) }));
  plank.position.set(x, SHELF_Y, ROOM.zBack + 0.25);
  scene.add(plank);
  for (const dx of [-0.55, 0.55]) {
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.4), frameMat);
    br.position.set(x + dx, SHELF_Y - 0.18, ROOM.zBack + 0.2);
    scene.add(br);
  }
  const fox = makeBox(textures[4], SPARE, 0.34 * DARK);
  fox.scale.setScalar(FOX_SCALE);
  fox.position.set(x - 0.05, SHELF_Y + 0.035 + BOX_H * FOX_SCALE / 2, ROOM.zBack + 0.25);
  fox.rotation.y = -0.25;
  scene.add(fox);
}

// ---- A string of small bulbs, where the room has one.
if (T.bulbs) {
  const n = 25;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), x = (t - 0.5) * (ROOM.w - 0.6);
    const sag = Math.pow((t * 4) % 1 - 0.5, 2) * 1.2;
    const y = 5.62 + sag, z = ROOM.zBack + 0.5;
    const col = new THREE.Color(T.bulbs[i % T.bulbs.length]);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6 * DARK) }));
    bulb.position.set(x, y, z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: col, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 * DARK }));
    glow.scale.setScalar(0.7); glow.position.set(x, y, z + 0.02);
    scene.add(bulb, glow);
  }
}
if (T.extras) T.extras();

// ---- Characters. Every skin is the same size class, wears the seat colour and has the same eyes.
const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.25 });
const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
function addEyes(turn, face, { r, y, spread = 0.33, size = 1, shock = false, visor = false }) {
  for (const s of [-1, 1]) {
    const a = s * spread;
    const at = (rr, yy) => new THREE.Vector3(Math.sin(a) * rr, yy, Math.cos(a) * rr);
    if (visor) {
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xbff3ff }));
      eye.scale.set(0.045 * size, 0.055 * size, 0.015);
      eye.position.set(s * 0.085, y, r);
      turn.add(eye);
      continue;
    }
    if (shock) {
      const white = new THREE.Mesh(eyeGeo, whiteMat);
      white.scale.set(0.06 * size, 0.075 * size, 0.022);
      white.position.copy(at(r, y)); white.rotation.y = a;
      const pupil = new THREE.Mesh(eyeGeo, eyeMat);
      pupil.scale.set(0.022 * size, 0.026 * size, 0.012);
      pupil.position.copy(at(r + 0.018, y)); pupil.rotation.y = a;
      turn.add(white, pupil);
      continue;
    }
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(0.034 * size, 0.052 * size, 0.02);
    eye.position.copy(at(r, y)); eye.rotation.y = a;
    turn.add(eye);
    // The glint is left off an eye that has turned to the edge of the head, where it would float.
    if (Math.abs(face + a) < 0.8) {
      const glint = new THREE.Mesh(eyeGeo, whiteMat);
      glint.scale.set(0.011 * size, 0.013 * size, 0.008);
      glint.position.copy(at(r + 0.014, y + 0.021 * size));
      turn.add(glint);
    }
  }
}
const lathe = (pts, seg = 56) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const pawnBody = lathe([[0, 0], [0.29, 0], [0.325, 0.03], [0.33, 0.08], [0.3, 0.13], [0.235, 0.24], [0.185, 0.4], [0.15, 0.56], [0.145, 0.61], [0.2, 0.645], [0.205, 0.68], [0.15, 0.715], [0, 0.72]]);
const pawnHead = new THREE.SphereGeometry(0.215, 40, 28);
const slimeProfile = (n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = i / n * Math.PI / 2;
  // A soft dome that sags outward at the foot.
  return [0.43 * Math.pow(Math.cos(a), 0.62) + 0.05 * Math.pow(1 - i / n, 6), 0.7 * Math.sin(a)];
}).concat([[0, 0.7]]);
const slimeBody = lathe(slimeProfile(25));
slimeBody.computeVertexNormals();
const slimeHard = lathe(slimeProfile(4), 9); // the same dome cut into flat faces
const ghostBody = lathe([[0.33, 0], [0.335, 0.2], [0.33, 0.5], [0.3, 0.72], [0.24, 0.88], [0.15, 0.98], [0, 1.02]]);
const SKIN_H = { pawn: 1.12, slime: 0.72, robot: 1.4, ghost: 1.04 };
function makeSkin(kind, hex, p) {
  const c = new THREE.Color(p.grey ? "#8a8d94" : hex);
  const face = p.face || 0;
  const mat = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25, emissive: c, emissiveIntensity: p.grey ? 0.12 : 0.3 });
  const turn = new THREE.Group();
  const cast = (m) => { m.castShadow = !p.gone; turn.add(m); return m; };
  if (kind === "slime") {
    if (p.mode === "hard") {
      // Hardened: flat faces, a steel shine.
      mat.color.lerp(new THREE.Color(0xe8eef6), 0.3); mat.flatShading = true; mat.metalness = 0.75; mat.roughness = 0.22; mat.clearcoat = 1; mat.emissiveIntensity = 0.16;
      cast(new THREE.Mesh(slimeHard, mat));
    } else {
      mat.roughness = 0.12; mat.clearcoat = 1; mat.clearcoatRoughness = 0.05; mat.transparent = true; mat.opacity = p.mode === "soft" ? 0.8 : 0.93; mat.emissiveIntensity = p.mode === "soft" ? 0.6 : 0.42;
      cast(new THREE.Mesh(slimeBody, mat));
      // A wet highlight and two drips at the foot.
      const shine = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
      shine.scale.set(0.085, 0.04, 0.02); shine.position.set(-0.16, 0.57, 0.19); shine.rotation.set(-0.7, -0.5, 0.5);
      turn.add(shine);
      for (const [X, Z, R] of [[0.47, 0.16, 0.07], [-0.44, 0.24, 0.05]]) { const d = cast(new THREE.Mesh(eyeGeo, mat)); d.scale.set(R, R * 0.6, R); d.position.set(X, R * 0.3, Z); }
    }
    addEyes(turn, face, { r: p.mode === "hard" ? 0.39 : 0.405, y: 0.34, spread: 0.36, size: 1.5, shock: p.shock });
  } else if (kind === "robot") {
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.5, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.35, metalness: 0.8 });
    const base = cast(new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.16, 0.42, 4, 0.07), dark)); base.position.y = 0.08;
    const body = cast(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 0.38, 5, 0.09), mat)); body.position.y = 0.36;
    const neck = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 16), steel)); neck.position.y = 0.6;
    const head = cast(new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.34, 0.38, 5, 0.1), mat)); head.position.y = 0.8;
    const visor = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.19, 0.06, 4, 0.03), new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.2 })); visor.position.set(0, 0.81, 0.175);
    turn.add(visor);
    const mast = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8), steel)); mast.position.y = 1.07;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd27a })); tip.position.y = 1.19;
    turn.add(tip);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })); plate.position.set(0, 0.38, 0.192);
    turn.add(plate);
    // Arms: the one on the viewer's side shoots out on a spring (round two's shove).
    const near = face > 0 ? -1 : 1;
    for (const s of [-1, 1]) {
      const out = s === near ? (p.arm || 0) : 0;
      const sh = cast(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), dark)); sh.position.set(s * 0.29, 0.44, 0);
      if (out) {
        const len = out + 0.16;
        const rod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 10), steel));
        rod.rotation.x = Math.PI / 2; rod.position.set(s * 0.29, 0.44, len / 2);
        for (let k = 0; k < 7; k++) { const coil = cast(new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.013, 8, 20), steel)); coil.position.set(s * 0.29, 0.44, 0.12 + k * (len - 0.2) / 6); }
        const glove = cast(new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), new THREE.MeshPhysicalMaterial({ color: 0xf3ead6, roughness: 0.4, clearcoat: 0.5 }))); glove.position.set(s * 0.29, 0.44, len + 0.06);
      } else {
        const arm = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 10), dark)); arm.position.set(s * 0.31, 0.3, 0);
        const hand = cast(new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), steel)); hand.position.set(s * 0.31, 0.16, 0);
      }
    }
    if (p.hook) {
      // The hook: a chain fired from the chest, ending in an open claw.
      const hx = near * 0.1, hy = 0.4, L = p.hook;
      const muzzle = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.12, 16), dark)); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(hx, hy, 0.22);
      for (let z = 0.32, k = 0; z < L - 0.02; z += 0.075, k++) {
        const link = cast(new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 6, 14), steel));
        link.position.set(hx, hy, z);
        if (k % 2) link.rotation.x = Math.PI / 2; else link.rotation.y = Math.PI / 2;
      }
      const claw = cast(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.032, 10, 28, Math.PI * 1.45), new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.3, metalness: 0.7, emissive: 0x8a5a10, emissiveIntensity: 0.6 })));
      claw.rotation.set(Math.PI / 2, 0, Math.PI * 0.775);
      claw.position.set(hx, hy, L + 0.1);
    }
    addEyes(turn, face, { r: 0.207, y: 0.81, visor: true });
    turn.scale.setScalar(1.13);
  } else if (kind === "ghost") {
    // A pale sheet tinted with the seat colour, so it does not read as a second slime.
    mat.color.lerp(new THREE.Color(0xffffff), 0.6); mat.emissive.lerp(new THREE.Color(0xffffff), 0.25);
    mat.transparent = true; mat.opacity = p.fade ? 0.26 : 0.92; mat.emissiveIntensity = p.fade ? 0.9 : 0.45; mat.roughness = 0.6; mat.clearcoat = 0.1;
    if (p.fade) mat.depthWrite = false;
    cast(new THREE.Mesh(ghostBody, mat));
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; const b = cast(new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), mat)); b.position.set(Math.sin(a) * 0.235, 0.0, Math.cos(a) * 0.235); }
    for (const s of [-1, 1]) { const hand = cast(new THREE.Mesh(eyeGeo, mat)); hand.scale.set(0.1, 0.075, 0.09); hand.position.set(s * 0.37, 0.5, 0.12); hand.rotation.z = s * 0.5; }
    if (!p.fade) {
      addEyes(turn, face, { r: 0.315, y: 0.68, spread: 0.36, size: 1.45 });
      const mouth = new THREE.Mesh(eyeGeo, eyeMat); mouth.scale.set(0.05, 0.065, 0.02); mouth.position.set(0, 0.5, 0.333);
      turn.add(mouth);
    }
  } else {
    cast(new THREE.Mesh(pawnBody, mat));
    const head = cast(new THREE.Mesh(pawnHead, mat));
    head.position.y = 0.9;
    addEyes(turn, face, { r: 0.205, y: 0.925, shock: p.shock, size: p.shock ? 0.9 : 1 });
  }
  if (p.crown) {
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.6, emissive: 0xf2c14e, emissiveIntensity: 0.45, side: THREE.DoubleSide });
    const band = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.09, 24, 1, true), gold)); band.position.y = 1.13;
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const spike = cast(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 10), gold)); spike.position.set(Math.sin(a) * 0.145, 1.22, Math.cos(a) * 0.145); }
  }
  if (p.gone) {
    // Fading out of the room.
    turn.traverse((m) => { if (m.material) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.2; m.material.depthWrite = false; } });
  }
  turn.rotation.y = face;
  const tilt = new THREE.Group();
  tilt.add(turn);
  tilt.scale.setScalar(CH);
  return tilt;
}
const heightOf = (p) => SKIN_H[p.skin || "pawn"] * CH * (p.squash || 1) + (p.crown ? 0.16 : 0);
const zOf = (p) => p.z ?? WALK_Z;
const blobMat = new THREE.MeshBasicMaterial({ map: RADIAL, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
for (const p of S.players) {
  const body = makeSkin(p.skin || "pawn", SEATS[p.seat].hex, p);
  body.position.set(p.x, p.y || 0, zOf(p));
  body.rotation.z = p.lean || 0;
  body.userData.keep = true;
  if (p.squash) body.scale.set(CH / Math.sqrt(p.squash), CH * p.squash, CH / Math.sqrt(p.squash));
  scene.add(body);
  if (p.gone) continue;
  const lift = (p.y || 0) - (p.ground || 0);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5 * CH * (p.skin === "slime" ? 1.3 : 1), 32), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(p.x, (p.ground || 0) + 0.008, zOf(p));
  blob.scale.setScalar(Math.max(0.45, 1 - lift * 0.6));
  blob.userData.keep = true;
  scene.add(blob);
  if (PHONE && p.seat === YOU) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.012, WALK_Z);
    scene.add(ring);
  }
}

// ---- The bell: a brass bell on a rope at the edge of the leading light.
const BELL_Y = 1.44;
if (S.bell !== undefined) {
  const x = POOL_X[S.bell] + BELL_DX;
  const brass = new THREE.MeshStandardMaterial({ color: 0xe0a93b, roughness: 0.25, metalness: 0.85, emissive: 0xc98a1e, emissiveIntensity: 0.55, side: THREE.DoubleSide });
  const bell = new THREE.Mesh(lathe([[0.2, 0], [0.19, 0.03], [0.15, 0.08], [0.125, 0.18], [0.11, 0.27], [0.07, 0.33], [0, 0.345]], 40), brass);
  bell.position.set(x, BELL_Y, WALK_Z);
  bell.rotation.z = 0.2;
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), brass);
  clapper.position.set(x + 0.07, BELL_Y - 0.03, WALK_Z);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 6, 8), new THREE.MeshBasicMaterial({ color: T.rope }));
  rope.position.set(x - 0.06, BELL_Y + 0.34 + 3, WALK_Z);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xffc860, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
  halo.scale.setScalar(1.5); halo.position.set(x, BELL_Y + 0.15, WALK_Z + 0.05);
  scene.add(rope, bell, clapper, halo);
}

// ---- A tie: one gold coin tossed between the two tied lights.
const COIN = { x: S.tied ? (POOL_X[S.tied[0]] + POOL_X[S.tied[1]]) / 2 : 0, y: 3.75, r: 0.4 }; // sized to sit in the gap between the two middle boxes
if (S.tied) {
  const faceTex = paint(512, 512, (g) => {
    const rim = g.createRadialGradient(256, 256, 40, 256, 256, 256);
    rim.addColorStop(0, "#ffe89a"); rim.addColorStop(0.75, "#eeb844"); rim.addColorStop(1, "#b17a1c");
    g.fillStyle = rim; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "#9a6614"; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 196, 0, 7); g.stroke();
    g.fillStyle = "#9a6614"; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, r = i % 2 ? 62 : 150; g.lineTo(256 + Math.sin(a) * r, 256 - Math.cos(a) * r); }
    g.fill();
  });
  const edge = new THREE.MeshStandardMaterial({ color: 0xc98f24, roughness: 0.3, metalness: 0.8, emissive: 0x7a5410, emissiveIntensity: 0.7 });
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.35, metalness: 0.4, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.8 });
  // Caught mid-spin: tipped back so its face and its thick edge both show.
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(COIN.r, COIN.r, 0.1, 64), [edge, faceMat, faceMat]);
  coin.rotation.set(Math.PI / 2 - 0.8, 0, 0.3);
  coin.position.set(COIN.x, COIN.y, WALK_Z);
  scene.add(coin);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: RADIAL, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  halo.scale.setScalar(3); halo.position.set(COIN.x, COIN.y, WALK_Z - 0.2);
  scene.add(halo);
}

// A clear page with only the pieces on it: the room is hidden, its lights are kept.
if (ALPHA) for (const o of scene.children) if (!o.isLight && !o.userData.keep) o.visible = false;
renderer.render(scene, camera);
// The box fronts as pictures, for the landing page's own boxes.
window.__boxes = Object.fromEntries([...GAMES, SPARE].map((game, i) => [game.id, canvases[i].toDataURL("image/png")]));

// ---- Words and marks, laid over the render from the same camera.
const over = document.getElementById("over");
function put(cls, html, at, extra = "") {
  const el = document.createElement("div");
  el.className = `at ${cls}`;
  el.innerHTML = html;
  el.style.cssText = `left:${at.x.toFixed(1)}px;top:${at.y.toFixed(1)}px;${extra}`;
  over.append(el);
  return el;
}
const esc = (s) => s.replace("&", "&amp;");

// Signs under the boxes. No vote marks here: the characters standing in the light are the vote.
GAMES.forEach((game, i) => {
  if (S.bigBoard && (i === 1 || i === 2)) return; // hidden behind the big scoreboard
  if (S.open === i) return;                       // folded away while the poster is open
  const shut = S.cant?.[i];
  if (shut) {
    put(`sign down shut n${i}`, `<b>${esc(game.name)}</b><span class="why">${shut.why}</span>${shut.how ? `<span class="how">${shut.how[0]}<br><u>${shut.how[1]}</u><br>${shut.how[2]}</span>` : ""}`,
      px(POOL_X[i], BOX_Y - NICHE.h / 2 - 0.14, ROOM.zBack));
    return;
  }
  const state = S.winner === i ? "lead" : isOff(i) ? "off" : S.tied ? "tied" : "";
  const about = S.tied && !isOff(i) ? `<span class="side">${S.tied[0] === i ? "Heads" : "Tails"}</span>` : `<span class="about">${game.about}</span>`;
  put(`sign down ${state} n${i}`, `<b>${esc(game.name)}</b>${about}<span class="row"><span class="need" style="--need:${NEED[game.need].color}">${NEED[game.need].plate}</span><span class="seats">${game.seats}</span></span>`,
    px(POOL_X[i], BOX_Y - NICHE.h / 2 - 0.14, ROOM.zBack));
});

// Name tags, added last so they sit over every sign.
function addTags() { for (const p of S.players) {
  if (S.noTags || p.noTag) continue;
  const seat = SEATS[p.seat];
  const you = PHONE && p.seat === YOU;
  const top = (p.y || 0) + heightOf(p) * Math.cos(p.lean || 0) + (you ? 0.24 : 0.15);
  const leanShift = -(p.lean || 0) * 0.8;
  const inLight = S.bigBoard || S.votes.some((v) => v.includes(p.seat));
  const at = p.tagAt ? px(p.x + p.tagAt[0], (p.y || 0) + p.tagAt[1], zOf(p)) : px(p.x + leanShift, top, zOf(p));
  const label = p.note ? `<span>${seat.name}<em>${p.name} - ${p.note}</em></span>` : (you ? (p.label || "You") : p.label || seat.name);
  put(`tag ${p.tagAt ? "" : "up"} ${p.note ? "skin" : ""} ${you ? "you" : ""} ${p.grey ? "grey" : ""} ${inLight ? "" : "dimmed"}`, `<i style="--seat:${p.grey ? "#8a8d94" : seat.hex}"></i>${label}${p.bubble ? `<span class="bubble">${p.bubble}</span>` : ""}`, at);
} }

// The join sign over the door.
{
  const code = generate(`https://${JOIN_ADDRESS}/?join=${PIN}`);
  const n = code.size, q = 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.get(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
  put(PHONE ? "join" : "join down", `<small>${PHONE ? "Party code" : "Scan or type the code"}</small><svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><path d="${d}" fill="#140c08"/></svg><div class="pin">${PIN}</div><div class="addr">${JOIN_ADDRESS}</div>`,
    px(-END_X, PHONE ? 3.6 : 5.12, ROOM.zBack));
}
put("shelf-tag down", `Up next<b>${SPARE.name}</b>`, px(END_X, SHELF_Y - 0.4, ROOM.zBack));

// The night's scores. "before" is the board as it stood before the game just played.
const table = S.before ? SCORES.map((s) => ({ seat: s.seat, pts: s.pts - s.last, last: 0 })).sort((a, b) => b.pts - a.pts || a.seat - b.seat) : SCORES;
const rows = (ups) => table.map((s, i) => `<div class="line"><u>${i + 1}</u><i style="--seat:${SEATS[s.seat].hex}"></i><span>${SEATS[s.seat].name}</span>${ups ? `<span class="up">${s.last ? `+${s.last}` : ""}</span>` : ""}<s>${s.pts}</s></div>`).join("");
if (S.bigBoard) {
  const top = px(0, 5.36, ROOM.zBack);
  for (const dx of [-1.9, 1.9]) {
    const a = px(dx, 5.36, ROOM.zBack);
    const chain = document.createElement("div");
    chain.className = "chain";
    chain.style.cssText = `left:${a.x - 1.5}px;top:0;height:${a.y + 4}px`;
    over.append(chain);
  }
  put("board big down", `<h3>Tonight's scores</h3><div class="rule"></div>${rows(true)}<small>After 3 games<br>Every game gives 3 for 1st, 2 for 2nd, 1 for 3rd</small>`, top);
  put("hook-patch down", "", px(END_X, 5.12, ROOM.zBack));
} else {
  put(`board down ${S.fresh ? "fresh" : ""}`, `<h3>Tonight</h3><div class="rule"></div>${rows(S.fresh)}<small>after ${S.before ? 2 : 3} games<br>1st 3 pts, 2nd 2, 3rd 1</small>`, px(END_X, 5.12, ROOM.zBack));
}

// Locking in with a clock: a count on the corner of the winning box.
if (S.count) {
  const r = 46, c = 2 * Math.PI * r, left = 0.6;
  put("count", `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="#160c06" stroke="rgba(255,255,255,.25)" stroke-width="6"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * left).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
    <small>Starts in</small><b>${S.count}</b>`, px(POOL_X[S.winner] + BOX_W / 2 + 0.24, BOX_Y + BOX_H / 2 + 0.2, ROOM.zBack));
}
if (S.bell !== undefined && SHOT === "bell") put("callout right", "Jump to ring it", px(POOL_X[S.bell] + BELL_DX + 0.36, BELL_Y + 0.17, WALK_Z));
if (S.tied) put("banner", `<b>Tie!</b><span>Coin toss decides</span>`, px(COIN.x, 5.52, ROOM.zBack));
if (S.toast) put("toast", S.toast, px(0, 5.62, ROOM.zBack));
if (S.card) put("card", S.card.html, px(S.card.x, S.card.y, ROOM.zBack));

addTags();

// The front of the stage.
{
  const edge = px(0, 0, ROOM.zFront).y;
  const el = document.createElement("div");
  el.className = "fascia";
  el.style.height = `${(H - edge).toFixed(1)}px`;
  if (PHONE) {
    const mine = S.votes.findIndex((v) => v.includes(YOU));
    const icon = (d, w = 3) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    // The ability button: its ring drains when the move is used and fills back up; the number is seconds left.
    const b = S.button || { cool: 1 };
    const ring = 2 * Math.PI * 46;
    const ability = `<div class="key ability ${b.cool < 1 ? "cooling" : ""}">
        <svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="7"/><circle cx="50" cy="50" r="46" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(ring * b.cool).toFixed(1)} ${ring.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
        ${b.skin === "slime"
          ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 19c-.8 0-1.2-.7-1-1.6C3.3 12.500 5 6 12 6s8.700 6.500 9.500 11.400c.2.900-.2 1.600-1 1.600z"/></svg>`
          : icon("M4 12h9 M10 7l5 5-5 5 M19 5v14")}
        ${b.cool < 1 ? `<em>2</em>` : ""}
      </div>`;
    el.innerHTML = `<div class="pad l"><div class="key">${icon("M15 5l-7 7 7 7")}</div><div class="key">${icon("M9 5l7 7-7 7")}</div></div>
      ${S.start
        ? `<div class="start"><small>${S.startNote}</small>${S.start}</div>`
        : `<div class="mine" style="height:${(H - edge).toFixed(1)}px"><span>Your vote</span><b><i style="--seat:${SEATS[YOU].hex}"></i>${mine < 0 ? "Not yet" : GAMES[mine].name}</b>${S.mine ? `<span class="sep"></span><span>${S.mine}</span>` : ""}</div>`}
      <div class="zoomkey">${icon(ZOOM > 1 ? "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4 M8 11h6" : "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4 M8 11h6 M11 8v6", 2.2)}<span>${ZOOM > 1 ? "Whole room" : "Closer"}</span></div>
      <div class="pad r"><div class="key small">${icon("M4 5.5h16v10.5h-9l-4.5 3.6V16H4z M9 9.2v.6 M15 9.2v.6 M9 12.2c1.8 1.5 4.2 1.5 6 0", 2.2)}</div>${ability}<div class="key jump">${icon("M5 14l7-7 7 7")}</div></div>
      ${b.tip ? `<div class="tip"><b>${b.tip[0]}</b><b>${b.tip[1]}</b></div>` : ""}`;
  } else {
    el.innerHTML = `<div class="brand"><i></i>${SITE_NAME}</div><div class="hint">${S.hint || ""}</div><div class="code"><span>Join<br>code</span><b>${PIN}</b></div>`;
  }
  over.append(el);
}

// ---- Hand-drawn marks for motion.
const fx = document.getElementById("fx");
fx.setAttribute("viewBox", `0 0 ${W} ${H}`);
const k = U / 127;
const INK = T.ink;
function mark(d, stroke, width, opacity, dash = "") {
  fx.insertAdjacentHTML("beforeend", `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${(width * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`);
}
fx.insertAdjacentHTML("beforeend", `<defs>
  <linearGradient id="streakL" x1="1" x2="0"><stop offset="0" stop-color="${INK}" stop-opacity=".85"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient>
  <linearGradient id="streakR" x1="0" x2="1"><stop offset="0" stop-color="${INK}" stop-opacity=".85"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient></defs>`);
// Speed lines trailing behind something that moves right (dir 1) or left (dir -1).
function streaks(x, y0, z, list, dir = 1) {
  for (const [y, start, len, h] of list) {
    const p1 = px(x - dir * start, y0 + y, z), p2 = px(x - dir * (start + len), y0 + y, z);
    fx.insertAdjacentHTML("beforeend", `<rect x="${Math.min(p1.x, p2.x)}" y="${p1.y - h * k / 2}" width="${Math.abs(p1.x - p2.x)}" height="${h * k}" rx="${h * k / 2}" fill="url(#streak${dir > 0 ? "L" : "R"})"/>`);
  }
}
const RUN = [[0.78, 0.36, 0.7, 5], [0.56, 0.42, 1.15, 7], [0.34, 0.44, 0.85, 5], [0.13, 0.42, 0.5, 4]];
function burst(at, n, r1, r2, from = -Math.PI / 2, step = 0.42, color = "#ffffff") {
  for (let i = 0; i < n; i++) {
    const ang = from + (i - (n - 1) / 2) * step, a = r1 * k, b = (i % 2 ? r2 * 0.7 : r2) * k;
    mark(`M${at.x + Math.cos(ang) * a} ${at.y + Math.sin(ang) * a}L${at.x + Math.cos(ang) * b} ${at.y + Math.sin(ang) * b}`, color, 4.5, 0.95);
  }
}
function sparks(list) {
  for (const [x, y, s] of list) {
    const c = px(x, y), r = s * k;
    mark(`M${c.x - r} ${c.y}L${c.x + r} ${c.y}M${c.x} ${c.y - r}L${c.x} ${c.y + r}`, "#ffd27a", 3.5, 0.95);
  }
}
const arc = (a, m, b, dash = true) => mark(`M${a.x} ${a.y}Q${m.x} ${m.y} ${b.x} ${b.y}`, INK, 3.5, 0.75, dash ? `${2 * k} ${11 * k}` : "");
const P = S.players;
if (S.fx?.charge) {
  const a = P[S.fx.charge[0]], b = P[S.fx.charge[1]];
  streaks(a.x, 0, WALK_Z, RUN);
  burst(px(a.x + 0.66, 0.5), 7, 16, 44);
  // The arc of the one who got knocked back: from where they stood, up and out of the light.
  arc(px(a.x + 0.74, 0.5), px((a.x + b.x) / 2 + 0.5, 1.25), px(b.x - 0.2, b.y + 0.62));
  sparks([[b.x + 0.62, b.y + 0.2, 9], [b.x + 0.95, b.y + 0.62, 6], [b.x + 0.3, b.y - 0.12, 6]]);
}
if (S.fx?.drag !== undefined) {
  // Dragged along the floor toward the robot: speed lines behind, skid marks under.
  const b = P[S.fx.drag];
  streaks(b.x, 0, zOf(b), [[0.7, 0.3, 0.6, 5], [0.48, 0.36, 1.0, 7], [0.26, 0.38, 0.7, 5]], -1);
  for (const dz of [-0.12, 0.12]) {
    const p1 = px(b.x + 0.2, 0.01, zOf(b) + dz), p2 = px(b.x + 1.25, 0.01, zOf(b) + dz);
    mark(`M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, "#1a0f08", 5, 0.55);
  }
}
if (S.fx?.reverse) {
  // The slime soaks up the pull: rings closing in on it, and the robot flying toward it.
  const s = P[S.fx.reverse[0]], r = P[S.fx.reverse[1]];
  streaks(r.x, r.y, WALK_Z, [[0.95, 0.4, 0.6, 5], [0.66, 0.46, 1.0, 7], [0.36, 0.46, 0.7, 5]]);
  const c = px(s.x, 0.3, zOf(s));
  for (const [rx, ry, o] of [[150, 96, 0.3], [124, 78, 0.5], [98, 60, 0.8]]) {
    mark(`M${c.x - rx * k} ${c.y}A${rx * k} ${ry * k} 0 0 1 ${c.x + rx * k} ${c.y}`, "#fff4c8", 4, o);
  }
  for (const s2 of [-1, 1]) {
    const tip = { x: c.x + s2 * 84 * k, y: c.y - 30 * k };
    mark(`M${tip.x + s2 * 26 * k} ${tip.y - 22 * k}L${tip.x} ${tip.y}M${tip.x + s2 * 2 * k} ${tip.y - 18 * k}L${tip.x} ${tip.y}L${tip.x + s2 * 18 * k} ${tip.y - 2 * k}`, "#fff4c8", 4, 0.9);
  }
  sparks([[r.x - 0.3, r.y + 1.3, 8], [r.x + 0.1, r.y + 1.5, 6]]);
}
if (S.fx?.bounce) {
  // The charge lands on something hard, and the one who charged is thrown back the way it came.
  const s = P[S.fx.bounce[0]], b = P[S.fx.bounce[1]];
  burst(px(s.x - 0.42, 0.4), 7, 18, 52, Math.PI, 0.36);
  arc(px(s.x - 0.5, 0.45), px((s.x + b.x) / 2 - 0.2, 1.5), px(b.x + 0.25, b.y + 0.7));
  sparks([[b.x - 0.55, b.y + 0.3, 9], [b.x - 0.85, b.y + 0.75, 6], [b.x - 0.25, b.y + 1.0, 6]]);
  // A glint on the hard shell.
  const g = px(s.x + 0.1, 0.52), r = 20 * k;
  mark(`M${g.x - r} ${g.y}L${g.x + r} ${g.y}M${g.x} ${g.y - r * 1.4}L${g.x} ${g.y + r * 1.4}`, "#ffffff", 4, 0.95);
}
if (S.fx?.through) {
  // The charge passes through a ghost that is only an outline.
  const gh = P[S.fx.through[0]], a = P[S.fx.through[1]];
  streaks(a.x, 0, WALK_Z, [[0.78, 0.36, 1.3, 5], [0.56, 0.42, 1.9, 7], [0.34, 0.44, 1.5, 5], [0.13, 0.42, 1.0, 4]]);
  const c = px(gh.x, gh.y + 0.42), rx = 46 * k, ry = 62 * k;
  mark(`M${c.x - rx} ${c.y + ry}L${c.x - rx} ${c.y - ry * 0.3}A${rx} ${rx} 0 0 1 ${c.x + rx} ${c.y - ry * 0.3}L${c.x + rx} ${c.y + ry}`, "#ffffff", 3, 0.8, `${7 * k} ${8 * k}`);
  // A question mark over the one who missed.
  const q = px(a.x + 0.3, 1.25), u = 12 * k;
  mark(`M${q.x - u} ${q.y - u}Q${q.x - u} ${q.y - 2.4 * u} ${q.x} ${q.y - 2.4 * u}Q${q.x + u * 1.1} ${q.y - 2.4 * u} ${q.x + u} ${q.y - 1.3 * u}Q${q.x + u * 0.9} ${q.y - 0.6 * u} ${q.x} ${q.y - 0.2 * u}L${q.x} ${q.y + 0.4 * u}`, "#ffffff", 5, 0.95);
  mark(`M${q.x} ${q.y + 1.3 * u}L${q.x} ${q.y + 1.35 * u}`, "#ffffff", 6, 0.95);
}
if (SHOT === "skins") {
  const [pawn, , slime, ghost] = P;
  for (const dx of [-0.2, 0, 0.2]) {
    const p1 = px(pawn.x + dx, pawn.y - 0.08), p2 = px(pawn.x + dx, pawn.y - (dx ? 0.3 : 0.42));
    mark(`M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, INK, 4, 0.6);
  }
  burst(px(slime.x - 0.4, 0.36), 5, 12, 30, Math.PI * 1.2, 0.45);
  for (const dx of [0.5, 0.62]) {
    const p1 = px(slime.x + dx, 0.5), p2 = px(slime.x + dx + 0.03, 0.12), m = px(slime.x + dx + 0.09, 0.32);
    mark(`M${p1.x} ${p1.y}Q${m.x} ${m.y} ${p2.x} ${p2.y}`, INK, 3, 0.55);
  }
  for (const dx of [-0.2, 0.02, 0.24]) {
    const p1 = px(ghost.x + dx, ghost.y - 0.2), m = px(ghost.x + dx + 0.07, ghost.y - 0.3), p2 = px(ghost.x + dx - 0.02, ghost.y - 0.42);
    mark(`M${p1.x} ${p1.y}Q${m.x} ${m.y} ${p2.x} ${p2.y}`, INK, 3, 0.5);
  }
}
if (S.bell !== undefined) burst(px(POOL_X[S.bell] + BELL_DX - 0.05, BELL_Y + 0.14), 3, 34, 54, Math.PI, 0.4);
if (S.tied) {
  // Tossed up from the floor between the two tied lights, and still spinning.
  arc(px(COIN.x - 0.1, 0.25), px(COIN.x - 0.5, 1.6), px(COIN.x - 0.12, COIN.y - 0.62));
  const c = px(COIN.x, COIN.y), rx = 76 * k, ry = 66 * k;
  for (const s of [-1, 1]) {
    const a = { x: c.x + s * rx * 0.62, y: c.y - s * ry * 0.92 }, b = { x: c.x + s * rx, y: c.y + s * ry * 0.3 };
    const curve = `M${a.x} ${a.y}A${rx} ${ry} 0 0 1 ${b.x} ${b.y}`;
    const head = `M${b.x - s * 15 * k} ${b.y - s * 9 * k}L${b.x} ${b.y}L${b.x + s * 13 * k} ${b.y - s * 12 * k}`;
    // A dark line under the white one, so the arrows hold up over pale box art.
    mark(curve, "#1a0f08", 9, 0.75); mark(head, "#1a0f08", 9, 0.75);
    mark(curve, "#ffffff", 4.5, 1); mark(head, "#ffffff", 4.5, 1);
  }
}
if (S.hop !== undefined) {
  const p = P[S.hop];
  for (const dx of [-0.16, 0.16]) {
    const p1 = px(p.x + dx, 0.14), p2 = px(p.x + dx * 1.4, 0.02);
    mark(`M${p1.x} ${p1.y}L${p2.x} ${p2.y}`, INK, 3.5, 0.6);
  }
}

document.documentElement.dataset.ready = "1";
