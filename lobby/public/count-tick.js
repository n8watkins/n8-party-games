// The count, large, in the bottom bar on every device, over the line of words that says the
// same: what is about to happen and a big number. It sits in the bar, never over the room, so
// it covers nobody's piece. Ten seconds is long enough to be dull if nothing moves, so each
// second ticks, and the last three tick harder: the number turns gold and pops, a phone gives a short buzz, and
// the page announces "count.tick" / "count.last" on window as a `party-room:sound` event for the
// sound system (none is played here). Stepping out of a light stops the count, and this with it.
import { h } from "./dom.js";

const LAST = 3;

export class CountTick {
  /** @param {HTMLElement} root  the Hud's element */
  constructor(root, { buzz = null } = {}) {
    this.root = root;
    this.buzz = buzz;
    this.el = h("div", "count-big", "", root);
    this.el.setAttribute("aria-live", "off");
    this.words = h("span", "count-words", "", this.el);
    this.digit = h("span", "count-digit", "", this.el);
    this.el.hidden = true;
    this.shown = 0;
    this.key = "";
  }

  /** Puts the chip over the middle of the bar's words. */
  place() {
    const words = this.root.querySelector(".bar .status");
    const r = words?.getBoundingClientRect();
    if (!r?.width) return;
    const at = `${Math.round(r.left + r.width / 2)},${Math.round(r.top + r.height / 2)}`;
    if (at === this.at) return;
    this.at = at;
    this.el.style.left = `${Math.round(r.left + r.width / 2)}px`;
    this.el.style.top = `${Math.round(r.top + r.height / 2)}px`;
    // It covers the line of words it stands for, and no more.
    this.el.style.minWidth = `${Math.round(r.width)}px`;
  }

  /** Every frame. `room` is the room view, `left` the ms the count has left (null when there is none). */
  update(room, left) {
    if (left === null || room.phase !== "lobby") {
      if (!this.el.hidden) this.el.hidden = true;
      this.shown = 0;
      return;
    }
    const n = Math.max(1, Math.ceil(left / 1000));
    const vote = room.vote;
    const lead = vote.leaders.length === 1 ? room.boxes.find((b) => b.id === vote.leaders[0]) : null;
    const words = lead ? `${lead.name} ${lead.url ? "opens" : "starts"} in` : "Coin toss in";
    if (words !== this.key) {
      this.key = words;
      this.words.textContent = words;
    }
    this.el.hidden = false;
    if (n === this.shown) return;
    this.place();
    this.shown = n;
    this.digit.textContent = String(n);
    const last = n <= LAST;
    this.el.classList.toggle("last", last);
    // Restart the pop: one per second, a bigger one in the last three.
    this.digit.classList.remove("pop");
    void this.digit.offsetWidth;
    this.digit.classList.add("pop");
    if (last) this.buzz?.(18);
    window.dispatchEvent(new CustomEvent("party-room:sound", { detail: { name: last ? "count.last" : "count.tick", n } }));
  }

  destroy() {
    this.el.remove();
  }
}
