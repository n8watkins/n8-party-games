// The ghost's two sounds, made in code: no recording, so nothing to credit (a recording would need
// its licence in sounds/CREDITS.txt first). They are played by the kit's player like every other
// room sound (party-kit/client/sounds.js: the same volume, mute and "who hears it" rules), named
// here as short WAV files built on this device the first time the page asks for them.
//
//   ghost-fade   a soft airy swell with a rising shimmer: a ghost going see-through
//   ghost-boo    a warbling "booOOoo", rising and falling: the ghost's scare and its spook
//
// Nobody has judged these by ear yet; they are kept quiet and short, under the room's recordings.
import { defineSound } from "/party-kit/client/sounds.js";

const RATE = 22050;

/** Mono 16-bit WAV bytes from samples in -1..1. */
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

/** "booOOoo": a voice-like tone that rises and falls, with a slow warble and a soft second harmonic. */
export function booSamples() {
  const n = Math.round(RATE * 0.78);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const u = i / n;
    // Up from a low "b", over the top, and down again.
    const pitch = 200 + 130 * Math.sin(Math.min(1, u * 1.25) * Math.PI) - 40 * u;
    const warble = 1 + 0.035 * Math.sin(2 * Math.PI * 6.2 * t);
    phase += (2 * Math.PI * pitch * warble) / RATE;
    const tone = Math.sin(phase) + 0.32 * Math.sin(2 * phase + 0.6) + 0.12 * Math.sin(3 * phase + 1.1);
    out[i] = 0.42 * envelope(u, 0.09, 0.32) * tone;
  }
  return out;
}

/** A soft swell of air with a shimmer rising through it. */
export function fadeSamples() {
  const n = Math.round(RATE * 0.55);
  const out = new Float32Array(n);
  let seed = 12345;
  let low = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = seed / 0x3fffffff - 1;
    // Air: noise, softened.
    low += (noise - low) * 0.18;
    phase += (2 * Math.PI * (700 + 900 * u * u)) / RATE;
    const shimmer = Math.sin(phase) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 14 * (i / RATE)));
    out[i] = envelope(u, 0.35, 0.45) * (0.32 * low + 0.12 * shimmer);
  }
  return out;
}

let defined = false;

/** Names the ghost's sounds for the page's player. Built once, on first call (a few milliseconds). */
export function defineGhostSounds() {
  if (defined) return;
  defined = true;
  defineSound("ghost-boo", dataUri(wav(booSamples())));
  defineSound("ghost-fade", dataUri(wav(fadeSamples())));
}
