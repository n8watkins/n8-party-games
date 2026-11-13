// The emotes as data: what a pawn and its two floating hands do over time. Nothing here draws.
//
// An emote is pose(t): for a moment `t` ms into it, where the pawn's body and face are, where
// each hand is and what shape it makes, and which props and effects are where. A drawing turns
// that into pictures: the flat SVG room (draw.js) today, a 3D room later, from the same numbers.
//
// Coordinates are the pawn's own, in room units: x to the viewer's right, y up is negative, the
// foot at (0, 0), the head's centre at (0, -113). Hands and props given in "body" space move with
// the body's lean; "stage" space is the floor under the pawn, for things that fly or fall.
//
// A hand is {side, x, y, rot, s, sx, shape}: side 1 is the hand on the viewer's right, -1 on the
// left (drawn mirrored, thumbs toward the body); rot turns it in degrees (0: fingers up); s is
// its size (0: tucked away) and sx squashes it sideways (a hand turned edge-on); shape is a set
// of numbers (HAND below), so two shapes can be blended over time.
"use strict";

// ---------------------------------------------------------------- hand shapes

/**
 * A hand shape: how far each finger is curled (index, middle, ring, little: 0 straight, 1 in a
 * fist), how far they fan out, and the thumb: its angle (degrees from pointing along the fingers,
 * negative away from the palm, positive across it) and its curl.
 */
const HAND = {
  open: { f: [0, 0, 0, 0], spread: 1, ta: -55, tc: 0 },
  flat: { f: [0, 0, 0, 0], spread: 0, ta: -12, tc: 0 },
  fist: { f: [1, 1, 1, 1], spread: 0, ta: 40, tc: 0.75 },
  grip: { f: [0.82, 0.86, 0.88, 0.9], spread: 0, ta: 28, tc: 0.45 },
  pinch: { f: [0.5, 0.78, 0.86, 0.9], spread: 0.2, ta: 14, tc: 0.25 },
  point: { f: [0, 1, 1, 1], spread: 0, ta: 34, tc: 0.7 },
  thumb: { f: [1, 1, 1, 1], spread: 0, ta: -90, tc: 0 },
  claw: { f: [0.45, 0.45, 0.5, 0.5], spread: 0.6, ta: -20, tc: 0.3 },
  cup: { f: [0.35, 0.35, 0.4, 0.45], spread: 0.15, ta: -35, tc: 0.15 },
  card: { f: [0.25, 0.3, 0.4, 0.5], spread: 0, ta: 22, tc: 0 },
};

/** A shape between two others, `u` of the way from a to b. */
function mixShape(a, b, u) {
  const m = (x, y) => x + (y - x) * u;
  return { f: a.f.map((v, i) => m(v, b.f[i])), spread: m(a.spread, b.spread), ta: m(a.ta, b.ta), tc: m(a.tc, b.tc) };
}

// ---------------------------------------------------------------- timing helpers

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (u) => u * u * (3 - 2 * u);
const EASE = {
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
/** Hands and props come in with a pop at the start of an emote and tuck away at its end. */
const appear = (t, dur, from = 0, inMs = 180, outMs = 220) => (t < from ? 0 : Math.min(EASE.b(clamp((t - from) / inMs, 0, 1)), clamp((dur - t) / outMs, 0, 1)));

/** A point given in a hand's own frame (fingers up, before mirroring), in the space the hand is in. */
function held(h, lx, ly) {
  const r = (h.rot * Math.PI) / 180;
  const x = h.side * h.s * (h.sx ?? 1) * lx;
  const y = h.s * ly;
  return { x: h.x + x * Math.cos(r) - y * Math.sin(r), y: h.y + x * Math.sin(r) + y * Math.cos(r) };
}

/** A hand: shape by name or blend, everything else with defaults. */
function hand(side, x, y, rot, shape, s = 1, sx = 1) {
  return { side, x, y, rot, s, sx, shape: typeof shape === "string" ? HAND[shape] : shape };
}

/** A pose with everything at rest. `calm`: reduced motion, so wobbles and shakes are left out. */
function rest() {
  return {
    body: { x: 0, dx: 0, lift: 0, rot: 0, pivot: 0, sx: 1, sy: 1, tint: 0, hx: 0, hy: 0, hr: 0 },
    face: { eyes: "open", eye: 1, look: 0, up: 0, lid: 0, brows: null, mouth: null },
    hands: [],
    props: [],
    fx: [],
    other: { look: -3, sweat: null },
  };
}

// ---------------------------------------------------------------- the emotes

/**
 * Every candidate: {id, name, line, word, dur, hold, aimed, kept, pose(t, calm)}. `hold` is the
 * moment for stills and pictures. `word` is the sticker. `aimed`: done at the piece on the right.
 */
const EMOTES = [
  {
    id: "violin",
    kept: true,
    name: "World's smallest violin",
    line: "Violin under the chin, one hand on the neck, the other drawing long, sad strokes of the bow.",
    word: "so sad",
    dur: 3400,
    hold: 1500,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      // The bow goes back and forth in long, slow strokes: 0 at the frog, 1 at the tip.
      const stroke = calm ? 0.5 : 0.5 - 0.5 * Math.cos((Math.max(0, t - 300) / 1300) * Math.PI);
      p.body.rot = 3 * (stroke - 0.5) * on;
      p.body.hr = 16 * on;
      p.body.hx = 5 * on;
      p.face.eyes = on > 0.5 ? "shut" : "open";
      p.face.brows = on > 0.5 ? "sad" : null;
      p.face.mouth = on > 0.5 ? "frown" : null;
      // The violin: its body tucked under the chin on the right, the neck reaching out and up.
      const vrot = 68;
      const vx = 20;
      const vy = -92;
      p.props.push({ kind: "violin", x: vx, y: vy, rot: vrot, s: on });
      const along = (d) => ({ x: vx + Math.sin((vrot * Math.PI) / 180) * d, y: vy - Math.cos((vrot * Math.PI) / 180) * d });
      // The hand on the neck, near the scroll, its fingers curled over the strings.
      const neck = along(46);
      p.hands.push(hand(1, neck.x + 4, neck.y + 22, -24, "grip", on));
      // The bow crosses the strings just below the bridge, close to square with them, and slides
      // through that point: the hand holds the frog end and goes down and up in long strokes.
      const contact = along(4);
      const dir = { x: -0.28, y: 0.96 }; // from the strings toward the frog: down, a little left
      const reach = 14 + 58 * stroke;
      const frog = { x: contact.x + dir.x * reach, y: contact.y + dir.y * reach };
      const tip = { x: frog.x - dir.x * 96, y: frog.y - dir.y * 96 };
      p.props.push({ kind: "bow", x1: frog.x, y1: frog.y, x2: tip.x, y2: tip.y, s: on });
      p.hands.push(hand(-1, frog.x - 2, frog.y + 22, -8, "pinch", on * 0.9));
      if (on > 0.5) p.fx.push({ kind: "note", x: 44 + ((t / 30) % 30), y: -150 - ((t / 20) % 40), o: 1 - ((t / 20) % 40) / 40 });
      return p;
    },
  },
  {
    id: "popcorn",
    kept: true,
    name: "Popcorn",
    line: "One hand holds the bucket, the other picks a few, up to the mouth, chew. Now and then one falls.",
    word: "this is good",
    dur: 3800,
    hold: 1900,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      p.face.look = 4;
      p.face.eye = 1.15;
      p.body.hr = 6 * on;
      p.props.push({ kind: "bucket", x: -16, y: -38, rot: -6, s: on });
      p.hands.push(hand(-1, -40, -14, 34, "cup", on));
      // Each mouthful: down into the bucket, pinch, up to the mouth, back down while chewing.
      const cycle = 1100;
      const c = Math.max(0, t - 300) % cycle;
      const n = Math.floor(Math.max(0, t - 300) / cycle);
      const reach = k(c, [[0, 0], [260, 1], [380, 1], [640, 0], [1100, 0]]); // 1: in the bucket
      const lift = k(c, [[0, 0], [380, 0], [640, 1, "o"], [760, 1], [1000, 0.2]]); // 1: at the mouth
      // Where the fingertips are: over the bucket, then at the mouth. The wrist is below them.
      const tipAt = { x: -14 + 16 * lift + 4 * (1 - reach), y: -70 + 12 * reach - 30 * lift };
      const shape = mixShape(HAND.cup, HAND.pinch, clamp(reach * 1.5 + lift, 0, 1));
      const pick = hand(1, tipAt.x + 18, tipAt.y + 34, -24 - 20 * lift, shape, on);
      p.hands.push(pick);
      const pinch = held(pick, -8, -36);
      if (lift > 0.05 && lift < 0.98 && c < 760) for (const [dx, dy] of [[0, 0], [5, -3]]) p.props.push({ kind: "kernel", x: pinch.x + dx, y: pinch.y + dy, s: on });
      p.face.mouth = c > 640 && c < 1080 && t < this.dur - 300 ? (Math.floor(t / 120) % 2 ? "chew" : "flat") : on > 0.5 ? "smile" : null;
      // Every other mouthful, one piece misses and falls to the floor.
      if (n % 2 === 1 && c > 560) {
        const u = clamp((c - 560) / 380, 0, 1);
        p.props.push({ kind: "kernel", space: "stage", x: 10 + u * 16, y: -100 + u * u * 100, s: on });
      }
      return p;
    },
  },
  {
    id: "slowclap",
    kept: true,
    name: "Slow clap",
    line: "Two flat hands, palms together, three slow claps with a held beat between. Unimpressed eyes.",
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
      // How far apart the hands are: they come together fast, stay a moment, part slowly.
      let gap = 1;
      for (const c of claps) {
        const before = clamp((c - t) / 160, 0, 1);
        const after = clamp((t - c - 90) / 420, 0, 1);
        if (t <= c) gap = Math.min(gap, smooth(before));
        else gap = Math.min(gap, t < c + 90 ? 0 : smooth(after));
      }
      const x = 7 + 26 * gap;
      for (const side of [-1, 1]) p.hands.push(hand(side, side * x, -38, side * (-8 + 18 * gap), "flat", on, 0.78 + 0.22 * gap));
      const hit = claps.find((c) => t >= c && t < c + 240);
      if (hit !== undefined) p.fx.push({ kind: "clap", x: 0, y: -74, o: 1 - (t - hit) / 240 });
      return p;
    },
  },
  {
    id: "pointlaugh",
    kept: true,
    name: "Point and laugh",
    line: "Points right at the nearest piece and shakes with laughter, a hand on its belly. The target just stands there.",
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
      p.hands.push(hand(1, 40 + 6 * on, -82, 92, "point", on));
      p.hands.push(hand(-1, -16, -26 + (shake ? wave(t, 240, 3) : 0), 24, "flat", on));
      if (on > 0.5 && (calm || Math.floor(t / 260) % 2)) p.fx.push({ kind: "text", text: "HA", x: -42, y: -178, size: 22 });
      if (on > 0.5 && (calm || Math.floor(t / 260) % 2 === 0)) p.fx.push({ kind: "text", text: "HA", x: 30, y: -190, size: 27 });
      // The target is not changed: a glance at the laugher, one drop of sweat.
      p.other.look = -3.5;
      p.other.sweat = t > 600 && t < this.dur - 300 ? clamp((t - 600) / 1400, 0, 1) : null;
      return p;
    },
  },
  {
    id: "redcard",
    name: "Red card",
    line: "A hand thrusts a red card up high at the target. Off you go.",
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
      const h = hand(1, 34 + 6 * up, -96 - 62 * up, 12 * up, "card", on);
      p.hands.push(h);
      const at = held(h, 2, -38);
      p.props.push({ kind: "card", x: at.x, y: at.y, rot: h.rot + 6, s: on });
      p.hands.push(hand(-1, -32, -30, 24, "fist", on * 0.9));
      return p;
    },
  },
  {
    id: "whiteflag",
    name: "White flag",
    line: "A hand waves a white flag on a long stick. I give up.",
    word: "I give up",
    dur: 3000,
    hold: 1300,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const sway = calm ? 0 : wave(t, 760, 14);
      p.body.sy = 1 - 0.05 * on;
      p.body.hr = -6 * on;
      p.face.eyes = on > 0.5 ? "shut" : "open";
      p.face.mouth = on > 0.5 ? "frown" : null;
      p.face.brows = on > 0.5 ? "sad" : null;
      const h = hand(1, 34, -112, sway * 0.6, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, 10);
      p.props.push({ kind: "flag", x: at.x, y: at.y, rot: sway, s: on, phase: calm ? 0 : t / 120 });
      return p;
    },
  },
  {
    id: "hurry",
    name: "Hurry up",
    line: "One hand holds up a stopwatch, the other taps it, again and again, hopping on the spot.",
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
      const watch = hand(-1, -46, -58, -10, "grip", on);
      p.hands.push(watch);
      const face = held(watch, 2, -30);
      p.props.push({ kind: "stopwatch", x: face.x, y: face.y, rot: 0, s: on, hand: calm ? 60 : (t / 3) % 360 });
      // The tapping finger: in to the glass and back, three times a second.
      const tap = calm ? 0.5 : Math.max(0, Math.sin((t / 330) * Math.PI * 2));
      p.hands.push(hand(1, face.x + 40 - 14 * tap, face.y + 34 - 6 * tap, -52, "point", on));
      return p;
    },
  },
  {
    id: "confetti",
    name: "Confetti",
    line: "Both hands hold a party popper aimed at the target: one pulls the string, pop, confetti rains round them.",
    word: "yay!",
    dur: 3000,
    hold: 1050,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const popped = t > 520;
      p.face.eyes = popped && t < this.dur - 300 ? "happy" : "open";
      p.face.mouth = popped && t < this.dur - 300 ? "grin" : on > 0.5 ? "smile" : null;
      p.body.lift = t > 520 && t < 760 ? 10 : 0;
      const cone = { x: 30, y: -112, rot: 34 };
      p.props.push({ kind: "popper", ...cone, s: on, popped });
      p.hands.push(hand(1, 22, -94, 30, "grip", on));
      const pull = k(t, [[0, 0], [300, 0], [520, 1, "i"], [700, 1]]);
      p.hands.push(hand(-1, 4 - 22 * pull, -84 + 14 * pull, -10, "pinch", on));
      if (popped) {
        const colours = ["#ffe58a", "#4fc3b0", "#f05a7e", "#8fd3ff", "#f4b453", "#b79cf7"];
        const bits = [];
        for (let i = 0; i < 26; i++) {
          const u = clamp((t - 520) / 450, 0, 1);
          const fall = clamp((t - 970) / 1600, 0, 1);
          const spread = (i / 26 - 0.5) * 110;
          const x = 60 + (190 + spread - 60) * u + (calm ? 0 : wave(t + i * 97, 600, 6));
          const y = -170 + (-170 + 170) * u - Math.sin(u * Math.PI) * 60 + fall * (110 + (i % 5) * 18);
          bits.push({ x, y, rot: (t / 4 + i * 40) % 360, c: colours[i % colours.length] });
        }
        if (t < this.dur - 200) p.props.push({ kind: "confetti", space: "stage", bits });
      }
      return p;
    },
  },
  {
    id: "steam",
    name: "Fuming",
    line: "Goes red, steam out of the head, fists clenched and shaking, little stomps.",
    word: "grr",
    dur: 2900,
    hold: 1250,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const red = k(t, [[0, 0], [200, 0], [800, 0.85], [this.dur - 350, 0.85], [this.dur, 0]]);
      p.body.tint = red;
      p.face.brows = red > 0.3 ? "angry" : null;
      p.face.mouth = red > 0.3 ? "grit" : null;
      p.face.eye = 0.7;
      p.body.lift = red > 0.5 && !calm ? Math.max(0, wave(t, 340, 9)) : 0;
      const pump = calm ? 0 : wave(t, 170, 4);
      p.hands.push(hand(-1, -42, -36 + pump, -10, "fist", on));
      p.hands.push(hand(1, 42, -36 - pump, 10, "fist", on));
      for (const [i, side] of [-1, 1].entries()) {
        const u = calm ? 0.3 : ((t + i * 250) % 600) / 600;
        if (red > 0.4) p.fx.push({ kind: "steam", side, x: side * 24, y: -134 - u * 16, o: 1 - u, onHead: true });
      }
      return p;
    },
  },
  {
    id: "thumbsup",
    name: "Thumbs up",
    line: "Its own big hand: a thumbs up that pops toward you, and a nod.",
    word: "nice!",
    dur: 2500,
    hold: 1000,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const pop = k(t, [[0, 0], [200, 0], [380, 1.3, "o"], [560, 1.12], [this.dur - 250, 1.12], [this.dur, 0]]);
      p.hands.push(hand(1, 36, -104, 90, "thumb", on * pop));
      p.body.hy = on > 0.5 && !calm ? Math.max(0, wave(t, 520, 5)) : 0;
      p.face.eyes = on > 0.5 ? "happy" : "open";
      p.face.mouth = on > 0.5 ? "smile" : null;
      return p;
    },
  },
  {
    id: "boo",
    name: "Boo",
    line: "Both hands, thumbs down, shaken at the target.",
    word: "BOO",
    dur: 2700,
    hold: 1100,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const shake = calm ? 0 : wave(t, 230, 7);
      p.hands.push(hand(1, 54, -66 + shake, -90, "thumb", on * 1.1));
      p.hands.push(hand(-1, -54, -66 - shake, 90, "thumb", on * 1.1));
      p.face.mouth = on > 0.5 ? "o" : null;
      p.face.brows = on > 0.5 ? "angry" : null;
      p.face.look = 3;
      p.body.dx = on > 0.5 && !calm ? wave(t, 230, 2) : 0;
      return p;
    },
  },
  {
    id: "trophy",
    name: "GG",
    line: "Both hands hold out a gold trophy to the target, with a little bow.",
    word: "GG",
    dur: 2800,
    hold: 1250,
    aimed: true,
    pose(t) {
      const p = rest();
      const on = appear(t, this.dur);
      const out = k(t, [[0, 0], [420, 1, "o"], [this.dur - 300, 1], [this.dur, 0]]);
      p.body.rot = 9 * out;
      p.face.eyes = out > 0.5 ? "happy" : "open";
      p.face.mouth = out > 0.5 ? "smile" : null;
      const cx = 36 + 12 * out;
      p.props.push({ kind: "trophy", x: cx, y: -96, rot: 0, s: on * 1.35, shine: t > 600 && t < this.dur - 400 });
      p.hands.push(hand(1, cx + 30, -72, -40, "grip", on * 0.85));
      p.hands.push(hand(-1, cx - 30, -72, 40, "grip", on * 0.85));
      return p;
    },
  },
  {
    id: "tenfingers",
    name: "Ten out of ten",
    line: "Both hands up high, all ten fingers spread and wiggling: a perfect score, no paddle.",
    word: "10/10",
    dur: 2700,
    hold: 1100,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const wig = calm ? 0 : wave(t, 260, 1);
      for (const side of [-1, 1]) {
        const shape = { ...HAND.open, spread: 1.2 + 0.25 * wig * side };
        p.hands.push(hand(side, side * 42, -150 + (calm ? 0 : wave(t, 520, 4, side)), side * (12 + 6 * wig), shape, on));
      }
      p.face.eyes = on > 0.5 ? "happy" : "open";
      p.face.mouth = on > 0.5 ? "grin" : null;
      p.body.lift = on > 0.5 && !calm ? Math.abs(wave(t, 520, 6)) : 0;
      return p;
    },
  },
  {
    id: "ten",
    demoted: true,
    name: "Perfect 10 (paddle)",
    line: "The judge's paddle: 10, held up in a fist.",
    word: "10!",
    dur: 2600,
    hold: 1100,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const h = hand(1, 36, -132, 0, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, -6);
      p.props.push({ kind: "paddle", x: at.x, y: at.y, rot: calm ? 0 : wave(t, 500, 6), s: on, text: "10", ink: "#1e1410", size: 30 });
      p.face.eyes = on > 0.5 ? "happy" : "open";
      p.face.mouth = on > 0.5 ? "grin" : null;
      p.body.lift = on > 0.5 && !calm ? Math.abs(wave(t, 500, 6)) : 0;
      return p;
    },
  },
  {
    id: "two",
    demoted: true,
    name: "Harsh 2 (paddle)",
    line: "The judge's paddle again: 2, with a slow shake of the head.",
    word: "2",
    dur: 2600,
    hold: 1300,
    aimed: true,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const h = hand(1, 36, -132, 0, "grip", on);
      p.hands.push(h);
      const at = held(h, 0, -6);
      p.props.push({ kind: "paddle", x: at.x, y: at.y, rot: 0, s: on, text: "2", ink: "#c8382c", size: 34 });
      p.body.hr = on > 0.5 && !calm ? wave(t, 900, 9) : 0;
      p.face.eye = 0.6;
      p.face.lid = 0.45 * on;
      p.face.mouth = on > 0.5 ? "flat" : null;
      return p;
    },
  },
  {
    id: "shush",
    name: "Shh",
    line: "Leans toward the target, a finger to its lips, and a little puff: shh.",
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
      p.hands.push(hand(1, 10, -56, -4, "point", on * 0.9));
      const u = clamp((t - 450) / 900, 0, 1);
      if (t > 450 && t < this.dur - 200) p.fx.push({ kind: "puff", text: "shh", x: 30 + 70 * u, y: -102 - 18 * u, s: 0.6 + 0.5 * u, o: 1 - u * 0.7 });
      return p;
    },
  },
  {
    id: "lighter",
    name: "Lighter up",
    line: "Sways slowly, eyes closed, singing; one hand raises a lighter, flicks it on and waves it side to side.",
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
      const flick = k(t, [[0, 0], [700, 0], [800, 1], [900, 0.4]]);
      const shape = mixShape(HAND.grip, { ...HAND.grip, ta: -10, tc: 0 }, flick);
      const h = hand(1, 30 + 18 * sway, -100 - 50 * up, 8 * sway, shape, on);
      p.hands.push(h);
      const at = held(h, 0, -10);
      const lit = t > 800 && t < this.dur - 250;
      p.props.push({ kind: "lighter", x: at.x, y: at.y, rot: h.rot, s: on, lit: lit ? 1 : 0, flicker: calm ? 0 : t / 70, spark: t > 760 && t < 880 });
      p.hands.push(hand(-1, -14, -34, 24, "flat", on * 0.9));
      if (lit) for (let i = 0; i < 2; i++) {
        const u = (((t - 900 - i * 700) % 1400) + 1400) % 1400 / 1400;
        p.fx.push({ kind: "note", x: -24 - i * 12 - u * 18, y: -140 - u * 46, o: 1 - u });
      }
      return p;
    },
  },
  {
    id: "shrug",
    name: "Huh? (shrug)",
    line: "Both hands turned up, shoulders up, head tilted. A small question mark pops up.",
    word: "huh?",
    dur: 2600,
    hold: 1100,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const up = k(t, [[0, 0], [300, 1, "b"], [this.dur - 400, 1], [this.dur, 0]]);
      p.body.lift = 6 * up;
      p.body.hr = 12 * up;
      p.body.sy = 1 + 0.03 * up;
      p.face.brows = up > 0.5 ? "up" : null;
      p.face.mouth = up > 0.5 ? "flat" : null;
      p.face.eye = 1.1;
      for (const side of [-1, 1]) p.hands.push(hand(side, side * (40 + 6 * up), -46 - 14 * up, side * 70, "cup", on));
      const q = appear(t, this.dur, 380, 200);
      if (q > 0) p.fx.push({ kind: "qmark", x: 14, y: -168, s: q * (calm ? 1 : 1 + 0.05 * wave(t, 600)) });
      return p;
    },
  },
  {
    id: "scratch",
    name: "Huh? (scratching head)",
    line: "One hand scratches the side of its head, eyes drifting up, thinking it over.",
    word: "hmm?",
    dur: 2800,
    hold: 1200,
    pose(t, calm) {
      const p = rest();
      const on = appear(t, this.dur);
      const s = calm ? 0 : wave(t, 160, 1);
      p.body.hr = -8 * on;
      p.face.up = 3 * on;
      p.face.look = 2 * on;
      p.face.mouth = on > 0.5 ? "squiggle" : null;
      p.face.brows = on > 0.5 ? "sus" : null;
      p.hands.push(hand(1, 34 + 2 * s, -112 + 3 * s, -40, "claw", on));
      return p;
    },
  },
];
