// The emotes preview, second round. One page, no files fetched: the kit's sound player is inlined
// above this script by preview/make-emotes-artifact.mjs, and so are the recordings (CLIPS, each
// a data: URI with where it came from). The pawn is the room's own (lobby/public/scene.js,
// piece()), with arms that appear only while it holds something up.
//
// Every candidate is a clear prop and a simple motion, mostly aimed at someone else: the pawn on
// the right ("Tom") is the target. An emote never changes another player's piece in a way that
// looks like harm or a game state: the target at most glances, sweats a little, or gets confetti.
/* global SoundBoard, defineSound, CLIPS */
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
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
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
function toHex(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
function mixHex(a, b, u) {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((p >> s) & 255) * (1 - u) + ((q >> s) & 255) * u);
  return "#" + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0");
}
/** The four seat colours of the room (party-kit/src/core/room-core.js). */
const SEATS = ["#c8382c", "#2f6f8f", "#d9a02a", "#3f7a4a"];
const INK = "#1a1210";
const FLOOR = 262;

// ---------------------------------------------------------------- the pawn

/**
 * One pawn, as the room draws it, with what an emote needs: arms (hidden at rest), a mouth (the
 * room's pawn has none until it acts), eyes that can close, narrow or look aside, and places for
 * props: on the head, on the body, held up in front (handFx: drawn upright, over the arms), and
 * on the floor.
 */
function makePawn(parent, colour, x) {
  const p = { colour, baseX: x };
  p.root = el("g", {}, parent);
  p.floor = el("g", {}, p.root);
  p.shadow = el("ellipse", { cy: 5, rx: 40, ry: 9, fill: "#000", opacity: 0.42 }, p.root);
  p.body = el("g", {}, p.root);
  p.armBack = el("g", {}, p.body);
  el("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5, fill: shade(colour, -0.28) }, p.body);
  p.torso = el("path", { d: "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z", fill: shade(colour, 0.16) }, p.body);
  el("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8, fill: shade(colour, 0.3) }, p.body);
  p.bodyFx = el("g", {}, p.body);
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
  p.handFx = el("g", {}, p.body);
  p.front = el("g", {}, p.root);
  return p;
}

const REST = () => ({ x: 0, dx: 0, lift: 0, rot: 0, pivot: 0, sx: 1, sy: 1, hx: 0, hy: 0, hr: 0, eye: 1, look: 0, eyes: "open", lid: 0, brows: null, mouth: null, arms: { [-1]: null, [1]: null }, tint: 0 });
const ARM = (a, b = 0) => ({ a, b });

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
  const ang = Math.atan2(hy - ey, hx - ex) * (180 / Math.PI) - 90;
  return { sx, sy, ex, ey, hx, hy, ang };
}

const MOUTHS = {
  smile: { d: "M-9,-101 Q0,-93 9,-101" },
  grin: { d: "M-11,-102 Q0,-85 11,-102 Z", fill: "#3a1010", w: 2.6 },
  laugh: { d: "M-12,-103 Q0,-82 12,-103 Z", fill: "#3a1010", w: 2.6 },
  o: { d: "M0,-104 a5,6 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2.4 },
  wail: { d: "M0,-106 a8,9 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2.4 },
  small: { d: "M0,-100 a2.6,3 0 1,0 0.01,0 Z", fill: "#3a1010", w: 2 },
  flat: { d: "M-7,-98 H7" },
  frown: { d: "M-9,-95 Q0,-103 9,-95" },
  grit: { d: "M-10,-101 H10 V-95 H-10 Z M-5,-101 V-95 M0,-101 V-95 M5,-101 V-95", fill: "#fff", w: 2 },
  smirk: { d: "M-7,-99 Q2,-97 9,-103" },
};

function apply(p, q) {
  set(p.root, { transform: `translate(${(p.baseX + q.x).toFixed(1)},${FLOOR})` });
  set(p.body, { transform: `translate(${q.dx.toFixed(1)},${(-q.lift).toFixed(1)}) rotate(${q.rot.toFixed(1)},0,${-q.pivot}) scale(${q.sx.toFixed(3)},${q.sy.toFixed(3)})` });
  set(p.head, { transform: `translate(${q.hx.toFixed(1)},${q.hy.toFixed(1)}) rotate(${q.hr.toFixed(1)},0,-113)` });
  set(p.shadow, { rx: (40 * (1 - Math.min(0.45, Math.max(0, q.lift) / 260))).toFixed(1), cx: q.dx.toFixed(1) });
  const base = toHex(shade(p.colour, 0.16));
  const fill = q.tint ? mixHex(base, "#ff2a14", q.tint) : base;
  set(p.torso, { fill });
  set(p.skull, { fill });
  const open = q.eyes === "open";
  set(p.eyes, { display: open ? "inline" : "none" });
  if (open) {
    for (const [e, g, cx] of [
      [p.eyeL, p.glintL, -9],
      [p.eyeR, p.glintR, 9],
    ]) {
      set(e, { cx: cx + q.look, ry: Math.max(0.6, 5.6 * q.eye).toFixed(2), rx: q.eye > 1.05 ? 4.6 : 3.8 });
      set(g, { cx: cx + 1 + q.look, display: q.eye > 0.55 ? "inline" : "none" });
    }
  }
  set(p.happy, { display: q.eyes === "happy" ? "inline" : "none" });
  set(p.shut, { display: q.eyes === "shut" ? "inline" : "none" });
  if (q.lid > 0 && open) {
    const y = -113 - 6 + q.lid * 9;
    set(p.lids, { display: "inline", d: `M-15,-121 H-3 V${y.toFixed(1)} H-15 Z M3,-121 H15 V${y.toFixed(1)} H3 Z` });
  } else set(p.lids, { display: "none" });
  if (q.brows) set(p.brows, { display: "inline", d: q.brows });
  else set(p.brows, { display: "none" });
  const m = MOUTHS[q.mouth];
  if (m) set(p.mouth, { display: "inline", d: m.d, fill: m.fill ?? "none", stroke: INK, "stroke-width": m.w ?? 3, "stroke-linecap": "round", "stroke-linejoin": "round" });
  else set(p.mouth, { display: "none" });
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
  }
}

// ---------------------------------------------------------------- props

function text(parent, str, attrs) {
  const t = el("text", { "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif", "font-weight": 900, "text-anchor": "middle", ...attrs }, parent);
  t.textContent = str;
  return t;
}
function star4(parent, x, y, r, fill = "#ffe58a") {
  const g = el("g", { transform: `translate(${x},${y})` }, parent);
  el("path", { d: `M0,${-r} Q${r * 0.18},${-r * 0.18} ${r},0 Q${r * 0.18},${r * 0.18} 0,${r} Q${-r * 0.18},${r * 0.18} ${-r},0 Q${-r * 0.18},${-r * 0.18} 0,${-r} Z`, fill, stroke: "#fff6d8", "stroke-width": 1.2 }, g);
  return g;
}
/** Puts a held prop at the hand of `side`, upright, offset by (dx, dy), turned by `rot`, scaled by `s`. */
function atHand(node, q, side, dx = 0, dy = 0, rot = 0, s = 1) {
  const arm = q.arms[side];
  if (!arm) return set(node, { display: "none" });
  const p = armPoints(side, arm);
  set(node, { display: "inline", transform: `translate(${(p.hx + dx).toFixed(1)},${(p.hy + dy).toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${Math.max(0.001, s).toFixed(3)})` });
}
/** A round sign on a short handle, its face centred `up` units above the hand. */
function paddle(parent, fill, ink, word, size = 30, r = 26, up = 44) {
  const g = el("g", {}, parent);
  el("rect", { x: -3.5, y: -up + r - 4, width: 7, height: up - r + 8, rx: 2, fill: "#7a4b22" }, g);
  el("circle", { cy: -up, r, fill, stroke: INK, "stroke-width": 3 }, g);
  if (word) text(g, word, { y: -up + size * 0.36, "font-size": size, fill: ink });
  return g;
}
/** A thumb, drawn on a 24 grid pointing up. */
function thumb(parent, fill) {
  return el("path", { d: "M7 21H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7", fill, stroke: fill, "stroke-width": 1.4, "stroke-linejoin": "round" }, parent);
}
/** A pop when a prop arrives: 0 to 1 over 180 ms with a little overshoot. */
const pop = (t, at) => (calm() ? (t >= at ? 1 : 0) : EASE.b(clamp((t - at) / 180, 0, 1)));

// ---------------------------------------------------------------- the emotes

/**
 * Every candidate. `frame(r, t, P)` poses the pawns at `t` ms: r.q is the sender, r.qo the
 * target on its right, r.qo2 a watcher on its left. `setup(r)` makes its props once and returns
 * them as P. `hold` is the moment for the still and the pictures. `word` is its sticker.
 */
const CANDIDATES = [
  {
    id: "violin",
    kept: true,
    name: "World's smallest violin",
    line: "A tiny violin at the chin, the bow sawing, eyes shut. For your loss.",
    word: "so sad",
    dur: 2900,
    hold: 1300,
    setup(r) {
      const v = el("g", {}, r.me.arms[-1].holds);
      el("path", { d: "M-6,-2 C-12,0 -12,8 -7,10 C-11,13 -10,21 -3,22 L3,22 C10,21 11,13 7,10 C12,8 12,0 6,-2 C3,-3 -3,-3 -6,-2 Z", fill: "#b5651d", stroke: INK, "stroke-width": 1.4 }, v);
      el("rect", { x: -1.5, y: -18, width: 3, height: 17, fill: "#2a1a10" }, v);
      el("circle", { cx: 0, cy: -19, r: 2.4, fill: "#2a1a10" }, v);
      set(v, { transform: "translate(2,2) rotate(-70) scale(0.95)" });
      const bow = el("g", {}, r.me.arms[1].holds);
      el("path", { d: "M0,-26 V26", stroke: "#e8d6b0", "stroke-width": 2 }, bow);
      el("path", { d: "M2,-26 V26", stroke: "#3a2414", "stroke-width": 2.2 }, bow);
      set(bow, { transform: "rotate(70)" });
      return {};
    },
    frame(r, t) {
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
    },
  },
  {
    id: "popcorn",
    kept: true,
    name: "Popcorn",
    line: "A striped bucket, a handful to the mouth, eyes on the drama.",
    word: "this is good",
    dur: 3000,
    hold: 1250,
    setup(r) {
      const bucket = el("g", {}, r.me.bodyFx);
      el("path", { d: "M-18,-62 L18,-62 L13,-28 L-13,-28 Z", fill: "#fbf3e2", stroke: INK, "stroke-width": 1.5 }, bucket);
      for (const x of [-10, 0, 10]) el("path", { d: `M${x - 3},-62 L${x + 3},-62 L${x + 2.2},-28 L${x - 2.2},-28 Z`, fill: "#d23a2c" }, bucket);
      for (const [x, y] of [[-12, -64], [-4, -68], [4, -67], [12, -64], [0, -72], [-8, -72], [8, -71]]) el("circle", { cx: x, cy: y, r: 4.5, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, bucket);
      const kernel = el("circle", { r: 3.8, fill: "#fff3c4", stroke: "#e8c46a", "stroke-width": 1 }, r.me.arms[1].holds);
      return { bucket, kernel };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [250, 1], [2600, 1], [2900, 0]]);
      set(P.bucket, { display: on > 0.05 ? "inline" : "none" });
      q.look = 4 * on;
      q.eye = 1 + 0.2 * on;
      q.hr = 6 * on;
      q.arms[-1] = ARM(-20 * on + 6, -70 * on);
      const cycle = (t - 400) % 900;
      const eating = t > 400 && t < 2500;
      const up = eating ? (cycle < 300 ? smooth(cycle / 300) : cycle < 600 ? 1 : 1 - smooth((cycle - 600) / 300)) : 0;
      q.arms[1] = ARM(-25 + up * 205 * on, -60 + up * -60);
      set(P.kernel, { display: eating && up > 0.05 && up < 0.98 ? "inline" : "none" });
      q.mouth = eating && cycle > 300 && cycle < 650 ? (Math.floor(t / 110) % 2 ? "o" : "flat") : "smile";
    },
  },
  {
    id: "slowclap",
    kept: true,
    name: "Slow clap",
    line: "Hands meet three times, slowly. Unimpressed eyes.",
    word: "*clap*",
    dur: 2900,
    hold: 1400,
    setup(r) {
      const lines = el("path", { d: "M-16,-80 l-9,-9 M0,-86 v-13 M16,-80 l9,-9", stroke: "#ffe58a", "stroke-width": 3.5, "stroke-linecap": "round", fill: "none" }, r.me.bodyFx);
      return { lines };
    },
    frame(r, t, P) {
      const q = r.q;
      q.eye = 0.5;
      q.lid = 0.55;
      q.mouth = "flat";
      q.look = 3;
      const claps = [600, 1400, 2200];
      let apart = 1;
      for (const c of claps) apart = Math.min(apart, clamp(Math.abs(t - c) / 280, 0, 1));
      const inSet = t > 250 && t < 2500;
      const b = inSet ? -42 - 30 * (1 - apart) : k(t, [[0, 0], [250, -42], [2500, -42], [2800, 0]]);
      const a = k(t, [[0, 6], [250, -30], [2500, -30], [2800, 6]]);
      q.arms[-1] = ARM(a, b);
      q.arms[1] = ARM(a, b);
      const near = claps.find((c) => t >= c && t < c + 260);
      set(P.lines, { display: near || t === 1400 ? "inline" : "none" });
    },
  },
  {
    id: "pointlaugh",
    kept: true,
    name: "Point and laugh",
    line: "Points at the nearest piece and shakes with laughter. The target just stands there and sweats a little.",
    word: "HA HA",
    dur: 2900,
    hold: 1200,
    aimed: true,
    setup(r) {
      const ha = el("g", {}, r.me.front);
      const a = text(ha, "HA", { "font-size": 22, fill: "#ffe58a", x: -40, y: -176 });
      const b = text(ha, "HA", { "font-size": 27, fill: "#ffe58a", x: 34, y: -192 });
      const drop = el("path", { d: "M0,-7 C4,-1 4,4 0,4 C-4,4 -4,-1 0,-7 Z", fill: "#8fd3ff", stroke: "#e8f6ff", "stroke-width": 1 }, r.other.headFx);
      return { a, b, drop };
    },
    frame(r, t, P) {
      const q = r.q;
      const o = r.qo;
      const point = k(t, [[0, 0], [250, 1, "o"], [2500, 1], [2850, 0]]);
      q.arms[1] = ARM(8 + 82 * point, -6 * point);
      q.arms[-1] = point > 0.5 ? ARM(-30, -80) : null;
      q.eyes = point > 0.5 ? "happy" : "open";
      q.mouth = point > 0.5 ? "laugh" : null;
      const shake = point > 0.5 && !calm();
      q.rot = shake ? -6 + wave(t, 240, 4) : 0;
      q.lift = shake ? Math.abs(wave(t, 240, 6)) : 0;
      set(P.a, { display: between(t, 300, 2500) && (calm() || Math.floor(t / 260) % 2) ? "inline" : "none" });
      set(P.b, { display: between(t, 430, 2500) && (calm() || Math.floor(t / 260) % 2 === 0) ? "inline" : "none" });
      // The target is not changed: only a glance at the laugher and one small drop of sweat.
      o.look = -3.5;
      const u = clamp((t - 600) / 1400, 0, 1);
      set(P.drop, { display: t > 600 && t < 2600 ? "inline" : "none", transform: `translate(24,${(-126 + u * 12).toFixed(1)})` });
    },
  },
  {
    id: "ten",
    name: "Perfect 10",
    line: "A judge's paddle: 10. Held high, bobbing with joy.",
    word: "10!",
    dur: 2600,
    hold: 1100,
    aimed: true,
    setup(r) {
      return { p: paddle(r.me.handFx, "#fbf3e2", "#1e1410", "10", 30) };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [300, 1, "o"], [2200, 1], [2550, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 12 * up);
      atHand(P.p, q, 1, 0, 0, calm() ? 0 : wave(t, 500, 6), pop(t, 200) * (t < 2400 ? 1 : 0));
      q.eyes = up > 0.5 ? "happy" : "open";
      q.mouth = up > 0.5 ? "grin" : null;
      q.lift = up > 0.5 && !calm() ? Math.abs(wave(t, 500, 7)) : 0;
    },
  },
  {
    id: "two",
    name: "Harsh 2",
    line: "The judge's paddle again: 2. A slow shake of the head.",
    word: "2",
    dur: 2600,
    hold: 1300,
    aimed: true,
    setup(r) {
      return { p: paddle(r.me.handFx, "#fbf3e2", "#c8382c", "2", 34) };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [300, 1, "o"], [2200, 1], [2550, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 12 * up);
      atHand(P.p, q, 1, 0, 0, 0, pop(t, 200) * (t < 2400 ? 1 : 0));
      q.hr = up > 0.5 && !calm() ? wave(t, 900, 9) : 0;
      q.eye = 0.6;
      q.lid = 0.45 * up;
      q.mouth = up > 0.5 ? "flat" : null;
    },
  },
  {
    id: "redcard",
    name: "Red card",
    line: "A referee's red card, held up high at the target. Off you go.",
    word: "RED CARD",
    dur: 2500,
    hold: 1100,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -17, y: -58, width: 34, height: 48, rx: 4, fill: "#e0261b", stroke: "#fff", "stroke-width": 3 }, g);
      return { card: g };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [220, 1, "b"], [2100, 1], [2450, 0]]);
      q.arms[1] = ARM(8 + 152 * up, 0);
      q.rot = 6 * up;
      atHand(P.card, q, 1, 0, 2, 8 * up, pop(t, 160) * (t < 2300 ? 1 : 0));
      q.brows = up > 0.5 ? "M-15,-127 L-3,-121 M15,-127 L3,-121" : null;
      q.mouth = up > 0.5 ? "flat" : null;
      q.look = 3;
    },
  },
  {
    id: "tissues",
    name: "Cry more",
    line: "Offers a box of tissues to the target, one tissue fluttering. Smirking.",
    word: "cry more",
    dur: 2700,
    hold: 1200,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -20, y: -16, width: 40, height: 24, rx: 3, fill: "#6fb7e8", stroke: INK, "stroke-width": 2 }, g);
      el("path", { d: "M-14,-10 h28 M-14,-3 h28", stroke: "#ffffff", "stroke-width": 2, opacity: 0.6 }, g);
      const tissue = el("path", { d: "M-6,-16 C-10,-30 -2,-34 0,-44 C4,-34 12,-30 6,-16 Z", fill: "#fff", stroke: "#cdbfa6", "stroke-width": 1.2 }, g);
      return { box: g, tissue };
    },
    frame(r, t, P) {
      const q = r.q;
      const out = k(t, [[0, 0], [350, 1, "o"], [2300, 1], [2650, 0]]);
      q.arms[1] = ARM(8 + 80 * out, -8 * out);
      q.rot = 7 * out;
      atHand(P.box, q, 1, 8, -2, 0, pop(t, 250) * (t < 2450 ? 1 : 0));
      set(P.tissue, { transform: `skewX(${calm() ? 0 : wave(t, 300, 10).toFixed(1)})` });
      q.eye = 1 - 0.4 * out;
      q.lid = 0.45 * out;
      q.look = 3;
      q.mouth = out > 0.5 ? "smirk" : null;
    },
  },
  {
    id: "whiteflag",
    name: "White flag",
    line: "Waves a white flag on a long stick. I give up.",
    word: "I give up",
    dur: 2800,
    hold: 1200,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -2.5, y: -78, width: 5, height: 84, rx: 2, fill: "#7a4b22" }, g);
      const flag = el("path", { d: "", fill: "#fbfbf6", stroke: "#cdbfa6", "stroke-width": 1.5 }, g);
      return { g, flag };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [300, 1, "o"], [2400, 1], [2750, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 6 * up);
      atHand(P.g, q, 1, 0, 0, calm() ? 0 : wave(t, 700, 10), up > 0.05 ? 1 : 0);
      const f = calm() ? 0 : t / 120;
      const w = (n) => (Math.sin(f + n) * 5).toFixed(1);
      set(P.flag, { d: `M2,-78 C16,${-84 + Number(w(0))} 30,${-72 + Number(w(1))} 46,${-78 + Number(w(2))} L46,${-46 + Number(w(2))} C30,${-40 + Number(w(1))} 16,${-52 + Number(w(0))} 2,-46 Z` });
      q.sy = 1 - 0.05 * up;
      q.eyes = up > 0.5 ? "shut" : "open";
      q.mouth = up > 0.5 ? "frown" : null;
      q.hr = -6 * up;
    },
  },
  {
    id: "hurry",
    name: "Hurry up",
    line: "Holds up a stopwatch, its hand racing, and hops on the spot.",
    word: "hurry up!",
    dur: 2600,
    hold: 1000,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -4, y: -64, width: 8, height: 8, rx: 2, fill: "#3a2a1c" }, g);
      el("circle", { cy: -36, r: 24, fill: "#fbf3e2", stroke: "#3a2a1c", "stroke-width": 5 }, g);
      for (let i = 0; i < 12; i++) el("rect", { x: -1, y: -56, width: 2, height: 5, fill: INK, transform: `rotate(${i * 30},0,-36)` }, g);
      const hand = el("path", { d: "M0,-36 V-54", stroke: "#c8382c", "stroke-width": 3.5, "stroke-linecap": "round" }, g);
      return { g, hand };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [250, 1, "o"], [2250, 1], [2550, 0]]);
      q.arms[1] = ARM(8 + 148 * up, 10 * up);
      atHand(P.g, q, 1, 0, 2, 0, pop(t, 180) * (t < 2400 ? 1 : 0));
      set(P.hand, { transform: `rotate(${calm() ? 60 : ((t / 3) % 360).toFixed(0)},0,-36)` });
      q.lift = up > 0.5 && !calm() ? Math.abs(wave(t, 360, 12)) : 0;
      q.eye = 1.2;
      q.look = 3;
      q.mouth = up > 0.5 ? "flat" : null;
      q.brows = up > 0.5 ? "M-15,-125 L-3,-122 M15,-125 L3,-122" : null;
    },
  },
  {
    id: "thumbsup",
    name: "Thumbs up",
    line: "A big green thumbs-up sign, and a nod.",
    word: "nice!",
    dur: 2400,
    hold: 1000,
    aimed: true,
    setup(r) {
      const g = paddle(r.me.handFx, "#3fae5a", null, null, 0, 28, 46);
      const glyph = el("g", { transform: "translate(-16,-62) scale(1.35)" }, g);
      thumb(glyph, "#ffffff");
      return { g };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [280, 1, "o"], [2050, 1], [2350, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 12 * up);
      atHand(P.g, q, 1, 0, 0, 0, pop(t, 200) * (t < 2200 ? 1 : 0));
      q.hy = up > 0.5 && !calm() ? Math.max(0, wave(t, 500, 6)) : 0;
      q.eyes = up > 0.5 ? "happy" : "open";
      q.mouth = up > 0.5 ? "smile" : null;
    },
  },
  {
    id: "boo",
    name: "Boo",
    line: "A red thumbs-down paddle, shaken at the target.",
    word: "BOO",
    dur: 2600,
    hold: 1100,
    aimed: true,
    setup(r) {
      const g = paddle(r.me.handFx, "#d23a2c", null, null, 0, 28, 46);
      const glyph = el("g", { transform: "translate(16,-30) scale(1.35) rotate(180)" }, g);
      thumb(glyph, "#ffffff");
      return { g };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [280, 1, "o"], [2250, 1], [2550, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 12 * up);
      atHand(P.g, q, 1, 0, 0, calm() ? 0 : wave(t, 260, 14), pop(t, 200) * (t < 2400 ? 1 : 0));
      q.dx = up > 0.5 && !calm() ? wave(t, 260, 3) : 0;
      q.mouth = up > 0.5 ? "o" : null;
      q.brows = up > 0.5 ? "M-15,-127 L-3,-121 M15,-127 L3,-121" : null;
      q.look = 3;
    },
  },
  {
    id: "trophy",
    name: "GG",
    line: "Hands a gold trophy across to the target, with a little bow.",
    word: "GG",
    dur: 2700,
    hold: 1200,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("path", { d: "M-16,-50 h32 c0,18 -6,26 -16,28 c-10,-2 -16,-10 -16,-28 Z", fill: "#f4c542", stroke: "#8a5a10", "stroke-width": 2 }, g);
      el("path", { d: "M-16,-46 c-10,0 -10,12 0,14 M16,-46 c10,0 10,12 0,14", fill: "none", stroke: "#8a5a10", "stroke-width": 3 }, g);
      el("rect", { x: -3, y: -22, width: 6, height: 10, fill: "#c99a2e" }, g);
      el("rect", { x: -12, y: -12, width: 24, height: 7, rx: 2, fill: "#8a5a10" }, g);
      const shine = el("g", {}, g);
      star4(shine, -22, -60, 6);
      star4(shine, 22, -64, 5);
      return { g, shine };
    },
    frame(r, t, P) {
      const q = r.q;
      const out = k(t, [[0, 0], [400, 1, "o"], [2300, 1], [2650, 0]]);
      q.arms[1] = ARM(8 + 84 * out, -16 * out);
      q.rot = 9 * out;
      atHand(P.g, q, 1, 6, 8, 0, 1.4 * pop(t, 250) * (t < 2450 ? 1 : 0));
      set(P.shine, { display: t > 600 && t < 2300 ? "inline" : "none" });
      q.eyes = out > 0.5 ? "happy" : "open";
      q.mouth = out > 0.5 ? "smile" : null;
    },
  },
  {
    id: "confetti",
    name: "Confetti",
    line: "A party popper aimed at the target: pop, and confetti rains on them.",
    word: "yay!",
    dur: 2800,
    hold: 1000,
    aimed: true,
    setup(r) {
      const cone = el("g", {}, r.me.handFx);
      el("path", { d: "M-6,4 L6,4 L18,-30 L-2,-34 Z", fill: "#b79cf7", stroke: INK, "stroke-width": 2 }, cone);
      el("path", { d: "M-2,-6 L10,-10 M1,-18 L14,-21", stroke: "#ffe58a", "stroke-width": 3 }, cone);
      const bits = el("g", {}, r.world);
      const colours = ["#ffe58a", "#4fc3b0", "#f05a7e", "#8fd3ff", "#f4b453", "#b79cf7"];
      const parts = Array.from({ length: 26 }, (_, i) => el("rect", { width: 7, height: 4, rx: 1, fill: colours[i % colours.length] }, bits));
      return { cone, parts };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [300, 1, "o"], [2400, 1], [2750, 0]]);
      q.arms[1] = ARM(8 + 128 * up, 14 * up);
      atHand(P.cone, q, 1, 0, 0, 10, pop(t, 200) * (t < 2550 ? 1 : 0));
      q.eyes = t > 450 && t < 2400 ? "happy" : "open";
      q.mouth = t > 450 && t < 2400 ? "grin" : null;
      q.lift = t > 450 && t < 700 ? 10 : 0;
      // From the cone's mouth, up and over the target, then fluttering down around it.
      const from = { x: r.me.baseX + 46, y: FLOOR - 160 };
      const to = { x: r.other.baseX, y: FLOOR - 170 };
      P.parts.forEach((bit, i) => {
        const u = clamp((t - 450) / 450, 0, 1);
        const fall = clamp((t - 900) / 1500, 0, 1);
        const spread = (i / P.parts.length - 0.5) * 110;
        const x = from.x + (to.x + spread - from.x) * u + (calm() ? 0 : wave(t + i * 97, 600, 6));
        const y = from.y + (to.y - from.y) * u - Math.sin(u * Math.PI) * 60 + fall * (110 + (i % 5) * 18);
        set(bit, { display: t > 450 && t < 2600 ? "inline" : "none", x: x.toFixed(1), y: y.toFixed(1), transform: `rotate(${((t / 4 + i * 40) % 360).toFixed(0)},${x.toFixed(1)},${y.toFixed(1)})` });
      });
    },
  },
  {
    id: "magnifier",
    name: "Suspicious",
    line: "Leans in with a magnifying glass at the target. One big eye in the lens.",
    word: "hmm...",
    dur: 2800,
    hold: 1300,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -3.5, y: -8, width: 7, height: 26, rx: 3, fill: "#5a3a22", transform: "rotate(-35)" }, g);
      el("circle", { cx: 12, cy: -20, r: 20, fill: "#cfeaff", "fill-opacity": 0.55, stroke: "#3a2a1c", "stroke-width": 5 }, g);
      el("ellipse", { cx: 12, cy: -20, rx: 7, ry: 10, fill: INK }, g);
      el("circle", { cx: 14, cy: -24, r: 2.5, fill: "#fff" }, g);
      return { g };
    },
    frame(r, t, P) {
      const q = r.q;
      const lean = k(t, [[0, 0], [400, 1, "o"], [2400, 1], [2750, 0]]);
      q.arms[1] = ARM(8 + 78 * lean, -8 * lean);
      q.rot = 12 * lean;
      q.dx = 12 * lean + (calm() ? 0 : wave(t, 900, 4 * lean));
      atHand(P.g, q, 1, 4, 0, 0, pop(t, 250) * (t < 2550 ? 1 : 0));
      q.eye = 1 - 0.45 * lean;
      q.lid = 0.6 * lean;
      q.look = 3;
      q.brows = lean > 0.5 ? "M-15,-122 L-3,-124 M3,-126 L15,-120" : null;
      q.mouth = lean > 0.5 ? "flat" : null;
    },
  },
  {
    id: "shamebell",
    name: "Shame bell",
    line: "Rings a handbell high, slowly. Judging.",
    word: "shame",
    dur: 2800,
    hold: 1100,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      // A handbell: the handle in the hand, the bell hanging under it, mouth down.
      el("rect", { x: -4, y: -14, width: 8, height: 20, rx: 3, fill: "#5a3a22" }, g);
      el("circle", { cx: 0, cy: 38, r: 4, fill: "#8a5a10" }, g);
      el("path", { d: "M0,6 C-12,6 -18,16 -18,30 L-23,36 L23,36 L18,30 C18,16 12,6 0,6 Z", fill: "#f4c542", stroke: "#8a5a10", "stroke-width": 2.5 }, g);
      return { g };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [300, 1, "o"], [2400, 1], [2750, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 10 * up);
      atHand(P.g, q, 1, 0, 0, calm() ? 0 : wave(t, 700, 24), 1.5 * pop(t, 200) * (t < 2550 ? 1 : 0));
      q.eye = 0.6;
      q.lid = 0.5 * up;
      q.look = 3;
      q.mouth = up > 0.5 ? "flat" : null;
      q.hr = up > 0.5 && !calm() ? wave(t, 1400, 5) : 0;
    },
  },
  {
    id: "shush",
    name: "Shh",
    line: "A sign that says SHH, held up firmly.",
    word: "shh",
    dur: 2500,
    hold: 1100,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -3, y: -26, width: 6, height: 30, rx: 2, fill: "#7a4b22" }, g);
      el("rect", { x: -34, y: -64, width: 68, height: 40, rx: 6, fill: "#fbf3e2", stroke: INK, "stroke-width": 3 }, g);
      text(g, "SHH", { y: -34, "font-size": 26, fill: INK });
      return { g };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [250, 1, "b"], [2150, 1], [2450, 0]]);
      q.arms[1] = ARM(8 + 150 * up, 10 * up);
      atHand(P.g, q, 1, 0, 0, 0, pop(t, 180) * (t < 2300 ? 1 : 0));
      q.eye = 0.7;
      q.lid = 0.35 * up;
      q.mouth = up > 0.5 ? "small" : null;
      q.look = 3;
    },
  },
  {
    id: "bored",
    name: "Bored",
    line: "Rests its head on a pillow. Zzz drifts up.",
    word: "zzz",
    dur: 3000,
    hold: 1500,
    setup(r) {
      const pillow = el("rect", { x: 22, y: -136, width: 46, height: 30, rx: 12, fill: "#f6f0e6", stroke: "#cdbfa6", "stroke-width": 2 }, r.me.bodyFx);
      const zs = [0, 1, 2].map((i) => text(r.me.front, "Z", { "font-size": 18 + i * 6, fill: "#cdbfa6", x: 0, y: 0 }));
      return { pillow, zs };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [450, 1, "o"], [2600, 1], [2950, 0]]);
      set(P.pillow, { display: on > 0.05 ? "inline" : "none", opacity: on.toFixed(2) });
      q.hr = 24 * on;
      q.hx = 8 * on;
      q.hy = 4 * on;
      q.sy = 1 - 0.05 * on;
      q.eyes = on > 0.5 ? "shut" : "open";
      q.mouth = on > 0.5 ? "small" : null;
      P.zs.forEach((z, i) => {
        const u = calm() ? 0.5 : (((t - 500 - i * 400) % 1200) + 1200) % 1200 / 1200;
        set(z, { display: t > 500 + i * 400 && t < 2700 ? "inline" : "none", x: (30 + i * 14 + u * 10).toFixed(1), y: (-150 - i * 16 - u * 26).toFixed(1), opacity: (1 - u * 0.7).toFixed(2) });
      });
    },
  },
  {
    id: "question",
    name: "Huh?",
    line: "A big question mark held up, and a shrug.",
    word: "huh?",
    dur: 2600,
    hold: 1100,
    setup(r) {
      return { g: paddle(r.me.handFx, "#f4b453", "#1e1410", "?", 36, 26, 44) };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [280, 1, "o"], [2250, 1], [2550, 0]]);
      const shrug = up > 0.5 && !calm() ? Math.max(0, wave(t, 700, 1)) : 0;
      q.arms[1] = ARM(8 + 150 * up, 10 * up);
      q.arms[-1] = up > 0.3 ? ARM(55 + 15 * shrug, 70) : null;
      atHand(P.g, q, 1, 0, 0, calm() ? 0 : wave(t, 700, 8), pop(t, 200) * (t < 2400 ? 1 : 0));
      q.lift = 6 * shrug;
      q.look = -2;
      q.eye = 1.15;
      q.mouth = up > 0.5 ? "flat" : null;
      q.brows = up > 0.5 ? "M-15,-127 Q-9,-131 -3,-127 M3,-127 Q9,-131 15,-127" : null;
    },
  },
  {
    id: "heart",
    name: "Love it",
    line: "A big red heart held up toward the target, beating.",
    word: "love it",
    dur: 2600,
    hold: 1100,
    aimed: true,
    setup(r) {
      const g = el("g", {}, r.me.handFx);
      el("rect", { x: -3, y: -20, width: 6, height: 24, rx: 2, fill: "#7a4b22" }, g);
      const heart = el("path", { d: "M0,-22 C-30,-40 -26,-70 -12,-70 C-4,-70 0,-62 0,-58 C0,-62 4,-70 12,-70 C26,-70 30,-40 0,-22 Z", fill: "#e8334a", stroke: "#7a1d12", "stroke-width": 2.5 }, g);
      return { g, heart };
    },
    frame(r, t, P) {
      const q = r.q;
      const up = k(t, [[0, 0], [280, 1, "o"], [2250, 1], [2550, 0]]);
      q.arms[1] = ARM(8 + 145 * up, 14 * up);
      atHand(P.g, q, 1, 0, 0, 0, pop(t, 200) * (t < 2400 ? 1 : 0));
      const beat = calm() ? 1 : 1 + 0.12 * Math.max(0, Math.sin((t / 600) * Math.PI * 2)) ** 6;
      set(P.heart, { transform: `translate(0,-46) scale(${beat.toFixed(3)}) translate(0,46)` });
      q.eyes = up > 0.5 ? "happy" : "open";
      q.mouth = up > 0.5 ? "smile" : null;
      q.rot = up > 0.5 && !calm() ? wave(t, 1200, 3) : 0;
    },
  },
  {
    id: "rolling",
    name: "Rolling laughing",
    line: "Falls back laughing and rocks on the floor, holding its belly.",
    word: "HA HA HA",
    dur: 3000,
    hold: 1400,
    setup(r) {
      const ha = el("g", {}, r.world);
      const a = text(ha, "HA HA", { "font-size": 24, fill: "#ffe58a", x: r.me.baseX, y: FLOOR - 120 });
      return { a };
    },
    frame(r, t, P) {
      const q = r.q;
      const down = k(t, [[0, 0], [400, 1, "o"], [2500, 1], [2900, 0]]);
      q.pivot = 70;
      q.rot = -95 * down + (down > 0.9 && !calm() ? wave(t, 300, 12) : 0);
      q.lift = -30 * down;
      q.eyes = t > 200 ? "happy" : "open";
      q.mouth = t > 200 ? "laugh" : null;
      q.arms[-1] = down > 0.5 ? ARM(-20, -80) : null;
      q.arms[1] = down > 0.5 ? ARM(-20, -80) : null;
      set(P.a, { display: t > 500 && t < 2600 ? "inline" : "none" });
    },
  },
  {
    id: "steam",
    name: "Fuming",
    line: "Goes red, steam out of the head, little stomps.",
    word: "grr",
    dur: 2700,
    hold: 1200,
    setup(r) {
      const steam = [-1, 1].map((s) => el("path", { d: `M${s * 24},-134 q${s * 7},-9 0,-16 q${-s * 7},-7 0,-16`, stroke: "#eeeeee", "stroke-width": 5, fill: "none", "stroke-linecap": "round" }, r.me.headFx));
      return { steam };
    },
    frame(r, t, P) {
      const q = r.q;
      const red = k(t, [[0, 0], [200, 0], [800, 0.85], [2300, 0.85], [2650, 0]]);
      q.tint = red;
      q.brows = red > 0.3 ? "M-15,-127 L-3,-120 M15,-127 L3,-120" : null;
      q.mouth = red > 0.3 ? "grit" : null;
      q.eye = 0.7;
      q.lift = red > 0.5 && !calm() ? Math.max(0, wave(t, 330, 9)) : 0;
      P.steam.forEach((s, i) => {
        const u = calm() ? 0.3 : ((t + i * 250) % 600) / 600;
        set(s, { display: red > 0.4 ? "inline" : "none", transform: `translate(0,${(-u * 16).toFixed(1)})`, opacity: (1 - u).toFixed(2) });
      });
    },
  },
  {
    id: "sprinkler",
    name: "Sobbing",
    line: "Wails, and tears spray out of both eyes like a sprinkler.",
    word: "waaah",
    dur: 2800,
    hold: 1200,
    setup(r) {
      const drops = Array.from({ length: 16 }, () => el("path", { d: "M0,-5 C3,-1 3,3 0,3 C-3,3 -3,-1 0,-5 Z", fill: "#8fd3ff" }, r.me.headFx));
      return { drops };
    },
    frame(r, t, P) {
      const q = r.q;
      const on = k(t, [[0, 0], [250, 1], [2500, 1], [2750, 0]]);
      q.eyes = on > 0.5 ? "shut" : "open";
      q.mouth = on > 0.5 ? "wail" : null;
      q.brows = on > 0.5 ? "M-15,-124 L-4,-121 M15,-124 L4,-121" : null;
      q.dx = on > 0.5 && !calm() ? wave(t, 90, 1.2) : 0;
      P.drops.forEach((d, i) => {
        const side = i % 2 ? 1 : -1;
        const u = calm() ? (i / P.drops.length) % 1 : ((t + i * 70) % 560) / 560;
        const x = side * (12 + u * 46);
        const y = -112 - Math.sin(u * Math.PI) * 30 + u * u * 40;
        set(d, { display: on > 0.5 && t < 2500 ? "inline" : "none", transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, opacity: (1 - u * 0.5).toFixed(2) });
      });
    },
  },
];

/**
 * Candidates drawn and then cut because they did not read at a piece's real size on a phone (the
 * across-the-room test), or read as something they are not. Not shown in the list.
 */
const CUT_BECAUSE = {
  sprinkler: "the tears vanish at a piece's real size",
  magnifier: "the lens shrinks to a dot",
  tissues: "the tissue box is a speck; only the sticker says what it is",
  bored: "the pillow reads as a white blob",
  rolling: "a piece lying on the floor reads as knocked over, not laughing",
};
const EMOTES = CANDIDATES.filter((e) => !CUT_BECAUSE[e.id]);
const CUT = CANDIDATES.filter((e) => CUT_BECAUSE[e.id]).map((e) => `${e.name} (${CUT_BECAUSE[e.id]})`);

const byId = (id) => EMOTES.find((e) => e.id === id);

// ---------------------------------------------------------------- sounds: recordings, A/B/C per emote

const board = new SoundBoard({ room: "preview-v2" });
let soundOn = true;
addEventListener("pointerdown", () => board.unlock(), { capture: true, passive: true });
addEventListener("keydown", () => board.unlock(), { capture: true, passive: true });
const takesOf = (id) => CLIPS.filter((c) => c.emote === id);
for (const c of CLIPS) defineSound(`${c.emote}-${c.label}`, c.uri);
/** The take chosen for each emote ("A" by default), kept on the device. */
const takes = recall("pv2:takes", {});
const takeFor = (id) => (takesOf(id).some((c) => c.label === takes[id]) ? takes[id] : takesOf(id)[0]?.label ?? null);
let soundTimer = 0;
function playSound(e, delay = 220) {
  clearTimeout(soundTimer);
  const take = takeFor(e.id);
  if (!soundOn || !take) return;
  soundTimer = setTimeout(() => void board.play(`${e.id}-${take}`, { from: "me" }), delay);
}

// ---------------------------------------------------------------- a stage: the room's back wall, a floor, three pawns

function backdrop(svg, id) {
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
  for (let x = -880; x < 1540; x += 46) {
    const y = 26 + 10 * Math.sin(x / 50);
    el("circle", { cx: x, cy: y, r: 3.6, fill: "#ffeccb" }, g);
  }
}

let stageCount = 0;
function makeStage(svg) {
  svg.replaceChildren();
  backdrop(svg, ++stageCount);
  const cam = el("g", {}, svg);
  const world = el("g", {}, cam);
  const r = { svg, cam, world, state: {} };
  r.other2 = makePawn(world, SEATS[3], 130);
  r.other = makePawn(world, SEATS[1], 510);
  r.me = makePawn(world, SEATS[0], 320);
  r.over = el("g", {}, svg);
  r.bubble = (() => {
    const g = el("g", { display: "none" }, r.over);
    const back = el("path", { fill: "#fbf3e2", stroke: INK, "stroke-width": 3, "stroke-linejoin": "round" }, g);
    const t = text(g, "", { "font-size": 22, fill: INK, y: 8 });
    return { g, back, t };
  })();
  r.card = (() => {
    const g = el("g", { display: "none" }, r.over);
    el("rect", { x: -230, y: -52, width: 460, height: 104, rx: 16, fill: "#120b08", stroke: "#f4b453", "stroke-width": 4 }, g);
    text(g, "MABEL", { "font-size": 18, fill: SEATS[0], y: -18, "letter-spacing": 4 });
    const big = text(g, "", { "font-size": 40, fill: "#fbf3e2", y: 28 });
    return { g, big };
  })();
  return r;
}

function prepare(r, e) {
  for (const p of [r.me, r.other, r.other2]) for (const g of [p.bodyFx, p.headFx, p.handFx, p.front, p.floor, p.arms[-1].holds, p.arms[1].holds]) g.replaceChildren();
  for (const c of [...r.world.children]) if (![r.me.root, r.other.root, r.other2.root].includes(c)) c.remove();
  r.props = e.setup ? e.setup(r) : {};
}

/** Draws emote `e` at `t` on stage `r`, with treatment "A" (the body), "B" (+ a sticker) or "C" (+ a screen card). */
function draw(r, e, t, treatment = "B") {
  r.q = REST();
  r.qo = REST();
  r.qo2 = REST();
  // Watchers turn their eyes toward whoever is performing.
  r.qo.look = -3;
  r.qo2.look = 3;
  e.frame(r, t, r.props);
  apply(r.me, r.q);
  apply(r.other, r.qo);
  apply(r.other2, r.qo2);
  set(r.other.root, { opacity: e.aimed ? 1 : 0.55 });
  set(r.other2.root, { opacity: 0.5 });
  const show = treatment !== "A" && t > 250 && t < e.dur - 250;
  if (show) {
    const lifted = Math.max(0, r.q.lift);
    const lying = e.id === "rolling";
    const head = { x: r.me.baseX + r.q.x - (lying ? 60 : 0), y: FLOOR - (lying ? 110 : 215) - lifted };
    r.bubble.t.textContent = e.word;
    const w = Math.max(60, e.word.length * 12.5 + 28);
    set(r.bubble.back, { d: `M${-w / 2},-22 h${w} a10,10 0 0 1 10,10 v24 a10,10 0 0 1 -10,10 h${-w / 2 + 10} l-10,12 l-4,-12 h${-w / 2 + 4} a10,10 0 0 1 -10,-10 v-24 a10,10 0 0 1 10,-10 Z` });
    const s = calm() ? 1 : EASE.b(clamp((t - 250) / 160, 0, 1));
    // Stickers sit to the sender's left when a sign is held up on the right.
    const x = clamp(head.x - (r.q.arms[1] && r.q.arms[1].a > 120 ? 40 : 0), w / 2 + 12, 640 - w / 2 - 12);
    set(r.bubble.g, { display: "inline", transform: `translate(${x.toFixed(1)},${head.y.toFixed(1)}) scale(${s.toFixed(3)})` });
  } else set(r.bubble.g, { display: "none" });
  const card = treatment === "C" && t > 500 && t < Math.min(e.dur - 300, 2400);
  if (card) {
    r.card.big.textContent = e.word.toUpperCase();
    set(r.card.g, { display: "inline", transform: `translate(320,58) scale(${(0.72 * (calm() ? 1 : EASE.b(clamp((t - 500) / 200, 0, 1)) * 0.9 + 0.1)).toFixed(3)})` });
  } else set(r.card.g, { display: "none" });
}

// ---------------------------------------------------------------- the main stage

const stage = makeStage($("stage"));
let current = EMOTES[0];
let startedAt = -1;
let running = false;
let treatment = recall("pv2:treatment", "B");

function play(e, withSound = true) {
  current = e;
  prepare(stage, e);
  startedAt = performance.now();
  drawNow();
  if (withSound) playSound(e);
  for (const row of document.querySelectorAll(".row")) row.classList.toggle("playing", row.dataset.id === e.id);
  if (calm()) return draw(stage, e, e.hold, treatment);
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

/** The line under the stage: the emote, and its sound takes to choose from by ear. */
function drawNow() {
  const box = $("now");
  box.replaceChildren();
  h("span", "name", current.name, box);
  const list = takesOf(current.id);
  if (!list.length) {
    h("span", "what", "no sound", box);
    return;
  }
  h("span", "what", "sound:", box);
  const seg = h("span", "takes", "", box);
  for (const c of list) {
    const b = h("button", "", c.label, seg);
    b.type = "button";
    b.title = `${c.source.title} by ${c.source.author} (CC0)`;
    b.setAttribute("aria-label", `Sound ${c.label}: ${c.source.title} by ${c.source.author}`);
    b.setAttribute("aria-pressed", String(takeFor(current.id) === c.label));
    b.addEventListener("click", () => {
      takes[current.id] = c.label;
      remember("pv2:takes", takes);
      drawNow();
      drawRows();
      writePicks();
      void board.play(`${current.id}-${c.label}`, { from: "me" });
    });
  }
  const credit = list.find((c) => c.label === takeFor(current.id))?.source;
  if (credit) h("span", "what", `${credit.author}, CC0`, box);
}

// ---------------------------------------------------------------- the list: every candidate, at its real size

/**
 * A picture of the held pose at the size a piece really is: on a phone held sideways showing
 * the whole room a piece is about 58 CSS pixels tall; on a 1080p big screen about 141.
 */
function thumbnail(e, size) {
  const px = size === "screen" ? 141 : 58;
  const s = px / 141;
  // Tall enough for what is held up and the sticker over it: about 270 room units, at the real scale.
  const h0 = Math.round(270 * s);
  const w0 = Math.round((e.aimed ? 300 : 150) * s);
  const svg = document.createElementNS(NS, "svg");
  const vw = w0 / s;
  const vh = h0 / s;
  const cx = e.aimed ? 420 : 320;
  set(svg, { width: w0, height: h0, viewBox: `${(cx - vw / 2).toFixed(1)} ${(FLOOR + 10 - vh).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`, "aria-hidden": "true" });
  const r = makeStage(svg);
  prepare(r, e);
  draw(r, e, e.hold, treatment);
  if (!e.aimed) set(r.other.root, { display: "none" });
  set(r.other2.root, { display: "none" });
  return svg;
}

const stars = new Set(recall("pv2:stars", []));
let size = "phone";
function drawRows() {
  const box = $("rows");
  box.replaceChildren();
  $("pane-list").classList.toggle("big", size === "screen");
  for (const e of EMOTES) {
    const row = h("button", "row" + (e === current ? " playing" : ""), "", box);
    row.type = "button";
    row.dataset.id = e.id;
    const th = h("span", "thumb", "", row);
    const pic = thumbnail(e, size);
    th.style.width = `${pic.getAttribute("width")}px`;
    th.style.height = `${pic.getAttribute("height")}px`;
    th.append(pic);
    const words = h("span", "words", "", row);
    const nm = h("span", "nm", e.name, words);
    if (e.kept) h("span", "tag kept", "KEPT", nm);
    if (e.aimed) h("span", "tag", "AIMED", nm);
    h("div", "ln", e.line, words);
    const take = takeFor(e.id);
    const clip = takesOf(e.id).find((c) => c.label === take);
    h("div", "snd", clip ? `♪ ${clip.source.title.replace(/\.(wav|mp3|flac|aif)$/i, "")} (${takesOf(e.id).length} take${takesOf(e.id).length > 1 ? "s" : ""})` : "no sound", words);
    const st = h("span", "star", "★", row);
    st.setAttribute("role", "button");
    st.setAttribute("tabindex", "0");
    st.setAttribute("aria-label", `Favourite: ${e.name}`);
    st.setAttribute("aria-pressed", String(stars.has(e.id)));
    const toggle = (ev) => {
      ev.stopPropagation();
      if (stars.has(e.id)) stars.delete(e.id);
      else stars.add(e.id);
      remember("pv2:stars", [...stars]);
      st.setAttribute("aria-pressed", String(stars.has(e.id)));
      writePicks();
    };
    st.addEventListener("click", toggle);
    st.addEventListener("keydown", (ev) => (ev.key === "Enter" || ev.key === " ") && toggle(ev));
    row.addEventListener("click", () => play(e));
  }
}

// ---------------------------------------------------------------- the wheel and its loadout

const DEFAULT_WHEEL = ["violin", "popcorn", "slowclap", "pointlaugh", "ten", "redcard"];
let wheel = recall("pv2:wheel", DEFAULT_WHEEL).filter((id) => byId(id));
while (wheel.length < 6) wheel.push(DEFAULT_WHEEL.find((id) => !wheel.includes(id)));
let slotPicked = 0;
function drawLoadout() {
  const box = $("loadout");
  box.replaceChildren();
  wheel.forEach((id, i) => {
    const b = h("button", "slot" + (i === slotPicked ? " sel" : ""), "", box);
    b.type = "button";
    h("div", "k", `key ${i + 1}`, b);
    h("div", "", byId(id).name, b);
    b.addEventListener("click", () => {
      slotPicked = i;
      drawLoadout();
    });
  });
}
$("put").addEventListener("click", () => {
  wheel[slotPicked] = current.id;
  remember("pv2:wheel", wheel);
  toast(`${current.name} is on slot ${slotPicked + 1}`);
  slotPicked = (slotPicked + 1) % 6;
  drawLoadout();
  writePicks();
});
$("reset").addEventListener("click", () => {
  wheel = [...DEFAULT_WHEEL];
  remember("pv2:wheel", wheel);
  drawLoadout();
  writePicks();
});

const wheelBox = $("wheel");
const veil = $("veil");
let press = null;
let hot = -1;
let coolUntil = 0;
let wedges = [];
function buildWheel() {
  wheelBox.replaceChildren();
  const svg = el("svg", { viewBox: "-150 -150 300 300" }, wheelBox);
  wedges = [];
  for (let i = 0; i < 6; i++) {
    const a0 = ((i - 0.5) / 6) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.5) / 6) * Math.PI * 2 - Math.PI / 2;
    const p = (rr, a) => `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
    const w = el("path", { class: "wedge", d: `M${p(46, a0)} L${p(142, a0)} A142,142 0 0 1 ${p(142, a1)} L${p(46, a1)} A46,46 0 0 0 ${p(46, a0)} Z` }, svg);
    const mid = (a0 + a1) / 2;
    const cx = Math.cos(mid) * 95;
    const cy = Math.sin(mid) * 95;
    const e = byId(wheel[i]);
    const pic = thumbnail({ ...e, aimed: false }, "phone");
    set(pic, { x: cx - 26, y: cy - 38, width: 52, height: 52 });
    svg.append(pic);
    el("text", { class: "label", x: cx, y: cy + 28 }, svg).textContent = e.name.split(" ").slice(0, 2).join(" ");
    w.addEventListener("click", () => wheelBox.classList.contains("tap") && fire(i));
    wedges.push(w);
  }
  el("circle", { class: "hub", r: 40 }, svg);
  el("text", { class: "hubtext", y: 4 }, svg).textContent = "flick";
}
function openWheel(x, y, tapMode) {
  buildWheel();
  wheelBox.style.left = clamp(x, 158, innerWidth - 158) + "px";
  wheelBox.style.top = clamp(y - 60, 158, innerHeight - 158) + "px";
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
  const sweep = $("emote-sweep");
  const step = () => {
    const left = Math.max(0, coolUntil - performance.now());
    sweep.setAttribute("stroke-dasharray", `${(100 * (1 - left / 1500)).toFixed(1)} 100`);
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
  setHot(((Math.round((a / (Math.PI * 2)) * 6) % 6) + 6) % 6);
});
btn.addEventListener("pointerup", (ev) => {
  if (!press || ev.pointerId !== press.id) return;
  btn.classList.remove("held");
  const quick = performance.now() - press.at < 300 && hot === -1;
  if (hot >= 0) fire(hot);
  else if (quick) {
    press = null;
    wheelBox.classList.add("tap");
    veil.classList.add("open");
  } else closeWheel();
});
btn.addEventListener("pointercancel", () => closeWheel());
veil.addEventListener("click", closeWheel);
addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeWheel();
  if (/^[1-6]$/.test(ev.key) && !(ev.target instanceof HTMLTextAreaElement)) fire(Number(ev.key) - 1);
});

// ---------------------------------------------------------------- tabs and switches

for (const tab of document.querySelectorAll(".tabs button")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll(".pane")) p.hidden = p.id !== `pane-${tab.dataset.pane}`;
  });
}
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
    remember("pv2:treatment", v);
    drawRows();
    writePicks();
    play(current, false);
  },
  treatment,
);
segment(
  "sizes",
  (v) => {
    size = v;
    drawRows();
  },
  size,
);
$("sound-on").addEventListener("click", () => {
  soundOn = !soundOn;
  $("sound-on").classList.toggle("on", soundOn);
  $("sound-on").setAttribute("aria-pressed", String(soundOn));
  $("sound-on").textContent = soundOn ? "Sound on" : "Sound off";
  if (!soundOn) board.stopAll();
});

// ---------------------------------------------------------------- notes and sources

const NOTES = [
  "<strong>What changed from the first round.</strong> Kept the four that worked (violin, popcorn, slow clap, point and laugh). Every new one is a single clear prop and one simple motion, readable in half a second, and most are aimed at someone. Point and laugh no longer knocks the other piece down: it just stands there and sweats a little. No emote changes another player's piece in a way that looks like harm.",
  "<strong>The across-the-room test.</strong> Each row's picture is the held pose at the size a piece really is: about 58 pixels tall on a phone held sideways showing the whole room (the hardest case), or about 141 on a 1080p big screen (switch above the list). Candidates that did not read at the phone size were cut before you saw them (listed below).",
  "<strong>Suggested starter wheel:</strong> violin, popcorn, slow clap, point and laugh, Perfect 10 and Red card. The paddle and the card read instantly at any size and give one nice and one rude option.",
  "<strong>Sounds.</strong> Each emote carries one short recording; the A, B and C buttons under the stage switch between takes so you can choose by ear. They are all recordings from Freesound marked Creative Commons 0 (public domain), listed on the Sounds tab. With a big screen in the room the sound plays from the screen only; each phone has volume and mute, and can mute one player.",
  "<strong>Display.</strong> \"+ sticker\" (a word bubble over the head) is the default: the pawn's performance is the fun, the word makes it readable from the couch. \"+ screen card\" is for a few rare ones at most.",
];
{
  const box = $("notes");
  for (const n of NOTES) {
    const d = h("div", "note", "", box);
    h("p", "", "", d).innerHTML = n;
  }
  const cut = h("div", "note", "", box);
  h("p", "", "", cut).innerHTML = `<strong>Cut for failing the thumbnail test:</strong> ${CUT.join("; ")}.`;
}
{
  const box = $("sources");
  h("p", "", "Every sound here is a recording from Freesound that its page marks Creative Commons 0 (public domain: may be copied, changed and shared, even commercially, without asking). Each was trimmed, made mono and brought to the same loudness. Nothing is in the repository until you pick.", box);
  const table = h("table", "", "", box);
  const head = h("tr", "", "", table);
  for (const t of ["Emote", "Take", "Recording", "Licence"]) h("th", "", t, head);
  for (const c of CLIPS.filter((x) => byId(x.emote))) {
    const tr = h("tr", "", "", table);
    h("td", "", byId(c.emote)?.name ?? c.emote, tr);
    h("td", "", `${c.label} · ${c.seconds.toFixed(1)} s`, tr);
    const td = h("td", "", "", tr);
    const a = h("a", "", `${c.source.title} by ${c.source.author}`, td);
    a.href = c.source.page;
    a.target = "_blank";
    a.rel = "noopener";
    h("td", "", c.source.licence, tr);
  }
}

// ---------------------------------------------------------------- picks

function writePicks() {
  const em = EMOTES.filter((e) => stars.has(e.id));
  const lines = [
    "Emotes v2: my picks",
    "",
    "Starred: " + (em.length ? em.map((e) => `${e.name}${takeFor(e.id) ? ` (sound ${takeFor(e.id)})` : ""}`).join(", ") : "(none starred)"),
    "My wheel: " + wheel.map((id) => byId(id).name).join(", "),
    "Display: " + { A: "the body only", B: "body + sticker", C: "body + sticker + screen card" }[treatment],
  ];
  $("picks").value = lines.join("\n");
}
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
  remember("pv2:stars", []);
  drawRows();
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

/** #still=<id>&look=A|B|C: the stage alone, frozen at the held pose. #size=screen: the big pictures. */
const still = /still=([\w-]+)/.exec(location.hash);
if (/size=screen/.test(location.hash)) {
  size = "screen";
  segment("sizes", () => {}, "screen");
}
drawRows();
drawLoadout();
writePicks();
if (still && byId(still[1])) {
  document.documentElement.classList.add("still-mode");
  current = byId(still[1]);
  prepare(stage, current);
  draw(stage, current, current.hold, /look=([ABC])/.exec(location.hash)?.[1] ?? treatment);
} else {
  prepare(stage, current);
  draw(stage, current, current.hold, treatment);
  drawNow();
}
document.documentElement.dataset.ready = "1";
