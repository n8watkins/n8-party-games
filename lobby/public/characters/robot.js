// The robot, as the page knows it without the 3D look: its flat drawing and its emotes.
// One of the characters (./index.js lists them; lobby/README.md, "Characters", is the interface).
//
// The landing scene's robot, which the owner approved (landing/tools/scene/scene.js, makeSkin):
// a dark base, a body and a head in the player's colour, a dark visor with two light eyes, a
// steel neck, a mast with a lamp on top, a round plate on its chest, and arms of dark metal at its
// sides ending in steel hands. Its head is where a pawn's is; the mast stands above.
//
// It rolls: its base stays on the floor and its wheels turn, while the rest bobs with the motor,
// leans into where it is going, and its head and mast lag a beat and wobble when it stops. The
// lamp on its mast lights when it stands in a game's light (its vote) with a quick double flash
// and a happy squint, and flashes red when it is knocked, where a pawn gets crosses its eyes do
// too. Its emotes are the ghost's, fitted to its body (./body-rig.js), its hands on jointed arms.
import { s, set, shade } from "../dom.js";
import { bodyRig } from "./body-rig.js";

const GREY = "#8a8d94";
const DARK = "#2b2f39";
const DARK_EDGE = "#14161c";
const STEEL = "#c1c8d3";
const VISOR = "#10131c";
const EYE = "#a8f4ff";
const LAMP = "#ffd27a";
const ALARM = "#ff4a3a";
/** Rig units per model unit, and the landing robot's own scale. */
const RU = (113 / 0.9) * 1.13;

/** The robot's measures in rig units (body-rig.js, BodyMeasures), from the landing scene's model. */
export const ROBOT = {
  floor: 0,
  mouth: -101,
  top: -0.97 * RU,
  half: 36,
  root: { x: 0.29 * RU, y: -0.44 * RU },
  hover: 0,
  hand: 1.15,
  lift: 0.6,
  puff: 0,
  sag: 0.2,
  /** Where its parts are (rig units, y up negative). */
  visorY: -0.81 * RU,
  mastTop: -1.19 * RU,
};

const { rig, emotes } = bodyRig(ROBOT, "rod");
export const ROBOT_RIG = rig;

/** How far the top of its lamp is above a standing pawn's head (room units). */
const ABOVE_PAWN = -(ROBOT.mastTop - 0.055 * RU) - 141;

const box = (cx, cy, w, h, r, attrs) => s("rect", { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: r, ...attrs });

function shapes(colour, connected = true) {
  const u = RU;
  const a = {};
  // The base: dark, with three wheels showing along its side.
  a.wheels = [-24, 0, 24].map((x) => s("g", { transform: `translate(${x},-10)` }, s("circle", { r: 8.5, fill: "#3b404c", stroke: DARK_EDGE, "stroke-width": 1.6 }), s("path", { d: "M-6,0 H6 M0,-6 V6", stroke: "#8b93a1", "stroke-width": 2, "stroke-linecap": "round" })));
  a.base = s("g", {}, box(0, -0.08 * u, 0.56 * u, 0.16 * u, 9, { fill: DARK, stroke: DARK_EDGE, "stroke-width": 1.8 }), ...a.wheels);
  // The body: what rides on the base, and bobs and leans.
  a.armsL = s("g", {});
  a.armsR = s("g", {});
  for (const [side, g] of [[-1, a.armsL], [1, a.armsR]]) {
    g.append(
      s("rect", { x: side * 0.31 * u - 4.5, y: -0.44 * u, width: 9, height: 0.28 * u, rx: 4.5, fill: DARK, stroke: DARK_EDGE, "stroke-width": 1.4 }),
      s("circle", { cx: side * 0.31 * u, cy: -0.16 * u, r: 0.06 * u, fill: STEEL, stroke: DARK_EDGE, "stroke-width": 1.4 }),
      s("circle", { cx: side * 0.29 * u, cy: -0.44 * u, r: 0.075 * u, fill: DARK, stroke: DARK_EDGE, "stroke-width": 1.4 }),
    );
  }
  a.torso = box(0, -0.36 * u, 0.5 * u, 0.42 * u, 11, { "stroke-width": 2 });
  a.torsoHi = box(0, -0.5 * u, 0.42 * u, 0.06 * u, 3, { fill: "#fff", opacity: 0.22 });
  a.plate = s("circle", { cx: 0, cy: -0.38 * u, r: 0.07 * u, fill: "#fbf3e2", opacity: 0.88, stroke: DARK_EDGE, "stroke-width": 1.2 });
  a.neck = box(0, -0.6 * u, 0.12 * u, 0.12 * u, 2, { fill: STEEL, stroke: DARK_EDGE, "stroke-width": 1.4 });
  // The head, its visor and eyes, and the mast with its lamp: the head turns and lags on its own.
  a.head = box(0, -0.8 * u, 0.48 * u, 0.34 * u, 12, { "stroke-width": 2 });
  a.headHi = box(0, -0.92 * u, 0.38 * u, 0.05 * u, 3, { fill: "#fff", opacity: 0.22 });
  a.visor = box(0, ROBOT.visorY + 1, 0.4 * u, 0.25 * u, 9, { fill: VISOR, stroke: DARK_EDGE, "stroke-width": 1.4 });
  a.visorGlint = s("path", { d: `M${-0.16 * u},${ROBOT.visorY - 11} h${0.1 * u}`, stroke: "#fff", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.35 });
  a.mast = s("rect", { x: -2.2, y: ROBOT.mastTop, width: 4.4, height: -ROBOT.mastTop - 0.97 * u + 2, fill: STEEL, stroke: DARK_EDGE, "stroke-width": 1 });
  a.glow = s("circle", { cx: 0, cy: ROBOT.mastTop, r: 17, fill: LAMP, opacity: 0 });
  a.lamp = s("circle", { cx: 0, cy: ROBOT.mastTop, r: 0.055 * u * 1.15, stroke: DARK_EDGE, "stroke-width": 1.4 });
  tint(a, colour, connected);
  return a;
}

function tint(a, colour, connected) {
  const c = connected ? shade(colour, 0.12) : GREY;
  for (const part of [a.torso, a.head]) set(part, { fill: c, stroke: shade(connected ? colour : GREY, -0.5) });
}

function face() {
  const eye = (cx) => box(cx, ROBOT.visorY, 9, 13, 4, { fill: EYE });
  const open = s("g", {}, eye(-12), eye(12));
  // Knocked: an X for each eye, in the visor's light.
  const x = (cx) => `M${cx - 5},${ROBOT.visorY - 5} l10,10 M${cx + 5},${ROBOT.visorY - 5} l-10,10`;
  const crosses = s("path", { d: `${x(-12)} ${x(12)}`, stroke: EYE, "stroke-width": 3.2, "stroke-linecap": "round", display: "none", class: "robot-crosses" });
  // Pleased (it has just stepped into a game's light): two arcs.
  const arc = (cx) => `M${cx - 6},${ROBOT.visorY + 3} Q${cx},${ROBOT.visorY - 7} ${cx + 6},${ROBOT.visorY + 3}`;
  const happy = s("path", { d: `${arc(-12)} ${arc(12)}`, stroke: EYE, "stroke-width": 3.2, "stroke-linecap": "round", fill: "none", display: "none" });
  return { g: s("g", {}, open, crosses, happy), open, crosses, happy };
}

function spring(value, velocity, target, stiffness, damping, dt) {
  velocity += ((target - value) * stiffness - velocity * damping) * dt;
  return [value + velocity * dt, velocity];
}

const blinkAt = (now, seed) => {
  const t = (now + seed * 977) % 4100;
  return t < 120 ? Math.sin((t / 120) * Math.PI) : 0;
};

/** How long its lamp flashes and it squints with pleasure when it steps into a light (ms). */
const PLEASED_MS = 700;

export const robot = {
  id: "robot",
  emotes,
  flat: {
    tall: ABOVE_PAWN,
    rest: 0,
    shadow: { rx: 44, ry: 9 },
    /** It rolls: no hop from foot to foot (its own bob is in frame). */
    glides: true,
    figure: {
      limbs: "rod",
      // The emote's face lights up in its visor.
      face: { dy: ROBOT.visorY + 113, turn: 6, scale: 1.05 },
      ink: EYE,
      skin: VISOR,
      tint(parent) {
        parent.append(box(0, -0.36 * RU, 0.5 * RU, 0.42 * RU, 11), box(0, -0.8 * RU, 0.48 * RU, 0.34 * RU, 12));
      },
    },
    make() {
      const p = shapes("#888888");
      const a = { ...p, face: face(), colour: "#888888", lean: 0, leanV: 0, nod: 0, nodV: 0, mastA: 0, mastV: 0, voting: false, pleasedAt: -Infinity, rolled: 0, lastX: null, lampK: 0, arms: 1 };
      a.headG = s("g", {}, a.neck, a.mast, a.glow, a.lamp, a.head, a.headHi, a.visor, a.visorGlint, a.face.g);
      a.mastG = s("g", {}, a.mast, a.glow, a.lamp);
      a.headG.prepend(a.mastG);
      a.upper = s("g", {}, a.armsL, a.armsR, a.torso, a.torsoHi, a.plate, a.headG);
      a.inner = s("g", {}, a.base, a.upper);
      return a;
    },
    dress(a, colour, connected) {
      tint(a, colour, connected);
      a.colour = colour;
      a.connected = connected;
    },
    /** Every frame: its wheels turn, its body bobs and leans, its head and mast lag; its lamp shows its vote. */
    frame(a, { now, dt, face: dir, seat, calm, grounded, walking, x, voting }) {
      const step = Math.min(dt, 1 / 30);
      const moving = !!walking && !grounded;
      if (typeof x === "number") {
        if (a.lastX !== null) a.rolled += x - a.lastX;
        a.lastX = x;
      }
      for (const w of a.wheels) set(w.lastChild, { transform: `rotate(${((a.rolled / 8.5) * 57.3).toFixed(1)})` });
      const bob = moving && !calm ? Math.abs(Math.sin(now / 55)) * 2.2 : 0;
      [a.lean, a.leanV] = spring(a.lean, a.leanV, moving ? dir * 5 : 0, 140, calm ? 30 : 11, step);
      // The head lags the body's lean, and the mast lags the head: on a stop both run on and wobble back.
      [a.nod, a.nodV] = spring(a.nod, a.nodV, a.lean, 170, calm ? 30 : 7, step);
      [a.mastA, a.mastV] = spring(a.mastA, a.mastV, a.nod * 1.4, 90, calm ? 30 : 4, step);
      // The base stays flat on its wheels; what rides on it leans about the top of the base.
      set(a.upper, { transform: `translate(0,${(-bob).toFixed(2)}) rotate(${a.lean.toFixed(2)},0,${(-0.16 * RU).toFixed(1)})` });
      set(a.headG, { transform: `rotate(${(a.nod - a.lean).toFixed(2)},0,${(-0.6 * RU).toFixed(1)})` });
      set(a.mastG, { transform: `rotate(${(a.mastA - a.nod).toFixed(2)},0,${(-0.97 * RU).toFixed(1)})` });
      // The lamp: dim at rest, lit while it stands in a game's light (a quick double flash as it steps in), red and flashing when knocked.
      if (voting && !a.voting) a.pleasedAt = now;
      a.voting = !!voting;
      const since = now - a.pleasedAt;
      const flash = since < PLEASED_MS && !calm ? (Math.floor(since / 120) % 2 === 0 ? 1 : 0.35) : 1;
      a.lampK += ((voting ? 1 : 0) - a.lampK) * Math.min(1, step * 10);
      const alarm = !!a.dizzy;
      const k = alarm ? (calm ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(now / 60))) : (0.35 + 0.65 * a.lampK) * flash;
      set(a.lamp, { fill: alarm ? ALARM : shade(LAMP, -0.5 * (1 - k)) });
      set(a.glow, { fill: alarm ? ALARM : LAMP, opacity: (alarm ? 0.4 * k : 0.38 * a.lampK * flash).toFixed(2) });
      const pleased = since < PLEASED_MS + 400 && !alarm;
      if (!alarm) {
        set(a.face.happy, { display: pleased ? null : "none" });
        set(a.face.open, { display: pleased ? "none" : null });
        const shut = calm ? 0 : blinkAt(now, seat);
        set(a.face.open, { transform: `translate(${dir * 3},${(ROBOT.visorY * shut * 0.85).toFixed(1)}) scale(1,${(1 - 0.85 * shut).toFixed(2)})` });
      }
      return 0;
    },
    dizzy(a, on) {
      a.dizzy = on;
      set(a.face.crosses, { display: on ? null : "none" });
      set(a.face.open, { display: on ? "none" : null });
      if (on) set(a.face.happy, { display: "none" });
    },
    blink(a, opacity) {
      set(a.torso, { opacity });
      set(a.head, { opacity });
    },
    /** An emote's pose laid over the body, or null when it ends: the emote drawing brings its face (lit in the visor) and its jointed arms. */
    emote(a, pose, bodyTransform) {
      if (!pose) {
        set(a.inner, { transform: null });
        set(a.face.g, { display: null });
        for (const g of [a.armsL, a.armsR]) set(g, { opacity: null });
        return;
      }
      set(a.inner, { transform: bodyTransform(pose.body) });
      set(a.face.g, { display: "none" });
      // Its own arms give way to the emote's.
      const rest = Math.max(0, Math.min(1, pose.ghost.nubs));
      for (const g of [a.armsL, a.armsR]) set(g, { opacity: rest.toFixed(2) });
    },
    still(colour) {
      const p = shapes(colour);
      const lamp = p.lamp;
      set(lamp, { fill: shade(LAMP, -0.2) });
      return s("g", {}, p.base, p.armsL, p.armsR, p.torso, p.torsoHi, p.plate, p.neck, p.mast, lamp, p.head, p.headHi, p.visor, p.visorGlint);
    },
    portrait(colour) {
      const g = this.still(colour);
      g.append(face().g);
      return g;
    },
  },
};
