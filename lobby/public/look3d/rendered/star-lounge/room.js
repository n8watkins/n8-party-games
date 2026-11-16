// The Star Lounge made real, in the party room: its rendered picture (layers/, from the Blender
// scene lobby/tools/blender/star-lounge.py), the universe outside its window drawn live and cut
// to the glass, and the room's real things over it, unchanged in behaviour (rendered/room-rendered.js).
//
// What is its own:
//   - the lamps: rendered cards that swing on their cords (the room's life swings them, as it
//     swings the 3D look's lamps), each with its share of the picture's light, its glow, its beam
//     and a real spot of light on the pieces under it
//   - the chart table under the Tonight board: a rendered card with a globe of light over it.
//     It is the room's feature (look3d/life.js): a bump or a landing beside it sets it off
//   - outside: the turning planet with its storms, its moon, stars, gas clouds and the things that
//     pass one at a time (star-lounge/outside.js), on the sky's timetable (star-lounge/sky.js),
//     which here runs on the room's own clock from the room's code, so every screen in a room
//     sees the same rocket at the same moment
//   - the lights that blink on the bench, the lines of light in the deck, the rods the two
//     boards hang from and the shine on the screens
//
// Its steps down the ladder, cheapest last (rendered/ladder.js; ?rung= forces them for a test):
//   weather   the planet's storms, torn cloud edges and belt streaks off: five fewer looks into a
//             picture per pixel of planet, and at phone size the belts read the same
//   planet    the planet's surface at half its size (2048 across); a device that cannot hold a
//             picture 4096 across starts here
//   outside   everything outside drawn at half the room's resolution: a quarter of the pixels.
//             The outside is soft far things, so it shows least there
import { SPACE } from "../../space.js";
import * as THREE from "../../three.js";
import { RoomRendered } from "../room-rendered.js";
import { halfOutside, loadTexture, seeded } from "../plate.js";
import { RENDERED } from "../switch.js";
import { OUTSIDE_PICTURES, createOutside, halfPlanet } from "./outside.js";
import { LIGHTS, buildBlinks, buildHolo, buildLamp, colours, rodRects, rodsMesh, runHolo, setLamp, sheensMesh, strikeHolo } from "./parts.js";
import { createSky } from "./sky.js";

const LAYERS = new URL("./layers/", import.meta.url);
/** The Star Lounge's numbers, shared with the Blender scene (the site serves lobby/tools/blender/star-lounge.json here: scripts/build-public.mjs). */
const NUMBERS = new URL("./layers/star-lounge.json", import.meta.url);

/** What the timetable's things sound like: the names the room's sounds listen for (room-sounds.js). */
const SOUNDS = { star: "star.fall", rocket: "rocket.pass", saucer: "saucer.pass" };

/** The join sign and the Tonight board, where the room's words put them (look3d/words.js), for the rods they hang from. */
const JOIN = { x: 181 - 106, w: 212, top: 133 };
const BOARD = { x: 1722 - 118, w: 236, top: 136 };

export class RoomStarLounge extends RoomRendered {
  static SKIN = "ship";
  static DEF = RENDERED.ship;

  constructor(...args) {
    super(...args);
    this.lightNames = LIGHTS;
    this.exposure = 0.95;
    // The planet's light, coming in low through the glass behind the pieces; the room's own soft light from the front.
    this.pieceLight = {
      hemi: { sky: 0x8fb0ff, ground: 0x05070f, intensity: 0.55 },
      front: { colour: 0xc4d8ff, intensity: 0.85, at: [-2.5, 6, 10] },
      back: { colour: 0xffc08a, intensity: 1.5, at: [4, 1.6, -8] },
      env: 0.75,
    };
  }

  /** The plate, the room's pictures and what is outside, loaded together. */
  async loadLayers() {
    const aniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const at = (name) => new URL(name, LAYERS).href;
    const json = async (url) => {
      const answer = await fetch(url);
      if (!answer.ok) throw new Error(`${String(url).split("/").pop()} did not load`);
      return answer.json();
    };
    const [plate, cfg, base, lights, sheet, env, ...outside] = await Promise.all([
      json(at("plate.json")),
      json(NUMBERS),
      loadTexture(at("base.webp"), { anisotropy: aniso }),
      loadTexture(at("lights.webp"), { mips: false, anisotropy: aniso }),
      loadTexture(at("cards.webp"), { anisotropy: aniso }),
      loadTexture(at("env.webp"), { mips: false, anisotropy: aniso }),
      ...OUTSIDE_PICTURES.map((n) => loadTexture(at(`${n}.webp`), { repeat: ["sky", "planet", "moon"].includes(n), anisotropy: aniso })),
    ]);
    env.mapping = THREE.EquirectangularReflectionMapping;
    const tex = Object.fromEntries(OUTSIDE_PICTURES.map((n, i) => [n, outside[i]]));
    // A device that cannot hold a picture this wide starts on the smaller planet, before any of it reaches the graphics card.
    this.bigPlanet = tex.planet;
    this.smallPlanetOnly = this.renderer.capabilities.maxTextureSize < tex.planet.image.width;
    if (this.smallPlanetOnly) tex.planet = this.smallPlanet = halfPlanet(this.bigPlanet, aniso);
    if (this.smallPlanetOnly && !this.rung.taken.includes("planet")) this.rung.taken.push("planet");
    if (this.ladder && this.smallPlanetOnly) this.ladder.taken.add("planet");
    return { plate, cfg, base, lights, sheet, env, tex, sill: plate.layout.sill };
  }

  /** The room keeps only the steps of light that follow the pieces from the 3D look's life; the rest of the Star Lounge's life is here. */
  ownLife(life) {
    return life.filter((def) => def.kind === "trail");
  }

  /** Its lamp over box i: the rendered card that swings. */
  lamp(b, i) {
    const lamp = buildLamp(i, { plate: this.plate, sheet: this.sheet, radial: this.glow, colour: colours(this.cfg).lamp, exposure: this.exposure, add: (o) => this.stuff.add(o), depthTest: true });
    lamp.b = b;
    this.lamps.push(lamp);
    return lamp.pivot;
  }

  /** Once the 3D look has built the room: what is outside, the chart table, the blinking lights, the rods and shines. */
  dress() {
    const add = (o) => (this.stuff.add(o), o);
    // A lamp's light on the dark blue deck comes back very blue; it is warmed a little so the pool reads as light.
    for (const [i, name] of LIGHTS.entries()) if (name.startsWith("lamp")) this.shellMat.uniforms.uTint.value[i].setRGB(1.3, 1.08, 0.86);
    this.holo = buildHolo({ plate: this.plate, cfg: this.cfg, sheet: this.sheet, radial: this.glow, exposure: this.exposure, add, depthTest: true });
    this.blinks = buildBlinks({ gaps: this.L.gaps, add, depthTest: true });
    add(rodsMesh([...rodRects(this.plate, JOIN.x, JOIN.w, JOIN.top), ...rodRects(this.plate, BOARD.x, BOARD.w, BOARD.top)], { depthTest: true }));
    add(sheensMesh(this.L.xs.map((x) => ({ x, y: this.L.by, z: SPACE.zBack + 0.365, w: this.L.bw, h: this.L.bh })), { depthTest: true }));
    if (!this.outside) {
      this.world = createOutside({ cfg: this.cfg, tex: this.tex, weather: !this.taken.includes("weather") });
      this.outside = this.world.scene;
    }
    this.sky = null;
    // The chart table is the room's feature: the room's life knocks it (a bump or a landing near the board) and steps it.
    const holo = this.holo;
    const tint = this.shellMat.uniforms.uTint.value[LIGHTS.indexOf("holo")];
    const gain = this.plate.lights.holo.gain;
    this.life.feature = {
      kick: (ctx, strength) => {
        ctx.emit("holo.spin");
        strikeHolo(holo, ctx.now / 1000, seeded(Math.round(ctx.now)));
        if (strength < 1) holo.struck -= (1 - strength) * 2.5; // a lighter knock: a shorter spin
      },
      step: (ctx) => {
        const { power, hot } = runHolo(holo, ctx.now / 1000, ctx.dt, tint, ctx.calm);
        this.shellMat.uniforms.uGain.value[LIGHTS.indexOf("holo")] = gain * power;
        return hot ? 2 : 1;
      },
    };
    // Outside and the lines of light are the room's ambient life: stepped every frame by the room's clock.
    this.life.ambient.push({ step: (ctx) => this.stepOutside(ctx) });
  }

  /** One frame of what is outside, by the room's clock (seconds the room has been open): the same on every screen in the room. */
  stepOutside(ctx) {
    const T = ctx.T;
    if (!this.sky || T < this.skyT - 1 || this.skySeed !== ctx.seed) {
      // The timetable from the room's start, run forward to now in a moment (it only does sums), so a screen that came late is in step.
      this.sky = createSky(seeded((ctx.seed ^ 0x51a7) >>> 0));
      this.skySeed = ctx.seed;
      for (let t = 0; t < T; t += 0.5) this.sky.step(t);
      this.skyEv = this.sky.step(T);
    }
    this.skyT = T;
    const timed = this.sky.step(T);
    const ev = this.held ?? (ctx.calm ? null : timed);
    if (ev && ev !== this.skyEv && !ev.held && SOUNDS[ev.thing.name]) ctx.emit(SOUNDS[ev.thing.name]);
    this.skyEv = ev;
    this.world.step(T, 0, ev);
    const i = LIGHTS.indexOf("strips");
    // The lines of light in the deck breathe slowly.
    this.shellMat.uniforms.uGain.value[i] = this.plate.lights.strips.gain * (0.82 + 0.18 * Math.sin(T * 1.3));
    this.blinks.material.uniforms.uTime.value = T;
    return ev ? 2 : 1;
  }

  /** Just before a picture: each lamp at its level of light, swinging as the room's life swings it. */
  tick() {
    const u = this.shellMat.uniforms;
    for (const lamp of this.lamps) {
      const b = lamp.b;
      const level = b.level;
      const glow = Math.min(1, level * 8);
      const k = 0.3 * glow + 0.7 * level;
      const swing = lamp.pivot.rotation.z;
      // The beam a little stronger than the preview's: in the room it says which light is on, from across the room.
      setLamp(lamp, { glow, k, level, swing, beam: 1.8 });
      // A lamp that is on with nobody under it (the room's 0.16) lights its pool faintly; each piece under it brightens it.
      u.uGain.value[b.i] = this.plate.lights[`lamp${b.i}`].gain * 2 * (0.15 * glow + 0.95 * level);
      u.uSway.value[b.i] = -swing * 0.035;
      // The box that leads: its lamp's light goes the room's colour.
      u.uTint.value[b.i].setRGB(1.3, 1.08, 0.86).lerp(TEAL, b.gold * 0.7);
    }
    const px = this.renderer.getPixelRatio();
    const h = this.el.clientHeight || 1;
    this.world.resize(px, h);
    this.blinks.material.uniforms.uPx.value = px * Math.max(0.75, h / 520);
  }

  /** One step down the ladder, or back up it. */
  step(name, on) {
    if (name === "weather") this.world?.setWeather(!on);
    else if (name === "planet") {
      if (!this.smallPlanet) this.smallPlanet = halfPlanet(this.bigPlanet, Math.min(4, this.renderer.capabilities.getMaxAnisotropy()));
      this.tex.planet = on || this.smallPlanetOnly ? this.smallPlanet : this.bigPlanet;
      this.world?.setPlanet(this.tex.planet);
    } else if (name === "outside") {
      if (on && !this.halfOutside) this.halfOutside = halfOutside(this.renderer);
      if (!on) {
        this.halfOutside?.dispose();
        this.halfOutside = null;
      }
    }
    this.idle = 0;
  }

  /** For checks and stills: holds one passing thing at one point of its way (0 to 1), or lets go (no name). Returns what is outside now. */
  hold(name, u = 0.5) {
    this.held = name ? { thing: { name }, u, held: true, start: 0 } : null;
    this.idle = 0;
    return { passing: this.world?.passing ?? null, next: this.sky?.nextAt ?? null, now: this.sky?.now?.thing.name ?? null, T: this.skyT };
  }

  /**
   * For checks (lobby/test/shoot-real.mjs): does a passing thing change any pixel that is not glass,
   * anywhere along its way? This moment of the room is drawn with an empty sky, then only its glass
   * (in white), then with `name` at each of `steps` + 1 points of its way, and the pixels each
   * changed are counted, with how many of those are not glass. Nothing else moves between the drawings.
   */
  leaks(name, steps = 12) {
    const gl = this.renderer.getContext();
    const [w, h] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    const grab = () => {
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const T = this.skyT ?? 0;
    const put = (ev) => {
      this.world.step(T, 0, ev);
      this.draw();
    };
    put(null);
    const empty = grab();
    // The pieces were dressed for this picture once (dressing is done to a fresh pose each frame); not again.
    this.dressPieces = () => {};
    this.shellMat.uniforms.uProbe.value = 1;
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.shellMesh, this.camera);
    const glass = grab();
    this.shellMat.uniforms.uProbe.value = 0;
    let panes = 0;
    for (let i = 0; i < glass.length; i += 4) if (glass[i] > 0) panes++;
    const changed = [];
    const leaked = [];
    let worst = 0;
    for (let s = 0; s <= steps; s++) {
      put({ thing: { name }, u: s / steps, held: true, start: 0 });
      const full = grab();
      let [c, l] = [0, 0];
      for (let i = 0; i < empty.length; i += 4) {
        const d = Math.max(Math.abs(empty[i] - full[i]), Math.abs(empty[i + 1] - full[i + 1]), Math.abs(empty[i + 2] - full[i + 2]));
        if (!d) continue;
        c++;
        if (glass[i] === 0) {
          l++;
          worst = Math.max(worst, d);
        }
      }
      changed.push(c);
      leaked.push(l);
    }
    delete this.dressPieces;
    this.idle = 0;
    return { changed, leaked, worst, glass: panes, pixels: w * h };
  }

  fallBack(note) {
    this.world?.dispose();
    this.world = null;
    this.outside = null;
    this.halfOutside?.dispose();
    this.halfOutside = null;
    super.fallBack(note);
  }

  destroy() {
    this.world?.dispose();
    this.halfOutside?.dispose();
    this.smallPlanet?.dispose();
    for (const t of Object.values(this.tex ?? {})) t.dispose();
    this.bigPlanet?.dispose();
    super.destroy();
  }
}

const TEAL = new THREE.Color(0.55, 1.15, 1.4);
