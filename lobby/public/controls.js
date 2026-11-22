// A player's four buttons: walk left, walk right, jump and the character's move (a pawn's bump,
// a ghost's fade, a robot's hook, a slime's harden: lobby/shared/characters.js, moveOf; a robot's
// jump button is its stilt legs). One family: the same round, dark,
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
  // A robot's hook on the end of its chain.
  hook: { d: ["M3 6h3", "M8.5 6h3", "M14 6h3.5v8.5a3.5 3.5 0 0 1-7 0v-1.5", "M8 13l2.5-2.5 2.5 2.5"] },
  // A slime's dome cut into facets: hardened.
  harden: { d: ["M3.5 19.5L6 11.5l6-6 6 6 2.5 8z", "M12 5.5v14", "M6 11.5l6 2 6-2"] },
  // Two telescoping legs: a robot's jump.
  stilts: { d: ["M6 4h12v3.5H6z", "M9 7.5v12", "M15 7.5v12", "M7 20h4", "M13 20h4", "M8 12.5h2", "M14 12.5h2"] },
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
  hook: { picture: "hook", name: "Hook", word: "Hook", jump: { picture: "stilts", name: "Stilt legs", word: "Legs" } },
  harden: { picture: "harden", name: "Harden (hold to go soft)", word: "Harden" },
};
/** The jump button, for every character whose move does not change it. */
const JUMP = { picture: "jump", name: "Jump", word: "Jump" };

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
    // A key held down repeats: only its first press acts (a slime's held button must not harden again).
    if ((e.key === "Enter" || e.key === " ") && !e.repeat) action();
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
    // A slime's button is held to go soft (lobby/shared/slime.js): the page hears it come up. The
    // finger is captured, so a thumb that drifts off the button while it holds does not end the
    // hold, and the button takes no gesture of its own (touch-action: none, lobby.css .round).
    this.bump.addEventListener("pointerdown", (e) => {
      try {
        this.bump.setPointerCapture?.(e.pointerId);
      } catch {
        // A pointer the browser no longer knows (a made-up event): nothing to hold.
      }
    });
    for (const type of ["pointerup", "pointercancel"]) this.bump.addEventListener(type, () => on.unbump?.());
    this.bump.addEventListener("keyup", (e) => (e.key === "Enter" || e.key === " ") && on.unbump?.());
    // The cooldown ring: a track, and an arc that sweeps round as the move recharges.
    this.sweep = s("circle", { cx: 50, cy: 50, r: 47, pathLength: 100, class: "ctl-ring-sweep" });
    this.bump.append(s("svg", { viewBox: "0 0 100 100", class: "ctl-ring", "aria-hidden": "true" }, s("circle", { cx: 50, cy: 50, r: 47, class: "ctl-ring-track" }), this.sweep));
    this.move = "kick";
    this.state = "";
    this.filled = -1;
    this.show({ cooling: 0, down: false, of: 1 });
  }

  /** The player's character has this move ("kick", "fade", "hook" or "harden"): the button shows it, and a robot's jump button its legs. */
  setMove(move) {
    const m = MOVES[move] ?? MOVES.kick;
    if (this.move === move) return;
    this.move = move;
    this.bump.querySelector(".ctl-icon").replaceWith(picture(m.picture));
    this.bump.querySelector(".ctl-word").textContent = m.word;
    this.bump.dataset.move = move;
    const jump = m.jump ?? JUMP;
    this.jump.querySelector(".ctl-icon").replaceWith(picture(jump.picture));
    this.jump.querySelector(".ctl-word").textContent = jump.word;
    this.jump.setAttribute("aria-label", jump.name);
    this.jump.dataset.move = jump.picture;
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
