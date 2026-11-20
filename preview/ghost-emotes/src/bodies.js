// The ghost and the pawn as 3D toys, and the slice of the bar they stand in.
//
// The ghost is the one the owner approved in the character previews (round two and three): the
// same turned sheet with a dipped hem, five lobes, two nub arms, two eyes and a mouth, the same
// hover, bob, trailing hem and fade. What is new here is only how an emote's pose (ghost-rig.js)
// is laid over it: lean, lift, swell, the turn of the face, the face itself and the red of fuming.
// The pawn is the room's own (lobby/public/look3d/pieces.js), standing still as the target.
import * as T from "three";
import { GHOST } from "./ghost-rig.js";

/** The room's numbers (lobby/shared/world.js, look3d/space.js, look3d/pieces.js). */
export const PX = 0.00673;
export const SIZE = 0.78;
export const WALK_Z = 0.6;
export const LIGHT_HALF = 102;
/** Model units per rig unit (look3d/emote-arms.js), and room units per rig unit. */
export const RIG_UNIT = 0.9 / 113;
export const RIG_TO_ROOM = (RIG_UNIT * SIZE) / PX;
/** A pawn's height in metres: what "phone size" and "TV size" are measured by. */
export const PAWN_METRES = 1.115 * SIZE;

const MU = PX / SIZE;
const INK = 0x0a0d18;
const CREAM = 0xf6efe0;
const FUMING = new T.Color("#ff2a14");
const WHITE = new T.Color(0xffffff);
const tmpC = new T.Color();

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

// ---------------------------------------------------------------- colour: any pick becomes a whole palette

const ROOM_TONES = ["#3a2318", "#22150f", "#1c3a31", "#140e0a"].map((h) => new T.Color(h));
const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function palette(hex) {
  const base = new T.Color(hex);
  const hsl = {};
  base.getHSL(hsl);
  // A glossy toy wants its colour a little brighter than print (as the game does for seat colours).
  base.setHSL(hsl.h, clamp(hsl.s + 0.1, 0, 1), clamp(hsl.l + 0.06, 0.03, 0.94));
  const lum = luminance(base);
  const hem = new T.Color().setHSL(hsl.h, clamp(Math.max(hsl.s, 0.25) * 0.95, 0, 1), clamp(mix(hsl.l, 0.6, 0.55), 0.42, 0.74));
  if (hsl.s < 0.08) hem.setHSL(0, 0, clamp(hsl.l, 0.35, 0.72));
  let near = 9;
  for (const t of ROOM_TONES) near = Math.min(near, Math.hypot(base.r - t.r, base.g - t.g, base.b - t.b));
  const rim = lum < 0.05 || near < 0.2 ? 0.42 : lum < 0.1 ? 0.25 : 0;
  return { hex, base, hem, lum, darkEyes: lum > 0.09, rim };
}

/** A toy material in the game's style, with an optional rim of light. */
export function toyMat(opts) {
  const mat = new T.MeshPhysicalMaterial({ roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.25, emissiveIntensity: 0.3, ...opts });
  mat.userData.rim = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = mat.userData.rim;
    shader.fragmentShader =
      "uniform float uRim;\n" +
      shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        "float rimK = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.6);\n gl_FragColor.rgb += vec3(1.0, 0.9, 0.74) * rimK * uRim;\n#include <dithering_fragment>",
      );
  };
  return mat;
}

// ---------------------------------------------------------------- small shared shapes

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function texOf(c) {
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
let RADIAL = null;
let BALL = null;
function shared() {
  if (BALL) return;
  BALL = new T.SphereGeometry(1, 20, 14);
  const c = canvasOf(128, 128);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  RADIAL = texOf(c);
}
const lathe = (pts, seg) => new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), seg);
function ball(mat, sx, sy = sx, sz = sx) {
  const m = new T.Mesh(BALL, mat);
  m.scale.set(sx, sy, sz);
  return m;
}

/** An eye that can blink and squeeze shut. A dazed or delighted piece shuts its eyes; it never gets crosses. */
function makeEye(parent, x, y, z, turn, w, h) {
  const g = new T.Group();
  g.position.set(x, y, z);
  g.rotation.y = turn;
  parent.add(g);
  const darkMat = new T.MeshStandardMaterial({ color: INK, roughness: 0.25 });
  const glintMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const dark = ball(darkMat, w, h, w * 0.6);
  g.add(dark);
  const glint = ball(glintMat, w * 0.32, h * 0.25, w * 0.24);
  glint.position.set(w * 0.2, h * 0.42, w * 0.44);
  g.add(glint);
  return { g, dark, glint, darkMat, glintMat, w, h };
}
/** shut: 0 open to 1 shut; open: how tall the open eye is (1: as made). */
function poseEye(e, shut, open = 1) {
  e.dark.scale.set(e.w * (open > 1.05 ? 1.15 : 1), e.h * open * (1 - 0.9 * shut), e.w * 0.6);
  e.glint.visible = shut < 0.5 && open > 0.55;
}
function inkEye(e, darkEyes) {
  e.darkMat.color.set(darkEyes ? INK : CREAM);
  e.glintMat.color.set(darkEyes ? 0xffffff : INK);
}
const blinkAt = (now, seed) => {
  const t = (now + seed * 977) % 3400;
  return t < 130 ? Math.sin((t / 130) * Math.PI) : 0;
};

function makeShadow(scene, wide) {
  const mat = new T.MeshBasicMaterial({ map: RADIAL, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
  const blob = new T.Mesh(new T.CircleGeometry(0.5 * SIZE * wide, 24), mat);
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  const contact = new T.Mesh(blob.geometry, mat);
  contact.scale.set(0.66, 0.66, 1);
  contact.position.z = 0.001;
  blob.add(contact);
  scene.add(blob);
  return blob;
}
function placeShadow(blob, x, rise, wide, strength) {
  const off = Math.max(0.45, 1 - Math.max(0, rise) * PX * 0.6);
  blob.position.set(x * PX, 0.008, WALK_Z);
  blob.scale.setScalar(off * wide * 1.15);
  blob.material.opacity = 0.72 * off * strength;
}

// ---------------------------------------------------------------- the ghost

/** How the ghost's mouth sits for each of the rig's mouth names: [wide, tall] against its resting oval. */
const MOUTHS = {
  grin: [1.7, 1.15],
  laugh: [1.8, 1.6],
  o: [1.1, 1.35],
  chew: [1.25, 0.7],
  purse: [0.62, 0.62],
  flat: [1.45, 0.28],
  grit: [1.75, 0.55],
  squiggle: [1.35, 0.3],
};
/** The two mouths that are a curve, not an oval: 1 turns up, -1 turns down. */
const CURVES = { smile: 1, frown: -1 };

/**
 * The ghost. update(p, now, dt) poses it: p is {x (room units), face, fade, lit, seat, emote}
 * where emote is a pose from ghost-rig.js or null. Returns nothing; r.tilt is where its hands hang
 * (ghost-limbs.js), r.fadeK how far it has faded, r.pal its colours.
 */
export function makeGhost(scene) {
  shared();
  const group = new T.Group();
  const tilt = new T.Group();
  const turn = new T.Group();
  tilt.add(turn);
  group.add(tilt);
  scene.add(group);
  const r = { group, tilt, turn, shadow: makeShadow(scene, 0.92), pal: null };

  const TOP = 0.96;
  const HEM = 0.2;
  const profile = [[0, 0.215], [0.1, 0.2], [0.2, 0.2], [0.255, 0.245], [0.272, 0.32], [0.27, 0.46], [0.264, 0.6]];
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 0.5;
    profile.push([0.264 * Math.cos(a), 0.64 + (TOP - 0.64) * Math.sin(a)]);
  }
  const SEG = 28;
  const ROWS = profile.length;
  const geo = lathe(profile, SEG);
  const pos = geo.attributes.position;
  const base = Float32Array.from(pos.array);
  const n = pos.count;
  const ang = new Float32Array(n);
  const wk = new Float32Array(n);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    ang[i] = Math.atan2(base[i * 3 + 2], base[i * 3]);
    wk[i] = Math.pow(clamp((TOP - base[i * 3 + 1]) / (TOP - HEM), 0, 1.05), 1.7);
  }
  geo.setAttribute("color", new T.BufferAttribute(cols, 3));
  r.mat = toyMat({ vertexColors: true, roughness: 0.42, clearcoat: 0.45 });
  r.lobeMat = toyMat({ roughness: 0.42, clearcoat: 0.45 });
  r.armMat = toyMat({ roughness: 0.42, clearcoat: 0.45 });
  // A see-through ghost is drawn in two passes, depth first, so its far side never shows through its near side.
  const depthMat = new T.MeshBasicMaterial({ colorWrite: false, transparent: true });
  const skins = [];
  const add = (mesh, parent) => {
    parent.add(mesh);
    const pre = new T.Mesh(mesh.geometry, depthMat);
    pre.renderOrder = 5;
    pre.visible = false;
    mesh.add(pre);
    mesh.renderOrder = 6;
    skins.push(pre);
    return mesh;
  };
  r.body = add(new T.Mesh(geo, r.mat), turn);
  r.lobes = [];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 5;
    const lobe = add(ball(r.lobeMat, 0.092), turn);
    lobe.userData = { a, bx: Math.cos(a) * 0.178, bz: Math.sin(a) * 0.178 };
    r.lobes.push(lobe);
  }
  r.arms = [-1, 1].map((s) => {
    const g = new T.Group();
    g.position.set(s * 0.235, 0.5, 0.03);
    turn.add(g);
    const arm = add(ball(r.armMat, 0.105, 0.068, 0.068), g);
    arm.position.x = s * 0.085;
    return g;
  });
  r.eyes = [-1, 1].map((s) => makeEye(turn, Math.sin(s * 0.37) * 0.258, 0.725, Math.cos(s * 0.37) * 0.258, s * 0.37, 0.04, 0.06));
  r.mouthMat = new T.MeshStandardMaterial({ color: INK, roughness: 0.3 });
  r.mouthAt = new T.Group();
  r.mouthAt.position.set(0, 0.585, 0.266);
  turn.add(r.mouthAt);
  r.mouth = ball(r.mouthMat, 0.034, 0.044, 0.02);
  r.curve = new T.Mesh(new T.TorusGeometry(1, 0.24, 8, 18, Math.PI), r.mouthMat);
  r.curve.visible = false;
  r.mouthAt.add(r.mouth, r.curve);
  const face = [...r.eyes.map((e) => e.g), r.mouthAt, ...r.arms].map((o) => ({ o, x: o.position.x, y: o.position.y, z: o.position.z, k: Math.pow(clamp((TOP - o.position.y) / (TOP - HEM), 0, 1), 1.7) }));
  const faceMats = [r.mouthMat, ...r.eyes.flatMap((e) => [e.darkMat, e.glintMat])];
  for (const mat of faceMats) mat.transparent = true;
  for (const e of r.eyes) for (const o of [e.dark, e.glint]) o.renderOrder = 7;
  r.mouth.renderOrder = r.curve.renderOrder = 7;

  r.tint = (pal) => {
    r.pal = pal;
    for (let i = 0; i < n; i++) {
      const k = smooth((wk[i] - 0.1) / 0.75);
      tmpC.setRGB(1, 1, 1).lerp(pal.hem, k);
      cols[i * 3] = tmpC.r;
      cols[i * 3 + 1] = tmpC.g;
      cols[i * 3 + 2] = tmpC.b;
    }
    geo.attributes.color.needsUpdate = true;
    r.lobeCol = pal.hem.clone();
    r.armCol = new T.Color(0xffffff).lerp(pal.hem, 0.22);
    r.glow = new T.Color(0xffffff).lerp(pal.hem, 0.5);
  };
  r.reset = (faceDir) => {
    Object.assign(r, { sq: 1, sqV: 0, yaw: GHOST.yaw * (faceDir || 1), fadeK: 0, trX: null, trV: 0, trY: null, trYV: 0, bobT: 0, arm: 0, armV: 0, puff: 0, puffV: 0, nubK: 1, redK: 0, opacity: 1, litK: 1 });
  };
  r.reset(1);

  r.update = (p, now, dt) => {
    const step = Math.min(dt, 1 / 30);
    const e = p.emote;
    const eb = e ? e.body : null;
    const eg = e ? e.ghost : null;
    const breath = 0.02 * Math.sin(now / 700 + p.seat * 1.7);
    [r.sq, r.sqV] = spring(r.sq, r.sqV, 1 + breath, 150, 10, step);
    r.sq = clamp(r.sq, 0.68, 1.25);
    r.yaw += ((eg ? eg.yaw : GHOST.yaw) * p.face - r.yaw) * Math.min(1, step * 10);
    r.fadeK += ((p.fade ? 1 : 0) - r.fadeK) * Math.min(1, step * 9);
    r.litK += (p.lit - r.litK) * Math.min(1, step * 8);
    const fl = r.fadeK;
    // It never stands: it hangs in the air and bobs, slower and wider when it has faded.
    r.bobT += step * (2.7 - 1.0 * fl);
    const bob = Math.sin(r.bobT) * (5 + 7 * fl) + Math.sin(r.bobT * 0.47 + 1) * 2.5;
    const hover = GHOST.hover + 16 * fl;
    const sway = Math.sin(r.bobT * 0.62) * 0.035 * (1 + 1.4 * fl);
    [r.puff, r.puffV] = spring(r.puff, r.puffV, eg ? eg.puff : 0, 240, 13, step);
    const tall = Math.max(0.6, r.sq);
    const wide = 1 / Math.sqrt(tall);
    const rise = hover + bob + (eb ? eb.lift * RIG_TO_ROOM : 0);
    const X = p.x + (eb ? eb.dx * RIG_TO_ROOM : 0);
    // The hem trails behind the head, sideways and up and down, like a sheet.
    if (r.trX === null) {
      r.trX = X;
      r.trY = rise;
    }
    [r.trX, r.trV] = spring(r.trX, r.trV, X, 85, 9.5, step);
    [r.trY, r.trYV] = spring(r.trY, r.trYV, rise, 120, 9, step);
    const dX = clamp((r.trX - X) * MU, -0.23, 0.23);
    const dY = clamp((r.trY - rise) * MU, -0.12, 0.1);
    group.position.set(X * PX, rise * PX, WALK_Z);
    tilt.rotation.z = sway - (eb ? (eb.rot * Math.PI) / 180 : 0);
    tilt.scale.set(SIZE * wide * (1 + r.puff), SIZE * tall * (1 + r.puff * 0.6), SIZE * wide * (1 + r.puff));
    turn.rotation.y = r.yaw;
    const yaw = r.yaw;
    const dLx = dX * Math.cos(yaw);
    const dLz = dX * Math.sin(yaw);
    const flare = 0.05 + (1 - tall) * 1.3 + Math.max(0, -dY) * 0.5;
    const ripple = 0.022 + 0.03 * fl;
    const phase = now * 0.0065;
    const arr = pos.array;
    for (let i = 0; i < n; i++) {
      const k = wk[i];
      const f = 1 + flare * k + ripple * k * Math.sin(3 * ang[i] + phase);
      arr[i * 3] = base[i * 3] * f + dLx * k;
      arr[i * 3 + 1] = base[i * 3 + 1] + dY * k;
      arr[i * 3 + 2] = base[i * 3 + 2] * f + dLz * k;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // The seam of the turned sheet: both edges get the same normal, so no line shows.
    const nor = geo.attributes.normal;
    for (let j = 0; j < ROWS; j++) {
      const a = j;
      const c = SEG * ROWS + j;
      const x = nor.getX(a) + nor.getX(c);
      const y = nor.getY(a) + nor.getY(c);
      const z = nor.getZ(a) + nor.getZ(c);
      const l = Math.hypot(x, y, z) || 1;
      nor.setXYZ(a, x / l, y / l, z / l);
      nor.setXYZ(c, x / l, y / l, z / l);
    }
    for (let i = 0; i < r.lobes.length; i++) {
      const lobe = r.lobes[i];
      const u = lobe.userData;
      const f = 1 + flare * 1.15 + ripple * Math.sin(3 * u.a + phase);
      lobe.position.set(u.bx * f + dLx * 1.12, 0.205 + dY * 1.25 + Math.sin(now * 0.0062 + i * 1.9) * 0.014, u.bz * f + dLz * 1.12);
    }
    for (const fi of face) fi.o.position.set(fi.x + dLx * fi.k, fi.y + dY * fi.k, fi.z + dLz * fi.k);
    // Its own nub arms: a little lift while it idles; tucked away while an emote gives it hands.
    r.nubK += ((eg ? eg.nubs : 1) - r.nubK) * Math.min(1, step * 18);
    [r.arm, r.armV] = spring(r.arm, r.armV, 0.08 + 0.1 * Math.sin(r.bobT * 0.8) + (eg && eg.limb === "haunt" ? 0.45 : 0), 190, 12, step);
    r.arms[0].rotation.z = -r.arm * 0.95;
    r.arms[1].rotation.z = r.arm * 0.95;
    for (const a of r.arms) {
      a.scale.setScalar(Math.max(0.001, r.nubK));
      a.visible = r.nubK > 0.02;
    }
    // The face an emote asks for, in the ghost's own terms: how open the eyes are, the shape of the mouth.
    const ef = e ? e.face : null;
    const blink = blinkAt(now, p.seat);
    const shut = ef && ef.eyes !== "open" ? 0.85 : Math.max(blink, ef ? ef.lid * 0.6 : 0);
    const open = ef ? clamp(ef.eye, 0.4, 1.3) : 1;
    for (const eye of r.eyes) {
      poseEye(eye, shut, open);
      eye.g.position.y += (ef ? ef.up : 0) * RIG_UNIT;
    }
    const bend = ef ? CURVES[ef.mouth] : 0;
    r.curve.visible = !!bend;
    r.mouth.visible = !bend;
    if (bend) {
      // Half a ring: its open side up for a smile, down for a frown, sitting where the oval sits.
      r.curve.scale.set(0.046, 0.034, 0.03);
      r.curve.rotation.z = bend > 0 ? Math.PI : 0;
      r.curve.position.y = bend > 0 ? 0.02 : -0.012;
    }
    const [mw, mh] = (ef && MOUTHS[ef.mouth]) || [1, 1];
    r.mouth.scale.set(0.034 * mw, 0.044 * mh, 0.02);
    // See-through when faded; the light slides off it. Fuming turns the whole sheet red.
    r.redK += ((eb ? eb.tint : 0) - r.redK) * Math.min(1, step * 20);
    const lit = r.litK * (1 - 0.35 * fl);
    const k = mix(0.66 + 0.34 * lit, 1, fl);
    r.opacity = clamp(1 - 0.5 * fl, 0.2, 1);
    const clear = r.opacity < 0.985;
    for (const [mat, col] of [[r.mat, WHITE], [r.lobeMat, r.lobeCol], [r.armMat, r.armCol]]) {
      mat.color.copy(col).multiplyScalar(k).lerp(FUMING, r.redK * 0.95);
      mat.emissive.copy(mat === r.mat ? r.glow : col).lerp(FUMING, r.redK).multiplyScalar(1 - 0.45 * r.redK);
      mat.emissiveIntensity = 0.07 + 0.16 * lit + 1.1 * fl;
      if (mat.transparent !== clear) {
        mat.transparent = clear;
        mat.needsUpdate = true;
      }
      mat.opacity = r.opacity;
      mat.userData.rim.value = 0.12 + 0.9 * fl;
    }
    for (const pre of skins) pre.visible = clear;
    for (const mat of faceMats) mat.opacity = clamp(1 - 0.45 * fl, 0, 1);
    placeShadow(r.shadow, X, rise, wide, 0.85 * (1 - 0.7 * fl));
    r.lit = lit;
  };
  return r;
}

// ---------------------------------------------------------------- the pawn (lobby/public/look3d/pieces.js), as the target

export function makePawn(scene) {
  shared();
  const group = new T.Group();
  const tilt = new T.Group();
  const turn = new T.Group();
  tilt.add(turn);
  group.add(tilt);
  scene.add(group);
  const r = { group, tilt, turn, shadow: makeShadow(scene, 1), pal: null };
  const profile = [[0, 0], [0.29, 0], [0.325, 0.03], [0.33, 0.08], [0.3, 0.13], [0.235, 0.24], [0.185, 0.4], [0.15, 0.56], [0.145, 0.61], [0.2, 0.645], [0.205, 0.68], [0.15, 0.715]];
  const a0 = Math.asin((0.715 - 0.9) / 0.215);
  for (let i = 0; i <= 14; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / 14;
    profile.push([0.215 * Math.cos(a), 0.9 + 0.215 * Math.sin(a)]);
  }
  r.mat = toyMat({});
  turn.add(new T.Mesh(lathe(profile, 40), r.mat));
  r.eyes = [-1, 1].map((s) => makeEye(turn, Math.sin(s * 0.33) * 0.205, 0.925, Math.cos(s * 0.33) * 0.205, s * 0.33, 0.034, 0.052));
  r.tint = (pal) => {
    r.pal = pal;
    for (const e of r.eyes) inkEye(e, pal.darkEyes);
  };
  /** p: {x, face, seat, flinch (0 to 1: a jolt away from the ghost)}. The pawn is never changed beyond that. */
  r.update = (p, now) => {
    const breath = 0.012 * Math.sin(now / 700 + p.seat * 1.7);
    const tall = 1 + breath;
    const wide = 1 / Math.sqrt(tall);
    const jolt = p.flinch || 0;
    group.position.set(p.x * PX, jolt * 5 * PX, WALK_Z);
    tilt.rotation.z = jolt * 0.1 * p.face;
    tilt.scale.set(SIZE * wide, SIZE * tall, SIZE * wide);
    turn.rotation.y = p.face * 0.32;
    for (const e of r.eyes) poseEye(e, 0, 1 + 0.25 * jolt);
    placeShadow(r.shadow, p.x, 0, wide, 1);
    r.mat.color.copy(r.pal.base);
    r.mat.emissive.copy(r.pal.base);
    r.mat.emissiveIntensity = 0.36;
    r.mat.userData.rim.value = r.pal.rim;
  };
  return r;
}

// ---------------------------------------------------------------- the room: a slice of the bar's wall and floor, one lamp

export function buildRoom(scene) {
  shared();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Floor boards run across the picture, as in the bar.
  const fc = canvasOf(1024, 512);
  const f = fc.getContext("2d");
  f.fillStyle = "#3b2317";
  f.fillRect(0, 0, 1024, 512);
  const rowsN = 15;
  const rh = 512 / rowsN;
  for (let j = 0; j < rowsN; j++) {
    let x = -rnd() * 200;
    while (x < 1024) {
      const w = 150 + rnd() * 220;
      const l = 20 + rnd() * 9;
      f.fillStyle = `hsl(${20 + rnd() * 6} 42% ${l}%)`;
      f.fillRect(x, j * rh, w - 2, rh - 2);
      f.fillStyle = "rgba(0,0,0,0.12)";
      for (let k = 0; k < 3; k++) f.fillRect(x + rnd() * w, j * rh + rnd() * rh, 30 + rnd() * 60, 1);
      x += w;
    }
    f.fillStyle = "rgba(10,5,3,0.75)";
    f.fillRect(0, j * rh + rh - 2, 1024, 2);
  }
  const shadeF = f.createLinearGradient(0, 0, 0, 512);
  shadeF.addColorStop(0, "rgba(0,0,0,0.38)");
  shadeF.addColorStop(0.3, "rgba(0,0,0,0.0)");
  shadeF.addColorStop(1, "rgba(0,0,0,0.5)");
  f.fillStyle = shadeF;
  f.fillRect(0, 0, 1024, 512);
  const floor = new T.Mesh(new T.PlaneGeometry(20, 10), new T.MeshBasicMaterial({ map: texOf(fc), color: 0xb9b0aa }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 2.5);
  scene.add(floor);
  // Wall: dark boards above, bottle-green panelling below a brass rail.
  const wc = canvasOf(1024, 512);
  const w = wc.getContext("2d");
  const WH = 5.2;
  const ppm = 512 / WH;
  const ppx = 1024 / 16;
  w.fillStyle = "#24160f";
  w.fillRect(0, 0, 1024, 512);
  for (let x = 0; x < 1024; x += ppx * 0.26) {
    w.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.2})`;
    w.fillRect(x, 0, 1.5, 512);
    w.fillStyle = `rgba(255,200,150,${rnd() * 0.035})`;
    w.fillRect(x + 2, 0, ppx * 0.26 - 3, 512);
  }
  const railY = 512 - 1.42 * ppm;
  w.fillStyle = "#1d4034";
  w.fillRect(0, railY, 1024, 512 - railY);
  for (let x = 0; x < 1024; x += ppx * 0.34) {
    w.fillStyle = "rgba(0,0,0,0.28)";
    w.fillRect(x, railY, 1.5, 512 - railY);
    w.fillStyle = "rgba(160,255,220,0.04)";
    w.fillRect(x + 2, railY, 2, 512 - railY);
  }
  w.fillStyle = "#0f1a16";
  w.fillRect(0, railY + 5, 1024, 3);
  w.fillStyle = "#c69a4a";
  w.fillRect(0, railY - 3, 1024, 6);
  w.fillStyle = "#f1d08a";
  w.fillRect(0, railY - 3, 1024, 1.5);
  w.fillStyle = "#14251f";
  w.fillRect(0, 512 - 0.16 * ppm, 1024, 0.16 * ppm);
  const dim = w.createLinearGradient(0, 0, 0, 512);
  dim.addColorStop(0, "rgba(0,0,0,0.45)");
  dim.addColorStop(0.6, "rgba(0,0,0,0.05)");
  dim.addColorStop(1, "rgba(0,0,0,0.3)");
  w.fillStyle = dim;
  w.fillRect(0, 0, 1024, 512);
  const wall = new T.Mesh(new T.PlaneGeometry(16, WH), new T.MeshBasicMaterial({ map: texOf(wc), color: 0xc8c0bb }));
  wall.position.set(0, WH / 2, -2.5);
  scene.add(wall);

  // The lamp's light: a pool on the floor and a wash up the wall behind it.
  const pc = canvasOf(256, 256);
  const pg = pc.getContext("2d");
  const grad = pg.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,214,150,0.62)");
  grad.addColorStop(0.7, "rgba(255,205,140,0.5)");
  grad.addColorStop(0.93, "rgba(255,200,130,0.46)");
  grad.addColorStop(1, "rgba(255,200,130,0)");
  pg.fillStyle = grad;
  pg.fillRect(0, 0, 256, 256);
  // Wider than a voting light: both pieces stand in it, so neither is judged in the dark.
  const radius = LIGHT_HALF * PX * 1.9;
  const pool = new T.Mesh(new T.CircleGeometry(radius, 48), new T.MeshBasicMaterial({ map: texOf(pc), transparent: true, opacity: 0.62, blending: T.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.004, WALK_Z);
  pool.renderOrder = 1;
  scene.add(pool);
  const wash = new T.Mesh(new T.PlaneGeometry(5.4, 4.4), new T.MeshBasicMaterial({ map: RADIAL, color: 0xffc98a, transparent: true, opacity: 0.15, blending: T.AdditiveBlending, depthWrite: false }));
  wash.position.set(0, 1.5, -2.49);
  scene.add(wash);
}
