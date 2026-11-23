// What every room view (the flat Scene through room-view.js's FlatRoomView, and look3d/room3d.js's
// Room3D) answers to, in one list, so the page (main.js) and the stand-in it uses while the next
// view loads cannot drift apart from the views. A unit test holds every view and the stand-in to
// this list, and main.js to calling nothing else.

/** What the room said, heard while a view is up: a view that loads meanwhile is told it after (heard in order). */
export const HEARD = ["setVote", "onMove", "onBump", "onCharge", "onFade", "onSpook", "onExpress", "onHook", "onHookVerdict", "onStilts", "onSlime", "onShove"];

/** What this page's own player did at once, before the room answers: told to a view that loads meanwhile too. */
export const OWN = ["ownJump", "ownBump", "ownCharge", "ownRelease", "ownHook", "ownStilts", "ownSlime", "ownRefused"];

/** The rest: drawing the room, and the view's own life. */
export const OTHER = ["build", "setRoom", "setCompact", "frame", "destroy", "ownX"];

export const VIEW_METHODS = [...HEARD, ...OWN, ...OTHER];

/**
 * A stand-in for the room view while the next one loads: it answers to everything a view does,
 * draws nothing, and keeps what it heard (`heard`: [method, args] in order) so the new view can
 * be told it once it is up (replay). `own`: where this page's own piece stands.
 */
export function standIn(own) {
  const heard = [];
  const view = { paused: true, look: "", heard };
  for (const name of VIEW_METHODS) view[name] = () => {};
  for (const name of [...HEARD, ...OWN]) view[name] = (...args) => void heard.push([name, args]);
  view.ownX = () => own;
  /**
   * Tells `next` what this stand-in heard, in order: what came after `since` (the whole room the
   * new view was built from was heard then, and already says what came before it). Each call's
   * last argument is when it was heard.
   */
  view.replay = (next, since = -Infinity) => {
    for (const [name, args] of heard.splice(0)) {
      const at = args.at(-1);
      if (!(typeof at === "number" && at <= since)) next[name](...args);
    }
  };
  return view;
}
