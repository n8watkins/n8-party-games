// "Your piece" (public/look-menu.js) against the room's real rules (LobbyCore.setLook) over a
// network with a delay each way: taps the player makes at an ordinary pace always become their
// piece, and the player never sees a cooldown message or "the room did not answer" from normal
// tapping, a dropped answer, a choice the room already has, or the saved choice sent on entering.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { game as coinFlip, manifest as coinFlipManifest } from "../games/coin-flip.js";
import { LobbyCore } from "../server/lobby-core.js";
import { boxFromManifest } from "../shared/vote.js";

// The portraits are drawings, not part of what is tested.
vi.mock("../public/emotes/svg.js", () => ({ characterPortrait: () => ({}) }));

const { LookMenu } = await import("../public/look-menu.js");

const COOLDOWN = "Wait a moment before changing it again.";
const NO_ANSWER = "The room did not answer. Check the connection and try again.";

/**
 * A phone with the menu, and the room. `up` is how long a message takes phone to room; the answer
 * takes `down`. The room answers as lobby-room.js does: the room view when the piece changed, a
 * plain yes when it already was that, `look-no` (with `wait`) when it is refused.
 */
function rig(firstPhase = "lobby") {
  const core = new LobbyCore({ boxes: [boxFromManifest(coinFlipManifest, { test: true })], games: new Map([["coin-flip", coinFlip]]), seed: 7, code: "BCDFGH", now: 0 });
  const joined = core.join("Ann", 0);
  core.connect(joined.token, 0);
  const seat = joined.seat;
  // The page reads "a game is on" off the room view; the room itself is in its lobby throughout.
  let phase = firstPhase;
  const view = () => ({ phase, members: core.members.map((m) => (m ? { seat: m.seat, character: m.character, colour: m.colour } : null)) });
  const net = { up: 50, down: 50 };
  const log = { sent: [], refusedByRoom: [], shown: [] };
  const pad = { appendChild() {}, append() {} };
  const menu = new LookMenu(pad, {}, {
    seat,
    send: (look) => {
      log.sent.push({ at: performance.now(), look });
      setTimeout(() => {
        const out = core.setLook(seat, look, performance.now());
        const m = core.members[seat];
        setTimeout(() => {
          if (!out.ok) {
            log.refusedByRoom.push(out.why);
            menu.refused(out.why, out.wait ? Math.ceil(out.wait) : undefined);
          } else if (out.changed) menu.update(view());
          else menu.answered({ c: m.character, v: m.colour });
        }, net.down);
      }, net.up);
    },
  });
  // What the player is shown: every reason put on the sheet.
  const nudge = menu.nudge.bind(menu);
  menu.nudge = (text) => {
    log.shown.push(text);
    nudge(text);
  };
  // The sheet is open (its drawing is not under test): taps arrive as pick().
  menu.sheet = { classList: { add() {}, remove() {} }, remove() {} };
  menu.why = { classList: { add() {}, remove() {} }, hidden: true, offsetWidth: 0 };
  menu.cards = [];
  menu.swatches = [];
  menu.any = { parentElement: { classList: { toggle() {} } } };
  menu.anyDot = { style: {} };
  menu.update(view());
  return { core, menu, seat, log, net, view, setPhase: (p) => (phase = p) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  // Just enough of a page for the corner button to be made.
  const el = () => ({ setAttribute() {}, addEventListener() {}, remove() {}, replaceChildren() {}, append() {}, appendChild() {}, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} } });
  globalThis.document = { createElement: el, createElementNS: el };
  globalThis.localStorage = {
    store: {},
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem(k, v) {
      this.store[k] = String(v);
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.localStorage;
  delete globalThis.document;
});

describe("choosing a piece against the room, over a real network", () => {
  it("takes a second tap inside the cooldown when the first message was slower on the wire", () => {
    const { menu, log, net, core, seat } = rig();
    net.up = 150;
    menu.pick({ c: "ghost" }); // arrives at 150
    vi.advanceTimersByTime(200);
    net.up = 40;
    menu.pick({ v: "#8a5bc4" }); // held, sent at 1060, arrives at 1100: 950 ms after the first
    vi.advanceTimersByTime(6000);
    expect(log.shown).toEqual([]);
    expect(core.members[seat]).toMatchObject({ character: "ghost", colour: "#8a5bc4" });
  });

  it("sends a choice once more, and says nothing, when the room still refuses it as too soon", () => {
    const { menu, log, net, core, seat } = rig();
    net.up = 700; // a first message stuck for most of a second: beyond the room's slack
    menu.pick({ c: "ghost" });
    vi.advanceTimersByTime(800);
    net.up = 20;
    menu.pick({ v: "#3aa9a0" });
    vi.advanceTimersByTime(6000);
    expect(log.refusedByRoom).toEqual([COOLDOWN]);
    expect(log.shown).toEqual([]);
    expect(core.members[seat]).toMatchObject({ character: "ghost", colour: "#3aa9a0" });
  });

  it("taps as fast as a finger can: the last choice wins and nothing is said", () => {
    const { menu, log, net, core, seat } = rig();
    for (const [i, look] of [{ c: "ghost" }, { v: "#d9619a" }, { c: "pawn" }, { v: "#3f7a4a" }, { c: "ghost" }, { v: "#8a5bc4" }].entries()) {
      net.up = [150, 30, 220, 40, 90, 10][i];
      menu.pick(look);
      vi.advanceTimersByTime(180);
    }
    vi.advanceTimersByTime(10_000);
    expect(log.shown).toEqual([]);
    expect(core.members[seat]).toMatchObject({ character: "ghost", colour: "#8a5bc4" });
  });

  it("starts the cooldown with the saved choice sent on entering, so a tap just after is not refused", () => {
    localStorage.setItem("party-room:piece", JSON.stringify({ v: "#8a5bc4" }));
    const { menu, log, core, seat } = rig();
    expect(log.sent.map((s) => s.look)).toEqual([{ v: "#8a5bc4" }]);
    vi.advanceTimersByTime(500);
    menu.pick({ c: "ghost" });
    vi.advanceTimersByTime(6000);
    expect(log.refusedByRoom).toEqual([]);
    expect(log.shown).toEqual([]);
    expect(core.members[seat]).toMatchObject({ character: "ghost", colour: "#8a5bc4" });
  });

  it("sends the same choice again after a request was lost and the sheet was closed", () => {
    const { menu, log, net, core, seat } = rig();
    net.up = 1e9; // the socket dropped: it never arrives
    menu.pick({ c: "ghost" });
    menu.close();
    vi.advanceTimersByTime(60_000);
    net.up = 50; // reconnected; the room view comes back unchanged
    menu.forget();
    menu.update({ phase: "lobby", members: menu.room.members });
    menu.sheet = { classList: { add() {}, remove() {} }, remove() {} };
    menu.pick({ c: "ghost" });
    vi.advanceTimersByTime(6000);
    expect(log.sent).toHaveLength(2);
    expect(core.members[seat].character).toBe("ghost");
  });

  it("forgets a request lost while the sheet was open once the connection is back", () => {
    const { menu, log, net, core, seat } = rig();
    net.up = 1e9;
    menu.pick({ c: "ghost" });
    vi.advanceTimersByTime(1500);
    net.up = 50;
    menu.forget(); // main.js on "open"
    menu.pick({ c: "ghost" });
    vi.advanceTimersByTime(6000);
    expect(log.sent).toHaveLength(2);
    expect(core.members[seat].character).toBe("ghost");
    expect(log.shown).toEqual([]);
  });

  it("is answered at once for a choice the room already has, and never says the room did not answer", () => {
    const { menu, log, net } = rig();
    net.up = 1e9;
    menu.pick({ c: "ghost" });
    menu.close();
    vi.advanceTimersByTime(60_000);
    net.up = 50;
    menu.sheet = { classList: { add() {}, remove() {} }, remove() {} };
    menu.pick({ c: "pawn" }); // differs from the lost request, equals the room: nothing to ask
    vi.advanceTimersByTime(6000);
    expect(log.shown).toEqual([]);
    // A request the room already has (two phones of one player, a retry that crossed an answer) is answered.
    menu.send({ c: "pawn" });
    vi.advanceTimersByTime(6000);
    expect(log.shown).not.toContain(NO_ANSWER);
    expect(log.shown).toEqual([]);
  });

  it("keeps the saved choice for a phone that comes in during a game, and asks for it when the lobby is back", () => {
    localStorage.setItem("party-room:piece", JSON.stringify({ c: "ghost", v: "#3aa9a0" }));
    const { menu, log, core, seat, view, setPhase } = rig("playing");
    expect(log.sent).toEqual([]);
    menu.update(view());
    expect(log.sent).toEqual([]);
    setPhase("lobby");
    menu.update(view());
    vi.advanceTimersByTime(1000);
    expect(log.sent.map((s) => s.look)).toEqual([{ c: "ghost", v: "#3aa9a0" }]);
    expect(core.members[seat]).toMatchObject({ character: "ghost", colour: "#3aa9a0" });
    // Asked for once: later room views do not ask again.
    menu.update(view());
    expect(log.sent).toHaveLength(1);
  });
});
