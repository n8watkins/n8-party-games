// The Specimen: Hot Potato's potato as the Game Art Picker drew it (its first Hot Potato look),
// an angular, flat-coloured potato with a face, held in a lab rig: two antennas with bulbs, a test
// tube each side, clamp arms and a tray with lights. Pure: no DOM. art-specimen.js draws what
// scene() returns, every part every time, so nothing is ever added or removed as it heats up.
//
// Everything is in the picker's 240 by 240 box. The potato grows about the point it sits on, past
// the clamps; the rig reacts as it heats: the clamps strain open, the tubes fill and bubble over,
// the bulbs flicker and then flash pink, the tray lights go out one by one, the tray cracks.
// The face changes with the heat, from a set of expressions per stage (chosen by the round's seed
// and changing between turns), and reacts to right answers, wrong ones, silence, repeats and
// appeals.
//
// How stressed it acts follows one continuous level (levelOf): the stage, plus a share of the
// stress within it (artState's `stress`), so it gets visibly worse while a slow turn's fuse burns
// and calms a notch after an answer, and each lost life jumps to the next stage's baseline. The
// LADDER below gives every sign of stress at each whole level, eased in between: calm is chill
// (slow breathing, lazy blinks); warm is uneasy (more blinks, darting eyes, a bead of sweat now and
// then); hot sweats and shivers every few seconds; strain trembles steadily and flings sweat; at
// critical the potato shakes hard in its rig. Only the potato moves, inside its own drawing: the
// screen, the layout and the potato's box never do. With reduced motion nothing moves; the stress
// shows in still signs (sweat, the face, the colour, the rig).

export const INK = "#1a1433";
export const SKIN = "#e0a458";
export const SHADE = "#b97a34";
export const HILITE = "#f6cf8e";
export const GLOW = "#3ee6a8";
export const LUMP = "#7dffb6";
export const MOUTH = "#5b1436";
export const BULB = "#ffd23f";
export const BULB_DIM = "#8f7c3a";
export const ALARM = "#ff3d7f";
export const GLASS = "#dff3ff";
export const ROD = "#8f97c9";
export const CLAMP = "#aab2d8";
export const TRAY = "#4a4f86";
export const TRAY_TOP = "#7178bd";
export const LIGHT_OFF = "#2a2850";
export const SWEAT = "#dff3ff";
export const TONGUE = "#ff7aa8";

/**
 * The SVG's view: the picker's box with room for the sprouts above, the burst's chunks and the
 * potato at its biggest and shakiest (the tests keep everything inside it).
 */
export const VIEW = "-16 -50 272 292";
/** The point the potato sits on and grows about (the picker's 50% 82%). */
export const PIVOT = [120, 196.8];
/** The point it shakes about: the middle of its body (from PIVOT), so it shakes in place. */
export const SHAKE_AT = [0, -74];
/** The potato's outline (the picker's). */
export const BODY = "M70 66 L118 50 L170 60 L204 100 L198 150 L160 188 L104 194 L56 170 L38 120Z";
const BODY_POINTS = [[70, 66], [118, 50], [170, 60], [204, 100], [198, 150], [160, 188], [104, 194], [56, 170], [38, 120]];
/** The glowing spots under the skin: [x, y, radius, delay], away from the face. */
export const LUMPS = [[58, 108, 9, 0], [194, 142, 9, -0.6], [156, 72, 7, -1.1]];
/** Beads of sweat: where each forms (on its brow, then its cheeks). */
export const BEADS = [[72, 98], [176, 102], [70, 140], [180, 126]];
/** Drops flung off: [x, y, which way]. */
export const FLUNG = [[62, 100, -1], [180, 104, 1], [76, 80, -1], [166, 78, 1]];
/** How much bigger it gets at the top of a stage's stress (the size creep). */
export const SIZE_CREEP = 0.04;
/** How far the burst springs the clamps open (degrees): as far as they go and stay in the drawing. */
export const CLAMP_BURST = -40;

/** The stages' names, as the picker called its heat states. */
export const HEATS = ["calm", "warm", "hot", "strain", "critical", "boom"];
/** How big it is at each stage (the picker's --k), eased between by growth. */
export const SIZES = [0.62, 0.72, 0.86, 1, 1.14];

/** How much of a stage the stress within it can add to the level: the next stage is always a jump. */
export const LEVEL_STRESS = 0.7;
/** The stress level: the stage (0 to 4, eased as growth * 4) plus LEVEL_STRESS of the stress. */
export const levelOf = (g4, stress = 0) => Math.max(0, Math.min(4, g4)) + LEVEL_STRESS * Math.max(0, Math.min(1, stress));

/**
 * The stress ladder: each sign of stress at levels 0 (calm), 1 (warm), 2 (hot), 3 (strain), 4
 * (critical) and 5 (the top of critical; the level stops at 4.7), eased between.
 */
export const LADDER = {
  /** Seconds a breath takes, and how deep (a share of its size). */
  breathS: [6, 4.6, 3.4, 2.6, 2, 1.7],
  breath: [0.04, 0.04, 0.035, 0.03, 0.025, 0.02],
  /** Seconds between blinks, and how long a blink lasts (lazy when calm). */
  blinkS: [4.2, 2.6, 2, 1.7, 1.5, 1.4],
  blinkLong: [0.28, 0.16, 0.13, 0.12, 0.11, 0.1],
  /** How far its eyes dart about between turns (0 to 1 of the eye). */
  dart: [0, 0.7, 0.85, 1, 1, 1],
  /** Beads of sweat on its face (up to 4; a fraction is a bead forming), and seconds each takes to roll. */
  beads: [0, 1, 3, 4, 4, 4],
  beadS: [4, 4, 2.4, 1.7, 1.3, 1.2],
  /** Drops of sweat flung off it (up to 4). */
  flung: [0, 0, 0, 1.5, 3, 4],
  /** Nervous shivers, in short bursts every few seconds (degrees of tremble at the peak), from hot. */
  shiver: [0, 0, 1, 1.3, 0.4, 0],
  /** A steady tremble (degrees; it also jolts a little sideways), from strain. */
  tremble: [0, 0, 0, 0.6, 2.6, 3.2],
  /** The throb: how much it bulges each beat, and beats a second. */
  throb: [0, 0, 0.05, 0.07, 0.09, 0.1],
  throbHz: [0.8, 0.8, 1.1, 1.4, 1.8, 2.1],
  /** The clamps: how far they are pushed open (degrees), and how much they creak with each beat. */
  clamp: [0, -3, -9, -20, -30, -36],
  creak: [0, 0, 0, 1.5, 2.5, 3],
  /** Tray lights out (of 4; past the half, the next one flickers before it goes). */
  lightsOut: [0, 0.45, 1, 2, 3, 3.9],
  /** The tubes' level (the top of the liquid; lower is fuller). */
  tubeL: [174, 170, 165, 159, 153, 151],
  tubeR: [166, 163, 159, 155, 151, 150],
};

const f = (n) => Math.round(n * 10) / 10;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
/** A value per stage (0 to 4), eased between by growth * 4. */
export const perStage = (values, g4) => {
  const x = Math.max(0, Math.min(values.length - 1, g4));
  const i = Math.min(values.length - 2, Math.floor(x));
  return lerp(values[i], values[i + 1], x - i);
};
const smooth = (t) => t * t * (3 - 2 * t);
/** One LADDER row at a level. */
export const atLevel = (row, lv) => perStage(row, lv);
/** A looping wave 0..1..0 over `period` seconds, eased (an alternate ease-in-out animation). */
const swing = (t, period) => (1 - Math.cos((Math.PI * 2 * t) / period)) / 2;
/** On or off, `period` seconds a cycle, on for `duty` of it. */
const blinkOn = (t, period, duty = 0.5) => ((t % period) + period) % period < period * duty;

/** Keyframes [[at 0..1, ...values]] at `p` (0..1), eased between keys. */
function keys(frames, p) {
  for (let i = 1; i < frames.length; i++) {
    const [b, ...vb] = frames[i];
    const [a, ...va] = frames[i - 1];
    if (p <= b) {
      const t = b === a ? 1 : smooth((p - a) / (b - a));
      return va.map((v, j) => lerp(v, vb[j], t));
    }
  }
  return frames.at(-1).slice(1);
}

/** The picker's seeded random numbers (an LCG). */
export const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
/** A small hash of a few integers, for choosing a face. */
export const pick = (...n) => {
  let h = 2166136261;
  for (const x of n) {
    h ^= x & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= x >>> 16;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
};

/** A jagged burst (straight lines), as the picker drew its splat. */
export function burstPoints(cx, cy, rOut, rIn, spikes, seed) {
  const r = rnd(seed);
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = (i % 2 ? rIn : rOut) * (0.88 + r() * 0.2);
    pts.push(`${f(cx + Math.cos(a) * rad)},${f(cy + Math.sin(a) * rad)}`);
  }
  return pts.join(" ");
}

// ---- Faces ------------------------------------------------------------------------------------
//
// A face: three eyes (the third, on the forehead, only when it strains), two brows, a mouth and
// two sweat drops. An eye is the picker's six-sided eye with a round pupil, optionally a lid (how
// far down, 0 to 1) or shut ("line" for a blink or a doze, "happy" for ^, "squeeze" for > <).
// The mouth is a line, a filled shape (dark, or white teeth), a white detail on it and ink lines.

const eye = (x, y, w, h, p, o = {}) => ({ x, y, w, h, p, lid: 0, tilt: 0, px: 0, py: 0, shut: null, ...o });
const brow = (x1, y1, x2, y2, t) => ({ x1, y1, x2, y2, t });
const teeth = (x, y, w, n, len = 18) => Array.from({ length: n }, (_, i) => `M${f(x + ((i + 1) * w) / (n + 1))} ${y} l0 ${len}`).join(" ");

const F = (id, eyes, brows, mouth, sweat = 0) => ({ id, eyes: [eyes[0], eyes[1], eyes[2] ?? null], brows: [brows[0] ?? null, brows[1] ?? null], mouth, sweat });
const shutBoth = (kind, l = [96, 118, 14, 11, 4], r = [146, 118, 14, 11, 4]) => [eye(...l, { shut: kind }), eye(...r, { shut: kind })];

/** The expressions at each stage. The first of each is the picker's own; the rest are variety. */
export const FACES = {
  calm: [
    F("deadpan", [eye(96, 118, 13, 10, 4, { lid: 0.5 }), eye(146, 118, 13, 10, 4, { lid: 0.5 })], [], { line: "M108 150 L134 148" }),
    F("side-eye", [eye(96, 119, 14, 9, 4, { lid: 0.3, px: 1, py: 0.3 }), eye(146, 119, 14, 9, 4, { lid: 0.3, px: 1, py: 0.3 })], [null, brow(134, 104, 160, 103, 3)], { line: "M110 151 L132 150" }),
    F("smug", [eye(96, 118, 13, 10, 4, { lid: 0.55, tilt: 2 }), eye(146, 118, 13, 10, 4, { lid: 0.55, tilt: -2 })], [null, brow(132, 100, 160, 96, 3)], { line: "M106 149 L126 152 L138 143" }),
    F("yawn", [eye(96, 118, 13, 10, 4, { lid: 0.72 }), eye(146, 118, 13, 10, 4, { lid: 0.72 })], [], { fill: "M110 145 L130 144 L133 166 L112 168Z", colour: MOUTH }),
    F("dozing", shutBoth("line", [96, 120, 13, 10, 4], [146, 120, 13, 10, 4]), [], { line: "M114 152 L128 151" }),
  ],
  warm: [
    F("one-brow", [eye(94, 116, 16, 14, 5), eye(148, 120, 12, 6, 3)], [null, brow(160, 104, 134, 108, 4)], { line: "M104 152 L114 146 L124 152 L134 146" }),
    F("brow-up", [eye(96, 118, 13, 10, 4, { lid: 0.4 }), eye(146, 116, 15, 13, 4)], [null, brow(132, 96, 162, 90, 4)], { line: "M108 152 L132 147" }),
    F("squint", [eye(96, 118, 14, 7, 3, { lid: 0.25 }), eye(146, 118, 14, 7, 3, { lid: 0.25 })], [brow(78, 104, 110, 106, 4), brow(164, 104, 132, 106, 4)], { line: "M108 150 L116 147 L124 150 L132 147" }),
    F("uneasy", [eye(96, 118, 14, 11, 4, { px: -0.8 }), eye(146, 118, 14, 11, 4, { px: -0.8 })], [brow(80, 102, 108, 98, 3.5)], { line: "M106 151 L116 148 L126 151 L136 148" }, 1),
    // Whistling innocently, looking away: nothing to see here.
    F("whistling", [eye(96, 118, 13, 10, 4, { lid: 0.35, px: 0.9, py: -0.6 }), eye(146, 118, 13, 10, 4, { lid: 0.35, px: 0.9, py: -0.6 })], [brow(82, 101, 108, 98, 3), brow(160, 99, 134, 97, 3)], { fill: "M118 147 L127 146 L130 152 L126 158 L118 158 L115 152Z", colour: MOUTH }),
  ],
  hot: [
    F("gasp", [eye(92, 114, 18, 16, 5), eye(150, 116, 14, 13, 4)], [brow(70, 92, 104, 86, 5), brow(170, 92, 138, 90, 5)], { fill: "M98 146 L146 142 L138 164 L108 166Z", colour: MOUTH, detail: "M112 146 L124 145 L123 155 L113 156Z" }),
    F("gritted", [eye(94, 116, 16, 14, 4), eye(148, 116, 16, 14, 4)], [brow(74, 96, 108, 102, 5), brow(168, 96, 134, 102, 5)], { fill: "M98 146 L146 144 L144 162 L100 164Z", colour: "#fff", lines: "M109 145 L109 163 M120 145 L120 163 M131 144 L131 162 M99 154 L145 153" }, 1),
    F("worried", [eye(94, 118, 15, 14, 5, { py: 0.3 }), eye(148, 118, 15, 14, 5, { py: 0.3 })], [brow(72, 102, 106, 92, 4.5), brow(170, 102, 136, 92, 4.5)], { line: "M102 158 L112 151 L122 158 L132 151 L142 157" }, 2),
    // A wince: one eye screwed shut, a crooked wobbly mouth.
    F("wince", [eye(94, 117, 16, 13, 4, { shut: "squeeze" }), eye(148, 116, 15, 14, 5)], [brow(72, 99, 106, 105, 5), brow(170, 92, 136, 90, 4.5)], { line: "M102 156 L113 150 L124 156 L135 150 L145 154" }, 1),
  ],
  strain: [
    F("three-eyes", [eye(92, 116, 19, 17, 4), eye(152, 118, 16, 15, 4), eye(122, 82, 11, 9, 3)], [], { fill: "M94 148 L150 144 L146 166 L100 170Z", colour: "#fff", lines: teeth(94, 148, 56, 4) }),
    F("cross-eyed", [eye(92, 116, 18, 16, 4, { px: 0.9 }), eye(152, 116, 18, 16, 4, { px: -0.9 }), eye(122, 82, 11, 9, 3, { py: -0.6 })], [brow(70, 96, 106, 104, 5), brow(174, 96, 138, 104, 5)], { fill: "M96 148 L148 145 L145 163 L99 166Z", colour: "#fff", lines: "M107 147 l0 18 M118 147 l0 18 M129 146 l0 18 M140 146 l0 18 M97 156 L146 154" }, 1),
    F("grimace", [eye(92, 116, 18, 16, 4, { shut: "squeeze" }), eye(152, 116, 18, 16, 4, { shut: "squeeze" }), eye(122, 80, 12, 10, 3)], [], { fill: "M90 146 L154 142 L150 164 L94 168Z", colour: "#fff", lines: "M101 145 l0 21 M112 145 l0 21 M123 144 l0 21 M134 144 l0 21 M145 143 l0 21" }, 2),
  ],
  critical: [
    // A cartoon wail: wide eyes under worried brows, a big open mouth with two buck teeth and a
    // tongue (comic, never fangs).
    F("screech", [eye(90, 114, 20, 18, 6, { py: -0.3 }), eye(154, 116, 18, 17, 6, { py: -0.3 }), eye(122, 78, 13, 11, 4)], [brow(66, 92, 104, 80, 5), brow(178, 94, 140, 82, 5)], { fill: "M98 146 L146 142 L141 175 L103 177Z", colour: MOUTH, detail: "M112 145.6 L121.5 145 L121.5 154 L112 154.6Z M123.5 144.9 L133 144.3 L133 153.4 L123.5 154Z", tongue: "M108 176 L111 166 L121 161 L132 163 L137 173Z" }),
    F("panic", [eye(92, 112, 22, 20, 3, { py: -0.2 }), eye(152, 112, 22, 20, 3, { py: -0.2 }), eye(122, 74, 13, 11, 3)], [brow(66, 82, 104, 74, 5), brow(178, 82, 140, 74, 5)], { fill: "M106 144 L138 142 L144 180 L102 182Z", colour: MOUTH }, 2),
    F("scream", [eye(92, 114, 20, 18, 3, { shut: "squeeze" }), eye(152, 114, 20, 18, 3, { shut: "squeeze" }), eye(122, 78, 14, 12, 2.5)], [], { fill: "M98 144 L146 140 L140 180 L104 182Z", colour: MOUTH, detail: "M100 146 L144 142 L143 149 L101 152Z" }, 2),
  ],
};

/** Looking up, listening (at the calm stage; later stages keep their face and look up). */
export const LISTENING = F("listening", [eye(96, 116, 14, 12, 4, { py: -0.8 }), eye(146, 116, 14, 12, 4, { py: -0.8 })], [brow(80, 100, 110, 96, 3.5), brow(162, 100, 132, 96, 3.5)], { line: "M112 150 L130 149" });

/** The reactions: a moment's face after a verdict. */
export const REACTIONS = {
  right: [
    F("relieved", shutBoth("happy"), [], { line: "M104 146 L114 156 L132 156 L142 146" }, 1),
    F("proud", shutBoth("happy"), [], { fill: "M102 144 L142 144 L134 164 L110 164Z", colour: MOUTH, detail: "M104 145 L140 145 L138 151 L106 151Z" }),
    F("phew", shutBoth("line"), [], { fill: "M116 150 L126 149 L127 157 L117 158Z", colour: MOUTH }, 1),
  ],
  appeal: [F("sheepish", [eye(96, 118, 13, 10, 4, { shut: "happy" }), eye(146, 118, 12, 9, 4, { px: -0.6 })], [null, brow(132, 100, 160, 96, 3)], { line: "M106 150 L116 154 L126 151 L138 155" }, 1)],
  wrong: [
    F("flinch", shutBoth("squeeze", [96, 118, 15, 12, 4], [146, 118, 15, 12, 4]), [], { line: "M100 156 L108 148 L116 156 L124 148 L132 156 L140 148" }),
    F("ouch", shutBoth("squeeze", [96, 118, 15, 12, 4], [146, 118, 15, 12, 4]), [], { fill: "M108 148 L134 146 L132 162 L110 164Z", colour: MOUTH }, 1),
  ],
  slow: [F("jolted", [eye(94, 114, 17, 15, 2.5), eye(148, 114, 17, 15, 2.5)], [brow(74, 90, 108, 86, 4), brow(168, 90, 134, 86, 4)], { fill: "M114 150 L128 149 L129 160 L115 161Z", colour: MOUTH }, 1)],
  repeat: [F("eye-roll", [eye(96, 118, 13, 10, 4, { lid: 0.3, py: -1 }), eye(146, 118, 13, 10, 4, { lid: 0.3, py: -1 })], [brow(80, 102, 110, 104, 3.5)], { line: "M108 151 L134 151" })],
  overturned: [F("betrayed", [eye(94, 116, 16, 14, 4, { py: 0.2 }), eye(148, 116, 16, 14, 4, { py: 0.2 })], [brow(72, 102, 106, 94, 4.5), brow(170, 102, 136, 94, 4.5)], { fill: "M110 152 L132 150 L130 160 L112 162Z", colour: MOUTH })],
  doom: [FACES.critical[1], FACES.critical[0]],
};

/** Every face there is, for the contact sheet and the tests. */
export const ALL_FACES = [...Object.values(FACES).flat(), LISTENING, ...Object.entries(REACTIONS).filter(([k]) => k !== "doom").flatMap(([, v]) => v)];
export const faceById = (id) => ALL_FACES.find((x) => x.id === id) ?? null;

/** How a verdict's reason reads on its face. */
export function reactionKind(event, detail = {}) {
  if (event === "right") return detail.appeal ? "appeal" : "right";
  if (event === "doom") return "doom";
  const why = detail.why ?? "";
  if (why === "slow") return "slow";
  if (why === "used" || why === "echo") return "repeat";
  if (why === "overturned") return "overturned";
  return "wrong";
}

/**
 * The face to show now. `base` is the stage's face (from FACES), `reaction` a face from REACTIONS
 * or null, `phase` the round's phase, `fuse` the fuse left (1 when not burning), and the idle
 * moments (blink, glance at whoever is up, sigh) as booleans. Returns a new face.
 */
export function composeFace({ base, reaction = null, stage = 0, phase = "idle", fuse = 1, blink = false, glance = false, sigh = false, dart = 0 }) {
  let face = reaction ?? (phase === "listen" && stage === 0 ? LISTENING : base);
  face = { ...face, eyes: face.eyes.map((e) => e && { ...e }), brows: [...face.brows], mouth: { ...face.mouth } };
  // Once it strains it keeps its third eye in every reaction.
  if (!face.eyes[2] && base.eyes[2]) face.eyes[2] = { ...base.eyes[2] };
  if (!reaction && phase === "listen") {
    // Listening: eyes up and open; once the fuse burns they follow its spark from right to left.
    const burning = fuse < 1;
    for (const e of face.eyes) {
      if (!e || e.shut) continue;
      e.lid = Math.min(e.lid, 0.12);
      e.px = burning ? lerp(-0.9, 0.9, fuse) : 0;
      e.py = -0.85;
    }
  } else if (!reaction && phase === "ready") {
    // Uneasy eyes dart from side to side (`dart`, -1 to 1), unless it glances at whoever is up.
    if (!glance && Math.abs(dart) > 0.02)
      for (const e of face.eyes) {
        if (!e || e.shut) continue;
        e.px = Math.max(-1, Math.min(1, dart));
      }
    if (glance)
      for (const e of face.eyes) {
        if (!e || e.shut) continue;
        e.px = 0.8;
        e.py = -0.7;
        e.lid = Math.min(e.lid, 0.35);
      }
    if (sigh) face.mouth = { fill: "M116 149 L127 148 L128 157 L117 158Z", colour: MOUTH };
  }
  if (blink && !reaction) for (const e of face.eyes) if (e && !e.shut) e.shut = "line";
  return face;
}

/** One eye's shapes: the white, the pupil, the lid and the shut line (null for what is not drawn). */
export function eyeParts(e, side, lidFill) {
  if (!e) return { white: null, pupil: null, lid: null, shut: null };
  const { x, y, w, h, p } = e;
  if (e.shut) {
    let d;
    if (e.shut === "happy") d = `M${f(x - w)} ${f(y + h * 0.35)} L${f(x - w * 0.1)} ${f(y - h * 0.55)} L${f(x + w)} ${f(y + h * 0.35)}`;
    else if (e.shut === "squeeze") {
      const s = side === 1 ? -1 : 1;
      d = `M${f(x - s * w)} ${f(y - h * 0.7)} L${f(x + s * w * 0.7)} ${f(y)} L${f(x - s * w)} ${f(y + h * 0.7)}`;
    } else d = `M${f(x - w)} ${f(y + 1)} L${f(x + w)} ${f(y - 1)}`;
    return { white: null, pupil: null, lid: null, shut: d };
  }
  const white = [[-w, 0], [-w * 0.5, -h], [w * 0.6, -h * 0.9], [w, -h * 0.1], [w * 0.5, h], [-w * 0.6, h * 0.9]].map(([a, b]) => `${f(x + a)},${f(y + b)}`).join(" ");
  const pupil = { cx: f(x + 1 + e.px * Math.max(0, w - p - 4) * 0.85), cy: f(y + 1 + e.py * Math.max(0, h - p - 3) * 0.85), r: p };
  let lid = null;
  if (e.lid > 0) {
    const top = y - h - 3;
    const down = e.lid * (2 * h + 6);
    lid = { points: `${f(x - w - 3)},${f(top)} ${f(x + w + 3)},${f(top)} ${f(x + w + 3)},${f(top + down - 1.5 - e.tilt)} ${f(x - w - 3)},${f(top + down + 1.5 + e.tilt)}`, fill: lidFill };
  }
  return { white, pupil, lid, shut: null };
}

const browPoints = (b) => (b ? `${b.x1},${b.y1} ${b.x2},${b.y2 - b.t} ${b.x2},${b.y2 + b.t}` : null);
const dropPoints = (x, y) => `${x},${y - 9} ${x + 5},${y + 1} ${x + 3},${y + 6} ${x - 3},${y + 6} ${x - 5},${y + 1}`;

/** Mixes two #rrggbb colours. */
export function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(lerp(v, pb[i], clamp01(t))).toString(16).padStart(2, "0")).join("")}`;
}

// ---- Motion -----------------------------------------------------------------------------------

/** A tremble's wobble at `t`, about -1 to 1: a few fixed fast waves, so its strength can change smoothly. */
const wobble = (t, a, b, c) => (Math.sin(Math.PI * 2 * a * t) + 0.6 * Math.sin(Math.PI * 2 * b * t + 1.3) + 0.35 * Math.sin(Math.PI * 2 * c * t + 2.1)) / 1.95;
/** The nervous shivers: a short burst (0.7 s, eased in and out) every 3.2 s; 0 to 1. */
export const shiverGate = (t) => {
  const u = (((t + 1.1) % 3.2) + 3.2) % 3.2 / 0.7;
  return u < 1 ? Math.sin(Math.PI * u) ** 2 : 0;
};

/**
 * How the potato moves now, inside its drawing: a scale about where it sits (sx, sy), a skew (sk,
 * degrees), a rotation (rot, degrees) and a jolt sideways (tx, ty, in the drawing's units), plus
 * `beat`, the throb's phase (0 to 1) that the clamps creak with. From the stress `level` (levelOf;
 * `stage` when it is not given) and the LADDER: breathing all the time, a throb from hot, shivers
 * at hot, a steady tremble from strain that is a hard shake at critical; then the moments:
 * settling after a right answer, a flinch when it gets worse, a sigh. `breath` and `beat` are the
 * breathing's and the throb's phases (the renderer advances them, so a change of pace never
 * jumps); without them they follow `t`. Nothing moves with reduced motion or when held still.
 */
export function pose({ t = 0, stage = 0, level = stage, breath = null, beat = null, reduce = false, still = false, react = null, reactFor = 9, sighFor = 9 }) {
  let sx = 1;
  let sy = 1;
  let sk = 0;
  let rot = 0;
  let tx = 0;
  let ty = 0;
  const lv = Math.max(0, level);
  const phase = ((((beat ?? t * atLevel(LADDER.throbHz, lv)) % 1) + 1) % 1);
  if (reduce || still) return { sx, sy, sk, rot, tx, ty, beat: 0 };
  // Breathing: slow and deep when calm, quicker and shallower as it gets stressed.
  const u = (1 - Math.cos(Math.PI * 2 * (breath ?? t / atLevel(LADDER.breathS, lv)))) / 2;
  const deep = atLevel(LADDER.breath, lv);
  sx *= 1 + deep * u;
  sy *= 1 - deep * 0.9 * u;
  // The throb: a bulge at the start of each beat that settles back.
  const bulge = lv < 2 ? 0 : atLevel(LADDER.throb, lv);
  if (bulge > 0) {
    const [a, c] = keys([[0, 1, 1], [0.18, 1 + bulge, 1 + bulge * 0.55], [0.4, 1 - bulge * 0.2, 1 + bulge * 0.1], [1, 1, 1]], phase);
    sx *= a;
    sy *= c;
  }
  // Shivers in bursts from hot on (never while it is only warm), and a steady tremble from strain
  // that grows into a hard shake.
  const shake = (lv < 2 ? 0 : atLevel(LADDER.shiver, lv) * shiverGate(t)) + (lv < 3 ? 0 : atLevel(LADDER.tremble, lv));
  if (shake > 0) {
    rot += shake * wobble(t, 9.3, 13.7, 17.9);
    tx += shake * 0.9 * wobble(t + 0.37, 11.1, 15.3, 7.7);
    ty += shake * 0.3 * wobble(t + 0.71, 12.7, 8.9, 16.1);
  }
  if (react === "right" && reactFor < 0.9) {
    const [a, b] = keys([[0, 1, 1], [0.25, 1.1, 0.84], [0.55, 0.92, 1.06], [1, 1, 1]], reactFor / 0.9);
    sx *= a;
    sy *= b;
  } else if (react === "worse" && reactFor < 0.55) {
    const [a, b] = keys([[0, 1, 1], [0.18, 1.07, 0.88], [0.5, 0.96, 1.05], [1, 1, 1]], reactFor / 0.55);
    sx *= a;
    sy *= b;
  }
  if (sighFor < 1.6) {
    const [a, b] = keys([[0, 1, 1], [0.35, 1.03, 1.05], [0.75, 1.02, 0.95], [1, 1, 1]], sighFor / 1.6);
    sx *= a;
    sy *= b;
  }
  return { sx, sy, sk, rot, tx, ty, beat: phase };
}

/**
 * The idle moments between turns, from the clock and the stress level: a blink (lazy and rare when
 * calm, quick and often when stressed), a glance at whoever is up, a sigh, and eyes that dart
 * (`dart`, -1 to 1: a quick, eased look one way, then the other).
 */
export function idleAt(t, seed = 7, level = 0) {
  const off = (pick(seed) % 1000) / 1000;
  const every = atLevel(LADDER.blinkS, level);
  const blink = (t + off * 3) % every < atLevel(LADDER.blinkLong, level);
  const glance = (t + 2 + off * 5) % 7 < 1;
  const sighFor = (t + 4 + off * 4) % 11;
  // Darting: hold a side, flick to the other in 0.15 s, every 0.9 s.
  const p = (t + off * 2) % 1.8;
  const side = (x) => (x < 0.15 ? -1 + 2 * smooth(x / 0.15) : 1);
  const d = p < 0.9 ? side(p) : -side(p - 0.9);
  return { blink, glance, sighFor, dart: d * atLevel(LADDER.dart, level) };
}

// ---- The scene --------------------------------------------------------------------------------

/**
 * Every part's attributes now, by part name (see PARTS in art-specimen.js). `growth` and `stress`
 * are the eased values (stress within the stage, see levelOf), `stage` the stage it is at (0 to
 * 4), `face` the composed face, `motion` from pose(), `t` the art's clock, `burstFor` seconds since
 * it burst (null if not), and `reduce` reduced motion. The same parts every time: what is not
 * shown has opacity 0. The mutation (green skin, lumps, veins, sprouts, the third eye) follows the
 * stage; the stress signs (sweat, the rig, the size creep) follow the stress level too.
 */
export function scene({ growth = 0, stress = 0, stage = 0, face, motion = { sx: 1, sy: 1, sk: 0, rot: 0, tx: 0, ty: 0, beat: 0 }, t = 0, burstFor = null, reduce = false, still = false, seed = 7 }) {
  const out = {};
  const g4 = Math.max(0, Math.min(4, growth * 4));
  const lv = levelOf(g4, stress);
  const live = !reduce && !still;
  const boom = burstFor !== null;
  const bt = boom ? (reduce ? 9 : burstFor) : 0;
  const order = lightOrder(seed);

  // Antennas and their bulbs: steady when calm, one flickers when warm (more often as the stress
  // rises); then sparks fly from them to the potato, and once it strains they flash pink, faster
  // and faster.
  const flickerSide = pick(seed, 3) % 2;
  const flickerEvery = lerp(2.3, 1.1, clamp01(lv - 1));
  const flicker = live && lv >= 1 && lv < 2 && (t + flickerSide) % flickerEvery < 0.12;
  out.bulbL = { fill: flicker && flickerSide === 0 ? BULB_DIM : BULB };
  out.bulbR = { fill: flicker && flickerSide === 1 ? BULB_DIM : BULB };
  const alarmPeriod = atLevel([0.8, 0.8, 0.8, 0.8, 0.5, 0.35], lv);
  const alarm = boom || (stage >= 3 && (!live || blinkOn(t, alarmPeriod)));
  out.alarmL = { opacity: alarm ? 1 : 0 };
  out.alarmR = { opacity: alarm ? 1 : 0 };
  const boltPeriod = atLevel([1.1, 1.1, 1.1, 0.7, 0.5, 0.4], lv);
  const bolts = !boom && stage >= 2 && (!live || blinkOn(t, boltPeriod, 0.5));
  out.boltInk = { opacity: bolts ? 1 : 0 };
  out.bolt = { opacity: bolts ? 1 : 0 };

  // The tubes fill as the stress rises, and bubble over at the end.
  const over = boom ? 1 : clamp01((lv - 3.4) / 0.6);
  const topL = boom ? 151 : atLevel(LADDER.tubeL, lv);
  const topR = boom ? 150 : atLevel(LADDER.tubeR, lv);
  out.liquidL = { y: f(topL), height: f(202 - topL) };
  out.liquidR = { y: f(topR), height: f(202 - topR) };
  out.foamL = { opacity: f(over) };
  out.foamR = { opacity: f(over) };
  out.dripL = { points: `13,150 18,150 18,${f(150 + 30 * over)} 15.5,${f(154 + 30 * over)} 13,${f(150 + 30 * over)}`, opacity: over > 0.02 ? 1 : 0 };
  out.dripR = { points: `222,150 227,150 227,${f(150 + 22 * over)} 224.5,${f(154 + 22 * over)} 222,${f(150 + 22 * over)}`, opacity: over > 0.02 ? 1 : 0 };
  const bubblePeriod = atLevel([2, 1.8, 1.4, 1.1, 0.8, 0.7], lv);
  const BUBBLES = [[9, 194, 2.6, 0], [231, 190, 2.6, 0.35], [12, 184, 2, 0.65]];
  BUBBLES.forEach(([x, y, r, off], i) => {
    if (!live) {
      out[`bub${i}`] = { cx: x, cy: y - 8, r, opacity: 0.8 };
      return;
    }
    const p = ((t / bubblePeriod + off) % 1 + 1) % 1;
    out[`bub${i}`] = { cx: x, cy: f(y - 22 * p - 8 * over * p), r, opacity: f(p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8) };
  });

  // The potato: a little bigger as the stress rises (a size creep), trembling inside its rig.
  const k = perStage(SIZES, g4) * (1 + SIZE_CREEP * clamp01(stress));
  const [ox, oy] = PIVOT;
  out.spud = {
    transform: `translate(${f(ox + (motion.tx ?? 0))} ${f(oy + (motion.ty ?? 0))}) rotate(${f(motion.rot)} ${SHAKE_AT[0]} ${SHAKE_AT[1]}) skewX(${f(motion.sk)}) scale(${(k * motion.sx).toFixed(4)} ${(k * motion.sy).toFixed(4)}) translate(${-ox} ${-oy})`,
    opacity: boom ? 0 : 1,
  };
  // Sprouts push out once it strains, and wave at the end.
  const sprout = perStage([0, 0, 0, 0.55, 1], g4);
  const VINES = [[103, 57], [157, 59], [48, 128]];
  VINES.forEach(([vx, vy], i) => {
    const wave = live && g4 > 3.5 ? Math.sin((t * Math.PI * 2) / 1 + i * 1.6) : 0;
    const s = sprout * (1 + 0.04 * (1 + wave));
    out[`vine${i}`] = { transform: `rotate(${f(wave * 6)} ${vx} ${vy}) translate(${vx} ${vy}) scale(${s.toFixed(3)}) translate(${-vx} ${-vy})`, opacity: sprout > 0.01 ? 1 : 0 };
  });
  // It turns green as it heats, pulsing at the end.
  const glow = clamp01(perStage([0, 0.1, 0.22, 0.34, 0.48], g4) + (live && g4 > 3.5 ? 0.1 * Math.sin(t * Math.PI * 2 * 0.8) : 0));
  out.glowskin = { opacity: f(glow * 100) / 100 };
  // Glowing spots under the skin once it is hot, away from the face: they glow brighter and
  // dimmer and drift a little, faster at the end.
  const lumps = clamp01((g4 - 1.6) / 0.4);
  const glowPeriod = g4 > 3.5 ? 1.4 : 3.2;
  LUMPS.forEach(([cx, cy, , delay], i) => {
    const u = live ? swing(t + delay, glowPeriod) : 0.5;
    const s = lerp(0.85, 1.12, u) * lumps;
    const dx = lerp(-2.5, 2.5, live ? swing(t * 0.7 + delay, glowPeriod * 1.7) : 0.5);
    out[`lump${i}`] = { transform: `translate(${f(cx + dx)} ${f(cy)}) scale(${s.toFixed(3)}) translate(${-cx} ${-cy})`, opacity: lumps > 0.01 ? f(lerp(0.75, 1, u)) : 0 };
  });
  out.veins = { opacity: f(clamp01((g4 - 2.6) / 0.4)) };

  // The face.
  const lidFill = mix(SKIN, GLOW, glow);
  face.eyes.forEach((e, i) => {
    const p = eyeParts(e, i, lidFill);
    out[`eyeW${i}`] = p.white ? { points: p.white, opacity: 1 } : { points: "0,0", opacity: 0 };
    out[`eyeP${i}`] = p.pupil ? { ...p.pupil, opacity: 1 } : { cx: 0, cy: 0, r: 0, opacity: 0 };
    out[`eyeL${i}`] = p.lid ? { points: p.lid.points, fill: p.lid.fill, opacity: 1 } : { points: "0,0", fill: lidFill, opacity: 0 };
    out[`eyeS${i}`] = p.shut ? { d: p.shut, opacity: 1 } : { d: "M0 0", opacity: 0 };
  });
  face.brows.forEach((b, i) => {
    out[`brow${i}`] = b ? { points: browPoints(b), opacity: 1 } : { points: "0,0", opacity: 0 };
  });
  const m = face.mouth;
  out.mouthFill = m.fill ? { d: m.fill, fill: m.colour ?? MOUTH, opacity: 1 } : { d: "M0 0", fill: MOUTH, opacity: 0 };
  out.mouthDetail = m.detail ? { d: m.detail, opacity: 1 } : { d: "M0 0", opacity: 0 };
  out.mouthLines = m.lines ? { d: m.lines, opacity: 1 } : { d: "M0 0", opacity: 0 };
  out.mouthLine = m.line ? { d: m.line, opacity: 1 } : { d: "M0 0", opacity: 0 };
  out.mouthTongue = m.tongue ? { d: m.tongue, opacity: 1 } : { d: "M0 0", opacity: 0 };
  // Sweat: beads form on its brow and roll down, more of them and faster as the stress rises (a
  // worried face sweats whatever the level). Held still, each bead shows part way down.
  const beads = Math.max(face.sweat, atLevel(LADDER.beads, lv));
  const beadS = atLevel(LADDER.beadS, lv);
  BEADS.forEach(([x, y], i) => {
    const amount = clamp01(beads - i);
    const p = live ? (((t / beadS + i * 0.37) % 1) + 1) % 1 : 0.35;
    // It forms (grows), rolls down, and fades at the end.
    const grow = live ? clamp01(p / 0.2) : 1;
    const fade = 1 - clamp01((p - 0.8) / 0.2);
    const yy = y + 14 * clamp01((p - 0.2) / 0.6);
    const s = 0.4 + 0.6 * grow;
    out[`sweat${i}`] = { points: dropPoints(x, f(yy)), transform: `translate(${x} ${f(yy)}) scale(${s.toFixed(3)}) translate(${-x} ${f(-yy)})`, opacity: amount > 0.01 ? f(amount * fade) : 0 };
  });
  // Once it strains, drops of sweat are flung off it (only while it moves).
  const flung = live && !boom ? atLevel(LADDER.flung, lv) : 0;
  FLUNG.forEach(([x, y, dir], i) => {
    const amount = clamp01(flung - i);
    const p = (((t * 1.4 + i * 0.29) % 1) + 1) % 1;
    const fx = x + dir * 24 * p;
    const fy = y - 14 * p + 36 * p * p;
    out[`fling${i}`] = { points: dropPoints(f(fx), f(fy)), opacity: amount > 0.01 ? f(amount * (p < 0.1 ? p / 0.1 : 1 - (p - 0.1) / 0.9)) : 0 };
  });

  // The clamps are pushed open as the stress rises, creaking with each beat once it strains; the
  // burst springs them open, but they stay in the rig.
  let clamp = atLevel(LADDER.clamp, lv);
  if (live && !boom) clamp += atLevel(LADDER.creak, lv) * Math.sin(Math.PI * 2 * (motion.beat ?? 0));
  if (boom) {
    // They spring open as far as they go, bounce back a little and settle.
    [clamp] = keys([[0, -34], [0.35, CLAMP_BURST], [0.7, -33], [1, -37]], clamp01(bt / 0.6));
  }
  out.clampL = { transform: `rotate(${f(clamp)} 36 206)` };
  out.clampR = { transform: `rotate(${f(clamp)} 36 206)` };
  // The tray's lights go out one by one as the stress rises; past half way to the next, the next
  // one to go flickers.
  const gone = boom ? 4 : atLevel(LADDER.lightsOut, lv);
  const out_ = Math.floor(gone + 1e-9);
  order.forEach((light, i) => {
    let on = i >= out_;
    if (on && !boom && i === out_ && live && gone - out_ > 0.5) on = (t % 1.1) > lerp(0.12, 0.5, (gone - out_ - 0.5) * 2);
    out[`light${light}`] = { fill: on ? BULB : LIGHT_OFF };
  });
  out.dishcrack = { opacity: boom ? 1 : f(clamp01((g4 - 2.6) / 0.4)) };

  // The burst: the picker's splat, "BREACH!" and chunks flying out (it shows its end at once
  // with reduced motion).
  if (boom) {
    const p = clamp01(bt / 0.55);
    const [s, r] = keys([[0, 0.1, -20], [0.7, 1.08, -2], [1, 1, 0]], p);
    out.splat = { transform: `translate(120 120) rotate(${f(r)}) scale(${s.toFixed(3)}) translate(-120 -120)`, opacity: f(clamp01(p / 0.3)) };
    out.breach = { opacity: f(clamp01((bt - 0.3) / 0.2)) };
    CHUNKS.forEach((c, i) => {
      const q = clamp01((bt - c.delay) / 0.7);
      const e = 1 - (1 - q) ** 3;
      const d = c.dist * e;
      const x = 120 + Math.sin(c.a) * d;
      const y = 120 - Math.cos(c.a) * d;
      const sc = lerp(0.3, c.scale, e);
      out[`chunk${i}`] = { transform: `translate(${f(x)} ${f(y)}) rotate(${f((c.a * 180) / Math.PI)}) scale(${sc.toFixed(3)})`, opacity: q > 0 ? 1 : 0 };
    });
  } else {
    out.splat = { transform: "translate(120 120) scale(0.1) translate(-120 -120)", opacity: 0 };
    out.breach = { opacity: 0 };
    CHUNKS.forEach((c, i) => (out[`chunk${i}`] = { transform: "translate(120 120) scale(0.3)", opacity: 0 }));
  }
  return out;
}

/** The burst's chunks (the picker's: ten, at seeded angles, distances and sizes). */
export const CHUNKS = (() => {
  const r = rnd(5);
  return Array.from({ length: 10 }, (_, i) => {
    const a = ((i * 36 + r() * 20) * Math.PI) / 180;
    const dist = ((32 + r() * 18) / 96) * 240;
    const scale = 0.7 + r() * 0.8;
    const delay = r() * 0.12;
    return { a, dist, scale, delay };
  });
})();

/** The order the tray's four lights go out in, from the seed. */
export function lightOrder(seed = 7) {
  const r = rnd(pick(seed, 11));
  const o = [0, 1, 2, 3];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

/** Seconds a moment lasts: a reaction's face, the burst's flight. */
export const REACT_S = 1.4;
export const BURST_S = 1.1;
export { BODY_POINTS };
