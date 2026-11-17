// The emotes of a character with no pawn's shoulders, as data: the ghost's emotes (./ghost-rig.js)
// fitted to another body. Nothing here draws.
//
// The ghost's emotes were made for a body without a neck or shoulders, whose face is low and whose
// hands are joined on at its sides; the slime and the robot are bodies of that kind too. Rather
// than a third and fourth copy of fourteen emotes, each is the ghost's, moved onto the other body
// by its landmarks (BodyMeasures below): its floor, its mouth, the top of its head, how wide it is
// and where an arm leaves it. Every number in body space is carried across:
//   - heights piecewise between floor, mouth and top, so a hand at the ghost's mouth is at the
//     slime's mouth, and one over its head is as far over the other's;
//   - widths scaled inside the body and shifted outside it, so a hand held out beside the ghost
//     is held out as far beside a wider body;
//   - an arm is worked out again from the new body's own shoulder (`root`) to the wrist;
//   - things on the floor (a splat, confetti landing, a thrown tomato near its target) stay where
//     they are: the target has not moved.
// The ids, words, durations and moments are the ghost's, so the pawn's, and every recording fits.
//
// Each body says how its hands are joined on (`join`, by the ghost's take):
//   "goo"   (the slime) its own goo reaches out to the hand, a tapering arm in its colour
//   "rod"   (the robot) a jointed arm of dark metal from its shoulder, ending in a steel hand
//   "none"  no hands: the body does it alone (Fuming, for every character)
// For a joined arm the ghost's "wisp" variant of a pose is used (a hip hand on Red card and the
// tomato), because a hand that has an arm reads where a floating one would not.
//
// pose.ghost carries the same fields for these bodies as for the ghost ({limb, yaw, puff, nubs}):
// the drawings read it whatever the character (emotes/svg.js, look3d/*.js). `nubs` is how much of
// the body's own resting arms show (the robot's arms at its sides; the slime has none).
import { EASE, clamp, mirrorPose } from "../emotes/rig.js";
import { GHOST, GHOST_RIG } from "./ghost-rig.js";

/**
 * The ghost's landmarks, in rig units (y up is negative, 0 where its hem would touch the floor):
 * the bottom of its scallops, its mouth, the top of its head, half its width, where its arms
 * start, and how high it hangs.
 */
export const GHOST_MEASURES = { floor: -24, mouth: GHOST.mouthY, top: GHOST.top, half: GHOST.half, root: GHOST.root, hover: GHOST.hover, hand: GHOST.hand };

/** How far outside the body a width is still shifted with it (rig units): beyond, the floor and the target are where they were. */
const NEAR = 80;

/** How far either side of the mouth heights are carried one for one (rig units, at most): a finger on the lips, a hand at the chin, keep their place against the face whatever the body's height. */
const FACE_BAND = 30;

/** Carries y from the span [a0, a1] on one body to [b0, b1] on the other. */
const span = (y, a0, a1, b0, b1) => b0 + ((y - a0) * (b1 - b0)) / (a1 - a0);

/** A height on the ghost's body, on the other body. */
function mapY(y, S, T) {
  if (y >= S.floor) return T.floor + (y - S.floor);
  if (y <= S.top) return T.top + (y - S.top);
  // One for one in a band about the mouth (as wide as both bodies allow), stretched between it and the floor or the top.
  const below = Math.min(FACE_BAND, 0.6 * (S.floor - S.mouth), 0.6 * (T.floor - T.mouth));
  const above = Math.min(FACE_BAND, 0.6 * (S.mouth - S.top), 0.6 * (T.mouth - T.top));
  if (y >= S.mouth + below) return span(y, S.mouth + below, S.floor, T.mouth + below, T.floor);
  if (y >= S.mouth - above) return T.mouth + (y - S.mouth);
  return span(y, S.top, S.mouth - above, T.top, T.mouth - above);
}

/** A width on the ghost's body, on the other body: scaled inside it, shifted outside it, and left alone well clear of it. */
function mapX(x, S, T) {
  const a = Math.abs(x);
  if (a <= S.half) return (x * T.half) / S.half;
  const shift = (T.half - S.half) * clamp(1 - (a - S.half) / NEAR, 0, 1);
  return Math.sign(x) * (a + shift);
}

/** How high above the floor a thing in stage space is fully carried with the body (rig units): below, it eases back to where it was, so the floor stays the floor. */
const GROUND = 40;

/**
 * A height in stage space (on the floor under the body, 0 the floor), on the other body: what is
 * at the body's height is carried as body space is, what is on the floor stays there, and the two
 * meet smoothly in between (a kernel falls from the new mouth to the same floor).
 */
function mapStageY(y, S, T) {
  if (y >= 0) return y;
  const carried = mapY(y + S.hover, S, T) - T.hover;
  const w = clamp(-y / GROUND, 0, 1);
  return y + (carried - y) * w;
}

/** The arm to a wrist on the other body: from its own root, with one soft bend away from it (as ghost-rig.js armTo). */
function armTo(T, side, wrist) {
  const sh = { x: side * T.root.x, y: T.root.y };
  const dx = wrist.x - sh.x;
  const dy = wrist.y - sh.y;
  const d = Math.hypot(dx, dy);
  const n = d > 0.01 ? { x: -dy / d, y: dx / d } : { x: side, y: 0 };
  const sign = n.x * side + n.y * 0.3 >= 0 ? 1 : -1;
  const sag = 4 + d * (T.sag ?? 0.16);
  return { shoulder: sh, elbow: { x: sh.x + dx / 2 + n.x * sag * sign, y: sh.y + dy / 2 + n.y * sag * sign }, wrist: { x: wrist.x, y: wrist.y } };
}

/** One of the ghost's poses, carried onto body T, with hands joined on as `join`. */
export function carryPose(p, S, T, join) {
  const body = (o) => {
    if (typeof o.x === "number") o.x = mapX(o.x, S, T);
    if (typeof o.y === "number") o.y = mapY(o.y, S, T);
    return o;
  };
  const stage = (o) => {
    if (typeof o.x === "number" && Math.abs(o.x) < S.half + NEAR) o.x = mapX(o.x, S, T);
    if (typeof o.y === "number") o.y = mapStageY(o.y, S, T);
    return o;
  };
  const hands = p.hands.map((h) => {
    const x = mapX(h.x, S, T);
    const y = mapY(h.y, S, T);
    return { ...h, x, y, s: (h.s * T.hand) / S.hand, arm: armTo(T, h.side, { x, y }) };
  });
  const props = p.props.map((x) => {
    if (x.kind === "confetti") return { ...x, bits: x.bits.map((b) => stage({ ...b })) };
    return x.space === "stage" ? stage({ ...x }) : body({ ...x });
  });
  const fx = p.fx.map((f) => body({ ...f }));
  const limb = p.ghost.limb === "none" ? "none" : join;
  return {
    ...p,
    body: { ...p.body, lift: p.body.lift * T.lift },
    hands: limb === "none" ? [] : hands,
    props,
    fx,
    ghost: { ...p.ghost, limb, puff: p.ghost.puff * T.puff },
  };
}

/**
 * A body's measures, in rig units (the pawn's: its head's middle 113 up, a model unit 113 / 0.9
 * of them), with what this file needs and what the drawings read:
 *   floor, mouth, top, half   the landmarks (see the top of this file)
 *   root {x, y}               where an arm leaves the body (its shoulder)
 *   hover                     how high it hangs at rest (0: it stands)
 *   hand                      its hands' size against a pawn's
 *   lift, puff                how much of the ghost's bounce and swell it takes (1: all)
 *   sag                       how much its arm bends (the ghost's: 0.16)
 * @typedef {{floor: number, mouth: number, top: number, half: number, root: {x: number, y: number}, hover: number, hand: number, lift: number, puff: number, sag?: number}} BodyMeasures
 */

/**
 * The fourteen emotes for body T: {id, name, word, dur, hold, aimed, take, pose(t, calm, reach)},
 * with `take` the way its hands are joined ("none" or `join`), and the definition's `emotes`
 * ({byId, mirror, top}) for ./index.js.
 */
export function bodyRig(T, join) {
  const S = GHOST_MEASURES;
  const rig = GHOST_RIG.map((src) => {
    const take = src.take === "none" ? "none" : join;
    // The joined variant of the ghost's pose: on Red card and the tomato a hand on the hip, which an arm makes read.
    const joined = { ...src, take: "wisp" };
    return {
      id: src.id,
      name: src.name,
      word: src.word,
      dur: src.dur,
      hold: src.hold,
      aimed: src.aimed,
      take,
      pose(t, calm, reach) {
        return carryPose(src.pose.call(joined, t, calm, reach), S, T, join);
      },
    };
  });
  const byId = new Map(rig.map((e) => [e.id, e]));
  /** How high a pose reaches above the floor line (negative up): for the sticker. */
  const top = (pose) => {
    const tops = pose.hands.filter((h) => h.s > 0.3).map((h) => h.y - 30);
    const props = pose.props.filter((x) => x.space !== "stage" && typeof x.y === "number").map((x) => x.y - (x.kind === "lighter" ? 64 : 40));
    return Math.min(T.top - 14, ...tops, ...props) - T.hover - Math.max(0, pose.body.lift);
  };
  const mirror = (p) => ({ ...mirrorPose(p), ghost: { ...p.ghost, yaw: -p.ghost.yaw } });
  return { rig, emotes: { byId: (id) => byId.get(id), mirror, top } };
}

/** How much of the resting arms a pose leaves showing (0 to 1), eased: for a body whose own arms give way to an emote's. */
export const restingArms = (pose) => (pose ? EASE.s(clamp(pose.ghost?.nubs ?? 1, 0, 1)) : 1);
