// The slime of the 3D look: the landing scene's slime (landing/tools/scene/scene.js, makeSkin),
// which the owner approved. A soft dome in the player's colour that sags outward at its foot, wet
// and glossy, two drips at its foot, a wet highlight on its front and one on its back (the Tin
// Derby reviewer's fix: from behind, a dome in a dark colour read as nothing), and two big eyes low
// on its front. The flat look draws the same slime in SVG (../characters/slime.js).
//
// It is one of the characters (./characters.js; lobby/README.md, "Characters"): the same handles
// as the pawn, the same moments from the room, its own way of showing them. It has no feet: it
// creeps, squashing and stretching as it goes, its top drags behind when it sets off and runs on
// and wobbles back when it stops; it flattens when it is knocked over, and its eyes squeeze shut.
// Its emotes are the ghost's, fitted to its body (../characters/body-rig.js), its hands on arms
// of its own goo.
//
// Cost: four draws at rest (the dome with its drips; the two highlights; the eyes; their glints)
// plus its shadow; the mouth only while an emote gives it one. Nothing is made per frame, and its
// breath is laid on outside its springs, so an idle slime does not keep the room drawing.
import * as THREE from "./three.js";
import { EmoteArms, RIG_UNIT } from "./emote-arms.js";
import { blinkAt, clamp, merged, spring, tube, tubeGeometry } from "./body-kit.js";
import { HOP_HEIGHT, HOP_MS, PAWN_HEIGHT, SIZE, bumpPose } from "./pieces.js";
import { PX, SPACE, walkX } from "./space.js";
import { JUMP_MS, WALK_SPEED, jumpHeight } from "../shared/world.js";
import { wispAt } from "../characters/ghost-rig.js";

const TOP = 0.7;
const SLIME_HEIGHT = (TOP * SIZE) / PX;
const BELOW_PAWN = PAWN_HEIGHT - SLIME_HEIGHT;
const RAD = Math.PI / 180;
const GREY = new THREE.Color("#8a8d94");
const SOOT = new THREE.Color("#1c1512");
const FUMING = new THREE.Color("#ff2a14");
const INK = 0x0a0d18;
/** Below these an idle slime is still (its breath is laid on outside the springs). */
const STILL = { squashV: 0.03, leanV: 0.01, puffV: 0.02 };
/** Where its eyes sit: how far round from the front, how high, how far out, how big. */
const EYE = { a: 0.36, y: 0.34, r: 0.405, w: 0.051, h: 0.078 };
const MOUTH = { y: 0.215, z: 0.43 };
const MOUTHS = { grin: [1.7, 1.15], laugh: [1.8, 1.6], o: [1.1, 1.35], chew: [1.25, 0.7], purse: [0.62, 0.62], flat: [1.45, 0.28], grit: [1.75, 0.55], squiggle: [1.35, 0.3] };
const CURVES = { smile: 1, frown: -1 };

let SHAPES = null;
const at = new THREE.Object3D();
const eyeMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.25 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false });
const mouthMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.3 });

const place = (x, y, z, rx, ry, rz, sx, sy, sz) => {
  at.position.set(x, y, z);
  at.rotation.set(rx, ry, rz);
  at.scale.set(sx, sy, sz);
  at.updateMatrix();
  return at.matrix.clone();
};

function shapes() {
  // The landing scene's profile: a soft dome that sags outward at the foot, closed underneath (a shiny floor shows its underside).
  const n = 14;
  const profile = [[0, 0]];
  for (let i = 0; i <= n; i++) {
    const a = ((i / n) * Math.PI) / 2;
    profile.push([0.43 * Math.pow(Math.cos(a), 0.62) + 0.05 * Math.pow(1 - i / n, 6), TOP * Math.sin(a)]);
  }
  profile.push([0, TOP]);
  const dome = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 30);
  dome.computeVertexNormals();
  const ball = new THREE.SphereGeometry(1, 12, 8);
  const drips = [
    [0.47, 0.16, 0.07],
    [-0.44, 0.24, 0.05],
  ].map(([x, z, r]) => [ball, place(x, r * 0.3, z, 0, 0, 0, r, r * 0.6, r)]);
  const body = merged([[dome, new THREE.Matrix4()], ...drips]);
  // The wet highlight on the front, and the streak on the back, along the dome's surface.
  const back = new THREE.Object3D();
  const p = new THREE.Vector3(-0.13, 0.55, -0.29);
  const nrm = new THREE.Vector3(-0.13 / 0.185, 0.55 / 0.49, -0.29 / 0.185).normalize();
  back.position.copy(p).addScaledVector(nrm, 0.012);
  back.lookAt(p.clone().addScaledVector(nrm, 2));
  back.rotateZ(0.6);
  back.scale.set(0.11, 0.045, 0.02);
  back.updateMatrix();
  const shine = merged([
    [ball, place(-0.16, 0.57, 0.2, -0.7, -0.5, 0.5, 0.085, 0.04, 0.02)],
    [ball, place(-0.25, 0.45, 0.3, -0.4, -0.7, 0.2, 0.025, 0.018, 0.012)],
    [ball, back.matrix.clone()],
  ]);
  const eyes = [];
  const glints = [];
  for (const side of [-1, 1]) {
    const a = side * EYE.a;
    eyes.push([ball, place(Math.sin(a) * EYE.r, 0, Math.cos(a) * EYE.r, 0, a, 0, EYE.w, EYE.h, EYE.w * 0.55)]);
    glints.push([ball, place(Math.sin(a) * (EYE.r + 0.016) + EYE.w * 0.25, EYE.h * 0.4, Math.cos(a) * (EYE.r + 0.016), 0, a, 0, EYE.w * 0.32, EYE.h * 0.26, EYE.w * 0.22)]);
  }
  return {
    body,
    shine,
    eyes: merged(eyes),
    glints: merged(glints),
    ball,
    curve: new THREE.TorusGeometry(1, 0.24, 6, 12, Math.PI),
    blob: new THREE.CircleGeometry(0.5 * SIZE * 1.3, 24),
    ring: new THREE.RingGeometry(0.4, 0.47, 48),
  };
}

/** A slime, sitting on the origin of its own group. Returns the handles every character has, and its own. */
export function makeSlime(radial) {
  SHAPES ??= shapes();
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, emissiveIntensity: 0.3 });
  const turn = new THREE.Group();
  const skin = new THREE.Mesh(SHAPES.body, mat);
  const shine = new THREE.Mesh(SHAPES.shine, shineMat);
  const face = new THREE.Group();
  face.position.y = EYE.y;
  const eyes = new THREE.Mesh(SHAPES.eyes, eyeMat);
  const glints = new THREE.Mesh(SHAPES.glints, glintMat);
  face.add(eyes, glints);
  const mouthAt = new THREE.Group();
  mouthAt.position.set(0, MOUTH.y, MOUTH.z);
  const mouth = new THREE.Mesh(SHAPES.ball, mouthMat);
  const curve = new THREE.Mesh(SHAPES.curve, mouthMat);
  mouthAt.add(mouth, curve);
  mouthAt.visible = false;
  turn.add(skin, shine, face, mouthAt);
  const tilt = new THREE.Group();
  tilt.add(turn);
  const group = new THREE.Group();
  group.add(tilt);
  // One wide soft shadow, and a dark one close under it: it sits on the floor.
  const blob = new THREE.Mesh(SHAPES.blob, new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  const contact = new THREE.Mesh(SHAPES.blob, blob.material);
  contact.scale.set(0.72, 0.72, 1);
  contact.position.z = 0.001;
  blob.add(contact);
  const ring = new THREE.Mesh(SHAPES.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  ring.visible = false;
  return {
    group, tilt, turn, mat, blob, ring, skin: [skin], colour: new THREE.Color(), lit: 0, fade: 1, air: false, dizzy: false, connected: true,
    shine, face, eyes, glints, mouthAt, mouth, curve, own: null,
    sq: 1, sqV: 0, lean: 0, leanV: 0, puff: 0, puffV: 0, yaw: 0, stride: 0, prevX: null, walked: false, want: null,
  };
}

/** Colours a slime for its player (a shade lighter, as the flat drawing's), or grey for one who has dropped. */
export function dressSlime(b, hex, connected) {
  b.colour.set(connected ? hex : GREY);
  if (connected) b.colour.offsetHSL(0, 0.06, 0.07);
  b.connected = connected;
  b.mat.emissive.copy(b.colour);
}

export function disposeSlime(b) {
  b.mat.dispose();
  for (const m of b.own ?? []) m.dispose();
  b.blob.material.dispose();
  b.ring.material.dispose();
}

/** Fades a slime that is leaving the room: `left` runs from 1 to 0. */
export function fadeSlime(b, left) {
  b.fade = left;
  // Its face and highlights are shared by every slime, so a fading slime gets its own.
  if (!b.own) {
    b.own = [b.eyes, b.glints, b.mouth, b.shine].map((mesh) => (mesh.material = mesh.material.clone()));
    b.curve.material = b.mouth.material;
    for (const m of b.own) m.transparent = true;
  }
  for (const m of [...b.own, b.mat]) {
    m.transparent = true;
    m.opacity = left * 0.8;
  }
}

/** Sits a slime where its piece is, for this frame: the same call and answer as posePawn (pieces.js). */
export function poseSlime(b, piece, now, dt, how) {
  const step = Math.min(dt, 1 / 30);
  const calm = how.calm;
  const bump = bumpPose(piece, now);
  const thrown = bump.x !== null;
  if (thrown) piece.rx = bump.x;
  b.prevX ??= piece.rx;
  const speed = step > 0 && !thrown ? clamp((piece.rx - b.prevX) / step / WALK_SPEED, -1.4, 1.4) : 0;
  b.prevX = piece.rx;

  const sinceJump = now - piece.jumpAt;
  const up = jumpHeight(sinceJump);
  const air = sinceJump >= 0 && sinceJump < JUMP_MS;
  if (air && !b.air) b.sqV += 3.2;
  if (!air && b.air) b.sqV -= 6.5;
  b.air = air;

  const want = b.want;
  b.want = null;
  const walking = how.walking && !air && !thrown;
  // A creep: one squash and stretch for each stretch of floor it covers.
  if (walking) b.stride += Math.abs(speed) * step * 10;
  // Stopping, it runs on and wobbles back.
  if (b.walked && !walking && !calm) b.sqV += 1.4;
  b.walked = walking;
  const creep = walking && !calm ? 0.09 * Math.sin(b.stride) : 0;
  // Knocked over, it flattens on the floor.
  const flat = bump.dizzy ? 0.62 : 1;
  [b.sq, b.sqV] = spring(b.sq, b.sqV, (air ? 1.12 : 1) * flat + creep, 210, calm ? 26 : 6.5, step);
  b.sq = clamp(b.sq, 0.5, 1.35);
  // Its top drags behind the way it goes, and swings past upright when it stops.
  [b.lean, b.leanV] = spring(b.lean, b.leanV, speed * 0.16, 110, calm ? 26 : 5.5, step);
  [b.puff, b.puffV] = spring(b.puff, b.puffV, want ? want.puff : 0, 240, 13, step);
  const facing = how.walking ? Math.sign(speed || piece.face) * 0.8 : want ? want.yaw : piece.face * 0.32;
  b.yaw += (facing - b.yaw) * Math.min(1, step * 10);

  const breath = calm ? 0 : 0.022 * Math.sin(now / 650 + piece.seat * 1.7);
  const tall = Math.max(0.45, b.sq + breath);
  const wide = 1 / Math.sqrt(tall);
  const startle = (now - (piece.fx?.hopAt ?? -Infinity)) / HOP_MS;
  const yelp = startle >= 0 && startle < 1 ? 4 * HOP_HEIGHT * startle * (1 - startle) : 0;
  const rise = up + bump.lift + yelp;
  const pivot = bump.pivot * PX;
  b.group.position.set(walkX(piece.rx + bump.dx) + pivot * Math.sin(bump.lean), rise * PX + pivot * (1 - Math.cos(bump.lean)), SPACE.walkZ);
  b.tilt.rotation.z = (thrown ? 0 : b.lean) + bump.lean;
  const swell = 1 + b.puff;
  b.tilt.scale.set(SIZE * wide * bump.sx * swell, SIZE * tall * bump.sy * (1 + b.puff * 0.6), SIZE * wide * bump.sx * swell);
  b.turn.rotation.y = thrown ? b.yaw * 0.3 : b.yaw;

  // Eyes squeezed shut while it is thrown and lying; a blink now and then.
  b.dizzy = bump.dizzy;
  b.face.position.y = EYE.y;
  faceSlime(b, bump.dizzy ? 0.92 : calm ? 0 : blinkAt(now, piece.seat, 3700), 1, null);

  const off = Math.max(0.45, 1 - Math.max(0, rise) * PX * 0.6);
  b.blob.position.set(walkX(piece.rx + bump.dx), 0.008, SPACE.walkZ);
  b.blob.scale.setScalar(off * wide * 1.0);
  b.blob.material.opacity = 0.72 * off * b.fade;
  b.ring.position.set(walkX(piece.rx), 0.012, SPACE.walkZ);

  // Brighter under a lamp, dimmer in the dark; jelly glows a little more than paint does.
  b.lit += (how.lit - b.lit) * Math.min(1, step * 8);
  const char = piece.fx?.char ?? 0;
  b.mat.color.copy(b.colour).multiplyScalar(0.45 + 0.55 * b.lit).lerp(SOOT, char * 0.82);
  b.mat.emissive.copy(b.colour).lerp(SOOT, char);
  b.mat.emissiveIntensity = (b.connected ? 0.13 : 0.06) + 0.27 * b.lit;
  b.mat.clearcoat = 1 - char * 0.8;
  if (bump.safe) b.mat.emissiveIntensity += how.calm ? 0.25 : 0.55 * Math.abs(Math.sin(now / 70));

  const moving = walking || air || bump.state !== "idle" || yelp > 0 || Math.abs(b.sqV) > STILL.squashV || Math.abs(b.leanV) > STILL.leanV || Math.abs(b.puffV) > STILL.puffV || Math.abs(facing - b.yaw) > 0.01 || Math.abs(how.lit - b.lit) > 0.01;
  return { up: rise + (tall - 1) * SLIME_HEIGHT - BELOW_PAWN, moving, shock: bump.shock, burst: bump.burst, dust: bump.dust, state: bump.state };
}

/** The face: how far shut the eyes are (0 to 1), how big they are open (1: as made), and the rig's name for the mouth (null: none). */
function faceSlime(b, shut, open, mouth) {
  b.eyes.scale.set(open > 1.05 ? 1.12 : 1, open * (1 - 0.9 * shut), 1);
  b.glints.visible = shut < 0.5 && open > 0.55;
  b.mouthAt.visible = !!mouth;
  if (!mouth) return;
  const bend = CURVES[mouth] ?? 0;
  b.curve.visible = !!bend;
  b.mouth.visible = !bend;
  if (bend) {
    b.curve.scale.set(0.05, 0.036, 0.03);
    b.curve.rotation.z = bend > 0 ? Math.PI : 0;
    b.curve.position.y = bend > 0 ? 0.022 : -0.012;
  }
  const [mw, mh] = MOUTHS[mouth] ?? [1, 1];
  b.mouth.scale.set(0.036 * mw, 0.046 * mh, 0.02);
}

/** An emote's pose on the slime for this frame, after poseSlime: lean and lift, its face, the red of fuming, and (next frame) its swell and turn. */
export function emoteSlime(b, pose, now, seat) {
  const body = pose.body;
  const metres = RIG_UNIT * SIZE;
  b.group.position.x += body.dx * metres;
  b.group.position.y += body.lift * metres;
  b.tilt.rotation.z -= body.rot * RAD;
  b.want = pose.ghost;
  if (body.tint > 0) {
    b.mat.color.lerp(FUMING, body.tint * 0.85);
    b.mat.emissive.lerp(FUMING, body.tint * 0.7);
  }
  if (b.dizzy) return;
  const f = pose.face;
  const shut = f.eyes !== "open" ? 0.85 : Math.max(blinkAt(now, seat, 3700), f.lid * 0.6);
  b.face.position.y = EYE.y + f.up * RIG_UNIT;
  faceSlime(b, shut, clamp(f.eye, 0.4, 1.3), f.mouth);
}

/** The baked look has real light: the slime in its true colour, glossier still. */
export function bakeSlime(b) {
  if (!b.baked) {
    b.baked = true;
    b.mat.roughness = 0.1;
    b.mat.clearcoatRoughness = 0.04;
    b.mat.envMapIntensity = 1.2;
  }
  const flicker = Math.max(0, b.mat.emissiveIntensity - ((b.connected ? 0.13 : 0.06) + 0.27 * b.lit) - 0.01);
  b.mat.color.copy(b.colour);
  b.mat.emissiveIntensity = 0.06 + flicker * 0.6;
}

// ---------------------------------------------------------------- its hands
//
// The hands are the room's own (emote-arms.js), in the player's colour, a shade lighter than the
// body so a hand held in front of it still reads. What joins each to the body is its own goo: a
// tube from the slime's side to the wrist, thick where it leaves the body and thin at the hand,
// in the body's own material, so it is lit, dimmed and reddened exactly as the body is.

/** How far in front of the pawn's hands the slime's sit (model units): its front is well forward of a pawn's. */
const FRONT = 0.2;
/** Where an arm leaves the body (in front of its axis, model units) and where it meets the hand. */
const ROOT_Z = 0.16;
const WRIST_Z = 0.24 + FRONT;
/** Half the width of a goo arm where it leaves the body and at the wrist, in rig units. */
const GOO = { root: 13, wrist: 5.6 };
const AT = [0, 0, 0, 0];

export class SlimeHands {
  /** @param {object} b  makeSlime(); `colour` is the player's colour as "#rrggbb" */
  constructor(b, colour) {
    this.slime = b;
    this.arms = new EmoteArms(b, colour);
    this.group = this.arms.group;
    this.group.position.z = FRONT;
    // The pawn's stick arm is never drawn on a slime: its arms are goo.
    for (const l of this.arms.limbs) l.upper.visible = l.lower.visible = l.elbow.visible = false;
    this.wisps = [0, 1].map(() => {
      const mesh = new THREE.Mesh(tubeGeometry(), b.mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      b.tilt.add(mesh);
      return mesh;
    });
  }

  /** Shows the hands of a pose (already turned toward its target), or hides them (null). */
  set(pose, now = 0) {
    const limb = pose?.ghost?.limb ?? "none";
    const hands = limb === "none" ? [] : pose.hands;
    this.arms.set({ hands });
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const on = !!h && h.s > 0.05;
      this.wisps[i].visible = on;
      if (on) this.goo(this.wisps[i], h, now, i);
    }
  }

  goo(mesh, h, now, seed) {
    const grow = Math.min(1, h.s);
    tube(
      mesh.geometry,
      (u, P, T) => {
        const k = u * grow;
        wispAt(h.arm, k, AT);
        // It quivers a little along its length, most in the middle.
        const wob = Math.sin(now / 180 + u * 4 + seed * 2) * 1.2 * Math.sin(k * Math.PI);
        P.set((AT[0] - AT[3] * wob) * RIG_UNIT, -(AT[1] + AT[2] * wob) * RIG_UNIT, ROOT_Z + (WRIST_Z - ROOT_Z) * k + Math.sin(k * Math.PI) * 0.05);
        T.set(AT[2], -AT[3], (WRIST_Z - ROOT_Z) / 40);
      },
      (u) => (GOO.root + (GOO.wrist - GOO.root) * Math.pow(u, 0.75)) * RIG_UNIT * (0.4 + 0.6 * grow),
    );
  }

  dispose() {
    for (const mesh of this.wisps) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.arms.dispose();
  }
}
