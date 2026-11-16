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
import { THINGS, createSky } from "./sky.js";

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
const SPEED = Math.max(1, Number(Q.get("speed") ?? 1) || 1);

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance", alpha: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x01020a, 1);
renderer.sortObjects = true;
renderer.autoClear = false;
renderer.info.autoReset = false; // a frame is two drawings; the count of draw calls is for both
// Two pictures, drawn one after the other, every frame:
//   1. `outside`: everything beyond the glass (sky, stars, planet, moon, and whatever is passing, with its lights).
//   2. `scene`: the room, drawn over it. The room's picture is solid everywhere but the glass.
// What is outside is put in the first and can never be drawn after the room, whatever its own
// drawing order says. (Round one kept both in one list, and an engine's glow, added as a child of
// its ship, fell back to the default place in that list: after the room, so over the door and the wall.)
const scene = new THREE.Scene();
const sceneOut = new THREE.Scene();
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
sceneOut.add(outside);

/** A small picture of tangled noise that repeats without a seam, for the fine grain of a surface:
 *  red is its height, green and blue the slope of that height (east and north), alpha a second, unrelated height. */
function grainTexture(size = 256) {
  const rnd = seeded(77);
  const field = (octaves) => {
    const h = new Float32Array(size * size);
    let amp = 1;
    let sum = 0;
    for (const cells of octaves) {
      const g = new Float32Array(cells * cells);
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      const s = (v) => v * v * (3 - 2 * v);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cells;
          const fy = (y / size) * cells;
          const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
          const [tx, ty] = [s(fx - x0), s(fy - y0)];
          const at = (cx, cy) => g[(cy % cells) * cells + (cx % cells)];
          h[y * size + x] += amp * (at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty);
        }
      sum += amp;
      amp *= 0.55;
    }
    for (let i = 0; i < h.length; i++) h[i] /= sum;
    return h;
  };
  const a = field([4, 8, 16, 32, 64]);
  const b = field([3, 6, 12, 24, 48]);
  const px = new Uint8Array(size * size * 4);
  const w = (v) => (v + size) % size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = a[y * size + w(x + 1)] - a[y * size + w(x - 1)];
      const dy = a[w(y + 1) * size + x] - a[w(y - 1) * size + x];
      px.set([clamp(a[i] * 255, 0, 255), clamp(127.5 + dx * 1800, 0, 255), clamp(127.5 + dy * 1800, 0, 255), clamp(b[i] * 255, 0, 255)], i * 4);
    }
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
const grain = grainTexture();

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
function ball(map, o, { gas = false, air = 0 } = {}) {
  const axis = new THREE.Vector3(...(o.axis ?? [0, 1, 0])).normalize();
  const centre = new THREE.Vector3(...o.centre);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uMap: { value: map }, uGrain: { value: grain }, uTurn: { value: 0 }, uSun: { value: SUN }, uCentre: { value: centre }, uAxis: { value: axis }, uR: { value: o.radius }, uRing: { value: new THREE.Vector2(...(o.ring ?? [0, 0])) }, uRingMap: { value: null }, uAir: { value: air }, uTime: { value: 0 }, uDetail: { value: Q.get("detail") === "off" ? 0 : 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uMap; uniform sampler2D uGrain; uniform sampler2D uRingMap; uniform float uTurn; uniform vec3 uSun; uniform vec3 uCentre; uniform vec3 uAxis; uniform float uR; uniform vec2 uRing; uniform float uAir; uniform float uTime; uniform float uDetail;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      float grey(vec3 c){ return dot(c, vec3(0.3, 0.6, 0.1)); }
      ${
        gas
          ? `// A storm: the belts round one place are wound into a spiral. s = where (across, up), how big, how flat; it returns how deep in the storm this point is.
      float storm(inout vec2 uv, vec4 s, float wind){
        float wide = 2.0 * cos((s.y - 0.5) * 3.14159);
        vec2 d = vec2((fract(uv.x - s.x + 0.5) - 0.5) * wide, (uv.y - s.y) * s.w);
        float r = length(d) / s.z;
        if (r >= 1.0) return 0.0;
        float f = (1.0 - r) * (1.0 - r);
        float a = wind * f;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
        uv += vec2((q.x - d.x) / wide, (q.y - d.y) / s.w);
        return f;
      }`
          : ""
      }
      void main(){
        vec3 n = normalize(vN);
        // East and north on the surface here, and where the sun is in those terms: for the relief.
        vec3 east = normalize(cross(uAxis, n)); vec3 north = cross(n, east);
        vec2 sun2 = vec2(dot(uSun, east), dot(uSun, north));
        vec2 uv = vec2(vUv.x + uTurn, vUv.y);
        vec3 albedo; float relief = 0.0;
        ${
          gas
            ? `// The belts do not all turn together: the faster ones slide past the slower ones a little.
        uv.x += 0.006 * sin(vUv.y * 31.0 + uTime * 0.05) + 0.003 * sin(vUv.y * 77.0 - uTime * 0.08);
        // Three storms, carried round with the planet: one great red one and two pale ones.
        float breathe = 0.35 * sin(uTime * 0.07);
        // (The window looks down on the planet's far north, from about 40 degrees up from its middle to nearly the pole, so that is where they are.
        // Measured, not guessed: the surface's own coordinates were drawn as colours and read off a still.)
        float great = storm(uv, vec4(0.02, 0.812, 0.034, 1.15), 4.2 + breathe) * uDetail;
        float pale = (storm(uv, vec4(0.42, 0.875, 0.015, 1.1), -3.6 - breathe) + storm(uv, vec4(0.71, 0.80, 0.017, 1.1), 3.2 + breathe)) * uDetail;
        // Fine weather the picture is too coarse to hold: its edges are torn by two sizes of noise that drift slowly against each other.
        vec4 g1 = texture2D(uGrain, uv * vec2(10.0, 7.0) + vec2(uTime * 0.0007, 0.0));
        vec4 g2 = texture2D(uGrain, uv * vec2(46.0, 30.0) - vec2(uTime * 0.0016, 0.0));
        // It is wind, so it tears along the belts far more than across them.
        vec2 tear = ((g1.gb - 0.5) * vec2(0.0075, 0.0022) + (g2.gb - 0.5) * vec2(0.0024, 0.0008)) * uDetail;
        vec2 at = uv + tear;
        albedo = texture2D(uMap, at).rgb;
        // Cloud tops are soft: they only show their height where the sun is low, and then only a little.
        relief = dot(g2.gb - 0.5, sun2) * -0.26 * uDetail;
        // Grain in the colour itself: thin streaks along the belts, and the faintest mottle across them.
        float streak = texture2D(uGrain, at * vec2(14.0, 230.0)).a;
        albedo *= 1.0 + ((g2.r - 0.5) * 0.1 + (streak - 0.5) * 0.16) * uDetail;
        albedo = mix(albedo, albedo * mix(vec3(1.05, 0.98, 0.93), vec3(0.96, 1.0, 1.05), g1.a), 0.5 * uDetail);
        // The storms' own colour: the great one's red eye inside a pale collar, the small ones white.
        albedo = mix(albedo, albedo * vec3(1.04, 0.47, 0.3), smoothstep(0.1, 0.7, great) * 0.85);
        albedo = mix(albedo, vec3(1.0, 0.93, 0.8), (smoothstep(0.0, 0.1, great) * (1.0 - smoothstep(0.1, 0.3, great)) * 0.35 + smoothstep(0.1, 0.8, pale) * 0.5));`
            : `// The moon: its own picture, with its pits and ridges standing up in the sun.
        albedo = texture2D(uMap, uv).rgb;
        vec4 g2 = texture2D(uGrain, uv * vec2(8.0, 4.0));
        relief = ((grey(albedo) - grey(texture2D(uMap, uv + sun2 * vec2(0.004, 0.008)).rgb)) * 3.0 + dot(g2.gb - 0.5, sun2) * -0.6) * uDetail;
        albedo *= 1.0 + (g2.r - 0.5) * 0.25 * uDetail;`
        }
        vec3 v = normalize(cameraPosition - vP);
        float face = max(dot(n, v), 0.0);
        float d = dot(n, uSun);
        // Relief shows most where the sun is low: it is nearly nothing at noon and strong toward the edge of day.
        float low = 1.0 - smoothstep(0.1, 0.8, d);
        relief *= mix(1.0, low, uAir);
        float lit = smoothstep(-0.1, 0.42, d + relief);
        // The planet's colours are deepened; the moon is left as it was painted.
        albedo = mix(albedo, mix(vec3(grey(albedo)), albedo, 1.3) * mix(vec3(1.0), albedo, 0.75), uAir);
        vec3 col = albedo * (lit * mix(1.7, 1.25, uAir) * (1.0 + relief * 0.55 * uAir) + 0.012);
        ${
          gas
            ? `// The ring's shadow lies across the lit side.
        float den = dot(uSun, uAxis);
        float t = dot(uCentre - vP, uAxis) / (abs(den) < 1e-4 ? 1e-4 : den);
        if (t > 0.0) { float r = length(vP + uSun * t - uCentre) / uR; if (r > uRing.x && r < uRing.y) col *= 1.0 - 0.62 * texture2D(uRingMap, vec2((r - uRing.x) / (uRing.y - uRing.x), 0.5)).a; }
        // Day's edge: the last light comes through a lot of air and goes red, and the night side is not black (the ring lights it a little).
        float dusk = smoothstep(-0.12, 0.08, d) * (1.0 - smoothstep(0.08, 0.5, d));
        col *= mix(vec3(1.0), vec3(1.12, 0.74, 0.5), dusk * uDetail);
        col += albedo * vec3(0.016, 0.022, 0.035) * (1.0 - lit) * uDetail;
        // Its air, thicker the more of it the eye looks through: toward the edge the surface darkens and a blue haze lies over it.
        // (From this window nearly all of the planet is seen at a slant, so this is kept to its last edge: any more and the whole of it goes pale.)
        float haze = pow(1.0 - face, 9.0);
        col = mix(col, vec3(0.42, 0.62, 0.95) * (0.05 + lit) * 0.95, haze * 0.5 * uDetail);`
            : ""
        }
        // A thin bright edge where the ball turns away, strongest on the lit side.
        float rim = pow(1.0 - face, 7.0);
        col += vec3(0.55, 0.75, 1.0) * rim * uAir * (0.1 + lit) * 0.7;
        // The very edge is faded over a pixel or so, so the ball has a clean outline on a phone that does not smooth edges itself:
        // the moon fades into the sky behind it, the planet into the colour of the glow of air that is drawn round it.
        float edge = clamp(face / max(fwidth(face) * 1.5, 1e-5), 0.0, 1.0);
        ${
          gas
            ? `vec3 glow = pow(vec3(0.45, 0.68, 1.0) * (0.06 + smoothstep(-0.25, 0.5, d)) * 0.8, vec3(2.2)) * 1.7;
        gl_FragColor = vec4(mix(glow, col, edge), 1.0);`
            : `gl_FragColor = vec4(col, edge);`
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.radius, 192, 96), mat);
  mesh.position.copy(centre);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  mesh.renderOrder = -97;
  sceneOut.add(mesh);
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
  mesh.renderOrder = -96.5; // after the planet, which hides the part of this shell that is behind it (so that part costs nothing)
  sceneOut.add(mesh);
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
  sceneOut.add(mesh);
  return { mesh, bandsTex };
}

// ---- things that pass the window: each is a rendered picture at its own depth
// When each one passes is not decided here: the sky's timetable (sky.js) says what is passing, one thing at a time.
const PASSERS = [
  // name, length in metres, depth z, height y (room metres at that depth), direction, bob;
  // flame: where its engine is (in lengths from its middle), how long and how thick the flame is (in lengths), its colour.
  { name: "rocket", w: 2.0, z: -7.5, y: 1.5, dir: 1, bob: 0.06, flames: [{ at: [-0.355, 0.0], len: 0.42, thick: 0.15, colour: 0xffa050 }] },
  { name: "liner", w: 7.5, z: -30, y: 1.75, dir: -1, bob: 0.0, flames: [{ at: [0.405, -0.022], len: 0.09, thick: 0.034, colour: 0x7fd8ff }] },
  { name: "saucer", w: 1.8, z: -9, y: 1.75, dir: -1, bob: 0.2, wobble: true },
  { name: "rock0", w: 1.5, z: -4.6, y: 1.1, dir: -1, spin: 0.25 },
  { name: "rock1", w: 0.8, z: -4.0, y: 1.9, dir: -1, spin: -0.4 },
  { name: "rock2", w: 0.9, z: -5.4, y: 1.5, dir: -1, spin: 0.18 },
];
for (const p of PASSERS) p.lasts = THINGS.find((t) => t.name === p.name).lasts;
const timetable = createSky();
const LABEL = { star: "shooting star", rocket: "rocket", liner: "liner", saucer: "saucer", rock0: "rock", rock1: "rock", rock2: "rock" };
/** An engine's flame: hot and white at the nozzle, thinning to a point behind. It points to the picture's left. */
const flameTex = canvasTexture(256, 64, (g, w, h) => {
  const body = g.createLinearGradient(0, 0, w, 0);
  body.addColorStop(0, "rgba(255,255,255,0)");
  body.addColorStop(0.45, "rgba(255,255,255,.28)");
  body.addColorStop(0.86, "rgba(255,255,255,.9)");
  body.addColorStop(1, "rgba(255,255,255,1)");
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(0, h / 2);
  g.quadraticCurveTo(w * 0.6, h * 0.08, w - 4, h * 0.14);
  g.lineTo(w - 4, h * 0.86);
  g.quadraticCurveTo(w * 0.6, h * 0.92, 0, h / 2);
  g.fill();
  // Soft edges: the same shape blurred over itself.
  g.globalCompositeOperation = "destination-in";
  const soft = g.createLinearGradient(0, 0, 0, h);
  soft.addColorStop(0, "rgba(0,0,0,0)");
  soft.addColorStop(0.5, "rgba(0,0,0,1)");
  soft.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = soft;
  g.fillRect(0, 0, w, h);
});
function buildPassers(tex) {
  for (const p of PASSERS) {
    const t = tex[p.name];
    const h = (p.w * t.image.height) / t.image.width;
    p.mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, h), new THREE.MeshBasicMaterial({ map: t, color: 0xd8d8d8, transparent: true, depthWrite: false, depthTest: false, toneMapped: true }));
    p.mesh.renderOrder = -95;
    p.mesh.visible = false;
    sceneOut.add(p.mesh);
    p.flameMeshes = (p.flames ?? []).map((f) => {
      // The flame trails behind: to the left of a thing heading right, to the right of one heading left.
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(-0.5, 0, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: flameTex, color: f.colour, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      m.position.set(f.at[0] * p.w, f.at[1] * p.w, 0);
      m.rotation.z = p.dir > 0 ? 0 : Math.PI;
      m.renderOrder = -95.5; // under its ship, and (like the ship) in the outside picture: the room is drawn over both
      p.mesh.add(m);
      return { m, f };
    });
  }
}
/** How far left and right of the middle a thing at depth z must go to be off any screen. */
const offstage = (z) => ((CAM.z - z) / D_WALL) * 11.5 + 3;
/** Puts one passing thing where it is at the point u (0 to 1) of its way. */
function placePasser(p, u, t) {
  const edge = offstage(p.z) + p.w;
  const k = (CAM.z - p.z) / D_WALL;
  const hold = p.wobble ? 0.08 * Math.sin(u * Math.PI * 3) : 0;
  p.mesh.position.set(-p.dir * edge + p.dir * 2 * edge * (u + hold), CAM.y + (p.y - CAM.y) * k + (p.bob ? Math.sin(t * 2.1 + p.z) * p.bob * k : 0), p.z);
  if (p.spin) p.mesh.rotation.z = t * p.spin;
  if (p.wobble) p.mesh.rotation.z = Math.sin(t * 2.6) * 0.12;
  for (const { m, f } of p.flameMeshes) m.scale.set(f.len * p.w * (0.82 + 0.18 * Math.sin(t * 43) * Math.sin(t * 17)), f.thick * p.w * (0.92 + 0.08 * Math.sin(t * 31)), 1);
}
/** For a screenshot (?still&pass=rocket&at=0.3): one named thing held at one point of its way. */
let heldEv = Q.get("pass") ? { thing: { name: Q.get("pass") }, u: Number(Q.get("at") ?? 0.5) } : null;
let passing = null; // the name of what is in the sky this frame, for the checks
function runSky(t) {
  const ev = heldEv ?? (still ? null : timetable.step(t));
  const name = ev ? ev.thing.name : null;
  for (const p of PASSERS) {
    p.mesh.visible = p.name === name;
    if (p.mesh.visible) placePasser(p, ev.u, t);
  }
  if (name === "star") {
    if (!streak.m.visible || streak.ev !== ev) aimStreak(ev);
    drawStreak(ev.u);
  } else streak.m.visible = false;
  passing = name;
}

// ---- a shooting star: a streak of light. There is only ever one, because the timetable passes one thing at a time.
const streak = { m: null, ev: null };
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
  streak.m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.125), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  streak.m.visible = false;
  streak.m.renderOrder = -94;
  sceneOut.add(streak.m);
}
/** Aims the streak for one shooting star: through the place that was tapped (the timetable carries it), or through a place of its own in the band of sky the window shows. */
function aimStreak(ev) {
  const z = -40;
  const k = (CAM.z - z) / D_WALL;
  const d = ev.data ?? { x: eye + (Math.random() - 0.5) * 12 * k, y: CAM.y + (0.9 + Math.random() * 1.6 - CAM.y) * k, len: 9 };
  const angle = -0.28 - Math.random() * 0.2;
  Object.assign(streak, { ev, x: d.x, y: d.y, z, len: d.len ?? 11, angle: Math.random() < 0.5 ? angle : Math.PI - angle });
  if (ev === heldEv) Object.assign(streak, { x: heldEv.x ?? eye, y: CAM.y + (1.5 - CAM.y) * k, angle: -0.35 });
  streak.m.visible = true;
}
function drawStreak(u) {
  const s = streak;
  const travel = s.len * 2.2 * (u - 0.5);
  s.m.position.set(s.x + Math.cos(s.angle) * travel, s.y + Math.sin(s.angle) * travel, s.z);
  s.m.rotation.z = s.angle;
  s.m.scale.set(s.len * Math.sin(u * Math.PI), s.len * 0.6, 1);
  s.m.material.opacity = Math.sin(u * Math.PI);
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
      uProbe: { value: 0 },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uBase; uniform sampler2D uLights; uniform float uGain[${n}]; uniform vec3 uTint[${n}]; uniform float uSway[${n}]; uniform float uExposure; uniform float uGlass; uniform float uShine; uniform float uProbe;
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
        // How much of the outside shows here: 1 in the middle of a pane, 0 on anything solid. The picture
        // that says so is squeezed small and comes back with faint smudges where it was 0, so its lowest
        // few hundredths are read as nothing: a wall, a post or the door is solid, with no exceptions.
        float through = smoothstep(0.04, 0.96, light(uv, ${tile(P.glassTile)}).r) * uGlass;
        // A crack a texel or two wide in that picture (the seam between the door's frame and the first post) is not a
        // window: with no glass three texels to either side, or three above and below, the point is solid.
        // The proper fix is to re-render the glass mask without the seam; this guard stays either way.
        if (through > 0.0) {
          vec2 tx = vec2(${(3 / grid.w).toFixed(6)}, ${(3 / grid.h).toFixed(6)});
          float side = max(light(uv - vec2(tx.x, 0.0), ${tile(P.glassTile)}).r, light(uv + vec2(tx.x, 0.0), ${tile(P.glassTile)}).r);
          float updown = max(light(uv - vec2(0.0, tx.y), ${tile(P.glassTile)}).r, light(uv + vec2(0.0, tx.y), ${tile(P.glassTile)}).r);
          through *= step(0.04, side) * step(0.04, updown);
        }
        if (uProbe > 0.5) { gl_FragColor = vec4(vec3(through > 0.0 ? 1.0 : 0.0), 1.0); return; }
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
  shell = { mat, u: mat.uniforms, group: g };
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
/** A hung screen's body: a dark glass panel in a metal rim, with a line of the room's light inside it. */
function panel(g, w, h, r, line = "rgba(110,231,255,.65)") {
  g.fillStyle = "rgba(4,8,20,.93)";
  rr(g, 3, 3, w - 6, h - 6, r);
  g.fill();
  const rim = g.createLinearGradient(0, 0, 0, h);
  rim.addColorStop(0, "#c9d6ea");
  rim.addColorStop(0.08, "#5d6c86");
  rim.addColorStop(0.92, "#27324a");
  rim.addColorStop(1, "#0b1020");
  g.strokeStyle = rim;
  g.lineWidth = 6;
  g.stroke();
  g.strokeStyle = line;
  g.lineWidth = 2.5;
  rr(g, 11, 11, w - 22, h - 22, Math.max(2, r - 8));
  g.stroke();
}
/** The shine on a screen's glass: a soft slanted band of light. It slides as the eye moves (see tick), which is what makes the glass read as glass. */
const sheenTex = canvasTexture(256, 256, (g, w, h) => {
  const band = g.createLinearGradient(0, h, w, 0);
  band.addColorStop(0.3, "rgba(255,255,255,0)");
  band.addColorStop(0.47, "rgba(190,220,255,.16)");
  band.addColorStop(0.53, "rgba(220,235,255,.26)");
  band.addColorStop(0.6, "rgba(190,220,255,.06)");
  band.addColorStop(0.75, "rgba(255,255,255,0)");
  g.fillStyle = band;
  g.fillRect(0, 0, w, h);
});
sheenTex.wrapS = sheenTex.wrapT = THREE.ClampToEdgeWrapping;
/** Many flat rectangles facing the room, drawn as one thing (one call to the graphics card, however many there are).
 *  Each is { x, y, z, w, h }: its middle and its size, in the room's metres. */
function quads(rects) {
  const [pos, uv, mid, idx] = [[], [], [], []];
  for (const [i, r] of rects.entries()) {
    const [l, rt, b, t] = [r.x - r.w / 2, r.x + r.w / 2, r.y - r.h / 2, r.y + r.h / 2];
    pos.push(l, b, r.z, rt, b, r.z, rt, t, r.z, l, t, r.z);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    mid.push(r.x, r.x, r.x, r.x);
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("mid", new THREE.Float32BufferAttribute(mid, 1));
  g.setIndex(idx);
  return g;
}
/** A rectangle laid out on the back wall (in the wall's own units), as it is at depth z: nearer, so drawn smaller to cover the same place. */
const onWall = (xw, yw, ww, hw, z) => {
  const k = (CAM.z - z) / D_WALL;
  return { x: (wallX(xw) + ww / U / 2) * k, y: CAM.y + (wallY(yw) - hw / U / 2 - CAM.y) * k, z, w: (ww / U) * k, h: (hw / U) * k };
};
const sheenRects = [];
const rodRects = [];
let sheenMesh = null;
function runSheens() {
  sheenMesh.material.uniforms.uEye.value = eye;
}
/** Two rods from the beam over the window down to a hung screen, like the ones the game screens hang from in the rendered room. */
const rodTex = canvasTexture(8, 4, (g, w, h) => {
  const metal = g.createLinearGradient(0, 0, w, 0);
  metal.addColorStop(0, "#111724");
  metal.addColorStop(0.45, "#77849c");
  metal.addColorStop(1, "#161d2c");
  g.fillStyle = metal;
  g.fillRect(0, 0, w, h);
});
function rods(xw, ww, topYw) {
  const beam = (6.25 - P.layout.head) * U - 2;
  for (const x of [xw + ww * 0.2, xw + ww * 0.8]) rodRects.push(onWall(x - 2, beam, 4, topYw - beam + 4, ZB + 0.42));
}
/** The rods and the shines, once every screen has said where it is: two drawings in all. */
function buildRodsAndSheens() {
  const rodMesh = new THREE.Mesh(quads(rodRects), new THREE.MeshBasicMaterial({ map: rodTex, transparent: true, depthWrite: false, depthTest: false }));
  rodMesh.renderOrder = -41;
  sheenMesh = new THREE.Mesh(
    quads(sheenRects),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      uniforms: { uMap: { value: sheenTex }, uEye: { value: 0 } },
      // Each screen shows the part of the band of light that its place, and the eye's, give it.
      vertexShader: `attribute float mid; uniform float uEye; varying vec2 vUv;
        void main(){ vUv = uv * 0.5 + vec2(0.25 + clamp((mid - uEye) * 0.07, -0.25, 0.25), 0.25); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(uMap, vUv);
        #include <colorspace_fragment>
        }`,
    }),
  );
  sheenMesh.renderOrder = -38;
  for (const m of [rodMesh, sheenMesh]) {
    m.frustumCulled = false;
    scene.add(m);
  }
}
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
    sheenRects.push({ x: L.xs[i], y: L.by, z: ZB + 0.365, w: L.bw, h: L.bh });
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
  rods(181 - 106, 212, 133);
  sheenRects.push(onWall(181 - 106, 133, 212, 276, ZB + 0.425));
  wallQuad(181 - 106, 133, 212, 276, canvasTexture(212 * 3, 276 * 3, (g, w, h) => {
    panel(g, w, h, 24);
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
  rods(1722 - 118, 236, 136);
  sheenRects.push(onWall(1722 - 118, 136, 236, 240, ZB + 0.425));
  wallQuad(1722 - 118, 136, 236, 240, canvasTexture(236 * 3, 240 * 3, (g, w, h) => {
    panel(g, w, h, 18);
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
  buildRodsAndSheens();
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
    // The shooting star is the sky's to give: it comes only into an empty sky, like everything else out there.
    const [sx, sy] = under(cx, cy, -40);
    const busy = timetable.now?.thing.name;
    if (timetable.startIfEmpty("star", t, { x: sx, y: sy, len: 11 })) return say("A ring on the glass, and a shooting star behind it.");
    return say(busy === "star" ? "A ring on the glass." : `A ring on the glass. No shooting star while the ${LABEL[busy] ?? "sky"} is passing: one thing at a time.`);
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
const clock = { t: still ? Number(Q.get("t") ?? 30) : 0, last: performance.now() };
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

/** One frame: the outside first, then the room over it. */
const corner = new THREE.Vector3();
function drawFrame() {
  renderer.info.reset();
  renderer.setScissorTest(false);
  renderer.clear();
  // The outside is only drawn inside the box of screen that the window wall takes up (from the sill
  // to the ceiling, from side wall to side wall, where the eye is now). The planet is a very large
  // ball and most of it lies behind the bench and the deck: none of that is worked out any more.
  const [w, h] = [stage.clientWidth, stage.clientHeight];
  corner.set(-SPACE.w / 2, P.layout.sill - 0.06, ZB).project(cam);
  const [x0, y0] = [clamp(Math.floor(((corner.x + 1) / 2) * w) - 1, 0, w), clamp(Math.floor(((corner.y + 1) / 2) * h) - 1, 0, h)];
  corner.set(SPACE.w / 2, SPACE.h, ZB).project(cam);
  const [x1, y1] = [clamp(Math.ceil(((corner.x + 1) / 2) * w) + 1, 0, w), clamp(Math.ceil(((corner.y + 1) / 2) * h) + 1, 0, h)];
  if (x1 > x0 && y1 > y0) {
    renderer.setScissor(x0, y0, x1 - x0, y1 - y0);
    renderer.setScissorTest(true);
    renderer.render(sceneOut, cam);
    renderer.setScissorTest(false);
  }
  renderer.clearDepth();
  renderer.render(scene, cam);
}
/** For the checks (shoot.mjs --paths): does a passing thing change any pixel that is not glass, anywhere along its way?
 *  This one moment of the room is drawn with an empty sky, then with only the glass (in white), then
 *  with the named thing at each of `steps` + 1 points of its way. For each point it counts the pixels
 *  the thing changed, and how many of those are not glass. Nothing else moves between the drawings. */
function leakSweep(name, steps, x) {
  const gl = renderer.getContext();
  const [w, h] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
  const grab = () => {
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const before = heldEv;
  window.__hold(null);
  runSky(clock.t);
  const quiet = passing === null; // (false on a live page while the timetable has something out: then this check says nothing)
  drawFrame();
  const empty = grab();
  const others = scene.children.filter((o) => o !== shell.group && o.visible);
  others.forEach((o) => (o.visible = false));
  shell.u.uProbe.value = 1;
  renderer.clear();
  renderer.render(scene, cam);
  const glass = grab();
  shell.u.uProbe.value = 0;
  others.forEach((o) => (o.visible = true));
  let panes = 0;
  for (let i = 0; i < glass.length; i += 4) if (glass[i] > 0) panes++;
  const changed = [];
  const leaked = [];
  let worst = 0;
  let drew = true;
  for (let s = 0; s <= steps; s++) {
    window.__hold(name, s / steps, x);
    runSky(clock.t);
    drew &&= passing === name;
    drawFrame();
    const full = grab();
    let c = 0;
    let l = 0;
    for (let i = 0; i < empty.length; i += 4) {
      const d = Math.max(Math.abs(empty[i] - full[i]), Math.abs(empty[i + 1] - full[i + 1]), Math.abs(empty[i + 2] - full[i + 2]));
      if (!d) continue;
      c++;
      if (glass[i] === 0) {
        l++;
        worst = Math.max(worst, d);
      }
    }
    changed.push(c);
    leaked.push(l);
  }
  heldEv = before;
  streak.ev = null;
  runSky(clock.t);
  drawFrame();
  return { quiet, drew, changed, leaked, worst, glass: panes, pixels: w * h };
}

function tick(nowMs) {
  requestAnimationFrame(tick);
  const dtReal = Math.min(0.1, (nowMs - clock.last) / 1000);
  meter.frames.push(nowMs - clock.last);
  clock.last = nowMs;
  if (state.look !== "real" || state.paused) return;
  const t0 = performance.now();
  // ?speed=20 runs the room's clock fast, for the check that watches the sky for a long time (shoot.mjs --sky).
  // Each step is still at most a tenth of a second, as on a slow phone.
  const dt = still ? 0 : Math.min(0.1, dtReal * SPEED);
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
  runSky(t);
  runSheens();

  drawFrame();

  // The names over the pieces (HTML, as in the room).
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const proj = new THREE.Vector3();
  const spots = pieces.map((p, i) => {
    proj.set(p.pawn.group.position.x, p.pawn.group.position.y + 1.02, SPACE.walkZ).project(cam);
    return { i, x: ((proj.x + 1) / 2) * w, y: ((1 - proj.y) / 2) * h };
  });
  // Names over pieces that stand together: each goes up one line above the highest name within 64 px to its left, so three together do not cover one another.
  spots.sort((a, b) => a.x - b.x);
  for (const [k, s] of spots.entries()) {
    s.lvl = 0;
    for (let j = 0; j < k; j++) if (s.x - spots[j].x < 64 && spots[j].lvl >= s.lvl) s.lvl = spots[j].lvl + 1;
    tags[s.i].style.transform = `translate(${s.x}px, ${s.y - s.lvl * 24}px) translate(-50%, -100%)`;
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
  // "Send one now": the thing asked for still goes through the timetable, so it waits for an empty sky.
  for (const b of document.querySelectorAll("[data-send]"))
    b.addEventListener("click", () => {
      const name = b.dataset.send === "rock" ? `rock${Math.floor(Math.random() * 3)}` : b.dataset.send;
      const waitsFor = timetable.ask(name, clock.t);
      document.body.classList.remove("notes-on"); // sideways, the notes cover the window: get them out of the way
      const what = name === "star" ? "A shooting star" : `The ${LABEL[name]}`;
      say(waitsFor ? `${what} comes next, a few seconds after the ${LABEL[waitsFor]} has gone.` : `${what} is on its way.`);
    });
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
  planet = ball(planetMap, CFG.planet, { gas: true, air: 1 });
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
  }
  document.body.classList.add("ready");
  // For the checks (shoot.mjs): what the lamps and the pieces are doing.
  window.__leak = leakSweep;
  // What is in the sky this frame: the timetable's word, and (counted separately, from the drawing itself) every passing thing that is switched on.
  window.__sky = () => ({ t: clock.t, passing, drawn: [...PASSERS.filter((p) => p.mesh.visible).map((p) => p.name), ...(streak.m.visible ? ["star"] : [])] });
  window.__ask = (name) => timetable.ask(name, clock.t);
  // Holds one named thing at one point of its way (or lets go, with no name). A shooting star can be put through a place of the wall (x in the room's metres).
  window.__hold = (name, u, x) => {
    heldEv = name ? { thing: { name }, u, x: x === undefined ? undefined : x * ((CAM.z + 40) / D_WALL) } : null;
    streak.ev = null;
  };
  window.__glass = (on) => {
    shell.u.uProbe.value = on ? 1 : 0;
    for (const o of scene.children) if (o !== shell.group) o.visible = !on;
  };
  window.__probe = () => ({ lamps: lamps.map((b) => ({ level: +b.level.toFixed(2), gain: +shell.u.uGain.value[b.i].toFixed(2), halo: +b.halo.material.opacity.toFixed(2), spot: +b.spot.intensity.toFixed(2) })), pieces: pieces.map((p) => Math.round(p.piece.rx)), eye: +eye.toFixed(2), view });
  window.__ready = true;
  requestAnimationFrame(tick);
}
start().catch((err) => {
  console.error(err);
  $("said").textContent = "This preview could not start: " + err.message;
  $("said").classList.add("on");
});
