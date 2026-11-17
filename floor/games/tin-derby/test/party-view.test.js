// The view the party room mounts (page/party-view.js): the test switches (derby-auto and the rest) reach the race
// page only where the room has its test games on, decided from what the server sent (the wall), never the address.
import { describe, expect, it } from "vitest";
import { TEST_WALL, WALL } from "../../../../lobby/wall.js";
import { mount, switchesFor } from "../page/party-view.js";
import { game, testGame } from "../party.js";

const ASKED = new URLSearchParams("join=1234&look=flat&derby-auto=1&derby-lag=200&derby-touch&lag=40&derby-=x");

/** The least of a document mount() needs: an iframe it can dress, and a box to put it in. */
function fakeContainer(search = "") {
  const made = [];
  const doc = {
    defaultView: { location: { search } },
    createElement(tag) {
      const node = { tag, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, remove() {} };
      made.push(node);
      return node;
    },
  };
  return { ownerDocument: doc, append() {}, made };
}
const view = (wall) => ({ boxes: wall.boxes, code: "BCDFGH" });
const ctx = (wall, params) => ({ room: view(wall), you: { role: "player", seat: 0 }, snapshot: {}, send() {}, now: () => 0, params });

describe("the test switches", () => {
  it("production's wall has no test box, the test wall has one: the server's word the page goes by", () => {
    expect(WALL.boxes.some((b) => b.test)).toBe(false);
    expect(TEST_WALL.boxes.some((b) => b.test === true)).toBe(true);
  });

  it("production runs the plain game, which never takes a short race; only the test wall runs the one that does", () => {
    expect(WALL.games.get("tin-derby")).toBe(game);
    expect(TEST_WALL.games.get("tin-derby")).toBe(testGame);
    expect(game.create({ seed: 1, seats: [] }).tests).toBeUndefined();
    expect(testGame.create({ seed: 1, seats: [] }).tests).toBe(true);
  });

  it("production ignores every derby-* switch on the address: the house's driver never steers for anyone", () => {
    expect(switchesFor(view(WALL), ASKED)).toBe("");
    const box = fakeContainer("?" + ASKED);
    const v = mount(box, ctx(WALL, null)); // no params: the view reads the room page's own address
    expect(v.frame.partyHost.switches).toBe("");
    expect(v.frame.src).not.toMatch(/auto|lag|touch/);
    v.unmount();
  });

  it("where test games are on, the derby-* switches (and only they) are handed to the page, not put on its address", () => {
    expect(new URLSearchParams(switchesFor(view(TEST_WALL), ASKED)).toString()).toBe("auto=1&lag=200&touch=");
    const v = mount(fakeContainer(), ctx(TEST_WALL, ASKED));
    expect(v.frame.partyHost.switches).toBe("auto=1&lag=200&touch=");
    expect(new URL(v.frame.src).search).toBe("?party=1");
    v.unmount();
  });

  it("a room view with no wall, or a malformed one, gives no switches", () => {
    for (const room of [null, undefined, {}, { boxes: null }, { boxes: [{ test: "yes" }] }, { boxes: [null, 7] }]) expect(switchesFor(room, ASKED)).toBe("");
  });
});
