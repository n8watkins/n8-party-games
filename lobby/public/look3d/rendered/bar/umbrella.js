// The umbrella on the wind outside the bar: a real one, not a picture of one. A dome of eight
// gores in red and cream with a scalloped hem, a shaft with a tip, and a crook handle, lit by the
// street and the bar's window. Its flight (where it is, how it leans and turns) is plain numbers
// in bar/street.js (umbrellaAt); this only builds it and poses it.
import * as THREE from "../../three.js";

const GORES = 8;
const RED = new THREE.Color(0xc8363e);
const CREAM = new THREE.Color(0xefe1c4);
/** How far down from its top the canopy reaches (radians on its sphere) and that sphere's radius, for a hem of radius 1. */
const REACH = 1.12;
const SPHERE = 1 / Math.sin(REACH);
/** The top of the canopy, over its hem. */
const TOP = SPHERE * (1 - Math.cos(REACH));

/** The canopy, one gore at a time so each keeps its own colour: its top at y = TOP, its hem at about y = 0. */
function canopy() {
  const pos = [];
  const nor = [];
  const col = [];
  const rings = 9;
  const steps = 6;
  const point = (a, t) => {
    const th = t * REACH;
    // Between two ribs the cloth sags in a little and its hem rides up: the scallops.
    const between = (1 - Math.cos(GORES * a)) / 2;
    const rho = SPHERE * Math.sin(th) * (1 - 0.07 * t * t * between);
    const y = SPHERE * Math.cos(th) - SPHERE * Math.cos(REACH) + 0.06 * t ** 4 * between;
    const n = new THREE.Vector3(Math.sin(th) * Math.cos(a), Math.cos(th), Math.sin(th) * Math.sin(a));
    return { p: [rho * Math.cos(a), y, rho * Math.sin(a)], n: [n.x, n.y, n.z] };
  };
  for (let g = 0; g < GORES; g++) {
    const c = g % 2 ? CREAM : RED;
    const a0 = (g / GORES) * Math.PI * 2;
    const da = (Math.PI * 2) / GORES / steps;
    for (let s = 0; s < steps; s++)
      for (let r = 0; r < rings; r++) {
        const [t0, t1] = [r / rings, (r + 1) / rings];
        const [aa, ab] = [a0 + s * da, a0 + (s + 1) * da];
        const quad = [point(aa, t0), point(ab, t0), point(ab, t1), point(aa, t0), point(ab, t1), point(aa, t1)];
        for (const v of quad) {
          pos.push(...v.p);
          nor.push(...v.n);
          // The cloth darkens toward the hem, where the light through it is less.
          const k = 1 - 0.18 * (v.p[1] < 0.15 ? 1 - v.p[1] / 0.15 : 0);
          col.push(c.r * k, c.g * k, c.b * k);
        }
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/**
 * The umbrella: {group, pose({x, y, z, lean, spin, nod, size}), dispose()}. The group's +y is its
 * shaft, from the handle up to the tip; `size` is the canopy's width in metres.
 */
export function buildUmbrella() {
  const group = new THREE.Group();
  const lean = new THREE.Group();
  const nod = new THREE.Group();
  const spin = new THREE.Group();
  group.add(lean);
  lean.add(nod);
  nod.add(spin);
  const cloth = canopy();
  const outside = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, toneMapped: false });
  // Inside, the cloth is in its own shadow, with the light coming through it warm.
  const inside = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.BackSide, color: 0x9a7a6a, emissive: 0x2a0e08, toneMapped: false });
  spin.add(new THREE.Mesh(cloth, outside), new THREE.Mesh(cloth, inside));
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a4422, toneMapped: false });
  const metal = new THREE.MeshLambertMaterial({ color: 0x4a4440, toneMapped: false });
  // The shaft runs from the tip down past the hem by a little more than the canopy's radius, as a real one does.
  const LONG = 1.95;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, LONG, 6), metal);
  shaft.position.y = TOP - LONG / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 6), metal);
  tip.position.y = TOP + 0.06;
  // The crook: a half ring at the foot of the shaft, and the grip above it.
  const crook = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.034, 6, 14, Math.PI), wood);
  crook.position.set(-0.11, TOP - LONG, 0);
  crook.rotation.z = Math.PI;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.22, 8), wood);
  grip.position.y = TOP - LONG + 0.11;
  spin.add(shaft, tip, crook, grip);
  // Its middle (where the flight puts it) is a little under the canopy, so it turns about where it would.
  spin.position.y = -0.3;
  return {
    group,
    pose({ x, y, z, lean: l, spin: s, nod: n, size }) {
      group.position.set(x, y, z);
      group.scale.setScalar(size / 2);
      lean.rotation.z = -l;
      nod.rotation.x = n;
      spin.rotation.y = s;
    },
    dispose() {
      cloth.dispose();
      for (const m of [outside, inside, wood, metal]) m.dispose();
      for (const o of [shaft, tip, crook, grip]) o.geometry.dispose();
    },
  };
}
