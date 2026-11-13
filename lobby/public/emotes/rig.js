// The emotes as data: what a pawn and its arms do over time. Nothing here draws.
//
// An emote is pose(t, calm, reach): for a moment `t` ms into it, where the pawn's body and face
// are, where each hand is, what shape it makes and where its arm runs, and which props and
// effects are where. Both looks draw the same numbers: the flat room in SVG (emotes/svg.js), the
// 3D room with its arms as meshes (look3d/emote-arms.js) and its props in the same SVG.
//
// Coordinates are the pawn's own, in room units: x to the viewer's right, y up is negative, the
// foot at (0, 0), the head's centre at (0, -113), the shoulders at (+-19, -74). Things in "body"
// space move with the body's lean; "stage" space is the floor under the pawn, for things that
// fall or fly. An aimed emote is posed at a piece on the right, `reach` room units away; when the
// nearest piece is on the left, the drawing mirrors the pose (mirrorPose).
//
// The kit holds the rules (party-kit/client/emotes.js: which emotes exist, the cooldown); this
// file holds how each one moves, and the two lists must name the same emotes (a test checks).
//
// Limbs come in one style, always in the pawn's own colour and always on a stick arm from the
// shoulder, at three levels chosen per emote by what the action needs (`limbs`):
//   "none"     no arms: the body does it alone
//   "mitten"   a stick arm ending in a simple mitten: holding, waving, pointing (a mitten with one
//              finger out)
//   "hands"    a stick arm ending in a small cartoon hand with stubby fingers, where dexterity is
//              the point (a pinch, a clap, a thumb, a finger to the lips)
//
// A hand is {side, x, y, rot, s, sx, shape, style, arm}: side 1 is on the viewer's right, -1 on the
// left (drawn mirrored, thumbs toward the body); x, y is the wrist; rot turns it in degrees (0:
// fingers up); s is its size (0: tucked away), sx squashes it sideways (turned edge-on); shape is
// a set of numbers (HAND below), so shapes blend over time; style is "mitten" or "hands"; arm is
// {shoulder, elbow, wrist}, worked out from the wrist (two segments of ARM_SEGMENT each).

// ---------------------------------------------------------------- hand shapes

/**
 * A hand shape: how far each finger is curled (index, middle, ring, little: 0 straight, 1 in a
 * fist), how far they fan out, and the thumb: its angle (degrees from pointing along the fingers,
 * negative away from the palm, positive across it) and its curl. A mitten reads the same numbers:
 * its body curls with the fingers, the index finger stands out when it is straight and the others
 * are not, and the thumb is a lobe at that angle.
 */
export const HAND = {
  open: { f: [0, 0, 0, 0], spread: 1, ta: -55, tc: 0 },
  flat: { f: [0, 0, 0, 0], spread: 0, ta: -12, tc: 0 },
  fist: { f: [1, 1, 1, 1], spread: 0, ta: 40, tc: 0.75 },
  grip: { f: [0.82, 0.86, 0.88, 0.9], spread: 0, ta: 28, tc: 0.45 },
  pinch: { f: [0.5, 0.78, 0.86, 0.9], spread: 0.2, ta: 14, tc: 0.25 },
  point: { f: [0, 1, 1, 1], spread: 0, ta: 34, tc: 0.7 },
  thumb: { f: [1, 1, 1, 1], spread: 0, ta: -90, tc: 0 },
  claw: { f: [0.45, 0.45, 0.5, 0.5], spread: 0.6, ta: -20, tc: 0.3 },
  cup: { f: [0.35, 0.35, 0.4, 0.45], spread: 0.15, ta: -35, tc: 0.15 },
};

/** A shape between two others, `u` of the way from a to b. */
function mixShape(a, b, u) {
  const m = (x, y) => x + (y - x) * u;
  return { f: a.f.map((v, i) => m(v, b.f[i])), spread: m(a.spread, b.spread), ta: m(a.ta, b.ta), tc: m(a.tc, b.tc) };
}

// ---------------------------------------------------------------- timing helpers

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (u) => u * u * (3 - 2 * u);
export const EASE = {
  s: smooth,
  l: (u) => u,
  o: (u) => 1 - (1 - u) ** 3,
  i: (u) => u * u * u,
  b: (u) => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2,
};
/** A value along keys [[ms, value, ease?], ...]: the ease is how it gets to that key. */
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
/** Arms and props come in with a pop at the start of an emote and tuck away at its end. */
const appear = (t, dur, from = 0, inMs = 180, outMs = 220) => (t < from ? 0 : Math.min(EASE.b(clamp((t - from) / inMs, 0, 1)), clamp((dur - t) / outMs, 0, 1)));

// ---------------------------------------------------------------- arms

/** Each of an arm's two segments, as long as the room's stick arms of the second round. */
export const ARM_SEGMENT = 24;
const SHOULDER = { x: 19, y: -74 };
/** How far away an aimed emote's target stands when no piece is near: the preview's stage. */
export const REACH = 190;

/**
 * The arm to a wrist: a stick from the shoulder with one bend, the elbow out to the side. A wrist
 * further than the arm can reach is brought in to where it can.
 */
function armTo(side, wrist) {
  const sh = { x: side * SHOULDER.x, y: SHOULDER.y };
  let dx = wrist.x - sh.x;
  let dy = wrist.y - sh.y;
  let d = Math.hypot(dx, dy);
  const reach = ARM_SEGMENT * 2 - 0.5;
  if (d > reach) {
    dx *= reach / d;
    dy *= reach / d;
    d = reach;
  }
  const w = { x: sh.x + dx, y: sh.y + dy };
  const lift = Math.sqrt(Math.max(0, ARM_SEGMENT ** 2 - (d / 2) ** 2));
  const n = d > 0.01 ? { x: -dy / d, y: dx / d } : { x: side, y: 0 };
  // Of the two ways an elbow can bend, the one that points away from the body (and down).
  const sign = n.x * side + n.y * 0.3 >= 0 ? 1 : -1;
  const elbow = { x: sh.x + dx / 2 + n.x * lift * sign, y: sh.y + dy / 2 + n.y * lift * sign };
  return { shoulder: sh, elbow, wrist: w };
}

/** A hand on an arm: the wrist where it can be reached, its shape by name or numbers. */
function hand(side, x, y, rot, shape, s = 1, style = "mitten", sx = 1) {
  const arm = armTo(side, { x, y });
  return { side, x: arm.wrist.x, y: arm.wrist.y, rot, s, sx, style, arm, shape: typeof shape === "string" ? HAND[shape] : shape };
}

/** A point given in a hand's own frame (fingers up, before mirroring), in the space the hand is in. */
function held(h, lx, ly) {
  const r = (h.rot * Math.PI) / 180;
  const x = h.side * h.s * (h.sx ?? 1) * lx;
  const y = h.s * ly;
  return { x: h.x + x * Math.cos(r) - y * Math.sin(r), y: h.y + x * Math.sin(r) + y * Math.cos(r) };
}

/** A pose with everything at rest. */
function rest() {
  return {
    body: { x: 0, dx: 0, lift: 0, rot: 0, pivot: 0, sx: 1, sy: 1, tint: 0, hx: 0, hy: 0, hr: 0 },
    face: { eyes: "open", eye: 1, look: 0, up: 0, lid: 0, brows: null, mouth: null },
    hands: [],
    props: [],
    fx: [],
    other: { look: -3, sweat: null, flinch: 0 },
  };
}

const flipX = (o) => (o && typeof o.x === "number" ? { ...o, x: -o.x } : o);

/** The same pose for a target on the left: everything across the pawn's middle, turns the other way. */
export function mirrorPose(p) {
  const b = p.body;
  return {
    body: { ...b, x: -b.x, dx: -b.dx, rot: -b.rot, hx: -b.hx, hr: -b.hr },
    face: { ...p.face, look: -p.face.look },
    hands: p.hands.map((h) => ({ ...h, side: -h.side, x: -h.x, rot: -h.rot, arm: { shoulder: flipX(h.arm.shoulder), elbow: flipX(h.arm.elbow), wrist: flipX(h.arm.wrist) } })),
    props: p.props.map((x) => ({
      ...x,
      ...(typeof x.x === "number" ? { x: -x.x } : {}),
      ...(typeof x.rot === "number" ? { rot: -x.rot } : {}),
      ...(typeof x.x1 === "number" ? { x1: -x.x1, x2: -x.x2 } : {}),
      ...(x.bits ? { bits: x.bits.map((b2) => ({ ...b2, x: -b2.x, rot: -b2.rot })) } : {}),
    })),
    fx: p.fx.map((f) => ({ ...f, x: -f.x, ...(f.side ? { side: -f.side } : {}) })),
    other: { ...p.other, look: -p.other.look },
  };
}

// ---------------------------------------------------------------- the emotes

/**
 * Every candidate: {id, name, line, word, limbs, dur, hold, aimed, kept, pose(t, calm)}. `hold`
 * is the moment for stills and pictures; `word` the sticker; `aimed`: done at the piece on the
 * right; `limbs`: "none", "mitten" or "hands" (above).
 */
export const RIG = [
  {
    id: "popcorn",
    kept: true,
    limbs: "mitten",
    name: "Popcorn",
    line: "One mitten holds the bucket, the other picks, up to the mouth, chew. Now and then a piece falls.",
    word: "this is good",
    dur: 3800,
    hold: 1900,
    aimed: true,
    pose(t) {
      const p = rest();
      const on = appear(t, this.dur);
      p.face.look = 4;
      p.face.eye = 1.15;
      p.body.hr = 6 * on;
      const bucketHand = hand(-1, -40, -52, 20, "grip", on);
      p.hands.push(bucketHand);
      p.props.push({ kind: "bucket", x: -24, y: -60, rot: -6, s: on * 0.85 });
      const cycle = 1100;
      const c = Math.max(0, t - 300) % cycle;
      const n = Math.floor(Math.max(0, t - 300) / cycle);
      const reach = k(c, [[0, 0], [260, 1], [380, 1], [640, 0], [1100, 0]]); // 1: in the bucket
      const lift = k(c, [[0, 0], [380, 0], [640, 1, "o"], [760, 1], [1000, 0.2]]); // 1: at the mouth
      const wrist = { x: -14 + 22 * lift + 6 * (1 - reach), y: -70 + 10 * reach - 10 * lift };
      const pick = hand(1, wrist.x, wrist.y, -20 - 40 * lift, mixShape(HAND.grip, HAND.pinch, clamp(reach + lift, 0, 1)), on);
      p.hands.push(pick);
      const tips = held(pick, -2, -18);
      if (lift > 0.05 && lift < 0.98 && c < 760) for (const [dx, dy] of [[0, 0], [4, -3]]) p.props.push({ kind: "kernel", x: tips.x + dx, y: tips.y + dy, s: on });
      p.face.mouth = c > 640 && c < 1080 && t < this.dur - 300 ? (Math.floor(t / 120) % 2 ? "chew" : "flat") : on > 0.5 ? "smile" : null;
      if (n % 2 === 1 && c > 560) {
        const u = clamp((c - 560) / 380, 0, 1);
        p.props.push({ kind: "kernel", space: "stage", x: 10 + u * 16, y: -96 + u * u * 96, s: on });
      }
      return p;
    },
  },
  {
    id: "slowclap",
    kept: true,
    limbs: "hands",
    name: "Slow clap",
    line: "Two small flat hands meet palm to palm, three slow claps with a held beat between. Unimpressed eyes.",
    word: "*clap*",
    dur: 3200,
    hold: 1500,
    aimed: true,
    pose(t) {
      const p = rest();
      const on = appear(t, this.dur);
      p.face.eye = 0.5;
      p.face.lid = 0.55;
      p.face.look = 3;
      p.face.mouth = on > 0.5 ? "flat" : null;
      const claps = [700, 1500, 2300];
      let gap = 1;
      for (const c of claps) {
        const before = clamp((c - t) / 160, 0, 1);
        const after = clamp((t - c - 90) / 420, 0, 1);
        if (t <= c) gap = Math.min(gap, smooth(before));
        else gap = Math.min(gap, t < c + 90 ? 0 : smooth(after));
      }
      const x = 6 + 20 * gap;
      for (const side of [-1, 1]) p.hands.push(hand(side, side * x, -62, side * (-6 + 14 * gap), "flat", on, "hands", 0.75 + 0.25 * gap));
      const hit = claps.find((c) => t >= c && t < c + 240);
      if (hit !== undefined) p.fx.push({ kind: "clap", x: 0, y: -66, o: 1 - (t - hit) / 240 });
      return p;
    },
  },
  {
    id: "pointlaugh",
    kept: true,
    limbs: "mitten",
    name: "Point and laugh",
    line: "Points right at the nearest piece and shakes with laughter, a mitten on its belly. The target just stands there.",
    word: "HA HA",
    dur: 3000,
    hold: 1200,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const shake = on > 0.5 && !calm;
      p.body.rot = shake ? -5 + wave(t, 240, 4) : 0;
      p.body.lift = shake ? Math.abs(wave(t, 240, 6)) : 0;
      p.face.eyes = on > 0.5 ? "happy" : "open";
      p.face.mouth = on > 0.5 ? "laugh" : null;
      p.hands.push(hand(1, 62, -84, 92, "point", on));
      p.hands.push(hand(-1, -14, -48 + (shake ? wave(t, 240, 3) : 0), 24, "flat", on));
      if (on > 0.5 && (calm || Math.floor(t / 260) % 2)) p.fx.push({ kind: "text", text: "HA", x: -46, y: -146, size: 22 });
      if (on > 0.5 && (calm || Math.floor(t / 260) % 2 === 0)) p.fx.push({ kind: "text", text: "HA", x: 46, y: -150, size: 26 });
      // The target is not changed: a glance at the laugher, one drop of sweat.
      p.other.look = -3.5;
      p.other.sweat = t > 600 && t < this.dur - 300 ? clamp((t - 600) / 1400, 0, 1) : null;
      return p;
    },
  },
  {
    id: "redcard",
    limbs: "mitten",
    name: "Red card",
    line: "A mitten thrusts a red card up high at the target. Off you go.",
    word: "RED CARD",
    dur: 2700,
    hold: 1100,
    aimed: true,
    pose(t) {
      const p = rest();
      const on = appear(t, this.dur);
      const up = k(t, [[0, 0], [260, 1, "b"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 6 * up;
      p.face.brows = up > 0.5 ? "angry" : null;
      p.face.mouth = up > 0.5 ? "flat" : null;
      p.face.look = 3;
      const h = hand(1, 28 + 10 * up, -86 - 30 * up, 10 * up, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, -38);
      p.props.push({ kind: "card", x: at.x, y: at.y, rot: h.rot + 6, s: on });
      p.hands.push(hand(-1, -36, -54, 20, "fist", on * 0.95));
      return p;
    },
  },
  {
    id: "hurry",
    limbs: "mitten",
    name: "Hurry up",
    line: "One mitten holds up a stopwatch, the other taps it, again and again, hopping on the spot.",
    word: "hurry up!",
    dur: 2900,
    hold: 1150,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      p.body.lift = on > 0.5 && !calm ? Math.abs(wave(t, 380, 10)) : 0;
      p.face.eye = 1.2;
      p.face.look = 3;
      p.face.mouth = on > 0.5 ? "flat" : null;
      p.face.brows = on > 0.5 ? "up" : null;
      // Low enough that the tapping arm crosses the chest, not the face.
      const watch = hand(-1, -44, -62, -12, "grip", on);
      p.hands.push(watch);
      const face = held(watch, 0, -36);
      p.props.push({ kind: "stopwatch", x: face.x, y: face.y, rot: 0, s: on * 0.9, hand: calm ? 60 : (t / 3) % 360 });
      const tap = calm ? 0.5 : Math.max(0, Math.sin((t / 330) * Math.PI * 2));
      p.hands.push(hand(1, face.x + 30 - 10 * tap, face.y + 26 - 4 * tap, -56, "point", on));
      return p;
    },
  },
  {
    id: "thumbsup",
    limbs: "hands",
    name: "Thumbs up",
    line: "A small hand gives a big thumbs up, popping toward you, and a nod.",
    word: "nice!",
    dur: 2500,
    hold: 1000,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const pop = k(t, [[0, 0], [200, 0], [380, 1.35, "o"], [560, 1.18], [this.dur - 250, 1.18], [this.dur, 0]]);
      p.hands.push(hand(1, 50, -98, 90, "thumb", on * pop, "hands"));
      p.body.hy = on > 0.5 && !calm ? Math.max(0, wave(t, 520, 5)) : 0;
      p.face.eyes = on > 0.5 ? "happy" : "open";
      p.face.mouth = on > 0.5 ? "smile" : null;
      return p;
    },
  },
  {
    id: "confetti",
    limbs: "mitten",
    name: "Confetti",
    line: "Two mittens hold a party popper aimed at the target: one pulls the string, pop, confetti rains round them.",
    word: "yay!",
    dur: 3000,
    hold: 1050,
    aimed: true,
    pose(t, calm, reach = REACH) {
      const p = rest();
      const on = appear(t, this.dur);
      const popped = t > 520;
      p.face.eyes = popped && t < this.dur - 300 ? "happy" : "open";
      p.face.mouth = popped && t < this.dur - 300 ? "grin" : on > 0.5 ? "smile" : null;
      p.body.lift = t > 520 && t < 760 ? 10 : 0;
      const grip = hand(1, 36, -100, 30, "grip", on);
      p.hands.push(grip);
      const cone = held(grip, 0, -16);
      p.props.push({ kind: "popper", x: cone.x, y: cone.y, rot: 34, s: on * 0.85, popped });
      const pull = k(t, [[0, 0], [300, 0], [520, 1, "i"], [700, 1]]);
      p.hands.push(hand(-1, 24 - 34 * pull, -78 + 2 * pull, -10, "pinch", on));
      if (popped && t < this.dur - 200) {
        const colours = ["#ffe58a", "#4fc3b0", "#f05a7e", "#8fd3ff", "#f4b453", "#b79cf7"];
        const bits = [];
        for (let i = 0; i < 26; i++) {
          const u = clamp((t - 520) / 450, 0, 1);
          const fall = clamp((t - 970) / 1600, 0, 1);
          const spread = (i / 26 - 0.5) * 110;
          const x = 60 + (reach + spread - 60) * u + (calm ? 0 : wave(t + i * 97, 600, 6));
          const y = -170 - Math.sin(u * Math.PI) * 60 + fall * (110 + (i % 5) * 18);
          bits.push({ x, y, rot: (t / 4 + i * 40) % 360, c: colours[i % colours.length] });
        }
        p.props.push({ kind: "confetti", space: "stage", bits });
      }
      return p;
    },
  },
  {
    id: "boo",
    limbs: "hands",
    name: "Boo",
    line: "Two small hands, thumbs down, shaken at the target.",
    word: "BOO",
    dur: 2700,
    hold: 1100,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const shake = calm ? 0 : wave(t, 230, 6);
      p.hands.push(hand(1, 50, -66 + shake, -90, "thumb", on * 1.15, "hands"));
      p.hands.push(hand(-1, -50, -66 - shake, 90, "thumb", on * 1.15, "hands"));
      p.face.mouth = on > 0.5 ? "o" : null;
      p.face.brows = on > 0.5 ? "angry" : null;
      p.face.look = 3;
      p.body.dx = on > 0.5 && !calm ? wave(t, 230, 2) : 0;
      return p;
    },
  },
  {
    id: "trophy",
    limbs: "mitten",
    name: "GG",
    line: "Two mittens hold out a gold trophy to the target, with a little bow.",
    word: "GG",
    dur: 2800,
    hold: 1250,
    aimed: true,
    pose(t) {
      const p = rest();
      const on = appear(t, this.dur);
      const out = k(t, [[0, 0], [420, 1, "o"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 8 * out;
      p.face.eyes = out > 0.5 ? "happy" : "open";
      p.face.mouth = out > 0.5 ? "smile" : null;
      const cx = 34 + 8 * out;
      p.props.push({ kind: "trophy", x: cx, y: -100, rot: 0, s: on * 1.1, shine: t > 600 && t < this.dur - 400 });
      p.hands.push(hand(1, cx + 18, -86, -36, "grip", on));
      p.hands.push(hand(-1, cx - 18, -86, 36, "grip", on));
      return p;
    },
  },
  {
    id: "shush",
    limbs: "hands",
    name: "Shh",
    line: "Leans toward the target, one small finger to its lips, and a little puff: shh.",
    word: "shh",
    dur: 2600,
    hold: 1150,
    aimed: true,
    pose(t) {
      const p = rest();
      const on = appear(t, this.dur);
      const lean = k(t, [[0, 0], [300, 1, "o"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 9 * lean;
      p.body.hr = 4 * lean;
      p.face.eye = 0.75;
      p.face.lid = 0.35 * lean;
      p.face.look = 3;
      p.face.mouth = lean > 0.5 ? "purse" : null;
      // The fingertip on the lips: the wrist sits just below the chin.
      p.hands.push(hand(1, 5, -80, -4, "point", on, "hands"));
      const u = clamp((t - 450) / 900, 0, 1);
      if (t > 450 && t < this.dur - 200) p.fx.push({ kind: "puff", text: "shh", x: 30 + 70 * u, y: -102 - 18 * u, s: 0.6 + 0.5 * u, o: 1 - u * 0.7 });
      return p;
    },
  },
  {
    id: "lighter",
    limbs: "mitten",
    name: "Lighter up",
    line: "Sways slowly, eyes closed, singing; one mitten raises a lighter, flicks it on and waves it side to side.",
    word: "♪ ♪",
    dur: 4200,
    hold: 2000,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const sway = calm ? 0 : wave(t, 2400, 1);
      p.body.rot = 5 * sway * on;
      p.body.hr = -4 * sway * on;
      p.face.eyes = on > 0.5 ? "shut" : "open";
      p.face.mouth = on > 0.5 ? (Math.floor(t / 500) % 2 ? "o" : "smile") : null;
      const up = k(t, [[0, 0], [400, 1, "o"]]);
      const h = hand(1, 30 + 12 * sway, -88 - 32 * up, 8 * sway, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, -14);
      const lit = t > 800 && t < this.dur - 250;
      p.props.push({ kind: "lighter", x: at.x, y: at.y, rot: h.rot, s: on * 0.85, lit: lit ? 1 : 0, flicker: calm ? 0 : t / 70, spark: t > 760 && t < 880 });
      p.hands.push(hand(-1, -12, -60, 24, "flat", on * 0.95));
      if (lit) {
        for (let i = 0; i < 2; i++) {
          const u = ((((t - 900 - i * 700) % 1400) + 1400) % 1400) / 1400;
          p.fx.push({ kind: "note", x: -24 - i * 12 - u * 18, y: -140 - u * 46, o: 1 - u });
        }
      }
      return p;
    },
  },
  {
    id: "scratch",
    limbs: "hands",
    name: "Huh?",
    line: "One small hand scratches the side of its head, eyes drifting up, thinking it over.",
    word: "hmm?",
    dur: 2800,
    hold: 1200,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const s = calm ? 0 : wave(t, 160, 1);
      p.body.hr = -8 * on;
      p.face.up = 3 * on;
      p.face.look = -2 * on;
      p.face.mouth = on > 0.5 ? "squiggle" : null;
      p.face.brows = on > 0.5 ? "sus" : null;
      // Fingers on the side of the head, clear of the eyes.
      p.hands.push(hand(1, 44 + 1.5 * s, -112 + 2 * s, -55, "claw", on, "hands"));
      return p;
    },
  },
  {
    id: "steam",
    limbs: "none",
    name: "Fuming",
    line: "No arms at all: goes red, steam out of the head, shaking, little stomps.",
    word: "grr",
    dur: 2900,
    hold: 1250,
    pose(t, calm) {
      const p = rest();
      const red = k(t, [[0, 0], [200, 0], [800, 0.85], [this.dur - 350, 0.85], [this.dur, 0]]);
      p.body.tint = red;
      p.face.brows = red > 0.3 ? "angry" : null;
      p.face.mouth = red > 0.3 ? "grit" : null;
      p.face.eye = 0.7;
      p.body.lift = red > 0.5 && !calm ? Math.max(0, wave(t, 340, 9)) : 0;
      p.body.dx = red > 0.4 && !calm ? wave(t, 45, 1.6) : 0;
      for (const [i, side] of [-1, 1].entries()) {
        const u = calm ? 0.3 : ((t + i * 250) % 600) / 600;
        if (red > 0.4) p.fx.push({ kind: "steam", side, x: side * 24, y: -134 - u * 16, o: 1 - u, onHead: true });
      }
      return p;
    },
  },
  {
    id: "tomato",
    limbs: "mitten",
    name: "Throw a tomato",
    line: "A stick arm winds up and lobs a tomato at the nearest piece. It splats on the floor in front of them and fades; they only flinch.",
    word: "splat!",
    dur: 2600,
    hold: 1080,
    aimed: true,
    pose(t, calm, reach = REACH) {
      const p = rest();
      const on = appear(t, this.dur);
      const RELEASE = 560;
      const LAND = 1000;
      // The arm: back over the shoulder, a beat, then over the top and through.
      const back = k(t, [[0, 0], [160, 0], [440, 1, "o"], [RELEASE - 40, 1.05], [RELEASE + 80, -0.6, "i"], [900, -0.4], [this.dur - 250, 0]]);
      p.body.rot = -6 * Math.max(0, back) + 9 * Math.max(0, -back) * 1.4;
      p.body.hr = -4 * Math.max(0, back);
      p.face.look = 3;
      p.face.eye = t > LAND - 80 && t < LAND + 900 ? 1.2 : 1;
      p.face.mouth = t < RELEASE ? "flat" : t < LAND + 1200 ? "grin" : on > 0.5 ? "smile" : null;
      p.face.brows = t < RELEASE && on > 0.5 ? "angry" : null;
      const wx = 30 - 40 * Math.max(0, back) + 38 * Math.max(0, -back);
      const wy = -96 - 22 * Math.max(0, back) + 8 * Math.max(0, -back);
      const thrower = hand(1, wx, wy, -50 * back, t < RELEASE ? "grip" : "open", on);
      p.hands.push(thrower);
      p.hands.push(hand(-1, -34, -56, 18, "fist", on * 0.95));
      // The tomato: in the hand, then a lob to the floor just short of the target.
      const target = Math.max(70, reach - 34);
      if (t < RELEASE) {
        const at = held(thrower, 0, -14);
        p.props.push({ kind: "tomato", x: at.x, y: at.y, rot: 0, s: on });
      } else if (t < LAND) {
        const u = (t - RELEASE) / (LAND - RELEASE);
        const x0 = 62;
        const y0 = -120;
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
      p.other.look = -3;
      return p;
    },
  },
];

const BY_ID = new Map(RIG.map((e) => [e.id, e]));

/** How an emote moves, by its id; undefined for an id this page does not know. */
export const rigById = (id) => BY_ID.get(id);
