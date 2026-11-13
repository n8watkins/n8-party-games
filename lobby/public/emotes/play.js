// Who is doing which emote, and how far into it: the same for both looks.
//
// A room view hears an emote (onExpress) and asks, every frame, what each piece is doing
// (pose). A player's new emote replaces their own previous one at once; other players' emotes
// carry on. An aimed emote turns toward the nearest piece when it starts and keeps that side to
// the end, following the piece if it walks; with nobody near, it is done toward the way the
// piece faces, at the distance of the preview's stage.
import { EASE, REACH, clamp, mirrorPose, rigById } from "./rig.js";

/** How near a piece must be, in room units, to be an emote's target. */
const NEAR = 520;
/** The closest and furthest an aimed emote reaches: no nearer than the target's edge, no further than it can throw. */
const MIN_REACH = 90;
const MAX_REACH = 420;

export class Expressions {
  constructor() {
    /** seat -> {rig, at, target, side} */
    this.now = new Map();
  }

  /**
   * Starts `id` on `seat`. `pieces` is where everyone is: [{seat, x, face}].
   * Returns false for an emote this page does not know.
   */
  start(seat, id, at, pieces) {
    const rig = rigById(id);
    if (!rig) return false;
    const me = pieces.find((p) => p.seat === seat);
    let target = null;
    let best = NEAR;
    if (me && rig.aimed) {
      for (const p of pieces) {
        const d = Math.abs(p.x - me.x);
        if (p.seat !== seat && d < best) {
          best = d;
          target = p.seat;
        }
      }
    }
    const other = target === null ? null : pieces.find((p) => p.seat === target);
    const side = other ? Math.sign(other.x - me.x) || 1 : Math.sign(me?.face ?? 1) || 1;
    this.now.set(seat, { rig, at, target, side });
    return true;
  }

  /** Forgets a piece's emote (it left, or the room was rebuilt). */
  stop(seat) {
    this.now.delete(seat);
  }

  /** Whether any piece is doing an emote. */
  get busy() {
    return this.now.size > 0;
  }

  /**
   * What `seat` is doing at `at`, or null: the pose (turned toward its target), the target's
   * offset in room units (null: nobody), the word for the sticker and how far it has popped in
   * (null: no sticker now). `xOf(seat)` is where a piece is now (undefined: gone).
   */
  pose(seat, at, xOf, calm) {
    const e = this.now.get(seat);
    if (!e) return null;
    const t = at - e.at;
    if (t >= e.rig.dur || t < 0) {
      if (t >= e.rig.dur) this.now.delete(seat);
      return null;
    }
    const x = xOf(seat);
    const tx = e.target === null ? undefined : xOf(e.target);
    let reach = REACH;
    let toward = null;
    if (x !== undefined && tx !== undefined) {
      // Kept on the side it started on, even if the target walks round.
      reach = clamp((tx - x) * e.side, MIN_REACH, MAX_REACH);
      toward = reach * e.side;
    }
    const raw = e.rig.pose(t, calm, reach);
    const pose = e.side < 0 ? mirrorPose(raw) : raw;
    const sticker = t > 250 && t < e.rig.dur - 250;
    const pop = calm ? 1 : EASE.b(clamp((t - 250) / 160, 0, 1));
    return { rig: e.rig, t, pose, toward, word: sticker ? e.rig.word : null, pop };
  }
}

/** How high a pose reaches above the foot (room units, negative up): for the sticker, so it clears raised hands and props. */
export function poseTop(pose) {
  const tops = pose.hands.filter((h) => h.s > 0.3).map((h) => h.y - 30);
  const props = pose.props.filter((x) => x.space !== "stage" && typeof x.y === "number").map((x) => x.y - 40);
  return Math.min(-150, ...tops, ...props) - Math.max(0, pose.body.lift);
}
