// Reading what a 3D page really drew for a robot, by its pixels: for the tests that a colour on its
// paint (a fume's red, a fright's pale) shows on every colour a player can wear, and is not its
// colour times the tint (red on blue paint is near black).
import sharp from "sharp";

/**
 * A small box (css pixels) on a 3D page around the paint of a seat's robot: its body below the
 * plate on its chest, `side` of the way to its left (-1) or right (1) edge, to keep clear of a
 * piece standing up to it. null when there is no such piece.
 */
export function paintBox(page, seat, side = 0, half = 5) {
  return page.evaluate(
    ([seat, side, half]) => {
      const room = window.__room3d;
      const p = room?.pieces.get(seat);
      if (!p?.body.main) return null;
      p.body.group.updateMatrixWorld(true);
      // The body (look3d/robot.js): paint from 0.16 to 0.57 up and 0.215 out in front, the plate from 0.31 to 0.45 (x 1.13).
      // In the world, not along its own turn: x across the screen from the middle of its body.
      const v = p.body.group.position.clone().set(0, 0.235 * 1.13, 0.2 * 1.13);
      p.body.main.localToWorld(v);
      v.x += side * 0.16 * 1.13 * p.body.tilt.scale.x;
      v.project(room.camera);
      const r = room.renderer.domElement.getBoundingClientRect();
      return { x: Math.round(r.left + ((v.x + 1) / 2) * r.width - half), y: Math.round(r.top + ((1 - v.y) / 2) * r.height - half), width: half * 2, height: half * 2 };
    },
    [seat, side, half],
  );
}

/** The mean colour {r, g, b} (0 to 255) a page shows in a box. */
export async function meanColour(page, box) {
  const png = await page.screenshot({ clip: box });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += data[i * info.channels + c];
  return { r: Math.round(sum[0] / n), g: Math.round(sum[1] / n), b: Math.round(sum[2] / n) };
}

/** Whether a colour reads as red: bright enough, and well redder than it is green or blue. */
export const isRed = (c) => c.r >= 110 && c.r > 1.7 * c.g && c.r > 1.7 * c.b;

/** How far apart two colours are (0 to 441). */
export const apart = (a, b) => Math.round(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b));
