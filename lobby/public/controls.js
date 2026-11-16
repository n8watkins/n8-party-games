// A player's four buttons: walk left, walk right, jump and the character's move (a pawn's bump,
// a ghost's fade: lobby/shared/characters.js, moveOf). One family: the same round, dark,
// outlined button, each with a picture of what it does and a word under it. One of them carries
// the accent colour: the move, the only one with a cooldown, is amber when it is ready. While it
// recharges it is dim and a ring sweeps round it; a pulse says it is ready again.
//
// The room enforces the cooldown (lobby/shared/bump.js, lobby/shared/ghost.js). This only shows it.
import { h, s } from "./dom.js";

/** Pictures on a 24 x 24 grid. `fill` ones are solid shapes; the rest are drawn as lines (`dash`: a broken line). */
const PICTURES = {
  left: { d: ["M15 5l-7 7 7 7"] },
  right: { d: ["M9 5l7 7-7 7"] },
  // An arrow leaving the floor.
  jump: { d: ["M12 16V4", "M6.5 9.5L12 4l5.5 5.5", "M5 21h14"] },
  // The burst of a blow landing.
  bump: { fill: true, d: ["M12 1.6L14.6 7.5L21 6.8L17.2 12L21 17.2L14.6 16.5L12 22.4L9.4 16.5L3 17.2L6.8 12L3 6.8L9.4 7.5Z"] },
  // A ghost's sheet in a broken line: going see-through.
  fade: { dash: "2.7 2.3", d: ["M5.5 20.5V11a6.5 6.5 0 0 1 13 0v9.5l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6z"] },
};

/**
 * What each button says, and a key that does the same on a keyboard: `key` is what the small
 * badge shows (one sign, so it never covers the picture), `keys` is every key that works.
 */
const BUTTONS = {
  left: { name: "Walk left", word: "Left", key: "←", keys: "ArrowLeft A" },
  right: { name: "Walk right", word: "Right", key: "→", keys: "ArrowRight D" },
  jump: { name: "Jump", word: "Jump", key: "↑", keys: "ArrowUp Space W" },
  bump: { name: "Bump", word: "Bump", key: "B", keys: "B X Shift" },
};

/** The move button for each move a character can have: its picture, its name and its word. */
const MOVES = {
  kick: { picture: "bump", name: "Bump", word: "Bump" },
  fade: { picture: "fade", name: "Fade", word: "Fade" },
};

function picture(kind) {
  const { d, fill, dash } = PICTURES[kind];
  const attrs = fill ? { fill: "currentColor" } : { fill: "none", stroke: "currentColor", "stroke-width": 2.8, "stroke-linecap": "round", "stroke-linejoin": "round", ...(dash ? { "stroke-dasharray": dash } : {}) };
  const svg = s("svg", { viewBox: "0 0 24 24", class: "ctl-icon", "aria-hidden": "true", ...attrs });
  for (const path of d) svg.append(s("path", { d: path }));
  return svg;
}

/** One of the four buttons: the picture, the word, and the key for people at a keyboard. */
function control(parent, kind) {
  const { name, word, key, keys } = BUTTONS[kind];
  const b = h("button", `round ctl ctl-${kind}`, "", parent);
  b.type = "button";
  b.setAttribute("aria-label", name);
  b.setAttribute("aria-keyshortcuts", keys);
  b.append(picture(kind));
  h("span", "ctl-word", word, b);
  h("span", "ctl-key", key, b).setAttribute("aria-hidden", "true");
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  return b;
}

/** A button that acts the moment it is touched, without waiting for the finger to lift. */
function onTap(button, action) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    action();
  });
  button.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") action();
  });
}

/** A walk button: held down to walk, let go to stop. */
function onHold(button, steer) {
  const stop = (e) => {
    if (!button.classList.contains("held")) return;
    button.classList.remove("held");
    if (e.pointerId !== undefined && button.hasPointerCapture?.(e.pointerId)) button.releasePointerCapture(e.pointerId);
    steer(false);
  };
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    button.classList.add("held");
    steer(true);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, stop);
}

export class Controls {
  /**
   * @param {HTMLElement} left   where the walk buttons go: under the left thumb
   * @param {HTMLElement} right  where jump and the move go: under the right thumb, the move in the corner
   * @param {{steer: (d: number, down: boolean) => void, jump: () => void, bump: () => void}} on  `bump` is the move, whichever it is
   */
  constructor(left, right, on) {
    this.left = control(left, "left");
    this.right = control(left, "right");
    onHold(this.left, (down) => on.steer(-1, down));
    onHold(this.right, (down) => on.steer(1, down));
    this.jump = control(right, "jump");
    onTap(this.jump, on.jump);
    this.bump = control(right, "bump");
    onTap(this.bump, on.bump);
    // The cooldown ring: a track, and an arc that sweeps round as the move recharges.
    this.sweep = s("circle", { cx: 50, cy: 50, r: 47, pathLength: 100, class: "ctl-ring-sweep" });
    this.bump.append(s("svg", { viewBox: "0 0 100 100", class: "ctl-ring", "aria-hidden": "true" }, s("circle", { cx: 50, cy: 50, r: 47, class: "ctl-ring-track" }), this.sweep));
    this.move = "kick";
    this.state = "";
    this.filled = -1;
    this.show({ cooling: 0, down: false, of: 1 });
  }

  /** The player's character has this move ("kick" or "fade"): the button shows it. */
  setMove(move) {
    const m = MOVES[move] ?? MOVES.kick;
    if (this.move === move) return;
    this.move = move;
    this.bump.querySelector(".ctl-icon").replaceWith(picture(m.picture));
    this.bump.querySelector(".ctl-word").textContent = m.word;
    this.bump.dataset.move = move;
    // Said again with the new name on the next show.
    this.state = "";
    this.filled = -1;
  }

  /**
   * Call every frame. `cooling`: milliseconds until the move is ready (0: ready), out of `of`,
   * its whole cooldown. `down`: the piece is knocked over, so nothing works for a moment.
   */
  show({ cooling, down, of }) {
    const name = (MOVES[this.move] ?? MOVES.kick).name;
    const state = cooling > 0 ? "cooling" : "ready";
    if (state !== this.state) {
      // The pulse is only for coming back from a cooldown, not for the first time the room is drawn.
      this.bump.classList.toggle("pulse", state === "ready" && this.state === "cooling");
      this.state = state;
      this.bump.classList.toggle("cooling", state === "cooling");
      this.bump.classList.toggle("ready", state === "ready");
      this.bump.setAttribute("aria-disabled", String(state === "cooling"));
      this.bump.setAttribute("aria-label", state === "cooling" ? `${name}, recharging` : `${name}, ready`);
    }
    const filled = Math.round((1 - Math.min(1, Math.max(0, cooling / (of || 1)))) * 200) / 2;
    if (filled !== this.filled) {
      this.filled = filled;
      this.sweep.setAttribute("stroke-dasharray", `${filled} 100`);
    }
    if (down !== this.down) {
      this.down = down;
      for (const b of [this.left, this.right, this.jump, this.bump]) b.classList.toggle("floored", down);
    }
  }
}
