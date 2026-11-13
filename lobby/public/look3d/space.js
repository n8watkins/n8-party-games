// How the room's numbers become a place.
//
// The rules know the room as a flat picture in world units (lobby/shared/world.js): 1920 wide,
// a piece has an x, a light is a stretch of floor. The 3D look keeps that picture exactly. Its
// camera never moves: it looks straight at the back wall, and a device shows a different part
// of the room by sliding and scaling the frame (as a building is photographed), not by turning.
// So one world unit is one pixel of the same 1920 x 1080 picture the flat drawing shows, on two
// planes: the back wall, where the boxes and the words are, and the walking line, where the
// pieces and the pools of light are.
import { ROOM, boxCentre, boxWidth } from "../shared/world.js";

/** World units per metre on the back wall. */
export const U = 125.55;
/** The height on the back wall, in metres, that world y = 0 looks at. */
const Y0 = 6.25;
export const CAM = { y: 4.2, z: 17.5 };
/** The room in metres: its width, its height, the back wall, the front of the stage, the walking line. */
export const SPACE = { w: 14.2, h: 6.8, zBack: -2.5, zFront: 3.0, walkZ: 0.6, lampY: 5.25 };
export const D_WALL = CAM.z - SPACE.zBack;
/** How much nearer the walking line is than the wall: a metre there covers 1 / WALK metres of wall. */
export const WALK = (CAM.z - SPACE.walkZ) / D_WALL;

/** World units to metres on the back wall, and back. */
export const wallX = (xw) => (xw - 960) / U;
export const wallY = (yw) => Y0 - yw / U;
export const worldX = (xm) => 960 + xm * U;
export const worldY = (ym) => (Y0 - ym) * U;

/** Metres along the walking line for a world x, and metres there per world unit. */
export const walkX = (xw) => wallX(xw) * WALK;
export const PX = WALK / U;
/** The world y where a piece's feet touch the floor. */
export const FEET_Y = worldY(CAM.y - CAM.y / WALK);

/** Where a point of the flat picture is in the room, on the plane at depth z (metres). */
export function place(xw, yw, z, out) {
  const k = (CAM.z - z) / D_WALL;
  return out.set(wallX(xw) * k, CAM.y + (wallY(yw) - CAM.y) * k, z);
}

/** The bar of a box's frame, and the gap between frame and box, in metres. */
export const FRAME = { bar: 0.07, gap: 0.05, depth: 0.4 };

/**
 * Where everything hangs for a wall of `n` boxes, in metres from the middle of the wall. The
 * boxes are the approved size (1.75 x 2.45 m) when there are four, and shrink to fit more.
 */
export function layout(n) {
  const slot = (ROOM.boxesRight - ROOM.boxesLeft) / n / U;
  const bw = Math.min(1.75, (boxWidth(n) + 8) / U - 2 * (FRAME.bar + FRAME.gap));
  const bh = bw * 1.4;
  const by = wallY(150) - bh / 2;
  const xs = Array.from({ length: n }, (_, i) => wallX(boxCentre(i, n)));
  const gaps = Array.from({ length: n + 1 }, (_, i) => xs[0] - slot / 2 + i * slot);
  return {
    n,
    slot,
    bw,
    bh,
    by,
    xs,
    /** The middle of each gap beside and between the boxes, on the wall and on the walking line. */
    gaps,
    gapsWalk: gaps.map((x) => x * WALK),
    /** World y of the top of the signs under the boxes, and the width of a sign in world units. */
    signTop: worldY(by - bh / 2 - FRAME.gap - FRAME.bar) + 8,
    signW: Math.min(262, boxWidth(n)),
    /** The door under the join sign and the shelf under the Tonight board (look3d/words.js places the two signs). */
    doorX: wallX(181),
    boardX: wallX(1722),
    wallW: SPACE.w,
    zBack: SPACE.zBack,
    walkZ: SPACE.walkZ,
  };
}
