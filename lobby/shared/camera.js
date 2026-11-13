// Which part of the room a device shows. Plain arithmetic, so it is tested without a browser.
//
// The room is drawn in world units (lobby/shared/world.js) and the wall and floor carry on past
// its edges, so any shape of screen can be filled without bars. A big screen shows the whole
// room. A phone held sideways shows the whole room too, from the lamps over the boxes down to
// the pools on the floor, or a closer view that follows the player's own piece.

/** The whole picture a big screen shows: the stills' 1920 x 990 above the bottom line. */
export const FRAME = { left: 0, right: 1920, top: 0, bottom: 990 };
/**
 * What a phone must still show in "whole room": every box, the join sign and the board, from the
 * tops of the lamps over the boxes (so the beams can be seen to come from them) down to the pools
 * of light and the pieces' feet, with no strip of empty floor under them.
 */
export const PHONE_FRAME = { left: 40, right: 1880, top: 30, bottom: 915 };
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
/** The smallest a piece is ever drawn in "Closer" on a phone, in CSS pixels, signs or no signs. */
export const PIECE_MIN_CSS = 70;
/** The top of the signs under the posters in the flat drawing, in world units (scene.js, SIGN_TOP). */
export const SIGN_TOP = 454;

/**
 * The top of the signs for a wall of `n` boxes, in whichever drawing has them higher. The 3D look
 * sizes its boxes to the wall (look3d/space.js, layout), so with more boxes its signs sit higher
 * than the flat drawing's; this is the same sum, in world units.
 */
export function signTop(n) {
  const U = 125.55;
  const bw = Math.min(1.75, ((1284 / n - 36) + 8) / U - 0.24);
  const bh = bw * 1.4;
  const bottom = 6.25 - 150 / U - bh - 0.12;
  return Math.min(SIGN_TOP, (6.25 - bottom) * U + 8);
}
/**
 * But never so close that the signs go under the buttons in the top corner (Rooms and the door,
 * 44 pixels and their margin): the signs always start at least this far down the screen.
 */
export const CORNER_CLEAR = 58;
/**
 * The top right corner of a phone's screen holds three buttons (sound, Rooms and the door:
 * room-menu.js, hud.js): in "whole room", when the room is narrower than the screen, it is set to
 * the left of them, so they cover nothing on the wall; when there is not quite room for that, it
 * goes as far left as it can. CSS pixels.
 */
export const CORNER_WIDTH = 162;
/** An upright phone shows this much of the room's width around the player. */
export const UPRIGHT_WIDTH = 720;

/**
 * @param {{w: number, h: number, bar?: number, mode?: "room" | "closer", focusX?: number, phone?: boolean, boxes?: number}} o
 *   w, h: the viewport in CSS pixels. bar: the height of the strip of controls or the bottom line
 *   laid over the foot of the picture. focusX: the player's own piece, for "closer". boxes: how
 *   many boxes hang on the wall (the 3D look's signs are higher with more of them).
 * @returns {{x: number, y: number, width: number, height: number, scale: number}} an SVG viewBox and its scale
 */
export function camera({ w, h, bar = 0, mode = "room", focusX = 960, phone = false, boxes = 5 }) {
  const sideways = phone && w >= h;
  const frame = phone ? PHONE_FRAME : FRAME;
  const open = Math.max(1, h - bar);
  const upright = phone && h > w;
  let scale = Math.min(w / (frame.right - frame.left), open / (frame.bottom - frame.top));
  if (upright) scale = w / UPRIGHT_WIDTH;
  else if (mode === "closer") {
    const wide = (w / (FRAME.right - FRAME.left)) * CLOSER;
    if (!phone) scale = Math.max(scale, wide);
    else {
      // A phone zooms in to a comfortable piece, but not so far that the signs go under the
      // corner buttons, unless that would leave the pieces smaller than PIECE_MIN_CSS.
      const clear = (open - CORNER_CLEAR) / (frame.bottom - signTop(boxes));
      scale = Math.max(scale, Math.min(Math.max(wide, PIECE_CSS / PIECE_HEIGHT), Math.max(clear, PIECE_MIN_CSS / PIECE_HEIGHT)));
    }
  }
  const width = w / scale;
  const height = h / scale;
  const following = upright || mode === "closer";
  let x = (following ? focusX : (frame.left + frame.right) / 2) - width / 2;
  // A view narrower than the room stays inside it; a wider one is centred on it.
  if (width <= FRAME.right - FRAME.left) x = Math.min(FRAME.right - width, Math.max(FRAME.left, x));
  else x = (FRAME.left + FRAME.right) / 2 - width / 2;
  // A sideways phone's whole room: in the middle of what the corner buttons leave, if it fits there.
  const across = (frame.right - frame.left) * scale;
  if (sideways && !following && across + CORNER_WIDTH <= w) x = frame.left - (w - CORNER_WIDTH - across) / 2 / scale;
  else if (sideways && !following && across < w) x = frame.left;
  // The foot of the frame sits on top of the bar; the floor carries on under it. An upright
  // phone has room to spare, so the room sits in the middle of what is left above the bar.
  let y = frame.bottom - open / scale;
  if (upright) y = Math.max(y, (FRAME.top + frame.bottom - open / scale) / 2);
  return { x, y, width, height, scale };
}
