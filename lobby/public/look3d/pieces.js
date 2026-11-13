// The pieces of the 3D look: the pawn, and how it moves with weight.
//
// Where a piece is, and what it is doing, is decided elsewhere and is the same for every
// drawing: its x comes from the player's Pilot or from the room (lobby/shared), and so do the
// moments "jumped", "bumped" and "was hit". This file only turns those into a pose: it leans
// into a walk, rocks from foot to foot, stretches in the air and squashes on landing.
import * as THREE from "./three.js";
import { PX, SPACE, walkX } from "./space.js";
import { JUMP_MS, WALK_SPEED, jumpHeight } from "../shared/world.js";

/** How big a piece is beside the room. */
const SIZE = 0.78;
/** A pawn's height in world units, for placing its name tag. */
export const PAWN_HEIGHT = (1.115 * SIZE) / PX;
const GREY = new THREE.Color("#8a8d94");
const SOOT = new THREE.Color("#1c1512");
/** How long the startled hop of a piece that a room effect made jump lasts, and how high it goes (world units). */
const HOP_MS = 420;
const HOP_HEIGHT = 46;

function merged(parts) {
  const pos = [];
  const nor = [];
  for (const [geo, matrix] of parts) {
    const g = geo.toNonIndexed().applyMatrix4(matrix);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/** The shapes every pawn shares: one turned body with its head, the two eyes, their glints, a shadow. */
function shapes() {
  const profile = [[0, 0], [0.29, 0], [0.325, 0.03], [0.33, 0.08], [0.3, 0.13], [0.235, 0.24], [0.185, 0.4], [0.15, 0.56], [0.145, 0.61], [0.2, 0.645], [0.205, 0.68], [0.15, 0.715]];
  const a0 = Math.asin((0.715 - 0.9) / 0.215);
  for (let i = 0; i <= 14; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / 14;
    profile.push([0.215 * Math.cos(a), 0.9 + 0.215 * Math.sin(a)]);
  }
  const body = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 40);
  const ball = new THREE.SphereGeometry(1, 12, 8);
  const eyes = [];
  const glints = [];
  const at = new THREE.Object3D();
  for (const side of [-1, 1]) {
    const a = side * 0.33;
    at.position.set(Math.sin(a) * 0.205, 0.925, Math.cos(a) * 0.205);
    at.rotation.set(0, a, 0);
    at.scale.set(0.034, 0.052, 0.02);
    at.updateMatrix();
    eyes.push([ball, at.matrix.clone()]);
    at.position.set(Math.sin(a) * 0.219, 0.946, Math.cos(a) * 0.219);
    at.scale.set(0.011, 0.013, 0.008);
    at.updateMatrix();
    glints.push([ball, at.matrix.clone()]);
  }
  return { body, eyes: merged(eyes), glints: merged(glints), blob: new THREE.CircleGeometry(0.5 * SIZE, 24), ring: new THREE.RingGeometry(0.4, 0.47, 48) };
}

let SHAPES = null;
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.25 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

/**
 * A pawn, standing at the origin of its own group. `radial` is the soft round texture its
 * shadow is cut from. Returns the handles posePawn needs.
 */
export function makePawn(radial) {
  SHAPES ??= shapes();
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25, emissiveIntensity: 0.3 });
  const turn = new THREE.Group();
  turn.add(new THREE.Mesh(SHAPES.body, mat), new THREE.Mesh(SHAPES.eyes, eyeMat), new THREE.Mesh(SHAPES.glints, glintMat));
  const tilt = new THREE.Group();
  tilt.add(turn);
  const group = new THREE.Group();
  group.add(tilt);
  // Two shadows in one group: a wide soft one, and a small dark one right under the foot that pins the piece to the floor.
  const blob = new THREE.Mesh(SHAPES.blob, new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  const contact = new THREE.Mesh(SHAPES.blob, blob.material);
  contact.scale.set(0.66, 0.66, 1);
  contact.position.z = 0.001;
  blob.add(contact);
  const ring = new THREE.Mesh(SHAPES.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  ring.visible = false;
  return { group, tilt, turn, mat, blob, ring, colour: new THREE.Color(), sq: 1, sqV: 0, lean: 0, leanV: 0, yaw: 0, stride: 0, lit: 0, prevX: null, air: false, fade: 1 };
}

/** Colours a pawn for its seat, or grey for a player who has dropped and is expected back. */
export function dressPawn(pawn, hex, connected) {
  pawn.colour.set(connected ? hex : GREY);
  // The seat colours are chosen for print on a dark page; a glossy toy wants them a little brighter.
  if (connected) pawn.colour.offsetHSL(0, 0.1, 0.06);
  pawn.connected = connected;
  pawn.mat.emissive.copy(pawn.colour);
}

export function disposePawn(pawn) {
  for (const mesh of pawn.turn.children) if (mesh.userData.own) mesh.material.dispose();
  pawn.mat.dispose();
  pawn.blob.material.dispose();
  pawn.ring.material.dispose();
}

// ---------------------------------------------------------------- BUMP STATES PLUG IN HERE
//
// The one place where "what a bump is doing to this piece" becomes a pose. Today the room knows
// two moments, and so does this function: the bumper lunged (piece.lungeAt, piece.lungeDir) and
// someone was hit (piece.hitAt, piece.hitDir). The richer, drawing-independent states that are
// being built (wind-up, strike, knocked, getting up, cooling down) belong here and nowhere else
// in the 3D look: give each state a branch that fills in the same five numbers, and the pawn,
// its shadow and its name tag all follow.
//
//   dx      how far the body is thrown along the floor, in world units
//   lift    how far it leaves the floor, in world units
//   lean    how far it tips, in radians (positive tips its head to the left of the screen)
//   squash  added to its height as a share of it (-0.2 is a fifth shorter, and as much wider)
//   shock   true while its name tag should show the "!" of someone who was just hit
//
// `piece` is the drawing's record of a piece; `now` is performance.now().

const LUNGE_MS = 260;
const KNOCK_MS = 700;

export function bumpPose(piece, now) {
  const pose = { dx: 0, lift: 0, lean: 0, squash: 0, shock: false };
  const lunge = (now - piece.lungeAt) / LUNGE_MS;
  if (lunge >= 0 && lunge < 1) {
    // Out fast, back slower, head first.
    const reach = Math.sin(Math.PI * Math.sqrt(lunge));
    pose.dx += 30 * reach * piece.lungeDir;
    pose.lean -= 0.34 * reach * piece.lungeDir;
    pose.squash -= 0.07 * reach;
  }
  const knock = (now - piece.hitAt) / KNOCK_MS;
  if (knock >= 0 && knock < 1) {
    // Shoved at the foot: the head lags behind, then the piece rocks itself upright like a skittle.
    const dir = piece.hitDir || 1;
    pose.lean += dir * 0.3 * Math.exp(-3.4 * knock) * Math.cos(knock * 13);
    pose.lift += 16 * Math.sin(Math.PI * Math.min(1, knock * 2.4));
    pose.squash -= 0.1 * Math.exp(-6 * knock) * Math.cos(knock * 16);
    pose.shock = knock < 0.6;
  }
  return pose;
}

// ---------------------------------------------------------------- the pose

/** One step of a damped spring: returns [value, velocity]. */
function spring(value, velocity, target, stiffness, damping, dt) {
  velocity += ((target - value) * stiffness - velocity * damping) * dt;
  return [value + velocity * dt, velocity];
}

/**
 * Stands a pawn where its piece is, for this frame.
 *
 * @param {object} pawn    from makePawn
 * @param {object} piece   the drawing's record: {rx, face, jumpAt, lungeAt, lungeDir, hitAt, hitDir, seat}
 * @param {number} now     performance.now()
 * @param {number} dt      seconds since the last frame
 * @param {{walking: boolean, lit: number}} how  whether it is walking, and how bright the light it stands in is (0 to 1)
 * @returns {{up: number, moving: boolean, shock: boolean}} how far its head is above standing height
 *   (world units), whether anything about it is still moving, and whether it was just hit
 */
export function posePawn(pawn, piece, now, dt, how) {
  const step = Math.min(dt, 1 / 30);
  pawn.prevX ??= piece.rx;
  const speed = step > 0 ? Math.max(-1.4, Math.min(1.4, (piece.rx - pawn.prevX) / step / WALK_SPEED)) : 0;
  pawn.prevX = piece.rx;
  const bump = bumpPose(piece, now);

  // In the air: a stretch on the way up, and a kick into a squash when the floor comes back.
  const sinceJump = now - piece.jumpAt;
  const up = jumpHeight(sinceJump);
  const air = sinceJump >= 0 && sinceJump < JUMP_MS;
  if (air && !pawn.air) pawn.sqV += 2.6;
  if (!air && pawn.air) pawn.sqV -= 5.2;
  pawn.air = air;

  // On the floor: a rock from foot to foot whose beat follows the distance covered.
  const walking = how.walking && !air;
  if (walking) pawn.stride += Math.abs(speed) * step * 11.5;
  else pawn.stride += ((Math.round(pawn.stride / Math.PI) * Math.PI - pawn.stride) * Math.min(1, step * 14));
  const hop = Math.abs(Math.sin(pawn.stride)) * 7;
  const rock = Math.sin(pawn.stride) * 0.045;

  const breath = 0.012 * Math.sin(now / 700 + piece.seat * 1.7);
  [pawn.sq, pawn.sqV] = spring(pawn.sq, pawn.sqV, (air ? 1.07 : 1) + breath, 230, 15, step);
  pawn.sq = Math.max(0.68, Math.min(1.25, pawn.sq));
  // It leans the way it is going, a little late, and swings back past upright when it stops.
  [pawn.lean, pawn.leanV] = spring(pawn.lean, pawn.leanV, -speed * 0.17, 95, 12, step);

  const facing = how.walking ? Math.sign(speed || piece.face) * 0.85 : piece.face * 0.32;
  pawn.yaw += (facing - pawn.yaw) * Math.min(1, step * 10);

  const tall = Math.max(0.6, pawn.sq + bump.squash);
  const wide = 1 / Math.sqrt(tall);
  // A room effect may ask for a startled hop (look3d/life.js). It is drawn here and goes nowhere: the piece's x is untouched.
  const startle = (now - (piece.fx?.hopAt ?? -Infinity)) / HOP_MS;
  const yelp = startle >= 0 && startle < 1 ? 4 * HOP_HEIGHT * startle * (1 - startle) : 0;
  const rise = up + hop + bump.lift + yelp;
  pawn.group.position.set(walkX(piece.rx + bump.dx), rise * PX, SPACE.walkZ);
  pawn.tilt.rotation.z = pawn.lean + rock + bump.lean;
  pawn.tilt.scale.set(SIZE * wide, SIZE * tall, SIZE * wide);
  pawn.turn.rotation.y = pawn.yaw;

  // The shadow stays on the floor and tightens as the piece leaves it.
  const off = Math.max(0.45, 1 - rise * PX * 0.6);
  pawn.blob.position.set(walkX(piece.rx + bump.dx), 0.008, SPACE.walkZ);
  pawn.blob.scale.setScalar(off * wide * 1.15);
  pawn.blob.material.opacity = 0.72 * off * pawn.fade;
  pawn.ring.position.set(walkX(piece.rx), 0.012, SPACE.walkZ);

  // Brighter under a lamp, dimmer in the dark between two.
  pawn.lit += (how.lit - pawn.lit) * Math.min(1, step * 8);
  // Outside a pool it falls back into the room's own dimness, so it does not glow like a toy in a shop window.
  const char = piece.fx?.char ?? 0;
  pawn.mat.color.copy(pawn.colour).multiplyScalar(0.42 + 0.58 * pawn.lit).lerp(SOOT, char * 0.82);
  pawn.mat.emissive.copy(pawn.colour).lerp(SOOT, char);
  pawn.mat.emissiveIntensity = (pawn.connected ? 0.09 : 0.06) + 0.27 * pawn.lit;
  pawn.mat.clearcoat = 0.7 * (1 - char * 0.8);

  const moving = walking || air || bump.dx !== 0 || bump.lift !== 0 || bump.lean !== 0 || yelp > 0 || Math.abs(pawn.sqV) > 0.02 || Math.abs(pawn.leanV) > 0.01 || Math.abs(pawn.lean) > 0.004 || Math.abs(facing - pawn.yaw) > 0.01 || Math.abs(how.lit - pawn.lit) > 0.01 || hop > 0.2;
  return { up: rise + (tall - 1) * PAWN_HEIGHT, moving, shock: bump.shock };
}

/** Fades a pawn that is leaving the room: `left` runs from 1 to 0. */
export function fadePawn(pawn, left) {
  pawn.fade = left;
  for (const mesh of pawn.turn.children) {
    // The eyes are shared by every pawn, so a fading pawn gets its own.
    if (mesh.material !== pawn.mat && !mesh.userData.own) {
      mesh.material = mesh.material.clone();
      mesh.userData.own = true;
    }
    mesh.material.transparent = true;
    mesh.material.opacity = left * 0.8;
  }
}
