// The robot of the 3D look: the landing scene's robot (landing/tools/scene/scene.js, makeSkin),
// which the owner approved. A dark base; a body and a head in the player's colour; a dark visor
// with two light eyes; a steel neck; a round plate on its chest; a mast with a lamp on top; dark
// arms at its sides ending in steel hands. The flat look draws the same robot in SVG
// (../characters/robot.js).
//
// It is one of the characters (./characters.js; lobby/README.md, "Characters"): the same handles
// as the pawn, the same moments from the room, its own way of showing them. It rolls, humming
// along with a small bob and a lean into where it goes; its head lags a beat behind its body and
// its mast lags behind its head, so both run on and wobble back when it stops or is bumped. The
// lamp on its mast is dim until it stands in a game's light (its vote), when it lights with a
// quick double flash and its eyes squint with pleasure; knocked over, the lamp flashes red and its
// eyes are crosses. Its emotes are the ghost's, fitted to its body (../characters/body-rig.js),
// its hands on jointed arms of dark metal.
//
// Its parts are coloured point by point (pointLitMat in ./body-kit.js), so the body, the head,
// the mast and the resting arms are one material and four draws; with the eyes and the lamp that
// is six, and the lamp's glow a seventh only while it is lit. Nothing is made per frame.
import * as THREE from "./three.js";
import { EmoteArms, RIG_UNIT } from "./emote-arms.js";
import { blinkAt, clamp, merged, paintPoints, pointLitMat, roundedBox, spring } from "./body-kit.js";
import { HOP_HEIGHT, HOP_MS, PAWN_HEIGHT, SIZE, bumpPose } from "./pieces.js";
import { PX, SPACE, walkX } from "./space.js";
import { JUMP_MS, WALK_SPEED, jumpHeight } from "../shared/world.js";

/** The landing robot's own scale, baked into its shapes. */
const K = 1.13;
/** The top of its lamp, in model units, and how far that is above a pawn's head in world units. */
const TOP = 1.245 * K;
const ROBOT_HEIGHT = (TOP * SIZE) / PX;
const ABOVE_PAWN = ROBOT_HEIGHT - PAWN_HEIGHT;
const RAD = Math.PI / 180;
const DARK = "#23262e";
const STEEL = "#b9c0cc";
const VISOR = "#0a0d18";
const PLATE = "#f3ead6";
const GREY = new THREE.Color("#8a8d94");
const SOOT = new THREE.Color("#1c1512");
const FUMING = new THREE.Color("#ff2a14");
const EYE = new THREE.Color("#bff3ff");
const LAMP = new THREE.Color("#ffd27a");
const ALARM = new THREE.Color("#ff4a3a");
/** Where its head and mast turn (model units): the top of its neck and the top of its head. */
const NECK = 0.63 * K;
const CROWN = 0.97 * K;
/** Where its eyes are, on the head (model units). */
const EYES = { x: 0.085 * K, y: 0.81 * K, z: 0.212 * K };
/** How long its lamp flashes and its eyes squint when it steps into a light (ms). */
const PLEASED_MS = 700;
/** Below these a robot is still. */
const STILL = { squashV: 0.03, leanV: 0.01, nodV: 0.02, mastV: 0.03 };

let SHAPES = null;
const at = new THREE.Object3D();
const place = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  at.position.set(x * K, y * K, z * K);
  at.rotation.set(rx, ry, rz);
  at.scale.set(sx, sy, sz);
  at.updateMatrix();
  return at.matrix.clone();
};

function shapes() {
  const box = (w, h, d, r) => roundedBox(w * K, h * K, d * K, r * K, 3);
  const ball = (r, w = 14, h = 10) => new THREE.SphereGeometry(r * K, w, h);
  const rod = (r, h, n = 12) => new THREE.CylinderGeometry(r * K, r * K, h * K, n);
  const main = merged(
    [
      [box(0.56, 0.16, 0.42, 0.07), place(0, 0.08, 0), DARK],
      [box(0.5, 0.42, 0.38, 0.09), place(0, 0.36, 0), "paint"],
      [new THREE.CylinderGeometry(0.07 * K, 0.07 * K, 0.012 * K, 20), place(0, 0.38, 0.192, Math.PI / 2), PLATE],
      [rod(0.07, 0.1, 14), place(0, 0.6, 0), STEEL],
      [ball(0.075), place(-0.29, 0.44, 0), DARK],
      [ball(0.075), place(0.29, 0.44, 0), DARK],
    ],
    true,
  );
  // The head, about the top of the neck.
  const head = merged(
    [
      [box(0.48, 0.34, 0.38, 0.1), place(0, 0.8 - 0.63, 0), "paint"],
      [box(0.38, 0.19, 0.06, 0.03), place(0, 0.81 - 0.63, 0.175), VISOR],
    ],
    true,
  );
  // The mast, about the top of the head.
  const mast = merged([[rod(0.02, 0.2, 8), place(0, 0.1, 0), STEEL]], true);
  // Its arms at rest, hanging at its sides.
  const arms = merged(
    [-1, 1].flatMap((s) => [
      [rod(0.04, 0.24, 10), place(s * 0.31, 0.3, 0), DARK],
      [ball(0.06, 12, 8), place(s * 0.31, 0.16, 0), STEEL],
    ]),
    true,
  );
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const eyes = merged([-1, 1].map((s) => [sphere, new THREE.Matrix4().compose(new THREE.Vector3(s * EYES.x, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.05 * K, 0.066 * K, 0.016 * K))]));
  const bar = new THREE.BoxGeometry(0.1 * K, 0.02 * K, 0.012 * K);
  const crosses = merged([-1, 1].flatMap((s) => [-1, 1].map((t) => [bar, new THREE.Matrix4().compose(new THREE.Vector3(s * EYES.x, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (t * Math.PI) / 4)), new THREE.Vector3(1, 1, 1))])));
  return {
    main,
    head,
    mast,
    arms,
    eyes,
    crosses,
    lamp: new THREE.SphereGeometry(0.055 * K * 1.15, 14, 10),
    rod: new THREE.CylinderGeometry(1, 1, 1, 10, 1, true),
    joint: new THREE.SphereGeometry(1, 12, 8),
    blob: new THREE.CircleGeometry(0.5 * SIZE * 1.05, 24),
    ring: new THREE.RingGeometry(0.4, 0.47, 48),
  };
}

const eyeMat = new THREE.MeshBasicMaterial({ color: EYE });

/** A robot, standing on the origin of its own group. Returns the handles every character has, and its own. */
export function makeRobot(radial) {
  SHAPES ??= shapes();
  const mat = pointLitMat({ roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25, emissive: 0xffffff, emissiveIntensity: 0.3 }, "robot-paint");
  // Its own copies of the shapes in its colour; the mast and arms have none of it and are shared.
  const mainGeo = SHAPES.main.clone();
  const headGeo = SHAPES.head.clone();
  mainGeo.userData = SHAPES.main.userData;
  headGeo.userData = SHAPES.head.userData;
  const turn = new THREE.Group();
  const main = new THREE.Mesh(mainGeo, mat);
  const arms = new THREE.Mesh(SHAPES.arms, mat);
  const headG = new THREE.Group();
  headG.position.y = NECK;
  const head = new THREE.Mesh(headGeo, mat);
  const eyes = new THREE.Mesh(SHAPES.eyes, eyeMat);
  const crosses = new THREE.Mesh(SHAPES.crosses, eyeMat);
  crosses.visible = false;
  for (const m of [eyes, crosses]) m.position.set(0, EYES.y - NECK, EYES.z);
  const mastG = new THREE.Group();
  mastG.position.y = CROWN - NECK;
  const mast = new THREE.Mesh(SHAPES.mast, mat);
  const lampMat = new THREE.MeshBasicMaterial({ color: LAMP.clone() });
  const lamp = new THREE.Mesh(SHAPES.lamp, lampMat);
  lamp.position.y = (1.19 - 0.97) * K;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: LAMP.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.copy(lamp.position);
  glow.scale.setScalar(0.42);
  glow.visible = false;
  mastG.add(mast, lamp, glow);
  headG.add(head, eyes, crosses, mastG);
  turn.add(main, arms, headG);
  const tilt = new THREE.Group();
  tilt.add(turn);
  const group = new THREE.Group();
  group.add(tilt);
  const blob = new THREE.Mesh(SHAPES.blob, new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  const contact = new THREE.Mesh(SHAPES.blob, blob.material);
  contact.scale.set(0.7, 0.7, 1);
  contact.position.z = 0.001;
  blob.add(contact);
  const ring = new THREE.Mesh(SHAPES.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  ring.visible = false;
  return {
    group, tilt, turn, mat, blob, ring, skin: [main, arms, head, mast], colour: new THREE.Color(), lit: 0, fade: 1, air: false, dizzy: false, connected: true,
    main, arms, headG, head, eyes, crosses, mastG, mast, lamp, lampMat, glow, own: null,
    sq: 1, sqV: 0, lean: 0, leanV: 0, nod: 0, nodV: 0, mastA: 0, mastV: 0, yaw: 0, prevX: null, lampK: 0, voting: false, pleasedAt: -Infinity, want: null, shockAt: -Infinity,
  };
}

/** Colours a robot's body and head for its player (a little brighter, as a pawn's), or grey for one who has dropped. */
export function dressRobot(r, hex, connected) {
  r.colour.set(connected ? hex : GREY);
  if (connected) r.colour.offsetHSL(0, 0.08, 0.05);
  r.connected = connected;
  paintPoints(r.main.geometry, r.colour);
  paintPoints(r.head.geometry, r.colour);
}

export function disposeRobot(r) {
  r.main.geometry.dispose();
  r.head.geometry.dispose();
  r.mat.dispose();
  r.lampMat.dispose();
  r.glow.material.dispose();
  for (const m of r.own ?? []) m.dispose();
  r.blob.material.dispose();
  r.ring.material.dispose();
}

/** Fades a robot that is leaving the room: `left` runs from 1 to 0. */
export function fadeRobot(r, left) {
  r.fade = left;
  if (!r.own) {
    // Its eyes are shared by every robot, so a fading robot gets its own.
    r.own = [(r.eyes.material = r.eyes.material.clone())];
    r.crosses.material = r.eyes.material;
  }
  for (const m of [r.mat, r.lampMat, ...r.own]) {
    m.transparent = true;
    m.opacity = left * 0.8;
  }
}

/** Stands a robot where its piece is, for this frame: the same call and answer as posePawn (pieces.js). */
export function poseRobot(r, piece, now, dt, how) {
  const step = Math.min(dt, 1 / 30);
  const calm = how.calm;
  const bump = bumpPose(piece, now);
  const thrown = bump.x !== null;
  if (thrown) piece.rx = bump.x;
  r.prevX ??= piece.rx;
  const speed = step > 0 && !thrown ? clamp((piece.rx - r.prevX) / step / WALK_SPEED, -1.4, 1.4) : 0;
  r.prevX = piece.rx;

  const sinceJump = now - piece.jumpAt;
  const up = jumpHeight(sinceJump);
  const air = sinceJump >= 0 && sinceJump < JUMP_MS;
  // It is stiff: a jump and a landing only shake its suspension a little, and its mast a lot.
  if (air && !r.air) {
    r.sqV += 1.2;
    r.mastV -= 3;
  }
  if (!air && r.air) {
    r.sqV -= 2.6;
    r.mastV += 5;
  }
  r.air = air;
  if (bump.shock && now - r.shockAt > 400) {
    r.shockAt = now;
    r.mastV += 7 * Math.sign(bump.lean || 1);
  }

  const want = r.want;
  r.want = null;
  const walking = how.walking && !air && !thrown;
  // It hums along: a small fast bob while it rolls.
  const hum = walking && !calm ? Math.abs(Math.sin(now / 55)) * 2.2 : 0;
  [r.sq, r.sqV] = spring(r.sq, r.sqV, air ? 1.03 : 1, 320, calm ? 30 : 14, step);
  r.sq = clamp(r.sq, 0.85, 1.12);
  // It leans into where it goes; its head lags its body, and its mast lags its head.
  [r.lean, r.leanV] = spring(r.lean, r.leanV, -speed * 0.09, 140, calm ? 30 : 11, step);
  [r.nod, r.nodV] = spring(r.nod, r.nodV, r.lean, 170, calm ? 30 : 7, step);
  [r.mastA, r.mastV] = spring(r.mastA, r.mastV, r.nod * 1.4, 90, calm ? 30 : 4, step);
  const facing = how.walking ? Math.sign(speed || piece.face) * 0.85 : want ? want.yaw : piece.face * 0.32;
  r.yaw += (facing - r.yaw) * Math.min(1, step * 10);

  const startle = (now - (piece.fx?.hopAt ?? -Infinity)) / HOP_MS;
  const yelp = startle >= 0 && startle < 1 ? 4 * HOP_HEIGHT * startle * (1 - startle) : 0;
  const rise = up + bump.lift + yelp + hum;
  const pivot = bump.pivot * PX;
  r.group.position.set(walkX(piece.rx + bump.dx) + pivot * Math.sin(bump.lean), rise * PX + pivot * (1 - Math.cos(bump.lean)), SPACE.walkZ);
  r.tilt.rotation.z = (thrown ? 0 : r.lean) + bump.lean;
  const tall = r.sq;
  const wide = 1 / Math.sqrt(tall);
  r.tilt.scale.set(SIZE * wide * bump.sx, SIZE * tall * bump.sy, SIZE * wide * bump.sx);
  r.turn.rotation.y = thrown ? r.yaw * 0.3 : r.yaw;
  r.headG.rotation.z = calm ? 0 : r.nod - r.lean;
  r.mastG.rotation.z = calm ? 0 : clamp(r.mastA - r.nod, -0.6, 0.6);

  // Its lamp and its eyes: a vote lights the lamp with a double flash and a squint; a knock flashes it red and crosses its eyes.
  const voting = how.lit > 0.5;
  if (voting && !r.voting) r.pleasedAt = now;
  r.voting = voting;
  r.lampK += ((voting ? 1 : 0) - r.lampK) * Math.min(1, step * 10);
  const since = now - r.pleasedAt;
  const flash = since < PLEASED_MS && !calm ? (Math.floor(since / 120) % 2 === 0 ? 1 : 0.3) : 1;
  r.dizzy = bump.dizzy;
  const alarm = bump.dizzy || bump.state === "hit" || bump.state === "flying";
  const k = alarm ? (calm ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(now / 60))) : (0.32 + 0.68 * r.lampK) * flash;
  r.lampMat.color.copy(alarm ? ALARM : LAMP).multiplyScalar(0.45 + 0.75 * k);
  const glow = alarm ? 0.5 * k : 0.55 * r.lampK * flash;
  r.glow.visible = glow > 0.02;
  r.glow.material.opacity = glow * r.fade;
  r.glow.material.color.copy(alarm ? ALARM : LAMP);
  r.crosses.visible = bump.dizzy;
  r.eyes.visible = !bump.dizzy;
  const pleased = since < PLEASED_MS + 400 && !alarm;
  const shut = calm ? 0 : blinkAt(now, piece.seat, 4100);
  r.eyes.scale.set(1, pleased ? 0.42 : 1 - 0.85 * shut, 1);
  r.eyes.position.y = EYES.y - NECK + (pleased ? 0.012 : 0);
  // The resting arms come back once an emote's arms are gone.
  r.arms.visible = !want || want.nubs > 0.5;

  const off = Math.max(0.45, 1 - Math.max(0, rise - hum) * PX * 0.6);
  r.blob.position.set(walkX(piece.rx + bump.dx), 0.008, SPACE.walkZ);
  r.blob.scale.setScalar(off * 1.1);
  r.blob.material.opacity = 0.72 * off * r.fade;
  r.ring.position.set(walkX(piece.rx), 0.012, SPACE.walkZ);

  r.lit += (how.lit - r.lit) * Math.min(1, step * 8);
  const char = piece.fx?.char ?? 0;
  r.mat.color.setScalar(0.42 + 0.58 * r.lit).lerp(SOOT, char * 0.82);
  r.mat.emissive.setScalar(1).lerp(SOOT, char);
  r.mat.emissiveIntensity = (r.connected ? 0.09 : 0.06) + 0.27 * r.lit;
  r.mat.clearcoat = 0.7 * (1 - char * 0.8);
  if (bump.safe) r.mat.emissiveIntensity += how.calm ? 0.25 : 0.55 * Math.abs(Math.sin(now / 70));

  const moving =
    walking || air || bump.state !== "idle" || yelp > 0 || alarm || since < PLEASED_MS + 450 || Math.abs(r.sqV) > STILL.squashV || Math.abs(r.leanV) > STILL.leanV || Math.abs(r.nodV) > STILL.nodV || Math.abs(r.mastV) > STILL.mastV || Math.abs(facing - r.yaw) > 0.01 || Math.abs(how.lit - r.lit) > 0.01;
  return { up: rise + (tall - 1) * ROBOT_HEIGHT + ABOVE_PAWN, moving, shock: bump.shock, burst: bump.burst, dust: bump.dust, state: bump.state };
}

/** An emote's pose on the robot for this frame, after poseRobot: lean and lift, the light of its eyes, the red of fuming; and (next frame) its resting arms put away. */
export function emoteRobot(r, pose, now, seat) {
  const b = pose.body;
  const metres = RIG_UNIT * SIZE;
  r.group.position.x += b.dx * metres;
  r.group.position.y += b.lift * metres;
  r.tilt.rotation.z -= b.rot * RAD;
  r.want = pose.ghost;
  if (b.tint > 0) {
    r.mat.color.lerp(FUMING, b.tint * 0.8);
    r.mat.emissive.lerp(FUMING, b.tint * 0.6);
    r.lampMat.color.lerp(ALARM, b.tint);
  }
  if (r.dizzy) return;
  // Its face is its eyes: wide, squinting, shut, or narrowed in anger.
  const f = pose.face;
  const shut = f.eyes === "shut" ? 0.8 : f.eyes === "happy" ? 0.55 : f.brows === "angry" ? 0.45 : Math.max(blinkAt(now, seat, 4100), f.lid * 0.6);
  r.eyes.scale.set(f.eye > 1.05 ? 1.15 : 1, clamp(f.eye, 0.4, 1.3) * (1 - 0.9 * shut), 1);
  r.eyes.position.y = EYES.y - NECK + f.up * RIG_UNIT + (f.eyes === "happy" ? 0.012 : 0);
}

/** The baked look has real light: the robot in its true colours, the paint shinier. */
export function bakeRobot(r) {
  if (!r.baked) {
    r.baked = true;
    r.mat.roughness = 0.3;
    r.mat.clearcoat = 1;
    r.mat.clearcoatRoughness = 0.12;
    r.mat.envMapIntensity = 1;
  }
  const flicker = Math.max(0, r.mat.emissiveIntensity - ((r.connected ? 0.09 : 0.06) + 0.27 * r.lit) - 0.01);
  r.mat.color.setScalar(1);
  r.mat.emissiveIntensity = 0.035 + flicker * 0.6;
}

// ---------------------------------------------------------------- its hands
//
// The hands are the room's own (emote-arms.js), made in steel. What joins each to the body is a
// jointed arm of dark metal: from the shoulder at its side to an elbow and on to the wrist, with a
// steel ball at the elbow. The arm is as long as it needs to be: a robot's arms telescope.

/** How far in front of the pawn's hands the robot's sit (model units): its body is deeper than a pawn's. */
const FRONT = 0.06;
const ELBOW_Z = 0.17;
const WRIST_Z = 0.24 + FRONT;
/** Half the width of its arm, in rig units. */
const ARM_R = 4.6;
const UP = new THREE.Vector3(0, 1, 0);
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const D = new THREE.Vector3();
let rodMat = null;
let jointMat = null;

function placeRod(mesh, a, b, rad) {
  D.subVectors(b, a);
  const len = D.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, len > 1e-6 ? D.divideScalar(len) : UP);
  mesh.scale.set(rad, len, rad);
}

export class RobotHands {
  /** @param {object} r  makeRobot(); its hands are steel whatever its colour */
  constructor(r, colour) {
    SHAPES ??= shapes();
    this.robot = r;
    this.arms = new EmoteArms(r, colour);
    this.group = this.arms.group;
    this.group.position.z = FRONT;
    for (const l of this.arms.limbs) l.upper.visible = l.lower.visible = l.elbow.visible = false;
    this.arms.handMat.color.set(STEEL);
    this.arms.handMat.emissive.set(0x30343c);
    this.arms.handMat.emissiveIntensity = 0.5;
    this.arms.handMat.metalness = 0.35;
    rodMat ??= new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.42, metalness: 0.45, emissive: 0x1a1d24, emissiveIntensity: 0.6 });
    jointMat ??= new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.3, metalness: 0.6, emissive: 0x30343c, emissiveIntensity: 0.6 });
    this.rods = [0, 1].map(() => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(SHAPES.rod, rodMat);
      const lower = new THREE.Mesh(SHAPES.rod, rodMat);
      const elbow = new THREE.Mesh(SHAPES.joint, jointMat);
      elbow.scale.setScalar(ARM_R * 1.25 * RIG_UNIT);
      g.add(upper, lower, elbow);
      g.visible = false;
      r.tilt.add(g);
      return { g, upper, lower, elbow };
    });
  }

  /** Shows the hands of a pose (already turned toward its target), or hides them (null). */
  set(pose) {
    const limb = pose?.ghost?.limb ?? "none";
    const hands = limb === "none" ? [] : pose.hands;
    this.arms.set({ hands });
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const rod = this.rods[i];
      rod.g.visible = !!h && h.s > 0.05;
      if (!rod.g.visible) continue;
      const a = h.arm;
      const grow = Math.min(1, h.s);
      A.set(a.shoulder.x * RIG_UNIT, -a.shoulder.y * RIG_UNIT, 0.02);
      B.set(a.elbow.x * RIG_UNIT, -a.elbow.y * RIG_UNIT, ELBOW_Z);
      C.set(a.wrist.x * RIG_UNIT, -a.wrist.y * RIG_UNIT, WRIST_Z - 0.02);
      // It reaches out of the shoulder as the hand comes in, and back as it goes.
      B.lerpVectors(A, B, grow);
      C.lerpVectors(A, C, grow);
      const rad = ARM_R * RIG_UNIT;
      placeRod(rod.upper, A, B, rad);
      placeRod(rod.lower, B, C, rad * 0.85);
      rod.elbow.position.copy(B);
    }
  }

  get wisps() {
    return [];
  }

  dispose() {
    for (const rod of this.rods) rod.g.removeFromParent();
    this.arms.dispose();
  }
}
