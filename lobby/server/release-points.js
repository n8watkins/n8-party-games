// When a page in the party room may load a new version of the site (plan step 3, "New version
// available"), read from the room as every page sees it (LobbyCore.view): never in the middle of
// something the party is doing together.
//
// A page that is older than the site reloads itself only at such a moment, and comes straight back
// to its seat from its saved session; at any other moment it says "New version ready, it will load
// after this round" and waits for the room's next `{t: "release"}`, which the room sends as it
// comes to one (lobby-room.js). The rule lives here, apart from the room's other rules, so it can be
// tested phase by phase (lobby/test/release-points.test.js).

/**
 * Why a page may not reload now, or null when it may. `view` is LobbyCore.view(now).
 *
 * - A game is being played, on the Floor (Cork & Bell's round, Tin Derby's race) or at the Table
 *   (a turn of Paper Masks, Who Am I?): not until it ends and the result is shown.
 * - A game's settings are being chosen (who plays, which spots): not until they start or are put away.
 * - The vote's count or its coin toss is running on the Floor: a reload would take a player out of
 *   the light that is choosing the game.
 * - The Table's host has just picked a game and everyone sees it starting (`starting`).
 * - The room is closing: a reload would only come back to a room that is going.
 *
 * Everything else is a safe point: the lobby with nobody choosing, people walking about or
 * standing in a light before any count, the last game's result on show, the Table's list.
 */
export function unsafeBecause(view) {
  if (!view || typeof view !== "object") return "no room";
  if (view.closing) return "closing";
  if (view.phase === "playing" || view.game) return "playing";
  if (view.phase === "settings") return "settings";
  if (view.phase !== "lobby") return "busy";
  if (view.vote?.count) return "count";
  if (view.vote?.toss) return "toss";
  if (view.starting) return "starting";
  return null;
}

/** Whether a page may reload now (see unsafeBecause). */
export function releaseSafe(view) {
  return unsafeBecause(view) === null;
}
