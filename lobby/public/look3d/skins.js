// The rooms, as skins. One description per room, and nothing else in the 3D look knows any
// room by name.
//
// Every room keeps the layout exactly: side view, the join sign and the door at the left end,
// the game boxes along the wall with a lamp and a pool of light each, the Tonight board at the
// right end. A skin changes six things: wall, floor, lamps, lettering, sign style and small extras.
//
// A skin is:
//   name, line     what it is called, and one line on what makes the room itself
//   live           true for a room that can be played in (&room=<id>); the others are concepts,
//                  drawn as stills on the rooms page only
//   light...       the colours of its light and its fittings (hex numbers, as three.js takes them)
//   lamp           "shade" | "ring" | "lantern" | "tube" | "dome" | "globe"
//   frame style    `neon`: a colour per box, for frames that glow. `trim: "bolts"` for rivets.
//                  The frames and the signs are the same size and in the same place in every
//                  room; a skin changes only their colour, lettering and trim.
//   doorway        "door" | "tent" | "hatch" | "none" (painted on the wall instead)
//   words          the lettering and the sign style: CSS custom properties for look3d.css, and
//                  `led` for a lit panel in place of the chalkboard
//   wall, floor    painters. (g, w, h, k, side, L): a 2D canvas context, its size in pixels,
//                  pixels per metre, whether this is a side wall, and the layout L (where the
//                  boxes hang, in metres from the middle of the wall). A wall painter may cut
//                  windows (see `cut`): what is outside them is an "outside" entry in `life`.
//   life           what makes the room alive (look3d/life.js): ambient loops, timed events,
//                  reactions, and the one "feature" under the Tonight board that is the room's
//                  own. Times are seconds; places are metres on the wall, from its middle and
//                  from the floor.
//   happens        what to look for, in plain words, for the rooms page
//   sounds         the names this room announces for a sound system to listen for (none is
//                  played here), each with what it should sound like
import { glow, planks, seeded, speckle, stars } from "./paint.js";

/** Cuts a window in a wall that is being painted: a rounded rectangle, or a circle when only r is given. */
function cut(g, x, y, w, h, r = 0) {
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "#000";
  g.beginPath();
  if (w === null) g.arc(x, y, r, 0, 7);
  else g.roundRect(x, y, w, h, r);
  g.fill();
  g.restore();
}

/** Events most night skies share. */
const SHOOTING_STAR = { kind: "flyby", name: "star.fall", sprite: "star", size: [1.7, 0.1], px: [256, 16], every: 27, lasts: 0.9, y: [5.6, 6.6], fall: -1.1, tilt: -0.3, glow: true };
/** What every room announces, whatever its skin. */
const COMMON_SOUNDS = { "lamp.swing": "a lamp creaking on its cord", "piece.land": "a soft wooden thud" };

/** A vertical gradient fill over the whole canvas. */
function fade(g, w, h, stops, y0 = 0, y1 = h) {
  const grad = g.createLinearGradient(0, y0, 0, y1);
  for (const [at, colour] of stops) grad.addColorStop(at, colour);
  g.fillStyle = grad;
  g.fillRect(0, y0, w, y1 - y0);
}

const bar = {
  name: "The bar",
  line: "Dark boards, a green dado, red lamp shades and a string of warm bulbs: the back room of a pub on games night.",
  live: true,
  light: 0xffd9a6, accent: 0xf6b35c, hemiSky: 0xb08a72, hemiGround: 0x140b08, hemi: 1.0, fill: 0xffd2b0,
  frame: 0x4a2c1c, panel: 0x241511, shade: 0x7a2f22, fascia: 0x140b08, cord: 0x1a0f0b, door: 0x2a5a4e, plank: 0x6a4028, above: "#120b09",
  lamp: "shade", bulbs: ["#ffd08a"], skirt: true, doorway: "door",
  words: {},
  life: [
    { kind: "feature", is: "jukebox" },
    { kind: "drift", count: 16, area: [-5.4, 4.6, 1.6, 4.9], colour: 0xffd9a6, size: 0.06 },
    { kind: "flyby", name: "cat.walk", sprite: "cat", size: [0.78, 0.44], px: [192, 108], every: 58, lasts: 15, y: [0.24, 0.24], depth: "rail", fps: 5 },
    { kind: "flyby", name: "moth.visit", sprite: "moth", size: [0.24, 0.2], px: [64, 54], every: 37, lasts: 9, y: [4.7, 5.2], bob: 0.16, arc: 0.3, fps: 14 },
  ],
  happens: [
    "The jukebox under the Tonight board runs its lights round its arch. Bump someone next to it, or land a jump beside it, and it rocks, flashes and throws a few notes.",
    "Jump under a lamp and it swings on its cord.",
    "A cat walks along the foot of the wall from one end of the room to the other, about once a minute.",
    "A moth comes in and bothers the lamps. Dust hangs in their light.",
  ],
  sounds: { ...COMMON_SOUNDS, "jukebox.skip": "a record scratch, then a bar of the tune", "cat.walk": "a small miaow", "moth.visit": "a soft flutter" },
  wall(g, w, h, k) {
    fade(g, w, h, [[0, "#150d0b"], [0.55, "#2b1913"], [1, "#22130e"]]);
    // Tongue-and-groove boards.
    const board = 0.3 * k;
    for (let x = 0, i = 0; x < w; x += board, i++) {
      g.fillStyle = `rgba(255,200,150,${0.012 + ((i * 37) % 5) * 0.008})`;
      g.fillRect(x, 0, board - 2, h);
      g.fillStyle = "rgba(0,0,0,.45)";
      g.fillRect(x + board - 2, 0, 2, h);
    }
    // Painted dado: dark green below the rail.
    const dado = h - 1.25 * k;
    g.fillStyle = "rgba(18,50,44,.78)";
    g.fillRect(0, dado, w, h - dado);
    g.fillStyle = "#b9853f";
    g.fillRect(0, dado - 5, w, 5);
    speckle(g, w, h, 5000, 0.05);
  },
  floor(g, w, h, k) {
    planks(g, w, h, k, 0.22, "#4a3020", "255,210,160");
    speckle(g, w, h, 9000, 0.06);
  },
};

const navy = {
  name: "The studio",
  line: "A game show set in navy and cyan: bulbs chasing round every box, beams sweeping the wall, a prize wheel, and an APPLAUSE sign that means it.",
  live: true,
  life: [
    { kind: "feature", is: "wheel" },
    { kind: "chase", colours: [0xfff2c8, 0x38bdf8], speed: 6, every: 0.26 },
    { kind: "sweep", beams: [{ x: -4.6, colour: 0x38bdf8, swing: 0.5, speed: 0.5, phase: 0 }, { x: 0, colour: 0xb39dfc, swing: 0.62, speed: 0.37, phase: 2 }, { x: 4.6, colour: 0x38bdf8, swing: 0.5, speed: 0.44, phase: 4 }] },
    { kind: "applause", name: "applause.on", words: "APPLAUSE", every: 50, lasts: 5, x: 0, y: 6.05, colours: [0xffd45c, 0x38bdf8, 0xff7a6b, 0xb39dfc] },
  ],
  happens: [
    "Bulbs chase round every game box, and three beams sweep the wall the whole time.",
    "The prize wheel under the Tonight board turns slowly. Bump someone next to it, or land a jump beside it, and it spins.",
    "Just under once a minute the APPLAUSE sign lights up and confetti comes down.",
    "Jump under a lamp and it swings.",
  ],
  sounds: { ...COMMON_SOUNDS, "wheel.spin": "a ratchet clicking down to a stop", "applause.on": "a studio audience clapping and one whoop" },
  light: 0xe6f3ff, accent: 0x38bdf8, hemiSky: 0x7896ea, hemiGround: 0x0a1022, hemi: 1.25, fill: 0xbcd0ff,
  frame: 0x1c2854, panel: 0x101a3c, shade: 0x1d2a56, fascia: 0x060a18, cord: 0x0a1024, door: 0x22336e, plank: 0x2a3a78, above: "#050816",
  lamp: "shade", bulbs: null, skirt: true, doorway: "door",
  words: {
    led: true,
    vars: {
      "--ink": "#eef3ff", "--soft": "#a3b0cf", "--dim": "#7482a6", "--accent": "#38bdf8", "--accent-rgb": "56, 189, 248",
      "--plate": "rgba(8, 13, 30, .93)", "--plate-line": "rgba(132, 160, 230, .34)",
      "--title": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', "--title-w": "800", "--title-size": "0.88", "--title-space": "-.025em",
    },
  },
  wall(g, w, h, k) {
    fade(g, w, h, [[0, "#060a1a"], [0.5, "#0e1a40"], [1, "#0e1a40"]]);
    const dado = h - 1.25 * k;
    fade(g, w, h, [[0, "#16255a"], [1, "#101c48"]], dado, h);
    const step = 0.5 * k;
    for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) {
      g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`;
      g.fillRect(Math.round(x), 0, 1.5, h);
    }
    for (let y = h, i = 0; y > 0; y -= step, i++) {
      g.fillStyle = `rgba(120,185,255,${i % 2 ? 0.07 : 0.13})`;
      g.fillRect(0, Math.round(y), w, 1.5);
    }
    g.fillStyle = "rgba(96,200,255,.75)";
    g.fillRect(0, dado - 3, w, 3);
    fade(g, w, h, [[0, "rgba(56,189,248,0)"], [0.5, "rgba(56,189,248,.13)"], [1, "rgba(56,189,248,0)"]], dado - 46, dado + 46);
    speckle(g, w, h, 4000, 0.03);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#1b2748";
    g.fillRect(0, 0, w, h);
    const step = 0.5 * k;
    for (let x = (w / 2) % step, i = 0; x < w; x += step, i++) {
      g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`;
      g.fillRect(Math.round(x), 0, 2, h);
    }
    for (let y = 0, i = 0; y < h; y += step, i++) {
      g.fillStyle = `rgba(130,195,255,${i % 2 ? 0.1 : 0.2})`;
      g.fillRect(0, Math.round(y), w, 2);
    }
    speckle(g, w, h, 9000, 0.035);
  },
};

const fair = {
  name: "The pier fair",
  line: "The end of the pier on a summer night: sea-green and cream stripes, painted white frames, balloons getting away, fireworks over the water and a high striker to show off on.",
  live: true,
  life: [
    { kind: "feature", is: "striker" },
    { kind: "flyby", name: "balloons.loose", sprite: "balloons", size: [0.8, 1.0], px: [160, 200], every: 39, lasts: 13, y: [2.2, 3.4], fall: 3.6, bob: 0.05 },
    { kind: "burst", name: "fireworks.burst", every: 46, lasts: 4.5, area: [-6, 6, 5.75, 6.5], size: 1.5, colours: [0xff7a6b, 0x5fd6c4, 0xffd45c, 0xffffff] },
  ],
  happens: [
    "The high striker under the Tonight board: bump someone next to it, or land a jump beside it, and the puck runs up the tower. Hit it well and the lamp on top lights.",
    "A bunch of balloons gets away and drifts up across the room, a little more than once a minute.",
    "Fireworks go off in the sky over the top of the canvas, three at a time.",
    "Jump under a lamp and it swings.",
  ],
  sounds: { ...COMMON_SOUNDS, "striker.hit": "a mallet thump and a puck sliding up a wire", "striker.top": "the same, then a ding and a cheer", "balloons.loose": "a child's distant 'oh no'", "fireworks.burst": "three pops with a crackle" },
  light: 0xfff0d0, accent: 0x5fd6c4, hemiSky: 0xa0b8c8, hemiGround: 0x101a1c, hemi: 1.1, fill: 0xe8f0ff,
  frame: 0xf3e9d2, panel: 0x12303a, shade: 0x8fd8c8, fascia: 0x081820, cord: 0x0b1a22, door: 0xe8604c, plank: 0xe8604c, above: "#071226",
  lamp: "shade", bulbs: ["#ffd9a0", "#5fd6c4", "#ff9a8c", "#ffe9a8"], skirt: true, doorway: "door",
  words: {
    vars: {
      "--accent": "#5fd6c4", "--accent-rgb": "95, 214, 196", "--plate": "rgba(8, 26, 36, .94)", "--plate-line": "rgba(95, 214, 196, .5)",
      "--ink": "#f6fbf6", "--soft": "#b8d4cc", "--dim": "#86a39c",
      "--title": '"Nunito", system-ui, sans-serif', "--title-w": "900", "--title-size": "0.9",
      "--sign-bg": "#f6efdc", "--sign-ink": "#1c4a52", "--sign-soft": "#4a6a68", "--sign-line": "#e8604c",
    },
  },
  wall(g, w, h, k) {
    fade(g, w, h, [[0, "#071226"], [0.3, "#14284e"], [1, "#14284e"]]);
    const top = h - 5.32 * k;
    const stripe = 0.71 * k;
    stars(g, w, top - 20, 160, 11);
    // A far shore: a line of lights on the water under the sky.
    for (let x = 0; x < w; x += 0.19 * k) glow(g, x, top - 0.1 * k, 7, x % 3 ? "255,220,160" : "140,230,220", 0.5);
    for (let x = 0, i = 0; x < w; x += stripe, i++) {
      g.fillStyle = i % 2 ? "#f1ead6" : "#2d8f88";
      g.fillRect(x, top, stripe + 1, h - top);
    }
    // The canvas sags a little between its poles.
    for (let x = 0; x < w; x += stripe) {
      g.fillStyle = "rgba(0,0,0,.13)";
      g.fillRect(x + stripe - 7, top, 7, h - top);
    }
    fade(g, w, h, [[0, "rgba(6,16,34,.6)"], [0.5, "rgba(6,16,34,.42)"], [1, "rgba(6,16,34,.58)"]], top, h);
    // A pennant edge in coral, where a big top would have scallops.
    for (let x = 0; x < w; x += stripe / 2) {
      g.fillStyle = "#e8604c";
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x + stripe / 2, top);
      g.lineTo(x + stripe / 4, top + 0.24 * k);
      g.fill();
    }
    g.fillStyle = "#f1ead6";
    g.fillRect(0, top - 4, w, 8);
    // The pier's own boards below the rail, whitewashed, with a rope along the top.
    const dado = h - 1.25 * k;
    g.fillStyle = "#1c4a52";
    g.fillRect(0, dado, w, h - dado);
    for (let x = 0; x < w; x += 0.24 * k) {
      g.fillStyle = "rgba(0,0,0,.34)";
      g.fillRect(x, dado, 2, h - dado);
    }
    g.strokeStyle = "#e9d9b4";
    g.lineWidth = 0.05 * k;
    g.beginPath();
    for (let x = 0; x <= w; x += 0.9 * k) {
      g.moveTo(x, dado - 0.02 * k);
      g.quadraticCurveTo(x + 0.45 * k, dado + 0.2 * k, x + 0.9 * k, dado - 0.02 * k);
    }
    g.stroke();
    speckle(g, w, h, 6000, 0.05);
  },
  floor(g, w, h, k) {
    planks(g, w, h, k, 0.3, "#7a7466", "235,240,235");
    // Sand blown over the boards.
    const rnd = seeded(5);
    for (let i = 0; i < 2200; i++) {
      g.fillStyle = `rgba(240,225,180,${0.06 + rnd() * 0.16})`;
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 1.5);
    }
    speckle(g, w, h, 9000, 0.07);
  },
};

const roof = {
  name: "The rooftop",
  line: "The city at night behind a brick parapet: neon round every box, windows coming on and going off, a night flight overhead, pigeons on the vent, and now and then our own signal on the clouds.",
  live: true,
  life: [
    { kind: "feature", is: "pigeons" },
    { kind: "twinkle", count: 80, area: [-7, 7, 1.5, 4.7], size: [0.06, 0.08], colours: [0xffce78, 0xffce78, 0x78e1ff], period: [5, 18], lit: 0.5 },
    { kind: "flyby", name: "plane.pass", sprite: "plane", size: [1.5, 0.42], px: [384, 108], every: 49, lasts: 12, y: [5.5, 6.4], fps: 1.4, calm: true },
    { kind: "flyby", name: "signal.on", sprite: "signal", size: [2.2, 3.6], px: [300, 490], every: 83, lasts: 16, y: [4.45, 4.45], stay: true, glow: true, opacity: 0.85, calm: true },
    { kind: "flyby", name: "birds.pass", sprite: "birds", size: [1.3, 0.7], px: [208, 112], every: 61, lasts: 11, y: [5.4, 6.4], fps: 4, bob: 0.05 },
    SHOOTING_STAR,
  ],
  happens: [
    "Windows across the skyline come on and go off all night.",
    "A night flight crosses with its wing light blinking, about once a minute. Birds go over. A star falls.",
    "Every minute or two a searchlight finds the clouds with a pawn in the middle of it: the party's own signal.",
    "Three pigeons sit on the vent under the Tonight board. Bump someone next to it, or land a jump beside it, and they leave. They come back.",
    "The ring lamps swing if you jump under them.",
  ],
  sounds: { ...COMMON_SOUNDS, "(always)": "far traffic and a fan", "plane.pass": "a jet, far up", "signal.on": "a heavy switch and a low brass sting", "birds.pass": "a few calls", "pigeons.scatter": "a clatter of wings", "star.fall": "a tiny chime" },
  dust: 0x4a4458,
  light: 0xffd8f2, accent: 0xff5fb0, hemiSky: 0x8a7ad8, hemiGround: 0x100a1e, hemi: 1.15, fill: 0xd8c8ff,
  frame: 0x1a1230, panel: 0x150d2a, shade: 0x2a1a44, fascia: 0x0a0618, cord: 0x0a0618, door: 0x2c3566, plank: 0x3a2f55, above: "#0c0728",
  lamp: "ring", bulbs: null, skirt: false, doorway: "door",
  neon: [0xff5fb0, 0x4fe3ff, 0xffd45c, 0x8f7bff, 0x7fe08a, 0xff8a5c],
  words: {
    led: true,
    neon: true,
    vars: {
      "--accent": "#ff5fb0", "--accent-rgb": "255, 95, 176", "--plate": "rgba(16, 9, 38, .92)", "--plate-line": "rgba(255, 95, 176, .6)",
      "--ink": "#fff0fa", "--soft": "#d3b6d9", "--dim": "#9a82a8",
      "--title": '"Nunito", system-ui, sans-serif', "--title-w": "900",
    },
  },
  wall(g, w, h, k) {
    const horizon = h - 1.25 * k;
    fade(g, w, h, [[0, "#0c0728"], [0.55, "#2c1458"], [0.85, "#7a2a68"], [1, "#c2496a"]], 0, horizon);
    stars(g, w, horizon * 0.45, 150, 23);
    // Two rows of buildings with lit windows.
    const rnd = seeded(31);
    for (const [tone, lo, hi, lit] of [
      ["#1b1140", 2.4, 5.0, 0.3],
      ["#0e0926", 1.5, 3.9, 0.42],
    ]) {
      for (let x = -30; x < w; ) {
        const bw = (0.7 + rnd() * 1.1) * k;
        const bh = (lo + rnd() * (hi - lo)) * k;
        g.fillStyle = tone;
        g.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 16; wy < horizon - 14; wy += 26)
          for (let wx = x + 12; wx < x + bw - 16; wx += 22) {
            if (rnd() > lit) continue;
            g.fillStyle = rnd() > 0.75 ? "rgba(120,225,255,.7)" : "rgba(255,206,120,.75)";
            g.fillRect(wx, wy, 9, 12);
          }
        x += bw + rnd() * 10;
      }
    }
    // The brick parapet at the roof's edge.
    g.fillStyle = "#3a2836";
    g.fillRect(0, horizon, w, h - horizon);
    for (let y = horizon, r = 0; y < h; y += 0.11 * k, r++) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(0, y, w, 2);
      for (let x = (r % 2) * 0.17 * k; x < w; x += 0.34 * k) g.fillRect(x, y, 2, 0.11 * k);
    }
    g.fillStyle = "#6a5670";
    g.fillRect(0, horizon - 4, w, 0.1 * k);
    g.fillStyle = "rgba(255,95,176,.35)";
    g.fillRect(0, horizon - 7, w, 3);
    speckle(g, w, h, 5000, 0.04);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#262330";
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 1.2 * k) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(x, 0, 3, h);
    }
    for (let y = 0; y < h; y += 1.2 * k) {
      g.fillStyle = "rgba(0,0,0,.4)";
      g.fillRect(0, y, w, 3);
    }
    // Wet patches that pick up the neon.
    const rnd = seeded(9);
    for (let i = 0; i < 16; i++) {
      const rx = (0.4 + rnd() * 0.9) * k;
      glow(g, rnd() * w, rnd() * h, rx, i % 2 ? "255,110,190" : "110,220,255", 0.16, 0.25 + rnd() * 0.2);
    }
    speckle(g, w, h, 14000, 0.07);
  },
};

const camp = {
  name: "The campfire",
  line: "A clearing in the pines: the games hang between the trunks, paper lanterns on a rope from tree to tree, a tent for a door, fireflies, an owl, and a fire you should not stand too near.",
  live: true,
  rope: true,
  life: [
    { kind: "feature", is: "campfire" },
    { kind: "drift", count: 26, area: [-6.8, 6.8, 0.5, 4.2], colour: 0xd8ff78, size: 0.13 },
    { kind: "flyby", name: "owl.pass", sprite: "owl", size: [1.0, 0.62], px: [224, 140], every: 43, lasts: 7, y: [5.2, 6.3], bob: 0.1, arc: -0.4, fps: 4 },
    SHOOTING_STAR,
  ],
  happens: [
    "The fire is under the Tonight board: it flickers, throws sparks and lights the pieces near it.",
    "Stand right in front of the fire for a second and your piece gets toasty: it yelps, smokes and goes sooty, and the soot wears off once you walk away. It is only a look; nothing about the vote changes.",
    "An owl flies over, under once a minute. A star falls. Fireflies drift about.",
    "The lanterns swing on their rope if you jump under them.",
  ],
  sounds: { ...COMMON_SOUNDS, "(always)": "the fire crackling, crickets", "fire.toasty": "a sizzle and a yelp", "owl.pass": "two hoots and soft wingbeats", "star.fall": "a tiny chime" },
  dust: 0x3a3424,
  light: 0xffc98a, accent: 0xff9d4a, hemiSky: 0x6f8fb0, hemiGround: 0x0a120a, hemi: 1.0, fill: 0xbfd2e6,
  frame: 0x5a3f26, panel: 0x1a140c, shade: 0xff9d4a, fascia: 0x070d0a, cord: 0x3a2a18, door: 0x000000, plank: 0x5a3f26, above: "#050d1c",
  lamp: "lantern", bulbs: null, skirt: false, doorway: "tent",
  words: {
    vars: {
      "--accent": "#ff9d4a", "--accent-rgb": "255, 157, 74", "--plate": "rgba(20, 16, 10, .94)", "--plate-line": "rgba(255, 190, 130, .36)",
      "--ink": "#fff1dc", "--soft": "#d6c2a2", "--dim": "#a08e72",
      "--sign-bg": "#4f3722", "--sign-line": "#7a5a38", "--sign-border": "2", "--sign-radius": "4",
    },
  },
  wall(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#050d1c"], [0.5, "#0b2230"], [1, "#0f2a1e"]]);
    stars(g, w, h * 0.4, 170, 41);
    const rnd = seeded(17);
    const pines = (tone, lo, hi, step) => {
      for (let x = -40; x < w + 40; x += step * k * (0.7 + rnd() * 0.6)) {
        const ph = (lo + rnd() * (hi - lo)) * k;
        const pw = ph * 0.3;
        g.fillStyle = tone;
        for (let t = 0; t < 4; t++) {
          const y0 = h - ph + t * ph * 0.2;
          const half = pw * (0.35 + t * 0.22);
          g.beginPath();
          g.moveTo(x, y0);
          g.lineTo(x + half, y0 + ph * 0.34);
          g.lineTo(x - half, y0 + ph * 0.34);
          g.fill();
        }
        g.fillRect(x - 5, h - ph * 0.3, 10, ph * 0.3);
      }
    };
    pines("#0c2a2a", 3.0, 4.6, 0.8);
    pines("#081c1a", 3.6, 5.8, 1.5);
    // Mist low between the trees.
    fade(g, w, h, [[0, "rgba(120,170,160,0)"], [1, "rgba(120,170,160,.16)"]], h - 1.8 * k, h);
    if (!side) {
      // The near trunks the boxes are strung between.
      for (const xm of L.gaps) {
        const x = (xm + L.wallW / 2) * k;
        const tw = 0.3 * k;
        const bark = g.createLinearGradient(x - tw / 2, 0, x + tw / 2, 0);
        bark.addColorStop(0, "#1c120b");
        bark.addColorStop(0.5, "#3a281a");
        bark.addColorStop(1, "#150d08");
        g.fillStyle = bark;
        g.fillRect(x - tw / 2, 0, tw, h);
        for (let y = 10; y < h; y += 34) {
          g.fillStyle = "rgba(0,0,0,.35)";
          g.fillRect(x - tw / 2 + ((y * 7) % 20), y, 3, 20);
        }
      }
      // The tent latecomers crawl out of.
      const tx = (L.doorX + L.wallW / 2) * k;
      const half = 1.2 * k;
      const apex = h - 2.45 * k;
      g.fillStyle = "#c4672d";
      g.beginPath();
      g.moveTo(tx, apex);
      g.lineTo(tx + half, h);
      g.lineTo(tx - half, h);
      g.fill();
      g.fillStyle = "rgba(0,0,0,.28)";
      g.beginPath();
      g.moveTo(tx, apex);
      g.lineTo(tx + half, h);
      g.lineTo(tx, h);
      g.fill();
      const inside = g.createLinearGradient(0, h - 1.9 * k, 0, h);
      inside.addColorStop(0, "#3a1c08");
      inside.addColorStop(1, "#ffb45c");
      g.fillStyle = inside;
      g.beginPath();
      g.moveTo(tx, h - 1.95 * k);
      g.lineTo(tx + 0.5 * k, h);
      g.lineTo(tx - 0.5 * k, h);
      g.fill();
      g.strokeStyle = "#f2c9a0";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(tx - half, h);
      g.lineTo(tx, apex);
      g.lineTo(tx + half, h);
      g.stroke();
    }
    // Fireflies.
    for (let i = 0; i < 46; i++) glow(g, rnd() * w, h - (0.4 + rnd() * 3.4) * k, 9 + rnd() * 8, "220,255,130", 0.95);
    speckle(g, w, h, 5000, 0.04);
  },
  floor(g, w, h, k, side, L) {
    g.fillStyle = "#1d2c1a";
    g.fillRect(0, 0, w, h);
    // The trodden path the lights fall on.
    const y0 = (L.walkZ - 1.3 - L.zBack) * k;
    const y1 = (L.walkZ + 1.4 - L.zBack) * k;
    fade(g, w, h, [[0, "rgba(72,56,38,0)"], [0.2, "rgba(72,56,38,.95)"], [0.8, "rgba(72,56,38,.95)"], [1, "rgba(72,56,38,0)"]], y0, y1);
    const rnd = seeded(3);
    for (let i = 0; i < 5200; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const onPath = y > y0 + 40 && y < y1 - 40;
      if (onPath && rnd() > 0.12) continue;
      g.strokeStyle = `rgba(${90 + rnd() * 60},${150 + rnd() * 60},${80 + rnd() * 30},${0.2 + rnd() * 0.3})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 8, y - 6 - rnd() * 9);
      g.stroke();
    }
    speckle(g, w, h, 14000, 0.09);
  },
};

// ---------------------------------------------------------------- concepts (stills only)

const arcade = {
  name: "The arcade",
  line: "1986, after closing: every game is a cabinet with a glowing marquee, the carpet is that carpet and lights up where you tread, and the claw machine in the corner can be persuaded.",
  live: true,
  life: [
    { kind: "feature", is: "claw" },
    { kind: "trail", colours: [0xff4fd8, 0x35e8ff, 0xffe14f, 0x7dff6a], size: 0.19, fade: 1.3 },
    { kind: "twinkle", count: 36, area: [-7, 7, 5.5, 6.7], size: [0.3, 0.3], glow: true, colours: [0xff4fd8, 0x35e8ff, 0xffe14f], period: [0.6, 2.2], lit: 0.35 },
    { kind: "flyby", name: "pawn.run", sprite: "bug", size: [0.3, 0.3], px: [64, 64], every: 33, lasts: 10, y: [0.2, 0.2], depth: "rail", fps: 7, glow: true },
  ],
  happens: [
    "The carpet lights up under your feet as you walk, in the colours of the cabinets, and fades behind you.",
    "The claw in the machine under the Tonight board wanders about. Bump someone next to it, or land a jump beside it, and the claw drops and prizes fall out.",
    "Lights blink along the top of the wall, and every half minute a little pixel pawn runs along the skirting.",
  ],
  sounds: { ...COMMON_SOUNDS, "(always)": "a room of machines idling: hum, and attract-mode bleeps", "claw.drop": "a motor whine, a clunk and a prize jingle", "pawn.run": "eight fast square-wave blips" },
  dust: 0x4a3a7a,
  light: 0xd9c8ff, accent: 0xff4fd8, hemiSky: 0x7a5ad8, hemiGround: 0x0a0618, hemi: 1.1, fill: 0xc8b8ff,
  frame: 0x0c0a16, panel: 0x05040c, shade: 0x1a1430, fascia: 0x07040f, cord: 0x05040c, door: 0x1a1430, plank: 0x2a2148, above: "#07040f",
  lamp: "tube", bulbs: null, skirt: false, doorway: "none",
  neon: [0xff4fd8, 0x35e8ff, 0xffe14f, 0x7dff6a, 0xff7a3a, 0x9a7bff],
  words: {
    led: true,
    neon: true,
    vars: {
      "--accent": "#ff4fd8", "--accent-rgb": "255, 79, 216", "--plate": "rgba(10, 6, 24, .94)", "--plate-line": "rgba(53, 232, 255, .55)",
      "--ink": "#f6efff", "--soft": "#b9a8de", "--dim": "#8a7ab0",
      "--title": 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', "--title-w": "800", "--title-size": "0.74", "--title-case": "uppercase", "--title-space": ".02em",
    },
  },
  wall(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#07040f"], [0.6, "#150a2e"], [1, "#1c0d3a"]]);
    // A grid of neon triangles and squiggles, as on the wallpaper of the time.
    const rnd = seeded(86);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w;
      const y = rnd() * (h - 1.4 * k);
      const s = (0.12 + rnd() * 0.16) * k;
      g.strokeStyle = ["rgba(255,79,216,.28)", "rgba(53,232,255,.26)", "rgba(255,225,79,.22)"][i % 3];
      g.lineWidth = 3;
      g.beginPath();
      if (i % 3 === 0) {
        g.moveTo(x, y - s);
        g.lineTo(x + s, y + s * 0.7);
        g.lineTo(x - s, y + s * 0.7);
        g.closePath();
      } else if (i % 3 === 1) {
        for (let t = 0; t <= 4; t++) g.lineTo(x + (t - 2) * s * 0.5, y + (t % 2 ? -s * 0.35 : s * 0.35));
      } else g.arc(x, y, s * 0.6, 0, 7);
      g.stroke();
    }
    if (!side) {
      // Each box is the screen of a cabinet: a lit marquee over it, a control deck under its sign, a body down to the floor.
      L.xs.forEach((xm, i) => {
        const x = (xm + L.wallW / 2) * k;
        const half = (L.bw / 2 + 0.2) * k;
        const top = h - (L.by + L.bh / 2 + 0.62) * k;
        const col = ["255,79,216", "53,232,255", "255,225,79", "125,255,106", "255,122,58", "154,123,255"][i % 6];
        g.fillStyle = "#0b0816";
        g.beginPath();
        g.roundRect(x - half, top, half * 2, h - top, [0.16 * k, 0.16 * k, 0, 0]);
        g.fill();
        g.fillStyle = `rgba(${col},.14)`;
        g.fillRect(x - half, top, 0.07 * k, h - top);
        g.fillRect(x + half - 0.07 * k, top, 0.07 * k, h - top);
        // The marquee.
        glow(g, x, top + 0.26 * k, half * 1.5, col, 0.3, 0.45);
        g.fillStyle = `rgba(${col},.92)`;
        g.beginPath();
        g.roundRect(x - half + 0.1 * k, top + 0.09 * k, half * 2 - 0.2 * k, 0.34 * k, 0.05 * k);
        g.fill();
        g.fillStyle = "rgba(10,6,24,.82)";
        for (let s = -3; s <= 3; s++) g.fillRect(x + s * half * 0.24 - 0.03 * k, top + 0.18 * k, 0.06 * k, 0.16 * k);
        // The control deck: a stick and three buttons.
        const deck = h - 1.2 * k;
        g.fillStyle = "#1b1532";
        g.beginPath();
        g.moveTo(x - half, deck);
        g.lineTo(x + half, deck);
        g.lineTo(x + half - 0.06 * k, deck + 0.3 * k);
        g.lineTo(x - half + 0.06 * k, deck + 0.3 * k);
        g.fill();
        g.fillStyle = "#e9e4f5";
        g.fillRect(x - half * 0.55 - 3, deck + 0.02 * k, 6, 0.14 * k);
        g.fillStyle = "#ff3b4e";
        g.beginPath();
        g.arc(x - half * 0.55, deck + 0.02 * k, 0.06 * k, 0, 7);
        g.fill();
        ["255,225,79", "53,232,255", "255,79,216"].forEach((c, b) => {
          g.fillStyle = `rgb(${c})`;
          g.beginPath();
          g.arc(x + half * (0.05 + b * 0.27), deck + 0.14 * k, 0.05 * k, 0, 7);
          g.fill();
        });
        // The coin door.
        g.fillStyle = "#05040c";
        g.fillRect(x - 0.2 * k, h - 0.66 * k, 0.4 * k, 0.42 * k);
        g.fillStyle = `rgba(${col},.85)`;
        g.fillRect(x - 0.03 * k, h - 0.56 * k, 0.06 * k, 0.12 * k);
      });
      // The way out: a lit EXIT over a dark doorway.
      const dx = (L.doorX + L.wallW / 2) * k;
      g.fillStyle = "#04030a";
      g.fillRect(dx - 0.5 * k, h - 2.2 * k, k, 2.2 * k);
      glow(g, dx, h - 2.42 * k, 0.7 * k, "125,255,106", 0.35, 0.5);
      g.fillStyle = "#7dff6a";
      g.font = `800 ${0.2 * k}px ui-monospace, Menlo, Consolas, monospace`;
      g.textAlign = "center";
      g.fillText("EXIT", dx, h - 2.34 * k);
    }
    g.fillStyle = "rgba(255,79,216,.8)";
    g.fillRect(0, h - 0.06 * k, w, 0.03 * k);
    speckle(g, w, h, 5000, 0.04);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#120a26";
    g.fillRect(0, 0, w, h);
    // That carpet: confetti shapes on dark purple.
    const rnd = seeded(1986);
    const cols = ["#ff4fd8", "#35e8ff", "#ffe14f", "#7dff6a", "#ff7a3a"];
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const s = (0.05 + rnd() * 0.08) * k;
      g.save();
      g.translate(x, y);
      g.rotate(rnd() * 6.3);
      g.globalAlpha = 0.5 + rnd() * 0.3;
      g.strokeStyle = g.fillStyle = cols[i % 5];
      g.lineWidth = 4;
      g.beginPath();
      if (i % 4 === 0) g.fillRect(-s / 2, -s / 2, s, s * 0.4);
      else if (i % 4 === 1) {
        g.moveTo(0, -s);
        g.lineTo(s * 0.8, s * 0.6);
        g.lineTo(-s * 0.8, s * 0.6);
        g.fill();
      } else if (i % 4 === 2) {
        g.arc(0, 0, s * 0.7, 0, 4);
        g.stroke();
      } else {
        for (let t = 0; t <= 3; t++) g.lineTo((t - 1.5) * s * 0.6, t % 2 ? -s * 0.4 : s * 0.4);
        g.stroke();
      }
      g.restore();
    }
    speckle(g, w, h, 12000, 0.06);
  },
};

const submarine = {
  name: "The submarine",
  line: "Riveted steel and brass a long way down: a big porthole on the sea, small ones between the games, light moving on the deck, and things swimming past that are bigger than the boat.",
  live: false,
  life: [
    {
      kind: "outside",
      layers: [
        {
          speed: -0.1,
          paint(g, w, h, k) {
            fade(g, w, h, [[0, "#0d5a66"], [0.5, "#083a48"], [1, "#04202a"]]);
            // Shafts of light from the surface, and weed on the sea bed.
            for (let i = 0; i < 9; i++) {
              const x = (i / 9) * w + 40;
              const shaft = g.createLinearGradient(0, 0, 0, h * 0.8);
              shaft.addColorStop(0, "rgba(160,255,230,.2)");
              shaft.addColorStop(1, "rgba(160,255,230,0)");
              g.fillStyle = shaft;
              g.beginPath();
              g.moveTo(x, 0);
              g.lineTo(x + 0.5 * k, 0);
              g.lineTo(x + 1.5 * k, h * 0.8);
              g.lineTo(x + 0.7 * k, h * 0.8);
              g.fill();
            }
            const rnd = seeded(12);
            g.fillStyle = "#031a20";
            g.beginPath();
            g.moveTo(0, h);
            for (let x = 0; x <= w; x += w / 24) g.lineTo(x, h - (0.35 + 0.3 * Math.sin((x / w) * Math.PI * 6) + rnd() * 0.12) * k);
            g.lineTo(w, h);
            g.fill();
            for (let i = 0; i < 46; i++) {
              const x = rnd() * w;
              const tall = (0.5 + rnd() * 1.1) * k;
              g.strokeStyle = `rgba(20,${90 + rnd() * 60},80,.8)`;
              g.lineWidth = 0.05 * k;
              g.beginPath();
              g.moveTo(x, h - 0.3 * k);
              g.bezierCurveTo(x - 0.2 * k, h - tall * 0.5, x + 0.25 * k, h - tall * 0.8, x, h - 0.3 * k - tall);
              g.stroke();
            }
          },
        },
        {
          speed: -0.34,
          paint(g, w, h) {
            const rnd = seeded(8);
            for (let i = 0; i < 150; i++) {
              g.strokeStyle = `rgba(200,255,240,${0.2 + rnd() * 0.4})`;
              g.lineWidth = 1.5;
              g.beginPath();
              g.arc(rnd() * w, rnd() * h, 2 + rnd() * 5, 0, 7);
              g.stroke();
            }
          },
        },
      ],
    },
    { kind: "feature", is: "porthole", r: 0.8, y: 1.42 },
    { kind: "caustics", colour: 0x9fffe0 },
    { kind: "flyby", name: "whale.pass", sprite: "whale", size: [4.6, 1.9], px: [512, 212], every: 62, lasts: 18, y: [1.3, 1.9], depth: "outside", bob: 0.02, fps: 1.2, calm: true },
    { kind: "flyby", name: "fish.pass", sprite: "fish", size: [1.9, 1.0], px: [256, 136], every: 29, lasts: 9, y: [1.0, 4.4], depth: "outside", fps: 6 },
    { kind: "flyby", name: "jelly.pass", sprite: "jelly", size: [0.5, 0.75], px: [96, 144], every: 43, lasts: 24, y: [1.1, 4.2], depth: "outside", fps: 1.5, bob: 0.05, arc: 0.6 },
  ],
  happens: [
    "The sea goes slowly by outside the big porthole and the small ones between the games, and its light wanders over the deck.",
    "A whale passes about once a minute. A shoal of fish and a jellyfish pass more often.",
    "Bump someone by the big porthole, or land a jump there, and bubbles go up the glass.",
  ],
  sounds: { ...COMMON_SOUNDS, "whale.pass": "a long whale call through the hull", "fish.pass": "a flurry of tiny taps", "jelly.pass": "nothing, or one soft sonar ping", "porthole.knock": "knuckles on thick glass, then bubbles" },
  dust: 0x35504c,
  light: 0xc8ffe6, accent: 0xffb347, hemiSky: 0x5fa89a, hemiGround: 0x06100f, hemi: 1.05, fill: 0xb8e6d8,
  frame: 0xa9772c, panel: 0x08201f, shade: 0x8a6a2a, fascia: 0x050d0d, cord: 0x1c2a2a, door: 0x35504c, plank: 0x6b5a34, above: "#0a1a1b",
  lamp: "dome", bulbs: null, skirt: false, doorway: "hatch", trim: "bolts",
  words: {
    led: true,
    vars: {
      "--accent": "#ffb347", "--accent-rgb": "255, 179, 71", "--plate": "rgba(8, 24, 24, .94)", "--plate-line": "rgba(255, 190, 110, .5)",
      "--ink": "#eafff6", "--soft": "#a8cdc2", "--dim": "#7a9f96",
      "--title": '"Nunito", system-ui, sans-serif', "--title-w": "900", "--title-size": "0.86", "--title-case": "uppercase", "--title-space": ".03em",
      "--sign-bg": "#b98a3a", "--sign-ink": "#1a1206", "--sign-soft": "#3a2a10", "--sign-line": "#e6c27a", "--sign-radius": "3",
    },
  },
  wall(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#0e2424"], [0.5, "#1c3f3c"], [1, "#16302e"]]);
    // Hull plates and their rivets.
    const plate = 1.42 * k;
    for (let x = 0, i = 0; x < w + plate; x += plate, i++) {
      g.fillStyle = `rgba(160,230,210,${0.02 + (i % 3) * 0.018})`;
      g.fillRect(x, 0, plate - 3, h);
      g.fillStyle = "rgba(0,0,0,.5)";
      g.fillRect(x - 3, 0, 3, h);
      for (let y = 0.2 * k; y < h; y += 0.3 * k) {
        g.fillStyle = "rgba(0,0,0,.45)";
        g.beginPath();
        g.arc(x + 0.09 * k + 1, y + 2, 0.028 * k, 0, 7);
        g.fill();
        g.fillStyle = "rgba(190,240,225,.3)";
        g.beginPath();
        g.arc(x + 0.09 * k, y, 0.026 * k, 0, 7);
        g.fill();
      }
    }
    // Ribs, and the pipes that run the length of the boat.
    for (const [ym, t, tone, hi] of [
      [6.2, 0.16, "#7a5a26", "rgba(255,220,150,.5)"],
      [5.95, 0.07, "#28504c", "rgba(190,240,225,.35)"],
      [0.34, 0.12, "#7a5a26", "rgba(255,220,150,.5)"],
      [0.16, 0.06, "#8c2f24", "rgba(255,190,170,.4)"],
    ]) {
      const y = h - ym * k;
      g.fillStyle = tone;
      g.fillRect(0, y, w, t * k);
      g.fillStyle = hi;
      g.fillRect(0, y + t * k * 0.18, w, t * k * 0.14);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(0, y + t * k, w, 5);
    }
    if (!side) {
      const X = (xm) => (xm + L.wallW / 2) * k;
      // Small portholes between the games, where there is room for one, each with a gauge under it.
      const r = Math.min(0.22, (L.slot - L.bw - 0.5) / 2);
      L.gaps.slice(1, -1).forEach((xm, i) => {
        if (r > 0.08) {
          g.fillStyle = "#a9772c";
          g.beginPath();
          g.arc(X(xm), h - 4.1 * k, (r + 0.06) * k, 0, 7);
          g.fill();
          cut(g, X(xm), h - 4.1 * k, null, null, r * k);
        }
        const [x, y, gr] = [X(xm), h - 3.2 * k, Math.min(0.15, Math.max(0.07, r)) * k];
        g.fillStyle = "#a9772c";
        g.beginPath();
        g.arc(x, y, gr * 1.22, 0, 7);
        g.fill();
        g.fillStyle = "#f1ead6";
        g.beginPath();
        g.arc(x, y, gr, 0, 7);
        g.fill();
        g.strokeStyle = "#c8382c";
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(-0.9 - i) * gr * 0.7, y + Math.sin(-0.9 - i) * gr * 0.7);
        g.stroke();
      });
      // The big porthole under the Tonight board.
      cut(g, X(L.boardX), h - 1.42 * k, null, null, 0.8 * k);
      // The round hatch at the left end, where the door is in other rooms.
      const dx = X(L.doorX);
      const dy = h - 1.18 * k;
      g.fillStyle = "#0a1a1a";
      g.beginPath();
      g.ellipse(dx, dy, 0.62 * k, 1.02 * k, 0, 0, 7);
      g.fill();
      g.fillStyle = "#35504c";
      g.beginPath();
      g.ellipse(dx, dy, 0.52 * k, 0.92 * k, 0, 0, 7);
      g.fill();
      g.strokeStyle = "#a9772c";
      g.lineWidth = 0.07 * k;
      g.beginPath();
      g.ellipse(dx, dy, 0.57 * k, 0.97 * k, 0, 0, 7);
      g.stroke();
      g.lineWidth = 0.035 * k;
      g.beginPath();
      g.arc(dx, dy, 0.22 * k, 0, 7);
      g.stroke();
      for (let a = 0; a < 3; a++) {
        g.beginPath();
        g.moveTo(dx - Math.cos((a * Math.PI) / 3) * 0.22 * k, dy - Math.sin((a * Math.PI) / 3) * 0.22 * k);
        g.lineTo(dx + Math.cos((a * Math.PI) / 3) * 0.22 * k, dy + Math.sin((a * Math.PI) / 3) * 0.22 * k);
        g.stroke();
      }
    }
  },
  floor(g, w, h, k) {
    g.fillStyle = "#1f3432";
    g.fillRect(0, 0, w, h);
    // Deck grating.
    for (let x = 0; x < w; x += 0.12 * k) {
      g.fillStyle = "rgba(0,0,0,.42)";
      g.fillRect(x, 0, 0.05 * k, h);
    }
    for (let y = 0; y < h; y += 0.6 * k) {
      g.fillStyle = "rgba(160,230,210,.16)";
      g.fillRect(0, y, w, 0.05 * k);
      g.fillStyle = "rgba(0,0,0,.5)";
      g.fillRect(0, y + 0.05 * k, w, 4);
    }
    for (let x = 0; x < w; x += 2.4 * k) {
      g.fillStyle = "rgba(169,119,44,.5)";
      g.fillRect(x, 0, 0.06 * k, h);
    }
    speckle(g, w, h, 12000, 0.07);
  },
};

const train = {
  name: "The night train",
  line: "A lounge car at speed: the country streams past one long window behind the pieces and tall ones between the posters, and now and then an express comes the other way.",
  live: false,
  life: [
    {
      kind: "outside",
      layers: [
        {
          speed: -0.8,
          paint(g, w, h, k) {
            fade(g, w, h, [[0, "#070c24"], [0.6, "#1c2a58"], [0.86, "#3a4a7c"], [1, "#1a2440"]]);
            stars(g, w, h * 0.6, 260, 77);
            glow(g, w * 0.3, h - 4.4 * k, 0.5 * k, "255,244,214", 0.9);
            // Far hills, and a few lit farms on them.
            const rnd = seeded(77);
            for (const [tone, base, amp] of [["#141d3c", 1.5, 0.5], ["#0c1228", 0.95, 0.3]]) {
              g.fillStyle = tone;
              g.beginPath();
              g.moveTo(0, h);
              for (let x = 0; x <= w; x += w / 60) g.lineTo(x, h - (base + amp * Math.sin((x / w) * Math.PI * 4) + amp * 0.4 * Math.sin((x / w) * Math.PI * 14)) * k);
              g.lineTo(w, h);
              g.fill();
            }
            for (let i = 0; i < 14; i++) glow(g, rnd() * w, h - (0.7 + rnd() * 0.5) * k, 9, "255,214,140", 0.9);
          },
        },
        {
          speed: -7,
          paint(g, w, h, k) {
            // Near things: trees, and telegraph poles with their wires.
            const rnd = seeded(31);
            for (let i = 0; i < 9; i++) {
              const x = rnd() * w;
              const tall = (2.2 + rnd() * 2.6) * k;
              g.fillStyle = "#05070f";
              g.fillRect(x - 0.06 * k, h - tall * 0.5, 0.12 * k, tall * 0.5);
              g.beginPath();
              g.ellipse(x, h - tall * 0.72, tall * 0.2, tall * 0.34, 0, 0, 7);
              g.fill();
            }
            g.fillStyle = "#05070f";
            g.strokeStyle = "rgba(5,7,15,.9)";
            g.lineWidth = 3;
            for (let x = 0; x < w; x += w / 4) {
              g.fillRect(x, h - 4.6 * k, 0.07 * k, 4.6 * k);
              g.fillRect(x - 0.3 * k, h - 4.4 * k, 0.67 * k, 0.05 * k);
              g.beginPath();
              g.moveTo(x, h - 4.4 * k);
              g.quadraticCurveTo(x + w / 8, h - 3.9 * k, x + w / 4, h - 4.4 * k);
              g.stroke();
            }
            g.fillRect(0, h - 0.5 * k, w, 0.5 * k);
          },
        },
      ],
    },
    { kind: "flyby", name: "express.pass", sprite: "express", size: [19, 0.72], px: [1024, 40], every: 44, lasts: 2.6, y: [0.86, 0.86], depth: "outside", dir: 1 },
  ],
  happens: [
    "The country goes by outside: far hills slowly, trees and telegraph poles fast, through the long window behind the pieces and the tall ones between the posters.",
    "Under once a minute an express passes the other way, a streak of lit windows.",
    "Jump under a lamp and it swings.",
  ],
  sounds: { ...COMMON_SOUNDS, "express.pass": "a rush, a horn dropping in pitch, and the windows rattling", "(always)": "wheels on rail joints, low" },
  light: 0xffe2b0, accent: 0xe8b04a, hemiSky: 0x9a8a72, hemiGround: 0x120c08, hemi: 1.0, fill: 0xffdcb8,
  frame: 0x8a6a2a, panel: 0x1c120c, shade: 0xe8d3a0, fascia: 0x0d0806, cord: 0x8a6a2a, door: 0x5a2f22, plank: 0x8a6a2a, above: "#1a110c",
  lamp: "globe", bulbs: null, skirt: true, doorway: "door",
  words: {
    vars: {
      "--accent": "#e8b04a", "--accent-rgb": "232, 176, 74", "--plate": "rgba(28, 17, 12, .94)", "--plate-line": "rgba(232, 176, 74, .5)",
      "--ink": "#fff1d8", "--soft": "#d8c09a", "--dim": "#a48f6c",
      "--sign-bg": "#efe2c4", "--sign-ink": "#3a1410", "--sign-soft": "#5a4030", "--sign-line": "#c9a25a", "--sign-radius": "3",
    },
  },
  wall(g, w, h, k, side, L) {
    // Walnut panelling, a curved cream ceiling at the very top.
    fade(g, w, h, [[0, "#3a2a1c"], [0.08, "#4a2c1a"], [1, "#3a2114"]]);
    fade(g, w, h, [[0, "#d9c9a4"], [1, "#8a7650"]], 0, h - 6.25 * k);
    g.fillStyle = "#8a6a2a";
    g.fillRect(0, h - 6.25 * k, w, 0.06 * k);
    for (let x = 0, i = 0; x < w; x += 0.71 * k, i++) {
      g.fillStyle = `rgba(255,190,130,${0.02 + (i % 3) * 0.015})`;
      g.fillRect(x, h - 6.19 * k, 0.71 * k - 3, 6.19 * k);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(x - 3, h - 6.19 * k, 3, 6.19 * k);
    }
    if (!side) {
      const X = (xm) => (xm + L.wallW / 2) * k;
      // Tall windows in the gaps between the posters.
      const ww = Math.max(0.2, L.slot - L.bw - 0.5) * k;
      for (const xm of L.gaps) {
        const [top, bottom] = [h - 5.05 * k, h - 2.7 * k];
        g.fillStyle = "#8a6a2a";
        g.beginPath();
        g.roundRect(X(xm) - ww / 2 - 0.04 * k, top - 0.04 * k, ww + 0.08 * k, bottom - top + 0.08 * k, 0.12 * k);
        g.fill();
        cut(g, X(xm) - ww / 2, top, ww, bottom - top, 0.1 * k);
      }
      // One long window behind the pieces, in brass, with a bar every pane.
      const [top, bottom] = [h - 1.62 * k, h - 0.46 * k];
      g.fillStyle = "#8a6a2a";
      g.fillRect(0.2 * k, top - 0.06 * k, w - 0.4 * k, bottom - top + 0.12 * k);
      cut(g, 0.26 * k, top, w - 0.52 * k, bottom - top, 0.06 * k);
      g.fillStyle = "#8a6a2a";
      for (let x = (w / 2) % (2.13 * k); x < w; x += 2.13 * k) g.fillRect(x - 0.03 * k, top, 0.06 * k, bottom - top);
      // The luggage rack: a brass rail over everything, with a case and a hat box on it.
      const rack = h - 5.52 * k;
      g.fillStyle = "#b08a3a";
      g.fillRect(0.3 * k, rack, w - 0.6 * k, 0.045 * k);
      g.fillRect(0.3 * k, rack + 0.14 * k, w - 0.6 * k, 0.03 * k);
      for (let x = 0.3 * k; x < w; x += 1.1 * k) g.fillRect(x, rack, 0.03 * k, 0.17 * k);
      for (const [xm, bw, bh, tone] of [
        [L.gaps[1] ?? 0, 0.9, 0.36, "#6a3a22"],
        [L.gaps[L.gaps.length - 2] ?? 0, 0.7, 0.3, "#2f4a3a"],
      ]) {
        g.fillStyle = tone;
        g.beginPath();
        g.roundRect(X(xm) - (bw * k) / 2, rack - bh * k, bw * k, bh * k, 0.05 * k);
        g.fill();
        g.fillStyle = "rgba(232,176,74,.8)";
        g.fillRect(X(xm) - (bw * k) / 2 + 0.1 * k, rack - bh * k, 0.04 * k, bh * k);
        g.fillRect(X(xm) + (bw * k) / 2 - 0.14 * k, rack - bh * k, 0.04 * k, bh * k);
      }
    }
    // Buttoned green plush along the foot of the wall: the back of the long seat.
    const seat = h - 0.4 * k;
    fade(g, w, h, [[0, "#1f4a3a"], [1, "#12301f"]], seat, h);
    for (let x = 0.18 * k; x < w; x += 0.36 * k) {
      g.fillStyle = "rgba(232,176,74,.65)";
      g.beginPath();
      g.arc(x, seat + 0.2 * k, 0.02 * k, 0, 7);
      g.fill();
    }
  },
  floor(g, w, h, k, side, L) {
    planks(g, w, h, k, 0.2, "#3f2a1c", "255,205,150");
    // A carpet runner down the aisle, under the lights.
    const y0 = (L.walkZ - 0.95 - L.zBack) * k;
    const y1 = (L.walkZ + 1.05 - L.zBack) * k;
    g.fillStyle = "#6a1f24";
    g.fillRect(0, y0, w, y1 - y0);
    g.fillStyle = "#c9a25a";
    g.fillRect(0, y0 + 0.1 * k, w, 0.04 * k);
    g.fillRect(0, y1 - 0.14 * k, w, 0.04 * k);
    for (let x = 0.4 * k; x < w; x += 0.8 * k) {
      g.fillStyle = "rgba(201,162,90,.4)";
      g.beginPath();
      g.moveTo(x, (y0 + y1) / 2 - 0.3 * k);
      g.lineTo(x + 0.22 * k, (y0 + y1) / 2);
      g.lineTo(x, (y0 + y1) / 2 + 0.3 * k);
      g.lineTo(x - 0.22 * k, (y0 + y1) / 2);
      g.fill();
    }
    speckle(g, w, h, 12000, 0.07);
  },
};

const ship = {
  name: "The star lounge",
  line: "The observation deck of a slow ship: the whole wall is a window and the universe goes by it, with a ringed planet, comets, passing traffic, and a chart table that does not like being bumped.",
  live: true,
  life: [
    {
      kind: "outside",
      layers: [
        {
          speed: -0.07,
          paint(g, w, h, k) {
            fade(g, w, h, [[0, "#02030a"], [0.6, "#070b20"], [1, "#0d1230"]]);
            // Far gas clouds, and the faint stars.
            for (const [x, y, r, rgb, a] of [[0.14, 4.6, 2.8, "120,90,220", 0.24], [0.3, 3.6, 2.0, "70,170,230", 0.17], [0.62, 5.2, 2.4, "220,90,160", 0.13], [0.84, 3.0, 2.6, "60,120,220", 0.18]]) {
              glow(g, w * x, h - y * k, r * k, rgb, a, 0.55);
              glow(g, w * x - w, h - y * k, r * k, rgb, a, 0.55);
              glow(g, w * x + w, h - y * k, r * k, rgb, a, 0.55);
            }
            stars(g, w, h, 520, 61);
          },
        },
        {
          speed: -0.2,
          paint(g, w, h) {
            // The near stars: fewer, brighter, some with colour.
            const rnd = seeded(19);
            for (let i = 0; i < 70; i++) glow(g, rnd() * w, rnd() * h, 3 + rnd() * 6, ["255,255,255", "190,220,255", "255,226,190"][i % 3], 0.95);
          },
        },
      ],
    },
    { kind: "feature", is: "holo" },
    { kind: "twinkle", count: 15, at: [-7.1, -3.55, 0, 3.55, 7.1].flatMap((x) => [[x, 6.45], [x, 4.3], [x, 2.4]]), area: [0, 0, 0, 0], size: [0.22, 0.22], glow: true, colours: [0xff5a5a, 0x6ee7ff], period: [0.8, 2.4], lit: 0.4, z: -2.45 },
    { kind: "pulse", flat: true, colour: 0x6ee7ff, speed: 1.3, strips: [{ x: 0, y: 0.006, z: -0.65, w: 14.2, d: 0.5 }, { x: 0, y: 0.006, z: 1.9, w: 14.2, d: 0.5 }] },
    { kind: "trail", colours: [0x6ee7ff, 0x9d8bff, 0x7dffb8], size: 0.19, fade: 1.5 },
    { kind: "flyby", name: "planet.rise", sprite: "planet", size: [9, 5.4], px: [1000, 600], every: 150, lasts: 130, y: [3.1, 3.9], depth: "outside", dir: -1, calm: true },
    { kind: "flyby", name: "moon.pass", sprite: "moon", size: [1.2, 1.2], px: [200, 200], every: 86, lasts: 58, y: [4.6, 6.0], depth: "outside", dir: -1, calm: true },
    { kind: "flyby", name: "comet.pass", sprite: "comet", size: [3.4, 0.5], px: [512, 76], every: 47, lasts: 6.5, y: [4.9, 6.3], depth: "outside", fall: -1.6, tilt: -0.12, glow: true },
    { ...SHOOTING_STAR, depth: "outside", every: 21, y: [3.2, 6.5] },
    { kind: "flyby", name: "rocket.pass", sprite: "rocket", size: [1.3, 0.56], px: [256, 110], every: 71, lasts: 10, y: [2.9, 6.2], depth: "outside", bob: 0.03, fps: 12 },
    { kind: "flyby", name: "saucer.pass", sprite: "saucer", size: [1.2, 0.6], px: [256, 128], every: 113, lasts: 9, y: [3.0, 6.2], depth: "outside", bob: 0.16, arc: 0.7, fps: 5 },
    { kind: "flyby", name: "rocks.drift", sprite: "rocks", size: [3.6, 1.1], px: [512, 156], every: 131, lasts: 26, y: [2.8, 6.0], depth: "outside", dir: -1, calm: true },
    { kind: "flyby", name: "satellite.pass", sprite: "satellite", size: [0.9, 0.34], px: [192, 72], every: 59, lasts: 17, y: [5.6, 6.4], depth: "outside", dir: -1, tilt: 0.2, fps: 1.5 },
  ],
  happens: [
    "The whole wall is a window and the stars slide past it, the near ones faster than the far ones.",
    "A ringed planet rises slowly across the window and takes two minutes to go by. A small blue moon does the same.",
    "Comets and shooting stars cross every half minute or so. A rocket, a saucer, a satellite and a drift of rocks come past now and then.",
    "The floor lights up under your feet as you walk, and fades behind you.",
    "The chart table under the Tonight board is a globe of light. Bump someone next to it, or land a jump beside it, and it spins up, turns pink and throws sparks.",
    "The lamps swing if you jump under them, and the lights on the window ribs blink.",
  ],
  sounds: {
    ...COMMON_SOUNDS,
    "(always)": "a low engine hum",
    "holo.spin": "a rising electric whirr and a glitch",
    "comet.pass": "a soft shimmer",
    "star.fall": "a tiny chime",
    "rocket.pass": "a muffled whoosh",
    "saucer.pass": "a wobbling theremin note",
    "planet.rise": "a slow, wide chord",
    "satellite.pass": "three beeps",
  },
  dust: 0x8fa0c0,
  light: 0xcfe8ff, accent: 0x6ee7ff, hemiSky: 0x7fa8ff, hemiGround: 0x05070f, hemi: 1.2, fill: 0xc4d8ff,
  frame: 0xdfe8f5, panel: 0x05070f, shade: 0xe8eef8, fascia: 0x04060c, cord: 0x9fb4d0, door: 0xb9c6da, plank: 0xb9c6da, above: "#04060c",
  lamp: "ring", bulbs: null, skirt: true, doorway: "none",
  neon: [0x6ee7ff, 0x9d8bff, 0x7dffb8, 0xffc76e, 0xff8fd0, 0x6ea8ff],
  words: {
    led: true,
    neon: true,
    vars: {
      "--accent": "#6ee7ff", "--accent-rgb": "110, 231, 255", "--plate": "rgba(6, 10, 22, .9)", "--plate-line": "rgba(110, 231, 255, .6)",
      "--ink": "#f0f8ff", "--soft": "#a9c0dc", "--dim": "#7b90ac",
      "--title": 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', "--title-w": "300", "--title-size": "0.82", "--title-case": "uppercase", "--title-space": ".12em",
    },
  },
  wall(g, w, h, k, side, L) {
    if (side) {
      // The end walls are hull: pale panels, with one small window each.
      fade(g, w, h, [[0, "#aab8ce"], [1, "#56647e"]]);
      for (let x = 0; x < w; x += 1.1 * k) {
        g.fillStyle = "rgba(0,0,0,.2)";
        g.fillRect(x, 0, 3, h);
      }
      g.fillStyle = "#04060c";
      g.beginPath();
      g.roundRect(w * 0.3, h - 5.4 * k, w * 0.4, 2.6 * k, 0.3 * k);
      g.fill();
      stars(g, w * 0.4, h - 2.9 * k, 30, 3, h - 5.3 * k);
      return;
    }
    // Everything above the sill is window. The frame: white ribs, a band along the top, and the sill.
    g.clearRect(0, 0, w, h);
    for (let x = (w / 2) % (3.55 * k) - 3.55 * k; x < w + k; x += 3.55 * k) {
      const rib = g.createLinearGradient(x - 0.11 * k, 0, x + 0.11 * k, 0);
      rib.addColorStop(0, "#8a98b0");
      rib.addColorStop(0.4, "#eef3fb");
      rib.addColorStop(1, "#6a7890");
      g.fillStyle = rib;
      g.fillRect(x - 0.11 * k, 0, 0.22 * k, h);
    }
    const sill = h - 1.25 * k;
    fade(g, w, h, [[0, "#e4ebf6"], [0.12, "#aab8ce"], [1, "#56647e"]], sill, h);
    for (let x = 0; x < w; x += 1.775 * k) {
      g.fillStyle = "rgba(0,0,0,.22)";
      g.fillRect(x, sill + 0.14 * k, 3, h - sill);
    }
    g.fillStyle = "#6ee7ff";
    g.fillRect(0, sill + 0.08 * k, w, 0.035 * k);
    glow(g, w / 2, sill + 0.1 * k, w * 0.6, "110,231,255", 0.2, 0.05);
    fade(g, w, h, [[0, "#cfd8e8"], [1, "#7c8aa4"]], 0, h - 6.3 * k);
    // A panel in the sill under the Tonight board, where the chart table plugs in.
    g.fillStyle = "#0a1022";
    g.beginPath();
    g.roundRect((L.boardX + L.wallW / 2 - 0.7) * k, sill + 0.3 * k, 1.4 * k, 0.5 * k, 0.06 * k);
    g.fill();
    for (let i = 0; i < 5; i++) {
      g.fillStyle = ["#6ee7ff", "#7dffb8", "#ffc76e", "#ff8fd0", "#9d8bff"][i];
      g.fillRect((L.boardX + L.wallW / 2 - 0.56 + i * 0.25) * k, sill + 0.44 * k, 0.12 * k, 0.07 * k);
    }
  },
  floor(g, w, h, k, side, L) {
    fade(g, w, h, [[0, "#39435a"], [1, "#222a3c"]]);
    // Hexagonal deck plates, and a lit strip either side of where you walk.
    const s = 0.42 * k;
    g.strokeStyle = "rgba(190,215,255,.16)";
    g.lineWidth = 2.5;
    for (let row = 0, y = 0; y < h + s; y += s * 0.87, row++)
      for (let x = (row % 2) * s * 1.5; x < w + s; x += s * 3) {
        g.beginPath();
        for (let a = 0; a < 6; a++) g.lineTo(x + Math.cos((a * Math.PI) / 3) * s, y + Math.sin((a * Math.PI) / 3) * s * 0.87);
        g.closePath();
        g.stroke();
      }
    for (const z of [L.walkZ - 1.25, L.walkZ + 1.3]) {
      const y = (z - L.zBack) * k;
      glow(g, w / 2, y, w * 0.6, "110,231,255", 0.22, 0.03);
      g.fillStyle = "rgba(110,231,255,.9)";
      g.fillRect(0, y - 2, w, 4);
    }
    speckle(g, w, h, 10000, 0.05);
  },
};

const alley = {
  name: "The lantern alley",
  line: "A back street of little bars after rain: red paper lanterns, lit paper screens, blue door curtains, wet stone, and a food stall steaming under the Tonight board.",
  live: false,
  life: [
    { kind: "feature", is: "stall" },
    { kind: "flyby", name: "cat.walk", sprite: "cat", size: [0.78, 0.44], px: [192, 108], every: 52, lasts: 15, y: [0.24, 0.24], depth: "rail", fps: 5 },
    { kind: "twinkle", count: 10, area: [-6.6, 6.6, 5.7, 6.5], size: [0.1, 0.14], colours: [0xffd9a0, 0xff8a6a], period: [5, 16], lit: 0.6 },
    SHOOTING_STAR,
  ],
  happens: [
    "The stall's pot steams under the Tonight board; bump someone next to it and its lantern swings.",
    "A cat walks the foot of the wall. The lanterns swing if you jump under them.",
    "Windows up in the dark come on and go off, and a star falls now and then.",
  ],
  sounds: { ...COMMON_SOUNDS, "stall.knock": "a ladle on a pot lid", "cat.walk": "a small miaow", "(always)": "rain dripping off the eaves, a far train" },
  dust: 0x3a3440,
  light: 0xffc9a0, accent: 0xff5a3a, hemiSky: 0x8a7a98, hemiGround: 0x0c0a10, hemi: 1.05, fill: 0xd8d0f0,
  frame: 0x3a1f14, panel: 0x160d0a, shade: 0xff5a3a, fascia: 0x08060a, cord: 0x1a120a, door: 0x1c2a55, plank: 0x5a2f1c, above: "#080a1c",
  lamp: "lantern", bulbs: null, skirt: false, doorway: "none", rope: true,
  words: {
    vars: {
      "--accent": "#ff5a3a", "--accent-rgb": "255, 90, 58", "--plate": "rgba(20, 12, 12, .94)", "--plate-line": "rgba(255, 150, 110, .45)",
      "--ink": "#fff1e0", "--soft": "#d8bfa8", "--dim": "#a08a78",
      "--sign-bg": "#efe6d2", "--sign-ink": "#2a1410", "--sign-soft": "#5a4034", "--sign-line": "#3a1f14", "--sign-border": "3", "--sign-radius": "2",
    },
  },
  wall(g, w, h, k, side, L) {
    // Night above the roofs, dark timber fronts below.
    fade(g, w, h, [[0, "#080a1c"], [0.2, "#141a3a"], [1, "#141a3a"]]);
    stars(g, w, h - 5.9 * k, 60, 9);
    const eave = h - 5.6 * k;
    fade(g, w, h, [[0, "#2a1810"], [1, "#1c100b"]], eave, h);
    for (let x = 0; x < w; x += 0.2 * k) {
      g.fillStyle = "rgba(0,0,0,.3)";
      g.fillRect(x, eave, 2, h - eave);
    }
    // Tiled eaves along the top of the fronts.
    g.fillStyle = "#12161f";
    g.fillRect(0, eave - 0.3 * k, w, 0.34 * k);
    for (let x = 0; x < w; x += 0.16 * k) {
      g.fillStyle = "rgba(160,180,220,.18)";
      g.beginPath();
      g.arc(x, eave + 0.03 * k, 0.07 * k, 0, Math.PI);
      g.fill();
    }
    if (!side) {
      const X = (xm) => (xm + L.wallW / 2) * k;
      // Lit paper screens in the gaps between the games, with their wooden lattice.
      const ww = Math.max(0.2, L.slot - L.bw - 0.46) * k;
      for (const xm of L.gaps.slice(1, -1)) {
        const [top, tall] = [h - 4.9 * k, 2.2 * k];
        const paper = g.createLinearGradient(0, top, 0, top + tall);
        paper.addColorStop(0, "#ffe2a8");
        paper.addColorStop(1, "#e8a860");
        g.fillStyle = paper;
        g.fillRect(X(xm) - ww / 2, top, ww, tall);
        g.fillStyle = "#2a1810";
        for (let y = top; y <= top + tall; y += tall / 5) g.fillRect(X(xm) - ww / 2, y - 2, ww, 4);
        g.fillRect(X(xm) - 2, top, 4, tall);
        g.strokeStyle = "#2a1810";
        g.lineWidth = 6;
        g.strokeRect(X(xm) - ww / 2, top, ww, tall);
        glow(g, X(xm), top + tall / 2, ww * 1.6, "255,190,110", 0.16);
      }
      // The doorway at the left end: a dark opening behind a split blue curtain.
      const dx = X(L.doorX);
      g.fillStyle = "#0a0607";
      g.fillRect(dx - 0.55 * k, h - 2.25 * k, 1.1 * k, 2.25 * k);
      glow(g, dx, h - 0.6 * k, 0.8 * k, "255,170,90", 0.3);
      for (let i = 0; i < 3; i++) {
        g.fillStyle = "#1c2a55";
        g.fillRect(dx - 0.55 * k + i * 0.375 * k, h - 2.3 * k, 0.35 * k, 0.9 * k);
        g.fillStyle = "#f3e9d2";
        g.beginPath();
        g.arc(dx - 0.375 * k + i * 0.375 * k, h - 1.9 * k, 0.1 * k, 0, 7);
        g.fill();
      }
      g.fillStyle = "#3a1f14";
      g.fillRect(dx - 0.62 * k, h - 2.36 * k, 1.24 * k, 0.07 * k);
    }
    // A stone footing, wet.
    fade(g, w, h, [[0, "#2a2a34"], [1, "#16161e"]], h - 0.5 * k, h);
    g.fillStyle = "rgba(255,120,80,.12)";
    g.fillRect(0, h - 0.5 * k, w, 0.04 * k);
    speckle(g, w, h, 6000, 0.05);
  },
  floor(g, w, h, k) {
    g.fillStyle = "#23232c";
    g.fillRect(0, 0, w, h);
    // Stone setts, and the lanterns and screens lying in the wet.
    const rnd = seeded(4);
    for (let y = 0, row = 0; y < h; y += 0.3 * k, row++)
      for (let x = (row % 2) * 0.25 * k - 0.5 * k; x < w; x += 0.5 * k) {
        g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${0.03 + rnd() * 0.06})`;
        g.fillRect(x + 2, y + 2, 0.5 * k - 4, 0.3 * k - 4);
      }
    for (let i = 0; i < 22; i++) glow(g, rnd() * w, rnd() * h, (0.5 + rnd() * 0.9) * k, i % 3 ? "255,110,70" : "255,200,130", 0.13, 0.28);
    speckle(g, w, h, 14000, 0.07);
  },
};

export const SKINS = { bar, ship, arcade, camp, roof, navy, fair, submarine, train, alley };
for (const [id, skin] of Object.entries(SKINS)) skin.id = id;

export const DEFAULT_SKIN = "bar";

/** The skin a live room uses for `id`: a live skin by that name, or the bar. */
export function liveSkin(id) {
  return SKINS[id]?.live ? SKINS[id] : SKINS[DEFAULT_SKIN];
}
