// The ladder a rendered room comes down on a device that cannot keep up.
//
// The 3D look has one way to help a slow device: draw fewer pixels (Room3D.govern). A rendered
// room has that same step first, by the same rule, and then steps of its own that each make it
// a little cheaper while changing what a still frame at phone size shows as little as possible
// (the Star Lounge's are in star-lounge/room.js). After its last step, if frames are still slow,
// it gives up and the room is drawn as the 3D look draws it.
//
//   sharpness    the pixel ratio, down by a fifth at a time to 0.75. A step that did not make
//                frames faster is undone and no more are tried: the device is held back by
//                something else (a battery saver at 30 a second, say). Room3D.govern's rule.
//   steps        the room's own, in its order. Each is kept once taken.
//   fall back    still slow after the last step: the 3D look's own drawing of the room.
//
// One more rule keeps a capped device (one that never goes over 30 a second) from losing the
// rendered look for nothing: if the room's own steps together did not make frames faster, they
// are all undone and the ladder stops, as the governor stops.
//
// It is plain arithmetic on frame times, so it is tested with made-up ones (lobby/test/rendered.test.js).

/** The fewest drawn pixels per CSS pixel the sharpness step goes to: the 3D look's governor's floor. */
export const SHARP_MIN = 0.75;
/** Slower than this (ms a frame, on average over a window) is slow: the 3D look's governor's number. */
export const SLOW_MS = 24;
/** A step helped if frames after it are at most this share of what they were before. */
export const HELPS = 0.88;

export class Ladder {
  /**
   * @param {object} o
   * @param {number} o.ratio         the pixel ratio the room starts at
   * @param {string[]} o.steps       the room's own steps, cheapest last
   * @param {string[]} [o.taken]     steps already taken (remembered on the device, or forced)
   * @param {number} [o.settleMs]    how long after the start nothing is judged (fonts, first frames)
   * @param {number} [o.windowMs]    how long each judgement averages over
   */
  constructor({ ratio, steps, taken = [], slowMs = SLOW_MS, settleMs = 3000, windowMs = 1500, helps = HELPS }) {
    this.ratio = ratio;
    this.steps = steps;
    this.taken = new Set(taken);
    this.slowMs = slowMs;
    this.settleMs = settleMs;
    this.windowMs = windowMs;
    this.helps = helps;
    this.start = null;
    this.windowAt = null;
    this.sum = 0;
    this.count = 0;
    this.trial = null;
    this.sharpDone = ratio <= SHARP_MIN + 1e-6;
    /** Steps taken by this ladder (not the remembered ones), and the frame time before the first of them. */
    this.mine = [];
    this.before = null;
    this.helped = false;
    /** "", "fell back" or "capped": why it stopped. */
    this.done = "";
    this.last = null;
  }

  /**
   * One frame, `dtMs` after the last one, at time `now` (ms). Returns what to do now, or null:
   *   {ratio}          draw at this pixel ratio
   *   {take: name}     take this step of the room's own
   *   {undo: names}    undo these steps (a capped device: they did not help)
   *   {fallback: true} draw the room as the 3D look does
   */
  frame(now, dtMs) {
    if (this.done || !(dtMs > 0) || dtMs > 250) return null;
    if (this.start === null) this.start = now;
    if (now - this.start < this.settleMs) return null;
    if (this.windowAt === null) this.windowAt = now;
    this.sum += dtMs;
    this.count++;
    if (now - this.windowAt < this.windowMs || this.count < 10) return null;
    const avg = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    this.windowAt = now;
    this.last = avg;
    return this.decide(avg);
  }

  decide(avg) {
    const trial = this.trial;
    this.trial = null;
    if (trial?.kind === "sharp" && !(avg < trial.before * this.helps)) {
      // Fewer pixels did not help: put them back and try no more.
      this.ratio = trial.ratio;
      this.sharpDone = true;
      return { ratio: this.ratio };
    }
    if (avg <= this.slowMs) return null;
    if (!this.sharpDone) {
      const ratio = Math.max(SHARP_MIN, this.ratio * 0.8);
      this.trial = { kind: "sharp", before: avg, ratio: this.ratio };
      this.ratio = ratio;
      if (ratio <= SHARP_MIN + 1e-6) this.sharpDone = true;
      return { ratio };
    }
    const next = this.steps.find((s) => !this.taken.has(s));
    if (next) {
      this.taken.add(next);
      if (!this.mine.length) this.before = avg;
      this.mine.push(next);
      return { take: next };
    }
    if (this.mine.length && !(avg < this.before * this.helps)) {
      // The room's own steps together changed nothing: the device is held back by something else.
      this.done = "capped";
      const undo = this.mine;
      for (const s of undo) this.taken.delete(s);
      this.mine = [];
      return { undo };
    }
    this.done = "fell back";
    return { fallback: true };
  }
}
