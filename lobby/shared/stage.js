// Which match a page's game view (the stage) was mounted for. A page that lost its connection
// while one match ended and the next began (a rematch, where a watcher may now play) hears only
// the room as it is now: the view it shows belongs to the old match, with the old match's idea of
// who this device is. The stage is tied to the game and its round, and put away when they differ.

/** The match a room view's game is: its id and round, or null when no game is on. */
export function stageKey(game) {
  return game ? `${game.id}/${game.round}` : null;
}

/** Whether a stage mounted for `key` no longer shows the room's game (`room`: a room view). */
export function stageStale(key, room) {
  if (key === null) return false;
  return room?.phase !== "playing" || stageKey(room.game) !== key;
}

/**
 * A mounted view hears the room view each time it changes, if it asks to (an optional `room(view)` on what
 * `mount` returned: GAME-CONTRACT.md, "In the browser"). A view without it is not touched, and a view whose hook
 * throws does not stop the room's page. Returns whether the view was told.
 */
export function tellRoom(view, room) {
  if (typeof view?.room !== "function") return false;
  try {
    view.room(room);
    return true;
  } catch (err) {
    console.warn(`a game's view failed on a room update: ${err?.message ?? err}`);
    return false;
  }
}
