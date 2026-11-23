// The pieces of the 3D look: the pawn, and how it moves with weight.
//
// Where a piece is, and what it is doing, is decided elsewhere and is the same for every
// drawing: its x comes from the player's Pilot or from the room (lobby/shared), and so do the
// moments "jumped", "bumped" and "was hit". This file only turns those into a pose: it leans
// into a walk, rocks from foot to foot, stretches in the air and squashes on landing.
//
// The pawn is one of the characters (./characters.js lists them; lobby/README.md, "Characters",
// is the interface). What every character shares is here too: the size of a piece, the bump as a
// pose (bumpPose) and the moments the room view writes on a piece's record (startAttack,
// startKnock, resumeKnock).
import * as THREE from "./three.js";
import { PX, SPACE, walkX } from "./space.js";
import { IMMUNE_MS, IMPACT_MS, PIECE_HEAD, PIECE_PIVOT, STUN_MS, impactPoint, knockPose } from "../shared/bump.js";
import { isMoved, moved, movedPose, movedResumed } from "../shared/moves.js";
import { JUMP_HEIGHT, JUMP_MS, WALK_SPEED, jumpHeight } from "../shared/world.js";
import { attackDrawn, landing } from "../move-state.js";
/** The warm glow of a pawn charging its kick (shared/bump.js, chargePose). */
const CHARGE_GLOW = new THREE.Color("#ffc450");

/** How big a piece is beside the room. */
export const SIZE = 0.78;
/** A pawn's height in world units: the height name tags and stickers are placed by, whatever the character. */
export const PAWN_HEIGHT = (1.115 * SIZE) / PX;
const GREY = new THREE.Color("#8a8d94");
const SOOT = new THREE.Color("#1c1512");
const FUMING = new THREE.Color("#ff2a14");
/** The pale a fright gives a piece, and where a pawn's eyes are (model units), to widen them about. */
export const PALE = new THREE.Color("#eef3fb");
const EYES_AT = new THREE.Vector3(0, 0.925, 0.2);
/** How long the startled hop of a piece that a room effect made jump lasts, and how high it goes (world units). */
export const HOP_MS = 420;
export const HOP_HEIGHT = 46;

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
  // The eyes of a piece that has just been knocked over: squeezed shut, a wince (> <), so it reads
  // as "oof" and never as hurt (the owner's pick, character preview round three; crosses read as dead).
  const shut = [];
  const L = 0.05;
  const ANG = 0.5;
  const bar = new THREE.BoxGeometry(L, 0.016, 0.012);
  for (const side of [-1, 1]) {
    // The left eye points in (>), the right eye points in (<): the tips face each other.
    const s = -side;
    const tip = side * 0.055;
    for (const up of [1, -1]) {
      at.position.set(tip - s * Math.cos(ANG) * (L / 2), 0.925 + up * Math.sin(ANG) * (L / 2), 0.207);
      at.rotation.set(0, side * 0.33, -up * s * ANG);
      at.scale.set(1, 1, 1);
      at.updateMatrix();
      shut.push([bar, at.matrix.clone()]);
    }
  }
  return { body, eyes: merged(eyes), glints: merged(glints), shut: merged(shut), blob: new THREE.CircleGeometry(0.5 * SIZE, 24), ring: new THREE.RingGeometry(0.4, 0.47, 48) };
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
  const eyes = new THREE.Mesh(SHAPES.eyes, eyeMat);
  const glints = new THREE.Mesh(SHAPES.glints, glintMat);
  const shut = new THREE.Mesh(SHAPES.shut, eyeMat);
  shut.visible = false;
  const skin = new THREE.Mesh(SHAPES.body, mat);
  turn.add(skin, eyes, glints, shut);
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
  return { group, tilt, turn, mat, blob, ring, skin: [skin], eyes, glints, shut, colour: new THREE.Color(), sq: 1, sqV: 0, lean: 0, leanV: 0, yaw: 0, stride: 0, lit: 0, prevX: null, air: false, fade: 1 };
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

// ---------------------------------------------------------------- THE BUMP, DRAWN
//
// The one place where "what a bump is doing to this piece" becomes a pose. Everything that
// decides anything is lobby/shared/bump.js: who is hit, where they land, how long each state
// lasts and how a piece holds itself in each (attackPose, knockPose), in world units and
// degrees. The flat drawing turns those numbers into SVG (../bump-draw.js); this turns the same
// numbers into a pawn. So the two drawings show the same story at the same moments:
//
//   the bumper   winding (picked up by its head, base swung back) -> striking (the base kicks
//                forward and up, low into the other piece) -> recovering (follows through, set down)
//   the victim   standing -> hit (kicked low) -> flying (thrown feet first, tipping over) -> down (lying on
//                the floor) -> rising -> safe (up, and cannot be knocked again for a while)
//
// A piece's record carries two things the room view (room3d.js) writes when it hears of a bump:
//   piece.attack = {at, dir, landed}
//   piece.knock  = {at, from, to, safeFor, burst, dust}

const UPRIGHT = { x: null, dx: 0, lift: 0, lean: 0, pivot: 0, sx: 1, sy: 1, state: "idle", dizzy: false, safe: false, shock: false, burst: null, dust: null, scared: 0, pale: 0 };
const RAD = Math.PI / 180;
/** The shared poses give the height of a piece's head for the flat pawn; this pawn's head (the middle of its ball) is here. */
const HEAD_SCALE = (0.9 * SIZE) / PX / PIECE_HEAD;

/**
 * How a bump has a piece standing right now.
 *   x      where it is along the floor while it is being thrown (null: wherever it walks)
 *   dx     sideways from there; lift: off the floor (below zero as it lies down); world units
 *   lean   radians, positive tips its head to the left of the screen, about a point `pivot`
 *          world units above its foot
 *   sx, sy stretch
 *   dizzy  eyes squeezed shut (a pawn's wince, > <; a robot's crosses); safe: it cannot be knocked again yet; shock: it was just hit
 *   burst  {x, y} once, at the moment the blow lands; dust: an x once, when it hits the floor
 *   scared, pale  0 to 1: a ghost frightened it (lobby/shared/ghost.js, frightPose): its eyes go
 *          wide and its paint pales, as its own character does them. It starts, freezes and
 *          scurries off upright, about its foot; it is never knocked over by it.
 * `calm`: the viewer asked for less motion (a fright does not shiver then).
 */
export function bumpPose(piece, now, calm = false) {
  // Where a piece the room has already moved stands until its fright or knock begins: its own kick is drawn there.
  let pin = null;
  const f = piece.fright;
  if (f) {
    const pose = movedPose(f, now - f.at, calm);
    // The first frame after its move is over puts it where the room put it, however few frames
    // came in between (as the flat look's BumpDraw.pose: move-state.js, landing).
    const x = pose.x ?? landing(f, pose.state);
    if (pose.state === "up") {
      piece.fright = null;
      if (x !== null) pin = x;
    }
    // Until the kick reaches the ghost the kicker's own kick is drawn (below), where it kicked.
    else if (pose.state === "standing") pin = f.from;
    else {
      // Riding the hook (lobby/shared/robot.js): a pawn that kicks as it is pulled is drawn kicking as it slides.
      const ride = f.kind === "pull" && piece.attack && !piece.attack.charging ? attackDrawn(piece, now, calm) : null;
      if (ride) return { ...UPRIGHT, x, dx: ride.dx, lift: ride.lift, lean: -ride.tilt * RAD, pivot: ride.pivot * HEAD_SCALE, sx: ride.sx, sy: ride.sy, state: ride.state };
      if (pose.face) piece.face = pose.face;
      return { ...UPRIGHT, x, dx: pose.dx, lift: pose.lift, lean: -pose.tilt * RAD, sx: pose.sx, sy: pose.sy, state: pose.state, safe: pose.state === "safe", scared: pose.scared, pale: pose.pale, dizzy: !!pose.dizzy };
    }
  }
  const k = piece.knock;
  if (k) {
    const pose = knockPose(now - k.at, k.from, k.to, k.safeFor, k.extra ?? 0);
    if (pose.state === "up") {
      piece.knock = null;
      const x = landing(k, "up");
      if (x !== null) pin = x;
    } else {
      let burst = null;
      let dust = null;
      if (!k.burst && now - k.at >= IMPACT_MS) {
        k.burst = true;
        burst = impactPoint(k.from, k.to);
      }
      if (!k.dust && (pose.state === "down" || pose.state === "rising")) {
        k.dust = true;
        dust = k.to;
      }
      // Until the blow lands the piece stands where it stood, although the room has already put it
      // where it will land; a kicker knocked back by its own kick (a hardened slime) is drawn
      // kicking until then, as a scared one is.
      const thrown = pose.state !== "standing" && pose.state !== "safe";
      if (pose.state === "standing" && piece.attack) pin = k.from;
      else return { x: pose.state === "safe" ? landing(k, "safe") : pose.x, dx: 0, lift: pose.lift, lean: -pose.tilt * RAD, pivot: PIECE_PIVOT, sx: pose.sx, sy: pose.sy, state: pose.state, dizzy: thrown, safe: pose.state === "safe", shock: pose.state === "hit" || pose.state === "flying", burst, dust };
    }
  }
  // Winding up, charging, dashing, striking or recovering (../move-state.js, attackDrawn).
  const pose = attackDrawn(piece, now, calm);
  // The bumper swings from its head, like a pendulum held at the top: a lean throws its base, not its head.
  if (pose) return { ...UPRIGHT, x: pose.x ?? pin, dx: pose.dx, lift: pose.lift, lean: -pose.tilt * RAD, pivot: pose.pivot * HEAD_SCALE, sx: pose.sx, sy: pose.sy, state: pose.state, charge: pose.charge ?? 0 };
  return pin === null ? UPRIGHT : { ...UPRIGHT, x: pin };
}

/** A piece began a bump at `now`, facing `dir`. `landed`: it hit somebody (known once the room says). */
export function startAttack(piece, dir, now, landed = false) {
  piece.attack = { at: now, dir: dir || 1, landed };
}

/** A piece was knocked from where it is drawn (or `from`) to `to`. `at` is when the bump that did it began; `extra`, how much longer than a knock it lies down. */
export function startKnock(piece, to, at, extra = 0, from = piece.rx) {
  piece.knock = { at, from: from ?? piece.rx, to, safeFor: IMMUNE_MS, burst: false, dust: false, extra };
  // A kick it was charging is lost with it (the room forgets it too).
  if (piece.attack?.charging) piece.attack = null;
}

/**
 * The room moved a piece some other way than a kick, from where it is drawn (or `from`) to `to`
 * (lobby/shared/moves.js): `kind` "scare" or "bigscare" (it kicked a faded ghost; `at` is when its
 * kick began), "spook", "hookscare", "pull", "bonk" or "shove" (`at` is now).
 */
export function startFright(piece, to, at, kind, from = piece.rx) {
  piece.fright = moved(kind, from ?? piece.rx, to, at);
  piece.knock = null;
  if (piece.attack?.charging) piece.attack = null;
}

/**
 * The room says a piece is on the floor or just up from it (for a page that arrived in the
 * middle): knocked (`extra`: down that much longer), or moved another way (`fright`,
 * lobby/shared/moves.js), drawn as what it is.
 */
export function resumeKnock(piece, x, down, safe, now, fright, extra = 0) {
  if (piece.knock || piece.fright || !(safe > 0)) return;
  if (isMoved(fright)) return void (piece.fright = movedResumed(x, down, safe, fright, now));
  piece.knock = { at: now - (STUN_MS + extra - down), from: x, to: x, safeFor: safe - down, burst: true, dust: true, extra };
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
 * @param {object} piece   the drawing's record: {rx, face, jumpAt, attack, knock, fx, seat}
 * @param {number} now     performance.now()
 * @param {number} dt      seconds since the last frame
 * @param {{walking: boolean, lit: number, calm: boolean}} how  whether it is walking, how bright the light it stands in is (0 to 1), and whether the viewer asked for less motion
 * @returns {{up, moving, shock, burst, dust, state}} how far its head is above standing height (world
 *   units), whether anything about it is still moving, whether it was just hit, and the bump's
 *   burst and dust for this frame, if any (see bumpPose)
 */
export function posePawn(pawn, piece, now, dt, how) {
  const step = Math.min(dt, 1 / 30);
  // Winding up, striking, thrown, lying or getting up: the bump's pose, on top of the walk.
  const bump = bumpPose(piece, now, how.calm);
  const thrown = bump.x !== null;
  if (thrown) piece.rx = bump.x;
  pawn.prevX ??= piece.rx;
  // A piece that is being thrown is not walking: it does not lean into where it is flung.
  const speed = step > 0 && !thrown ? Math.max(-1.4, Math.min(1.4, (piece.rx - pawn.prevX) / step / WALK_SPEED)) : 0;
  pawn.prevX = piece.rx;

  // In the air: a stretch on the way up, and a kick into a squash when the floor comes back.
  const sinceJump = now - piece.jumpAt;
  // The pawn jumps highest (shared/world.js, jumpTopOf).
  const up = jumpHeight(sinceJump, JUMP_HEIGHT);
  const air = sinceJump >= 0 && sinceJump < JUMP_MS;
  if (air && !pawn.air) pawn.sqV += 2.6;
  if (!air && pawn.air) pawn.sqV -= 5.2;
  pawn.air = air;

  // On the floor: a rock from foot to foot whose beat follows the distance covered.
  const walking = how.walking && !air && !thrown;
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

  const tall = Math.max(0.6, pawn.sq);
  const wide = 1 / Math.sqrt(tall);
  // A room effect may ask for a startled hop (look3d/life.js). It is drawn here and goes nowhere: the piece's x is untouched.
  const startle = (now - (piece.fx?.hopAt ?? -Infinity)) / HOP_MS;
  const yelp = startle >= 0 && startle < 1 ? 4 * HOP_HEIGHT * startle * (1 - startle) : 0;
  const rise = up + hop + bump.lift + yelp;
  // The bump tips a piece about a point above its foot (its middle, when it is knocked over), so the foot swings out from under it.
  const pivot = bump.pivot * PX;
  pawn.group.position.set(walkX(piece.rx + bump.dx) + pivot * Math.sin(bump.lean), rise * PX + pivot * (1 - Math.cos(bump.lean)), SPACE.walkZ);
  pawn.tilt.rotation.z = (thrown ? 0 : pawn.lean + rock) + bump.lean;
  pawn.tilt.scale.set(SIZE * wide * bump.sx, SIZE * tall * bump.sy, SIZE * wide * bump.sx);
  pawn.turn.rotation.y = thrown ? pawn.yaw * 0.3 : pawn.yaw;
  if (bump.dizzy !== pawn.dizzy) {
    pawn.dizzy = bump.dizzy;
    pawn.shut.visible = bump.dizzy;
    pawn.eyes.visible = pawn.glints.visible = !bump.dizzy;
  }
  // Frightened by a ghost: the eyes go wide, grown about their own middle.
  if (bump.scared !== (pawn.scaredK ?? 0)) {
    pawn.scaredK = bump.scared;
    const k = 1 + 0.45 * bump.scared;
    for (const mesh of [pawn.eyes, pawn.glints]) {
      mesh.scale.setScalar(k);
      mesh.position.copy(EYES_AT).multiplyScalar(1 - k);
    }
  }

  // The shadow stays on the floor and tightens as the piece leaves it.
  const off = Math.max(0.45, 1 - Math.max(0, rise) * PX * 0.6);
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
  // Up again and not to be knocked for a while: it flickers (it only glows steadily for people who asked for less motion).
  if (bump.safe) pawn.mat.emissiveIntensity += how.calm ? 0.25 : 0.55 * Math.abs(Math.sin(now / 70));
  // Frightened by a ghost: a lighter, paler tint while it lasts (the owner's pick for the scare).
  pawn.pale = bump.pale;
  if (bump.pale > 0) {
    pawn.mat.color.lerp(PALE, 0.5 * bump.pale);
    pawn.mat.emissive.lerp(PALE, 0.4 * bump.pale);
  }
  // Charging its kick: a warm glow, brighter the harder it is held (the same with less motion).
  pawn.charge = bump.charge ?? 0;
  if (pawn.charge > 0) {
    // Its own colour still reads through the glow.
    pawn.mat.emissive.lerp(CHARGE_GLOW, 0.2 + 0.35 * pawn.charge);
    pawn.mat.emissiveIntensity += 0.2 + 0.5 * pawn.charge;
  }

  const moving = walking || air || bump.state !== "idle" || yelp > 0 || Math.abs(pawn.sqV) > 0.02 || Math.abs(pawn.leanV) > 0.01 || Math.abs(pawn.lean) > 0.004 || Math.abs(facing - pawn.yaw) > 0.01 || Math.abs(how.lit - pawn.lit) > 0.01 || hop > 0.2;
  return { up: rise + (tall - 1) * PAWN_HEIGHT, moving, shock: bump.shock, burst: bump.burst, dust: bump.dust, state: bump.state };
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

/**
 * An emote's pose on the pawn for this frame, after posePawn: the body lifted, nudged and leaned
 * about its foot, on top of whatever the walk and the bump did, and the red of fuming.
 * `metres` is model metres per rig unit.
 */
export function emotePawn(pawn, pose, metres) {
  const b = pose.body;
  pawn.group.position.x += b.dx * metres;
  pawn.group.position.y += b.lift * metres;
  pawn.tilt.rotation.z -= (b.rot * Math.PI) / 180;
  if (b.tint > 0) {
    pawn.mat.color.lerp(FUMING, b.tint * 0.8);
    pawn.mat.emissive.lerp(FUMING, b.tint * 0.6);
  }
}

/**
 * The baked look has real light, so the paint is not dimmed outside a pool or made to glow
 * inside one: the pawn in its true colour, shinier, keeping only the flicker of a piece that
 * cannot be knocked again yet.
 */
export function bakePawn(pawn) {
  if (!pawn.baked) {
    pawn.baked = true;
    pawn.mat.roughness = 0.3;
    pawn.mat.clearcoat = 1;
    pawn.mat.clearcoatRoughness = 0.12;
    pawn.mat.envMapIntensity = 1;
  }
  const flicker = Math.max(0, pawn.mat.emissiveIntensity - (0.09 + 0.27 * pawn.lit) - 0.01);
  pawn.mat.color.copy(pawn.colour);
  if (pawn.pale > 0) pawn.mat.color.lerp(PALE, 0.5 * pawn.pale);
  pawn.mat.emissiveIntensity = 0.035 + flicker * 0.6;
}
