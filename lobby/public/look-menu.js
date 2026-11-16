// "Your piece": the button in the room's corner that shows a player's own piece, and the sheet
// it opens to choose a character and a colour (lobby/shared/characters.js).
//
// The choice is the player's, kept with the room on the server and shown to everyone in the room
// view: a tap asks the room, and the sheet shows the answer when the room view comes back. Two
// players may choose the same. It cannot be changed while a game is on, and then the sheet says
// so in plain words. The last choice made on this device is remembered, so the next party
// starts with the same piece (restore).
import { h } from "./dom.js";
import { characterPortrait } from "./emotes/svg.js";
import { CHARACTERS, COLOUR_PRESETS, LOOK_COOLDOWN_MS, characterOr, cleanColour, isCharacter } from "./shared/characters.js";

// ("party-room:look" is taken: it is which drawing of the room this device asked for, room-view.js.)
const SAVED_KEY = "party-room:piece";
/** A choice the room has not answered in this long is given up (the connection is down). */
const WAIT_MS = 4000;
/** A held tap goes this much after the room's cooldown is over by this page's clock. */
const HOLD_MARGIN_MS = 60;

function saved() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export class LookMenu {
  /**
   * @param {HTMLElement} corner  the room's corner of buttons (room-menu.js); this one goes before Rooms
   * @param {{seat: number, send: (look: {c?: string, v?: string}) => void, onChange?: (now: {character: string, colour: string}) => void}} opts
   *   send: asks the room; onChange: the room has the player's piece as something new
   */
  constructor(corner, opts) {
    this.opts = opts;
    this.corner = corner;
    const btn = (this.button = h("button", "round corner-btn look-btn", ""));
    btn.type = "button";
    btn.setAttribute("aria-label", "Your piece: choose a character and a colour");
    btn.setAttribute("aria-haspopup", "dialog");
    this.face = h("span", "look-face", "", btn);
    h("span", "door-word", "Your piece", btn);
    corner.insertBefore(btn, corner.querySelector(".rooms-btn"));
    btn.addEventListener("click", () => this.open());
    this.sheet = null;
    this.room = null;
    this.key = "";
    this.sentAt = -Infinity;
    /** Taps made inside the room's cooldown, until they are sent. */
    this.held = null;
    /** What was last asked of the room, until it answers. */
    this.pending = null;
    /** The last choice sent, for the one retry of a choice that came a little early. */
    this.asked = null;
    this.retrying = false;
    this.restored = false;
  }

  get isOpen() {
    return !!this.sheet;
  }

  /** The player's own piece as the room has it: {character, colour}, or null before the room has answered. */
  mine(room = this.room) {
    const m = room?.members[this.opts.seat];
    return m ? { character: characterOr(m.character), colour: m.colour } : null;
  }

  /** Why the piece cannot be changed right now, in plain words, or null. */
  whyNot(room) {
    return room?.phase === "playing" ? "A game is on. You can change your piece when it ends." : null;
  }

  /**
   * Once: the piece last chosen on this device, if the room has this seat as something else.
   * Tried when the room is first drawn, and again with each room view until it can be asked (a
   * phone that comes in during a game becomes its piece when the lobby is back). It is sent like
   * a tap, so a tap just after waits out the room's cooldown. A choice the room refuses (a
   * character it no longer has) is simply not applied.
   */
  restore(room) {
    if (this.restored) return;
    const want = saved();
    if (!want) {
      this.restored = true;
      return;
    }
    const now = this.mine(room);
    if (!now || this.whyNot(room)) return;
    this.restored = true;
    const look = {};
    if (isCharacter(want.c) && want.c !== now.character) look.c = want.c;
    const colour = cleanColour(want.v);
    if (colour && colour !== now.colour) look.v = colour;
    if (look.c || look.v) this.send(look);
  }

  open() {
    if (this.sheet || !this.room) return;
    const back = (this.sheet = h("div", "sheet-back", "", this.corner.parentElement));
    const box = h("div", "sheet picker look-sheet", "", back);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Your piece");
    const head = h("div", "picker-head", "", box);
    h("h2", "picker-title", "Your piece", head);
    h("p", "picker-line", "Everyone in the party sees the character and colour you choose.", head);
    this.why = h("p", "picker-why", "", box);
    this.why.setAttribute("role", "status");
    this.why.hidden = true;

    h("h3", "look-label", "Character", box);
    const cast = h("div", "look-cast", "", box);
    this.cards = CHARACTERS.map((c) => {
      const card = h("button", "look-card", "", cast);
      card.type = "button";
      card.dataset.character = c.id;
      card.pic = h("span", "look-pic", "", card);
      h("span", "look-name", c.name, card);
      card.addEventListener("click", () => this.pick({ c: c.id }));
      return card;
    });

    h("h3", "look-label", "Colour", box);
    const row = h("div", "look-colours", "", box);
    this.swatches = COLOUR_PRESETS.map((c) => {
      const sw = h("button", "look-swatch", "", row);
      sw.type = "button";
      sw.dataset.colour = c.hex;
      sw.style.background = c.hex;
      sw.addEventListener("click", () => this.pick({ v: c.hex }));
      return sw;
    });
    // Any colour at all: the device's own colour picker. It is asked for once, when the picker is closed.
    const any = h("label", "look-any", "", row);
    this.anyDot = h("span", "look-any-dot", "", any);
    h("span", "", "Any colour", any);
    this.any = h("input", "", "", any);
    this.any.type = "color";
    this.any.setAttribute("aria-label", "Any colour");
    this.any.addEventListener("change", () => this.pick({ v: this.any.value }));

    const done = h("button", "plain", "Done", box);
    done.type = "button";
    done.addEventListener("click", () => this.close());
    back.addEventListener("click", (e) => {
      if (e.target === back) this.close();
    });
    this.key = "";
    this.update(this.room);
    done.focus();
  }

  close() {
    // What was asked and not yet answered is not waited on any more: a tap on the same choice
    // later is sent again, not taken as already on its way.
    this.forget();
    // A tap still held back is sent all the same: it was made.
    if (this.held) {
      clearTimeout(this.holdTimer);
      const wait = Math.max(0, this.sentAt + LOOK_COOLDOWN_MS + HOLD_MARGIN_MS - performance.now());
      this.holdTimer = setTimeout(() => this.pick({}), wait);
    }
    this.sheet?.remove();
    this.sheet = null;
  }

  /**
   * Stops waiting for the room's answer to the last choice: the sheet is closed, or the
   * connection dropped and came back (an answer lost with it never comes).
   */
  forget() {
    clearTimeout(this.waitTimer);
    this.pending = null;
    this.sheet?.classList.remove("waiting");
  }

  /** Sends a choice to the room: the one way a choice leaves this page. */
  send(look) {
    this.sentAt = performance.now();
    this.asked = look;
    this.pending = { ...this.pending, ...look, ...(look.v ? { v: cleanColour(look.v) } : {}) };
    this.opts.send(look);
    this.sheet?.classList.add("waiting");
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => this.refused("The room did not answer. Check the connection and try again."), WAIT_MS);
  }

  /** The room has the choice (it changed the piece, or the piece already was that): nothing is waited on. */
  answered() {
    this.retrying = false;
    this.forget();
  }

  /** A tap on a character or a colour: asks the room, and remembers it for the next party on this device. */
  pick(look) {
    const room = this.room;
    const now = this.mine(room);
    if (!now) return;
    const why = this.whyNot(room);
    if (why) return this.nudge(why);
    // The room makes a second change wait a moment; taps inside it are held back, put together (a
    // character and then a colour are one choice) and sent when the moment is over.
    // A new tap is a new choice: it may be sent once more if it comes a little early (refused).
    if (Object.keys(look).length) this.retrying = false;
    look = { ...this.held, ...look };
    this.held = null;
    clearTimeout(this.holdTimer);
    // Against what the piece is about to be: the room may not have answered the last choice yet.
    const soon = { c: now.character, v: now.colour, ...this.pending };
    if ((look.c ?? soon.c) === soon.c && (cleanColour(look.v) ?? soon.v) === soon.v) {
      this.retrying = false;
      return;
    }
    const wait = this.sentAt + LOOK_COOLDOWN_MS + HOLD_MARGIN_MS - performance.now();
    if (wait > 0) {
      this.held = look;
      this.sheet?.classList.add("waiting");
      this.holdTimer = setTimeout(() => this.pick({}), wait);
      return;
    }
    this.send(look);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ ...saved(), ...look }));
    } catch {
      // No storage here: the choice still holds for this party.
    }
  }

  /** A tap that cannot apply: the reason, made to stand out for a moment. */
  nudge(text) {
    if (!this.sheet) return;
    this.why.textContent = text;
    this.why.hidden = false;
    this.why.classList.remove("nudge");
    void this.why.offsetWidth;
    this.why.classList.add("nudge");
  }

  /**
   * The room said no to this device's choice. A choice that only came a little early (`wait`, the
   * room's cooldown still left: the two clocks and the network never agree to the millisecond) is
   * sent once more when the moment is over, and the player sees nothing. Returns whether the page
   * dealt with it (a retry, or the reason on the open sheet); if not, the caller says it as a note.
   */
  refused(why, wait = 0) {
    clearTimeout(this.waitTimer);
    if (wait > 0 && this.asked && !this.retrying) {
      this.retrying = true;
      const again = this.asked;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        // Whatever was tapped since is put together with it, as a held tap is.
        this.held = { ...again, ...this.held };
        this.pending = null;
        this.sentAt = -Infinity;
        this.pick({});
      }, wait + HOLD_MARGIN_MS);
      return true;
    }
    this.retrying = false;
    this.forget();
    this.nudge(why);
    return !!this.sheet;
  }

  /** Call whenever the room may have changed: cheap, and only touches the page when the piece does. */
  update(room) {
    this.room = room;
    const now = this.mine(room);
    if (!now) return;
    const why = this.whyNot(room);
    // A game began while the sheet was open: it would lie over the game, so it goes.
    if (why && this.sheet) this.close();
    const key = `${now.character}/${now.colour}/${why ?? ""}/${this.isOpen}`;
    const same = key === this.key;
    const changed = !this.key.startsWith(`${now.character}/${now.colour}/`);
    this.key = key;
    if (changed) {
      // The room answered: the choice is on.
      this.answered();
      this.face.replaceChildren(characterPortrait(now.character, now.colour, 34));
      this.opts.onChange?.(now);
    }
    // The saved piece waits for a room view in which it can be asked for.
    if (!this.restored) this.restore(room);
    if (same || !this.sheet) return;
    this.why.textContent = why ?? "";
    this.why.hidden = !why;
    for (const card of this.cards) {
      const on = card.dataset.character === now.character;
      card.setAttribute("aria-pressed", String(on));
      card.setAttribute("aria-disabled", String(!!why));
      card.pic.replaceChildren(characterPortrait(card.dataset.character, now.colour, 96));
    }
    let preset = false;
    for (const sw of this.swatches) {
      const on = sw.dataset.colour === now.colour;
      preset ||= on;
      sw.setAttribute("aria-pressed", String(on));
      sw.setAttribute("aria-disabled", String(!!why));
      sw.setAttribute("aria-label", COLOUR_PRESETS.find((c) => c.hex === sw.dataset.colour).name + (on ? ", yours now" : ""));
    }
    // A colour that is none of the presets shows as chosen on "Any colour".
    this.any.value = now.colour;
    this.any.disabled = !!why;
    this.any.parentElement.classList.toggle("on", !preset);
    this.anyDot.style.background = preset ? "" : now.colour;
  }

  destroy() {
    this.held = null;
    clearTimeout(this.holdTimer);
    clearTimeout(this.retryTimer);
    this.close();
    this.button.remove();
  }
}
