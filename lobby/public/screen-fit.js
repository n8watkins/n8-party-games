// Getting the browser's bars out of the way, as far as each browser allows.
//
//   - Where the page can go full screen (Android Chrome and the like, desktop browsers), it does
//     so on the tap that takes someone into a room (the way in calls goFullscreen from that tap),
//     turns sideways where the browser lets a full-screen page do that, and keeps a small button
//     in the room's corner to leave and come back. If the browser drops out of full screen by
//     itself (the back gesture, an app switch), one tap brings it back; it never asks twice.
//   - An iPhone has no full screen for a page. There the room is laid out against what is
//     really visible (visualViewport), so the bar never covers anything, and "Add to Home
//     Screen" is offered once, with the steps, as the way to lose the bar for good. The corner
//     button opens the steps again.
//   - Opened from the home screen the page is already without bars, and none of this shows.
import { h, icon } from "./dom.js";

const HOME_TIP_KEY = "party-room:home-tip";
const EXPAND = ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"];
const SHRINK = ["M9 4v5H4", "M15 4v5h5", "M9 20v-5H4", "M15 20v-5h5"];

const root = document.documentElement;
/** Opened from the home screen: no browser bars to get rid of. */
// (A page put full screen by the Fullscreen API also matches display-mode: fullscreen, so that
// alone is the home screen only when no element is full screen.)
export const standalone = () =>
  navigator.standalone === true || matchMedia("(display-mode: standalone)").matches || (matchMedia("(display-mode: fullscreen)").matches && !document.fullscreenElement);
/** The page itself can go full screen here. */
export const canFullscreen = () => !!(root.requestFullscreen && document.fullscreenEnabled);
/** An iPhone (or an iPad that says it is a Mac): full screen only from the home screen. */
export const iPhone = () => /iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1 && !canFullscreen());
const chromeOnIOS = () => /CriOS/.test(navigator.userAgent);

/** Asks for full screen, sideways. Must be called from a tap. Quietly does nothing where it cannot. */
export function goFullscreen() {
  if (standalone() || !canFullscreen() || document.fullscreenElement) return;
  // Only a touch device is turned sideways; a laptop's screen is wide already.
  root
    .requestFullscreen({ navigationUI: "hide" })
    .then(() => (matchMedia("(pointer: coarse)").matches ? screen.orientation?.lock?.("landscape") : null))
    .catch(() => {});
}

/**
 * Keeps the room the size of what is really visible. iPhone Safari's bars come and go, and a
 * fixed element can sit under them; visualViewport says what is left.
 */
export function fitVisible() {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => root.style.setProperty("--seen-h", `${Math.round(vv.height)}px`);
  vv.addEventListener("resize", fit);
  fit();
}

/** The corner button, and what it does on this device. Returns null where nothing is needed. */
export class ScreenFit {
  /** @param {HTMLElement} corner  the room's corner (room-menu.js), the button goes first in it */
  constructor(corner, app) {
    this.app = app;
    this.wanted = false;
    if (standalone() || (!canFullscreen() && !iPhone())) return;
    const btn = (this.button = h("button", "round corner-btn full-btn", ""));
    btn.type = "button";
    corner.prepend(btn);
    btn.addEventListener("click", () => this.toggle());
    this.onChange = () => this.changed();
    document.addEventListener("fullscreenchange", this.onChange);
    this.wanted = !!document.fullscreenElement;
    this.draw();
    if (iPhone()) this.homeTip(false);
  }

  draw() {
    const on = !!document.fullscreenElement;
    this.button.replaceChildren(icon(on ? SHRINK : EXPAND, 20));
    this.button.setAttribute("aria-label", iPhone() ? "Play without the browser bar" : on ? "Leave full screen" : "Full screen");
  }

  toggle() {
    if (iPhone()) return this.homeTip(true);
    this.back?.remove();
    if (document.fullscreenElement) {
      this.wanted = false;
      document.exitFullscreen().catch(() => {});
    } else {
      this.wanted = true;
      goFullscreen();
    }
  }

  /** Out of full screen without being asked (the back gesture, an app switch): offer it back, once. */
  changed() {
    this.draw();
    if (document.fullscreenElement) {
      this.wanted = true;
      this.back?.remove();
      return;
    }
    if (!this.wanted) return;
    this.wanted = false;
    this.back?.remove();
    const back = (this.back = h("button", "full-back", "Back to full screen", this.app));
    back.type = "button";
    back.addEventListener("click", () => {
      back.remove();
      this.wanted = true;
      goFullscreen();
    });
    setTimeout(() => back.remove(), 8000);
  }

  /** On an iPhone: how to play without the bar. Shown by itself once; the corner button opens it again. */
  homeTip(asked) {
    if (!asked) {
      try {
        if (localStorage.getItem(HOME_TIP_KEY) === "1") return;
        localStorage.setItem(HOME_TIP_KEY, "1");
      } catch {
        return;
      }
    }
    this.tip?.remove();
    const back = (this.tip = h("div", "sheet-back", "", this.app));
    const card = h("div", "sheet home-tip", "", back);
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Play without the browser bar");
    h("h2", "picker-title", "Play without the browser bar", card);
    h("p", "picker-line", "An iPhone shows a web page's bar unless the page is opened from the Home Screen. Add it once and it opens full screen, like an app.", card);
    const steps = h("ol", "home-steps", "", card);
    const lines = chromeOnIOS()
      ? ["Tap the Share button in the address bar.", "Tap Add to Home Screen.", "Tap Add, then open it from your Home Screen."]
      : ["Tap the ••• button by the address (or the Share button).", "Tap Share, then scroll down and tap Add to Home Screen.", "Keep Open as Web App on, tap Add, then open it from your Home Screen."];
    for (const line of lines) h("li", "", line, steps);
    const ok = h("button", "plain", "Got it", card);
    ok.type = "button";
    const close = () => {
      back.remove();
      this.tip = null;
    };
    ok.addEventListener("click", close);
    back.addEventListener("click", (e) => e.target === back && close());
  }

  destroy() {
    if (this.onChange) document.removeEventListener("fullscreenchange", this.onChange);
    this.back?.remove();
    this.tip?.remove();
    this.button?.remove();
  }
}
