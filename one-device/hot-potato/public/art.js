// The seam between Hot Potato's rules and the potato's look. The page (app.js) makes the art
// here and talks to it only through this interface; the rules (game.js) never see it.
//
//   const art = createPotatoArt(host, { seed, reducedMotion });
//   art.set(state)    every frame: artState(g) from game.js, nothing more:
//                       stage   0 healthy ... 4 last life, 5 burst
//                       growth  0 to 1, how big it has grown (from the stage)
//                       strain  0 to 1, how tight its skin is (growth, plus the burning fuse)
//                       light   the status light's colour (green, dim green, yellow, orange, red, dark)
//                       phase   "ready", "listen", "doom" or "burst"
//                       paused  true while the game is paused (nothing moves)
//   art.play(event)   a moment: "right" (it settles), "worse" (it gets worse: steam as it swells),
//                     "burst", or "reset" (healthy again at once, for a new round)
//   art.look()        what it is showing now, for tests: { growth, strain, burst, burstFor }
//   art.destroy()
//
// Today there is one renderer, the code-drawn potato (art-code.js, geometry in potato-draw.js).
// A picture-based renderer (painted stages matching this design) can replace it by exporting a
// function with the same signature here: it would pick or blend its pictures from `stage` and
// `growth`, scale them by `strain`, tint the light from `light` and play the same four moments,
// with no change to game.js, app.js or the screens.

export { createCodePotato as createPotatoArt } from "./art-code.js";
