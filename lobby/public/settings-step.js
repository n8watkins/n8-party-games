// The settings step after the vote (the room view's `choosing`): a card over the room. The
// party's host sees each setting as a list to pick from, a Start button and the way back to the
// room; everyone else (the big screen too) sees "Choosing settings" with the picks as they stand.
// Every change goes to the room, which checks it with the game and sends everyone the new picks:
// this card only ever shows what the room said.
import { h } from "./dom.js";

function minutes(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The label of a field's current pick. */
function pickLabel(field, picks) {
  return field.options.find((o) => o.value === picks[field.key])?.label ?? String(picks[field.key] ?? "");
}

export class SettingsStep {
  /**
   * @param {HTMLElement} parent  the hud, which the card is laid over
   * @param {{send: (message: object) => void, mine: (choosing: object) => boolean}} opts
   *   send: a message to the room; mine: whether this device is the one that chooses
   */
  constructor(parent, opts) {
    this.parent = parent;
    this.opts = opts;
    this.back = null;
    this.key = "";
    this.endsAt = 0;
  }

  /** Call with every room view: opens, redraws or closes the card. `at` is when the view arrived. */
  update(room, at) {
    const choosing = room.phase === "settings" ? room.choosing : null;
    if (!choosing) return this.close();
    this.endsAt = at + choosing.endsIn;
    const mine = this.opts.mine(choosing);
    const key = JSON.stringify([choosing.id, choosing.picks, choosing.by, mine, choosing.spots ?? null]);
    if (key === this.key && this.back) return;
    this.key = key;
    this.draw(room, choosing, mine);
  }

  draw(room, choosing, mine) {
    this.back?.remove();
    // While the players are chosen on spots the room stays in reach: the card sits at the top and
    // the pieces walk under it (lobby.css, .settings-back.spots).
    const spots = choosing.spots ?? null;
    const back = (this.back = h("div", `card-back settings-back${spots ? " spots" : ""}`, "", this.parent));
    const card = h("div", "card settings-card", "", back);
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Settings for ${choosing.name}`);
    h("div", "card-kicker", spots ? "WHO PLAYS" : mine ? "SETTINGS" : "CHOOSING SETTINGS", card);
    h("h2", "card-title", choosing.name, card);
    if (spots) {
      h("p", "card-foot spots-line", `Stand in a lit spot to play. The first ${spots.length} play; everyone else watches.`, card);
      const taken = h("div", "settings-list spots-list", "", card);
      spots.forEach((spot, i) => {
        const row = h("div", "settings-row", "", taken);
        h("span", "settings-label", `Player ${i + 1}`, row);
        const who = spot.seat === null ? null : room.members[spot.seat];
        h("strong", "settings-pick", who ? who.name : "Open", row);
      });
    }
    const who = choosing.by === -1 ? "The room's screen" : room.members[choosing.by]?.name;
    this.who = mine ? "You choose, everyone sees your picks." : `${who ?? "The host"} is choosing.`;
    const list = h("div", "settings-list", "", card);
    for (const field of choosing.fields) {
      const row = h("label", "settings-row", "", list);
      h("span", "settings-label", field.label, row);
      if (!mine) {
        h("strong", "settings-pick", pickLabel(field, choosing.picks), row);
        continue;
      }
      const select = h("select", "settings-select", "", row);
      field.options.forEach((option, i) => {
        const el = h("option", "", option.label, select);
        el.value = String(i);
        el.selected = option.value === choosing.picks[field.key];
      });
      select.addEventListener("change", () => {
        const option = field.options[Number(select.value)];
        if (option) this.opts.send({ t: "settings", v: { [field.key]: option.value } });
      });
    }
    this.said = h("p", "settings-said", "", card);
    this.said.hidden = true;
    this.left = h("p", "card-foot settings-left", "", card);
    if (mine) {
      const actions = h("div", "settings-actions", "", card);
      const cancel = h("button", "plain", "Back to the room", actions);
      cancel.type = "button";
      cancel.addEventListener("click", () => this.opts.send({ t: "settings-cancel" }));
      const start = h("button", "button", "Start", actions);
      start.type = "button";
      start.addEventListener("click", () => this.opts.send({ t: "settings-start" }));
    }
    this.frame(performance.now());
  }

  /** The room turned a change down: its words, under the list, until the next change. */
  refused(message) {
    if (!this.said) return;
    this.said.textContent = message;
    this.said.hidden = false;
  }

  /** Call every frame: the time left. */
  frame(now) {
    if (!this.left) return;
    const text = `${this.who} Starts by itself in ${minutes(this.endsAt - now)}.`;
    if (this.left.textContent !== text) this.left.textContent = text;
  }

  get isOpen() {
    return !!this.back;
  }

  close() {
    this.back?.remove();
    this.back = this.left = this.said = null;
    this.key = "";
  }

  destroy() {
    this.close();
  }
}
