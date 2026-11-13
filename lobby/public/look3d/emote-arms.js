// An emote's arms and hands in the 3D look: the same pose numbers as the flat drawing
// (emotes/rig.js), as a few small meshes on the pawn. Each arm is two thin cylinders from the
// shoulder with a ball at the elbow; each hand is a mitten (a squashed ball with a thumb, and a
// finger when it points) or a small cartoon hand (a palm and four stubby fingers), in the pawn's
// own colour. They hang in the pawn's tilt group, so they lean, hop and squash with it, and stay
// facing the camera as the body turns. The props and effects are drawn in SVG over the picture
// (emotes/svg.js), from the same numbers.
//
// Cheap on purpose: the shapes are shared by every pawn, a pawn's meshes are made the first time
// it does an emote, and nothing is made per frame.
import * as THREE from "./three.js";
import { shade } from "../emotes/svg.js";

/** Model units per room unit: the rig's head centre (113 up) is the pawn's (0.9 up). */
export const RIG_UNIT = 0.9 / 113;
/** How far in front of the body's axis the arms and the hands are (model units): clear of the body as the camera sees it. */
const ARM_Z = 0.21;
const HAND_Z = 0.26;
/** Half the width of a stick arm, in room units (the flat drawing's stroke is 8). */
const ARM_R = 4.4;
/** Hands a little larger than the flat drawing's: lit by the room, a small hand reads darker and smaller than a flat one. */
const HAND_SIZE = 1.25;

let SHAPES = null;
function shapes() {
  return {
    rod: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
    ball: new THREE.SphereGeometry(1, 14, 10),
    stub: new THREE.CapsuleGeometry(0.5, 1, 3, 8),
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const D = new THREE.Vector3();

/** A point of the rig (room units, y down) in the pawn's model space (y up), at depth z. */
function at(p, z, out) {
  return out.set(p.x * RIG_UNIT, -p.y * RIG_UNIT, z);
}

/** Puts a rod between two points. */
function rod(mesh, a, b, r) {
  D.subVectors(b, a);
  const len = D.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, len > 1e-6 ? D.divideScalar(len) : UP);
  mesh.scale.set(r, len, r);
}

/** Index to little finger on the cartoon hand: where each sits and how long it is when straight (emotes/svg.js). */
const STUBS = [
  { x: -5.4, len: 9 },
  { x: -1.8, len: 10 },
  { x: 1.8, len: 9.4 },
  { x: 5.3, len: 7.6 },
];

export class EmoteArms {
  /** @param {object} pawn  look3d/pieces.js makePawn(); `colour` is the seat's colour as "#rrggbb" */
  constructor(pawn, colour) {
    SHAPES ??= shapes();
    this.group = new THREE.Group();
    this.group.visible = false;
    pawn.tilt.add(this.group);
    const tone = new THREE.Color(colour);
    this.armMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(colour, -0.05)), roughness: 0.5, emissive: tone, emissiveIntensity: 0.32 });
    this.handMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(colour, 0.28)), roughness: 0.45, emissive: tone, emissiveIntensity: 0.42 });
    this.limbs = [0, 1].map(() => this.limb());
  }

  limb() {
    const mesh = (geo, mat, parent) => {
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      return m;
    };
    const g = new THREE.Group();
    this.group.add(g);
    const upper = mesh(SHAPES.rod, this.armMat, g);
    const lower = mesh(SHAPES.rod, this.armMat, g);
    const elbow = mesh(SHAPES.ball, this.armMat, g);
    elbow.scale.setScalar(ARM_R * RIG_UNIT);
    // The hand: its own group at the wrist, in room units (scaled by RIG_UNIT), fingers up its +y.
    const hand = new THREE.Group();
    g.add(hand);
    const mitten = mesh(SHAPES.ball, this.handMat, hand);
    const pointer = mesh(SHAPES.stub, this.handMat, hand);
    const palm = mesh(SHAPES.ball, this.handMat, hand);
    const fingers = STUBS.map(() => mesh(SHAPES.stub, this.handMat, hand));
    // The thumb turns about its root at the side of the palm.
    const thumbRoot = new THREE.Group();
    thumbRoot.position.set(-6.4, 3, 0);
    hand.add(thumbRoot);
    const thumb = mesh(SHAPES.stub, this.handMat, thumbRoot);
    return { g, upper, lower, elbow, hand, mitten, pointer, palm, fingers, thumbRoot, thumb };
  }

  /** Shows the arms of a pose (already turned toward its target), or hides them (null). */
  set(pose) {
    const hands = pose?.hands ?? [];
    this.group.visible = hands.some((h) => h && h.s > 0.05);
    if (!this.group.visible) return;
    for (let i = 0; i < 2; i++) this.shape(this.limbs[i], hands[i]);
  }

  shape(l, pose) {
    l.g.visible = !!pose && pose.s > 0.05;
    if (!l.g.visible) return;
    const a = pose.arm;
    const r = ARM_R * RIG_UNIT;
    at(a.shoulder, ARM_Z, A);
    at(a.elbow, ARM_Z + 0.015, B);
    rod(l.upper, A, B, r);
    l.elbow.position.copy(B);
    at(a.wrist, HAND_Z - 0.02, A);
    rod(l.lower, B, A, r);

    // The hand, as the flat drawing places it: at the wrist, turned, mirrored for the left side, sized.
    at(pose, HAND_Z, l.hand.position);
    l.hand.rotation.set(0, 0, (-pose.rot * Math.PI) / 180);
    const k = pose.s * RIG_UNIT * HAND_SIZE;
    l.hand.scale.set(pose.side * (pose.sx ?? 1) * k, k, k);
    const sh = pose.shape;
    const mitten = pose.style === "mitten";
    l.mitten.visible = mitten;
    l.palm.visible = !mitten;
    for (const f of l.fingers) f.visible = !mitten;
    if (mitten) {
      const rest = (sh.f[1] + sh.f[2] + sh.f[3]) / 3;
      const hgt = 18 * (1 - 0.38 * rest);
      l.mitten.position.set(0, (hgt - 3) / 2, 0);
      l.mitten.scale.set(7.5, (hgt + 3) / 2, 5.5);
      l.pointer.visible = sh.f[0] < 0.3 && rest > 0.6;
      // A capsule 2 units long at scale 1: this one is 5.4 wide and 12 long.
      l.pointer.position.set(-4.3, 16, 0.5);
      l.pointer.rotation.set(0, 0, 0);
      l.pointer.scale.set(5.4, 6, 5.4);
    } else {
      l.pointer.visible = false;
      l.palm.position.set(0, 4.5, 0);
      l.palm.scale.set(7.2, 6.5, 4.6);
      STUBS.forEach((st, i) => {
        const len = st.len * (1 - 0.68 * sh.f[i]);
        const angle = (-sh.spread * [-10, -3.5, 3.5, 10][i] * Math.PI) / 180;
        const f = l.fingers[i];
        // From its root at the top of the palm, up along its own (slightly fanned) line.
        const half = (len + 3) / 2;
        f.position.set(st.x - Math.sin(angle) * (half - 1.5), 9 + Math.cos(angle) * (half - 1.5), 0.4);
        f.rotation.set(0, 0, angle);
        f.scale.set(4, half, 4);
      });
    }
    // The thumb: out from the palm's edge (negative angle), or across the front of it (positive).
    const tl = (mitten ? 9 : 8.5) * (1 - 0.4 * sh.tc);
    l.thumbRoot.rotation.set(0, 0, (-sh.ta * Math.PI) / 180);
    l.thumbRoot.position.z = sh.ta > 5 ? 3.5 : -2;
    const half = (tl + 2.5) / 2;
    l.thumb.position.set(0, half - 2.5, 0);
    l.thumb.scale.set(4.8, half, 4.8);
  }

  dispose() {
    this.group.removeFromParent();
    this.armMat.dispose();
    this.handMat.dispose();
  }
}
