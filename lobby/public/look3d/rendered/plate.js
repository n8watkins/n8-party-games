// A room made of rendered layers: the part every such room shares.
//
// A rendered room is a picture of the room, rendered offline in Blender from the 3D look's own
// camera place (look3d/space.js), and a few more pictures that are added to it as light:
//
//   base     the room with every light that can change switched off
//   lights   one tile per light that can change (a lamp, a line of light), in one atlas: what that
//            light adds to the base. Light adds up, so any mix of lights on, off and brighter is
//            one shader adding tiles with one number each.
//   glass    (a room with windows) one more tile of the atlas: 1 where the room is glass, 0 where
//            it is solid. What is outside is a scene of its own, drawn first; the room is drawn
//            over it, solid everywhere but the glass, so nothing outside can ever show over a wall.
//   cards    rendered things that stand apart from the walls (a lamp, a table), on one sheet.
//
// plate.json, written by the Blender script, says where each of those is. Everything that is
// data (posters, signs, words, pieces) stays live, drawn by the 3D look as it is.
//
// Used by look3d/rendered/room-rendered.js (the party room) and by the Star Lounge's preview
// page (preview/star-lounge), which import these same functions.
import { CAM, D_WALL, SPACE, U, wallX, wallY } from "../space.js";
import * as THREE from "../three.js";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** A small repeatable source of numbers from 0 up to 1. */
export const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

/** One picture as a texture. Rejects with the file's name if it does not arrive. */
export function loadTexture(url, { srgb = true, mips = true, repeat = false, anisotropy = 4 } = {}) {
  return new Promise((done, fail) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.generateMipmaps = mips;
        t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        if (repeat) t.wrapS = THREE.RepeatWrapping;
        t.anisotropy = anisotropy;
        done(t);
      },
      undefined,
      () => fail(new Error(`the picture ${String(url).split("/").pop().slice(0, 60)} did not load`)),
    );
  });
}

/** A texture painted on a canvas. */
export function canvasTexture(w, h, draw, anisotropy = 4) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** A soft round spot of light, for glows. */
export const radialTexture = () =>
  canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });

/** Where a point of the flat picture (world units) is in the room, on the plane at depth z (metres): [x, y]. */
export const placeAt = (xw, yw, z) => {
  const k = (CAM.z - z) / D_WALL;
  return [wallX(xw) * k, CAM.y + (wallY(yw) - CAM.y) * k];
};

/**
 * The room's picture as a material: the base, plus each named light's tile times its gain and
 * tint, cut to the glass when the plate has a glass tile. `names` are the lights in the order
 * of their uniforms (plate.lights[name].tile says where each one is in the atlas).
 *
 * Uniforms: uGain[i], uTint[i], uSway[i] (a sideways nudge of a light's tile, for a lamp that
 * swings), uExposure, uGlass (0 makes the glass solid), uShine (how much of the room's own
 * picture the glass keeps), uProbe (1 draws only the glass, in white: for checks).
 */
export function shellMaterial(plate, base, lights, names, { exposure = 0.95, shine = 0.5 } = {}) {
  const n = names.length;
  const grid = plate.lightsGrid;
  const tile = (i) => `vec2(${(i % grid.cols).toFixed(1)}, ${Math.floor(i / grid.cols).toFixed(1)})`;
  const r = plate.rect;
  const glass = Number.isInteger(plate.glassTile);
  const G = glass ? tile(plate.glassTile) : "";
  const mat = new THREE.ShaderMaterial({
    // Solid for three.js's lists (it is drawn first of everything, by its order), but blended:
    // its alpha is how much of the room covers what was drawn before it (the outside).
    transparent: false,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uBase: { value: base },
      uLights: { value: lights },
      uGain: { value: new Array(n).fill(0) },
      uTint: { value: Array.from({ length: n }, () => new THREE.Color(1, 1, 1)) },
      uSway: { value: new Array(n).fill(0) },
      uExposure: { value: exposure },
      uGlass: { value: glass ? 1 : 0 },
      uShine: { value: shine },
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
        ${names.map((name, i) => `if (uGain[${i}] > 0.0) sum += light(uv + vec2(uSway[${i}], 0.0), ${tile(plate.lights[name].tile)}) * uGain[${i}] * uTint[${i}];`).join("\n        ")}
        float through = 0.0;
        ${
          glass
            ? `// How much of the outside shows here: 1 in the middle of a pane, 0 on anything solid. The picture
        // that says so is squeezed small and comes back with faint smudges where it was 0, so its lowest
        // few hundredths are read as nothing: a wall, a post or the door is solid, with no exceptions.
        through = smoothstep(0.04, 0.96, light(uv, ${G}).r) * uGlass;
        // A crack a texel or two wide in that picture (the seam between the door's frame and the first post) is not a
        // window: with no glass three texels to either side, or three above and below, the point is solid.
        // The proper fix is to re-render the glass mask without the seam; this guard stays either way.
        if (through > 0.0) {
          vec2 tx = vec2(${(3 / grid.w).toFixed(6)}, ${(3 / grid.h).toFixed(6)});
          float side = max(light(uv - vec2(tx.x, 0.0), ${G}).r, light(uv + vec2(tx.x, 0.0), ${G}).r);
          float updown = max(light(uv - vec2(0.0, tx.y), ${G}).r, light(uv + vec2(0.0, tx.y), ${G}).r);
          through *= step(0.04, side) * step(0.04, updown);
        }`
            : ""
        }
        if (uProbe > 0.5) { gl_FragColor = vec4(vec3(through > 0.0 ? 1.0 : 0.0), 1.0); return; }
        // The glass holds a picture of the room, but faintly: what is outside is the brighter thing.
        sum *= mix(1.0, uShine, through);
        // Past the picture's edge the room carries on as darkness.
        vec2 o2 = abs(uv - 0.5) - 0.5; float past = max(o2.x, o2.y);
        sum *= 1.0 - smoothstep(0.0, 0.1, past);
        // Premultiplied: the room's light is added over what is outside, which shows through as much as the room is glass.
        gl_FragColor = vec4(sum * uExposure, 1.0 - through);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return mat;
}

/**
 * The room's own shape (back wall, floor, ceiling and the two ends), for the picture to be thrown
 * back onto from the place it was taken. Seen from that place it is the picture exactly; seen
 * from a little to one side, near things move against far ones as they would.
 */
export function shellGroup(material, { zFront = 16, w = SPACE.w } = {}) {
  const g = new THREE.Group();
  const [h, zb] = [SPACE.h, SPACE.zBack];
  const add = (geo, pos, rot) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.renderOrder = -50;
    m.frustumCulled = false;
    g.add(m);
  };
  add(new THREE.PlaneGeometry(w, h), [0, h / 2, zb], [0, 0, 0]);
  add(new THREE.PlaneGeometry(w, zFront - zb), [0, 0, (zFront + zb) / 2], [-Math.PI / 2, 0, 0]);
  add(new THREE.PlaneGeometry(w, zFront - zb), [0, h, (zFront + zb) / 2], [Math.PI / 2, 0, 0]);
  add(new THREE.PlaneGeometry(zFront - zb, h), [-w / 2, h / 2, (zFront + zb) / 2], [0, Math.PI / 2, 0]);
  add(new THREE.PlaneGeometry(zFront - zb, h), [w / 2, h / 2, (zFront + zb) / 2], [0, -Math.PI / 2, 0]);
  return g;
}

/**
 * A card's material: its rendered picture, plus its own light (the row below it on the sheet)
 * times uOwn and uTint. `depthTest`: whether solid things in front of it (the pieces) hide it.
 */
export const cardMaterial = (sheet, { depthTest = false, exposure = 1 } = {}) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthTest,
    depthWrite: false,
    uniforms: { uMap: { value: sheet }, uOwn: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uOff: { value: new THREE.Vector2(0, 0) }, uExposure: { value: exposure } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uOwn; uniform vec3 uTint; uniform vec2 uOff; uniform float uExposure; varying vec2 vUv;
      void main(){ vec4 a = texture2D(uMap, vUv); vec3 own = texture2D(uMap, vUv - uOff).rgb;
        gl_FragColor = vec4((a.rgb + own * uOwn * uTint) * uExposure, a.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

/** A beam of light from a lamp: brightest where it is seen face on, fading at both ends. */
export const beamMaterial = (colour, { depthTest = false } = {}) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: { uStrength: { value: 0 }, uColor: { value: colour.clone() } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float along = smoothstep(0.0, 0.06, vH) * smoothstep(1.0, 0.5, vH);
        gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
  });

/** One of the plate's cards as a mesh at its own depth: {mesh, mat, c, top, bottom, left, right}. */
export function card(plate, name, sheet, opts) {
  const c = plate.cards[name];
  const S = plate.cardsSheet;
  const [l, t] = placeAt(c.x0, c.y0, c.z);
  const [r, b] = placeAt(c.x1, c.y1, c.z);
  const geo = new THREE.PlaneGeometry(r - l, t - b);
  const [ax, ay, aw, ah] = c.at;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (ax + uv.getX(i) * aw) / S.w, 1 - (ay + (1 - uv.getY(i)) * ah) / S.h);
  const mat = cardMaterial(sheet, opts);
  mat.uniforms.uOff.value.set(0, S.ownRow / S.h);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((l + r) / 2, (t + b) / 2, c.z);
  return { mesh, mat, c, top: t, bottom: b, left: l, right: r };
}

/** A camera that sees what `cam` sees, out to `far` metres (the room's own camera stops short of the sky). */
export function farCamera(cam, out, far) {
  out.position.copy(cam.position);
  out.quaternion.copy(cam.quaternion);
  out.updateMatrixWorld();
  const p = out.projectionMatrix.copy(cam.projectionMatrix);
  // Only the depth range of a perspective projection changes with near and far: two numbers.
  const e = p.elements;
  const near = e[14] / (e[10] - 1);
  e[10] = -(far + near) / (far - near);
  e[14] = (-2 * far * near) / (far - near);
  out.projectionMatrixInverse.copy(p).invert();
  return out;
}

const corner = new THREE.Vector3();
/**
 * The box of screen (CSS pixels, from the bottom left, as three.js's scissor wants it) that the
 * window wall takes up as `cam` sees it: from `sill` to the ceiling, from end wall to end wall
 * (`across` metres: a room whose picture is wider than the 3D look's room says how wide).
 * Null when it is off the screen.
 */
export function windowBox(cam, w, h, sill, across = SPACE.w) {
  corner.set(-across / 2, sill - 0.06, SPACE.zBack).project(cam);
  const x0 = clamp(Math.floor(((corner.x + 1) / 2) * w) - 1, 0, w);
  const y0 = clamp(Math.floor(((corner.y + 1) / 2) * h) - 1, 0, h);
  corner.set(across / 2, SPACE.h, SPACE.zBack).project(cam);
  const x1 = clamp(Math.ceil(((corner.x + 1) / 2) * w) + 1, 0, w);
  const y1 = clamp(Math.ceil(((corner.y + 1) / 2) * h) + 1, 0, h);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/**
 * One frame of a room with windows: what is outside first, inside the box of screen the window
 * takes up (`box`, from windowBox), then the room over it. What is outside is in its own scene
 * and can never be drawn after the room, whatever its own drawing order says.
 */
export function drawOutsideFirst(renderer, outside, outCam, room, cam, box, half = null) {
  renderer.setScissorTest(false);
  renderer.clear();
  if (box) {
    if (half) half.draw(renderer, outside, outCam, box);
    else {
      renderer.setScissor(...box);
      renderer.setScissorTest(true);
      renderer.render(outside, outCam);
      renderer.setScissorTest(false);
    }
  }
  renderer.clearDepth();
  renderer.render(room, cam);
}

/**
 * What is outside drawn at half the room's resolution (a quarter of the pixels), then laid on
 * the screen inside the window's box: for a device that cannot keep up. The picture is kept in
 * light's own numbers (half floats) and given the film curve and colour only when it is laid
 * down, as it is when drawn straight to the screen. Null where the device cannot draw into half
 * floats, so that step is not there to take.
 */
export function halfOutside(renderer) {
  const ext = renderer.extensions;
  if (!ext.has("EXT_color_buffer_float") && !ext.has("EXT_color_buffer_half_float")) return null;
  const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { uMap: { value: target.texture } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
      void main(){ gl_FragColor = vec4(texture2D(uMap, vUv).rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  return {
    draw(renderer, outside, outCam, box) {
      renderer.getDrawingBufferSize(size);
      const [w, h] = [Math.max(1, Math.ceil(size.x / 2)), Math.max(1, Math.ceil(size.y / 2))];
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      // The box is in CSS pixels; the target's own are half the drawn ones.
      const k = renderer.getPixelRatio() / 2;
      target.scissor.set(Math.floor(box[0] * k), Math.floor(box[1] * k), Math.ceil(box[2] * k) + 1, Math.ceil(box[3] * k) + 1);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(outside, outCam);
      renderer.setRenderTarget(null);
      renderer.setScissor(...box);
      renderer.setScissorTest(true);
      renderer.render(scene, flat);
      renderer.setScissorTest(false);
    },
    dispose() {
      target.dispose();
      mat.dispose();
      quad.geometry.dispose();
    },
  };
}
