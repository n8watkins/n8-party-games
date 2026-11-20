// The ghost's emotes as data: what the ghost, its hands and its props do over time. Nothing here draws.
//
// Same terms as the pawn's emotes (lobby/public/emotes/rig.js), so the room can take this file as
// it is: an emote is pose(t, calm, reach, take), and a pose is {body, face, hands, props, fx,
// other} with the same fields, the same hand shapes (HAND) and the same prop and effect kinds
// (lobby/public/emotes/svg.js draws them unchanged). The ids, names, words, durations and the
// moments things happen (the three claps, the pop, the flick of the lighter) are the pawn's, so
// each emote's recording fits both characters.
//
// What is the ghost's own:
//   - its measurements (GHOST below): a shorter, wider body with the face lower down, floating
//     above the floor, and no shoulders. An arm starts at the side of the sheet, where its little
//     nub arms are.
//   - a `take`: how the hands are joined to the body.
//       "float"  detached hands, as the pawn's hands are but with no arm: they hang in the air
//       "wisp"   the sheet itself reaches out: a tapering wisp from the ghost's side to the hand
//       "haunt"  no hands at all: the prop floats by itself beside the ghost
//   - pose.ghost = {limb, yaw, puff, nubs}: the take; how far the face is turned toward the target
//     (radians); how much the body swells (0: none); whether its own nub arms show (0 to 1).
//
// Coordinates are the pawn rig's: room units, x to the viewer's right, y up is negative, (0, 0)
// under the middle of the ghost at the height its hem would touch if it stood. The ghost hovers:
// "body" space rides up and down with it, "stage" space is the floor under it.
import { EASE, HAND, REACH, clamp, mirrorPose } from "../../../lobby/public/emotes/rig.js";

/** The ghost's measurements in rig units (the approved model: 0.96 tall, 0.27 wide, hem at 0.2). */
export const GHOST = {
  top: -121,
  eyeY: -91,
  mouthY: -73.5,
  /** How far the mouth sits from the middle line at a quarter turn. */
  faceOut: 33,
  half: 34,
  hem: -25,
  /** Where an arm leaves the body: the side of the sheet, at the nub arms. */
  root: { x: 31, y: -62 },
  /** How far it turns its face to the piece it is aiming at, when a pose says nothing else. */
  yaw: 0.32,
  /** How high the hem floats over the floor at rest. */
  hover: 15,
};

export const TAKES = [
  { id: "float", name: "Hands", what: "Detached hands in the ghost's colour, floating beside it" },
  { id: "wisp", name: "Wisps", what: "The sheet itself reaches out and forms the hand" },
  { id: "haunt", name: "Haunted", what: "No hands: the prop floats by itself" },
];

// ---------------------------------------------------------------- timing helpers (as in rig.js)

const smooth = (u) => u * u * (3 - 2 * u);
function k(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e = "s"] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * EASE[e]((t - t0) / Math.max(1, t1 - t0));
  }
  return keys[keys.length - 1][1];
}
const wave = (t, ms, amp = 1, phase = 0) => Math.sin((t / ms) * Math.PI * 2 + phase) * amp;
const appear = (t, dur, from = 0, inMs = 180, outMs = 220) => (t < from ? 0 : Math.min(EASE.b(clamp((t - from) / inMs, 0, 1)), clamp((dur - t) / outMs, 0, 1)));
function mixShape(a, b, u) {
  const m = (x, y) => x + (y - x) * u;
  return { f: a.f.map((v, i) => m(v, b.f[i])), spread: m(a.spread, b.spread), ta: m(a.ta, b.ta), tc: m(a.tc, b.tc) };
}

// ---------------------------------------------------------------- arms

/**
 * The arm to a wrist: from the side of the sheet, with one soft bend that sags away from the
 * body. A wisp stretches, so unlike the pawn's stick arm it has no fixed length.
 */
function armTo(side, wrist) {
  const sh = { x: side * GHOST.root.x, y: GHOST.root.y };
  const dx = wrist.x - sh.x;
  const dy = wrist.y - sh.y;
  const d = Math.hypot(dx, dy);
  const n = d > 0.01 ? { x: -dy / d, y: dx / d } : { x: side, y: 0 };
  const sign = n.x * side + n.y * 0.3 >= 0 ? 1 : -1;
  const sag = 4 + d * 0.16;
  return { shoulder: sh, elbow: { x: sh.x + dx / 2 + n.x * sag * sign, y: sh.y + dy / 2 + n.y * sag * sign }, wrist: { x: wrist.x, y: wrist.y } };
}

function hand(side, x, y, rot, shape, s = 1, style = "mitten", sx = 1) {
  return { side, x, y, rot, s, sx, style, arm: armTo(side, { x, y }), shape: typeof shape === "string" ? HAND[shape] : shape };
}

/** A point given in a hand's own frame (fingers up, before mirroring), in the space the hand is in. */
function held(h, lx, ly) {
  const r = (h.rot * Math.PI) / 180;
  const x = h.side * h.s * (h.sx ?? 1) * lx;
  const y = h.s * ly;
  return { x: h.x + x * Math.cos(r) - y * Math.sin(r), y: h.y + x * Math.sin(r) + y * Math.cos(r) };
}

function rest() {
  return {
    body: { x: 0, dx: 0, lift: 0, rot: 0, pivot: 0, sx: 1, sy: 1, tint: 0, hx: 0, hy: 0, hr: 0 },
    face: { eyes: "open", eye: 1, look: 0, up: 0, lid: 0, brows: null, mouth: null },
    hands: [],
    props: [],
    fx: [],
    other: { look: -3, sweat: null, flinch: 0 },
    ghost: { limb: "float", yaw: GHOST.yaw, puff: 0, nubs: 0 },
  };
}

/** Where the mouth is for a pose's turn of the face. */
const mouthAt = (yaw) => ({ x: Math.sin(yaw) * GHOST.faceOut, y: GHOST.mouthY });

/**
 * Finishes a pose for its take. "haunt" takes the hands away and lets what they held bob in the
 * air; the ghost's own nub arms stay. With hands, the nubs are tucked away: they become the hands.
 */
function finish(p, take, t, calm, on) {
  p.ghost.limb = take;
  if (take === "haunt") {
    p.hands = [];
    p.ghost.nubs = 1;
    if (!calm)
      for (const [i, x] of p.props.entries()) {
        if (x.space === "stage" || typeof x.y !== "number") continue;
        x.y += wave(t, 1100, 3.5, i);
        if (typeof x.rot === "number") x.rot += wave(t, 1500, 5, i * 2);
      }
  } else p.ghost.nubs = p.hands.length ? 1 - clamp(on, 0, 1) : 1;
  return p;
}

// ---------------------------------------------------------------- the emotes

/**
 * Every emote: {id, name, word, dur, hold, aimed, takes, pose(t, calm, reach, take)}. `takes` are
 * the ones worth showing; the first is the default.
 */
export const GHOST_RIG = [
  {
    id: "popcorn",
    name: "Popcorn",
    word: "this is good",
    dur: 3800,
    hold: 1900,
    aimed: true,
    takes: ["wisp", "float", "haunt"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      p.face.eye = 1.15;
      // The bucket sits low at its side, clear of the face, which is lower on a ghost than on a pawn.
      const bucketHand = hand(-1, -46, -34, 20, "grip", on);
      p.hands.push(bucketHand);
      p.props.push({ kind: "bucket", x: -29, y: -42, rot: -6, s: on * 0.85 });
      const cycle = 1100;
      const c = Math.max(0, t - 300) % cycle;
      const n = Math.floor(Math.max(0, t - 300) / cycle);
      const dip = k(c, [[0, 0], [260, 1], [380, 1], [640, 0], [1100, 0]]); // 1: in the bucket
      const lift = k(c, [[0, 0], [380, 0], [640, 1, "o"], [760, 1], [1000, 0.2]]); // 1: at the mouth
      const m = mouthAt(p.ghost.yaw);
      const wrist = { x: -19 + (m.x + 37) * lift + 4 * (1 - dip), y: -52 + 9 * dip + (m.y + 61) * lift };
      const pick = hand(1, wrist.x, wrist.y, -20 - 40 * lift, mixShape(HAND.grip, HAND.pinch, clamp(dip + lift, 0, 1)), on);
      p.hands.push(pick);
      const tips = held(pick, -2, -18);
      if (lift > 0.05 && lift < 0.98 && c < 760) for (const [dx, dy] of [[0, 0], [4, -3]]) p.props.push({ kind: "kernel", x: tips.x + dx, y: tips.y + dy, s: on });
      p.face.mouth = c > 640 && c < 1080 && t < this.dur - 300 ? (Math.floor(t / 120) % 2 ? "chew" : "flat") : on > 0.5 ? "smile" : null;
      if (n % 2 === 1 && c > 560) {
        const u = clamp((c - 560) / 380, 0, 1);
        const from = GHOST.mouthY - GHOST.hover;
        p.props.push({ kind: "kernel", space: "stage", x: m.x + 6 + u * 16, y: from - from * u * u, s: on });
      }
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "slowclap",
    name: "Slow clap",
    word: "*clap*",
    dur: 3200,
    hold: 1500,
    aimed: true,
    takes: ["float", "wisp"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      p.face.eye = 0.5;
      p.face.lid = 0.55;
      p.face.mouth = on > 0.5 ? "flat" : null;
      p.ghost.yaw = 0.2;
      const claps = [700, 1500, 2300];
      let gap = 1;
      for (const c of claps) {
        const before = clamp((c - t) / 160, 0, 1);
        const after = clamp((t - c - 90) / 420, 0, 1);
        if (t <= c) gap = Math.min(gap, smooth(before));
        else gap = Math.min(gap, t < c + 90 ? 0 : smooth(after));
      }
      // In front of the chest, under the mouth: the hands must not hide the face.
      const x = 7 + 22 * gap;
      for (const side of [-1, 1]) p.hands.push(hand(side, 4 + side * x, -46, side * (-6 + 14 * gap), "flat", on, "hands", 0.75 + 0.25 * gap));
      const hit = claps.find((c) => t >= c && t < c + 240);
      if (hit !== undefined) p.fx.push({ kind: "clap", x: 4, y: -66, o: 1 - (t - hit) / 240 });
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "pointlaugh",
    name: "Point and laugh",
    word: "HA HA",
    dur: 3000,
    hold: 1200,
    aimed: true,
    takes: ["wisp", "float"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const shake = on > 0.5 && !calm;
      p.body.rot = shake ? -5 + wave(t, 240, 4) : 0;
      p.body.lift = shake ? Math.abs(wave(t, 240, 6)) : 0;
      p.face.eyes = on > 0.5 ? "happy" : "open";
      p.face.mouth = on > 0.5 ? "laugh" : null;
      p.hands.push(hand(1, 62, -70, 92, "point", on));
      p.hands.push(hand(-1, -12, -36 + (shake ? wave(t, 240, 3) : 0), 24, "flat", on));
      if (on > 0.5 && (calm || Math.floor(t / 260) % 2)) p.fx.push({ kind: "text", text: "HA", x: -54, y: -104, size: 22 });
      if (on > 0.5 && (calm || Math.floor(t / 260) % 2 === 0)) p.fx.push({ kind: "text", text: "HA", x: 58, y: -112, size: 26 });
      // The target is not changed: a glance at the laugher, one drop of sweat.
      p.other.look = -3.5;
      p.other.sweat = t > 600 && t < this.dur - 300 ? clamp((t - 600) / 1400, 0, 1) : null;
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "redcard",
    name: "Red card",
    word: "RED CARD",
    dur: 2700,
    hold: 1100,
    aimed: true,
    takes: ["wisp", "float", "haunt"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const up = k(t, [[0, 0], [260, 1, "b"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 6 * up;
      p.face.brows = up > 0.5 ? "angry" : null;
      p.face.mouth = up > 0.5 ? "flat" : null;
      p.face.eye = 0.8;
      const h = hand(1, 36 + 12 * up, -72 - 30 * up, 10 * up, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, -38);
      p.props.push({ kind: "card", x: at.x, y: at.y, rot: h.rot + 6, s: on });
      // A hand on the hip needs an arm to read as one: floating by itself it is only a blob.
      if (take === "wisp") p.hands.push(hand(-1, -44, -44, 20, "fist", on * 0.95));
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "hurry",
    name: "Hurry up",
    word: "hurry up!",
    dur: 2900,
    hold: 1150,
    aimed: true,
    takes: ["float", "wisp", "haunt"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      p.body.lift = on > 0.5 && !calm ? Math.abs(wave(t, 380, 10)) : 0;
      p.face.eye = 1.2;
      p.face.mouth = on > 0.5 ? "flat" : null;
      // The stopwatch is held out on the target's side, where they can see it; the other hand comes across to tap it.
      const watch = hand(1, 58, -50, 8, "grip", on);
      p.hands.push(watch);
      const face = held(watch, 0, -36);
      p.props.push({ kind: "stopwatch", x: face.x, y: face.y, rot: 0, s: on * 0.9, hand: calm ? 60 : (t / 3) % 360 });
      const tap = calm ? 0.5 : Math.max(0, Math.sin((t / 330) * Math.PI * 2));
      p.hands.push(hand(-1, face.x - 34 + 10 * tap, face.y + 20 - 4 * tap, 56, "point", on));
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "thumbsup",
    name: "Thumbs up",
    word: "nice!",
    dur: 2500,
    hold: 1000,
    aimed: true,
    takes: ["wisp", "float"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const pop = k(t, [[0, 0], [200, 0], [380, 1.35, "o"], [560, 1.18], [this.dur - 250, 1.18], [this.dur, 0]]);
      p.hands.push(hand(1, 60, -80, 90, "thumb", on * pop, "hands"));
      // A ghost has no neck to nod with: it dips its whole body.
      p.body.lift = on > 0.5 && !calm ? -Math.max(0, wave(t, 520, 5)) : 0;
      p.face.eye = 1.12;
      p.face.mouth = on > 0.5 ? "smile" : null;
      return finish(p, take, t, calm, on * Math.min(1, pop));
    },
  },
  {
    id: "confetti",
    name: "Confetti",
    word: "yay!",
    dur: 3000,
    hold: 1050,
    aimed: true,
    takes: ["wisp", "float"],
    pose(t, calm, reach = REACH, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const popped = t > 520;
      p.face.eye = popped && t < this.dur - 300 ? 1.15 : 1;
      p.face.mouth = popped && t < this.dur - 300 ? "grin" : on > 0.5 ? "smile" : null;
      p.body.lift = t > 520 && t < 760 ? 10 : 0;
      const grip = hand(1, 46, -84, 30, "grip", on);
      p.hands.push(grip);
      const cone = held(grip, 0, -16);
      p.props.push({ kind: "popper", x: cone.x, y: cone.y, rot: 34, s: on * 0.85, popped });
      const pull = k(t, [[0, 0], [300, 0], [520, 1, "i"], [700, 1]]);
      p.hands.push(hand(-1, 34 - 26 * pull, -50 + 4 * pull, -10, "pinch", on));
      if (popped && t < this.dur - 200) {
        const colours = ["#ffe58a", "#4fc3b0", "#f05a7e", "#8fd3ff", "#f4b453", "#b79cf7"];
        const bits = [];
        for (let i = 0; i < 26; i++) {
          const u = clamp((t - 520) / 450, 0, 1);
          const fall = clamp((t - 970) / 1600, 0, 1);
          const spread = (i / 26 - 0.5) * 110;
          const x = 68 + (reach + spread - 68) * u + (calm ? 0 : wave(t + i * 97, 600, 6));
          const y = -160 - Math.sin(u * Math.PI) * 56 + fall * (104 + (i % 5) * 18);
          bits.push({ x, y, rot: (t / 4 + i * 40) % 360, c: colours[i % colours.length] });
        }
        p.props.push({ kind: "confetti", space: "stage", bits });
      }
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "boo",
    name: "Boo",
    word: "BOO",
    dur: 2700,
    hold: 1100,
    aimed: true,
    takes: ["float", "wisp"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const shake = calm ? 0 : wave(t, 230, 6);
      p.hands.push(hand(1, 62, -70 + shake, -90, "thumb", on * 1.15, "hands"));
      p.hands.push(hand(-1, -62, -70 - shake, 90, "thumb", on * 1.15, "hands"));
      p.face.mouth = on > 0.5 ? "frown" : null;
      p.face.brows = on > 0.5 ? "angry" : null;
      p.face.eye = 0.7;
      p.ghost.yaw = 0.2;
      p.body.dx = on > 0.5 && !calm ? wave(t, 230, 2) : 0;
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "trophy",
    name: "GG",
    word: "GG",
    dur: 2800,
    hold: 1250,
    aimed: true,
    takes: ["float", "wisp", "haunt"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const out = k(t, [[0, 0], [420, 1, "o"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 8 * out;
      p.face.eye = 1.1;
      p.face.mouth = out > 0.5 ? "smile" : null;
      const cx = 50 + 12 * out;
      p.props.push({ kind: "trophy", x: cx, y: -84, rot: 0, s: on * 1.1, shine: t > 600 && t < this.dur - 400 });
      p.hands.push(hand(1, cx + 18, -70, -36, "grip", on));
      p.hands.push(hand(-1, cx - 18, -70, 36, "grip", on));
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "shush",
    name: "Shh",
    word: "shh",
    dur: 2600,
    hold: 1150,
    aimed: true,
    takes: ["float", "wisp"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const lean = k(t, [[0, 0], [300, 1, "o"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 9 * lean;
      p.face.eye = 0.75;
      p.face.lid = 0.35 * lean;
      p.face.mouth = lean > 0.5 ? "purse" : null;
      p.ghost.yaw = 0.18;
      // The fingertip on the lips. The index finger of a hand this size ends 7 to the side of the wrist and 28 above it.
      const m = mouthAt(p.ghost.yaw);
      p.hands.push(hand(1, m.x + 7, m.y + 23, -4, "point", on, "hands"));
      const u = clamp((t - 450) / 900, 0, 1);
      if (t > 450 && t < this.dur - 200) p.fx.push({ kind: "puff", text: "shh", x: 38 + 70 * u, y: -84 - 18 * u, s: 0.6 + 0.5 * u, o: 1 - u * 0.7 });
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "lighter",
    name: "Lighter up",
    word: "♪ ♪",
    dur: 4200,
    hold: 2000,
    takes: ["wisp", "float", "haunt"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const sway = calm ? 0 : wave(t, 2400, 1);
      p.body.rot = 5 * sway * on;
      p.face.eyes = on > 0.5 ? "shut" : "open";
      p.face.mouth = on > 0.5 ? (Math.floor(t / 500) % 2 ? "o" : "smile") : null;
      p.ghost.yaw = 0;
      const up = k(t, [[0, 0], [400, 1, "o"]]);
      const h = hand(1, 40 + 12 * sway, -74 - 30 * up, 8 * sway, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, -14);
      const lit = t > 800 && t < this.dur - 250;
      p.props.push({ kind: "lighter", x: at.x, y: at.y, rot: h.rot, s: on * 0.85, lit: lit ? 1 : 0, flicker: calm ? 0 : t / 70, spark: t > 760 && t < 880 });
      p.hands.push(hand(-1, -10, -40, 24, "flat", on * 0.95));
      if (lit) {
        for (let i = 0; i < 2; i++) {
          const u = ((((t - 900 - i * 700) % 1400) + 1400) % 1400) / 1400;
          p.fx.push({ kind: "note", x: -30 - i * 12 - u * 18, y: -122 - u * 46, o: 1 - u });
        }
      }
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "scratch",
    name: "Huh?",
    word: "hmm?",
    dur: 2800,
    hold: 1200,
    takes: ["float", "wisp"],
    pose(t, calm, reach, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const s = calm ? 0 : wave(t, 160, 1);
      p.body.rot = -5 * on;
      p.face.up = 3 * on;
      p.face.mouth = on > 0.5 ? "squiggle" : null;
      p.ghost.yaw = 0.1;
      // Fingers on the side of the head, above the eyes and clear of them.
      p.hands.push(hand(1, 40 + 1.5 * s, -98 + 2 * s, -50, "claw", on, "hands"));
      return finish(p, take, t, calm, on);
    },
  },
  {
    id: "steam",
    name: "Fuming",
    word: "grr",
    dur: 2900,
    hold: 1250,
    takes: ["float"],
    pose(t, calm, reach, take) {
      const p = rest();
      const red = k(t, [[0, 0], [200, 0], [800, 0.85], [this.dur - 350, 0.85], [this.dur, 0]]);
      p.body.tint = red;
      p.face.brows = red > 0.3 ? "angry" : null;
      p.face.mouth = red > 0.3 ? "grit" : null;
      p.face.eye = 0.7;
      // No feet to stomp with: it swells up and bounces on the spot.
      p.ghost.puff = 0.1 * red;
      p.ghost.yaw = 0.1;
      p.body.lift = red > 0.5 && !calm ? Math.max(0, wave(t, 340, 9)) : 0;
      p.body.dx = red > 0.4 && !calm ? wave(t, 45, 1.6) : 0;
      for (const [i, side] of [-1, 1].entries()) {
        const u = calm ? 0.3 : ((t + i * 250) % 600) / 600;
        if (red > 0.4) p.fx.push({ kind: "steam", side, x: side * 22, y: GHOST.top + 4 - u * 16, o: 1 - u });
      }
      p.ghost.limb = "none";
      p.ghost.nubs = 1;
      return p;
    },
  },
  {
    id: "tomato",
    name: "Throw a tomato",
    word: "splat!",
    dur: 2600,
    hold: 1080,
    aimed: true,
    takes: ["wisp", "float"],
    pose(t, calm, reach = REACH, take) {
      const p = rest();
      const on = appear(t, this.dur);
      const RELEASE = 560;
      const LAND = 1000;
      // The arm: back over the shoulder, a beat, then over the top and through.
      const back = k(t, [[0, 0], [160, 0], [440, 1, "o"], [RELEASE - 40, 1.05], [RELEASE + 80, -0.6, "i"], [900, -0.4], [this.dur - 250, 0]]);
      p.body.rot = -6 * Math.max(0, back) + 9 * Math.max(0, -back) * 1.4;
      p.face.eye = t > LAND - 80 && t < LAND + 900 ? 1.2 : 1;
      p.face.mouth = t < RELEASE ? "flat" : t < LAND + 1200 ? "grin" : on > 0.5 ? "smile" : null;
      p.face.brows = t < RELEASE && on > 0.5 ? "angry" : null;
      const wx = 38 - 44 * Math.max(0, back) + 36 * Math.max(0, -back);
      const wy = -86 - 26 * Math.max(0, back) + 10 * Math.max(0, -back);
      const thrower = hand(1, wx, wy, -50 * back, t < RELEASE ? "grip" : "open", on);
      p.hands.push(thrower);
      if (take === "wisp") p.hands.push(hand(-1, -44, -44, 18, "fist", on * 0.95));
      // The tomato: in the hand, then a lob to the floor just short of the target.
      const target = Math.max(70, reach - 34);
      if (t < RELEASE) {
        const at = held(thrower, 0, -14);
        p.props.push({ kind: "tomato", x: at.x, y: at.y, rot: 0, s: on });
      } else if (t < LAND) {
        const u = (t - RELEASE) / (LAND - RELEASE);
        const x0 = 66;
        const y0 = -110 - GHOST.hover;
        const x = x0 + (target - x0) * u;
        const y = y0 * (1 - u) - Math.sin(u * Math.PI) * 70 - 6 * u;
        p.props.push({ kind: "tomato", space: "stage", x, y, rot: calm ? 0 : u * 540, s: 1 });
      }
      if (t >= LAND) {
        // The splat: a flat smear on the floor that slides a little and fades, nowhere near the target's body.
        const u = clamp((t - LAND) / (this.dur - LAND - 150), 0, 1);
        const pop = calm ? 1 : EASE.b(clamp((t - LAND) / 140, 0, 1));
        p.props.push({ kind: "splat", space: "stage", x: target + 6 * u, y: -2, s: pop, o: 1 - u * u });
      }
      // The target only flinches: a jolt and a glance, then nothing.
      p.other.flinch = t >= LAND && t < LAND + 420 ? 1 - (t - LAND) / 420 : 0;
      return finish(p, take, t, calm, on);
    },
  },
];

const BY_ID = new Map(GHOST_RIG.map((e) => [e.id, e]));
export const ghostRigById = (id) => BY_ID.get(id);

/** The same pose for a target on the left. */
export function mirrorGhostPose(p) {
  return { ...mirrorPose(p), ghost: { ...p.ghost, yaw: -p.ghost.yaw } };
}

/** How high a pose reaches above the floor line (negative up): for the sticker. */
export function ghostPoseTop(pose) {
  const tops = pose.hands.filter((h) => h.s > 0.3).map((h) => h.y - 30);
  // A lit lighter's flame stands well above it.
  const props = pose.props.filter((x) => x.space !== "stage" && typeof x.y === "number").map((x) => x.y - (x.kind === "lighter" ? 64 : 40));
  return Math.min(GHOST.top - 14, ...tops, ...props) - Math.max(0, pose.body.lift);
}
