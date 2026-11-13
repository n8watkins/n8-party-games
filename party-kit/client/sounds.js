// One device's player for a room's short sounds: what emotes carry, and the room's own (steps,
// the count, a door). The sounds are recordings, each with its source in a credits file: a sound
// is named, given an address (a file on the site, or a data: URI), fetched and decoded the first
// time it is needed (or ahead, with warm()), and then played with a single node.
//
//   - Nothing plays until the browser allows it (a tap or a key on this page): unlock() is called
//     from every tap and key, and a sound asked for before that is simply not played. Nothing is
//     queued, so unlocking never plays a backlog.
//   - Volume, "mute all sounds", the room's ambience volume and "mute this player" are kept on the device.
//   - One sound at a time per player (a new one cuts the old), and at most MAX_VOICES at once;
//     a minor sound (a footstep) never pushes another out, it is skipped instead.
//   - Ambience (a crackling fire, an owl) goes through a volume of its own, under the main one.
//   - Other parts of a room (a crackling fire, an owl, a plane going over) can add sounds of
//     their own by name with defineSound(), and play them with the same play().

/** How many sounds may play over each other on one device. */
export const MAX_VOICES = 6;
/** A sound that could not start within this long of being asked for is dropped, not played late. */
export const LATE_MS = 350;
/** ...except the first time it is played, when it has to be decoded: a slow phone may take this long. */
export const FIRST_PLAY_MS = 2000;
/** Where the device's choices are kept. */
export const PREFS_KEY = "party-kit:sound";

/** Every sound by name: name -> address (a site path or a data: URI). */
const BOOK = new Map();

/** Adds (or replaces) a sound by name for every player on this page. */
export function defineSound(name, address) {
  BOOK.set(name, address);
}

export function soundNames() {
  return [...BOOK.keys()];
}

export function hasSound(name) {
  return BOOK.has(name);
}

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
    this.ambience = typeof saved.ambience === "number" ? Math.min(1, Math.max(0, saved.ambience)) : 0.6;
    this.room = room;
    this.mutedPlayers = new Set(saved.players?.room === room ? saved.players.names : []);
    this.ctx = null;
    this.buffers = new Map();
    /** Sounds decoded on this device already. */
    this.decoded = new Set();
    this.voices = [];
    this.listeners = new Set();
    /** The last few things this player did with a request, newest last: for the tests and for a "why no sound" hint. */
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
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        this.ambientBus = this.ctx.createGain();
        this.ambientBus.gain.value = this.ambience;
        this.ambientBus.connect(this.master);
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

  /** Decodes the given sounds ahead of time, one after another, so the first play is instant. Call it once sound is allowed. */
  async warm(names = soundNames()) {
    if (!this.ctx) return;
    for (const name of names) {
      const ok = await this.buffer(name).then(
        () => true,
        () => false,
      );
      if (ok) this.decoded.add(name);
    }
  }

  buffer(name) {
    if (!this.buffers.has(name)) {
      const job = bytesOf(BOOK.get(name)).then((bytes) => new Promise((resolve, reject) => this.ctx.decodeAudioData(bytes, resolve, reject)));
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

  /** The room's own life (a fire, an owl), under the main volume: 0 turns it off on this device. */
  setAmbience(v) {
    this.ambience = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.ambientBus) this.ambientBus.gain.setTargetAtTime(this.ambience, this.ctx.currentTime, 0.02);
    if (this.ambience <= 0) for (const v2 of [...this.voices]) if (v2.bus === "ambient") this.stop(v2);
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
   * is not on screen), "late" (it could not be made ready in time), "busy" (a minor sound with
   * every voice taken) or "unknown".
   * @param {string} name
   * @param {{from?: string, gain?: number, bus?: "main" | "ambient", minor?: boolean, late?: number}} [opts]
   *   from: who sent it, by name, for "mute this player" and one voice each. gain: how loud, 0 to 1.
   *   bus: "ambient" for the room's own life, under its own volume. minor: skipped rather than
   *   cutting another sound when every voice is taken. late: the most it may start late, in ms,
   *   even the first time (a footstep is useless a second late).
   */
  async play(name, { from = "", gain = 1, bus = "main", minor = false, late = null } = {}) {
    const asked = performance.now();
    const who = String(from).toLowerCase();
    const said = (what) => {
      this.log.push({ name, from, what });
      if (this.log.length > 30) this.log.shift();
      return what;
    };
    if (!BOOK.has(name)) return said("unknown");
    if (this.muted || this.volume <= 0 || (bus === "ambient" && this.ambience <= 0) || (who && this.mutedPlayers.has(who))) return said("muted");
    if (!this.unlocked) return said("locked");
    if (typeof document !== "undefined" && document.hidden) return said("hidden");
    // A sound decoded before is ready at once; the first time, decoding takes a moment and that is fine.
    const first = !this.decoded.has(name);
    let buffer;
    try {
      buffer = await this.buffer(name);
    } catch {
      return said("unknown");
    }
    this.decoded.add(name);
    // Never late: a sound that waited for no good reason, or arrived while the page could not play, is dropped.
    if (performance.now() - asked > (late ?? (first ? FIRST_PLAY_MS : LATE_MS)) || !this.unlocked || this.muted) return said("late");
    if (who) this.stopAll(who);
    if (minor && this.voices.length >= MAX_VOICES) return said("busy");
    // Room for it: the oldest minor sound goes first, then the oldest of all.
    while (this.voices.length >= MAX_VOICES) this.stop(this.voices.find((v) => v.minor) ?? this.voices[0]);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const level = this.ctx.createGain();
    level.gain.value = Math.min(1, Math.max(0, gain));
    src.connect(level).connect(bus === "ambient" ? this.ambientBus : this.master);
    const voice = { src, gain: level, who, minor, bus };
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
      this.storage?.setItem(PREFS_KEY, JSON.stringify({ volume: this.volume, muted: this.muted, ambience: this.ambience, players: { room: this.room, names: [...this.mutedPlayers] } }));
    } catch {
      // Private browsing: the choice lasts as long as the page.
    }
    this.changed();
  }
}

/**
 * The bytes at an address. A data: URI is decoded here rather than fetched: a site's
 * Content-Security-Policy may allow fetching only from the site itself.
 */
async function bytesOf(address) {
  const inline = /^data:[^;,]*;base64,(.*)$/s.exec(address);
  if (!inline) return (await fetch(address)).arrayBuffer();
  const raw = atob(inline[1]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
