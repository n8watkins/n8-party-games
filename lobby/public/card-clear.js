// Keeping the pieces' name tags clear of the spot card on a phone (settings-step.js): the card lies
// over the top of the screen while players are chosen on spots, and nobody's name may go under it.
// Plain arithmetic over a camera framing (shared/camera.js), so it is tested without a browser.
// The room's measures come in from the caller: on the site, lobby/shared is served under this
// folder (./shared/), which is not where it lies in the repository.

/** CSS pixels of air between the card's bottom edge and the highest a name tag can go. */
export const CARD_AIR = 8;

/**
 * Where a piece's name tag would be highest, in world units, from the tags as they are drawn:
 * each tag's top with its piece's jump taken off (so a jump does not move the framing), the
 * highest of those, and never less than one step of stacking over the lowest (two pieces that
 * walk together stack their tags). Null when no tag is drawn.
 * @param {{top: number, height: number, up: number}[]} tags  each tag's top and height in CSS pixels, and its piece's height off the floor in world units
 * @param {{y: number, scale: number}} view  the framing the tags were drawn with
 */
export function tagsTop(tags, view) {
  let high = Infinity;
  let low = -Infinity;
  let step = 0;
  for (const t of tags) {
    if (!(t.height > 0)) continue;
    const top = view.y + t.top / view.scale + (t.up || 0);
    high = Math.min(high, top);
    if (top > low) {
      low = top;
      step = t.height / view.scale + 6;
    }
  }
  if (high === Infinity) return null;
  return Math.min(high, low - step);
}

/**
 * A framing like `aim` in which a name tag at world height `top`, even mid-jump, stays below the
 * card's bottom edge with CARD_AIR to spare. The room first sits down on the bar (an upright phone
 * keeps spare floor under the pieces), then, only if that is not enough, draws a little smaller.
 * @param {{x: number, y: number, width: number, height: number, scale: number}} aim  from camera()
 * @param {{cardBottom: number | null, top: number | null, w: number, h: number, bar: number,
 *   jump: number, bottom: number, room: {left: number, right: number}}} o  jump: JUMP_HEIGHT
 *   (shared/world.js); bottom: PHONE_FRAME.bottom, the world line that sits on the bar; room: FRAME (shared/camera.js)
 */
export function clearOfCard(aim, { cardBottom, top, w, h, bar, jump, bottom, room }) {
  if (cardBottom == null || top == null) return aim;
  const worst = top - jump;
  const need = cardBottom + CARD_AIR;
  const open = Math.max(1, h - bar);
  if ((worst - aim.y) * aim.scale >= need) return aim;
  let scale = aim.scale;
  let y = Math.min(aim.y, bottom - open / scale);
  if ((worst - y) * scale < need) {
    scale = Math.max(0.05, Math.min(scale, (open - need) / (bottom - worst)));
    y = bottom - open / scale;
  }
  const width = w / scale;
  const height = h / scale;
  let x = aim.x + aim.width / 2 - width / 2;
  if (width <= room.right - room.left) x = Math.min(room.right - width, Math.max(room.left, x));
  else x = (room.left + room.right) / 2 - width / 2;
  return { x, y, width, height, scale };
}
