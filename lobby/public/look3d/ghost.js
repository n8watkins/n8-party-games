// The ghost of the 3D look: a turned sheet with a hem dipped in the player's colour, five lobes
// along the hem, two nub arms, two eyes and a mouth. It never stands: it hangs above the floor,
// bobs, and its hem trails behind it like a sheet. The model is the one the owner approved in
// the character previews; the flat look draws the same ghost in SVG (../characters/ghost.js).
//
// It is one of the characters (./characters.js; lobby/README.md, "Characters"): the same handles
// as the pawn (pieces.js: group, tilt, turn, mat, blob, ring, colour, lit, fade, air, dizzy), the
// same moments from the room (a walk, a jump, a bump's pose from lobby/shared/bump.js), its own
// way of showing them. Where the pawn gets crosses for eyes, the ghost squeezes its eyes shut.
//
// Cost: a ghost is five draws (the sheet; the lobes and nubs as one instanced mesh; the eyes;
// their glints; the mouth) plus its shadow, about what a pawn is, in fewer triangles. The sheet's
// 300-odd points are moved every frame (that is its cost over a pawn: measured by
// lobby/test/e2e-characters.mjs --measure), nothing is made per frame, and its idle hover does
// not keep the room drawing every frame.
//
// `piece.faded` (nothing sets it yet) is where the ghost's own move comes in: the model already
// knows how to be see-through, lighter and higher (fadeK below).
import * as THREE from "./three.js";
import { GHOST, WISP, joinOf, wispAt, wispHalf } from "../characters/ghost-rig.js";
import { isPale } from "../shared/characters.js";
import { JUMP_MS, WALK_SPEED, jumpHeight } from "../shared/world.js";
import { EmoteArms, RIG_UNIT } from "./emote-arms.js";
import { HOP_HEIGHT, HOP_MS, PAWN_HEIGHT, SIZE, bumpPose } from "./pieces.js";
import { PX, SPACE, walkX } from "./space.js";

const TOP = 0.96;
/** Where the sheet's edge is, between two scallops, and how far each scallop hangs below it (model units). */
const HEM = 0.15;
const SCALLOP = 0.095;
/** How many scallops along the hem. */
const SCALLOPS = 5;
/** The hem's colour: full below BAND_LOW, none above BAND_HIGH (model units, before the scallops). */
const BAND_LOW = 0.27;
const BAND_HIGH = 0.43;
/** How much higher than the flat drawing's the 3D ghost hangs (world units): the air under its hem must show from the whole-room view. */
const LIFT = 9;
/** The ghost's height in world units, and how far that is below a pawn's. */
const GHOST_HEIGHT = (TOP * SIZE) / PX;
const BELOW_PAWN = PAWN_HEIGHT - GHOST_HEIGHT;
/** Model units per world unit. */
const MU = PX / SIZE;
/** How many sides the turned sheet has (six to a scallop), and how many steps its round top: enough at the size a piece is drawn, and no more (its points are moved every frame). */
const SEG = 30;
const DOME = 8;
const RAD = Math.PI / 180;
/** How much the sheet glows by itself in the dark (the emissive strength of its materials). */
const GLOW = 0.16;
/** How bright a dropped player's sheet is against a connected one's. */
const DROPPED = 0.62;
/**
 * Below these a ghost is still, and the room need not draw every frame for it (poseGhost's
 * `moving`): how far its hem trails behind (model units), and how fast its trail, squash, lean and
 * swell springs move. Its idle life (hover, bob, breath, ripple) is laid on outside the springs,
 * so an idle ghost sits at none of these, far from any of them.
 */
export const STILL = { trail: 0.004, trailV: 3, squashV: 0.03, leanV: 0.01, puffV: 0.02 };

const INK = 0x0a0d18;
const WHITE = new THREE.Color(0xffffff);
const GREY = new THREE.Color("#8a8d94");
const SOOT = new THREE.Color("#1c1512");
const FUMING = new THREE.Color("#ff2a14");
const tmpC = new THREE.Color();
const at = new THREE.Object3D();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, u) => a + (b - a) * u;
const smooth = (u) => {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
};
function spring(value, velocity, target, stiffness, damping, dt) {
  velocity += ((target - value) * stiffness - velocity * damping) * dt;
  return [value + velocity * dt, velocity];
}

/**
 * How the sheet keeps its own colours under any room's light. The room's light is warm (lamps,
 * candles, a neon sign) and a white sheet lit only by it turns beige and grey: the sheet takes
 * from the light only how bright it is, never its hue, so white stays white and the hem stays the
 * player's colour; part of it is the sheet's own glow (UNLIT), as a ghost's may be; and a cool
 * rim of light outlines it against a warm wall. The numbers keep the brightest of it under white,
 * so it is never blown out.
 */
export const SHEET_LIGHT = { unlit: 0.62, min: 0.5, max: 1.2, rim: 0.3, rimColour: [0.7, 0.84, 1.0] };

/** A toy material in the room's style, lit as the sheet is (SHEET_LIGHT), with a warm rim of light for a ghost that has faded. */
function toyMat(opts) {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.25, emissiveIntensity: 0.3, ...opts });
  mat.userData.rim = { value: 0 };
  const L = SHEET_LIGHT;
  const f = (n) => n.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = mat.userData.rim;
    shader.fragmentShader =
      "uniform float uRim;\n" +
      shader.fragmentShader
        .replace(
          "#include <opaque_fragment>",
          [
            "{",
            "  vec3 luma = vec3(0.2126, 0.7152, 0.0722);",
            "  float shade = clamp(dot(outgoingLight, luma) / max(dot(diffuseColor.rgb, luma), 0.02), " + f(L.min) + ", " + f(L.max) + ");",
            "  outgoingLight = diffuseColor.rgb * mix(shade, 1.0, " + f(L.unlit) + ");",
            "  float coolK = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.6);",
            "  outgoingLight += vec3(" + L.rimColour.map(f).join(", ") + ") * coolK * " + f(L.rim) + ";",
            "}",
            "#include <opaque_fragment>",
          ].join("\n"),
        )
        .replace(
          "#include <dithering_fragment>",
          "float rimK = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.6);\n gl_FragColor.rgb += vec3(1.0, 0.9, 0.74) * rimK * uRim;\n#include <dithering_fragment>",
        );
  };
  // One program for every ghost's materials of the same kind.
  mat.customProgramCacheKey = () => "ghost-sheet";
  return mat;
}

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

/** Where the eyes sit on the sheet: how far round from the front, how high, how far out. */
const EYE = { a: 0.37, y: 0.725, r: 0.246, w: 0.04, h: 0.06 };
const MOUTH = { y: 0.585, z: 0.258 };
const weight = (y) => Math.pow(clamp((TOP - y) / (TOP - HEM), 0, 1.05), 1.7);

/** What every ghost shares: the sheet's profile, a ball, the two eyes and their glints, the mouths, a shadow, a ring. */
let SHAPES = null;
function shapes() {
  // A sheet, not a solid: hollow underneath (the underside rises into it), its edge flared out a
  // little past its sides, which narrow toward a round top. The rows nearest the edge hang into
  // scallops (scallop(), in makeGhost); `hang` is how much of a scallop each row takes.
  const profile = [[0, 0.4], [0.13, 0.36], [0.24, 0.25], [0.3, HEM], [0.293, 0.23], [0.279, 0.33], [0.266, 0.45], [0.255, 0.56], [0.248, 0.64]];
  const hang = [0, 0.15, 0.7, 1, 0.55, 0.12, 0, 0, 0];
  for (let i = 1; i <= DOME; i++) {
    const a = (i / DOME) * Math.PI * 0.5;
    profile.push([0.248 * Math.cos(a), 0.64 + (TOP - 0.64) * Math.sin(a)]);
    hang.push(0);
  }
  const ball = new THREE.SphereGeometry(1, 12, 8);
  const eyes = [];
  const glints = [];
  for (const side of [-1, 1]) {
    const a = side * EYE.a;
    // Around the eyes' own height, so one scale in y blinks both.
    at.position.set(Math.sin(a) * EYE.r, 0, Math.cos(a) * EYE.r);
    at.rotation.set(0, a, 0);
    at.scale.set(EYE.w, EYE.h, EYE.w * 0.6);
    at.updateMatrix();
    eyes.push([ball, at.matrix.clone()]);
    at.position.set(Math.sin(a) * (EYE.r + 0.017) + EYE.w * 0.2, EYE.h * 0.42, Math.cos(a) * (EYE.r + 0.017));
    at.scale.set(EYE.w * 0.32, EYE.h * 0.25, EYE.w * 0.24);
    at.updateMatrix();
    glints.push([ball, at.matrix.clone()]);
  }
  return {
    profile,
    hang,
    rows: profile.length,
    ball,
    eyes: merged(eyes),
    glints: merged(glints),
    curve: new THREE.TorusGeometry(1, 0.24, 6, 12, Math.PI),
    blob: new THREE.CircleGeometry(0.5 * SIZE * 0.92, 24),
    ring: new THREE.RingGeometry(0.4, 0.47, 48),
  };
}

const eyeMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.25 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const mouthMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.3 });
/** A see-through ghost is drawn in two passes, depth first, so its far side never shows through its near side. */
const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });

/** How the mouth sits for each of the rig's mouth names: [wide, tall] against its resting oval. */
const MOUTHS = { grin: [1.7, 1.15], laugh: [1.8, 1.6], o: [1.1, 1.35], chew: [1.25, 0.7], purse: [0.62, 0.62], flat: [1.45, 0.28], grit: [1.75, 0.55], squiggle: [1.35, 0.3] };
/** The two mouths that are a curve, not an oval: 1 turns up, -1 turns down. */
const CURVES = { smile: 1, frown: -1 };
const blinkAt = (now, seed) => {
  const t = (now + seed * 977) % 3400;
  return t < 130 ? Math.sin((t / 130) * Math.PI) : 0;
};

/** Which way round the sheet's points run: 1 or -1, so sheetNormals points outward. Found once, on the first sheet. */
let OUTWARD = 0;

/**
 * The sheet's normals after its points have moved. The sheet is a grid (SEG + 1 columns round
 * it, each `rows` points from the middle of the underside to the top), so a point's normal is
 * the cross of its two neighbours across and its two neighbours along: a few hundred small sums,
 * a tenth of what the general method costs, and the two edges of the seam come out the same.
 */
function sheetNormals(geo) {
  const p = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const R = SHAPES.rows;
  const sign = OUTWARD || 1;
  for (let i = 0; i <= SEG; i++) {
    const ia = (i === 0 ? SEG - 1 : i - 1) * R;
    const ib = (i === SEG ? 1 : i + 1) * R;
    for (let j = 0; j < R; j++) {
      const k = (i * R + j) * 3;
      const a = (ia + j) * 3;
      const b = (ib + j) * 3;
      const c = (i * R + (j === 0 ? 0 : j - 1)) * 3;
      const d = (i * R + (j === R - 1 ? j : j + 1)) * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const vx = p[d] - p[c];
      const vy = p[d + 1] - p[c + 1];
      const vz = p[d + 2] - p[c + 2];
      const nx = (uy * vz - uz * vy) * sign;
      const ny = (uz * vx - ux * vz) * sign;
      const nz = (ux * vy - uy * vx) * sign;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) {
        // The two points on the axis: the middle of the underside looks down, the top looks up.
        nor[k] = 0;
        nor[k + 1] = j === 0 ? -1 : 1;
        nor[k + 2] = 0;
      } else {
        nor[k] = nx / l;
        nor[k + 1] = ny / l;
        nor[k + 2] = nz / l;
      }
    }
  }
  if (!OUTWARD) {
    // A point on the side of the sheet, a little round from the seam: its normal must point away from the axis.
    const k = (2 * R + 5) * 3;
    OUTWARD = nor[k] * p[k] + nor[k + 2] * p[k + 2] >= 0 ? 1 : -1;
    if (OUTWARD < 0) return sheetNormals(geo);
  }
  geo.attributes.normal.needsUpdate = true;
}

/**
 * A ghost, hanging over the origin of its own group. `radial` is the soft round texture its
 * shadow is cut from. Returns the handles poseGhost needs; the first of them are the same as a pawn's.
 */
export function makeGhost(radial) {
  SHAPES ??= shapes();
  const geo = new THREE.LatheGeometry(SHAPES.profile.map(([x, y]) => new THREE.Vector2(x, y)), SEG);
  const pos = geo.attributes.position;
  const n = pos.count;
  // The scallops: the rows by the edge hang down in round humps, one in the middle of the front.
  const R = SHAPES.rows;
  for (let i = 0; i <= SEG; i++) {
    const hump = Math.pow(Math.abs(Math.cos((SCALLOPS / 2) * ((i / SEG) * Math.PI * 2))), 0.55);
    for (let j = 0; j < R; j++) pos.array[(i * R + j) * 3 + 1] -= SCALLOP * SHAPES.hang[j] * hump;
  }
  const base = Float32Array.from(pos.array);
  // The ripple runs three waves round the sheet: sin(3a + phase), kept as its two parts so no point needs a sine every frame.
  const rs = new Float32Array(n);
  const rc = new Float32Array(n);
  const wk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = 3 * Math.atan2(base[i * 3 + 2], base[i * 3]);
    rs[i] = Math.sin(a);
    rc[i] = Math.cos(a);
    wk[i] = weight(base[i * 3 + 1]);
  }
  // How much of the player's colour each point of the sheet takes: the hem, and a short way up into the white.
  const band = new Float32Array(n);
  for (let i = 0; i < n; i++) band[i] = smooth((BAND_HIGH - base[i * 3 + 1]) / (BAND_HIGH - BAND_LOW));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = toyMat({ vertexColors: true });
  const softMat = toyMat({});
  const turn = new THREE.Group();
  const body = new THREE.Mesh(geo, mat);
  // The two nub arms: two balls, one draw.
  const soft = new THREE.InstancedMesh(SHAPES.ball, softMat, 2);
  soft.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  soft.frustumCulled = false;
  const prepass = [body, soft].map((mesh) => {
    mesh.renderOrder = 6;
    const pre = mesh.isInstancedMesh ? new THREE.InstancedMesh(mesh.geometry, depthMat, 2) : new THREE.Mesh(mesh.geometry, depthMat);
    if (pre.isInstancedMesh) pre.instanceMatrix = mesh.instanceMatrix;
    pre.renderOrder = 5;
    pre.visible = false;
    pre.frustumCulled = false;
    mesh.add(pre);
    return pre;
  });
  const eyes = new THREE.Mesh(SHAPES.eyes, eyeMat);
  const glints = new THREE.Mesh(SHAPES.glints, glintMat);
  const mouthAt = new THREE.Group();
  const mouth = new THREE.Mesh(SHAPES.ball, mouthMat);
  const curve = new THREE.Mesh(SHAPES.curve, mouthMat);
  curve.visible = false;
  mouthAt.add(mouth, curve);
  for (const o of [eyes, glints, mouth, curve]) o.renderOrder = 7;
  turn.add(body, soft, eyes, glints, mouthAt);
  const tilt = new THREE.Group();
  tilt.add(turn);
  const group = new THREE.Group();
  group.add(tilt);
  // One soft shadow, with no dark spot pinning it to the floor (a pawn's has one): it floats.
  const blob = new THREE.Mesh(SHAPES.blob, new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  const ring = new THREE.Mesh(SHAPES.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  ring.visible = false;
  return {
    // The handles every character has (see pieces.js makePawn). `colour` is the sheet's own (white): the player's colour is in `hem`.
    group, tilt, turn, mat, blob, ring, skin: [body, soft], colour: new THREE.Color(0xffffff), lit: 0, fade: 1, air: false, dizzy: false, connected: true,
    // The ghost's own.
    geo, base, rs, rc, wk, band, softMat, soft, prepass, eyes, glints, mouthAt, mouth, curve, faceMats: null,
    hem: new THREE.Color(), nub: new THREE.Color(), glow: new THREE.Color(),
    sq: 1, sqV: 0, lean: 0, leanV: 0, yaw: 0, prevX: null, trX: null, trV: 0, trY: 0, trYV: 0, bobT: 0, arm: 0, armV: 0, puff: 0, puffV: 0, nubK: 1, fadeK: 0, ground: 0, opacity: 1, clear: false, want: null, tick: 0, busy: true, shaped: false,
  };
}

/** Colours a ghost's hem for its player, or grey for one who has dropped and is expected back. */
export function dressGhost(g, hex, connected) {
  const hsl = {};
  tmpC.set(hex).getHSL(hsl);
  // The hem: the player's colour, kept bright enough to read against the white above it and the dark floor under it.
  if (!connected) g.hem.copy(GREY);
  // A very pale colour stays pale: darkened to "read" it would only look like dirt on the sheet.
  else if (isPale(hex)) g.hem.setHSL(hsl.h, Math.min(hsl.s, 0.55), clamp(hsl.l - 0.1, 0.72, 0.84));
  else if (hsl.s < 0.08) g.hem.setHSL(0, 0, clamp(hsl.l, 0.35, 0.72));
  else g.hem.setHSL(hsl.h, clamp(Math.max(hsl.s, 0.25) * 0.95 + 0.1, 0, 1), clamp(mix(hsl.l, 0.6, 0.55), 0.42, 0.74));
  g.connected = connected;
  const cols = g.geo.attributes.color;
  for (let i = 0; i < cols.count; i++) {
    tmpC.setRGB(1, 1, 1).lerp(g.hem, g.band[i]);
    cols.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
  }
  cols.needsUpdate = true;
  // The nub arms are the sheet's own: white, as in the flat drawing.
  g.nub.setRGB(1, 1, 1);
  g.glow.setRGB(1, 1, 1);
  for (let i = 0; i < 2; i++) g.soft.setColorAt(i, g.nub);
  g.soft.instanceColor.needsUpdate = true;
}

export function disposeGhost(g) {
  g.geo.dispose();
  g.mat.dispose();
  g.softMat.dispose();
  g.soft.dispose();
  for (const mat of g.faceMats ?? []) mat.dispose();
  g.blob.material.dispose();
  g.ring.material.dispose();
}

/** Fades a ghost that is leaving the room: `left` runs from 1 to 0. */
export function fadeGhost(g, left) {
  g.fade = left;
  // The face is shared by every ghost, so a fading ghost gets its own.
  if (!g.faceMats) {
    g.faceMats = [g.eyes, g.glints, g.mouth].map((mesh) => (mesh.material = mesh.material.clone()));
    g.curve.material = g.mouth.material;
    for (const mat of g.faceMats) mat.transparent = true;
  }
  for (const mat of g.faceMats) mat.opacity = left * 0.8;
}

/**
 * Hangs a ghost where its piece is, for this frame. The same call as posePawn (pieces.js), and
 * the same answer: {up, moving, shock, burst, dust, state}, where `up` is how far the top of its
 * head is above a standing pawn's (world units; a ghost is shorter, and it hovers).
 */
export function poseGhost(g, piece, now, dt, how) {
  const step = Math.min(dt, 1 / 30);
  const calm = how.calm;
  const bump = bumpPose(piece, now);
  const thrown = bump.x !== null;
  if (thrown) piece.rx = bump.x;
  g.prevX ??= piece.rx;
  const speed = step > 0 && !thrown ? clamp((piece.rx - g.prevX) / step / WALK_SPEED, -1.4, 1.4) : 0;
  g.prevX = piece.rx;

  const sinceJump = now - piece.jumpAt;
  const up = jumpHeight(sinceJump);
  const air = sinceJump >= 0 && sinceJump < JUMP_MS;
  if (air && !g.air) g.sqV += 2.6;
  if (!air && g.air) g.sqV -= 5.2;
  g.air = air;

  // What an emote asked of the body last frame (emoteGhost): the turn of its face, a swell, its nubs tucked away.
  const want = g.want;
  g.want = null;
  const fl = (g.fadeK += ((piece.faded ? 1 : 0) - g.fadeK) * Math.min(1, step * 9));
  // Knocked over, it lies on the floor like anything else; then it lifts off again.
  g.ground += ((bump.dizzy ? 1 : 0) - g.ground) * Math.min(1, step * 14);
  const floaty = 1 - g.ground;

  // The squash springs only for what happens to it (a jump, a landing); its breath is laid on top,
  // outside the spring, so the slow life of an idle ghost never reads as movement (STILL).
  const breath = calm ? 0 : 0.02 * Math.sin(now / 700 + piece.seat * 1.7);
  [g.sq, g.sqV] = spring(g.sq, g.sqV, air ? 1.07 : 1, 150, 10, step);
  g.sq = clamp(g.sq, 0.68, 1.25);
  [g.lean, g.leanV] = spring(g.lean, g.leanV, -speed * 0.1, 95, 12, step);
  [g.puff, g.puffV] = spring(g.puff, g.puffV, want ? want.puff : 0, 240, 13, step);
  const walking = how.walking && !thrown;
  const facing = walking ? Math.sign(speed || piece.face) * 0.7 : want ? want.yaw : GHOST.yaw * piece.face;
  g.yaw += (facing - g.yaw) * Math.min(1, step * 10);

  // It never stands: it hangs in the air and bobs, slower and wider when it has faded.
  if (!calm) g.bobT += step * (2.7 - fl);
  const bob = calm ? 0 : Math.sin(g.bobT) * (5 + 7 * fl) + Math.sin(g.bobT * 0.47 + 1) * 2.5;
  const hover = (GHOST.hover + LIFT + 16 * fl + bob) * floaty;
  const sway = calm ? 0 : Math.sin(g.bobT * 0.62) * 0.035 * (1 + 1.4 * fl) * floaty;
  const startle = (now - (piece.fx?.hopAt ?? -Infinity)) / HOP_MS;
  const yelp = startle >= 0 && startle < 1 ? 4 * HOP_HEIGHT * startle * (1 - startle) : 0;
  const tall = Math.max(0.6, g.sq + breath);
  const wide = 1 / Math.sqrt(tall);
  const rise = up + bump.lift + yelp + hover;
  const X = piece.rx + bump.dx;

  // The hem trails behind the head, sideways and up and down, like a sheet.
  if (g.trX === null) {
    g.trX = X;
    g.trY = rise;
  }
  // In as many small steps as the frame was long (four at most): on a device that draws slowly the hem would otherwise catch up in slow motion.
  for (let left = Math.min(dt, 4 / 30); left > 1e-4; left -= 1 / 30) {
    const h = Math.min(left, 1 / 30);
    [g.trX, g.trV] = spring(g.trX, g.trV, X, 85, 9.5, h);
    [g.trY, g.trYV] = spring(g.trY, g.trYV, rise, 120, 9, h);
  }
  const dX = clamp((g.trX - X) * MU, -0.23, 0.23);
  const dY = clamp((g.trY - rise) * MU, -0.12, 0.1);

  const pivot = bump.pivot * PX;
  g.group.position.set(walkX(X) + pivot * Math.sin(bump.lean), rise * PX + pivot * (1 - Math.cos(bump.lean)), SPACE.walkZ);
  g.tilt.rotation.z = (thrown ? 0 : g.lean + sway) + bump.lean;
  g.tilt.scale.set(SIZE * wide * bump.sx * (1 + g.puff), SIZE * tall * bump.sy * (1 + g.puff * 0.6), SIZE * wide * bump.sx * (1 + g.puff));
  const yaw = thrown ? g.yaw * 0.3 : g.yaw;
  g.turn.rotation.y = yaw;

  // The sheet: flared and rippling toward the hem, dragged by the trail.
  const dLx = dX * Math.cos(yaw);
  const dLz = dX * Math.sin(yaw);
  const flare = 0.05 + (1 - tall) * 1.3 + Math.max(0, -dY) * 0.5;
  const ripple = calm ? 0 : 0.022 + 0.03 * fl;
  const phase = now * 0.0065;
  const sinP = Math.sin(phase);
  const cosP = Math.cos(phase);
  const still = calm && Math.abs(dX) < 0.001 && Math.abs(dY) < 0.001 && Math.abs(g.sqV) < 0.02;
  // While it only hovers the room draws every second or third frame, and the sheet is shaped every second one.
  g.tick = (g.tick + 1) & 1;
  if (!g.shaped || (!still && (g.busy || g.tick))) {
    g.shaped = true;
    const arr = g.geo.attributes.position.array;
    const base = g.base;
    for (let i = 0, n = g.wk.length; i < n; i++) {
      const k = g.wk[i];
      const f = 1 + flare * k + ripple * k * (g.rs[i] * cosP + g.rc[i] * sinP);
      arr[i * 3] = base[i * 3] * f + dLx * k;
      arr[i * 3 + 1] = base[i * 3 + 1] + dY * k;
      arr[i * 3 + 2] = base[i * 3 + 2] * f + dLz * k;
    }
    g.geo.attributes.position.needsUpdate = true;
    sheetNormals(g.geo);
  }
  // Its own nub arms: a little lift while it idles, tucked away while an emote gives it hands.
  g.nubK += ((want ? want.nubs : 1) - g.nubK) * Math.min(1, step * 18);
  [g.arm, g.armV] = spring(g.arm, g.armV, 0.08 + (calm ? 0 : 0.1 * Math.sin(g.bobT * 0.8)), 190, 12, step);
  const nk = weight(0.5);
  for (const side of [-1, 1]) {
    const a = g.arm * 0.95;
    at.position.set(side * (0.24 + 0.085 * Math.cos(a)) + dLx * nk, 0.5 + 0.085 * Math.sin(a) + dY * nk, 0.03 + dLz * nk);
    at.rotation.set(0, 0, side * a);
    at.scale.set(0.11, 0.066, 0.066).multiplyScalar(Math.max(0.001, g.nubK));
    at.updateMatrix();
    g.soft.setMatrixAt(side < 0 ? 0 : 1, at.matrix);
  }
  g.soft.instanceMatrix.needsUpdate = true;

  // The face rides the sheet. Squeezed shut while it is thrown and lying; a blink now and then.
  const ek = weight(EYE.y);
  const mk = weight(MOUTH.y);
  g.eyes.position.set(dLx * ek, EYE.y + dY * ek, dLz * ek);
  g.glints.position.copy(g.eyes.position);
  g.mouthAt.position.set(dLx * mk, MOUTH.y + dY * mk, MOUTH.z + dLz * mk);
  g.dizzy = bump.dizzy;
  faceGhost(g, bump.dizzy ? 0.9 : calm ? 0 : blinkAt(now, piece.seat), 1, null);

  // The shadow stays on the floor and tightens as the ghost leaves it; a faded ghost barely has one.
  const off = Math.max(0.45, 1 - Math.max(0, rise) * PX * 0.6);
  g.blob.position.set(walkX(X), 0.008, SPACE.walkZ);
  g.blob.scale.setScalar(off * wide * 1.15);
  g.blob.material.opacity = 0.72 * off * 0.85 * (1 - 0.7 * fl) * g.fade;
  g.ring.position.set(walkX(piece.rx), 0.012, SPACE.walkZ);

  // Brighter under a lamp, dimmer in the dark between two; see-through when it has faded or is leaving.
  g.lit += (how.lit - g.lit) * Math.min(1, step * 8);
  const lit = g.lit * (1 - 0.35 * fl);
  const char = piece.fx?.char ?? 0;
  // A white sheet dimmed as far as a pawn's paint is turns to mud: it keeps most of its white in the dark, and glows a little, as a ghost may.
  const k = mix(0.84 + 0.16 * lit, 1, fl) * (g.connected ? 1 : DROPPED);
  g.opacity = clamp(1 - 0.5 * fl, 0.2, 1) * (g.fade < 1 ? g.fade * 0.8 : 1);
  const clear = g.opacity < 0.985;
  for (const m of [g.mat, g.softMat]) {
    m.color.copy(WHITE).multiplyScalar(k).lerp(SOOT, char * 0.82);
    m.emissive.copy(g.glow).lerp(SOOT, char);
    m.emissiveIntensity = (g.connected ? GLOW : 0.04) + 0.14 * lit + 1.1 * fl;
    if (m.transparent !== clear) {
      m.transparent = clear;
      m.needsUpdate = true;
    }
    m.opacity = g.opacity;
    m.userData.rim.value = 0.12 + 0.9 * fl;
  }
  if (g.clear !== clear) for (const pre of g.prepass) pre.visible = g.clear = clear;
  // Up again and not to be knocked for a while: it flickers (it only glows steadily for people who asked for less motion).
  if (bump.safe) g.mat.emissiveIntensity += how.calm ? 0.25 : 0.55 * Math.abs(Math.sin(now / 70));

  // Its hover, bob and ripple are slow, and are not "moving": like a room's own ambient life they are drawn at the still room's rate
  // (room3d.js draws every frame only while something moves), so a room of idle ghosts costs what a room of idle pawns does.
  const moving =
    walking || air || bump.state !== "idle" || yelp > 0 || Math.abs(dX) > STILL.trail || Math.abs(g.trV) > STILL.trailV || Math.abs(g.sqV) > STILL.squashV || Math.abs(g.leanV) > STILL.leanV || Math.abs(g.puffV) > STILL.puffV ||
    Math.abs(facing - g.yaw) > 0.01 || Math.abs(how.lit - g.lit) > 0.01 || (fl > 0.01 && fl < 0.99);
  g.busy = moving;
  return { up: rise + (tall - 1) * GHOST_HEIGHT - BELOW_PAWN, moving, shock: bump.shock, burst: bump.burst, dust: bump.dust, state: bump.state };
}

/** The face: how far shut the eyes are (0 to 1), how tall they are open (1: as made), and the rig's name for the mouth (null: its resting oval). */
function faceGhost(g, shut, open, mouth) {
  g.eyes.scale.set(1, open * (1 - 0.9 * shut), 1);
  g.glints.visible = shut < 0.5 && open > 0.55;
  const bend = mouth ? CURVES[mouth] : 0;
  g.curve.visible = !!bend;
  g.mouth.visible = !bend;
  if (bend) {
    // Half a ring: its open side up for a smile, down for a frown, sitting where the oval sits.
    g.curve.scale.set(0.046, 0.034, 0.03);
    g.curve.rotation.z = bend > 0 ? Math.PI : 0;
    g.curve.position.y = bend > 0 ? 0.02 : -0.012;
  }
  const [mw, mh] = (mouth && MOUTHS[mouth]) || [1, 1];
  g.mouth.scale.set(0.034 * mw, 0.044 * mh, 0.02);
}

/**
 * An emote's pose on the ghost for this frame, after poseGhost: the lean and lift of the body,
 * its face, the red of fuming; and, for the next frame, the turn of its face, a swell, its nubs
 * tucked away while it has hands.
 */
export function emoteGhost(g, pose, now, seat) {
  const b = pose.body;
  const metres = RIG_UNIT * SIZE;
  g.group.position.x += b.dx * metres;
  g.group.position.y += b.lift * metres;
  g.tilt.rotation.z -= b.rot * RAD;
  g.want = pose.ghost;
  if (b.tint > 0) {
    for (const m of [g.mat, g.softMat]) {
      m.color.lerp(FUMING, b.tint * 0.95);
      m.emissive.lerp(FUMING, b.tint).multiplyScalar(1 - 0.45 * b.tint);
    }
  }
  if (g.dizzy) return;
  const f = pose.face;
  const shut = f.eyes !== "open" ? 0.85 : Math.max(blinkAt(now, seat), f.lid * 0.6);
  g.eyes.position.y += f.up * RIG_UNIT;
  g.glints.position.y += f.up * RIG_UNIT;
  faceGhost(g, shut, clamp(f.eye, 0.4, 1.3), f.mouth);
}

/** The baked look has real light: the sheet in its true white, a little shinier. */
export function bakeGhost(g) {
  if (!g.baked) {
    g.baked = true;
    for (const m of [g.mat, g.softMat]) {
      m.roughness = 0.34;
      m.clearcoat = 0.8;
      m.clearcoatRoughness = 0.14;
      m.envMapIntensity = 1;
    }
  }
  const flicker = Math.max(0, g.mat.emissiveIntensity - (GLOW + 0.14 * g.lit) - 0.01);
  for (const m of [g.mat, g.softMat]) {
    m.color.copy(WHITE).multiplyScalar(g.connected ? 1 : DROPPED);
    m.emissiveIntensity = 0.03;
  }
  g.mat.emissiveIntensity += flicker * 0.6;
}

// ---------------------------------------------------------------- its hands
//
// The hands themselves are the room's own: the mitten and the small cartoon hand of
// emote-arms.js, in the player's colour, shaped by the same pose numbers. What differs is what
// joins a hand to the body (ghost-rig.js, joinOf):
//   nothing   the pawn's stick arm is not drawn: the hand hangs in the air ("Hands")
//   "wisp"    a tapering tube of the sheet from the ghost's side to the wrist, white where it
//             leaves the body and dipped in the player's colour toward the hand ("Wisps")
//   "cuff"    the last stretch of such a wisp only, trailing from the hand toward the body
// On a very pale colour the hands would be lost against the white sheet: they get a dark outline.

/** How far in front of the pawn's hands the ghost's sit (model units): the ghost is wider than a pawn's shoulders. */
const FRONT = 0.06;
/** Where a wisp leaves the body and where it meets the hand, in front of the body's axis (model units). */
const ROOT_Z = 0.1;
const WRIST_Z = 0.24 + FRONT;
const RINGS = 12;
const SIDES = 8;
/** How thick the outline of a pale hand is, in rig units. */
const OUTLINE = 1.2;
const AT = [0, 0, 0, 0];
let outlineMat = null;

function wispGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
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

export class GhostHands {
  /** @param {object} g  makeGhost(); `colour` is the player's colour as "#rrggbb" */
  constructor(g, colour) {
    this.ghost = g;
    this.arms = new EmoteArms(g, colour);
    this.group = this.arms.group;
    this.group.position.z = FRONT;
    this.wispMat = toyMat({ vertexColors: true, side: THREE.DoubleSide });
    this.wisps = [0, 1].map(() => {
      const mesh = new THREE.Mesh(wispGeometry(), this.wispMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      g.tilt.add(mesh);
      return mesh;
    });
    // The pawn's stick arm is never drawn on a ghost.
    for (const l of this.arms.limbs) l.upper.visible = l.lower.visible = l.elbow.visible = false;
    this.hulls = [];
    if (isPale(colour)) {
      outlineMat ??= new THREE.MeshBasicMaterial({ color: 0x1a1210, side: THREE.BackSide });
      for (const l of this.arms.limbs)
        for (const m of [l.mitten, l.pointer, l.palm, l.thumb, ...l.fingers]) {
          const hull = new THREE.Mesh(m.geometry, outlineMat);
          m.add(hull);
          this.hulls.push([m, hull]);
        }
    }
  }

  /** Shows the hands of a pose (already turned toward its target), or hides them (null). */
  set(pose, now = 0) {
    const g = this.ghost;
    const limb = pose?.ghost?.limb ?? "none";
    const hands = limb === "float" || limb === "wisp" ? pose.hands : [];
    this.arms.set({ hands });
    // An outline of the same thickness all round, whatever shape the hand's part has been given.
    for (const [m, hull] of this.hulls) hull.scale.set(1 + OUTLINE / Math.abs(m.scale.x), 1 + OUTLINE / Math.abs(m.scale.y), 1 + OUTLINE / Math.abs(m.scale.z));
    this.wispMat.color.setScalar(0.74 + 0.26 * g.lit);
    this.wispMat.emissive.copy(g.glow);
    this.wispMat.emissiveIntensity = GLOW + 0.14 * g.lit;
    for (let i = 0; i < 2; i++) {
      const h = hands[i];
      const join = h && h.s > 0.05 ? joinOf(pose, h) : null;
      this.wisps[i].visible = !!join;
      if (join) this.wisp(this.wisps[i], h, join === "cuff", now, i);
    }
  }

  /** One wisp: a bent tube from the side of the sheet to the wrist (a cuff: only its last stretch), more of the player's colour toward the hand. */
  wisp(mesh, h, cuff, now, seed) {
    const g = this.ghost;
    const grow = Math.min(1, h.s);
    const pos = mesh.geometry.attributes.position;
    const col = mesh.geometry.attributes.color;
    const from = cuff ? WISP.cuffFrom : 0;
    for (let i = 0; i < RINGS; i++) {
      const u = from + (1 - from) * (i / (RINGS - 1)) * grow;
      wispAt(h.arm, u, AT);
      // It wavers a little along its length, most in the middle: a wisp, not a rod.
      const waver = Math.sin(now / 210 + i * 0.8 + seed * 2) * 1.3 * Math.sin(u * Math.PI);
      const r = wispHalf(u, cuff) * (0.35 + 0.65 * grow);
      // It swings out in front of the body on its way, so an arm that crosses the chest is not lost inside the sheet.
      const z = ROOT_Z + (WRIST_Z - ROOT_Z) * u + Math.sin(u * Math.PI) * 0.07;
      tmpC.copy(WHITE).lerp(g.hem, Math.pow(u, 1.4));
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const across = Math.cos(a) * r + waver;
        const k = i * SIDES + j;
        pos.setXYZ(k, (AT[0] - AT[3] * across) * RIG_UNIT, -(AT[1] + AT[2] * across) * RIG_UNIT, z + Math.sin(a) * r * 0.75 * RIG_UNIT);
        col.setXYZ(k, tmpC.r, tmpC.g, tmpC.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  dispose() {
    for (const mesh of this.wisps) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.wispMat.dispose();
    this.arms.dispose();
  }
}
