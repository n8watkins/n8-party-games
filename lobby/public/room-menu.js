// The top right corner of the room: the "Rooms" button and the door button side by side, and
// the room picker the Rooms button opens.
//
// The room is the party's, not the device's: one look everyone sees (lobby/shared/rooms.js),
// kept with the room on the server. Everyone can open the picker. Only the host's taps apply
// (the player who started the party, or the first player when a big screen started it); the
// others see who chooses. It cannot be changed during the count, the coin toss or a game, nor
// twice within a few seconds, and then every card looks disabled and the picker says why in
// plain words. A tap that works answers at once: the card says "Going there", and the picker
// closes as the lights go down.
//
// Both buttons say what they do while the room is new to this device, then fold to their
// pictures so they cover less of the wall. The first time a host is in a room, a small bubble
// under Rooms says what it is.
import { h, icon } from "./dom.js";
import { ROOMS, ROOM_COOLDOWN_MS, roomLocked, roomName } from "./shared/rooms.js";

/** How long the buttons keep their words after the room opens on this device. */
const WORDS_MS = 9000;
/** A pick the room has not answered in this long is given up (the connection is down). */
const PICK_WAIT_MS = 4000;
const HINT_KEY = "party-room:rooms-hint";
const ROOMS_ICON = ["M4 5h16v14H4z", "M4 15l5-5 4 4 3-3 4 4", "M15.5 8.5h.01"];

export class RoomMenu {
  /**
   * @param {HTMLElement} hudEl  the Hud's element; the door button is already in it
   * @param {{onPick: (id: string) => void, seat: number, role: string}} opts
   */
  constructor(hudEl, opts) {
    this.opts = opts;
    this.corner = h("div", "corner", "", hudEl);
    const btn = (this.button = h("button", "round corner-btn rooms-btn", "", this.corner));
    btn.type = "button";
    btn.setAttribute("aria-label", "Rooms: choose how the party's room looks");
    btn.append(icon(ROOMS_ICON, 22));
    h("span", "door-word", "Rooms", btn);
    btn.addEventListener("click", () => this.open());
    // The door button moves into the corner, after Rooms, so the two line up whatever their words.
    const door = hudEl.querySelector(".door-btn");
    if (door) this.corner.append(door);
    this.foldTimer = setTimeout(() => this.fold(), WORDS_MS);
    this.sheet = null;
    this.key = "";
    this.room = null;
    /** When the room last changed, as this page heard it: the next change waits ROOM_COOLDOWN_MS. */
    this.changedAt = -Infinity;
    /** The room this device has just asked for, until the room answers. */
    this.going = null;
  }

  /** The buttons lose their words (after a while, or once the player has started playing). */
  fold() {
    clearTimeout(this.foldTimer);
    this.corner.classList.add("folded");
  }

  get isOpen() {
    return !!this.sheet;
  }

  /** The first time a host is in a room: one small bubble under Rooms, for a few seconds. */
  hint() {
    try {
      if (localStorage.getItem(HINT_KEY) === "1") return;
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      return;
    }
    const tip = h("div", "rooms-hint", "Change the room's look here", this.corner.parentElement);
    tip.setAttribute("role", "status");
    setTimeout(() => tip.remove(), 6000);
    tip.addEventListener("click", () => tip.remove());
  }

  open() {
    if (this.sheet || !this.room) return;
    this.fold();
    this.corner.parentElement.querySelector(".rooms-hint")?.remove();
    const back = (this.sheet = h("div", "sheet-back", "", this.corner.parentElement));
    const box = h("div", "sheet picker", "", back);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Choose the room");
    const head = h("div", "picker-head", "", box);
    h("h2", "picker-title", "Choose the room", head);
    this.line = h("p", "picker-line", "", head);
    this.why = h("p", "picker-why", "", box);
    this.why.setAttribute("role", "status");
    const grid = h("div", "picker-grid", "", box);
    this.cards = ROOMS.map((r) => {
      const card = h("button", "room-card", "", grid);
      card.type = "button";
      card.dataset.room = r.id;
      const img = h("img", "", "", card);
      // The small pictures are only fetched when the picker is opened.
      img.src = `/lobby/rooms/${r.id}.webp`;
      img.alt = "";
      img.width = 320;
      img.height = 165;
      h("span", "room-name", r.name.replace(/^The /, ""), card);
      h("span", "room-here", "Here now", card);
      h("span", "room-going", "Going there...", card);
      card.addEventListener("click", () => this.pick(r.id, card));
      return card;
    });
    const done = h("button", "plain", "Done", box);
    done.type = "button";
    done.addEventListener("click", () => this.close());
    back.addEventListener("click", (e) => {
      if (e.target === back) this.close();
    });
    this.key = "";
    this.update(this.room);
    // While the room is resting after a change, the words count down.
    this.ticker = setInterval(() => this.update(this.room), 500);
    done.focus();
  }

  close() {
    clearInterval(this.ticker);
    clearTimeout(this.goingTimer);
    this.going = null;
    this.sheet?.remove();
    this.sheet = null;
  }

  /** Whether this device's taps change the room. */
  mine(room) {
    const p = room.picker;
    if (!p) return false;
    return p.seat === -1 ? this.opts.role === "screen" : this.opts.role === "player" && p.seat === this.opts.seat;
  }

  /** Why the room cannot be changed from this device right now, in plain words, or null. */
  whyNot(room) {
    if (!this.mine(room)) {
      const p = room.picker;
      const who = p ? (p.seat === -1 ? "the room's screen" : room.members[p.seat]?.name) : null;
      return who ? `Only ${who} can change the room: the one who started the party.` : "Only the one who started the party can change the room.";
    }
    const locked = roomLocked(room);
    if (locked) return locked;
    const wait = ROOM_COOLDOWN_MS - (performance.now() - this.changedAt);
    if (wait > 0) return `The room just changed. You can change it again in ${Math.ceil(wait / 1000)} s.`;
    return null;
  }

  pick(id, card) {
    const room = this.room;
    if (!room || this.going) return;
    if (id === room.room) return this.nudge("You are in this room now.");
    const why = this.whyNot(room);
    if (why) return this.nudge(why);
    this.going = id;
    card.classList.add("going");
    this.sheet.classList.add("waiting");
    this.opts.onPick(id);
    // No answer: the connection is down. Say so, and let the next tap try again.
    this.goingTimer = setTimeout(() => this.refused("The room did not answer. Check the connection and try again."), PICK_WAIT_MS);
  }

  /** A tap that cannot apply: the reason, made to stand out for a moment. */
  nudge(text) {
    if (!this.why) return;
    this.why.textContent = text;
    this.why.hidden = false;
    this.why.classList.remove("nudge");
    void this.why.offsetWidth;
    this.why.classList.add("nudge");
  }

  /** The room moved (anyone's pick): the picker closes as the lights go down. */
  picked(id) {
    this.changedAt = performance.now();
    if (this.sheet && this.going === id) this.close();
    else if (this.sheet) this.update(this.room);
  }

  /** The room said no to this device's pick. */
  refused(why) {
    clearTimeout(this.goingTimer);
    this.going = null;
    if (!this.sheet) return;
    this.sheet.classList.remove("waiting");
    for (const card of this.cards) card.classList.remove("going");
    this.key = "";
    this.update(this.room);
    this.nudge(why);
  }

  /** Call whenever the room may have changed: cheap, and only touches the page when the words change. */
  update(room) {
    this.room = room;
    this.button.classList.toggle("locked", !!roomLocked(room));
    if (!this.sheet) return;
    const mine = this.mine(room);
    const why = this.whyNot(room);
    const key = JSON.stringify([room.room, why, mine]);
    if (key === this.key) return;
    this.key = key;
    this.line.textContent = mine ? "Everyone in the party sees the room you choose. The games stay the same." : "Everyone in the party sees the same room.";
    this.why.textContent = why ?? "";
    this.why.hidden = !why;
    this.why.classList.toggle("blocked", !!why);
    for (const card of this.cards) {
      const here = card.dataset.room === room.room;
      card.classList.toggle("here", here);
      const usable = !why && !here;
      card.setAttribute("aria-disabled", String(!usable));
      card.classList.toggle("off", !usable && !here);
      card.setAttribute("aria-label", roomName(card.dataset.room) + (here ? ", here now" : usable ? "" : ", cannot be chosen now"));
    }
  }

  destroy() {
    clearTimeout(this.foldTimer);
    this.close();
  }
}
