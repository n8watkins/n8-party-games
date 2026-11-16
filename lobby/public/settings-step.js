// The settings step after the vote (the room view's `choosing`): a card over the room. The
// party's host sees each setting as a list to pick from, a Start button and the way back to the
// room; everyone else (the big screen too) sees "Choosing settings" with the picks as they stand.
// Every change goes to the room, which checks it with the game and sends everyone the new picks:
// this card only ever shows what the room said.
//
// When the game's players are chosen on spots (`choosing.spots`), the room stays in sight and in
// reach: the card is a compact one that leaves the floor, the pieces and their name tags free
// (lobby.css, .settings-back.spots). Each setting is then a small pill with its name over its
// pick; the host's pills open the same lists.
import { h } from "./dom.js";

function minutes(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The index of a field's current pick among its options, or -1. */
export function pickIndex(field, picks) {
  return field.options.findIndex((o) => o.value === picks?.[field.key]);
}

/** The label of a field's current pick. */
function pickLabel(field, picks) {
  return field.options[pickIndex(field, picks)]?.label ?? String(picks?.[field.key] ?? "");
}

/**
 * What redraws the card: the game, the picks, who chooses and whether this device does. Who stands
 * on the spots is not part of it: those rows are filled in place, so a list the host has open
 * stays open while the pieces walk.
 */
export function cardKey(choosing, mine) {
  return JSON.stringify([choosing.id, choosing.picks, choosing.by, mine, choosing.spots ? choosing.spots.map((spot) => spot.place) : null]);
}

/**
 * The card's foot: who chooses, and what the time limit will do. With a spot still open it sends
 * everyone back to the room, so it says so; otherwise the game starts by itself.
 */
export function timeLine(who, spots, ms) {
  const open = Array.isArray(spots) && spots.some((spot) => spot.seat === null);
  // Short enough for one line beside the game's name on a small phone held sideways.
  return open ? `${who} Back to the room in ${minutes(ms)} if a spot is still open.` : `${who} Starts by itself in ${minutes(ms)}.`;
}

/**
 * Which side of a wide screen the spot card goes to: away from the lit spots, so the posters of
 * the games whose lights they are stay in sight. "left" or "right".
 * @param {{id: string}[]} boxes  the wall, in order
 * @param {{place: string}[]} spots
 */
export function cardSide(boxes, spots) {
  const at = spots.map((spot) => boxes.findIndex((b) => b.id === spot.place)).filter((i) => i >= 0);
  if (!at.length) return "right";
  const mean = at.reduce((a, b) => a + b, 0) / at.length;
  return mean < (boxes.length - 1) / 2 ? "right" : "left";
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
    /** The host's lists, each with its field and the words that show its pick: [{field, select, shown}]. */
    this.selects = [];
    /** The picks as the room last said them. */
    this.picks = {};
  }

  /** Call with every room view: opens, redraws or closes the card. `at` is when the view arrived. */
  update(room, at) {
    const choosing = room.phase === "settings" ? room.choosing : null;
    if (!choosing) return this.close();
    this.endsAt = at + choosing.endsIn;
    const mine = this.opts.mine(choosing);
    const key = cardKey(choosing, mine);
    this.spots = choosing.spots ?? null;
    this.picks = choosing.picks ?? {};
    if (key === this.key && this.back) return this.fillSpots(room);
    this.key = key;
    this.draw(room, choosing, mine);
  }

  /** Who stands on each spot, written into the rows that are already there. */
  fillSpots(room) {
    (this.spots ?? []).forEach((spot, i) => {
      const cell = this.spotCells?.[i];
      if (!cell) return;
      const name = (spot.seat === null ? null : room.members[spot.seat]?.name) ?? "Open";
      if (cell.textContent !== name) cell.textContent = name;
      cell.parentElement?.classList.toggle("open", spot.seat === null);
    });
  }

  draw(room, choosing, mine) {
    this.back?.remove();
    const spots = choosing.spots ?? null;
    const side = spots ? ` side-${cardSide(room.boxes ?? [], spots)}` : "";
    const back = (this.back = h("div", `card-back settings-back${spots ? " spots" : ""}${side}`, "", this.parent));
    // Under the door button's sheet and the other sheets, whichever opened first (lobby.css).
    const card = (this.card = h("div", `card settings-card${spots ? " spots-card" : ""}`, "", back));
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `${spots ? "Who plays" : "Settings for"} ${choosing.name}`);
    const head = h("div", "settings-head", "", card);
    h("div", "card-kicker", spots ? "WHO PLAYS" : mine ? "SETTINGS" : "CHOOSING SETTINGS", head);
    h("h2", "card-title", choosing.name, head);
    if (spots) {
      // How to take a spot: every role sees it, on every screen (it is not a card-foot).
      h("p", "spots-line", `Stand in a lit spot to play. The first ${spots.length} play; everyone else watches.`, card);
      const taken = h("div", "spots-list", "", card);
      this.spotCells = spots.map((spot, i) => {
        const row = h("div", "spot-chip", "", taken);
        h("span", "spot-label", `Player ${i + 1}`, row);
        return h("strong", "spot-name", "", row);
      });
      this.fillSpots(room);
    } else this.spotCells = null;
    const who = choosing.by === -1 ? "The room's screen" : room.members[choosing.by]?.name;
    // A step with only spots has nothing to choose: its host starts the game.
    if (spots && !choosing.fields.length) this.who = mine ? "You start the game." : `${who ?? "The host"} starts the game.`;
    else this.who = mine ? "You choose, everyone sees your picks." : `${who ?? "The host"} is choosing.`;
    this.selects = [];
    if (choosing.fields.length) {
      const list = h("div", spots ? "settings-pills" : "settings-list", "", card);
      for (const field of choosing.fields) (spots ? this.pill : this.row).call(this, list, field, choosing.picks, mine);
    }
    this.said = h("p", "settings-said", "", card);
    this.said.setAttribute("role", "status");
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

  /** A setting as a row: its name, and its pick (a list to choose from on the host's card). */
  row(list, field, picks, mine) {
    const row = h("label", "settings-row", "", list);
    h("span", "settings-label", field.label, row);
    if (!mine) {
      h("strong", "settings-pick", pickLabel(field, picks), row);
      return;
    }
    this.select(row, field, picks, null);
  }

  /** A setting as a pill, its name over its pick: on the host's card the whole pill opens the list. */
  pill(list, field, picks, mine) {
    const pill = h(mine ? "label" : "div", `pick${mine ? " mine" : ""}`, "", list);
    h("span", "pick-label", field.label, pill);
    const shown = h("strong", "pick-value", pickLabel(field, picks), pill);
    if (mine) this.select(pill, field, picks, shown);
  }

  /** The host's list for a field. `shown`: the words that repeat its pick, kept in step with it. */
  select(parent, field, picks, shown) {
    const select = h("select", "settings-select", "", parent);
    if (shown) select.setAttribute("aria-label", field.label);
    field.options.forEach((option, i) => {
      const el = h("option", "", option.label, select);
      el.value = String(i);
      el.selected = option.value === picks[field.key];
    });
    select.addEventListener("change", () => {
      const option = field.options[Number(select.value)];
      if (!option) return;
      if (shown) shown.textContent = option.label;
      this.opts.send({ t: "settings", v: { [field.key]: option.value } });
    });
    this.selects.push({ field, select, shown });
  }

  /**
   * The room turned a change down: its words, under the list, until the next change. The room
   * kept its picks, so every list goes back to showing them.
   */
  refused(message) {
    if (!this.said) return;
    for (const { field, select, shown } of this.selects) {
      const i = pickIndex(field, this.picks);
      if (i >= 0) select.value = String(i);
      if (shown) shown.textContent = pickLabel(field, this.picks);
    }
    this.said.textContent = message;
    this.said.hidden = false;
    this.back?.classList.add("said");
  }

  /** Call every frame: the time left. */
  frame(now) {
    if (!this.left) return;
    const text = timeLine(this.who, this.spots, this.endsAt - now);
    if (this.left.textContent !== text) this.left.textContent = text;
  }

  /** Where the spot card ends on the screen, in CSS pixels from the top; null without one (main.js keeps the name tags below it). */
  cardBottom() {
    if (!this.spots || !this.card?.isConnected) return null;
    return this.card.getBoundingClientRect().bottom;
  }

  get isOpen() {
    return !!this.back;
  }

  close() {
    this.back?.remove();
    this.back = this.card = this.left = this.said = this.spotCells = this.spots = null;
    this.selects = [];
    this.key = "";
  }

  destroy() {
    this.close();
  }
}
