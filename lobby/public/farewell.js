// Every way out of the party room ends on the front page (the main menu), never on an empty
// screen. The room leaves a short note for the front page (site/front.js) to say what happened,
// with the way back in while the party is still open.
const NOTE_KEY = "party-room:note";

/**
 * Why this device is no longer in the room, from how it went:
 *   left, screen_left    the player chose "Leave the party" / the screen chose "Stop showing"
 *   seat_lost            away too long: the room let the seat go
 *   screen_lost          away too long, and another device is the room's screen now
 *   room_idle, room_expired, allowance_spent, room_closed   the room itself closed
 */
export function farewellKind(said, screen) {
  if (said === "left") return screen ? "screen_left" : "left";
  if (said === "seat_lost") return screen ? "screen_lost" : "seat_lost";
  return ["room_idle", "room_expired", "allowance_spent"].includes(said) ? said : "room_closed";
}

/** Goes to the front page with a note about the party (`pin`: its four-digit code, if known). */
export function goFront(kind, pin) {
  try {
    sessionStorage.setItem(NOTE_KEY, JSON.stringify({ kind, pin: pin ?? null, at: Date.now() }));
  } catch {
    // Private browsing: the front page simply says nothing.
  }
  // Replaced, not added: the back button does not lead into a room this device has left.
  location.replace("/");
}
