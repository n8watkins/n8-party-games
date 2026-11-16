// Small pieces the slime's and the robot's models share (./slime.js, ./robot.js): a spring, shapes
// merged into one, a box with round edges, a blink, and a bent tube for an arm. Nothing here knows
// a character; the pawn and the ghost keep their own copies, as they were approved.
import * as THREE from "./three.js";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** One step of a damped spring: returns [value, velocity]. */
export function spring(value, velocity, target, stiffness, damping, dt) {
  velocity += ((target - value) * stiffness - velocity * damping) * dt;
  return [value + velocity * dt, velocity];
}

/** A blink now and then, different for each seat: 0 open, 1 shut. */
export function blinkAt(now, seed, every = 3600) {
  const t = (now + seed * 977) % every;
  return t < 130 ? Math.sin((t / 130) * Math.PI) : 0;
}

/**
 * Shapes put together as one, so they are one draw: [geometry, matrix, colour?] each. With
 * colours, every point carries its part's colour (`color`), and `paint` marks the points that
 * take the player's colour (1) rather than a fixed one (0).
 */
export function merged(parts, coloured = false) {
  const pos = [];
  const nor = [];
  const col = [];
  const paint = [];
  for (const [geo, matrix, colour] of parts) {
    const g = geo.toNonIndexed().applyMatrix4(matrix);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (coloured) {
      const c = colour === "paint" ? null : new THREE.Color(colour);
      for (let i = 0; i < g.attributes.position.count; i++) {
        col.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
        paint.push(c ? 0 : 1);
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  if (coloured) {
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    // Which points are paint, for the shader too (pointLitMat's tint).
    out.setAttribute("paint", new THREE.Float32BufferAttribute(paint, 1));
    out.userData.paint = Float32Array.from(paint);
    out.userData.fixed = Float32Array.from(col);
  }
  return out;
}

/** Writes the player's colour into the points of a merged shape that take it; the rest keep their own. */
export function paintPoints(geo, colour) {
  const cols = geo.attributes.color;
  const { paint, fixed } = geo.userData;
  for (let i = 0; i < cols.count; i++) {
    if (paint[i]) cols.setXYZ(i, colour.r, colour.g, colour.b);
    else cols.setXYZ(i, fixed[i * 3], fixed[i * 3 + 1], fixed[i * 3 + 2]);
  }
  cols.needsUpdate = true;
}

/** A box with round edges and corners (radius r), centred on the origin. */
export function roundedBox(w, h, d, r, seg = 3) {
  const geo = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const half = [w / 2 - r, h / 2 - r, d / 2 - r];
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(clamp(v.x, -half[0], half[0]), clamp(v.y, -half[1], half[1]), clamp(v.z, -half[2], half[2]));
    v.sub(inner);
    const len = v.length();
    if (len > 1e-6) v.multiplyScalar(1 / len);
    else v.fromBufferAttribute(n, i);
    n.setXYZ(i, v.x, v.y, v.z);
    p.setXYZ(i, inner.x + v.x * r, inner.y + v.y * r, inner.z + v.z * r);
  }
  return geo;
}

/**
 * A material in the room's toy style whose glow follows its points' own colours (three.js gives
 * every point of a shape the same glow): so a robot's dark parts stay dark in the dark while its
 * paint glows a little, as a pawn's does.
 *
 * Its paint (the points merged() marks `paint`) can be tinted toward a colour: `tintPaint(mat,
 * colour, k, glow)` mixes the paint's lit colour `k` of the way to `colour`, and its glow `glow`
 * of the way, as a pawn's `mat.color.lerp(colour, k)` does to its whole body. The fixed parts (a
 * robot's dark base and visor) keep their own colours. Tinting `mat.color` instead would multiply
 * the tint by the paint: red on blue paint is near black.
 */
export function pointLitMat(opts, key) {
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, ...opts });
  const tint = { value: new THREE.Vector4(1, 1, 1, 0) };
  const glow = { value: 0 };
  mat.userData.tint = tint;
  mat.userData.glow = glow;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.paintTint = tint;
    shader.uniforms.paintGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float paint;\nvarying float vPaint;")
      .replace("#include <color_vertex>", "#include <color_vertex>\n vPaint = paint;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec4 paintTint;\nuniform float paintGlow;\nvarying float vPaint;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, paintTint.rgb, paintTint.a * vPaint);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance *= mix(vColor.rgb, paintTint.rgb, paintGlow * vPaint);");
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Tints a pointLitMat's paint toward `colour` (a THREE.Color): `k` of its lit colour, `glow` of its glow (0: its own paint). */
export function tintPaint(mat, colour, k, glow = 0) {
  mat.userData.tint.value.set(colour.r, colour.g, colour.b, k);
  mat.userData.glow.value = glow;
}

/** How far a pointLitMat's paint is tinted now, and toward what: {r, g, b, k, glow}. */
export function paintTintOf(mat) {
  const v = mat.userData.tint.value;
  return { r: v.x, g: v.y, b: v.z, k: v.w, glow: mat.userData.glow.value };
}

/** How many rings and sides an arm's tube has. */
const RINGS = 10;
const SIDES = 8;

/** The shape of a bent tube, for an arm made each frame (tube below). */
export function tubeGeometry() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3));
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

const P = new THREE.Vector3();
const T = new THREE.Vector3();
const N = new THREE.Vector3();
const B = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Bends a tube along a curve: `at(u, P, T)` writes the point `u` of the way along (0 to 1) and the
 * direction there, and `half(u)` is the tube's half width there. Its normals are worked out after.
 */
export function tube(geo, at, half) {
  const pos = geo.attributes.position;
  for (let i = 0; i < RINGS; i++) {
    const u = i / (RINGS - 1);
    at(u, P, T);
    T.normalize();
    N.crossVectors(T, Z);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
    N.normalize();
    B.crossVectors(T, N).normalize();
    const r = half(u);
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      pos.setXYZ(i * SIDES + j, P.x + N.x * c + B.x * s, P.y + N.y * c + B.y * s, P.z + N.z * c + B.z * s);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}
