// Every sound is made here, in code. Nothing plays until the player enables sound.
export class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  /** Must be called from a click. */
  enable() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.out = this.ctx.createDynamicsCompressor();
      this.out.threshold.value = -14;
      this.out.ratio.value = 5;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.out.connect(this.master).connect(this.ctx.destination);
      // A short wooden room: a few fast echoes off the back board and the canvas.
      this.room = this.ctx.createGain();
      this.room.gain.value = 0.22;
      for (const [time, gain] of [[0.021, 0.5], [0.037, 0.32], [0.058, 0.2], [0.083, 0.1]]) {
        const d = this.ctx.createDelay(0.2);
        d.delayTime.value = time;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 2600;
        this.room.connect(d).connect(f).connect(g).connect(this.out);
      }
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, len);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    this.ctx.resume();
    this.on = true;
    return true;
  }

  disable() {
    this.on = false;
    this.ctx?.suspend();
  }

  get ready() {
    return this.on && this.ctx && this.ctx.state === "running";
  }

  env(gain, attack, decay, when, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * peak), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    g.connect(this.out);
    g.connect(this.room);
    return g;
  }

  tone(freq, gain, decay, { type = "sine", when = 0, attack = 0.002, slide = 0, pan = 0 } = {}) {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + decay);
    let node = o;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      o.connect(p);
      node = p;
    }
    node.connect(this.env(gain, attack, decay, t));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  burst(gain, decay, { when = 0, type = "bandpass", freq = 1200, q = 1, attack = 0.001 } = {}) {
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    s.connect(f).connect(this.env(gain, attack, decay, t));
    s.start(t, Math.random() * 0.5);
    s.stop(t + attack + decay + 0.05);
  }

  /** Struck metal: a handful of partials that do not line up, each dying at its own rate. */
  metal(base, ratios, gain, decay, pan = 0, when = 0) {
    ratios.forEach((r, i) => this.tone(base * r, (gain / (1 + i * 0.6)) * (0.8 + Math.random() * 0.4), decay / (1 + i * 0.35), { when, pan, type: i === 0 ? "sine" : "triangle" }));
  }

  // ------------------------------------------------------------ the gun

  shot() {
    if (!this.ready) return;
    // The spring lets go: a thump in the stock, the pop of the cork leaving, the spring singing after.
    this.tone(150, 0.9, 0.11, { slide: 0.3 });
    this.burst(0.7, 0.045, { freq: 900, q: 0.8 });
    this.burst(0.3, 0.02, { freq: 3800, q: 1.2 });
    this.tone(410, 0.12, 0.22, { type: "triangle", slide: 0.82, when: 0.012 });
    this.tone(633, 0.05, 0.16, { type: "triangle", slide: 0.86, when: 0.012 });
    // The lever: down, and home with a click.
    this.burst(0.16, 0.018, { when: 0.19, freq: 2600, q: 3 });
    this.tone(1900, 0.04, 0.03, { when: 0.19, type: "square" });
    this.burst(0.22, 0.02, { when: 0.4, freq: 3200, q: 3 });
    this.tone(1250, 0.06, 0.04, { when: 0.4, type: "square" });
    this.tone(95, 0.2, 0.05, { when: 0.4 });
  }

  empty() {
    if (!this.ready) return;
    this.burst(0.2, 0.02, { freq: 3000, q: 3 });
  }

  // ------------------------------------------------------------ what the cork hits

  hit(e) {
    if (!this.ready) return;
    const pan = (e.x ?? 0) * 0.5;
    const rise = 1 + Math.min(e.streak ?? 0, 10) * 0.035; // a run of hits climbs in pitch
    if (e.ricochet) this.ricochet(pan);
    if (e.target === "bell") return this.bell(e.rung);
    if (e.target === "jam") {
      this.burst(0.5, 0.06, { freq: 700 });
      this.metal(520, [1, 2.3, 3.9], 0.3, 0.3, pan);
      return;
    }
    if (e.row === 0) {
      // A tin plate knocked flat: clack, then it rattles on the bar.
      this.burst(0.6, 0.03, { freq: 1900, q: 0.9 });
      this.metal(330 * rise, [1, 2.76, 5.4, 8.9], 0.5, 0.2, pan);
      this.tone(120, 0.5, 0.07, { pan });
      this.burst(0.25, 0.025, { when: 0.13, freq: 1500 });
      this.metal(300 * rise, [1, 2.76], 0.14, 0.09, pan, 0.13);
    } else if (e.row === 1) {
      // A thinner star: a bright ting.
      this.burst(0.4, 0.02, { freq: 3200, q: 1 });
      this.metal(980 * rise, [1, 2.4, 4.1, 6.3], 0.42, 0.34, pan);
    } else if (e.target === "sh") {
      this.metal(1560, [1, 1.5, 2.01, 3.0], 0.5, 0.7, pan);
      this.metal(1560 * 1.26, [1, 2.0], 0.3, 0.6, pan, 0.07);
    } else {
      // A heavy enamel disc on a rod: a dull gong and a rattle of the pivot.
      this.burst(0.45, 0.03, { freq: 1200, q: 0.8 });
      this.metal(440 * rise, [1, 1.72, 2.9, 4.6], 0.5, 0.5, pan);
    }
    if (e.perfect) this.tone(2093, 0.12, 0.3, { when: 0.03, type: "sine" });

  }

  bell(rung) {
    const f = rung ? 620 : 780;
    const ratios = [0.5, 1, 1.19, 1.5, 2.0, 2.51, 3.01, 4.1];
    ratios.forEach((r, i) => this.tone(f * r, (rung ? 0.5 : 0.32) / (1 + i * 0.45), (rung ? 2.4 : 1.1) / (1 + i * 0.3), { type: "sine" }));
    this.burst(0.5, 0.012, { freq: 4200, q: 0.7 });
    if (rung) {
      // Rung for the jackpot: it is struck three times.
      for (const when of [0.16, 0.32]) ratios.slice(0, 5).forEach((r, i) => this.tone(f * r, 0.36 / (1 + i * 0.5), 1.6 / (1 + i * 0.3), { when }));
    }
  }

  bounce(e) {
    if (!this.ready) return;
    const v = Math.min(1, (e.s ?? 2) / 8);
    if (v < 0.08) return;
    const pan = (e.x ?? 0) * 0.5;
    if (e.what === "board" || e.what === "wall") {
      this.tone(170, 0.5 * v, 0.06, { slide: 0.6, pan });
      this.burst(0.35 * v, 0.03, { freq: 700, q: 0.7 });
    } else {
      this.tone(260, 0.3 * v, 0.035, { slide: 0.7, pan });
      this.burst(0.25 * v, 0.02, { freq: 1500, q: 0.8 });
    }
  }

  /** A challenge done: a short rising flourish on the stall's little bells. */
  task() {
    if (!this.ready) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.metal(f, [1, 2.76], 0.22, 0.5 + i * 0.12, 0, 0.1 + i * 0.085));
    this.burst(0.12, 0.25, { when: 0.42, freq: 5200, q: 0.8 });
  }

  /** A ricochet that scored: the whine of a cork coming off at an angle, then two bright notes going up. */
  ricochet(pan = 0) {
    if (!this.ready) return;
    this.tone(2600, 0.2, 0.2, { slide: 0.32, pan, type: "triangle" });
    this.tone(2600 * 1.5, 0.07, 0.2, { slide: 0.32, pan });
    this.metal(1568, [1, 2.76], 0.26, 0.5, pan, 0.16);
    this.metal(2349, [1, 2.76], 0.3, 0.8, pan, 0.27);
  }

  /** A cork off something that is not a target: each thing in the stall has its own voice. */
  prop(e) {
    if (!this.ready) return;
    const pan = (e.x ?? 0) * 0.5;
    if (e.what === "lamp") {
      // Thin glass: a bright tinkle, a few shards after it, and the filament going.
      this.burst(0.3, 0.04, { freq: 6500, q: 1.2, type: "highpass" });
      [3136, 4186, 5274, 3729].forEach((f, i) => this.tone(f * (0.97 + Math.random() * 0.06), 0.14, 0.16 + i * 0.05, { when: i * 0.035, pan }));
      this.tone(90, 0.12, 0.25, { type: "sawtooth", slide: 0.5, when: 0.02 });
    } else if (e.what === "vase") {
      // Turned wood and paint: a hollow knock. Off the shelf: a clatter on the boards below.
      this.tone(e.broke ? 310 : 420, 0.45, 0.09, { slide: 0.8, pan, type: "triangle" });
      this.burst(0.3, 0.03, { freq: 1800, q: 0.9 });
      if (e.broke) {
        for (let i = 0; i < 4; i++) this.tone(240 + Math.random() * 260, 0.3 / (1 + i * 0.4), 0.06, { when: 0.24 + i * 0.07 + Math.random() * 0.02, pan, type: "triangle", slide: 0.85 });
        this.burst(0.35, 0.12, { when: 0.24, freq: 2600, q: 0.6 });
      }
    } else if (e.what === "chalk") {
      // Slate on a wall: a flat slap and a soft puff.
      this.tone(210, 0.4, 0.05, { slide: 0.7, pan });
      this.burst(0.22, 0.22, { freq: 900, q: 0.4, attack: 0.02 });
    } else if (e.what === "wheel") {
      // Cast iron, turning: it rings, and the belt slaps once.
      this.metal(e.i === 0 ? 392 : 587, [1, 2.4, 3.9, 5.3], 0.3, 0.9, pan);
      this.burst(0.25, 0.05, { when: 0.05, freq: 600, q: 0.8 });
    }
  }

  /** The bell rung in the last second of the round: three quick peals, the landlord calling time. */
  lastOrders() {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) [1568, 1568 * 2.4, 1568 * 3.6].forEach((f, k) => this.tone(f, 0.3 / (1 + k * 0.6), 0.7, { when: 0.12 + i * 0.2 }));
  }

  rest() {
    if (!this.ready) return;
    this.burst(0.05, 0.015, { freq: 2200, q: 1 });
  }

  // ------------------------------------------------------------ the machine

  /** The cam bar comes up: a clunk and five plates standing against it. */
  camLift(any) {
    if (!this.ready) return;
    this.tone(88, 0.5, 0.12, { slide: 0.7 });
    this.burst(0.3, 0.05, { freq: 500, q: 0.6 });
    if (any) for (let i = 0; i < 4; i++) this.metal(300 + i * 40, [1, 2.76], 0.1, 0.08, (i - 2) * 0.3, 0.1 + i * 0.03);
  }

  reelTick() {
    if (!this.ready) return;
    this.burst(0.05, 0.008, { freq: 4200, q: 4 });
  }

  /** One turn of the flywheel: the belt joint slaps over the pulley. */
  flywheel(speed) {
    if (!this.ready) return;
    this.burst(0.035, 0.03, { freq: 380 * speed, q: 1.2 });
    this.tone(62, 0.05, 0.06);
  }

  openingBell(count = 2) {
    if (!this.ready) return;
    for (let i = 0; i < count; i++) this.metal(1318, [1, 2.0, 2.76, 4.07], 0.35, 0.9, 0, i * 0.2);
  }

  countTick(last) {
    if (!this.ready) return;
    this.tone(last ? 990 : 660, 0.25, 0.12, { type: "triangle" });
  }

  // ------------------------------------------------------------ attacks

  warning(type) {
    if (!this.ready) return;
    if (type === "dark") {
      // The lamps buzz before they go.
      this.tone(100, 0.2, 1.2, { type: "sawtooth" });
      this.burst(0.12, 1.2, { freq: 3000, q: 6, attack: 0.3 });
    } else if (type === "moths") {
      this.burst(0.2, 1.3, { freq: 5200, q: 2, attack: 0.9 });
    } else {
      this.tone(520, 0.2, 0.5, { slide: 2.2, type: "sine" }); // a cork whistling in
    }
  }

  landed(type) {
    if (!this.ready) return;
    if (type === "dark") {
      this.tone(70, 0.6, 0.25, { slide: 0.5 });
      this.burst(0.3, 0.05, { freq: 2500, q: 0.8 });
    } else if (type === "moths") {
      for (let i = 0; i < 14; i++) this.burst(0.06, 0.03, { when: i * 0.25 + Math.random() * 0.1, freq: 4200 + Math.random() * 2400, q: 3 });
    } else {
      this.tone(140, 0.7, 0.1, { slide: 0.5 });
      this.burst(0.5, 0.05, { freq: 800 });
      this.metal(210, [1, 2.76, 5.4], 0.3, 0.3);
    }
  }

  /** The brass chime of a block: two bright notes, a fourth apart. */
  block() {
    if (!this.ready) return;
    this.metal(1568, [1, 2.0, 3.0, 4.2], 0.45, 1.1);
    this.metal(2093, [1, 2.0, 3.0], 0.4, 1.3, 0, 0.11);
  }

  sent() {
    if (!this.ready) return;
    this.tone(880, 0.12, 0.12, { slide: 1.6, type: "triangle" });
  }

  cleared() {
    if (!this.ready) return;
    this.metal(660, [1, 1.5, 2.0], 0.25, 0.3);
  }

  end(won) {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) this.metal(1046, [1, 2.0, 2.76, 4.07], 0.4, 1.2, 0, i * 0.24);
    if (won) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 0.5, { when: 0.9 + i * 0.12, type: "triangle" }));
  }
}

let touched = false;
addEventListener("pointerdown", () => (touched = true), { once: true });

/** Haptics, where the browser allows them (it asks for a tap first). */
export function buzz(pattern) {
  if (!touched) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are a nicety.
  }
}
