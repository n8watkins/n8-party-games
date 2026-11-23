// The Table's away note, on the stage under the game's name, where the players and the big screen
// look while a turn-based game is on, and the screen kept awake meanwhile:
//   - Another player's page is hidden: "Bo is away", and while the room runs Bo's grace (their
//     turn; the room view's `awayIn`), under it "back within 1:45 or the match ends", counted
//     down from when that room view arrived.
//   - This player's own page is shown again after an absence that ran some of their grace
//     (`awaySpare` on their member): for a few seconds, "You're back, with 0:28 to spare" and why.
//   - While this player plays a turn-based game the page holds a screen wake lock, so a phone left
//     on the table does not lock itself; a page that cannot hold one tells the room, which then
//     never charges it for being hidden (lobby/public/connection.js, WakeKeeper).
// The room decides who is away and for how long (lobby/server/lobby-core.js, trackClocks); this
// only shows it. The words are lobby/public/connection.js's, shared with the tests.
import { BACK_NOTE_MS, WakeKeeper, awayNote, returnHeard } from "/lobby/connection.js";
import { h } from "/lobby/dom.js";

/**
 * Mounts the note in `parent`, before `before`. `link` is the PartyClient. Returns
 * {room(next, you)}: call it with every room view. It counts down by itself.
 */
export function mountAway(parent, before, { link, now = () => performance.now() }) {
  const el = h("div", "away-note", "");
  el.setAttribute("role", "status");
  el.hidden = true;
  parent.insertBefore(el, before);
  const mine = { room: null, you: null, seenAt: 0, back: null, wasHidden: false, shown: "" };
  const keeper = new WakeKeeper(link, { wakeLock: navigator.wakeLock ?? null, hidden: () => document.hidden });

  document.addEventListener("visibilitychange", () => {
    // This page was hidden: the first room view that answers its return says whether it cost anything.
    if (document.hidden) mine.wasHidden = true;
    else void keeper.shown();
  });
  // Some browsers grant a wake lock only after a tap.
  addEventListener("pointerdown", () => void keeper.shown(), { passive: true });

  function draw() {
    const note = mine.room ? awayNote(mine.room, mine.you, mine.seenAt, now(), mine.back) : null;
    const key = note ? JSON.stringify(note) : "";
    if (key === mine.shown) return;
    mine.shown = key;
    el.hidden = !note;
    el.replaceChildren();
    if (!note) return;
    el.className = `away-note ${note.kind}`;
    for (const colour of note.dots) h("span", "dot", "", el).style.background = colour;
    const words = h("span", "away-words", "", el);
    h("span", "away-who", note.who, words);
    if (note.left) h("span", "away-left", note.left, words);
  }
  setInterval(draw, 250);

  return {
    room(next, you) {
      mine.room = next;
      mine.you = you;
      mine.seenAt = now();
      void keeper.room(next);
      const own = you?.role === "player" ? next.members?.[you.seat] : null;
      // Only a view sent after the room heard this page is back answers its return.
      if (mine.wasHidden && !document.hidden && returnHeard(own)) {
        mine.wasHidden = false;
        if (typeof own.awaySpare === "number" && next.phase === "playing") mine.back = { spare: own.awaySpare, until: mine.seenAt + BACK_NOTE_MS };
      }
      if (next.phase !== "playing") mine.back = null;
      draw();
    },
  };
}
