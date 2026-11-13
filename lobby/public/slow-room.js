// The 3D room on a device that cannot keep up. The 3D look first helps itself: it draws fewer
// pixels when frames are slow (Room3D.govern). If frames are still slow after that has had its
// chance, this offers the flat room once, with one tap: "Simpler room". Never twice on a
// device, and never while the page is hidden (a hidden page draws no frames, so it measures nothing).
import { h } from "./dom.js";

const OFFERED_KEY = "party-room:slow-offered";
/** The room is given this long to settle (fonts, the first frames, the 3D look's own step down). */
const SETTLE_MS = 15_000;
/** Slower than this, on average over WINDOW_MS, is too slow to play in: about 22 frames a second. */
const SLOW_FRAME_MS = 45;
const WINDOW_MS = 6000;

function offeredBefore() {
  try {
    return localStorage.getItem(OFFERED_KEY) === "1";
  } catch {
    return false;
  }
}

export class SlowWatch {
  /** @param {boolean} wanted  false where software drawing was asked for on purpose (?gl=any, the tests). */
  constructor(wanted = true) {
    this.wanted = wanted;
    this.on = false;
    this.el = null;
  }

  /** A room view went up: watch it if it is the 3D one. `simpler` switches this device to the flat room. */
  start(look, now, simpler) {
    this.stop();
    this.on = this.wanted && look === "3d" && !offeredBefore();
    this.since = now;
    this.simpler = simpler;
    this.avg = 16;
    this.slowSince = null;
  }

  stop() {
    this.on = false;
    this.el?.remove();
    this.el = null;
  }

  /** Every frame the 3D room is drawn. */
  frame(now, dt) {
    if (!this.on || dt <= 0 || dt > 0.5) return;
    this.avg += (dt * 1000 - this.avg) * 0.03;
    if (now - this.since < SETTLE_MS) return;
    if (this.avg < SLOW_FRAME_MS) return void (this.slowSince = null);
    this.slowSince ??= now;
    if (now - this.slowSince >= WINDOW_MS) this.offer();
  }

  offer() {
    this.on = false;
    try {
      localStorage.setItem(OFFERED_KEY, "1");
    } catch {
      // Private browsing: offered once per visit instead.
    }
    const el = (this.el = h("div", "slow-offer", "", document.getElementById("app")));
    el.setAttribute("role", "status");
    h("span", "", "The room is slow on this device.", el);
    const go = h("button", "slow-go", "Simpler room", el);
    go.type = "button";
    const no = h("button", "slow-no", "×", el);
    no.type = "button";
    no.setAttribute("aria-label", "Keep this room");
    go.addEventListener("click", () => {
      this.stop();
      this.simpler();
    });
    no.addEventListener("click", () => this.stop());
  }
}
