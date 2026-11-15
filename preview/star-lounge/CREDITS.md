# The Star Lounge preview: where everything in it came from

## Made for this project, in this repository

Nothing below was downloaded.
No outside model, texture, picture or recording is used.

- The room, the lamps, the chart table, the planet's and the moon's surface, the gas clouds, the rocket, the liner, the saucer and the three rocks.
  All are built by script from plain shapes and Blender's own noise patterns, and rendered with Blender 4.2 (Cycles).
  Source: `lobby/tools/blender/star-lounge.py` and `lobby/tools/blender/star-lounge.json`.
  The pictures in `preview/star-lounge/assets/` are those renders, made smaller (`preview/star-lounge/build.mjs assets`).
- The stars, the ring, the shooting stars, the chart's globe of light, the join sign, the Tonight board, the signs and the name tags.
  All are drawn by the page's own code (`preview/star-lounge/src/main.js`).
- The pieces: the room's own pawn (`lobby/public/look3d/pieces.js`), called and not copied.
- The posters: the room's own poster painting (`lobby/public/look3d/paint.js`), with Cork & Bell's own picture (`lobby/public/look3d/art/cork-and-bell.jpg`), which is this project's art.
- "Today": two stills of the room as it runs on the main branch, taken with `lobby/test/shoot-3d.mjs --room=ship`.

## Already in the project, under their own licence (not public domain)

The posters and buttons use the two typefaces the room already uses, built into the page so the posters look as they do in the room.
Both are under the SIL Open Font License 1.1, which allows this; their licence texts are in the repository.

- Abril Fatface, copyright 2011 TypeTogether. Licence: `node_modules/cork-and-bell/game/fonts/OFL-AbrilFatface.txt` (Cork & Bell ships it).
- Nunito, copyright 2014 The Nunito Project Authors. Licence: `lobby/public/look3d/fonts/OFL-Nunito.txt`.

## Software

- Blender 4.2 (GPL; its renders belong to whoever made the scene).
- three.js r186 (MIT), bundled into the page; the room already uses the same version.
