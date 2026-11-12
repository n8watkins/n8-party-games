// The stall, in metres. One source for the bake (Blender), the simulation (room and browser)
// and the picture. Axes: x to the right, y up, z towards the player; the stall runs into -z.

export const HALF_W = 1.25;

export const COUNTER = { zFront: 0.04, zBack: -0.34, top: 0.98 };

/** Three tiers of staging. Each row of targets stands on a step; corks come to rest on them. */
export const STEPS = [
  { zFront: -1.4, zBack: -1.9, top: 1.0 },
  { zFront: -1.9, zBack: -2.4, top: 1.32 },
  { zFront: -2.4, zBack: -2.78, top: 1.64 },
];

export const ROWS = [
  { id: "front", z: -1.52, y: 1.0, points: 10 },
  { id: "mid", z: -2.02, y: 1.32, points: 25 },
  { id: "far", z: -2.52, y: 1.64, points: 50 },
];

export const BACK = { z: -2.78, top: 2.18, archHalfW: 0.62, archH: 0.34 };
export const WALL_TOP = 2.18;

export const CAMERA = { pos: [0, 1.46, 0.82], look: [0, 1.29, -1.6], fov: 46 };

/** Where the cork leaves the gun (the muzzle moves a little with the aim). */
export function muzzle(ax, ay) {
  return [0.15 + ax * 0.1, 1.25 + (ay - 1.3) * 0.08, 0.2];
}

// ---------------------------------------------------------------- targets

export const PLATES = [-0.74, -0.37, 0, 0.37, 0.74].map((x, i) => ({ id: `p${i}`, x, y: ROWS[0].y + 0.125, z: ROWS[0].z, rx: 0.135, ry: 0.115 }));

export const CHAIN = { span: 1.96, r: 0.06, count: 10, speed: 0.24, y: ROWS[1].y + 0.13, z: ROWS[1].z, rx: 0.085, ry: 0.085 };
CHAIN.loop = 2 * CHAIN.span + 2 * Math.PI * CHAIN.r;

export const PENDULUMS = [
  { id: "d0", px: -0.64, py: 2.13, len: 0.41, amp: 0.5, phase: 0, z: ROWS[2].z, r: 0.092 },
  { id: "d1", px: 0.64, py: 2.13, len: 0.41, amp: 0.5, phase: 2.1, z: ROWS[2].z, r: 0.092 },
];
export const PENDULUM_RATE = 2.6; // radians per second of mechanism time

export const SHUTTER = { id: "sh", x: 0, y: ROWS[2].y + 0.1, z: ROWS[2].z, r: 0.062, period: 3.2, open: 0.42 };
export const BELL = { id: "bell", x: 0, y: 1.98, z: -2.7, r: 0.105 };
/** Where a rival's cork wedges into the front row's cam. */
export const JAM = { id: "jam", x: 1.04, y: ROWS[0].y + 0.07, z: ROWS[0].z + 0.02, r: 0.075 };

/** The drive on the left wall: a flywheel and one wheel per row, all on one belt. */
export const DRIVE = {
  x: -1.13,
  flywheel: { y: 0.762, z: -1.16, r: 0.26 },
  wheels: ROWS.map((row) => ({ y: row.y - 0.03, z: row.z + 0.02, r: 0.1 })),
};

// ---------------------------------------------------------------- bulbs

function borderBulbs() {
  const out = [];
  const z = BACK.z + 0.075;
  const x = HALF_W - 0.07;
  for (let i = 0; i < 3; i++) out.push([-x, 1.74 + i * 0.16, z]);
  out.push([-x + 0.04, 2.2, z]);
  out.push([-0.98, 2.24, z]);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = Math.PI - (i / (n - 1)) * Math.PI;
    out.push([Math.cos(a) * (BACK.archHalfW + 0.02), BACK.top + 0.06 + Math.sin(a) * (BACK.archH + 0.02), z]);
  }
  out.push([0.98, 2.24, z]);
  out.push([x - 0.04, 2.2, z]);
  for (let i = 2; i >= 0; i--) out.push([x, 1.74 + i * 0.16, z]);
  return out;
}

function keyBulbs() {
  const out = [];
  for (let i = 0; i < 9; i++) out.push([-1.12 + i * 0.28, 2.05, -0.93]);
  return out;
}

function festoonBulbs() {
  const out = [];
  for (let i = 0; i < 11; i++) {
    const u = i / 10;
    out.push([-2.6 + u * 5.2, 2.66 + 0.62 * (2 * u - 1) ** 2, -3.5]);
  }
  return out;
}

function prizeBulbs() {
  const out = [];
  for (let i = 0; i < 5; i++) out.push([HALF_W - 0.075, 1.86, -1.3 - i * 0.2]);
  return out;
}

/** Every bulb. `border` is the chase run, in order. `key` hang under the awning and light the targets. */
export const BULBS = { border: borderBulbs(), key: keyBulbs(), festoon: festoonBulbs(), prize: prizeBulbs() };

/** The live key light: where the awning bulbs are, as one soft source. */
export const KEY_LIGHT = { pos: [0.25, 2.3, -0.55], target: [0, 1.35, -2.1] };

export const PRIZE_SHELF = { x: HALF_W, y: 1.5, z0: -1.18, z1: -2.22 };
export const SCORE_WINDOW = { x: 0, y: 2.335, z: BACK.z + 0.045, w: 0.5, h: 0.125 };
export const CHALK_BOARD = { x: -HALF_W + 0.012, y: 1.86, z: -2.02, w: 0.62, h: 0.5 };
export const TRAY = { x: 0.72, z: -0.17, w: 0.3, d: 0.2 };
