// The seam between Hot Potato's rules and the potato's look. The page (app.js) makes the art
// here and talks to it only through this interface; the rules (game.js) never see it.
//
//   const art = createPotatoArt(host, { seed, reducedMotion });
//   art.set(state)    every frame: artState(g) from game.js, nothing more:
//                       stage   0 healthy ... 4 last life, 5 burst
//                       growth  0 to 1, how big it has grown (from the stage)
//                       strain  0 to 1, how tight its skin is (growth, plus the burning fuse)
//                       fuse    0 to 1, the fuse left (1 while it is not burning)
//                       light   the status light's colour (green, dim green, yellow, orange, red, dark)
//                       phase   "idle" (the start screen), "ready", "listen", "doom" or "burst"
//                       paused  true while the game is paused (nothing moves)
//   art.play(event, detail)
//                     a moment: "right" (it settles), "worse" (it gets worse), "doom" (the last
//                     miss, before it bursts), "burst", or "reset" (healthy again at once, for a
//                     new round). `detail` says why: { why } is the verdict's reason ("slow",
//                     "used", "echo", "wrong-letter", "word", "overturned" ...), { appeal: true }
//                     a right answer given on appeal. A renderer may ignore what it does not draw.
//   art.look()        what it is showing now, for tests: { growth, strain, burst, burstFor, draws, running }
//   art.destroy()
//
// Two renderers:
//  - the Specimen (art-specimen.js, drawing in specimen-draw.js), the default: the potato with a
//    face in its lab rig, as the Game Art Picker drew it;
//  - the plain potato (art-code.js, geometry in potato-draw.js): the faceless one on a steel
//    stand, kept for comparison and chosen with #plain in the address.

import { createCodePotato } from "./art-code.js";
import { createSpecimen } from "./art-specimen.js";

const plain = () => {
  try {
    return location.hash === "#plain";
  } catch {
    return false;
  }
};

export function createPotatoArt(host, options) {
  return plain() ? createCodePotato(host, options) : createSpecimen(host, options);
}
