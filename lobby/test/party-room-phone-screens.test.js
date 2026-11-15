// The settings step's card as the phones see it: what a refused change leaves on the host's lists,
// what rebuilds the card, and where a wide screen puts it. The card is built with a small stand-in
// for the page's document, enough for settings-step.js (the test runs in Node).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardKey, cardSide, pickIndex, SettingsStep } from "../public/settings-step.js";

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.selected = false;
    const names = new Set();
    this.classList = {
      add: (n) => names.add(n),
      toggle: (n, on) => (on ?? !names.has(n) ? names.add(n) : names.delete(n)),
      contains: (n) => names.has(n) || this.className.split(" ").includes(n),
    };
  }
  append(...kids) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type) {
    for (const fn of this.listeners[type] ?? []) fn({ target: this });
  }
  /** Every element under this one with the class, in order. */
  all(name) {
    const out = [];
    const walk = (el) => {
      for (const kid of el.children) {
        if (kid.className.split(" ").includes(name)) out.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return out;
  }
}

const FIELDS = [
  { key: "pace", label: "Turn timer", options: [{ value: 30, label: "30 seconds" }, { value: 60, label: "60 seconds" }] },
  { key: "rounds", label: "Match length", options: [1, 3, 9].map((n) => ({ value: n, label: String(n) })) },
];
const members = [
  { seat: 0, name: "Ann" },
  { seat: 1, name: "Bo" },
  { seat: 2, name: "Cy" },
];
const boxes = ["cork", "turns", "who-am-i", "tin", "flood", "fox"].map((id) => ({ id, name: id }));
function stepRoom({ spots = null, picks = { pace: 30, rounds: 3 } } = {}) {
  return { phase: "settings", members, boxes, choosing: { id: "turns", name: "Turn Test", by: 0, fields: FIELDS, picks, spots, endsIn: 60_000 } };
}

let saved;
beforeEach(() => {
  saved = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
});
afterEach(() => {
  globalThis.document = saved;
});

function hostCard(room) {
  const hud = new FakeElement("div");
  const sent = [];
  const step = new SettingsStep(hud, { send: (m) => sent.push(m), mine: (c) => c.by === 0 });
  step.update(room, 0);
  return { hud, sent, step };
}

describe("a refused setting on the host's card", () => {
  for (const spots of [null, [{ place: "turns", seat: 0 }, { place: "who-am-i", seat: null }]]) {
    it(`puts every list back to what the room has (${spots ? "the spot card's pills" : "the full card's rows"})`, () => {
      const room = stepRoom({ spots });
      const { hud, sent, step } = hostCard(room);
      const [pace, rounds] = hud.all("settings-select");
      expect(pace.children.map((o) => o.selected)).toEqual([true, false]);
      // The host picks 9 rounds; the page sends it and, on the spot card, the pill says 9 at once.
      rounds.value = "2";
      rounds.fire("change");
      expect(sent).toEqual([{ t: "settings", v: { rounds: 9 } }]);
      if (spots) expect(hud.all("pick-value")[1].textContent).toBe("9");
      // The room turns it down and keeps 3: the list and its words show 3 again, and the reason is said.
      step.refused("Nine rounds need the 60 second timer.");
      expect(rounds.value).toBe("1");
      if (spots) expect(hud.all("pick-value").map((v) => v.textContent)).toEqual(["30 seconds", "3"]);
      const said = hud.all("settings-said")[0];
      expect(said.hidden).toBe(false);
      expect(said.textContent).toBe("Nine rounds need the 60 second timer.");
    });
  }

  it("follows the room's newer picks when the refusal comes after them", () => {
    const { hud, step } = hostCard(stepRoom());
    // A fine change the room took, then a refused one: the lists show the room's latest.
    step.update(stepRoom({ picks: { pace: 60, rounds: 3 } }), 0);
    const [pace, rounds] = hud.all("settings-select");
    rounds.value = "2";
    step.refused("No.");
    expect([pace.value, rounds.value]).toEqual(["1", "1"]);
  });

  it("names each pill's list for a screen reader, and shows a watcher the picks without lists", () => {
    const room = stepRoom({ spots: [{ place: "turns", seat: null }, { place: "who-am-i", seat: null }] });
    const { hud } = hostCard(room);
    expect(hud.all("settings-select").map((s) => s.attributes["aria-label"])).toEqual(["Turn timer", "Match length"]);
    const other = new FakeElement("div");
    new SettingsStep(other, { send: () => {}, mine: () => false }).update(room, 0);
    expect(other.all("settings-select")).toEqual([]);
    expect(other.all("pick-value").map((v) => v.textContent)).toEqual(["30 seconds", "3"]);
    expect(other.all("spots-line")[0].textContent).toBe("Stand in a lit spot to play. The first 2 play; everyone else watches.");
    expect(other.all("spot-name").map((v) => v.textContent)).toEqual(["Open", "Open"]);
  });
});

describe("the spot card", () => {
  it("is rebuilt when the spots move to other lights, never when somebody steps onto one", () => {
    const { choosing } = stepRoom({ spots: [{ place: "turns", seat: null }, { place: "who-am-i", seat: null }] });
    expect(cardKey({ ...choosing, spots: [{ place: "turns", seat: 2 }, { place: "who-am-i", seat: null }] }, true)).toBe(cardKey(choosing, true));
    expect(cardKey({ ...choosing, spots: [{ place: "who-am-i", seat: null }, { place: "tin", seat: null }] }, true)).not.toBe(cardKey(choosing, true));
    expect(cardKey(choosing, false)).not.toBe(cardKey(choosing, true));
  });

  it("fills the spots in place, and marks the open ones", () => {
    const room = stepRoom({ spots: [{ place: "turns", seat: null }, { place: "who-am-i", seat: null }] });
    const { hud, step } = hostCard(room);
    const before = hud.all("settings-select")[0];
    step.update(stepRoom({ spots: [{ place: "turns", seat: 1 }, { place: "who-am-i", seat: null }] }), 0);
    expect(hud.all("settings-select")[0]).toBe(before);
    expect(hud.all("spot-name").map((v) => v.textContent)).toEqual(["Bo", "Open"]);
    expect(hud.all("spot-chip").map((c) => c.classList.contains("open"))).toEqual([false, true]);
  });

  it("stands on a wide screen on the side away from the lit spots", () => {
    expect(cardSide(boxes, [{ place: "turns" }, { place: "who-am-i" }])).toBe("right");
    expect(cardSide(boxes, [{ place: "flood" }, { place: "fox" }])).toBe("left");
    expect(cardSide(boxes, [{ place: "nowhere" }])).toBe("right");
    const { hud } = hostCard(stepRoom({ spots: [{ place: "flood", seat: null }, { place: "fox", seat: null }] }));
    expect(hud.children[0].className).toContain("side-left");
  });

  it("finds a pick among a field's options", () => {
    expect(pickIndex(FIELDS[1], { rounds: 9 })).toBe(2);
    expect(pickIndex(FIELDS[1], {})).toBe(-1);
  });
});
