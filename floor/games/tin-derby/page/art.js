// Tin Derby: how it is drawn. The look is a flat screen print: a few inks, two tones a surface,
// a halftone edge between them, a navy line round the subjects, and no real lighting.
// Round five's reviewed art.js as it is; only this import and the export at the end are new (env.js says why).
import { THREE, TUNE, hash, wrapS } from "./env.js";

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
// The inks: each with its shade ink. Taken from derby-view.png and the poster.
const PAL = {
  red: [0xd9301f, 0xa81f1c], mustard: [0xf4ab16, 0xd5801a], teal: [0x2a7b70, 0x1c5753], cream: [0xfadba3, 0xecb873],
  navy: [0x242a3e, 0x171b2b], grey: [0xa9aaa2, 0x6f7480], white: [0xfdeccb, 0xf3cf94], ghost: [0xfff4dc, 0xe9d3ad],
  orange: [0xee6d45, 0xc9472c], pepper: [0x5a3a30, 0x3a2626], butter: [0xf9c53e, 0xe39a1f], inside: [0x8a8d96, 0x5d6170], page: [0xfbe6bd, 0xe9c489],
  wood: [0xe2a35a, 0xb9773c], steel: [0xc4c6c4, 0x8b8f98], dark: [0x3a3f52, 0x242a3e], toast: [0xd99a4e, 0xa8682f], chrome: [0xdfe1dc, 0x9ea3ab],
  glass: [0xd9e8de, 0xa9c3ba], // round four: a shaker's glass, a pale green-grey so it reads apart from the salt in it
  paint: [0xd9301f, 0xa81f1c], // a stand-in: a triangle keyed "paint" takes the car's own colour (uPaint)
  paintLight: [0xd9301f, 0xa81f1c], // reviewer fix (round two): the car's colour lifted toward cream, so a rider of the same colour stands off the body
};
for (const k in PAL) PAL[k] = { ink: hex(PAL[k][0]), shade: hex(PAL[k][1]) };
const PAPER = hex(0xfbdfaa);
const CSS = { red: "#d9301f", mustard: "#f4ab16", teal: "#2a7b70", cream: "#fadba3", navy: "#242a3e", paper: "#fbdfaa", orange: "#ee6d45" };
const g3 = (a) => `vec3(${a.map((v) => v.toFixed(4)).join(",")})`;

// ---- The characters of the party room, and the colours they may wear (lobby/shared/characters.js) ----
const CHARACTERS = [
  { id: "pawn", name: "Pawn" },
  { id: "ghost", name: "Ghost" },
  { id: "slime", name: "Slime" },
  { id: "robot", name: "Robot" },
];
const COLOURS = [
  { hex: "#c8382c", name: "Oxblood red" }, { hex: "#2f6f8f", name: "Enamel blue" }, { hex: "#d9a02a", name: "Gilt yellow" }, { hex: "#3f7a4a", name: "Bottle green" },
  { hex: "#d9662b", name: "Marmalade" }, { hex: "#8a5bc4", name: "Violet" }, { hex: "#d9619a", name: "Rose" }, { hex: "#3aa9a0", name: "Teal" },
  { hex: "#f4ead4", name: "Cream" }, { hex: "#565b66", name: "Slate" },
];
/** A chosen colour as two printing inks: the colour itself, and a deeper shade of it leaning toward the navy. */
function paintOf(hexStr) {
  const n = parseInt(hexStr.slice(1), 16), c = hex(n), nv = PAL.navy.ink;
  return { ink: c, shade: c.map((v, i) => v * 0.74 + nv[i] * 0.12) };
}

const INK_VS = `
attribute vec3 aInk; attribute vec3 aShade; attribute float aFlag; attribute vec3 aOut;
uniform float uOutline;
varying vec3 vInk; varying vec3 vShade; varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying float vFlag; varying float vDepth; varying vec2 vUv;
void main(){
  #ifdef USE_INSTANCING
    mat4 mm = modelMatrix * instanceMatrix; // round four: sweets and butter pats are drawn many to a call
  #else
    mat4 mm = modelMatrix;
  #endif
  vec4 w = mm * vec4(position, 1.0);
  #ifdef SHELL
    float dd = clamp(distance(w.xyz, cameraPosition), 0.5, 90.0);
    w.xyz += normalize(mat3(mm) * aOut + vec3(1e-6)) * uOutline * pow(dd, 0.8) * step(0.001, dot(aOut, aOut));
  #endif
  vN = normalize(mat3(mm) * normal);
  vW = w.xyz; vObj = position; vInk = aInk; vShade = aShade; vFlag = aFlag; vUv = uv;
  vec4 mv = viewMatrix * w; vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GLSL_COMMON = `
precision highp float;
uniform vec3 uLight; uniform vec3 uPaper; uniform vec3 uFade; uniform float uDot;
const vec3 CREAM = ${g3(PAL.cream.ink)}; const vec3 CREAM_S = ${g3(PAL.cream.shade)};
const vec3 MUSTARD = ${g3(PAL.mustard.ink)}; const vec3 MUSTARD_S = ${g3(PAL.mustard.shade)};
const vec3 TEAL = ${g3(PAL.teal.ink)}; const vec3 TEAL_S = ${g3(PAL.teal.shade)};
const vec3 RED = ${g3(PAL.red.ink)}; const vec3 NAVY = ${g3(PAL.navy.ink)};
const vec3 INSIDE = ${g3(PAL.inside.ink)}; const vec3 INSIDE_S = ${g3(PAL.inside.shade)};
uniform float uGhost;
float dots(vec2 fc, float size){ vec2 q = mat2(0.707, -0.707, 0.707, 0.707) * fc / size; return length(fract(q) - 0.5) * 1.414; }
// A car close to someone else's camera breaks into paper-coloured dots (and nearer still is not drawn at all).
// Reviewer note (round one): a rival beside the camera smeared into navy dots. Now it fades to paper: its outline goes first, then its own inks break into paper-coloured dots.
// Round five: uGhost 3 is the ghost racer fading through a knock: half its print opens into holes, at any distance.
float nearFade(float away){ return uGhost > 2.5 ? 0.55 : uGhost > 0.5 ? clamp((2.3 - away) / 0.7, 0.0, 1.0) : 0.0; }
bool ghosted(float away){ return nearFade(away) > 0.0 && dots(gl_FragCoord.xy, uDot * 1.6) < nearFade(away) * 1.06; }
vec3 toPaper(vec3 c, float depth){ return mix(c, uPaper, smoothstep(uFade.x, uFade.y, depth) * uFade.z); }
`;

const INK_FS = GLSL_COMMON + `
uniform vec3 uPaint; uniform vec3 uPaintShade; uniform vec4 uCut; uniform vec3 uDome;
varying vec3 vInk; varying vec3 vShade; varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying float vFlag; varying float vDepth; varying vec2 vUv;
// The tin car's printed body, from derby-car-sheet.png: the paint, a cream stripe down the middle,
// a cream rim line round the body above the mustard skirt, one long cream highlight on the dome.
void carInk(vec3 p, vec3 n, inout vec3 ink, inout vec3 sh, inout float gloss){
  ink = uPaint; sh = uPaintShade; gloss = 0.0;
  float az = abs(p.z);
  if (az < 0.062 && n.y > -0.35) { ink = CREAM; sh = CREAM_S; }
  vec2 c = vec2((p.x + 0.035) / 0.2, p.z / 0.2); float cr = length(c);
  if (n.y > 0.1 && cr < 1.18) { if (cr < 1.0) { ink = TEAL_S; sh = NAVY; } else { ink = CREAM; sh = CREAM_S; } }
  // The highlight: one long streak on the upper left shoulder, from the tail toward the cockpit.
  if (p.z > 0.1 && p.z < 0.145 && n.y > 0.35 && p.x < -0.14 && p.x > -0.43) { ink = vec3(1.0, 0.96, 0.86); sh = CREAM; }
  if (p.x > 0.2) {
    if (length(vec2(az - 0.155, p.y - 0.265)) < 0.045) { ink = CREAM; sh = CREAM; }
    if (az < 0.105 && p.y > 0.17 && p.y < 0.305 - az * az * 7.0) { ink = CREAM; sh = CREAM; if (fract(p.z * 34.0 + 0.5) < 0.42) { ink = NAVY; sh = NAVY; } }
  }
  if (p.x < -0.2) { float tr = length(vec2(az - 0.2, p.y - 0.2)); if (tr < 0.034) { ink = MUSTARD; sh = MUSTARD; if (tr < 0.02) { ink = RED; sh = RED; } } }
  if (p.y < 0.195 && p.y > 0.168) { ink = CREAM; sh = CREAM_S; }
  if (p.y <= 0.168) {
    ink = MUSTARD; sh = MUSTARD_S;
    if (p.y > 0.155) { ink = NAVY; sh = NAVY; }
  }
}
void main(){
  bool paperDot = ghosted(distance(vW, cameraPosition));
  vec3 N = normalize(vN);
  vec3 ink = vInk; vec3 sh = vShade; float gloss = 0.0;
  int f = int(vFlag + 0.5);
  if (f == 1) gloss = 1.0;
  else if (f == 6) carInk(vObj, N, ink, sh, gloss);
  else if (f == 7) { ink = uPaint; sh = uPaintShade; gloss = 1.0; }
  else if (f == 8) { ink = uPaint; sh = uPaintShade; }
  else if (f == 9) { ink = mix(uPaint, CREAM, 0.3); sh = mix(uPaintShade, uPaint, 0.35); gloss = 1.0; }
  else if (f == 4) {
    float fu = fract(vUv.x * 11.0 + vUv.y * 0.3) - 0.5; float t = (vUv.y - 0.25) / 0.5;
    if (t > 0.0 && t < 1.0 && abs(fu) < 0.34 * sin(3.14159 * t) * (1.0 - 0.35 * t) && abs(fu) > 0.022) { ink = TEAL; sh = TEAL_S; }
  }
  else if (f == 2) {
    float dzc = distance(vW.xz, uDome.xy);
    if (dzc < 1.05 && vW.y < 1.25 * sqrt(max(0.0, 1.0 - dzc * dzc / 1.1025))) discard;
    vec2 g = vec2(vUv.x * 40.0, vUv.y * 11.0); g.x += 0.5 * floor(mod(g.y, 2.0));
    vec2 hc = fract(g) - 0.5;
    if (vUv.y > 0.12 && vUv.y < 0.84 && length(hc * vec2(1.0, 1.25)) < 0.2) discard;
    if (!gl_FrontFacing) { N = -N; ink = INSIDE; sh = INSIDE_S; }
    else if (uCut.w > 0.0) {
      float r = distance(gl_FragCoord.xy, uCut.xy) / uCut.z;
      if (dots(gl_FragCoord.xy, uDot * 2.4) < (1.0 - smoothstep(0.5, 1.15, r)) * uCut.w * 1.06) discard;
    }
  }
  vec3 col = ink;
  if (f != 3) {
    float tone = dot(N, uLight);
    float lit = step(dots(gl_FragCoord.xy, uDot), (tone + 0.16) / 0.26);
    col = mix(sh, ink, lit);
    if (gloss > 0.5) {
      vec3 V = normalize(cameraPosition - vW);
      float nv = dot(N, V);
      if (nv > 0.3 && nv < 0.355 && tone > 0.0) col = mix(CREAM, vec3(1.0, 0.95, 0.84), 0.5);
    }
  }
  #ifdef FADE_OUT
    if (paperDot) discard; // a prop at the lens (a shaker) opens into holes instead of a paper-coloured wall
    // Reviewer fix (round four): a shaker the camera passes beside is 2 to 3 lengths away, so the fade above never
    // reached it and a third of the picture went flat pepper-brown. A shaker (uGhost 2) also opens into holes for
    // anything nearer the lens than your own car, by depth along the view.
    if (uGhost > 1.5 && uGhost < 2.5 && dots(gl_FragCoord.xy, uDot * 2.0) < clamp((2.7 - vDepth) / 0.9, 0.0, 1.0) * 1.06) discard;
  #endif
  if (paperDot) col = uPaper;
  gl_FragColor = vec4(toPaper(col, vDepth), 1.0);
}`;

const SHELL_FS = GLSL_COMMON + `
varying float vDepth; varying vec3 vW;
void main(){ float nf = nearFade(distance(vW, cameraPosition)); if (nf > 0.0 && (uGhost < 2.5 || dots(gl_FragCoord.xy, uDot * 1.6) < nf * 1.06)) discard; gl_FragColor = vec4(toPaper(NAVY, vDepth * 0.6), 1.0); }`;

const CLOTH_VS = `
varying vec3 vW; varying vec3 vN; varying float vDepth;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const CLOTH_FS = GLSL_COMMON + `
uniform sampler2D uTex; uniform float uRep;
varying vec3 vW; varying vec3 vN; varying float vDepth;
void main(){
  vec2 uv = vW.xz * uRep; if (abs(vN.y) < 0.5) uv = vec2(vW.x + vW.z, vW.y) * uRep;
  vec3 c = texture2D(uTex, uv).rgb;
  if (vN.y < 0.93) c *= vN.y < 0.5 ? vec3(0.74, 0.62, 0.66) : vec3(0.9, 0.82, 0.84);
  gl_FragColor = vec4(toPaper(c, vDepth), 1.0);
}`;

// Shadows printed on the cloth: a darker tone with its edge broken into dots. Multiplied onto what is under it.
const SHADOW_VS = `
attribute float aKind;
varying vec2 vUv; varying vec3 vW; varying float vKind; varying float vDepth;
void main(){ vUv = uv; vKind = aKind; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const SHADOW_FS = GLSL_COMMON + `
uniform float uAmt;
varying vec2 vUv; varying vec3 vW; varying float vKind; varying float vDepth;
void main(){
  float r = length(vUv);
  float m = 0.0;
  float edge = (1.0 - r) / 0.28;
  m = step(dots(gl_FragCoord.xy, uDot * 1.3), edge) * step(r, 1.0);
  if (vKind > 0.5) { vec2 g = vW.xz / 0.62; g.x += 0.5 * floor(mod(g.y, 2.0)); if (length(fract(g) - 0.5) < 0.26) m = 0.0; }
  m *= uAmt;
  vec3 tint = vKind > 0.5 ? vec3(0.46, 0.38, 0.52) : vec3(0.3, 0.25, 0.4);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, vDepth) * uFade.z;
  gl_FragColor = vec4(mix(vec3(1.0), tint, m * fade), 1.0);
}`;

// A printed panel (the cereal box's front): its picture, faded toward paper with distance like everything else.
const PANEL_VS = `varying vec2 vUv; varying float vDepth; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const PANEL_FS = GLSL_COMMON + `uniform sampler2D uTex; varying vec2 vUv; varying float vDepth; void main(){ gl_FragColor = vec4(toPaper(texture2D(uTex, vUv).rgb, vDepth), 1.0); }`;
const WALL_FS = `precision highp float; uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }`;
const WALL_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Dust, stars and sparks: flat cut-out shapes that always face the camera.
const PART_VS = `
attribute vec4 aP; attribute vec4 aQ; // aP: world xyz, size.  aQ: turn, shape, flip, tint (1: pepper grey)
varying vec2 vUv; varying float vTint;
void main(){
  vTint = aQ.w;
  float c = cos(aQ.x), s = sin(aQ.x);
  vec4 mv = viewMatrix * vec4(aP.xyz, 1.0);
  // A puff right at the lens shrinks away instead of filling the picture.
  // Reviewer note (round two): a rival's dust beside the camera filled a quarter of the frame. The shrink starts at 2.5 lengths now.
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aP.w * clamp((-mv.z - 1.0) / 1.5, 0.0, 1.0);
  mv.xy += p;
  vec2 cell = vec2(mod(aQ.y, 2.0), 1.0 - floor(aQ.y / 2.0));
  vUv = (cell + vec2(aQ.z > 0.5 ? 1.0 - uv.x : uv.x, uv.y)) * 0.5;
  gl_Position = projectionMatrix * mv;
}`;
const PART_FS = `precision highp float; uniform sampler2D uTex; varying vec2 vUv; varying float vTint; void main(){ vec4 c = texture2D(uTex, vUv); if (c.a < 0.5) discard; vec3 col = c.rgb; if (vTint > 0.5) col = mix(col, vec3(0.36, 0.3, 0.3), 0.7 * step(0.5, dot(col, vec3(0.33)))); gl_FragColor = vec4(col, 1.0); }`;

// ---- Collecting many shapes into one mesh, each triangle with its own ink ----
class Geo {
  constructor() { this.p = []; this.n = []; this.ink = []; this.sh = []; this.flag = []; this.out = []; this.uv = []; }
  /** key: an ink name, or (centre, uv) => ink name. "paint" is the car's own colour. out: "n" along the normal, "c" away from the part's middle, "" none. */
  add(geo, m, key, flag = 0, out = "n") {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    g.computeBoundingBox();
    const mid = g.boundingBox.getCenter(new THREE.Vector3());
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3(), v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
      cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const cu = UV ? [(UV.getX(i) + UV.getX(i + 1) + UV.getX(i + 2)) / 3, (UV.getY(i) + UV.getY(i + 1) + UV.getY(i + 2)) / 3] : [0, 0];
      const name = typeof key === "function" ? key(cen, cu) : key;
      const pal = PAL[name], fl = name === "paint" ? (flag === 1 || flag === 7 ? 7 : 8) : name === "paintLight" ? 9 : flag;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(P, i + k);
        if (out === "c") o.copy(v).sub(mid).normalize(); else if (out === "n") o.fromBufferAttribute(N, i + k); else o.set(0, 0, 0);
        if (out) o.applyMatrix3(nm).normalize();
        v.applyMatrix4(m); this.p.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i + k).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
        this.ink.push(...pal.ink); this.sh.push(...pal.shade); this.flag.push(fl); this.out.push(o.x, o.y, o.z);
        this.uv.push(UV ? UV.getX(i + k) : 0, UV ? UV.getY(i + k) : 0);
      }
    }
    geo.dispose();
    return this;
  }
  /** A strip of quads laid from a list of [left point, right point] pairs (each [x, y, z]), facing up. */
  strip(pairs, key, flag = 3, closed = false) {
    const pos = [], nor = [];
    const n = pairs.length - (closed ? 0 : 1);
    for (let i = 0; i < n; i++) {
      const [a, b] = pairs[i], [c, d] = pairs[(i + 1) % pairs.length];
      for (const p of [a, c, b, b, c, d]) { pos.push(...p); nor.push(0, 1, 0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    return this.add(g, new THREE.Matrix4(), key, flag, "");
  }
  get empty() { return this.p.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    const f = (arr, n) => new THREE.Float32BufferAttribute(arr, n);
    g.setAttribute("position", f(this.p, 3)); g.setAttribute("normal", f(this.n, 3)); g.setAttribute("aInk", f(this.ink, 3));
    g.setAttribute("aShade", f(this.sh, 3)); g.setAttribute("aFlag", f(this.flag, 1)); g.setAttribute("aOut", f(this.out, 3)); g.setAttribute("uv", f(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YZX")), new THREE.Vector3(sx, sy, sz));

/** A surface from a function of (u, v), with true normals; u must go round so that dP/dv x dP/du points out. */
function surface(nu, nv, fn) {
  const pos = [], nor = [], uv = [], idx = [];
  const P = (u, v) => new THREE.Vector3(...fn(u, v));
  const e = 1e-3;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv, p = P(u, v);
    const vv = clampN(v, e, 1 - e);
    const du = P(u + e, vv).sub(P(u - e, vv)), dv = P(u, vv + e).sub(P(u, vv - e));
    const n = dv.cross(du).normalize();
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(u, v);
  }
  const w = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const A = j * w + i, B = A + 1, D = A + w, C = D + 1; idx.push(A, D, C, A, C, B); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
/** Turned on a lathe: prof is [[radius, height], ...] from the bottom up (and down the inside for a bowl). */
function lathe(prof, segs = 28) {
  const n = prof.length - 1;
  return surface(segs, n, (u, v) => {
    const t = clampN(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(t)), f = t - i;
    const a = prof[i], b = prof[i + 1];
    const r = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, ang = u * Math.PI * 2;
    return [r * Math.cos(ang), y, r * Math.sin(ang)];
  });
}
function smoothProf(pts, per = 5) {
  const c = new THREE.SplineCurve(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  return c.getPoints((pts.length - 1) * per).map((p) => [Math.max(0, p.x), p.y]);
}
/** Reviewer fix (round one): the height of the lathe ring nearest y, so a colour band follows a ring instead of a sawtooth. */
function ringNear(prof, y) { let best = prof[0][1]; for (const p of prof) if (Math.abs(p[1] - y) < Math.abs(best - y)) best = p[1]; return best; }
/** A box with round edges (a superellipsoid), for the robot. */
function roundBox(w, h, d, e = 0.28, nu = 20, nv = 12) {
  const sp = (c, p) => Math.sign(c) * Math.pow(Math.abs(c), p);
  return surface(nu, nv, (u, v) => {
    const a = u * Math.PI * 2, b = (clampN(v, 0, 1) - 0.5) * Math.PI;
    return [(w / 2) * sp(Math.cos(b), e) * sp(Math.cos(a), e), (h / 2) * sp(Math.sin(b), e), (d / 2) * sp(Math.cos(b), e) * sp(Math.sin(a), e)];
  });
}

function inkMaterial(shared, opts = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: INK_VS, fragmentShader: opts.shell ? SHELL_FS : INK_FS, defines: opts.shell ? { SHELL: 1 } : opts.fadeOut ? { FADE_OUT: 1 } : {},
    side: opts.shell ? THREE.BackSide : opts.side || THREE.FrontSide,
    uniforms: {
      ...shared, uOutline: { value: opts.shell ? opts.thick || TUNE.OUTLINE : 0 }, uGhost: opts.ghost || { value: 0 },
      uPaint: opts.paintU || { value: new THREE.Vector3(...PAL.red.ink) }, uPaintShade: opts.shadeU || { value: new THREE.Vector3(...PAL.red.shade) },
    },
  });
  if (opts.offset) { m.polygonOffset = true; m.polygonOffsetFactor = -opts.offset; m.polygonOffsetUnits = -opts.offset; }
  return m;
}

// ---- Pictures made in code ----
function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function shapesTexture() {
  const S = 256, c = canvasOf(S * 2, S * 2), x = c.getContext("2d");
  x.lineJoin = "round"; x.lineCap = "round";
  // 0: a big chunky dust cloud, as the poster's: navy first and wider, then cream on top.
  {
    const lumps = [[58, 172, 46], [100, 116, 58], [160, 104, 56], [208, 156, 44], [134, 172, 60]];
    const cloud = (grow) => { x.beginPath(); for (const [cx, cy, r] of lumps) { x.moveTo(cx + r + grow, cy); x.arc(cx, cy, r + grow, 0, Math.PI * 2); } x.rect(56, 150, 150, 64 + grow); x.fill(); };
    x.fillStyle = CSS.navy; cloud(10); x.fillStyle = "#fbe6bd"; cloud(0);
    x.strokeStyle = CSS.navy; x.lineWidth = 7; x.beginPath(); x.arc(108, 146, 34, 3.6, 5.0); x.stroke(); x.beginPath(); x.arc(170, 132, 26, 3.7, 4.9); x.stroke();
  }
  // 1: a bump star
  x.save(); x.translate(S, 0);
  const star = (r1, r2) => { x.beginPath(); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, r = i % 2 ? r2 * (0.8 + 0.3 * hash(3, i)) : r1 * (0.8 + 0.25 * hash(5, i)); x.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } x.closePath(); };
  star(118, 56); x.fillStyle = CSS.navy; x.fill(); star(104, 50); x.fillStyle = CSS.mustard; x.fill(); star(64, 30); x.fillStyle = "#fbe6bd"; x.fill();
  x.restore();
  // 2: a rewind spark: a little brass key-shaped burst
  x.save(); x.translate(0, S);
  x.strokeStyle = CSS.navy; x.lineWidth = 30; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40); x.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); x.stroke(); }
  x.strokeStyle = CSS.mustard; x.lineWidth = 15; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * 42, 128 + Math.sin(a) * 42); x.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110); x.stroke(); }
  x.restore();
  // 3: a small tick mark (a click, a scrape)
  x.save(); x.translate(S, S); x.strokeStyle = CSS.navy; x.lineWidth = 26;
  for (const a of [-0.6, 0, 0.6]) { x.beginPath(); x.moveTo(128 + Math.sin(a) * 40, 200 - Math.cos(a) * 40); x.lineTo(128 + Math.sin(a) * 112, 200 - Math.cos(a) * 112); x.stroke(); }
  x.strokeStyle = "#fbe6bd"; x.lineWidth = 11;
  for (const a of [-0.6, 0, 0.6]) { x.beginPath(); x.moveTo(128 + Math.sin(a) * 42, 200 - Math.cos(a) * 42); x.lineTo(128 + Math.sin(a) * 110, 200 - Math.cos(a) * 110); x.stroke(); }
  x.restore();
  const t = new THREE.CanvasTexture(c); t.flipY = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
/** The Hand of the House: a big drawn hand pinching from above, for the car that fell off the table. */
function handTexture() {
  const W = 256, H = 384, c = canvasOf(W, H), x = c.getContext("2d");
  x.lineJoin = "round"; x.lineCap = "round";
  const hand = () => {
    x.beginPath();
    x.moveTo(70, 0); x.lineTo(186, 0); x.lineTo(190, 150); // the wrist and cuff
    x.quadraticCurveTo(214, 190, 200, 250); x.quadraticCurveTo(190, 300, 160, 318); // the back of the hand and the thumb
    x.quadraticCurveTo(150, 344, 136, 360); x.quadraticCurveTo(122, 366, 120, 348); x.quadraticCurveTo(128, 320, 124, 296); // the thumb's tip
    x.lineTo(112, 300); x.quadraticCurveTo(100, 340, 92, 362); x.quadraticCurveTo(78, 368, 76, 350); x.quadraticCurveTo(80, 300, 70, 262); // the finger
    x.quadraticCurveTo(48, 220, 62, 160); x.closePath();
  };
  x.fillStyle = CSS.navy; x.save(); x.translate(0, 0); x.lineWidth = 16; x.strokeStyle = CSS.navy; hand(); x.stroke(); x.fill(); x.restore();
  x.fillStyle = "#fadba3"; hand(); x.fill();
  x.fillStyle = "#ecb873"; x.beginPath(); x.ellipse(104, 230, 24, 50, 0.2, 0, 7); x.fill();
  x.fillStyle = CSS.teal; x.fillRect(70, 0, 116, 70); x.strokeStyle = CSS.navy; x.lineWidth = 6; x.strokeRect(70, -4, 116, 74);
  x.strokeStyle = "#fbe6bd"; x.lineWidth = 5; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(84 + i * 28, 6); x.lineTo(84 + i * 28, 62); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function wallTexture() {
  const W = 1024, H = 512, c = canvasOf(W, H), x = c.getContext("2d");
  x.fillStyle = "#fbdfaa"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#fde9bf"; for (const [a, b] of [[250, 60], [520, 420], [800, 760]]) { x.beginPath(); x.moveTo(a, 120); x.lineTo(a + 120, 120); x.lineTo(b + 260, H); x.lineTo(b, H); x.fill(); }
  const wx = 330, wy = 70, ww = 364, wh = 300;
  x.fillStyle = "#fdf0cf"; x.fillRect(wx, wy, ww, wh);
  x.fillStyle = "#bfd6bd"; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(wx + 20 + i * 44 + 14 * hash(9, i), wy + wh - 20 - 46 * hash(4, i), 44 + 26 * hash(2, i), 0, 7); x.fill(); }
  x.fillStyle = "#9cc2ad"; for (let i = 0; i < 7; i++) { x.beginPath(); x.arc(wx + 40 + i * 54, wy + wh + 6 - 30 * hash(6, i), 34 + 16 * hash(8, i), 0, 7); x.fill(); }
  x.fillStyle = "#fdf0cf"; x.fillRect(wx, wy + wh, ww, 40);
  x.strokeStyle = "#f1c57c"; x.lineWidth = 16; x.strokeRect(wx, wy, ww, wh);
  x.lineWidth = 10; x.beginPath(); x.moveTo(wx + ww / 2, wy); x.lineTo(wx + ww / 2, wy + wh); x.moveTo(wx, wy + wh * 0.42); x.lineTo(wx + ww, wy + wh * 0.42); x.stroke();
  x.fillStyle = "#f1c57c"; x.fillRect(wx - 26, wy + wh - 4, ww + 52, 18);
  for (const side of [-1, 1]) {
    const cx = side < 0 ? wx - 20 : wx + ww + 20;
    x.fillStyle = "#fdeccb"; x.beginPath(); x.moveTo(cx - side * 10, 40); x.lineTo(cx + side * 96, 40); x.quadraticCurveTo(cx + side * 60, 260, cx + side * 130, H); x.lineTo(cx - side * 4, H); x.quadraticCurveTo(cx + side * 30, 250, cx - side * 10, 40); x.fill();
    x.strokeStyle = "#a9cdb9"; x.lineWidth = 5;
    for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(cx + side * (10 + i * 22), 46); x.quadraticCurveTo(cx + side * (24 + i * 18), 260, cx + side * (20 + i * 30), H); x.stroke(); }
  }
  x.fillStyle = "#f1c57c"; x.fillRect(wx - 150, 30, ww + 300, 12);
  x.fillStyle = "#f3cd8c"; x.fillRect(40, 250, 170, 10); x.fillRect(840, 150, 120, 150);
  x.fillStyle = "#fbe6bd"; x.fillRect(852, 162, 96, 126);
  x.fillStyle = "#bfd6bd"; x.beginPath(); x.arc(900, 240, 30, 0, 7); x.fill();
  for (const px of [80, 130, 180]) { x.fillStyle = "#fdeccb"; x.beginPath(); x.arc(px, 222, 26, 0, 7); x.fill(); x.strokeStyle = "#a9cdb9"; x.lineWidth = 4; x.beginPath(); x.arc(px, 222, 16, 0, 7); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}
/** Paper grain for the whole frame, as a tile laid over the page. */
function grainUrl() {
  const S = 220, c = canvasOf(S, S), x = c.getContext("2d");
  const d = x.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const r = hash(11, i), blot = hash(23, ((i % S) >> 3) + ((i / S) >> 3) * 97);
    let a = 0, dark = true;
    if (r < 0.2) { a = 10 + 34 * hash(5, i); } else if (r > 0.86) { dark = false; a = 14 + 44 * hash(7, i); }
    a += dark ? blot * 8 : 0;
    d.data[i * 4] = dark ? 60 : 255; d.data[i * 4 + 1] = dark ? 38 : 240; d.data[i * 4 + 2] = dark ? 40 : 206; d.data[i * 4 + 3] = a;
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL("image/png");
}

// ---- The car, modelled to the sheet: short and bulbous, big wheels, the key on its back ----
function carBodyFn(u, v) {
  const t = clampN(v, 0, 1);
  const x = -0.5 + (1 - Math.cos(t * Math.PI)) / 2;
  const q = x + 0.5;
  const pe = q < 0.5 ? 5 : 3.2;
  const plan = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * q - 1), pe)), 1 / pe);
  const hw = 0.3 * plan * (1 - 0.1 * q);
  const p = q < 0.4 ? (q / 0.4) * 0.5 : 0.5 + ((q - 0.4) / 0.6) * 0.5;
  const arch = p < 0.5 ? Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * p - 1), 4.5)), 1 / 3.2) : Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * p - 1), 2.5)), 1 / 2.1);
  const top = 0.1 + 0.37 * arch * (1 - 0.32 * clampN((q - 0.45) / 0.55, 0, 1));
  const bot = 0.09 + 0.05 * Math.pow(Math.abs(2 * p - 1), 4);
  const a = u * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a), k = 2 / 2.35;
  const z = hw * Math.sign(cs) * Math.pow(Math.abs(cs), k);
  const y = (top + bot) / 2 + ((top - bot) / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), k);
  return [x, y, z];
}
function keyGeometry() {
  const lobes = [[0.078, 0.07], [-0.078, 0.07], [0, 0.044]];
  const pts = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (const [cx, r] of lobes) { const dc = dx * cx, disc = dc * dc - cx * cx + r * r; if (disc >= 0) best = Math.max(best, dc + Math.sqrt(disc)); }
    pts.push(new THREE.Vector2(dx * best, dy * best));
  }
  const shape = new THREE.Shape(pts);
  for (const cx of [0.078, -0.078]) { const h = new THREE.Path(); h.absarc(cx, 0, 0.028, 0, Math.PI * 2, true); shape.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.02);
  return g;
}

/**
 * The party room's four characters, ported from the room's 3D builders (lobby/public/look3d: the
 * pawn's and the ghost's turned profiles, eyes and hem; the slime and the robot from the landing
 * scene's builders, which the owner approved in the character previews), restyled for the print:
 * the same shapes and proportions, inked and halftoned, the player's colour on what the room paints.
 * Model units as the room's (a pawn is 1.115 tall); `fit` sizes and seats each in the cockpit.
 * Returns the body (one Geo) facing +z, as in the room.
 * Round three: every rider wears the lighter ink of the player's colour (the reviewer's slime fix, for all four),
 * so a red pawn on a red car still reads at phone size.
 */
const CHAR_FIT = { pawn: { s: 0.56, y: 0.16 }, ghost: { s: 0.6, y: 0.2 }, slime: { s: 0.74, y: 0.3 }, robot: { s: 0.46, y: 0.17 } };
function characterGeo(kind) {
  const G = new Geo();
  const ball = () => new THREE.SphereGeometry(1, 12, 8);
  const eyes = (a, r, y, w, h, glint = true) => {
    for (const s of [-1, 1]) {
      const ang = s * a;
      G.add(ball(), M4(Math.sin(ang) * r, y, Math.cos(ang) * r, 0, ang, 0, w, h, w * 0.55), "navy", 3, "");
      if (glint) G.add(ball(), M4(Math.sin(ang) * (r + 0.014) + w * 0.25, y + h * 0.4, Math.cos(ang) * (r + 0.014), 0, ang, 0, w * 0.32, h * 0.26, w * 0.22), "white", 3, "");
    }
  };
  if (kind === "pawn") {
    // lobby/public/look3d/pieces.js: one turned body with its head.
    const prof = [[0, 0], [0.29, 0], [0.325, 0.03], [0.33, 0.08], [0.3, 0.13], [0.235, 0.24], [0.185, 0.4], [0.15, 0.56], [0.145, 0.61], [0.2, 0.645], [0.205, 0.68], [0.15, 0.715]];
    const a0 = Math.asin((0.715 - 0.9) / 0.215);
    for (let i = 0; i <= 12; i++) { const a = a0 + ((Math.PI / 2 - a0) * i) / 12; prof.push([0.215 * Math.cos(a), 0.9 + 0.215 * Math.sin(a)]); }
    G.add(lathe(prof, 26), M4(), "paintLight", 1, "n");
    eyes(0.33, 0.205, 0.925, 0.034, 0.052);
  } else if (kind === "ghost") {
    // lobby/public/look3d/ghost.js: a sheet with a scalloped hem in the player's colour, two nubs, eyes and a mouth.
    const HEM = 0.15, TOP = 0.96, SC = 0.095, prof = [[0.3, HEM], [0.293, 0.23], [0.279, 0.33], [0.266, 0.45], [0.255, 0.56], [0.248, 0.64]], hang = [1, 0.55, 0.12, 0, 0, 0];
    for (let i = 1; i <= 7; i++) { const a = (i / 7) * Math.PI * 0.5; prof.push([0.248 * Math.cos(a), 0.64 + (TOP - 0.64) * Math.sin(a)]); hang.push(0); }
    const n = prof.length - 1;
    const sheet = surface(30, n, (u, v) => {
      const t = clampN(v, 0, 1) * n, i = Math.min(n - 1, Math.floor(t)), f = t - i, a = prof[i], b = prof[i + 1];
      const r = a[0] + (b[0] - a[0]) * f, ang = u * Math.PI * 2, h = hang[i] + (hang[i + 1] - hang[i]) * f;
      const y = a[1] + (b[1] - a[1]) * f - SC * h * (0.5 + 0.5 * Math.cos(ang * 5));
      return [r * Math.cos(ang), y, r * Math.sin(ang)];
    });
    G.add(sheet, M4(), (c) => (c.y < 0.36 ? "paintLight" : "ghost"), 1, "n");
    for (const s of [-1, 1]) G.add(ball(), M4(s * 0.3, 0.46, 0.06, 0, 0, s * 0.5, 0.075, 0.055, 0.07), "ghost", 0, "n");
    eyes(0.37, 0.246, 0.725, 0.04, 0.06);
    G.add(ball(), M4(0, 0.585, 0.255, 0, 0, 0, 0.034, 0.045, 0.02), "navy", 3, "");
  } else if (kind === "slime") {
    const prof = [];
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI / 2; prof.push([0.43 * Math.pow(Math.cos(a), 0.62) + 0.05 * Math.pow(1 - i / 14, 6), 0.7 * Math.sin(a)]); }
    prof.push([0, 0.7]);
    // Reviewer fix (round two): from behind the slime was a dome in the car's own colour. It is a shade lighter than the
    // car now, with its gloss streak on the back too, where the chase camera sees it.
    G.add(lathe(prof, 28), M4(), "paintLight", 1, "n");
    G.add(ball(), M4(-0.16, 0.57, 0.19, -0.7, -0.5, 0.5, 0.085, 0.04, 0.02), "white", 3, "");
    {
      const at = new THREE.Object3D(), pnt = new THREE.Vector3(-0.13, 0.55, -0.29), nrm = new THREE.Vector3(-0.13 / 0.185, 0.55 / 0.49, -0.29 / 0.185).normalize();
      at.position.copy(pnt).addScaledVector(nrm, 0.012); at.lookAt(pnt.clone().addScaledVector(nrm, 2)); at.rotateZ(0.6); at.scale.set(0.11, 0.045, 0.02); at.updateMatrix();
      G.add(ball(), at.matrix.clone(), "white", 3, "");
    }
    for (const [X, Z, R] of [[0.47, 0.16, 0.07], [-0.44, 0.24, 0.05]]) G.add(ball(), M4(X, R * 0.3, Z, 0, 0, 0, R, R * 0.6, R), "paintLight", 1, "n");
    eyes(0.36, 0.405, 0.34, 0.051, 0.078);
  } else {
    // The robot: a base, a body and a head in its colour, a dark visor with two light eyes, a mast with a lamp, arms at its sides.
    const k = 1.13, S = (x, y, z, w, h, d) => [x * k, y * k, z * k, w * k, h * k, d * k];
    const box = (x, y, z, w, h, d, key, e = 0.3) => { const [X, Y, Z, W, H, D] = S(x, y, z, w, h, d); G.add(roundBox(W, H, D, e), M4(X, Y, Z), key, key === "paintLight" ? 1 : 0, "n"); };
    box(0, 0.08, 0, 0.56, 0.16, 0.42, "dark");
    box(0, 0.36, 0, 0.5, 0.42, 0.38, "paintLight");
    G.add(new THREE.CylinderGeometry(0.07 * k, 0.07 * k, 0.1 * k, 10), M4(0, 0.6 * k, 0), "steel", 1, "n");
    box(0, 0.8, 0, 0.48, 0.34, 0.38, "paintLight");
    box(0, 0.81, 0.175, 0.38, 0.19, 0.06, "navy", 0.25);
    for (const s of [-1, 1]) G.add(roundBox(0.045 * k, 0.055 * k, 0.02 * k, 0.4, 10, 6), M4(s * 0.085 * k, 0.81 * k, 0.207 * k), "white", 3, "");
    G.add(new THREE.CylinderGeometry(0.014 * k * 1.4, 0.014 * k * 1.4, 0.2 * k, 6), M4(0, 1.07 * k, 0), "steel", 0, "c");
    G.add(new THREE.SphereGeometry(0.055 * k * 1.25, 10, 8), M4(0, 1.19 * k, 0), "mustard", 1, "n");
    G.add(new THREE.CylinderGeometry(0.07 * k, 0.07 * k, 0.01, 16), M4(0, 0.38 * k, 0.192 * k, Math.PI / 2, 0, 0), "white", 3, "");
    for (const s of [-1, 1]) {
      G.add(new THREE.SphereGeometry(0.075 * k, 10, 8), M4(s * 0.29 * k, 0.44 * k, 0), "dark", 0, "n");
      G.add(new THREE.CylinderGeometry(0.04 * k, 0.04 * k, 0.24 * k, 8), M4(s * 0.31 * k, 0.3 * k, 0), "dark", 0, "n");
      G.add(new THREE.SphereGeometry(0.06 * k, 10, 8), M4(s * 0.31 * k, 0.16 * k, 0), "steel", 1, "n");
    }
  }
  return G;
}
/** A character's height above its seat, in car lengths, for the name tags and the cheer. */
const charTop = (kind) => ({ pawn: 1.115, ghost: 0.96, slime: 0.7, robot: 1.25 * 1.13 })[kind] * CHAR_FIT[kind].s + CHAR_FIT[kind].y;

function buildCar(shared, look) {
  const paintU = { value: new THREE.Vector3() }, shadeU = { value: new THREE.Vector3() };
  const ghost = { value: 0 };
  // Reviewer fix (round four): at toy scale a rival beside the low camera filled a third of the picture as a flat cream
  // silhouette (its dots were painted paper). It now opens into holes, so the road shows through it.
  const mat = inkMaterial(shared, { paintU, shadeU, ghost, fadeOut: true });
  const shell = inkMaterial(shared, { shell: true, ghost });
  const G = new Geo();
  G.add(surface(26, 22, carBodyFn), M4(), "red", 6, "n");
  G.add(new THREE.CylinderGeometry(0.04, 0.046, 0.07, 10), M4(-0.5, 0.3, 0, 0, 0, Math.PI / 2), "mustard", 0, "c"); // where the key goes in
  const geo = G.build();
  const car = new THREE.Group(), pivot = new THREE.Group(), lift = new THREE.Group();
  car.add(pivot); pivot.add(lift); pivot.position.y = 0.26; lift.position.y = -0.26; pivot.rotation.order = "YZX";
  lift.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, shell));
  // The key: its bow faces backwards, level, as on the sheet; it spins while the spring is wound.
  const K = new Geo();
  K.add(keyGeometry(), M4(-0.105, 0, 0, 0, Math.PI / 2, 0, 0.9), "mustard", 0, "c");
  K.add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), M4(-0.05, 0, 0, 0, 0, Math.PI / 2), "mustard", 0, "c");
  const kg = K.build();
  const key = new THREE.Group(); key.position.set(-0.5, 0.3, 0);
  key.add(new THREE.Mesh(kg, mat), new THREE.Mesh(kg, shell));
  lift.add(key);
  // Wheels: solid navy tyres with one pale highlight each, mustard hubs; each axle is one mesh, turned about its middle.
  const wheels = [];
  for (const x of [-0.27, 0.27]) {
    const A = new Geo();
    for (const z of [-0.315, 0.315]) {
      A.add(new THREE.TorusGeometry(0.124, 0.063, 8, 24), M4(0, 0, z, 0, 0, 0, 1, 1, 1.45), (c, uv) => (uv[0] > 0.3 && uv[0] < 0.42 && uv[1] > 0.12 && uv[1] < 0.3 ? "page" : "navy"), 0, "");
      A.add(new THREE.CylinderGeometry(0.066, 0.066, 0.1, 12), M4(0, 0, z, Math.PI / 2, 0, 0), "mustard", 0, "");
      A.add(new THREE.CylinderGeometry(0.022, 0.022, 0.112, 8), M4(0, 0, z, Math.PI / 2, 0, 0), "navy", 3, "");
    }
    const w = new THREE.Mesh(A.build(), mat); w.position.set(x, 0.187, 0); lift.add(w); wheels.push(w);
  }
  // The rider: its own group, so it can lean, bounce, cheer and slump on its own.
  const rider = new THREE.Group(), riderTilt = new THREE.Group();
  rider.position.set(-0.04, 0, 0); rider.add(riderTilt); lift.add(rider);
  const v = { group: car, pivot, lift, key, wheels, mat, ghost, rider, riderTilt, paintU, shadeU, shell, riderMeshes: [] };
  dressCar(v, look);
  return v;
}
/** Puts a character and a colour on a car (the picker calls this again on a change). */
function dressCar(v, look) {
  const p = paintOf(look.colour);
  v.paintU.value.set(...p.ink); v.shadeU.value.set(...p.shade);
  if (v.kind === look.character) return;
  for (const m of v.riderMeshes) { v.riderTilt.remove(m); m.geometry.dispose(); }
  const kind = (v.kind = look.character), fit = CHAR_FIT[kind];
  const geo = characterGeo(kind).build();
  const a = new THREE.Mesh(geo, v.mat), b = new THREE.Mesh(geo, v.shell);
  for (const m of [a, b]) { m.position.y = fit.y; m.scale.setScalar(fit.s); m.rotation.y = Math.PI / 2; v.riderTilt.add(m); } // the room's characters face +z; the car's nose is +x
  v.riderMeshes = [a, b];
  v.top = charTop(kind);
}

// (The table and the course on it are in table.js.)

// The names the other drawing files and the page use.
export { hex, PAL, PAPER, CSS, CHARACTERS, COLOURS, paintOf, INK_VS, INK_FS, SHELL_FS, CLOTH_VS, CLOTH_FS, SHADOW_VS, SHADOW_FS, PANEL_VS, PANEL_FS, WALL_VS, WALL_FS, PART_VS, PART_FS, Geo, M4, surface, clampN, lathe, smoothProf, ringNear, roundBox, inkMaterial, canvasOf, shapesTexture, handTexture, wallTexture, grainUrl, buildCar, dressCar };
