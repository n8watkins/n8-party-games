// Small soft pictures by the hundred, each in one drawing: the drops on the bar's windows, the
// splashes, the glow of the street lamps, the ripples in the puddles, the shop light going off.
//
// Everything outside the bar is laid out in the painting's own pixels (bar/layers/plate.json) at a
// depth of its own in metres; the shader puts each where it is in the room (look3d/space.js), so
// what is far away moves less than the window when the eye moves, as it would.
import { CAM, D_WALL, U } from "../../space.js";
import * as THREE from "../../three.js";

/** The pictures on the sheet, by name: each a square of TILE pixels, side by side. */
export const TILES = { bead: 0, ring: 1, dot: 2, glow: 3, rect: 4, fade: 5 };
const TILE = 128;
/** How much of a tile the round things fill: a bead of radius r is drawn r / FILL over its tile's half. */
export const FILL = { bead: 48 / 64, ring: 56 / 64, dot: 56 / 64, glow: 1, rect: 1, fade: 1 };

/** The sheet: a drop on glass (a dark edge where it bends the light, a clear body, the room's warm glint and a white highlight), a ring, a soft dot, a glow, a square and a fade. */
export function spriteSheet() {
  const n = Object.keys(TILES).length;
  const c = document.createElement("canvas");
  c.width = TILE * n;
  c.height = TILE;
  const g = c.getContext("2d");
  const at = (name) => TILES[name] * TILE + TILE / 2;
  // The drop: centred, radius 48.
  {
    const [cx, cy, r] = [at("bead"), 64, 48];
    g.fillStyle = "rgba(8,12,26,.34)";
    g.beginPath();
    g.ellipse(cx, cy + r * 0.25, r * 1.02, r, 0, 0, Math.PI * 2);
    g.fill();
    const body = g.createRadialGradient(cx - 11, cy - 15, 4, cx, cy, r);
    body.addColorStop(0, "rgba(205,222,248,.18)");
    body.addColorStop(0.8, "rgba(175,198,232,.28)");
    body.addColorStop(1, "rgba(225,236,255,.5)");
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,212,155,.55)";
    g.beginPath();
    g.arc(cx + r * 0.32, cy + r * 0.38, r * 0.24, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.9)";
    g.beginPath();
    g.arc(cx - r * 0.34, cy - r * 0.4, r * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // The ring of a splash, radius 56.
  g.strokeStyle = "#fff";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(at("ring"), 64, 56 - 5, 0, Math.PI * 2);
  g.stroke();
  // A soft dot, radius 56.
  {
    const d = g.createRadialGradient(at("dot"), 64, 0, at("dot"), 64, 56);
    d.addColorStop(0, "rgba(255,255,255,1)");
    d.addColorStop(0.7, "rgba(255,255,255,.85)");
    d.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = d;
    g.fillRect(TILES.dot * TILE, 0, TILE, TILE);
  }
  // A glow: the preview's lamp glow (radial, .55 to .22 at 45% to nothing), as a share of white.
  {
    const d = g.createRadialGradient(at("glow"), 64, 0, at("glow"), 64, 64);
    d.addColorStop(0, "rgba(255,255,255,1)");
    d.addColorStop(0.45, "rgba(255,255,255,.4)");
    d.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = d;
    g.fillRect(TILES.glow * TILE, 0, TILE, TILE);
  }
  // A square, a pixel in from its tile's edge so it never picks up its neighbours.
  g.fillStyle = "#fff";
  g.fillRect(TILES.rect * TILE + 2, 2, TILE - 4, TILE - 4);
  // A fade: white at the top to nothing at the bottom.
  {
    const d = g.createLinearGradient(0, 2, 0, TILE - 2);
    d.addColorStop(0, "rgba(255,255,255,1)");
    d.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = d;
    g.fillRect(TILES.fade * TILE + 2, 2, TILE - 4, TILE - 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: t, tiles: n };
}

/**
 * The shader's part that puts a point of the painting (`p`, painting pixels) at depth `z` (metres)
 * where it is in the room: the place the camera that saw the painting saw it, at that depth.
 * `uPaint` is (world units per painting pixel, world y of the painting's top).
 */
export const PLACE_GLSL = `
  uniform vec2 uPaint;
  vec3 placeP(vec2 p, float z) {
    float k = (${CAM.z.toFixed(4)} - z) / ${D_WALL.toFixed(4)};
    float xw = p.x * uPaint.x;
    float yw = uPaint.y + p.y * uPaint.x;
    return vec3((xw - 960.0) / ${U.toFixed(3)} * k, ${CAM.y.toFixed(4)} + ((6.25 - yw / ${U.toFixed(3)}) - ${CAM.y.toFixed(4)}) * k, z);
  }`;

/**
 * A batch of sprites, refilled every frame: add() each, then done(). Each is a tile of the sheet
 * at a point of the painting and a depth, a size (half width and half height in painting pixels),
 * a turn, a colour and an alpha, either laid over (normal) or added as light (add).
 */
export class Sprites {
  /** `depthTest`: whether solid things in front (the pieces) hide them: outside the glass nothing is in front, inside the room the pieces are. */
  constructor(sheet, paint, max = 1024, { depthTest = false } = {}) {
    this.max = max;
    this.n = 0;
    // pos.xyz, size.xy, rot, tile | colour.rgb, alpha, add
    this.a = new Float32Array(max * 7);
    this.b = new Float32Array(max * 5);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.ia = new THREE.InstancedInterleavedBuffer(this.a, 7).setUsage(THREE.DynamicDrawUsage);
    this.ib = new THREE.InstancedInterleavedBuffer(this.b, 5).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPos", new THREE.InterleavedBufferAttribute(this.ia, 3, 0));
    geo.setAttribute("iSize", new THREE.InterleavedBufferAttribute(this.ia, 2, 3));
    geo.setAttribute("iRot", new THREE.InterleavedBufferAttribute(this.ia, 1, 5));
    geo.setAttribute("iTile", new THREE.InterleavedBufferAttribute(this.ia, 1, 6));
    geo.setAttribute("iColour", new THREE.InterleavedBufferAttribute(this.ib, 4, 0));
    geo.setAttribute("iAdd", new THREE.InterleavedBufferAttribute(this.ib, 1, 4));
    geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
      uniforms: { uMap: { value: sheet.texture }, uTiles: { value: sheet.tiles }, uPaint: { value: new THREE.Vector2(...paint) } },
      vertexShader: `${PLACE_GLSL}
        attribute vec3 iPos; attribute vec2 iSize; attribute float iRot; attribute float iTile; attribute vec4 iColour; attribute float iAdd;
        uniform float uTiles; varying vec2 vUv; varying vec4 vColour; varying float vAdd;
        void main(){
          vec2 c = position.xy; float s = sin(iRot), co = cos(iRot);
          vec2 d = vec2(c.x * iSize.x, -c.y * iSize.y);
          d = vec2(d.x * co - d.y * s, d.x * s + d.y * co);
          vUv = vec2((iTile + (c.x * 0.5 + 0.5)) / uTiles, c.y * 0.5 + 0.5);
          vColour = iColour; vAdd = iAdd;
          gl_Position = projectionMatrix * viewMatrix * vec4(placeP(iPos.xy + d, iPos.z), 1.0);
        }`,
      fragmentShader: `uniform sampler2D uMap; varying vec2 vUv; varying vec4 vColour; varying float vAdd;
        void main(){ vec4 t = texture2D(uMap, vUv); float a = t.a * vColour.a;
          gl_FragColor = vec4(t.rgb * vColour.rgb * a, a * (1.0 - vAdd));
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.geo = geo;
    this.colour = new THREE.Color();
  }

  begin() {
    this.n = 0;
  }

  /** One sprite. `colour` a three.js Color or a hex number (sRGB), `alpha` 0 to 1, `add` true to add it as light. */
  add(tile, px, py, z, rx, ry, colour = 0xffffff, alpha = 1, add = false, rot = 0) {
    if (this.n >= this.max || !(alpha > 0.002)) return;
    const c = colour.isColor ? colour : this.colour.set(colour);
    this.a.set([px, py, z, rx, ry, rot, tile], this.n * 7);
    this.b.set([c.r, c.g, c.b, alpha, add ? 1 : 0], this.n * 5);
    this.n++;
  }

  done() {
    this.geo.instanceCount = this.n;
    this.ia.needsUpdate = true;
    this.ib.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
