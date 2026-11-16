// The bump, drawn. Everything that decides anything (who is hit, how long each state lasts,
// how a piece holds itself in each) is lobby/shared/bump.js; this file only turns those numbers
// into SVG: a pose for a piece, dizzy eyes, a burst where the blow lands, dust where the piece
// comes down, a ring under the viewer's own piece while its bump recharges, and a small jolt
// of the picture. A room drawn another way (3D) would replace this file and keep the rules.
//
// It also draws the ghost's scare and spook (lobby/shared/ghost.js, frightPose): a frightened
// piece starts, freezes and scurries off, with wide eyes and a pale tint, as its own character
// does them (`scared` in its flat definition). Neither jolts the picture.
import { s, set } from "./dom.js";
import { IMMUNE_MS, IMPACT_MS, PIECE_PIVOT, STUN_MS, attackPose, cooldownFraction, impactPoint, knockPose } from "./shared/bump.js";
import { SCARE, SPOOK, frightPose, frightResumed } from "./shared/ghost.js";
import { ROOM } from "./shared/world.js";

const BURST_MS = 240;
const DUST_MS = 420;
const JOLT_MS = 170;
const READY_MS = 420;
const STILL = { x: null, dx: 0, lift: 0, tilt: 0, pivot: 0, sx: 1, sy: 1, state: "idle", dizzy: false, safe: false, scared: 0, pale: 0 };

const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A short buzz on phones that have one (many do not, and say nothing). */
export function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not allowed here: the picture and the sound of friends laughing will do.
  }
}

export class BumpDraw {
  /** @param {{fx: SVGGElement, floor: SVGGElement}} layers  where bursts and dust go, and the ring under a piece */
  constructor(layers) {
    this.layers = layers;
    this.fx = [];
    this.joltAt = -Infinity;
    this.joltSize = 0;
    // The ring under the viewer's own piece: how far its bump has recharged.
    this.ring = s("g", { display: "none", "pointer-events": "none" });
    this.ringTrack = s("ellipse", { cy: ROOM.floorY + 5, rx: 52, ry: 14, fill: "none", stroke: "#f4b453", "stroke-width": 3, opacity: 0.22 });
    this.ringSweep = s("ellipse", { cy: ROOM.floorY + 5, rx: 52, ry: 14, fill: "none", stroke: "#f4b453", "stroke-width": 4, "stroke-linecap": "round", pathLength: 100 });
    this.ring.append(this.ringTrack, this.ringSweep);
    layers.floor.append(this.ring);
    this.cooling = false;
    this.readyAt = -Infinity;
  }

  // ---------------------------------------------------------------- what happened

  /** A piece began a bump at `now`, facing `dir`. `landed`: it hit somebody (known once the room says). */
  attack(p, dir, now, landed = false) {
    p.attack = { at: now, dir: dir || 1, landed };
    // The bumper comes down on top of whoever it hits, so it is drawn in front of the others.
    p.g.parentNode?.append(p.g);
  }

  /** A piece was knocked from where it is drawn to `to`. `at` is when the bump that did it began. */
  knock(p, to, at) {
    p.knock = { at, from: p.rx, to, safeFor: IMMUNE_MS, burst: false, dust: false };
  }

  /**
   * A piece was frightened by a ghost and runs from where it is drawn to `to`: `kind` is "scare"
   * (it kicked a faded ghost; `at` is when its kick began) or "spook" (a faded ghost drifted
   * through it; `at` is now).
   */
  fright(p, to, at, kind) {
    p.fright = { at, from: p.rx, to, how: kind === "scare" ? SCARE : SPOOK, safeFor: IMMUNE_MS };
    p.knock = null;
  }

  /**
   * The room says a piece is on the floor or just up from it (for a page that arrived in the
   * middle): knocked, or scared or spooked (`fright`), drawn as what it is.
   */
  resume(p, x, down, safe, now, fright) {
    if (p.knock || p.fright || !(safe > 0)) return;
    if (fright) return void (p.fright = frightResumed(x, down, safe, fright, now));
    p.knock = { at: now - (STUN_MS - down), from: x, to: x, safeFor: safe - down, burst: true, dust: true };
  }

  // ---------------------------------------------------------------- every frame

  /**
   * How to draw a piece now: {x, dx, lift, tilt, pivot, sx, sy, state, dizzy, safe}. `x` is
   * where it is along the floor while it is being thrown (null: wherever it walks).
   */
  pose(p, now) {
    const f = p.fright;
    if (f) {
      const pose = frightPose(now - f.at, f.from, f.to, f.how, f.safeFor, calm());
      if (pose.state === "up") p.fright = null;
      // Until the kick reaches the ghost the kicker's own kick is drawn (below).
      else if (pose.state !== "standing") {
        if (pose.face) p.face = pose.face;
        return { x: pose.x, dx: pose.dx, lift: pose.lift, tilt: pose.tilt, pivot: 0, sx: pose.sx, sy: pose.sy, state: pose.state, dizzy: false, safe: pose.state === "safe", scared: pose.scared, pale: pose.pale };
      }
    }
    const k = p.knock;
    if (k) {
      const pose = knockPose(now - k.at, k.from, k.to, k.safeFor);
      if (pose.state === "up") p.knock = null;
      else {
        if (!k.burst && now - k.at >= IMPACT_MS) {
          k.burst = true;
          const at = impactPoint(k.from, k.to);
          this.burst(at.x, at.y, now);
        }
        if (!k.dust && (pose.state === "down" || pose.state === "rising")) {
          k.dust = true;
          this.dust(k.to, now);
        }
        // Until the blow lands the piece stands where it stood, although the room has already put it where it will land.
        const thrown = pose.state !== "standing" && pose.state !== "safe";
        return { x: pose.state === "safe" ? null : pose.x, dx: 0, lift: pose.lift, tilt: pose.tilt, pivot: PIECE_PIVOT, sx: pose.sx, sy: pose.sy, state: pose.state, dizzy: thrown, safe: pose.state === "safe" };
      }
    }
    const a = p.attack;
    if (a) {
      const pose = attackPose(now - a.at, a.dir, a.landed);
      if (pose.state === "idle") p.attack = null;
      // The bumper swings from its head (pose.pivot), so a tilt throws its base, not its head.
      else return { x: null, dx: pose.dx, lift: pose.lift, tilt: pose.tilt, pivot: pose.pivot, sx: pose.sx, sy: pose.sy, state: pose.state, dizzy: false, safe: false };
    }
    return STILL;
  }

  /**
   * Dizzy eyes while a piece is thrown and lying, and a blink while it cannot be knocked again.
   * How each looks is the character's own (p.kind.flat: characters/index.js).
   */
  dress(p, pose, now) {
    const flat = p.kind.flat;
    if (pose.dizzy !== !!p.dizzy) {
      p.dizzy = pose.dizzy;
      flat.dizzy(p.actor, pose.dizzy);
    }
    if (pose.safe) {
      p.blinking = true;
      flat.blink(p.actor, calm() ? 0.7 : 0.55 + 0.45 * Math.abs(Math.sin(now / 70)));
    } else if (p.blinking) {
      p.blinking = false;
      flat.blink(p.actor, null);
    }
    // Frightened by a ghost: the character's own wide eyes, and a pale tint over the whole piece
    // (the owner's "lighter pale tint for the scare"). Written only while it changes.
    const scared = Math.round((pose.scared || 0) * 20) / 20;
    const pale = Math.round((pose.pale || 0) * 20) / 20;
    if (scared !== (p.scaredK ?? 0)) {
      p.scaredK = scared;
      flat.scared(p.actor, scared);
      set(p.g, { "data-scared": scared || null });
    }
    if (pale !== (p.paleK ?? 0)) {
      p.paleK = pale;
      p.g.style.filter = pale > 0 ? `saturate(${(1 - 0.55 * pale).toFixed(2)}) brightness(${(1 + 0.32 * pale).toFixed(2)})` : "";
    }
  }

  /**
   * The ring under the viewer's own piece: it fills as the bump recharges and flashes when it
   * is ready. `left` is the milliseconds still to wait, and `share` how far it has recharged (0 to
   * 1; a bump's when not given: a ghost's fade has a longer cooldown).
   */
  cooldown(x, left, now, share) {
    const cooling = left > 0;
    if (cooling !== this.cooling) {
      this.cooling = cooling;
      if (!cooling) this.readyAt = now;
    }
    const flash = now - this.readyAt;
    if (!cooling && !(flash < READY_MS)) return void set(this.ring, { display: "none" });
    const u = cooling ? 0 : flash / READY_MS;
    set(this.ring, { display: null, transform: `translate(${x.toFixed(1)}, 0)`, opacity: cooling ? 1 : 1 - u });
    set(this.ringSweep, { "stroke-dasharray": `${((share ?? cooldownFraction(left)) * 100).toFixed(1)} 100`, rx: 52 + u * 22, ry: 14 + u * 6, "stroke-width": cooling ? 4 : 4 + (1 - u) * 3 });
    set(this.ringTrack, { display: cooling ? null : "none" });
  }

  /** Bursts and dust: grow, fade and go. */
  frame(now) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      const u = (now - f.at) / f.ms;
      if (u >= 1) {
        f.g.remove();
        this.fx.splice(i, 1);
        continue;
      }
      if (f.kind === "burst") {
        const grow = 0.5 + 0.6 * (1 - (1 - u) * (1 - u));
        set(f.g, { transform: `translate(${f.x}, ${f.y}) scale(${grow.toFixed(3)}) rotate(${(u * 22).toFixed(1)})`, opacity: u < 0.4 ? 1 : ((1 - u) / 0.6).toFixed(3) });
      } else {
        // Small puffs that spread along the floor, rise a little and thin out.
        f.bits.forEach((bit, n) => {
          const side = n % 2 ? 1 : -1;
          const far = 16 + (n >> 1) * 20;
          set(bit, { cx: (side * far * (0.35 + u)).toFixed(1), cy: (-u * (6 + n * 3)).toFixed(1), r: (5 + (n % 3) * 1.5 + u * 5).toFixed(1) });
        });
        set(f.g, { opacity: (0.34 * (1 - u) * (1 - u)).toFixed(3) });
      }
    }
  }

  /** How far the whole picture is jolted right now, in world units: {x, y}. */
  jolt(now) {
    const u = (now - this.joltAt) / JOLT_MS;
    if (!(u >= 0 && u < 1) || calm()) return { x: 0, y: 0 };
    const k = this.joltSize * (1 - u);
    return { x: Math.sin(u * 30) * k, y: Math.cos(u * 23) * k * 0.6 };
  }

  // ---------------------------------------------------------------- the effects

  /** A star where the blow lands, and a jolt of the picture. */
  burst(x, y, now) {
    const points = [];
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 8;
      const r = i % 2 ? 19 : 44;
      points.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
    }
    const g = s("g", { "pointer-events": "none" }, s("polygon", { points: points.join(" "), fill: "#ffd75e", stroke: "#fff6d8", "stroke-width": 4, "stroke-linejoin": "round" }), s("circle", { r: 11, fill: "#fff6d8" }));
    this.layers.fx.append(g);
    this.fx.push({ kind: "burst", g, x: x.toFixed(1), y: y.toFixed(1), at: now, ms: BURST_MS });
    this.joltAt = now;
    this.joltSize = 9;
  }

  /** A puff of dust where a piece comes down. */
  dust(x, now) {
    const bits = [0, 1, 2, 3, 4, 5].map(() => s("circle", { fill: "#e8d7b8" }));
    const g = s("g", { transform: `translate(${x.toFixed(1)}, ${ROOM.floorY + 2})`, "pointer-events": "none" }, ...bits);
    this.layers.fx.append(g);
    this.fx.push({ kind: "dust", g, bits, at: now, ms: DUST_MS });
    this.joltAt = now;
    this.joltSize = 5;
  }
}

/** The transform for a piece standing at (x, y) in a pose. */
export function poseTransform(x, y, pose) {
  let t = `translate(${(x + pose.dx).toFixed(1)}, ${(y - pose.lift).toFixed(1)})`;
  if (pose.tilt) t += ` rotate(${pose.tilt.toFixed(1)}, 0, ${-pose.pivot})`;
  if (pose.sx !== 1 || pose.sy !== 1) t += ` scale(${pose.sx.toFixed(3)}, ${pose.sy.toFixed(3)})`;
  return t;
}
