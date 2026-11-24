// The code-drawn potato: an SVG that redraws itself from potato-draw.js every frame. It is one
// renderer behind the art interface in art.js; the game never reaches past that interface.
//
// It eases toward what it is told (a spring, so growth has a little cartoon bounce), breathes
// (pulseAt), and plays three moments: "right" (it settles: a squash and a flare of the light),
// "worse" (a puff of steam as it swells) and "burst". "reset" puts it back to healthy at once.
// With reduced motion it does not breathe or bounce, the steam is skipped and the burst shows its
// end at once. While paused, nothing moves.

import { FLOOR_Y, FRAME, INK, CIRCUIT, SIZE, SKIN, SKIN_LIGHT, SKIN_SHADE, STAND, TETHER_SOCKET, burstShape, makeSpecimen, potatoShape, pulseAt, smoothPath } from "./potato-draw.js";

const NS = "http://www.w3.org/2000/svg";
const f = (v) => Math.round(v * 10) / 10;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function el(parent, name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}
const set = (node, attrs) => {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
};

/** A chamfered rectangle's outline. */
const chamfered = (x, y, w, h, c) => `M${x + c} ${y}H${x + w - c}L${x + w} ${y + c}V${y + h - c}L${x + w - c} ${y + h}H${x + c}L${x} ${y + h - c}V${y + c}Z`;

/** The frame's band: the outer chamfered edge, and the inner edge bowed where it is pushed. */
function framePath(fr) {
  const { left: L, right: R, top: T, bottom: B, band: w, chamfer: c } = fr;
  const outer = chamfered(L, T, R - L, B - T, c);
  const il = L + w;
  const ir = R - w;
  const it = T + w;
  const ib = B - w;
  const ci = c - w * 0.4;
  const { left: bl, right: br, top: bt } = fr.bow;
  // Inner edge, drawn the other way round so the band is a ring (evenodd).
  const inner =
    `M${il + ci} ${it}` +
    `Q${(il + ir) / 2} ${it - 2 * bt} ${ir - ci} ${it}` +
    `L${ir} ${it + ci}` +
    `Q${ir + 2 * br} ${(it + ib) / 2} ${ir} ${ib}` +
    `H${il}` +
    `Q${il - 2 * bl} ${(it + ib) / 2} ${il} ${it + ci}Z`;
  return { outer, inner, band: `${outer}${inner}` };
}

/**
 * Makes the code-drawn potato inside `host` (an element; the SVG fills it). Returns the art
 * interface: set(state), play(event), destroy(), plus look() for tests (what is drawn now).
 */
let made = 0;

export function createCodePotato(host, { seed = 7, reducedMotion = () => false } = {}) {
  const spec = makeSpecimen(seed);
  // Ids for the clip and the glow, unique on the page however many potatoes it draws.
  const id = `${seed}-${++made}`;
  const svg = el(host, "svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, class: "potato-art", "aria-hidden": "true", focusable: "false" });
  const defs = el(svg, "defs");
  const clip = el(defs, "clipPath", { id: `hp-body-${id}` });
  const clipPath = el(clip, "path");
  const glowGrad = el(defs, "radialGradient", { id: `hp-glow-${id}` });
  const glowStop0 = el(glowGrad, "stop", { offset: "0", "stop-opacity": "0.9" });
  const glowStop1 = el(glowGrad, "stop", { offset: "1", "stop-opacity": "0" });

  // The bay: back panel, a few panel lines, the floor, the frame band and its bolts.
  const bay = el(svg, "g", { class: "bay" });
  const back = el(bay, "path", { fill: "#2a1f19" });
  const lines = el(bay, "path", { fill: "none", stroke: "#3a2c23", "stroke-width": "3" });
  el(bay, "rect", { x: FRAME.left + FRAME.band, y: FLOOR_Y - 26, width: FRAME.right - FRAME.left - 2 * FRAME.band, height: 26, fill: "#33261e" });
  const band = el(bay, "path", { "fill-rule": "evenodd", fill: "#9aa0a8", stroke: INK, "stroke-width": "6", "stroke-linejoin": "round" });
  const bandLight = el(bay, "path", { fill: "none", stroke: "#c9ced4", "stroke-width": "3", "stroke-linecap": "round" });
  const bolts = [
    [FRAME.left + 14, FRAME.top + 14],
    [FRAME.right - 14, FRAME.top + 14],
    [FRAME.left + 14, FRAME.bottom - 14],
    [FRAME.right - 14, FRAME.bottom - 14],
  ].map(([x, y]) => el(bay, "circle", { cx: x, cy: y, r: 5, fill: "#5c6066", stroke: INK, "stroke-width": "3" }));
  void bolts;
  // The light's glow on the back panel.
  const wash = el(svg, "circle", { fill: `url(#hp-glow-${id})`, opacity: "0.35" });

  // The stand: base plate (with the tether's socket), legs, feet and the rod it rests on.
  const stand = el(svg, "g", { class: "stand" });
  const shadow = el(stand, "ellipse", { fill: "#000", opacity: "0.35" });
  const base = el(stand, "path", { fill: "#7d838c", stroke: INK, "stroke-width": "5", "stroke-linejoin": "round" });
  const socket = el(stand, "rect", { x: TETHER_SOCKET.x - 9, y: TETHER_SOCKET.y - 5, width: 18, height: 10, rx: 2, fill: "#4b78c2", stroke: INK, "stroke-width": "4" });
  void socket;
  const legsInk = el(stand, "path", { fill: "none", stroke: INK, "stroke-width": "13", "stroke-linecap": "round" });
  const legs = el(stand, "path", { fill: "none", stroke: "#b8bec6", "stroke-width": "6", "stroke-linecap": "round" });
  const feet = [0, 1].map(() => el(stand, "rect", { width: 22, height: 12, rx: 4, fill: "#2a2a2d", stroke: INK, "stroke-width": "4" }));

  // The potato.
  const body = el(svg, "g", { class: "body" });
  // Flat cartoon shading: the body in its shade colour, the lit skin a slightly smaller copy
  // nudged up and left (a crescent of shade low right), and one soft highlight.
  const skin = el(body, "path", { fill: SKIN_SHADE });
  const inside = el(body, "g", { "clip-path": `url(#hp-body-${id})` });
  const lit = el(inside, "path", { fill: SKIN });
  const light = el(inside, "ellipse", { fill: SKIN_LIGHT, opacity: "0.8" });
  const traceInk = el(inside, "path", { fill: "none", stroke: "#9a6328", "stroke-width": "7", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: "0.6" });
  const trace = el(inside, "path", { fill: "none", stroke: CIRCUIT, "stroke-width": "3", "stroke-linecap": "round", "stroke-linejoin": "round" });
  const nodes = spec.traces.map(() => el(inside, "circle", { r: 4.5, fill: CIRCUIT, stroke: "#7a4a1f", "stroke-width": "2.5" }));
  const pores = spec.pores.map(() => ({
    lip: el(inside, "ellipse", { fill: SKIN_LIGHT, opacity: "0.7" }),
    hole: el(inside, "ellipse", { fill: "#6e4219" }),
    glow: el(inside, "ellipse", { fill: CIRCUIT }),
  }));
  const marks = spec.marks.map(() => ({ ink: el(inside, "path", { fill: "none", stroke: "#7a4a1f", "stroke-linecap": "round", "stroke-linejoin": "round" }), glow: el(inside, "path", { fill: "none", stroke: CIRCUIT, "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" }) }));
  const creases = [0, 1, 2].map(() => el(inside, "path", { fill: "none", stroke: "#8a5a26", "stroke-linecap": "round" }));
  const outline = el(body, "path", { fill: "none", stroke: INK, "stroke-width": "7", "stroke-linejoin": "round" });
  const cables = spec.plugs.map((p) => ({
    ink: el(body, "path", { fill: "none", stroke: INK, "stroke-width": "10", "stroke-linecap": "round" }),
    wire: el(body, "path", { fill: "none", stroke: p.cable, "stroke-width": "5", "stroke-linecap": "round" }),
    plug: el(body, "path", { fill: p.colour, stroke: INK, "stroke-width": "4", "stroke-linejoin": "round" }),
  }));
  const plateG = el(body, "g");
  el(plateG, "path", { d: chamfered(-35, -26, 70, 52, 10), fill: "#aeb2b6", stroke: INK, "stroke-width": "5", "stroke-linejoin": "round" });
  el(plateG, "path", { d: "M-27 -18H18", stroke: "#e2e4e6", "stroke-width": "3", "stroke-linecap": "round", fill: "none" });
  for (const [x, y] of [[-27, -18], [27, -18], [-27, 18], [27, 18]]) el(plateG, "circle", { cx: x, cy: y, r: 2.6, fill: "#5c6066" });
  // Two clips that hold it to the skin.
  el(plateG, "path", { d: chamfered(-10, -33, 20, 12, 3), fill: "#8c929b", stroke: INK, "stroke-width": "4" });
  el(plateG, "path", { d: chamfered(-10, 21, 20, 12, 3), fill: "#8c929b", stroke: INK, "stroke-width": "4" });
  // The status lamp: a wide pill in a dark bezel at the plate's top right, with vent slots below,
  // a readout on a panel rather than anything like an eye.
  const lampGlow = el(plateG, "ellipse", { cx: 13, cy: -9, rx: 26, ry: 16, fill: `url(#hp-glow-${id})` });
  el(plateG, "path", { d: chamfered(-6, -17, 38, 17, 4), fill: "#2b2826", stroke: INK, "stroke-width": "3.5", "stroke-linejoin": "round" });
  const lamp = el(plateG, "rect", { x: -2, y: -13.5, width: 30, height: 10, rx: 5 });
  el(plateG, "rect", { x: 2, y: -12, width: 12, height: 3, rx: 1.5, fill: "#fff", opacity: "0.6" });
  el(plateG, "path", { d: "M-24 4H-6M-24 10H-6M-24 16H-6M6 8H26M6 14H26", stroke: "#5c6066", "stroke-width": "3", "stroke-linecap": "round", fill: "none" });
  const tetherInk = el(svg, "path", { fill: "none", stroke: INK, "stroke-width": "10", "stroke-linecap": "round" });
  const tether = el(svg, "path", { fill: "none", stroke: "#4b78c2", "stroke-width": "5", "stroke-linecap": "round" });

  // Steam puffs (getting worse) and the burst.
  // Steam: three clouds, each three overlapping billows drawn as one shape (an ink layer under a
  // white layer), rising one after another from different places.
  const steam = el(svg, "g", { class: "steam" });
  const steamInk = el(steam, "g", { fill: INK });
  const steamFill = el(steam, "g", { fill: "#f4efe6" });
  const puffs = Array.from({ length: 9 }, () => ({ ink: el(steamInk, "circle"), fill: el(steamFill, "circle") }));
  const BILLOWS = [
    [-0.7, 0.15, 0.75],
    [0.55, 0.05, 0.85],
    [0, -0.45, 1],
  ];
  const boom = el(svg, "g", { class: "boom" });
  const flash = el(boom, "circle", { cx: 200, cy: 200, fill: "#fff6d6" });
  const splat = el(boom, "g");
  const splatOuter = el(splat, "polygon", { fill: INK });
  const splatMid = el(splat, "polygon", { fill: CIRCUIT });
  const splatCore = el(splat, "polygon", { fill: "#ffd23f", stroke: INK, "stroke-width": "5", "stroke-linejoin": "round" });
  const pile = el(boom, "path", { fill: "#f3dc9a", stroke: INK, "stroke-width": "6", "stroke-linejoin": "round" });
  const pileFlecks = el(boom, "path", { fill: "none", stroke: SKIN_SHADE, "stroke-width": "4", "stroke-linecap": "round" });
  const fallenPlate = el(boom, "g");
  el(fallenPlate, "path", { d: chamfered(-35, -26, 70, 52, 10), fill: "#aeb2b6", stroke: INK, "stroke-width": "5", "stroke-linejoin": "round" });
  el(fallenPlate, "path", { d: chamfered(-6, -17, 38, 17, 4), fill: "#2b2826", stroke: INK, "stroke-width": "3.5", "stroke-linejoin": "round" });
  el(fallenPlate, "path", { d: "M-24 4H-6M-24 10H-6M-24 16H-6M6 8H26M6 14H26", stroke: "#5c6066", "stroke-width": "3", "stroke-linecap": "round", fill: "none" });
  const chunkEls = Array.from({ length: 11 }, () => el(boom, "polygon", { fill: SKIN, stroke: INK, "stroke-width": "4", "stroke-linejoin": "round" }));

  const star = (r1, r2, n, seedOff) => {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const rad = (i % 2 ? r2 : r1) * (0.9 + 0.18 * Math.sin(i * 2.3 + seedOff));
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    return pts;
  };
  const SPLAT = [star(150, 92, 12, 1), star(136, 82, 12, 1), star(100, 60, 10, 4)];
  const scaled = (pts, k, cx, cy) => pts.map(([x, y]) => `${f(cx + x * k)},${f(cy + y * k)}`).join(" ");

  // ---- Motion state ----
  const target = { growth: 0, strain: 0, light: "#5dff6a", phase: "ready", paused: false };
  const shown = { growth: 0, strain: 0, vg: 0, vs: 0 };
  let clock = 0; // seconds of art time (stops while paused)
  let last = 0;
  let settleAt = -10;
  let steamAt = -10;
  let burstAt = null;
  let raf = 0;
  let alive = true;

  function stillMotion() {
    return reducedMotion();
  }

  function draw() {
    const reduce = stillMotion();
    const t = clock;
    if (burstAt !== null) {
      drawBurst(reduce ? 5 : t - burstAt);
      return;
    }
    set(body, { visibility: "visible" });
    set(boom, { visibility: "hidden" });
    // Breathing, plus the squash of settling after a right answer.
    let pulse = reduce ? 0 : pulseAt(t, shown.strain);
    const since = t - settleAt;
    if (!reduce && since >= 0 && since < 0.9) pulse += -0.04 * Math.sin(Math.PI * clamp01(since / 0.45)) * (since < 0.45 ? 1 : 0) + 0.015 * Math.sin(Math.PI * clamp01((since - 0.45) / 0.45)) * (since >= 0.45 ? 1 : 0);
    const shape = potatoShape({ spec, growth: shown.growth, strain: shown.strain, pulse });
    const d = smoothPath(shape.outline);
    set(clipPath, { d });
    set(skin, { d });
    set(outline, { d });
    // The lit skin, nudged up and left of the shade; the highlight high left. Both follow its size.
    const lcx = shape.cx;
    const lcy = shape.cy;
    set(lit, { d, fill: shape.skin, transform: `translate(${f(lcx - shape.rx * 0.07)} ${f(lcy - shape.ry * 0.09)}) scale(0.95) translate(${f(-lcx)} ${f(-lcy)})` });
    set(light, { cx: f(shape.cx - shape.rx * 0.42), cy: f(shape.cy - shape.ry * 0.46), rx: f(shape.rx * 0.34), ry: f(shape.ry * 0.2), transform: `rotate(-18 ${f(shape.cx - shape.rx * 0.42)} ${f(shape.cy - shape.ry * 0.46)})` });
    // The bay's back panel and panel lines (fixed), the band bowed where pushed.
    const fr = framePath(shape.frame);
    set(back, { d: fr.inner });
    set(band, { d: fr.band });
    const il = FRAME.left + FRAME.band + 4;
    const it = FRAME.top + FRAME.band + 4;
    set(bandLight, { d: `M${FRAME.left + FRAME.chamfer} ${FRAME.top + 5}H${FRAME.right - FRAME.chamfer}` });
    set(lines, { d: `M${il} 120H${FRAME.right - FRAME.band - 4}M${il} 230H${FRAME.right - FRAME.band - 4}M140 ${it}V${FLOOR_Y - 26}M260 ${it}V${FLOOR_Y - 26}` });
    // The stand.
    const st = shape.stand;
    const rod = `M${st.rod.from[0]} ${st.rod.from[1]}Q${f(st.rod.control[0])} ${f(st.rod.control[1])} ${st.rod.to[0]} ${st.rod.to[1]}`;
    const legPath = st.legs.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join("") + rod;
    set(legsInk, { d: legPath });
    set(legs, { d: legPath });
    st.feet.forEach(([x, y], i) => set(feet[i], { x: x - 11, y: y - 4 }));
    set(base, { d: chamfered(st.base.x, st.base.y, st.base.w, st.base.h + 4, 4) });
    set(shadow, { cx: STAND.cx, cy: FLOOR_Y - 12, rx: f(Math.min(170, shape.rx * 1.05)), ry: 9 });
    // Circuit traces, glowing more as it strains.
    const tracePath = shape.traces.map((run) => run.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("")).join("");
    const glowing = 0.35 + 0.55 * shape.strain + (reduce ? 0 : 0.1 * Math.sin(t * (2 + 6 * shape.strain)));
    set(traceInk, { d: tracePath });
    set(trace, { d: tracePath, opacity: f(clamp01(glowing) * 100) / 100 });
    shape.traces.forEach((run, i) => set(nodes[i], { cx: f(run.at(-1)[0]), cy: f(run.at(-1)[1]), opacity: f(clamp01(glowing) * 100) / 100 }));
    // Pores: the same ones, stretched.
    shape.pores.forEach((p, i) => {
      const rot = `rotate(${f((p.tilt * 180) / Math.PI)} ${f(p.x)} ${f(p.y)})`;
      set(pores[i].lip, { cx: f(p.x), cy: f(p.y + p.h * 0.35), rx: f(p.w / 2), ry: f(p.h / 2), transform: rot });
      set(pores[i].hole, { cx: f(p.x), cy: f(p.y), rx: f(p.w / 2), ry: f(p.h / 2), transform: rot });
      set(pores[i].glow, { cx: f(p.x), cy: f(p.y + 0.4), rx: f(p.w / 3.4), ry: f(p.h / 3.4), transform: rot, opacity: f(p.glow * (0.75 + (reduce ? 0 : 0.25 * Math.sin(t * 5 + i)))) });
    });
    // Stretch marks: always there, faint and closed when calm, deeper and glowing as it is pulled tight.
    shape.marks.forEach((m, i) => {
      const ca = Math.cos(m.angle);
      const sa = Math.sin(m.angle);
      const h = m.len / 2;
      const k = m.kink * h * m.side * (0.2 + 0.3 * m.open);
      const pts = [
        [-h, 0],
        [-h * 0.3, k],
        [h * 0.25, -k * 0.8],
        [h, 0],
      ].map(([x, y]) => `${f(m.x + x * ca - y * sa)} ${f(m.y + x * sa + y * ca)}`);
      const dd = `M${pts.join("L")}`;
      set(marks[i].ink, { d: dd, "stroke-width": f(2 + 2.6 * m.open), opacity: f(0.35 + 0.65 * m.open) });
      set(marks[i].glow, { d: dd, opacity: f(0.12 + 0.88 * m.open) });
    });
    // Creases where the cables are set into the skin: a slight pucker, fanning out as they pull.
    shape.creases.forEach((c, i) => {
      let dd = "";
      for (const spread of [-0.5, 0, 0.5]) {
        const a = c.toward + Math.PI + spread;
        dd += `M${f(c.x + Math.cos(a) * 12)} ${f(c.y + Math.sin(a) * 12)}L${f(c.x + Math.cos(a) * (12 + c.len))} ${f(c.y + Math.sin(a) * (12 + c.len))}`;
      }
      set(creases[i], { d: dd, "stroke-width": f(1.8 + 1.2 * c.pull), opacity: f(0.45 + 0.55 * c.pull) });
    });
    // Cables and plugs.
    shape.cables.forEach((c, i) => {
      const dd = `M${f(c.from[0])} ${f(c.from[1])}Q${f(c.control[0])} ${f(c.control[1])} ${f(c.to[0])} ${f(c.to[1])}`;
      set(cables[i].ink, { d: dd });
      set(cables[i].wire, { d: dd });
      const [x, y] = c.plug;
      set(cables[i].plug, { d: chamfered(f(x - 11), f(y - 9), 22, 18, 5) });
    });
    const tt = shape.tether;
    const td = `M${f(tt.from[0])} ${f(tt.from[1])}Q${f(tt.control[0])} ${f(tt.control[1])} ${f(tt.to[0])} ${f(tt.to[1])}`;
    set(tetherInk, { d: td });
    set(tether, { d: td });
    // The plate and its light.
    set(plateG, { transform: `translate(${f(shape.plate.x)} ${f(shape.plate.y)}) rotate(${f(shape.plate.angle)})` });
    const blinkHz = 0.6 + 2.6 * shape.strain;
    const flare = since >= 0 && since < 0.9 ? 1 - since / 0.9 : 0;
    const blink = reduce ? 0.8 : 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * blinkHz));
    set(lamp, { fill: target.light });
    set(glowStop0, { "stop-color": target.light });
    set(glowStop1, { "stop-color": target.light });
    set(lampGlow, { opacity: f(clamp01(blink + flare * 0.6)), rx: f(26 + 14 * flare), ry: f(16 + 8 * flare) });
    set(wash, { cx: f(shape.plate.x), cy: f(shape.plate.y), r: f(95 + 40 * flare), opacity: f(0.08 + 0.08 * blink + 0.15 * flare) });
    // Steam, when it gets worse.
    const st2 = t - steamAt;
    if (!reduce && st2 >= 0 && st2 < 1.5) {
      const top = shape.box.top;
      // From the left plug, the top right and the plate's edge, each a moment after the last.
      const sources = [
        [shape.cables[0].plug[0] - 6, shape.cables[0].plug[1] - 16, 0, -1],
        [shape.cx + shape.rx * 0.32, top + shape.ry * 0.18, 0.14, 1],
        [shape.plate.x + shape.plate.w / 2, shape.plate.y - shape.plate.h / 2, 0.28, 1],
      ];
      puffs.forEach((p, i) => {
        const [sx, sy, delay, lean] = sources[(i / 3) | 0];
        const [bx, by, bs] = BILLOWS[i % 3];
        const k = clamp01((st2 - delay) / 1.1);
        const r = (11 + 15 * Math.sqrt(k)) * bs;
        const cx = sx + lean * 26 * k + bx * r;
        const cy = sy - 12 - 74 * k + by * r;
        const show = k > 0 && k < 1;
        set(p.ink, { cx: f(cx), cy: f(cy), r: f(show ? r + 3.5 : 0) });
        set(p.fill, { cx: f(cx), cy: f(cy), r: f(show ? r : 0) });
      });
      set(steam, { visibility: "visible", opacity: f(clamp01(1.25 - st2 / 1.2)) });
    } else set(steam, { visibility: "hidden" });
  }

  function drawBurst(t) {
    const b = burstShape(spec, t);
    set(body, { visibility: "hidden" });
    set(steam, { visibility: "hidden" });
    set(tether, { d: "" });
    set(tetherInk, { d: "" });
    set(boom, { visibility: "visible" });
    const fr = framePath(b.frame);
    set(back, { d: fr.inner });
    set(band, { d: fr.band });
    const st = b.stand;
    const rod = `M${st.rod.from[0]} ${st.rod.from[1]}Q${f(st.rod.control[0])} ${f(st.rod.control[1])} ${st.rod.to[0]} ${st.rod.to[1]}`;
    const legPath = st.legs.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join("") + rod;
    set(legsInk, { d: legPath });
    set(legs, { d: legPath });
    set(flash, { r: f(b.flash.r), opacity: f(b.flash.opacity) });
    set(splat, { visibility: b.splat.scale > 0.01 ? "visible" : "hidden" });
    set(splatOuter, { points: scaled(SPLAT[0], b.splat.scale, 200, 205) });
    set(splatMid, { points: scaled(SPLAT[1], b.splat.scale, 200, 205) });
    set(splatCore, { points: scaled(SPLAT[2], b.splat.scale, 200, 205) });
    set(pile, { d: smoothPath(b.pile), opacity: f(b.pileShown) });
    const fl = [];
    for (let i = 0; i < 7; i++) {
      const x = 130 + i * 22 + (i % 2) * 6;
      const y = STAND.rodY - 20 - ((i * 13) % 30);
      fl.push(`M${x} ${y}l${6 + (i % 3) * 2} ${i % 2 ? 3 : -3}`);
    }
    set(pileFlecks, { d: fl.join(""), opacity: f(b.pileShown) });
    set(fallenPlate, { transform: `translate(${f(b.plate.x)} ${f(b.plate.y)}) rotate(${f(b.plate.angle)})` });
    b.chunks.forEach((c, i) => set(chunkEls[i], { points: c.shape.map(([x, y]) => `${f(x)},${f(y)}`).join(" "), transform: `translate(${f(c.x)} ${f(c.y)}) rotate(${f(c.angle)})` }));
    set(wash, { opacity: "0" });
  }

  /**
   * Whether anything on screen is moving: the eased values, the breathing (not when idle on the
   * start screen, nor with reduced motion), a moment playing, or the burst still flying. Paused,
   * nothing moves.
   */
  function moving() {
    if (target.paused) return false;
    const easing = ["growth", "strain"].some((k) => Math.abs(target[k] - shown[k]) > 1e-4) || Math.abs(shown.vg) > 1e-4 || Math.abs(shown.vs) > 1e-4;
    if (easing) return true;
    if (burstAt !== null) return !stillMotion() && clock - burstAt < 2;
    if (stillMotion()) return false;
    return target.phase !== "idle" || clock - settleAt < 0.9 || clock - steamAt < 1.5;
  }

  function step(now) {
    raf = 0;
    if (!alive) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!target.paused) {
      clock += dt;
      if (stillMotion()) {
        shown.growth = target.growth;
        shown.strain = target.strain;
      } else {
        // A spring with a little overshoot: it swells past and settles, cartoon style.
        for (const [k, v] of [["growth", "vg"], ["strain", "vs"]]) {
          const stiff = k === "growth" ? 90 : 40;
          const damp = 2 * Math.sqrt(stiff) * (k === "growth" ? 0.55 : 0.9);
          shown[v] += (stiff * (target[k] - shown[k]) - damp * shown[v]) * dt;
          shown[k] += shown[v] * dt;
        }
      }
    }
    if (dirty || moving()) {
      dirty = false;
      draw();
      draws++;
    }
    // Nothing moving and nothing new: the loop stops until set() or play() changes something.
    if (moving()) raf = requestAnimationFrame(step);
    else last = 0;
  }
  let dirty = true;
  let draws = 0;
  const wake = () => {
    if (!raf && alive) raf = requestAnimationFrame(step);
  };
  wake();

  return {
    /** The game's state for the art (artState in game.js). Redraws only when something changed. */
    set(state) {
      const changed = Object.keys(state).some((k) => target[k] !== state[k]);
      if (!changed) return;
      Object.assign(target, state);
      if (state.phase !== "burst" && burstAt !== null) burstAt = null;
      host.dataset.stage = String(state.stage ?? "");
      dirty = true;
      wake();
    },
    /** A moment: "right", "worse", "burst" or "reset". */
    play(event) {
      if (event === "right") settleAt = clock;
      else if (event === "worse") steamAt = clock;
      else if (event === "burst") burstAt = clock;
      else if (event === "reset") {
        burstAt = null;
        settleAt = steamAt = -10;
        Object.assign(shown, { growth: 0, strain: 0, vg: 0, vs: 0 });
        Object.assign(target, { growth: 0, strain: 0 });
      }
      dirty = true;
      wake();
    },
    /** What is drawn now, for tests and stills: the eased values, whether it has burst, and how many times it has been drawn. */
    look() {
      return { growth: shown.growth, strain: shown.strain, burst: burstAt !== null, burstFor: burstAt === null ? 0 : clock - burstAt, draws, running: Boolean(raf) };
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      svg.remove();
    },
  };
}
