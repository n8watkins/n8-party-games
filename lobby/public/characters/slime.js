// The slime, as the page knows it without the 3D look: its flat drawing and its emotes.
// One of the characters (./index.js lists them; lobby/README.md, "Characters", is the interface).
//
// The landing scene's slime, which the owner approved (landing/tools/scene/scene.js, makeSkin):
// a soft dome in the player's colour that sags outward at its foot, a wet highlight, two drips at
// the foot and two big eyes low on its front. It is a shade lighter than the player's colour with
// a gloss streak (the Tin Derby reviewer's fix: a dome in a dark colour otherwise reads as a hole),
// and a darker rim, so it reads on a light wall and on a dark floor alike.
//
// It has no feet: it squashes and stretches as it creeps along, its top lags behind when it sets
// off and jiggles when it stops, and it flattens when it is knocked over. Its emotes are the
// ghost's, fitted to its body (./body-rig.js), its hands on arms of its own goo.
import { s, set, shade } from "../dom.js";
import { bodyRig } from "./body-rig.js";

const INK = "#1a1210";
const GREY = "#8a8d94";
/** Rig units per model unit: the pawn's head (0.9 up in the model) is 113 up in the rig. */
const RU = 113 / 0.9;

/** The slime's measures in rig units (body-rig.js, BodyMeasures), from the landing scene's model (0.7 tall, 0.48 wide at its foot). */
export const SLIME = {
  floor: -2,
  mouth: -0.21 * RU,
  top: -0.7 * RU,
  half: 52,
  root: { x: 46, y: -36 },
  hover: 0,
  hand: 1.12,
  lift: 0.8,
  puff: 1.4,
  sag: 0.22,
  eyeY: -0.34 * RU,
  eyeX: 15,
};

const { rig, emotes } = bodyRig(SLIME, "goo");
export const SLIME_RIG = rig;

/** The dome, from the landing scene's profile: round on top, sagging outward at the foot. */
function domePath() {
  const n = 16;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i / n) * Math.PI) / 2;
    const r = 0.43 * Math.pow(Math.cos(a), 0.62) + 0.05 * Math.pow(1 - i / n, 6);
    pts.push([r * RU, -0.7 * Math.sin(a) * RU]);
  }
  const right = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
  const left = pts.slice(0, -1).reverse().map(([x, y]) => `${(-x).toFixed(1)},${y.toFixed(1)}`);
  // The foot: a little round lip where it meets the floor.
  return `M${-pts[0][0].toFixed(1)},-1 Q0,3 ${pts[0][0].toFixed(1)},-1 L${right.join(" L")} L${left.join(" L")} Z`;
}
export const SLIME_DOME = domePath();

/**
 * The dome hardened: the same outline cut into flat faces, like a gem (lobby/shared/slime.js,
 * harden), and the lines between its faces.
 */
function gemPaths() {
  const n = 4;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i / n) * Math.PI) / 2;
    const r = 0.43 * Math.pow(Math.cos(a), 0.62) + 0.05 * Math.pow(1 - i / n, 6);
    pts.push([r * RU, -0.7 * Math.sin(a) * RU]);
  }
  const ring = [...pts.map(([x, y]) => [x, y]), ...pts.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
  const outline = `M${ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} Z`;
  // From a point high on its front to each corner: the facets.
  const c = [-6, -0.46 * RU];
  const facets = ring.slice(1, -1).map(([x, y]) => `M${c[0]},${c[1].toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return { outline, facets };
}
const GEM = gemPaths();

/** How far the top of its head is below a standing pawn's (room units). */
const BELOW_PAWN = 141 + SLIME.top;

let made = 0;

function shapes(colour, connected = true) {
  const id = `slime-gel-${++made}`;
  const hi = s("stop", { offset: "0%" });
  const mid = s("stop", { offset: "55%" });
  const lo = s("stop", { offset: "100%" });
  const grad = s("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, hi, mid, lo);
  const a = {
    grad,
    hi,
    mid,
    lo,
    body: s("path", { d: SLIME_DOME, fill: `url(#${id})`, "stroke-width": 2.2, "stroke-linejoin": "round" }),
    drips: s("g", {}, s("ellipse", { cx: 58, cy: -3, rx: 8.5, ry: 5 }), s("ellipse", { cx: -55, cy: -2.5, rx: 6.2, ry: 3.8 })),
    // The wet highlight, and a second smaller one: the gloss that makes it read as jelly, from near and far.
    shine: s("g", {}, s("ellipse", { cx: -21, cy: -70, rx: 12, ry: 5.2, fill: "#fff", opacity: 0.72, transform: "rotate(-28,-21,-70)" }), s("ellipse", { cx: -34, cy: -52, rx: 3.4, ry: 2.4, fill: "#fff", opacity: 0.55 })),
    // Hardened: a gem of flat faces over the dome, with sharp glints (shown by frame).
    gemBody: s("path", { d: GEM.outline, "stroke-width": 2.4, "stroke-linejoin": "round" }),
    gemLines: s("path", { d: GEM.facets, fill: "none", stroke: "#fff", "stroke-width": 1.6, opacity: 0.55 }),
    gemGlint: s("path", { d: "M-24,-66 l6,-10 l4,10 l-5,4 z M20,-40 l4,-6 l3,6 l-3,3 z", fill: "#fff", opacity: 0.9 }),
  };
  a.gem = s("g", { display: "none", class: "slime-gem" }, a.gemBody, a.gemLines, a.gemGlint);
  tint(a, colour, connected);
  return a;
}

function tint(a, colour, connected) {
  const c = connected ? colour : GREY;
  // A shade lighter than the colour itself, darker toward the floor, with a darker rim.
  set(a.hi, { "stop-color": shade(c, 0.42) });
  set(a.mid, { "stop-color": shade(c, 0.14) });
  set(a.lo, { "stop-color": shade(c, -0.12) });
  set(a.body, { stroke: shade(c, -0.45), opacity: connected ? null : 0.85 });
  set(a.drips, { fill: shade(c, 0.05), stroke: shade(c, -0.45), "stroke-width": 1.6 });
  // The gem is the colour made glassy and bright.
  if (a.gemBody) set(a.gemBody, { fill: shade(c, 0.32), stroke: shade(c, 0.7) });
}

function face() {
  const eye = (cx) => s("ellipse", { cx, cy: SLIME.eyeY, rx: 6.2, ry: 9.4, fill: INK });
  const glint = (cx) => s("circle", { cx: cx + 1.8, cy: SLIME.eyeY - 4, r: 2.2, fill: "#fff" });
  // Wide eyes for a fright: whites round the eyes (shown by `scared`).
  const white = (cx) => s("ellipse", { cx, cy: SLIME.eyeY, rx: 8.6, ry: 11.8, fill: "#fff", stroke: INK, "stroke-width": 1.6 });
  const whites = s("g", { display: "none", class: "slime-wide" }, white(-SLIME.eyeX), white(SLIME.eyeX));
  const open = s("g", {}, whites, eye(-SLIME.eyeX), eye(SLIME.eyeX), glint(-SLIME.eyeX), glint(SLIME.eyeX));
  // Knocked over: its eyes squeezed shut, a wince (> <), as in the 3D look (the owner's pick: "oof", never hurt).
  const wince = (cx, point) => `M${cx - point * 5.5},${SLIME.eyeY - 6.5} L${cx + point * 4},${SLIME.eyeY} L${cx - point * 5.5},${SLIME.eyeY + 6.5}`;
  const dizzy = s("path", { d: `${wince(-SLIME.eyeX, 1)} ${wince(SLIME.eyeX, -1)}`, stroke: INK, "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none", display: "none", class: "slime-dizzy" });
  return { g: s("g", {}, open, dizzy), open, dizzy, whites };
}

/** One step of a damped spring: returns [value, velocity]. */
function spring(value, velocity, target, stiffness, damping, dt) {
  velocity += ((target - value) * stiffness - velocity * damping) * dt;
  return [value + velocity * dt, velocity];
}

const blinkAt = (now, seed) => {
  const t = (now + seed * 977) % 3700;
  return t < 140 ? Math.sin((t / 140) * Math.PI) : 0;
};

export const slime = {
  id: "slime",
  emotes,
  flat: {
    tall: -BELOW_PAWN,
    rest: 0,
    shadow: { rx: 58, ry: 9 },
    /** It has no feet to hop on: it squashes and stretches instead (frame). */
    glides: true,
    figure: {
      limbs: "goo",
      // The emote's face is drawn for a pawn's head: on a slime it sits much lower, larger, and slides toward the piece it is turned to.
      face: { dy: SLIME.eyeY + 113, turn: 12, scale: 1.55 },
      /** Knocked over mid-emote, its own squeezed-shut eyes stay and the emote's face is not drawn (as in the 3D look). */
      ownKnockedFace: true,
      tint(parent) {
        parent.append(s("path", { d: SLIME_DOME }));
      },
    },
    make() {
      const a = { ...shapes("#888888"), face: face(), colour: "#888888", sq: 1, sqV: 0, lean: 0, leanV: 0, phase: 0, walked: false, puff: 0, scaredK: 0, hardK: 0, softK: 0 };
      // The jelly in a group of its own, so its squash is about its foot and an emote's lean (on `inner`) is laid over it.
      a.squish = s("g", {}, a.grad, a.drips, a.body, a.shine, a.gem, a.face.g);
      a.inner = s("g", {}, a.squish);
      return a;
    },
    dress(a, colour, connected) {
      tint(a, colour, connected);
      a.colour = colour;
    },
    /** Every frame: the squash and stretch of its creep, the lag of its top, the jiggle when it stops. It never leaves the floor by itself. */
    frame(a, { now, dt, face: dir, seat, calm, grounded, walking, goo = null }) {
      const step = Math.min(dt, 1 / 30);
      const moving = !!walking && !grounded;
      if (moving) a.phase += step * 10.5;
      // Setting off, the top is left behind; stopping, it runs on past and wobbles back.
      if (a.walked && !moving && !calm) a.sqV += 1.6;
      a.walked = moving;
      // Hard (lobby/shared/slime.js): a gem, stiff and still. Soft: low, wide and wobbling.
      const hard = goo?.hard ?? 0;
      const soft = goo?.soft ?? 0;
      if (hard > 0.5 && a.hardK <= 0.5) a.sqV -= calm ? 0 : 2.2;
      if (soft > 0.5 && a.softK <= 0.5) a.sqV -= calm ? 0 : 3;
      a.hardK = hard;
      a.softK = soft;
      const creep = moving && !calm && hard < 0.5 ? 0.085 * Math.sin(a.phase) : 0;
      const breath = calm || hard > 0.5 ? 0 : 0.018 * Math.sin(now / 650 + seat * 1.7);
      const wobble = calm ? 0 : soft * 0.06 * Math.sin(now / 85);
      [a.sq, a.sqV] = spring(a.sq, a.sqV, grounded ? 0.66 : 1 + creep - 0.24 * soft + wobble + 0.03 * hard, hard > 0.5 ? 600 : 260, calm ? 30 : hard > 0.5 ? 26 : 7.5, step);
      // Its top drags a little behind while it moves (a positive skew leans the top to the left).
      [a.lean, a.leanV] = spring(a.lean, a.leanV, moving && hard < 0.5 ? dir * 7 : 0, 120, calm ? 30 : 6, step);
      const tall = Math.max(0.55, a.sq + breath);
      const wide = 1 / Math.sqrt(tall);
      set(a.squish, { transform: `skewX(${a.lean.toFixed(2)}) scale(${wide.toFixed(3)},${tall.toFixed(3)})` });
      const gem = hard > 0.02;
      if (gem !== !!a.gemShown || (gem && Math.abs(hard - (a.gemK ?? 0)) > 0.04)) {
        a.gemShown = gem;
        a.gemK = hard;
        set(a.gem, { display: gem ? null : "none", opacity: hard.toFixed(2) });
        set(a.shine, { opacity: (1 - hard).toFixed(2) });
      }
      // Soft, it runs at the foot: its drips spread and swell.
      const drip = 1 + 0.15 * soft;
      if (Math.abs(drip - (a.dripK ?? 1)) > 0.004) {
        a.dripK = drip;
        set(a.drips, { transform: `scale(${drip.toFixed(3)},${(1 + 1.6 * soft).toFixed(2)})` });
      }
      if (!a.dizzy) {
        // Wide while a ghost has frightened it (no blink then), about the middle of its eyes.
        const wide = 1 + 0.3 * a.scaredK;
        const shut = calm || a.scaredK > 0 ? 0 : blinkAt(now, seat);
        const sy = (1 - 0.9 * shut) * wide;
        set(a.face.open, { transform: `translate(${dir * 4},${(SLIME.eyeY * (1 - sy)).toFixed(1)}) scale(${wide.toFixed(2)},${sy.toFixed(2)})` });
      }
      return 0;
    },
    /** Frightened by a ghost (0 to 1): its eyes go wide, with whites round them. */
    scared(a, k) {
      a.scaredK = k;
      set(a.face.whites, { display: k > 0.3 ? null : "none" });
    },
    dizzy(a, on) {
      a.dizzy = on;
      set(a.face.open, { display: on ? "none" : null });
      set(a.face.dizzy, { display: on ? null : "none" });
    },
    blink(a, opacity) {
      set(a.body, { opacity });
    },
    /** An emote's pose laid over the body, or null when it ends: the emote drawing brings its own face, and goo arms. */
    emote(a, pose, bodyTransform) {
      if (!pose) {
        set(a.inner, { transform: null });
        set(a.face.g, { display: null });
        return;
      }
      // Fuming swells it, about its middle.
      const puff = 1 + pose.ghost.puff;
      set(a.inner, { transform: `${bodyTransform(pose.body)} translate(0,-30) scale(${puff.toFixed(3)}) translate(0,30)` });
      // Knocked over, it keeps its squeezed-shut eyes (figure.ownKnockedFace: the emote draws no face then).
      set(a.face.g, { display: a.dizzy ? null : "none" });
    },
    still(colour) {
      const p = shapes(colour);
      return s("g", {}, p.grad, p.drips, p.body, p.shine);
    },
    portrait(colour) {
      const g = this.still(colour);
      g.append(face().g);
      return g;
    },
  },
};
