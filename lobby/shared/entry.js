// The way in, as plain logic: what a device is offered when it starts or joins a party.
//
// A phone is a device to play on, so its way in leads with playing, and "use this as the
// room's screen" is a small link under the form. A wide screen is offered both, side by side.
// Nothing is decided for anybody: whichever way a device leans, the other choice is one tap
// away, until the room's one screen is taken (then there is nothing to offer).

/** A phone, by the size of its window: the same rule the room uses to pick a phone's signs. */
export function isSmall(width, height) {
  return Math.min(width, height) < 520;
}

/**
 * What the way in shows.
 * @param {{small: boolean, starting: boolean, as: "player" | "screen", screenTaken?: boolean}} o
 *   small: a phone. starting: making a party, not joining one. as: what the device has chosen
 *   so far. screenTaken: the party being joined already has its screen.
 * @returns {{as: "player" | "screen", choice: "cards" | "link" | "none", link: null | {to: "player" | "screen", text: string},
 *   title: string, sub: string, go: string, askName: boolean, note: string}}
 */
export function doorPlan({ small, starting, as, screenTaken = false }) {
  const taken = !starting && screenTaken;
  const role = taken ? "player" : as === "screen" ? "screen" : "player";
  const screen = role === "screen";
  const device = small ? "phone" : "device";
  let link = null;
  if (small && !taken) link = screen ? { to: "player", text: `Play on this ${device} instead` } : { to: "screen", text: `Use this ${device} as the room's screen` };
  let title = starting ? "Start a party" : "Type the room code";
  let sub = starting ? "You get a room and a code. Friends join with the code or the QR code on the wall." : "It is on the sign by the door in the room.";
  if (small && screen) {
    title = starting ? "Start a party on this screen" : "Show the room on this phone";
    sub = "This phone shows the room and the games for everyone. Nobody plays from it.";
  }
  return {
    as: role,
    // A wide screen sees both choices as two cards; a phone sees a link; a taken screen leaves nothing to choose.
    choice: taken ? "none" : small ? "link" : "cards",
    link,
    title,
    sub,
    go: screen ? "Show the room here" : starting ? "Start the party" : "Join the party",
    askName: !screen,
    // Said where a choice has gone missing: to a wide screen, and to a phone that asked to be the screen.
    note: taken && (!small || as === "screen") ? "This party already has its screen, so you join as a player." : "",
  };
}

/** The two cards a wide screen is offered: [value, title, text]. */
export const ROLE_CARDS = [
  ["player", "Play on this device", "Join as a player, with your own piece."],
  ["screen", "Use this as the room's screen", "Shows the room and the games for everyone. Nobody plays from it."],
];
