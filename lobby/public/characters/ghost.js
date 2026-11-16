// The ghost, as the page knows it without the 3D look: its flat drawing and its emotes.
// One of the characters (./index.js lists them; lobby/README.md, "Characters", is the interface).
//
// A white sheet with a hem dipped in the player's colour, five lobes along the hem, two nub
// arms, two eyes and a mouth. It never stands: it hangs a little above the floor and bobs. The
// 3D look draws the same ghost as a model (../look3d/ghost.js), from the same measurements
// (GHOST in ./ghost-rig.js).
import { s, set, shade } from "../dom.js";
import { GHOST, ghostPoseTop, ghostRigById, mirrorGhostPose } from "./ghost-rig.js";

const INK = "#1a1210";
const GREY = "#8a8d94";
const SHEET = "#fbf8f1";
/** The sheet: straight sides, a round top, five lobes along the hem. */
const LOBE = (GHOST.half * 2) / 5;
export const GHOST_SHEET = `M${-GHOST.half},-30 L${-GHOST.half},-87 A${GHOST.half},${GHOST.half} 0 0 1 ${GHOST.half},-87 L${GHOST.half},-30 ${`q${-LOBE / 2},13 ${-LOBE},0 `.repeat(5)}Z`;
/** How far the top of its head is below a standing pawn's (room units), before it hovers. */
const BELOW_PAWN = 141 + GHOST.top;
/** How long one bob takes (ms) and how far it goes (room units). */
const BOB_MS = 2300;
const BOB = 5;

let made = 0;

/** The ghost's shapes in one colour: what the room draws, and what a picture of it (the wheel, the picker) draws. */
function shapes(colour, connected = true) {
  // The hem's colour runs up into the white as a gradient, which needs a name of its own in the page.
  const id = `ghost-hem-${++made}`;
  const top = s("stop", { offset: "38%" });
  const hem = s("stop", { offset: "100%" });
  const grad = s("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, s("stop", { offset: "0%", "stop-color": SHEET }), top, hem);
  const a = {
    grad,
    top,
    hem,
    nubs: s("g", {}, s("ellipse", { cx: -GHOST.half - 4, cy: GHOST.root.y, rx: 9.5, ry: 6.2 }), s("ellipse", { cx: GHOST.half + 4, cy: GHOST.root.y, rx: 9.5, ry: 6.2 })),
    body: s("path", { d: GHOST_SHEET, fill: `url(#${id})`, stroke: "#00000022", "stroke-width": 1 }),
    shine: s("ellipse", { cx: -12, cy: -104, rx: 10, ry: 6.5, fill: "#fff", opacity: 0.5 }),
  };
  tint(a, colour, connected);
  return a;
}

function tint(a, colour, connected) {
  set(a.top, { "stop-color": connected ? SHEET : "#cfcbc4" });
  set(a.hem, { "stop-color": connected ? shade(colour, 0.12) : GREY });
  set(a.nubs, { fill: connected ? SHEET : "#cfcbc4" });
}

function face() {
  const eye = (cx) => s("ellipse", { cx, cy: GHOST.eyeY, rx: 4.6, ry: 7, fill: INK });
  const glint = (cx) => s("circle", { cx: cx + 1.2, cy: GHOST.eyeY - 3, r: 1.5, fill: "#fff" });
  const open = s("g", {}, eye(-10), eye(10), glint(-10), glint(10));
  // Squeezed shut: what a knocked ghost's eyes do (it never gets crosses).
  const shut = s("path", { d: `M-15,${GHOST.eyeY - 2} l5.5,3.5 l-5.5,3.5 M15,${GHOST.eyeY - 2} l-5.5,3.5 l5.5,3.5`, stroke: INK, "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none", display: "none" });
  const mouth = s("ellipse", { cx: 0, cy: GHOST.mouthY, rx: 4, ry: 5.2, fill: INK });
  return { g: s("g", {}, open, shut, mouth), open, shut };
}

export const ghost = {
  id: "ghost",
  emotes: { byId: ghostRigById, mirror: mirrorGhostPose, top: ghostPoseTop },
  flat: {
    tall: -BELOW_PAWN,
    /** How far off the floor it holds itself at rest, for a picture of it. */
    rest: GHOST.hover,
    shadow: { rx: 34, ry: 7.5 },
    /** It has no feet: it does not hop from one to the other as it walks. */
    glides: true,
    /** What the emote drawing needs to know about this body (emotes/svg.js). */
    figure: {
      limbs: "ghost",
      // The emote's face is drawn for a pawn's head: on a ghost it sits lower, and slides a little toward the piece it is turned to.
      face: { dy: GHOST.eyeY + 113, turn: 16 },
      tint(parent) {
        parent.append(s("path", { d: GHOST_SHEET }));
      },
    },
    make() {
      const a = { ...shapes("#888888"), face: face(), hover: 1, colour: "#888888" };
      a.inner = s("g", {}, a.grad, a.nubs, a.body, a.shine, a.face.g);
      return a;
    },
    dress(a, colour, connected) {
      tint(a, colour, connected);
      a.colour = colour;
    },
    /**
     * Every frame. Returns how far off the floor it holds itself: it hovers and bobs, and comes
     * down to the floor while it is knocked over (`grounded`).
     */
    frame(a, { now, dt, face: dir, seat, calm, grounded }) {
      a.hover += ((grounded ? 0 : 1) - a.hover) * Math.min(1, dt * 14);
      set(a.face.g, { transform: `translate(${dir * 6}, 0)` });
      const bob = calm ? 0 : Math.sin((now / BOB_MS) * Math.PI * 2 + seat * 1.7) * BOB;
      return (GHOST.hover + bob) * a.hover;
    },
    dizzy(a, on) {
      set(a.face.open, { display: on ? "none" : null });
      set(a.face.shut, { display: on ? null : "none" });
    },
    blink(a, opacity) {
      set(a.body, { opacity });
    },
    /** An emote's pose laid over the body, or null when it ends: the emote drawing brings its own face, and hands in place of the nubs. */
    emote(a, pose, bodyTransform) {
      if (!pose) {
        set(a.inner, { transform: null });
        set(a.face.g, { display: null });
        set(a.nubs, { opacity: null });
        return;
      }
      // Fuming swells the whole sheet, about its middle.
      const puff = 1 + pose.ghost.puff;
      set(a.inner, { transform: `${bodyTransform(pose.body)} translate(0,-70) scale(${puff.toFixed(3)}) translate(0,70)` });
      set(a.face.g, { display: "none" });
      set(a.nubs, { opacity: pose.ghost.nubs.toFixed(2) });
    },
    still(colour) {
      const p = shapes(colour);
      return s("g", {}, p.grad, p.nubs, p.body, p.shine);
    },
    portrait(colour) {
      const g = this.still(colour);
      g.append(face().g);
      return g;
    },
  },
};
