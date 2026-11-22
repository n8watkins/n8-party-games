// How far to either side each drawing of the room is drawn as room, and the camera kept inside it.
//
// The room's rules know it as 1920 world units wide (shared/world.js), and a big screen shows
// exactly that. A phone held sideways is wider than the room for its height: to show the room
// from the tops of the lamps down to the pools (shared/camera.js, PHONE_FRAME) it shows more
// than 1920 across, and it sets the room to the left of its corner buttons, so most of the spare
// width is past the room's right end (to about 2350 on an 844 x 390 phone, 2600 with the
// browser's bars). Every drawing carries the room on past its ends, as wall and floor and not as
// darkness, at least as far as its reach here says; withinReach keeps a view inside it, for a
// screen wider still. Plain arithmetic, so it is tested without a browser
// (lobby/test/reach.test.js, and lobby/test/shoot-fill.mjs looks at the pictures).
//
// None of this moves anything the room counts: the pools and the pieces stay where the room
// (server) puts them, in the same world units; only how far the picture goes changes.

/**
 * Each drawing's reach, in world units: from `left` to `right` it is room. The 3D look's room
 * (look3d/room3d.js, shell) has walls at its two ends that run forward to the front of its
 * stage, so a view out to 2900 sees end wall and not past it. The flat drawing's wall and floor
 * run on to its fade (scene.js, backdrop). The rendered rooms reach as far as their pictures do
 * (their plate.json's rect, passed in by the drawing).
 */
export const REACH = {
  flat: { left: -1100, right: 3000 },
  "3d": { left: -1000, right: 2900 },
};

/**
 * `view` (shared/camera.js, camera) kept inside `reach`. A view wider than the reach is brought in
 * to its width, about its own middle, with the line it stands on the bar kept where it was (the
 * pieces' feet and the pools stay on screen; the top of the room gives way); then it is slid
 * inside. A view already inside is returned as it is. With `slide` only, a view is never brought
 * in, only slid (one wider than the reach is set in its middle): for a framing whose size is set
 * by something that must stay on screen (card-clear.js).
 *
 * @param {{x: number, y: number, width: number, height: number, scale: number}} view
 * @param {{left: number, right: number} | null | undefined} reach
 * @param {number} bar the height of the strip over the foot of the picture, CSS pixels
 * @param {number} h the viewport's height, CSS pixels
 * @param {{slide?: boolean}} [o]
 */
export function withinReach(view, reach, bar = 0, h = view.height * view.scale, { slide = false } = {}) {
  if (!reach) return view;
  let { x, y, width, height, scale } = view;
  const span = reach.right - reach.left;
  if (width > span && slide) {
    x = (reach.left + reach.right) / 2 - width / 2;
    return x === view.x ? view : { x, y, width, height, scale };
  }
  if (width > span) {
    const k = width / span;
    const open = Math.max(1, h - bar);
    const foot = y + open / scale;
    const middle = x + width / 2;
    scale *= k;
    width = span;
    height /= k;
    x = middle - width / 2;
    y = foot - open / scale;
  }
  x = Math.min(reach.right - width, Math.max(reach.left, x));
  if (x === view.x && width === view.width) return view;
  return { x, y, width, height, scale };
}
