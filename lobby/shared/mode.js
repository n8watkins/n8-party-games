// One party, two waiting rooms. A party is in one of two modes, kept with the room on the server
// and sent in the room view (`room.mode`): the side-view room with characters (the Floor, mode
// "party-games", at /lobby/) or a plain waiting room with no characters (the Table, mode
// "turn-based", at /party/). The host
// switches the whole party between them; each page that hears a mode that is not its own moves
// itself to the other page, which resumes the same seat from the same saved session.
//
// Plain data and small rules, so the room (server) and both pages share them without loading
// anything else.
import { ROOM_COOLDOWN_MS, roomLocked } from "./rooms.js";

/** The two modes, in the order the switch shows them. */
export const MODES = ["party-games", "turn-based"];

/** The mode a new party starts in, and the one every party saved before modes is read as. */
export const DEFAULT_MODE = "party-games";

/** Whether `v` is a mode a party can be in. */
export const isMode = (v) => typeof v === "string" && MODES.includes(v);

/** The page that shows each mode. */
export const MODE_PAGE = { "party-games": "/lobby/", "turn-based": "/party/" };

/**
 * Each mode's name, as people read it (the owner's names): the Floor, where everyone plays at
 * once, and the Table, where the party sits, talks and takes turns. The one place they are
 * written: the mode values above are what is stored and sent, and never change with the names.
 */
export const MODE_NAME = { "party-games": "the Floor", "turn-based": "the Table" };

/** A mode's name at the start of a line or on a button: "The Table". */
export const modeTitle = (mode) => MODE_NAME[mode].replace(/^the /, "The ");

/** How long after one switch the party may be switched again: a double tap cannot bounce everyone twice. */
export const MODE_COOLDOWN_MS = ROOM_COOLDOWN_MS;

/**
 * Why the party cannot be switched right now, in plain words, or null when it can. `room` is
 * what the room view carries (`phase`, `vote`); the server asks the same of its own state.
 */
export function modeLocked({ phase, vote }) {
  if (phase === "playing") return "A game is on. You can switch when it ends.";
  if (phase === "settings") return "A game's settings are being chosen. Go back to the room first, then switch.";
  return roomLocked({ phase, vote });
}

/** The mode a room view is in: a room from before modes (or a page that missed it) is the character room. */
export const modeOf = (room) => (isMode(room?.mode) ? room.mode : DEFAULT_MODE);

/** Where the sessionStorage note of the last hop is kept (hopNow, arrived). */
export const HOP_KEY = "n8games:hop";

/** A page hops at most once in this long; after that it offers a link instead, so two pages can never bounce a tab between them. */
export const HOP_GAP_MS = 3000;

/**
 * Whether this page should move itself, and where: the room's mode is not the one this page
 * shows (`mine`). Returns the other page's path, or null to stay.
 */
export function hopTarget(room, mine) {
  const mode = modeOf(room);
  return mode === mine ? null : MODE_PAGE[mode];
}

/**
 * The loop guard. `last` is the hop note this tab left (readHop), `now` the wall clock. A page
 * may hop when it has not hopped in the last HOP_GAP_MS.
 */
export const mayHop = (last, now) => !last || !(now - last.at < HOP_GAP_MS && now >= last.at);

/** The hop note this tab left, or null. */
export function readHop(storage) {
  try {
    const note = JSON.parse(storage?.getItem(HOP_KEY) ?? "null");
    return note && typeof note.at === "number" ? note : null;
  } catch {
    return null;
  }
}

/**
 * Moves this tab to `path`, unless it hopped a moment ago (the loop guard): then returns false
 * and the page offers a link. `text` is said on the page it arrives at ("Ann moved the party
 * here"). Replaced, not added: the back button does not lead into the room just left.
 */
export function hopNow(path, { storage, now = Date.now(), text = "", go = (to) => location.replace(to) } = {}) {
  if (!mayHop(readHop(storage), now)) return false;
  try {
    storage?.setItem(HOP_KEY, JSON.stringify({ at: now, to: path, text }));
  } catch {
    // Private browsing: the hop still happens, unguarded.
  }
  go(path);
  return true;
}

/**
 * On a page that just loaded: what to say about how it got here (the hop's note, once), or "".
 * The note's time stays, so the loop guard still holds on this page.
 */
export function arrived(storage, path, now = Date.now()) {
  const note = readHop(storage);
  if (!note || note.to !== path || note.said || now - note.at > 15_000) return "";
  try {
    storage?.setItem(HOP_KEY, JSON.stringify({ ...note, said: true }));
  } catch {
    // Said again on a reload: harmless.
  }
  return typeof note.text === "string" ? note.text : "";
}

/** The note the room sends when the party switches: who did it, in words. */
export function modeNote(by, mode) {
  return `${by ? `${by} moved` : "Moved"} the party to ${MODE_NAME[mode]}`;
}
