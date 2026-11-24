// Hot Potato's sounds, made with the Web Audio API (no audio files). The owner's defaults from
// the reviewed screens: right answer "Bell", wrong or too slow "Knocks", the fuse's tick "Clock",
// the burst "Crack". Each is rendered once off-line, levelled to one peak with a short fade at
// each end, then played. Nothing is created or played before a tap: wake() is called inside one.
//
// And the vibration patterns (where the device can vibrate): twitching "Tap" (stage 1), swelling
// "Pulse" (stages 2 and 3), about to burst "Climb" (stage 4), the burst "Shudder".

const SR = 44100;
const PEAK = 0.7;

function noiseBuf(c, dur, seed) {
  const b = c.createBuffer(1, Math.ceil(dur * SR), SR);
  const d = b.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = s / 2147483648 - 1;
  }
  return b;
}

function tone(c, out, type, f0, t, attack, peak, decay) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

function hiss(c, out, t, dur, peak, type, f0, f1, q, seed) {
  const n = c.createBufferSource();
  n.buffer = noiseBuf(c, dur + 0.05, seed || 1);
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.Q.value = q || 0.7;
  fl.frequency.setValueAtTime(f0, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(fl);
  fl.connect(g);
  g.connect(out);
  n.start(t);
  n.stop(t + dur + 0.03);
}

const RECIPES = {
  bell: {
    dur: 0.95,
    draw: (c, o) => {
      tone(c, o, "sine", 1318.5, 0, 0.004, 0.6, 0.85);
      tone(c, o, "sine", 2637, 0, 0.003, 0.2, 0.4);
      tone(c, o, "sine", 3955.5, 0, 0.002, 0.08, 0.2);
    },
  },
  knocks: {
    dur: 0.42,
    draw: (c, o) => {
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1000;
      lp.connect(o);
      tone(c, lp, "square", 196, 0, 0.005, 0.6, 0.13);
      tone(c, lp, "square", 147, 0.17, 0.005, 0.6, 0.2);
    },
  },
  clock: {
    dur: 0.09,
    level: 0.45,
    draw: (c, o) => {
      hiss(c, o, 0.005, 0.03, 1, "bandpass", 3200, 0, 3, 5);
      tone(c, o, "sine", 1900, 0.005, 0.001, 0.25, 0.018);
    },
  },
  crack: {
    dur: 1.35,
    draw: (c, o) => {
      hiss(c, o, 0, 0.06, 0.45, "highpass", 1800, 0, 0.7, 31);
      hiss(c, o, 0.005, 0.8, 1, "lowpass", 1600, 260, 0.8, 32);
      [0.2, 0.31, 0.39, 0.52, 0.6, 0.77, 0.9, 1.08].forEach((t, i) => hiss(c, o, t, 0.05, 0.5 - i * 0.04, "bandpass", 1600 + ((i * 937) % 2600), 0, 3, 40 + i));
    },
  },
};

/** Vibration patterns, in milliseconds on and off. */
export const BUZZ = {
  tap: [40, 960],
  pulse: [70, 380],
  climb: [40, 160, 60, 120, 90, 80, 130, 40],
  shudder: [300, 60, 70, 50, 60, 50, 50, 60, 40],
};
/** The pattern that repeats while each stage's fuse burns (none while healthy). */
export const STAGE_BUZZ = [null, BUZZ.tap, BUZZ.pulse, BUZZ.pulse, BUZZ.climb];

export function createSounds() {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const AC = window.AudioContext || window.webkitAudioContext;
  const cache = new Map();
  let ctx = null;
  const live = { fx: null, tick: null };
  const token = { fx: 0, tick: 0 };

  function rendered(key) {
    if (!cache.has(key)) {
      const r = RECIPES[key];
      const c = new OAC(1, Math.ceil(r.dur * SR), SR);
      r.draw(c, c.destination);
      cache.set(
        key,
        new Promise((res, rej) => {
          c.oncomplete = (e) => res(e.renderedBuffer);
          const p = c.startRendering();
          if (p && p.then) p.then(res, rej);
        }).then((buf) => {
          const d = buf.getChannelData(0);
          let peak = 0;
          for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
          const k = (PEAK * (r.level || 1)) / (peak || 1);
          const fin = Math.round(SR * 0.002);
          const fout = Math.round(SR * 0.012);
          for (let i = 0; i < d.length; i++) {
            let g = k;
            if (i < fin) g *= i / fin;
            if (i > d.length - fout) g *= (d.length - 1 - i) / fout;
            d[i] *= g;
          }
          return buf;
        }),
      );
    }
    return cache.get(key);
  }

  function cut(ch) {
    const v = live[ch];
    if (!v) return;
    live[ch] = null;
    try {
      const t = ctx.currentTime;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + 0.012);
      v.src.stop(t + 0.02);
    } catch {
      // Already stopped.
    }
  }

  return {
    /** Call only inside a tap: makes (or resumes) the audio. False when this browser has none. */
    wake() {
      if (!AC || !OAC) return false;
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        Object.keys(RECIPES).forEach(rendered);
        return true;
      } catch {
        return false;
      }
    },
    /** Plays a sound on a channel ("fx" or "tick"); a newer sound on a channel cuts the older. */
    play(key, ch = "fx") {
      if (!ctx || !RECIPES[key]) return;
      const mine = ++token[ch];
      cut(ch);
      rendered(key)
        .then((buf) => {
          if (mine !== token[ch]) return;
          cut(ch);
          const src = ctx.createBufferSource();
          const g = ctx.createGain();
          src.buffer = buf;
          src.connect(g);
          g.connect(ctx.destination);
          const v = { src, g };
          src.onended = () => {
            if (live[ch] === v) live[ch] = null;
            try {
              g.disconnect();
            } catch {
              // Already disconnected.
            }
          };
          live[ch] = v;
          src.start();
        })
        .catch(() => {});
    },
    silence() {
      token.fx++;
      token.tick++;
      cut("fx");
      cut("tick");
    },
  };
}
