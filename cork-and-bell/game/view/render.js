// The camera and the lens. Every stall is drawn into one HDR frame (side by side on a shared
// screen), then a lens is applied once: depth of field that follows the aim, bloom on the
// real light sources, a filmic curve, a little vignette and grain.
import * as THREE from "three";

const FSQ_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Depth to a circle of confusion, shared by both depth of field paths.
const COC_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform float uNear, uFar;
uniform float uFocus[4];
uniform vec2 uGrid;     // columns and rows of stalls on the screen
uniform float uScale;   // pixels of blur for something infinitely far when focused close
float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
float focusAt(vec2 uv) {
  int i = int(clamp(floor(uv.x * uGrid.x) + floor((1.0 - uv.y) * uGrid.y) * uGrid.x, 0.0, 3.0));
  return i == 0 ? uFocus[0] : i == 1 ? uFocus[1] : i == 2 ? uFocus[2] : uFocus[3];
}
// Signed: negative in front of the focus, positive behind it.
float coc(float d, float focus) {
  if (d > 40.0) return 0.0;                      // the far fairground is painted already out of focus
  float c = (1.0 - focus / d) * uScale;
  return clamp(c, -uScale * 0.62, uScale);        // the near field is held back so the gun stays a gun
}`;

// High quality: one gather at full resolution with many taps.
const DOF_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
${COC_GLSL}
void main() {
  float focus = focusAt(vUv);
  float centerDepth = linearDepth(vUv);
  float centerCoc = abs(coc(centerDepth, focus));
  vec3 acc = texture2D(tColor, vUv).rgb;
  float total = 1.0;
  float maxR = uScale;
  // The spiral is turned by a different amount at every pixel, so its pattern never shows.
  float turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2832;
  for (int i = 1; i <= TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi - 0.5) / float(TAPS)) * maxR;
    float a = fi * 2.39996323 + turn;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
    float d = linearDepth(uv);
    float c = abs(coc(d, focus));
    if (d > centerDepth) c = min(c, centerCoc * 2.0);   // sharp things do not smear over what is behind them
    float w = smoothstep(r - 0.5, r + 0.5, c);
    vec3 s = texture2D(tColor, uv).rgb;
    // Bright points keep their energy and open into discs.
    w *= 1.0 + dot(s, vec3(0.3, 0.5, 0.2)) * 0.6;
    acc += s * w;
    total += w;
  }
  gl_FragColor = vec4(acc / total, 1.0);
}`;

// Low quality (phones, and anything asked for with ?quality=low): the blur is made at half
// resolution with a fixed kernel and laid back over the sharp picture. A quarter of the pixels
// and a third of the taps, and no per-pixel noise: the turned spiral above needs many taps to
// hide its turn, and with few it showed as a stipple.

// Half size, weighted by blur so that sharp things do not leak into the blur. Alpha: signed blur.
const DOF_HALF_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
${COC_GLSL}
void main() {
  float focus = focusAt(vUv);
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + (vec2(float(i - (i / 2) * 2), float(i / 2)) - 0.5) * uTexel;
    float c = coc(linearDepth(uv), focus);
    float w = 0.2 + abs(c);
    acc += vec4(min(texture2D(tColor, uv).rgb, vec3(40.0)), c) * w;
    total += w;
  }
  gl_FragColor = acc / total;
}`;

// The fixed kernel: a golden-angle spiral, written out so that no pixel has to compute it.
const lowTaps = (n) =>
  Array.from({ length: n }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / n);
    const a = (i + 1) * 2.39996323;
    return `  tap(vec2(${(Math.cos(a) * r).toFixed(5)}, ${(Math.sin(a) * r).toFixed(5)}), ${r.toFixed(5)});`;
  }).join("\n");

const dofBlurFrag = (n) => /* glsl */ `
precision highp float;
uniform sampler2D tHalf;
uniform vec2 uTexel;    // one full-resolution pixel
uniform float uScale;
varying vec2 vUv;
vec4 centre;
vec3 acc;
float total;
float cover;
void tap(vec2 o, float rr) {
  vec4 s = texture2D(tHalf, vUv + o * uScale * uTexel);
  float c = abs(s.a);
  if (s.a > centre.a) c = min(c, abs(centre.a) * 2.0);   // sharp things do not smear over what is behind them
  float r = rr * uScale;
  // A blurred point spreads its light over its whole disc, so it gives each pixel of it little.
  float w = smoothstep(r - 1.0, r + 1.0, c) / max(c * c, 1.0);
  cover += w * step(s.a, centre.a - 0.5);
  // Bright points keep their energy and open into discs.
  w *= 1.0 + dot(s.rgb, vec3(0.3, 0.5, 0.2)) * 0.6;
  acc += s.rgb * w;
  total += w;
}
void main() {
  centre = texture2D(tHalf, vUv);
  acc = vec3(0.0);
  total = 0.0;
  cover = 0.0;
${lowTaps(n)}
  float w0 = 0.02 / max(centre.a * centre.a, 1.0);
  // Alpha: how much of this pixel is covered by the blur of nearer things beside it.
  gl_FragColor = vec4((acc + centre.rgb * w0) / (total + w0), clamp(cover * uScale * uScale / ${n.toFixed(1)}, 0.0, 1.0));
}`;

const DOF_MIX_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tBlur;
varying vec2 vUv;
${COC_GLSL}
void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb;
  vec4 blur = texture2D(tBlur, vUv);
  float own = abs(coc(linearDepth(vUv), focusAt(vUv)));
  // The half-size picture is already about a pixel and a half soft, so small blurs take only part of it.
  float f = max(clamp((own - 0.4) / 2.6, 0.0, 1.0), blur.a);
  gl_FragColor = vec4(mix(sharp, blur.rgb, f), 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(uThreshold, uThreshold * 2.4, l);
    c = min(c, vec3(24.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const UP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb * 4.0;
  c += (texture2D(tColor, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 0.0)).rgb
      + texture2D(tColor, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
     + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uTime;
uniform float uExposure;
uniform float uGrain;
uniform vec2 uGrid;
uniform vec2 uSize;
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 filmic(vec3 x) {
  // A filmic curve with a long shoulder, so the bulbs roll off instead of clipping.
  x = max(vec3(0.0), x);
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 develop(vec3 x) {
  // Curved channel by channel, a lamp far over the top comes out pure white: every channel
  // reaches the ceiling. The brightest things keep part of their own colour instead, so a
  // tungsten bulb burns out to a warm white, as it does on film.
  vec3 each = filmic(x);
  float top = max(x.r, max(x.g, x.b));
  vec3 kept = x * (filmic(vec3(top)).r / max(top, 0.0001));
  return mix(each, kept, 0.6 * smoothstep(0.8, 3.0, top));
}
#ifdef EDGES
// Low quality draws without multisampling; this takes the stair-steps off its edges instead
// (the usual fast approximate anti-aliasing, done before the curve on compressed colours so a
// lamp's edge blends like any other). Flat areas leave after five taps.
vec3 squeeze(vec3 c) { return c / (1.0 + c); }
vec3 tap(vec2 uv) { return squeeze(texture2D(tColor, uv).rgb); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 picture(vec2 uv) {
  vec2 px = 1.0 / uSize;
  vec3 m = tap(uv);
  float lM = luma(m);
  float lNW = luma(tap(uv + vec2(-1.0, -1.0) * px));
  float lNE = luma(tap(uv + vec2(1.0, -1.0) * px));
  float lSW = luma(tap(uv + vec2(-1.0, 1.0) * px));
  float lSE = luma(tap(uv + vec2(1.0, 1.0) * px));
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 best = m;
  if (lMax - lMin > max(0.02, lMax * 0.125)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * px;
    vec3 a = 0.5 * (tap(uv + dir * (1.0 / 3.0 - 0.5)) + tap(uv + dir * (2.0 / 3.0 - 0.5)));
    vec3 b = a * 0.5 + 0.25 * (tap(uv - dir * 0.5) + tap(uv + dir * 0.5));
    float lB = luma(b);
    best = lB < lMin || lB > lMax ? a : b;
  }
  return best / max(1.0 - best, 0.001);
}
#else
vec3 picture(vec2 uv) { return texture2D(tColor, uv).rgb; }
#endif
void main() {
  vec3 c = picture(vUv);
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  c += bloom * 0.42;
  // Vignette, per stall on a shared screen.
  vec2 q = fract(vUv * uGrid) - 0.5;
  float vig = 1.0 - dot(q, q) * 0.62;
  c *= vig * vig * uExposure;
  c = develop(c);
  c = pow(c, vec3(1.0 / 2.2));
  // Grain: finer than a pixel is not possible, so it is kept faint and strongest in the mid tones.
  float n = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
  float l = dot(c, vec3(0.3, 0.5, 0.2));
  c += n * uGrain * (0.35 + 0.65 * (1.0 - abs(l - 0.4)));
  gl_FragColor = vec4(c, 1.0);
}`;

export class Lens {
  constructor(canvas, { quality = "high" } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, stencil: false, depth: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the lens writes display colours itself
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.quality = quality;
    this.scale = 1; // internal resolution, lowered when frames take too long
    this.taps = quality === "low" ? 24 : 72;
    this.near = 0.08;
    this.far = 120;
    this.focus = [2.4, 2.4, 2.4, 2.4];
    this.views = 1;
    this.fsq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.fsq.frustumCulled = false;
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsqScene = new THREE.Scene();
    this.fsqScene.add(this.fsq);
    const mat = (frag, uniforms, defines) => new THREE.ShaderMaterial({ vertexShader: FSQ_VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
    // The depth of field passes share one set of uniforms.
    this.dof = { tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: this.near }, uFar: { value: this.far }, uFocus: { value: this.focus }, uGrid: { value: new THREE.Vector2(1, 1) }, uScale: { value: 12 } };
    if (quality === "low") {
      this.dofHalfMat = mat(DOF_HALF_FRAG, this.dof);
      this.dofBlurMat = mat(dofBlurFrag(this.taps), { tHalf: { value: null }, uTexel: this.dof.uTexel, uScale: this.dof.uScale });
      this.dofMixMat = mat(DOF_MIX_FRAG, { ...this.dof, tBlur: { value: null } });
    } else {
      this.dofMat = mat(DOF_FRAG, this.dof, { TAPS: this.taps });
    }
    this.downMat = mat(DOWN_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
    this.upMat = mat(UP_FRAG, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat.blending = THREE.AdditiveBlending;
    this.upMat.transparent = true;
    this.finalMat = mat(FINAL_FRAG, { tColor: { value: null }, tBloom: { value: null }, uTime: { value: 0 }, uExposure: { value: 0.66 }, uGrain: { value: 0.05 }, uGrid: { value: new THREE.Vector2(1, 1) }, uSize: { value: new THREE.Vector2(1, 1) } }, quality === "low" ? { EDGES: 1 } : {});
    this.targets = null;
    this.width = 0;
    this.height = 0;
  }

  /** Call when the window or the internal scale changes. */
  resize(cssW, cssH, dpr) {
    const ratio = Math.min(dpr, 2) * this.scale;
    const w = Math.max(2, Math.round(cssW * ratio));
    const h = Math.max(2, Math.round(cssH * ratio));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.targets?.forEach((t) => t.dispose());
    const hdr = (tw, th, depth, samples = 0) => {
      const rt = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, samples });
      if (depth) {
        rt.depthTexture = new THREE.DepthTexture(tw, th);
        rt.depthTexture.type = THREE.UnsignedIntType;
      }
      return rt;
    };
    this.sceneRT = hdr(w, h, true, this.quality === "low" ? 0 : 4);
    this.dofRT = hdr(w, h, false);
    this.bloom = [];
    let bw = w;
    let bh = h;
    for (let i = 0; i < 5; i++) {
      bw = Math.max(2, bw >> 1);
      bh = Math.max(2, bh >> 1);
      this.bloom.push(hdr(bw, bh, false));
    }
    this.targets = [this.sceneRT, this.dofRT, ...this.bloom];
    if (this.quality === "low") {
      this.halfRT = [hdr(Math.max(2, w >> 1), Math.max(2, h >> 1), false), hdr(Math.max(2, w >> 1), Math.max(2, h >> 1), false)];
      this.targets.push(...this.halfRT);
    }
  }

  pass(material, target) {
    this.fsq.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsqScene, this.orthoCam);
  }

  /**
   * views: [{scene, camera}] drawn left to right. time is for the grain.
   */
  render(views, time) {
    const r = this.renderer;
    const w = this.width;
    const h = this.height;
    r.info.reset();
    r.setRenderTarget(this.sceneRT);
    r.setViewport(0, 0, w, h);
    r.setScissorTest(false);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    const n = views.length;
    const [cols, rows] = gridFor(n);
    this.views = n;
    r.setScissorTest(n > 1);
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x0 = Math.round((col * w) / cols);
      const x1 = Math.round(((col + 1) * w) / cols);
      const y0 = Math.round(h - ((row + 1) * h) / rows);
      const y1 = Math.round(h - (row * h) / rows);
      this.sceneRT.viewport.set(x0, y0, x1 - x0, y1 - y0);
      this.sceneRT.scissor.set(x0, y0, x1 - x0, y1 - y0);
      this.sceneRT.scissorTest = n > 1;
      r.setRenderTarget(this.sceneRT);
      r.render(views[i].scene, views[i].camera);
    }
    this.sceneRT.viewport.set(0, 0, w, h);
    this.sceneRT.scissorTest = false;
    r.setScissorTest(false);

    const d = this.dof;
    d.tColor.value = this.sceneRT.texture;
    d.tDepth.value = this.sceneRT.depthTexture;
    d.uTexel.value.set(1 / w, 1 / h);
    d.uGrid.value.set(cols, rows);
    // The blur is sized by one stall's picture (by its width when it stands upright, where the
    // stall is drawn smaller for its height); small and low-quality screens get less.
    d.uScale.value = (Math.min(h / rows, ((w / cols) * 9) / 16) / 1080) * 13 * (this.quality === "low" ? 0.7 : 1);
    if (this.quality === "low") {
      this.pass(this.dofHalfMat, this.halfRT[0]);
      this.dofBlurMat.uniforms.tHalf.value = this.halfRT[0].texture;
      this.pass(this.dofBlurMat, this.halfRT[1]);
      this.dofMixMat.uniforms.tBlur.value = this.halfRT[1].texture;
      this.pass(this.dofMixMat, this.dofRT);
    } else {
      this.pass(this.dofMat, this.dofRT);
    }

    // Bloom: only what is brighter than paper white, spread wide and soft.
    let src = this.dofRT;
    for (let i = 0; i < this.bloom.length; i++) {
      const u = this.downMat.uniforms;
      u.tColor.value = src.texture;
      u.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      u.uThreshold.value = i === 0 ? 2.4 : 0;
      this.pass(this.downMat, this.bloom[i]);
      src = this.bloom[i];
    }
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const u = this.upMat.uniforms;
      u.tColor.value = this.bloom[i].texture;
      u.uTexel.value.set(1 / this.bloom[i].width, 1 / this.bloom[i].height);
      this.pass(this.upMat, this.bloom[i - 1]);
    }

    const f = this.finalMat.uniforms;
    f.tColor.value = this.dofRT.texture;
    f.tBloom.value = this.bloom[0].texture;
    f.uTime.value = time;
    f.uGrid.value.set(cols, rows);
    f.uSize.value.set(w, h);
    this.pass(this.finalMat, null);
  }
}

let oneRow = false;
/** Ask for four stalls in one row (each then stands upright, framed as on a phone). */
export function fourInARow(yes) {
  oneRow = yes;
}

/** How the stalls share the screen: side by side up to three, two rows of two for four. */
export function gridFor(n) {
  return n <= 3 || oneRow ? [Math.max(1, n), 1] : [2, 2];
}

// ---------------------------------------------------------------- the sky and the far fairground

// Keep in step with SKY in tools/blender/build_set.py: the bake was lit by this sky.
const SKY_GLSL = /* glsl */ `
vec3 duskSky(float sinElevation) {
  float v = sinElevation * 0.5 + 0.5;
  vec3 c = vec3(0.012, 0.016, 0.03);
  c = mix(c, vec3(0.03, 0.04, 0.075), smoothstep(0.0, 0.47, v));
  c = mix(c, vec3(0.5, 0.3, 0.2), smoothstep(0.47, 0.5, v));
  c = mix(c, vec3(0.2, 0.2, 0.33), smoothstep(0.5, 0.56, v));
  c = mix(c, vec3(0.055, 0.1, 0.27), smoothstep(0.56, 0.68, v));
  c = mix(c, vec3(0.012, 0.03, 0.12), smoothstep(0.68, 1.0, v));
  return c;
}`;

export function makeSky() {
  const geo = new THREE.SphereGeometry(100, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir;
      ${SKY_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = duskSky(d.y);
        // Thin high cloud catching the last light, and the first stars.
        float band = sin(d.x * 5.0 + d.y * 14.0) * 0.5 + 0.5;
        c += vec3(0.05, 0.03, 0.035) * band * smoothstep(0.05, 0.25, d.y) * (1.0 - smoothstep(0.25, 0.5, d.y));
        vec2 g = floor(d.xy / max(d.z * -1.0, 0.2) * 90.0);
        float s = step(0.995, hash(g)) * smoothstep(0.28, 0.5, d.y);
        c += vec3(0.5, 0.55, 0.7) * s * 0.35;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** The far lights of the fairground: a big wheel, a tower and strings of lamps, as soft discs. */
export function makeFarLights(seed = 1) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pts = [];
  const warm = [1.0, 0.6, 0.25];
  const push = (x, y, z, size, col, wheel = 0, tw = rnd()) => pts.push({ x, y, z, size, col, wheel, tw });
  // The big wheel, off to the right, turning slowly.
  for (let i = 0; i < 26; i++) push(13, 15.5, -62, 0.55 + rnd() * 0.15, i % 5 === 0 ? [1.0, 0.25, 0.15] : warm, i + 1);
  for (let i = 0; i < 8; i++) push(13, 15.5, -62, 0.4, [0.9, 0.75, 0.5], -(i + 1));
  // A tower with a spiral of lamps, to the left.
  for (let i = 0; i < 22; i++) push(-17 + Math.sin(i * 0.9) * (2.2 - i * 0.07), 9 + i * 0.62, -58, 0.42, i % 3 ? warm : [0.3, 0.7, 0.9]);
  // Strings of lamps between poles.
  for (let s = 0; s < 4; s++) {
    const x0 = -30 + s * 16 + rnd() * 4;
    const y0 = 12 + rnd() * 5;
    const z = -50 - rnd() * 25;
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      push(x0 + u * 15, y0 - 2.4 * (1 - (2 * u - 1) ** 2), z, 0.36, [warm, warm, [0.9, 0.2, 0.15], [0.25, 0.7, 0.4]][Math.floor(rnd() * 4)]);
    }
  }
  // Scattered lamps low down: stalls and rides beyond.
  for (let i = 0; i < 46; i++) push(-40 + rnd() * 80, 8.5 + rnd() * rnd() * 14, -48 - rnd() * 40, 0.3 + rnd() * 0.5, rnd() < 0.75 ? warm : [0.5 + rnd() * 0.5, 0.3 + rnd() * 0.5, 0.3 + rnd() * 0.6]);

  const n = pts.length;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(n * 4);
  const col = new Float32Array(n * 4);
  const extra = new Float32Array(n * 2);
  pts.forEach((p, i) => {
    off.set([p.x, p.y, p.z, p.size], i * 4);
    col.set([...p.col, 0.6 + rnd() * 0.8], i * 4);
    extra.set([p.wheel, p.tw], i * 2);
  });
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(off, 4));
  geo.setAttribute("aColour", new THREE.InstancedBufferAttribute(col, 4));
  geo.setAttribute("aExtra", new THREE.InstancedBufferAttribute(extra, 2));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aOffset; attribute vec4 aColour; attribute vec2 aExtra;
      uniform float uTime;
      varying vec2 vP; varying vec4 vColour; varying float vTw;
      void main() {
        vec3 c = aOffset.xyz;
        if (aExtra.x > 0.5) { float a = (aExtra.x - 1.0) / 26.0 * 6.2832 + uTime * 0.11; c.xy += vec2(cos(a), sin(a)) * 7.2; }
        if (aExtra.x < -0.5) { float a = (-aExtra.x - 1.0) / 8.0 * 6.2832 + uTime * 0.11; c.xy += vec2(cos(a), sin(a)) * 3.4; }
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * aOffset.w * 1.25;
        vP = position.xy; vColour = aColour; vTw = aExtra.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform float uLevel;
      varying vec2 vP; varying vec4 vColour; varying float vTw;
      void main() {
        float r = length(vP);
        // A lens disc: flat, a little brighter at the rim, soft at the very edge.
        float disc = smoothstep(1.0, 0.86, r) * (0.72 + 0.28 * smoothstep(0.55, 0.92, r));
        float twinkle = 0.85 + 0.15 * sin(uTime * (1.5 + vTw * 3.0) + vTw * 40.0);
        gl_FragColor = vec4(vColour.rgb * vColour.a * disc * twinkle * 0.5 * uLevel, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  return mesh;
}

export { SKY_GLSL };
