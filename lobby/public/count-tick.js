// The count, large, just above the bottom bar, on every device: what is about to happen and a
// big number. Ten seconds is long enough to be dull if nothing moves, so each second ticks, and
// the last three tick harder: the number turns gold and pops, a phone gives a short buzz, and
// the page announces "count.tick" / "count.last" on window as a `party-room:sound` event for the
// sound system (none is played here). Stepping out of a light stops the count, and this with it.
import { h } from "./dom.js";

const LAST = 3;

export class CountTick {
  /** @param {HTMLElement} root  the Hud's element */
  constructor(root, { buzz = null } = {}) {
    this.buzz = buzz;
    this.el = h("div", "count-big", "", root);
    this.el.setAttribute("aria-live", "off");
    this.words = h("span", "count-words", "", this.el);
    this.digit = h("span", "count-digit", "", this.el);
    this.el.hidden = true;
    this.shown = 0;
    this.key = "";
  }

  /**
   * Every frame. `room` is the room view, `left` the ms the count has left (null when there is
   * none), `bar` the bottom bar's height so the number sits just above it.
   */
  update(room, left, bar) {
    if (left === null || room.phase !== "lobby") {
      if (!this.el.hidden) this.el.hidden = true;
      this.shown = 0;
      return;
    }
    const n = Math.max(1, Math.ceil(left / 1000));
    const vote = room.vote;
    const lead = vote.leaders.length === 1 ? room.boxes.find((b) => b.id === vote.leaders[0]) : null;
    const words = lead ? `${lead.name} ${lead.url ? "opens" : "starts"} in` : "Coin toss in";
    const key = `${words}/${bar}`;
    if (key !== this.key) {
      this.key = key;
      this.words.textContent = words;
      this.el.style.bottom = `${bar + 10}px`;
    }
    this.el.hidden = false;
    if (n === this.shown) return;
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
