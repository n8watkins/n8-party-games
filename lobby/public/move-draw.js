// The robot's hook, drawn in the flat look: the line of light along the floor while it winds up
// (the tell), the chain from the robot's chest to the hook, the hook itself, and a spark where it
// clangs off a hardened slime or is batted away. Where everything is comes from the shared numbers
// (lobby/shared/robot.js, hookDrawn); the legs and the slime's harden and absorb are drawn by the
// characters themselves (characters/robot.js, characters/slime.js). The 3D look draws the same in
// look3d/moves3d.js.
import { s, set } from "./dom.js";
import { HOOK_HAND, HOOK_RANGE } from "./shared/robot.js";
import { ROOM } from "./shared/world.js";

const STEEL = "#c1c8d3";
const DARK = "#14161c";
const GLOW = "#ffe2a8";
const SPARK_MS = 260;
/** Where the chain leaves the robot: the plate on its chest, in front of its middle (world units above the floor). */
const CHEST = 52;

export class MoveDraw {
  /** @param {{floor: SVGGElement, fx: SVGGElement}} layers  the floor (the line of light) and over the pieces (the chain and hook) */
  constructor(layers) {
    this.layers = layers;
    this.hooks = new Map();
    this.sparks = [];
  }

  /**
   * One robot's hook for this frame: `drawn` from hookDrawn (null: put away), `x` where the robot
   * is drawn, `lift` how far up its legs hold it, `colour` its player's (the tell is drawn in it).
   */
  hook(seat, drawn, x, dir, lift = 0, colour = GLOW) {
    let h = this.hooks.get(seat);
    if (!drawn) {
      if (h) {
        h.g.remove();
        h.aim.remove();
        this.hooks.delete(seat);
      }
      return;
    }
    if (!h) {
      h = {
        // The tell: a bold band along the floor in the robot's own colour, edged in light, ending in
        // an arrow head, so at phone size it reads as "a hook is coming this way", never as a kick's wind-up.
        aim: s("g", { "pointer-events": "none", class: "hook-tell" }, s("rect", { height: 16, rx: 8, "stroke-width": 3 }), s("path", { "stroke-width": 3, "stroke-linejoin": "round" })),
        under: s("path", { fill: "none", stroke: DARK, "stroke-width": 8, "stroke-linecap": "round" }),
        chain: s("path", { fill: "none", stroke: STEEL, "stroke-width": 5, "stroke-dasharray": "7 4", "stroke-linecap": "round" }),
        head: s("path", { d: "M0,0 h10 a9,9 0 1,1 -9,12", fill: "none", stroke: STEEL, "stroke-width": 5, "stroke-linecap": "round" }),
        headUnder: s("path", { d: "M0,0 h10 a9,9 0 1,1 -9,12", fill: "none", stroke: DARK, "stroke-width": 8.5, "stroke-linecap": "round" }),
      };
      h.headG = s("g", {}, h.headUnder, h.head);
      h.g = s("g", { class: "robot-hook", "data-seat": seat, "pointer-events": "none" }, h.under, h.chain, h.headG);
      this.layers.fx.append(h.g);
      this.layers.floor.append(h.aim);
      this.hooks.set(seat, h);
    }
    set(h.g, { "data-state": drawn.state });
    // The tell: a band along the floor as far as the hook reaches, in the robot's colour, pulsing.
    const reach = HOOK_HAND + HOOK_RANGE;
    set(h.aim, { opacity: (0.35 + drawn.aim * 0.6).toFixed(2), display: drawn.aim > 0 ? null : "none" });
    if (drawn.aim > 0) {
      const [band, head] = h.aim.children;
      const end = x + dir * reach;
      set(band, { x: (dir > 0 ? x + 24 : end).toFixed(1), y: ROOM.floorY - 6, width: reach - 24, fill: colour, stroke: GLOW });
      set(head, { d: `M${(end + dir * 4).toFixed(1)},${ROOM.floorY + 2} l${-dir * 22},-16 v32 z`, fill: colour, stroke: GLOW });
    }
    const fromX = x + dir * 20;
    const fromY = ROOM.floorY - CHEST - lift;
    const toY = ROOM.floorY - drawn.y;
    const show = Math.abs(drawn.tip - fromX) > 4 && drawn.state !== "aim";
    const d = show ? `M${fromX.toFixed(1)},${fromY.toFixed(1)} L${drawn.tip.toFixed(1)},${toY.toFixed(1)}` : "";
    set(h.under, { d });
    set(h.chain, { d });
    set(h.headG, { display: drawn.state === "aim" ? "none" : null, transform: `translate(${drawn.tip.toFixed(1)},${toY.toFixed(1)}) scale(${dir},1)` });
  }

  /** A spark where the hook clangs off (or is batted away): a small star that grows and goes. */
  spark(x, y, now) {
    const points = [];
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const r = i % 2 ? 6 : 18;
      points.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
    }
    const g = s("g", { "pointer-events": "none", class: "hook-spark" }, s("polygon", { points: points.join(" "), fill: "#fff6d8", stroke: GLOW, "stroke-width": 2 }));
    this.layers.fx.append(g);
    this.sparks.push({ g, x, y, at: now });
  }

  /** Every frame: the sparks grow and go. */
  frame(now) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const f = this.sparks[i];
      const u = (now - f.at) / SPARK_MS;
      if (u >= 1) {
        f.g.remove();
        this.sparks.splice(i, 1);
        continue;
      }
      set(f.g, { transform: `translate(${f.x.toFixed(1)},${f.y.toFixed(1)}) scale(${(0.6 + u).toFixed(2)}) rotate(${(u * 40).toFixed(1)})`, opacity: (1 - u).toFixed(2) });
    }
  }

  /** Every hook put away (the room was built again). */
  clear() {
    for (const h of this.hooks.values()) {
      h.g.remove();
      h.aim.remove();
    }
    this.hooks.clear();
    for (const f of this.sparks) f.g.remove();
    this.sparks = [];
  }
}
