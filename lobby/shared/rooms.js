// The rooms a party can be in: one shared choice per party, kept with the room on the server
// and sent in the room view. Plain data, so the room (server) can check a choice and the page
// can list them without loading the 3D look. Each id is a live skin in
// public/look3d/skins.js (a test keeps the two lists the same), whose names they repeat.

/** The live rooms, in the order the picker shows them. */
export const ROOMS = [
  { id: "bar", name: "The bar" },
  { id: "ship", name: "The star lounge" },
  { id: "arcade", name: "The arcade" },
  { id: "camp", name: "The campfire" },
  { id: "roof", name: "The rooftop" },
  { id: "navy", name: "The studio" },
  { id: "fair", name: "The pier fair" },
];

/** The room a new party starts in, unless its start link names another (?room=). */
export const DEFAULT_ROOM = "bar";

/** How long after one change the room may be changed again, for everyone: nobody can strobe the party. */
export const ROOM_COOLDOWN_MS = 4000;

/** Whether `id` is a room a party can be in. */
export const isRoom = (id) => typeof id === "string" && ROOMS.some((room) => room.id === id);

/** A room's name, for the words ("Ada picked the star lounge"). */
export const roomName = (id) => ROOMS.find((room) => room.id === id)?.name ?? "The bar";

/**
 * Why the room cannot be changed right now, in plain words someone can act on, or null when it can. `vote` and
 * `phase` are what the room view carries.
 */
export function roomLocked({ phase, vote }) {
  if (phase === "playing") return "A game is on. You can change the room when it ends.";
  if (vote?.toss) return "A coin toss is picking the game. Wait a moment.";
  // A player alone who stands in a light starts the count, so say how to stop it.
  if (vote?.count) return "The count is running. Step out of the light to change the room.";
  return null;
}
