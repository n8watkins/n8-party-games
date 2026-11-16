// Which match a page's game view (the stage) was mounted for. A page that lost its connection
// while one match ended and the next began (a rematch, where a watcher may now play) hears only
// the room as it is now: the view it shows belongs to the old match, with the old match's idea of
// who this device is. The stage is tied to the game and its round, and put away when they differ.

/** The match a room view's game is: its id and round, or null when no game is on. */
export function stageKey(game) {
  return game ? `${game.id}/${game.round}` : null;
}

/**
 * The game's snapshot that came before the page had drawn the room. A phone joining or reloading
 * in the middle of a match is sent the room and then the game as it may see it, while the page is
 * still building the room; a turn-based game (Who Am I?) may then send nothing more for minutes,
 * so that first snapshot is kept, and the stage starts from it once the room is up.
 */
export class EarlySnapshot {
  constructor() {
    this.snapshot = null;
  }
  /** Keeps the latest snapshot that found no room drawn yet. */
  hold(snapshot) {
    this.snapshot = snapshot;
  }
  /** The snapshot to start the stage with now that the room is drawn (`room`: a room view), once; or null. */
  take(room) {
    const snapshot = room?.phase === "playing" && room.game ? this.snapshot : null;
    this.snapshot = null;
    return snapshot;
  }
}

/** Whether a stage mounted for `key` no longer shows the room's game (`room`: a room view). */
export function stageStale(key, room) {
  if (key === null) return false;
  return room?.phase !== "playing" || stageKey(room.game) !== key;
}
