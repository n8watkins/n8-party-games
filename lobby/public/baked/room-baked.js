// The baked look: the bar as a rendered picture, with only the moving things drawn live.
//
// The 3D look's camera never moves (look3d/space.js), so the room itself does not have to be
// drawn every frame at all: it can be one picture, rendered offline from that same camera with
// real light, soft shadows and haze (landing/tools/blender/room.py, the shots named plate-*).
// This look puts that picture behind the pieces and draws live only what changes:
//
//   - The lamps. The plate is a base picture with no game lamp on, plus one picture per lamp of
//     only what that lamp adds. Light adds up, so the page adds them in a small shader with one
//     number per lamp, and any combination of lamps on, off and brighter is right.
//   - The posters, signs, join code and Tonight board, which are data: the plate's frames are
//     empty and the live ones sit in them.
//   - The pieces, lit to match: a key light per pool, the room's own surroundings for their
//     shine, a shadow that leans away from the nearest lit lamp, and a faint reflection in the floor.
//   - The room's life (look3d/life.js), over the plate.
//
// It is the 3D look with its room swapped for a picture, and it is built that way: everything
// that decides how a piece stands and moves is still look3d/pieces.js, called and not copied,
// so a change to the bump there arrives here for free.
//
// The plate is made for one wall (plate.json says how many boxes). A room with a different
// number of boxes, or a device where the plate does not load, gets the 3D look drawn as it is.
import { boxCentre } from "../shared/world.js";
import { boxArt, boxSide } from "../look3d/paint.js";
import { Room3D } from "../look3d/room3d.js";
import { SKINS } from "../look3d/skins.js";
import { CAM, D_WALL, FRAME, PX, SPACE, U, walkX, wallX, wallY } from "../look3d/space.js";
import * as THREE from "../look3d/three.js";

const HERE = new URL("./bar/", import.meta.url);

/** The bar, with the jukebox kept and everything else of its life as it is. */
const SKIN = SKINS.bar;

function loadTexture(file, { srgb = true, mips = true } = {}) {
  return new Promise((done, fail) => {
    new THREE.TextureLoader().load(
      new URL(file, HERE).href,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.generateMipmaps = mips;
        t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        done(t);
      },
      undefined,
      () => fail(new Error(`the plate's ${file} did not load`)),
    );
  });
}

/** Everything the plate is made of, loaded together: {info, base, lamps, env, juke}. */
async function loadPlate(renderer) {
  const info = await (await fetch(new URL("plate.json", HERE))).json();
  // The big base picture where the screen can show it and the device can hold it; the smaller one otherwise.
  const sharp = Math.max(screen.width, screen.height) * Math.min(window.devicePixelRatio || 1, 2) > 2100 && renderer.capabilities.maxTextureSize >= 4096;
  const [base, env, juke, ...lamps] = await Promise.all([
    loadTexture(sharp ? info.base.large : info.base.small),
    loadTexture(info.env, { mips: false }),
    loadTexture(info.juke.file),
    ...info.lamps.map((file) => loadTexture(file)),
  ]);
  base.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  env.mapping = THREE.EquirectangularReflectionMapping;
  return { info, base, lamps, env, juke };
}

/**
 * The plate: the base picture and what each lamp adds, summed as light and then given the same
 * film curve as the live pieces, so the two sit in one picture.
 */
function plateMaterial(plate) {
  const n = plate.lamps.length;
  return new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uBase: { value: plate.base },
      uLamps: { value: plate.lamps },
      uGain: { value: new Array(n).fill(0) },
      uGold: { value: new Array(n).fill(0) },
      uGoldTint: { value: new THREE.Color(1.0, 0.72, 0.34) },
      uExposure: { value: plate.info.exposure ?? 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uBase; uniform sampler2D uLamps[${n}]; uniform float uGain[${n}]; uniform float uGold[${n}]; uniform vec3 uGoldTint; uniform float uExposure;
      varying vec2 vUv;
      void main(){
        vec2 uv = clamp(vUv, 0.0, 1.0);
        vec3 sum = texture2D(uBase, uv).rgb;
        ${Array.from({ length: n }, (_, i) => `sum += texture2D(uLamps[${i}], uv).rgb * uGain[${i}] * mix(vec3(1.0), uGoldTint * 1.25, uGold[${i}]);`).join("\n        ")}
        // Past the picture's edge the room carries on as darkness, not as a smear of its last row.
        vec2 out2 = abs(vUv - 0.5) - 0.5;
        float past = max(out2.x, out2.y);
        sum *= 1.0 - smoothstep(0.0, 0.12, past);
        // The corners of the room fall away a little, as they do in the hero picture.
        vec2 c = (uv - vec2(0.5, 0.46)) * vec2(1.0, 1.25);
        sum *= 1.0 - 0.55 * smoothstep(0.28, 0.75, length(c));
        gl_FragColor = vec4(sum * uExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A lamp's beam, drawn faintly over the pieces: a piece standing in a pool is inside the light, not in front of a picture of it. */
const beamMaterial = (color) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float along = smoothstep(0.0, 0.06, vH) * smoothstep(1.0, 0.55, vH);
        gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
  });

export class RoomBaked extends Room3D {
  /**
   * Starts the baked look in `root`. Throws when the device cannot draw it or the plate does
   * not arrive, so the page can fall back to the 3D look.
   */
  static async open(root, opts) {
    const view = await super.open(root, { ...opts, skin: "bar" });
    try {
      view.plate = await loadPlate(view.renderer);
    } catch (err) {
      view.destroy();
      throw err;
    }
    view.dressRoom();
    return view;
  }

  constructor(...args) {
    super(...args);
    this.look = "baked";
    this.el.classList.add("baked");
    this.plain = false;
    this.mirror = new THREE.Group();
    this.scene.add(this.mirror);
    // The pieces are lit and dressed for the plate just before each picture is drawn, after
    // look3d has posed them (this is the one hook: nothing of the pose is repeated here).
    this.scene.onBeforeRender = () => this.dressPieces();
    window.__roomBaked = this;
  }

  /** Once the plate is here: the room's light for the pieces, in place of the 3D look's three plain lights. */
  dressRoom() {
    for (const o of this.scene.children) {
      if (o.isHemisphereLight) o.intensity = 0.13;
      else if (o.isDirectionalLight) o.intensity = o.position.y > 8 ? 0 : 0.2; // the overhead lamp goes: each pool has its own now
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromEquirectangular(this.plate.env).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.3;
  }

  build(room) {
    // The plate is one wall. Another number of boxes is drawn by the 3D look as it stands.
    this.plain = room.boxes.length !== this.plate.info.boxes;
    this.el.classList.toggle("baked-plain", this.plain);
    this.spots = [];
    this.beams = [];
    super.build(room);
    if (!this.plain) this.jukebox();
  }

  // ---------------------------------------------------------------- the room, as a picture

  shell(L) {
    if (this.plain) return super.shell(L);
    const { x0, y0, x1, y1 } = this.plate.info.rect;
    // The picture was taken from the camera's own place, so it can hang at any depth: here on
    // the back wall's plane, with room all round it for screens of other shapes.
    const [w, h] = [(x1 - x0) / U, (y1 - y0) / U];
    const pad = 1.5;
    const geo = new THREE.PlaneGeometry(w * (1 + 2 * pad), h * (1 + 2 * pad));
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * (1 + 2 * pad) + 0.5, (uv.getY(i) - 0.5) * (1 + 2 * pad) + 0.5);
    this.plateMat = plateMaterial(this.plate);
    const mesh = new THREE.Mesh(geo, this.plateMat);
    mesh.position.set(wallX((x0 + x1) / 2), wallY((y0 + y1) / 2), SPACE.zBack);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    this.stuff.add(mesh);
    // The 3D look works its pools out in the floor's shader; here they are in the plate, and this stands in for that floor.
    this.floor = { material: { uniforms: { uPools: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 1, 0)) } } } };
    this.frameMat = new THREE.MeshBasicMaterial({ color: SKIN.frame });
    this.goldMat = new THREE.MeshBasicMaterial({ color: SKIN.accent });
  }

  doorway(L) {
    if (this.plain) super.doorway(L);
  }

  /** The string of bulbs is in the picture; what is added here is only the soft glow round each, which a camera would see. */
  bulbs() {
    if (this.plain) return super.bulbs();
    const n = 29;
    const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: this.radial, color: 0xffc27a, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false }), n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      o.position.set((t - 0.5) * (SPACE.w - 0.5), 5.6 + Math.pow(((t * 4) % 1) - 0.5, 2) * 1.25, SPACE.zBack + 0.5);
      o.updateMatrix();
      glows.setMatrixAt(i, o.matrix);
    }
    glows.renderOrder = -6;
    this.stuff.add(glows);
  }

  /** One game box: its poster in the plate's empty frame, its gold edge, and the light its lamp gives the pieces. */
  box(box, i, L) {
    if (this.plain) return super.box(box, i, L);
    const b = { box, i, cx: boxCentre(i, L.n), level: 0, aim: 0, gold: 0, goldAim: 0, shown: -1 };
    const x = walkX(b.cx);
    const z = SPACE.walkZ;
    const radius = (this.half + 12) * PX;
    b.pool = new THREE.Vector4(x, z, radius, 0);
    // The lamp itself is in the picture and cannot swing; the room's life is given a still stand-in to turn.
    b.lamp = { swing: new THREE.Group() };

    // What the lamp does to a piece under it: a real cone of light from where the lamp hangs.
    const spot = new THREE.SpotLight(SKIN.light, 0, 0, Math.atan((radius + 0.1) / SPACE.lampY), 0.35, 0);
    spot.position.set(x, SPACE.lampY, z);
    spot.target.position.set(x, 0, z);
    this.stuff.add(spot, spot.target);
    b.spot = spot;
    b.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, radius, SPACE.lampY, 40, 1, true), beamMaterial(SKIN.light));
    b.beam.position.set(x, SPACE.lampY / 2, z);
    b.beam.renderOrder = 6;
    this.stuff.add(b.beam);
    // The glow round a lamp that is on.
    b.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.radial, color: SKIN.light, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.halo.position.set(x, SPACE.lampY + 0.04, z + 0.05);
    this.stuff.add(b.halo);

    // On the wall: the poster as a box in the frame, and the frame's gold face for the box that leads.
    const g = new THREE.Group();
    g.position.set(L.xs[i], L.by, SPACE.zBack);
    const tex = new THREE.CanvasTexture(boxArt(box, this.images));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    b.art = new THREE.MeshBasicMaterial({ map: tex });
    b.side = new THREE.MeshBasicMaterial({ color: new THREE.Color(boxSide(box)).multiplyScalar(0.5) });
    // Two draws a poster: the box's sides as one mesh, and its printed front as another.
    const carton = new THREE.Mesh(new THREE.BoxGeometry(L.bw, L.bh, 0.3), b.side);
    carton.position.z = 0.2;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(L.bw, L.bh), b.art);
    front.position.z = 0.351;
    g.add(carton, front);
    const [nw, nh] = [L.bw + FRAME.gap * 2, L.bh + FRAME.gap * 2];
    const bar = FRAME.bar;
    b.goldFace = new THREE.MeshBasicMaterial({ color: new THREE.Color(SKIN.accent).multiplyScalar(1.5), transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Shape();
    ring.moveTo(-nw / 2 - bar, -nh / 2 - bar).lineTo(nw / 2 + bar, -nh / 2 - bar).lineTo(nw / 2 + bar, nh / 2 + bar).lineTo(-nw / 2 - bar, nh / 2 + bar).closePath();
    const hole = new THREE.Path();
    hole.moveTo(-nw / 2, -nh / 2).lineTo(-nw / 2, nh / 2).lineTo(nw / 2, nh / 2).lineTo(nw / 2, -nh / 2).closePath();
    ring.holes.push(hole);
    b.goldMesh = new THREE.Mesh(new THREE.ShapeGeometry(ring), b.goldFace);
    b.goldMesh.position.z = FRAME.depth + 0.002;
    b.goldMesh.visible = false;
    g.add(b.goldMesh);
    b.glow = new THREE.Mesh(new THREE.PlaneGeometry(nw + 1.6, nh + 1.6), new THREE.MeshBasicMaterial({ map: this.radial, color: SKIN.accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.glow.position.z = FRAME.depth + 0.004;
    b.glow.visible = false;
    g.add(b.glow);
    this.stuff.add(g);
    return b;
  }

  /** Sets a box's lamp for its level of light (0 is off): in the plate, on the poster, and on the pieces under it. */
  light(b) {
    if (this.plain) return super.light(b);
    const level = b.level;
    const glowing = Math.min(1, level * 8);
    const gain = (this.plate.info.lampGain ?? 2.83) * (0.3 * glowing + 0.7 * level);
    const u = this.plateMat.uniforms;
    u.uGain.value[b.i] = gain;
    u.uGold.value[b.i] = b.gold;
    b.spot.intensity = 4.6 * (0.3 * glowing + 0.7 * level);
    b.spot.visible = level > 0.002;
    b.spot.color.set(SKIN.light).lerp(new THREE.Color(SKIN.accent), b.gold * 0.6);
    b.beam.material.uniforms.uStrength.value = 0.05 * glowing + 0.05 * level;
    b.beam.visible = level > 0.002;
    b.halo.visible = level > 0.002;
    b.halo.material.opacity = (0.14 + 0.3 * Math.min(level, 1.3)) * glowing;
    b.halo.scale.setScalar(1.3 + level * 0.9);
    b.art.color.setScalar(0.17 + 0.68 * glowing + 0.2 * b.gold);
    b.goldFace.opacity = b.gold;
    b.glow.material.opacity = 0.45 * b.gold;
    b.goldMesh.visible = b.glow.visible = b.gold > 0.003;
  }

  // ---------------------------------------------------------------- the jukebox, as a picture

  /**
   * The room's life builds the jukebox as a painted crate with lights that run round it. Here
   * its crate is swapped for the rendered one, standing in the same group, so it still rocks
   * and flashes when it is knocked; the running lights stay live, over the rendered tubes.
   */
  jukebox() {
    const group = this.stuff.children.find((o) => o.isGroup && o.position.y === 0 && Math.abs(o.position.x - this.L.boardX) < 1e-6 && Math.abs(o.position.z - (SPACE.zBack + 0.3)) < 1e-6);
    if (!group) return;
    const [crate, ...lights] = group.children;
    crate.visible = false;
    for (const m of lights) {
      if (m.material.blending === THREE.AdditiveBlending) continue; // its halo
      m.material.transparent = true;
      m.material.opacity = 0.55;
      m.material.blending = THREE.AdditiveBlending;
      m.material.depthWrite = false;
    }
    // The picture was cut from the plate's own frame: it goes back exactly where it was, on the jukebox's own plane.
    const { x0, y0, x1, y1 } = this.plate.info.juke.rect;
    const k = (CAM.z - group.position.z) / D_WALL;
    const at = (xw, yw) => [wallX(xw) * k, CAM.y + (wallY(yw) - CAM.y) * k];
    const [l, t] = at(x0, y0);
    const [r, bt] = at(x1, y1);
    const picture = new THREE.Mesh(new THREE.PlaneGeometry(r - l, t - bt), new THREE.MeshBasicMaterial({ map: this.plate.juke, transparent: true, depthWrite: false, toneMapped: true }));
    picture.position.set((l + r) / 2 - group.position.x, (t + bt) / 2, 0);
    picture.renderOrder = -5;
    group.add(picture);
    // Its solid part also takes its place in depth, so what passes behind it (the cat, along the foot of the wall) is hidden by it.
    const solid = new THREE.Mesh(picture.geometry, new THREE.MeshBasicMaterial({ map: this.plate.juke, alphaTest: 0.6, colorWrite: false }));
    solid.position.copy(picture.position);
    solid.renderOrder = -4;
    group.add(solid);
    this.juke = { group, picture };
  }

  // ---------------------------------------------------------------- the pieces, in the picture

  /** How bright the nearest lit lamp is at a world x, and where that lamp is: {lit, x}. */
  lampOver(xw) {
    let best = { lit: 0, x: xw, d: Infinity };
    for (const b of this.boxes) {
      if (!(b.level > 0.002)) continue;
      const d = Math.abs(xw - b.cx);
      if (d < best.d) best = { lit: Math.min(1, 0.5 + 0.5 * b.level) * Math.max(0, Math.min(1, (this.half + 150 - d) / 150)), x: b.cx, d };
    }
    return best;
  }

  /**
   * Called just before each picture is drawn, after look3d has posed every piece: gives each
   * its true colour (the light does the dimming here, not the paint), leans its shadow away
   * from the nearest lit lamp, and stands its reflection under it.
   */
  dressPieces() {
    if (this.plain) return;
    const seen = new Set();
    for (const p of this.pieces.values()) {
      const pawn = p.pawn;
      seen.add(pawn);
      if (!pawn.baked) {
        pawn.baked = true;
        pawn.mat.roughness = 0.3;
        pawn.mat.clearcoat = 1;
        pawn.mat.clearcoatRoughness = 0.12;
        pawn.mat.envMapIntensity = 1;
      }
      // look3d dims the paint outside a pool and makes it glow inside one, because it has no real light. Here there is light.
      const flicker = Math.max(0, pawn.mat.emissiveIntensity - (0.09 + 0.27 * pawn.lit) - 0.01);
      pawn.mat.color.copy(pawn.colour);
      pawn.mat.emissiveIntensity = 0.035 + flicker * 0.6;

      // The shadow: short and dark right under a lamp, longer and leaning away from it further out, faint in the dark.
      const lamp = this.lampOver(p.rx);
      const away = lamp.lit > 0 ? Math.max(-1, Math.min(1, (p.rx - lamp.x) / (this.half + 60))) : 0;
      pawn.blob.position.x += away * 0.2;
      pawn.blob.scale.multiplyScalar(1.3);
      pawn.blob.scale.x *= 1 + Math.abs(away) * 0.6;
      pawn.blob.material.opacity = Math.min(1, pawn.blob.material.opacity * (1.0 + 0.8 * lamp.lit));

      // The reflection: the same piece, standing on its head under the floor.
      let r = pawn.reflection;
      if (!r) {
        // Only the body is mirrored: a floor this soft does not hold a pair of eyes.
        r = pawn.reflection = pawn.group.clone();
        r.traverse((o) => {
          if (!o.isMesh) return;
          o.visible = o.material === pawn.mat;
          if (!o.visible) return;
          o.material = o.material.clone();
          Object.assign(o.material, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
          o.renderOrder = -2;
        });
        this.mirror.add(r);
      }
      const [tilt, mt] = [pawn.group.children[0], r.children[0]];
      const [turn, mturn] = [tilt.children[0], mt.children[0]];
      r.position.set(pawn.group.position.x, -pawn.group.position.y, pawn.group.position.z);
      r.scale.set(1, -1, 1);
      mt.rotation.copy(tilt.rotation);
      mt.scale.copy(tilt.scale);
      mturn.rotation.copy(turn.rotation);
      const body = mturn.children[0];
      body.material.color.copy(pawn.mat.color);
      body.material.opacity = (0.07 + 0.13 * lamp.lit) * pawn.fade * Math.max(0, 1 - pawn.group.position.y * 0.9);
    }
    for (const r of [...this.mirror.children]) {
      if ([...seen].some((pawn) => pawn.reflection === r)) continue;
      r.traverse((o) => o.isMesh && o.visible && o.material.dispose());
      this.mirror.remove(r);
    }
  }

  stats() {
    return { ...super.stats(), look: this.plain ? "3d" : "baked", plate: this.plate.base.image?.width ?? 0 };
  }

  destroy() {
    this.scene.onBeforeRender = () => {};
    this.mirror.traverse((o) => o.isMesh && o.visible && o.material.dispose());
    this.envMap?.dispose();
    for (const t of [this.plate?.base, this.plate?.env, this.plate?.juke, ...(this.plate?.lamps ?? [])]) t?.dispose();
    super.destroy();
    if (window.__roomBaked === this) window.__roomBaked = null;
  }
}
