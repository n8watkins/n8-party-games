// The Tonight board, large: what a tap on the board on the wall opens. The night's standings
// (place, name, points) and the games played so far with who won each. It is only a view: the
// player's piece stays where it stands, so its vote carries on, and a line at the foot says
// what the room is doing meanwhile. Closed by a tap, Escape or the back gesture (main.js).
import { h } from "./dom.js";
import { ordinal, playedLines, standings } from "./shared/tonight.js";

/**
 * @param {HTMLElement} root
 * @param {{room: object, own: number, onClose: () => void}} opts  own: the viewer's seat, or -1
 * @returns {{el: HTMLElement, update: (room: object, line?: string) => void, remove: () => void}}
 */
export function openBoard(root, { room, own, onClose }) {
  const back = h("div", "board-back", "", root);
  const board = h("div", "board", "", back);
  board.setAttribute("role", "dialog");
  board.setAttribute("aria-modal", "true");
  board.setAttribute("aria-label", "Tonight: the standings and the games played");
  const close = h("button", "board-close", "", board);
  close.type = "button";
  close.setAttribute("aria-label", "Close the board");
  h("span", "", "Close", close);
  h("h2", "board-title", "Tonight", board);
  const sub = h("p", "board-sub", "", board);
  const cols = h("div", "board-cols", "", board);
  const left = h("section", "board-col", "", cols);
  h("h3", "board-head", "Standings", left);
  const places = h("ol", "board-places", "", left);
  const right = h("section", "board-col", "", cols);
  h("h3", "board-head", "Games played", right);
  const games = h("ol", "board-games", "", right);
  const foot = h("p", "board-foot", "", board);
  const now = h("span", "board-now", "", foot);
  h("span", "board-hint", "Tap anywhere to close", foot);
  let key = "";

  function update(next, line = "") {
    now.textContent = line;
    now.hidden = !line;
    const fresh = JSON.stringify([next.members, next.tonight]);
    if (fresh === key) return;
    key = fresh;
    const n = next.tonight.games;
    sub.textContent = `${n === 0 ? "No games yet" : n === 1 ? "After 1 game" : `After ${n} games`}. 1st gets 3 points, 2nd 2, 3rd 1.`;
    places.replaceChildren();
    const rows = standings(next.members);
    for (const row of rows) {
      const li = h("li", row.seat === own ? "mine" : "", "", places);
      h("span", "board-place", ordinal(row.place), li);
      h("span", "dot", "", li).style.background = row.connected ? row.colour : "#9b948b";
      h("span", "board-name", row.seat === own ? `${row.name} (you)` : row.name, li);
      h("span", "board-points", String(row.points), li);
      h("span", "board-unit", row.points === 1 ? "pt" : "pts", li);
    }
    if (!rows.length) h("li", "board-empty", "Nobody has joined yet.", places);
    games.replaceChildren();
    const lines = playedLines(next.tonight);
    // Newest first: the game just played is the one people look for.
    for (const game of [...lines].reverse()) {
      const li = h("li", "", "", games);
      h("span", "board-place", String(game.number), li);
      const words = h("span", "board-game", "", li);
      h("strong", "", game.name, words);
      const won = h("span", "board-won", "", words);
      for (const w of game.winners) h("span", "dot", "", won).style.background = w.colour;
      h("span", "", game.won, won);
    }
    if (!lines.length) h("li", "board-empty", "The first game is still to come. Stand in a light to pick one.", games);
    else if (lines[0].number > 1) h("li", "board-empty", `And ${lines[0].number - 1} earlier.`, games);
  }

  update(room);
  // A tap anywhere closes it: there is nothing on the board to press.
  back.addEventListener("click", onClose);
  close.focus();
  return { el: back, update, remove: () => back.remove() };
}
