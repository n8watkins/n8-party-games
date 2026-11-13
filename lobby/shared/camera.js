// Which part of the room a device shows. Plain arithmetic, so it is tested without a browser.
//
// The room is drawn in world units (lobby/shared/world.js) and the wall and floor carry on past
// its edges, so any shape of screen can be filled without bars. A big screen shows the whole
// room. A phone held sideways shows the whole room too, slightly cropped at the top, or a
// closer view that follows the player's own piece.

/** The whole picture a big screen shows: the stills' 1920 x 990 above the bottom line. */
export const FRAME = { left: 0, right: 1920, top: 0, bottom: 990 };
/** What a phone must still show in "whole room": every box, the join sign and the board, from the lamps down. */
export const PHONE_FRAME = { left: 40, right: 1880, top: 118, bottom: 950 };
/** How much closer "Closer" is than fitting the room's width, as in the stills: the least it zooms. */
export const CLOSER = 1.25;
/** A piece's height in world units (the pawn in scene.js, head to foot). */
export const PIECE_HEIGHT = 141;
/**
 * On a phone, "Closer" zooms in until a piece is this tall on the screen, in CSS pixels (about
 * 14 mm on a phone: big enough to see who is who at arm's length), so a small phone is not left
 * with tiny pieces. The width rule above still sets the least it zooms.
 */
export const PIECE_CSS = 90;
/**
 * But never so close that the signs under the posters leave the top of the screen: "Closer"
 * always shows at least this much of the room above the foot of the frame (from the signs down).
 */
export const CLOSER_SHOWS = 520;
/** An upright phone shows this much of the room's width around the player. */
export const UPRIGHT_WIDTH = 720;

/**
 * @param {{w: number, h: number, bar?: number, mode?: "room" | "closer", focusX?: number, phone?: boolean}} o
 *   w, h: the viewport in CSS pixels. bar: the height of the strip of controls or the bottom line
 *   laid over the foot of the picture. focusX: the player's own piece, for "closer".
 * @returns {{x: number, y: number, width: number, height: number, scale: number}} an SVG viewBox and its scale
 */
export function camera({ w, h, bar = 0, mode = "room", focusX = 960, phone = false }) {
  const frame = phone ? PHONE_FRAME : FRAME;
  const open = Math.max(1, h - bar);
  const upright = phone && h > w;
  let scale = Math.min(w / (frame.right - frame.left), open / (frame.bottom - frame.top));
  if (upright) scale = w / UPRIGHT_WIDTH;
  else if (mode === "closer") {
    const wide = (w / (FRAME.right - FRAME.left)) * CLOSER;
    // A phone zooms in to a comfortable piece, as long as the signs stay on the screen.
    const comfy = phone ? Math.min(PIECE_CSS / PIECE_HEIGHT, open / CLOSER_SHOWS) : 0;
    scale = Math.max(scale, wide, comfy);
  }
  const width = w / scale;
  const height = h / scale;
  const following = upright || mode === "closer";
  let x = (following ? focusX : (frame.left + frame.right) / 2) - width / 2;
  // A view narrower than the room stays inside it; a wider one is centred on it.
  if (width <= FRAME.right - FRAME.left) x = Math.min(FRAME.right - width, Math.max(FRAME.left, x));
  else x = (FRAME.left + FRAME.right) / 2 - width / 2;
  // The foot of the frame sits on top of the bar; the floor carries on under it. An upright
  // phone has room to spare, so the room sits in the middle of what is left above the bar.
  let y = frame.bottom - open / scale;
  if (upright) y = Math.max(y, (FRAME.top + frame.bottom - open / scale) / 2);
  return { x, y, width, height, scale };
}
