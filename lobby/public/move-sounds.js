// The robot's and the slime's sounds, made in code as the ghost's are (ghost-sounds.js): no
// recording, so nothing to credit. Played by the kit's player like every other room sound
// (party-kit/client/sounds.js: the same volume, mute and "who hears it" rules), named here as short
// WAV files built on this device the first time a robot or a slime does anything.
//
//   hook-throw    a quick whoosh with the rattle of a chain paying out
//   hook-catch    a metal clank as the hook bites, and the chain reeling in
//   hook-clang    a bright ring: the hook off a hardened slime, or batted away
//   stilts-up     a short rising servo whine
//   stilts-down   a clank as the legs drop
//   slime-harden  a glassy tick and a little crystal ring
//   slime-absorb  a soft squelch
//   slime-shove   a soft boing
//   robot-bonk    a hollow bonk: two heads meeting
//
// Nobody has judged these by ear yet; they are kept quiet and short, under the room's recordings.
import { defineSound } from "/party-kit/client/sounds.js";

const RATE = 22050;

function wav(samples) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}

function dataUri(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "data:audio/wav;base64," + btoa(bin);
}

/** A smooth rise and fall over 0..1: up in `a`, down over the last `r`. */
const envelope = (u, a, r) => Math.min(1, u / a) * Math.min(1, (1 - u) / r);

/** Fills `seconds` of samples from f(t, u, noise). */
function make(seconds, f) {
  const n = Math.round(RATE * seconds);
  const out = new Float32Array(n);
  let seed = 4321;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = f(i / RATE, i / n, seed / 0x3fffffff - 1);
  }
  return out;
}

/** A metal ring: a few inharmonic partials that die away. */
const ring = (t, base, decay) => (Math.sin(2 * Math.PI * base * t) + 0.6 * Math.sin(2 * Math.PI * base * 2.76 * t) + 0.35 * Math.sin(2 * Math.PI * base * 5.4 * t)) * Math.exp(-t / decay);

export function hookThrowSamples() {
  let low = 0;
  return make(0.26, (t, u, noise) => {
    low += (noise - low) * (0.08 + 0.5 * u);
    // The chain: little clicks paying out, quicker as it flies.
    const click = Math.sin(2 * Math.PI * 2400 * t) * Math.max(0, Math.sin(2 * Math.PI * (40 + 60 * u) * t)) ** 12;
    return envelope(u, 0.1, 0.4) * (0.4 * low + 0.25 * click);
  });
}

export function hookCatchSamples() {
  return make(0.32, (t, u, noise) => 0.38 * ring(t, 520, 0.06) * envelope(u, 0.01, 0.5) + 0.12 * noise * Math.exp(-t / 0.01));
}

export function hookClangSamples() {
  return make(0.5, (t, u) => 0.34 * ring(t, 1180, 0.14) * envelope(u, 0.005, 0.3));
}

export function stiltsUpSamples() {
  let phase = 0;
  return make(0.24, (t, u) => {
    phase += (2 * Math.PI * (220 + 520 * u)) / RATE;
    // A servo: a buzzy tone sliding up.
    return 0.2 * envelope(u, 0.15, 0.3) * (Math.sin(phase) + 0.4 * Math.sign(Math.sin(phase * 2)));
  });
}

export function stiltsDownSamples() {
  return make(0.22, (t, u, noise) => 0.36 * (ring(t, 300, 0.04) + 0.5 * noise * Math.exp(-t / 0.008)) * envelope(u, 0.005, 0.4));
}

export function slimeHardenSamples() {
  return make(0.36, (t, u) => 0.26 * (ring(t, 1760, 0.05) + 0.5 * ring(t, 2640, 0.09)) * envelope(u, 0.004, 0.4));
}

export function slimeAbsorbSamples() {
  let phase = 0;
  let low = 0;
  return make(0.32, (t, u, noise) => {
    low += (noise - low) * 0.06;
    phase += (2 * Math.PI * (300 - 180 * u + 30 * Math.sin(t * 60))) / RATE;
    return 0.3 * envelope(u, 0.08, 0.5) * (Math.sin(phase) * 0.7 + low * 0.6);
  });
}

export function slimeShoveSamples() {
  let phase = 0;
  return make(0.2, (t, u) => {
    phase += (2 * Math.PI * (180 + 140 * Math.exp(-t / 0.04))) / RATE;
    return 0.3 * envelope(u, 0.04, 0.6) * Math.sin(phase);
  });
}

export function bonkSamples() {
  let phase = 0;
  return make(0.3, (t, u) => {
    phase += (2 * Math.PI * (260 - 120 * u)) / RATE;
    return 0.42 * Math.exp(-t / 0.07) * (Math.sin(phase) + 0.3 * Math.sin(phase * 3.1));
  });
}

/** Every sound by name: what it is made from. */
export const MOVE_SOUNDS = {
  "hook-throw": hookThrowSamples,
  "hook-catch": hookCatchSamples,
  "hook-clang": hookClangSamples,
  "stilts-up": stiltsUpSamples,
  "stilts-down": stiltsDownSamples,
  "slime-harden": slimeHardenSamples,
  "slime-absorb": slimeAbsorbSamples,
  "slime-shove": slimeShoveSamples,
  "robot-bonk": bonkSamples,
};

let defined = false;

/** Names the robot's and the slime's sounds for the page's player. Built once, on first call (a few milliseconds). */
export function defineMoveSounds() {
  if (defined) return;
  defined = true;
  for (const [name, make] of Object.entries(MOVE_SOUNDS)) defineSound(name, dataUri(wav(make())));
}
