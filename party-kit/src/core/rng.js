// Seeded random numbers. Every random choice in a room comes from the room's seed,
// so the room, the clients and the tests all draw the same numbers.

/** Mixes a string or number into a 32-bit seed. */
export function hashSeed(value) {
  const text = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** A small fast generator (mulberry32). Returns a function that yields numbers in [0, 1). */
export function makeRng(seed) {
  let a = hashSeed(seed) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (n) => Math.floor(next() * n);
  next.pick = (list) => list[Math.floor(next() * list.length)];
  /** A child generator whose stream does not disturb this one. */
  next.fork = (label) => makeRng(`${seed}/${label}`);
  return next;
}

/** A fresh room seed from the platform's secure source. */
export function newSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}
