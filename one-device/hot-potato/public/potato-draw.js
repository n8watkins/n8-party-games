// The code-drawn potato's geometry: pure numbers, no DOM, so the unit tests can hold it to the
// owner's rules (art-code.js turns these numbers into SVG every frame).
//
// What it draws, in the bold, flat, outlined cartoon style of the art picker's "Specimen":
//  - a fixed specimen bay (the frame) with a floor, a metal stand and its base plate;
//  - an ordinary potato, with no face, merged with a machine: a steel plate with one status
//    light, two plugs and their cables, a tether from the plate down to the stand, and faint
//    circuit traces under the skin;
//  - growth: one continuous value (0 healthy, 1 about to burst) that the body's size and its two
//    lumps follow; and strain (0 to 1), how tight the skin is.
//
// The owner's rules, and how this file keeps them:
//  - No face, ever: nothing here is an eye, a mouth or a brow.
//  - It grows; nothing is bolted on. Every part exists from the first frame: the same pores, plugs,
//    cables, traces and stretch marks, all placed by one seed in the body's own coordinates, so
//    they only move and stretch as it grows. What is new at a later stage is only a consequence of
//    the growth: cables pulled straight, creases where they pull, stretch marks opening, pores
//    glowing through thinner skin, the stand's rod sagging, the frame bowing where it is pushed.
//  - A proper starting point: at growth 0 it sits small and calm in its bay, on its stand.
//  - Pulsing, never shaking: the only motion is a scale about the point where it rests.

/** The drawing's coordinate box (viewBox 0 0 SIZE SIZE). */
export const SIZE = 400;

export const INK = "#1b1410";
export const SKIN = "#e0a458";
export const SKIN_HOT = "#e6955c";
export const SKIN_SHADE = "#b97a34";
export const SKIN_LIGHT = "#f6cf8e";
export const CIRCUIT = "#3ee6a8";

/** The specimen bay: a chamfered steel frame, its inner edges and its floor. Fixed. */
export const FRAME = { left: 22, right: 378, top: 30, bottom: 384, band: 15, chamfer: 30 };
export const FLOOR_Y = FRAME.bottom - FRAME.band; // 369
/** The stand: a wire cradle on a small base plate. Its feet and base never move. */
export const STAND = { cx: 200, half: 92, rodY: 334, footY: FLOOR_Y - 8, baseHalf: 118, baseH: 10 };
/** Where the tether from the plate plugs into the stand's base plate. */
export const TETHER_SOCKET = { x: STAND.cx + 56, y: FLOOR_Y - STAND.baseH - 2 };

/** The healthy body's half width and half height. */
const RX0 = 94;
const RY0 = 64;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** A small seeded generator (the same seed gives the same potato on every device). */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Everything one seed decides, made once: the body's fixed irregularity, where its two lumps
 * grow, and where every pore, plug, trace and stretch mark sits, in the body's own coordinates
 * (u across, v down, inside the unit circle). Nothing here depends on growth.
 */
export function makeSpecimen(seed = 7) {
  const r = rng(seed);
  const harmonics = [2, 3, 4, 5].map((n) => ({ n, a: (0.012 + r() * 0.022) * (n === 2 ? 0.6 : 1), phase: r() * Math.PI * 2 }));
  // Knobs all round, as on a real potato: each is there from the start, small, and swells as it
  // grows, so a bigger potato is a lumpier potato, not a new shape. Strongest on top, none on the
  // underside where it rests.
  const knobAt = [-2.55, -2.0, -1.5, -0.95, -0.4, 0.25, 2.85];
  const knobGrow = [0.1, 0.16, 0.08, 0.17, 0.1, 0.07, 0.08];
  const lumps = knobAt.map((at, i) => ({ at: at + (r() - 0.5) * 0.18, width: 0.24 + r() * 0.1, base: 0.018 + r() * 0.018, grow: knobGrow[i] * (0.85 + r() * 0.3) }));
  // The plate sits on the right of the body's front; the plugs on the left.
  const plate = { u: 0.38, v: 0.06 };
  const plugs = [
    { u: -0.6, v: -0.2, colour: "#d9483f", cable: "#2a2a2e", port: -0.32 },
    { u: -0.5, v: 0.3, colour: "#4b78c2", cable: "#e7b53c", port: 0.32 },
  ];
  // Pores: spread over the body, kept off the plate, plugs and the flattened bottom.
  const pores = [];
  const clear = (u, v) =>
    Math.hypot(u - plate.u, (v - plate.v) * 1.3) > 0.36 && plugs.every((p) => Math.hypot(u - p.u, v - p.v) > 0.2) && pores.every((p) => Math.hypot(u - p.u, v - p.v) > 0.24);
  for (let tries = 0; pores.length < 15 && tries < 600; tries++) {
    const u = (r() * 2 - 1) * 0.86;
    const v = -0.82 + r() * 1.38;
    if (u * u + v * v > 0.74 || !clear(u, v)) continue;
    pores.push({ u, v, size: 0.75 + r() * 0.5, tilt: (r() - 0.5) * 0.9 });
  }
  // Circuit traces from the plate into the skin: right-angled runs with a node at the end.
  const traces = [
    [[plate.u - 0.06, plate.v - 0.2], [plate.u - 0.06, -0.42], [plate.u - 0.3 - r() * 0.1, -0.42]],
    [[plate.u + 0.1, plate.v + 0.22], [plate.u + 0.1, 0.44], [plate.u + 0.32, 0.44]],
    [[plate.u + 0.26, plate.v - 0.12], [0.7, plate.v - 0.12], [0.7, -0.34 - r() * 0.08]],
  ];
  // Stretch marks: faint, short, closed lines from the start, opening and glowing as the skin is
  // pulled tight.
  const marks = [
    { u: -0.2, v: -0.6, angle: 0.3 },
    { u: 0.12, v: -0.72, angle: -0.2 },
    { u: -0.72, v: 0.04, angle: 1.4 },
    { u: 0.66, v: 0.4, angle: 1.1 },
    { u: -0.12, v: 0.42, angle: 0.1 },
  ].map((m) => ({ ...m, kink: 0.35 + r() * 0.3, side: r() < 0.5 ? -1 : 1 }));
  return { seed, harmonics, lumps, plate, plugs, pores, traces, marks };
}

const angleGap = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** The body's radius factor in a direction: the seed's irregularity plus the lumps at this growth. */
function radiusFactor(spec, theta, growth) {
  let k = 1;
  for (const h of spec.harmonics) k += h.a * Math.cos(h.n * theta + h.phase);
  for (const l of spec.lumps) {
    const g = angleGap(theta, l.at) / l.width;
    k += (l.base + l.grow * smooth(growth)) * Math.exp(-g * g);
  }
  return k;
}

/** How far the stand's rod sags at its middle: the weight of a bigger potato. */
export const rodSag = (growth) => 3 + 13 * smooth(clamp01(growth));
/** The rod's height at x: a shallow curve between its two ends. */
function rodY(x, growth) {
  const t = clamp01((x - (STAND.cx - STAND.half)) / (2 * STAND.half));
  return STAND.rodY + rodSag(growth) * 4 * t * (1 - t);
}

/** Cable lengths are set at growth 0 and never change: a cable can only go from slack to taut. */
const SLACK = { plug: 1.32, tether: 1.18 };

/**
 * The whole drawing at one moment. `growth` and `strain` 0 to 1; `pulse` the breathing (a small
 * signed number, the body's extra scale: positive swells, negative squashes); `seed` the specimen.
 */
export function potatoShape({ spec = makeSpecimen(), growth = 0, strain = 0, pulse = 0 } = {}) {
  const g = clamp01(growth);
  const s = clamp01(strain);
  const rx = lerp(RX0, 144, g) * (1 + 0.035 * s);
  const ry = lerp(RY0, 116, g) * (1 + 0.03 * s);
  const cx = STAND.cx;
  const restY = STAND.rodY + rodSag(g);
  const bottomK = radiusFactor(spec, Math.PI / 2, g);
  // It rests on the rod: a little of its bottom is flattened against it.
  const cy = restY + 0.12 * ry - ry * bottomK;
  // The breathing scales the body about the point where it rests; the stand and frame keep still.
  const sx = 1 + pulse * 0.7;
  const sy = 1 + pulse;
  const place = (x, y) => [cx + (x - cx) * sx, restY + (y - restY) * sy];
  // A point of the body in its own coordinates (u across, v down, rho up to 1 at the skin).
  const at = (u, v) => {
    const theta = Math.atan2(v, u);
    const rho = Math.hypot(u, v);
    const k = radiusFactor(spec, theta, g);
    const x = cx + rho * rx * k * Math.cos(theta);
    const y = Math.min(cy + rho * ry * k * Math.sin(theta), restY - 2);
    return place(x, y);
  };
  // The outline.
  const N = 56;
  const outline = [];
  for (let i = 0; i < N; i++) {
    const theta = (i / N) * Math.PI * 2;
    const k = radiusFactor(spec, theta, g);
    const x = cx + rx * k * Math.cos(theta);
    // Flattened only where it rests on the rod; past the rod's ends it may bulge down over them
    // (the limit eases down over 40 units, so the outline has no corner there).
    const past = smooth(clamp01((Math.abs(x - STAND.cx) - STAND.half) / 40));
    const limit = lerp(rodY(x, g) + 0.5, FLOOR_Y - 16, past);
    const y = Math.min(cy + ry * k * Math.sin(theta), limit);
    outline.push(place(x, y));
  }
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  // How far it stretches its pores: the area grown, as a length.
  const stretch = Math.sqrt((rx * ry) / (RX0 * RY0));
  const pores = spec.pores.map((p) => {
    const [x, y] = at(p.u, p.v);
    // A pore stretches along the skin as the skin is pulled: wider, a little flatter.
    const w = 10 * p.size * Math.pow(stretch, 0.6) * (1 + 0.25 * s);
    const h = 5.4 * p.size * Math.pow(stretch, 0.35) * (1 - 0.18 * s);
    // A faint glow in every pore from the start (the machine inside), brighter as it strains.
    return { x, y, w, h, tilt: p.tilt, glow: 0.16 + 0.84 * clamp01((s - 0.3) / 0.6) };
  });
  // The plate is rigid steel: it moves with the skin but keeps its size. The tether can tilt it.
  const [px, py] = at(spec.plate.u, spec.plate.v);
  const plate = { x: px, y: py, w: 70, h: 52, angle: 0 };
  // Cables: each has the length it had at growth 0; more distance than that and it is taut.
  const rest = potatoRest(spec);
  const cables = spec.plugs.map((p, i) => {
    const a = at(p.u, p.v);
    const b = [plate.x - plate.w / 2 + 4, plate.y + p.port * plate.h * 0.8];
    return { ...cable(a, b, rest.plugs[i] * SLACK.plug), plug: a, colour: p.colour, cable: p.cable };
  });
  const tetherFrom = [plate.x + 10, plate.y + plate.h / 2 - 2];
  const tether = cable(tetherFrom, [TETHER_SOCKET.x, TETHER_SOCKET.y], rest.tether * SLACK.tether);
  // A taut tether pulls the plate's lower edge toward the socket.
  plate.angle = 10 * clamp01(tether.over * 4);
  // Creases: where a cable is set into the skin there is always a little pucker; as the cable is
  // pulled taut the lines fan out longer and deeper. `pull` 0 to 1.
  const creases = cables.map((c) => {
    const pull = clamp01(c.over * 3);
    return { x: c.plug[0], y: c.plug[1], toward: Math.atan2(c.to[1] - c.from[1], c.to[0] - c.from[0]), len: 5 + 21 * pull, pull };
  });
  const platePull = clamp01(Math.max(...cables.map((c) => c.over)) * 3);
  creases.push({ x: plate.x - plate.w / 2, y: plate.y, toward: Math.PI, len: 5 + 17 * platePull, pull: platePull });
  const traces = spec.traces.map((run) => run.map(([u, v]) => at(u, v)));
  const marks = spec.marks.map((m) => {
    const open = clamp01((s - 0.35) / 0.55);
    const [x, y] = at(m.u, m.v);
    return { x, y, angle: m.angle, len: (9 + 20 * open) * Math.sqrt(stretch), open, kink: m.kink, side: m.side };
  });
  return {
    growth: g,
    strain: s,
    rx,
    ry,
    cx,
    cy,
    restY,
    outline,
    box,
    stretch,
    pores,
    plate,
    cables,
    tether,
    creases,
    traces,
    marks,
    skin: mixColour(SKIN, SKIN_HOT, smooth(s)),
    frame: frameShape(box),
    stand: standShape(g),
  };
}

/** The plug-to-plate and plate-to-stand distances at growth 0: the cables' fixed lengths. */
const restCache = new Map();
function potatoRest(spec) {
  if (restCache.has(spec)) return restCache.get(spec);
  const r = { plugs: [], tether: 0 };
  restCache.set(spec, r);
  const s0 = potatoShape({ spec, growth: 0, strain: 0, pulse: 0 });
  r.plugs = s0.cables.map((c) => Math.hypot(c.to[0] - c.from[0], c.to[1] - c.from[1]));
  r.tether = Math.hypot(s0.tether.to[0] - s0.tether.from[0], s0.tether.to[1] - s0.tether.from[1]);
  return r;
}

/**
 * A cable of a fixed length between two points: it hangs (a curve whose sag uses up the extra
 * length) or, when the points are further apart than its length, it is pulled straight.
 * `over` is how far it is stretched past its length, as a share (0 when slack).
 */
export function cable(from, to, length) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  if (!length) return { from, to, control: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], sag: 0, over: 0, length: d };
  const extra = Math.max(0, length - d);
  // A shallow hanging curve of span d and sag h is about d + 8h²/(3d) long.
  const sag = Math.sqrt((3 * d * extra) / 8);
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  // It bows across its own line, toward the ground (a cable hanging straight down bows aside).
  let px = -(to[1] - from[1]) / d;
  let py = (to[0] - from[0]) / d;
  if (py < 0 || (Math.abs(py) < 1e-9 && px < 0)) {
    px = -px;
    py = -py;
  }
  return { from, to, control: [mx + px * 2 * sag, my + py * 2 * sag], sag, over: Math.max(0, d / length - 1), length };
}

/**
 * The frame stays where it is; once the potato presses on its sides, both sides bow out together
 * (it pushes outward, so the whole bay strains), and the top bar bows up if it reaches that.
 * `bow` is in drawing units; `press` 0 to 1 is how hard it presses, for the strain lines.
 */
export function frameShape(box) {
  const inner = { left: FRAME.left + FRAME.band, right: FRAME.right - FRAME.band, top: FRAME.top + FRAME.band };
  const room = 22;
  const push = (over) => Math.min(14, Math.max(0, over) * 0.6);
  const side = push(Math.max(inner.left + room - box.left, box.right - (inner.right - room)));
  return {
    ...FRAME,
    bow: { left: side, right: side, top: push(inner.top + room - box.top) },
    press: clamp01(side / 10),
  };
}

/** The stand: fixed feet and base plate; only its rod bends, under the weight. */
export function standShape(growth) {
  const sag = rodSag(growth);
  const l = STAND.cx - STAND.half;
  const r = STAND.cx + STAND.half;
  return {
    rod: { from: [l, STAND.rodY], to: [r, STAND.rodY], control: [STAND.cx, STAND.rodY + 2 * sag], sag },
    legs: [
      [l, STAND.rodY, l - 6, STAND.footY],
      [r, STAND.rodY, r + 6, STAND.footY],
    ],
    feet: [
      [l - 6, STAND.footY],
      [r + 6, STAND.footY],
    ],
    base: { x: STAND.cx - STAND.baseHalf, y: FLOOR_Y - STAND.baseH, w: STAND.baseHalf * 2, h: STAND.baseH },
  };
}

/**
 * The breathing: a slow, shallow swell when it is healthy, quicker and deeper as it strains, a
 * heartbeat near the end. Pure scale, never a shake. `t` in seconds.
 */
export function pulseAt(t, strain) {
  const s = clamp01(strain);
  const hz = 0.28 + 1.5 * s * s;
  const depth = 0.01 + 0.032 * s;
  const phase = (t * hz) % 1;
  // A soft swell and release: a raised cosine, with a quicker attack as it strains.
  const attack = lerp(0.5, 0.3, s);
  const wave = phase < attack ? 0.5 - 0.5 * Math.cos((Math.PI * phase) / attack) : 0.5 + 0.5 * Math.cos((Math.PI * (phase - attack)) / (1 - attack));
  return depth * wave;
}

/** Mixes two #rrggbb colours. */
export function mixColour(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(lerp(v, pb[i], clamp01(t))).toString(16).padStart(2, "0")).join("")}`;
}

/** A closed, smooth path through points (Catmull-Rom as cubic Béziers). */
export function smoothPath(points) {
  const n = points.length;
  const f = (v) => Math.round(v * 10) / 10;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/**
 * The burst, `t` seconds after it: a flash and a splat, chunks of skin thrown out that land on the
 * floor and stay, and a pile of mash on the stand that steams. The plate drops to the floor, its
 * light out. Settles by about 1.6 s.
 */
export function burstShape(spec, t) {
  const r = rng(spec.seed * 31 + 5);
  const cx = STAND.cx;
  const cy = 190;
  const chunks = Array.from({ length: 11 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 10 - 0.5) * 2.9 + (r() - 0.5) * 0.25;
    const speed = 300 + r() * 200;
    const vx = Math.cos(a) * speed * 0.9;
    let vy = Math.sin(a) * speed - 120;
    const size = 12 + r() * 12;
    const spin = (r() - 0.5) * 900;
    // Thrown, then falling; each comes to rest on the floor (or against the frame's sides).
    const gravity = 1300;
    let x = cx + vx * t;
    let y = cy + vy * t + 0.5 * gravity * t * t;
    // Resting on the floor, wholly inside the bay (a chunk reaches about 1.15 × size from its middle).
    const floor = FLOOR_Y - size * 0.95;
    let landed = false;
    if (y > floor) {
      y = floor;
      landed = true;
    }
    // Clear of the frame's chamfered corners (a chunk reaches about 1.15 × size from its middle).
    const minX = FRAME.left + FRAME.chamfer + 1.3 * size + 8;
    const maxX = FRAME.right - FRAME.chamfer - 1.3 * size - 8;
    // The time it lands: from then it stays where it fell.
    const tl = (-vy + Math.sqrt(vy * vy + 2 * gravity * (floor - cy))) / gravity;
    if (landed) x = cx + vx * tl;
    x = Math.max(minX, Math.min(maxX, x));
    const angle = spin * Math.min(t, tl);
    const sides = 5 + (i % 3);
    const shape = Array.from({ length: sides }, (_, j) => {
      const aa = (j / sides) * Math.PI * 2;
      const rr = size * (0.7 + r() * 0.45);
      return [Math.cos(aa) * rr, Math.sin(aa) * rr * 0.8];
    });
    vy = 0;
    return { x, y, angle, shape, landed };
  });
  const pile = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    const lump = 1 + 0.08 * Math.sin(i * 1.3 + spec.seed) + 0.04 * Math.sin(i * 2.9 + 1);
    pile.push([cx + Math.cos(a) * 118 * lump, STAND.rodY + 8 + Math.sin(a) * 70 * lump]);
  }
  pile.push([cx + 100, STAND.rodY + 12], [cx, STAND.rodY + 16], [cx - 100, STAND.rodY + 12]);
  const grow = smooth(clamp01(t / 0.35));
  return {
    flash: { r: 40 + 260 * clamp01(t / 0.5), opacity: clamp01(1 - t / 0.6) },
    // The splat pops out, holds, then shrinks away at full strength: it never fades through a
    // half-transparent, muddy colour.
    splat: { scale: smooth(clamp01(t / 0.18)) * (1 - smooth(clamp01((t - 0.45) / 0.35))) },
    chunks,
    pile: pile.map(([x, y]) => [cx + (x - cx) * grow, STAND.rodY + 10 + (y - STAND.rodY - 10) * grow]),
    pileShown: grow,
    // The plate (52 high) comes to rest on the floor at a slant, inside the bay.
    plate: { x: 262 + 14 * smooth(clamp01(t / 0.7)), y: lerp(240, FLOOR_Y - 36, smooth(clamp01(t / 0.7))), angle: 14 * smooth(clamp01(t / 0.7)) },
    stand: standShape(0.4),
    frame: frameShape({ left: 200, right: 200, top: 200, bottom: 200 }),
  };
}
