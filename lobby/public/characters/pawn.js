// The pawn, as the page knows it without the 3D look: its flat drawing and its emotes.
// One of the characters (./index.js lists them; lobby/README.md, "Characters", is the interface).
import { s, set, shade } from "../dom.js";
import { mirrorPose, rigById } from "../emotes/rig.js";

const GREY = "#9b948b";
/** The pawn's body, for the red of fuming and for pictures of it. */
export const PAWN_TORSO = "M-32,-10 C-31,-36 -15,-54 -13.5,-84 L13.5,-84 C15,-54 31,-36 32,-10 Z";

/** How high a pose reaches above the foot (room units, negative up): for the sticker, so it clears raised hands and props. */
function poseTop(pose) {
  const tops = pose.hands.filter((h) => h.s > 0.3).map((h) => h.y - 30);
  const props = pose.props.filter((x) => x.space !== "stage" && typeof x.y === "number").map((x) => x.y - 40);
  return Math.min(-150, ...tops, ...props) - Math.max(0, pose.body.lift);
}

/** The pawn's shapes in one colour: what the room draws, and what a picture of it (the wheel, the picker) draws. */
function shapes(colour, connected = true) {
  const main = connected ? shade(colour, 0.16) : GREY;
  return {
    base: s("ellipse", { cx: 0, cy: -8, rx: 39, ry: 11.5, fill: connected ? shade(colour, -0.28) : "#6f6a63" }),
    body: s("path", { d: PAWN_TORSO, fill: main }),
    collar: s("ellipse", { cx: 0, cy: -84, rx: 22, ry: 8, fill: connected ? shade(colour, 0.3) : "#b5afa6" }),
    head: s("circle", { cx: 0, cy: -113, r: 28, fill: main }),
    shine: s("ellipse", { cx: -10, cy: -125, rx: 9, ry: 6, fill: "#fff", opacity: 0.26 }),
  };
}

const eyes = () => s("g", {}, s("ellipse", { cx: -9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }), s("ellipse", { cx: 9, cy: -113, rx: 3.8, ry: 5.6, fill: "#1a1210" }), s("circle", { cx: -8, cy: -115.5, r: 1.3, fill: "#fff" }), s("circle", { cx: 10, cy: -115.5, r: 1.3, fill: "#fff" }));

export const pawn = {
  id: "pawn",
  emotes: { byId: rigById, mirror: mirrorPose, top: poseTop },
  flat: {
    /** How far the top of its head is above a standing pawn's (room units): the pawn is the measure. */
    tall: 0,
    /** How far off the floor it holds itself at rest, for a picture of it. */
    rest: 0,
    shadow: { rx: 40, ry: 9 },
    /** What the emote drawing needs to know about this body (emotes/svg.js). */
    figure: {
      limbs: "stick",
      face: null,
      tint(parent) {
        parent.append(s("path", { d: PAWN_TORSO }), s("circle", { cx: 0, cy: -113, r: 28 }));
      },
    },
    make() {
      const a = { ...shapes("#888888"), eyes: eyes(), crosses: null, colour: "#888888" };
      // The pawn itself, in a group of its own that an emote can lean and lift (emotes/svg.js draws over it).
      a.inner = s("g", {}, a.base, a.body, a.collar, a.head, a.shine, a.eyes);
      return a;
    },
    dress(a, colour, connected) {
      const fresh = shapes(colour, connected);
      for (const part of ["base", "body", "collar", "head"]) set(a[part], { fill: fresh[part].getAttribute("fill") });
      a.colour = colour;
    },
    /** Every frame. Returns how far off the floor it holds itself (the pawn stands: nothing). */
    frame(a, { face }) {
      const k = a.scaredK ?? 0;
      // Wide with a fright (scared): the eyes grow, and small pupils sit in whites.
      set(a.eyes, { transform: k > 0 ? `translate(${face * 5}, 0) translate(0,-113) scale(${(1 + 0.3 * k).toFixed(3)}) translate(0,113)` : `translate(${face * 5}, 0)` });
      return 0;
    },
    /** Frightened by a ghost (0 to 1): its eyes go wide, with whites round them. */
    scared(a, k) {
      a.scaredK = k;
      if (!a.whites && k > 0) {
        const white = (cx) => s("ellipse", { cx, cy: -113, rx: 5.8, ry: 7.6, fill: "#fff", stroke: "#1a1210", "stroke-width": 1.4 });
        a.whites = s("g", { class: "pawn-wide" }, white(-9), white(9));
        a.eyes.prepend(a.whites);
      }
      if (a.whites) set(a.whites, { display: k > 0.3 ? null : "none" });
    },
    /**
     * Eyes squeezed shut, a wince (> <), for a piece that has just been knocked over: it reads as
     * "oof", never as hurt (the owner's pick, character preview round three; crosses read as dead).
     */
    dizzy(a, on) {
      if (!a.crosses) {
        // `point`: which way the chevron's tip faces (the two tips face each other).
        const wince = (cx, point) => s("path", { d: `M${cx - point * 4.5},-118.5 L${cx + point * 3.5},-113 L${cx - point * 4.5},-107.5`, stroke: "#1a1210", "stroke-width": 3.2, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" });
        a.crosses = s("g", { display: "none", class: "pawn-shut" }, wince(-9, 1), wince(9, -1));
        a.inner.append(a.crosses);
      }
      set(a.crosses, { display: on ? null : "none" });
      a.dizzy = on;
      set(a.eyes, { display: on || a.emoting ? "none" : null });
    },
    /** A blink of the whole body while it cannot be knocked again (opacity), or null: solid. */
    blink(a, opacity) {
      set(a.body, { opacity });
      set(a.head, { opacity });
    },
    /** An emote's pose laid over the body, or null when it ends: the emote drawing brings its own face. */
    emote(a, pose, bodyTransform) {
      a.emoting = !!pose;
      set(a.inner, { transform: pose ? bodyTransform(pose.body) : null });
      set(a.eyes, { display: pose || a.dizzy ? "none" : null });
    },
    /** A still of it for a small picture, standing at (0, 0): the body only, the caller adds the emote. */
    still(colour) {
      const p = shapes(colour);
      return s("g", {}, p.base, p.body, p.collar, p.head, p.shine);
    },
    /** The same with its own face: for the picker. */
    portrait(colour) {
      const g = this.still(colour);
      g.append(eyes());
      return g;
    },
  },
};
