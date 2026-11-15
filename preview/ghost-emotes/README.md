# Ghost emotes preview

A page on which the owner tries the ghost doing each of the room's 14 emotes and says which fits work.
It is a picking step: nothing here is part of the room yet.

## Build

```
npm ci
node preview/ghost-emotes/build.mjs
```

This writes `preview/ghost-emotes/dist/index.html`, one self-contained file that makes no request to anywhere.
`dist/` is ignored by git, so build it again when you need it.
`--no-sound` leaves the recordings out.
`dist/wrapped.html` is the same page inside the wrapper a hosted page gets, for opening locally.

## Check

```
devguard slot -- node preview/ghost-emotes/check.mjs <out-dir> [sheets] [layout] [stress]
```

It runs a headless, muted browser and writes pictures to `<out-dir>`.
`sheets` holds every emote and take at its best moment, solid and faded.
`layout` measures the page at 390 by 844, 844 by 390, 667 by 375 and 360 by 640.
`stress` spams taps, cuts an emote off halfway and rotates.

## What the room can reuse

- `src/ghost-rig.js` is the data: every emote as `pose(t, calm, reach, take)`, in the same terms as `lobby/public/emotes/rig.js`.
  A pose has the same `body`, `face`, `hands`, `props`, `fx` and `other`, so `lobby/public/emotes/svg.js` draws its props and effects unchanged.
  It adds `pose.ghost = {limb, yaw, puff, nubs}` and the ghost's measurements (`GHOST`).
  Ids, names, words, durations and the timing of each beat are the pawn's, so each recording fits both characters.
- `src/ghost-limbs.js` draws the hands.
  The hands are `lobby/public/look3d/emote-arms.js` as it is, with the stick arm hidden; the wisp arm is the one new shape.
- `src/bodies.js` holds the ghost as approved in the character previews, plus how a pose is laid over it (lean, lift, swell, turn of the face, mouth shapes, the red of fuming).

The takes are `float` (detached hands), `wisp` (the sheet reaches out) and `haunt` (the prop floats by itself).
The build fails if the ghost's emote ids are not exactly the room's (`party-kit/client/emotes.js`).

## Things to know

- The page reads from `lobby/` and `party-kit/` at build time and changes nothing there.
- The poses were tuned by eye against the 3D camera, so the numbers already allow for the hands sitting in front of the body.
- Sound is the room's own recordings (`lobby/public/sounds/emote-<id>.mp3`, all CC0, credited in `lobby/public/sounds/CREDITS.txt`), embedded as base64.
  Nobody has judged them by ear on the ghost.
