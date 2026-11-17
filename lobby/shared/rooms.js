// The rooms a party can be in: one shared choice per party, kept with the room on the server
// and sent in the room view. Plain data, so the room (server) can check a choice and the page
// can list them without loading the 3D look. Each id is a live skin in
// public/look3d/skins.js (a test keeps the two lists the same), whose names they repeat.
import { evenWall, litOf, placedWall } from "./world.js";

/**
 * The live rooms, in the order the picker shows them. A room whose picture hangs its game boxes
 * in frames of its own says where they are (`frames`: the middle of each, in world units) and
 * which frames a wall of so many boxes uses (`hang`: {number of boxes: the frames, left to
 * right}), so a wall with fewer boxes than frames hangs in a chosen few. Any other room, and any
 * other number of boxes, spaces the boxes evenly.
 */
export const ROOMS = [
  // The bar's painting (look3d/rendered/bar) hangs five gold frames, closer together than the
  // even wall: the middles of their openings (bar/layers/plate.json, a test keeps them the same).
  // The Floor's wall is five: Cork & Bell, Flood, Tin Derby, Fox Trouble and the ideas poster, one
  // to a frame, so the two games a party can play hang a frame apart and their pools can be wide.
  { id: "bar", name: "The bar", frames: [656.4, 814.0, 971.5, 1129.1, 1286.2], hang: { 5: [0, 1, 2, 3, 4] } },
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

/** Where a room hangs a wall of `n` boxes in its own frames (the middles, left to right), or null when it hangs them evenly. */
export function framesFor(room, n) {
  const chosen = room?.frames && room.hang?.[n];
  return chosen && chosen.length === n ? chosen.map((f) => room.frames[f]) : null;
}

/**
 * The wall of room `id` for these boxes (shared/world.js): where they hang and where their pools
 * of light lie, a pool only under a box that can be played (world.js, hasPool). The room's own
 * frames when it has them for that many boxes; evenly spaced otherwise. `boxes` is the wall's
 * boxes, or a number of boxes that all have a light. The room (server) decides who stands in
 * which light by it, and every look draws it.
 */
export function wallFor(id, boxes) {
  const n = Array.isArray(boxes) ? boxes.length : boxes;
  const xs = framesFor(ROOMS.find((room) => room.id === id), n);
  return xs ? placedWall(xs, litOf(boxes)) : evenWall(n, litOf(boxes));
}

/** Whether room `id` hangs a wall of `n` boxes in places of its own (and not evenly). */
export const hangsOwnBoxes = (id, n) => !!framesFor(ROOMS.find((room) => room.id === id), n);

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
