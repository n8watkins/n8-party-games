// The room in 3D: a second drawing of the same live room (the first is ../scene.js), in the
// look of the approved stills. It is a room view (../room-view.js): the page tells it what the
// room says, and it draws. Nothing here decides anything; rules, movement and the vote are the
// shared logic's (../shared) exactly as for the flat drawing.
//
// How it stays cheap enough for a phone:
//   - The camera never moves (look3d/space.js), so nothing needs real light. Walls and floor
//     are painted once on canvases; a lamp's light is a cone of glow and a pool worked out in
//     the floor's own shader; a piece's shadow is a soft blob. There are no shadow maps and
//     only three plain lights, which touch the pieces and a few fittings.
//   - Words are HTML (look3d/words.js), so the 3D picture has no text to keep sharp.
//   - The picture is drawn at no more than twice the screen's CSS size and never more than a
//     fixed number of pixels; it steps down if frames are slow, draws a third as often when
//     nothing moves, and not at all while the page is hidden (the page's frame loop stops).
import { IMPACT_MS, cooldownFraction } from "../shared/bump.js";
import { COUNT_MS } from "../shared/vote.js";
import { ROOM, boxCentre, lightHalf, posAt } from "../shared/world.js";
import { Expressions, poseTop } from "../emotes/play.js";
import { EmoteFigure, Sticker } from "../emotes/svg.js";
import { EmoteArms, RIG_UNIT } from "./emote-arms.js";
import { Life } from "./life.js";
import { ART_IMAGES, boxArt, boxSide, canvasOf } from "./paint.js";
import { PAWN_HEIGHT, dressPawn, disposePawn, fadePawn, makePawn, posePawn, resumeKnock, startAttack, startKnock } from "./pieces.js";
import { SKINS, liveSkin } from "./skins.js";
import { CAM, D_WALL, FEET_Y, FRAME, PX, SPACE, U, layout, place, walkX, wallX, wallY } from "./space.js";
import * as THREE from "./three.js";
import { Words } from "./words.js";

/** How quickly another player's piece closes on where it should be (per second). The flat drawing's number. */
const EASE = 14;
/** The red a fuming piece goes. */
const FUMING = new THREE.Color("#ff2a14");
/** How bright a lamp burns for 0, 1, 2, 3 and 4 players standing under it. */
const LEVELS = [0.16, 0.6, 1.2, 1.4, 1.55];
/** Painted walls and floors: pixels per metre. */
const TEX_K = 150;
/** The most pixels the picture is ever drawn at (about 2560 x 1440). */
const MAX_PIXELS = 3_700_000;
const MAX_POOLS = 6;

// ---------------------------------------------------------------- loading

let styled = null;
function loadStyle() {
  styled ??= new Promise((done) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./look3d.css", import.meta.url).href;
    link.addEventListener("load", done);
    link.addEventListener("error", done);
    document.head.append(link);
  });
  return styled;
}

/** The lettering the box art is painted with must be there before it is painted. Never waits long. */
function loadFonts() {
  const wanted = ['400 40px "Abril Fatface"', '900 40px "Nunito"', '700 40px "Caveat"'];
  const loaded = Promise.all(wanted.map((font) => document.fonts.load(font))).catch(() => {});
  return Promise.race([loaded, new Promise((done) => setTimeout(done, 4000))]);
}

async function loadImages() {
  const out = {};
  await Promise.all(
    Object.entries(ART_IMAGES).map(async ([id, src]) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
        out[id] = img;
      } catch {
        // The box is painted without its picture.
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- small makers

function textureOf(canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/** Several shapes as one mesh's geometry: [[geometry, x, y, z], ...]. */
function joined(parts) {
  const pos = [];
  const nor = [];
  const m = new THREE.Matrix4();
  for (const [geo, x, y, z] of parts) {
    const g = geo.toNonIndexed().applyMatrix4(m.makeTranslation(x, y, z));
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

const glowMat = (map, color, opacity) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/** A lamp's beam: faint where it crosses the box art, gathering toward the floor. */
const coneMat = (color) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float along = mix(1.0, 0.3, smoothstep(0.25, 0.75, vH)) * smoothstep(0.0, 0.08, vH);
        gl_FragColor = vec4(uColor * uStrength * f * along, 1.0); }`,
  });

/**
 * The floor: its painted boards, lit by the pools. Each pool is {x, z, radius, level}; the
 * light is worked out here, per pixel, in place of real lamps.
 */
const floorMat = (map, light) =>
  new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uLight: { value: new THREE.Color(light) },
      // The wash of a pool is the lamp's colour made richer: a warm lamp makes a warm pool, not a white one.
      uPool: { value: new THREE.Color(light).offsetHSL(0, 0.18, -0.08) },
      uAmbient: { value: 0.9 },
      uFront: { value: new THREE.Vector2(SPACE.walkZ + 0.9, SPACE.zFront) },
      uPools: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector4(0, 0, 1, 0)) },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vAt;
      void main(){ vUv = uv; vec4 at = modelMatrix * vec4(position, 1.0); vAt = at.xyz; gl_Position = projectionMatrix * viewMatrix * at; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uLight; uniform vec3 uPool; uniform float uAmbient; uniform vec2 uFront; uniform vec4 uPools[${MAX_POOLS}];
      varying vec2 vUv; varying vec3 vAt;
      void main(){
        vec3 base = texture2D(map, vUv).rgb;
        float lit = 0.0;
        float wash = 0.0;
        for (int i = 0; i < ${MAX_POOLS}; i++) {
          vec4 p = uPools[i];
          float d = length(vAt.xz - p.xy) / p.z;
          float inside = (1.0 - smoothstep(0.93, 1.0, d)) * mix(1.0, 0.6, d * d);
          float on = min(1.0, p.w * 8.0);
          lit += (0.7 * on + 1.65 * p.w) * inside + p.w * 0.1 * exp(-d * d * 0.4);
          wash += (0.05 * on + 0.44 * p.w) * inside;
        }
        float front = mix(1.0, 0.72, smoothstep(uFront.x, uFront.y, vAt.z));
        gl_FragColor = vec4(base * (uAmbient * front + lit * uLight) + uPool * min(wash, 0.8), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

// ---------------------------------------------------------------- the room

export class Room3D {
  /**
   * Starts the 3D look in `root`. Throws when the device has no hardware WebGL 2, so the page
   * can fall back to the flat drawing.
   *
   * @param {HTMLElement} root
   * @param {{compact: boolean, own: number, host: string, qr: string, skin?: string, concept?: boolean}} opts
   *   as for the flat drawing, plus the skin's id. `concept` lets a still use a skin that is not live.
   */
  static async open(root, opts) {
    const query = new URLSearchParams(location.search);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "The party room");
    const dpr = window.devicePixelRatio || 1;
    // A software renderer is refused (the flat drawing is better than a slow 3D one) unless a test asks for any: ?gl=any.
    const context = canvas.getContext("webgl2", { antialias: dpr < 2, alpha: false, stencil: false, depth: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: query.get("gl") !== "any" });
    if (!context) throw new Error("no hardware WebGL 2 on this device");
    const [, , images] = await Promise.all([loadStyle(), loadFonts(), loadImages()]);
    const el = document.createElement("div");
    el.className = "look3d";
    el.append(canvas);
    root.append(el);
    const skin = opts.concept && SKINS[opts.skin] ? SKINS[opts.skin] : liveSkin(opts.skin);
    return new Room3D(el, canvas, context, opts, skin, images);
  }

  constructor(el, canvas, context, opts, skin, images) {
    this.look = "3d";
    this.el = el;
    this.canvas = canvas;
    this.opts = opts;
    this.skin = skin;
    this.images = images;
    this.pieces = new Map();
    /** Who is doing which emote (emotes/play.js). */
    this.expressions = new Expressions();
    this.boxes = [];
    this.room = null;
    this.vote = null;
    this.voteAt = 0;
    this.idle = 0;
    this.size = "";
    this.slow = { ms: 16, frames: 0, tried: null, locked: false };
    this.drawn = { frames: 0, cpu: 0 };
    this.joltAt = -Infinity;
    this.joltSize = 0;

    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, context }));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
    canvas.addEventListener("webglcontextrestored", () => (this.idle = 0));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03050c);
    this.camera = new THREE.PerspectiveCamera();
    this.camera.position.set(0, CAM.y, CAM.z);
    this.camera.updateMatrixWorld();
    this.scene.add(new THREE.HemisphereLight(skin.hemiSky, skin.hemiGround, skin.hemi));
    const fill = new THREE.DirectionalLight(skin.fill, 1.25);
    fill.position.set(-3, 5, 14);
    const lamp = new THREE.DirectionalLight(skin.light, 1.5);
    lamp.position.set(0.5, 10, 2.5);
    this.scene.add(fill, lamp);

    this.radial = textureOf(
      canvasOf(128, 128, (g) => {
        const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        r.addColorStop(0, "rgba(255,255,255,1)");
        r.addColorStop(0.25, "rgba(255,255,255,.5)");
        r.addColorStop(0.6, "rgba(255,255,255,.12)");
        r.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = r;
        g.fillRect(0, 0, 128, 128);
      }),
      renderer,
    );
    this.stuff = new THREE.Group();
    this.cast = new THREE.Group();
    this.scene.add(this.stuff, this.cast);
    this.words = new Words(el, opts, skin);
    this.at = new THREE.Vector3();
    // The page's bar under the room takes the room's colours while this look is up (look3d.css).
    this.host = el.parentElement;
    const hex = (colour) => "#" + new THREE.Color(colour).getHexString();
    const accent = hex(skin.accent);
    this.hostVars = { "--amber": accent, "--l3-accent": accent, "--l3-ink": skin.words?.vars?.["--ink"] ?? "#f6d9a0", "--l3-bar": "color-mix(in srgb, " + hex(skin.fascia) + " 82%, #000)" };
    this.host?.classList.add("l3-host");
    for (const [name, value] of Object.entries(this.hostVars)) this.host?.style.setProperty(name, value);
    window.__room3d = this;
  }

  // ---------------------------------------------------------------- building

  /** Builds everything that does not move, for this room's boxes. */
  build(room) {
    this.clear(this.stuff);
    const L = (this.L = layout(room.boxes.length));
    this.half = lightHalf(L.n);
    this.shell(L);
    this.doorway(L);
    this.bulbs();
    this.boxes = room.boxes.map((box, i) => this.box(box, i, L));
    // Everything else that moves in the room is its life: look3d/life.js, from the skin's own list.
    this.life = new Life({
      skin: this.skin,
      L,
      radial: this.radial,
      add: (thing) => (this.stuff.add(thing), thing),
      texture: (canvas) => textureOf(canvas, this.renderer),
      lamps: this.boxes.map((b) => ({ group: b.lamp.swing, x: b.cx, hangs: this.skin.lamp !== "tube" && this.skin.lamp !== "dome" })),
    });
    this.life.clock(room, performance.now());
    this.coin = null;
    this.words.build(room, L);
    for (const p of this.pieces.values()) p.tag = null;
    this.idle = 0;
  }

  /** Takes a group's things out of the scene and gives their memory back. */
  clear(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) {
        for (const value of Object.values(m.uniforms ?? {})) if (value.value?.isTexture && value.value !== this.radial) value.value.dispose();
        if (m.map && m.map !== this.radial) m.map.dispose();
        m.dispose();
      }
    });
    group.clear();
  }

  /** Walls, floor and the front of the stage. They run on past the room, so any shape of screen is filled. */
  shell(L) {
    const skin = this.skin;
    const add = (mesh) => (this.stuff.add(mesh), mesh);
    const depth = SPACE.zFront - SPACE.zBack;
    const painted = (mw, mh, paint, side) => textureOf(canvasOf(Math.round(mw * TEX_K), Math.round(mh * TEX_K), (g, w, h) => paint(g, w, h, TEX_K, side, L)), this.renderer);
    // A wall with windows cut in it (what is outside them is the skin's "outside" life) is drawn with its holes.
    const windows = (skin.life ?? []).some((def) => def.kind === "outside");
    const back = add(new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w, SPACE.h), new THREE.MeshBasicMaterial({ map: painted(SPACE.w, SPACE.h, skin.wall, false), alphaTest: windows ? 0.5 : 0 })));
    back.position.set(0, SPACE.h / 2, SPACE.zBack);
    const sideTex = painted(depth, SPACE.h, skin.wall, true);
    const sideGeo = new THREE.PlaneGeometry(depth, SPACE.h);
    const sideMat = new THREE.MeshBasicMaterial({ map: sideTex, color: 0x9aa4c4 });
    for (const sgn of [-1, 1]) {
      const m = add(new THREE.Mesh(sideGeo, sideMat));
      m.position.set((sgn * SPACE.w) / 2, SPACE.h / 2, (SPACE.zFront + SPACE.zBack) / 2);
      m.rotation.y = (-sgn * Math.PI) / 2;
    }
    // Above the painted wall: its top colour carried on up, for screens taller than the room.
    const above = new THREE.MeshBasicMaterial({ color: skin.above });
    const aboveSide = new THREE.MeshBasicMaterial({ color: new THREE.Color(skin.above).multiply(new THREE.Color(0x9aa4c4)) });
    const top = add(new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w, 14), above));
    top.position.set(0, SPACE.h + 7, SPACE.zBack);
    for (const sgn of [-1, 1]) {
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(depth, 14), aboveSide));
      m.position.set((sgn * SPACE.w) / 2, SPACE.h + 7, (SPACE.zFront + SPACE.zBack) / 2);
      m.rotation.y = (-sgn * Math.PI) / 2;
    }
    this.floor = add(new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w, depth), floorMat(painted(SPACE.w, depth, skin.floor, false), skin.light)));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, 0, (SPACE.zFront + SPACE.zBack) / 2);
    // The floor carries on toward the viewer (the same boards, turned over at the join), so a
    // tall screen such as an upright phone sees floor under the room and not a dark band.
    const apron = add(new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w, depth), this.floor.material));
    apron.rotation.x = -Math.PI / 2;
    apron.scale.y = -1;
    apron.position.set(0, 0, SPACE.zFront + depth / 2);
    this.floor.material.side = THREE.DoubleSide;
    // The front of the stage, and the lit edge along it.
    const front = SPACE.zFront + depth;
    const fascia = add(new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w + 30, 14), new THREE.MeshBasicMaterial({ color: skin.fascia })));
    fascia.position.set(0, -7, front);
    const lip = add(new THREE.Mesh(new THREE.BoxGeometry(SPACE.w + 30, 0.022, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(skin.accent).multiplyScalar(0.55) })));
    lip.position.set(0, -0.02, front + 0.02);
    if (skin.rope) {
      // The lamps hang from a rope strung across the room, not from a ceiling the room does not have.
      const rope = new THREE.CatmullRomCurve3(L.gapsWalk.map((x, i) => new THREE.Vector3(x, SPACE.lampY + 1.05, SPACE.walkZ)).flatMap((p, i, all) => (i < all.length - 1 ? [p, new THREE.Vector3((p.x + all[i + 1].x) / 2, SPACE.lampY + 0.62, SPACE.walkZ)] : [p])));
      add(new THREE.Mesh(new THREE.TubeGeometry(rope, 64, 0.02, 5), new THREE.MeshBasicMaterial({ color: skin.cord })));
    }
    if (skin.skirt) {
      const skirt = add(new THREE.Mesh(new THREE.BoxGeometry(SPACE.w, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: skin.accent, transparent: true, opacity: 0.4 })));
      skirt.position.set(0, 0.03, SPACE.zBack + 0.02);
    }
    this.frameMat = new THREE.MeshStandardMaterial({ color: skin.frame, roughness: 0.6 });
    this.goldMat = new THREE.MeshBasicMaterial({ color: skin.accent });
  }

  /** The door latecomers come through, at the left end. Some rooms paint their own way in on the wall. */
  doorway(L) {
    if (this.skin.doorway !== "door") return;
    const x = L.doorX;
    const [w, h] = [1.0, 2.2];
    const z = SPACE.zBack;
    const warm = new THREE.Color(0xffc777);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshStandardMaterial({ color: this.skin.door, roughness: 0.55 }));
    leaf.position.set(x, h / 2, z + 0.04);
    const frame = new THREE.Mesh(
      joined([
        [new THREE.BoxGeometry(0.08, h + 0.08, 0.12), -w / 2 - 0.04, h / 2 + 0.04, 0],
        [new THREE.BoxGeometry(0.08, h + 0.08, 0.12), w / 2 + 0.04, h / 2 + 0.04, 0],
        [new THREE.BoxGeometry(w + 0.16, 0.08, 0.12), 0, h + 0.04, 0],
        [new THREE.RingGeometry(0.13, 0.175, 32), 0, 1.6, 0.025],
      ]),
      this.frameMat,
    );
    frame.position.set(x, 0, z + 0.06);
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), new THREE.MeshBasicMaterial({ color: warm }));
    port.position.set(x, 1.6, z + 0.075);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.3, metalness: 0.4 }));
    knob.position.set(x + 0.36, 1.05, z + 0.1);
    const portGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), glowMat(this.radial, warm, 0.22));
    portGlow.position.set(x, 1.6, z + 0.1);
    const sill = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.06, 0.03), new THREE.MeshBasicMaterial({ color: warm }));
    sill.position.set(x, 0.02, z + 0.075);
    this.stuff.add(leaf, frame, port, knob, portGlow, sill);
  }

  /** A string of small bulbs, where the room has one: two meshes for all of them. */
  bulbs() {
    const colours = this.skin.bulbs;
    if (!colours) return;
    const n = 25;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 6), new THREE.MeshBasicMaterial(), n);
    const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.7), glowMat(this.radial, 0xffffff, 0.5), n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      o.position.set((t - 0.5) * (SPACE.w - 0.6), 5.62 + Math.pow(((t * 4) % 1) - 0.5, 2) * 1.2, SPACE.zBack + 0.5);
      o.updateMatrix();
      const col = new THREE.Color(colours[i % colours.length]);
      bulbs.setMatrixAt(i, o.matrix);
      bulbs.setColorAt(i, col.clone().multiplyScalar(1.6));
      o.position.z += 0.02;
      o.updateMatrix();
      glows.setMatrixAt(i, o.matrix);
      glows.setColorAt(i, col);
    }
    this.stuff.add(bulbs, glows);
  }

  /** A lamp's head, in the room's own kind: {group, glows: [{mat, base, off, on}], halo, haloY}. */
  lampHead(i) {
    const skin = this.skin;
    const g = new THREE.Group();
    const glows = [];
    const lit = new THREE.Color(skin.light);
    const dark = new THREE.MeshBasicMaterial({ color: skin.cord });
    const shine = (mesh, base, off, on) => (glows.push({ mat: mesh.material, base: new THREE.Color(base), off, on }), g.add(mesh), mesh);
    let haloY = 0.02;
    if (skin.lamp === "lantern") {
      // A paper lantern.
      const paper = shine(new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), new THREE.MeshBasicMaterial()), skin.shade, 0.35, 1.25);
      paper.scale.y = 1.12;
      paper.position.y = 0.3;
      const caps = new THREE.Mesh(joined([[new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), 0, 0.02, 0], [new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), 0, 0.58, 0]]), new THREE.MeshBasicMaterial({ color: 0x1a120a }));
      g.add(caps);
      for (const y of [0.16, 0.3, 0.44]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(y === 0.3 ? 0.272 : 0.235, 0.006, 5, 32), new THREE.MeshBasicMaterial({ color: 0x7a3a10 }));
        rib.rotation.x = Math.PI / 2;
        rib.position.y = y;
        g.add(rib);
      }
      haloY = 0.3;
    } else if (skin.lamp === "ring") {
      // A neon ring.
      const ring = shine(new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 10, 48), new THREE.MeshBasicMaterial()), skin.accent, 0.15, 1.5);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.08;
      const inner = shine(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 36), new THREE.MeshBasicMaterial()), lit, 0.06, 1.6);
      inner.rotation.x = Math.PI / 2;
      inner.position.y = 0.08;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), dark);
      cap.position.y = 0.26;
      g.add(cap);
    } else if (skin.lamp === "tube") {
      // A neon tube in the box's own colour, hung flat.
      const tube = shine(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.95, 10), new THREE.MeshBasicMaterial()), skin.neon[i % skin.neon.length], 0.15, 1.6);
      tube.rotation.z = Math.PI / 2;
      tube.position.y = 0.1;
      const holder = new THREE.Mesh(joined([[new THREE.BoxGeometry(1.06, 0.06, 0.12), 0, 0.17, 0], [new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), -0.4, 0.44, 0], [new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), 0.4, 0.44, 0]]), dark);
      g.add(holder);
      haloY = 0.1;
    } else if (skin.lamp === "dome") {
      // A caged bulkhead light.
      const glass = shine(new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial()), lit, 0.08, 1.5);
      glass.position.y = 0.2;
      const brass = new THREE.MeshStandardMaterial({ color: skin.shade, roughness: 0.4, metalness: 0.3 });
      const cap = new THREE.Mesh(joined([[new THREE.CylinderGeometry(0.26, 0.26, 0.08, 20), 0, 0.24, 0], [new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), 0, 0.36, 0]]), brass);
      g.add(cap);
      for (const a of [0, Math.PI / 2]) {
        const bar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 5, 20, Math.PI), brass);
        bar.rotation.set(Math.PI, a, 0);
        bar.position.y = 0.2;
        g.add(bar);
      }
      haloY = 0.1;
    } else if (skin.lamp === "globe") {
      // A glass globe on a brass fitting.
      const globe = shine(new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 14), new THREE.MeshBasicMaterial()), skin.shade, 0.22, 1.35);
      globe.position.y = 0.16;
      const brass = new THREE.MeshStandardMaterial({ color: skin.frame, roughness: 0.4, metalness: 0.3 });
      const cap = new THREE.Mesh(joined([[new THREE.CylinderGeometry(0.09, 0.14, 0.1, 14), 0, 0.36, 0], [new THREE.CylinderGeometry(0.2, 0.2, 0.025, 20), 0, 0.42, 0]]), brass);
      g.add(cap);
      haloY = 0.16;
    } else {
      // A metal shade with the light inside it.
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.36, 0.3, 32, 1, true), new THREE.MeshStandardMaterial({ color: skin.shade, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }));
      shade.position.y = 0.15;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 14), new THREE.MeshStandardMaterial({ color: skin.cord, roughness: 0.5 }));
      cap.position.y = 0.36;
      g.add(shade, cap);
      const bulb = shine(new THREE.Mesh(new THREE.CircleGeometry(0.33, 32), new THREE.MeshBasicMaterial()), lit, 0.06, 1.6);
      bulb.rotation.x = Math.PI / 2;
      bulb.position.y = 0.03;
    }
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(this.radial, skin.light, 0));
    halo.position.set(0, haloY, 0.05);
    g.add(halo);
    return { group: g, glows, halo };
  }

  /** One game box: lamp, cone of light, pool on the floor, and the box in its frame on the wall. */
  box(box, i, L) {
    const skin = this.skin;
    const add = (mesh) => (this.stuff.add(mesh), mesh);
    const b = { box, i, cx: boxCentre(i, L.n), level: 0, aim: 0, gold: 0, goldAim: 0, shown: -1, lead: null };
    const x = walkX(b.cx);
    const z = SPACE.walkZ;
    const radius = (this.half + 12) * PX;
    b.pool = new THREE.Vector4(x, z, radius, 0);

    // The lamp, its cord, its beam and the edge of its pool.
    b.lamp = this.lampHead(i);
    // The head hangs from a point above it, so that it can swing (look3d/life.js sets it going).
    const hang = skin.rope ? 0.62 : 1.6;
    b.lamp.swing = new THREE.Group();
    b.lamp.swing.position.set(x, SPACE.lampY + hang, z);
    b.lamp.group.position.y = -hang;
    b.lamp.swing.add(b.lamp.group);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, hang - 0.4, 6), new THREE.MeshBasicMaterial({ color: skin.cord }));
    cord.position.y = -(hang - 0.4) / 2;
    b.lamp.swing.add(cord);
    add(b.lamp.swing);
    if (!skin.rope) {
      const flex = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 12, 6), cord.material));
      flex.position.set(x, SPACE.lampY + hang + 6, z);
    }
    b.cone = add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, radius, SPACE.lampY, 48, 1, true), coneMat(skin.light)));
    b.cone.position.set(x, SPACE.lampY / 2, z);
    // The pool keeps a faint edge even when its lamp is out, so it still reads as a place.
    b.ring = add(new THREE.Mesh(new THREE.RingGeometry(radius - 0.018, radius + 0.018, 72), new THREE.MeshBasicMaterial({ color: skin.light, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false })));
    b.ring.rotation.x = -Math.PI / 2;
    b.ring.position.set(x, 0.006, z);
    b.ringLight = new THREE.Color(skin.light);
    b.ringGold = new THREE.Color(skin.accent);
    // Light spilling up the wall behind a bright pool.
    b.spill = add(new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.0), glowMat(this.radial, skin.light, 0)));
    b.spill.position.set(L.xs[i], 0.1, SPACE.zBack + 0.03);

    // On the wall: the frame, the box in it, and the glow behind a box that leads.
    const g = new THREE.Group();
    g.position.set(L.xs[i], L.by, SPACE.zBack);
    const [nw, nh] = [L.bw + FRAME.gap * 2, L.bh + FRAME.gap * 2];
    const neon = skin.neon ? new THREE.Color(skin.neon[i % skin.neon.length]) : null;
    const tex = textureOf(boxArt(box, this.images), this.renderer);
    b.art = new THREE.MeshBasicMaterial({ map: tex });
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh), new THREE.MeshBasicMaterial({ color: new THREE.Color(skin.panel).multiplyScalar(1.25) }));
    inner.position.z = 0.012;
    const bar = FRAME.bar;
    b.frame = new THREE.Mesh(
      joined([
        [new THREE.BoxGeometry(bar, nh + bar * 2, FRAME.depth), -nw / 2 - bar / 2, 0, 0],
        [new THREE.BoxGeometry(bar, nh + bar * 2, FRAME.depth), nw / 2 + bar / 2, 0, 0],
        [new THREE.BoxGeometry(nw, bar, FRAME.depth), 0, nh / 2 + bar / 2, 0],
        [new THREE.BoxGeometry(nw, bar, FRAME.depth), 0, -nh / 2 - bar / 2, 0],
      ]),
      this.frameMat,
    );
    b.frame.position.z = FRAME.depth / 2;
    const side = new THREE.MeshLambertMaterial({ color: boxSide(box) });
    const carton = new THREE.Mesh(new THREE.BoxGeometry(L.bw, L.bh, 0.3), [side, side, side, side, b.art, side]);
    carton.position.z = 0.2;
    g.add(inner, b.frame, carton);
    if (skin.trim === "bolts") {
      // Rivets round the frame: trim only, the frame is the same frame.
      const rivets = [];
      for (const sx of [-1, 1]) for (let k = 0; k <= 6; k++) rivets.push([new THREE.SphereGeometry(0.028, 6, 5), sx * (nw / 2 + FRAME.bar / 2), (k / 6 - 0.5) * (nh + FRAME.bar), FRAME.depth]);
      for (const sy of [-1, 1]) for (let k = 1; k < 4; k++) rivets.push([new THREE.SphereGeometry(0.028, 6, 5), (k / 4 - 0.5) * nw, sy * (nh / 2 + FRAME.bar / 2), FRAME.depth]);
      g.add(new THREE.Mesh(joined(rivets), new THREE.MeshLambertMaterial({ color: 0xe6c27a })));
    }
    if (neon) {
      b.neonMat = new THREE.MeshBasicMaterial({ color: neon.clone().multiplyScalar(1.25) });
      b.neonGlow = new THREE.Mesh(new THREE.PlaneGeometry(nw + 1.3, nh + 1.3), glowMat(this.radial, neon, 0.55));
      b.neonGlow.position.z = 0.02;
      g.add(b.neonGlow);
    }
    b.glow = new THREE.Mesh(new THREE.PlaneGeometry(nw + 1.5, nh + 1.5), glowMat(this.radial, skin.accent, 0));
    b.glow.position.z = 0.025;
    g.add(b.glow);
    add(g);
    return b;
  }

  /** The gold coin of a coin toss, made the first time there is one. */
  makeCoin() {
    const face = textureOf(
      canvasOf(256, 256, (g) => {
        const rim = g.createRadialGradient(128, 128, 20, 128, 128, 128);
        rim.addColorStop(0, "#ffe89a");
        rim.addColorStop(0.75, "#eeb844");
        rim.addColorStop(1, "#b17a1c");
        g.fillStyle = rim;
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = "#9a6614";
        g.lineWidth = 7;
        g.beginPath();
        g.arc(128, 128, 98, 0, 7);
        g.stroke();
        g.fillStyle = "#9a6614";
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const r = i % 2 ? 31 : 75;
          g.lineTo(128 + Math.sin(a) * r, 128 - Math.cos(a) * r);
        }
        g.fill();
      }),
      this.renderer,
    );
    const faceMat = new THREE.MeshBasicMaterial({ map: face, color: 0xfff2d8 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.09, 40), [new THREE.MeshBasicMaterial({ color: 0xb8831f }), faceMat, faceMat]);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), glowMat(this.radial, 0xffd27a, 0.55));
    this.coin = { coin, halo };
    this.stuff.add(coin, halo);
  }

  // ---------------------------------------------------------------- what changes

  setCompact(compact, room, now) {
    this.opts.compact = compact;
    this.words.setCompact(compact);
    for (const p of this.pieces.values()) p.look = "";
    this.setRoom(room, now);
  }

  /** The room changed: who is here, the code, the board. */
  setRoom(room, now) {
    this.room = room;
    const seen = new Set();
    for (const m of room.members) {
      if (!m) continue;
      seen.add(m.seat);
      let p = this.pieces.get(m.seat);
      if (!p || p.leaving) {
        if (p) this.removePiece(p);
        p = this.piece(m);
        this.pieces.set(m.seat, p);
      }
      // The room's word on where a piece is: news for everyone's piece but the viewer's own,
      // which is moved by its Pilot.
      p.net = { x: m.x, d: m.d, t: now };
      if (m.d) p.face = m.d;
      if (p.rev !== m.rev) p.rx = m.x; // the room put it somewhere: no sliding across the floor
      p.rev = m.rev;
      const look = `${m.name}/${m.connected}/${m.colour}`;
      if (p.look !== look) {
        p.look = look;
        dressPawn(p.pawn, m.colour, m.connected);
      }
      p.member = m;
      // On the floor or just up from it already (this page arrived in the middle of a bump).
      resumeKnock(p, m.x, m.down ?? 0, m.safe ?? 0, now);
    }
    for (const [seat, p] of this.pieces) {
      if (!seen.has(seat) && !p.leaving) p.leaving = now;
    }
    this.words.setRoom(room);
    this.life?.clock(room, now);
    this.setVote(room.vote, now);
  }

  setVote(vote, now) {
    this.vote = vote;
    this.voteAt = now;
    this.idle = 0;
  }

  piece(m) {
    const p = { fx: { char: 0, hopAt: -Infinity }, seat: m.seat, rx: m.x, net: { x: m.x, d: m.d, t: 0 }, face: 1, rev: m.rev, jumpAt: -Infinity, attack: null, knock: null, leaving: 0, level: 0, look: "", tag: null, member: m };
    p.pawn = makePawn(this.radial);
    p.pawn.ring.visible = m.seat === this.opts.own;
    this.cast.add(p.pawn.group, p.pawn.blob, p.pawn.ring);
    return p;
  }

  removePiece(p) {
    this.cast.remove(p.pawn.group, p.pawn.blob, p.pawn.ring);
    p.emote?.arms.dispose();
    p.emote?.figure.remove();
    p.sticker?.remove();
    this.expressions.stop(p.seat);
    disposePawn(p.pawn);
    p.tag?.el.remove();
  }

  /** Someone moved: where they are and which way they walk, as of now. */
  onMove(msg, now) {
    const p = this.pieces.get(msg.s);
    if (!p) return;
    p.net = { x: msg.x, d: msg.d, t: now };
    if (msg.d) p.face = msg.d;
    if (msg.j) p.jumpAt = now;
  }

  /** A bump: the bumper lunges, and whoever it lands on is knocked along. How that looks is pieces.js, bumpPose. */
  onBump(msg, now) {
    const by = this.pieces.get(msg.s);
    const landed = msg.to >= 0;
    let began = now;
    if (by) {
      by.face = msg.f || by.face;
      if (msg.s === this.opts.own && by.attack && now - by.attack.at < 600) {
        // The viewer's own bump began when the button went down (ownBump), not when the room answered.
        by.attack.landed = landed;
        began = Math.max(by.attack.at, now - IMPACT_MS);
      } else startAttack(by, msg.f, now, landed);
    }
    const hit = landed ? this.pieces.get(msg.to) : null;
    if (hit) {
      hit.net = { x: msg.x, d: 0, t: now };
      hit.rev = msg.rev;
      startKnock(hit, msg.x, began);
    }
    // If it happened by the room's feature, the feature is knocked too (look3d/life.js).
    // Where they are is taken from what the room said, not from where this device has drawn them
    // so far, so that a slow screen and a fast one agree.
    this.life?.onBump(by ? (msg.s === this.opts.own ? by.rx : posAt(by.net, now)) : null, hit ? msg.x : null);
  }

  /** Where a blow lands: a burst of sparks, a flash, and a jolt of the picture. The place is {x, y} in world units. */
  burst(at, now, calm) {
    this.life.emit("bump.hit");
    this.joltAt = now;
    this.joltSize = 9;
    if (calm) return;
    place(at.x, at.y, SPACE.walkZ + 0.2, this.at);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const fast = i % 2 ? 2.6 : 1.5;
      this.life.sparks.add(this.at.x, this.at.y, this.at.z, Math.cos(a) * fast, Math.sin(a) * fast, 0.28, i % 2 ? 0.2 : 0.3, i % 2 ? 0xfff6d8 : 0xffd75e, 0);
    }
    this.life.sparks.add(this.at.x, this.at.y, this.at.z, 0, 0, 0.2, 1.3, 0xfff6d8, 0, 0.6);
  }

  /** Where a knocked piece comes down: dust along the floor, and a smaller jolt. */
  dust(x, now, calm) {
    this.life.emit("bump.floor");
    this.joltAt = now;
    this.joltSize = 5;
    if (calm) return;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      this.life.smoke.add(walkX(x) + side * 0.1, 0.07, SPACE.walkZ + 0.12, side * (0.5 + (i >> 1) * 0.45), 0.12 + i * 0.04, 0.45, 0.24, this.skin.dust ?? 0x6a5a4a, 0, 1.3);
    }
  }

  /**
   * The ring under the viewer's own piece: it fills as the bump recharges and flashes when it
   * is ready. It is given the viewer's Pilot. Returns true while it is changing.
   */
  cooldown(own, now) {
    const mine = own ? this.pieces.get(this.opts.own) : null;
    const left = mine && own.cooling ? own.cooling(now) : 0;
    const cooling = left > 0;
    if (cooling !== this.cooling) {
      this.cooling = cooling;
      if (!cooling) this.readyAt = now;
    }
    const flash = (now - (this.readyAt ?? -Infinity)) / 420;
    if (!mine || (!cooling && !(flash < 1))) {
      if (this.coolRing) this.coolRing.visible = false;
      return false;
    }
    if (!this.coolRing) {
      // Twenty-four arcs, made once: the ring is whichever is as full as the cooldown.
      this.coolArcs = Array.from({ length: 25 }, (_, i) => new THREE.RingGeometry(0.52, 0.6, 40, 1, Math.PI / 2, -Math.max(0.001, (i / 24) * Math.PI * 2)));
      this.coolRing = new THREE.Mesh(this.coolArcs[0], new THREE.MeshBasicMaterial({ color: this.skin.accent, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      this.coolRing.rotation.x = -Math.PI / 2;
      this.coolRing.renderOrder = 3;
      this.cast.add(this.coolRing);
    }
    const ring = this.coolRing;
    ring.visible = true;
    ring.geometry = this.coolArcs[cooling ? Math.round(cooldownFraction(left) * 24) : 24];
    ring.position.set(walkX(mine.rx), 0.014, SPACE.walkZ);
    ring.scale.setScalar(cooling ? 1 : 1 + flash * 0.4);
    ring.material.opacity = cooling ? 0.9 : 1 - flash;
    return true;
  }

  /** The viewer's own piece began a bump: it winds up at once, before the room has said who it hit. */
  ownBump(now) {
    const p = this.pieces.get(this.opts.own);
    if (p) startAttack(p, p.face, now);
  }

  /** A blow jolts the picture for a moment: how far, in world units. (The frame applies it; this is for the page, which need not.) */
  jolt(now) {
    const u = (now - this.joltAt) / 170;
    if (!(u >= 0 && u < 1) || this.life?.calmQuery?.matches) return { x: 0, y: 0 };
    const k = this.joltSize * (1 - u);
    return { x: Math.sin(u * 30) * k, y: Math.cos(u * 23) * k * 0.6 };
  }

  /** Someone sent an emote (room-view.js): it starts on their piece now, in place of any they were doing. */
  onExpress(msg, now) {
    const where = [...this.pieces.values()].filter((p) => !p.leaving).map((p) => ({ seat: p.seat, x: p.rx, face: p.face }));
    this.expressions.start(msg.s, msg.e, now, where);
  }

  /**
   * A piece's emote for this frame, after its pawn is posed: the body's lean and lift and the
   * red of fuming on the pawn, the arms as meshes (emote-arms.js), and the props, effects and
   * the word over its head in SVG over the picture (emotes/svg.js), placed the way the name
   * tags are. Returns whether one is on.
   */
  express(p, now, view, calm) {
    const e = this.expressions.pose(p.seat, now, (seat) => this.pieces.get(seat)?.rx, calm);
    if (!e) {
      if (p.emote) {
        p.emote.arms.dispose();
        p.emote.figure.remove();
        p.emote = null;
        p.sticker.show(null);
      }
      return false;
    }
    const colour = p.member?.colour ?? "#8a8d94";
    if (!p.emote) {
      const figure = new EmoteFigure(colour, { face: false, limbs: false });
      this.words.emotes.append(figure.stage, figure.body);
      p.emote = { arms: new EmoteArms(p.pawn, colour), figure };
      p.sticker ??= new Sticker(this.words.stickers);
    }
    const pawn = p.pawn;
    const b = e.pose.body;
    // The body: lifted, nudged and leaned about its foot, on top of whatever the walk and the bump did.
    const metres = RIG_UNIT * (PAWN_HEIGHT * PX / 1.115);
    pawn.group.position.x += b.dx * metres;
    pawn.group.position.y += b.lift * metres;
    pawn.tilt.rotation.z -= (b.rot * Math.PI) / 180;
    if (b.tint > 0) {
      pawn.mat.color.lerp(FUMING, b.tint * 0.8);
      pawn.mat.emissive.lerp(FUMING, b.tint * 0.6);
    }
    p.emote.arms.set(e.pose);
    // In SVG: room units become world units at the walking line (S), then screen pixels (k).
    const k = view.scale;
    const S = RIG_UNIT * (PAWN_HEIGHT / 1.115);
    const gx = 960 + pawn.group.position.x / PX;
    const gy = FEET_Y - pawn.group.position.y / PX;
    const spin = (-pawn.tilt.rotation.z * 180) / Math.PI;
    const px = (x, y) => `${((x - view.x) * k).toFixed(1)},${((y - view.y) * k).toFixed(1)}`;
    p.emote.figure.body.setAttribute("transform", `translate(${px(gx, gy)}) rotate(${spin.toFixed(2)}) scale(${(k * S).toFixed(4)})`);
    p.emote.figure.stage.setAttribute("transform", `translate(${px(p.rx, FEET_Y)}) scale(${(k * S).toFixed(4)})`);
    p.emote.figure.draw(e.pose, e.toward);
    // The word: over the name tag and whatever the emote holds up, a little larger than the tag's words, and never too small to read.
    const tagTop = FEET_Y - PAWN_HEIGHT - 16 - p.up - p.level * ((p.tag?.h ?? 30) + 6) - (p.tag?.h ?? 30);
    const y = Math.min(tagTop - 6, gy + poseTop(e.pose) * S);
    const scale = Math.max(0.62, k * 0.9 * (this.opts.compact ? 1.2 : 1));
    const [sx, sy] = px(gx, y).split(",").map(Number);
    p.sticker.show(e.word, sx, sy, scale, e.pop);
    return true;
  }

  /** The viewer's own piece jumped (its Pilot says so; nothing comes back from the room). */
  ownJump(now) {
    const p = this.pieces.get(this.opts.own);
    if (p) p.jumpAt = now;
  }

  /** Where the viewer's own piece is drawn, for the camera. */
  ownX() {
    return this.pieces.get(this.opts.own)?.rx ?? 960;
  }

  // ---------------------------------------------------------------- every frame

  /** How bright the light is at a world x: 0 in the dark, 1 under a lamp with a crowd. */
  lightAt(x) {
    let best = 0;
    for (const b of this.boxes) {
      const d = Math.abs(x - b.cx);
      if (d < this.half + 40) best = Math.max(best, Math.min(1, b.level * 0.85) * Math.min(1, (this.half + 40 - d) / 40));
    }
    return Math.max(best, this.life.warmth(x));
  }

  /** Fits the picture to the element, at a pixel ratio the device can afford. */
  resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const size = `${w}x${h}x${this.ratio.toFixed(3)}`;
    if (size === this.size || !w || !h) return false;
    this.size = size;
    const ratio = Math.min(this.ratio, Math.sqrt(MAX_PIXELS / (w * h)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    return true;
  }

  /**
   * Slow frames: draw fewer pixels. One step is tried at a time; if a step does not make frames
   * faster the device is held back by something else (a 30 a second battery saver, say), so
   * the step is undone and nothing more is tried.
   */
  govern(dt) {
    const s = this.slow;
    if (s.locked || dt <= 0 || dt > 0.25) return;
    s.ms += (dt * 1000 - s.ms) * 0.05;
    if (++s.frames < 90) return;
    if (s.tried) {
      if (s.ms > s.tried.ms * 0.88) {
        this.ratio = s.tried.ratio;
        s.locked = true;
      }
      s.tried = null;
      s.frames = 0;
    } else if (s.ms > 24 && this.ratio > 0.75) {
      s.tried = { ratio: this.ratio, ms: s.ms };
      this.ratio = Math.max(0.75, this.ratio * 0.8);
      s.frames = 0;
    }
  }

  /**
   * Draws one frame. `own` is the viewer's Pilot (or null for a screen), `view` the part of
   * the room to show, in world units (lobby/shared/camera.js).
   */
  frame(now, dt, own, frame) {
    let busy = this.resize();
    // The page eases the frame's corner and size and leaves its scale behind, so work the scale out.
    // A blow jolts the picture for a moment; the framing itself does not move.
    const jolt = this.jolt(now);
    if (jolt.x || jolt.y) busy = true;
    const view = { x: frame.x + jolt.x, y: frame.y + jolt.y, width: frame.width, height: frame.height, scale: (this.el.clientWidth || 1) / frame.width };
    if (this.words.frame(view) || busy) {
      // The frame slides and scales; the camera stays where it is.
      const k = 1 / D_WALL;
      this.camera.projectionMatrix.makePerspective(wallX(view.x) * k, wallX(view.x + view.width) * k, (wallY(view.y) - CAM.y) * k, (wallY(view.y + view.height) - CAM.y) * k, 1, 90);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      busy = true;
    }

    // Lights: each eases to how many stand in it, and the leading one turns gold.
    const vote = this.vote;
    const lobby = this.room.phase === "lobby";
    const tossLeft = vote.toss ? vote.toss.endsIn - (now - this.voteAt) : 0;
    const landed = !!vote.toss && tossLeft < vote.toss.of * 0.3;
    const ease = 1 - Math.exp(-dt * 7);
    const states = this.boxes.map((b) => {
      const id = b.box.id;
      const why = vote.lights[id];
      const on = why === null && lobby;
      const here = Object.values(vote.standing).filter((v) => v === id).length;
      const leading = !!vote.count && vote.leaders.length === 1 && vote.leaders[0] === id;
      const tied = !!vote.toss && vote.toss.between.includes(id);
      const gold = leading || (tied && landed && vote.toss.winner === id);
      const side = tied ? (vote.toss.between.length === 2 ? ["Heads", "Tails"] : ["A", "B", "C", "D", "E"])[vote.toss.between.indexOf(id)] : null;
      b.aim = on ? LEVELS[Math.min(here, LEVELS.length - 1)] : 0;
      b.goldAim = gold ? 1 : 0;
      b.on = on;
      return { on, why, here, gold, tied, landed, side };
    });
    this.words.paint(states);
    const pools = this.floor.material.uniforms.uPools.value;
    this.boxes.forEach((b, i) => {
      b.level += (b.aim - b.level) * ease;
      b.gold += (b.goldAim - b.gold) * ease;
      if (Math.abs(b.aim - b.level) < 0.003) b.level = b.aim;
      if (Math.abs(b.goldAim - b.gold) < 0.003) b.gold = b.goldAim;
      const key = b.level * 1000 + b.gold;
      if (key !== b.shown) {
        b.shown = key;
        busy = true;
        this.light(b);
      }
      if (i < MAX_POOLS) pools[i].copy(b.pool).setW(b.level);
    });

    // Pieces: the player's own from its Pilot, everyone else's eased toward where they should be.
    const ordered = [];
    const alive = [];
    const calm = !!this.life.calmQuery?.matches;
    for (const [seat, p] of this.pieces) {
      let alpha = 1;
      if (p.leaving) {
        const gone = (now - p.leaving) / 900;
        if (gone >= 1) {
          this.removePiece(p);
          this.pieces.delete(seat);
          busy = true;
          continue;
        }
        fadePawn(p.pawn, 1 - gone);
        alpha = 1 - gone;
        busy = true;
      }
      let walking = false;
      if (own && seat === this.opts.own) {
        p.rx = own.x;
        p.face = own.face;
        walking = own.d !== 0 && own.x > ROOM.minX && own.x < ROOM.maxX;
      } else {
        const target = posAt(p.net, now);
        p.rx += (target - p.rx) * (1 - Math.exp(-dt * EASE));
        if (Math.abs(target - p.rx) < 0.3) p.rx = target;
        walking = (p.net.d !== 0 && target > ROOM.minX && target < ROOM.maxX) || Math.abs(target - p.rx) > 6;
      }
      const pose = posePawn(p.pawn, p, now, dt, { walking, lit: this.lightAt(p.rx), calm });
      if (pose.burst) this.burst(pose.burst, now, calm);
      if (pose.dust !== null) this.dust(pose.dust, now, calm);
      alive.push({ seat, x: p.rx, up: pose.up, air: p.pawn.air, fx: p.fx });
      if (pose.moving) busy = true;
      p.up = pose.up;
      p.shock = pose.shock;
      p.alpha = alpha;
      if (!p.tag) {
        p.tag = this.words.tag();
      }
      this.words.dressTag(p.tag, p.member);
      ordered.push(p);
    }
    // Name tags that would sit on top of each other step up instead.
    ordered.sort((a, b) => a.rx - b.rx);
    let prev = null;
    for (const p of ordered) {
      const want = prev && p.rx - prev.rx < (p.tag.w + prev.tag.w) / 2 + 8 ? (prev.want + 1) % 4 : 0;
      p.want = want;
      if (Math.abs(want - p.level) > 0.004) busy = true;
      p.level += (want - p.level) * Math.min(1, dt * 12);
      this.words.placeTag(p.tag, view, p.rx, p.up, p.level, p.shock, p.alpha);
      if (this.express(p, now, view, calm)) busy = true;
      prev = p;
    }

    // Under the viewer's own piece: how far its bump has recharged.
    if (this.cooldown(own, now)) busy = true;

    // The count and the toss.
    if (vote.count && lobby) {
      const b = vote.leaders.length === 1 ? this.boxes.find((x) => x.box.id === vote.leaders[0]) : null;
      this.words.drawCount(view, Math.max(0, vote.count.endsIn - (now - this.voteAt)), COUNT_MS, b ? b.cx + (this.L.bw * U) / 2 + 22 : 960);
      busy = true;
    } else this.words.drawCount(view, null);
    busy = this.toss(now, view) || busy;

    // Draw: every frame while anything moves, a third as often when the room is still.
    // The room's own life: 2 while something is happening, 1 for its ambient loops alone.
    const lively = this.life.frame(now, dt, view, alive);
    if (lively === 2) busy = true;
    this.govern(dt);
    this.idle = busy ? 0 : this.idle + 1;
    // Draw every frame while anything moves; every other frame for ambient life alone; a third as often when the room is still.
    if (this.idle > 2 && this.idle % (lively ? 2 : 3)) return;
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.drawn.cpu += performance.now() - t0;
    this.drawn.frames++;
  }

  /** Sets a box's lamp, beam, pool edge, picture and frame for its level of light (0 is off). */
  light(b) {
    const level = b.level;
    const glowing = Math.min(1, level * 8);
    const bright = Math.min(1, 0.02 + level * 0.9);
    for (const glow of b.lamp.glows) glow.mat.color.copy(glow.base).multiplyScalar(glow.off + (glow.on - glow.off) * bright);
    b.lamp.halo.material.opacity = (0.18 + 0.5 * Math.min(level, 1.3)) * glowing;
    b.lamp.halo.scale.setScalar(1.1 + level * 0.9);
    b.cone.material.uniforms.uStrength.value = Math.min(0.3, 0.06 * glowing + 0.18 * level);
    b.cone.visible = level > 0.002;
    b.ring.material.color.copy(b.ringLight).lerp(b.ringGold, b.gold);
    b.ring.material.opacity = Math.max(0.05 + 0.11 * glowing + 0.34 * Math.min(level, 1.2), b.gold);
    b.spill.material.opacity = 0.1 * level;
    b.art.color.setScalar(0.34 + 0.56 * glowing + 0.22 * b.gold);
    b.glow.material.opacity = 0.5 * b.gold;
    const lead = b.gold > 0.5 ? this.goldMat : glowing > 0.5 && b.neonMat ? b.neonMat : this.frameMat;
    if (b.frame.material !== lead) b.frame.material = lead;
    if (b.neonGlow) b.neonGlow.material.opacity = 0.55 * glowing * (1 - b.gold);
  }

  /** The coin toss: the coin spins in the air between the tied boxes, then comes down on the winner. */
  toss(now, view) {
    const toss = this.vote.toss;
    if (!toss) {
      if (this.coin) this.coin.coin.visible = this.coin.halo.visible = false;
      this.words.drawToss(view, null);
      return false;
    }
    if (!this.coin) this.makeCoin();
    const { coin, halo } = this.coin;
    const u = Math.min(1, Math.max(0, 1 - (toss.endsIn - (now - this.voteAt)) / toss.of));
    const centres = toss.between.map((id) => this.boxes.find((b) => b.box.id === id)?.cx ?? 960);
    const mid = (Math.min(...centres) + Math.max(...centres)) / 2;
    const win = centres[toss.between.indexOf(toss.winner)];
    const fall = Math.max(0, (u - 0.62) / 0.38);
    const ease = fall * fall * (3 - 2 * fall);
    const x = mid + (win - mid) * ease;
    const y = Math.max(view.y + 215, 250) - Math.sin(Math.min(1, u / 0.62) * Math.PI) * 60 + ease * 40;
    coin.visible = halo.visible = true;
    place(x, y, SPACE.zBack + 0.9, coin.position);
    halo.position.copy(coin.position);
    halo.position.z -= 0.3;
    // Face on once it has landed; tumbling end over end until then.
    coin.rotation.set(Math.PI / 2 + (u < 0.7 ? u * 46 : 0), 0, 0.2);
    this.words.drawToss(view, mid);
    return true;
  }

  /** For tests and for measuring: how much is being drawn, and at what size. */
  stats() {
    const info = this.renderer.info.render;
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      skin: this.skin.id,
      calls: info.calls,
      triangles: info.triangles,
      ratio: this.renderer.getPixelRatio(),
      size: [this.canvas.width, this.canvas.height],
      drawnFrames: this.drawn.frames,
      cpuMsPerFrame: this.drawn.frames ? this.drawn.cpu / this.drawn.frames : 0,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "",
    };
  }

  destroy() {
    for (const p of this.pieces.values()) this.removePiece(p);
    this.pieces.clear();
    this.clear(this.stuff);
    this.radial.dispose();
    this.words.destroy();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.el.remove();
    this.host?.classList.remove("l3-host");
    for (const name of Object.keys(this.hostVars)) this.host?.style.removeProperty(name);
    if (window.__room3d === this) window.__room3d = null;
  }
}
