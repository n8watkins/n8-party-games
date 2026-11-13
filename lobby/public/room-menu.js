// The top right corner of the room: the "Rooms" button and the door button side by side, and
// the room picker the Rooms button opens.
//
// The room is the party's, not the device's: one choice everyone sees (lobby/shared/rooms.js),
// kept with the room on the server. Everyone can open the picker; only the host's taps apply,
// and the others see who picks. It cannot be changed during the count, the coin toss or a
// game, and the picker says so.
//
// Both buttons say what they do while the room is new to this device, then fold to their
// pictures so they cover less of the wall.
import { h, icon } from "./dom.js";
import { ROOMS, roomLocked, roomName } from "./shared/rooms.js";

/** How long the buttons keep their words after the room opens on this device. */
const WORDS_MS = 9000;
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
    btn.setAttribute("aria-label", "Rooms: pick the room the party is in");
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
  }

  /** The buttons lose their words (after a while, or once the player has started playing). */
  fold() {
    clearTimeout(this.foldTimer);
    this.corner.classList.add("folded");
  }

  get isOpen() {
    return !!this.sheet;
  }

  open() {
    if (this.sheet || !this.room) return;
    this.fold();
    const back = (this.sheet = h("div", "sheet-back", "", this.corner.parentElement));
    const box = h("div", "sheet picker", "", back);
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Rooms");
    const head = h("div", "picker-head", "", box);
    h("h2", "picker-title", "Rooms", head);
    this.line = h("p", "picker-line", "", head);
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
      card.addEventListener("click", () => this.pick(r.id));
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
    done.focus();
  }

  close() {
    this.sheet?.remove();
    this.sheet = null;
  }

  /** Whether this device's taps change the room. */
  mine(room) {
    const p = room.picker;
    if (!p) return false;
    return p.seat === -1 ? this.opts.role === "screen" : this.opts.role === "player" && p.seat === this.opts.seat;
  }

  pick(id) {
    const room = this.room;
    if (!room || !this.mine(room) || roomLocked(room) || id === room.room) return;
    this.opts.onPick(id);
    this.close();
  }

  /** Call whenever the room may have changed: cheap, and only touches the page when the words change. */
  update(room) {
    this.room = room;
    this.button.classList.toggle("locked", !!roomLocked(room));
    if (!this.sheet) return;
    const locked = roomLocked(room);
    const mine = this.mine(room);
    const who = room.picker ? (room.picker.seat === -1 ? "The room's screen" : room.members[room.picker.seat]?.name) : null;
    const key = JSON.stringify([room.room, locked, mine, who]);
    if (key === this.key) return;
    this.key = key;
    this.line.textContent = locked ? `${locked}. You can pick when it is over.` : mine ? "Pick where the party is. Everyone moves with you." : who ? `${who} picks the room.` : "The host picks the room.";
    this.line.classList.toggle("locked", !!locked);
    for (const card of this.cards) {
      const here = card.dataset.room === room.room;
      card.classList.toggle("here", here);
      const usable = mine && !locked && !here;
      card.setAttribute("aria-disabled", String(!usable));
      card.classList.toggle("off", !usable && !here);
      card.setAttribute("aria-label", roomName(card.dataset.room) + (here ? ", here now" : ""));
    }
  }

  destroy() {
    clearTimeout(this.foldTimer);
    this.close();
  }
}
