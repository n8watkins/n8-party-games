// The flat drawing of an emote: turns a pose from rig.js into SVG. The pawn is the room's own
// (lobby/public/scene.js, piece()); its arms are sticks in its own colour ending in a mitten or a
// small cartoon hand, drawn from the pose's numbers every frame; props and effects come from a
// small library, by kind. A 3D drawing would read the same poses.
"use strict";

const NS = "http://www.w3.org/2000/svg";
const INK = "#1a1210";
const FLOOR = 262;
/** The four seat colours of the room (party-kit/src/core/room-core.js). */
const SEATS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"];

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k2, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k2, String(v));
  if (parent) parent.append(e);
  return e;
}
const set = (e, attrs) => {
  for (const [k2, v] of Object.entries(attrs)) e.setAttribute(k2, String(v));
};
const f1 = (n) => n.toFixed(1);
/** The room's colour mixing: toward white (amount above 0) or black (below 0). */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const to = amount > 0 ? 255 : 0;
  const m = Math.abs(amount);
  const mix = (c) => Math.round(c + (to - c) * m);
  return "#" + ((mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)).toString(16).padStart(6, "0");
}
function mixHex(a, b, u) {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((p >> s) & 255) * (1 - u) + ((q >> s) & 255) * u);
  return "#" + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0");
}
function text(parent, str, attrs) {
  const t = el("text", { "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", "font-weight": 900, "text-anchor": "middle", ...attrs }, parent);
  t.textContent = str;
  return t;
}

// ---------------------------------------------------------------- the pawn

function makePawn(parent, colour, x) {
  const p = { colour, baseX: x };
  p.root = el("g", {}, parent);
  p.stage = el("g", {}, p.root);
  el("ellipse", { cy: 5, rx: 40, ry: 9, fill: "#000", opacity: 0.42 }, p.root);
  p.shadow = p.root.lastChild;
  p.body = el("g", {}, p.root);
  el("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5, fill: shade(colour, -0.28) }, p.body);
  p.torso = el("path", { d: "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z", fill: shade(colour, 0.16) }, p.body);
  el("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8, fill: shade(colour, 0.3) }, p.body);
  p.head = el("g", {}, p.body);
  p.skull = el("circle", { cx: 0, cy: -113, r: 28, fill: shade(colour, 0.16) }, p.head);
  el("ellipse", { cx: -10, cy: -125, rx: 9, ry: 6, fill: "#fff", opacity: 0.26 }, p.head);
  p.eyes = el("g", {}, p.head);
  p.eyeL = el("ellipse", { cx: -9, cy: -113, rx: 3.8, ry: 5.6, fill: INK }, p.eyes);
  p.eyeR = el("ellipse", { cx: 9, cy: -113, rx: 3.8, ry: 5.6, fill: INK }, p.eyes);
  p.glintL = el("circle", { cx: -8, cy: -115.5, r: 1.3, fill: "#fff" }, p.eyes);
  p.glintR = el("circle", { cx: 10, cy: -115.5, r: 1.3, fill: "#fff" }, p.eyes);
  const line = { fill: "none", stroke: INK, "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" };
  p.happy = el("path", { d: "M-14,-111 Q-9,-119 -4,-111 M4,-111 Q9,-119 14,-111", ...line, display: "none" }, p.head);
  p.shut = el("path", { d: "M-14,-113 Q-9,-109 -4,-113 M4,-113 Q9,-109 14,-113", ...line, display: "none" }, p.head);
  p.lids = el("path", { d: "", fill: shade(colour, 0.05), display: "none" }, p.head);
  p.brows = el("path", { d: "", ...line, "stroke-width": 3, display: "none" }, p.head);
  p.mouth = el("path", { d: "", display: "none" }, p.head);
  p.headFx = el("g", {}, p.head);
  p.props = el("g", {}, p.body);
  p.hands = el("g", {}, p.body);
  p.fx = el("g", {}, p.body);
  p.cache = new Map();
  return p;
}

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

function applyBody(p, body, face) {
  set(p.root, { transform: `translate(${f1(p.baseX + body.x)},${FLOOR})` });
  set(p.body, { transform: `translate(${f1(body.dx)},${f1(-body.lift)}) rotate(${f1(body.rot)},0,${-body.pivot}) scale(${body.sx.toFixed(3)},${body.sy.toFixed(3)})` });
  set(p.head, { transform: `translate(${f1(body.hx)},${f1(body.hy)}) rotate(${f1(body.hr)},0,-113)` });
  set(p.shadow, { rx: f1(40 * (1 - Math.min(0.45, Math.max(0, body.lift) / 260))), cx: f1(body.dx) });
  const base = shade(p.colour, 0.16);
  const fill = body.tint ? mixHex(base, "#ff2a14", body.tint) : base;
  set(p.torso, { fill });
  set(p.skull, { fill });
  const open = face.eyes === "open";
  set(p.eyes, { display: open ? "inline" : "none" });
  if (open) {
    for (const [e, g, cx] of [
      [p.eyeL, p.glintL, -9],
      [p.eyeR, p.glintR, 9],
    ]) {
      set(e, { cx: cx + face.look, cy: -113 - face.up, ry: Math.max(0.6, 5.6 * face.eye).toFixed(2), rx: face.eye > 1.05 ? 4.6 : 3.8 });
      set(g, { cx: cx + 1 + face.look, cy: -115.5 - face.up, display: face.eye > 0.55 ? "inline" : "none" });
    }
  }
  set(p.happy, { display: face.eyes === "happy" ? "inline" : "none" });
  set(p.shut, { display: face.eyes === "shut" ? "inline" : "none" });
  if (face.lid > 0 && open) {
    // A heavy lid: skin over the top of each eye, curved like the eye, with its edge drawn.
    const y = -113 - 6 + face.lid * 9;
    const lid = (a, b) => `M${a},${f1(y)} C${a},-121 ${b},-121 ${b},${f1(y)} Z`;
    set(p.lids, { display: "inline", d: `${lid(-14.5, -3.5)} ${lid(3.5, 14.5)}`, stroke: INK, "stroke-width": 2.2, "stroke-linejoin": "round" });
  } else set(p.lids, { display: "none" });
  if (face.brows) set(p.brows, { display: "inline", d: BROWS[face.brows] });
  else set(p.brows, { display: "none" });
  const m = MOUTHS[face.mouth];
  if (m) set(p.mouth, { display: "inline", d: m.d, fill: m.fill ?? "none", stroke: INK, "stroke-width": m.w ?? 3, "stroke-linecap": "round", "stroke-linejoin": "round" });
  else set(p.mouth, { display: "none" });
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
  const fill = shade(colour, 0.28);
  const line = shade(colour, -0.42);
  const look = { fill, stroke: line, "stroke-width": 1.8, "stroke-linejoin": "round" };
  const back = el("g", {}, handG); // a thumb held out sits behind the palm's edge
  // The mitten: one rounded body, a thumb lobe, and one finger that stands out to point.
  const mitten = el("rect", look, handG);
  const pointer = el("rect", look, handG);
  // The cartoon hand: a round palm and four stubby fingers.
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
  set(l.g, { display: "inline" });
  const a = pose.arm;
  set(l.arm, { d: `M${f1(a.shoulder.x)},${f1(a.shoulder.y)} L${f1(a.elbow.x)},${f1(a.elbow.y)} L${f1(a.wrist.x)},${f1(a.wrist.y)}` });
  const sh = pose.shape;
  set(l.handG, { transform: `translate(${f1(pose.x)},${f1(pose.y)}) rotate(${f1(pose.rot)}) scale(${(pose.side * pose.s * (pose.sx ?? 1)).toFixed(3)},${pose.s.toFixed(3)})` });
  const mitten = pose.style === "mitten";
  const curl = (sh.f[0] + sh.f[1] + sh.f[2] + sh.f[3]) / 4;
  for (const e of [l.mitten, l.pointer]) set(e, { display: mitten ? "inline" : "none" });
  for (const e of [l.palm, ...l.fingers]) set(e, { display: mitten ? "none" : "inline" });
  if (mitten) {
    // The rest of the fingers together: shorter and rounder the more they curl.
    const rest = (sh.f[1] + sh.f[2] + sh.f[3]) / 3;
    const hgt = 18 * (1 - 0.38 * rest);
    set(l.mitten, { x: -7.5, y: f1(-hgt), width: 15, height: f1(hgt + 3), rx: 7 });
    // The index finger stands out when it is straight and the others are not.
    const points = sh.f[0] < 0.3 && rest > 0.6;
    set(l.pointer, { display: points ? "inline" : "none", x: -7, y: -22, width: 5.4, height: 12, rx: 2.7 });
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

/** Each kind: build(parent) -> update(prop). Everything is positioned by its prop's numbers. */
const KINDS = {
  violin(parent) {
    const g = el("g", {}, parent);
    el("rect", { x: -2, y: -76, width: 4, height: 50, rx: 1.5, fill: "#2a1a10" }, g);
    el("path", { d: "M-2,-80 q-4,-6 0,-10 q6,0 4,6", fill: "none", stroke: "#2a1a10", "stroke-width": 3 }, g);
    el("path", { d: "M-10,-28 C-18,-26 -18,-12 -11,-9 C-17,-5 -16,8 -6,10 L6,10 C16,8 17,-5 11,-9 C18,-12 18,-26 10,-28 C5,-30 -5,-30 -10,-28 Z", fill: "#b5651d", stroke: INK, "stroke-width": 1.8 }, g);
    el("path", { d: "M-5,-16 q-2,4 0,8 M5,-16 q2,4 0,8", fill: "none", stroke: INK, "stroke-width": 1.4 }, g);
    el("rect", { x: -5, y: -6, width: 10, height: 2.5, fill: "#f0d9a8" }, g);
    el("path", { d: "M-1.5,-74 V4 M1.5,-74 V4", stroke: "#f0e6cc", "stroke-width": 0.7 }, g);
    return (p) => set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
  },
  bow(parent) {
    const stick = el("path", { stroke: "#5a3420", "stroke-width": 2.6, "stroke-linecap": "round" }, parent);
    const hair = el("path", { stroke: "#f0e6cc", "stroke-width": 1.4 }, parent);
    return (p) => {
      const nx = p.y2 - p.y1;
      const ny = -(p.x2 - p.x1);
      const n = Math.hypot(nx, ny) || 1;
      const ox = (nx / n) * 3;
      const oy = (ny / n) * 3;
      const k2 = p.thin ? 0.35 : 1;
      set(stick, { d: `M${f1(p.x1)},${f1(p.y1)} L${f1(p.x2)},${f1(p.y2)}`, opacity: p.s, "stroke-width": 2.6 * k2 + 0.6 });
      set(hair, { d: `M${f1(p.x1 + ox * k2)},${f1(p.y1 + oy * k2)} L${f1(p.x2 + ox * k2)},${f1(p.y2 + oy * k2)}`, opacity: p.s, "stroke-width": 1.4 * k2 + 0.3 });
    };
  },
  bucket(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M-18,-22 L18,-22 L13,12 L-13,12 Z", fill: "#fbf3e2", stroke: INK, "stroke-width": 1.6 }, g);
    for (const x of [-10, 0, 10]) el("path", { d: `M${x - 3},-22 L${x + 3},-22 L${x + 2.2},12 L${x - 2.2},12 Z`, fill: "#d23a2c" }, g);
    for (const [x, y] of [[-12, -24], [-4, -28], [4, -27], [12, -24], [0, -32], [-8, -32], [8, -31]]) el("circle", { cx: x, cy: y, r: 4.6, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, g);
    return (p) => set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
  },
  kernel(parent) {
    const c = el("circle", { r: 3.8, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, parent);
    return (p) => set(c, { cx: f1(p.x), cy: f1(p.y), r: (3.8 * p.s).toFixed(2) });
  },
  card(parent) {
    const r = el("rect", { x: -16, y: -23, width: 32, height: 46, rx: 4, fill: "#e0261b", stroke: "#fff", "stroke-width": 3 }, parent);
    return (p) => set(r, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
  },
  flag(parent) {
    const g = el("g", {}, parent);
    el("rect", { x: -2.5, y: -96, width: 5, height: 106, rx: 2, fill: "#7a4b22" }, g);
    const cloth = el("path", { fill: "#fbfbf6", stroke: "#cdbfa6", "stroke-width": 1.5 }, g);
    return (p) => {
      const w = (n) => Math.sin(p.phase + n) * 5;
      set(cloth, { d: `M2,-96 C16,${f1(-102 + w(0))} 30,${f1(-90 + w(1))} 46,${f1(-96 + w(2))} L46,${f1(-64 + w(2))} C30,${f1(-58 + w(1))} 16,${f1(-70 + w(0))} 2,-64 Z` });
      set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
    };
  },
  stopwatch(parent) {
    const g = el("g", {}, parent);
    el("rect", { x: -4, y: -27, width: 8, height: 7, rx: 2, fill: "#3a2a1c" }, g);
    el("circle", { r: 21, fill: "#fbf3e2", stroke: "#3a2a1c", "stroke-width": 4.5 }, g);
    for (let i = 0; i < 12; i++) el("rect", { x: -1, y: -18, width: 2, height: 4, fill: INK, transform: `rotate(${i * 30})` }, g);
    const needle = el("path", { d: "M0,0 V-15", stroke: "#c8382c", "stroke-width": 3.2, "stroke-linecap": "round" }, g);
    return (p) => {
      set(needle, { transform: `rotate(${f1(p.hand)})` });
      set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
    };
  },
  popper(parent) {
    const g = el("g", {}, parent);
    el("path", { d: "M-7,14 L7,14 L14,-24 L-6,-26 Z", fill: "#b79cf7", stroke: INK, "stroke-width": 2 }, g);
    el("path", { d: "M-3,4 L9,1 M0,-8 L12,-11", stroke: "#ffe58a", "stroke-width": 3 }, g);
    const burst = el("g", {}, g);
    star4(burst, 4, -34, 9);
    return (p) => {
      set(burst, { display: p.popped ? "inline" : "none" });
      set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
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
      set(shine, { display: p.shine ? "inline" : "none" });
      set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
    };
  },
  paddle(parent) {
    const g = el("g", {}, parent);
    el("rect", { x: -3.5, y: -22, width: 7, height: 28, rx: 2, fill: "#7a4b22" }, g);
    el("circle", { cy: -44, r: 26, fill: "#fbf3e2", stroke: INK, "stroke-width": 3 }, g);
    const t = text(g, "", { y: -34, "font-size": 30 });
    return (p) => {
      t.textContent = p.text;
      set(t, { fill: p.ink, "font-size": p.size, y: -44 + p.size * 0.36 });
      set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
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
      set(flame, { display: p.lit ? "inline" : "none" });
      set(outer, { d: `M-6,-34 C-9,-44 -3,-50 ${f1(-1 + w(1))},${f1(-62 + w(2))} C4,-52 9,-44 6,-34 Z` });
      set(inner, { d: `M-3,-34 C-4,-40 -1,-44 ${f1(w(3) * 0.5)},${f1(-52 + w(4))} C2,-44 4,-40 3,-34 Z` });
      set(spark, { display: p.spark ? "inline" : "none" });
      set(g, { transform: `translate(${f1(p.x)},${f1(p.y)}) rotate(${f1(p.rot)}) scale(${p.s.toFixed(3)})` });
    };
  },
};

const FX = {
  glint(parent) {
    const g = el("g", {}, parent);
    star4(g, 0, 0, 9, "#fff6d8");
    return (f) => set(g, { transform: `translate(${f1(f.x)},${f1(f.y)}) scale(${Math.max(0.01, f.s).toFixed(3)})` });
  },
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
    const t = text(parent, "", { fill: "#ffe58a" });
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
  qmark(parent) {
    const g = el("g", {}, parent);
    el("circle", { r: 15, fill: "#f4b453", stroke: INK, "stroke-width": 2.5 }, g);
    text(g, "?", { y: 7, "font-size": 21, fill: INK });
    return (f) => set(g, { transform: `translate(${f1(f.x)},${f1(f.y)}) scale(${f.s.toFixed(3)})` });
  },
};

/** Draws a list of props or effects into `parent`, reusing elements between frames. */
function drawList(p, parent, list, lib, prefix) {
  const seen = new Set();
  list.forEach((item, i) => {
    const key = `${prefix}${i}:${item.kind}`;
    seen.add(key);
    let entry = p.cache.get(key);
    if (!entry || entry.parent !== parent) {
      const g = el("g", {}, parent);
      entry = { g, parent, update: lib[item.kind](g) };
      p.cache.set(key, entry);
    }
    set(entry.g, { display: "inline" });
    entry.update(item);
  });
  for (const [key, entry] of p.cache) if (key.startsWith(prefix) && !seen.has(key)) set(entry.g, { display: "none" });
}

/** Puts a pose on a pawn: body, face, hands, props and effects. */
function poseOn(p, pose) {
  applyBody(p, pose.body, pose.face);
  p.limbs ??= [makeLimb(p.hands, p.colour), makeLimb(p.hands, p.colour)];
  for (let i = 0; i < 2; i++) shapeLimb(p.limbs[i], pose.hands[i]);
  drawList(p, p.props, pose.props.filter((x) => x.space !== "stage"), KINDS, "b");
  drawList(p, p.stage, pose.props.filter((x) => x.space === "stage"), KINDS, "s");
  drawList(p, p.fx, pose.fx.filter((x) => !x.onHead), FX, "f");
  drawList(p, p.headFx, pose.fx.filter((x) => x.onHead), FX, "h");
}

/** The other pieces: unchanged, but for where they look and, at most, a drop of sweat. */
function watcherOn(p, look, sweat) {
  const body = { x: 0, dx: 0, lift: 0, rot: 0, pivot: 0, sx: 1, sy: 1, tint: 0, hx: 0, hy: 0, hr: 0 };
  applyBody(p, body, { eyes: "open", eye: 1, look, up: 0, lid: 0, brows: null, mouth: null });
  p.sweat ??= el("path", { d: "M0,-7 C4,-1 4,4 0,4 C-4,4 -4,-1 0,-7 Z", fill: "#8fd3ff", stroke: "#e8f6ff", "stroke-width": 1 }, p.headFx);
  set(p.sweat, { display: sweat === null ? "none" : "inline", transform: `translate(24,${f1(-126 + (sweat ?? 0) * 12)})` });
}

// ---------------------------------------------------------------- a stage: the room's back wall, a floor, three pawns

let stageCount = 0;
function backdrop(svg) {
  const id = ++stageCount;
  const defs = el("defs", {}, svg);
  const lin = (name, stops) => {
    const g = el("linearGradient", { id: `${name}-${id}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    for (const [o, c] of stops) el("stop", { offset: o, "stop-color": c }, g);
  };
  lin("wall", [[0, "#1d120d"], [1, "#150c09"]]);
  lin("floor", [[0, "#3b2217"], [0.35, "#2a1710"], [1, "#150c08"]]);
  const g = el("g", {}, svg);
  el("rect", { x: -900, y: -600, width: 2440, height: 760, fill: `url(#wall-${id})` }, g);
  let planks = "";
  for (let x = -900; x <= 1540; x += 40) planks += `M${x},-600V160`;
  el("path", { d: planks, stroke: "#0d0705", "stroke-width": 2, opacity: 0.75 }, g);
  el("rect", { x: -900, y: 160, width: 2440, height: 62, fill: "#11302a" }, g);
  el("rect", { x: -900, y: 158, width: 2440, height: 4, fill: "#b9853a" }, g);
  el("rect", { x: -900, y: 222, width: 2440, height: 400, fill: `url(#floor-${id})` }, g);
  el("rect", { x: -900, y: 220, width: 2440, height: 3, fill: "#c9b48a", opacity: 0.45 }, g);
  for (let x = -880; x < 1540; x += 46) el("circle", { cx: x, cy: 26 + 10 * Math.sin(x / 50), r: 3.6, fill: "#ffeccb" }, g);
}

function makeStage(svg) {
  svg.replaceChildren();
  backdrop(svg);
  const world = el("g", {}, svg);
  const r = { svg, world };
  r.other2 = makePawn(world, SEATS[3], 130);
  r.other = makePawn(world, SEATS[1], 510);
  r.me = makePawn(world, SEATS[0], 320);
  const over = el("g", {}, svg);
  r.bubble = (() => {
    const g = el("g", { display: "none" }, over);
    const back = el("path", { fill: "#fbf3e2", stroke: INK, "stroke-width": 3, "stroke-linejoin": "round" }, g);
    const t = text(g, "", { "font-size": 22, fill: INK, y: 8 });
    return { g, back, t };
  })();
  r.card = (() => {
    const g = el("g", { display: "none" }, over);
    el("rect", { x: -230, y: -52, width: 460, height: 104, rx: 16, fill: "#120b08", stroke: "#f4b453", "stroke-width": 4 }, g);
    text(g, "MABEL", { "font-size": 18, fill: SEATS[0], y: -18, "letter-spacing": 4 });
    const big = text(g, "", { "font-size": 40, fill: "#fbf3e2", y: 28 });
    return { g, big };
  })();
  return r;
}

/** Draws emote `e` at `t` on stage `r`: treatment "A" (the body), "B" (+ a sticker) or "C" (+ a screen card). */
function drawEmote(r, e, t, treatment = "B", calm = false) {
  const pose = e.pose(t, calm);
  poseOn(r.me, pose);
  watcherOn(r.other, pose.other.look, pose.other.sweat);
  watcherOn(r.other2, 3, null);
  set(r.other.root, { opacity: e.aimed ? 1 : 0.55 });
  set(r.other2.root, { opacity: 0.5 });
  const show = treatment !== "A" && t > 250 && t < e.dur - 250;
  if (show) {
    const tops = pose.hands.filter((h) => h.s > 0.3).map((h) => h.y - 30);
    const top = Math.min(-200, ...tops, ...pose.props.filter((x) => x.space !== "stage" && typeof x.y === "number").map((x) => x.y - 50));
    const head = { x: r.me.baseX + pose.body.x, y: FLOOR + top - Math.max(0, pose.body.lift) };
    r.bubble.t.textContent = e.word;
    const w = Math.max(60, [...e.word].length * 12.5 + 28);
    set(r.bubble.back, { d: `M${-w / 2},-22 h${w} a10,10 0 0 1 10,10 v24 a10,10 0 0 1 -10,10 h${-w / 2 + 10} l-10,12 l-4,-12 h${-w / 2 + 4} a10,10 0 0 1 -10,-10 v-24 a10,10 0 0 1 10,-10 Z` });
    const s = calm ? 1 : EASE.b(clamp((t - 250) / 160, 0, 1));
    const x = clamp(head.x, w / 2 + 12, 640 - w / 2 - 12);
    set(r.bubble.g, { display: "inline", transform: `translate(${f1(x)},${f1(Math.max(30, head.y))}) scale(${s.toFixed(3)})` });
  } else set(r.bubble.g, { display: "none" });
  const card = treatment === "C" && t > 500 && t < Math.min(e.dur - 300, 2400);
  if (card) {
    r.card.big.textContent = e.word.toUpperCase();
    set(r.card.g, { display: "inline", transform: `translate(320,58) scale(${(0.72 * (calm ? 1 : EASE.b(clamp((t - 500) / 200, 0, 1)) * 0.9 + 0.1)).toFixed(3)})` });
  } else set(r.card.g, { display: "none" });
}
