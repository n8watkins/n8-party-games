// The ghost's hands in 3D, for a pose from ghost-rig.js.
//
// The hands themselves are the room's own: the mitten and the small cartoon hand of
// lobby/public/look3d/emote-arms.js, used as they are (the same pose numbers shape them). What
// differs is what joins a hand to the body, by the pose's take (pose.ghost.limb):
//   "float"  nothing: the pawn's stick arm is not drawn, the hand hangs in the air
//   "wisp"   a tapering tube of the sheet from the ghost's side to the wrist, white where it
//            leaves the body and dipped in the player's colour toward the hand, as the hem is
//   "haunt" / "none"  no hands at all
// The hands are in the player's colour, as a pawn's are, so they show against the white sheet behind them.
import * as T from "three";
import { EmoteArms } from "../../../lobby/public/look3d/emote-arms.js";
import { RIG_UNIT, toyMat } from "./bodies.js";

/** How far in front of the pawn's hands the ghost's sit (model units): the ghost is wider than a pawn's shoulders. */
const FRONT = 0.06;
/** Where a wisp leaves the body and where it meets the hand, in front of the body's axis (model units). */
const ROOT_Z = 0.1;
const WRIST_Z = 0.24 + FRONT;
/** Half the width of a wisp at the body and at the wrist, in rig units. */
const ROOT_R = 10;
const WRIST_R = 4.6;
const RINGS = 14;
const SIDES = 8;

const FUMING = new T.Color("#ff2a14");
const WHITE = new T.Color(0xffffff);
const tmp = new T.Color();

function wispGeometry() {
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
  geo.setAttribute("color", new T.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
  const index = [];
  for (let i = 0; i < RINGS - 1; i++)
    for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j;
      const b = i * SIDES + ((j + 1) % SIDES);
      index.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
    }
  geo.setIndex(index);
  return geo;
}

export class GhostLimbs {
  /** @param {object} ghost  bodies.js makeGhost() */
  constructor(ghost) {
    this.ghost = ghost;
    this.arms = new EmoteArms(ghost, "#ffffff");
    this.arms.group.position.z = FRONT;
    this.wispMat = toyMat({ vertexColors: true, roughness: 0.42, clearcoat: 0.45, side: T.DoubleSide });
    this.wisps = [0, 1].map(() => {
      const mesh = new T.Mesh(wispGeometry(), this.wispMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      ghost.tilt.add(mesh);
      return mesh;
    });
    for (const l of this.arms.limbs) for (const m of [l.mitten, l.pointer, l.palm, l.thumb, ...l.fingers]) m.renderOrder = 9;
  }

  /** Shows the hands of a pose (null: none), in the ghost's colours and as see-through as it is now. */
  set(pose, now) {
    const g = this.ghost;
    const limb = pose ? pose.ghost.limb : "none";
    const hands = pose && (limb === "float" || limb === "wisp") ? pose.hands : [];
    this.arms.set({ hands });
    // The pawn's stick arm is never drawn on a ghost.
    for (const l of this.arms.limbs) l.upper.visible = l.lower.visible = l.elbow.visible = false;
    const clear = g.opacity < 0.985;
    const red = g.redK;
    const k = 0.7 + 0.3 * g.lit;
    const hand = this.arms.handMat;
    hand.color.copy(g.pal.base).lerp(WHITE, 0.1).multiplyScalar(k).lerp(FUMING, red * 0.8);
    hand.emissive.copy(g.pal.base);
    hand.emissiveIntensity = 0.3 + 0.9 * g.fadeK;
    for (const mat of [hand, this.wispMat]) {
      if (mat.transparent !== clear) {
        mat.transparent = clear;
        mat.needsUpdate = true;
      }
      mat.opacity = Math.min(1, g.opacity + 0.15);
    }
    this.wispMat.color.setScalar(k);
    this.wispMat.emissive.copy(g.glow);
    this.wispMat.emissiveIntensity = 0.07 + 0.16 * g.lit + 1.1 * g.fadeK;
    this.wispMat.userData.rim.value = 0.12 + 0.9 * g.fadeK;
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const on = limb === "wisp" && !!h && h.s > 0.05;
      this.wisps[i].visible = on;
      if (on) this.wisp(this.wisps[i], h, now, i);
    }
  }

  /** One wisp: a bent tube from the side of the sheet to the wrist, thinner and more of the player's colour toward the hand. */
  wisp(mesh, h, now, seed) {
    const g = this.ghost;
    const a = h.arm;
    const grow = Math.min(1, h.s);
    const pos = mesh.geometry.attributes.position;
    const col = mesh.geometry.attributes.color;
    const p0x = a.shoulder.x;
    const p0y = a.shoulder.y;
    for (let i = 0; i < RINGS; i++) {
      const u = (i / (RINGS - 1)) * grow;
      const v = 1 - u;
      // A curve through the bend (the elbow is where the curve is pulled to, not a joint).
      const cx = v * v * p0x + 2 * v * u * a.elbow.x + u * u * a.wrist.x;
      const cy = v * v * p0y + 2 * v * u * a.elbow.y + u * u * a.wrist.y;
      let tx = 2 * v * (a.elbow.x - p0x) + 2 * u * (a.wrist.x - a.elbow.x);
      let ty = 2 * v * (a.elbow.y - p0y) + 2 * u * (a.wrist.y - a.elbow.y);
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // It wavers a little along its length, most in the middle: a wisp, not a rod.
      const waver = Math.sin(now / 210 + i * 0.8 + seed * 2) * 1.3 * Math.sin(u * Math.PI);
      const r = (ROOT_R + (WRIST_R - ROOT_R) * Math.pow(u, 0.7)) * (0.35 + 0.65 * grow);
      const z = ROOT_Z + (WRIST_Z - ROOT_Z) * u;
      tmp.copy(WHITE).lerp(g.pal.hem, Math.pow(u, 1.4)).lerp(g.pal.base, Math.pow(u, 4) * 0.7);
      for (let j = 0; j < SIDES; j++) {
        const ang = (j / SIDES) * Math.PI * 2;
        const n = Math.cos(ang) * r;
        const d = Math.sin(ang) * r * 0.75;
        const k = i * SIDES + j;
        pos.setXYZ(k, (cx - ty * (n + waver)) * RIG_UNIT, -(cy + tx * (n + waver)) * RIG_UNIT, z + d * RIG_UNIT);
        col.setXYZ(k, tmp.r, tmp.g, tmp.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
}
