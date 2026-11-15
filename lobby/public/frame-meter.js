// The frame meter: one small line at the top left that says how fast the room is drawn on this
// device, for reading a phone's speed off its own screen. Switched on from the address with
// ?meter=1 and remembered on the device (the room's own address carries no query); ?meter=0
// switches it off and forgets it. Off, it is never made, so it costs nothing.
//
//   3d star-lounge · frame 16.7 ms (60 a second) · worst 33 ms · drawing 4.2 ms (20 a second) · 2x
//
// "frame" is the time between the page's own animation frames: what the player sees. It is
// not the 3D look's own count, because the 3D look skips drawing while the room is still, and a
// still room would read falsely fast. "drawing" is how long the 3D look's draw call took, per
// frame it actually drew, and how many it drew a second. The last is the sharpness (the pixel
// ratio the 3D look draws at, after its governor: Room3D.govern). The flat drawing has neither.
// It only reads: it never changes what the slow-room check or the governor decide.
import { h } from "./dom.js";

const METER_KEY = "party-room:meter";
/** What the numbers are taken over. */
export const WINDOW_MS = 3000;
/** How often the line is written. */
export const SHOW_MS = 500;
/** A gap this long is not a slow frame but a page that drew nothing (hidden, or a room being swapped). */
export const GAP_MS = 1000;

function store() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether this device asked for the meter: ?meter=1 remembers it, ?meter=0 forgets it. */
export function meterWanted(params, storage = store()) {
  try {
    if (params.get("meter") === "1") storage?.setItem(METER_KEY, "on");
    else if (params.get("meter") === "0") storage?.removeItem(METER_KEY);
    return storage?.getItem(METER_KEY) === "on" || params.get("meter") === "1";
  } catch {
    // Private browsing: the switch lasts as long as the address has it.
    return params.get("meter") === "1";
  }
}

/** Samples of a few seconds: each one a time and a value, the old ones let go. */
export class Window {
  constructor(ms = WINDOW_MS) {
    this.ms = ms;
    this.at = [];
    this.values = [];
  }

  add(t, value) {
    this.at.push(t);
    this.values.push(value);
    this.trim(t);
  }

  /** Lets go of every sample older than the window, as of `now`. */
  trim(now) {
    let n = 0;
    while (n < this.at.length && this.at[n] <= now - this.ms) n++;
    if (n) {
      this.at.splice(0, n);
      this.values.splice(0, n);
    }
  }

  clear() {
    this.at.length = 0;
    this.values.length = 0;
  }

  get count() {
    return this.values.length;
  }

  get average() {
    return this.count ? this.values.reduce((a, b) => a + b, 0) / this.count : 0;
  }

  get worst() {
    return this.count ? Math.max(...this.values) : 0;
  }
}

/** A number of milliseconds, short: one decimal under a hundred. */
const ms = (n) => (n < 100 ? n.toFixed(1) : n.toFixed(0));
/** A pixel ratio, short: 2x, 1.6x, 0.75x. */
const ratio = (n) => `${Number(n.toFixed(2))}x`;

/**
 * The line itself, from what was measured. `look`: "3d", "baked" or "flat"; `room`: the skin's
 * id, where the look draws one. `frames`, `drawing`: Windows of frame times and of drawing
 * times, by frame drawn; `sharpness`: the pixel ratio, or null where it does not apply.
 */
export function meterLine({ look, room, frames, drawing, sharpness, now }) {
  frames.trim(now);
  drawing?.trim(now);
  const parts = [room ? `${look} ${room}` : look];
  const perSecond = frames.count ? 1000 / frames.average : 0;
  if (frames.count) parts.push(`frame ${ms(frames.average)} ms (${Math.round(perSecond)} a second)`, `worst ${frames.worst.toFixed(0)} ms`);
  else parts.push("frame -");
  // Pictures drawn a second: the share of the same frames that drew one, so it is right from the first second.
  if (drawing) parts.push(drawing.count && frames.count ? `drawing ${ms(drawing.average)} ms (${Math.round((perSecond * Math.min(drawing.count, frames.count)) / frames.count)} a second)` : "drawing -");
  if (sharpness) parts.push(ratio(sharpness));
  return parts.join(" · ");
}

export class FrameMeter {
  /** @param {HTMLElement} root  where the line goes (the room page's #app) */
  constructor(root) {
    this.root = root;
    this.el = null;
    this.frames = new Window();
    this.drawing = new Window();
    this.scene = null;
  }

  /** A room view went up (the same moments as SlowWatch.start): measure it afresh. */
  start(scene) {
    this.scene = scene;
    this.frames.clear();
    this.drawing.clear();
    this.last = null;
    this.drawn = scene.drawing ?? null;
    this.shown = -Infinity;
    // Last in the page, so it sits over the room and its words; it takes no taps.
    this.el ??= h("div", "frame-meter", "");
    this.el.setAttribute("aria-hidden", "true");
    this.root.append(this.el);
  }

  stop() {
    this.scene = null;
    this.el?.remove();
    this.el = null;
  }

  /** Every animation frame the room is drawn in, with the frame's own time (requestAnimationFrame's). */
  frame(t) {
    if (!this.scene) return;
    if (this.last !== null && t - this.last > 0 && t - this.last < GAP_MS) this.frames.add(t, t - this.last);
    this.last = t;
    // The 3D look counts what it drew; a frame it skipped adds nothing here.
    const now = this.scene.drawing;
    if (now && this.drawn && now.frames > this.drawn.frames) this.drawing.add(t, (now.cpu - this.drawn.cpu) / (now.frames - this.drawn.frames));
    this.drawn = now ?? null;
    if (t - this.shown < SHOW_MS) return;
    this.shown = t;
    const look = this.scene.baked && !this.scene.plain ? "baked" : this.scene.look;
    this.el.textContent = meterLine({ look, room: now?.skin, frames: this.frames, drawing: now ? this.drawing : null, sharpness: now?.sharpness, now: t });
  }
}
