// An emote drawn in SVG: turns a pose from emotes/rig.js into pictures over a pawn.
//
// Both looks use it. The flat room draws everything here over its own pawn (scene.js): the face,
// the stick arms with their mitten or small cartoon hand in the pawn's own colour, the props and
// the effects. The 3D room draws the arms as meshes (look3d/emote-arms.js) and the rest here, in
// a layer over the picture that follows the piece. Elements are made once and reshaped every
// frame; nothing is made per frame once an emote has started.
//
// A figure has two groups for its host to place: `body`, at the pawn's feet, moving with it (its
// lean comes from bodyTransform), and `stage`, at the same spot on the floor, which does not.
import { s, set } from "../dom.js";

const INK = "#1a1210";
const f1 = (n) => n.toFixed(1);

/** The room's colour mixing: toward white (amount above 0) or black (below 0). */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const to = amount > 0 ? 255 : 0;
  const m = Math.abs(amount);
  const mix = (c) => Math.round(c + (to - c) * m);
  return "#" + ((mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)).toString(16).padStart(6, "0");
}

function el(tag, attrs, parent) {
  const e = s(tag, attrs);
  parent.append(e);
  return e;
}
function text(parent, str, attrs) {
  const t = el("text", { class: "t-ui", "font-weight": 900, "text-anchor": "middle", ...attrs }, parent);
  t.textContent = str;
  return t;
}

/** The lean, lift and squash of a pawn's body in a pose, as an SVG transform about its foot. */
export function bodyTransform(body) {
  return `translate(${f1(body.dx)},${f1(-body.lift)}) rotate(${f1(body.rot)},0,${-body.pivot}) scale(${body.sx.toFixed(3)},${body.sy.toFixed(3)})`;
}

// ---------------------------------------------------------------- the face

const BROWS = {
  sad: "M-15,-124 L-4,-121 M15,-124 L4,-121",
  angry: "M-15,-127 L-3,-120 M15,-127 L3,-120",
  up: "M-15,-127 Q-9,-131 -3,-127 M3,-127 Q9,-131 15,-127",
  sus: "M-15,-122 L-3,-124 M3,-126 L15,-120",
};
const MOUTHS = {
  smile: { d: "M-9,-101 Q0,-93 9,-101" },
  grin: { d: "M-11,-102 Q0,-85 11,-102 Z", fill: "#3a1010", w: 2.6 },
  laugh: { d: "M-12,-103 Q0,-82 12,-103 Z", fill: "#3a1010", w: 2.6 },
  o: { d: "M0,-104 a5,6 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2.4 },
  chew: { d: "M-6,-100 Q0,-94 6,-100 Q0,-97 -6,-100 Z", fill: "#3a1010", w: 2.2 },
  purse: { d: "M0,-101 a3.4,3.8 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2.2 },
  flat: { d: "M-7,-98 H7" },
  frown: { d: "M-9,-95 Q0,-103 9,-95" },
  grit: { d: "M-10,-101 H10 V-95 H-10 Z M-5,-101 V-95 M0,-101 V-95 M5,-101 V-95", fill: "#fff", w: 2 },
  squiggle: { d: "M-9,-98 q3,-3 6,0 q3,3 6,0 q3,-3 4,-1" },
};

/** The face the pose asks for, in place of the pawn's own two eyes (which the host hides meanwhile). */
function makeFace(parent, skin) {
  const f = { g: el("g", {}, parent) };
  f.eyes = el("g", {}, f.g);
  f.eyeL = el("ellipse", { rx: 3.8, ry: 5.6, fill: INK }, f.eyes);
  f.eyeR = el("ellipse", { rx: 3.8, ry: 5.6, fill: INK }, f.eyes);
  f.glintL = el("circle", { r: 1.3, fill: "#fff" }, f.eyes);
  f.glintR = el("circle", { r: 1.3, fill: "#fff" }, f.eyes);
  const line = { fill: "none", stroke: INK, "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" };
  f.happy = el("path", { d: "M-14,-111 Q-9,-119 -4,-111 M4,-111 Q9,-119 14,-111", ...line }, f.g);
  f.shut = el("path", { d: "M-14,-113 Q-9,-109 -4,-113 M4,-113 Q9,-109 14,-113", ...line }, f.g);
  f.lids = el("path", { fill: skin, stroke: INK, "stroke-width": 2.2, "stroke-linejoin": "round" }, f.g);
  f.brows = el("path", { ...line, "stroke-width": 3 }, f.g);
  f.mouth = el("path", { "stroke-linecap": "round", "stroke-linejoin": "round", stroke: INK }, f.g);
  return f;
}

function shapeFace(f, face) {
  const open = face.eyes === "open";
  set(f.eyes, { display: open ? null : "none" });
  if (open) {
    for (const [e, g, cx] of [
      [f.eyeL, f.glintL, -9],
      [f.eyeR, f.glintR, 9],
    ]) {
      set(e, { cx: cx + face.look, cy: -113 - face.up, ry: Math.max(0.6, 5.6 * face.eye).toFixed(2), rx: face.eye > 1.05 ? 4.6 : 3.8 });
      set(g, { cx: cx + 1 + face.look, cy: -115.5 - face.up, display: face.eye > 0.55 ? null : "none" });
    }
  }
  set(f.happy, { display: face.eyes === "happy" ? null : "none" });
  set(f.shut, { display: face.eyes === "shut" ? null : "none" });
  if (face.lid > 0 && open) {
    // A heavy lid: skin over the top of each eye, curved like the eye, with its edge drawn.
    const y = -113 - 6 + face.lid * 9;
    const lid = (a, b) => `M${a},${f1(y)} C${a},-121 ${b},-121 ${b},${f1(y)} Z`;
    set(f.lids, { display: null, d: `${lid(-14.5, -3.5)} ${lid(3.5, 14.5)}` });
  } else set(f.lids, { display: "none" });
  set(f.brows, face.brows ? { display: null, d: BROWS[face.brows] } : { display: "none" });
  const m = MOUTHS[face.mouth];
  set(f.mouth, m ? { display: null, d: m.d, fill: m.fill ?? "none", "stroke-width": m.w ?? 3 } : { display: "none" });
}

// ---------------------------------------------------------------- the limbs

/**
 * One limb's elements, made once and reshaped every frame: a stick arm and, at its end, a mitten
 * or a small cartoon hand, all in the pawn's own colour. Both hands are deliberately simple and
 * round: a toy's hands, not a person's.
 */
function makeLimb(parent, colour) {
  const g = el("g", {}, parent);
  const arm = el("path", { fill: "none", stroke: shade(colour, -0.05), "stroke-width": 8, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
  const handG = el("g", {}, g);
  const look = { fill: shade(colour, 0.28), stroke: shade(colour, -0.42), "stroke-width": 1.8, "stroke-linejoin": "round" };
  const back = el("g", {}, handG); // a thumb held out sits behind the palm's edge
  const mitten = el("rect", look, handG);
  const pointer = el("rect", look, handG);
  const palm = el("rect", look, handG);
  const fingers = [0, 1, 2, 3].map(() => el("rect", look, handG));
  const front = el("g", {}, handG); // a thumb across the palm, in front
  const thumb = el("rect", look, front);
  return { g, arm, handG, back, front, mitten, pointer, palm, fingers, thumb };
}

/** Index to little finger on the cartoon hand: where each sits and how long it is when straight. */
const STUBS = [
  { x: -5.4, len: 9 },
  { x: -1.8, len: 10 },
  { x: 1.8, len: 9.4 },
  { x: 5.3, len: 7.6 },
];

function shapeLimb(l, pose) {
  if (!pose || pose.s <= 0.05) return set(l.g, { display: "none" });
  set(l.g, { display: null });
  const a = pose.arm;
  set(l.arm, { d: `M${f1(a.shoulder.x)},${f1(a.shoulder.y)} L${f1(a.elbow.x)},${f1(a.elbow.y)} L${f1(a.wrist.x)},${f1(a.wrist.y)}` });
  const sh = pose.shape;
  set(l.handG, { transform: `translate(${f1(pose.x)},${f1(pose.y)}) rotate(${f1(pose.rot)}) scale(${(pose.side * pose.s * (pose.sx ?? 1)).toFixed(3)},${pose.s.toFixed(3)})` });
  const mitten = pose.style === "mitten";
  for (const e of [l.mitten, l.pointer]) set(e, { display: mitten ? null : "none" });
  for (const e of [l.palm, ...l.fingers]) set(e, { display: mitten ? "none" : null });
  if (mitten) {
    // The rest of the fingers together: shorter and rounder the more they curl.
    const rest = (sh.f[1] + sh.f[2] + sh.f[3]) / 3;
    const hgt = 18 * (1 - 0.38 * rest);
    set(l.mitten, { x: -7.5, y: f1(-hgt), width: 15, height: f1(hgt + 3), rx: 7 });
    // The index finger stands out when it is straight and the others are not.
    const points = sh.f[0] < 0.3 && rest > 0.6;
    set(l.pointer, { display: points ? null : "none", x: -7, y: -22, width: 5.4, height: 12, rx: 2.7 });
  } else {
    set(l.palm, { x: -7.2, y: -11, width: 14.4, height: 13, rx: 5.5 });
    STUBS.forEach((st, i) => {
      const len = st.len * (1 - 0.68 * sh.f[i]);
      const angle = sh.spread * [-10, -3.5, 3.5, 10][i];
      set(l.fingers[i], { x: f1(st.x - 2), y: f1(-9 - len), width: 4, height: f1(len + 3), rx: 2, transform: `rotate(${angle.toFixed(1)},${st.x},-9)` });
    });
  }
  // The thumb: out from the palm's edge (negative angle) or across it (positive).
  const tl = (mitten ? 9 : 8.5) * (1 - 0.4 * sh.tc);
  set(l.thumb, { x: -2.4, y: f1(-tl), width: 4.8, height: f1(tl + 2.5), rx: 2.4, transform: `translate(-6.4,-3) rotate(${sh.ta.toFixed(1)})` });
  const parent = sh.ta > 5 ? l.front : l.back;
  if (l.thumb.parentNode !== parent) parent.append(l.thumb);
}

// ---------------------------------------------------------------- props and effects

function star4(parent, x, y, r, fill = "#ffe58a") {
  const g = el("g", { transform: `translate(${x},${y})` }, parent);
  el("path", { d: `M0,${-r} Q${r * 0.18},${-r * 0.18} ${r},0 Q${r * 0.18},${r * 0.18} 0,${r} Q${-r * 0.18},${r * 0.18} ${-r},0 Q${-r * 0.18},${-r * 0.18} 0,${-r} Z`, fill, stroke: "#fff6d8", "stroke-width": 1.2 }, g);
  return g;
}
const place = (p) => `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot ?? 0)}) scale(${Math.max(0.001, p.s).toFixed(3)})`;

/** Each kind: build(parent) -> update(prop). Everything is positioned by its prop's numbers. */
const KINDS = {
  bucket(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M-18,-22 L18,-22 L13,12 L-13,12 Z", fill: "#fbf3e2", stroke: INK, "stroke-width": 1.6 }, g);
    for (const x of [-10, 0, 10]) el("path", { d: `M${x - 3},-22 L${x + 3},-22 L${x + 2.2},12 L${x - 2.2},12 Z`, fill: "#d23a2c" }, g);
    for (const [x, y] of [[-12, -24], [-4, -28], [4, -27], [12, -24], [0, -32], [-8, -32], [8, -31]]) el("circle", { cx: x, cy: y, r: 4.6, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, g);
    return (p) => set(g, { transform: place(p) });
  },
  kernel(parent) {
    const c = el("circle", { r: 3.8, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, parent);
    return (p) => set(c, { cx: f1(p.x), cy: f1(p.y), r: (3.8 * p.s).toFixed(2) });
  },
  card(parent) {
    const r = el("rect", { x: -16, y: -23, width: 32, height: 46, rx: 4, fill: "#e0261b", stroke: "#fff", "stroke-width": 3 }, parent);
    return (p) => set(r, { transform: place(p) });
  },
  stopwatch(parent) {
    const g = el("g", {}, parent);
    el("rect", { x: -4, y: -27, width: 8, height: 7, rx: 2, fill: "#3a2a1c" }, g);
    el("circle", { r: 21, fill: "#fbf3e2", stroke: "#3a2a1c", "stroke-width": 4.5 }, g);
    for (let i = 0; i < 12; i++) el("rect", { x: -1, y: -18, width: 2, height: 4, fill: INK, transform: `rotate(${i * 30})` }, g);
    const needle = el("path", { d: "M0,0 V-15", stroke: "#c8382c", "stroke-width": 3.2, "stroke-linecap": "round" }, g);
    return (p) => {
      set(needle, { transform: `rotate(${f1(p.hand)})` });
      set(g, { transform: place(p) });
    };
  },
  popper(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M-7,14 L7,14 L14,-24 L-6,-26 Z", fill: "#b79cf7", stroke: INK, "stroke-width": 2 }, g);
    el("path", { d: "M-3,4 L9,1 M0,-8 L12,-11", stroke: "#ffe58a", "stroke-width": 3 }, g);
    const burst = el("g", {}, g);
    star4(burst, 4, -34, 9);
    return (p) => {
      set(burst, { display: p.popped ? null : "none" });
      set(g, { transform: place(p) });
    };
  },
  confetti(parent) {
    const g = el("g", {}, parent);
    const bits = [];
    return (p) => {
      while (bits.length < p.bits.length) bits.push(el("rect", { width: 7, height: 4, rx: 1 }, g));
      p.bits.forEach((b, i) => set(bits[i], { x: f1(b.x), y: f1(b.y), fill: b.c, transform: `rotate(${b.rot.toFixed(0)},${f1(b.x)},${f1(b.y)})` }));
    };
  },
  trophy(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M-16,-30 h32 c0,18 -6,26 -16,28 c-10,-2 -16,-10 -16,-28 Z", fill: "#f4c542", stroke: "#8a5a10", "stroke-width": 2 }, g);
    el("path", { d: "M-16,-26 c-10,0 -10,12 0,14 M16,-26 c10,0 10,12 0,14", fill: "none", stroke: "#8a5a10", "stroke-width": 3 }, g);
    el("rect", { x: -3, y: -2, width: 6, height: 10, fill: "#c99a2e" }, g);
    el("rect", { x: -12, y: 8, width: 24, height: 7, rx: 2, fill: "#8a5a10" }, g);
    const shine = el("g", {}, g);
    star4(shine, -22, -40, 6);
    star4(shine, 22, -44, 5);
    return (p) => {
      set(shine, { display: p.shine ? null : "none" });
      set(g, { transform: place(p) });
    };
  },
  lighter(parent) {
    const g = el("g", {}, parent);
    const flame = el("g", {}, g);
    const outer = el("path", { fill: "#ff8a1f" }, flame);
    const inner = el("path", { fill: "#ffe27a" }, flame);
    const spark = el("g", {}, g);
    for (const [x, y] of [[-6, -38], [5, -42], [8, -34], [-3, -46]]) el("circle", { cx: x, cy: y, r: 1.8, fill: "#ffe58a" }, spark);
    el("rect", { x: -8, y: -26, width: 16, height: 30, rx: 4, fill: "#3fa7b0", stroke: INK, "stroke-width": 1.8 }, g);
    el("rect", { x: -7, y: -33, width: 12, height: 8, rx: 1.5, fill: "#c9ccd2", stroke: INK, "stroke-width": 1.5 }, g);
    el("circle", { cx: 6, cy: -29, r: 3.2, fill: "#5a5e66", stroke: INK, "stroke-width": 1 }, g);
    return (p) => {
      const w = (n) => Math.sin(p.flicker + n) * 2;
      set(flame, { display: p.lit ? null : "none" });
      set(outer, { d: `M-6,-34 C-9,-44 -3,-50 ${f1(-1 + w(1))},${f1(-62 + w(2))} C4,-52 9,-44 6,-34 Z` });
      set(inner, { d: `M-3,-34 C-4,-40 -1,-44 ${f1(w(3) * 0.5)},${f1(-52 + w(4))} C2,-44 4,-40 3,-34 Z` });
      set(spark, { display: p.spark ? null : "none" });
      set(g, { transform: place(p) });
    };
  },
  tomato(parent) {
    const g = el("g", {}, parent);
    el("circle", { r: 9, fill: "#e0352b", stroke: "#7a1410", "stroke-width": 1.6 }, g);
    el("ellipse", { cx: -3, cy: -3, rx: 3, ry: 2, fill: "#fff", opacity: 0.45 }, g);
    el("path", { d: "M0,-9 l-5,-3 M0,-9 l5,-3 M0,-9 l0,-5", stroke: "#3f8a3a", "stroke-width": 2.4, "stroke-linecap": "round" }, g);
    return (p) => set(g, { transform: place(p) });
  },
  splat(parent) {
    // Flat on the floor: a smear, a few drops and a leaf, never up on anyone.
    const g = el("g", {}, parent);
    el("path", { d: "M-24,0 C-22,-7 -10,-5 -6,-8 C-2,-12 8,-9 12,-6 C20,-7 28,-3 24,1 C20,5 6,4 0,5 C-8,7 -26,6 -24,0 Z", fill: "#d1302a", stroke: "#7a1410", "stroke-width": 1.4 }, g);
    for (const [x, y, r] of [[-30, -6, 2.6], [30, -8, 2.2], [-14, -14, 2], [18, -15, 1.8]]) el("circle", { cx: x, cy: y, r, fill: "#d1302a" }, g);
    el("path", { d: "M4,-6 l-5,-3 M4,-6 l5,-3", stroke: "#3f8a3a", "stroke-width": 2.2, "stroke-linecap": "round" }, g);
    return (p) => set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) scale(${Math.max(0.001, p.s).toFixed(3)},${Math.max(0.001, p.s * 0.8).toFixed(3)})`, opacity: Math.max(0, p.o).toFixed(2) });
  },
};

const FX = {
  note(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M0,0 V-16 L10,-19 V-4", stroke: "#fbf3e2", "stroke-width": 2.4, fill: "none" }, g);
    el("ellipse", { cx: -3, cy: 1, rx: 4, ry: 3, fill: "#fbf3e2" }, g);
    el("ellipse", { cx: 7, cy: -2, rx: 4, ry: 3, fill: "#fbf3e2" }, g);
    return (f) => set(g, { transform: `translate(${f1(f.x)},${f1(f.y)})`, opacity: Math.max(0, f.o).toFixed(2) });
  },
  clap(parent) {
    const pth = el("path", { stroke: "#ffe58a", "stroke-width": 3.5, "stroke-linecap": "round", fill: "none" }, parent);
    return (f) => set(pth, { d: `M${f.x - 18},${f.y + 4} l-9,-7 M${f.x},${f.y - 4} v-12 M${f.x + 18},${f.y + 4} l9,-7`, opacity: Math.max(0, f.o).toFixed(2) });
  },
  text(parent) {
    const t = text(parent, "", { fill: "#ffe58a", stroke: INK, "stroke-width": 1, "paint-order": "stroke" });
    return (f) => {
      t.textContent = f.text;
      set(t, { x: f1(f.x), y: f1(f.y), "font-size": f.size });
    };
  },
  steam(parent) {
    const pth = el("path", { stroke: "#eeeeee", "stroke-width": 5, fill: "none", "stroke-linecap": "round" }, parent);
    return (f) => set(pth, { d: `M${f1(f.x)},${f1(f.y)} q${f.side * 7},-9 0,-16 q${-f.side * 7},-7 0,-16`, opacity: Math.max(0, f.o).toFixed(2) });
  },
  puff(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M-18,6 C-26,6 -26,-6 -16,-6 C-16,-16 -2,-18 2,-10 C8,-18 22,-14 18,-4 C28,-2 24,10 14,8 Z", fill: "#fbf3e2", opacity: 0.92, stroke: "#cdbfa6", "stroke-width": 1.5 }, g);
    const t = text(g, "", { y: 5, "font-size": 13, fill: INK });
    return (f) => {
      t.textContent = f.text;
      set(g, { transform: `translate(${f1(f.x)},${f1(f.y)}) scale(${f.s.toFixed(2)})`, opacity: Math.max(0, f.o).toFixed(2) });
    };
  },
};

/** Draws a list of props or effects into `parent`, reusing elements between frames. */
function drawList(cache, parent, list, lib, prefix) {
  const seen = new Set();
  list.forEach((item, i) => {
    const key = `${prefix}${i}:${item.kind}`;
    seen.add(key);
    let entry = cache.get(key);
    if (!entry) {
      const g = el("g", {}, parent);
      entry = { g, update: lib[item.kind](g) };
      cache.set(key, entry);
    }
    set(entry.g, { display: null });
    entry.update(item);
  });
  for (const [key, entry] of cache) if (key.startsWith(prefix) && !seen.has(key)) set(entry.g, { display: "none" });
}

// ---------------------------------------------------------------- a figure

/** The body and head of the room's pawn (scene.js piece()), for the red of a fuming piece. */
const TORSO = "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z";

export class EmoteFigure {
  /**
   * @param {string} colour  the seat's colour
   * @param {{face?: boolean, limbs?: boolean}} what  draw the face (the flat look) and the arms (the flat look; the 3D one has meshes)
   */
  constructor(colour, { face = true, limbs = true } = {}) {
    this.body = s("g", { class: "emote" });
    this.stage = s("g", { class: "emote-stage" });
    this.cache = new Map();
    this.face = face;
    if (face) {
      this.tint = el("g", { fill: "#ff2a14", opacity: 0 }, this.body);
      el("path", { d: TORSO }, this.tint);
      el("circle", { cx: 0, cy: -113, r: 28 }, this.tint);
    }
    this.head = el("g", {}, this.body);
    this.faceEls = face ? makeFace(this.head, shade(colour, 0.05)) : null;
    this.headFx = el("g", {}, this.head);
    this.props = el("g", {}, this.body);
    this.hands = el("g", {}, this.body);
    this.limbs = limbs ? [makeLimb(this.hands, colour), makeLimb(this.hands, colour)] : null;
    this.fx = el("g", {}, this.body);
    this.other = el("g", {}, this.stage);
  }

  /**
   * Draws a pose (already mirrored when the target is on the left). `toward` is the target's
   * offset in room units (negative: on the left), for what happens at the target: a glance's
   * drop of sweat, a flinch. Nothing is drawn at a target that is not there (toward: null).
   */
  draw(pose, toward) {
    if (this.face) {
      set(this.tint, { opacity: (pose.body.tint * 0.8).toFixed(2) });
      shapeFace(this.faceEls, pose.face);
    }
    set(this.head, { transform: `translate(${f1(pose.body.hx)},${f1(pose.body.hy)}) rotate(${f1(pose.body.hr)},0,-113)` });
    if (this.limbs) for (let i = 0; i < 2; i++) shapeLimb(this.limbs[i], pose.hands[i]);
    drawList(this.cache, this.props, pose.props.filter((x) => x.space !== "stage"), KINDS, "b");
    drawList(this.cache, this.stage, pose.props.filter((x) => x.space === "stage"), KINDS, "s");
    drawList(this.cache, this.fx, pose.fx.filter((x) => !x.onHead), FX, "f");
    drawList(this.cache, this.headFx, pose.fx.filter((x) => x.onHead), FX, "h");
    this.drawOther(pose.other, toward);
  }

  /** At the target: a drop of sweat on its brow, or the short lines of a flinch beside its head. */
  drawOther(other, toward) {
    if (!this.sweat) {
      this.sweat = el("path", { d: "M0,-7 C4,-1 4,4 0,4 C-4,4 -4,-1 0,-7 Z", fill: "#8fd3ff", stroke: "#e8f6ff", "stroke-width": 1 }, this.other);
      this.flinch = el("path", { fill: "none", stroke: "#fbf3e2", "stroke-width": 3, "stroke-linecap": "round" }, this.other);
    }
    const there = toward !== null && toward !== undefined;
    const away = there ? Math.sign(toward) || 1 : 1;
    set(this.sweat, other.sweat === null || !there ? { display: "none" } : { display: null, transform: `translate(${f1(toward + away * 24)},${f1(-126 + other.sweat * 12)})` });
    if (other.flinch > 0 && there) {
      // Three short strokes on the far side of the target's head, where the flinch throws it.
      const x = toward + away * 36;
      const k = other.flinch;
      set(this.flinch, { display: null, opacity: k.toFixed(2), d: `M${f1(x)},-132 l${away * 10},-6 M${f1(x + away * 2)},-116 l${away * 12},0 M${f1(x)},-100 l${away * 10},6` });
    } else set(this.flinch, { display: "none" });
  }

  remove() {
    this.body.remove();
    this.stage.remove();
  }
}

// ---------------------------------------------------------------- a picture of one, for the wheel

/**
 * A small still of an emote: the room's pawn in `colour` at the emote's best moment, as an
 * <svg> `size` pixels tall. Aimed emotes are drawn toward the right with nobody there.
 */
export function emoteThumb(rig, colour, size = 56) {
  const pose = rig.pose(rig.hold, true);
  const fig = new EmoteFigure(colour);
  const base = shade(colour, 0.16);
  const pawn = s(
    "g",
    { transform: bodyTransform(pose.body) },
    s("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5, fill: shade(colour, -0.28) }),
    s("path", { d: TORSO, fill: base }),
    s("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8, fill: shade(colour, 0.3) }),
    s("circle", { cx: 0, cy: -113, r: 28, fill: base }),
    s("ellipse", { cx: -10, cy: -125, rx: 9, ry: 6, fill: "#fff", opacity: 0.26 }),
    fig.body,
  );
  fig.draw(pose, null);
  // Wide enough for what it holds out, tall enough for what it holds up.
  const box = { x: -78, y: -190, w: 172, h: 200 };
  return s("svg", { viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`, width: Math.round((size * box.w) / box.h), height: size, "aria-hidden": "true", class: "emote-thumb" }, fig.stage, pawn);
}

// ---------------------------------------------------------------- the sticker

/**
 * The word over a piece's head ("this is good", "RED CARD"): a speech bubble that pops in. Its
 * size is given in screen terms by the host, so it can be read on a phone whatever the zoom.
 */
export class Sticker {
  constructor(parent) {
    this.g = el("g", { class: "emote-sticker", display: "none" }, parent);
    this.back = el("path", { fill: "#fbf3e2", stroke: INK, "stroke-width": 3, "stroke-linejoin": "round" }, this.g);
    this.t = text(this.g, "", { "font-size": 22, fill: INK, y: 8 });
    this.word = "";
  }

  /** Shows `word` with its tail's tip at (x, y), at `scale`, popped in by `pop` (0 to 1); word null hides it. */
  show(word, x, y, scale, pop) {
    if (word === null) return set(this.g, { display: "none" });
    if (word !== this.word) {
      this.word = word;
      this.t.textContent = word;
      const w = Math.max(60, [...word].length * 12.5 + 28);
      set(this.back, { d: `M${-w / 2},-22 h${w} a10,10 0 0 1 10,10 v24 a10,10 0 0 1 -10,10 h${-w / 2 + 10} l-10,12 l-4,-12 h${-w / 2 + 4} a10,10 0 0 1 -10,-10 v-24 a10,10 0 0 1 10,-10 Z` });
    }
    // The bubble's tail ends 34 units below its middle.
    set(this.g, { display: null, transform: `translate(${f1(x)},${f1(y)}) scale(${(scale * Math.max(0.01, pop)).toFixed(3)}) translate(0,-34)` });
  }

  remove() {
    this.g.remove();
  }
}
