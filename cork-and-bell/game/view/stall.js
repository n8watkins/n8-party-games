// One stall as a picture: the baked set shown unlit, and every moving thing rendered live so
// that it sits in the baked light (matching environment, one soft key light with shadows).
// A StallView reads a StallSim at a given round time and reacts to its events.
import * as THREE from "three";
import { BACK, BELL, BULBS, CAMERA, CHAIN, CHALK_BOARD, COUNTER, DRIVE, HALF_W, JAM, KEY_LIGHT, PENDULUMS, PLATES, ROWS, SCORE_WINDOW, SHUTTER, STEPS, TRAY, muzzle } from "../shared/layout.js";
import { BELL_FULL, COCK_SECONDS, CORK_R, camLift, chainStar, mech, pendulumAngle, shutterOpen } from "../shared/sim.js";
import { chalkTexture, disc, paintBelt, paintCork, paintMoon, paintReel, paintSheet, paintStar, paintTeapot, paintWood, plateGeometry, star, TEAPOT } from "./paint.js";
import { makeFarLights, makeSky } from "./render.js";

const LIGHT_RANGE = 4.0;
const WARM = new THREE.Color(1.0, 0.56, 0.24);
const TEAPOT_COLOURS = ["#a8261c", "#1f5f86", "#d8c08a", "#2f6b46", "#b8741c"];
export const PRIZE_SCORES = [300, 700, 1200, 1800, 2600];

const SET_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SET_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAlbedo; uniform sampler2D tLit; uniform sampler2D tDusk;
uniform float uBulbs; uniform float uDusk; uniform float uPulse;
varying vec2 vUv;
void main() {
  vec3 albedo = texture2D(tAlbedo, vUv).rgb;
  vec3 lit = texture2D(tLit, vUv).rgb * ${LIGHT_RANGE.toFixed(1)};
  vec3 dusk = texture2D(tDusk, vUv).rgb;
  vec3 bulbs = max(lit - dusk, vec3(0.0));
  vec3 light = dusk * uDusk + bulbs * uBulbs * (1.0 + uPulse);
  gl_FragColor = vec4(albedo * light, 1.0);
}`;

/** Loaded once and shared by every stall on the page. */
export class StallAssets {
  constructor({ gltf, albedo, lit, dusk, env }) {
    this.setGeometry = gltf.scene.getObjectByProperty("isMesh", true).geometry;
    for (const t of [albedo, lit, dusk]) {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    this.albedo = albedo;
    this.lit = lit;
    this.dusk = dusk;
    this.env = env;
    const std = (maps, extra = {}) => new THREE.MeshStandardMaterial({ map: maps.map, roughnessMap: maps.roughnessMap, bumpMap: maps.bumpMap, bumpScale: 1.2, roughness: 1, metalness: 0.0, ...extra });
    this.teapots = TEAPOT_COLOURS.map((c, i) => std(paintTeapot(c, 40 + i)));
    this.teapotGeo = plateGeometry(TEAPOT, 0.3, 0.3 * 0.84);
    this.starMat = std(paintStar(7), { metalness: 0.25 });
    this.starGeo = plateGeometry(star(), CHAIN.rx * 2.15, CHAIN.rx * 2.15, 0.003);
    this.moonMat = std(paintMoon(9));
    this.moonGeo = plateGeometry(disc(), PENDULUMS[0].r * 2.06, PENDULUMS[0].r * 2.06);
    this.smallStarGeo = plateGeometry(star(), SHUTTER.r * 2, SHUTTER.r * 2, 0.003);
    this.redSheet = std(paintSheet("#9c231a", 3, { lines: true }));
    this.greenSheet = std(paintSheet("#1d4a33", 5));
    this.iron = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.62, metalness: 0.75 });
    this.wornIron = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.45, metalness: 0.85 });
    this.brass = new THREE.MeshStandardMaterial({ color: 0xc89a3c, roughness: 0.26, metalness: 1.0 });
    this.brassDull = new THREE.MeshStandardMaterial({ color: 0x9a7430, roughness: 0.48, metalness: 1.0 });
    const cork = paintCork();
    this.cork = new THREE.MeshStandardMaterial({ map: cork, roughness: 0.92, metalness: 0 });
    this.corkRed = new THREE.MeshStandardMaterial({ map: cork, color: 0xd05040, roughness: 0.8 });
    const wood = paintWood();
    wood.repeat.set(1, 2);
    this.wood = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.34, metalness: 0 });
    this.belt = paintBelt();
    this.beltMat = new THREE.MeshStandardMaterial({ map: this.belt, roughness: 0.75, side: THREE.DoubleSide });
    this.reelTex = paintReel();
    this.reelMat = new THREE.MeshStandardMaterial({ map: this.reelTex, roughness: 0.5, color: 0x8c8c8c });
    // A cork: a short tapered cylinder, lying along z when at rest.
    this.corkGeo = new THREE.CylinderGeometry(CORK_R * 0.86, CORK_R, 0.03, 14);
    this.corkGeo.rotateX(Math.PI / 2);
    this.bulbGeo = new THREE.SphereGeometry(0.024, 16, 12);
    this.chalk = chalkTexture();
  }
}

const BULB_VERT = /* glsl */ `
attribute float aLevel;
attribute float aSize;
varying float vLevel; varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
void main() {
  vLevel = aLevel;
  vLocal = position / 0.024;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * aSize, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BULB_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uWarm; uniform vec3 uSky;
varying float vLevel; varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
void main() {
  float facing = max(dot(normalize(vN), normalize(vV)), 0.0);
  // Clear glass: dark through the middle, the sky and the lamps in the rim.
  vec3 glass = mix(uSky * 1.6 + uWarm * 0.05, vec3(0.012, 0.01, 0.01), pow(facing, 0.6));
  // The filament: a small hot loop seen through the glass.
  float loop = abs(length(vLocal.xy * vec2(1.0, 1.25) - vec2(0.0, -0.05)) - 0.34);
  float filament = smoothstep(0.1, 0.0, loop) * step(-0.52, vLocal.y) * facing;
  float cold = filament * 0.08;
  // Lit: the filament burns out to white and the whole envelope glows.
  vec3 lit = uWarm * (1.1 + 2.6 * pow(facing, 1.5)) + vec3(1.0, 0.82, 0.55) * filament * 14.0;
  vec3 c = mix(glass + vec3(cold), lit, clamp(vLevel, 0.0, 1.0)) * max(1.0, vLevel);
  gl_FragColor = vec4(c, 1.0);
}`;

const MOTH_VERT = /* glsl */ `
attribute vec4 aPos;   // xyz, scale
attribute vec2 aFlap;  // phase, rate
uniform float uTime;
varying float vShade; varying vec2 vUv;
void main() {
  float flap = sin(uTime * aFlap.y + aFlap.x) * 1.1;
  vec3 p = position;
  // The wings hinge along the body (the y axis).
  float side = sign(p.x);
  float c = cos(flap), s = sin(flap);
  p = vec3(abs(p.x) * c * side, p.y, abs(p.x) * s);
  vShade = 0.55 + 0.45 * c;
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  mv.xyz += p * aPos.w;
  gl_Position = projectionMatrix * mv;
}`;
const MOTH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLight;
varying float vShade; varying vec2 vUv;
void main() {
  float wing = smoothstep(1.0, 0.82, length(vUv * vec2(1.0, 1.35)));
  if (wing < 0.5) discard;
  vec3 c = mix(vec3(0.5, 0.42, 0.32), vec3(0.22, 0.17, 0.12), smoothstep(0.2, 0.9, length(vUv)));
  gl_FragColor = vec4(c * uLight * vShade, 1.0);
}`;

function spring(obj, key, target, dt, stiffness = 120, damping = 14) {
  const v = (obj[key + "V"] ?? 0) + ((target - obj[key]) * stiffness - (obj[key + "V"] ?? 0) * damping) * dt;
  obj[key + "V"] = v;
  obj[key] += v * dt;
}

export class StallView {
  /**
   * @param {StallAssets} assets
   * @param {{shadows?: boolean, shadowSize?: number, own?: boolean}} opts
   */
  constructor(assets, opts = {}) {
    this.assets = assets;
    this.own = opts.own ?? true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, 0.08, 120);
    this.camera.position.set(...CAMERA.pos);
    this.viewName = "player";
    this.bulbLevel = 1;
    this.flicker = 1;
    this.chaseUntil = -10;
    this.chaseKind = 0;
    this.pulse = 0;
    this.aim = new THREE.Vector3(0, 1.3, ROWS[0].z);
    this.aimSoft = new THREE.Vector3(0, 1.3, ROWS[0].z);
    this.gun = { kick: 0, kickV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, lever: 0 };
    this.focus = 2.6;
    this.focusTarget = 2.6;
    this.displayScore = 0;
    this.reelAngles = [0, 0, 0, 0, 0];
    this.plateAngle = PLATES.map(() => ({ a: 0, aV: 0 }));
    this.starFold = new Array(CHAIN.count).fill(0);
    this.bellSwing = { a: 0, aV: 0 };
    this.particles = [];
    this.incoming = []; // attacks on their way in: {type, at, from}
    this.mothAmount = 0;
    this.time = 0;
    this.build(opts);
  }

  build(opts) {
    const A = this.assets;
    const scene = this.scene;
    scene.environment = A.env;
    scene.environmentIntensity = 1;
    scene.environmentRotation.y = Math.PI / 2;
    scene.add(makeSky());
    this.farLights = makeFarLights(3);
    scene.add(this.farLights);

    // The baked set, and a second copy that only catches the live shadows.
    this.setMat = new THREE.ShaderMaterial({
      vertexShader: SET_VERT,
      fragmentShader: SET_FRAG,
      uniforms: { tAlbedo: { value: A.albedo }, tLit: { value: A.lit }, tDusk: { value: A.dusk }, uBulbs: { value: 1 }, uDusk: { value: 1 }, uPulse: { value: 0 } },
    });
    const set = new THREE.Mesh(A.setGeometry, this.setMat);
    scene.add(set);
    this.shadowMat = new THREE.ShadowMaterial({ opacity: 0.5, color: 0x070403 });
    this.shadowMat.polygonOffset = true;
    this.shadowMat.polygonOffsetFactor = -1;
    this.shadowMat.polygonOffsetUnits = -2;
    const catcher = new THREE.Mesh(A.setGeometry, this.shadowMat);
    catcher.receiveShadow = true;
    catcher.renderOrder = 1;
    scene.add(catcher);
    this.catcher = catcher;

    // Light for the moving things: the awning bulbs as one soft key, and the dusk as fill.
    this.key = new THREE.SpotLight(WARM, 26, 9, 0.82, 0.6, 1.6);
    this.key.position.set(...KEY_LIGHT.pos);
    this.key.target.position.set(...KEY_LIGHT.target);
    this.key.castShadow = opts.shadows !== false;
    this.key.shadow.mapSize.set(opts.shadowSize ?? 2048, opts.shadowSize ?? 2048);
    this.key.shadow.camera.near = 0.6;
    this.key.shadow.camera.far = 5;
    this.key.shadow.radius = 5;
    this.key.shadow.blurSamples = 14;
    this.key.shadow.bias = -0.0006;
    scene.add(this.key, this.key.target);
    this.fill = new THREE.HemisphereLight(0x3a4c8c, 0x1a1410, 0.5);
    scene.add(this.fill);
    // The bulbs along the front of the awning also light the counter, the gun and the drive.
    this.front = new THREE.PointLight(WARM, 5, 7, 1.5);
    this.front.position.set(-0.2, 2.02, -0.35);
    scene.add(this.front);

    this.buildTargets();
    this.buildDrive();
    this.buildBulbs();
    this.buildScore();
    this.buildCorks();
    this.buildGun();
    this.buildMoths();
    this.buildParticles();
  }

  mesh(geo, mat, parent = this.scene, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  }

  buildTargets() {
    const A = this.assets;
    // Front row: teapots cut from sheet iron, each hinged at its foot.
    this.plates = PLATES.map((p, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(p.x, ROWS[0].y + 0.004, p.z);
      this.scene.add(pivot);
      const m = this.mesh(A.teapotGeo, A.teapots[i], pivot);
      m.position.y = 0.3 * 0.84 * 0.5 - 0.012;
      const hinge = this.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8), A.wornIron, pivot);
      hinge.rotation.z = Math.PI / 2;
      return pivot;
    });
    // The cam bar that lifts them: a square iron bar on two arms, swinging up from behind.
    this.cam = new THREE.Group();
    this.cam.position.set(0, ROWS[0].y + 0.012, ROWS[0].z - 0.03);
    this.scene.add(this.cam);
    const bar = this.mesh(new THREE.BoxGeometry(1.86, 0.016, 0.016), A.wornIron, this.cam);
    bar.position.set(0, 0.11, 0);
    for (const x of [-0.93, 0.93]) {
      const arm = this.mesh(new THREE.BoxGeometry(0.014, 0.125, 0.02), A.iron, this.cam);
      arm.position.set(x, 0.055, 0);
    }
    const shaft = this.mesh(new THREE.CylinderGeometry(0.009, 0.009, 2.2, 10), A.wornIron);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.copy(this.cam.position);
    // The cork a rival wedges into the cam.
    this.jamCork = this.mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.085, 18), A.corkRed);
    this.jamCork.visible = false;

    // Middle row: gilt stars riding a chain in a slot.
    this.stars = [];
    for (let i = 0; i < CHAIN.count; i++) {
      const g = new THREE.Group();
      this.scene.add(g);
      const stem = this.mesh(new THREE.BoxGeometry(0.008, 0.07, 0.004), A.iron, g);
      stem.position.y = -0.085;
      const fold = new THREE.Group();
      fold.position.y = -0.055;
      g.add(fold);
      const s = this.mesh(A.starGeo, A.starMat, fold);
      s.position.y = 0.055;
      this.stars.push({ g, fold });
    }
    const linkGeo = new THREE.BoxGeometry(0.02, 0.006, 0.012);
    this.linkCount = 64;
    this.links = new THREE.InstancedMesh(linkGeo, A.wornIron, this.linkCount);
    this.links.castShadow = false;
    this.scene.add(this.links);
    this.sprockets = [-1, 1].map((side) => {
      const s = this.mesh(new THREE.CylinderGeometry(CHAIN.r, CHAIN.r, 0.014, 9), A.wornIron);
      s.rotation.x = Math.PI / 2;
      const holder = new THREE.Group();
      holder.position.set((side * CHAIN.span) / 2 + side * 0.03, CHAIN.y - 0.115, CHAIN.z);
      holder.add(s);
      const hub = this.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10), A.brassDull, holder);
      hub.rotation.x = Math.PI / 2;
      this.scene.add(holder);
      return holder;
    });

    // Far row: two moons on pendulums, the shutter lantern, and the bell.
    this.pendulums = PENDULUMS.map((p) => {
      const pivot = new THREE.Group();
      pivot.position.set(p.px, p.py, p.z);
      this.scene.add(pivot);
      const rod = this.mesh(new THREE.BoxGeometry(0.012, p.len - 0.06, 0.004), A.iron, pivot);
      rod.position.y = -(p.len - 0.06) / 2;
      const moon = this.mesh(A.moonGeo, A.moonMat, pivot);
      moon.position.y = -p.len;
      const cap = this.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 14), A.brass, pivot);
      cap.rotation.x = Math.PI / 2;
      // The bracket that holds the pivot off the back board.
      const bracket = this.mesh(new THREE.BoxGeometry(0.03, 0.03, Math.abs(BACK.z - p.z)), A.iron);
      bracket.position.set(p.px, p.py, (BACK.z + p.z) / 2);
      return { pivot, moon };
    });
    this.shutterStar = this.mesh(A.smallStarGeo, A.starMat);
    this.shutterStar.position.set(SHUTTER.x, SHUTTER.y, SHUTTER.z - 0.02);
    this.shutters = [-1, 1].map((side) => {
      const leaf = this.mesh(new THREE.BoxGeometry(0.094, 0.2, 0.004), A.redSheet);
      leaf.position.set(SHUTTER.x + side * 0.048, SHUTTER.y, SHUTTER.z + 0.012);
      leaf.userData.side = side;
      return leaf;
    });
    // The bell: a spun brass gong on a post, with a ring of small lamps that fill as you score.
    const profile = [];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      profile.push(new THREE.Vector2(Math.sin(u * 1.45) * BELL.r * 1.01, (1 - Math.cos(u * 1.45)) * -0.05));
    }
    this.bell = new THREE.Group();
    this.bell.position.set(BELL.x, BELL.y, BELL.z);
    this.scene.add(this.bell);
    const dome = this.mesh(new THREE.LatheGeometry(profile, 40), this.assets.brass, this.bell);
    dome.rotation.x = Math.PI / 2;
    dome.position.z = 0.045;
    dome.material = this.assets.brass.clone();
    dome.material.side = THREE.DoubleSide;
    this.bellDome = dome;
    const boss = this.mesh(new THREE.SphereGeometry(0.018, 14, 10), A.brassDull, this.bell);
    boss.position.z = 0.05;
    const ring = this.mesh(new THREE.TorusGeometry(BELL.r * 0.62, 0.004, 8, 40), new THREE.MeshStandardMaterial({ color: 0x8f1f14, roughness: 0.4 }), this.bell);
    ring.position.z = 0.028;
    const post = this.mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8), A.iron, this.bell);
    post.rotation.x = Math.PI / 2;
    post.position.z = -0.04;
  }

  buildDrive() {
    const A = this.assets;
    const wheel = (r, spokes, rimMat) => {
      const g = new THREE.Group();
      const rim = this.mesh(new THREE.TorusGeometry(r, r * 0.11, 10, 44), rimMat, g);
      rim.rotation.y = Math.PI / 2;
      for (let i = 0; i < spokes; i++) {
        const s = this.mesh(new THREE.BoxGeometry(0.012, r * 2, r * 0.09), A.iron, g);
        s.rotation.x = (i / spokes) * Math.PI;
      }
      const hub = this.mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.05, 16), A.brass, g);
      hub.rotation.z = Math.PI / 2;
      this.scene.add(g);
      return g;
    };
    const red = new THREE.MeshStandardMaterial({ color: 0x7c1a12, roughness: 0.38, metalness: 0.2 });
    const green = new THREE.MeshStandardMaterial({ color: 0x1f4a34, roughness: 0.4, metalness: 0.2 });
    this.flywheel = wheel(DRIVE.flywheel.r, 3, red);
    this.flywheel.position.set(DRIVE.x, DRIVE.flywheel.y, DRIVE.flywheel.z);
    const crank = this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 10), A.brass, this.flywheel);
    crank.rotation.z = Math.PI / 2;
    crank.position.set(0.07, DRIVE.flywheel.r * 0.62, 0);
    this.wheels = DRIVE.wheels.map((w) => {
      const g = wheel(w.r, 2, green);
      g.position.set(DRIVE.x, w.y, w.z);
      return g;
    });
    // The belt: two straight runs tangent to the first and last pulleys, and the wraps round them.
    const a = DRIVE.flywheel;
    const b = DRIVE.wheels[2];
    const rA = 0.085;
    const rB = b.r * 0.92;
    const dz = b.z - a.z;
    const dy = b.y - a.y;
    const len = Math.hypot(dz, dy);
    const ang = Math.atan2(dy, -dz); // slope of the centre line, looking from +x
    const path = [];
    const N = 12;
    // Points in (z, y); the belt lies in the plane x = DRIVE.x + 0.05.
    for (let i = 0; i <= N; i++) {
      const t = ang + Math.PI / 2 + (i / N) * Math.PI;
      path.push([a.z + Math.cos(t) * rA * -1, a.y + Math.sin(t) * rA]);
    }
    for (let i = 0; i <= N; i++) {
      const t = ang - Math.PI / 2 + (i / N) * Math.PI;
      path.push([b.z + Math.cos(t) * rB * -1, b.y + Math.sin(t) * rB]);
    }
    path.push(path[0]);
    const pos = [];
    const uv = [];
    const idx = [];
    let run = 0;
    const w = 0.034;
    for (let i = 0; i < path.length; i++) {
      if (i) run += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      pos.push(DRIVE.x + 0.05 - w / 2, path[i][1], path[i][0], DRIVE.x + 0.05 + w / 2, path[i][1], path[i][0]);
      uv.push(0, run / 0.14, 1, run / 0.14);
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    }
    void len;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.beltMesh = this.mesh(geo, A.beltMat);
    // Shafts from each wheel into its row.
    for (const wdef of DRIVE.wheels) {
      const s = this.mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 8), A.wornIron);
      s.rotation.z = Math.PI / 2;
      s.position.set(DRIVE.x + 0.08, wdef.y, wdef.z);
    }
    const axle = this.mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 10), A.wornIron);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(DRIVE.x - 0.02, DRIVE.flywheel.y, DRIVE.flywheel.z);
  }

  buildBulbs() {
    const A = this.assets;
    const list = [];
    const add = (group, p, size = 1) => list.push({ group, p, size });
    BULBS.border.forEach((p) => add("border", p));
    BULBS.key.forEach((p) => add("key", p, 1.05));
    BULBS.festoon.forEach((p) => add("festoon", p, 1.25));
    BULBS.prize.forEach((p) => add("prize", p, 0.8));
    for (let i = 0; i < BELL_FULL; i++) {
      const a = Math.PI * (1.12 - (i / (BELL_FULL - 1)) * 1.24);
      add("meter", [BELL.x + Math.cos(a) * 0.155, BELL.y + Math.sin(a) * 0.155 - 0.02, BACK.z + 0.03], 0.42);
    }
    this.bulbList = list;
    const geo = A.bulbGeo.clone();
    this.bulbLevels = new Float32Array(list.length);
    geo.setAttribute("aLevel", new THREE.InstancedBufferAttribute(this.bulbLevels, 1));
    geo.setAttribute("aSize", new THREE.InstancedBufferAttribute(new Float32Array(list.map((b) => b.size)), 1));
    this.bulbMat = new THREE.ShaderMaterial({ vertexShader: BULB_VERT, fragmentShader: BULB_FRAG, uniforms: { uWarm: { value: WARM }, uSky: { value: new THREE.Color(0.05, 0.08, 0.2) } } });
    this.bulbs = new THREE.InstancedMesh(geo, this.bulbMat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((b, i) => this.bulbs.setMatrixAt(i, m.makeTranslation(b.p[0], b.p[1], b.p[2])));
    this.bulbs.frustumCulled = false;
    this.scene.add(this.bulbs);
    // The festoon's wire.
    const pts = BULBS.festoon.map((p) => new THREE.Vector3(p[0], p[1] + 0.04, p[2]));
    const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.006, 5), new THREE.MeshBasicMaterial({ color: 0x050506 }));
    this.scene.add(wire);
  }

  buildScore() {
    const A = this.assets;
    this.reels = [];
    const n = 5;
    const w = SCORE_WINDOW.w / n;
    for (let i = 0; i < n; i++) {
      const geo = new THREE.CylinderGeometry(0.062, 0.062, w - 0.008, 40, 1, true);
      geo.rotateZ(Math.PI / 2);
      const reel = this.mesh(geo, A.reelMat, this.scene, false);
      reel.position.set(SCORE_WINDOW.x - SCORE_WINDOW.w / 2 + w * (i + 0.5), SCORE_WINDOW.y, SCORE_WINDOW.z - 0.052);
      this.reels.push(reel);
    }
    const chalk = new THREE.Mesh(new THREE.PlaneGeometry(CHALK_BOARD.w, CHALK_BOARD.h), new THREE.MeshBasicMaterial({ map: A.chalk.texture, transparent: true, color: new THREE.Color(0.5, 0.4, 0.3) }));
    chalk.rotation.y = Math.PI / 2;
    chalk.position.set(CHALK_BOARD.x + 0.006, CHALK_BOARD.y, CHALK_BOARD.z);
    this.scene.add(chalk);
    this.chalkMesh = chalk;
  }

  buildCorks() {
    const A = this.assets;
    this.flying = [];
    for (let i = 0; i < 8; i++) {
      const c = this.mesh(A.corkGeo, A.cork);
      c.visible = false;
      this.flying.push(c);
    }
    this.restedMesh = new THREE.InstancedMesh(A.corkGeo, A.cork, 96);
    this.restedMesh.castShadow = true;
    this.restedMesh.count = 0;
    this.restedMesh.frustumCulled = false;
    this.scene.add(this.restedMesh);
    this.restedShown = 0;
    this.trayMesh = new THREE.InstancedMesh(A.corkGeo, A.cork, 72);
    this.trayMesh.castShadow = true;
    this.trayMesh.frustumCulled = false;
    this.scene.add(this.trayMesh);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let s = 9;
    const r = () => ((s = (s * 16807) % 2147483647), s / 2147483647);
    for (let i = 0; i < 72; i++) {
      const layer = Math.floor(i / 36);
      const k = i % 36;
      const x = TRAY.x - TRAY.w / 2 + 0.03 + (k % 9) * ((TRAY.w - 0.06) / 8) + (r() - 0.5) * 0.008;
      const z = TRAY.z - TRAY.d / 2 + 0.035 + Math.floor(k / 9) * ((TRAY.d - 0.07) / 3) + (r() - 0.5) * 0.01;
      e.set(0, r() * 6.28, 0);
      m.compose(new THREE.Vector3(x, COUNTER.top + 0.006 + CORK_R + layer * 0.021, z), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
      this.trayMesh.setMatrixAt(i, m);
    }
    this.trayMesh.count = 70;
  }

  buildGun() {
    const A = this.assets;
    const g = new THREE.Group();
    this.gunGroup = g;
    this.scene.add(g);
    // Built along -z: the muzzle is at the origin, the stock runs back towards the player.
    const barrel = this.mesh(new THREE.CylinderGeometry(0.0125, 0.0135, 0.4, 20), A.brass, g);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.2;
    const lip = this.mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 20), A.brass, g);
    const band = this.mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.025, 20), A.brassDull, g);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.3;
    const sight = this.mesh(new THREE.SphereGeometry(0.004, 8, 6), A.brass, g);
    sight.position.set(0, 0.016, 0.02);
    // The turned wood fore-end and stock.
    const pts = [[0.0, 0], [0.019, 0], [0.024, 0.04], [0.026, 0.16], [0.022, 0.21], [0.027, 0.26], [0.031, 0.34], [0.03, 0.48], [0.036, 0.6], [0.04, 0.68], [0.03, 0.7], [0, 0.7]].map(([r, y]) => new THREE.Vector2(r, y));
    const stock = this.mesh(new THREE.LatheGeometry(pts, 24), A.wood, g);
    stock.rotation.x = Math.PI / 2;
    stock.position.set(0, -0.012, 0.36);
    stock.scale.set(1, 1, 1.25);
    const guard = this.mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 20, Math.PI), A.brass, g);
    guard.rotation.set(0, Math.PI / 2, Math.PI);
    guard.position.set(0, -0.05, 0.62);
    // The cocking lever, hinged under the breech.
    this.lever = new THREE.Group();
    this.lever.position.set(0, -0.03, 0.44);
    g.add(this.lever);
    const arm = this.mesh(new THREE.BoxGeometry(0.008, 0.008, 0.2), A.brass, this.lever);
    arm.position.set(0.03, -0.004, 0.1);
    const knob = this.mesh(new THREE.SphereGeometry(0.012, 12, 10), A.brass, this.lever);
    knob.position.set(0.03, -0.004, 0.2);
    this.muzzleCork = this.mesh(A.corkGeo, A.cork, g);
    this.muzzleCork.position.z = -0.006;
    void lip;
  }

  buildMoths() {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -0.7, 0, 0, -0.35, 0, 0, 0.6, 0, -1, 0.8, 0, 1, -0.7, 0, 1, 0.8, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2]);
    this.mothCount = 64;
    this.mothPos = new Float32Array(this.mothCount * 4);
    const flap = new Float32Array(this.mothCount * 2);
    this.mothSeed = [];
    for (let i = 0; i < this.mothCount; i++) {
      flap[i * 2] = Math.random() * 6.28;
      flap[i * 2 + 1] = 34 + Math.random() * 26;
      this.mothSeed.push([Math.random(), Math.random(), Math.random(), Math.random()]);
    }
    geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(this.mothPos, 4));
    geo.setAttribute("aFlap", new THREE.InstancedBufferAttribute(flap, 2));
    geo.instanceCount = this.mothCount;
    this.mothMat = new THREE.ShaderMaterial({ vertexShader: MOTH_VERT, fragmentShader: MOTH_FRAG, uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Color(2.2, 1.5, 0.9) } }, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, this.mothMat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mothGeo = geo;
  }

  buildParticles() {
    this.chipMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.006, 0.006, 0.002), new THREE.MeshStandardMaterial({ color: 0xcdb48a, roughness: 0.9 }), 48);
    this.chipMesh.count = 0;
    this.chipMesh.frustumCulled = false;
    this.scene.add(this.chipMesh);
  }

  // ------------------------------------------------------------------ reacting to the simulation

  /** Events from this stall's simulation (and the battle), in order. Returns cues for sound and the HUD. */
  onEvent(e, sim) {
    switch (e.k) {
      case "fire":
        this.gun.kickV += 2.6;
        this.gun.pitchV += 1.9;
        this.gun.rollV += (Math.random() - 0.5) * 1.2;
        this.firedAt = this.time;
        break;
      case "hit": {
        this.chaseUntil = this.time + (e.rung ? 2.6 : e.row >= 2 ? 1.1 : 0.7);
        this.chaseKind = e.rung ? 2 : e.perfect ? 1 : 0;
        this.pulse = Math.max(this.pulse, e.rung ? 0.5 : 0.12);
        const colour = e.target.startsWith("p") ? TEAPOT_COLOURS[Number(e.target[1])] : e.target === "bell" ? "#c89a3c" : e.target.startsWith("d") ? "#1c3566" : "#c79a2c";
        this.burst(e.x, e.y, e.z + 0.02, e.perfect ? 12 : 7, colour);
        if (e.target === "bell") this.bellSwing.aV += e.rung ? 9 : 5;
        if (e.target.startsWith("p")) this.plateAngle[Number(e.target[1])].aV = -14;
        break;
      }
      case "bounce":
        if (e.what === "board" && e.s > 3) this.burst(e.x, e.y, e.z + 0.01, 3, "#3a5a48");
        break;
      case "reset":
        this.camAt = this.time;
        break;
      default:
        break;
    }
    void sim;
  }

  burst(x, y, z, n, colour) {
    const c = new THREE.Color(colour);
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= 48) this.particles.shift();
      this.particles.push({ p: new THREE.Vector3(x, y, z), v: new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 1.6, 0.5 + Math.random() * 1.4), life: 0.5 + Math.random() * 0.4, c, spin: Math.random() * 6 });
    }
  }

  setAim(x, y) {
    this.aim.set(x, y, ROWS[0].z);
  }

  setBestScores(rows) {
    this.assets.chalk.draw(rows);
  }

  setView(name, aspect) {
    this.viewName = name;
    this.aspect = aspect;
  }

  // ------------------------------------------------------------------ every frame

  /**
   * @param {import("../shared/sim.js").StallSim} sim
   * @param {number} t   round time shown
   * @param {number} dt  real seconds since the last frame
   * @param {number} wall real seconds, for things that never stop (moths, sway)
   */
  update(sim, t, dt, wall) {
    this.time = t;
    const A = this.assets;
    const frozen = dt === 0;
    const m4 = this._m ?? (this._m = new THREE.Matrix4());
    const q = this._q ?? (this._q = new THREE.Quaternion());
    const e3 = this._e ?? (this._e = new THREE.Euler());
    const v3 = this._v ?? (this._v = new THREE.Vector3());
    const one = this._one ?? (this._one = new THREE.Vector3(1, 1, 1));

    // ---- bulbs: the dark attack, the warning flicker, the chase.
    const dark = t < sim.darkUntil;
    const warnDark = this.incoming.find((a) => a.type === "dark" && t < a.at);
    let level = dark ? 0.035 + (Math.sin(wall * 47) > 0.96 ? 0.25 : 0) : 1;
    if (!dark && warnDark) level = 0.55 + 0.45 * Math.sign(Math.sin(wall * 31) + Math.sin(wall * 53) * 0.7 + 0.4);
    if (!dark && sim.darkUntil > 0 && t - sim.darkUntil < 0.5 && t >= sim.darkUntil) level = Math.sin(wall * 60) > -0.2 ? 1 : 0.3; // they stutter back on
    this.bulbLevel += (level - this.bulbLevel) * (frozen ? 1 : Math.min(1, dt * 18));
    const B = this.bulbLevel;
    this.pulse *= frozen ? 1 : Math.exp(-dt * 5);
    this.setMat.uniforms.uBulbs.value = B;
    this.setMat.uniforms.uPulse.value = this.pulse;
    this.key.intensity = 26 * B * (1 + this.pulse);
    this.front.intensity = 5 * B;
    this.scene.environmentIntensity = 0.12 + 0.88 * B;
    this.shadowMat.opacity = 0.5 * B;
    this.farLights.material.uniforms.uTime.value = wall;
    const chasing = t < this.chaseUntil;
    const prizeLit = PRIZE_SCORES.filter((s) => sim.score >= s).length;
    let borderIndex = 0;
    let prizeIndex = 0;
    let meterIndex = 0;
    for (let i = 0; i < this.bulbList.length; i++) {
      const b = this.bulbList[i];
      let L = B;
      if (b.group === "border") {
        const n = BULBS.border.length;
        if (chasing) {
          // The chase: a bright head runs along the border, both ways for a jackpot.
          const speed = this.chaseKind === 2 ? 34 : 26;
          const head = ((this.chaseUntil - t) * speed) % n;
          const d1 = Math.abs(((borderIndex - head + n * 1.5) % n) - n / 2);
          const d2 = Math.abs(((n - 1 - borderIndex - head + n * 1.5) % n) - n / 2);
          const d = this.chaseKind === 2 ? Math.min(d1, d2) : d1;
          L = B * (0.3 + 1.9 * Math.max(0, 1 - d / 2.5));
        } else {
          L = B * (0.92 + 0.08 * Math.sin(wall * 2 + borderIndex * 1.7));
        }
        borderIndex++;
      } else if (b.group === "prize") {
        L = prizeIndex < prizeLit ? B * 1.1 : 0;
        prizeIndex++;
      } else if (b.group === "meter") {
        const full = sim.bell >= BELL_FULL;
        L = meterIndex < sim.bell ? (full ? 0.75 + 0.6 * (Math.sin(wall * 12 - meterIndex * 0.8) > 0 ? 1 : 0) : 1) * Math.max(B, 0.4) : 0;
        meterIndex++;
      } else if (b.group === "festoon") {
        L = 0.9 + 0.1 * Math.sin(wall * 1.3 + i);
      }
      this.bulbLevels[i] = L;
    }
    this.bulbs.geometry.attributes.aLevel.needsUpdate = true;

    // ---- the drive: flywheel, wheels, belt, chain.
    const mt = mech(t);
    const beltTravel = mt * 0.42;
    this.flywheel.rotation.x = -beltTravel / 0.085;
    this.wheels.forEach((w, i) => (w.rotation.x = -beltTravel / DRIVE.wheels[i].r + i));
    A.belt.offset.y = -beltTravel / 0.14;
    const chainDist = CHAIN.speed * mt;
    this.sprockets.forEach((s) => (s.children[0].rotation.y = -chainDist / CHAIN.r));
    const pitch = CHAIN.span / (this.linkCount / 2);
    for (let i = 0; i < this.linkCount; i++) {
      const u = (((chainDist + (i >> 1) * pitch) % CHAIN.span) + CHAIN.span) % CHAIN.span;
      const z = CHAIN.z + (i % 2 ? 0.008 : -0.008);
      m4.makeTranslation(-CHAIN.span / 2 + u, CHAIN.y - 0.118, z);
      this.links.setMatrixAt(i, m4);
    }
    this.links.instanceMatrix.needsUpdate = true;

    // ---- front row: plates fall back on their hinges; the cam bar lifts them.
    const jammed = t < sim.jamUntil;
    const lift = jammed ? -1 : camLift(t);
    // The bar sweeps from lying back (-1.45) up to upright and returns.
    const sweep = lift < 0 ? 0 : lift < 0.6 ? lift / 0.6 : 1 - (lift - 0.6) / 0.4;
    const barAngle = -1.5 + 1.42 * (sweep * sweep * (3 - 2 * sweep)) + (jammed ? Math.sin(wall * 38) * 0.035 : 0);
    this.cam.rotation.x = barAngle;
    for (let i = 0; i < PLATES.length; i++) {
      const st = this.plateAngle[i];
      const down = sim.plateDown[i] >= 0;
      let target = 0;
      if (down) target = -1.5;
      else if (t < sim.plateUpAt[i]) target = Math.min(0, barAngle + 0.06); // riding up on the bar
      if (frozen) st.a = target;
      else if (down) {
        // It falls under its own weight and rattles once on the bar.
        st.aV -= 60 * dt;
        st.a += st.aV * dt;
        if (st.a < -1.5) {
          st.a = -1.5;
          st.aV = Math.abs(st.aV) > 2 ? -st.aV * 0.28 : 0;
        }
      } else {
        st.aV = 0;
        st.a += (target - st.a) * Math.min(1, dt * 30);
        if (target === 0 && Math.abs(st.a) < 0.2) st.a += Math.sin(wall * 40 + i) * 0.02 * Math.max(0, 1 - (t - sim.plateUpAt[i]) * 4);
      }
      this.plates[i].rotation.x = st.a;
    }
    // The jam: a rival's cork arcs in during the warning and wedges into the cam.
    const jamIn = this.incoming.find((a) => a.type === "jam" && t < a.at);
    if (jamIn) {
      const u = Math.max(0, 1 - (jamIn.at - t) / 1.3);
      const side = jamIn.side ?? 1;
      this.jamCork.visible = u > 0;
      this.jamCork.position.set(JAM.x + side * (1 - u) * 1.6, JAM.y + Math.sin(u * Math.PI) * 0.75 + (1 - u) * 0.5, JAM.z + (1 - u) * 1.4);
      this.jamCork.rotation.set(u * 9, 0, u * 7);
    } else if (jammed) {
      this.jamCork.visible = true;
      this.jamCork.position.set(JAM.x, JAM.y + Math.sin(wall * 38) * 0.002, JAM.z);
      this.jamCork.rotation.set(0.5, 0, 0.9);
    } else if (this.jamCork.visible) {
      // Shot loose: it tumbles away.
      this.jamCork.position.y -= dt * 2.2;
      this.jamCork.position.x += dt * 0.9;
      this.jamCork.rotation.z += dt * 14;
      if (this.jamCork.position.y < 0.4 || frozen) this.jamCork.visible = false;
    }

    // ---- middle row.
    for (let i = 0; i < CHAIN.count; i++) {
      const s = chainStar(i, t);
      const st = this.stars[i];
      st.g.visible = s.onTop;
      if (!s.onTop) {
        this.starFold[i] = 0;
        continue;
      }
      const hit = sim.starLap[i] === s.lap;
      const target = hit ? -1.45 : 0;
      this.starFold[i] += (target - this.starFold[i]) * (frozen ? 1 : Math.min(1, dt * 22));
      st.g.position.set(s.x, s.y - Math.abs(s.tip) * 0.07, CHAIN.z);
      st.g.rotation.z = -s.tip * 1.2;
      st.fold.rotation.x = this.starFold[i];
    }

    // ---- far row.
    PENDULUMS.forEach((p, i) => {
      const pd = this.pendulums[i];
      pd.pivot.rotation.z = pendulumAngle(p, t);
      const stun = sim.stunUntil[i] - t;
      // Struck, the moon spins on its rod and settles.
      pd.moon.rotation.y = stun > 0 ? stun * stun * 9 : 0;
    });
    const open = shutterOpen(t);
    this.shutters.forEach((leaf) => (leaf.position.x = SHUTTER.x + leaf.userData.side * (0.048 + open * 0.07)));
    const sinceStar = t - sim.shutterHitAt;
    this.shutterStar.rotation.y = sinceStar < 1.2 && sinceStar >= 0 ? (1.2 - sinceStar) ** 2 * 22 : 0;
    this.shutterStar.rotation.z = wall * 0.4;
    if (!frozen) {
      this.bellSwing.aV += (-this.bellSwing.a * 900 - this.bellSwing.aV * 5) * dt;
      this.bellSwing.a += this.bellSwing.aV * dt;
    }
    this.bell.rotation.x = this.bellSwing.a * 0.02;
    this.bell.position.z = BELL.z + this.bellSwing.a * 0.0016;
    this.bellDome.material.emissive.setRGB(0.5, 0.3, 0.08).multiplyScalar(sim.bell >= BELL_FULL ? 0.25 + 0.25 * Math.sin(wall * 9) : 0);

    // ---- corks: in flight, at rest, and what is left in the tray.
    for (let i = 0; i < this.flying.length; i++) {
      const mesh = this.flying[i];
      const c = sim.corks[i];
      mesh.visible = !!c;
      if (!c) continue;
      mesh.position.set(c.p[0], c.p[1], c.p[2]);
      // It tumbles end over end as it flies.
      const spin = c.age * (18 + c.spin * 30);
      mesh.rotation.set(spin, c.spin * 6, spin * 0.37);
    }
    if (this.restedShown !== sim.rested.length) {
      const n = Math.min(sim.rested.length, 96);
      for (let i = Math.min(this.restedShown, n); i < n; i++) {
        const c = sim.rested[i];
        e3.set(0, c[3], 0);
        m4.compose(v3.set(c[0], c[1], c[2]), q.setFromEuler(e3), one);
        this.restedMesh.setMatrixAt(i, m4);
      }
      this.restedMesh.count = n;
      this.restedMesh.instanceMatrix.needsUpdate = true;
      this.restedShown = sim.rested.length;
    }
    this.trayMesh.count = Math.max(0, Math.min(72, sim.corksLeft));

    // ---- the score reels roll to the score.
    const shown = Math.min(99999, sim.score);
    for (let i = 0; i < 5; i++) {
      const place = 10 ** (4 - i);
      const digit = Math.floor(shown / place) % 10;
      // Each drum eases to its digit, the low ones spinning fastest.
      let target = digit;
      const cur = this.reelAngles[i];
      const base = Math.floor(cur / 10) * 10;
      target += base;
      if (target < cur - 0.01) target += 10;
      this.reelAngles[i] = frozen ? target : cur + (target - cur) * Math.min(1, dt * (5 + i * 2.2));
      this.reels[i].rotation.x = (this.reelAngles[i] / 10) * Math.PI * 2 + Math.PI * 0.5 + 0.314;
    }

    // ---- the gun: it follows the aim with weight, sways, kicks and is cocked again.
    const g = this.gun;
    if (frozen) this.aimSoft.copy(this.aim);
    else {
      this.aimSoft.x += (this.aim.x - this.aimSoft.x) * Math.min(1, dt * 11);
      this.aimSoft.y += (this.aim.y - this.aimSoft.y) * Math.min(1, dt * 11);
      spring(g, "kick", 0, dt, 260, 17);
      spring(g, "pitch", 0, dt, 200, 15);
      spring(g, "roll", 0, dt, 150, 12);
    }
    const sway = frozen ? 0 : 1;
    const ax = this.aimSoft.x + Math.sin(wall * 1.1) * 0.012 * sway;
    const ay = this.aimSoft.y + Math.sin(wall * 1.7 + 1) * 0.009 * sway;
    const mz = muzzle(ax, ay);
    const dir = v3.set(ax - mz[0], ay - mz[1], ROWS[0].z - mz[2]).normalize();
    this.gunGroup.position.set(mz[0], mz[1] - 0.012, mz[2]).addScaledVector(dir, -g.kick * 0.035);
    // The barrel lies along the aim; the butt drops towards the player's shoulder.
    this.gunGroup.rotation.set(0, 0, 0);
    this.gunGroup.lookAt(this.gunGroup.position.x - dir.x, this.gunGroup.position.y - dir.y - 0.14, this.gunGroup.position.z - dir.z);
    this.gunGroup.rotateX(-g.pitch * 0.05);
    this.gunGroup.rotateZ(g.roll * 0.03);
    const sinceFire = t - sim.lastFire;
    const cock = sinceFire >= 0 && sinceFire < COCK_SECONDS ? sinceFire / COCK_SECONDS : 1;
    // Lever down and back up; the next cork is thumbed in near the end.
    this.lever.rotation.x = cock < 1 ? Math.sin(Math.min(1, cock * 1.25) * Math.PI) * 0.75 : 0;
    this.muzzleCork.visible = cock > 0.8 && sim.corksLeft > 0;
    this.gunGroup.visible = this.viewName === "player" || this.viewName === "gun";

    // ---- moths: a few always at the lamps; a swarm across the sights when a rival sends one.
    const mothsOn = t < sim.mothsUntil;
    const mothWarn = this.incoming.find((a) => a.type === "moths" && t < a.at);
    const want = mothsOn ? 1 : 0;
    this.mothAmount += (want - this.mothAmount) * (frozen ? 1 : Math.min(1, dt * 2.2));
    this.mothMat.uniforms.uTime.value = wall;
    this.mothMat.uniforms.uLight.value.setRGB(2.2 * B + 0.1, 1.5 * B + 0.12, 0.9 * B + 0.2);
    for (let i = 0; i < this.mothCount; i++) {
      const s = this.mothSeed[i];
      let x, y, z, size;
      if (i < 12) {
        // Circling a lamp.
        const lamp = i < 6 ? BULBS.key[(i * 3) % BULBS.key.length] : BULBS.festoon[(i * 2) % BULBS.festoon.length];
        const a = wall * (1.5 + s[0] * 2) + s[1] * 6.28;
        const r = 0.05 + s[2] * 0.09 + Math.sin(wall * 3 + s[3] * 9) * 0.02;
        x = lamp[0] + Math.cos(a) * r;
        y = lamp[1] + Math.sin(a * 1.7) * 0.05 - 0.01;
        z = lamp[2] + Math.sin(a) * r;
        size = 0.011 + s[3] * 0.006;
      } else {
        // The swarm gathers under the awning during the warning, then drifts across the sights.
        const gather = mothWarn ? Math.max(0, 1 - (mothWarn.at - t) / 1.5) : 0;
        const amt = Math.max(this.mothAmount, 0);
        const drift = wall * (0.25 + s[0] * 0.3) + s[1] * 10;
        const gx = (s[0] - 0.5) * 2.0 + Math.sin(drift * 2.1) * 0.25;
        const gy = 1.95 + s[1] * 0.12 + Math.sin(drift * 5) * 0.03;
        const sx = ((s[0] * 3 + wall * (0.12 + s[2] * 0.2)) % 1) * 2.6 - 1.3 + Math.sin(drift * 3.3) * 0.12;
        const sy = 1.0 + s[1] * 1.05 + Math.sin(drift * 2.7 + s[3] * 6) * 0.1;
        x = gx + (sx - gx) * amt;
        y = gy + (sy - gy) * amt;
        z = -0.85 + (-0.2 - s[2] * 1.0 + 0.85) * amt;
        size = (0.017 + s[3] * 0.012) * Math.min(1, Math.max(gather, amt) * 1.4);
      }
      this.mothPos.set([x, y, z, size], i * 4);
    }
    this.mothGeo.attributes.aPos.needsUpdate = true;

    // ---- chips of paint knocked off by a hit.
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!frozen) {
        p.life -= dt;
        p.v.y -= 9.8 * dt;
        p.p.addScaledVector(p.v, dt);
      }
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      e3.set(p.spin + p.life * 20, p.spin, 0);
      m4.compose(p.p, q.setFromEuler(e3), one);
      this.chipMesh.setMatrixAt(n, m4);
      this.chipMesh.setColorAt(n, p.c);
      n++;
    }
    this.chipMesh.count = n;
    this.chipMesh.instanceMatrix.needsUpdate = true;
    if (this.chipMesh.instanceColor) this.chipMesh.instanceColor.needsUpdate = true;

    // ---- the camera and its focus.
    this.updateCamera(dt, wall, frozen);
  }

  updateCamera(dt, wall, frozen) {
    const cam = this.camera;
    const aspect = this.aspect ?? 16 / 9;
    cam.aspect = aspect;
    let pos = CAMERA.pos;
    let look = CAMERA.look;
    let fov = Math.max(CAMERA.fov, THREE.MathUtils.radToDeg(2 * Math.atan(0.47 / aspect)));
    let focus = this.focusTarget;
    if (this.viewName === "wide") {
      pos = [0.9, 1.75, 2.6];
      look = [0, 1.45, -1.8];
      fov = 44;
      focus = 4.6;
    } else if (this.viewName === "mech") {
      pos = [-0.25, 1.38, -0.55];
      look = [-1.1, 1.12, -1.75];
      fov = 40;
      focus = 1.35;
    } else if (this.viewName === "far") {
      pos = [0.25, 1.78, -1.2];
      look = [0, 1.88, -2.6];
      fov = 44;
      focus = 1.42;
    } else if (this.viewName === "front") {
      pos = [0.5, 1.2, -0.75];
      look = [0.1, 1.14, -1.52];
      fov = 44;
      focus = 0.86;
    } else if (this.viewName === "gun") {
      pos = [0.42, 1.4, 0.6];
      look = [0.05, 1.28, -0.2];
      fov = 40;
      focus = 0.75;
    } else {
      // The aim's height picks the row the lens focuses on.
      const y = this.aimSoft.y;
      focus = y < 1.36 ? 2.36 : y < 1.72 ? 2.9 : 3.45;
      // The player leans a little with the aim.
      pos = [CAMERA.pos[0] + this.aimSoft.x * 0.035, CAMERA.pos[1] + (this.aimSoft.y - 1.3) * 0.02, CAMERA.pos[2]];
      look = [CAMERA.look[0] + this.aimSoft.x * 0.05, CAMERA.look[1] + (this.aimSoft.y - 1.3) * 0.05 - (aspect < 1 ? 0.12 : 0), CAMERA.look[2]];
    }
    cam.fov = fov;
    cam.position.set(pos[0], pos[1] + Math.sin(wall * 0.8) * 0.002, pos[2]);
    cam.lookAt(look[0], look[1], look[2]);
    cam.updateProjectionMatrix();
    this.focus = frozen ? focus : this.focus + (focus - this.focus) * Math.min(1, dt * 3.2);
  }

  /** Projects a stall point to 0..1 in this view (for the HUD's points and warnings). */
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [v.x * 0.5 + 0.5, 0.5 - v.y * 0.5];
  }

  /** The aim point on the front row's plane under a pointer at (u, v) in 0..1 of this view. */
  aimAt(u, v) {
    const ray = this._ray ?? (this._ray = new THREE.Raycaster());
    ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const k = (ROWS[0].z - ray.ray.origin.z) / ray.ray.direction.z;
    return [ray.ray.origin.x + ray.ray.direction.x * k, ray.ray.origin.y + ray.ray.direction.y * k];
  }
}

export { HALF_W, STEPS };
