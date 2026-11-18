// What is outside the bar's windows: a scene of its own, drawn before the room and seen only
// through its glass (rendered/plate.js, drawOutsideFirst). From far to near:
//
//   - the street (the owner's painting of it), one strip behind each window, far behind the glass
//   - its life: the lamps' glow breathing, a lit window going dark for a while, the shimmer on the
//     wet stones and rain landing in the puddles
//   - the thing that passes, as the street's timetable says (bar/street.js): an umbrella on the
//     wind, a cat on the sill, a paper boat in the gutter, or the shop light going off and on
//   - the rain, soft drops falling almost straight down, at three depths
//   - the glass: a faint warm reflection of the room, and the drops that land on it, sit, gather
//     and run down
//   - lightning, now and then: one soft cold glow over the street, never a flicker
//
// Everything is laid out in the painting's pixels (bar/layers/plate.json) at a depth of its own,
// so when the eye moves (rendered/room-rendered.js, `eye`) the street slides behind the window
// frames, the rain at its three depths slides less, and the drops stay on the glass.
//
// It draws nothing by itself and decides nothing: the room steps it with the time, what the
// timetable says is passing, and how bright the lightning is.
import { CAM, D_WALL, SPACE, U } from "../../space.js";
import * as THREE from "../../three.js";
import { placeAt } from "../plate.js";
import { buildUmbrella } from "./umbrella.js";
import { FILL, PLACE_GLSL, Sprites, TILES, spriteSheet } from "./sprites.js";
import { STREET_Z, umbrellaAt } from "./street.js";

/** The glass: the bar's back wall. */
const GLASS_Z = SPACE.zBack;
/** The rain's three depths, far to near: smaller and slower far away (the preview's three, in its order). */
const RAIN = [
  { z: -7.2, n: 22, len: [7, 9], w: 1.7, v: [118, 136], a: 0.42 },
  { z: -5.2, n: 14, len: [10, 13], w: 2.3, v: [160, 184], a: 0.52 },
  { z: -3.4, n: 8, len: [14, 18], w: 3.0, v: [208, 236], a: 0.6 },
];
/** The steady "Rain" the owner picked: the share of the drops shown, how fast they fall and how many land on each window a second. */
export const RAIN_STRENGTH = { count: 0.6, speed: 0.95, alpha: 1, impacts: 0.9, ripples: 0.7 };

/** The street's own lights and lit windows, in the street picture's pixels (bar-street.png), for each window. */
const STREET_LIFE = {
  left: {
    lamps: [[395, 318, 34], [345, 377, 22], [598, 425, 14], [690, 462, 9]],
    lit: [[340, 25, 376, 128], [405, 55, 442, 130], [507, 150, 541, 205], [515, 60, 540, 95], [474, 432, 520, 520], [345, 300, 365, 330]],
    shimmer: [[395, 700, 22], [345, 650, 14], [598, 640, 10]],
    shop: [[338, 22, 378, 130], [403, 52, 444, 132]],
    glint: [0.72, 0.36],
  },
  right: {
    lamps: [[1265, 265, 34], [1100, 425, 14], [1018, 462, 9]],
    lit: [[1425, 75, 1497, 195], [1265, 55, 1302, 112], [1560, 20, 1615, 140], [1218, 420, 1245, 520]],
    shimmer: [[1265, 700, 22], [1450, 700, 18], [1100, 650, 10]],
    shop: [[1356, 385, 1602, 548]],
    glint: [0.3, 0.36],
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** How many metres a painting pixel is at depth z (seen from where the painting was seen). */
export const metresPerPixel = (paint, z) => (paint[0] / U) * ((CAM.z - z) / D_WALL);
const ease = (u) => u * u * (3 - 2 * u);
const R = (rnd, a, b) => a + (b - a) * rnd();

/** The soft streak of a falling drop: a tapered stroke with a round head at the bottom, blurred. */
function dropTexture() {
  const c = document.createElement("canvas");
  c.width = 24;
  c.height = 96;
  const x = c.getContext("2d");
  x.filter = "blur(1.6px)";
  const g = x.createLinearGradient(0, 4, 0, 92);
  g.addColorStop(0, "rgba(215,228,250,0)");
  g.addColorStop(0.55, "rgba(215,228,250,.55)");
  g.addColorStop(1, "rgba(235,242,255,1)");
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(12, 6);
  x.quadraticCurveTo(15.5, 60, 17, 80);
  x.arc(12, 80, 5, 0, Math.PI);
  x.quadraticCurveTo(8.5, 60, 12, 6);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * One depth of rain over both windows, as one drawing: each drop's place is worked out on the
 * graphics card from the time, so nothing is moved drop by drop. A drop that reaches the bottom
 * starts again at the top somewhere else.
 */
function rainLayer(depth, layer, windows, tex, paint, rnd) {
  const drops = [];
  for (const [wi, b] of windows.entries()) {
    const n = Math.round((depth.n * (b.w * b.h)) / 10000);
    for (let i = 0; i < n; i++) drops.push([rnd(), rnd(), R(rnd, ...depth.v), R(rnd, ...depth.len), rnd(), wi]);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute("aDrop", new THREE.InstancedBufferAttribute(new Float32Array(drops.flatMap((d) => d.slice(0, 4))), 4));
  geo.setAttribute("aMore", new THREE.InstancedBufferAttribute(new Float32Array(drops.flatMap((d) => d.slice(4))), 2));
  geo.instanceCount = drops.length;
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    // (Its quad is laid out top down, as the painting is: seen from behind, so both sides are drawn.)
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: tex },
      uPaint: { value: new THREE.Vector2(...paint) },
      uBox: { value: windows.map((b) => new THREE.Vector4(b.x, b.y, b.w, b.h)) },
      uTime: { value: 0 },
      uFall: { value: 1 },
      uCount: { value: 1 },
      uSmall: { value: 0 },
      uK: { value: 1 },
      uAlpha: { value: depth.a },
      uZ: { value: depth.z },
      uW: { value: depth.w },
      uLayer: { value: layer },
    },
    vertexShader: `${PLACE_GLSL}
      attribute vec4 aDrop; attribute vec2 aMore;
      uniform vec4 uBox[2]; uniform float uTime, uFall, uCount, uSmall, uK, uZ, uW, uLayer;
      varying vec2 vUv;
      void main(){
        vec4 b = aMore.y < 0.5 ? uBox[0] : uBox[1];
        if (aMore.x > uCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        // Drawn a little larger than life at phone size, so it reads (the preview's rule).
        float L = max(aDrop.w * (1.0 + 0.6 * uSmall), 7.0 / uK);
        float dw = max(uW * (1.0 + 0.8 * uSmall), 1.5 / uK);
        float period = b.w + L + 30.0;
        float travel = aDrop.y * period + aDrop.z * uTime * uFall;
        float lap = floor(travel / period);
        float y = mod(travel, period) - 30.0;
        // Each lap from somewhere else along the window, drifting slowly sideways.
        float x = fract(aDrop.x + lap * 0.618034 + fract(sin(lap * 12.9898 + aDrop.x * 78.233) * 43758.5453) * 0.21);
        x = mod(x * (b.z + 40.0) + uTime * (3.0 + uLayer * 1.0), b.z + 40.0) - 20.0;
        vec2 p = b.xy + vec2(x + position.x * dw, y - (1.0 - position.y) * L);
        vUv = vec2(position.x + 0.5, position.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(placeP(p, uZ), 1.0);
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uAlpha; varying vec2 vUv;
      void main(){ vec4 t = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y)); gl_FragColor = vec4(t.rgb, t.a * uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10 + layer * 10;
  return { mesh, material, geo };
}

/** A flat picture laid out in painting pixels (x, y, w, h) at depth z, facing the room. */
function paintedPlane(paint, x, y, w, h, z, material) {
  const [l, t] = placeAt(x * paint[0], paint[1] + y * paint[0], z);
  const [r, b] = placeAt((x + w) * paint[0], paint[1] + (y + h) * paint[0], z);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r - l, t - b), material);
  mesh.position.set((l + r) / 2, (t + b) / 2, z);
  return mesh;
}

/** A vertical fade on a canvas, for the lightning over the street and the room's warm reflection in the glass. */
function fadeTexture(stops) {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 64);
  for (const [at, colour] of stops) grad.addColorStop(at, colour);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The cat's pictures (the preview's, lit warm from inside the bar): four steps of walking, three of sitting and a blink, on one sheet. */
function catSheet() {
  const S = 3;
  const cells = [];
  const FUR = "#cf7a35";
  const FUR_D = "#9c5222";
  const FUR_L = "#f0b070";
  const walk = (f) => (x) => {
    x.lineCap = "round";
    x.strokeStyle = FUR_D;
    x.lineWidth = 3;
    [[14, 1], [20, -1], [34, -1], [40, 1]].forEach(([lx, s], i) => {
      const sw = Math.sin((f * Math.PI) / 2 + i * 1.7) * 3 * s;
      x.beginPath();
      x.moveTo(lx, 24);
      x.lineTo(lx + sw, 34);
      x.stroke();
    });
    const bg = x.createLinearGradient(0, 13, 0, 29);
    bg.addColorStop(0, FUR_L);
    bg.addColorStop(0.5, FUR);
    bg.addColorStop(1, FUR_D);
    x.fillStyle = bg;
    x.beginPath();
    x.ellipse(27, 21, 16, 7.5, 0, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.arc(44, 15, 6.5, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.moveTo(40, 11);
    x.lineTo(41, 3.5);
    x.lineTo(45, 9);
    x.fill();
    x.beginPath();
    x.moveTo(45, 9);
    x.lineTo(49, 3.5);
    x.lineTo(50, 12);
    x.fill();
    x.strokeStyle = FUR;
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(12, 19);
    x.quadraticCurveTo(2, 16, 4, 5 + f);
    x.stroke();
    x.strokeStyle = "rgba(130,60,20,.55)";
    x.lineWidth = 1.2;
    for (const sx of [20, 26, 32]) {
      x.beginPath();
      x.moveTo(sx, 14);
      x.quadraticCurveTo(sx + 1.5, 18, sx, 22);
      x.stroke();
    }
    x.fillStyle = "#2a1a10";
    x.beginPath();
    x.arc(46.5, 14, 0.9, 0, Math.PI * 2);
    x.fill();
  };
  const sit = (tail, blink) => (x) => {
    x.lineCap = "round";
    const bg = x.createLinearGradient(0, 6, 0, 44);
    bg.addColorStop(0, FUR_L);
    bg.addColorStop(0.45, FUR);
    bg.addColorStop(1, FUR_D);
    x.fillStyle = bg;
    x.strokeStyle = FUR;
    x.lineWidth = 3.4;
    x.beginPath();
    x.moveTo(29, 41);
    x.quadraticCurveTo(38, 42, tail[0], tail[1]);
    x.stroke();
    x.beginPath();
    x.ellipse(20, 31, 11, 12.5, 0, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.arc(20, 15, 8.5, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.moveTo(12.5, 11);
    x.lineTo(13.5, 2);
    x.lineTo(18.5, 8);
    x.fill();
    x.beginPath();
    x.moveTo(27.5, 11);
    x.lineTo(26.5, 2);
    x.lineTo(21.5, 8);
    x.fill();
    x.fillStyle = "rgba(255,220,190,.8)";
    x.beginPath();
    x.ellipse(20, 33, 5.5, 8, 0, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = "rgba(130,60,20,.5)";
    x.lineWidth = 1;
    for (const sx of [16, 20, 24]) {
      x.beginPath();
      x.moveTo(sx, 7.5);
      x.lineTo(sx, 10.5);
      x.stroke();
    }
    if (blink) {
      x.strokeStyle = "#3a2210";
      x.lineWidth = 0.9;
      x.beginPath();
      x.moveTo(15, 15.5);
      x.quadraticCurveTo(16.5, 16.6, 18, 15.5);
      x.moveTo(22, 15.5);
      x.quadraticCurveTo(23.5, 16.6, 25, 15.5);
      x.stroke();
    } else {
      x.fillStyle = "#8fbf5a";
      x.beginPath();
      x.ellipse(16.5, 15, 1.9, 2.3, 0, 0, Math.PI * 2);
      x.ellipse(23.5, 15, 1.9, 2.3, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#1a120c";
      x.beginPath();
      x.ellipse(16.5, 15, 0.7, 1.8, 0, 0, Math.PI * 2);
      x.ellipse(23.5, 15, 0.7, 1.8, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = "#d98a7a";
    x.beginPath();
    x.moveTo(19, 18.4);
    x.lineTo(21, 18.4);
    x.lineTo(20, 19.6);
    x.fill();
  };
  // Every cell is 56 x 46 units: the walking cat (56 x 36) sits on its floor, the sitting one (44 x 46) in its middle.
  for (let f = 0; f < 4; f++) cells.push({ draw: walk(f), w: 56, h: 36 });
  for (const tp of [[38, 30], [40, 25], [37, 34]]) cells.push({ draw: sit(tp, false), w: 44, h: 46 });
  cells.push({ draw: sit([40, 25], true), w: 44, h: 46 });
  const [CW, CH] = [56, 46];
  const c = document.createElement("canvas");
  c.width = CW * S * cells.length;
  c.height = CH * S;
  const g = c.getContext("2d");
  cells.forEach((cell, i) => {
    g.save();
    g.translate(i * CW * S + ((CW - cell.w) / 2) * S, (CH - cell.h) * S);
    g.scale(S, S);
    cell.draw(g);
    g.restore();
  });
  const soft = document.createElement("canvas");
  soft.width = c.width;
  soft.height = c.height;
  const sg = soft.getContext("2d");
  sg.filter = `blur(${0.4 * S}px)`;
  sg.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(soft);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, cells: cells.length, cw: CW, ch: CH };
}

/** The paper boat's picture. */
function boatTexture() {
  const S = 4;
  const c = document.createElement("canvas");
  c.width = 38 * S;
  c.height = 24 * S;
  const x = c.getContext("2d");
  x.scale(S, S);
  x.filter = "blur(0.35px)";
  x.fillStyle = "#ece4d4";
  x.beginPath();
  x.moveTo(2, 13);
  x.lineTo(36, 13);
  x.lineTo(29, 21);
  x.lineTo(9, 21);
  x.closePath();
  x.fill();
  x.fillStyle = "rgba(120,100,80,.35)";
  x.beginPath();
  x.moveTo(9, 21);
  x.lineTo(29, 21);
  x.lineTo(31, 17);
  x.lineTo(7, 17);
  x.fill();
  x.fillStyle = "#f7f2e6";
  x.beginPath();
  x.moveTo(19, 2);
  x.lineTo(29, 13);
  x.lineTo(9, 13);
  x.closePath();
  x.fill();
  x.strokeStyle = "rgba(110,95,80,.5)";
  x.lineWidth = 0.6;
  x.beginPath();
  x.moveTo(19, 2);
  x.lineTo(19, 13);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The street, its life, the passing thing, the rain, the glass and the lightning.
 * @param {object} o
 * @param {object} o.plate  bar/layers/plate.json
 * @param {{left: THREE.Texture, right: THREE.Texture}} o.streets  the street behind each window
 * @param {() => number} o.rnd  a source of numbers for the ambient life (drops, ripples, lit windows)
 */
export function createOutside({ plate, streets, rnd = Math.random }) {
  const scene = new THREE.Scene();
  const paint = [plate.painting.scale, plate.painting.oy];
  const disposables = [];
  const keep = (...things) => (disposables.push(...things), things[0]);

  // The windows: their boxes, the street picture's place in each, and the panes the drops land on.
  const windows = Object.entries(plate.windows).map(([key, [x0, y0, x1, y1]]) => {
    const st = plate.street[key];
    const k = (y1 - y0) / st.h;
    const w = { key, x: x0, y: y0, w: x1 - x0, h: y1 - y0, k, crop: st, life: STREET_LIFE[key] };
    // The strip is wider than the window: its `mid` is at the window's middle, and the rest is room to slide.
    w.ox = x0 + w.w / 2 - (st.mid - st.x) * k;
    /** A point of the street picture, in painting pixels. */
    w.S = (sx, sy) => [w.ox + (sx - st.x) * k, y0 + sy * k];
    w.panes = plate.panes
      .map((p) => {
        const xs = p.map((q) => q[0]);
        const ys = p.map((q) => q[1]);
        return { x0: Math.min(...xs) - x0 + 1, x1: Math.max(...xs) - x0 - 1, y0: Math.min(...ys) - y0 + 4, y1: Math.max(...ys) - y0 - 1 };
      })
      .filter((p) => p.x1 > 0 && p.x0 < w.w && p.y1 > 0 && p.y0 < w.h && p.x1 - p.x0 > 10);
    w.paneArea = w.panes.map((p) => (p.x1 - p.x0) * (p.y1 - p.y0));
    w.beads = [];
    w.runners = [];
    w.splashes = [];
    w.fading = [];
    w.ripples = [];
    w.impactAcc = rnd();
    w.lit = w.life.lit.map(() => ({ on: 1, target: 1, next: R(rnd, 10, 30) }));
    return w;
  });

  // Far: the street behind each window.
  for (const w of windows) {
    const mat = keep(new THREE.MeshBasicMaterial({ map: streets[w.key], toneMapped: false, depthTest: false, depthWrite: false }));
    const mesh = paintedPlane(paint, w.ox, w.y, w.crop.w * w.k, w.crop.h * w.k, STREET_Z, mat);
    mesh.renderOrder = 0;
    keep(mesh.geometry);
    scene.add(mesh);
  }
  // The street's life, at the street's depth.
  const sheet = spriteSheet();
  keep(sheet.texture);
  const far = keep(new Sprites(sheet, paint, 400));
  far.mesh.renderOrder = 2;
  scene.add(far.mesh);

  // The passing things.
  // The street's cold light from the sky, the lamps' warm light from below, and the bar's own warm light through its windows.
  scene.add(new THREE.HemisphereLight(0x8a9cc8, 0x5a3218, 1.5));
  const warm = new THREE.DirectionalLight(0xffc88a, 1.5);
  warm.position.set(0.3, 0.2, 1);
  scene.add(warm);
  const umbrella = buildUmbrella();
  umbrella.group.visible = false;
  // The umbrella is solid: it hides its own far side, and nothing else here writes depth.
  umbrella.group.traverse((o) => (o.renderOrder = 15));
  scene.add(umbrella.group);
  const cat = catSheet();
  keep(cat.texture);
  const catMat = keep(new THREE.MeshBasicMaterial({ map: cat.texture, transparent: true, toneMapped: false, depthTest: false, depthWrite: false }));
  cat.texture.repeat.set(1 / cat.cells, 1);
  const catMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), catMat);
  catMesh.renderOrder = 16;
  catMesh.visible = false;
  scene.add(catMesh);
  const boatTex = keep(boatTexture());
  const boatMat = keep(new THREE.MeshBasicMaterial({ map: boatTex, transparent: true, toneMapped: false, depthTest: false, depthWrite: false }));
  const boatMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), boatMat);
  boatMesh.renderOrder = 3;
  boatMesh.visible = false;
  scene.add(boatMesh);

  // The rain.
  const dropTex = keep(dropTexture());
  const boxes = windows.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  const rain = RAIN.map((d, i) => rainLayer(d, i, boxes, dropTex, paint, rnd));
  for (const r of rain) {
    keep(r.geo, r.material);
    scene.add(r.mesh);
  }

  // Lightning over the street, and the room's warm reflection in the glass.
  const flashTex = keep(fadeTexture([[0, "rgba(185,205,255,1)"], [0.6, "rgba(160,180,240,.42)"], [1, "rgba(160,180,240,.24)"]]));
  const flashMat = keep(new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false, depthTest: false, depthWrite: false }));
  const glowTex = keep(fadeTexture([[0, "rgba(255,170,90,.06)"], [0.5, "rgba(255,170,90,.035)"], [1, "rgba(255,170,90,.10)"]]));
  const glowMat = keep(new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false, depthTest: false, depthWrite: false }));
  const flashes = [];
  for (const w of windows) {
    const f = paintedPlane(paint, w.x, w.y, w.w, w.h, STREET_Z + 0.5, flashMat);
    f.renderOrder = 5;
    flashes.push(f);
    const g = paintedPlane(paint, w.x, w.y, w.w, w.h, GLASS_Z, glowMat);
    g.renderOrder = 40;
    keep(f.geometry, g.geometry);
    scene.add(f, g);
  }
  // The glass: drops landing, sitting, gathering and running down.
  const glass = keep(new Sprites(sheet, paint, 900));
  glass.mesh.renderOrder = 50;
  scene.add(glass.mesh);

  const state = { drops: true, rainShare: 1, calm: false, small: 0, k: 1, flash: 0, passing: null };
  /** For checks: the umbrella's size, as a share of its own, and the umbrella itself. */
  const look = { umbrella: 1, model: umbrella };
  let last = null;

  // ---------------------------------------------------------------- drops on the glass (the preview's, step for step)
  const pickPane = (w) => {
    let a = rnd() * w.paneArea.reduce((s, v) => s + v, 0);
    for (let i = 0; i < w.panes.length; i++) if ((a -= w.paneArea[i]) <= 0) return i;
    return w.panes.length - 1;
  };
  const newBead = (w, x, y, r, pi) => {
    if (pi === undefined) pi = pickPane(w);
    const p = w.panes[pi];
    const b = { pane: pi, x: x ?? R(rnd, p.x0 + 3, p.x1 - 3), y: y ?? R(rnd, p.y0 + 3, p.y1 - 10), r: r ?? R(rnd, 1.5, 2.6), rd: 0, age: 0, life: R(rnd, 8, 16) };
    w.beads.push(b);
    return b;
  };
  const impact = (w) => {
    const pi = pickPane(w);
    const p = w.panes[pi];
    const [x, y, r] = [R(rnd, p.x0 + 3, p.x1 - 3), R(rnd, p.y0 + 3, p.y1 - 10), R(rnd, 1.5, 2.6)];
    w.splashes.push({ x, y, r, age: 0, a0: rnd() * 6.28 });
    // Landing on a bead, they join into one bigger drop.
    for (const b of w.beads)
      if (b.pane === pi && Math.hypot(b.x - x, b.y - y) < (b.r + r) * 1.25) {
        b.r = Math.sqrt(b.r * b.r + r * r);
        b.age = Math.min(b.age, 2);
        if (b.r > 3.3 && !b.runAt) b.runAt = b.age + R(rnd, 0.4, 1.4);
        return;
      }
    if (w.beads.length > 26) {
      const old = w.beads.reduce((a, b) => (a.life - a.age < b.life - b.age ? a : b));
      old.life = Math.min(old.life, old.age + 1);
    }
    newBead(w, x, y, r, pi);
  };
  for (const w of windows) for (let i = 0; i < 6; i++) Object.assign(newBead(w), { age: R(rnd, 0, 3) }).rd = 2;
  function stepGlass(w, dt) {
    const calm = state.calm;
    w.impactAcc += dt * RAIN_STRENGTH.impacts * (calm ? 0.5 : 1);
    while (w.impactAcc >= 1) {
      w.impactAcc -= 1 + R(rnd, -0.35, 0.35);
      impact(w);
    }
    for (const s of w.splashes) s.age += dt;
    w.splashes = w.splashes.filter((s) => s.age < 0.45);
    for (let i = w.beads.length - 1; i >= 0; i--) {
      const b = w.beads[i];
      b.age += dt;
      b.rd += (b.r - b.rd) * Math.min(1, dt * 7);
      if (b.age > b.life) {
        w.beads.splice(i, 1);
        continue;
      }
      const start = (b.runAt && b.age > b.runAt) || (!b.trail && b.r > 2.4 && rnd() < dt * 0.025);
      if (start && w.runners.length < 3) {
        w.beads.splice(i, 1);
        w.runners.push({ pane: b.pane, x: b.x, x0: b.x, y: b.y, y0: b.y, r: b.r, rd: b.rd, v: 0, ph: rnd() * 6.28, trail: [[b.x, b.y]], lastDrop: b.y, gap: R(rnd, 6, 10) });
      }
    }
    for (let i = w.runners.length - 1; i >= 0; i--) {
      const d = w.runners[i];
      const p = w.panes[d.pane];
      const vt = Math.min(40, 9 + d.r * 7) * (calm ? 0.4 : 1);
      d.v += (vt - d.v) * Math.min(1, dt * 1.4);
      d.y += d.v * dt;
      // A lazy wobble as it finds its way down.
      d.x = clamp(d.x0 + Math.sin((d.y - d.y0) * 0.085 + d.ph) * 1.6 + Math.sin((d.y - d.y0) * 0.023 + d.ph * 2) * 2.2, p.x0 + d.r, p.x1 - d.r);
      d.rd += (d.r - d.rd) * Math.min(1, dt * 7);
      const tail = d.trail[d.trail.length - 1];
      if (d.y - tail[1] > 2) {
        d.trail.push([d.x, d.y]);
        if (d.trail.length > 70) d.trail.shift();
      }
      // It gathers the beads in its way...
      for (let j = w.beads.length - 1; j >= 0; j--) {
        const b = w.beads[j];
        if (b.pane === d.pane && Math.abs(b.x - d.x) < d.r + b.r && b.y > d.y - d.r && b.y < d.y + d.r + b.r) {
          d.r = Math.sqrt(d.r * d.r + b.r * b.r);
          w.beads.splice(j, 1);
        }
      }
      // ...and leaves a few small ones behind.
      if (d.y - d.lastDrop > d.gap) {
        d.lastDrop = d.y;
        d.gap = R(rnd, 7, 12);
        const rb = d.r * 0.3;
        Object.assign(newBead(w, d.x + R(rnd, -0.5, 0.5), d.y - d.r * 1.2, rb, d.pane), { rd: rb, trail: true, life: R(rnd, 3, 6) });
        d.r = Math.sqrt(Math.max(0.5, d.r * d.r - rb * rb * 0.8));
      }
      if (d.r < 1.7 || d.y > p.y1 - d.r * 0.8) {
        const b = newBead(w, d.x, Math.min(d.y, p.y1 - d.r), d.r, d.pane);
        Object.assign(b, { rd: d.rd, trail: true });
        b.life = b.age + (d.r < 1.7 ? R(rnd, 3, 6) : 2.5);
        w.fading.push({ trail: d.trail, a: 1, w: d.rd });
        w.runners.splice(i, 1);
      }
    }
    for (const f of w.fading) f.a -= dt / 3;
    w.fading = w.fading.filter((f) => f.a > 0);
  }
  function drawGlass(w) {
    // Drawn a little larger than life at phone size, so they read (the preview's rule, grown less:
    // at the preview's nearly three times they read as pearls at low pixel density).
    const G = 1.15 + state.small * 1.1;
    const minR = 1.3 / state.k;
    const at = (x, y) => [w.x + x, w.y + y];
    for (const f of [...w.fading, ...w.runners.map((d) => ({ trail: d.trail, a: 1, w: d.rd }))]) {
      const r = Math.max(minR, f.w * G) * 0.38;
      for (let i = 1; i < f.trail.length; i += 1) glass.add(TILES.dot, ...at(...f.trail[i]), GLASS_Z, r / FILL.dot, r / FILL.dot, 0xc8d8f4, 0.09 * f.a);
    }
    for (const b of w.beads) {
      const a = Math.min(1, (b.life - b.age) / 1.5, b.age * 4 + 0.2);
      const r = Math.max(minR, b.rd * G);
      glass.add(TILES.bead, ...at(b.x, b.y), GLASS_Z, r / FILL.bead, (r * 0.95) / FILL.bead, 0xffffff, a);
    }
    for (const d of w.runners) {
      const r = Math.max(minR, d.rd * G);
      glass.add(TILES.bead, ...at(d.x, d.y), GLASS_Z, (r * 0.92) / FILL.bead, (r * 1.18) / FILL.bead, 0xffffff, 1);
    }
    for (const s of w.splashes) {
      const p = s.age / 0.45;
      const r = Math.max(minR, s.r * G);
      const ring = r * (0.8 + 1.7 * ease(p));
      glass.add(TILES.ring, ...at(s.x, s.y), GLASS_Z, ring / FILL.ring, ring / FILL.ring, 0xe1ecff, 0.55 * (1 - p));
      for (let j = 0; j < 4; j++) {
        const an = s.a0 + j * 1.57;
        const dist = r * (1.1 + 2.2 * ease(p));
        const rr = r * 0.28 * (1 - p) + 0.2;
        glass.add(TILES.dot, ...at(s.x + Math.cos(an) * dist, s.y + Math.sin(an) * dist * 0.8), GLASS_Z, rr / FILL.dot, rr / FILL.dot, 0xe1ecff, 0.6 * (1 - p));
      }
    }
    // A soft spot of the room's light caught in each window.
    const [gx, gy] = w.life.glint;
    glass.add(TILES.glow, ...at(w.w * gx, w.h * gy), GLASS_Z, 34, 34, 0xffc878, 0.16, true);
  }

  // ---------------------------------------------------------------- the street's own life
  function stepStreet(w, t, dt) {
    const S = w.S;
    const k = w.k;
    // A lit window now and then goes dark for a while and comes back, slowly; nothing flickers.
    w.life.lit.forEach((r, i) => {
      const st = w.lit[i];
      if (!state.calm) st.next -= dt;
      if (st.next <= 0) {
        if (st.target === 1) [st.target, st.next] = [0, R(rnd, 4, 9)];
        else [st.target, st.next] = [1, R(rnd, 14, 34)];
      }
      st.on += (st.target - st.on) * Math.min(1, dt * 1.6);
      const dark = 1 - st.on;
      if (dark > 0.01) {
        const [ax, ay] = S(r[0], r[1]);
        const [bx, by] = S(r[2], r[3]);
        far.add(TILES.rect, (ax + bx) / 2, (ay + by) / 2, STREET_Z, (bx - ax) / 2, (by - ay) / 2, 0x0e101e, dark * 0.78);
      }
    });
    // The street lamps' glow breathes, slowly.
    for (const [lx, ly, lr] of w.life.lamps) {
      const [x, y] = S(lx, ly);
      const b = state.calm ? 0.82 : 0.78 + 0.1 * Math.sin(t * 0.7 + lx) + 0.04 * Math.sin(t * 1.3 + ly);
      const rr = lr * k * 2.6;
      far.add(TILES.glow, x, y, STREET_Z, rr, rr, 0xffc878, 0.3 * b, true);
    }
    // Shimmer on the wet street: the lamps' reflections breathe in place.
    for (const [lx, ly, lr] of w.life.shimmer) {
      const [x, y] = S(lx, ly);
      for (let j = 0; j < 5; j++) {
        const a = state.calm ? 0.06 : 0.05 + 0.05 * Math.sin(t * 1.3 + j * 1.7 + lx);
        const ww = lr * k * (0.7 + 0.3 * Math.sin(t * 0.8 + j));
        far.add(TILES.rect, x, y + j * lr * k * 0.55, STREET_Z, ww / 2, 0.65, 0xffbe6e, a, true);
      }
    }
    // Rain landing in the puddles: a few soft rings.
    // (The street's pavement and road start about 600 of its pixels down.)
    const ground = w.S(0, 600)[1];
    const bottom = w.y + w.h;
    if (!state.calm && w.ripples.length < 8 * RAIN_STRENGTH.ripples && rnd() < dt * 10 * RAIN_STRENGTH.ripples) {
      const gy = ground + rnd() * (bottom - ground);
      w.ripples.push({ x: w.x + rnd() * w.w, y: gy, age: 0, life: R(rnd, 0.7, 1.1), max: R(rnd, 3, 5) * (0.5 + (gy - ground) / (bottom - ground)) });
    }
    for (let i = w.ripples.length - 1; i >= 0; i--) {
      const r = w.ripples[i];
      r.age += dt;
      if (r.age > r.life) {
        w.ripples.splice(i, 1);
        continue;
      }
      const p = r.age / r.life;
      const rad = r.max * p + 0.5;
      far.add(TILES.ring, r.x, r.y, STREET_Z, rad / FILL.ring, (rad * 0.32) / FILL.ring, 0xc8d7f0, 0.26 * (1 - p));
    }
  }

  // ---------------------------------------------------------------- the passing thing
  const hide = () => {
    umbrella.group.visible = false;
    catMesh.visible = false;
    boatMesh.visible = false;
  };
  /** Puts a flat picture (a plane of size 1) with its bottom middle at a point of the painting, `width` painting pixels wide, at depth z. */
  const stand = (mesh, px, py, z, width, aspect, { flip = false, rot = 0, mid = false } = {}) => {
    const [x, y] = placeAt(px * paint[0], paint[1] + py * paint[0], z);
    const k = metresPerPixel(paint, z);
    const [w, h] = [width * k, width * aspect * k];
    mesh.scale.set(flip ? -w : w, h, 1);
    mesh.rotation.z = rot;
    mesh.position.set(x + (mid ? 0 : Math.sin(rot) * h * 0.5), y + (mid ? 0 : Math.cos(rot) * h * 0.5), z);
  };
  function drawPassing(ev) {
    hide();
    state.passing = ev ? ev.thing.name : null;
    if (!ev) return;
    const w = windows.find((x) => x.key === ev.win) ?? windows[1];
    const t = ev.u * ev.thing.lasts;
    const D = ev.thing.lasts;
    const A = Math.min(clamp(t / 0.5, 0, 1), clamp((D - t) / 0.5, 0, 1));
    const dir = ev.dir;
    switch (ev.thing.name) {
      case "umbrella": {
        // High over the street, in the strip of sky and upper windows.
        const [high, low] = w.key === "left" ? [40, 150] : [60, 240];
        const f = umbrellaAt(ev.u, { w: w.w, high, low, dir, r: ev.r });
        const z = -5.6;
        const [x, y] = placeAt((w.x + f.x) * paint[0], paint[1] + (w.y + f.y) * paint[0], z);
        // Its canopy 120 painting pixels across: seen from the side as it flies, that reads as the
        // preview's 80-pixel picture did face on (`look.umbrella` scales it, for a close look in a check).
        const size = 120 * look.umbrella * metresPerPixel(paint, z);
        umbrella.group.visible = true;
        umbrella.pose({ x, y, z, lean: f.lean, spin: f.spin, nod: f.nod, size });
        break;
      }
      case "cat": {
        // Along the bar's own sill outside, at the foot of the window: trots in, sits and looks in (and blinks), trots on.
        const sill = w.y + w.h - 4;
        const mid = w.w * (0.42 + ev.r * 0.16);
        const [xs, xe] = dir > 0 ? [-40, w.w + 40] : [w.w + 40, -40];
        const [walkIn, sit] = [3, 5];
        let x;
        let cell;
        let flip = dir < 0;
        let width = 76;
        if (t < walkIn) {
          x = xs + (mid - xs) * ease(clamp(t / walkIn, 0, 1));
          cell = Math.floor(t * 6) % 4;
        } else if (t < walkIn + sit) {
          x = mid;
          width = 56 * (56 / 44);
          const st = t - walkIn;
          cell = st > 2.2 && st < 2.42 ? 7 : 4 + (Math.floor(st * 1.4) % 3);
          flip = false;
        } else {
          const u = clamp((t - walkIn - sit) / (D - walkIn - sit), 0, 1);
          x = mid + (xe - mid) * u * u;
          cell = Math.floor(t * 6) % 4;
        }
        if (state.calm) cell = cell < 4 ? 0 : cell;
        cat.texture.offset.set(cell / cat.cells, 0);
        catMesh.material.opacity = A;
        catMesh.visible = true;
        stand(catMesh, w.x + x, sill + 3, GLASS_Z - 0.12, width, cat.ch / cat.cw, { flip });
        break;
      }
      case "boat": {
        // Down the gutter by the kerb, toward the bar.
        const a = [1150, 676];
        const b = [1650, 822];
        const u = ease(ev.u * 0.5 + 0.5 * ev.u * ev.u);
        const [x, y] = w.S(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
        const scale = 0.7 + 0.7 * u;
        for (let j = 1; j <= 3; j++) {
          const rr = (t * 1.4 + j / 3) % 1;
          const rad = 3 + rr * 7 * scale;
          far.add(TILES.ring, x - 6 * scale * j, y - 2 * scale * j, STREET_Z, rad / FILL.ring, (rad * 0.35) / FILL.ring, 0xdce6fa, 0.45 * A * (1 - rr) * 0.6, false, 0.3);
        }
        boatMesh.material.opacity = A;
        boatMesh.visible = true;
        // (A little larger than the preview's, which was hard to find at phone size.)
        stand(boatMesh, x, y + 1.5 + (state.calm ? 0 : Math.sin(t * 2) * 0.6), STREET_Z + 0.02, 42 * scale, 24 / 38, { rot: -(0.28 + (state.calm ? 0 : Math.sin(t * 1.8) * 0.06)) });
        break;
      }
      case "shop": {
        // Off with a short fade, dark for a while, then on again with a slower fade; its glow on the pavement goes too.
        const off = t < 0.6 ? ease(t / 0.6) : t < D - 1.2 ? 1 : 1 - ease((t - (D - 1.2)) / 1.2);
        for (const r of w.life.shop) {
          const [ax, ay] = w.S(r[0], r[1]);
          const [bx, by] = w.S(r[2], r[3]);
          far.add(TILES.rect, (ax + bx) / 2, (ay + by) / 2, STREET_Z, (bx - ax) / 2, (by - ay) / 2, 0x101220, 0.72 * off);
          if (w.key === "right") far.add(TILES.fade, (ax + bx) / 2, by + 80 * w.k, STREET_Z, (bx - ax) / 2, 80 * w.k, 0x101220, 0.45 * off);
        }
        break;
      }
    }
  }

  return {
    scene,
    windows,
    /**
     * One frame. `t` seconds (the room's clock), `ev` what the timetable says is passing, with its
     * window, way and number ({thing, u, win, dir, r}) or null, `flash` how bright the lightning is.
     */
    step(t, ev, flash = 0) {
      const dt = last === null ? 0 : clamp(t - last, 0, 0.05);
      last = t;
      far.begin();
      glass.begin();
      for (const w of windows) stepStreet(w, t, dt);
      drawPassing(ev);
      for (const w of windows) {
        if (state.drops) {
          stepGlass(w, dt);
          drawGlass(w);
        } else glass.add(TILES.glow, w.x + w.w * w.life.glint[0], w.y + w.h * w.life.glint[1], GLASS_Z, 34, 34, 0xffc878, 0.16, true);
      }
      far.done();
      glass.done();
      // The rain: the steady "Rain", slower and thinner for a device that asked for less motion.
      for (const r of rain) {
        const u = r.material.uniforms;
        u.uTime.value = t % 3600;
        u.uFall.value = RAIN_STRENGTH.speed * (state.calm ? 0.35 : 1);
        u.uCount.value = RAIN_STRENGTH.count * state.rainShare * (state.calm ? 0.6 : 1);
        u.uSmall.value = state.small;
        u.uK.value = state.k;
      }
      flashMat.opacity = flash;
      state.flash = flash;
    },
    /** How the drawing is sized: `k` device pixels per painting pixel, for the rain's and the drops' smallest size. */
    resize(k) {
      state.k = Math.max(0.2, k);
      state.small = clamp((1.2 - state.k) / 0.6, 0, 1);
    },
    /** Steps down the ladder: the drops on the glass off, the rain thinned to half. */
    setDrops(on) {
      state.drops = on;
    },
    setRain(share) {
      state.rainShare = share;
    },
    setCalm(calm) {
      state.calm = calm;
    },
    look,
    get calm() {
      return state.calm;
    },
    get passing() {
      return state.passing;
    },
    /** For checks: how many drops are on each window's glass now. */
    glassCounts() {
      return windows.map((w) => ({ window: w.key, beads: w.beads.length, runners: w.runners.length, splashes: w.splashes.length }));
    },
    dispose() {
      umbrella.dispose();
      for (const d of disposables) d.dispose?.();
    },
  };
}
