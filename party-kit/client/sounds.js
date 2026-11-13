// The room's sounds, made in the browser. No audio file is shipped or fetched: every sound is a
// recipe of oscillators, noise and filters (sound-recipes.js), rendered once per device through
// an OfflineAudioContext into a buffer and then played with a single node. So a sound costs the
// same to play on a cheap phone as a click, sounds the same on every device, and the tests can
// render each one and look at its waveform without a speaker (test browsers stay muted).
//
// A SoundBoard is one device's player:
//   - nothing plays until the browser allows it (a tap or a key on this page): unlock() is
//     called from every tap and key, and a sound asked for before that is simply not played.
//     Nothing is queued, so unlocking never plays a backlog.
//   - volume, "mute all sounds" and "mute this player" are kept on the device.
//   - one sound at a time per player (a new one cuts the old), and at most MAX_VOICES at once.
//   - other parts of a room (a crackling fire, an owl, a plane going over) can add sounds of
//     their own by name with define(), and play them with the same play().
import { RECIPES } from "./sound-recipes.js";

/** How many sounds may play over each other on one device. */
export const MAX_VOICES = 4;
/** A sound that could not start within this long of being asked for is dropped, not played late. */
export const LATE_MS = 350;
/** Where the device's choices are kept. */
export const PREFS_KEY = "party-kit:sound";

// ---------------------------------------------------------------- rendering

/** A small seeded random source, so every render of a sound is the same. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a recipe builds with: the context, where to plug in (`out`), a seeded random source and
 * small helpers. Every helper returns a Web Audio node; nothing here knows about any one sound.
 */
export class Patch {
  constructor(ctx, out, seed = 1) {
    this.ctx = ctx;
    this.out = out;
    this.rnd = seeded(seed);
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = this.rnd() * 2 - 1;
  }

  /** A random number between lo and hi. */
  r(lo = 0, hi = 1) {
    return lo + this.rnd() * (hi - lo);
  }

  osc(type, freq, start, stop) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.start(start);
    o.stop(stop);
    return o;
  }

  /** Looping white noise from a random place in the buffer. */
  noise(start, stop) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.white;
    s.loop = true;
    s.start(start, this.r(0, 1.8));
    s.stop(stop);
    return s;
  }

  filter(type, freq, q = 0.707, gainDb = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gainDb;
    return f;
  }

  amp(value = 0) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  pan(x) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, x));
    return p;
  }

  /** Soft clipping: `drive` above 1 adds the rasp of a reed or an overdriven speaker. */
  shaper(drive) {
    const w = this.ctx.createWaveShaper();
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    w.curve = curve;
    w.oversample = "2x";
    return w;
  }

  /** A small room: a burst of decaying noise as an impulse, for a little air around a sound. */
  room(seconds = 0.8, bright = 0.5) {
    const c = this.ctx.createConvolver();
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        low += (this.rnd() * 2 - 1 - low) * (0.08 + bright * 0.6);
        d[i] = low * Math.pow(1 - t, 3) * (i < 40 ? i / 40 : 1);
      }
    }
    c.buffer = ir;
    return c;
  }

  /** Connects nodes one into the next and returns the last. */
  chain(...nodes) {
    for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
    return nodes[nodes.length - 1];
  }

  // ---- envelopes on an AudioParam. All start and end at silence, so nothing clicks.

  /** A strike: up to `peak` in `attack` seconds, then dying away to a thousandth of it over `decay` seconds. */
  hit(param, t, peak, attack, decay) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(Math.max(1e-5, peak * 0.001), t + attack + decay);
    param.linearRampToValueAtTime(0, t + attack + decay + 0.005);
  }

  /** A held note: up in `attack`, held at `peak` until `t + len`, down to silence in `release`. */
  gate(param, t, peak, attack, len, release) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + Math.max(attack, len));
    param.linearRampToValueAtTime(0, t + Math.max(attack, len) + release);
  }

  /** Sets a param to follow f(u) for u from 0 to 1 over [t, t + dur], as a curve of `steps` points. */
  curve(param, t, dur, f, steps = 256) {
    const v = new Float32Array(steps);
    for (let i = 0; i < steps; i++) v[i] = f(i / (steps - 1));
    param.setValueCurveAtTime(v, t, dur);
  }
}

const OfflineCtx = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;

/** Every sound by name: the built-in recipes, and whatever a room has added with define(). */
const BOOK = new Map(Object.entries(RECIPES));

/** Adds (or replaces) a sound by name for every board on this page: `{length, level, build(patch, t)}`. */
export function defineSound(name, recipe) {
  BOOK.set(name, recipe);
}

export function soundNames() {
  return [...BOOK.keys()];
}

export function recipeOf(name) {
  return BOOK.get(name) ?? null;
}

/**
 * Renders one sound to an AudioBuffer: built in an OfflineAudioContext, then trimmed of its
 * silent tail and brought to its loudness (`level` is a peak between 0 and 1). Works in any
 * browser, playing nothing, so the tests use it too.
 */
export async function renderSound(name, sampleRate = 44100) {
  const recipe = BOOK.get(name);
  if (!recipe) throw new Error(`No such sound: ${name}`);
  const Ctx = OfflineCtx();
  const ctx = new Ctx(2, Math.ceil(recipe.length * sampleRate), sampleRate);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  recipe.build(new Patch(ctx, out, recipe.seed ?? hash(name)), 0.01);
  const buffer = await ctx.startRendering();
  return finish(buffer, recipe.level ?? PEAK_MAX, recipe.loudness ?? LOUDNESS);
}

/** Every sound is brought to about this loudness (RMS), so none is much louder than another... */
export const LOUDNESS = 0.15;
/** ...without its peaks going over this. */
export const PEAK_MAX = 0.95;

function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Brings a rendered sound to its loudness (RMS over the part that sounds) with its peak at most
 * `level`, cuts the silence after it and fades its last few milliseconds.
 */
function finish(buffer, level, loudness) {
  const chans = [...Array(buffer.numberOfChannels)].map((_, i) => buffer.getChannelData(i));
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (const d of chans) {
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]) < peak * 0.01) continue;
      sum += d[i] * d[i];
      n += 1;
    }
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  const k = peak > 0 ? Math.min(level / peak, rms > 0 ? loudness / rms : Infinity) : 0;
  let last = 0;
  const quiet = peak * 0.0015;
  for (const d of chans) {
    for (let i = d.length - 1; i > last; i--) {
      if (Math.abs(d[i]) > quiet) {
        last = i;
        break;
      }
    }
  }
  const fade = Math.floor(buffer.sampleRate * 0.012);
  const end = Math.min(buffer.length, last + fade);
  const out = new AudioBuffer({ numberOfChannels: chans.length, length: Math.max(1, end), sampleRate: buffer.sampleRate });
  chans.forEach((d, ch) => {
    const o = out.getChannelData(ch);
    for (let i = 0; i < end; i++) o[i] = d[i] * k * (i > end - fade ? (end - i) / fade : 1);
  });
  return out;
}

// ---------------------------------------------------------------- one device's player

function loadPrefs(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null");
    if (saved && typeof saved === "object") return saved;
  } catch {
    // Private browsing, or something unreadable: the defaults.
  }
  return {};
}

export class SoundBoard {
  /**
   * @param {{storage?: Storage | null, room?: string}} [opts]  storage: where choices are kept
   *   (localStorage by default; null keeps nothing). room: the party's code, so "mute this
   *   player" holds for this party and a new party starts with nobody muted.
   */
  constructor({ storage = safeStorage(), room = "" } = {}) {
    this.storage = storage;
    const saved = loadPrefs(storage);
    this.volume = typeof saved.volume === "number" ? Math.min(1, Math.max(0, saved.volume)) : 0.7;
    this.muted = !!saved.muted;
    this.room = room;
    this.mutedPlayers = new Set(saved.players?.room === room ? saved.players.names : []);
    this.ctx = null;
    this.buffers = new Map();
    this.voices = [];
    this.listeners = new Set();
    /** The last few things this board did with a request, newest last: for the tests and for a "why no sound" hint. */
    this.log = [];
  }

  /** This party's code: player mutes are kept per party. */
  setRoom(code) {
    if (code === this.room) return;
    const saved = loadPrefs(this.storage);
    this.room = code;
    this.mutedPlayers = new Set(saved.players?.room === code ? saved.players.names : []);
    this.changed();
  }

  /** Whether the browser lets this page play sound now. */
  get unlocked() {
    return this.ctx?.state === "running";
  }

  /**
   * Call from every tap and key press: the browser allows sound only after one. Creating the
   * context and resuming it inside the gesture is what iPhones need; a short silent buffer
   * finishes the job on older ones. Once running it does nothing.
   */
  unlock() {
    if (this.unlocked) return true;
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return false;
    try {
      if (!this.ctx) {
        this.ctx = new Ctx({ latencyHint: "interactive" });
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -6;
        this.limiter.knee.value = 4;
        this.limiter.ratio.value = 12;
        this.limiter.attack.value = 0.002;
        this.limiter.release.value = 0.15;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.limiter.connect(this.master).connect(this.ctx.destination);
        this.ctx.addEventListener?.("statechange", () => this.changed());
      }
      const silence = this.ctx.createBufferSource();
      silence.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      silence.connect(this.ctx.destination);
      silence.start(0);
      void this.ctx.resume?.().then(() => this.changed(), () => {});
    } catch {
      return false;
    }
    return this.unlocked;
  }

  /** Renders the given sounds ahead of time, one after another, so the first play is instant. */
  async warm(names = soundNames()) {
    for (const name of names) await this.buffer(name).catch(() => null);
  }

  buffer(name) {
    if (!this.buffers.has(name)) {
      const rate = this.ctx?.sampleRate ?? 44100;
      const job = renderSound(name, rate);
      job.catch(() => this.buffers.delete(name));
      this.buffers.set(name, job);
    }
    return this.buffers.get(name);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    this.save();
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (muted) this.stopAll();
    this.save();
  }

  /** `who` is the player's name, as the room spells it. Their emotes still show; only their sounds are silent here. */
  mutePlayer(who, muted) {
    const key = String(who).toLowerCase();
    if (muted) this.mutedPlayers.add(key);
    else this.mutedPlayers.delete(key);
    if (muted) this.stopAll(key);
    this.save();
  }

  isPlayerMuted(who) {
    return this.mutedPlayers.has(String(who ?? "").toLowerCase());
  }

  /**
   * Plays a sound now, or says why not: "played", "muted" (all sounds, or this player, or the
   * volume is at nothing), "locked" (the browser has not allowed sound yet), "hidden" (the page
   * is not on screen), "late" (it could not be made ready in time) or "unknown".
   * @param {string} name
   * @param {{from?: string}} [opts]  from: who sent it, by name, for "mute this player" and one voice each
   */
  async play(name, { from = "" } = {}) {
    const asked = performance.now();
    const who = String(from).toLowerCase();
    const said = (what) => {
      this.log.push({ name, from, what });
      if (this.log.length > 30) this.log.shift();
      return what;
    };
    if (!BOOK.has(name)) return said("unknown");
    if (this.muted || this.volume <= 0 || (who && this.mutedPlayers.has(who))) return said("muted");
    if (!this.unlocked) return said("locked");
    if (typeof document !== "undefined" && document.hidden) return said("hidden");
    let buffer;
    try {
      buffer = await this.buffer(name);
    } catch {
      return said("unknown");
    }
    // Never late: a sound that took too long to make ready, or arrived while the page could not play, is dropped.
    if (performance.now() - asked > LATE_MS || !this.unlocked || this.muted) return said("late");
    if (who) this.stopAll(who);
    while (this.voices.length >= MAX_VOICES) this.stop(this.voices[0]);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.limiter);
    const voice = { src, gain, who };
    src.onended = () => (this.voices = this.voices.filter((v) => v !== voice));
    this.voices.push(voice);
    src.start();
    return said("played");
  }

  stop(voice) {
    this.voices = this.voices.filter((v) => v !== voice);
    try {
      const t = this.ctx.currentTime;
      voice.gain.gain.setTargetAtTime(0, t, 0.015);
      voice.src.stop(t + 0.08);
    } catch {
      // Already stopped.
    }
  }

  /** Stops every sound, or only those from one player. */
  stopAll(who = null) {
    for (const v of [...this.voices]) if (who === null || v.who === who) this.stop(v);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed() {
    for (const fn of this.listeners) fn(this);
  }

  save() {
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify({ volume: this.volume, muted: this.muted, players: { room: this.room, names: [...this.mutedPlayers] } }));
    } catch {
      // Private browsing: the choice lasts as long as the page.
    }
    this.changed();
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
