// Every sound the soundboard knows, as a recipe: oscillators, noise and filters wired up in an
// (offline) audio context. Nothing here is a recording or comes from anywhere: each sound is
// made from scratch, so the repository stays MIT with no audio licence to keep.
//
// A recipe is {length, level, build(patch, t)}: `length` is how many seconds to render (the
// silent tail is cut afterwards), `level` the peak it is brought to, and build() wires the
// sound into patch.out starting at time t (sounds.js, Patch, has the helpers).
//
// The list is longer than the soundboard will be: it holds every candidate for the owner to
// pick from on the preview page (/preview/emotes/, local only).

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** A parallel bank of resonances: what turns a buzz into a vowel ("oo", "ah"). Returns the node to feed. */
function formants(p, dest, bank) {
  const input = p.amp(1);
  for (const [freq, q, gain] of bank) p.chain(input, p.filter("bandpass", freq, q), p.amp(gain), dest);
  return input;
}

/** A send into a small room, mixed in at `wet`. Returns the node to feed. */
function roomSend(p, seconds, wet, bright = 0.5) {
  const send = p.amp(wet);
  p.chain(send, p.room(seconds, bright), p.out);
  return send;
}

/** A slow wobble added to a param: a vibrato on a pitch, or a "wah" on a filter. Depth fades in from `from` to `to`. */
function wobble(p, param, rate, t0, t1, from, to, rampEnd = t1) {
  const lfo = p.osc("sine", rate, t0, t1);
  const depth = p.amp(0);
  depth.gain.setValueAtTime(from, t0);
  depth.gain.linearRampToValueAtTime(to, rampEnd);
  lfo.connect(depth).connect(param);
}

/** A smooth curve through points [[x, y], ...], for x between the first and last point. */
function through(points) {
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x0, y0] = points[i - 1];
      if (x <= x1) {
        const u = (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      }
    }
    return points[points.length - 1][1];
  };
}

export const RECIPES = {
  // ---------------------------------------------------------------- the classics

  /** A stadium air horn: three blasts, short, short, long. Detuned reeds through a rasp, with the hiss of the can. */
  horn: {
    length: 1.45,
    build(p, t) {
      const f = 415;
      const bus = p.amp(1);
      p.chain(bus, p.shaper(2.6), p.filter("highpass", 180), p.filter("peaking", 1700, 1, 6), p.filter("lowpass", 5200, 0.9), p.out);
      for (const [s, len] of [
        [0, 0.11],
        [0.18, 0.11],
        [0.36, 0.8],
      ]) {
        const s0 = t + s;
        for (const [ratio, type, g] of [
          [1, "sawtooth", 0.32],
          [1.006, "sawtooth", 0.3],
          [0.994, "sawtooth", 0.3],
          [0.5, "square", 0.16],
          [1.498, "sawtooth", 0.1],
        ]) {
          // The reed catches flat, settles on its note, and sags as the can lets go.
          const o = p.osc(type, f * ratio * 0.9, s0, s0 + len + 0.14);
          o.frequency.linearRampToValueAtTime(f * ratio, s0 + 0.035);
          o.frequency.setValueAtTime(f * ratio, s0 + len);
          o.frequency.linearRampToValueAtTime(f * ratio * 0.93, s0 + len + 0.09);
          const env = p.amp();
          p.gate(env.gain, s0, g, 0.012, len, 0.08);
          p.chain(o, env, bus);
        }
        const hiss = p.amp();
        p.gate(hiss.gain, s0, 0.05, 0.02, len, 0.08);
        p.chain(p.noise(s0, s0 + len + 0.12), p.filter("bandpass", 3200, 0.8), hiss, p.out);
      }
    },
  },

  /** Wah, wah, wah, waaah: a muted trombone stepping down by semitones, the last note wobbling as it gives up. */
  trombone: {
    length: 2.9,
    build(p, t) {
      const bus = p.amp(1);
      p.chain(bus, p.filter("peaking", 500, 1, 3), p.out);
      bus.connect(roomSend(p, 1.1, 0.18));
      const notes = [
        [midi(58), 0, 0.36],
        [midi(57), 0.42, 0.36],
        [midi(56), 0.84, 0.36],
        [midi(55), 1.26, 1.3],
      ];
      notes.forEach(([f, s, len], i) => {
        const last = i === notes.length - 1;
        const s0 = t + s;
        const lp = p.filter("lowpass", 350, 4);
        lp.frequency.setValueAtTime(350, s0);
        lp.frequency.linearRampToValueAtTime(last ? 1100 : 1500, s0 + 0.13);
        lp.frequency.linearRampToValueAtTime(last ? 650 : 600, s0 + len);
        // The plunger: the last note goes wah-wah-wah.
        if (last) wobble(p, lp.frequency, 4.6, s0, s0 + len + 0.1, 0, 420, s0 + 0.4);
        const env = p.amp();
        p.gate(env.gain, s0, 0.5, 0.03, len, 0.1);
        p.chain(lp, env, bus);
        for (const [ratio, type, g] of [
          [1, "sawtooth", 0.5],
          [1.004, "sawtooth", 0.4],
          [0.5, "square", 0.15],
        ]) {
          const o = p.osc(type, f * ratio * 0.965, s0, s0 + len + 0.15);
          o.frequency.linearRampToValueAtTime(f * ratio, s0 + 0.06);
          if (last) {
            o.frequency.setValueAtTime(f * ratio, s0 + len - 0.35);
            o.frequency.linearRampToValueAtTime(f * ratio * 0.965, s0 + len);
            wobble(p, o.frequency, 5.2, s0, s0 + len + 0.1, 0, f * ratio * 0.02, s0 + 0.5);
          }
          p.chain(o, p.amp(g), lp);
        }
        const breath = p.amp();
        p.hit(breath.gain, s0, 0.05, 0.01, 0.09);
        p.chain(p.noise(s0, s0 + 0.2), p.filter("bandpass", 1200, 1), breath, bus);
      });
    },
  },

  /** A small crowd clapping: forty-odd pairs of hands, each with its own pace and tone, swelling in and dying away. */
  applause: {
    length: 3,
    build(p, t) {
      const crowd = p.amp(0);
      crowd.gain.setValueAtTime(0, t);
      crowd.gain.linearRampToValueAtTime(1, t + 0.3);
      crowd.gain.setValueAtTime(1, t + 1.6);
      crowd.gain.linearRampToValueAtTime(0, t + 2.7);
      p.chain(crowd, p.filter("highpass", 300), p.out);
      crowd.connect(roomSend(p, 1.1, 0.4, 0.7));
      for (let c = 0; c < 46; c++) {
        const g = p.amp(0);
        p.chain(p.noise(t, t + 2.8), p.filter("bandpass", p.r(900, 2600), p.r(0.8, 1.6)), g, p.pan(p.r(-0.85, 0.85)), crowd);
        const loud = p.r(0.4, 1);
        const every = 1 / p.r(3.6, 5.6);
        const stop = t + p.r(1.9, 2.6);
        for (let at = t + p.r(0, 0.25); at < stop; at += every * p.r(0.85, 1.15)) {
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(loud, at + 0.0012);
          g.gain.exponentialRampToValueAtTime(loud * 0.004, at + p.r(0.03, 0.06));
          g.gain.linearRampToValueAtTime(0, at + 0.07);
        }
      }
    },
  },

  /** Ba-dum-tss: snare, tom, then the kick and the cymbal. */
  rimshot: {
    length: 1.8,
    build(p, t) {
      const kit = p.amp(1);
      kit.connect(p.out);
      kit.connect(roomSend(p, 0.7, 0.16, 0.6));
      const drum = (from, to, glide, peak, decay, at) => {
        const o = p.osc("sine", from, at, at + decay + 0.05);
        o.frequency.exponentialRampToValueAtTime(to, at + glide);
        const g = p.amp();
        p.hit(g.gain, at, peak, 0.002, decay);
        p.chain(o, g, kit);
      };
      const hiss = (type, freq, q, peak, decay, at) => {
        const g = p.amp();
        p.hit(g.gain, at, peak, 0.001, decay);
        p.chain(p.noise(at, at + decay + 0.05), p.filter(type, freq, q), g, kit);
      };
      // Ba: the snare, its skin and its wires.
      const ba = t;
      drum(195, 150, 0.08, 0.55, 0.13, ba);
      hiss("highpass", 1800, 0.7, 0.55, 0.18, ba);
      hiss("bandpass", 4500, 0.8, 0.35, 0.12, ba);
      // Dum: a tom.
      const dum = t + 0.17;
      drum(150, 92, 0.25, 0.95, 0.38, dum);
      hiss("lowpass", 3000, 0.7, 0.3, 0.02, dum);
      // Tss: the kick under a crash, six square partials that do not agree, high up.
      const tss = t + 0.43;
      drum(120, 45, 0.3, 1, 0.42, tss);
      hiss("lowpass", 2500, 0.7, 0.4, 0.02, tss);
      const metal = p.amp();
      p.hit(metal.gain, tss, 0.32, 0.002, 1.1);
      const into = p.filter("highpass", 6500, 0.7);
      p.chain(into, p.filter("peaking", 9500, 0.8, 6), metal, kit);
      for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) p.chain(p.osc("square", f * 1.7, tss, tss + 1.2), p.amp(0.25), into);
      hiss("highpass", 8000, 0.7, 0.25, 0.8, tss);
    },
  },

  /** The needle dragged across a record: the music lurches forward and back, then stops dead. */
  scratch: {
    length: 0.85,
    build(p, t) {
      const dur = 0.66;
      // How fast the record turns under the needle, from 0 (stopped) up.
      const rate = through([
        [0, 0.2],
        [0.05, 2.3],
        [0.1, 0.12],
        [0.13, 0.15],
        [0.19, 1.8],
        [0.24, 0.1],
        [0.27, 0.12],
        [0.35, 1.5],
        [0.66, 0],
      ]);
      const loud = (x) => Math.min(1, rate(x) * 0.95) ** 0.8 * Math.min(1, x / 0.006) * Math.min(1, (dur - x) / 0.03);
      const amp = p.amp(0);
      p.curve(amp.gain, t, dur, (u) => loud(u * dur));
      amp.connect(p.out);
      const lp = p.filter("lowpass", 1000, 1.2);
      p.curve(lp.frequency, t, dur, (u) => 500 + 3200 * rate(u * dur));
      lp.connect(amp);
      for (const [f, g] of [
        [131, 0.35],
        [262, 0.25],
        [330, 0.2],
        [392, 0.2],
      ]) {
        const o = p.osc("sawtooth", f, t, t + dur);
        p.curve(o.frequency, t, dur, (u) => Math.max(1, f * rate(u * dur)));
        p.chain(o, p.amp(g), lp);
      }
      const grit = p.filter("bandpass", 1500, 1.5);
      p.curve(grit.frequency, t, dur, (u) => 700 + 3000 * rate(u * dur));
      p.chain(p.noise(t, t + dur), grit, p.amp(0.9), amp);
    },
  },

  /** Nobody laughs: two crickets in the dark, one near and one further off. */
  crickets: {
    length: 2.5,
    // Crickets are the joke of a quiet room: kept quieter than the rest.
    loudness: 0.07,
    build(p, t) {
      const night = p.amp();
      p.gate(night.gain, t, 0.015, 0.3, 1.8, 0.35);
      p.chain(p.noise(t, t + 2.5), p.filter("lowpass", 380), night, p.out);
      for (const c of [
        { f: 4600, pan: -0.45, gain: 0.55, starts: [0.08, 0.52, 0.96, 1.4, 1.84], pulses: 4 },
        { f: 4150, pan: 0.5, gain: 0.3, starts: [0.3, 0.75, 1.19, 1.63, 2.07], pulses: 3 },
      ]) {
        const g = p.amp(0);
        p.chain(g, p.amp(c.gain), p.pan(c.pan), p.out);
        const o = p.osc("sine", c.f, t, t + 2.4);
        const o2 = p.osc("sine", c.f * 2, t, t + 2.4);
        // A fast trill on the pitch: the rasp of a wing.
        wobble(p, o.frequency, 70, t, t + 2.4, 60, 60);
        o.connect(g);
        p.chain(o2, p.amp(0.12), g);
        for (const s of c.starts) {
          for (let k = 0; k < c.pulses; k++) {
            const at = t + s + k * 0.032;
            g.gain.setValueAtTime(0, at);
            g.gain.linearRampToValueAtTime(1, at + 0.004);
            g.gain.linearRampToValueAtTime(0.55, at + 0.013);
            g.gain.linearRampToValueAtTime(0, at + 0.021);
          }
        }
      }
    },
  },

  /** A spring let go: bo-i-i-ing, rising and wobbling as it settles. */
  boing: {
    length: 1.05,
    build(p, t) {
      const dur = 0.95;
      const pitch = (x) => {
        const up = 90 + 170 * Math.min(1, x / 0.12) ** 0.6;
        return up * (1 + 0.28 * Math.exp(-x / 0.35) * Math.sin(2 * Math.PI * (13 - 3 * x) * x));
      };
      const tone = p.filter("lowpass", 800, 9);
      p.curve(tone.frequency, t, dur, (u) => pitch(u * dur) * 3.4);
      const env = p.amp();
      p.hit(env.gain, t, 0.9, 0.004, 0.9);
      p.chain(tone, env, p.out);
      const a = p.osc("triangle", 90, t, t + dur);
      const b = p.osc("square", 45, t, t + dur);
      p.curve(a.frequency, t, dur, (u) => pitch(u * dur));
      p.curve(b.frequency, t, dur, (u) => pitch(u * dur) / 2);
      p.chain(a, p.amp(0.8), tone);
      p.chain(b, p.amp(0.18), tone);
      const pluck = p.amp();
      p.hit(pluck.gain, t, 0.3, 0.001, 0.02);
      p.chain(p.noise(t, t + 0.05), p.filter("highpass", 2000), pluck, p.out);
    },
  },

  /** A bell on a desk: one bright ding, with a slow shimmer as it rings. */
  ding: {
    length: 2,
    loudness: 0.12,
    build(p, t) {
      const bell = p.amp(1);
      bell.connect(p.out);
      bell.connect(roomSend(p, 1, 0.2, 0.7));
      for (const [ratio, peak, decay] of [
        [1, 1, 1.7],
        [1.0016, 0.5, 1.6],
        [0.5, 0.15, 1.2],
        [2.76, 0.45, 0.6],
        [5.4, 0.22, 0.3],
        [8.93, 0.1, 0.15],
      ]) {
        const g = p.amp();
        p.hit(g.gain, t, peak, 0.002, decay);
        p.chain(p.osc("sine", 1568 * ratio, t, t + decay + 0.05), g, bell);
      }
      const tap = p.amp();
      p.hit(tap.gain, t, 0.25, 0.001, 0.012);
      p.chain(p.noise(t, t + 0.03), p.filter("highpass", 4000), tap, bell);
    },
  },

  // ---------------------------------------------------------------- the owner's new candidates

  /** A slide whistle: up, and down again. */
  slide: {
    length: 1.35,
    // A pure whistle is piercing at the same loudness as a noisy sound.
    loudness: 0.1,
    build(p, t) {
      const dur = 1.22;
      const pitch = through([
        [0, 520],
        [0.55, 1900],
        [0.6, 1900],
        [1.22, 480],
      ]);
      const env = p.amp(0);
      p.curve(env.gain, t, dur, (u) => {
        const x = u * dur;
        return Math.min(1, x / 0.03) * Math.min(1, (dur - x) / 0.08) * (Math.abs(x - 0.575) < 0.05 ? 0.75 : 1);
      });
      env.connect(p.out);
      const o = p.osc("sine", 520, t, t + dur);
      const o2 = p.osc("triangle", 520, t, t + dur);
      p.curve(o.frequency, t, dur, (u) => pitch(u * dur) * (1 + 0.008 * Math.sin(2 * Math.PI * 7 * u * dur)));
      p.curve(o2.frequency, t, dur, (u) => pitch(u * dur));
      p.chain(o, p.amp(0.8), env);
      p.chain(o2, p.amp(0.12), env);
      const air = p.filter("bandpass", 1000, 6);
      p.curve(air.frequency, t, dur, (u) => pitch(u * dur));
      p.chain(p.noise(t, t + dur), air, p.amp(0.5), env);
    },
  },

  /** A deep cinematic boom: a hit, a sub that falls away, a low rumble and a long tail. */
  boom: {
    length: 3.2,
    build(p, t) {
      const bus = p.amp(1);
      p.chain(bus, p.shaper(1.8), p.filter("lowpass", 4000), p.out);
      bus.connect(roomSend(p, 2.4, 0.35, 0.2));
      const sub = p.osc("sine", 62, t, t + 3);
      sub.frequency.exponentialRampToValueAtTime(30, t + 2.2);
      const subG = p.amp();
      p.hit(subG.gain, t, 1, 0.005, 2.6);
      p.chain(sub, subG, bus);
      const thump = p.osc("sine", 120, t, t + 0.5);
      thump.frequency.exponentialRampToValueAtTime(50, t + 0.2);
      const thumpG = p.amp();
      p.hit(thumpG.gain, t, 0.6, 0.002, 0.35);
      p.chain(thump, thumpG, bus);
      // A low brass chord under it, and a thud in the low mids: a phone's small speaker cannot
      // play the sub at all, so this is what most people will actually hear.
      for (const f of [55, 82.4, 110, 164.8]) {
        const g = p.amp();
        p.hit(g.gain, t, 0.22, 0.02, 2);
        p.chain(p.osc("sawtooth", f, t, t + 2.2), p.filter("lowpass", 700, 1.2), g, bus);
      }
      const knock = p.osc("triangle", 190, t, t + 0.6);
      knock.frequency.exponentialRampToValueAtTime(85, t + 0.35);
      const knockG = p.amp();
      p.hit(knockG.gain, t, 0.55, 0.003, 0.5);
      p.chain(knock, knockG, bus);
      const crack = p.amp();
      p.hit(crack.gain, t, 0.8, 0.001, 0.06);
      p.chain(p.noise(t, t + 0.1), p.filter("lowpass", 2500), crack, bus);
      const rumble = p.amp();
      p.hit(rumble.gain, t, 0.9, 0.02, 2.8);
      p.chain(p.noise(t, t + 3), p.filter("lowpass", 140, 0.7), rumble, bus);
    },
  },

  /** A crowd going "ooooh": a dozen voices on one vowel, rising together and falling away. */
  ooh: {
    length: 2.4,
    build(p, t) {
      const voices = p.amp(1);
      voices.connect(roomSend(p, 1.2, 0.3, 0.4));
      voices.connect(p.out);
      const f1 = p.filter("bandpass", 450, 5);
      f1.frequency.setValueAtTime(450, t);
      f1.frequency.linearRampToValueAtTime(330, t + 1.8);
      const mouth = p.amp(1);
      mouth.connect(f1);
      p.chain(f1, p.amp(1), voices);
      const rest = formants(p, voices, [
        [850, 6, 0.45],
        [2500, 8, 0.1],
      ]);
      mouth.connect(rest);
      for (let v = 0; v < 14; v++) {
        const f = v % 2 ? p.r(170, 300) : p.r(105, 170);
        const d = t + p.r(0, 0.12);
        const o = p.osc("sawtooth", f * 0.9, d, d + 2.2);
        o.frequency.linearRampToValueAtTime(f * 1.12, d + 0.55);
        o.frequency.linearRampToValueAtTime(f * 0.82, d + 1.75);
        wobble(p, o.frequency, p.r(4.8, 6.2), d, d + 2.2, 0, f * 0.014, d + 0.6);
        const g = p.amp();
        p.gate(g.gain, d, p.r(0.35, 0.7), 0.25, 1.35, 0.5);
        p.chain(o, g, p.pan(p.r(-0.7, 0.7)), mouth);
      }
      const breath = p.amp();
      p.gate(breath.gain, t, 0.12, 0.2, 1.3, 0.5);
      p.chain(p.noise(t, t + 2.2), p.filter("bandpass", 500, 1), breath, voices);
    },
  },

  /** Canned laughter: half a dozen people, each with their own "ha-ha-ha", tumbling over each other. */
  laugh: {
    length: 2.6,
    build(p, t) {
      const crowd = p.amp(1);
      crowd.connect(p.out);
      crowd.connect(roomSend(p, 0.9, 0.25, 0.5));
      for (let who = 0; who < 6; who++) {
        const f = who % 3 === 0 ? p.r(300, 400) : p.r(160, 260);
        const voice = p.amp(p.r(0.5, 1));
        const place = p.pan(p.r(-0.7, 0.7));
        p.chain(place, voice, crowd);
        const mouth = formants(p, place, [
          [p.r(720, 820), 5, 1],
          [p.r(1150, 1300), 6, 0.55],
          [2700, 8, 0.18],
        ]);
        const out = p.amp(0);
        const o = p.osc("sawtooth", f, t, t + 2.5);
        o.connect(out);
        out.connect(mouth);
        const air = p.amp(0);
        p.chain(p.noise(t, t + 2.5), p.filter("bandpass", 1600, 1), air, mouth);
        const n = 7 + Math.floor(p.r(0, 4));
        const every = p.r(0.15, 0.2);
        let at = t + p.r(0, 0.35);
        for (let k = 0; k < n && at < t + 2.3; k++) {
          const fk = f * (1.15 - (0.35 * k) / n) * p.r(0.95, 1.05);
          o.frequency.setValueAtTime(fk * 1.08, at);
          o.frequency.linearRampToValueAtTime(fk * 0.92, at + 0.09);
          out.gain.setValueAtTime(0, at);
          out.gain.linearRampToValueAtTime(1, at + 0.012);
          out.gain.linearRampToValueAtTime(0.7, at + 0.06);
          out.gain.linearRampToValueAtTime(0, at + 0.1);
          air.gain.setValueAtTime(0, Math.max(t, at - 0.025));
          air.gain.linearRampToValueAtTime(0.5, at - 0.005);
          air.gain.linearRampToValueAtTime(0, at + 0.03);
          at += every * p.r(0.9, 1.1);
        }
      }
    },
  },

  /** A kazoo fanfare: da-da-da-daaa, buzzy and proud of itself. */
  kazoo: {
    length: 1.45,
    build(p, t) {
      const voice = p.amp(1);
      p.chain(voice, p.shaper(4), p.filter("highpass", 250), p.filter("peaking", 1100, 2, 8), p.filter("peaking", 2800, 3, 6), p.filter("lowpass", 5500), p.out);
      const notes = [
        [midi(67), 0, 0.12],
        [midi(67), 0.15, 0.12],
        [midi(67), 0.3, 0.12],
        [midi(72), 0.46, 0.7],
      ];
      const o = p.osc("sawtooth", notes[0][0], t, t + 1.3);
      const env = p.amp(0);
      p.chain(o, env, voice);
      notes.forEach(([f, s, len], i) => {
        const s0 = t + s;
        o.frequency.setValueAtTime(f * 0.94, s0);
        o.frequency.linearRampToValueAtTime(f, s0 + 0.03);
        env.gain.setValueAtTime(0, s0);
        env.gain.linearRampToValueAtTime(0.5, s0 + 0.015);
        env.gain.setValueAtTime(0.5, s0 + len);
        env.gain.linearRampToValueAtTime(0, s0 + len + 0.04);
        if (i === notes.length - 1) wobble(p, o.frequency, 6, s0, s0 + len + 0.05, 0, f * 0.025, s0 + 0.3);
      });
      const buzz = p.amp(0);
      p.chain(p.noise(t, t + 1.3), p.filter("bandpass", 3000, 2), buzz, voice);
      env.connect(buzz.gain);
    },
  },

  /** The boxing bell: ding-ding-ding, a big bell struck three times fast. */
  bell: {
    length: 2.9,
    build(p, t) {
      const bell = p.amp(1);
      bell.connect(p.out);
      bell.connect(roomSend(p, 1.2, 0.2, 0.6));
      [0, 0.2, 0.4].forEach((s) => {
        const s0 = t + s;
        for (const [ratio, peak, decay] of [
          [1, 1, 2.2],
          [1.003, 0.5, 2],
          [2.32, 0.6, 1.1],
          [4.25, 0.35, 0.6],
          [6.63, 0.2, 0.35],
          [9.38, 0.12, 0.2],
        ]) {
          const g = p.amp();
          p.hit(g.gain, s0, peak * 0.6, 0.002, decay);
          p.chain(p.osc("sine", 740 * ratio, s0, s0 + decay + 0.05), g, bell);
        }
        const clank = p.amp();
        p.hit(clank.gain, s0, 0.3, 0.001, 0.015);
        p.chain(p.noise(s0, s0 + 0.03), p.filter("highpass", 3000), clank, bell);
      });
    },
  },

  /** A dial-up modem connecting: the number dialled, the answer tone, then the squeal. */
  dialup: {
    length: 2.9,
    build(p, t) {
      const line = p.amp(1);
      p.chain(line, p.filter("bandpass", 1700, 0.5), p.out);
      const tone = (f, at, len, g = 0.4) => {
        const env = p.amp();
        p.gate(env.gain, at, g, 0.004, len, 0.006);
        p.chain(p.osc("sine", f, at, at + len + 0.02), env, line);
        return env;
      };
      [
        [697, 1209],
        [770, 1336],
        [852, 1477],
        [941, 1336],
      ].forEach(([a, b], i) => {
        tone(a, t + i * 0.1, 0.07);
        tone(b, t + i * 0.1, 0.07);
      });
      // The answer tone, beating slowly.
      const answer = tone(2100, t + 0.47, 0.5, 0.35);
      wobble(p, answer.gain, 15, t + 0.47, t + 0.97, 0.12, 0.12);
      tone(980, t + 1.02, 0.15, 0.4);
      tone(1180, t + 1.19, 0.15, 0.4);
      // The squeal: a carrier thrown about, and bursts of hiss.
      const s0 = t + 1.37;
      const dur = 1.35;
      const carrier = p.osc("sine", 1800, s0, s0 + dur);
      const steps = 48;
      const jumps = Array.from({ length: steps }, () => p.r(-700, 700));
      p.curve(carrier.frequency, s0, dur, (u) => 1800 + jumps[Math.min(steps - 1, Math.floor(u * steps))] + 250 * Math.sin(2 * Math.PI * 37 * u * dur));
      const cEnv = p.amp();
      p.gate(cEnv.gain, s0, 0.35, 0.01, dur - 0.05, 0.04);
      p.chain(carrier, cEnv, line);
      const second = p.osc("square", 2400, s0 + 0.3, s0 + dur);
      wobble(p, second.frequency, 23, s0 + 0.3, s0 + dur, 300, 300);
      const sEnv = p.amp();
      p.gate(sEnv.gain, s0 + 0.3, 0.08, 0.01, dur - 0.35, 0.04);
      p.chain(second, sEnv, line);
      const hiss = p.amp(0);
      p.curve(hiss.gain, s0, dur, (u) => (Math.sin(2 * Math.PI * 4.5 * u * dur) > 0.2 ? 0.45 : 0.1) * Math.min(1, u * 20) * Math.min(1, (1 - u) * 20));
      p.chain(p.noise(s0, s0 + dur), p.filter("bandpass", 2000, 0.8), hiss, line);
    },
  },

  /** Womp womp: two low, muted notes, the second sagging. */
  womp: {
    length: 1.6,
    build(p, t) {
      const bus = p.amp(1);
      p.chain(bus, p.shaper(1.5), p.out);
      [
        [midi(50), 0, 0.32, false],
        [midi(49), 0.42, 0.88, true],
      ].forEach(([f, s, len, last]) => {
        const s0 = t + s;
        const lp = p.filter("lowpass", 180, 6);
        lp.frequency.setValueAtTime(180, s0);
        lp.frequency.linearRampToValueAtTime(1000, s0 + 0.1);
        lp.frequency.linearRampToValueAtTime(220, s0 + len);
        const env = p.amp();
        p.gate(env.gain, s0, 0.55, 0.02, len, 0.1);
        p.chain(lp, env, bus);
        for (const [ratio, type, g] of [
          [1, "sawtooth", 0.5],
          [1.006, "sawtooth", 0.4],
          [0.5, "square", 0.25],
        ]) {
          const o = p.osc(type, f * ratio, s0, s0 + len + 0.15);
          if (last) {
            o.frequency.setValueAtTime(f * ratio, s0 + len * 0.45);
            o.frequency.linearRampToValueAtTime(f * ratio * 0.94, s0 + len);
          }
          p.chain(o, p.amp(g), lp);
        }
      });
    },
  },

  /** A cartoon fart, as campy as asked: a sputtering low buzz, a wobble, and a little squeak at the end. */
  fart: {
    length: 1.15,
    build(p, t) {
      const dur = 0.86;
      const jitter = Array.from({ length: 40 }, () => p.r(-1, 1));
      const pitch = (x) => {
        const shape = through([
          [0, 92],
          [0.3, 112],
          [0.62, 96],
          [0.86, 66],
        ])(x);
        return shape * (1 + 0.08 * Math.sin(2 * Math.PI * 3 * x) + 0.06 * jitter[Math.min(39, Math.floor((x / dur) * 40))]);
      };
      const tone = p.filter("lowpass", 700, 2);
      const body = p.amp(0.6);
      p.chain(tone, p.filter("peaking", 220, 1.5, 6), body, p.out);
      // The flutter: the sound coming in puffs, faster and deeper toward the end.
      const flutter = p.osc("sine", 30, t, t + dur);
      flutter.frequency.linearRampToValueAtTime(38, t + dur);
      const depth = p.amp(0.15);
      depth.gain.linearRampToValueAtTime(0.5, t + dur);
      flutter.connect(depth).connect(body.gain);
      const o = p.osc("square", 92, t, t + dur);
      p.curve(o.frequency, t, dur, (u) => pitch(u * dur));
      const env = p.amp();
      p.gate(env.gain, t, 0.9, 0.01, dur - 0.07, 0.06);
      p.chain(o, env, tone);
      const air = p.amp();
      p.gate(air.gain, t, 0.25, 0.01, dur - 0.07, 0.06);
      p.chain(p.noise(t, t + dur), p.filter("lowpass", 900), air, tone);
      // ...and the squeak.
      const pip = p.osc("triangle", 260, t + dur + 0.03, t + dur + 0.16);
      pip.frequency.linearRampToValueAtTime(420, t + dur + 0.14);
      const pipG = p.amp();
      p.gate(pipG.gain, t + dur + 0.03, 0.35, 0.01, 0.09, 0.03);
      p.chain(pip, pipG, p.out);
    },
  },

  /** The world's smallest violin: a thin, sad little phrase, high up, with a slow vibrato. */
  violin: {
    length: 2.7,
    build(p, t) {
      const body = p.amp(1);
      p.chain(body, p.filter("highpass", 350), p.filter("peaking", 900, 2, 6), p.filter("peaking", 2800, 1.5, 5), p.filter("peaking", 1500, 2, -3), p.filter("lowpass", 7000), p.out);
      body.connect(roomSend(p, 1.2, 0.25, 0.6));
      const notes = [
        [midi(81), 0, 0.42],
        [midi(79), 0.44, 0.42],
        [midi(77), 0.88, 0.42],
        [midi(76), 1.32, 1.05],
      ];
      const o = p.osc("sawtooth", notes[0][0], t, t + 2.6);
      const bow = p.amp(0);
      p.chain(o, bow, body);
      notes.forEach(([f, s, len], i) => {
        const s0 = t + s;
        // A finger slides to the next note rather than jumping.
        if (i === 0) o.frequency.setValueAtTime(f, s0);
        else o.frequency.linearRampToValueAtTime(f, s0 + 0.06);
        o.frequency.setValueAtTime(f, s0 + len - 0.01);
        bow.gain.setValueAtTime(i === 0 ? 0 : 0.3, s0);
        bow.gain.linearRampToValueAtTime(0.5, s0 + 0.12);
        bow.gain.setValueAtTime(0.5, s0 + len - 0.08);
        bow.gain.linearRampToValueAtTime(i === notes.length - 1 ? 0 : 0.32, s0 + len + (i === notes.length - 1 ? 0.25 : 0));
      });
      wobble(p, o.frequency, 5.8, t, t + 2.6, 0, 9, t + 0.4);
      const scrape = p.amp(0);
      p.chain(p.noise(t, t + 2.6), p.filter("bandpass", 3000, 0.7), scrape, body);
      bow.connect(scrape.gain);
      scrape.gain.value = 0;
    },
  },
};
