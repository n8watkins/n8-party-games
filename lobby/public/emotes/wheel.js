// A player's emote wheel: one button in the control bar, six emotes round it.
//
// Hold the button and flick toward one to send it (let go on it); or tap the button to open the
// wheel and tap one. A laptop's number keys 1 to 6 send the six without the wheel (main.js).
// While the player's emote recharges a ring sweeps round the button, as round the bump. Which
// six are on the wheel is the player's own choice, kept on the device (openLoadout, from the
// door button's sheet).
//
// The room enforces the cooldown (party-kit/client/emotes.js). This only shows it.
import { EMOTES, EMOTE_COOLDOWN_MS, WHEEL_SLOTS, emoteById } from "/party-kit/client/emotes.js";
import { h, s } from "../dom.js";
import { rigById } from "./rig.js";
import { emoteThumb } from "./svg.js";

/** The six a new player starts with: the owner's pick. */
export const STARTER = ["popcorn", "slowclap", "pointlaugh", "redcard", "thumbsup", "tomato"];
const KEY = "party-room:wheel";
/** How far a finger must move from where it went down before it points at an emote. */
const FLICK_PX = 22;
/** A press shorter than this, that pointed at nothing, opens the wheel to tap on. */
const TAP_MS = 300;

/** The player's six, as kept on this device, made whole again if anything is missing or unknown. */
export function loadWheel(storage = safeStorage()) {
  let saved = [];
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? "[]");
  } catch {
    // Unreadable: the starter six.
  }
  const ids = (Array.isArray(saved) ? saved : []).filter((id, i, all) => emoteById(id) && all.indexOf(id) === i).slice(0, WHEEL_SLOTS);
  for (const id of [...STARTER, ...EMOTES.map((e) => e.id)]) if (ids.length < WHEEL_SLOTS && !ids.includes(id)) ids.push(id);
  return ids;
}

export function saveWheel(ids, storage = safeStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Private browsing: the choice lasts as long as the page.
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The button's picture: a face. */
function faceIcon() {
  const svg = s("svg", { viewBox: "0 0 24 24", class: "ctl-icon", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const d of ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M9 10h.01", "M15 10h.01", "M8 14.5c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2"]) svg.append(s("path", { d }));
  return svg;
}

/** What the wheel and the slots call each emote: a word or two that fits under its picture. */
const SHORT = { pointlaugh: "Laugh", tomato: "Tomato", lighter: "Lighter" };
const shortName = (id) => SHORT[id] ?? emoteById(id).name;

export class EmoteWheel {
  /**
   * @param {HTMLElement} pad    where the button goes (the right-hand pad, before jump)
   * @param {HTMLElement} layer  where the wheel opens (the HUD)
   * @param {{send: (id: string) => boolean, colour: () => string}} on  send: tries to send an emote,
   *   true when it went; colour: the player's seat colour, for the pictures
   */
  constructor(pad, layer, on) {
    this.on = on;
    this.layer = layer;
    this.ids = loadWheel();
    const b = (this.button = h("button", "round ctl ctl-emote", ""));
    pad.prepend(b);
    b.type = "button";
    b.setAttribute("aria-label", "Emotes");
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-keyshortcuts", "1 2 3 4 5 6");
    b.append(faceIcon());
    h("span", "ctl-word", "Emote", b);
    h("span", "ctl-key", "1-6", b).setAttribute("aria-hidden", "true");
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    this.sweep = s("circle", { cx: 50, cy: 50, r: 47, pathLength: 100, class: "ctl-ring-sweep" });
    b.append(s("svg", { viewBox: "0 0 100 100", class: "ctl-ring", "aria-hidden": "true" }, s("circle", { cx: 50, cy: 50, r: 47, class: "ctl-ring-track" }), this.sweep));
    this.filled = -1;
    this.state = "";
    this.press = null;
    this.hot = -1;
    this.box = null;

    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        // A pointer the browser no longer knows: the wheel still follows it over the button.
      }
      b.classList.add("held");
      this.press = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId };
      this.open(false);
    });
    b.addEventListener("pointermove", (e) => {
      if (!this.press || e.pointerId !== this.press.id) return;
      const dx = e.clientX - this.press.x;
      const dy = e.clientY - this.press.y;
      if (Math.hypot(dx, dy) < FLICK_PX) return this.setHot(-1);
      const a = Math.atan2(dy, dx) + Math.PI / 2;
      this.setHot(((Math.round((a / (Math.PI * 2)) * WHEEL_SLOTS) % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS);
    });
    b.addEventListener("pointerup", (e) => {
      if (!this.press || e.pointerId !== this.press.id) return;
      b.classList.remove("held");
      const quick = performance.now() - this.press.at < TAP_MS && this.hot === -1;
      this.press = null;
      if (this.hot >= 0) this.fire(this.hot);
      else if (quick) this.tapMode();
      else this.close();
    });
    b.addEventListener("pointercancel", () => {
      b.classList.remove("held");
      this.press = null;
      this.close();
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (this.box) this.close();
        else {
          this.open(true);
          this.box?.querySelector(".wheel-pick")?.focus();
        }
      }
    });
    // Turning the phone closes an open wheel: it was placed for the other shape of screen.
    this.onResize = () => this.close();
    addEventListener("resize", this.onResize);
  }

  get isOpen() {
    return !!this.box;
  }

  /** The wheel over the button: hold-and-flick (tap: false), or open to tap on (tap: true). */
  open(tap) {
    this.close();
    const back = (this.box = h("div", "wheel-back", "", this.layer));
    back.addEventListener("pointerdown", (e) => {
      if (e.target === back) this.close();
    });
    const wheel = h("div", "wheel", "", back);
    wheel.setAttribute("role", "dialog");
    wheel.setAttribute("aria-label", "Send an emote");
    const r = this.button.getBoundingClientRect();
    const size = Math.min(300, innerHeight - 24, innerWidth - 24);
    const left = Math.min(innerWidth - size / 2 - 12, Math.max(size / 2 + 12, r.left + r.width / 2));
    const top = Math.min(innerHeight - size / 2 - 12, Math.max(size / 2 + 12, r.top + r.height / 2 - size * 0.32));
    wheel.style.width = wheel.style.height = `${size}px`;
    wheel.style.left = `${Math.round(left - size / 2)}px`;
    wheel.style.top = `${Math.round(top - size / 2)}px`;
    // Where the finger went down is the wheel's middle for flicking, wherever the wheel is drawn.
    const ring = s("svg", { viewBox: "-150 -150 300 300", class: "wheel-ring", "aria-hidden": "true" });
    wheel.append(ring);
    this.wedges = [];
    const colour = this.on.colour();
    this.ids.forEach((id, i) => {
      const a0 = ((i - 0.5) / WHEEL_SLOTS) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 0.5) / WHEEL_SLOTS) * Math.PI * 2 - Math.PI / 2;
      const p = (rr, a) => `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
      this.wedges.push(ring.appendChild(s("path", { class: "wheel-wedge", d: `M${p(46, a0)} L${p(146, a0)} A146,146 0 0 1 ${p(146, a1)} L${p(46, a1)} A46,46 0 0 0 ${p(46, a0)} Z` })));
      const mid = (a0 + a1) / 2;
      const e = emoteById(id);
      const pick = h("button", "wheel-pick", "", wheel);
      pick.type = "button";
      pick.setAttribute("aria-label", `${e.name} (key ${i + 1})`);
      pick.style.left = `${(50 + Math.cos(mid) * 32).toFixed(2)}%`;
      pick.style.top = `${(50 + Math.sin(mid) * 32).toFixed(2)}%`;
      pick.append(emoteThumb(rigById(id), colour, Math.round(size * 0.17)));
      h("span", "wheel-name", shortName(id), pick);
      h("span", "wheel-key", String(i + 1), pick).setAttribute("aria-hidden", "true");
      pick.addEventListener("click", () => this.fire(i));
    });
    h("span", "wheel-hub", "Emote", wheel);
    back.classList.toggle("tap", tap);
  }

  /** A short tap on the button: the wheel stays open to be tapped. */
  tapMode() {
    if (!this.box) this.open(true);
    this.box.classList.add("tap");
  }

  setHot(i) {
    if (i === this.hot) return;
    this.hot = i;
    this.wedges?.forEach((w, n) => w.classList.toggle("hot", n === i));
  }

  close() {
    this.box?.remove();
    this.box = null;
    this.wedges = null;
    this.hot = -1;
  }

  /** Sends the emote in slot `i` (0 to 5), if it may go now. */
  fire(i) {
    this.close();
    const id = this.ids[i];
    if (id) this.on.send(id);
  }

  /** Puts a new six on the wheel and keeps them on the device. */
  setIds(ids) {
    this.ids = ids.slice(0, WHEEL_SLOTS);
    saveWheel(this.ids);
  }

  /** Every frame: how long until an emote may go again (0: now), and whether emotes are allowed at all. */
  show(cooling, allowed = true) {
    const state = !allowed ? "off" : cooling > 0 ? "cooling" : "ready";
    if (state !== this.state) {
      this.state = state;
      this.button.classList.toggle("cooling", state !== "ready");
      this.button.setAttribute("aria-disabled", String(state !== "ready"));
      this.button.setAttribute("aria-label", state === "ready" ? "Emotes" : state === "off" ? "Emotes, not during this game" : "Emotes, recharging");
    }
    const filled = state === "cooling" ? Math.round((1 - cooling / EMOTE_COOLDOWN_MS) * 200) / 2 : 100;
    if (filled !== this.filled) {
      this.filled = filled;
      this.sweep.setAttribute("stroke-dasharray", `${Math.max(0, filled)} 100`);
    }
  }

  destroy() {
    removeEventListener("resize", this.onResize);
    this.close();
    this.button.remove();
  }
}

/**
 * The sheet for choosing the six: the wheel's slots across the top, every emote below. Tap a
 * slot, then an emote to put on it. "Start again" puts the starter six back.
 * @param {HTMLElement} parent
 * @param {{ids: string[], colour: string, onSave: (ids: string[]) => void}} opts
 */
export function openLoadout(parent, { ids, colour, onSave }) {
  let six = [...ids];
  let slot = 0;
  const back = h("div", "sheet-back", "", parent);
  const box = h("div", "sheet loadout", "", back);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Your emote wheel");
  h("h2", "loadout-title", "Your emote wheel", box);
  h("p", "loadout-line", "Tap a slot, then the emote to put on it. Number keys 1 to 6 send them on a keyboard.", box);
  const slots = h("div", "loadout-slots", "", box);
  const all = h("div", "loadout-all", "", box);
  const draw = () => {
    slots.replaceChildren();
    six.forEach((id, i) => {
      const b = h("button", `loadout-slot${i === slot ? " sel" : ""}`, "", slots);
      b.type = "button";
      b.setAttribute("aria-pressed", String(i === slot));
      b.setAttribute("aria-label", `Slot ${i + 1}: ${emoteById(id).name}`);
      h("span", "loadout-key", String(i + 1), b);
      b.append(emoteThumb(rigById(id), colour, 44));
      h("span", "loadout-name", shortName(id), b);
      b.addEventListener("click", () => {
        slot = i;
        draw();
      });
    });
    all.replaceChildren();
    for (const e of EMOTES) {
      const b = h("button", `loadout-emote${six.includes(e.id) ? " on" : ""}`, "", all);
      b.type = "button";
      b.setAttribute("aria-label", `Put ${e.name} on slot ${slot + 1}`);
      b.append(emoteThumb(rigById(e.id), colour, 44));
      h("span", "loadout-name", e.name, b);
      b.addEventListener("click", () => {
        // An emote already on the wheel swaps places with the one in the chosen slot.
        const was = six.indexOf(e.id);
        if (was >= 0) six[was] = six[slot];
        six[slot] = e.id;
        slot = (slot + 1) % WHEEL_SLOTS;
        onSave(six);
        draw();
      });
    }
  };
  draw();
  const row = h("div", "loadout-row", "", box);
  const reset = h("button", "plain loadout-reset", "Start again", row);
  reset.type = "button";
  reset.addEventListener("click", () => {
    six = [...STARTER];
    slot = 0;
    onSave(six);
    draw();
  });
  const done = h("button", "button", "Done", row);
  done.type = "button";
  const close = () => back.remove();
  done.addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });
  done.focus();
  return { el: back, close };
}
