// The clock a room's timed events go by, as plain arithmetic (tested without a browser).
//
// Nothing is sent to keep devices in step. The room view already says how long the room has
// left (`closesIn`), so every device can work out how long the room has been open; and a
// sequence of repeatable numbers seeded by the room's code decides when each thing comes. Two
// devices in the same room therefore agree on the same owl at the same moment, to within the
// lag of the last message each of them got.

/** How long a room lasts, in seconds: the room view counts down from it. */
export const ROOM_LIFE = 4 * 3600;

/** How long a room has been open, in seconds, from a room view. */
export function roomAge(room) {
  return ROOM_LIFE - (room.closesIn ?? ROOM_LIFE * 1000) / 1000;
}

/** A whole number from a room's code (or any text), to seed its sequence. */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h | 0;
}

/** A repeatable number from 0 up to (not including) 1, for a seed and two whole numbers. */
export function chance(seed, a, b = 0) {
  let h = seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** When, in room seconds, thing number `index` comes in its nth stretch of `every` seconds. */
function startOf(def, index, n, seed) {
  return n * def.every + chance(seed, index, n) * (def.every - def.lasts);
}

/**
 * Whether a timed thing is happening at room time T, and how far through it is. It comes once
 * in every `every` seconds and lasts `lasts`. Returns null, or {u: 0 to 1, n: which time this
 * is, r and r2: two numbers for this time's own choices (which way, how high)}.
 */
export function occurrence(def, index, T, seed) {
  const n = Math.floor(T / def.every);
  const u = (T - startOf(def, index, n, seed)) / def.lasts;
  return u >= 0 && u < 1 ? { u, n, r: chance(seed, index + 101, n), r2: chance(seed, index + 211, n) } : null;
}

/** When the thing at `index` next starts, at or after room time T. */
export function nextStart(def, index, T, seed) {
  for (let n = Math.max(0, Math.floor(T / def.every)); ; n++) {
    const start = startOf(def, index, n, seed);
    if (start >= T) return start;
  }
}
