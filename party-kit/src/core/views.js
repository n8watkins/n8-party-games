// Who sees what: the room shapes every message that carries game state for the socket it goes to.
// A game with a secret per seat (Who Am I?: everyone sees the other player's identity, never their
// own) cannot run on one snapshot for everyone, so the room asks the game once per kind of viewer.
//
// A viewer is one of:
//   { role: "player", seat }   a phone whose seat is in the round
//   { role: "screen" }         the shared big screen, which holds no seat
//   { role: "screen", seat }   a member of the room whose seat is not in the round (they arrived
//                              after it began, or the round was started for fewer seats); they
//                              watch, and get what a screen gets
// A game that ignores the viewer sends everyone the same thing, exactly as before.
//
// Plain logic: no network, no clock. Both room classes (the kit's room and the party room) can use it.

/** The viewer a room member gets. `inRound` is the set of seats in the round, or null when none has begun. */
export function viewerFor({ role, seat }, inRound = null) {
  if (role !== "player") return { role: "screen" };
  if (inRound && !inRound.has(seat)) return { role: "screen", seat };
  return { role: "player", seat };
}

/** One string per kind of viewer, so a message is built once for everyone who sees the same. */
export function viewerKey(viewer) {
  if (viewer.role === "player") return `player:${viewer.seat}`;
  return viewer.seat === undefined ? viewer.role : `${viewer.role}:${viewer.seat}`;
}

/**
 * The events this viewer may receive. An event that names seats in `only` (a seat number or a list
 * of them) reaches only the players in those seats; every other event reaches everyone.
 * (`only` and not `to`: Cork & Bell's events already use `to` for the seat a shot is aimed at.)
 */
export function eventsFor(events, viewer) {
  if (!events.some(isAddressed)) return events;
  return events.filter((e) => !isAddressed(e) || reaches(e.only, viewer));
}

function isAddressed(event) {
  return event !== null && typeof event === "object" && event.only !== undefined;
}

function reaches(only, viewer) {
  if (viewer.role !== "player") return false;
  return Array.isArray(only) ? only.includes(viewer.seat) : only === viewer.seat;
}

/**
 * Builds a message for each viewer and returns the text each one gets, built once per kind of
 * viewer. `make(viewer)` returns the message, or null when this viewer has nothing to receive.
 * @template T
 * @param {Iterable<T>} recipients
 * @param {(recipient: T) => {role: string, seat?: number}} viewerOf
 * @param {(viewer: object) => object | null} make
 * @returns {Array<[T, string]>}
 */
export function fanOut(recipients, viewerOf, make) {
  const built = new Map();
  const out = [];
  for (const recipient of recipients) {
    const viewer = viewerOf(recipient);
    const key = viewerKey(viewer);
    if (!built.has(key)) {
      const message = make(viewer);
      built.set(key, message ? JSON.stringify(message) : null);
    }
    const text = built.get(key);
    if (text !== null) out.push([recipient, text]);
  }
  return out;
}
