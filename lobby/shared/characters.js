// The characters a player can be, and the colours they can wear: one choice per player, kept
// with the room on the server and sent in the room view (each member carries `character` and
// `colour`). Plain data, so the room (server) can check a choice and the page can list them
// without loading any drawing. How a character is drawn lives with the page
// (public/characters/ for the flat look and the emotes, public/look3d/characters.js for the 3D
// and baked looks): a test keeps those lists the same as this one. The whole interface is
// written down in lobby/README.md, "Characters".
//
// A choice is lobby state, not game state: a game is handed each seat's colour when it starts
// and may ignore the character altogether.

/**
 * The characters, in the order the picker shows them. `move` is what the character's action
 * button does: every character kicks until its own move is built (the ghost's is "fade", the
 * slime's "harden", the robot's "hook").
 */
export const CHARACTERS = [
  { id: "pawn", name: "Pawn", move: "kick" },
  { id: "ghost", name: "Ghost", move: "kick" },
  { id: "slime", name: "Slime", move: "kick" },
  { id: "robot", name: "Robot", move: "kick" },
];

/** What everyone is until they choose, and what an unknown character is read as. */
export const DEFAULT_CHARACTER = "pawn";

/** Whether `id` is a character a player can be. */
export const isCharacter = (id) => typeof id === "string" && CHARACTERS.some((c) => c.id === id);

/** `id` when it is a character, the default when it is not (an older save, a newer page's character this room does not know). */
export const characterOr = (id) => (isCharacter(id) ? id : DEFAULT_CHARACTER);

/** A character's name, for the words. */
export const characterName = (id) => CHARACTERS.find((c) => c.id === id)?.name ?? "Pawn";

/**
 * The colours the picker offers. The first four are the seat colours (party-kit's SEAT_COLOURS:
 * a test keeps them the same), so a new player's piece is already one of the presets. Any other
 * colour may be chosen too (cleanColour).
 */
export const COLOUR_PRESETS = [
  { hex: "#c8382c", name: "Oxblood red" },
  { hex: "#2f6f8f", name: "Enamel blue" },
  { hex: "#d9a02a", name: "Gilt yellow" },
  { hex: "#3f7a4a", name: "Bottle green" },
  { hex: "#d9662b", name: "Marmalade" },
  { hex: "#8a5bc4", name: "Violet" },
  { hex: "#d9619a", name: "Rose" },
  { hex: "#3aa9a0", name: "Teal" },
  { hex: "#f4ead4", name: "Cream" },
  { hex: "#565b66", name: "Slate" },
];

/**
 * How long a player waits between two changes of character or colour. Nobody can strobe their
 * piece, and each change is one room view to everybody and one write of the room to storage, so
 * a script cannot make a room busy with them either.
 */
export const LOOK_COOLDOWN_MS = 1000;
/**
 * How early a second change may come and still be taken. A phone waits out the cooldown by its
 * own clock, but the room measures it at arrival, and two messages are rarely the same time on
 * the wire: ordinary jitter must never turn a patient tap into a refusal.
 */
export const LOOK_SLACK_MS = 250;

/** How dark a chosen colour may be (relative luminance, 0 to 1): the rooms are dark, and a black piece cannot be seen in them. */
export const MIN_LUMINANCE = 0.05;
/** At and above this a colour is "very pale": next to a white ghost its hands need an outline. */
export const PALE_LUMINANCE = 0.62;

const channel = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** The relative luminance of "#rrggbb", 0 (black) to 1 (white). */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(((n >> 16) & 255) / 255) + 0.7152 * channel(((n >> 8) & 255) / 255) + 0.0722 * channel((n & 255) / 255);
}

/** Whether a colour is so pale that a hand in it is lost against a white body. */
export const isPale = (hex) => luminance(hex) >= PALE_LUMINANCE;

/**
 * A chosen colour as the room keeps it: "#rrggbb" in lower case, lifted toward white until it
 * can be seen in a dark room. Returns null for anything that is not a six-digit hex colour.
 */
export function cleanColour(value) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) return null;
  let hex = value.toLowerCase();
  // A few steps toward white; black itself ends as a dark grey.
  for (let i = 0; i < 24 && luminance(hex) < MIN_LUMINANCE; i++) {
    const n = parseInt(hex.slice(1), 16);
    const up = (c) => Math.min(255, Math.round(c + (255 - c) * 0.08) + 1);
    hex = "#" + ((up((n >> 16) & 255) << 16) | (up((n >> 8) & 255) << 8) | up(n & 255)).toString(16).padStart(6, "0");
  }
  return hex;
}

/**
 * A choice a page sent, checked: {character, colour} with whichever parts were sent and are
 * good, or {error} in plain words. A choice may name one part or both.
 */
export function readLook(msg) {
  const out = {};
  if (msg?.c !== undefined) {
    if (!isCharacter(msg.c)) return { error: "That is not a character this room knows." };
    out.character = msg.c;
  }
  if (msg?.v !== undefined) {
    const colour = cleanColour(msg.v);
    if (!colour) return { error: "That is not a colour." };
    out.colour = colour;
  }
  if (out.character === undefined && out.colour === undefined) return { error: "Nothing was chosen." };
  return out;
}
