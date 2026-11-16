// What is outside the Star Lounge's window: a scene of its own, drawn before the room and seen
// only through its glass (look3d/rendered/plate.js, drawOutsideFirst).
//
//   - a turning ringed planet with a rendered surface, its storms and the glow of its air
//   - a small moon, two depths of stars and far gas clouds, turning slowly past
//   - the things that pass, one at a time, as the sky's timetable says (sky.js): a rocket, a
//     liner, a saucer, three rocks, a shooting star. Each is a rendered picture at its own depth.
//
// Shared by the party room (star-lounge/room.js) and the preview page (preview/star-lounge).
// It draws nothing by itself and decides nothing: the caller steps it with the time, where the
// eye is and what the timetable says is passing.
import { CAM, D_WALL } from "../../space.js";
import * as THREE from "../../three.js";
import { canvasTexture, clamp, seeded } from "../plate.js";
import { THINGS } from "./sky.js";

/** The things that pass the window: each is a rendered picture at its own depth. */
export const PASSERS = [
  // name, length in metres, depth z, height y (room metres at that depth), direction, bob;
  // flame: where its engine is (in lengths from its middle), how long and how thick the flame is (in lengths), its colour.
  { name: "rocket", w: 2.0, z: -7.5, y: 1.5, dir: 1, bob: 0.06, flames: [{ at: [-0.355, 0.0], len: 0.42, thick: 0.15, colour: 0xffa050 }] },
  { name: "liner", w: 7.5, z: -30, y: 1.75, dir: -1, bob: 0.0, flames: [{ at: [0.405, -0.022], len: 0.09, thick: 0.034, colour: 0x7fd8ff }] },
  { name: "saucer", w: 1.8, z: -9, y: 1.75, dir: -1, bob: 0.2, wobble: true },
  { name: "rock0", w: 1.5, z: -4.6, y: 1.1, dir: -1, spin: 0.25 },
  { name: "rock1", w: 0.8, z: -4.0, y: 1.9, dir: -1, spin: -0.4 },
  { name: "rock2", w: 0.9, z: -5.4, y: 1.5, dir: -1, spin: 0.18 },
];

/** The pictures the outside is made of, by name (each a file in layers/, .webp). */
export const OUTSIDE_PICTURES = ["sky", "planet", "moon", ...PASSERS.map((p) => p.name)];

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

/**
 * A ball lit by the far sun, with a rendered surface that turns: the planet and the moon.
 * `weather` (the planet only): its storms, torn cloud edges and belt streaks, which cost five
 * more looks into a picture for every pixel of it; without them the surface is the picture alone.
 */
function ballMaterial(map, grain, sun, o, { gas = false, air = 0, weather = true } = {}) {
  const axis = new THREE.Vector3(...(o.axis ?? [0, 1, 0])).normalize();
  const centre = new THREE.Vector3(...o.centre);
  return new THREE.ShaderMaterial({
    transparent: true,
    defines: { WEATHER: weather ? 1 : 0 },
    uniforms: { uMap: { value: map }, uGrain: { value: grain }, uTurn: { value: 0 }, uSun: { value: sun }, uCentre: { value: centre }, uAxis: { value: axis }, uR: { value: o.radius }, uRing: { value: new THREE.Vector2(...(o.ring ?? [0, 0])) }, uRingMap: { value: null }, uAir: { value: air }, uTime: { value: 0 }, uDetail: { value: 1 } },
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
        #if WEATHER
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
        albedo = mix(albedo, vec3(1.0, 0.93, 0.8), (smoothstep(0.0, 0.1, great) * (1.0 - smoothstep(0.1, 0.3, great)) * 0.35 + smoothstep(0.1, 0.8, pale) * 0.5));
        #else
        // The cheaper sky (a device that cannot keep up): the surface as it was rendered, turning, with no weather drawn over it.
        albedo = texture2D(uMap, uv).rgb;
        #endif`
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
}

/** An engine's flame: hot and white at the nozzle, thinning to a point behind. It points to the picture's left. */
const flameTexture = () =>
  canvasTexture(256, 64, (g, w, h) => {
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

/** The streak of a shooting star. */
const streakTexture = () =>
  canvasTexture(256, 32, (g, w, h) => {
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

/** The ring's bands of dust, as a strip one texel tall. */
const bandsTexture = () => {
  const t = canvasTexture(512, 4, (g, w, h) => {
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
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
};

/** How far left and right of the middle a thing at depth z must go to be off any screen. */
const offstage = (z) => ((CAM.z - z) / D_WALL) * 11.5 + 3;

/**
 * Builds what is outside. `cfg` is the Star Lounge's numbers (lobby/tools/blender/star-lounge.json:
 * the planet, the moon, the sun); `tex` the pictures by name (OUTSIDE_PICTURES), loaded.
 * `weather`: the planet's storms and fine grain (a device that cannot keep up goes without).
 *
 * Returns {scene, step(t, eye, ev), resize(px), setWeather(on), setPlanet(texture), passing, dispose}.
 * `ev` is what the sky's timetable says is passing ({thing: {name}, u, start, data}) or null;
 * an `ev.held` one (for checks) is drawn at a fixed place: x on the wall's plane if it has one.
 */
export function createOutside({ cfg, tex, weather = true }) {
  const scene = new THREE.Scene();
  const sun = new THREE.Vector3(...cfg.sun).normalize();
  const grain = grainTexture();
  const made = [grain];
  /** Everything so far away that it follows the eye. */
  const far = new THREE.Group();
  scene.add(far);

  // The window only ever shows a low band of the sky, so the gas clouds are wrapped on a band all
  // round the ship (twice round, the middle of the picture's height) instead of a whole ball.
  const sky = tex.sky;
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
  far.add(dome);

  /** Stars as points on a band all round, so the band can turn for ever. */
  const stars = (count, seed, size, bright) => {
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
    far.add(pts);
    return pts;
  };
  const farStars = stars(3000, 61, 2.4, 1.2);
  const nearStars = stars(240, 19, 5.0, 1.9);

  // The planet, the glow of its air, its ring; the moon.
  const P = cfg.planet;
  const planet = new THREE.Mesh(new THREE.SphereGeometry(P.radius, 192, 96), ballMaterial(tex.planet, grain, sun, P, { gas: true, air: 1, weather }));
  const axis = new THREE.Vector3(...P.axis).normalize();
  planet.position.set(...P.centre);
  planet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  planet.renderOrder = -97;
  scene.add(planet);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(P.radius * 1.035, 96, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uSun: { value: sun } },
      vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
        void main(){ vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vP);
          // Brightest right at the planet's edge (where this shell is seen at a slant of about 0.26), fading outward.
          float c = max(dot(-n, v), 0.0); float f = pow(smoothstep(0.0, 0.26, c), 2.5); float lit = smoothstep(-0.25, 0.5, dot(n, uSun));
          gl_FragColor = vec4(vec3(0.45, 0.68, 1.0) * f * (0.06 + lit) * 0.8, 1.0); }`,
    }),
  );
  halo.position.set(...P.centre);
  halo.renderOrder = -96.5; // after the planet, which hides the part of this shell that is behind it (so that part costs nothing)
  scene.add(halo);
  const bands = bandsTexture();
  made.push(bands);
  planet.material.uniforms.uRingMap.value = bands;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(P.radius * P.ring[0], P.radius * P.ring[1], 160, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uMap: { value: bands }, uSun: { value: sun }, uCentre: { value: new THREE.Vector3(...P.centre) }, uR: { value: P.radius }, uRing: { value: new THREE.Vector2(...P.ring) } },
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
    }),
  );
  ring.position.set(...P.centre);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  ring.renderOrder = -96;
  scene.add(ring);
  const M = cfg.moon;
  const moon = new THREE.Mesh(new THREE.SphereGeometry(M.radius, 192, 96), ballMaterial(tex.moon, grain, sun, M, { air: 0 }));
  moon.position.set(...M.centre);
  moon.renderOrder = -97;
  scene.add(moon);

  // ---- the things that pass the window
  const flameTex = flameTexture();
  made.push(flameTex);
  const passers = PASSERS.map((d) => ({ ...d, lasts: THINGS.find((t) => t.name === d.name).lasts }));
  for (const p of passers) {
    const t = tex[p.name];
    const h = (p.w * t.image.height) / t.image.width;
    p.mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, h), new THREE.MeshBasicMaterial({ map: t, color: 0xd8d8d8, transparent: true, depthWrite: false, depthTest: false, toneMapped: true }));
    p.mesh.renderOrder = -95;
    p.mesh.visible = false;
    scene.add(p.mesh);
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
  /** Puts one passing thing where it is at the point u (0 to 1) of its way. */
  const placePasser = (p, u, t) => {
    const edge = offstage(p.z) + p.w;
    const k = (CAM.z - p.z) / D_WALL;
    const hold = p.wobble ? 0.08 * Math.sin(u * Math.PI * 3) : 0;
    p.mesh.position.set(-p.dir * edge + p.dir * 2 * edge * (u + hold), CAM.y + (p.y - CAM.y) * k + (p.bob ? Math.sin(t * 2.1 + p.z) * p.bob * k : 0), p.z);
    if (p.spin) p.mesh.rotation.z = t * p.spin;
    if (p.wobble) p.mesh.rotation.z = Math.sin(t * 2.6) * 0.12;
    for (const { m, f } of p.flameMeshes) m.scale.set(f.len * p.w * (0.82 + 0.18 * Math.sin(t * 43) * Math.sin(t * 17)), f.thick * p.w * (0.92 + 0.08 * Math.sin(t * 31)), 1);
  };

  // ---- a shooting star: a streak of light. There is only ever one, because the timetable passes one thing at a time.
  const streakTex = streakTexture();
  made.push(streakTex);
  const streak = { m: new THREE.Mesh(new THREE.PlaneGeometry(1, 0.125), new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })), ev: null };
  streak.m.visible = false;
  streak.m.renderOrder = -94;
  scene.add(streak.m);
  /** Aims the streak for one shooting star: through a place the timetable carries, or a place of its own in the band of sky the window shows (the same on every device that has the same timetable). */
  const aimStreak = (ev, eye) => {
    const z = -40;
    const k = (CAM.z - z) / D_WALL;
    const rnd = seeded(Math.round((ev.start ?? 0) * 1000) + 7);
    const d = ev.data ?? { x: eye + (rnd() - 0.5) * 12 * k, y: CAM.y + (0.9 + rnd() * 1.6 - CAM.y) * k, len: 9 };
    const angle = -0.28 - rnd() * 0.2;
    Object.assign(streak, { ev, x: d.x, y: d.y, z, len: d.len ?? 11, angle: rnd() < 0.5 ? angle : Math.PI - angle });
    if (ev.held) Object.assign(streak, { x: ev.x ?? eye, y: CAM.y + (1.5 - CAM.y) * k, angle: -0.35 });
    streak.m.visible = true;
  };
  const drawStreak = (u) => {
    const s = streak;
    const travel = s.len * 2.2 * (u - 0.5);
    s.m.position.set(s.x + Math.cos(s.angle) * travel, s.y + Math.sin(s.angle) * travel, s.z);
    s.m.rotation.z = s.angle;
    s.m.scale.set(s.len * Math.sin(u * Math.PI), s.len * 0.6, 1);
    s.m.material.opacity = Math.sin(u * Math.PI);
  };

  const out = {
    scene,
    passers,
    streak,
    planet,
    moon,
    /** The name of what is in the sky as last stepped, or null. */
    passing: null,
    /** Everything in it for a moment of time `t` (seconds), the eye at x = `eye` (metres), and `ev` passing. */
    step(t, eye, ev) {
      // The ship is under way, so the far things turn slowly past, the near ones faster.
      far.position.set(eye, CAM.y, CAM.z);
      dome.rotation.y = t * 0.0016;
      farStars.rotation.y = t * 0.004;
      nearStars.rotation.y = t * 0.011;
      farStars.material.uniforms.uTime.value = nearStars.material.uniforms.uTime.value = t;
      planet.material.uniforms.uTurn.value = (t / P.turnSeconds) % 1;
      planet.material.uniforms.uTime.value = t;
      moon.material.uniforms.uTurn.value = (t / M.turnSeconds) % 1;
      const name = ev ? ev.thing.name : null;
      for (const p of passers) {
        p.mesh.visible = p.name === name;
        if (p.mesh.visible) placePasser(p, ev.u, t);
      }
      if (name === "star") {
        if (!streak.m.visible || streak.ev !== ev) aimStreak(ev, eye);
        drawStreak(ev.u);
      } else {
        streak.m.visible = false;
        streak.ev = null;
      }
      out.passing = name;
    },
    /** The stars' size in pixels: `px` is drawn pixels per CSS pixel, `h` the picture's height in CSS pixels. */
    resize(px, h) {
      for (const o of [farStars, nearStars]) o.material.uniforms.uPx.value = px * Math.max(0.75, h / 520);
    },
    /** The planet's weather on or off (the shader is built again, once). */
    setWeather(on) {
      const m = planet.material;
      if (m.defines.WEATHER === (on ? 1 : 0)) return;
      m.defines.WEATHER = on ? 1 : 0;
      m.needsUpdate = true;
    },
    /** A new surface for the planet (a smaller one, say); the old one is given back. */
    setPlanet(texture) {
      const u = planet.material.uniforms.uMap;
      if (u.value === texture) return;
      if (u.value !== tex.planet) u.value.dispose();
      u.value = texture;
    },
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      for (const t of made) t.dispose();
    },
  };
  return out;
}

/**
 * The planet's surface drawn at half its size, for a device that cannot hold the big one or keep
 * up with it: a canvas the image is drawn into, as a texture.
 */
export function halfPlanet(texture, anisotropy = 4) {
  const img = texture.image;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width / 2));
  c.height = Math.max(1, Math.round(img.height / 2));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = texture.colorSpace;
  t.wrapS = texture.wrapS;
  t.generateMipmaps = texture.generateMipmaps;
  t.minFilter = texture.minFilter;
  t.anisotropy = anisotropy;
  return t;
}
