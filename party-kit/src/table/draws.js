// The randomness of the Table games that deal secrets (Who Am I?, Paper Masks): a stream of draws
// from the match's secret, so knowing everything a page can see (every id, every name or answer
// revealed so far, the room's seed) tells nothing about the next draw.
//
// Draw n of a game is SHA-256("<game>/draw/<n>/<secret>") read as a number in [0, 1): SHA-256 in
// counter mode, a pseudorandom function keyed by the secret. The secret is at least 128 bits from
// the platform's secure source (the Table's adapter draws 256), so the generator's state is the
// secret itself, and the position is a plain count the rules keep in their state: a restart
// reproduces the same draws. `keyedHex` makes other values from the secret under labels of their
// own (Paper Masks' card ids), as unrelated to the draws as two draws are to each other.
//
// Synchronous on purpose: the rules are pure synchronous functions, and `crypto.subtle.digest` is
// asynchronous, so SHA-256 is written out here (FIPS 180-4; Who Am I's tests check it against
// node:crypto).

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 of a byte array; returns the 32-byte digest. */
export function sha256(bytes) {
  const length = bytes.length;
  const blocks = Math.ceil((length + 9) / 64);
  const data = new Uint8Array(blocks * 64);
  data.set(bytes);
  data[length] = 0x80;
  const bits = length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(data.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let block = 0; block < blocks; block++) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block * 64 + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A secret is at least 128 bits written as hex (the adapter gives 256). */
export const isSecret = (secret) => typeof secret === "string" && /^[0-9a-f]{32,}$/.test(secret);

/** A fresh 256-bit secret from the platform's secure source, as hex. */
export function freshSecret() {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** One game's draws: `draw(secret, n)` is draw number `n` (0, 1, 2, ...), in [0, 1) with 48 random bits. */
export function drawsFor(game) {
  return (secret, n) => {
    const d = sha256(encoder.encode(`${game}/draw/${n}/${secret}`));
    return (d[0] * 2 ** 40 + d[1] * 2 ** 32 + d[2] * 2 ** 24 + d[3] * 2 ** 16 + d[4] * 2 ** 8 + d[5]) / 2 ** 48;
  };
}

/** `chars` hex characters (at most 64) keyed by the secret under `label`: SHA-256("<label>/<secret>"). */
export function keyedHex(label, secret, chars = 16) {
  return hex(sha256(encoder.encode(`${label}/${secret}`))).slice(0, chars);
}
