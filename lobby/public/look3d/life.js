// What makes a room alive: everything in it that moves without being a piece.
//
// A skin lists its life (look3d/skins.js, `life: [...]`), and each entry is one of three kinds
// of thing. All of it is drawn on the device, from what every device already knows. Nothing
// here sends a message, asks the room anything or changes a rule: it cannot move a piece, block
// a vote or decide who was bumped.
//
//   ambient    always on: a fire, a sky going by a window, bulbs that chase round a frame
//   events     something passes now and then: an owl, a plane, a comet. They run off the
//              room's own clock (how long the room has been open, which the room view already
//              carries as `closesIn`) and a sequence seeded by the room's code, so every screen
//              in a room sees the same owl at the same moment, to within the lag of a message.
//   reactions  set off by pieces: where they stand, when they jump, who was bumped. Every
//              device hears those already, so every screen agrees.
//
// Sound: nothing here plays any. Each event and reaction announces itself by name (see `emit`)
// so that a sound system can listen: window.addEventListener("party-room:sound", ...).
//
// People who ask their device for less motion get the ambient life only, slowed where it
// scrolls; events do not fly and reactions do not wobble, hop or throw sparks.
import { canvasOf } from "./paint.js";
import { PX, SPACE, WALK, walkX, worldX } from "./space.js";
import { SPRITES } from "./sprites.js";
import * as THREE from "./three.js";

/** How long a room lasts, in seconds: the room view counts down from it (`closesIn`). */
const ROOM_LIFE = 4 * 3600;
/** A piece this near the middle of a room's feature (world units) can set it off. */
const REACH = 170;

/** A repeatable number from 0 to 1 for a seed and two whole numbers. */
export function chance(seed, a, b = 0) {
  let h = seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h | 0;
}

/**
 * Whether a timed thing is happening at room time T, and how far through it is.
 * It comes once in every `every` seconds, at a moment within that stretch picked by the seed.
 * Returns null, or {u: 0 to 1, n: which time this is, r: a number for this time's choices}.
 */
export function occurrence(def, index, T, seed) {
  const n = Math.floor(T / def.every);
  const start = n * def.every + chance(seed, index, n) * (def.every - def.lasts);
  const u = (T - start) / def.lasts;
  return u >= 0 && u < 1 ? { u, n, r: chance(seed, index + 101, n), r2: chance(seed, index + 211, n) } : null;
}

/** When the thing at `index` next starts at or after T: for stills and captures. */
export function nextStart(def, index, T, seed) {
  for (let n = Math.floor(T / def.every); ; n++) {
    const start = n * def.every + chance(seed, index, n) * (def.every - def.lasts);
    if (start >= T) return start;
  }
}

const additive = (map, color = 0xffffff, opacity = 1) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
const wobble = () => ({ a: 0, v: 0 });
function settle(w, dt, stiffness = 60, damping = 5) {
  w.v += (-w.a * stiffness - w.v * damping) * dt;
  w.a += w.v * dt;
  return Math.abs(w.a) > 0.002 || Math.abs(w.v) > 0.01;
}

// ---------------------------------------------------------------- small dots: sparks, smoke, dust

/** A pool of soft dots, drawn as one mesh. Glowing ones add light; the others are smoke and dust. */
class Dots {
  constructor(radial, n, glowing) {
    this.n = n;
    this.glowing = glowing;
    this.live = [];
    const material = glowing ? additive(radial) : new THREE.MeshBasicMaterial({ map: radial, transparent: true, opacity: 0.55, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.at = new THREE.Object3D();
    this.colour = new THREE.Color();
  }

  /** One dot: where (metres), which way (metres a second), how long, how big, what colour. */
  add(x, y, z, vx, vy, life, size, colour, pull = 0, grow = 0) {
    if (this.live.length >= this.n) this.live.shift();
    this.live.push({ x, y, z, vx, vy, life, age: 0, size, colour, pull, grow });
  }

  step(dt) {
    if (!this.live.length) {
      this.mesh.count = 0;
      return false;
    }
    this.live = this.live.filter((d) => (d.age += dt) < d.life);
    this.live.forEach((d, i) => {
      d.vy -= d.pull * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const left = 1 - d.age / d.life;
      this.at.position.set(d.x, d.y, d.z);
      this.at.scale.setScalar(d.size * (1 + d.grow * (1 - left)) * (this.glowing ? 1 : Math.min(1, left * 2.5)));
      this.at.updateMatrix();
      this.mesh.setMatrixAt(i, this.at.matrix);
      this.mesh.setColorAt(i, this.colour.set(d.colour).multiplyScalar(this.glowing ? left : 1));
    });
    this.mesh.count = this.live.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return this.live.length > 0;
  }
}

// ---------------------------------------------------------------- the kinds of ambient life

const AMBIENT = {
  /**
   * What is outside the windows: painted strips behind the wall that slide past, each at its
   * own speed (metres a second), seen through the holes the skin's wall painter cut.
   * {kind: "outside", layers: [{paint(g, w, h, k), speed, tile}]}
   */
  outside(kit, def) {
    const layers = def.layers.map((layer, i) => {
      const tile = layer.tile ?? SPACE.w;
      const k = layer.k ?? 100;
      const tex = kit.texture(canvasOf(Math.round(tile * k), Math.round(SPACE.h * k), (g, w, h) => layer.paint(g, w, h, k, kit.L)));
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(SPACE.w / tile, 1);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w, SPACE.h), new THREE.MeshBasicMaterial({ map: tex, transparent: i > 0, depthWrite: false }));
      mesh.position.set(0, SPACE.h / 2, SPACE.zBack - 0.12 + i * 0.02);
      mesh.renderOrder = -10 + i;
      kit.add(mesh);
      return { tex, speed: layer.speed / tile };
    });
    const fast = def.layers.some((l) => Math.abs(l.speed) > 0.6);
    return {
      step(ctx) {
        for (const l of layers) l.tex.offset.x = (ctx.T * l.speed * (ctx.calm ? 0.25 : 1)) % 1;
        return fast && !ctx.calm ? 2 : 1;
      },
    };
  },

  /**
   * Small lights that come on and go off, each in its own time: city windows, running lights.
   * {kind: "twinkle", count, area: [x0, x1, y0, y1] (wall metres), size: [w, h], colours, period: [lo, hi], z, glow}
   */
  twinkle(kit, def) {
    const n = def.count;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(def.size[0], def.size[1]), additive(def.glow ? kit.radial : null), n);
    const o = new THREE.Object3D();
    const lights = [];
    const [x0, x1, y0, y1] = def.area;
    for (let i = 0; i < n; i++) {
      const [x, y] = def.at ? def.at[i % def.at.length] : [x0 + chance(7, i, 1) * (x1 - x0), y0 + chance(7, i, 2) * (y1 - y0)];
      o.position.set(x, y, def.z ?? SPACE.zBack + 0.011);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      lights.push({ period: def.period[0] + chance(7, i, 3) * (def.period[1] - def.period[0]), phase: chance(7, i, 4) * 40, colour: new THREE.Color(def.colours[i % def.colours.length]), on: null });
    }
    const dark = new THREE.Color(0);
    kit.add(mesh);
    let due = 0;
    return {
      step(ctx) {
        if (ctx.now < due) return 1;
        due = ctx.now + 300;
        let changed = false;
        lights.forEach((l, i) => {
          const on = chance(11, i, Math.floor((ctx.T + l.phase) / l.period)) < (def.lit ?? 0.5);
          if (on === l.on) return;
          l.on = on;
          mesh.setColorAt(i, on ? l.colour : dark);
          changed = true;
        });
        if (changed) mesh.instanceColor.needsUpdate = true;
        return 1;
      },
    };
  },

  /**
   * Bulbs round every box's frame that chase each other, as on a marquee.
   * {kind: "chase", colours, speed (steps a second), every (metres between bulbs)}
   */
  chase(kit, def) {
    const L = kit.L;
    const spots = [];
    const [hw, hh] = [L.bw / 2 + 0.2, L.bh / 2 + 0.2];
    for (const cx of L.xs) {
      const round = [];
      for (let x = -hw; x <= hw + 0.001; x += (2 * hw) / Math.round((2 * hw) / def.every)) round.push([cx + x, L.by + hh]);
      for (let y = hh; y >= -hh - 0.001; y -= (2 * hh) / Math.round((2 * hh) / def.every)) round.push([cx + hw, L.by + y]);
      for (let x = hw; x >= -hw - 0.001; x -= (2 * hw) / Math.round((2 * hw) / def.every)) round.push([cx + x, L.by - hh]);
      for (let y = -hh; y <= hh + 0.001; y += (2 * hh) / Math.round((2 * hh) / def.every)) round.push([cx - hw, L.by + y]);
      spots.push(...round.map((p, i) => [...p, i]));
    }
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2), additive(kit.radial), spots.length);
    const o = new THREE.Object3D();
    spots.forEach(([x, y], i) => {
      o.position.set(x, y, SPACE.zBack + 0.43);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    kit.add(mesh);
    const colours = def.colours.map((c) => new THREE.Color(c));
    const dim = colours.map((c) => c.clone().multiplyScalar(0.16));
    let shown = -1;
    return {
      step(ctx) {
        const beat = Math.floor(ctx.T * def.speed * (ctx.calm ? 0.3 : 1));
        if (beat === shown) return 1;
        shown = beat;
        spots.forEach(([, , i], k) => mesh.setColorAt(k, ((i + beat) % 3 === 0 ? colours : dim)[i % colours.length]));
        mesh.instanceColor.needsUpdate = true;
        return 1;
      },
    };
  },

  /**
   * Beams of light from above that swing across the wall, as in a studio.
   * {kind: "sweep", beams: [{x, colour, swing (radians), speed, phase}]}
   */
  sweep(kit, def) {
    const beam = kit.texture(
      canvasOf(64, 256, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, "rgba(255,255,255,.9)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(26, 0);
        g.lineTo(38, 0);
        g.lineTo(64, 256);
        g.lineTo(0, 256);
        g.fill();
      }),
    );
    const beams = def.beams.map((b) => {
      const geo = new THREE.PlaneGeometry(1.5, 6.6);
      geo.translate(0, -3.3, 0);
      const mesh = new THREE.Mesh(geo, additive(beam, b.colour, 0.16));
      mesh.position.set(b.x, SPACE.h + 0.3, SPACE.zBack + 0.02);
      kit.add(mesh);
      return { mesh, ...b };
    });
    return {
      step(ctx) {
        for (const b of beams) b.mesh.rotation.z = Math.sin(ctx.T * b.speed * (ctx.calm ? 0.3 : 1) + b.phase) * b.swing;
        return 1;
      },
    };
  },

  /**
   * Strips of light that breathe: {kind: "pulse", strips: [{x, y, z, w, d}], colour, speed, flat}
   * `flat` strips lie on the floor (w along the room, d toward the viewer).
   */
  pulse(kit, def) {
    const strips = def.strips.map((s, i) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), additive(kit.radial, def.colour, 0.2));
      mesh.position.set(s.x, s.y, s.z);
      if (def.flat) mesh.rotation.x = -Math.PI / 2;
      kit.add(mesh);
      return { mesh, i };
    });
    return {
      step(ctx) {
        for (const s of strips) s.mesh.material.opacity = 0.16 + 0.12 * Math.sin(ctx.T * def.speed + s.i * 1.9);
        return 1;
      },
    };
  },

  /** Light through water, wandering over the floor: {kind: "caustics", colour} */
  caustics(kit, def) {
    const tex = kit.texture(
      canvasOf(256, 256, (g) => {
        g.fillStyle = "#000";
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = "rgba(255,255,255,.5)";
        g.lineWidth = 3;
        for (let i = 0; i < 26; i++) {
          g.beginPath();
          const [x, y] = [chance(3, i, 1) * 256, chance(3, i, 2) * 256];
          for (const dx of [-256, 0, 256])
            for (const dy of [-256, 0, 256]) {
              g.moveTo(x + dx - 30, y + dy);
              g.bezierCurveTo(x + dx - 10, y + dy - 26, x + dx + 16, y + dy + 22, x + dx + 34, y + dy - 6);
            }
          g.stroke();
        }
      }),
    );
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 2);
    const depth = SPACE.zFront - SPACE.zBack;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPACE.w, depth), additive(tex, def.colour, 0.2));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.004, (SPACE.zFront + SPACE.zBack) / 2);
    kit.add(mesh);
    return {
      step(ctx) {
        tex.offset.set(Math.sin(ctx.T * 0.21) * 0.08 + ctx.T * 0.012, Math.cos(ctx.T * 0.17) * 0.1);
        return 1;
      },
    };
  },

  /**
   * Fireflies, dust in a beam, bubbles: glowing dots that wander about where they started.
   * {kind: "drift", count, area: [x0, x1, y0, y1], colour, size, z, rise}
   */
  drift(kit, def) {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(def.size, def.size), additive(kit.radial), def.count);
    mesh.frustumCulled = false;
    const o = new THREE.Object3D();
    const colour = new THREE.Color(def.colour);
    const tint = new THREE.Color();
    const [x0, x1, y0, y1] = def.area;
    kit.add(mesh);
    return {
      step(ctx) {
        for (let i = 0; i < def.count; i++) {
          const [a, b, c] = [chance(5, i, 1), chance(5, i, 2), chance(5, i, 3)];
          let y = y0 + b * (y1 - y0) + Math.cos(ctx.T * (0.2 + c * 0.3) + i) * 0.22;
          if (def.rise) y = y0 + ((b * (y1 - y0) + ctx.T * def.rise * (0.6 + c)) % (y1 - y0));
          o.position.set(x0 + a * (x1 - x0) + Math.sin(ctx.T * (0.25 + b * 0.35) + i * 2.1) * 0.35, y, def.z ?? SPACE.zBack + 0.3 + c * 2.4);
          o.updateMatrix();
          mesh.setMatrixAt(i, o.matrix);
          mesh.setColorAt(i, tint.copy(colour).multiplyScalar(def.rise ? 0.7 : Math.max(0, Math.sin(ctx.T * (0.7 + a * 0.9) + i * 1.7))));
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        return 1;
      },
    };
  },
};

// ---------------------------------------------------------------- the kinds of event

/** A sprite sheet as a texture: the painter's frames side by side. */
function sheet(kit, name, px) {
  const sprite = SPRITES[name];
  const [w, h] = px;
  const tex = kit.texture(
    canvasOf(w * sprite.frames, h, (g) => {
      for (let f = 0; f < sprite.frames; f++) {
        g.save();
        g.translate(f * w, 0);
        g.beginPath();
        g.rect(0, 0, w, h);
        g.clip();
        sprite.paint(g, w, h, f);
        g.restore();
      }
    }),
  );
  tex.repeat.set(1 / sprite.frames, 1);
  return { tex, frames: sprite.frames };
}

/** Where things that pass are, front to back: outside the windows, on the wall's own sky, or along a rail in the room. */
const DEPTH = { outside: SPACE.zBack - 0.05, sky: SPACE.zBack + 0.012, rail: SPACE.zBack + 0.08 };

const EVENTS = {
  /**
   * Something flies, swims, walks or rolls from one side to the other.
   * {kind: "flyby", name, sprite, size: [w, h] (metres), px: [w, h], every, lasts, y: [lo, hi],
   *  depth: "outside" | "sky" | "rail", dir: 1 | -1 | 0 (either), bob, arc, tilt, fps, glow, stay, calm, sound}
   */
  flyby(kit, def) {
    const { tex, frames } = sheet(kit, def.sprite, def.px ?? [256, Math.round((256 * def.size[1]) / def.size[0])]);
    const material = def.glow ? additive(tex, def.tint ?? 0xffffff) : new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: def.tint ?? 0xffffff });
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.size[0], def.size[1]), material);
    mesh.visible = false;
    mesh.renderOrder = def.depth === "outside" ? -5 : 1;
    kit.add(mesh);
    const half = SPACE.w / 2 + def.size[0];
    return {
      step(ctx, on) {
        mesh.visible = !!on;
        if (!on) return 0;
        const dir = def.dir || (on.r < 0.5 ? 1 : -1);
        const y = def.y[0] + on.r2 * (def.y[1] - def.y[0]);
        const ease = def.stay ? Math.sin(Math.PI * on.u) : 1;
        const x = def.stay ? (on.r - 0.5) * (SPACE.w - 5) : dir * (on.u * 2 - 1) * half;
        mesh.position.set(x, y + (def.bob ?? 0) * Math.sin(ctx.T * 5) + (def.arc ?? 0) * Math.sin(Math.PI * on.u) + (def.fall ?? 0) * on.u, DEPTH[def.depth ?? "sky"]);
        mesh.scale.x = dir;
        mesh.rotation.z = def.stay ? Math.sin(ctx.T * 0.7) * 0.12 : (def.tilt ?? 0) * dir;
        material.opacity = (def.opacity ?? 1) * ease * Math.min(1, on.u * 12, (1 - on.u) * 12);
        tex.offset.x = frames > 1 ? (Math.floor(ctx.T * (def.fps ?? 6)) % frames) / frames : 0;
        return 2;
      },
    };
  },

  /**
   * Fireworks: a few bursts, one after the other, each opening and fading.
   * {kind: "burst", name, every, lasts, area: [x0, x1, y0, y1], size, colours, sound}
   */
  burst(kit, def) {
    const { tex } = sheet(kit, "firework", [256, 256]);
    const shells = [0, 1, 2].map(() => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.size, def.size), additive(tex));
      mesh.visible = false;
      kit.add(mesh);
      return mesh;
    });
    const [x0, x1, y0, y1] = def.area;
    return {
      step(ctx, on) {
        shells.forEach((mesh, i) => {
          const u = on ? on.u * 3 - i * 0.8 : -1;
          mesh.visible = u > 0 && u < 1;
          if (!mesh.visible) return;
          mesh.position.set(x0 + chance(on.n, i, 1) * (x1 - x0), y0 + chance(on.n, i, 2) * (y1 - y0), DEPTH.sky);
          mesh.scale.setScalar(0.15 + 0.85 * (1 - Math.pow(1 - u, 3)));
          mesh.material.color.set(def.colours[Math.floor(chance(on.n, i, 3) * def.colours.length)]).multiplyScalar(1 - u * u);
        });
        return on ? 2 : 0;
      },
    };
  },

  /**
   * A lit sign that comes on, with confetti: {kind: "applause", name, words, every, lasts, x, y, colours, sound}
   */
  applause(kit, def) {
    const tex = kit.texture(
      canvasOf(512, 128, (g) => {
        g.fillStyle = "#0a1230";
        g.beginPath();
        g.roundRect(4, 4, 504, 120, 22);
        g.fill();
        g.strokeStyle = "#ffffff";
        g.lineWidth = 6;
        g.stroke();
        g.fillStyle = "#ffffff";
        g.font = '900 78px "Nunito", system-ui, sans-serif';
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(def.words, 256, 68);
      }),
    );
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(def.x, def.y, SPACE.zBack + 0.05);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.4), additive(kit.radial, def.colours[0], 0));
    halo.position.set(def.x, def.y, SPACE.zBack + 0.04);
    kit.add(sign);
    kit.add(halo);
    const dark = new THREE.Color(0x24305a);
    const lit = new THREE.Color(def.colours[0]).multiplyScalar(1.5);
    let last = 0;
    return {
      step(ctx, on) {
        const flash = on ? Math.floor(ctx.T * 3) % 2 === 0 || on.u > 0.3 : false;
        sign.material.color.copy(flash ? lit : dark);
        halo.material.opacity = flash ? 0.5 : 0;
        if (on && ctx.now - last > 60) {
          last = ctx.now;
          for (let i = 0; i < 2; i++) ctx.sparks.add((Math.random() - 0.5) * SPACE.w * 0.9, SPACE.h - 0.4, SPACE.walkZ - Math.random() * 2.5, (Math.random() - 0.5) * 0.6, -1.1 - Math.random(), 3.2, 0.12, def.colours[Math.floor(Math.random() * def.colours.length)], 0.3);
        }
        return on ? 2 : 0;
      },
    };
  },
};

// ---------------------------------------------------------------- the feature spot

// Under the Tonight board every room has its own thing. A feature is (kit, def) => {step(ctx),
// kick(ctx, strength)}: `step` runs every frame the spot is in view, `kick` when a piece near it
// is bumped or lands a jump. `kit.spot` is the middle of the spot on the wall, in metres.

/** A box with one painted face. */
function crate(kit, w, h, d, colour, paint) {
  const side = new THREE.MeshLambertMaterial({ color: colour });
  const front = paint ? new THREE.MeshBasicMaterial({ map: kit.texture(canvasOf(256, Math.round((256 * h) / w), paint)) }) : side;
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, front, side]);
}

const FEATURES = {
  /** The bar's jukebox: tubes of light that run round its arch, and it skips when it is knocked. */
  jukebox(kit) {
    const group = new THREE.Group();
    group.position.set(kit.spot, 0, SPACE.zBack + 0.3);
    const body = crate(kit, 1.05, 1.62, 0.5, 0x4a2a16, (g, w, h) => {
      g.fillStyle = "#3a2012";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#6a3a1c";
      g.beginPath();
      g.roundRect(10, 10, w - 20, h - 20, [w * 0.46, w * 0.46, 14, 14]);
      g.fill();
      g.fillStyle = "#140b08";
      g.beginPath();
      g.roundRect(48, 50, w - 96, h * 0.34, [w * 0.3, w * 0.3, 8, 8]);
      g.fill();
      // The record, and the grille under it.
      g.fillStyle = "#0a0605";
      g.beginPath();
      g.arc(w / 2, h * 0.27, 46, 0, 7);
      g.fill();
      g.fillStyle = "#d8402a";
      g.beginPath();
      g.arc(w / 2, h * 0.27, 15, 0, 7);
      g.fill();
      g.fillStyle = "#c9a25a";
      g.fillRect(40, h * 0.5, w - 80, 10);
      for (let x = 52; x < w - 52; x += 14) {
        g.fillStyle = "#1a0f0a";
        g.fillRect(x, h * 0.56, 7, h * 0.32);
      }
      g.strokeStyle = "#c9a25a";
      g.lineWidth = 5;
      g.strokeRect(44, h * 0.54, w - 88, h * 0.36);
    });
    body.position.y = 0.81;
    group.add(body);
    const tubes = [-1, 1].map((s) => {
      const tube = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 1.3), new THREE.MeshBasicMaterial());
      tube.position.set(s * 0.44, 0.78, 0.26);
      group.add(tube);
      return tube;
    });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 6, 20, Math.PI), new THREE.MeshBasicMaterial());
    arch.position.set(0, 1.12, 0.24);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.8), additive(kit.radial, 0xffb060, 0.2));
    halo.position.set(0, 1.0, 0.2);
    group.add(arch, halo);
    kit.add(group);
    const rock = wobble();
    const colour = new THREE.Color();
    let flash = 0;
    return {
      step(ctx) {
        const moving = settle(rock, ctx.dt);
        group.rotation.z = rock.a;
        flash = Math.max(0, flash - ctx.dt * 2.2);
        const hue = (ctx.T * 0.08) % 1;
        tubes.forEach((t, i) => t.material.color.copy(colour.setHSL((hue + i * 0.33) % 1, 0.9, 0.55 + flash * 0.4)));
        arch.material.color.copy(colour.setHSL((hue + 0.6) % 1, 0.9, 0.55 + flash * 0.4));
        halo.material.color.copy(colour.setHSL(hue, 0.8, 0.5));
        halo.material.opacity = 0.16 + flash * 0.4;
        return moving || flash > 0 ? 2 : 1;
      },
      kick(ctx, strength) {
        ctx.emit("jukebox.skip");
        flash = 1;
        if (ctx.calm) return;
        rock.v += 1.1 * strength * (Math.random() < 0.5 ? -1 : 1);
        // A few notes shake loose.
        for (let i = 0; i < 6; i++) ctx.sparks.add(kit.spot + (Math.random() - 0.5) * 0.8, 1.6, SPACE.zBack + 0.7, (Math.random() - 0.5) * 0.9, 0.9 + Math.random(), 1.6, 0.2, colour.setHSL(Math.random(), 0.9, 0.6).getHex(), 0.2);
      },
    };
  },

  /** The studio's prize wheel: it turns slowly, and spins when it is knocked. */
  wheel(kit) {
    const tex = kit.texture(
      canvasOf(512, 512, (g) => {
        const cols = ["#38bdf8", "#f4b453", "#b39dfc", "#ff7a6b", "#7fe08a", "#ffffff", "#38bdf8", "#f4b453", "#b39dfc", "#ff7a6b", "#7fe08a", "#ffffff"];
        cols.forEach((c, i) => {
          g.fillStyle = c;
          g.beginPath();
          g.moveTo(256, 256);
          g.arc(256, 256, 244, (i / 12) * 6.2832, ((i + 1) / 12) * 6.2832);
          g.fill();
          g.save();
          g.translate(256, 256);
          g.rotate(((i + 0.5) / 12) * 6.2832);
          g.fillStyle = "#0a1230";
          g.font = '900 44px "Nunito", system-ui, sans-serif';
          g.textAlign = "center";
          g.fillText(["3", "1", "2", "?", "1", "0", "2", "1", "3", "!", "1", "0"][i], 180, 16);
          g.restore();
        });
        g.strokeStyle = "#0a1230";
        g.lineWidth = 14;
        g.beginPath();
        g.arc(256, 256, 244, 0, 7);
        g.stroke();
        g.fillStyle = "#0a1230";
        g.beginPath();
        g.arc(256, 256, 34, 0, 7);
        g.fill();
      }),
    );
    const wheel = new THREE.Mesh(new THREE.CircleGeometry(0.72, 40), new THREE.MeshBasicMaterial({ map: tex }));
    wheel.position.set(kit.spot, 1.22, SPACE.zBack + 0.2);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.22, 0.1), new THREE.MeshLambertMaterial({ color: 0x1c2854 }));
    stand.position.set(kit.spot, 0.61, SPACE.zBack + 0.12);
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 3), new THREE.MeshBasicMaterial({ color: 0xff7a6b }));
    pointer.position.set(kit.spot, 2.0, SPACE.zBack + 0.24);
    pointer.rotation.z = Math.PI;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), additive(kit.radial, 0x38bdf8, 0.22));
    halo.position.set(kit.spot, 1.22, SPACE.zBack + 0.1);
    kit.add(halo);
    kit.add(stand);
    kit.add(wheel);
    kit.add(pointer);
    let spin = 0;
    let turn = 0;
    return {
      step(ctx) {
        spin = Math.max(0, spin - ctx.dt * (0.6 + spin * 0.5));
        turn += ctx.dt * (spin + (ctx.calm ? 0.05 : 0.22));
        wheel.rotation.z = -turn;
        pointer.rotation.x = spin > 0.3 ? Math.sin(turn * 12) * 0.4 : 0;
        return spin > 0.05 ? 2 : 1;
      },
      kick(ctx, strength) {
        ctx.emit("wheel.spin");
        spin = Math.max(spin, (ctx.calm ? 1.5 : 9) * strength);
      },
    };
  },

  /** The rooftop's vent, its fan, and the pigeons on it, who leave when the vent is knocked. */
  pigeons(kit) {
    const vent = crate(kit, 1.1, 0.8, 0.6, 0x4a4458, (g, w, h) => {
      g.fillStyle = "#5a5468";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#1a1626";
      g.beginPath();
      g.arc(w / 2, h / 2, h * 0.36, 0, 7);
      g.fill();
      g.strokeStyle = "#8a84a0";
      g.lineWidth = 6;
      g.stroke();
      for (let y = 14; y < h; y += h - 28) for (let x = 14; x < w; x += w - 28) g.fillRect(x - 4, y - 4, 8, 8);
    });
    vent.position.set(kit.spot, 0.4, SPACE.zBack + 0.34);
    const fan = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.09), new THREE.MeshBasicMaterial({ color: 0x9a94b0 }));
    const fan2 = fan.clone();
    fan2.rotation.z = Math.PI / 2;
    const blades = new THREE.Group();
    blades.add(fan, fan2);
    blades.position.set(kit.spot, 0.4, SPACE.zBack + 0.65);
    kit.add(vent);
    kit.add(blades);
    const bird = kit.texture(
      canvasOf(128, 64, (g) => {
        for (const f of [0, 1]) {
          g.save();
          g.translate(f * 64, 0);
          g.fillStyle = "#8a8fa6";
          g.beginPath();
          g.ellipse(30, 40, 18, 12, -0.2, 0, 7);
          g.fill();
          g.beginPath();
          g.arc(46, 26, 8, 0, 7);
          g.fill();
          g.fillStyle = "#5a5f78";
          g.beginPath();
          if (f) g.ellipse(26, 22, 20, 8, -0.9, 0, 7);
          else g.ellipse(24, 40, 14, 7, 0.2, 0, 7);
          g.fill();
          g.fillStyle = "#ffb347";
          g.fillRect(53, 26, 7, 3);
          g.fillStyle = "#b06cff";
          g.fillRect(38, 32, 8, 4);
          g.restore();
        }
      }),
    );
    const birds = [-0.34, 0.02, 0.36].map((dx, i) => {
      const tex = bird.clone();
      tex.needsUpdate = true;
      tex.repeat.set(0.5, 1);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.scale.x = i === 1 ? -1 : 1;
      kit.add(mesh);
      return { mesh, tex, dx, away: 0 };
    });
    let gone = -1;
    return {
      step(ctx) {
        blades.rotation.z = ctx.T * (ctx.calm ? 1 : 7);
        const since = gone < 0 ? 99 : (ctx.now - gone) / 1000;
        // Up and off to one side, a wait, then back down to the vent.
        const out = since < 1.2 ? since / 1.2 : since < 5 ? 1 : Math.max(0, 1 - (since - 5) / 1.6);
        birds.forEach((b, i) => {
          const far = out * out;
          b.mesh.position.set(kit.spot + b.dx + far * (2.2 + i * 0.7) * (i === 1 ? -1 : 1), 0.88 + far * (3.4 + i * 0.5) + (out ? 0 : Math.max(0, Math.sin(ctx.T * 1.3 + i * 2)) * 0.015), SPACE.zBack + 0.5);
          b.tex.offset.x = out > 0 && out < 1 ? (Math.floor(ctx.T * 10 + i) % 2) / 2 : out === 1 ? 0.5 : 0;
          b.mesh.visible = out < 1;
        });
        return since < 6.6 ? 2 : 1;
      },
      kick(ctx) {
        if (gone >= 0 && ctx.now - gone < 6600) return;
        ctx.emit("pigeons.scatter");
        if (!ctx.calm) gone = ctx.now;
      },
    };
  },

  /**
   * The campfire: flames that flicker, sparks that rise, and a piece that stands too close gets
   * toasty. Toasty is a look, not a rule: smoke, a singe that fades, and one startled hop.
   */
  campfire(kit) {
    const at = new THREE.Vector3(kit.spot * WALK, 0, SPACE.walkZ - 1.15);
    const here = worldX(kit.spot);
    const log = new THREE.MeshLambertMaterial({ color: 0x3a2414 });
    for (const a of [0.5, -0.6, 1.7]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.95, 8), log);
      m.rotation.set(Math.PI / 2 - 0.25, a, 0, "YXZ");
      m.position.copy(at).setY(0.15);
      kit.add(m);
    }
    const stones = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: 0x5a5a58 }), 9);
    const o = new THREE.Object3D();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      o.position.set(at.x + Math.sin(a) * 0.62, 0.07, at.z + Math.cos(a) * 0.46);
      o.scale.set(1, 0.7, 1);
      o.updateMatrix();
      stones.setMatrixAt(i, o.matrix);
    }
    kit.add(stones);
    const flames = [[0, 1.15, 0.25, 0xff8a2a], [-0.17, 0.75, 0.18, 0xffb03a], [0.18, 0.85, 0.17, 0xffb03a], [0.02, 0.6, 0.12, 0xfff0a0]].map(([dx, hgt, r, col], i) => {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(r, hgt, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), transparent: true, opacity: 0.92 }));
      flame.position.set(at.x + dx, 0.2 + hgt / 2, at.z + (i ? 0.07 : 0));
      flame.userData = { h: hgt };
      kit.add(flame);
      return flame;
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), additive(kit.radial, 0xff8a3a, 0.75));
    halo.position.set(at.x, 0.7, at.z + 0.12);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), additive(kit.radial, 0xff8a3a, 0.3));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(at.x, 0.01, at.z + 0.6);
    kit.add(halo);
    kit.add(glow);
    const heat = new Map();
    let spark = 0;
    return {
      /** The fire warms the pieces near it, as the lamps do. */
      warmth: (x) => Math.max(0, 1 - Math.abs(x - here) / 330) * 0.55,
      step(ctx) {
        const t = ctx.T;
        flames.forEach((f, i) => {
          const s = 1 + 0.16 * Math.sin(t * (7 + i * 2.3) + i) + 0.08 * Math.sin(t * 17.3 + i * 4);
          f.scale.set(1, s, 1);
          f.position.y = 0.2 + (f.userData.h * s) / 2;
        });
        halo.material.opacity = 0.68 + 0.1 * Math.sin(t * 9.1) + 0.05 * Math.sin(t * 23);
        glow.material.opacity = 0.26 + 0.06 * Math.sin(t * 8.3);
        if (!ctx.calm && ctx.now > spark) {
          spark = ctx.now + 160 + Math.random() * 260;
          ctx.sparks.add(at.x + (Math.random() - 0.5) * 0.3, 0.9, at.z, (Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 0.9, 1.6, 0.07, 0xffb347, -0.2);
        }
        let busy = 1;
        for (const p of ctx.pieces) {
          const close = Math.abs(p.x - here) < 92;
          let h = heat.get(p.seat) ?? { time: 0, char: 0, yelped: false, puff: 0 };
          h.time = close ? h.time + ctx.dt : 0;
          if (close && h.time > 0.9) {
            h.char = Math.min(1, h.char + ctx.dt * 0.9);
            if (!h.yelped) {
              h.yelped = true;
              ctx.emit("fire.toasty", { seat: p.seat });
              if (!ctx.calm) p.fx.hopAt = ctx.now;
            }
            if (!ctx.calm && ctx.now > h.puff) {
              h.puff = ctx.now + 170;
              ctx.smoke.add(walkX(p.x) + (Math.random() - 0.5) * 0.2, 0.95 + p.up * PX, SPACE.walkZ + 0.05, (Math.random() - 0.5) * 0.2, 0.7, 1.3, 0.3, 0x2a2420, 0, 1.4);
            }
          } else if (!close) {
            h.char = Math.max(0, h.char - ctx.dt * 0.22);
            h.yelped = h.yelped && h.char > 0.05;
          }
          p.fx.char = h.char;
          if (h.char > 0) busy = 2;
          heat.set(p.seat, h);
        }
        return busy;
      },
      kick() {},
    };
  },

  /** The fairground's high striker: knock it and the puck runs up the tower; hard enough and the lamp on top lights. */
  striker(kit) {
    const tower = crate(kit, 0.5, 2.5, 0.16, 0x2d6f6a, (g, w, h) => {
      g.fillStyle = "#f3e9d2";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#2d8f88";
      g.fillRect(0, 0, w * 0.2, h);
      g.fillRect(w * 0.8, 0, w * 0.2, h);
      g.fillStyle = "#1c3a44";
      g.fillRect(w * 0.47, h * 0.06, w * 0.06, h * 0.86);
      const words = ["CHAMP", "STRONG", "NOT BAD", "FEEBLE", "OH DEAR"];
      g.font = `900 ${w * 0.11}px "Nunito", system-ui, sans-serif`;
      g.textAlign = "center";
      words.forEach((word, i) => {
        g.fillStyle = i ? "#1c3a44" : "#e8604c";
        g.fillText(word, w / 2, h * (0.16 + i * 0.17));
        g.fillStyle = "#e8604c";
        g.fillRect(w * 0.26, h * (0.19 + i * 0.17), w * 0.48, 4);
      });
    });
    tower.position.set(kit.spot, 1.3, SPACE.zBack + 0.16);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0xe8604c }));
    base.position.set(kit.spot, 0.08, SPACE.zBack + 0.3);
    const puck = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.08), new THREE.MeshBasicMaterial({ color: 0x1c3a44 }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshBasicMaterial({ color: 0x5a4a30 }));
    lamp.position.set(kit.spot, 2.7, SPACE.zBack + 0.2);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), additive(kit.radial, 0xffd45c, 0));
    halo.position.set(kit.spot, 2.7, SPACE.zBack + 0.3);
    for (const m of [tower, base, puck, lamp, halo]) kit.add(m);
    let shot = null;
    return {
      step(ctx) {
        const t = shot ? (ctx.now - shot.at) / 1000 : 9;
        // Up fast, a hang at the top, down under its own weight.
        const up = t < 0.5 ? 1 - Math.pow(1 - t / 0.5, 2) : Math.max(0, 1 - Math.pow((t - 0.5) / 0.7, 2));
        const reach = shot ? shot.reach : 0;
        puck.position.set(kit.spot, 0.3 + up * reach * 2.15, SPACE.zBack + 0.26);
        const rung = shot && reach > 0.92 && t > 0.4 && t < 1.6;
        lamp.material.color.set(rung ? 0xffe9a8 : 0x5a4a30);
        halo.material.opacity = rung ? 0.8 : 0;
        return t < 1.3 ? 2 : 1;
      },
      kick(ctx, strength) {
        if (shot && ctx.now - shot.at < 1300) return;
        const reach = Math.min(1, 0.45 + strength * 0.6 * (0.6 + chance(ctx.seed, Math.floor(ctx.T), 3) * 0.6));
        ctx.emit(reach > 0.92 ? "striker.top" : "striker.hit");
        if (!ctx.calm) shot = { at: ctx.now, reach };
      },
    };
  },

  /** The arcade's claw machine: the claw wanders, and when the cabinet is knocked it drops and a prize falls out. */
  claw(kit) {
    const cabinet = crate(kit, 1.15, 2.05, 0.6, 0x1b1532, (g, w, h) => {
      g.fillStyle = "#1b1532";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ff4fd8";
      g.fillRect(0, 0, w, h * 0.09);
      g.fillStyle = "#0a0618";
      g.font = `900 ${h * 0.05}px ui-monospace, Menlo, Consolas, monospace`;
      g.textAlign = "center";
      g.fillText("GRAB-A-PRIZE", w / 2, h * 0.066);
      g.fillStyle = "#2a1a5a";
      g.fillRect(w * 0.07, h * 0.12, w * 0.86, h * 0.46);
      // The heap of prizes.
      ["#ff4fd8", "#35e8ff", "#ffe14f", "#7dff6a", "#ff7a3a", "#9a7bff", "#35e8ff", "#ffe14f"].forEach((c, i) => {
        g.fillStyle = c;
        g.beginPath();
        g.arc(w * (0.16 + i * 0.097), h * (0.53 - (i % 3) * 0.025), w * 0.07, 0, 7);
        g.fill();
      });
      g.strokeStyle = "#35e8ff";
      g.lineWidth = 6;
      g.strokeRect(w * 0.07, h * 0.12, w * 0.86, h * 0.46);
      g.fillStyle = "#0a0618";
      g.fillRect(w * 0.62, h * 0.74, w * 0.26, h * 0.14);
      g.fillStyle = "#ffe14f";
      g.beginPath();
      g.arc(w * 0.26, h * 0.68, w * 0.05, 0, 7);
      g.fill();
      g.fillStyle = "#ff3b4e";
      g.beginPath();
      g.arc(w * 0.44, h * 0.68, w * 0.04, 0, 7);
      g.fill();
    });
    cabinet.position.set(kit.spot, 1.025, SPACE.zBack + 0.34);
    const grab = new THREE.Group();
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1, 0.02), new THREE.MeshBasicMaterial({ color: 0xdfe8f5 }));
    const hand = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 5, 12, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color: 0xdfe8f5 }));
    hand.rotation.z = Math.PI * 0.85;
    grab.add(cable, hand);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.4), additive(kit.radial, 0xff4fd8, 0.25));
    halo.position.set(kit.spot, 1.2, SPACE.zBack + 0.2);
    for (const m of [halo, cabinet, grab]) kit.add(m);
    let drop = -1;
    return {
      step(ctx) {
        const t = drop < 0 ? 9 : (ctx.now - drop) / 1000;
        const down = t < 0.5 ? t / 0.5 : t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.9);
        const x = kit.spot + Math.sin(ctx.T * (ctx.calm ? 0.2 : 0.7)) * 0.34;
        const len = 0.12 + down * 0.5;
        cable.scale.y = len;
        cable.position.set(x, 1.8 - len / 2, SPACE.zBack + 0.66);
        hand.position.set(x, 1.8 - len - 0.06, SPACE.zBack + 0.66);
        halo.material.opacity = 0.2 + 0.08 * Math.sin(ctx.T * 2.4) + (t < 1.7 ? 0.25 : 0);
        return t < 1.7 ? 2 : 1;
      },
      kick(ctx) {
        if (drop >= 0 && ctx.now - drop < 1700) return;
        ctx.emit("claw.drop");
        drop = ctx.now;
        if (ctx.calm) return;
        const colours = [0xff4fd8, 0x35e8ff, 0xffe14f, 0x7dff6a];
        for (let i = 0; i < 5; i++) ctx.sparks.add(kit.spot + 0.3, 0.55, SPACE.zBack + 0.75, 0.3 + Math.random() * 0.9, 1.2 + Math.random() * 1.2, 1.5, 0.22, colours[i % 4], 5);
      },
    };
  },

  /** The star lounge's chart table: a turning globe of light, which spins up and changes colour when it is knocked. */
  holo(kit) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.5, 20), new THREE.MeshLambertMaterial({ color: 0xb9c6da }));
    base.position.set(kit.spot, 0.25, SPACE.zBack + 0.6);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 28), new THREE.MeshBasicMaterial({ color: 0x6ee7ff }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(kit.spot, 0.5, SPACE.zBack + 0.6);
    const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), new THREE.MeshBasicMaterial({ color: 0x6ee7ff, wireframe: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    globe.position.set(kit.spot, 1.35, SPACE.zBack + 0.6);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.012, 4, 40), additive(null, 0x9d8bff, 0.9));
    ring.position.copy(globe.position);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.9, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(kit.spot, 0.95, SPACE.zBack + 0.6);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), additive(kit.radial, 0x6ee7ff, 0.3));
    halo.position.set(kit.spot, 1.3, SPACE.zBack + 0.3);
    for (const m of [halo, base, rim, beam, globe, ring]) kit.add(m);
    const calm = new THREE.Color(0x6ee7ff);
    const hot = new THREE.Color(0xff5fd0);
    let spin = 0;
    let turn = 0;
    return {
      step(ctx) {
        spin = Math.max(0, spin - ctx.dt * 1.6);
        turn += ctx.dt * (0.35 + spin * 2.2);
        globe.rotation.set(0.3, turn, 0);
        ring.rotation.set(1.2 + Math.sin(ctx.T * 0.4) * 0.3, turn * 0.6, 0);
        const heat = Math.min(1, spin / 3);
        globe.material.color.copy(calm).lerp(hot, heat);
        // A scan line: the light dips now and then, as a projected thing does.
        globe.material.opacity = (0.6 + 0.15 * Math.sin(ctx.T * 3)) * (Math.sin(ctx.T * 37) > 0.96 ? 0.4 : 1);
        globe.scale.setScalar(1 + heat * 0.25);
        halo.material.color.copy(globe.material.color);
        halo.material.opacity = 0.26 + heat * 0.3;
        return spin > 0.05 ? 2 : 1;
      },
      kick(ctx, strength) {
        ctx.emit("holo.spin");
        spin = Math.max(spin, (ctx.calm ? 1 : 4.5) * strength);
        if (ctx.calm) return;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * 6.283;
          ctx.sparks.add(globe.position.x, globe.position.y, globe.position.z, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0.8, 0.14, 0xff5fd0, 0);
        }
      },
    };
  },

  /** The submarine's big porthole: a rim round the hole the wall painter cut, and bubbles when someone knocks on the glass. */
  porthole(kit, def) {
    const r = def.r ?? 0.78;
    const y = def.y ?? 1.42;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 8, 40), new THREE.MeshLambertMaterial({ color: 0xc9933a }));
    rim.position.set(kit.spot, y, SPACE.zBack + 0.05);
    const bolts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshLambertMaterial({ color: 0xe6c27a }), 12);
    const o = new THREE.Object3D();
    for (let i = 0; i < 12; i++) {
      o.position.set(kit.spot + Math.cos((i / 12) * 6.283) * r, y + Math.sin((i / 12) * 6.283) * r, SPACE.zBack + 0.15);
      o.updateMatrix();
      bolts.setMatrixAt(i, o.matrix);
    }
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r, 40), additive(kit.radial, 0x7fffe0, 0.1));
    glass.position.set(kit.spot, y, SPACE.zBack + 0.02);
    for (const m of [glass, rim, bolts]) kit.add(m);
    return {
      step() {
        return 1;
      },
      kick(ctx) {
        ctx.emit("porthole.knock");
        if (ctx.calm) return;
        for (let i = 0; i < 9; i++) ctx.sparks.add(kit.spot + (Math.random() - 0.5) * r, y - r * 0.6, SPACE.zBack + 0.03, (Math.random() - 0.5) * 0.2, 0.8 + Math.random() * 0.8, 1.5, 0.1, 0xbffff0, -0.3);
      },
    };
  },

  /** The alley's food stall: a pot that steams, and a paper lantern over it that swings when the stall is knocked. */
  stall(kit) {
    const cart = crate(kit, 1.3, 0.95, 0.6, 0x5a2f1c, (g, w, h) => {
      g.fillStyle = "#6a3a22";
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += w / 7) {
        g.fillStyle = "rgba(0,0,0,.3)";
        g.fillRect(x, 0, 3, h);
      }
      g.fillStyle = "#1c2a55";
      g.fillRect(0, 0, w, h * 0.3);
      g.fillStyle = "#f3e9d2";
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(w * (0.14 + i * 0.24), h * 0.15, h * 0.09, 0, 7);
        g.fill();
      }
    });
    cart.position.set(kit.spot, 0.475, SPACE.zBack + 0.36);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.3, 16), new THREE.MeshLambertMaterial({ color: 0x3a3a40 }));
    pot.position.set(kit.spot - 0.25, 1.1, SPACE.zBack + 0.4);
    const lantern = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff5a3a }));
    paper.scale.y = 1.3;
    paper.position.y = -0.5;
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.3, 0.015), new THREE.MeshBasicMaterial({ color: 0x1a120a }));
    cord.position.y = -0.15;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), additive(kit.radial, 0xff6a3a, 0.5));
    halo.position.set(0, -0.5, 0.05);
    lantern.add(paper, cord, halo);
    lantern.position.set(kit.spot + 0.42, 2.2, SPACE.zBack + 0.5);
    for (const m of [cart, pot, lantern]) kit.add(m);
    const sway = wobble();
    let puff = 0;
    return {
      step(ctx) {
        const moving = settle(sway, ctx.dt, 22, 1.2);
        lantern.rotation.z = sway.a + Math.sin(ctx.T * 0.9) * 0.03;
        if (ctx.now > puff) {
          puff = ctx.now + 240;
          ctx.sparks.add(kit.spot - 0.25 + (Math.random() - 0.5) * 0.2, 1.3, SPACE.zBack + 0.45, (Math.random() - 0.5) * 0.12, 0.5, 1.8, 0.34, 0x4a4a52, 0, 1.2);
        }
        return moving ? 2 : 1;
      },
      kick(ctx, strength) {
        ctx.emit("stall.knock");
        if (!ctx.calm) sway.v += 1.6 * strength;
      },
    };
  },
};

// ---------------------------------------------------------------- reactions every room can have

const REACTIONS = {
  /**
   * Footsteps that light the floor behind a walking piece and fade.
   * {kind: "trail", colours, size (metres), fade (seconds)}
   */
  trail(kit, def) {
    const N = 40;
    const mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(def.size, 6), additive(null), N);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.007;
    mesh.frustumCulled = false;
    const o = new THREE.Object3D();
    const colour = new THREE.Color();
    const tiles = [];
    const last = new Map();
    kit.add(mesh);
    return {
      step(ctx) {
        for (const p of ctx.pieces) {
          const from = last.get(p.seat) ?? p.x;
          if (Math.abs(p.x - from) < 46 || p.air) continue;
          last.set(p.seat, p.x);
          if (tiles.length >= N) tiles.shift();
          tiles.push({ x: walkX(p.x), born: ctx.now, colour: def.colours[(Math.round(p.x / 46) + p.seat) % def.colours.length] });
        }
        while (tiles.length && ctx.now - tiles[0].born > def.fade * 1000) tiles.shift();
        tiles.forEach((t, i) => {
          // The mesh lies flat, so its own y runs toward the back of the room.
          o.position.set(t.x, -SPACE.walkZ, 0);
          o.updateMatrix();
          mesh.setMatrixAt(i, o.matrix);
          mesh.setColorAt(i, colour.set(t.colour).multiplyScalar(0.8 * (1 - (ctx.now - t.born) / (def.fade * 1000))));
        });
        mesh.count = tiles.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        return tiles.length ? 2 : 0;
      },
    };
  },
};

// ---------------------------------------------------------------- the engine

export class Life {
  /**
   * @param {object} kit  what a kind may use: {skin, L, radial, add(mesh), texture(canvas), lamps}
   *   `lamps` is one per box: {group, x (world units), hangs} so a jump under one can swing it.
   */
  constructor(kit) {
    this.kit = kit;
    this.skin = kit.skin;
    this.calmQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.sparks = new Dots(kit.radial, 96, true);
    this.smoke = new Dots(kit.radial, 32, false);
    kit.add(this.sparks.mesh);
    kit.add(this.smoke.mesh);
    kit.spot = kit.L.boardX;
    this.spotX = worldX(kit.L.boardX);
    this.ambient = [];
    this.events = [];
    this.reactions = [];
    this.feature = null;
    (this.skin.life ?? []).forEach((def, index) => {
      if (AMBIENT[def.kind]) this.ambient.push(AMBIENT[def.kind](kit, def));
      else if (EVENTS[def.kind]) this.events.push({ def, index, thing: EVENTS[def.kind](kit, def), n: -1 });
      else if (REACTIONS[def.kind]) this.reactions.push(REACTIONS[def.kind](kit, def));
      else if (def.kind === "feature" && FEATURES[def.is]) this.feature = FEATURES[def.is](kit, def);
    });
    this.swings = kit.lamps.map(() => wobble());
    this.air = new Map();
    this.base = 0;
    this.since = performance.now();
    this.seed = 1;
    this.force = null;
  }

  /** The room said how long it has left: that is the clock every device in the room shares. */
  clock(room, now) {
    const age = ROOM_LIFE - (room.closesIn ?? ROOM_LIFE * 1000) / 1000;
    // Hold the first reading; take a new one only if this device has drifted from it (a sleep, a long stall).
    if (!this.synced || Math.abs(age - this.T(now)) > 1.5) {
      this.base = age;
      this.since = now;
      this.synced = true;
    }
    this.seed = seedOf(room.pin ?? "");
  }

  /** Room time in seconds: the same number on every device in the room. */
  T(now) {
    return this.base + (now - this.since) / 1000;
  }

  /** The name a sound system listens for, on window: "party-room:sound", detail {name, room}. */
  emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent("party-room:sound", { detail: { name, room: this.skin.id, ...detail } }));

  /** When each timed event next starts: [{name, at (room seconds), lasts}], for stills and for the curious. */
  schedule(now) {
    const T = this.T(now);
    return this.events.map((e) => ({ name: e.def.name, at: nextStart(e.def, e.index, T, this.seed), lasts: e.def.lasts }));
  }

  /** A bump happened (every device hears it): if it was by the room's feature, the feature is knocked. */
  onBump(by, hit) {
    const near = [by, hit].some((p) => p && Math.abs(p.rx - this.spotX) < REACH);
    if (near) this.knock = { strength: hit ? 1 : 0.6 };
  }

  /**
   * One frame. `pieces` is [{seat, x, up, air, fx}]; `fx` is where a reaction leaves what it
   * wants a piece to look like ({char, hopAt}), which is all it may do to one.
   * Returns 0 when nothing here needs drawing, 1 for ambient life only, 2 while something is happening.
   */
  frame(now, dt, view, pieces) {
    const calm = !!this.calmQuery?.matches;
    const T = this.T(now);
    const ctx = { now, dt, T, calm, pieces, seed: this.seed, sparks: this.sparks, smoke: this.smoke, emit: this.emit };
    let busy = 0;
    for (const a of this.ambient) busy = Math.max(busy, a.step(ctx));
    for (const e of this.events) {
      const on = calm && !e.def.calm ? null : this.force === e.def.name ? { u: this.forceU, n: 1, r: 0.3, r2: 0.5 } : occurrence(e.def, e.index, T, this.seed);
      if (on && on.n !== e.n) {
        e.n = on.n;
        this.emit(e.def.sound ?? e.def.name);
      }
      busy = Math.max(busy, e.thing.step(ctx, on));
    }
    for (const r of this.reactions) busy = Math.max(busy, r.step(ctx));

    // Jumps: taking off under a lamp sets it swinging, landing throws up dust, and landing by the feature knocks it.
    for (const p of pieces) {
      const was = this.air.get(p.seat) ?? false;
      this.air.set(p.seat, p.air);
      if (p.air && !was) {
        const i = this.kit.lamps.findIndex((l) => l.hangs && Math.abs(l.x - p.x) < 100);
        if (i >= 0) {
          this.emit("lamp.swing");
          if (!calm) this.swings[i].v += 1.5 * (p.x >= this.kit.lamps[i].x ? 1 : -1);
        }
      } else if (!p.air && was) {
        this.emit("piece.land", { seat: p.seat });
        if (!calm) for (const s of [-1, 1]) this.smoke.add(walkX(p.x) + s * 0.16, 0.06, SPACE.walkZ + 0.1, s * 0.5, 0.12, 0.5, 0.22, this.skin.dust ?? 0x6a5a4a, 0, 1.2);
        if (Math.abs(p.x - this.spotX) < REACH * 0.7) this.knock = { strength: 0.5 };
      }
    }
    this.kit.lamps.forEach((lamp, i) => {
      if (settle(this.swings[i], dt, 18, 0.9)) busy = 2;
      lamp.group.rotation.z = this.swings[i].a;
    });

    if (this.feature) {
      if (this.knock) this.feature.kick(ctx, this.knock.strength);
      // The feature is at the right end of the room: a phone looking elsewhere does not pay for it.
      const seen = this.spotX + 260 > view.x && this.spotX - 260 < view.x + view.width;
      if (seen || this.feature.warmth) busy = Math.max(busy, this.feature.step(ctx));
    }
    this.knock = null;
    if (this.sparks.step(dt)) busy = 2;
    if (this.smoke.step(dt)) busy = 2;
    return busy;
  }

  /** How much a room's own fire or glow lights a piece at world x, on top of the lamps (0 to 1). */
  warmth(x) {
    return this.feature?.warmth?.(x) ?? 0;
  }
}
