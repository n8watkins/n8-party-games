// The emotes and sounds preview. One page, no files fetched: the kit's sound engine is inlined
// above this script by preview/make-emotes-artifact.mjs, so every sound here is exactly the one
// the room would play. The pawn is the room's own (lobby/public/scene.js, piece()), drawn the
// same way, with arms that only appear while it acts something out.
/* global SoundBoard */
"use strict";

// ---------------------------------------------------------------- small helpers

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
  if (parent) parent.append(e);
  return e;
}
function h(tag, cls = "", text = "", parent = null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.append(e);
  return e;
}
const set = (e, attrs) => {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
};
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
const between = (t, a, b) => t >= a && t < b;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function recall(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, or a host that forbids it: kept for this visit only.
  }
}

/** The room's colour mixing: toward white (amount above 0) or black (below 0). */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const to = amount > 0 ? 255 : 0;
  const m = Math.abs(amount);
  const mix = (c) => Math.round(c + (to - c) * m);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
function mixHex(a, b, u) {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((p >> s) & 255) * (1 - u) + ((q >> s) & 255) * u);
  return "#" + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0");
}
/** The four seat colours of the room (party-kit/src/core/room-core.js). */
const SEATS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"];
const NAMES = ["Mabel", "Tom", "Dolly", "Fitch"];

// ---------------------------------------------------------------- sound

const board = new SoundBoard({ room: "preview" });
let emoteSounds = true;
addEventListener("pointerdown", () => board.unlock(), { capture: true, passive: true });
addEventListener("keydown", () => board.unlock(), { capture: true, passive: true });
const cueTimers = [];
/** Plays a list of [sound, after ms]. Only ever from a tap: the browser allows nothing else. */
function cue(list) {
  for (const t of cueTimers.splice(0)) clearTimeout(t);
  if (!emoteSounds) return;
  for (const [name, at] of list) cueTimers.push(setTimeout(() => void board.play(name, { from: "me" }), at));
}

/** What each sound is called on the page. */
const SOUND_NAMES = {
  horn: "Air horn",
  trombone: "Sad trombone",
  applause: "Applause",
  rimshot: "Ba-dum-tss",
  scratch: "Record scratch",
  crickets: "Crickets",
  boing: "Boing",
  ding: "Ding",
  slide: "Slide whistle",
  boom: "Cinematic boom",
  ooh: "Crowd ooooh",
  laugh: "Canned laugh",
  kazoo: "Kazoo fanfare",
  bell: "Boxing bell",
  dialup: "Dial-up",
  womp: "Womp womp",
  fart: "Cartoon fart",
  violin: "Sad violin",
  sparkle: "Sparkle",
  slowclap: "Slow clap",
  chomp: "Popcorn",
  squeak: "Balloon squeak",
  shaker: "Salt shaker",
  gulp: "Gulp",
  kiss: "Mwah",
  crackle: "Little fire",
  swish: "Swish",
  splat: "Splat",
  slap: "High-five slap",
  pop: "Pop",
};
const soundName = (id) => SOUND_NAMES[id] ?? id;

// ---------------------------------------------------------------- the pawn

const FLOOR = 262;

/**
 * One pawn, as the room draws it, with what an emote needs: arms (hidden at rest), a mouth
 * (the room's pawn has none until it acts), eyes that can close, narrow, look aside or cross,
 * and places to hang props (in each hand, on the body, on the head, on the floor).
 */
function makePawn(parent, colour, x) {
  const p = { colour, baseX: x };
  p.root = el("g", {}, parent);
  p.floor = el("g", {}, p.root);
  p.shadow = el("ellipse", { cy: 5, rx: 40, ry: 9, fill: "#000", opacity: 0.42 }, p.root);
  p.back = el("g", {}, p.root);
  p.body = el("g", {}, p.root);
  p.armBack = el("g", {}, p.body);
  p.base = el("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5, fill: shade(colour, -0.28) }, p.body);
  p.torso = el("path", { d: "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z", fill: shade(colour, 0.16) }, p.body);
  p.collar = el("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8, fill: shade(colour, 0.3) }, p.body);
  p.bodyFx = el("g", {}, p.body);
  p.head = el("g", {}, p.body);
  p.skull = el("circle", { cx: 0, cy: -113, r: 28, fill: shade(colour, 0.16) }, p.head);
  el("ellipse", { cx: -10, cy: -125, rx: 9, ry: 6, fill: "#fff", opacity: 0.26 }, p.head);
  p.eyes = el("g", {}, p.head);
  p.eyeL = el("ellipse", { cx: -9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }, p.eyes);
  p.eyeR = el("ellipse", { cx: 9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }, p.eyes);
  p.glintL = el("circle", { cx: -8, cy: -115.5, r: 1.3, fill: "#fff" }, p.eyes);
  p.glintR = el("circle", { cx: 10, cy: -115.5, r: 1.3, fill: "#fff" }, p.eyes);
  const line = { fill: "none", stroke: "#1a1210", "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round" };
  p.happy = el("path", { d: "M-14,-111 Q-9,-119 -4,-111 M4,-111 Q9,-119 14,-111", ...line, display: "none" }, p.head);
  p.shut = el("path", { d: "M-14,-113 Q-9,-109 -4,-113 M4,-113 Q9,-109 14,-113", ...line, display: "none" }, p.head);
  p.crossed = el("path", { d: "M-14,-118 l10,10 M-4,-118 l-10,10 M4,-118 l10,10 M14,-118 l-10,10", ...line, display: "none" }, p.head);
  p.lids = el("path", { d: "", fill: shade(colour, 0.05), display: "none" }, p.head);
  p.brows = el("path", { d: "", ...line, "stroke-width": 3, display: "none" }, p.head);
  p.mouth = el("path", { d: "", display: "none" }, p.head);
  p.tongue = el("ellipse", { cx: 3, cy: -96, rx: 5, ry: 4, fill: "#e86a7a", display: "none" }, p.head);
  p.headFx = el("g", {}, p.head);
  p.armFront = el("g", {}, p.body);
  p.arms = {};
  for (const side of [-1, 1]) {
    const g = el("g", { display: "none" }, p.armFront);
    const limb = el("path", { fill: "none", stroke: shade(colour, -0.05), "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    const hand = el("g", {}, g);
    el("circle", { r: 7.5, fill: shade(colour, 0.28), stroke: shade(colour, -0.4), "stroke-width": 1.5 }, hand);
    const holds = el("g", {}, hand);
    p.arms[side] = { g, limb, hand, holds };
  }
  p.front = el("g", {}, p.root);
  return p;
}

const REST = () => ({ x: 0, dx: 0, lift: 0, rot: 0, pivot: 0, sx: 1, sy: 1, hx: 0, hy: 0, hr: 0, eye: 1, look: 0, eyes: "open", lid: 0, brows: null, mouth: null, arms: { [-1]: null, [1]: null }, tint: 0, opacity: 1, face: 1 });

/** Where a hand is, in body units, for an arm pose {a, b}: a from straight down, outward positive; b the elbow. */
function armPoints(side, arm) {
  const sx = side * 19;
  const sy = -74;
  const r = (deg) => (deg * Math.PI) / 180;
  const ex = sx + side * Math.sin(r(arm.a)) * 22;
  const ey = sy + Math.cos(r(arm.a)) * 22;
  const t2 = arm.a + arm.b;
  const hx = ex + side * Math.sin(r(t2)) * 22;
  const hy = ey + Math.cos(r(t2)) * 22;
  // The angle the forearm points at, as an SVG rotation of something drawn pointing down.
  const ang = Math.atan2(hy - ey, hx - ex) * (180 / Math.PI) - 90;
  return { sx, sy, ex, ey, hx, hy, ang };
}

function apply(p, q) {
  set(p.root, { transform: `translate(${(p.baseX + q.x).toFixed(1)},${FLOOR})`, opacity: q.opacity });
  set(p.body, { transform: `translate(${q.dx.toFixed(1)},${(-q.lift).toFixed(1)}) rotate(${q.rot.toFixed(1)},0,${-q.pivot}) scale(${q.sx.toFixed(3)},${q.sy.toFixed(3)})` });
  set(p.head, { transform: `translate(${q.hx.toFixed(1)},${q.hy.toFixed(1)}) rotate(${q.hr.toFixed(1)},0,-113)` });
  const air = Math.max(0, q.lift);
  set(p.shadow, { rx: (40 * (1 - Math.min(0.45, air / 260))).toFixed(1), cx: q.dx.toFixed(1) });
  const fill = q.tint ? mixHex(hex(shade(p.colour, 0.16)), "#ff2a14", q.tint) : shade(p.colour, 0.16);
  set(p.torso, { fill });
  set(p.skull, { fill });
  const open = q.eyes === "open";
  set(p.eyes, { display: open ? "inline" : "none" });
  if (open) {
    const ry = 5.6 * q.eye;
    for (const [e, g, cx] of [
      [p.eyeL, p.glintL, -9],
      [p.eyeR, p.glintR, 9],
    ]) {
      set(e, { cx: cx + q.look, ry: Math.max(0.6, ry).toFixed(2), rx: q.eye > 1.05 ? 4.6 : 3.8 });
      set(g, { cx: cx + 1 + q.look, display: q.eye > 0.55 ? "inline" : "none" });
    }
  }
  set(p.happy, { display: q.eyes === "happy" ? "inline" : "none" });
  set(p.shut, { display: q.eyes === "shut" ? "inline" : "none" });
  set(p.crossed, { display: q.eyes === "x" ? "inline" : "none" });
  // Heavy lids: a band of skin over the top of each eye, for a deadpan or a side-eye.
  if (q.lid > 0 && open) {
    const y = -113 - 6 + q.lid * 9;
    set(p.lids, { display: "inline", d: `M-15,-121 H-3 V${y.toFixed(1)} H-15 Z M3,-121 H15 V${y.toFixed(1)} H3 Z` });
  } else set(p.lids, { display: "none" });
  if (q.brows) set(p.brows, { display: "inline", d: q.brows });
  else set(p.brows, { display: "none" });
  const m = MOUTHS[q.mouth];
  if (m) set(p.mouth, { display: "inline", d: m.d, fill: m.fill ?? "none", stroke: "#1a1210", "stroke-width": m.w ?? 3, "stroke-linecap": "round", "stroke-linejoin": "round" });
  else set(p.mouth, { display: "none" });
  set(p.tongue, { display: q.mouth === "tongue" ? "inline" : "none" });
  for (const side of [-1, 1]) {
    const arm = q.arms[side];
    const a = p.arms[side];
    if (!arm) {
      set(a.g, { display: "none" });
      continue;
    }
    const pts = armPoints(side, arm);
    set(a.g, { display: "inline" });
    set(a.limb, { d: `M${pts.sx},${pts.sy} L${pts.ex.toFixed(1)},${pts.ey.toFixed(1)} L${pts.hx.toFixed(1)},${pts.hy.toFixed(1)}` });
    set(a.hand, { transform: `translate(${pts.hx.toFixed(1)},${pts.hy.toFixed(1)}) rotate(${pts.ang.toFixed(1)})` });
    // An arm behind the body (reaching across the back) is drawn behind it.
    const behind = !!arm.behind;
    if (behind && a.g.parentNode !== p.armBack) p.armBack.append(a.g);
    if (!behind && a.g.parentNode !== p.armFront) p.armFront.append(a.g);
  }
}
const hexCache = new Map();
function hex(rgb) {
  if (hexCache.has(rgb)) return hexCache.get(rgb);
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  const out = "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  hexCache.set(rgb, out);
  return out;
}

const MOUTHS = {
  smile: { d: "M-9,-101 Q0,-93 9,-101" },
  grin: { d: "M-11,-102 Q0,-85 11,-102 Z", fill: "#3a1010", w: 2.6 },
  laugh: { d: "M-12,-103 Q0,-82 12,-103 Z", fill: "#3a1010", w: 2.6 },
  o: { d: "M0,-104 a5,6 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2.4 },
  small: { d: "M0,-100 a2.6,3 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2 },
  flat: { d: "M-7,-98 H7" },
  frown: { d: "M-9,-95 Q0,-103 9,-95" },
  wobble: { d: "M-10,-98 l4,-3 l4,3 l4,-3 l4,3 l4,-3" },
  grit: { d: "M-10,-101 H10 V-95 H-10 Z M-5,-101 V-95 M0,-101 V-95 M5,-101 V-95", fill: "#fff", w: 2 },
  tongue: { d: "M-9,-101 Q0,-93 9,-101", w: 3 },
  smirk: { d: "M-7,-99 Q2,-97 9,-103" },
};

const ARM = (a, b = 0, extra = {}) => ({ a, b, ...extra });

// ---------------------------------------------------------------- props

const INK = "#1a1210";
function star4(parent, x, y, r, fill = "#ffe58a") {
  const s = el("path", { d: `M0,${-r} Q${r * 0.18},${-r * 0.18} ${r},0 Q${r * 0.18},${r * 0.18} 0,${r} Q${-r * 0.18},${r * 0.18} ${-r},0 Q${-r * 0.18},${-r * 0.18} 0,${-r} Z`, fill, stroke: "#fff6d8", "stroke-width": 1.2 }, parent);
  const g = el("g", { transform: `translate(${x},${y})` }, parent);
  g.append(s);
  return g;
}
/** Shows a prop between two times with a pop in and out. */
function popIn(node, t, from, to, scale = 1, at = "") {
  const visible = t >= from && t < to;
  if (!visible) return set(node, { display: "none" });
  const u = clamp((t - from) / 160, 0, 1);
  const v = clamp((to - t) / 160, 0, 1);
  const s = scale * (calm() ? 1 : EASE.b(u)) * (v < 1 ? v : 1);
  set(node, { display: "inline", transform: `${at} scale(${Math.max(0.001, s).toFixed(3)})` });
}
function text(parent, str, attrs) {
  const t = el("text", { "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", "font-weight": 900, "text-anchor": "middle", ...attrs }, parent);
  t.textContent = str;
  return t;
}

// ---------------------------------------------------------------- the emotes

/**
 * Every candidate. `frame(r, t, P)` poses the pawns at `t` ms; `setup(r)` makes its props once
 * and returns them as P. `hold` is the moment worth a screenshot (the still and the thumbnail).
 * `sound` is what it carries: [[sound, at ms]]. `word` is its sticker.
 */
const EMOTES = [
  {
    id: "dab",
    short: "Dab",
    name: "The dab",
    line: "Crouch, snap, sparkle.",
    word: "DAB",
    dur: 2300,
    hold: 1000,
    sound: [["horn", 260]],
    setup(r) {
      const g = el("g", {}, r.me.bodyFx);
      return { stars: [star4(g, -78, -150, 11), star4(g, -96, -118, 7), star4(g, -60, -178, 8)] };
    },
    frame(r, t, P) {
      const q = r.q;
      const snap = [[0, 0], [200, 0], [300, 1, "o"], [1800, 1], [2200, 0]];
      const s = k(t, snap);
      q.sy = k(t, [[0, 1], [200, 0.86], [300, 1.05, "o"], [420, 1], [1800, 1]]);
      q.sx = 2 - q.sy;
      q.rot = -12 * s;
      q.lift = k(t, [[0, 0], [200, 0], [300, 12, "o"], [450, 0, "i"]]);
      q.hr = 24 * s;
      q.hy = 7 * s;
      q.hx = 3 * s;
      q.eyes = s > 0.5 ? "shut" : "open";
      q.mouth = s > 0.5 ? "smirk" : null;
      q.arms[-1] = ARM(k(t, [[0, 8], [200, 30], [300, 132, "o"], [1800, 132], [2200, 8]]), 0);
      q.arms[1] = ARM(k(t, [[0, 8], [200, 30], [300, 200, "o"], [1800, 200], [2200, 8]]), k(t, [[0, 0], [200, 20], [300, 58, "o"], [1800, 58], [2200, 0]]));
      P.stars.forEach((st, i) => popIn(st, t, 330 + i * 70, 1800, 1 + (calm() ? 0 : wave(t, 380, 0.25, i)), st.getAttribute("data-at") ?? st.getAttribute("transform").split(" scale")[0]));
    },
  },
  {
    id: "slowclap",
    short: "Slow clap",
    name: "Slow clap",
    line: "Unimpressed. Three claps, an empty hall.",
    word: "*clap*",
    dur: 2500,
    hold: 1150,
    sound: [["slowclap", 600]],
    setup(r) {
      const g = el("g", {}, r.me.bodyFx);
      const lines = el("path", { d: "M-14,-78 l-8,-8 M0,-84 v-12 M14,-78 l8,-8", stroke: "#ffe58a", "stroke-width": 3, "stroke-linecap": "round", fill: "none" }, g);
      return { lines };
    },
    frame(r, t, P) {
      const q = r.q;
      q.eye = 0.5;
      q.lid = 0.55;
      q.mouth = "flat";
      // Hands together at 600, 1150, 1700.
      const claps = [600, 1150, 1700];
      let apart = 1;
      for (const c of claps) apart = Math.min(apart, clamp(Math.abs(t - c) / 260, 0, 1));
      const inSet = t > 250 && t < 2050;
      const b = inSet ? -42 - 30 * (1 - apart) : k(t, [[0, 0], [250, -42], [2050, -42], [2300, 0]]);
      const a = k(t, [[0, 6], [250, -30], [2050, -30], [2300, 6]]);
      q.arms[-1] = ARM(a, b);
      q.arms[1] = ARM(a, b);
      q.sy = 1 - 0.02 * (1 - apart);
      const near = claps.find((c) => t >= c && t < c + 220);
      set(P.lines, { display: near ? "inline" : "none", opacity: near ? 1 - (t - near) / 220 : 0 });
    },
  },
  {
    id: "violin",
    short: "Violin",
    name: "World's smallest violin",
    line: "For your loss. Eyes shut, bow sawing.",
    word: "so sad",
    dur: 2900,
    hold: 1300,
    sound: [["violin", 250]],
    setup(r) {
      const v = el("g", {}, r.me.arms[-1].holds);
      // A tiny violin, held at the chin: body, f-holes, neck, scroll.
      el("path", { d: "M-6,-2 C-12,0 -12,8 -7,10 C-11,13 -10,21 -3,22 L3,22 C10,21 11,13 7,10 C12,8 12,0 6,-2 C3,-3 -3,-3 -6,-2 Z", fill: "#b5651d", stroke: INK, "stroke-width": 1.4 }, v);
      el("rect", { x: -1.5, y: -18, width: 3, height: 17, fill: "#2a1a10" }, v);
      el("circle", { cx: 0, cy: -19, r: 2.4, fill: "#2a1a10" }, v);
      set(v, { transform: "translate(2,2) rotate(-70) scale(0.95)" });
      const bow = el("g", {}, r.me.arms[1].holds);
      el("path", { d: "M0,-26 V26", stroke: "#e8d6b0", "stroke-width": 2 }, bow);
      el("path", { d: "M2,-26 V26", stroke: "#3a2414", "stroke-width": 2.2 }, bow);
      set(bow, { transform: "rotate(70)" });
      const note = el("g", {}, r.me.front);
      el("path", { d: "M0,0 V-16 L10,-19 V-4", stroke: "#fbf3e2", "stroke-width": 2.4, fill: "none" }, note);
      el("ellipse", { cx: -3, cy: 1, rx: 4, ry: 3, fill: "#fbf3e2" }, note);
      el("ellipse", { cx: 7, cy: -2, rx: 4, ry: 3, fill: "#fbf3e2" }, note);
      return { note };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [250, 1], [2450, 1], [2800, 0]]);
      q.hr = 14 * on;
      q.hx = 4 * on;
      q.eyes = on > 0.5 ? "shut" : "open";
      q.brows = on > 0.5 ? "M-15,-124 L-4,-121 M15,-124 L4,-121" : null;
      q.mouth = on > 0.5 ? "frown" : null;
      q.arms[-1] = ARM(6 + 138 * on, 100 * on);
      const saw = calm() ? 0 : wave(t, 520, 1);
      q.arms[1] = ARM(6 + on * (60 + 14 * saw), on * (-75 + 10 * saw));
      q.sy = 1 + 0.015 * wave(t, 1040);
      const u = ((t - 300) % 1100) / 1100;
      set(P.note, { display: t > 300 && t < 2500 ? "inline" : "none", transform: `translate(${(30 + u * 18).toFixed(1)},${(-150 - u * 40).toFixed(1)})`, opacity: (1 - u).toFixed(2) });
    },
  },
  {
    id: "popcorn",
    short: "Popcorn",
    name: "Popcorn",
    line: "Settles in to watch somebody else's mess.",
    word: "this is good",
    dur: 3000,
    hold: 1250,
    sound: [["chomp", 650], ["chomp", 1550]],
    setup(r) {
      const bucket = el("g", {}, r.me.bodyFx);
      el("path", { d: "M-16,-62 L16,-62 L12,-30 L-12,-30 Z", fill: "#fbf3e2", stroke: INK, "stroke-width": 1.5 }, bucket);
      for (const x of [-9, 0, 9]) el("path", { d: `M${x - 2.6},-62 L${x + 2.6},-62 L${x + 2},-30 L${x - 2},-30 Z`, fill: "#d23a2c" }, bucket);
      for (const [x, y] of [[-11, -64], [-4, -67], [4, -66], [11, -64], [0, -70], [-7, -71], [8, -70]]) el("circle", { cx: x, cy: y, r: 4, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, bucket);
      const kernel = el("circle", { r: 3.5, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, r.me.arms[1].holds);
      return { bucket, kernel };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [250, 1], [2600, 1], [2900, 0]]);
      popIn(P.bucket, t, 150, 2800, 1);
      q.look = -4 * on;
      q.eye = 1 + 0.2 * on;
      q.hr = -6 * on;
      q.arms[-1] = ARM(-20 * on + 6, -70 * on);
      // A handful to the mouth every 900 ms.
      const cycle = (t - 400) % 900;
      const eating = t > 400 && t < 2500;
      const up = eating ? (cycle < 300 ? smooth(cycle / 300) : cycle < 600 ? 1 : 1 - smooth((cycle - 600) / 300)) : 0;
      q.arms[1] = ARM(-25 + up * 205 * on, -60 + up * -60);
      set(P.kernel, { display: eating && up > 0.05 && up < 0.98 ? "inline" : "none" });
      q.mouth = eating && cycle > 300 && cycle < 650 ? (Math.floor(t / 110) % 2 ? "o" : "flat") : "smile";
    },
  },
  {
    id: "micdrop",
    short: "Mic drop",
    name: "Mic drop",
    line: "Says nothing. Lets go. Walks away in spirit.",
    word: "BOOM",
    dur: 2700,
    hold: 1350,
    ultimate: true,
    sound: [["boom", 980]],
    setup(r) {
      const mic = el("g", {}, r.me.front);
      el("rect", { x: -3, y: 0, width: 6, height: 22, rx: 2, fill: "#2b2b2b" }, mic);
      el("circle", { cx: 0, cy: -2, r: 7, fill: "#9a9a9a", stroke: "#444", "stroke-width": 1.5 }, mic);
      const dust = el("g", {}, r.me.floor);
      for (const x of [-14, 14, -26, 26]) el("circle", { cx: x, cy: -4, r: 6, fill: "#e8d7b8" }, dust);
      return { mic, dust };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [300, 1, "o"], [2300, 1], [2650, 0]]);
      q.arms[1] = ARM(8 + 95 * up, -10 * up);
      q.hr = -10 * up;
      q.eye = 1 - 0.55 * up;
      q.lid = 0.5 * up;
      q.look = -3 * up;
      q.mouth = up > 0.5 ? "smirk" : null;
      const hand = armPoints(1, q.arms[1]);
      // Held until 700, then it falls (it is drawn in the pawn's place, not in the hand).
      let mx = hand.hx;
      let my = hand.hy - 8;
      let rot = -20;
      if (t >= 700) {
        const f = (t - 700) / 1000;
        const fall = Math.min(1, ((t - 700) / 300) ** 2);
        mx = hand.hx + 6 * Math.min(1, f * 3);
        my = hand.hy - 8 + fall * (-hand.hy + 8 - 4);
        rot = -20 + 110 * fall;
        if (t > 1000) {
          const b = (t - 1000) / 200;
          my -= b < 1 ? Math.sin(b * Math.PI) * 10 : 0;
        }
      }
      set(P.mic, { display: t < 2400 ? "inline" : "none", transform: `translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${rot.toFixed(1)})` });
      const d = (t - 1000) / 420;
      set(P.dust, { display: d > 0 && d < 1 ? "inline" : "none", opacity: (0.5 * (1 - d)).toFixed(2), transform: `translate(${mx.toFixed(1)},0) scale(${(0.6 + d).toFixed(2)},1)` });
      r.shake = between(t, 1000, 1150) ? 4 * (1 - (t - 1000) / 150) : 0;
    },
  },
  {
    id: "flex",
    short: "Flex",
    name: "Flex",
    line: "Inflates. Holds it. Lets the air out with a squeak.",
    word: "GAINS",
    dur: 2900,
    hold: 1050,
    sound: [["squeak", 1500]],
    setup(r) {
      const bulges = [-1, 1].map((side) => el("ellipse", { rx: 9, ry: 7, fill: shade(r.me.colour, 0.28), stroke: shade(r.me.colour, -0.4), "stroke-width": 1.5 }, r.me.arms[side].g));
      const puffs = el("g", {}, r.me.front);
      for (const [x, y] of [[-30, -60], [32, -40], [-24, -100]]) el("path", { d: `M${x},${y} q6,-6 12,0`, stroke: "#fbf3e2", "stroke-width": 2.5, fill: "none", "stroke-linecap": "round" }, puffs);
      return { bulges, puffs };
    },
    frame(r, t, P) {
      const q = r.q;
      const pump = k(t, [[0, 0], [250, -0.08], [700, 1, "b"], [1500, 1], [1900, -0.35, "o"], [2500, -0.35], [2850, 0]]);
      const tremble = between(t, 700, 1500) && !calm() ? wave(t, 60, 0.6) : 0;
      q.sx = 1 + 0.34 * pump;
      q.sy = 1 + 0.1 * pump;
      q.dx = tremble;
      q.lift = Math.max(0, pump) * 4;
      const arms = k(t, [[0, 0], [250, 0], [600, 1, "o"], [1500, 1], [1800, 0]]);
      q.arms[-1] = ARM(8 + 87 * arms, 95 * arms);
      q.arms[1] = ARM(8 + 87 * arms, 95 * arms);
      for (const [i, side] of [-1, 1].entries()) {
        const pts = armPoints(side, q.arms[side]);
        set(P.bulges[i], { display: arms > 0.6 ? "inline" : "none", cx: ((pts.sx + pts.ex) / 2).toFixed(1), cy: ((pts.sy + pts.ey) / 2 - 5).toFixed(1), transform: "" });
      }
      const deflate = between(t, 1500, 1950);
      q.rot = deflate && !calm() ? wave(t, 90, 9) : 0;
      q.eyes = t > 650 && t < 1500 ? "happy" : "open";
      q.eye = t >= 1500 ? 1.25 : 1;
      q.mouth = t > 650 && t < 1500 ? "grin" : t >= 1500 && t < 2500 ? "o" : null;
      set(P.puffs, { display: deflate ? "inline" : "none", opacity: 0.8 });
    },
  },
  {
    id: "sideeye",
    short: "Side-eye",
    name: "Side-eye",
    line: "Turns slowly. The eyes narrow. Nothing is said.",
    word: "hmm.",
    dur: 2800,
    hold: 1500,
    sound: [["scratch", 300]],
    frame(r, t) {
      const q = r.q;
      const turn = k(t, [[0, 0], [300, 0], [900, 1], [2300, 1], [2700, 0]]);
      const narrow = k(t, [[0, 0], [500, 0], [1400, 1, "l"], [2300, 1], [2600, 0]]);
      q.hx = 4 * turn;
      q.hr = 7 * turn;
      q.look = 4.5 * turn;
      q.eye = 1 - 0.55 * narrow;
      q.lid = 0.8 * narrow;
      q.rot = 4 * turn;
      q.mouth = turn > 0.3 ? "flat" : null;
      q.brows = narrow > 0.5 ? "M-15,-121 L-3,-123 M3,-124 L15,-120" : null;
    },
  },
  {
    id: "faint",
    short: "Faint",
    name: "Dramatic faint",
    line: "Hand to the brow, a wobble, and down. A lily for the fallen.",
    word: "I can't even",
    dur: 3000,
    hold: 1500,
    sound: [["trombone", 500]],
    setup(r) {
      const lily = el("g", {}, r.me.bodyFx);
      el("path", { d: "M0,0 C4,-10 2,-24 -2,-36", stroke: "#3f7a4a", "stroke-width": 3, fill: "none" }, lily);
      for (const a of [0, 72, 144, 216, 288]) el("ellipse", { cx: 0, cy: -8, rx: 4.5, ry: 9, fill: "#fbf3e2", stroke: "#cdbfa6", "stroke-width": 1, transform: `translate(-2,-38) rotate(${a})` }, lily);
      el("circle", { cx: -2, cy: -38, r: 3, fill: "#f4b453" }, lily);
      return { lily };
    },
    frame(r, t, P) {
      const q = r.q;
      const brow = k(t, [[0, 0], [250, 1, "o"], [700, 1], [950, 0]]);
      q.arms[1] = ARM(6 + 168 * brow, 105 * brow);
      q.rot = between(t, 250, 700) && !calm() ? wave(t, 260, 5) : 0;
      const down = k(t, [[0, 0], [700, 0], [1050, 1, "i"], [2500, 1], [2900, 0]]);
      q.rot += -90 * down;
      q.pivot = 70;
      q.lift = -36 * down + (between(t, 1050, 1200) ? Math.sin(((t - 1050) / 150) * Math.PI) * 8 : 0);
      q.eyes = down > 0.5 ? "x" : t > 250 ? "shut" : "open";
      q.mouth = t > 250 ? "o" : null;
      q.arms[-1] = down > 0.5 ? ARM(40, -60) : null;
      popIn(P.lily, t, 1250, 2550, 1, "translate(-12,-60) rotate(90)");
    },
  },
  {
    id: "salt",
    short: "Salty",
    name: "Salty",
    line: "Pours salt on the floor. Watches it pile up.",
    word: "salty",
    dur: 3000,
    hold: 1500,
    sound: [["shaker", 350]],
    setup(r) {
      const shaker = el("g", {}, r.me.arms[1].holds);
      el("path", { d: "M-6,4 L6,4 L7,22 L-7,22 Z", fill: "#e9eef0", stroke: INK, "stroke-width": 1.4 }, shaker);
      el("rect", { x: -6, y: 0, width: 12, height: 5, rx: 2, fill: "#9aa3a8", stroke: INK, "stroke-width": 1.2 }, shaker);
      set(shaker, { transform: "rotate(180) translate(0,-6)" });
      const grains = el("g", {}, r.me.front);
      const dots = Array.from({ length: 26 }, () => el("rect", { width: 2.4, height: 2.4, fill: "#fff" }, grains));
      const pile = el("ellipse", { cy: -2, rx: 0, ry: 0, fill: "#f4f4f4" }, r.me.floor);
      return { dots, pile };
    },
    frame(r, t, P) {
      const q = r.q;
      const out = k(t, [[0, 0], [300, 1, "o"], [2500, 1], [2900, 0]]);
      const shake = between(t, 350, 2200) && !calm() ? wave(t, 140, 6) : 0;
      q.arms[1] = ARM(8 + 92 * out + shake, -30 * out);
      q.eye = 1 - 0.45 * out;
      q.lid = 0.4 * out;
      q.look = 3 * out;
      q.hr = 10 * out;
      q.mouth = out > 0.5 ? "smirk" : null;
      const hand = armPoints(1, q.arms[1]);
      P.dots.forEach((d, i) => {
        const born = 380 + i * 70;
        const u = (t - born) / 380;
        const show = u >= 0 && u < 1 && t < 2300;
        set(d, { display: show ? "inline" : "none", x: (hand.hx + Math.sin(i * 7.1) * 4).toFixed(1), y: (hand.hy + 14 + u * (-hand.hy - 14)).toFixed(1) });
      });
      const grown = clamp((t - 600) / 1700, 0, 1) * (t < 2700 ? 1 : 0);
      set(P.pile, { cx: hand.hx.toFixed(1), rx: (14 * grown).toFixed(1), ry: (4 * grown).toFixed(1) });
    },
  },
  {
    id: "sweat",
    short: "Sweat",
    name: "Nervous sweat",
    line: "Shrinks a little. Eyes dart. Tugs the collar.",
    word: "uh oh",
    dur: 2700,
    hold: 1200,
    sound: [["gulp", 900]],
    setup(r) {
      const drops = Array.from({ length: 4 }, () => el("path", { d: "M0,-7 C4,-1 4,4 0,4 C-4,4 -4,-1 0,-7 Z", fill: "#8fd3ff", stroke: "#e8f6ff", "stroke-width": 1 }, r.me.headFx));
      return { drops };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [250, 1], [2300, 1], [2650, 0]]);
      q.dx = calm() ? 0 : wave(t, 45, 1.3 * on);
      q.sy = 1 - 0.07 * on;
      q.sx = 1 - 0.03 * on;
      q.eye = 1 + 0.25 * on;
      q.look = calm() ? 0 : (Math.floor(t / 330) % 2 ? 4 : -4) * on;
      q.mouth = on > 0.4 ? "wobble" : null;
      q.arms[1] = ARM(-20 * on + 6, -95 * on);
      P.drops.forEach((d, i) => {
        const born = 250 + i * 420;
        const u = (t - born) / 520;
        const side = i % 2 ? 1 : -1;
        if (u < 0 || u > 1 || t > 2400) return set(d, { display: "none" });
        set(d, { display: "inline", transform: `translate(${(side * (24 + u * 26)).toFixed(1)},${(-128 - Math.sin(u * Math.PI) * 18 + u * 30).toFixed(1)}) rotate(${side * 30})`, opacity: (1 - u * 0.6).toFixed(2) });
      });
    },
  },
  {
    id: "loading",
    short: "Thinking",
    name: "Thinking...",
    line: "Freezes. A spinner over the head. Then it clicks.",
    word: "loading...",
    dur: 3100,
    hold: 1300,
    sound: [["dialup", 150]],
    setup(r) {
      const spin = el("g", {}, r.me.headFx);
      const dots = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        dots.push(el("circle", { cx: Math.cos(a) * 15, cy: Math.sin(a) * 15, r: 3.6, fill: "#fbf3e2" }, spin));
      }
      const bang = el("g", {}, r.me.headFx);
      el("rect", { x: -4, y: -26, width: 8, height: 22, rx: 3, fill: "#f4b453" }, bang);
      el("circle", { cx: 0, cy: 4, r: 4.5, fill: "#f4b453" }, bang);
      return { spin, dots, bang };
    },
    frame(r, t, P) {
      const q = r.q;
      const thinking = t > 150 && t < 2300;
      q.eye = thinking ? 1 : 1;
      q.mouth = thinking ? "flat" : t >= 2300 && t < 2900 ? "o" : null;
      q.look = 0;
      if (t >= 2300 && t < 2900) {
        q.eye = 1.3;
        q.lift = Math.sin(clamp((t - 2300) / 300, 0, 1) * Math.PI) * 18;
      }
      popIn(P.spin, t, 150, 2300, 1, "translate(44,-150)");
      const lit = Math.floor(t / 110) % 8;
      P.dots.forEach((d, i) => set(d, { opacity: ((i - lit + 8) % 8) / 8 + 0.15 }));
      popIn(P.bang, t, 2300, 2950, 1.2, "translate(44,-150)");
    },
  },
  {
    id: "chefkiss",
    short: "Chef's kiss",
    name: "Chef's kiss",
    line: "Fingers to the lips. Mwah. Perfection.",
    word: "perfection",
    dur: 2400,
    hold: 1000,
    sound: [["kiss", 620], ["sparkle", 700]],
    setup(r) {
      const burst = el("g", {}, r.me.front);
      const parts = [0, 1, 2, 3, 4].map((i) => star4(burst, 0, 0, 6 + (i % 2) * 3, i % 2 ? "#ffd2e0" : "#ffe58a"));
      return { burst, parts };
    },
    frame(r, t, P) {
      const q = r.q;
      const toLips = k(t, [[0, 0], [400, 1, "o"], [600, 1], [700, 0.2, "o"], [1900, 0.2], [2300, 0]]);
      const fling = k(t, [[0, 0], [600, 0], [700, 1, "o"], [1900, 1], [2300, 0]]);
      q.arms[1] = ARM(6 + 168 * toLips + 90 * fling * (1 - toLips), -150 * toLips);
      q.eyes = t > 350 && t < 2000 ? "shut" : "open";
      q.mouth = t > 350 && t < 680 ? "small" : t >= 680 && t < 2000 ? "smile" : null;
      q.hr = -8 * fling;
      const hand = armPoints(1, q.arms[1]);
      const u = clamp((t - 680) / 600, 0, 1);
      set(P.burst, { display: t > 680 && t < 1500 ? "inline" : "none", transform: `translate(${hand.hx.toFixed(1)},${(hand.hy - q.lift).toFixed(1)})`, opacity: (1 - u * 0.7).toFixed(2) });
      P.parts.forEach((p, i) => {
        const a = -Math.PI / 2 + (i - 2) * 0.55;
        set(p, { transform: `translate(${(Math.cos(a) * 34 * u).toFixed(1)},${(Math.sin(a) * 34 * u).toFixed(1)})` });
      });
    },
  },
  {
    id: "crown",
    short: "Crown",
    tall: 26,
    name: "Crown yourself",
    line: "Takes the crown from the sky and puts it on.",
    word: "royalty",
    dur: 2900,
    hold: 1350,
    ultimate: true,
    sound: [["kazoo", 900]],
    setup(r) {
      const crown = el("g", {}, r.me.body);
      el("path", { d: "M-22,0 L-22,-20 L-11,-8 L0,-26 L11,-8 L22,-20 L22,0 Z", fill: "#f4c542", stroke: "#8a5a10", "stroke-width": 2, "stroke-linejoin": "round" }, crown);
      for (const x of [-11, 0, 11]) el("circle", { cx: x, cy: -5, r: 3, fill: x ? "#c8382c" : "#2f6f8f" }, crown);
      const sparkle = el("g", {}, r.me.headFx);
      const stars = [star4(sparkle, -36, -160, 8), star4(sparkle, 38, -150, 6), star4(sparkle, 30, -182, 7)];
      return { crown, stars };
    },
    frame(r, t, P) {
      const q = r.q;
      const reach = k(t, [[0, 0], [400, 1, "o"], [1000, 1], [1300, 0]]);
      q.arms[-1] = ARM(6 + 166 * reach, -12 * reach);
      q.arms[1] = ARM(6 + 166 * reach, -12 * reach);
      const cy = k(t, [[0, -300], [400, -195, "o"], [600, -195], [1000, -138, "s"], [2500, -138], [2800, -300, "i"]]);
      set(P.crown, { transform: `translate(0,${cy.toFixed(1)})` });
      const proud = k(t, [[0, 0], [1000, 0], [1250, 1, "o"], [2500, 1], [2850, 0]]);
      q.sy = 1 + 0.06 * proud;
      q.lift = 6 * proud;
      q.eyes = proud > 0.5 ? "shut" : "open";
      q.mouth = proud > 0.5 ? "smile" : null;
      q.hr = -5 * proud;
      P.stars.forEach((s, i) => set(s, { display: proud > 0.5 && t < 2500 ? "inline" : "none", opacity: calm() ? 1 : 0.6 + 0.4 * wave(t, 400, 1, i * 2) }));
    },
  },
  {
    id: "moonwalk",
    short: "Moonwalk",
    name: "Moonwalk out",
    line: "Leans back, glides off the screen. Peeks back in.",
    word: "smooth",
    dur: 3400,
    hold: 1100,
    sound: [["slide", 300]],
    setup(r) {
      const hat = el("g", {}, r.me.headFx);
      el("path", { d: "M-24,-134 L24,-134 L16,-138 L13,-156 Q0,-162 -13,-156 L-16,-138 Z", fill: "#1d1d22", stroke: "#000", "stroke-width": 1.5 }, hat);
      el("rect", { x: -14, y: -142, width: 28, height: 4, fill: "#f4b453" }, hat);
      return { hat };
    },
    frame(r, t, P) {
      const q = r.q;
      const go = k(t, [[0, 0], [300, 0], [2000, 1, "l"]]);
      q.x = -460 * go;
      q.rot = k(t, [[0, 0], [300, 7], [2000, 7], [2300, 0]]);
      q.sy = 1 + (between(t, 300, 2000) && !calm() ? Math.abs(wave(t, 420, 0.04)) : 0);
      q.eyes = between(t, 300, 2100) ? "shut" : "open";
      q.mouth = "smirk";
      q.arms[1] = ARM(k(t, [[0, 8], [300, 150], [2000, 150]]), -60);
      set(P.hat, { display: t < 3300 ? "inline" : "none" });
      // Peeks back in from the edge, then is gone.
      if (t >= 2300) {
        const peek = k(t, [[2300, 0], [2600, 1, "o"], [2900, 1], [3200, 0]]);
        q.x = -460 + 150 * peek;
        q.rot = -18 * peek;
        q.eyes = "open";
        q.look = 4;
      }
      if (t >= 3300) q.x = 0;
    },
  },
  {
    id: "fine",
    short: "This is fine",
    tall: 26,
    name: "This is fine",
    line: "Calm. Sips tea. A small fire on its head.",
    word: "this is fine",
    dur: 3200,
    hold: 1500,
    sound: [["crackle", 100]],
    setup(r) {
      const fire = el("g", {}, r.me.headFx);
      const outer = el("path", { fill: "#ff7a1a" }, fire);
      const inner = el("path", { fill: "#ffd84a" }, fire);
      const mug = el("g", {}, r.me.arms[1].holds);
      el("rect", { x: -7, y: 2, width: 14, height: 14, rx: 2, fill: "#fbf3e2", stroke: INK, "stroke-width": 1.4 }, mug);
      el("path", { d: "M7,5 q6,0 6,5 q0,5 -6,5", fill: "none", stroke: INK, "stroke-width": 1.6 }, mug);
      set(mug, { transform: "rotate(180) translate(0,-8)" });
      return { fire, outer, inner };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [200, 1], [2900, 1], [3150, 0]]);
      q.eyes = on > 0.5 ? "happy" : "open";
      q.mouth = on > 0.5 ? "smile" : null;
      const sip = between(t, 1000, 1700) ? smooth(clamp((t - 1000) / 250, 0, 1)) * (1 - smooth(clamp((t - 1450) / 250, 0, 1))) : 0;
      q.arms[1] = ARM(6 + on * (35 + 120 * sip), on * (-70 - 50 * sip));
      const f = calm() ? 0 : t / 1000;
      const big = 1 + 0.25 * clamp((t - 1500) / 1000, 0, 1);
      const flick = (n) => (Math.sin(f * 17 + n) + Math.sin(f * 11.3 + n * 2)) * 2;
      set(P.outer, { d: `M-12,-138 C-14,-150 -6,-156 -4,-${(166 + flick(1)) * 1} C-2,-158 2,-160 ${2 + flick(2) / 2},-${170 + flick(3)} C8,-160 14,-152 12,-138 Z` });
      set(P.inner, { d: `M-6,-138 C-7,-146 -2,-150 ${flick(4) / 2},-${156 + flick(5)} C3,-150 7,-146 6,-138 Z` });
      set(P.fire, { display: t > 150 && t < 3000 ? "inline" : "none", transform: `translate(0,-138) scale(${(big * on).toFixed(2)}) translate(0,138)` });
    },
  },
  {
    id: "trickshot",
    short: "Trick shot",
    name: "Trick shot",
    line: "Double spin, flick, into the cup. Finger guns.",
    word: "NAILED IT",
    dur: 3000,
    hold: 1650,
    ultimate: true,
    sound: [["swish", 280], ["ding", 1400]],
    setup(r) {
      const cup = el("g", {}, r.world);
      el("path", { d: "M-14,-30 L14,-30 L10,0 L-10,0 Z", fill: "#c8382c", stroke: INK, "stroke-width": 1.5 }, cup);
      el("ellipse", { cx: 0, cy: -30, rx: 14, ry: 4, fill: "#7a1d12", stroke: INK, "stroke-width": 1.2 }, cup);
      set(cup, { transform: `translate(${r.me.baseX + 112},${FLOOR})` });
      const ball = el("circle", { r: 6, fill: "#fbf3e2", stroke: INK, "stroke-width": 1.2 }, r.world);
      const glow = el("circle", { cx: r.me.baseX + 112, cy: FLOOR - 34, r: 26, fill: "#ffe58a", opacity: 0 }, r.world);
      return { cup, ball, glow };
    },
    frame(r, t, P) {
      const q = r.q;
      q.sy = k(t, [[0, 1], [220, 0.86], [300, 1.08, "o"], [860, 1], [900, 0.88], [1000, 1]]);
      q.lift = k(t, [[0, 0], [250, 0], [560, 78, "o"], [880, 0, "i"]]);
      const spin = calm() ? 0 : k(t, [[0, 0], [280, 0], [860, 720, "l"]]);
      q.pivot = 70;
      q.sx = 1 - 0.3 * Math.abs(Math.sin((spin * Math.PI) / 180));
      const guns = k(t, [[0, 0], [1000, 0], [1200, 1, "o"], [2600, 1], [2950, 0]]);
      q.arms[-1] = ARM(8 + 80 * guns, -15 * guns);
      q.arms[1] = ARM(8 + 82 * guns, -10 * guns);
      q.eyes = guns > 0.5 ? "open" : t > 280 && t < 860 ? "shut" : "open";
      q.eye = guns > 0.5 ? 0.6 : 1;
      q.lid = guns > 0.5 ? 0.35 : 0;
      q.mouth = guns > 0.5 ? "grin" : null;
      // The ball: from the hand at the top of the spin to the cup.
      const start = { x: r.me.baseX + 20, y: FLOOR - 160 };
      const end = { x: r.me.baseX + 112, y: FLOOR - 30 };
      const u = clamp((t - 860) / 520, 0, 1);
      const show = t > 860 && t < 1400;
      set(P.ball, { display: show ? "inline" : "none", cx: (start.x + (end.x - start.x) * u).toFixed(1), cy: (start.y + (end.y - start.y) * u - Math.sin(u * Math.PI) * 90).toFixed(1) });
      set(P.glow, { opacity: t > 1380 && t < 2000 ? (0.55 * (1 - (t - 1380) / 620)).toFixed(2) : 0 });
      r.spin = spin;
    },
  },
  {
    id: "deadpan",
    short: "Deadpan",
    name: "Deadpan stare",
    line: "Turns to the camera. The camera slowly comes in.",
    word: "...",
    dur: 3200,
    hold: 2300,
    sound: [["crickets", 300]],
    frame(r, t) {
      const q = r.q;
      const on = k(t, [[0, 0], [300, 1], [2800, 1], [3100, 0]]);
      q.eye = 1 - 0.35 * on;
      q.lid = 0.6 * on;
      q.look = 0;
      q.mouth = on > 0.3 ? "flat" : null;
      r.zoom = 1 + (calm() ? 0.9 : 1.6) * k(t, [[0, 0], [300, 0], [2500, 1, "l"], [2800, 1], [3000, 0, "o"]]);
      r.zoomAt = { x: r.me.baseX, y: FLOOR - 112 };
    },
  },
  {
    id: "rage",
    short: "Rage quit",
    name: "Rage quit",
    line: "Goes red, steams, stomps. Holds up the sign.",
    word: "RAGE QUIT",
    dur: 3000,
    hold: 1600,
    sound: [["bell", 1250]],
    setup(r) {
      const steam = [-1, 1].map((s) => el("path", { d: `M${s * 24},-134 q${s * 6},-8 0,-14 q${-s * 6},-6 0,-14`, stroke: "#eeeeee", "stroke-width": 4, fill: "none", "stroke-linecap": "round" }, r.me.headFx));
      const sign = el("g", {}, r.me.arms[1].holds);
      el("rect", { x: -2, y: 0, width: 4, height: 40, fill: "#7a4b22" }, sign);
      el("rect", { x: -34, y: 34, width: 68, height: 30, rx: 3, fill: "#fbf3e2", stroke: INK, "stroke-width": 1.6 }, sign);
      text(sign, "I QUIT", { x: 0, y: 55, "font-size": 15, fill: "#c8382c", transform: "rotate(180,0,49)" });
      const dust = el("g", {}, r.me.floor);
      for (const x of [-30, 30, -44, 44]) el("circle", { cx: x, cy: -3, r: 7, fill: "#e8d7b8" }, dust);
      return { steam, sign, dust };
    },
    frame(r, t, P) {
      const q = r.q;
      const red = k(t, [[0, 0], [200, 0], [900, 0.85], [2600, 0.85], [2950, 0]]);
      q.tint = red;
      q.dx = calm() ? 0 : wave(t, 40, 2.5 * red * (t < 1200 ? 1 : 0.3));
      q.eye = 1 - 0.4 * red;
      q.brows = red > 0.3 ? "M-15,-127 L-3,-120 M15,-127 L3,-120" : null;
      q.mouth = red > 0.3 ? "grit" : null;
      q.lift = k(t, [[0, 0], [1000, 0], [1150, 26, "o"], [1250, 0, "i"]]);
      r.shake = between(t, 1250, 1400) ? 5 * (1 - (t - 1250) / 150) : 0;
      const sign = k(t, [[0, 0], [1300, 0], [1500, 1, "b"], [2600, 1], [2900, 0]]);
      q.arms[1] = ARM(8 + 160 * sign, 0);
      set(P.sign, { display: sign > 0.05 ? "inline" : "none" });
      P.steam.forEach((s, i) => {
        const u = ((t + i * 250) % 600) / 600;
        set(s, { display: red > 0.4 && t < 2600 ? "inline" : "none", transform: `translate(0,${(-u * 16).toFixed(1)})`, opacity: (1 - u).toFixed(2) });
      });
      const d = (t - 1250) / 420;
      set(P.dust, { display: d > 0 && d < 1 ? "inline" : "none", opacity: (0.5 * (1 - d)).toFixed(2), transform: `scale(${(0.6 + d).toFixed(2)},1)` });
    },
  },
  {
    id: "bow",
    short: "Bow",
    name: "Take a bow",
    line: "A deep, theatrical bow. Roses land at its feet.",
    word: "thank you, thank you",
    dur: 2900,
    hold: 1450,
    sound: [["applause", 450]],
    setup(r) {
      const roses = [0, 1, 2].map(() => {
        const g = el("g", {}, r.world);
        el("path", { d: "M0,0 L0,22", stroke: "#3f7a4a", "stroke-width": 2.6 }, g);
        el("circle", { cx: 0, cy: 0, r: 6, fill: "#c8382c", stroke: "#7a1d12", "stroke-width": 1.2 }, g);
        return g;
      });
      return { roses };
    },
    frame(r, t, P) {
      const q = r.q;
      const bow = k(t, [[0, 0], [300, -0.1], [800, 1, "o"], [2100, 1], [2600, 0]]);
      // Toward the people watching: it folds down, and the head comes forward over the collar.
      q.sy = 1 - 0.2 * bow;
      q.sx = 1 + 0.04 * bow;
      q.hy = 24 * bow;
      q.hr = 0;
      q.arms[1] = ARM(6 - 30 * Math.max(0, bow), -70 * Math.max(0, bow));
      q.arms[-1] = ARM(6 + 80 * Math.max(0, bow), 0);
      q.eyes = bow > 0.4 ? "shut" : "open";
      q.mouth = bow > 0.4 ? "smile" : null;
      P.roses.forEach((rose, i) => {
        const born = 800 + i * 180;
        const u = clamp((t - born) / 450, 0, 1);
        const x = r.me.baseX - 40 + i * 40;
        set(rose, { display: t > born && t < 2600 ? "inline" : "none", transform: `translate(${x},${(FLOOR - 320 + u * 300).toFixed(1)}) rotate(${(u * (200 + i * 40)).toFixed(0)})` });
      });
    },
  },
];

/** Aimed at someone, or needing a friend. `target` is the pawn on the right. */
const TARGETED = [
  {
    id: "tomato",
    short: "Tomato",
    name: "Throw a tomato",
    line: "At the nearest piece. Splat, and it drips.",
    word: "SPLAT",
    dur: 3000,
    hold: 1500,
    target: true,
    sound: [["swish", 380], ["splat", 950]],
    setup(r) {
      const tomato = el("g", {}, r.world);
      el("circle", { r: 9, fill: "#e0402e", stroke: "#7a1d12", "stroke-width": 1.5 }, tomato);
      el("path", { d: "M-4,-8 l4,-4 l4,4", stroke: "#3f7a4a", "stroke-width": 2.4, fill: "none" }, tomato);
      const splat = el("g", {}, r.other.headFx);
      el("path", { d: "M-20,-120 q-8,-12 4,-14 q2,-12 12,-4 q10,-10 14,2 q12,0 6,12 q8,10 -4,14 q-4,10 -14,4 q-10,6 -12,-4 q-12,-2 -6,-10 Z", fill: "#d8331f", opacity: 0.92 }, splat);
      const drips = [-8, 6, 14].map((x) => el("path", { d: `M${x},-104 q2,10 0,14 q-2,-4 0,-14`, fill: "#d8331f" }, splat));
      return { tomato, splat, drips };
    },
    frame(r, t, P) {
      const q = r.q;
      const o = r.qo;
      const wind = k(t, [[0, 0], [380, 1, "o"], [480, -0.6, "o"], [900, -0.4], [2600, 0]]);
      q.arms[1] = ARM(8 + (wind > 0 ? 160 * wind : 70 * -wind), wind > 0 ? 30 * wind : 0);
      q.rot = -8 * Math.max(0, wind) + 6 * Math.max(0, -wind);
      q.mouth = t > 950 ? "laugh" : "grin";
      q.eyes = t > 950 && t < 2600 ? "happy" : "open";
      q.lift = t > 950 && t < 2400 && !calm() ? Math.abs(wave(t, 300, 6)) : 0;
      const from = { x: r.me.baseX + 30, y: FLOOR - 150 };
      const to = { x: r.other.baseX, y: FLOOR - 113 };
      const u = clamp((t - 480) / 470, 0, 1);
      set(P.tomato, { display: t > 480 && t < 950 ? "inline" : "none", transform: `translate(${(from.x + (to.x - from.x) * u).toFixed(1)},${(from.y + (to.y - from.y) * u - Math.sin(u * Math.PI) * 70).toFixed(1)}) rotate(${(u * 540).toFixed(0)})` });
      const hit = t >= 950 && t < 2700;
      set(P.splat, { display: hit ? "inline" : "none" });
      P.drips.forEach((d, i) => set(d, { transform: `translate(0,${hit ? Math.min(26, ((t - 1000 - i * 200) / 1200) * 26).toFixed(1) : 0})` }));
      const recoil = k(t, [[0, 0], [950, 0], [1050, 1, "o"], [1400, 0.4], [2600, 0.4], [2900, 0]]);
      o.rot = 10 * recoil;
      o.sy = 1 - 0.1 * (t > 950 && t < 1100 ? 1 : 0);
      o.eyes = hit ? "shut" : "open";
      o.mouth = hit ? "o" : null;
    },
  },
  {
    id: "pointlaugh",
    short: "Point & laugh",
    name: "Point and laugh",
    line: "At whoever was just knocked over.",
    word: "HA HA",
    dur: 2900,
    hold: 1200,
    target: true,
    sound: [["laugh", 200]],
    setup(r) {
      const ha = el("g", {}, r.world);
      const a = text(ha, "HA", { "font-size": 22, fill: "#ffe58a", x: r.me.baseX - 34, y: FLOOR - 172 });
      const b = text(ha, "HA", { "font-size": 26, fill: "#ffe58a", x: r.me.baseX + 30, y: FLOOR - 186 });
      return { a, b };
    },
    frame(r, t, P) {
      const q = r.q;
      const o = r.qo;
      // The target lies where a bump put it, as in the room.
      o.rot = -90;
      o.pivot = 70;
      o.lift = -36;
      o.eyes = "x";
      const point = k(t, [[0, 0], [250, 1, "o"], [2500, 1], [2850, 0]]);
      q.arms[1] = ARM(8 + 82 * point, -6 * point);
      q.arms[-1] = point > 0.5 ? ARM(-30, -80) : null;
      q.eyes = point > 0.5 ? "happy" : "open";
      q.mouth = point > 0.5 ? "laugh" : null;
      q.rot = point > 0.5 && !calm() ? -8 + wave(t, 260, 4) : 0;
      q.lift = point > 0.5 && !calm() ? Math.abs(wave(t, 260, 7)) : 0;
      set(P.a, { display: between(t, 300, 2500) && Math.floor(t / 260) % 2 ? "inline" : "none" });
      set(P.b, { display: between(t, 430, 2500) && Math.floor(t / 260) % 2 === 0 ? "inline" : "none" });
    },
  },
  {
    id: "highfive",
    short: "High five",
    name: "High five?",
    line: "Up goes the hand. Somebody has 1.5 s to answer, or you are left hanging.",
    word: "HIGH FIVE!",
    dur: 3200,
    hold: 1300,
    target: true,
    interactive: true,
    sound: [],
    setup(r) {
      const ring = el("circle", { r: 16, fill: "none", stroke: "#4fc3b0", "stroke-width": 4, "stroke-linecap": "round", pathLength: 100, transform: "rotate(-90)" }, r.world);
      const burst = el("g", {}, r.world);
      for (let i = 0; i < 6; i++) star4(burst, Math.cos((i / 6) * 6.28) * 26, Math.sin((i / 6) * 6.28) * 26, 7);
      return { ring, burst };
    },
    frame(r, t, P) {
      const q = r.q;
      const o = r.qo;
      const answered = r.state.answeredAt;
      const up = k(t, [[0, 0], [300, 1, "o"]]);
      const slap = answered !== null && answered !== undefined ? answered + 220 : null;
      const lean = slap ? k(t, [[0, 0], [slap - 220, 0], [slap, 1, "i"], [slap + 900, 1], [slap + 1300, 0]]) : 0;
      q.arms[1] = ARM(8 + 150 * up, -10 * up);
      q.x = 40 * lean;
      if (slap) {
        o.arms[-1] = ARM(k(t, [[answered, 8], [answered + 200, 158, "o"]]), -10);
        o.x = -40 * lean;
        o.eyes = t >= slap ? "happy" : "open";
        o.mouth = t >= slap ? "grin" : "smile";
        q.eyes = t >= slap ? "happy" : "open";
        q.mouth = "grin";
        const b = (t - slap) / 500;
        set(P.burst, { display: b > 0 && b < 1 ? "inline" : "none", transform: `translate(${(r.me.baseX + r.other.baseX) / 2},${FLOOR - 172}) scale(${(0.5 + b).toFixed(2)})`, opacity: (1 - b).toFixed(2) });
        set(P.ring, { display: "none" });
        if (t > slap + 1500) Object.assign(q, { arms: { [-1]: null, [1]: ARM(k(t, [[slap + 1500, 158], [slap + 1800, 8]]), 0) } });
      } else {
        const left = 1 - clamp((t - 300) / 1500, 0, 1);
        const hand = armPoints(1, q.arms[1]);
        set(P.ring, { display: t > 300 && left > 0 ? "inline" : "none", cx: 0, cy: 0, transform: `translate(${(r.me.baseX + hand.hx).toFixed(1)},${(FLOOR + hand.hy - 30).toFixed(1)}) rotate(-90)`, "stroke-dasharray": `${(left * 100).toFixed(1)} 100` });
        set(P.burst, { display: "none" });
        q.mouth = "smile";
        if (t > 1800) {
          // Left hanging: the hand comes down slowly, eyes to the floor.
          const sag = k(t, [[1800, 0], [2600, 1]]);
          q.arms[1] = ARM(158 - 120 * sag, -10 - 50 * sag);
          q.look = -2;
          q.eye = 0.7;
          q.mouth = "wobble";
          q.hr = 8 * sag;
        }
      }
    },
  },
  {
    id: "wavespread",
    short: "The wave",
    name: "The wave spreads",
    line: "You wave. Each player who joins in makes it bigger.",
    word: "WAVE x3",
    dur: 3200,
    hold: 1650,
    target: true,
    three: true,
    sound: [["ooh", 600]],
    frame(r, t) {
      const pawns = [r.qo2, r.q, r.qo];
      const starts = [700, 200, 1200];
      pawns.forEach((q, i) => {
        if (!q) return;
        const s = starts[i];
        const on = k(t, [[0, 0], [s, 0], [s + 200, 1, "o"], [2800, 1], [3100, 0]]);
        const size = 1 + i * 0.0 + (t > 1200 ? 0.3 : t > 700 ? 0.15 : 0);
        q.arms[1] = ARM(8 + 150 * on, calm() ? 0 : wave(t, 380, 28 * on, i));
        q.arms[-1] = t > 1200 ? ARM(8 + 150 * on, calm() ? 0 : -wave(t, 380, 28 * on, i)) : null;
        q.lift = on > 0.5 && t > 1200 && !calm() ? Math.abs(wave(t + i * 120, 500, 14 * size)) : 0;
        q.eyes = on > 0.5 ? "happy" : "open";
        q.mouth = on > 0.5 ? "grin" : null;
      });
      r.word = t > 1200 ? "WAVE x3" : t > 700 ? "WAVE x2" : "WAVE";
    },
  },
];

const ALL = [...EMOTES, ...TARGETED];
/** The sounds an emote carries, each named once. */
const soundsOf = (e) => [...new Set(e.sound.map(([s]) => soundName(s)))].join(" + ");
const byId = (id) => ALL.find((e) => e.id === id);

// ---------------------------------------------------------------- a stage: the room's back wall, a floor, pawns

function backdrop(svg) {
  const defs = el("defs", {}, svg);
  const lin = (id, stops) => {
    const g = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    for (const [o, c] of stops) el("stop", { offset: o, "stop-color": c }, g);
  };
  lin("pv-wall", [[0, "#1d120d"], [1, "#150c09"]]);
  lin("pv-floor", [[0, "#3b2217"], [0.35, "#2a1710"], [1, "#150c08"]]);
  const g = el("g", {}, svg);
  el("rect", { x: -400, y: -400, width: 1440, height: 560, fill: "url(#pv-wall)" }, g);
  let planks = "";
  for (let x = -400; x <= 1040; x += 40) planks += `M${x},-400V160`;
  el("path", { d: planks, stroke: "#0d0705", "stroke-width": 2, opacity: 0.75 }, g);
  el("rect", { x: -400, y: 160, width: 1440, height: 62, fill: "#11302a" }, g);
  el("rect", { x: -400, y: 158, width: 1440, height: 4, fill: "#b9853a" }, g);
  el("rect", { x: -400, y: 222, width: 1440, height: 400, fill: "url(#pv-floor)" }, g);
  el("rect", { x: -400, y: 220, width: 1440, height: 3, fill: "#c9b48a", opacity: 0.45 }, g);
  for (let x = -380; x < 1040; x += 46) {
    const y = 26 + 10 * Math.sin(x / 50);
    el("circle", { cx: x, cy: y, r: 10, fill: "#ffe9c4", opacity: 0.18 }, g);
    el("circle", { cx: x, cy: y, r: 3.6, fill: "#ffeccb" }, g);
  }
  return g;
}

/**
 * A stage with me in the middle and two others either side. `opts.thumb` makes a small still
 * of one emote (no backdrop of words, nothing moving).
 */
function makeStage(svg, opts = {}) {
  svg.replaceChildren();
  if (opts.backdrop !== false) backdrop(svg);
  const cam = el("g", {}, svg);
  const world = el("g", {}, cam);
  const r = { svg, cam, world, state: {} };
  r.other2 = makePawn(world, SEATS[3], 130);
  r.other = makePawn(world, SEATS[1], 510);
  r.me = makePawn(world, SEATS[0], 320);
  r.over = el("g", {}, svg);
  r.bubble = makeBubble(r.over);
  r.card = makeCard(r.over);
  return r;
}

function makeBubble(parent) {
  const g = el("g", { display: "none" }, parent);
  const back = el("path", { fill: "#fbf3e2", stroke: INK, "stroke-width": 3, "stroke-linejoin": "round" }, g);
  const t = text(g, "", { "font-size": 22, fill: INK, y: 8 });
  return { g, back, t };
}
function makeCard(parent) {
  const g = el("g", { display: "none" }, parent);
  const rays = el("g", {}, g);
  for (let i = 0; i < 16; i++) el("path", { d: "M0,0 L-14,-260 L14,-260 Z", fill: "#f4b453", opacity: 0.18, transform: `rotate(${i * 22.5})` }, rays);
  el("rect", { x: -230, y: -52, width: 460, height: 104, rx: 16, fill: "#120b08", stroke: "#f4b453", "stroke-width": 4 }, g);
  const who = text(g, "MABEL", { "font-size": 18, fill: SEATS[0], y: -18, "letter-spacing": 4 });
  const big = text(g, "", { "font-size": 40, fill: "#fbf3e2", y: 28 });
  return { g, rays, who, big };
}

/** Draws emote `e` at `t` on stage `r`, with treatment "A", "B" or "C". */
function draw(r, e, t, treatment = "A") {
  r.q = REST();
  r.qo = REST();
  r.qo2 = REST();
  r.zoom = 1;
  r.shake = 0;
  r.word = e.word;
  // Watchers turn their eyes toward whoever is performing.
  r.qo.look = -3;
  r.qo2.look = 3;
  e.frame(r, t, r.props);
  apply(r.me, r.q);
  apply(r.other, r.qo);
  apply(r.other2, r.qo2);
  const watching = e.target ? 1 : 0.55;
  set(r.other.root, { opacity: watching });
  set(r.other2.root, { opacity: e.three ? 1 : watching * 0.9 });
  if (r.spin) set(r.me.body, { transform: r.me.body.getAttribute("transform") + ` rotate(${r.spin.toFixed(0)},0,-70)` });
  r.spin = 0;
  const z = r.zoom;
  const at = r.zoomAt ?? { x: 320, y: 150 };
  const sh = calm() ? 0 : r.shake;
  set(r.cam, { transform: z === 1 && !sh ? "" : `translate(${(at.x + (sh ? Math.sin(t / 9) * sh : 0)).toFixed(1)},${at.y.toFixed(1)}) scale(${z.toFixed(3)}) translate(${-at.x},${-at.y})` });
  // B: a sticker over the head. C: the same, and a card across the big screen.
  const show = treatment !== "A" && t > 250 && t < e.dur - 250 && r.zoom < 1.15;
  if (show) {
    const head = { x: r.me.baseX + r.q.x, y: FLOOR - 200 - Math.max(0, r.q.lift) - (e.tall ?? 0) };
    r.bubble.t.textContent = r.word;
    const w = Math.max(60, r.word.length * 12.5 + 28);
    set(r.bubble.back, { d: `M${-w / 2},-22 h${w} a10,10 0 0 1 10,10 v24 a10,10 0 0 1 -10,10 h${-w / 2 + 10} l-10,12 l-4,-12 h${-w / 2 + 4} a10,10 0 0 1 -10,-10 v-24 a10,10 0 0 1 10,-10 Z` });
    const u = clamp((t - 250) / 160, 0, 1);
    const s = calm() ? 1 : EASE.b(u);
    const x = clamp(head.x, w / 2 + 12, 640 - w / 2 - 12);
    set(r.bubble.g, { display: "inline", transform: `translate(${x.toFixed(1)},${head.y.toFixed(1)}) scale(${s.toFixed(3)})` });
  } else set(r.bubble.g, { display: "none" });
  const card = treatment === "C" && t > 500 && t < Math.min(e.dur - 300, 2400);
  if (card) {
    const u = clamp((t - 500) / 200, 0, 1);
    r.card.big.textContent = r.word.toUpperCase();
    set(r.card.g, { display: "inline", transform: `translate(320,58) scale(${(0.72 * (calm() ? 1 : EASE.b(u) * 0.9 + 0.1)).toFixed(3)})` });
    set(r.card.rays, { transform: `rotate(${calm() ? 0 : (t / 30).toFixed(1)})` });
  } else set(r.card.g, { display: "none" });
}

function prepare(r, e) {
  for (const p of [r.me, r.other, r.other2]) {
    for (const g of [p.bodyFx, p.headFx, p.front, p.floor, p.arms[-1].holds, p.arms[1].holds]) g.replaceChildren();
    // Bulges and the like are added to an arm itself: remove all but the limb and the hand.
    for (const side of [-1, 1]) for (const c of [...p.arms[side].g.children]) if (c !== p.arms[side].limb && c !== p.arms[side].hand) c.remove();
  }
  for (const c of [...r.world.children]) if (![r.me.root, r.other.root, r.other2.root].includes(c)) c.remove();
  r.props = e.setup ? e.setup(r) : {};
  r.state = {};
}

// ---------------------------------------------------------------- the main stage

const stage = makeStage($("stage"));
let current = EMOTES[0];
let startedAt = -1;
let running = false;
let treatment = "B";

function play(e) {
  current = e;
  prepare(stage, e);
  startedAt = performance.now();
  $("now").replaceChildren(document.createTextNode(e.name));
  h("small", "", e.sound.length ? "with " + soundsOf(e) : "", $("now"));
  $("answer").classList.toggle("show", !!e.interactive);
  if (e.interactive) stage.state.answeredAt = null;
  cue(e.sound);
  for (const c of document.querySelectorAll(".card")) c.classList.toggle("playing", c.dataset.id === e.id);
  if (calm()) {
    draw(stage, e, e.hold, treatment);
    return;
  }
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}
function tick() {
  const t = performance.now() - startedAt;
  draw(stage, current, Math.min(t, current.dur), treatment);
  if (t < current.dur) requestAnimationFrame(tick);
  else running = false;
}
$("answer").addEventListener("click", () => {
  const t = performance.now() - startedAt;
  if (current.id !== "highfive" || stage.state.answeredAt !== null || t > 1800) return;
  stage.state.answeredAt = t;
  $("answer").classList.remove("show");
  if (emoteSounds) cueTimers.push(setTimeout(() => void board.play("slap", { from: "me" }), 220));
});
// The high five that nobody answered.
setInterval(() => {
  if (current.id === "highfive" && running && stage.state.answeredAt === null && performance.now() - startedAt > 1800) {
    stage.state.answeredAt = undefined;
    $("answer").classList.remove("show");
    if (emoteSounds) void board.play("womp", { from: "me" });
  }
}, 100);
$("replay").addEventListener("click", () => play(current));

// ---------------------------------------------------------------- thumbnails: the held pose

function thumb(e, size = "card") {
  const svg = document.createElementNS(NS, "svg");
  const wide = e.target || e.id === "trickshot" || e.id === "moonwalk";
  set(svg, { class: "mini", viewBox: size === "slot" ? "240 66 160 178" : wide ? "90 40 480 240" : "230 50 180 230", "aria-hidden": "true", preserveAspectRatio: "xMidYMid slice" });
  const r = makeStage(svg, { backdrop: size !== "slot" });
  prepare(r, e);
  if (e.interactive) r.state.answeredAt = 600;
  const t = e.id === "moonwalk" ? 400 : e.hold;
  draw(r, e, t, "A");
  if ((!e.target && !e.three) || size === "slot") {
    set(r.other.root, { display: "none" });
    set(r.other2.root, { display: "none" });
  }
  return svg;
}

// ---------------------------------------------------------------- favourites and choices

const stars = new Set(recall("pv:stars", []));
const choices = Object.assign({ trigger: "Wheel (hold and flick)", display: "B", emoteSounds: "Both: emotes carry a sound, and a separate board", board: "Grid of pads" }, recall("pv:choices", {}));
function starButton(key, label) {
  const b = h("button", "star", "★");
  b.type = "button";
  b.setAttribute("aria-label", "Favourite: " + label);
  const sync = () => b.setAttribute("aria-pressed", String(stars.has(key)));
  sync();
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (stars.has(key)) stars.delete(key);
    else stars.add(key);
    remember("pv:stars", [...stars]);
    sync();
    writePicks();
  });
  return b;
}

// ---------------------------------------------------------------- candidate cards

function card(e, parent) {
  const c = h("div", "card" + (e.target ? " wide" : ""), "", parent);
  c.dataset.id = e.id;
  const b = h("button", "play", "", c);
  b.type = "button";
  b.setAttribute("aria-label", "Play " + e.name);
  b.append(thumb(e));
  b.addEventListener("click", () => {
    play(e);
    $("stage-section").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  });
  if (e.ultimate) h("span", "badge", "ULTIMATE?", c);
  if (e.target) h("span", "badge t", e.interactive ? "NEEDS A FRIEND" : "AIMED", c);
  const m = h("div", "meta", "", c);
  h("div", "name", e.name, m);
  h("div", "line", e.line, m);
  if (e.sound.length) h("div", "pair", "♪ " + soundsOf(e), m);
  const tools = h("div", "tools", "", m);
  tools.append(starButton("emote:" + e.id, e.name));
  const put = h("button", "small", "Put on wheel", tools);
  put.type = "button";
  put.addEventListener("click", () => putOnWheel(e.id));
}
for (const e of EMOTES) card(e, $("cards"));
for (const e of TARGETED) card(e, $("cards-t"));

// ---------------------------------------------------------------- the wheel and its loadout

const DEFAULT_WHEEL = ["dab", "slowclap", "violin", "popcorn", "tomato", "pointlaugh"];
let wheel = recall("pv:wheel", DEFAULT_WHEEL).filter((id) => byId(id));
while (wheel.length < 6) wheel.push(DEFAULT_WHEEL.find((id) => !wheel.includes(id)) ?? "dab");
let slotPicked = 0;

function drawLoadout() {
  const box = $("loadout");
  box.replaceChildren();
  wheel.forEach((id, i) => {
    const e = byId(id);
    const b = h("button", "slotbtn" + (i === slotPicked ? " sel" : ""), "", box);
    b.type = "button";
    b.setAttribute("aria-label", `Slot ${i + 1}: ${e.name}${i === slotPicked ? " (selected)" : ""}`);
    const m = h("div", "mini-box", "", b);
    m.append(thumb(e, "slot"));
    h("div", "", e.short, b);
    b.addEventListener("click", () => {
      slotPicked = i;
      drawLoadout();
      toast(`Slot ${i + 1} selected: pick "Put on wheel" on any emote below`);
    });
  });
  const reset = h("button", "small", "Reset wheel", box);
  reset.type = "button";
  reset.addEventListener("click", () => {
    wheel = [...DEFAULT_WHEEL];
    remember("pv:wheel", wheel);
    drawLoadout();
    drawAlts();
  });
}
function putOnWheel(id) {
  wheel[slotPicked] = id;
  remember("pv:wheel", wheel);
  toast(`${byId(id).name} is on slot ${slotPicked + 1}`);
  slotPicked = (slotPicked + 1) % 6;
  drawLoadout();
  drawAlts();
  writePicks();
}
drawLoadout();

// The wheel itself: six wedges round the thumb. Hold and flick picks; a quick tap opens it to tap.
const wheelBox = $("wheel");
const veil = $("veil");
const WEDGES = 6;
const R0 = 46;
const R1 = 142;
let press = null;
let hot = -1;
let coolUntil = 0;

function buildWheel() {
  wheelBox.replaceChildren();
  const svg = el("svg", { viewBox: "-150 -150 300 300" }, wheelBox);
  const wedges = [];
  for (let i = 0; i < WEDGES; i++) {
    const a0 = ((i - 0.5) / WEDGES) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.5) / WEDGES) * Math.PI * 2 - Math.PI / 2;
    const p = (r, a) => `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
    const w = el("path", { class: "wedge", d: `M${p(R0, a0)} L${p(R1, a0)} A${R1},${R1} 0 0 1 ${p(R1, a1)} L${p(R0, a1)} A${R0},${R0} 0 0 0 ${p(R0, a0)} Z` }, svg);
    w.dataset.i = i;
    const mid = (a0 + a1) / 2;
    const cx = Math.cos(mid) * 95;
    const cy = Math.sin(mid) * 95;
    const e = byId(wheel[i]);
    const pic = thumb(e, "slot");
    set(pic, { x: cx - 30, y: cy - 40, width: 60, height: 60 });
    svg.append(pic);
    const lab = el("text", { class: "label", x: cx, y: cy + 30 }, svg);
    lab.textContent = e.short;
    wedges.push(w);
    w.addEventListener("click", () => {
      if (!wheelBox.classList.contains("tap")) return;
      fire(i);
    });
  }
  el("circle", { class: "hub", r: R0 - 6 }, svg);
  const hub = el("text", { class: "hubtext", y: 4 }, svg);
  hub.textContent = "flick";
  return wedges;
}
let wedges = buildWheel();

function openWheel(x, y, tapMode) {
  wedges = buildWheel();
  // Keep the whole wheel on the screen: it may sit off the thumb, the flick still reads from the thumb.
  const cx = clamp(x, 150 + 8, innerWidth - 150 - 8);
  const cy = clamp(y - 60, 150 + 8, innerHeight - 150 - 8);
  wheelBox.style.left = cx + "px";
  wheelBox.style.top = cy + "px";
  wheelBox.classList.add("open");
  wheelBox.classList.toggle("tap", tapMode);
  veil.classList.toggle("open", tapMode);
}
function closeWheel() {
  wheelBox.classList.remove("open", "tap");
  veil.classList.remove("open");
  press = null;
  setHot(-1);
}
function setHot(i) {
  hot = i;
  wedges.forEach((w, n) => w.classList.toggle("hot", n === i));
}
function fire(i) {
  closeWheel();
  const now = performance.now();
  if (now < coolUntil) return toast("Cooling down: the ring shows when it is ready");
  coolUntil = now + 1500;
  play(byId(wheel[i]));
  sweepCooldown();
}
function sweepCooldown() {
  const sweep = $("emote-sweep");
  const btn = $("emote-btn");
  const step = () => {
    const left = Math.max(0, coolUntil - performance.now());
    sweep.setAttribute("stroke-dasharray", `${(100 * (1 - left / 1500)).toFixed(1)} 100`);
    btn.classList.toggle("cooling", left > 0);
    if (left > 0) requestAnimationFrame(step);
  };
  step();
}
const btn = $("emote-btn");
btn.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  try {
    btn.setPointerCapture(ev.pointerId);
  } catch {
    // A pointer the browser no longer knows: the wheel still reads it while it is over the button.
  }
  btn.classList.add("held");
  press = { x: ev.clientX, y: ev.clientY, at: performance.now(), id: ev.pointerId };
  openWheel(ev.clientX, ev.clientY, false);
});
btn.addEventListener("pointermove", (ev) => {
  if (!press || ev.pointerId !== press.id) return;
  const dx = ev.clientX - press.x;
  const dy = ev.clientY - press.y;
  if (Math.hypot(dx, dy) < 22) return setHot(-1);
  const a = Math.atan2(dy, dx) + Math.PI / 2;
  setHot(((Math.round((a / (Math.PI * 2)) * WEDGES) % WEDGES) + WEDGES) % WEDGES);
});
function release(ev) {
  if (!press || ev.pointerId !== press.id) return;
  btn.classList.remove("held");
  const quick = performance.now() - press.at < 300 && hot === -1;
  if (hot >= 0) fire(hot);
  else if (quick) {
    // A tap: the wheel stays open to tap a picture.
    press = null;
    wheelBox.classList.add("tap");
    veil.classList.add("open");
  } else closeWheel();
}
btn.addEventListener("pointerup", release);
btn.addEventListener("pointercancel", () => closeWheel());
veil.addEventListener("click", closeWheel);
btn.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  ev.preventDefault();
  const r = btn.getBoundingClientRect();
  openWheel(r.left + r.width / 2, r.top, true);
});
addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeWheel();
  // A laptop: the number keys fire the wheel's slots.
  if (/^[1-6]$/.test(ev.key) && !(ev.target instanceof HTMLTextAreaElement)) fire(Number(ev.key) - 1);
});

// ---------------------------------------------------------------- the two alternates

function drawAlts() {
  const quick = $("quick-slots");
  quick.replaceChildren();
  for (const id of wheel.slice(0, 2)) {
    const b = h("button", "ctl emote slot", "", quick);
    b.type = "button";
    b.setAttribute("aria-label", byId(id).name);
    const m = h("div", "mini-box", "", b);
    m.append(thumb(byId(id), "slot"));
    b.addEventListener("click", () => play(byId(id)));
  }
  for (const [box, fn] of [
    [$("drawer"), (b) => $("drawer").classList.remove("open")],
    [$("strip"), () => $("strip").classList.remove("open")],
  ]) {
    box.replaceChildren();
    for (const id of box.id === "drawer" ? ALL.filter((e) => !wheel.slice(0, 2).includes(e.id)).slice(0, 8).map((e) => e.id) : wheel) {
      const b = h("button", "", "", box);
      b.type = "button";
      b.setAttribute("aria-label", byId(id).name);
      b.append(thumb(byId(id), "slot"));
      b.addEventListener("click", () => {
        play(byId(id));
        fn(b);
      });
    }
  }
}
drawAlts();
$("drawer-btn").addEventListener("click", () => $("drawer").classList.toggle("open"));
$("strip-btn").addEventListener("click", () => $("strip").classList.toggle("open"));

// ---------------------------------------------------------------- the soundboard

const BOARD = ["horn", "trombone", "applause", "rimshot", "scratch", "crickets", "boing", "slide", "boom", "ooh", "laugh", "kazoo", "bell", "dialup", "womp", "fart", "ding", "violin"];
const STINGS = ["sparkle", "slowclap", "chomp", "squeak", "shaker", "gulp", "kiss", "crackle", "swish", "splat", "slap", "pop"];
const SYNTH_DOUBTS = new Set(["applause", "ooh", "laugh"]);
const OWN = ["Your clip: \"Let's gooo\"", "Your clip: \"Nooo\"", "Your clip: a burp"];

function pad(id, parent, own = false) {
  const c = h("div", "padc", "", parent);
  const b = h("button", "sp" + (own ? " own" : ""), own ? id : soundName(id), c);
  b.type = "button";
  if (own) h("span", "sub", "Mock: recording comes next", b);
  else if (STINGS.includes(id)) h("span", "sub", "an emote's sting", b);
  else if (SYNTH_DOUBTS.has(id)) h("span", "sub", "made up; a found one may beat it", b);
  b.addEventListener("click", () => {
    b.classList.add("hit");
    setTimeout(() => b.classList.remove("hit"), 200);
    if (own) return toast("Recording your own clips comes next: this pad is a placeholder");
    void board.play(id).then((what) => what === "locked" && toast("Tap once more: the browser has just allowed sound"));
  });
  if (!own) c.append(starButton("sound:" + id, soundName(id)));
}
for (const id of BOARD) pad(id, $("pads"));
for (const id of STINGS) pad(id, $("pads"));
for (const name of OWN) pad(name, $("pads"), true);

function drawRadial() {
  const box = $("radial");
  box.replaceChildren();
  const picks = BOARD.filter((id) => stars.has("sound:" + id));
  const eight = [...picks, ...BOARD.filter((id) => !picks.includes(id))].slice(0, 8);
  eight.forEach((id, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const b = h("button", "", soundName(id), box);
    b.type = "button";
    b.style.left = 50 + Math.cos(a) * 38 + "%";
    b.style.top = 50 + Math.sin(a) * 38 + "%";
    b.addEventListener("click", () => void board.play(id));
  });
  const hub = h("button", "hubr", "Your 8 (starred first)", box);
  hub.type = "button";
}
drawRadial();

// The pairs: which sound each emote carries.
{
  const table = $("pairs");
  const head = h("tr", "", "", table);
  h("th", "", "Emote", head);
  h("th", "", "Its sound", head);
  for (const e of ALL) {
    const tr = h("tr", "", "", table);
    h("td", "", e.name, tr);
    h("td", "", e.interactive ? "Slap if answered, womp womp if not" : soundsOf(e) || "none", tr);
  }
}

// ---------------------------------------------------------------- the switches at the top

function segment(id, onPick, initial) {
  const box = $(id);
  const sync = (v) => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    sync(b.dataset.v);
    onPick(b.dataset.v);
  });
  sync(initial);
}
segment(
  "treatment",
  (v) => {
    treatment = v;
    choices.display = v;
    remember("pv:choices", choices);
    writePicks();
    play(current);
  },
  choices.display,
);
treatment = choices.display;
segment(
  "board-layout",
  (v) => {
    $("pads").classList.toggle("hide", v === "radial");
    $("radial").classList.toggle("show", v === "radial");
    if (v === "radial") drawRadial();
    choices.board = v === "radial" ? "Small radial" : "Grid of pads";
    remember("pv:choices", choices);
    writePicks();
  },
  choices.board === "Small radial" ? "radial" : "grid",
);
$("emote-sound").addEventListener("click", () => {
  emoteSounds = !emoteSounds;
  $("emote-sound").classList.toggle("on", emoteSounds);
  $("emote-sound").setAttribute("aria-pressed", String(emoteSounds));
  $("emote-sound").textContent = emoteSounds ? "Emote sounds on" : "Emote sounds off";
});
$("volume").addEventListener("input", (ev) => board.setVolume(Number(ev.target.value) / 100));
$("volume").value = String(Math.round(board.volume * 100));

// ---------------------------------------------------------------- the notes

const NOTES = {
  trigger: [
    "<strong>Recommended: the wheel, hold and flick.</strong>",
    "It is one more button in a bar that is already full, so nothing else gets smaller. Hold and flick is one gesture: a thumb learns where the dab is, and it is fast enough to answer a bump. A quick tap opens the same wheel to tap, for people who do not flick, and number keys 1 to 6 do it on a laptop.",
    "Six wedges, not eight: each is a big target under a thumb, and the loadout lets everyone pick their six from the whole set.",
    "The two quick slots (B) are faster for one or two favourites but cover the room's corner; the strip (C) is easy to learn but covers the bottom of the room while it is open.",
  ],
  display: [
    "<strong>Recommended: B for every emote, and C only for a few rare \"ultimates\".</strong>",
    "The pawn acting it out is the fun, so it is always there (A). The sticker (B) makes it readable on a big screen across the room and on a phone in the closer view. The big card (C) is loud: keep it for two or three ultimates with a long cooldown (say 30 s), so it stays special. Marked ULTIMATE? on the cards: mic drop, crown, trick shot.",
  ],
  board: [
    "<strong>Recommended: both, as you said.</strong> Each emote carries its own short sound, and the soundboard is a second, separate thing to play with.",
    "Board layout: the grid of pads, opened from the same Emote button (a second tab on the wheel, or a flick down). A radial of eight is quick but holds too few for a board that is \"just to play with\"; it suits a loadout of favourites instead.",
    "Sounds play from the big screen when there is one, and on every phone when there is not. Every sound shows who did it, so muted phones see it too.",
    "Your own clips: they slot in as pads beside the built-in ones (the dashed ones above are mock-ups). Recording is the next step, not this one.",
  ],
  recs: [
    "<strong>First set I would ship:</strong> the dab, slow clap, world's smallest violin, popcorn, side-eye and dramatic faint on the default wheel; throw a tomato and point and laugh as the two aimed ones; the high five as the one that needs a friend.",
    "<strong>Cooldowns:</strong> 1.5 s for an emote, 4 s for a soundboard sound, about 30 s for an ultimate. The room enforces all of them; the ring on the button shows them.",
    "<strong>Sounds that are made up versus found:</strong> the made-up ones are good for anything mechanical or musical (horn, trombone, rimshot, boing, slide whistle, kazoo, boxing bell, dial-up, womp womp, the stings). Crowds and voices are the hard part: applause is fair, but the crowd \"ooooh\" and the canned laugh are recognisable as fake. If you want them to sound real, those two (and maybe applause) are where found public-domain recordings would help; I have listed candidates for you to approve, and nothing has been downloaded.",
    "<strong>During a game:</strong> emotes on, sounds off, unless a game says otherwise.",
  ],
};
function note(id, lines) {
  const box = $(id);
  for (const l of lines) {
    const p = h("p", "", "", box);
    p.innerHTML = l;
  }
}
note("note-trigger", NOTES.trigger);
note("note-display", NOTES.display);
note("note-board", NOTES.board);
for (const l of NOTES.recs) {
  const d = h("div", "note", "", $("recs"));
  const p = h("p", "", "", d);
  p.innerHTML = l;
}

// ---------------------------------------------------------------- picks

const PICK_CHOICES = [
  ["trigger", "How to trigger", ["Wheel (hold and flick)", "Two quick slots + a drawer", "Strip that slides up"]],
  ["display", "How an emote shows", ["A", "B", "C"]],
  ["emoteSounds", "Emote sounds", ["Both: emotes carry a sound, and a separate board", "Emotes carry their own sound only", "Separate board only"]],
  ["board", "Soundboard layout", ["Grid of pads", "Small radial"]],
];
for (const [key, label, options] of PICK_CHOICES) {
  const row = h("div", "row", "", $("choices"));
  h("span", "", label + ":", row);
  const seg = h("span", "seg", "", row);
  for (const o of options) {
    const b = h("button", "", o.length > 28 ? o.slice(0, 26) + "..." : o, seg);
    b.type = "button";
    b.title = o;
    b.dataset.v = o;
    b.setAttribute("aria-pressed", String(choices[key] === o));
    b.addEventListener("click", () => {
      choices[key] = o;
      remember("pv:choices", choices);
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === o)));
      writePicks();
    });
  }
}
function writePicks() {
  const em = ALL.filter((e) => stars.has("emote:" + e.id)).map((e) => e.name);
  const so = [...BOARD, ...STINGS].filter((id) => stars.has("sound:" + id)).map(soundName);
  const lines = [
    "Emotes and sounds: my picks",
    "",
    "Favourite emotes: " + (em.length ? em.join(", ") : "(none starred)"),
    "Favourite sounds: " + (so.length ? so.join(", ") : "(none starred)"),
    "My wheel: " + wheel.map((id) => byId(id).name).join(", "),
    "",
    "Trigger: " + choices.trigger,
    "Display: " + { A: "A, body only", B: "B, body + sticker", C: "C, body + sticker + big screen card" }[choices.display],
    "Emote sounds: " + choices.emoteSounds,
    "Soundboard layout: " + choices.board,
  ];
  $("picks").value = lines.join("\n");
}
writePicks();
$("copy").addEventListener("click", async () => {
  const area = $("picks");
  try {
    await navigator.clipboard.writeText(area.value);
    return toast("Copied");
  } catch {
    // No clipboard here: fall back to selecting it.
  }
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  toast(ok ? "Copied" : "Selected: copy it with your device's Copy");
});
$("clear").addEventListener("click", () => {
  stars.clear();
  remember("pv:stars", []);
  document.querySelectorAll(".star").forEach((s) => s.setAttribute("aria-pressed", "false"));
  writePicks();
});

let toastTimer = 0;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------- stills, for the screenshots

/**
 * #still=<emote id>: the stage alone, filling the window, frozen at the held pose (treatment
 * from &look=A|B|C). #still=wheel | slots | strip: that trigger mock, open. Nothing in the
 * shared page depends on it.
 */
function stillMode() {
  const m = /still=([\w-]+)/.exec(location.hash);
  if (!m) return false;
  const look = /look=([ABC])/.exec(location.hash)?.[1] ?? "B";
  document.documentElement.classList.add("still-mode");
  const keep = (id) => {
    for (const s of document.querySelectorAll(".still-keep")) s.hidden = s.id !== id;
  };
  if (m[1] === "wheel" || m[1] === "slots" || m[1] === "strip") {
    keep(m[1] === "wheel" ? "wheel-section" : "alt-section");
    if (m[1] === "wheel") {
      const r = $("emote-btn").getBoundingClientRect();
      openWheel(r.left + r.width / 2, r.top + r.height / 2, true);
      setHot(1);
    }
    if (m[1] === "slots") $("drawer").classList.add("open");
    if (m[1] === "strip") $("strip").classList.add("open");
    return true;
  }
  keep("stage-section");
  const e = byId(m[1]);
  if (!e) return true;
  current = e;
  prepare(stage, e);
  if (e.interactive) stage.state.answeredAt = 600;
  draw(stage, e, Number(/t=(\d+)/.exec(location.hash)?.[1] ?? e.hold), look);
  document.documentElement.dataset.ready = "1";
  return true;
}
if (!stillMode()) {
  // The first thing on the stage: the dab's held pose, so the page never opens empty.
  prepare(stage, current);
  draw(stage, current, current.hold, treatment);
}
document.documentElement.dataset.ready = "1";
