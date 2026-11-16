// The bar made real, in the party room: the owner's painting of the bar (layers/, made by
// lobby/tools/bar/layers.mjs), the rainy street outside its two windows drawn live and cut to the
// glass, and the room's real things over it, unchanged in behaviour (rendered/room-rendered.js).
//
// The painting is laid on the 3D look's room so that its wall is the back wall and its floor line
// is where the pieces' feet are; its own gold frames hold the five posters, a little larger than
// painted (the owner's pick), the join code is on the wooden sign by the door and the scores are
// chalked on its board. Where the room's numbers put the pools of light (wider apart than the
// painted frames) hang five lamps of its own, near the eye, over the pools.
//
// Its depth, near to far (the eye moves with the view: rendered/room-rendered.js, `eye`):
//   - what stands in front of the pieces: stools, a plant and candles, a chair (front.webp), which
//     the pieces walk behind at either end
//   - the walking line: the pieces, their shadows and reflections in the boards, the pools, the lamps
//   - the floor and the back wall with the bar, its frames and posters (base.webp on the room's shape)
//   - the glass, with the drops on it, then the rain at three depths, then the street far behind
//
// Its steps down the ladder, cheapest last (rendered/ladder.js; ?rung= forces them for a test):
//   drops     the drops landing and running on the glass off: the most work done drop by drop
//   rain      half the rain: at phone size the window still reads as rain
//   outside   everything outside drawn at half the room's resolution: a quarter of the pixels
import { CAM, D_WALL, SPACE, U, WALK, walkX, wallX, wallY } from "../../space.js";
import { boxArt } from "../../paint.js";
import * as THREE from "../../three.js";
import { RoomRendered } from "../room-rendered.js";
import { beamMaterial, halfOutside, loadTexture, seeded } from "../plate.js";
import { RENDERED } from "../switch.js";
import { createOutside } from "./outside.js";
import { FILL, Sprites, TILES, spriteSheet } from "./sprites.js";
import { EYE, THINGS, createLightning, createStreet, variant } from "./street.js";

const LAYERS = new URL("./layers/", import.meta.url);
const STYLE = new URL("./bar.css", import.meta.url);

/** What the street's things sound like: the names the room's sounds listen for (room-sounds.js). The bar's cat has its miaow. */
const SOUNDS = { cat: "cat.walk" };

/** The painted lights that breathe, slowly: [x, y, rx, ry (painting pixels), colour, base, amount, speed] (the preview's). */
const GLOWS = [
  [766, 182, 150, 120, 0xffd696, 0.55, 0.06, 0.7],
  [1117, 182, 150, 120, 0xffd696, 0.55, 0.06, 0.6],
  [1516, 182, 150, 120, 0xffd696, 0.55, 0.06, 0.8],
  [552, 282, 80, 95, 0xffc882, 0.5, 0.05, 0.9],
  [1384, 284, 80, 95, 0xffc882, 0.5, 0.05, 0.85],
  [300, 372, 95, 80, 0xffcd8c, 0.5, 0.06, 1.0],
  [380, 262, 110, 30, 0xffaa50, 0.35, 0.09, 1.6],
  [766, 660, 230, 46, 0xffbe78, 0.32, 0.04, 0.7],
  [1117, 660, 230, 46, 0xffbe78, 0.32, 0.04, 0.6],
  [1516, 660, 230, 46, 0xffbe78, 0.32, 0.04, 0.8],
  [330, 640, 150, 30, 0xffbe78, 0.28, 0.04, 1.0],
];
/** The candles in front, which shimmer a very little. */
const CANDLES = [
  [95, 708, 70, 70, 0xffb45a, 0.4, 0.08, 2.3],
  [1847, 604, 70, 70, 0xffb45a, 0.4, 0.08, 2.1],
];
/** What stands in front of the pieces, at this depth (metres): just behind the painting's bottom edge, well in front of the walking line. */
const FRONT_Z = 3.4;

/** The world y of the horizon: where the camera's own height is on the wall. */
const HORIZON = (6.25 - CAM.y) * U;

export class RoomBar extends RoomRendered {
  static SKIN = "bar";
  static DEF = RENDERED.bar;

  constructor(...args) {
    super(...args);
    this.lightNames = ["flash"];
    this.exposure = 1;
    this.painted = true;
    this.shine = 0;
    // (At most 1.2 metres to either side: the street behind each window has room to slide that far.)
    this.eye = EYE;
    this.still = true;
    this.frameRing = false;
    // The pools: a soft white, so the place to vote stands out from the room's own amber.
    this.voteLight = 0xfff1dc;
    // The painted lamps' warm light from above and in front, a little of the floor's glow from below, and the room in the lacquer.
    this.pieceLight = {
      hemi: { sky: 0xffd2a0, ground: 0x3a1a0a, intensity: 0.75 },
      front: { colour: 0xffd9b0, intensity: 0.95, at: [-2.5, 5.5, 11] },
      back: { colour: 0xffb870, intensity: 1.35, at: [1.5, 9, -1] },
      env: 0.55,
    };
    this.streetT = 0;
  }

  /** The plate and every picture of the room and the street, loaded together. */
  async loadLayers(opts, signal) {
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const at = (name) => new URL(name, LAYERS).href;
    const answer = await fetch(at("plate.json"), { signal });
    if (!answer.ok) throw new Error("plate.json did not load");
    const [plate, base, lights, frames, front, left, right, env] = await Promise.all([
      answer.json(),
      loadTexture(at("base.webp"), { anisotropy: aniso }),
      loadTexture(at("lights.webp"), { mips: false, anisotropy: aniso }),
      loadTexture(at("frames.webp"), { anisotropy: aniso }),
      loadTexture(at("front.webp"), { anisotropy: aniso }),
      loadTexture(at("street-left.webp"), { anisotropy: aniso }),
      loadTexture(at("street-right.webp"), { anisotropy: aniso }),
      loadTexture(at("env.webp"), { mips: false, anisotropy: aniso }),
    ]);
    env.mapping = THREE.EquirectangularReflectionMapping;
    const { scale, oy } = plate.painting;
    // The glass starts at its lowest pane.
    const lowest = Math.max(...plate.panes.flat().map((p) => p[1]));
    return { plate, base, lights, frames, front, streets: { left, right }, env, sill: wallY(oy + lowest * scale), across: (plate.rect.x1 - plate.rect.x0) / U, paint: [scale, oy] };
  }

  /** A point of the painting (painting pixels) in world units. */
  toWorld(px, py) {
    return [px * this.paint[0], this.paint[1] + py * this.paint[0]];
  }

  /** The room keeps only the dust in the lamps' light from the 3D look's life; the rest of the bar's is outside its windows. */
  ownLife(life) {
    return life.filter((def) => def.kind === "drift");
  }

  // ---------------------------------------------------------------- the wall

  /** Box i's poster, in its painted frame at the owner's size (a little larger than painted), running under the frame's gold lip. */
  posterAt(i) {
    const o = this.plate.frames[i].drawn.open;
    const lip = 7 * this.plate.posterScale;
    const [x0, y0] = this.toWorld(o.x - lip, o.y - lip);
    const [x1, y1] = this.toWorld(o.x + o.w + lip, o.y + o.h + lip);
    return { x: wallX((x0 + x1) / 2), y: wallY((y0 + y1) / 2), z: SPACE.zBack + 0.012, w: (x1 - x0) / U, h: (y1 - y0) / U, lip: lip / (o.w + 2 * lip) };
  }

  /**
   * A poster as a print in the bar's light (the preview's): fitted to the frame's opening so no
   * title is cut by the lip, a little less saturated, warmed, with the lip's shadow along its
   * edges and a faint sheen. The frame's own gold lip covers its edges.
   */
  posterArt(box, at) {
    const art = boxArt(box, this.images);
    const H = 480;
    const W = Math.round((H * at.w) / at.h);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    // The print's own paper edge is skipped (it showed inside the gold lip).
    const [ix, iy] = [art.width * 0.035, art.height * 0.035];
    const [pw, ph] = [art.width - 2 * ix, art.height - 2 * iy];
    const m = at.lip;
    const o = { x: W * m, y: H * m, w: W * (1 - 2 * m), h: H * (1 - 2 * m) };
    g.filter = "saturate(0.86) contrast(0.94)";
    // A copy stretched under it fills what runs under the gold; the print itself fills the opening.
    g.drawImage(art, ix, iy, pw, ph, 0, 0, W, H);
    g.drawImage(art, ix, iy, pw, ph, o.x - 2, o.y - 2, o.w + 4, o.h + 4);
    g.filter = "none";
    g.globalCompositeOperation = "multiply";
    g.globalAlpha = 0.55;
    g.fillStyle = "rgb(255,222,178)";
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    const lip = g.createLinearGradient(0, o.y, 0, o.y + o.h);
    lip.addColorStop(0, "rgba(70,35,10,.75)");
    lip.addColorStop(0.11, "rgba(120,70,30,0)");
    lip.addColorStop(0.92, "rgba(255,255,255,0)");
    lip.addColorStop(1, "rgba(120,70,30,.35)");
    g.fillStyle = lip;
    g.fillRect(0, 0, W, H);
    const side = g.createLinearGradient(o.x, 0, o.x + o.w, 0);
    side.addColorStop(0, "rgba(90,45,15,.45)");
    side.addColorStop(0.1, "rgba(255,255,255,0)");
    side.addColorStop(0.92, "rgba(255,255,255,0)");
    side.addColorStop(1, "rgba(90,45,15,.3)");
    g.fillStyle = side;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "screen";
    const sheen = g.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
    sheen.addColorStop(0, "rgba(255,240,215,0)");
    sheen.addColorStop(0.38, "rgba(255,240,215,0)");
    sheen.addColorStop(0.5, "rgba(255,240,215,.10)");
    sheen.addColorStop(0.62, "rgba(255,240,215,0)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, W, H);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  /**
   * A print in the room's light: a game this party cannot play is dimmer; one that can be played a
   * little dim until someone stands in its light, and brighter with each who does, as its lamp is;
   * the leader brighter still.
   */
  posterShade(lit, gold, level = 0) {
    return 0.58 + 0.24 * lit + 0.2 * Math.min(1, Math.max(0, level - 0.16) / 1.04) + 0.12 * gold;
  }

  // ---------------------------------------------------------------- the lamps

  /** Its lamp over box i: a glass shade like the painted ones, hung near the eye over the pool, that swings on its cord. */
  lamp(b, i) {
    const x = walkX(b.cx);
    const z = SPACE.walkZ;
    const bottom = SPACE.lampY + 0.1;
    const pivot = new THREE.Group();
    pivot.position.set(x, SPACE.h + 1.6, z);
    const hang = (o, y) => (o.position.y = y - pivot.position.y, pivot.add(o), o);
    // The shade: frosted glass, a tulip with a scalloped hem, brightest at the hem.
    const profile = [[0.05, 0.31], [0.08, 0.295], [0.13, 0.25], [0.19, 0.17], [0.24, 0.09], [0.275, 0.03], [0.29, 0]].map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(profile, 48);
    const pos = geo.attributes.position;
    const col = [];
    for (let k = 0; k < pos.count; k++) {
      const [vx, vy, vz] = [pos.getX(k), pos.getY(k), pos.getZ(k)];
      if (vy < 0.035) pos.setY(k, vy + 0.016 * (1 - Math.cos(10 * Math.atan2(vz, vx))) * (1 - vy / 0.035));
      const t = 1 - vy / 0.31;
      col.push(0.7 + 0.3 * t, 0.66 + 0.3 * t, 0.56 + 0.3 * t);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const glass = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    const shade = hang(new THREE.Mesh(geo, glass), bottom);
    shade.renderOrder = 6;
    const brass = new THREE.MeshLambertMaterial({ color: 0x8a6a32, toneMapped: false });
    hang(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.08, 16), brass), bottom + 0.34);
    const cordLength = pivot.position.y - (bottom + 0.38);
    const cord = hang(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, cordLength, 6), new THREE.MeshBasicMaterial({ color: 0x24160c })), bottom + 0.38 + cordLength / 2);
    cord.renderOrder = 6;
    // Its glow round the hem.
    const halo = hang(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), new THREE.MeshBasicMaterial({ map: this.glow, color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })), bottom + 0.05);
    halo.position.z = 0.05;
    halo.renderOrder = 7;
    this.stuff.add(pivot);
    // Its light on the pieces under it, and its beam down to the pool.
    const radius = (this.half + 12) * (WALK / U) + 0.04;
    const colour = new THREE.Color(0xffd9a6);
    const spot = new THREE.SpotLight(colour, 0, 0, Math.atan((radius + 0.1) / bottom), 0.4, 0);
    spot.position.set(x, bottom, z);
    spot.target.position.set(x, 0, z);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.24, radius, bottom, 40, 1, true), beamMaterial(colour, { depthTest: true }));
    beam.position.set(x, bottom / 2, z);
    beam.renderOrder = 5;
    this.stuff.add(spot, spot.target, beam);
    this.lamps.push({ b, x, pivot, glass, halo, spot, beam, drop: pivot.position.y - bottom });
    return pivot;
  }

  // ---------------------------------------------------------------- dressing the room

  /** Once the 3D look has built the room: the frames, what stands in front, the breathing lights and what is outside. */
  dress() {
    const add = (o) => (this.stuff.add(o), o);
    const plate = this.plate;
    // The five gold frames, at the posters' size, over them: one drawing.
    {
      const S = plate.framesSheet;
      const [pos, uv, idx] = [[], [], []];
      const z = SPACE.zBack + 0.02;
      plate.frames.forEach((f, i) => {
        const d = f.drawn.box;
        const [x0, y0] = this.toWorld(d.x, d.y);
        const [x1, y1] = this.toWorld(d.x + d.w, d.y + d.h);
        const [l, r, t, b] = [wallX(x0), wallX(x1), wallY(y0), wallY(y1)];
        pos.push(l, b, z, r, b, z, r, t, z, l, t, z);
        const [u0, u1] = [(f.box.x - S.x) / S.w, (f.box.x + f.box.w - S.x) / S.w];
        const [v0, v1] = [1 - (f.box.y + f.box.h - S.y) / S.h, 1 - (f.box.y - S.y) / S.h];
        uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const frames = add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.frames, transparent: true, depthWrite: false, toneMapped: false })));
      frames.renderOrder = -20;
    }
    // What stands in front of the pieces: a card for each corner, at its own depth, so the pieces walk behind it.
    for (const side of ["left", "right"]) {
      const f = plate.front[side];
      const S = plate.front.sheet;
      const [x0, y0] = this.toWorld(f.x, f.y);
      const [x1, y1] = this.toWorld(f.x + f.w, f.y + f.h);
      const k = (CAM.z - FRONT_Z) / D_WALL;
      const [l, r] = [wallX(x0) * k, wallX(x1) * k];
      const [t, b] = [CAM.y + (wallY(y0) - CAM.y) * k, CAM.y + (wallY(y1) - CAM.y) * k];
      const geo = new THREE.PlaneGeometry(r - l, t - b);
      const uv = geo.attributes.uv;
      const [ax, ay, aw, ah] = f.at;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (ax + uv.getX(i) * aw) / S.w, 1 - (ay + (1 - uv.getY(i)) * ah) / S.h);
      const card = add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.front, transparent: true, depthWrite: false, toneMapped: false })));
      card.position.set((l + r) / 2, (t + b) / 2, FRONT_Z);
      card.renderOrder = 30;
    }
    // The painted lights that breathe, and the candles in front: one drawing each.
    const sheet = spriteSheet();
    this.sheet = sheet.texture;
    this.glows = new Sprites(sheet, this.paint, 32, { depthTest: true });
    this.glows.mesh.renderOrder = -10;
    this.candles = new Sprites(sheet, this.paint, 8, { depthTest: true });
    this.candles.mesh.renderOrder = 31;
    add(this.glows.mesh);
    add(this.candles.mesh);
    this.glowList = GLOWS.map((g) => ({ g, z: this.depthOf(g[1]), ph: seeded(g[0])() * 6.28 }));
    this.candleList = CANDLES.map((g) => ({ g, z: FRONT_Z - 0.05, ph: seeded(g[0])() * 6.28 }));
    if (!this.outside) {
      this.scenery = createOutside({ plate, streets: this.streets, rnd: seeded(41) });
      this.outside = this.scenery.scene;
      if (this.taken.includes("drops")) this.scenery.setDrops(false);
      if (this.taken.includes("rain")) this.scenery.setRain(0.5);
    }
    this.street = null;
    // What is outside is the room's ambient life: stepped every frame by the room's clock.
    this.life.ambient.push({ step: (ctx) => this.stepOutside(ctx) });
  }

  /** How far away a painted point is (metres, as a depth): on the wall above its foot, on the floor below it. */
  depthOf(py) {
    const yw = this.paint[1] + py * this.paint[0];
    if (yw <= (6.25 - 0) * U + 0.5) return SPACE.zBack + 0.05;
    return CAM.z - (CAM.y * U * D_WALL) / (yw - HORIZON);
  }

  /** Moves the room's words onto the painting: the join code onto the sign by the door, the scores onto the chalkboard, each sign under its poster. */
  placeWords() {
    if (!document.querySelector(`link[href="${STYLE.href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = STYLE.href;
      document.head.append(link);
    }
    const plate = this.plate;
    const put = (el, px, py, pw, ph = null) => {
      if (!el) return;
      const [x, y] = this.toWorld(px, py);
      el.style.left = `calc(var(--k) * ${x.toFixed(1)}px)`;
      el.style.top = `calc(var(--k) * ${y.toFixed(1)}px)`;
      el.style.width = `calc(var(--k) * ${(pw * this.paint[0]).toFixed(1)}px)`;
      if (ph !== null) el.style.height = `calc(var(--k) * ${(ph * this.paint[0]).toFixed(1)}px)`;
    };
    const wall = this.words.wall;
    const p = plate.panel;
    put(wall.querySelector(".l3-join"), p.x, p.y, p.w, p.h);
    const b = plate.board;
    put(wall.querySelector(".l3-board"), b.x, b.y, b.w, b.h);
    this.words.signs.forEach((sign, i) => {
      const d = plate.frames[i]?.drawn.box;
      if (d) put(sign.el, d.x + 6, d.y + d.h + 2, d.w - 12);
    });
    this.words.needsFit = true;
  }

  build(room) {
    super.build(room);
    this.el.classList.toggle("bar-real", !this.plain);
    this.touchCache = null;
  }

  /**
   * Where the page's touch spots go (touch.js): over the painted sign, the painted board and the
   * painted frames, in world units, slid with the wall when the eye has moved. Null when the 3D
   * look draws the room (its own places).
   */
  get touchPlaces() {
    if (this.plain || !this.plate) return null;
    const s = Math.round(this.wallShiftWorld ?? 0);
    if (this.touchCache?.s === s) return this.touchCache.places;
    const rect = (r) => {
      const [x0, y0] = this.toWorld(r.x, r.y);
      const [x1, y1] = this.toWorld(r.x + r.w, r.y + r.h);
      return { x: x0 + s, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const plate = this.plate;
    const places = { key: `bar ${s}`, sign: rect(plate.sign), board: rect(plate.board), posters: plate.frames.map((f) => rect(f.drawn.box)) };
    this.touchCache = { s, places };
    return places;
  }

  // ---------------------------------------------------------------- every frame

  /** One frame of what is outside, by the room's clock: the same thing passing on every screen in the room. */
  stepOutside(ctx) {
    const T = ctx.T;
    if (!this.street || T < this.streetT - 1 || this.streetSeed !== ctx.seed) {
      // The timetables from the room's start, seeded by the room's code; they catch up to now by themselves.
      this.street = createStreet(seeded((ctx.seed ^ 0xba7) >>> 0));
      this.lightning = createLightning(seeded((ctx.seed ^ 0x11e) >>> 0));
      this.streetSeed = ctx.seed;
      this.streetEv = this.street.step(T);
    }
    this.streetT = T;
    const timed = this.street.step(T);
    const ev = this.held ?? (ctx.calm || !timed ? null : { ...timed, ...variant(timed, ctx.seed) });
    // A thing's sound as it comes in, not one that was already half way when this screen looked again.
    if (ev && !ev.held && ev.start !== this.streetEv?.start && T - ev.start < 1 && SOUNDS[ev.thing.name]) ctx.emit(SOUNDS[ev.thing.name]);
    this.streetEv = ev;
    // Lightning, now and then; none for a device that asked for less motion.
    const flash = this.flashHeld ?? (ctx.calm ? 0 : this.lightning.step(T));
    this.flash = flash;
    this.scenery.setCalm(ctx.calm);
    this.scenery.step(T, ev, flash);
    return ev || flash > 0.002 ? 2 : 1;
  }

  /** Just before a picture: each lamp at its level of light and swing, the breathing lights, the lightning in the room. */
  tick(now) {
    const t = now / 1000;
    const calm = !!this.life?.calmQuery?.matches;
    for (const lamp of this.lamps) {
      const { b } = lamp;
      const level = b.level;
      const glow = Math.min(1, level * 8);
      const k = 0.3 * glow + 0.7 * level;
      const swing = lamp.pivot.rotation.z;
      // The glass glows by itself as the lamp comes on; the box that leads warms toward gold.
      lamp.glass.color.setRGB(1, 0.94, 0.8).multiplyScalar(0.42 + 0.62 * glow + 0.12 * Math.min(level, 1.3)).lerp(GOLD, b.gold * 0.35);
      lamp.halo.material.opacity = (0.12 + 0.3 * glow + 0.25 * Math.min(level, 1.3)) * (1 + 0.3 * b.gold);
      lamp.spot.intensity = 5 * k;
      lamp.spot.position.x = lamp.x - Math.sin(swing) * lamp.drop;
      lamp.beam.material.uniforms.uStrength.value = (0.07 * glow + 0.08 * level) * 1.5;
      lamp.beam.visible = level > 0.002;
      lamp.beam.rotation.z = swing * 0.5;
      // The pools are where the room's numbers put them, wider apart than the painted frames: so a
      // poster whose light someone stands in warms round its frame as its lamp does, and the two read as one.
      const stood = Math.min(1, Math.max(0, level - 0.16) / 1.04);
      b.glowMesh.material.opacity = Math.max(0.7 * b.gold, 0.55 * stood);
      b.glowMesh.visible = b.glowMesh.material.opacity > 0.003;
    }
    // The painted lights breathe; the candles shimmer a very little. A device that asked for less motion has them still.
    const breathe = (list, out, candle) => {
      out.begin();
      for (const { g, z, ph } of list) {
        const [x, y, rx, ry, colour, base, amt, sp] = g;
        let o = calm ? base : base + amt * (Math.sin(t * sp + ph) * 0.7 + Math.sin(t * sp * 1.73 + ph * 3) * 0.3);
        if (candle && !calm) o += 0.03 * Math.sin(t * 7.1 + ph) * Math.sin(t * 2.3);
        out.add(TILES.glow, x, y, z, rx, ry, colour, 0.55 * Math.max(0, o), true);
      }
      out.done();
    };
    breathe(this.glowList, this.glows, false);
    breathe(this.candleList, this.candles, true);
    // Lightning throws a little cold light into the room by the windows.
    this.shellMat.uniforms.uGain.value[0] = (this.flash ?? 0) * 1.6;
    // The rain's and the drops' smallest size: device pixels per painting pixel.
    const view = this.view;
    if (view && this.scenery) this.scenery.resize(((this.el.clientWidth || 1) / view.width) * this.renderer.getPixelRatio() * this.paint[0]);
  }

  /** One step down the ladder, or back up it. */
  step(name, on) {
    if (name === "drops") this.scenery?.setDrops(!on);
    else if (name === "rain") this.scenery?.setRain(on ? 0.5 : 1);
    else if (name === "outside") {
      if (on && !this.halfOutside) this.halfOutside = halfOutside(this.renderer);
      if (!on) {
        this.halfOutside?.dispose();
        this.halfOutside = null;
      }
    }
    this.idle = 0;
  }

  // ---------------------------------------------------------------- for checks and stills

  /** A passing thing held at one point of its way (0 to 1), at a window and going a way: {thing, u, win, dir, r, held}. */
  passAt(name, u = 0.5, { win = null, dir = 1, r = 0.5 } = {}) {
    const thing = THINGS.find((x) => x.name === name);
    if (!thing) return null;
    return { thing, u, win: win ?? (name === "cat" || name === "boat" ? "right" : "left"), dir, r, held: true, start: 0 };
  }

  /** Holds one passing thing at one point of its way, or lets go (no name). Returns what is outside now. */
  hold(name, u = 0.5, opts = {}) {
    this.held = name ? this.passAt(name, u, opts) : null;
    this.idle = 0;
    return { passing: this.scenery?.passing ?? null, next: this.street?.nextAt ?? null, now: this.street?.now?.thing.name ?? null, T: this.streetT };
  }

  /** Holds the lightning at a brightness (0 to the flash's peak), or lets go (null). */
  holdFlash(value) {
    this.flashHeld = value;
    this.idle = 0;
  }

  /** For leaks(): what is outside, drawn this instant with `ev` passing and nothing else moving. */
  putOutside(ev) {
    this.scenery.step(this.streetT ?? 0, ev, 0);
  }

  fallBack(note) {
    this.scenery?.dispose();
    this.scenery = null;
    this.outside = null;
    this.halfOutside?.dispose();
    this.halfOutside = null;
    this.el.classList.remove("bar-real");
    super.fallBack(note);
  }

  destroy() {
    this.scenery?.dispose();
    this.halfOutside?.dispose();
    this.glows?.dispose();
    this.candles?.dispose();
    this.sheet?.dispose();
    for (const t of [this.frames, this.front, this.streets?.left, this.streets?.right]) t?.dispose();
    this.el.classList.remove("bar-real");
    super.destroy();
  }
}

const GOLD = new THREE.Color(1.2, 0.86, 0.45);
