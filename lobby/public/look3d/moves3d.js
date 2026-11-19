// The robot's hook in the 3D look (and the baked and made-real looks, which draw their pieces through
// it): the line of light along the floor while it winds up (the tell), a chain of steel links from
// the robot's chest to the hook, and the hook itself. Where everything is comes from the shared
// numbers (lobby/shared/robot.js, hookDrawn), as the flat look's move-draw.js does; the legs and the
// slime's harden and absorb are drawn by the bodies themselves (./robot.js, ./slime.js).
//
// Cost: nothing while no hook is out. A hook out is three draws (the line, the chain as one
// instanced mesh, the hook); nothing is made per frame.
import * as THREE from "./three.js";
import { HOOK_HAND, HOOK_RANGE } from "../shared/robot.js";
import { PX, SPACE, walkX } from "./space.js";

const STEEL = new THREE.Color("#c3cad6");
const GLOW = new THREE.Color("#ffe2a8");
/** Where the chain leaves the robot: the plate on its chest (world units above the floor). */
const CHEST = 52;
/** One link every this far (metres), and the most a chain has. */
const LINK = 0.032;
const LINKS = 90;
/** In front of the pieces' middles, so the chain reads over a body it reaches past. */
const Z = SPACE.walkZ + 0.16;

let shapes = null;
function makeShapes() {
  // The hook: a curl of steel with a straight shank to the chain.
  const curl = new THREE.TorusGeometry(0.034, 0.009, 6, 16, Math.PI * 1.35);
  curl.rotateZ(-Math.PI * 0.85);
  curl.translate(0.034, -0.03, 0);
  const shank = new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8);
  shank.rotateZ(Math.PI / 2);
  shank.translate(0.0, 0.0, 0);
  return {
    link: new THREE.TorusGeometry(0.014, 0.0048, 5, 10),
    curl,
    shank,
    plane: new THREE.PlaneGeometry(1, 1),
  };
}

const at = new THREE.Object3D();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const D = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Q = new THREE.Quaternion();

export class Hooks3D {
  /** @param {THREE.Object3D} parent  where the hooks go (the room's cast) */
  constructor(parent) {
    shapes ??= makeShapes();
    this.parent = parent;
    this.hooks = new Map();
    this.steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.28, metalness: 0.75, emissive: 0x2a2e36, emissiveIntensity: 0.9 });
  }

  /**
   * One robot's hook for this frame: `drawn` from hookDrawn (null: put away), `x` where the robot
   * is drawn, `lift` how far its legs hold it up (world units), `colour` its player's ("#rrggbb":
   * the tell is drawn in it).
   */
  hook(seat, drawn, x, dir, lift = 0, colour = null) {
    let h = this.hooks.get(seat);
    if (!drawn) {
      if (h) {
        this.parent.remove(h.group);
        h.aim.material.dispose();
        this.hooks.delete(seat);
      }
      return false;
    }
    if (!h) {
      const group = new THREE.Group();
      const aim = new THREE.Mesh(shapes.plane, new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false }));
      aim.rotation.x = -Math.PI / 2;
      aim.renderOrder = 3;
      const chain = new THREE.InstancedMesh(shapes.link, this.steel, LINKS);
      chain.frustumCulled = false;
      const head = new THREE.Group();
      head.add(new THREE.Mesh(shapes.curl, this.steel), new THREE.Mesh(shapes.shank, this.steel));
      group.add(aim, chain, head);
      this.parent.add(group);
      h = { group, aim, chain, head };
      this.hooks.set(seat, h);
    }
    // The tell: a bold band along the floor as far as the hook reaches, in the robot's colour made
    // bright, pulsing: at phone size it reads as a hook coming, never as a kick's wind-up.
    const reach = (HOOK_HAND + HOOK_RANGE) * PX;
    h.aim.visible = drawn.aim > 0;
    if (h.aim.visible) {
      if (colour && h.colour !== colour) {
        h.colour = colour;
        h.aim.material.color.set(colour).lerp(GLOW, 0.35);
      }
      h.aim.material.opacity = 0.35 + drawn.aim * 0.55;
      h.aim.position.set(walkX(x) + (dir * reach) / 2, 0.014, SPACE.walkZ);
      h.aim.scale.set(reach, 0.16, 1);
    }
    // The chain, link by link, from its chest to the hook.
    A.set(walkX(x + dir * 20), (CHEST + lift) * PX, Z);
    B.set(walkX(drawn.tip), drawn.y * PX, Z);
    D.subVectors(B, A);
    const len = drawn.state === "aim" ? 0 : D.length();
    const n = Math.min(LINKS, Math.floor(len / LINK));
    h.chain.count = n;
    if (n > 0) {
      D.normalize();
      const q = Q.setFromUnitVectors(X_AXIS, D);
      for (let i = 0; i < n; i++) {
        at.position.copy(A).addScaledVector(D, (i + 0.5) * LINK);
        at.quaternion.copy(q);
        // Every other link turned a quarter round its length: a chain, not a row of rings.
        if (i % 2) at.rotateX(Math.PI / 2);
        at.scale.set(1.35, 1, 1);
        at.updateMatrix();
        h.chain.setMatrixAt(i, at.matrix);
      }
      h.chain.instanceMatrix.needsUpdate = true;
    }
    h.head.visible = drawn.state !== "aim";
    h.head.position.copy(B);
    // Turned to face the way it flies (a turn, not a mirror, so its faces stay the right way out).
    h.head.rotation.y = dir < 0 ? Math.PI : 0;
    return true;
  }

  clear() {
    for (const seat of [...this.hooks.keys()]) this.hook(seat, null);
  }

  dispose() {
    this.clear();
    this.steel.dispose();
  }
}
