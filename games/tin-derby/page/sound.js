// Tin Derby: every sound is made here in code. Nothing plays until the player taps "Sound on".
class Sound {
  constructor() { this.on = false; this.ctx = null; }
  enable() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        const c = (this.ctx = new AC());
        this.out = c.createGain(); this.out.gain.value = 0.55; this.out.connect(c.destination);
        const len = c.sampleRate * 0.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        // The clockwork whirr of your own car: two buzzy tones through a filter, pitched by speed.
        this.wg = c.createGain(); this.wg.gain.value = 0;
        this.wf = c.createBiquadFilter(); this.wf.type = "bandpass"; this.wf.frequency.value = 700; this.wf.Q.value = 1.2;
        this.w1 = c.createOscillator(); this.w1.type = "sawtooth"; this.w2 = c.createOscillator(); this.w2.type = "square";
        this.w1.connect(this.wf); this.w2.connect(this.wf); this.wf.connect(this.wg); this.wg.connect(this.out);
        this.w1.start(); this.w2.start();
        // The drift: tin wheels scrubbing the cloth, a filtered hiss that rises with the charge.
        this.dg = c.createGain(); this.dg.gain.value = 0;
        this.df = c.createBiquadFilter(); this.df.type = "bandpass"; this.df.frequency.value = 1800; this.df.Q.value = 3;
        this.ds = c.createBufferSource(); this.ds.buffer = buf; this.ds.loop = true;
        this.ds.connect(this.df); this.df.connect(this.dg); this.dg.connect(this.out); this.ds.start();
      }
      this.ctx.resume();
      this.on = true;
      return true;
    } catch (e) { return false; }
  }
  disable() { this.on = false; try { if (this.ctx) this.ctx.suspend(); } catch (e) { /* nothing to stop */ } }
  pause(hidden) { try { if (this.ctx && this.on) hidden ? this.ctx.suspend() : this.ctx.resume(); } catch (e) { /* ignore */ } }
  blip(f, dur, type = "square", vol = 0.2, to = 0, delay = 0) {
    if (!this.on) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, f, q = 2, vol = 0.3, to = 0, delay = 0) {
    if (!this.on) return;
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), b = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true; b.type = "bandpass"; b.frequency.setValueAtTime(f, t); if (to) b.frequency.exponentialRampToValueAtTime(to, t + dur); b.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(b); b.connect(g); g.connect(this.out); s.start(t); s.stop(t + dur + 0.02);
  }
  beep(f) { this.blip(f, 0.14, "triangle", 0.25); }
  ding() { this.blip(1320, 1.0, "sine", 0.25); this.blip(1976, 0.7, "sine", 0.12); this.blip(2640, 0.4, "sine", 0.06); }
  /** A pad: a quick ratchet as the key winds, then the spring sings up. */
  pad() { for (let i = 0; i < 4; i++) this.noise(0.025, 2600 + i * 300, 4, 0.4, 0, i * 0.035); this.blip(420, 0.35, "sawtooth", 0.14, 1400, 0.12); this.noise(0.4, 600, 0.8, 0.22, 2600, 0.12); }
  /** A drift boost: a small one is a plain wind-up, a big one adds a bell. */
  mini(lvl) { this.blip(380, 0.28, "sawtooth", 0.12, lvl === 2 ? 1300 : 900); this.noise(0.3, 700, 0.8, 0.18, 2200); if (lvl === 2) this.blip(1568, 0.4, "sine", 0.18, 0, 0.1); }
  /** The drift charge reaching a level: a click, higher for the second. */
  charge(lvl) { this.noise(0.03, lvl === 2 ? 3400 : 2600, 5, 0.45); this.blip(lvl === 2 ? 1175 : 880, 0.08, "square", 0.12); }
  /** A bump or a wall: a light tin knock. */
  knock(size = 1) { this.blip(640 * (0.95 + Math.random() * 0.1), 0.08, "square", 0.08 * size); this.noise(0.05, 1500, 1.5, 0.22 * size); }
  thud() { this.blip(130, 0.16, "sine", 0.4, 50); this.noise(0.06, 500, 1, 0.2); }
  /** Off the table: a falling whistle. */
  fall() { this.blip(1400, 0.9, "sine", 0.18, 220); }
  /** A sweet taken: a crinkle of wrapper and a bright note. */
  pick() { for (let i = 0; i < 5; i++) this.noise(0.03, 3000 + i * 500, 6, 0.25, 0, i * 0.03); this.blip(1047, 0.18, "triangle", 0.2, 0, 0.1); }
  /** A power used: each its own small sound. */
  use(item) {
    if (item === "overwind") { for (let i = 0; i < 6; i++) this.noise(0.02, 2400 + i * 200, 5, 0.35, 0, i * 0.03); this.blip(300, 0.6, "sawtooth", 0.14, 1600, 0.15); }
    else if (item === "butter") this.blip(220, 0.18, "sine", 0.3, 120);
    else if (item === "pepper") { this.blip(160, 0.1, "square", 0.25, 90); this.noise(0.35, 1600, 0.8, 0.3, 500, 0.04); }
  }
  /** Pepper in your face: a little sneeze. */
  sneeze() { this.noise(0.12, 1800, 1.2, 0.3, 900); this.noise(0.22, 900, 0.9, 0.35, 300, 0.16); }
  /** Butter: a slither. */
  slip() { this.noise(0.4, 700, 1.5, 0.25, 2400); }
  /** The kettle's lid rattling. */
  rattle() { for (let i = 0; i < 8; i++) this.noise(0.03, 2200, 4, 0.18, 0, i * 0.11); }
  /** The toaster's lever going down: a clunk and a tick. */
  tick() { this.blip(180, 0.08, "square", 0.15); this.noise(0.03, 3200, 6, 0.2, 0, 0.12); }
  /** The kettle coming to the boil: the lid rattles under a rising whistle. */
  whistle() { this.rattle(); this.blip(1400, 1.2, "sine", 0.12, 2300, 0.15); }
  /** The egg rocking in its cup: a low wooden rumble. */
  rumble() { for (let i = 0; i < 5; i++) this.blip(95 + i * 6, 0.12, "triangle", 0.22, 70, i * 0.16); }
  /** The syrup bottle tipping: a slow glug and a drip. */
  drip() { this.blip(300, 0.25, "sine", 0.2, 140); this.blip(900, 0.12, "sine", 0.15, 500, 0.5); }
  /** Driving into syrup: a sticky squelch. */
  squelch() { this.noise(0.25, 400, 2, 0.3, 180); }
  /** Your shot or your butter got someone. */
  got() { this.blip(880, 0.1, "square", 0.12); this.blip(1320, 0.18, "square", 0.12, 0, 0.09); }
  /** The ghost fading through: a soft whoosh. */
  whoosh() { this.noise(0.35, 500, 0.8, 0.25, 1800); }
  /** Once a frame: the whirr follows your speed, the hiss follows your drift (0 none, 1 to 3 its charge). */
  run(speed, running, drift) {
    if (!this.on || !this.wg) return;
    const t = this.ctx.currentTime, f = 55 + speed * 34;
    this.w1.frequency.setTargetAtTime(f, t, 0.05); this.w2.frequency.setTargetAtTime(f * 2.02, t, 0.05); this.wf.frequency.setTargetAtTime(500 + speed * 260, t, 0.05);
    this.wg.gain.setTargetAtTime(running ? 0.035 + Math.min(0.05, speed * 0.006) : 0, t, 0.06);
    this.dg.gain.setTargetAtTime(running && drift ? 0.05 + 0.03 * drift : 0, t, 0.05);
    this.df.frequency.setTargetAtTime(1500 + 600 * drift, t, 0.08);
  }
}

export { Sound };
