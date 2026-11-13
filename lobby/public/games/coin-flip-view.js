// What Coin Flip looks like: a coin for every player, spinning until the room says where they
// landed. The test game's half of the browser seam: the room page mounts a game's view when the
// game starts, passes it what the room sends, and unmounts it when the game ends.
import { h } from "../dom.js";

/**
 * @param {HTMLElement} container  an empty box laid over the room
 * @param {{room: object, you: object, snapshot: object}} ctx
 * @returns {{events: (list: object[]) => void, snapshot: (s: object) => void, unmount: () => void}}
 */
export function mount(container, { room, snapshot }) {
  const el = h("div", "flip", "", container);
  h("div", "card-kicker", "TEST GAME", el);
  h("h2", "flip-title", "Coin Flip", el);
  h("p", "flip-sub", "Luck picks the order. Nothing to press.", el);
  const row = h("div", "flip-row", "", el);
  for (const seat of snapshot.seats) {
    const m = room.members[seat];
    if (!m) continue;
    const who = h("div", "flip-who", "", row);
    const coin = h("div", "flip-coin", "", who);
    coin.style.background = m.colour;
    h("div", "flip-name", m.name, who);
  }
  return {
    events() {},
    snapshot() {},
    unmount: () => el.remove(),
  };
}
