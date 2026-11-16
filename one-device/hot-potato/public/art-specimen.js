// The Specimen renderer: the potato with a face in its lab rig, as the Game Art Picker drew it,
// behind the art interface in art.js. It builds every part once (PARTS) and each frame sets what
// scene() in specimen-draw.js says; nothing is ever added or removed.
//
// It eases toward what it is told (a spring, so it swells past and settles, cartoon style), moves
// as the picker did (breathing, a twitch, a throb), and between turns blinks, glances at whoever is
// up and sighs; listening, it looks up and follows the fuse. Its face is one of several for the
// stage, chosen by the round's seed, changing between turns; a verdict shows a reaction for a
// moment (right, an appeal, wrong, silence, a repeat, an overturned word), and the last miss
// panics until it bursts. With reduced motion nothing moves (faces still change) and the burst
// shows its end at once. It is redrawn only while something moves, never while paused.

import {
  BODY,
  ALARM,
  BULB,
  CLAMP,
  FACES,
  GLASS,
  GLOW,
  HEATS,
  HILITE,
  INK,
  LUMP,
  REACTIONS,
  REACT_S,
  BURST_S,
  ROD,
  SHADE,
  SKIN,
  SWEAT,
  TRAY,
  TRAY_TOP,
  VIEW,
  burstPoints,
  composeFace,
  faceById,
  idleAt,
  pick,
  pose,
  reactionKind,
  scene,
} from "./specimen-draw.js";

const NS = "http://www.w3.org/2000/svg";
const ink = (w) => ({ stroke: INK, "stroke-width": String(w), "stroke-linejoin": "round" });
const line = (w, colour = INK) => ({ fill: "none", stroke: colour, "stroke-width": String(w), "stroke-linecap": "round", "stroke-linejoin": "round" });

/**
 * Every part: [name, tag, parent, fixed attributes]. Parents come before their children; the
 * order is the drawing order (back rig, potato, front rig, burst).
 */
export const PARTS = [
  ["back", "g", null, { class: "rig rig-back" }],
  ["rodL", "polygon", "back", { points: "20,104 32,44 46,48 40,106", fill: ROD, ...ink(5) }],
  ["rodR", "polygon", "back", { points: "220,104 208,44 194,48 200,106", fill: ROD, ...ink(5) }],
  ["bulbL", "circle", "back", { cx: 38, cy: 38, r: 11, fill: BULB, ...ink(5) }],
  ["bulbR", "circle", "back", { cx: 202, cy: 38, r: 11, fill: BULB, ...ink(5) }],
  ["alarmL", "circle", "back", { cx: 38, cy: 38, r: 11, fill: ALARM, ...ink(5) }],
  ["alarmR", "circle", "back", { cx: 202, cy: 38, r: 11, fill: ALARM, ...ink(5) }],
  ["glassL", "rect", "back", { x: 2, y: 150, width: 15, height: 52, rx: 3, fill: GLASS, ...ink(5) }],
  ["liquidL", "rect", "back", { x: 2, width: 15, fill: GLOW, ...ink(5) }],
  ["glassR", "rect", "back", { x: 223, y: 150, width: 15, height: 52, rx: 3, fill: GLASS, ...ink(5) }],
  ["liquidR", "rect", "back", { x: 223, width: 15, fill: GLOW, ...ink(5) }],
  ["foamL", "polygon", "back", { points: "0,151 3,143 8,146 12,141 17,145 19,151", fill: GLOW, ...ink(3.5) }],
  ["foamR", "polygon", "back", { points: "221,151 223,144 228,147 232,141 237,145 240,151", fill: GLOW, ...ink(3.5) }],
  ["dripL", "polygon", "back", { fill: GLOW, ...ink(3) }],
  ["dripR", "polygon", "back", { fill: GLOW, ...ink(3) }],
  ["bubbles", "g", "back", { fill: GLASS }],
  ["bub0", "circle", "bubbles", {}],
  ["bub1", "circle", "bubbles", {}],
  ["bub2", "circle", "bubbles", {}],
  ["boltInk", "path", "back", { d: "M52 42 L72 56 L62 62 L84 78 M188 42 L168 56 L178 62 L156 78", ...line(10) }],
  ["bolt", "path", "back", { d: "M52 42 L72 56 L62 62 L84 78 M188 42 L168 56 L178 62 L156 78", ...line(5, BULB) }],

  ["spud", "g", null, { class: "spud" }],
  ["vines", "g", "spud", { fill: GLOW, ...ink(5) }],
  ["vine0", "polygon", "vines", { points: "96,58 80,22 90,6 100,24 110,56" }],
  ["vine1", "polygon", "vines", { points: "150,58 166,26 160,8 176,22 164,60" }],
  ["vine2", "polygon", "vines", { points: "48,128 14,112 4,120 18,130 46,144" }],
  ["body", "path", "spud", { d: BODY, fill: SKIN }],
  ["inside", "g", "spud", {}],
  ["shade", "polygon", "inside", { points: "170,56 210,100 204,154 160,194 100,198 150,154 174,106", fill: SHADE }],
  ["hilite", "polygon", "inside", { points: "62,90 100,64 88,92", fill: HILITE }],
  ["glowskin", "path", "inside", { d: BODY, fill: GLOW }],
  ["lumps", "g", "inside", { fill: LUMP, ...ink(4) }],
  ["lump0", "circle", "lumps", { cx: 66, cy: 152, r: 10 }],
  ["lump1", "circle", "lumps", { cx: 176, cy: 140, r: 12 }],
  ["lump2", "circle", "lumps", { cx: 126, cy: 182, r: 9 }],
  ["veins", "path", "inside", { d: "M60 80 L76 96 L66 110 L84 122 M190 96 L176 112 L186 126 M110 192 L118 174 L104 164", ...line(5, GLOW) }],
  ["outline", "path", "spud", { d: BODY, fill: "none", ...ink(7) }],
  ["face", "g", "spud", { class: "face" }],
  ...[0, 1, 2].flatMap((i) => [
    [`eyeW${i}`, "polygon", "face", { fill: "#fff", ...ink(5) }],
    [`eyeP${i}`, "circle", "face", { fill: INK }],
    [`eyeL${i}`, "polygon", "face", ink(4)],
    [`eyeS${i}`, "path", "face", line(5)],
  ]),
  ["brow0", "polygon", "face", { fill: INK }],
  ["brow1", "polygon", "face", { fill: INK }],
  ["mouthFill", "path", "face", ink(5)],
  ["mouthDetail", "path", "face", { fill: "#fff" }],
  ["mouthLines", "path", "face", line(3.5)],
  ["mouthLine", "path", "face", line(5.5)],
  ["sweat0", "polygon", "face", { fill: SWEAT, ...ink(3) }],
  ["sweat1", "polygon", "face", { fill: SWEAT, ...ink(3) }],

  ["front", "g", null, { class: "rig rig-front" }],
  ["tray", "polygon", "front", { points: "36,198 204,198 224,230 16,230", fill: TRAY, ...ink(5) }],
  ["trayTop", "polygon", "front", { points: "36,198 204,198 210,208 30,208", fill: TRAY_TOP, ...ink(5) }],
  ["light0", "polygon", "front", { points: "52,214 68,214 62,226 46,226", ...ink(3) }],
  ["light1", "polygon", "front", { points: "96,214 112,214 106,226 90,226", ...ink(3) }],
  ["light2", "polygon", "front", { points: "140,214 156,214 150,226 134,226", ...ink(3) }],
  ["light3", "polygon", "front", { points: "184,214 200,214 194,226 178,226", ...ink(3) }],
  ["clampL", "g", "front", {}],
  ["clampLArm", "polygon", "clampL", { points: "26,206 34,134 70,120 76,136 50,146 46,206", fill: CLAMP, ...ink(5) }],
  ["clampLBolt", "circle", "clampL", { cx: 38, cy: 194, r: 5, fill: INK }],
  ["mirror", "g", "front", { transform: "translate(240 0) scale(-1 1)" }],
  ["clampR", "g", "mirror", {}],
  ["clampRArm", "polygon", "clampR", { points: "26,206 34,134 70,120 76,136 50,146 46,206", fill: CLAMP, ...ink(5) }],
  ["clampRBolt", "circle", "clampR", { cx: 38, cy: 194, r: 5, fill: INK }],
  ["dishcrack", "path", "front", { d: "M110 200 L118 212 L108 218 L116 230 M150 200 L144 214", ...line(4) }],

  ["boom", "g", null, { class: "boom" }],
  ["splat", "g", "boom", {}],
  ["splatInk", "polygon", "splat", { points: burstPoints(120, 120, 118, 70, 11, 21), fill: INK }],
  ["splatGreen", "polygon", "splat", { points: burstPoints(120, 120, 106, 62, 11, 21), fill: GLOW }],
  ["splatCore", "polygon", "splat", { points: burstPoints(120, 120, 78, 48, 9, 4), fill: BULB, ...ink(5) }],
  ["breach", "text", "boom", { x: 0, y: 12, transform: "translate(120 120) rotate(-6) skewX(-8)", "text-anchor": "middle", fill: INK, "font-size": 34, "font-family": "Anton, Impact, 'Arial Narrow', sans-serif", "letter-spacing": "0.5" }],
  ...Array.from({ length: 10 }, (_, i) => [`chunk${i}`, "polygon", "boom", { points: "-8,5.3 0,-8.8 10,1.8 2,8.8", fill: SKIN }]),
];

let made = 0;

/** Makes the Specimen inside `host` (the SVG fills it) and returns the art interface. */
export function createSpecimen(host, { seed = 7, reducedMotion = () => false } = {}) {
  const id = `sp-${seed}-${++made}`;
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: VIEW, class: "potato-art specimen", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  const defs = document.createElementNS(NS, "defs");
  const clip = document.createElementNS(NS, "clipPath");
  clip.setAttribute("id", `${id}-body`);
  const clipBody = document.createElementNS(NS, "path");
  clipBody.setAttribute("d", BODY);
  clip.appendChild(clipBody);
  defs.appendChild(clip);
  svg.appendChild(defs);
  const els = {};
  for (const [name, tag, parent, attrs] of PARTS) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    node.setAttribute("data-part", name);
    (parent ? els[parent] : svg).appendChild(node);
    els[name] = node;
  }
  els.inside.setAttribute("clip-path", `url(#${id}-body)`);
  els.breach.textContent = "BREACH!";
  host.appendChild(svg);
  const last = {};
  const apply = (attrs) => {
    for (const [name, a] of Object.entries(attrs)) {
      const node = els[name];
      const was = last[name] ?? (last[name] = {});
      for (const [k, v] of Object.entries(a)) {
        const s = String(v);
        if (was[k] !== s) {
          node.setAttribute(k, s);
          was[k] = s;
        }
      }
    }
  };

  // ---- State ----
  const target = { stage: 0, growth: 0, strain: 0, fuse: 1, phase: "idle", paused: false };
  const shown = { growth: 0, strain: 0, vg: 0, vs: 0 };
  let clock = 0;
  let lastNow = 0;
  let round = 0;
  let beat = 0;
  let faceStage = -1;
  let variant = 0;
  let react = null; // { kind, face, at, event }
  let burstAt = null;
  let raf = 0;
  let alive = true;
  let dirty = true;
  let draws = 0;
  let current = FACES.calm[0];
  let frozen = null; // for stills: { face, stage }

  const reduce = () => reducedMotion();
  const heatOf = (stage) => HEATS[Math.max(0, Math.min(4, stage))];

  /** The stage's face: the picker's own the first time a stage is shown, then one of the set. */
  function baseFace() {
    const stage = Math.max(0, Math.min(4, target.stage));
    const set = FACES[heatOf(stage)];
    if (stage !== faceStage) {
      faceStage = stage;
      variant = 0;
    }
    return set[variant % set.length];
  }
  function nextBeat() {
    beat++;
    const stage = Math.max(0, Math.min(4, target.stage));
    if (stage === faceStage) variant = pick(seed, round, beat) % FACES[heatOf(stage)].length;
  }

  function moving() {
    if (target.paused) return false;
    const easing = Math.abs(target.growth - shown.growth) > 1e-4 || Math.abs(target.strain - shown.strain) > 1e-4 || Math.abs(shown.vg) > 1e-4 || Math.abs(shown.vs) > 1e-4;
    if (easing) return true;
    if (react && clock - react.at < REACT_S) return true;
    if (burstAt !== null) return !reduce() && clock - burstAt < BURST_S;
    if (reduce() || frozen) return false;
    return target.phase === "ready" || target.phase === "listen" || target.phase === "doom";
  }

  function draw() {
    const r = reduce();
    const still = target.phase === "idle" || target.phase === "burst";
    const t = clock;
    const stage = Math.max(0, Math.min(4, target.stage));
    if (react && react.kind !== "doom" && clock - react.at >= REACT_S) react = null;
    const base = frozen?.face ?? baseFace();
    const reacting = react && (react.kind !== "doom" || target.phase === "doom");
    const idle = target.phase === "ready" && !r ? idleAt(t, seed) : { blink: false, glance: false, sighFor: 9 };
    const face = frozen
      ? frozen.face
      : composeFace({ base, reaction: reacting ? react.face : null, stage, phase: target.phase, fuse: target.fuse ?? 1, blink: idle.blink, glance: idle.glance, sigh: stage <= 1 && idle.sighFor > 0.6 && idle.sighFor < 1.4 });
    current = face;
    const motion = pose({ t, stage, reduce: r, still: still || Boolean(frozen), react: react?.event ?? null, reactFor: react ? clock - react.at : 9, sighFor: stage <= 1 && target.phase === "ready" ? idle.sighFor : 9 });
    apply(scene({ growth: shown.growth, strain: shown.strain, stage, face, motion, t, burstFor: burstAt === null ? null : clock - burstAt, reduce: r, still: still || Boolean(frozen), seed }));
  }

  function step(now) {
    raf = 0;
    if (!alive) return;
    const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (!target.paused) {
      clock += dt;
      if (reduce()) {
        shown.growth = target.growth;
        shown.strain = target.strain;
        shown.vg = shown.vs = 0;
      } else {
        for (const [k, v] of [["growth", "vg"], ["strain", "vs"]]) {
          const stiff = k === "growth" ? 90 : 40;
          const damp = 2 * Math.sqrt(stiff) * (k === "growth" ? 0.55 : 0.9);
          shown[v] += (stiff * (target[k] - shown[k]) - damp * shown[v]) * dt;
          shown[k] += shown[v] * dt;
        }
      }
    }
    const go = moving();
    if (dirty || go) {
      dirty = false;
      draw();
      draws++;
    }
    if (moving()) raf = requestAnimationFrame(step);
    else {
      lastNow = 0;
      // A moment that has just ended needs one last drawing without it.
      if (react && react.kind !== "doom" && clock - react.at >= REACT_S) {
        react = null;
        dirty = true;
        draw();
        draws++;
        dirty = false;
      }
    }
  }
  const wake = () => {
    if (!raf && alive) raf = requestAnimationFrame(step);
  };
  wake();

  return {
    /** The game's state for the art (artState in game.js). Redraws only when something changed. */
    set(state) {
      const changed = Object.keys(state).some((k) => target[k] !== state[k]);
      if (!changed) return;
      const was = target.phase;
      Object.assign(target, state);
      if (state.phase !== "burst" && burstAt !== null) burstAt = null;
      if (react?.kind === "doom" && state.phase !== "doom") react = null;
      // A new turn, or the potato passed on: another face from the stage's set.
      if (state.phase !== was && (state.phase === "listen" || (state.phase === "ready" && was !== "idle"))) nextBeat();
      host.dataset.stage = String(state.stage ?? "");
      dirty = true;
      wake();
    },
    /** A moment: "right", "worse", "doom", "burst" or "reset"; `detail` says why ({ why, appeal }). */
    play(event, detail = {}) {
      if (event === "right" || event === "worse" || event === "doom") {
        const kind = reactionKind(event, detail);
        const set = REACTIONS[kind];
        react = { kind, event: event === "doom" ? "worse" : event, face: set[pick(seed, round, beat, 7) % set.length], at: clock };
        nextBeat();
      } else if (event === "burst") {
        burstAt = clock;
        react = null;
      } else if (event === "reset") {
        burstAt = null;
        react = null;
        round++;
        beat = 0;
        faceStage = -1;
        Object.assign(shown, { growth: 0, strain: 0, vg: 0, vs: 0 });
        Object.assign(target, { growth: 0, strain: 0, stage: 0, fuse: 1 });
      }
      dirty = true;
      wake();
    },
    /** What is drawn now, for tests and stills. */
    look() {
      return { growth: shown.growth, strain: shown.strain, burst: burstAt !== null, burstFor: burstAt === null ? 0 : clock - burstAt, draws, running: Boolean(raf), face: current.id, reaction: react?.kind ?? null };
    },
    /** For the contact sheet only: hold one face at one stage (null lets go). Not part of the seam. */
    hold(faceId, stage = 0) {
      const face = faceId ? faceById(faceId) : null;
      frozen = face ? { face } : null;
      if (face) {
        const g = Math.max(0, Math.min(4, stage)) / 4;
        Object.assign(target, { stage, growth: g, strain: g * 0.8, phase: "idle" });
        Object.assign(shown, { growth: g, strain: g * 0.8, vg: 0, vs: 0 });
      }
      dirty = true;
      wake();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      svg.remove();
    },
  };
}
