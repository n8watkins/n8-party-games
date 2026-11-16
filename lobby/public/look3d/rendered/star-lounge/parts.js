// The Star Lounge's own things inside the room, built round its rendered picture: the lamps
// (rendered cards that swing), the chart table and its globe of light, the lights that blink
// on the bench, and the rods the join sign and the Tonight board hang from.
//
// Shared by the party room (star-lounge/room.js), which drives them from the room's vote and
// its life, and the preview page (preview/star-lounge), which drives them from its stand-ins.
// Each builder adds its meshes with `add` and returns what can be set; nothing here decides.
import { boxCentre } from "../../../shared/world.js";
import { CAM, D_WALL, SPACE, U, wallX, wallY } from "../../space.js";
import * as THREE from "../../three.js";
import { beamMaterial, canvasTexture, card, seeded } from "../plate.js";

/** The names of the lights in the plate, in the order of the room picture's uniforms. */
export const LIGHTS = ["lamp0", "lamp1", "lamp2", "lamp3", "lamp4", "strips", "holo"];

/** The colours of the Star Lounge's numbers (lobby/tools/blender/star-lounge.json) as three.js colours. */
export const colours = (cfg) => ({ accent: new THREE.Color().setRGB(...cfg.accent), lamp: new THREE.Color().setRGB(...cfg.lampColour), pink: new THREE.Color(0xff5fb0) });

/** A beam of light from a lamp (rendered/plate.js: every rendered room's). */
export { beamMaterial };

/**
 * One lamp: its rendered card hung from a pivot in the ceiling (it swings about that), its glow,
 * its beam, and a real spot of light for the pieces under it. Returns {i, x, cx, pivot, card, halo, spot, beam}.
 * `depthTest`: whether the pieces hide what is behind them (the room: yes; the preview draws in one list: no).
 */
export function buildLamp(i, { plate, sheet, radial, colour, exposure, add, depthTest = false }) {
  const c = card(plate, `lamp${i}`, sheet, { depthTest, exposure });
  const x = plate.layout.poolX[i];
  const pivot = new THREE.Group();
  pivot.position.set(x, SPACE.h, SPACE.walkZ);
  c.mesh.position.x -= x;
  c.mesh.position.y -= SPACE.h;
  c.mesh.position.z = 0;
  c.mesh.renderOrder = 6;
  pivot.add(c.mesh);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radial, color: colour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest }));
  halo.position.set(0, SPACE.lampY - SPACE.h - 0.02, 0.02);
  halo.renderOrder = 7;
  pivot.add(halo);
  add(pivot);
  const radius = plate.layout.poolR + 0.04;
  const spot = new THREE.SpotLight(colour, 0, 0, Math.atan((radius + 0.1) / SPACE.lampY), 0.4, 0);
  spot.position.set(x, SPACE.lampY, SPACE.walkZ);
  spot.target.position.set(x, 0, SPACE.walkZ);
  add(spot);
  add(spot.target);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, radius, SPACE.lampY, 40, 1, true), beamMaterial(colour, { depthTest }));
  beam.position.set(x, SPACE.lampY / 2, SPACE.walkZ);
  beam.renderOrder = 5;
  add(beam);
  return { i, x, cx: boxCentre(i, plate.boxes), pivot, card: c, halo, spot, beam };
}

/**
 * A lamp at a level of light: `glow` 0 to 1 (how much its tube burns), `k` how much light it gives,
 * `swing` its angle on its cord. Sets everything of it but its share of the room's picture,
 * which the caller sets (it is one uniform of the room picture: shell.uGain).
 */
export function setLamp(lamp, { glow, k, level, swing, spot = 5, beam = 1 }) {
  lamp.pivot.rotation.z = swing;
  lamp.card.mat.uniforms.uOwn.value = lamp.card.c.ownGain * (0.06 + k) * 0.7;
  lamp.spot.intensity = spot * k;
  lamp.spot.position.x = lamp.x - Math.sin(swing) * (SPACE.h - SPACE.lampY);
  lamp.beam.material.uniforms.uStrength.value = (0.07 * glow + 0.08 * level) * beam;
  lamp.beam.visible = level > 0.002;
  lamp.beam.rotation.z = swing * 0.5;
  lamp.halo.material.opacity = 0.1 + (0.28 + 0.4 * Math.min(level, 1.3)) * glow;
  lamp.halo.scale.setScalar(0.9 + level * 0.9);
}

/**
 * The chart table: its rendered card, and over it a globe of light drawn live, with a little copy
 * of the planet and its ring, the cone it stands in, a glow and the sparks it throws.
 * Returns the holo, to be run with runHolo and set off with strikeHolo.
 */
export function buildHolo({ plate, cfg, sheet, radial, exposure, add, depthTest = false }) {
  const { accent } = colours(cfg);
  const c = card(plate, "table", sheet, { depthTest, exposure });
  c.mesh.renderOrder = -30;
  add(c.mesh);
  const h = cfg.holo;
  const group = new THREE.Group();
  group.position.set(h.x, h.y, h.z);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: accent.clone() }, uTime: { value: 0 }, uPower: { value: 1 } },
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
  // (A material's side must be one of three.js's sides: an undefined one makes it warn on every open.)
  const glowMat = (colour, opacity, side = THREE.FrontSide) => new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, side });
  const core = new THREE.Mesh(new THREE.SphereGeometry(h.r * 0.36, 20, 12), glowMat(accent, 0.55));
  core.renderOrder = -29;
  const orbit = new THREE.Mesh(new THREE.RingGeometry(h.r * 0.52, h.r * 0.74, 48), glowMat(accent, 0.4, THREE.DoubleSide));
  orbit.rotation.x = Math.PI / 2 - 0.35;
  orbit.renderOrder = -29;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(h.r * 0.95, 0.36, h.y - 1.0, 32, 1, true), beamMaterial(accent, { depthTest }));
  cone.material.uniforms.uStrength.value = 0.22;
  cone.position.y = -(h.y - 1.0) / 2;
  cone.renderOrder = -29;
  group.add(cone, core, orbit, globe);
  add(group);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: radial, color: accent, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, depthTest }));
  glow.position.set(h.x, h.y, h.z - 0.3);
  glow.renderOrder = -31;
  add(glow);
  const count = 46;
  const sparks = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3)),
    new THREE.PointsMaterial({ map: radial, color: 0xffffff, size: 0.11, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest }),
  );
  sparks.frustumCulled = false;
  sparks.renderOrder = -27;
  add(sparks);
  return { cfg: h, card: c, group, globe, core, orbit, cone, glow, mat, sparks, vel: new Float32Array(count * 3), spin: 0.5, heat: 0, struck: -10, accent, pink: colours(cfg).pink, colour: accent.clone() };
}

/**
 * One frame of the chart: it turns, and for a few seconds after it is set off it spins up, turns
 * pink, flickers and throws sparks. `tint` is the room picture's tint for the chart's light
 * (a Color, set here), and the returned number its gain, as a share of the plate's own.
 * `calm`: the device asked for less motion (it still changes colour, but throws nothing).
 */
export function runHolo(h, t, dt, tint, calm = false) {
  const since = t - h.struck;
  const hot = since >= 0 && since < 4.5 ? Math.max(0, 1 - since / 4.5) : 0;
  h.heat += (hot - h.heat) * Math.min(1, dt * 6);
  h.spin += (0.5 + hot * (calm ? 2 : 13) - h.spin) * Math.min(1, dt * 3);
  h.globe.rotation.y += h.spin * dt;
  h.orbit.rotation.z += h.spin * dt * 0.6;
  h.colour.copy(h.accent).lerp(h.pink, Math.min(1, h.heat * 1.6));
  const jitter = h.heat > 0.05 && !calm ? (Math.sin(t * 80) * Math.sin(t * 37) > 0.4 ? 0.55 : 1) : 1;
  const breathe = 0.92 + 0.08 * Math.sin(t * 1.7);
  h.mat.uniforms.uColor.value.copy(h.colour);
  h.mat.uniforms.uTime.value = t;
  h.mat.uniforms.uPower.value = (0.5 + h.heat * 0.6) * jitter * breathe;
  h.core.material.color.copy(h.colour);
  h.orbit.material.color.copy(h.colour);
  h.cone.material.uniforms.uColor.value.copy(h.colour);
  h.glow.material.color.copy(h.colour);
  h.glow.material.opacity = (0.1 + 0.25 * h.heat) * jitter * breathe;
  h.group.scale.setScalar(1 + (calm ? 0 : 0.12 * h.heat * Math.sin(t * 30)));
  const power = (0.75 + 1.4 * h.heat) * jitter * breathe;
  // The chart's layer was rendered in its resting colour; this turns that colour into the one it has now.
  tint.setRGB(h.colour.r / h.accent.r, h.colour.g / h.accent.g, h.colour.b / h.accent.b);
  h.card.mat.uniforms.uOwn.value = h.card.c.ownGain * power;
  h.card.mat.uniforms.uTint.value.copy(tint);
  const pos = h.sparks.geometry.attributes.position;
  if (since >= 0 && since < 1.6 && !calm) {
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
  return { power, hot: h.heat > 0.02 || (since >= 0 && since < 4.5) };
}

/** Sets the chart off at time t (seconds): it spins up and throws sparks. `rnd` a source of numbers. */
export function strikeHolo(h, t, rnd = Math.random) {
  h.struck = t;
  const pos = h.sparks.geometry.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const a = rnd() * 6.28;
    const s = 1.2 + rnd() * 2.6;
    pos.array.set([h.cfg.x, h.cfg.y, h.cfg.z + 0.3], k * 3);
    h.vel.set([Math.cos(a) * s, Math.sin(a) * s * 0.8 + 1.4, (rnd() - 0.3) * 1.5], k * 3);
  }
}

/** The lights on the bench under the window that blink, three at each post: one drawing for all. */
export function buildBlinks({ gaps, add, depthTest = false }) {
  const xs = [-SPACE.w / 2 + 0.09, ...gaps, SPACE.w / 2 - 0.09];
  const count = 3 * xs.length;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const info = new Float32Array(count * 2);
  const rnd = seeded(3);
  let n = 0;
  for (const x of xs)
    for (const y of [0.74, 0.8, 0.86]) {
      pos.set([x, y, SPACE.zBack + 0.35], n * 3);
      info.set([0.5 + rnd() * 2.2, rnd() * 6.28], n * 2);
      n++;
    }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("info", new THREE.BufferAttribute(info, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `attribute vec2 info; uniform float uTime; uniform float uPx; varying vec3 vC;
      void main(){ float on = step(0.0, sin(uTime * info.x + info.y)); float red = step(0.72, fract(info.y * 3.7));
        vC = mix(vec3(0.3, 0.9, 1.0), vec3(1.0, 0.3, 0.3), red) * (0.25 + 0.75 * on);
        gl_PointSize = 5.0 * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vC * smoothstep(1.0, 0.2, d), 1.0); }`,
  });
  const blinks = new THREE.Points(geo, mat);
  blinks.frustumCulled = false;
  blinks.renderOrder = -39;
  add(blinks);
  return blinks;
}

/** A rectangle laid out on the back wall (in world units), as it is at depth z: nearer, so drawn smaller to cover the same place. */
export const onWall = (xw, yw, ww, hw, z) => {
  const k = (CAM.z - z) / D_WALL;
  return { x: (wallX(xw) + ww / U / 2) * k, y: CAM.y + (wallY(yw) - hw / U / 2 - CAM.y) * k, z, w: (ww / U) * k, h: (hw / U) * k };
};

/** Many flat rectangles facing the room, as one geometry (one drawing however many): each is {x, y, z, w, h} in metres. */
export function quads(rects) {
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

/** Two rods from the beam over the window down to a hung screen at (xw, topYw), `ww` wide (world units): rectangles for `rodsMesh`. */
export function rodRects(plate, xw, ww, topYw) {
  const beam = (6.25 - plate.layout.head) * U - 2;
  return [xw + ww * 0.2, xw + ww * 0.8].map((x) => onWall(x - 2, beam, 4, topYw - beam + 4, SPACE.zBack + 0.42));
}

/** The rods the hung screens hang from, as one drawing. */
export function rodsMesh(rects, { depthTest = false } = {}) {
  const tex = canvasTexture(8, 4, (g, w, h) => {
    const metal = g.createLinearGradient(0, 0, w, 0);
    metal.addColorStop(0, "#111724");
    metal.addColorStop(0.45, "#77849c");
    metal.addColorStop(1, "#161d2c");
    g.fillStyle = metal;
    g.fillRect(0, 0, w, h);
  });
  const m = new THREE.Mesh(quads(rects), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest }));
  m.renderOrder = -41;
  m.frustumCulled = false;
  return m;
}

/**
 * The shine on the screens' glass: a soft slanted band of light, one drawing for all of them. It
 * slides as the eye moves (uEye), which is what makes the glass read as glass.
 */
export function sheensMesh(rects, { depthTest = false } = {}) {
  const tex = canvasTexture(256, 256, (g, w, h) => {
    const band = g.createLinearGradient(0, h, w, 0);
    band.addColorStop(0.3, "rgba(255,255,255,0)");
    band.addColorStop(0.47, "rgba(190,220,255,.16)");
    band.addColorStop(0.53, "rgba(220,235,255,.26)");
    band.addColorStop(0.6, "rgba(190,220,255,.06)");
    band.addColorStop(0.75, "rgba(255,255,255,0)");
    g.fillStyle = band;
    g.fillRect(0, 0, w, h);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(
    quads(rects),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest,
      uniforms: { uMap: { value: tex }, uEye: { value: 0 } },
      // Each screen shows the part of the band of light that its place, and the eye's, give it.
      vertexShader: `attribute float mid; uniform float uEye; varying vec2 vUv;
        void main(){ vUv = uv * 0.5 + vec2(0.25 + clamp((mid - uEye) * 0.07, -0.25, 0.25), 0.25); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(uMap, vUv);
        #include <colorspace_fragment>
        }`,
    }),
  );
  m.renderOrder = -38;
  m.frustumCulled = false;
  return m;
}
