// The Star Lounge made real, as a preview: the room rendered in Blender (lobby/tools/blender/star-lounge.py)
// put back together with depth, the universe drawn live outside its window, and the room's real
// pieces (lobby/public/look3d/pieces.js, called and not copied) walking its line.
//
// What is a picture and what is live:
//   - The room is one rendered picture thrown back onto the room's own shape (floor, walls, ceiling)
//     from the place it was taken, so it holds together when the eye moves. Each light in it was
//     rendered on its own and is added here with one number: five lamps, the lines of light, the chart's glow.
//   - The lamps and the chart table are rendered cards at their own depth.
//   - Outside is live: a turning ball with a rendered surface, its ring and shadow, a moon, two
//     depths of stars, gas clouds, and rendered ships and rocks that pass.
//   - The pieces, posters, signs and words are drawn live, as they are in the room today.
import * as THREE from "three";
import { camera as viewOf } from "../../../lobby/shared/camera.js";
import { ROOM, WALK_SPEED, boxCentre, clampX, lightAt, lightHalf } from "../../../lobby/shared/world.js";
import { boxArt } from "../../../lobby/public/look3d/paint.js";
import { dressPawn, makePawn, posePawn } from "../../../lobby/public/look3d/pieces.js";
import { CAM, D_WALL, SPACE, U, WALK, layout, walkX, wallX, wallY } from "../../../lobby/public/look3d/space.js";

const A = window.__ASSETS;
const P = window.__PLATE;
const CFG = window.__CFG;
const Q = new URLSearchParams(location.search);
const N = P.boxes;
const L = layout(N);
const ZB = SPACE.zBack;
const ACCENT = new THREE.Color().setRGB(...CFG.accent);
const LAMP = new THREE.Color().setRGB(...CFG.lampColour);
const PINK = new THREE.Color(0xff5fb0);
const BAR = 64;
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("gl");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

// ------------------------------------------------------------------ what the preview is showing
const state = {
  look: "real", // "real" | "today"
  mode: Q.get("view") === "room" ? "room" : "closer",
  depth: Q.get("depth") !== "off",
  drag: Number(Q.get("eye") ?? 0), // metres the eye was pushed by a finger
  paused: false,
};
const still = Q.has("still"); // for screenshots: a fixed moment, nothing random

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance", alpha: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x01020a, 1);
renderer.sortObjects = true;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera();
cam.position.set(0, CAM.y, CAM.z);
cam.matrixAutoUpdate = true;

function texture(name, { srgb = true, mips = true, repeat = false } = {}) {
  return new Promise((done, fail) => {
    new THREE.TextureLoader().load(
      A[name],
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.generateMipmaps = mips;
        t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        if (repeat) t.wrapS = THREE.RepeatWrapping;
        t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        done(t);
      },
      undefined,
      () => fail(new Error(`the picture "${name}" did not load`)),
    );
  });
}
function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}
const radial = canvasTexture(128, 128, (g) => {
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
});

/** Where a point of the flat picture is in the room, on the plane at depth z. */
const place = (xw, yw, z) => {
  const k = (CAM.z - z) / D_WALL;
  return [wallX(xw) * k, CAM.y + (wallY(yw) - CAM.y) * k];
};

// ================================================================== outside the window
const SUN = new THREE.Vector3(...CFG.sun).normalize();
const outside = new THREE.Group(); // everything so far away that it follows the eye
scene.add(outside);

function buildSky(sky) {
  // The window only ever shows a low band of the sky, so the gas clouds are wrapped on a band all
  // round the ship (twice round, the middle of the picture's height) instead of a whole ball.
  sky.wrapS = THREE.RepeatWrapping;
  sky.repeat.set(2, 0.6);
  sky.offset.set(0, 0.2);
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(650, 650, 400, 64, 1, true),
    // Everything in this scene is drawn in one list, back to front by its order (three.js draws see-through things after solid ones otherwise).
    new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, color: new THREE.Color(1.9, 1.9, 2.2), toneMapped: false }),
  );
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  outside.add(dome);
  return dome;
}

/** Stars as points on a band all round, so the band can turn for ever. */
function buildStars(count, seed, size, bright) {
  const rnd = seeded(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const info = new Float32Array(count * 3); // size, twinkle speed, phase
  const tints = [
    [1, 1, 1],
    [0.75, 0.86, 1],
    [1, 0.9, 0.76],
    [0.82, 0.8, 1],
  ];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const e = -0.3 + rnd() * 0.5; // only as high and as low as the window can show
    pos.set([Math.cos(e) * Math.sin(a) * 600, Math.sin(e) * 600, -Math.cos(e) * Math.cos(a) * 600], i * 3);
    const t = tints[Math.floor(rnd() * tints.length)];
    const b = bright * (0.35 + 0.65 * Math.pow(rnd(), 2.2));
    col.set([t[0] * b, t[1] * b, t[2] * b], i * 3);
    info.set([size * (0.6 + 0.9 * Math.pow(rnd(), 3)), 0.6 + rnd() * 2.4, rnd() * 6.28], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("info", new THREE.BufferAttribute(info, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `attribute vec3 color; attribute vec3 info; uniform float uTime; uniform float uPx; varying vec3 vC;
      void main(){ float tw = 0.78 + 0.22 * sin(uTime * info.y + info.z);
        vC = color * tw; gl_PointSize = info.x * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC * a * a, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -99;
  outside.add(pts);
  return pts;
}

/** A ball lit by the far sun, with a rendered surface that turns: the planet and the moon. */
function ball(map, o, { ringed = false, air = 0 } = {}) {
  const axis = new THREE.Vector3(...(o.axis ?? [0, 1, 0])).normalize();
  const centre = new THREE.Vector3(...o.centre);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uMap: { value: map }, uTurn: { value: 0 }, uSun: { value: SUN }, uCentre: { value: centre }, uAxis: { value: axis }, uR: { value: o.radius }, uRing: { value: new THREE.Vector2(...(o.ring ?? [0, 0])) }, uRingMap: { value: null }, uAir: { value: air }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uMap; uniform sampler2D uRingMap; uniform float uTurn; uniform vec3 uSun; uniform vec3 uCentre; uniform vec3 uAxis; uniform float uR; uniform vec2 uRing; uniform float uAir; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){
        vec3 n = normalize(vN);
        // The belts do not all turn together: the faster ones slide past the slower ones a little.
        float slide = 0.006 * sin(vUv.y * 31.0 + uTime * 0.05) + 0.003 * sin(vUv.y * 77.0 - uTime * 0.08);
        vec3 albedo = texture2D(uMap, vec2(vUv.x + uTurn + slide, vUv.y)).rgb;
        float d = dot(n, uSun);
        float lit = smoothstep(-0.1, 0.42, d);
        // The planet's colours are deepened; the moon is left as it was painted.
        albedo = mix(albedo, mix(vec3(dot(albedo, vec3(0.3, 0.6, 0.1))), albedo, 1.3) * mix(vec3(1.0), albedo, 0.75), uAir);
        vec3 col = albedo * (lit * mix(1.7, 1.25, uAir) + 0.012);
        ${
          ringed
            ? `// The ring's shadow lies across the lit side.
        float den = dot(uSun, uAxis);
        float t = dot(uCentre - vP, uAxis) / (abs(den) < 1e-4 ? 1e-4 : den);
        if (t > 0.0) { float r = length(vP + uSun * t - uCentre) / uR; if (r > uRing.x && r < uRing.y) col *= 1.0 - 0.62 * texture2D(uRingMap, vec2((r - uRing.x) / (uRing.y - uRing.x), 0.5)).a; }`
            : ""
        }
        // Its air: a thin bright edge where the ball turns away, strongest on the lit side.
        vec3 v = normalize(cameraPosition - vP);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 7.0);
        col += vec3(0.55, 0.75, 1.0) * rim * uAir * (0.1 + lit) * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius, 96, 48), mat);
  mesh.position.copy(centre);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  mesh.renderOrder = -97;
  scene.add(mesh);
  return mesh;
}

/** The glow of the planet's air just past its edge. */
function halo(o) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: SUN } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      void main(){ vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vP);
        // Brightest right at the planet's edge (where this shell is seen at a slant of about 0.26), fading outward.
        float c = max(dot(-n, v), 0.0); float f = pow(smoothstep(0.0, 0.26, c), 2.5); float lit = smoothstep(-0.25, 0.5, dot(n, uSun));
        gl_FragColor = vec4(vec3(0.45, 0.68, 1.0) * f * (0.06 + lit) * 0.8, 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius * 1.035, 96, 48), mat);
  mesh.position.set(...o.centre);
  mesh.renderOrder = -96.5;
  scene.add(mesh);
  return mesh;
}

/** The ring: bands of dust, with the planet's shadow across the far side. */
function buildRing(o) {
  const bandsTex = canvasTexture(512, 4, (g, w, h) => {
    const rnd = seeded(5);
    g.clearRect(0, 0, w, h);
    // Broad bands, each several pixels wide: fine ones shimmer when the ring is seen edge-on.
    let band = 0;
    let left = 0;
    for (let x = 0; x < w; x++) {
      const t = x / w;
      if (left-- <= 0) {
        band = (rnd() - 0.5) * 0.3;
        left = 6 + Math.floor(rnd() * 22);
      }
      let a = 0.5 + 0.22 * Math.sin(t * 19) * Math.sin(t * 7 + 1) + band;
      if (t > 0.56 && t < 0.63) a *= 0.12; // the gap
      if (t < 0.12) a *= t / 0.12;
      if (t > 0.94) a *= (1 - t) / 0.06;
      const warm = 200 + Math.round(40 * Math.sin(t * 9));
      g.fillStyle = `rgba(${warm + 15},${warm - 8},${warm - 50},${clamp(a, 0, 1)})`;
      g.fillRect(x, 0, 1, h);
    }
  });
  bandsTex.wrapS = THREE.ClampToEdgeWrapping;
  const axis = new THREE.Vector3(...o.axis).normalize();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uMap: { value: bandsTex }, uSun: { value: SUN }, uCentre: { value: new THREE.Vector3(...o.centre) }, uR: { value: o.radius }, uRing: { value: new THREE.Vector2(...o.ring) } },
    vertexShader: `varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uSun; uniform vec3 uCentre; uniform float uR; uniform vec2 uRing; varying vec3 vP;
      void main(){ float r = length(vP - uCentre) / uR; vec4 b = texture2D(uMap, vec2((r - uRing.x) / (uRing.y - uRing.x), 0.5));
        // In the planet's shadow?
        vec3 to = uCentre - vP; float along = dot(to, uSun); float off = length(to - uSun * along);
        float shade = along > 0.0 ? smoothstep(uR * 0.96, uR * 1.03, off) : 1.0;
        vec3 col = b.rgb * (0.05 + 0.95 * shade) * 0.95;
        gl_FragColor = vec4(col, b.a * 0.74);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(o.radius * o.ring[0], o.radius * o.ring[1], 160, 1), mat);
  mesh.position.set(...o.centre);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  mesh.renderOrder = -96;
  scene.add(mesh);
  return { mesh, bandsTex };
}

// ---- things that pass the window: each is a rendered picture at its own depth
const PASSERS = [
  // name, picture, length in metres, depth z, height y (room metres at that depth), seconds to cross, every (s), first at (s), direction, bob
  { name: "rocket", w: 2.0, z: -7.5, y: 1.5, lasts: 8, every: 23, first: 2.5, dir: 1, bob: 0.06, flame: [-0.5, 0.0, 0.3, 0xffb060] },
  { name: "liner", w: 7.5, z: -30, y: 1.75, lasts: 34, every: 52, first: 9, dir: -1, bob: 0.0, flame: [0.44, -0.03, 0.13, 0x7fd8ff] },
  { name: "saucer", w: 1.8, z: -9, y: 1.75, lasts: 11, every: 41, first: 30, dir: -1, bob: 0.2, wobble: true },
  { name: "rock0", w: 1.5, z: -4.6, y: 1.1, lasts: 30, every: 37, first: 14, dir: -1, spin: 0.25 },
  { name: "rock1", w: 0.8, z: -4.0, y: 1.9, lasts: 24, every: 37, first: 17, dir: -1, spin: -0.4 },
  { name: "rock2", w: 0.9, z: -5.4, y: 5.55, lasts: 36, every: 37, first: 12, dir: -1, spin: 0.18 },
];
function buildPassers(tex) {
  for (const p of PASSERS) {
    const t = tex[p.name];
    const h = (p.w * t.image.height) / t.image.width;
    p.mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, h), new THREE.MeshBasicMaterial({ map: t, color: 0xd8d8d8, transparent: true, depthWrite: false, toneMapped: true }));
    p.mesh.renderOrder = -95 + (p.z + 30) * 0.01;
    p.mesh.visible = false;
    scene.add(p.mesh);
    if (p.flame) {
      p.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radial, color: p.flame[3], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      p.glow.position.set(p.flame[0] * p.w, p.flame[1] * p.w, 0.01);
      p.mesh.add(p.glow);
    }
    p.next = p.first;
  }
}
/** How far left and right of the middle a thing at depth z must go to be off any screen. */
const offstage = (z) => ((CAM.z - z) / D_WALL) * 11.5 + 3;
function runPassers(t) {
  for (const p of PASSERS) {
    if (!p.mesh.visible && t >= p.next) {
      p.start = p.next;
      p.mesh.visible = true;
    }
    if (!p.mesh.visible) continue;
    const u = (t - p.start) / p.lasts;
    if (u >= 1) {
      p.mesh.visible = false;
      p.next = p.start + p.every;
      continue;
    }
    const edge = offstage(p.z) + p.w;
    const k = (CAM.z - p.z) / D_WALL;
    const hold = p.wobble ? 0.08 * Math.sin(u * Math.PI * 3) : 0;
    p.mesh.position.set(-p.dir * edge + p.dir * 2 * edge * (u + hold), CAM.y + (p.y - CAM.y) * k + (p.bob ? Math.sin(t * 2.1 + p.z) * p.bob * k : 0), p.z);
    if (p.spin) p.mesh.rotation.z = t * p.spin;
    if (p.wobble) p.mesh.rotation.z = Math.sin(t * 2.6) * 0.12;
    if (p.glow) p.glow.scale.setScalar(p.flame[2] * p.w * (0.75 + 0.25 * Math.sin(t * 43) * Math.sin(t * 17)));
  }
}

// ---- shooting stars and comets: a streak of light, drawn on the glass side of the stars
const streaks = [];
function buildStreaks() {
  const tex = canvasTexture(256, 32, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.85, "rgba(190,225,255,.75)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2 - 5);
    g.lineTo(w, h / 2 + 5);
    g.closePath();
    g.fill();
    const head = g.createRadialGradient(w - 10, h / 2, 0, w - 10, h / 2, 10);
    head.addColorStop(0, "rgba(255,255,255,1)");
    head.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = head;
    g.fillRect(w - 22, 0, 22, h);
  });
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.125), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    m.visible = false;
    m.renderOrder = -94;
    scene.add(m);
    streaks.push({ m, until: 0 });
  }
}
let nextStreak = 4;
/** A streak through the point (x, y) on the plane at depth z, in room metres. */
function shoot(t, x, y, { z = -40, len = 9, lasts = 0.9, angle = -0.28 - Math.random() * 0.2, dir = Math.random() < 0.5 ? 1 : -1 } = {}) {
  const s = streaks.find((q) => !q.m.visible) ?? streaks[0];
  Object.assign(s, { t0: t, until: t + lasts, x, y, z, len, angle: dir > 0 ? angle : Math.PI - angle, lasts });
  s.m.visible = true;
}
function runStreaks(t) {
  if (!still && t > nextStreak) {
    const k = (CAM.z + 40) / D_WALL;
    shoot(t, (Math.random() - 0.5) * 14 * k, CAM.y + (1.2 + Math.random() * 5 - CAM.y) * k);
    nextStreak = t + 4 + Math.random() * 6;
  }
  for (const s of streaks) {
    if (!s.m.visible) continue;
    const u = (t - s.t0) / s.lasts;
    if (u >= 1) {
      s.m.visible = false;
      continue;
    }
    const travel = s.len * 2.2 * (u - 0.5);
    s.m.position.set(s.x + Math.cos(s.angle) * travel, s.y + Math.sin(s.angle) * travel, s.z);
    s.m.rotation.z = s.angle;
    s.m.scale.set(s.len * Math.sin(u * Math.PI), s.len * 0.6, 1);
    s.m.material.opacity = Math.sin(u * Math.PI);
  }
}

// ================================================================== the room, from its rendered picture
let shell = null;
const LIGHTS = ["lamp0", "lamp1", "lamp2", "lamp3", "lamp4", "strips", "holo"];
function buildShell(base, lights) {
  const n = LIGHTS.length;
  const grid = P.lightsGrid;
  const tile = (i) => `vec2(${(i % grid.cols).toFixed(1)}, ${Math.floor(i / grid.cols).toFixed(1)})`;
  const r = P.rect;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uBase: { value: base },
      uLights: { value: lights },
      uGain: { value: new Array(n).fill(0) },
      uTint: { value: Array.from({ length: n }, () => new THREE.Color(1, 1, 1)) },
      uSway: { value: new Array(n).fill(0) },
      uExposure: { value: Number(Q.get("exposure") ?? 0.95) },
      uGlass: { value: 1 },
      uShine: { value: Number(Q.get("shine") ?? 0.5) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uBase; uniform sampler2D uLights; uniform float uGain[${n}]; uniform vec3 uTint[${n}]; uniform float uSway[${n}]; uniform float uExposure; uniform float uGlass; uniform float uShine;
      varying vec3 vW;
      const vec2 GRID = vec2(${grid.cols.toFixed(1)}, ${grid.rows.toFixed(1)});
      vec3 light(vec2 uv, vec2 at){ vec2 t = (at + clamp(uv, 0.003, 0.997)) / GRID; return texture2D(uLights, vec2(t.x, 1.0 - t.y)).rgb; }
      void main(){
        // Where the camera that took the picture saw this point of the room.
        float k = ${D_WALL.toFixed(4)} / (${CAM.z.toFixed(4)} - vW.z);
        float xm = vW.x * k; float ym = ${CAM.y.toFixed(4)} + (vW.y - ${CAM.y.toFixed(4)}) * k;
        vec2 uv = vec2((960.0 + xm * ${U.toFixed(3)} - ${r.x0.toFixed(1)}) / ${(r.x1 - r.x0).toFixed(1)}, ((6.25 - ym) * ${U.toFixed(3)} - ${r.y0.toFixed(1)}) / ${(r.y1 - r.y0).toFixed(1)});
        vec2 c = clamp(uv, 0.0, 1.0);
        vec3 sum = texture2D(uBase, vec2(c.x, 1.0 - c.y)).rgb;
        ${LIGHTS.map((_, i) => `if (uGain[${i}] > 0.0) sum += light(uv + vec2(uSway[${i}], 0.0), ${tile(i)}) * uGain[${i}] * uTint[${i}];`).join("\n        ")}
        float through = light(uv, ${tile(P.glassTile)}).r * uGlass;
        // The glass holds a picture of the room, but faintly: the universe is the brighter thing.
        sum *= mix(1.0, uShine, through);
        // Past the picture's edge the room carries on as darkness.
        vec2 o2 = abs(uv - 0.5) - 0.5; float past = max(o2.x, o2.y);
        sum *= 1.0 - smoothstep(0.0, 0.1, past);
        gl_FragColor = vec4(sum * uExposure, 1.0 - through);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const g = new THREE.Group();
  const [w, h, zf] = [SPACE.w, SPACE.h, 16];
  const add = (geo, pos, rot) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.renderOrder = -50;
    m.frustumCulled = false;
    g.add(m);
  };
  add(new THREE.PlaneGeometry(w, h), [0, h / 2, ZB], [0, 0, 0]);
  add(new THREE.PlaneGeometry(w, zf - ZB), [0, 0, (zf + ZB) / 2], [-Math.PI / 2, 0, 0]);
  add(new THREE.PlaneGeometry(w, zf - ZB), [0, h, (zf + ZB) / 2], [Math.PI / 2, 0, 0]);
  add(new THREE.PlaneGeometry(zf - ZB, h), [-w / 2, h / 2, (zf + ZB) / 2], [0, Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(zf - ZB, h), [w / 2, h / 2, (zf + ZB) / 2], [0, -Math.PI / 2, 0]);
  scene.add(g);
  shell = { mat, u: mat.uniforms };
  // A lamp's light on the dark blue deck comes back very blue; it is warmed a little so the pool reads as light.
  for (const [i, name] of LIGHTS.entries()) if (name.startsWith("lamp")) shell.u.uTint.value[i].setRGB(1.3, 1.08, 0.86);
}
const gainOf = (name) => P.lights[name].gain;

// ---- the cards: rendered things that stand apart from the walls
const cardShader = (sheet) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uMap: { value: sheet }, uOwn: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uOff: { value: new THREE.Vector2(0, 0) }, uExposure: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uOwn; uniform vec3 uTint; uniform vec2 uOff; uniform float uExposure; varying vec2 vUv;
      void main(){ vec4 a = texture2D(uMap, vUv); vec3 own = texture2D(uMap, vUv - uOff).rgb;
        gl_FragColor = vec4((a.rgb + own * uOwn * uTint) * uExposure, a.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
function card(name, sheet) {
  const c = P.cards[name];
  const S = P.cardsSheet;
  const [l, t] = place(c.x0, c.y0, c.z);
  const [r, b] = place(c.x1, c.y1, c.z);
  const geo = new THREE.PlaneGeometry(r - l, t - b);
  const [ax, ay, aw, ah] = c.at;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (ax + uv.getX(i) * aw) / S.w, 1 - (ay + (1 - uv.getY(i)) * ah) / S.h);
  const mat = cardShader(sheet);
  mat.uniforms.uOff.value.set(0, S.ownRow / S.h);
  mat.uniforms.uExposure.value = shell.u.uExposure.value;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((l + r) / 2, (t + b) / 2, c.z);
  return { mesh, mat, c, top: t, bottom: b, left: l, right: r };
}

// ---- the lamps: a card that swings from the ceiling, a glow, a beam, and the light for the pieces under it
const lamps = [];
const beamMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: { uStrength: { value: 0 }, uColor: { value: LAMP.clone() } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float along = smoothstep(0.0, 0.06, vH) * smoothstep(1.0, 0.5, vH);
        gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
  });
function buildLamps(sheet) {
  for (let i = 0; i < N; i++) {
    const c = card(`lamp${i}`, sheet);
    const x = P.layout.poolX[i];
    const pivot = new THREE.Group();
    pivot.position.set(x, SPACE.h, SPACE.walkZ);
    c.mesh.position.x -= x;
    c.mesh.position.y -= SPACE.h;
    c.mesh.position.z = 0;
    c.mesh.renderOrder = 6;
    pivot.add(c.mesh);
    const halo_ = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radial, color: LAMP, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    halo_.position.set(0, SPACE.lampY - SPACE.h - 0.02, 0.02);
    halo_.renderOrder = 7;
    pivot.add(halo_);
    scene.add(pivot);
    const radius = P.layout.poolR + 0.04;
    const spot = new THREE.SpotLight(LAMP, 0, 0, Math.atan((radius + 0.1) / SPACE.lampY), 0.4, 0);
    spot.position.set(x, SPACE.lampY, SPACE.walkZ);
    spot.target.position.set(x, 0, SPACE.walkZ);
    scene.add(spot, spot.target);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, radius, SPACE.lampY, 40, 1, true), beamMaterial());
    beam.position.set(x, SPACE.lampY / 2, SPACE.walkZ);
    beam.renderOrder = 5;
    scene.add(beam);
    lamps.push({ i, x, cx: boxCentre(i, N), pivot, card: c, halo: halo_, spot, beam, level: 0, aim: 0, swing: 0, swingV: 0, flick: 0, struck: -1 });
  }
}

// ---- the chart table: a card, and over it a globe of light drawn live
let holo = null;
function buildHolo(sheet) {
  const c = card("table", sheet);
  c.mesh.renderOrder = -30;
  scene.add(c.mesh);
  const h = CFG.holo;
  const group = new THREE.Group();
  group.position.set(h.x, h.y, h.z);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: ACCENT.clone() }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      float line(float v, float n, float w){ float f = abs(fract(v * n) - 0.5) * 2.0; return smoothstep(1.0 - w, 1.0, f); }
      void main(){ float g = max(line(vUv.x, 16.0, 0.12), line(vUv.y, 9.0, 0.14));
        float face = abs(dot(normalize(vN), normalize(vV))); float edge = pow(1.0 - face, 2.0);
        float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 1.4 - uTime * 9.0);
        float a = (g * (0.35 + 0.65 * face) + edge * 0.55 + 0.05) * scan * uPower;
        gl_FragColor = vec4(uColor * a, 1.0); }`,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(h.r, 32, 18), mat);
  globe.renderOrder = -28;
  // A little copy of the planet outside, with its ring, at the middle of the chart.
  const core = new THREE.Mesh(new THREE.SphereGeometry(h.r * 0.36, 20, 12), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  core.renderOrder = -29;
  const orbit = new THREE.Mesh(new THREE.RingGeometry(h.r * 0.52, h.r * 0.74, 48), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  orbit.rotation.x = Math.PI / 2 - 0.35;
  orbit.renderOrder = -29;
  // The cone of light it stands in.
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(h.r * 0.95, 0.36, h.y - 1.0, 32, 1, true), beamMaterial());
  cone.material.uniforms.uColor.value = ACCENT.clone();
  cone.material.uniforms.uStrength.value = 0.22;
  cone.position.y = -(h.y - 1.0) / 2;
  cone.renderOrder = -29;
  group.add(cone, core, orbit, globe);
  scene.add(group);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: radial, color: ACCENT, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  glow.position.set(h.x, h.y, h.z - 0.3);
  glow.renderOrder = -31;
  scene.add(glow);
  // Sparks, thrown when it is set off.
  const count = 46;
  const sparks = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3)),
    new THREE.PointsMaterial({ map: radial, color: 0xffffff, size: 0.11, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
  );
  sparks.frustumCulled = false;
  sparks.renderOrder = -27;
  scene.add(sparks);
  holo = { card: c, group, globe, core, orbit, cone, glow, mat, sparks, vel: new Float32Array(count * 3), spin: 0.5, heat: 0, struck: -10, colour: ACCENT.clone() };
}

// ---- the wall's words and pictures: live, as in the room today (stand-ins for the room's own HTML)
const BOXES = [
  { name: "Cork & Bell", art: "cork-and-bell", about: "1-4 players", tag: "Any device" },
  { name: "Who Am I?", art: "who-am-i", url: "https://example.invalid", about: "For 2 players" },
  { name: "Tin Derby", art: "tin-derby", soon: true, about: "Coming soon" },
  { name: "Flood", art: "flood", soon: true, about: "Coming soon" },
  { name: "Fox Trouble", art: "fox-trouble", soon: true, about: "Coming soon" },
];
const posters = [];
const wallQuad = (xw, yw, ww, hw, tex, z = ZB + 0.42, order = -40) => {
  const [l, t] = [wallX(xw), wallY(yw)];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ww / U, hw / U), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  // The words are laid out on the back wall; a quad nearer than the wall is drawn smaller so it still covers the same place.
  const k = (CAM.z - z) / D_WALL;
  m.scale.setScalar(k);
  m.position.set((l + ww / U / 2) * k, CAM.y + (t - hw / U / 2 - CAM.y) * k, z);
  m.renderOrder = order;
  scene.add(m);
  return m;
};
const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h); // an older phone: square corners
};
function buildWall(images) {
  for (const [i, box] of BOXES.entries()) {
    const tex = new THREE.CanvasTexture(boxArt(box, images));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L.bw, L.bh), mat);
    m.position.set(L.xs[i], L.by, ZB + 0.36);
    m.renderOrder = -40;
    scene.add(m);
    posters.push({ mat, glitch: -1 });
    // Its sign: the same size and place as in every room.
    const sw = Math.round(L.signW * 0.84);
    wallQuad(boxCentre(i, N) - sw / 2, L.signTop, sw, 46, canvasTexture(sw * 4, 46 * 4, (g, w, h) => {
      g.scale(w / (sw * 3), h / (58 * 3));
      [w, h] = [sw * 3, 58 * 3];
      g.fillStyle = "rgba(6,10,22,.86)";
      rr(g, 3, 3, w - 6, h - 6, 26);
      g.fill();
      g.strokeStyle = i === 0 ? "rgba(255,95,176,.95)" : "rgba(110,231,255,.5)";
      g.lineWidth = 4;
      g.setLineDash(i === 0 ? [] : [10, 8]);
      g.stroke();
      g.textBaseline = "middle";
      g.font = "800 46px Nunito, system-ui, sans-serif";
      if (box.tag) {
        g.font = "800 38px Nunito, system-ui, sans-serif";
        g.fillStyle = "#cfe8ff";
        g.textAlign = "left";
        g.fillText(box.about, 26, h / 2 + 2);
        const tw = g.measureText(box.tag).width + 40;
        g.fillStyle = "#38c8ff";
        rr(g, w - tw - 26, 34, tw, h - 68, 40);
        g.fill();
        g.fillStyle = "#06101c";
        g.textAlign = "center";
        g.fillText(box.tag, w - tw / 2 - 26, h / 2 + 2);
      } else {
        const tw = g.measureText(box.about).width + 56;
        g.fillStyle = "#fff1e6";
        rr(g, (w - tw) / 2, 30, tw, h - 60, 50);
        g.fill();
        g.fillStyle = "#b3261e";
        g.textAlign = "center";
        g.fillText(box.about, w / 2, h / 2 + 3);
      }
    }));
  }
  // The join sign: its code must stay readable (the QR picture is a stand-in pattern, not a working code).
  wallQuad(181 - 106, 133, 212, 276, canvasTexture(212 * 3, 276 * 3, (g, w, h) => {
    g.fillStyle = "rgba(4,8,20,.9)";
    rr(g, 3, 3, w - 6, h - 6, 24);
    g.fill();
    g.strokeStyle = "rgba(110,231,255,.65)";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#6ee7ff";
    g.font = "700 30px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center";
    g.letterSpacing = "4px";
    g.fillText("SCAN OR TYPE THE CODE", w / 2, 58);
    g.letterSpacing = "0px";
    g.fillStyle = "#fff7ea";
    rr(g, w / 2 - 190, 86, 380, 380, 14);
    g.fill();
    const rnd = seeded(99);
    g.fillStyle = "#101010";
    const cells = 25;
    const cs = 340 / cells;
    const finder = (cx, cy) => {
      g.fillRect(cx, cy, cs * 7, cs * 7);
      g.fillStyle = "#fff7ea";
      g.fillRect(cx + cs, cy + cs, cs * 5, cs * 5);
      g.fillStyle = "#101010";
      g.fillRect(cx + cs * 2, cy + cs * 2, cs * 3, cs * 3);
    };
    for (let y = 0; y < cells; y++)
      for (let x = 0; x < cells; x++) {
        const corner = (x < 8 && y < 8) || (x > cells - 9 && y < 8) || (x < 8 && y > cells - 9);
        if (!corner && rnd() < 0.48) g.fillRect(w / 2 - 170 + x * cs, 106 + y * cs, cs + 0.5, cs + 0.5);
      }
    finder(w / 2 - 170, 106);
    finder(w / 2 + 170 - cs * 7, 106);
    finder(w / 2 - 170, 106 + 340 - cs * 7);
    g.fillStyle = "#fff";
    g.font = "700 168px ui-monospace, Menlo, Consolas, monospace";
    g.fillText("4827", w / 2, 640);
    g.fillStyle = "#9fb4d0";
    g.font = "500 30px ui-monospace, Menlo, Consolas, monospace";
    g.fillText("partygames.n8builds.dev", w / 2, 730);
  }));
  // The Tonight board.
  wallQuad(1722 - 118, 136, 236, 240, canvasTexture(236 * 3, 240 * 3, (g, w, h) => {
    g.fillStyle = "rgba(4,8,20,.9)";
    rr(g, 3, 3, w - 6, h - 6, 18);
    g.fill();
    g.strokeStyle = "rgba(110,231,255,.65)";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#6ee7ff";
    g.font = "700 44px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center";
    g.letterSpacing = "10px";
    g.fillText("TONIGHT", w / 2 + 5, 78);
    g.letterSpacing = "0px";
    g.fillStyle = "rgba(110,231,255,.5)";
    g.fillRect(50, 110, w - 100, 3);
    g.font = "700 56px ui-monospace, Menlo, Consolas, monospace";
    PLAYERS.forEach((p, i) => {
      const y = 190 + i * 88;
      g.textAlign = "left";
      g.fillStyle = "#9fb4d0";
      g.font = "500 40px ui-monospace, Menlo, Consolas, monospace";
      g.fillText(String(i + 1), 46, y);
      g.fillStyle = p.hex;
      g.beginPath();
      g.arc(124, y - 16, 20, 0, 7);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "700 56px ui-monospace, Menlo, Consolas, monospace";
      g.fillText(p.name, 160, y);
      g.textAlign = "right";
      g.fillText(String(p.score), w - 50, y);
    });
    g.fillStyle = "#9fb4d0";
    g.font = "500 30px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center";
    g.fillText("1st 3 pts, 2nd 2, 3rd 1", w / 2, h - 60);
  }));
}

// ---- the lights on the bench that blink, and the ring a touch leaves on the glass
let blinks = null;
const ripples = [];
function buildSmall() {
  const count = 3 * (L.gaps.length + 2);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const info = new Float32Array(count * 2);
  const rnd = seeded(3);
  const xs = [-SPACE.w / 2 + 0.09, ...L.gaps, SPACE.w / 2 - 0.09];
  let n = 0;
  for (const x of xs)
    for (const y of [0.74, 0.8, 0.86]) {
      pos.set([x, y, ZB + 0.35], n * 3);
      info.set([0.5 + rnd() * 2.2, rnd() * 6.28], n * 2);
      n++;
    }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("info", new THREE.BufferAttribute(info, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `attribute vec2 info; uniform float uTime; uniform float uPx; varying vec3 vC;
      void main(){ float on = step(0.0, sin(uTime * info.x + info.y)); float red = step(0.72, fract(info.y * 3.7));
        vC = mix(vec3(0.3, 0.9, 1.0), vec3(1.0, 0.3, 0.3), red) * (0.25 + 0.75 * on);
        gl_PointSize = 5.0 * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vC * smoothstep(1.0, 0.2, d), 1.0); }`,
  });
  blinks = new THREE.Points(geo, mat);
  blinks.frustumCulled = false;
  blinks.renderOrder = -39;
  scene.add(blinks);
  const ringTex = canvasTexture(128, 128, (g) => {
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 56, 0, 7);
    g.stroke();
  });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    m.position.z = ZB + 0.02;
    m.renderOrder = -45;
    m.visible = false;
    scene.add(m);
    ripples.push({ m, t0: -10 });
  }
}

// ================================================================== the pieces
const PLAYERS = [
  { name: "You", hex: "#c8382c", score: 5, x: 420 },
  { name: "Mabel", hex: "#2f8fd0", score: 3, x: 700 },
  { name: "Fitch", hex: "#d9a02a", score: 2, x: 1180 },
  { name: "Tom", hex: "#3f8a4a", score: 0, x: 1460 },
];
const pieces = [];
const mirror = new THREE.Group();
let tags = [];
function buildPieces(env) {
  scene.add(new THREE.HemisphereLight(0x8fb0ff, 0x05070f, 0.55));
  // The planet's light, coming in low through the glass behind them; and the room's own soft light from the front.
  const shine = new THREE.DirectionalLight(0xffc08a, 1.5);
  shine.position.set(4, 1.6, -8);
  const front = new THREE.DirectionalLight(0xc4d8ff, 0.85);
  front.position.set(-2.5, 6, 10);
  scene.add(shine, front, mirror);
  const pm = new THREE.PMREMGenerator(renderer);
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pm.fromEquirectangular(env).texture;
  scene.environmentIntensity = 0.75;
  pm.dispose();
  const rnd = seeded(21);
  for (const [seat, p] of PLAYERS.entries()) {
    const pawn = makePawn(radial);
    dressPawn(pawn, p.hex, true);
    pawn.mat.roughness = 0.3;
    pawn.mat.clearcoat = 1;
    pawn.mat.clearcoatRoughness = 0.12;
    pawn.mat.envMapIntensity = 1;
    // Solid, but drawn in the same back-to-front list as the room's pictures, after them.
    for (const mesh of pawn.turn.children) {
      mesh.material.transparent = true;
      mesh.renderOrder = mesh.material === pawn.mat ? 0 : 1;
    }
    pawn.blob.material.depthTest = false;
    pawn.blob.renderOrder = -12;
    scene.add(pawn.group, pawn.blob);
    // Its reflection in the deck: the same body, standing on its head under the floor.
    const refl = pawn.group.clone();
    refl.traverse((o) => {
      if (!o.isMesh) return;
      o.visible = o.material === pawn.mat;
      if (!o.visible) return;
      o.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
      o.renderOrder = -11;
    });
    mirror.add(refl);
    // The light the deck gives back under its feet.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: radial, color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.renderOrder = -13;
    scene.add(glow);
    pieces.push({ ...p, seat, pawn, refl, glow, piece: { rx: p.x, seat, face: seat % 2 ? -1 : 1, jumpAt: -1e9, fx: {} }, target: p.x, wait: 1 + rnd() * 3, walking: false, moved: 0, rnd });
  }
  tags = PLAYERS.map((p, i) => {
    const el = document.createElement("div");
    el.className = "tag" + (i === 0 ? " you" : "");
    el.innerHTML = `<i style="background:${p.hex}"></i>${p.name}`;
    $("tags").appendChild(el);
    return el;
  });
}
/** The stand-ins wander: to a light, to the dark between two, sometimes a jump. The first one is "you" and the closer view follows it. */
function walkPieces(now, dt) {
  const half = lightHalf(N);
  for (const p of pieces) {
    const piece = p.piece;
    if (still) {
      p.walking = false;
    } else if (Math.abs(p.target - piece.rx) > 2) {
      const dir = Math.sign(p.target - piece.rx);
      piece.rx = clampX(piece.rx + dir * Math.min(Math.abs(p.target - piece.rx), WALK_SPEED * dt));
      piece.face = dir;
      p.walking = true;
    } else {
      p.walking = false;
      p.wait -= dt;
      if (p.wait <= 0) {
        const r = p.rnd();
        if (r < 0.22) piece.jumpAt = now;
        else if (r < 0.75) p.target = boxCentre(Math.floor(p.rnd() * N), N) + (p.rnd() - 0.5) * half * 1.2;
        else p.target = clampX(ROOM.minX + 40 + p.rnd() * (ROOM.maxX - ROOM.minX - 80));
        p.wait = 1.5 + p.rnd() * 4;
      }
    }
  }
}
const lampOver = (xw) => {
  let best = { lit: 0, x: xw, d: Infinity };
  const half = lightHalf(N);
  for (const b of lamps) {
    if (!(b.level > 0.002)) continue;
    const d = Math.abs(xw - b.cx);
    if (d < best.d) best = { lit: Math.min(1, 0.5 + 0.5 * b.level) * clamp((half + 150 - d) / 150, 0, 1), x: b.cx, d };
  }
  return best;
};
function drawPieces(now, dt) {
  for (const p of pieces) {
    const { pawn, piece } = p;
    const lamp = lampOver(piece.rx);
    posePawn(pawn, piece, now, dt, { walking: p.walking, lit: lamp.lit, calm: false });
    // The room has real light, so the paint is not dimmed: the light does it.
    pawn.mat.color.copy(pawn.colour);
    pawn.mat.emissiveIntensity = 0.03;
    const away = lamp.lit > 0 ? clamp((piece.rx - lamp.x) / (lightHalf(N) + 60), -1, 1) : 0;
    pawn.blob.position.x += away * 0.2;
    pawn.blob.scale.multiplyScalar(1.3);
    pawn.blob.scale.x *= 1 + Math.abs(away) * 0.6;
    pawn.blob.material.opacity = Math.min(1, pawn.blob.material.opacity * (0.75 + 0.8 * lamp.lit));
    const r = p.refl;
    const [tilt, mt] = [pawn.group.children[0], r.children[0]];
    const [turn, mturn] = [tilt.children[0], mt.children[0]];
    r.position.set(pawn.group.position.x, -pawn.group.position.y, pawn.group.position.z);
    r.scale.set(1, -1, 1);
    mt.rotation.copy(tilt.rotation);
    mt.scale.copy(tilt.scale);
    mturn.rotation.copy(turn.rotation);
    const body = mturn.children[0];
    body.material.color.copy(pawn.mat.color).multiplyScalar(0.4 + 0.6 * lamp.lit);
    body.material.opacity = (0.16 + 0.2 * lamp.lit) * Math.max(0, 1 - pawn.group.position.y * 0.9);
    // The deck lights up under a piece that is moving, and fades behind it.
    p.moved += ((p.walking ? 1 : 0.25) - p.moved) * Math.min(1, dt * 4);
    p.glow.position.set(walkX(piece.rx), 0.01, SPACE.walkZ + 0.05);
    p.glow.material.opacity = 0.34 * p.moved;
  }
}

// ================================================================== the room's life
function runLamps(t, dt) {
  const half = lightHalf(N);
  for (const b of lamps) {
    const inside = pieces.filter((p) => Math.abs(p.piece.rx - b.cx) <= half).length;
    const aim = inside ? Math.min(1.25, 0.8 + 0.15 * inside) : 0;
    if (aim > 0 && b.aim === 0) b.struck = t; // it stutters as it comes on, like a tube
    b.aim = aim;
    b.level += (aim - b.level) * Math.min(1, dt * 7);
    // A lamp that was knocked swings and flickers.
    const acc = -22 * b.swing - 1.6 * b.swingV;
    b.swingV += acc * dt;
    b.swing += b.swingV * dt;
    b.pivot.rotation.z = b.swing;
    const since = t - b.struck;
    let flick = 1;
    if (since >= 0 && since < 0.45) flick = Math.sin(since * 70) > -0.2 ? 1 : 0.25;
    if (b.flick > 0) {
      b.flick -= dt;
      flick *= Math.sin(t * 61) * Math.sin(t * 23) > -0.15 ? 1 : 0.3;
    }
    const idle = 0; // a lamp nobody stands under gives the room nothing, so its layer is not looked up at all
    const level = Math.max(b.flick > 0 ? 0.7 : 0, b.level) * flick;
    const glowing = Math.min(1, level * 8);
    const k = 0.3 * glowing + 0.7 * level;
    shell.u.uGain.value[b.i] = gainOf(`lamp${b.i}`) * (idle + k * 1.6);
    shell.u.uSway.value[b.i] = -b.swing * 0.035;
    b.card.mat.uniforms.uOwn.value = b.card.c.ownGain * (0.06 + k) * 0.7;
    b.spot.intensity = 5.0 * k;
    b.spot.position.x = b.x - Math.sin(b.swing) * (SPACE.h - SPACE.lampY);
    b.beam.material.uniforms.uStrength.value = 0.07 * glowing + 0.08 * level;
    b.beam.visible = level > 0.002;
    b.beam.rotation.z = b.swing * 0.5;
    b.halo.material.opacity = 0.1 + (0.28 + 0.4 * Math.min(level, 1.3)) * glowing;
    b.halo.scale.setScalar(0.9 + level * 0.9);
    const post = posters[b.i];
    const g = post.glitch > 0 ? (Math.sin(t * 90) > 0 ? 1.5 : 0.25) : 1;
    post.glitch -= dt;
    post.mat.color.setScalar((0.3 + 0.66 * glowing) * g);
  }
}
function runHolo(t, dt) {
  const h = holo;
  const since = t - h.struck;
  const hot = since >= 0 && since < 4.5 ? Math.max(0, 1 - since / 4.5) : 0;
  h.heat += (hot - h.heat) * Math.min(1, dt * 6);
  h.spin += ((0.5 + hot * 13) - h.spin) * Math.min(1, dt * 3);
  h.globe.rotation.y += h.spin * dt;
  h.orbit.rotation.z += h.spin * dt * 0.6;
  h.colour.copy(ACCENT).lerp(PINK, Math.min(1, h.heat * 1.6));
  const jitter = h.heat > 0.05 ? (Math.sin(t * 80) * Math.sin(t * 37) > 0.4 ? 0.55 : 1) : 1;
  const breathe = 0.92 + 0.08 * Math.sin(t * 1.7);
  h.mat.uniforms.uColor.value.copy(h.colour);
  h.mat.uniforms.uTime.value = t;
  h.mat.uniforms.uPower.value = (0.5 + h.heat * 0.6) * jitter * breathe;
  h.core.material.color.copy(h.colour);
  h.orbit.material.color.copy(h.colour);
  h.cone.material.uniforms.uColor.value.copy(h.colour);
  h.glow.material.color.copy(h.colour);
  h.glow.material.opacity = (0.1 + 0.25 * h.heat) * jitter * breathe;
  h.group.scale.setScalar(1 + 0.12 * h.heat * Math.sin(t * 30));
  const power = (0.75 + 1.4 * h.heat) * jitter * breathe;
  const i = LIGHTS.indexOf("holo");
  shell.u.uGain.value[i] = gainOf("holo") * power;
  // The chart's layer was rendered in its resting colour; this turns that colour into the one it has now.
  shell.u.uTint.value[i].setRGB(h.colour.r / ACCENT.r, h.colour.g / ACCENT.g, h.colour.b / ACCENT.b);
  h.card.mat.uniforms.uOwn.value = h.card.c.ownGain * power;
  h.card.mat.uniforms.uTint.value.copy(shell.u.uTint.value[i]);
  // Sparks fly out and fall.
  const pos = h.sparks.geometry.attributes.position;
  if (since >= 0 && since < 1.6) {
    for (let k = 0; k < pos.count; k++) {
      h.vel[k * 3 + 1] -= 5.5 * dt;
      pos.array[k * 3] += h.vel[k * 3] * dt;
      pos.array[k * 3 + 1] += h.vel[k * 3 + 1] * dt;
      pos.array[k * 3 + 2] += h.vel[k * 3 + 2] * dt;
    }
    pos.needsUpdate = true;
    h.sparks.material.opacity = Math.max(0, 1 - since / 1.6);
    h.sparks.material.color.copy(h.colour).lerp(new THREE.Color(1, 1, 1), 0.5);
  } else h.sparks.material.opacity = 0;
}
function strikeHolo(t) {
  const h = holo;
  h.struck = t;
  const pos = h.sparks.geometry.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const a = Math.random() * 6.28;
    const s = 1.2 + Math.random() * 2.6;
    pos.array.set([CFG.holo.x, CFG.holo.y, CFG.holo.z + 0.3], k * 3);
    h.vel.set([Math.cos(a) * s, Math.sin(a) * s * 0.8 + 1.4, (Math.random() - 0.3) * 1.5], k * 3);
  }
}
function runSmall(t) {
  const i = LIGHTS.indexOf("strips");
  // The lines of light in the deck breathe slowly.
  shell.u.uGain.value[i] = gainOf("strips") * (0.82 + 0.18 * Math.sin(t * 1.3));
  blinks.material.uniforms.uTime.value = t;
  for (const r of ripples) {
    const u = (t - r.t0) / 0.9;
    r.m.visible = u >= 0 && u < 1;
    if (!r.m.visible) continue;
    r.m.scale.setScalar(0.2 + u * 2.4);
    r.m.material.opacity = 0.8 * (1 - u) * (1 - u);
  }
}

// ================================================================== a touch
/** The point of the plane at depth z under a point of the screen, in room metres. */
function under(cx, cy, z) {
  const box = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector3(((cx - box.left) / box.width) * 2 - 1, -(((cy - box.top) / box.height) * 2 - 1), 0.5).unproject(cam);
  const dir = ndc.sub(cam.position);
  const k = (z - cam.position.z) / dir.z;
  return [cam.position.x + dir.x * k, cam.position.y + dir.y * k];
}
function touch(cx, cy) {
  const t = clock.t;
  // A lamp?
  const [lx, ly] = under(cx, cy, SPACE.walkZ);
  for (const b of lamps)
    if (Math.abs(lx - b.x) < 0.75 && ly > SPACE.lampY - 0.7) {
      b.swingV += (lx >= b.x ? -1 : 1) * 1.5 + (Math.random() - 0.5) * 0.3;
      b.flick = 1.3;
      return say("The lamp swings and flickers, and its pool of light goes with it.");
    }
  // The chart table?
  const [hx, hy] = under(cx, cy, CFG.holo.z);
  if (Math.hypot(hx - CFG.holo.x, hy - CFG.holo.y) < 0.85 || (Math.abs(hx - CFG.holo.x) < 0.6 && hy < CFG.holo.y && hy > 0)) {
    strikeHolo(t);
    return say("The chart spins up, turns pink and throws sparks. Its light on the wall and the deck turns with it.");
  }
  // A screen?
  const [wx, wy] = under(cx, cy, ZB + 0.36);
  for (const [i, x] of L.xs.entries())
    if (Math.abs(wx - x) < L.bw / 2 && Math.abs(wy - L.by) < L.bh / 2) {
      posters[i].glitch = 0.45;
      lamps[i].flick = 0.5;
      return say("The screen stutters, and so does its lamp.");
    }
  // The glass: a ring where it was touched, and a shooting star through that place.
  const [gx, gy] = under(cx, cy, ZB);
  if (gy > P.layout.sill && gy < P.layout.head && Math.abs(gx) < SPACE.w / 2) {
    const r = ripples.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    r.t0 = t;
    r.m.position.set(gx, gy, ZB + 0.02);
    const [sx, sy] = under(cx, cy, -40);
    shoot(t, sx, sy, { lasts: 0.8, len: 11 });
    return say("A ring on the glass, and a shooting star behind it.");
  }
  // The deck: a piece comes over.
  if (ly < 0.2 || gy < P.layout.sill) {
    const p = pieces[0];
    p.target = clampX(960 + (under(cx, cy, SPACE.walkZ)[0] / WALK) * U);
    p.wait = 4;
    return say("Your piece walks to where you touched.");
  }
}
let sayTimer = 0;
function say(text) {
  const el = $("said");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => el.classList.remove("on"), 3200);
}

// ================================================================== the frame
const clock = { t: still ? 30 : 0, last: performance.now() };
const meter = { frames: [], script: [], shown: 0 };
let view = null;
let eye = 0;
function frameView() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const phone = Math.min(w, h) < 560;
  return viewOf({ w, h, bar: BAR, mode: state.mode, focusX: pieces[0]?.piece.rx ?? 960, phone, boxes: N });
}
function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const ratio = sharp;
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  for (const o of [farStars, nearStars, blinks]) if (o) o.material.uniforms.uPx.value = ratio * Math.max(0.75, h / 520);
}
/** Drawn pixels per screen pixel: at most two, and fewer on a device that cannot keep up (see the meter in tick). */
let sharp = Math.min(window.devicePixelRatio || 1, 2);
let slowSince = 0;
let farStars = null;
let nearStars = null;
let sky = null;
let planet = null;
let moon = null;

function tick(nowMs) {
  requestAnimationFrame(tick);
  const dtReal = Math.min(0.1, (nowMs - clock.last) / 1000);
  meter.frames.push(nowMs - clock.last);
  clock.last = nowMs;
  if (state.look !== "real" || state.paused) return;
  const t0 = performance.now();
  const dt = still ? 0 : dtReal;
  clock.t += dt;
  const t = clock.t;
  const now = t * 1000;

  walkPieces(now, dt);
  runLamps(t, dt);
  drawPieces(now, dt);
  runHolo(t, dt);
  runSmall(t);

  // The view: the frame slides and scales as it does in the room today. New here: the eye slides a
  // little with it, so near things pass in front of far ones.
  const v = frameView();
  view = view ? { x: view.x + (v.x - view.x) * Math.min(1, dtReal * 6), y: view.y + (v.y - view.y) * Math.min(1, dtReal * 6), width: view.width + (v.width - view.width) * Math.min(1, dtReal * 6), height: view.height + (v.height - view.height) * Math.min(1, dtReal * 6) } : v;
  const mid = wallX(view.x + view.width / 2) * WALK;
  const want = state.depth ? clamp(mid * 0.55 + state.drag + (still ? 0 : 0.22 * Math.sin(t * 0.33)), -3.2, 3.2) : 0;
  eye += (want - eye) * Math.min(1, dtReal * 5);
  const n = 1;
  const kWalk = n / (CAM.z - SPACE.walkZ);
  const kWall = n / D_WALL;
  cam.position.set(eye, CAM.y, CAM.z);
  cam.updateMatrixWorld();
  cam.projectionMatrix.makePerspective((wallX(view.x) * WALK - eye) * kWalk, (wallX(view.x + view.width) * WALK - eye) * kWalk, (wallY(view.y) - CAM.y) * kWall, (wallY(view.y + view.height) - CAM.y) * kWall, n, 1600);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

  // Outside: the ship is under way, so the far things turn slowly past, the near ones faster.
  outside.position.set(eye, CAM.y, CAM.z);
  sky.rotation.y = t * 0.0016;
  farStars.rotation.y = t * 0.004;
  nearStars.rotation.y = t * 0.011;
  farStars.material.uniforms.uTime.value = nearStars.material.uniforms.uTime.value = t;
  planet.material.uniforms.uTurn.value = (t / CFG.planet.turnSeconds) % 1;
  planet.material.uniforms.uTime.value = t;
  moon.material.uniforms.uTurn.value = (t / CFG.moon.turnSeconds) % 1;
  runPassers(t);
  runStreaks(t);

  renderer.render(scene, cam);

  // The names over the pieces (HTML, as in the room).
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const proj = new THREE.Vector3();
  const spots = pieces.map((p, i) => {
    proj.set(p.pawn.group.position.x, p.pawn.group.position.y + 1.02, SPACE.walkZ).project(cam);
    return { i, x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h };
  });
  // Two names over two pieces that stand together: the one on the right goes up a line.
  spots.sort((a, b) => a.x - b.x);
  for (const [k, s] of spots.entries()) {
    const near = k > 0 && s.x - spots[k - 1].x < 64 && !spots[k - 1].raised;
    s.raised = near;
    tags[s.i].style.transform = `translate(${s.x}px, ${s.y - (near ? 24 : 0)}px) translate(-50%, -100%)`;
  }

  meter.script.push(performance.now() - t0);
  if (nowMs - meter.shown > 500 && meter.frames.length > 5) {
    const f = meter.frames.slice(-90);
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const worst = Math.max(...f);
    const s = meter.script.slice(-90);
    const sc = s.reduce((a, b) => a + b, 0) / s.length;
    $("meter").textContent = `frame ${avg.toFixed(1)} ms (${Math.round(1000 / avg)} a second) · worst ${worst.toFixed(0)} ms · script ${sc.toFixed(1)} ms · ${sharp.toFixed(2).replace(/\.?0+$/, "")}x`;
    meter.frames = f;
    meter.script = s;
    meter.shown = nowMs;
    // A device that cannot hold sixty a second draws fewer pixels instead: slower than 20 ms for two seconds, and the picture is drawn a step smaller.
    if (avg > 20 && sharp > 1 && !still && !Q.has("fixed")) {
      slowSince ||= nowMs;
      if (nowMs - slowSince > 2000) {
        sharp = Math.max(1, sharp - 0.25);
        slowSince = 0;
        meter.frames = [];
        resize();
      }
    } else slowSince = 0;
    window.__meter = { avg, worst, script: sc, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }
}

// ================================================================== the page round it
function setLook(look) {
  state.look = look;
  document.body.dataset.look = look;
  for (const b of document.querySelectorAll("[data-look-set]")) b.setAttribute("aria-pressed", String(b.dataset.lookSet === look));
  $("before").src = A[state.mode === "closer" ? "beforeCloser" : "beforeRoom"];
  $("meter").hidden = look !== "real";
}
function setMode(mode) {
  state.mode = mode;
  for (const b of document.querySelectorAll("[data-mode-set]")) b.setAttribute("aria-pressed", String(b.dataset.modeSet === mode));
  $("before").src = A[mode === "closer" ? "beforeCloser" : "beforeRoom"];
}
function setDepth(on) {
  if (on !== state.depth) state.drag = 0;
  state.depth = on;
  $("depth").setAttribute("aria-pressed", String(on));
  $("depth").textContent = on ? "Depth: on" : "Depth: off";
}
function wire() {
  for (const b of document.querySelectorAll("[data-look-set]")) b.addEventListener("click", () => setLook(b.dataset.lookSet));
  for (const b of document.querySelectorAll("[data-mode-set]")) b.addEventListener("click", () => setMode(b.dataset.modeSet));
  $("depth").addEventListener("click", () => setDepth(!state.depth));
  $("notes-open").addEventListener("click", () => document.body.classList.toggle("notes-on"));
  $("notes-shut").addEventListener("click", () => document.body.classList.remove("notes-on"));
  // A touch on the stage: a short one sets something off, a drag moves the eye.
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, drag: state.drag, moved: false };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // a touch that has already ended: nothing to hold on to
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) > 8) down.moved = true;
    if (down.moved && state.depth) state.drag = clamp(down.drag - ((e.clientX - down.x) / stage.clientWidth) * 7, -3, 3);
  });
  const up = (e) => {
    if (down && !down.moved && e.type === "pointerup") touch(e.clientX, e.clientY);
    down = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => (clock.last = performance.now()));
}

async function start() {
  const image = (name) =>
    new Promise((done, fail) => {
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => fail(new Error(`the picture "${name}" did not load`));
      img.src = A[name];
    });
  const [base, lights, sheet, env, planetMap, moonMap, skyMap, corkArt, ...sprites] = await Promise.all([
    texture("base"),
    texture("lights", { mips: false }),
    texture("cards"),
    texture("env", { mips: false }),
    texture("planet", { repeat: true }),
    texture("moon", { repeat: true }),
    texture("sky", { repeat: true }),
    image("corkArt"),
    ...PASSERS.map((p) => texture(p.name)),
    document.fonts?.load('400 40px "Abril Fatface"').catch(() => null),
    document.fonts?.load('800 40px "Nunito"').catch(() => null),
  ]);
  sky = buildSky(skyMap);
  farStars = buildStars(3000, 61, 2.4, 1.2);
  nearStars = buildStars(240, 19, 5.0, 1.9);
  planet = ball(planetMap, CFG.planet, { ringed: true, air: 1 });
  halo(CFG.planet);
  const ring = buildRing(CFG.planet);
  planet.material.uniforms.uRingMap.value = ring.bandsTex;
  moon = ball(moonMap, { ...CFG.moon }, { air: 0 });
  buildPassers(Object.fromEntries(PASSERS.map((p, i) => [p.name, sprites[i]])));
  buildStreaks();
  buildShell(base, lights);
  buildWall({ "cork-and-bell": corkArt });
  buildSmall();
  buildHolo(sheet);
  buildLamps(sheet);
  buildPieces(env);
  wire();
  resize();
  setMode(state.mode);
  setLook(Q.get("look") === "today" ? "today" : "real");
  setDepth(state.depth);
  if (still) {
    // A fixed moment for a screenshot: two in the first light, one in the third.
    pieces[0].piece.rx = boxCentre(0, N) - 40;
    pieces[1].piece.rx = boxCentre(0, N) + 46;
    pieces[2].piece.rx = boxCentre(2, N) + 10;
    pieces[3].piece.rx = boxCentre(3, N) + 150;
    for (const b of lamps) b.level = b.aim = pieces.some((p) => Math.abs(p.piece.rx - b.cx) <= lightHalf(N)) ? 1 : 0;
    for (const p of PASSERS) if (["liner", "rock0", "rock1"].includes(p.name)) p.next = clock.t - p.lasts * (p.name === "liner" ? 0.55 : 0.4);
  }
  document.body.classList.add("ready");
  // For the checks (shoot.mjs): what the lamps and the pieces are doing.
  window.__probe = () => ({ lamps: lamps.map((b) => ({ level: +b.level.toFixed(2), gain: +shell.u.uGain.value[b.i].toFixed(2), halo: +b.halo.material.opacity.toFixed(2), spot: +b.spot.intensity.toFixed(2) })), pieces: pieces.map((p) => Math.round(p.piece.rx)), eye: +eye.toFixed(2), view });
  window.__ready = true;
  requestAnimationFrame(tick);
}
start().catch((err) => {
  console.error(err);
  $("said").textContent = "This preview could not start: " + err.message;
  $("said").classList.add("on");
});
